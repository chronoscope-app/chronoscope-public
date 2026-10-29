//! Indexed, disk-backed events. Working databases are private disposable copies.
//! IDs remain decimal strings; SQLite rowids are internal and never exposed as identity.
use crate::{model::*, project::Project};
use rusqlite::{params, types::Value as SqlValue, Connection};
use serde_json::{json, Value};
use std::{
    cell::RefCell,
    collections::BTreeMap,
    path::{Path, PathBuf},
};

mod display;
pub mod statistics;
mod summary;
mod validation;

const APPLICATION_ID: i64 = 0x4348524f;
// SQLite INTEGER affinity accepts fractional REAL values too. Retain the existing
// indexed layout so upgrading old workspaces does not rewrite every Event row.
// user_version=3 gates fractional-time files from minute-only readers.
const SCHEMA: &str = "
CREATE TABLE meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);
CREATE TABLE events(r INTEGER PRIMARY KEY,id TEXT NOT NULL UNIQUE,id_key TEXT NOT NULL,
 entity TEXT NOT NULL,time INTEGER NOT NULL,t_end INTEGER NOT NULL,lat REAL,lon REAL,
 category TEXT NOT NULL,label TEXT NOT NULL,value REAL,related_to TEXT NOT NULL,
 source TEXT NOT NULL,source_row INTEGER NOT NULL,end INTEGER,tags TEXT NOT NULL,note TEXT NOT NULL,mgrs_precision INTEGER,geometry_wkt TEXT,payload TEXT NOT NULL CHECK(length(payload)<=2097152));
CREATE INDEX events_id_order ON events(id_key);
CREATE INDEX events_time ON events(time,r);
CREATE INDEX events_end ON events(t_end,r);
CREATE INDEX events_track ON events(entity,time,id_key);
CREATE INDEX events_geometry ON events(r) WHERE geometry_wkt IS NOT NULL;
CREATE INDEX events_category ON events(category,r);
CREATE INDEX events_source ON events(source,r);
CREATE INDEX events_value ON events(value,r);
CREATE TABLE attributes(r INTEGER NOT NULL,key TEXT NOT NULL,text TEXT NOT NULL,num REAL,
 PRIMARY KEY(r,key));
CREATE INDEX attributes_text ON attributes(key,text,r);
CREATE INDEX attributes_num ON attributes(key,num,r);
CREATE VIRTUAL TABLE search USING fts5(text, tokenize='trigram',detail=none,columnsize=0);
CREATE VIRTUAL TABLE spatial USING rtree(r,lat_min,lat_max,lon_min,lon_max);
CREATE TABLE resources(name TEXT PRIMARY KEY,sha TEXT NOT NULL,bytes BLOB NOT NULL);
CREATE TABLE history(seq INTEGER PRIMARY KEY,description TEXT NOT NULL,before_meta TEXT NOT NULL,
 after_meta TEXT NOT NULL,undone INTEGER NOT NULL DEFAULT 0);
CREATE TABLE history_rows(seq INTEGER NOT NULL,id TEXT NOT NULL,before TEXT,after TEXT,
 PRIMARY KEY(seq,id));
";
fn err(e: impl std::fmt::Display) -> String {
    let message = e.to_string();
    if message.contains("disk is full") {
        format!("RESOURCE_LIMIT: workspace exceeds its 32 GiB database budget or working disk is full; allow space for working copies, portable saves and journals ({message})")
    } else {
        format!("Workspace database: {message}")
    }
}
struct TableScope<'a> {
    viewport: Option<&'a GeoBounds>,
    cell: Option<&'a crate::display::Cell>,
    search: &'a str,
}
fn search_text(e: &Event) -> String {
    [
        e.entity.as_str(),
        &e.category,
        &e.label,
        &e.related_to,
        &e.note,
    ]
    .into_iter()
    .chain(e.attrs.values().map(String::as_str))
    .chain(e.tags.iter().map(String::as_str))
    .collect::<Vec<_>>()
    .join("\n")
    .to_lowercase()
}
pub fn event_json(e: &Event) -> Value {
    let mut v = serde_json::to_value(e).expect("validated finite event");
    v["id"] = json!(e.id.to_string());
    v
}
fn reclaim_stale(data_dir: &Path) {
    // Recoverable sessions survive ordinary stale-working-directory cleanup.
    let protected: std::collections::BTreeSet<PathBuf> = std::fs::read_dir(data_dir)
        .into_iter()
        .flatten()
        .flatten()
        .take(10000)
        .filter(|e| e.file_name().to_string_lossy().starts_with("recovery-"))
        .filter_map(|e| std::fs::read(e.path()).ok().filter(|b| b.len() <= 32768))
        .filter_map(|b| serde_json::from_slice::<Value>(&b).ok())
        .filter_map(|v| v["database"].as_str().map(PathBuf::from))
        .filter_map(|p| p.parent().map(|p| data_dir.join(p)))
        .collect();
    let Ok(entries) = std::fs::read_dir(data_dir) else {
        return;
    };
    for entry in entries.take(1000).flatten() {
        let path = entry.path();
        if protected.contains(&path) {
            continue;
        }
        if !entry
            .file_name()
            .to_string_lossy()
            .starts_with("workspace-")
        {
            continue;
        }
        let Ok(meta) = std::fs::symlink_metadata(&path) else {
            continue;
        };
        if !meta.is_dir()
            || meta.file_type().is_symlink()
            || meta
                .modified()
                .ok()
                .and_then(|m| m.elapsed().ok())
                .is_none_or(|age| age < std::time::Duration::from_secs(86400))
        {
            continue;
        }
        let lease = path.join(".lease");
        if lease.exists() {
            let Ok(lock) = std::fs::OpenOptions::new()
                .read(true)
                .write(true)
                .open(lease)
            else {
                continue;
            };
            if lock.try_lock().is_err() {
                continue;
            }
            drop(lock);
        }
        let _ = std::fs::remove_dir_all(path);
    }
}
fn decode_event(text: &str) -> Result<Event, String> {
    if text.len() > 2 * 1024 * 1024 {
        return Err("Event payload exceeds 2 MiB".into());
    }
    let event: Event = serde_json::from_str(text).map_err(err)?;
    event.validate()?;
    Ok(event)
}
#[derive(Clone)]
struct Cached {
    table: String,
    used: u64,
}
struct WorkingDirectory {
    directory: Option<tempfile::TempDir>,
    retain: std::sync::atomic::AtomicBool,
}
impl WorkingDirectory {
    fn path(&self) -> &Path {
        self.directory
            .as_ref()
            .expect("live working directory")
            .path()
    }
}
impl Drop for WorkingDirectory {
    fn drop(&mut self) {
        if self.retain.load(std::sync::atomic::Ordering::Relaxed) {
            if let Some(directory) = self.directory.take() {
                let _ = directory.keep();
            }
        }
    }
}
pub struct DataStore {
    pub connection: Connection,
    path: PathBuf,
    cache: RefCell<BTreeMap<String, Cached>>,
    clock: RefCell<u64>,
    pub data_revision: u64,
    selection_revision: u64,
    previous_selection: RefCell<std::collections::BTreeSet<u64>>,
    summary_cache: RefCell<BTreeMap<String, Value>>,
    selection_summary_cache: RefCell<BTreeMap<String, Value>>,
    selected_entities_cache: RefCell<Option<(u64, u64, Value)>>,
    facet_cache: RefCell<BTreeMap<String, (u64, u64, Value)>>,
    summary_cache_bytes: std::cell::Cell<usize>,
    selection_cache_bytes: std::cell::Cell<usize>,
    summary_builds: std::cell::Cell<u64>,
    statistics_builds: std::cell::Cell<u64>,
    column_cache: RefCell<BTreeMap<Option<String>, Vec<String>>>,
    _lease: std::sync::Arc<std::fs::File>,
    _directory: std::sync::Arc<WorkingDirectory>,
}
/// Independent WAL reader pins its revision and keeps the working files alive
/// even when the user opens another project during an analysis.
pub(crate) struct AnalyticsRead {
    pub connection: Connection,
    _lease: std::sync::Arc<std::fs::File>,
    _directory: std::sync::Arc<WorkingDirectory>,
}
impl DataStore {
    pub(crate) fn analytics_read(&self) -> Result<AnalyticsRead, String> {
        self.connection.execute("INSERT OR IGNORE INTO meta VALUES('analytics_generation',lower(hex(randomblob(16))))",[]).map_err(err)?;
        let c = Connection::open_with_flags(&self.path, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY)
            .map_err(err)?;
        Self::register_functions(&c)?;
        c.execute_batch("PRAGMA trusted_schema=OFF; PRAGMA temp_store=FILE; PRAGMA cache_size=-8192; PRAGMA temp.cache_size=-8192; PRAGMA temp.max_page_count=65536; PRAGMA busy_timeout=2000; BEGIN;").map_err(err)?;
        c.query_row("SELECT count(*) FROM meta", [], |r| r.get::<_, u64>(0))
            .map_err(err)?;
        c.progress_handler(10000, Some(crate::operation::cancelled));
        Ok(AnalyticsRead {
            connection: c,
            _directory: self._directory.clone(),
            _lease: self._lease.clone(),
        })
    }
    pub fn new(data_dir: &Path) -> Result<Self, String> {
        std::fs::create_dir_all(data_dir).map_err(err)?;
        reclaim_stale(data_dir);
        let dir = tempfile::Builder::new()
            .prefix("workspace-")
            .tempdir_in(data_dir)
            .map_err(err)?;
        let lease = std::fs::OpenOptions::new()
            .create_new(true)
            .read(true)
            .write(true)
            .open(dir.path().join(".lease"))
            .map_err(err)?;
        lease.lock().map_err(err)?;
        let path = dir.path().join("events.sqlite");
        let connection = Connection::open(&path).map_err(err)?;
        Self::configure(&connection)?;
        connection.execute_batch(SCHEMA).map_err(err)?;
        connection
            .pragma_update(None, "application_id", APPLICATION_ID)
            .map_err(err)?;
        connection
            .pragma_update(None, "user_version", 3)
            .map_err(err)?;
        connection
            .execute_batch("CREATE TEMP TABLE selection(id TEXT PRIMARY KEY)")
            .map_err(err)?;
        Ok(Self {
            connection,
            path,
            cache: RefCell::default(),
            clock: RefCell::new(0),
            data_revision: 1,
            selection_revision: 1,
            previous_selection: RefCell::default(),
            summary_cache: RefCell::default(),
            selection_summary_cache: RefCell::default(),
            selected_entities_cache: RefCell::default(),
            facet_cache: RefCell::default(),
            summary_cache_bytes: std::cell::Cell::new(0),
            selection_cache_bytes: std::cell::Cell::new(0),
            summary_builds: std::cell::Cell::new(0),
            statistics_builds: std::cell::Cell::new(0),
            column_cache: RefCell::default(),
            _lease: std::sync::Arc::new(lease),
            _directory: std::sync::Arc::new(WorkingDirectory {
                directory: Some(dir),
                retain: std::sync::atomic::AtomicBool::new(false),
            }),
        })
    }
    fn harden(c: &Connection) -> Result<(), String> {
        c.set_limit(
            rusqlite::limits::Limit::SQLITE_LIMIT_LENGTH,
            80 * 1024 * 1024,
        )
        .map_err(err)?;
        c.set_limit(
            rusqlite::limits::Limit::SQLITE_LIMIT_SQL_LENGTH,
            1024 * 1024,
        )
        .map_err(err)?;
        Ok(())
    }
    fn register_functions(c: &Connection) -> Result<(), String> {
        Self::harden(c)?;
        display::register(c)?;
        c.create_scalar_function(
            "geometry_intersects",
            5,
            rusqlite::functions::FunctionFlags::SQLITE_DETERMINISTIC,
            |ctx| {
                Ok(crate::geometry::intersects(
                    &ctx.get::<String>(0)?,
                    ctx.get(1)?,
                    ctx.get(2)?,
                    ctx.get(3)?,
                    ctx.get(4)?,
                ))
            },
        )
        .map_err(err)?;
        c.create_scalar_function(
            "unicode_trim",
            1,
            rusqlite::functions::FunctionFlags::SQLITE_DETERMINISTIC,
            |ctx| Ok(ctx.get::<String>(0)?.trim().to_owned()),
        )
        .map_err(err)?;
        c.create_scalar_function(
            "rust_number",
            1,
            rusqlite::functions::FunctionFlags::SQLITE_DETERMINISTIC,
            |ctx| Ok(ctx.get::<Option<f64>>(0)?.map(|v| v.to_string())),
        )
        .map_err(err)?;
        // SQLite REAL storage normalizes -0. Preserve the existing domain's
        // lexical formatting from authoritative payloads only when zero needs
        // disambiguation; numeric comparisons still use the indexed REAL.
        c.create_scalar_function(
            "canonical_number",
            3,
            rusqlite::functions::FunctionFlags::SQLITE_DETERMINISTIC,
            |ctx| {
                let value = ctx.get::<Option<f64>>(0)?;
                if value == Some(0.) {
                    let payload = ctx.get::<String>(1)?;
                    let key = ctx.get::<String>(2)?;
                    let canonical: Value = serde_json::from_str(&payload)
                        .map_err(|e| rusqlite::Error::UserFunctionError(Box::new(e)))?;
                    return Ok(canonical
                        .get(&key)
                        .and_then(Value::as_f64)
                        .map(|v| v.to_string()));
                }
                Ok(value.map(|v| v.to_string()))
            },
        )
        .map_err(err)?;
        c.progress_handler(10000, Some(crate::operation::cancelled));
        c.create_scalar_function(
            "utc_time",
            1,
            rusqlite::functions::FunctionFlags::SQLITE_DETERMINISTIC,
            |ctx| Ok(crate::timestamps::utc_time(ctx.get::<f64>(0)?)),
        )
        .map_err(err)?;
        c.create_scalar_function(
            "utc_year",
            1,
            rusqlite::functions::FunctionFlags::SQLITE_DETERMINISTIC,
            |ctx| Ok(crate::timestamps::utc_year(ctx.get::<f64>(0)?)),
        )
        .map_err(err)?;
        c.create_scalar_function(
            "unicode_lower",
            1,
            rusqlite::functions::FunctionFlags::SQLITE_DETERMINISTIC,
            |ctx| Ok(ctx.get::<String>(0)?.to_lowercase()),
        )
        .map_err(err)?;
        c.create_scalar_function(
            "finite_number",
            1,
            rusqlite::functions::FunctionFlags::SQLITE_DETERMINISTIC,
            |ctx| {
                Ok(ctx
                    .get::<String>(0)?
                    .parse::<f64>()
                    .ok()
                    .filter(|v| v.is_finite()))
            },
        )
        .map_err(err)?;
        Ok(())
    }
    fn configure(c: &Connection) -> Result<(), String> {
        Self::register_functions(c)?;
        let page_size: u64 = c
            .pragma_query_value(None, "page_size", |r| r.get(0))
            .map_err(err)?;
        c.pragma_update(
            None,
            "max_page_count",
            32u64 * 1024 * 1024 * 1024 / page_size,
        )
        .map_err(err)?;
        c.execute_batch(
            "PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL; PRAGMA temp_store=FILE;
        PRAGMA cache_size=-32768; PRAGMA mmap_size=0; PRAGMA trusted_schema=OFF;
        PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;",
        )
        .map_err(err)
    }
    pub fn is_database(path: &Path) -> bool {
        use std::io::Read;
        let mut header = [0u8; 16];
        std::fs::File::open(path)
            .and_then(|mut f| f.read_exact(&mut header))
            .is_ok()
            && &header == b"SQLite format 3\0"
    }
    pub fn open_copy(path: &Path, data_dir: &Path) -> Result<(Self, Project), String> {
        Self::open_copy_kind(path, data_dir, false)
    }
    pub(crate) fn open_recovery(path: &Path, data_dir: &Path) -> Result<(Self, Project), String> {
        Self::open_copy_kind(path, data_dir, true)
    }
    fn open_copy_kind(
        path: &Path,
        data_dir: &Path,
        recovery: bool,
    ) -> Result<(Self, Project), String> {
        if std::fs::metadata(path).map_err(err)?.len() > 32 * 1024 * 1024 * 1024 {
            return Err("Database exceeds 32 GiB workspace budget".into());
        }
        let source = Connection::open_with_flags(path, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY)
            .map_err(err)?;
        Self::harden(&source)?;
        source.progress_handler(10000, Some(crate::operation::cancelled));
        source
            .pragma_update(None, "trusted_schema", false)
            .map_err(err)?;
        let app: i64 = source
            .pragma_query_value(None, "application_id", |r| r.get(0))
            .map_err(err)?;
        let version: i64 = source
            .pragma_query_value(None, "user_version", |r| r.get(0))
            .map_err(err)?;
        if app != APPLICATION_ID || !matches!(version, 1..=3) {
            return Err("Unsupported Chronoscope database format".into());
        }
        let triggers: i64 = source
            .query_row(
                "SELECT count(*) FROM sqlite_master WHERE type IN ('trigger','view')",
                [],
                |r| r.get(0),
            )
            .map_err(err)?;
        if triggers != 0 {
            return Err("Workspace databases cannot contain triggers or views".into());
        }
        let allowed = [
            "meta",
            "events",
            "attributes",
            "search",
            "search_data",
            "search_idx",
            "search_content",
            "search_config",
            "spatial",
            "spatial_node",
            "spatial_rowid",
            "spatial_parent",
            "resources",
            "history",
            "history_rows",
            "sqlite_stat1",
            "sqlite_stat4",
        ];
        {
            let mut statement = source
                .prepare("SELECT name FROM sqlite_master WHERE type='table'")
                .map_err(err)?;
            for name in statement
                .query_map([], |row| row.get::<_, String>(0))
                .map_err(err)?
            {
                if !allowed.contains(&name.map_err(err)?.as_str()) {
                    return Err("Unsupported table in Chronoscope workspace".into());
                }
            }
        }
        let check: String = source
            .query_row("PRAGMA quick_check", [], |r| r.get(0))
            .map_err(err)?;
        if check != "ok" {
            return Err("Workspace database integrity check failed".into());
        }
        let store = Self::new(data_dir)?;
        let expected_indexes = validation::index_definitions(&store.connection)?;
        // A fresh DELETE-journal destination avoids a full-sized WAL plus a second
        // full-sized checkpoint copy during open. Enable WAL only after backup.
        drop(store.connection);
        std::fs::remove_file(&store.path).map_err(err)?;
        source
            .backup(rusqlite::MAIN_DB, &store.path, None)
            .map_err(err)?;
        let connection = Connection::open(&store.path).map_err(err)?;
        if version == 1 {
            connection
                .execute_batch(
                    "ALTER TABLE events ADD COLUMN geometry_wkt TEXT; PRAGMA user_version=2",
                )
                .map_err(err)?;
        }
        connection
            .pragma_update(None, "user_version", 3)
            .map_err(err)?;
        let old_geometry_index: Option<String> = connection
            .query_row(
                "SELECT sql FROM sqlite_master WHERE type='index' AND name='events_geometry'",
                [],
                |r| r.get(0),
            )
            .optional()
            .map_err(err)?;
        if old_geometry_index.is_some_and(|sql| sql.to_ascii_lowercase().contains("lat is null")) {
            connection
                .execute_batch("DROP INDEX events_geometry")
                .map_err(err)?;
        }
        connection.execute_batch("CREATE INDEX IF NOT EXISTS events_geometry ON events(r) WHERE geometry_wkt IS NOT NULL").map_err(err)?;
        if validation::index_definitions(&connection)? != expected_indexes {
            return Err("Workspace index definitions do not match the supported schema".into());
        }
        Self::configure(&connection)?;
        connection
            .execute_batch("CREATE TEMP TABLE selection(id TEXT PRIMARY KEY)")
            .map_err(err)?;
        let store = Self {
            connection,
            ..store
        };
        store.verify_events()?;
        let metadata_key = if recovery {
            "recovery_project"
        } else {
            "project"
        };
        let metadata_bytes: u64 = store
            .connection
            .query_row(
                "SELECT length(cast(value AS BLOB)) FROM meta WHERE key=?",
                [metadata_key],
                |row| row.get(0),
            )
            .map_err(err)?;
        if metadata_bytes > 64 * 1024 * 1024 {
            return Err("Workspace metadata exceeds 64 MiB".into());
        }
        let text: String = store
            .connection
            .query_row("SELECT value FROM meta WHERE key=?", [metadata_key], |r| {
                r.get(0)
            })
            .map_err(err)?;
        if text.len() > 64 * 1024 * 1024 {
            return Err("Workspace metadata exceeds 64 MiB".into());
        }
        let mut project: Project = serde_json::from_str(&text).map_err(err)?;
        if !recovery {
            store.extract_resources(&mut project)?;
        } else {
            // Rows committed after the debounced context checkpoint may include
            // deletions. Recovery reconciles saved references with those rows;
            // portable files continue to reject inconsistent context.
            store.reconcile_recovery_context(&mut project)?;
        }
        store.validate_metadata(&project)?;
        {
            let mut q = store
                .connection
                .prepare(
                    "SELECT payload FROM events WHERE geometry_wkt IS NOT NULL AND lat IS NULL",
                )
                .map_err(err)?;
            let mut rows = q.query([]).map_err(err)?;
            let mut upgrades = Vec::new();
            let mut bytes = 0usize;
            while let Some(row) = rows.next().map_err(err)? {
                let text: String = row.get(0).map_err(err)?;
                let mut event = decode_event(&text)?;
                event.derive_polygon_centroid()?;
                if event.location_kind.is_some() {
                    bytes += text.len();
                    if bytes > 64 * 1024 * 1024 {
                        return Err("RESOURCE_LIMIT: geometry centroid migration exceeds 64 MiB; migrate in smaller workspaces".into());
                    }
                    upgrades.push(event);
                }
            }
            drop(rows);
            drop(q);
            if !upgrades.is_empty() {
                store
                    .connection
                    .execute_batch("SAVEPOINT centroid_upgrade")
                    .map_err(err)?;
                for event in upgrades {
                    store.insert(&event)?;
                }
                store
                    .connection
                    .execute_batch("RELEASE centroid_upgrade")
                    .map_err(err)?;
                project.version = 7;
            }
        }
        project.version = 7;
        project.time_resolution = "fractional_second".into();
        store.set_selection(&project.selected)?;
        Ok((store, project))
    }
    pub fn projected_page(
        &self,
        table: &str,
        offset: usize,
        limit: usize,
        fields: &[Value],
    ) -> Result<Vec<Value>, String> {
        let mut expressions = vec![];
        let mut parameters = vec![];
        let mut json_fields = vec![];
        for field in fields {
            let name = field.as_str().ok_or("Invalid projection field")?;
            let expression = if let Some(key) = name.strip_prefix("attribute:") {
                parameters.push(SqlValue::Text(key.into()));
                "(SELECT text FROM attributes WHERE r=e.r AND key=?)".into()
            } else {
                match name {
                    "altitude" => { json_fields.push(expressions.len()); "json_extract(e.payload,'$.altitude')".to_owned() },
                    "altitude_m" => "json_extract(e.payload,'$.altitude.meters')".to_owned(),
                    "altitude_reference" => "json_extract(e.payload,'$.altitude.reference')".to_owned(),
                    "time_utc" => "utc_time(e.time)".to_owned(),
                    "year_utc" => "utc_year(e.time)".to_owned(),
                    "location_kind" => "json_extract(e.payload,'$.location_kind')".to_owned(),
                    "attrs" | "tags" => {
                        json_fields.push(expressions.len());
                        format!("json_extract(e.payload,'$.{name}')")
                    }
                    "value"|"lat"|"lon" => format!("CASE WHEN e.{name}=0 THEN canonical_number(e.{name},e.payload,'{name}') ELSE e.{name} END"),
                    "id" | "entity" | "time" | "end" | "category" | "label"
                    | "related_to" | "note" | "source" | "source_row"
                    | "mgrs_precision" | "geometry_wkt" => format!("e.{name}"),
                    _ => return Err(format!("Unknown projection field: {name}")),
                }
            };
            expressions.push(expression)
        }
        if expressions.is_empty() {
            return Ok(
                (0..self.table_count(table)?.saturating_sub(offset).min(limit))
                    .map(|_| json!({}))
                    .collect(),
            );
        }
        parameters.extend([
            SqlValue::Integer(offset as i64),
            SqlValue::Integer(offset.saturating_add(limit) as i64),
        ]);
        let mut q=self.connection.prepare(&format!("SELECT {} FROM {table} o JOIN events e ON e.r=o.r WHERE o.pos>? AND o.pos<=? ORDER BY o.pos",expressions.join(","))).map_err(err)?;
        let mut rows = q
            .query(rusqlite::params_from_iter(parameters))
            .map_err(err)?;
        let mut result = vec![];
        let mut bytes = 0usize;
        while let Some(row) = rows.next().map_err(err)? {
            let mut value = serde_json::Map::new();
            for (index, field) in fields.iter().enumerate() {
                let raw: SqlValue = row.get(index).map_err(err)?;
                let v = match raw {
                    SqlValue::Null => Value::Null,
                    SqlValue::Integer(v) => json!(v),
                    SqlValue::Real(v) => json!(v),
                    SqlValue::Text(v) => {
                        if matches!(field.as_str(), Some("lat" | "lon" | "value")) {
                            json!(v.parse::<f64>().map_err(err)?)
                        } else if json_fields.contains(&index) {
                            serde_json::from_str(&v).map_err(err)?
                        } else {
                            json!(v)
                        }
                    }
                    SqlValue::Blob(_) => return Err("Invalid canonical field encoding".into()),
                };
                bytes = bytes.saturating_add(v.to_string().len());
                if bytes > 4 * 1024 * 1024 {
                    return Err("RESOURCE_LIMIT: projected page exceeds 4 MiB; reduce limit or requested fields".into());
                }
                value.insert(field.as_str().unwrap().into(), v);
            }
            result.push(Value::Object(value))
        }
        Ok(result)
    }
    pub(crate) fn retain_recovery(&self, retain: bool) {
        self._directory
            .retain
            .store(retain, std::sync::atomic::Ordering::Relaxed);
    }
    pub(crate) fn write_recovery_metadata(&self, metadata: &Project) -> Result<PathBuf, String> {
        let text = serde_json::to_string(metadata).map_err(err)?;
        if text.len() > 64 * 1024 * 1024 {
            return Err("Recovery metadata exceeds 64 MiB".into());
        }
        self.connection
            .pragma_update(None, "synchronous", "FULL")
            .map_err(err)?;
        let result=self.connection.execute("INSERT INTO meta(key,value) VALUES('recovery_project',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",[text]).map_err(err);
        let reset = self
            .connection
            .pragma_update(None, "synchronous", "NORMAL")
            .map_err(err);
        result?;
        reset?;
        Ok(self.path.clone())
    }
    pub fn directory(&self) -> &Path {
        self.path.parent().expect("workspace directory")
    }
    pub fn compact_page(
        &self,
        table: &str,
        offset: usize,
        limit: usize,
    ) -> Result<Vec<Event>, String> {
        let mut q=self.connection.prepare(&format!("SELECT e.id,e.entity,e.time,e.end,e.lat,e.lon,e.value,json_extract(e.payload,'$.location_kind'),json_extract(e.payload,'$.altitude') FROM {table} o JOIN events e ON e.r=o.r WHERE o.pos>? AND o.pos<=? ORDER BY o.pos")).map_err(err)?;
        let rows = q
            .query_map(
                params![offset as i64, offset.saturating_add(limit) as i64],
                compact_row,
            )
            .map_err(err)?;
        rows.map(|r| r.map_err(err)).collect()
    }
    pub fn page_bounded(
        &self,
        table: &str,
        offset: usize,
        limit: usize,
    ) -> Result<Vec<Event>, String> {
        let mut q=self.connection.prepare(&format!("SELECT e.payload FROM {table} o JOIN events e ON e.r=o.r WHERE o.pos>? AND o.pos<=? ORDER BY o.pos")).map_err(err)?;
        let mut rows = q
            .query(params![offset as i64, offset.saturating_add(limit) as i64])
            .map_err(err)?;
        let mut total = 0usize;
        let mut events = vec![];
        while let Some(row) = rows.next().map_err(err)? {
            let text: String = row.get(0).map_err(err)?;
            total = total.saturating_add(text.len());
            if total > 4 * 1024 * 1024 {
                return Err("RESOURCE_LIMIT: page payload exceeds 4 MiB; reduce limit or request field projections".into());
            }
            events.push(decode_event(&text)?)
        }
        Ok(events)
    }
    fn extract_resources(&self, project: &mut Project) -> Result<(), String> {
        let count: usize = self
            .connection
            .query_row("SELECT count(*) FROM resources", [], |r| r.get(0))
            .map_err(err)?;
        if project.resources_external {
            if count != 0 {
                return Err("External-resource autosave has unexpected embedded assets".into());
            }
            for layer in &project.gis_layers {
                crate::gis::validate_scoped_package(
                    layer,
                    self._directory
                        .path()
                        .parent()
                        .ok_or("Invalid workspace cache directory")?,
                    crate::operation::scope().as_deref(),
                    None,
                )?;
            }
            return Ok(());
        }
        let mut refs: Vec<(String, u64)> = Vec::new();
        if let Some(workspace) = &project.workspace {
            for (index, file) in workspace.terrain_files.iter().enumerate() {
                let ext = file.extension().and_then(|e| e.to_str()).unwrap_or("");
                let name = format!("terrain/{index:04}.{ext}");
                if !["dt0", "dt1", "dt2"].contains(&ext) || file.to_str() != Some(&name) {
                    return Err("Invalid terrain resource path".into());
                }
                refs.push((name, 32 * 1024 * 1024));
            }
        }
        for (index, layer) in project.gis_layers.iter().enumerate() {
            let name = format!("gis/{index:04}.cga");
            if layer.asset.to_str() != Some(&name) {
                return Err("Invalid GIS resource path".into());
            }
            refs.push((name, crate::gis::MAX_PACKAGE));
        }
        if count != refs.len() || count > 2048 + crate::gis::MAX_LAYERS {
            return Err("Workspace resources do not match metadata".into());
        }
        if count == 0 {
            return Ok(());
        }
        use sha2::{Digest, Sha256};
        let mut key = Sha256::new();
        for (name, _) in &refs {
            key.update(name.as_bytes());
        }
        let hashes: String = self
            .connection
            .query_row(
                "SELECT group_concat(sha,'') FROM (SELECT sha FROM resources ORDER BY name)",
                [],
                |r| r.get(0),
            )
            .map_err(err)?;
        key.update(hashes.as_bytes());
        let root = self
            ._directory
            .path()
            .parent()
            .unwrap()
            .join("project-assets")
            .join(format!("sqlite-{:x}", key.finalize()));
        if root.exists()
            && std::fs::symlink_metadata(&root)
                .map_err(err)?
                .file_type()
                .is_symlink()
        {
            return Err("Invalid workspace resource cache".into());
        }
        std::fs::create_dir_all(&root).map_err(err)?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&root, std::fs::Permissions::from_mode(0o700)).map_err(err)?;
        }
        let mut terrain_total = 0u64;
        let mut gis_total = 0u64;
        for (name, limit) in refs {
            crate::operation::check()?;
            let (size, sha): (u64, String) = self
                .connection
                .query_row(
                    "SELECT length(bytes),sha FROM resources WHERE name=?",
                    [&name],
                    |r| Ok((r.get(0)?, r.get(1)?)),
                )
                .map_err(err)?;
            if name.starts_with("terrain/") {
                terrain_total = terrain_total
                    .checked_add(size)
                    .ok_or("Resource size overflow")?;
            } else {
                gis_total = gis_total
                    .checked_add(size)
                    .ok_or("Resource size overflow")?;
            }
            if size > limit
                || terrain_total > 512 * 1024 * 1024
                || gis_total > crate::gis::MAX_TOTAL
            {
                return Err("Workspace resource budget exceeded".into());
            }
            let bytes: Vec<u8> = self
                .connection
                .query_row("SELECT bytes FROM resources WHERE name=?", [&name], |r| {
                    r.get(0)
                })
                .map_err(err)?;
            if format!("{:x}", Sha256::digest(&bytes)) != sha {
                return Err("Workspace resource checksum mismatch".into());
            }
            let output = root.join(&name);
            let parent = output.parent().unwrap();
            if parent.exists()
                && std::fs::symlink_metadata(parent)
                    .map_err(err)?
                    .file_type()
                    .is_symlink()
            {
                return Err("Invalid workspace resource cache".into());
            }
            std::fs::create_dir_all(parent).map_err(err)?;
            // Atomic replacement also avoids following a pre-existing leaf symlink.
            let mut temp = tempfile::NamedTempFile::new_in(parent).map_err(err)?;
            std::io::Write::write_all(&mut temp, &bytes).map_err(err)?;
            crate::persistence::persist(temp, &output)?;
        }
        if let Some(workspace) = &mut project.workspace {
            for file in &mut workspace.terrain_files {
                *file = root.join(&*file);
            }
            if !workspace.terrain_files.is_empty() {
                workspace.preferences.terrain_builtin = false;
                workspace.preferences.terrain_path = Some(root.join("terrain"));
            } else {
                workspace.preferences.terrain_path = None;
            }
        }
        for layer in &mut project.gis_layers {
            layer.asset = root.join(&layer.asset);
            crate::gis::validate_package(layer)?;
        }
        project.resource_dir = Some(root);
        Ok(())
    }
    fn reconcile_recovery_context(&self, project: &mut Project) -> Result<(), String> {
        let mut query = self
            .connection
            .prepare_cached("SELECT 1 FROM events WHERE id=?")
            .map_err(err)?;
        for ids in std::iter::once(&mut project.selected)
            .chain(project.views.iter_mut().map(|v| &mut v.selected))
            .chain(project.groups.iter_mut().map(|g| &mut g.ids))
        {
            let mut failure = None;
            ids.retain(|id| match query.exists([id.to_string()]) {
                Ok(exists) => exists,
                Err(error) => {
                    failure = Some(err(error));
                    false
                }
            });
            if let Some(error) = failure {
                return Err(error);
            }
            crate::operation::check()?;
        }
        Ok(())
    }
    pub fn validate_metadata(&self, p: &Project) -> Result<(), String> {
        let mut structural = p.clone();
        structural.dataset.events.clear();
        structural.selected.clear();
        for v in &mut structural.views {
            v.selected.clear()
        }
        for g in &mut structural.groups {
            g.ids.clear()
        }
        structural.validate()?;
        for id in p
            .selected
            .iter()
            .chain(p.views.iter().flat_map(|v| &v.selected))
            .chain(p.groups.iter().flat_map(|g| &g.ids))
        {
            if self.get(*id)?.is_none() {
                return Err("Workspace context refers to a missing event".into());
            }
        }
        Ok(())
    }
    pub fn insert(&self, e: &Event) -> Result<(), String> {
        let normalized;
        let e = if e.geometry_wkt.is_some() && e.location().is_none() {
            normalized = {
                let mut event = e.clone();
                event.derive_polygon_centroid()?;
                event
            };
            &normalized
        } else {
            e
        };
        e.validate()?;
        let payload = serde_json::to_string(e).map_err(err)?;
        let existing = self
            .connection
            .prepare_cached("SELECT r FROM events WHERE id=?")
            .map_err(err)?
            .query_row([e.id.to_string()], |r| r.get::<_, i64>(0))
            .optional()
            .map_err(err)?;
        if let Some(r) = existing {
            self.remove_row(r)?
        }
        self.connection.prepare_cached("INSERT INTO events(id,id_key,entity,time,t_end,lat,lon,category,label,value,related_to,source,source_row,end,tags,note,mgrs_precision,geometry_wkt,payload) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)").map_err(err)?.execute(
        params![e.id.to_string(),format!("{:020}",e.id),e.entity,e.time,e.end.unwrap_or(e.time),e.lat,e.lon,e.category,e.label,e.value,e.related_to,e.source,e.source_row as i64,e.end,e.tags.iter().cloned().collect::<Vec<_>>().join(","),e.note,e.mgrs_precision,e.geometry_wkt,payload]).map_err(err)?;
        let r = self.connection.last_insert_rowid();
        let mut insert = self
            .connection
            .prepare_cached("INSERT INTO attributes(r,key,text,num) VALUES(?,?,?,?)")
            .map_err(err)?;
        for (key, value) in &e.attrs {
            let numeric = value.trim().parse::<f64>().ok().filter(|v| v.is_finite());
            insert
                .execute(params![r, key, value, numeric])
                .map_err(err)?;
        }
        let search = search_text(e);
        self.connection
            .prepare_cached("INSERT INTO search(rowid,text) VALUES(?,?)")
            .map_err(err)?
            .execute(params![r, search])
            .map_err(err)?;
        let footprint = if let Some(text) = e.geometry_wkt.as_ref() {
            crate::geometry::parse(text)?.bounds
        } else {
            e.location().map(|(lat, lon)| [lon, lat, lon, lat])
        };
        if let Some([west, south, east, north]) = footprint {
            self.connection
                .prepare_cached("INSERT INTO spatial VALUES(?,?,?,?,?)")
                .map_err(err)?
                .execute(params![r, south, north, west, east])
                .map_err(err)?;
        }
        Ok(())
    }
    fn remove_row(&self, r: i64) -> Result<(), String> {
        for sql in [
            "DELETE FROM attributes WHERE r=?",
            "DELETE FROM spatial WHERE r=?",
            "DELETE FROM search WHERE rowid=?",
            "DELETE FROM events WHERE r=?",
        ] {
            self.connection
                .prepare_cached(sql)
                .map_err(err)?
                .execute([r])
                .map_err(err)?;
        }
        Ok(())
    }
    pub fn delete(&self, id: u64) -> Result<(), String> {
        let r: i64 = self
            .connection
            .query_row("SELECT r FROM events WHERE id=?", [id.to_string()], |r| {
                r.get(0)
            })
            .map_err(err)?;
        self.remove_row(r)
    }
    pub fn get(&self, id: u64) -> Result<Option<Event>, String> {
        use rusqlite::OptionalExtension;
        let raw: Option<String> = self
            .connection
            .query_row(
                "SELECT payload FROM events WHERE id=?",
                [id.to_string()],
                |r| r.get(0),
            )
            .optional()
            .map_err(err)?;
        raw.map(|s| decode_event(&s)).transpose()
    }
    pub fn opaque_identity(&self) -> String {
        use sha2::{Digest, Sha256};
        format!(
            "{:x}",
            Sha256::digest(self.path.to_string_lossy().as_bytes())
        )
    }
    pub(crate) fn selection_version(&self) -> u64 {
        self.selection_revision
    }
    pub fn identity(&self) -> String {
        self.path.to_string_lossy().into()
    }
    pub fn history_bytes(&self) -> Result<usize, String> {
        self.connection.query_row("SELECT coalesce(sum(length(before)+coalesce(length(after),0)),0) FROM history_rows",[],|r|r.get::<_,i64>(0)).map(|v|v as usize).map_err(err)
    }
    pub fn payload_bytes(&self) -> Result<u64, String> {
        self.connection
            .query_row(
                "SELECT coalesce(sum(length(cast(payload AS BLOB))),0) FROM events",
                [],
                |r| r.get(0),
            )
            .map_err(err)
    }
    pub fn count(&self) -> Result<usize, String> {
        self.connection
            .query_row("SELECT count(*) FROM events", [], |r| r.get::<_, i64>(0))
            .map(|v| v as usize)
            .map_err(err)
    }
    pub fn has_centroids(&self) -> Result<bool, String> {
        self.connection.query_row("SELECT EXISTS(SELECT 1 FROM events INDEXED BY events_geometry WHERE geometry_wkt IS NOT NULL AND json_extract(payload,'$.location_kind')='polygon-centroid')",[],|r|r.get(0)).map_err(err)
    }
    pub fn time_bounds(&self) -> Result<(f64, f64), String> {
        self.connection
            .query_row(
                "SELECT coalesce((SELECT min(time) FROM events),0),coalesce((SELECT max(t_end) FROM events),0)",
                [],
                |r| {
                    let lo = r.get::<_, f64>(0)?;
                    let hi = r.get::<_, f64>(1)?;
                    Ok((lo, if hi > lo { hi } else { lo + 1. }))
                },
            )
            .map_err(err)
    }
    pub fn max_id(&self) -> Result<u64, String> {
        let s: Option<String> = self
            .connection
            .query_row(
                "SELECT id FROM events ORDER BY id_key DESC LIMIT 1",
                [],
                |r| r.get(0),
            )
            .optional()
            .map_err(err)?;
        s.map_or(Ok(0), |s| s.parse().map_err(err))
    }
    pub fn set_selection(&self, ids: &std::collections::BTreeSet<u64>) -> Result<(), String> {
        self.connection
            .execute_batch("SAVEPOINT selection_update; DELETE FROM selection")
            .map_err(err)?;
        let result = (|| {
            let mut q = self
                .connection
                .prepare_cached("INSERT INTO selection VALUES(?)")
                .map_err(err)?;
            for id in ids {
                q.execute([id.to_string()]).map_err(err)?;
            }
            Ok(())
        })();
        match result {
            Ok(()) => {
                self.connection
                    .execute_batch("RELEASE selection_update")
                    .map_err(err)?;
                *self.previous_selection.borrow_mut() = ids.clone();
                Ok(())
            }
            Err(e) => {
                let _ = self
                    .connection
                    .execute_batch("ROLLBACK TO selection_update; RELEASE selection_update");
                Err(e)
            }
        }
    }
    pub fn changed(&mut self) -> Result<(), String> {
        self.data_revision += 1;
        self.connection.execute("INSERT OR REPLACE INTO meta VALUES('analytics_generation',lower(hex(randomblob(16))))",[]).map_err(err)?;
        self.clear_cache()
    }
    pub fn selection_changed(
        &mut self,
        ids: &std::collections::BTreeSet<u64>,
    ) -> Result<(), String> {
        if *self.previous_selection.borrow() != *ids {
            self.set_selection(ids)?;
            self.selection_revision += 1;
        }
        Ok(())
    }
    fn clear_cache(&self) -> Result<(), String> {
        self.summary_cache.borrow_mut().clear();
        self.selection_summary_cache.borrow_mut().clear();
        self.summary_cache_bytes.set(0);
        self.selection_cache_bytes.set(0);
        self.column_cache.borrow_mut().clear();
        for c in self.cache.borrow().values() {
            self.connection
                .execute_batch(&format!("DROP TABLE IF EXISTS {}", c.table))
                .map_err(err)?;
        }
        self.cache.borrow_mut().clear();
        Ok(())
    }
    fn facet_expression(field: &str, args: &mut Vec<SqlValue>) -> String {
        match field {
            "lat" | "lon" | "value" => {
                format!("coalesce(canonical_number(e.{field},e.payload,'{field}'),'')")
            }
            "id" | "entity" | "category" | "source" | "label" | "related_to" | "note" | "time"
            | "end" | "source_row" | "mgrs_precision" | "geometry_wkt" | "tags" => {
                format!("coalesce(cast(e.{field} AS TEXT),'')")
            }
            "altitude_m" => {
                "coalesce(cast(json_extract(e.payload,'$.altitude.meters') AS TEXT),'')".into()
            }
            "altitude_reference" => {
                "coalesce(json_extract(e.payload,'$.altitude.reference'),'')".into()
            }
            "location_kind" => "coalesce(json_extract(e.payload,'$.location_kind'),'')".into(),
            _ => {
                args.push(SqlValue::Text(
                    field.strip_prefix("attribute:").unwrap_or(field).into(),
                ));
                "coalesce((SELECT text FROM attributes WHERE r=e.r AND key=?),'')".into()
            }
        }
    }
    pub fn where_sql(filter: &Filter, source: Option<&str>) -> (String, Vec<SqlValue>) {
        let mut parts = vec!["1=1".to_string()];
        let mut args = vec![];
        let mut condition = |sql: &str, v: SqlValue| {
            parts.push(sql.into());
            args.push(v);
        };
        if let Some(s) = source {
            condition("e.source=?", SqlValue::Text(s.into()));
        }
        if let Some(t) = filter.start {
            condition("e.t_end>=?", SqlValue::Real(t));
        }
        if let Some(t) = filter.end {
            condition("e.time<=?", SqlValue::Real(t));
        }
        for (column, hidden) in [
            ("entity", &filter.hidden_entities),
            ("category", &filter.hidden_categories),
            ("source", &filter.hidden_sources),
        ] {
            if !hidden.is_empty() {
                parts.push(format!(
                    "e.{column} NOT IN ({})",
                    vec!["?"; hidden.len()].join(",")
                ));
                args.extend(hidden.iter().cloned().map(SqlValue::Text));
            }
        }
        for (kind, hidden) in &filter.facet_hidden {
            if hidden.is_empty() {
                continue;
            }
            let field = filter
                .facet_fields
                .get(kind)
                .map(String::as_str)
                .unwrap_or(kind);
            let expr = Self::facet_expression(field, &mut args);
            parts.push(format!(
                "{expr} NOT IN ({})",
                vec!["?"; hidden.len()].join(",")
            ));
            args.extend(hidden.iter().map(|value| {
                let normalized = if matches!(field, "value" | "lat" | "lon") {
                    value
                        .parse::<f64>()
                        .ok()
                        .filter(|v| v.is_finite())
                        .map(|v| v.to_string())
                        .unwrap_or_else(|| value.clone())
                } else {
                    value.clone()
                };
                SqlValue::Text(normalized)
            }));
        }
        if filter.selected_only {
            parts.push(
                if filter.bounds.is_some() {
                    "EXISTS(SELECT 1 FROM selection s WHERE s.id=e.id)"
                } else {
                    "e.id IN (SELECT id FROM selection)"
                }
                .into(),
            );
        }
        if filter.located_only {
            parts.push("(e.lat IS NOT NULL OR (e.geometry_wkt IS NOT NULL AND EXISTS(SELECT 1 FROM spatial WHERE r=e.r)))".into());
        }
        if let Some(b) = &filter.bounds {
            let spatial_lon = if b.west <= b.east {
                "lon_max>=? AND lon_min<=?"
            } else {
                "(lon_max>=? OR lon_min<=?)"
            };
            parts.push(format!(
                "e.r IN (SELECT r FROM spatial WHERE lat_max>=? AND lat_min<=? AND {spatial_lon})"
            ));
            args.extend([b.south, b.north, b.west, b.east].map(SqlValue::Real));
            let point_lon = if b.west <= b.east {
                "e.lon>=? AND e.lon<=?"
            } else {
                "(e.lon>=? OR e.lon<=?)"
            };
            parts.push(format!("((e.geometry_wkt IS NULL AND e.lat>=? AND e.lat<=? AND {point_lon}) OR (e.geometry_wkt IS NOT NULL AND geometry_intersects(e.geometry_wkt,?,?,?,?)))"));
            args.extend(
                [
                    b.south, b.north, b.west, b.east, b.south, b.north, b.west, b.east,
                ]
                .map(SqlValue::Real),
            );
        }
        if !filter.search.is_empty() {
            let query = filter.search.to_lowercase();
            let special = query.contains(['%', '_', '\\']);
            parts.push(
                if special {
                    "e.r IN (SELECT rowid FROM search WHERE text LIKE ? ESCAPE '\\')"
                } else {
                    "e.r IN (SELECT rowid FROM search WHERE text LIKE ?)"
                }
                .into(),
            );
            let q = query
                .replace('\\', "\\\\")
                .replace('%', "\\%")
                .replace('_', "\\_");
            args.push(SqlValue::Text(format!("%{q}%")));
        }
        for p in &filter.predicates {
            // A constant-false numeric predicate has no expression/key binds.
            // Decide it before constructing an attribute subquery.
            if matches!(p.op, Operator::Greater | Operator::Less)
                && p.field != "id"
                && p.value.parse::<f64>().ok().is_none_or(|v| !v.is_finite())
            {
                parts.push("0=1".into());
                continue;
            }
            if p.field == "id" && matches!(p.op, Operator::Greater | Operator::Less) {
                if let Ok(id) = p.value.parse::<u64>() {
                    parts.push(format!(
                        "e.id_key{}?",
                        if p.op == Operator::Greater { ">" } else { "<" }
                    ));
                    args.push(SqlValue::Text(format!("{id:020}")));
                } else {
                    parts.push("0=1".into());
                }
                continue;
            }
            // Whitelisted canonical columns use exact indexed predicates.
            // Original attribute strings retain untrimmed domain semantics.
            if matches!(p.field.as_str(), "entity" | "category" | "source" | "id")
                && matches!(p.op, Operator::Equals | Operator::NotEquals)
            {
                parts.push(format!(
                    "e.{}{}?",
                    p.field,
                    if p.op == Operator::Equals { "=" } else { "<>" }
                ));
                args.push(SqlValue::Text(p.value.clone()));
                continue;
            }
            if p.field == "altitude_m" {
                if let Some(value) = p.value.parse::<f64>().ok().filter(|v| v.is_finite()) {
                    let op = match p.op {
                        Operator::Equals => Some("="),
                        Operator::NotEquals => Some("<>"),
                        Operator::Greater => Some(">"),
                        Operator::Less => Some("<"),
                        _ => None,
                    };
                    if let Some(op) = op {
                        let expression = "json_extract(e.payload,'$.altitude.meters')";
                        parts.push(if p.op == Operator::NotEquals {
                            format!("({expression} IS NULL OR {expression}{op}?)")
                        } else {
                            format!("{expression}{op}?")
                        });
                        args.push(SqlValue::Real(value));
                        continue;
                    }
                }
            }
            if matches!(p.field.as_str(), "value" | "lat" | "lon") {
                if let Some(value) = p.value.parse::<f64>().ok().filter(|v| v.is_finite()) {
                    let op = match p.op {
                        Operator::Equals => Some("="),
                        Operator::NotEquals => Some("<>"),
                        Operator::Greater => Some(">"),
                        Operator::Less => Some("<"),
                        _ => None,
                    };
                    if let Some(op) = op {
                        let comparison = format!("e.{}{op}?", p.field);
                        parts.push(if p.op == Operator::NotEquals {
                            format!("(e.{} IS NULL OR {comparison})", p.field)
                        } else {
                            comparison
                        });
                        args.push(SqlValue::Real(value));
                        continue;
                    }
                }
            }
            let column = match p.field.as_str() {
                "geometry_wkt" => Some("geometry_wkt"),
                "entity" => Some("entity"),
                "category" => Some("category"),
                "label" => Some("label"),
                "related_to" => Some("related_to"),
                "value" => Some("value"),
                "tags" => Some("tags"),
                "id" => Some("id"),
                "time" => Some("time"),
                "end" => Some("end"),
                "lat" => Some("lat"),
                "lon" => Some("lon"),
                "source" => Some("source"),
                "source_row" => Some("source_row"),
                "note" => Some("note"),
                "mgrs_precision" => Some("mgrs_precision"),
                _ => None,
            };
            let expr = if matches!(p.field.as_str(), "lat" | "lon" | "value") {
                format!(
                    "coalesce(canonical_number(e.{0},e.payload,'{0}'),'')",
                    p.field
                )
            } else if matches!(p.field.as_str(), "altitude_m" | "altitude_reference") {
                Self::facet_expression(&p.field, &mut args)
            } else if let Some(col) = column {
                format!("coalesce(cast(e.{col} AS TEXT),'')")
            } else {
                args.push(SqlValue::Text(
                    p.field
                        .strip_prefix("attribute:")
                        .unwrap_or(&p.field)
                        .into(),
                ));
                "coalesce((SELECT text FROM attributes WHERE r=e.r AND key=?),'')".into()
            };
            let predicate = match p.op {
                Operator::Contains => {
                    args.push(SqlValue::Text(p.value.to_lowercase()));
                    format!("instr(unicode_lower({expr}),?)>0")
                }
                Operator::Equals | Operator::NotEquals => {
                    let numeric =
                        if matches!(p.field.as_str(), "value" | "lat" | "lon" | "altitude_m") {
                            p.value.parse::<f64>().ok().filter(|v| v.is_finite())
                        } else {
                            None
                        };
                    if let Some(value) = numeric {
                        args.push(SqlValue::Real(value));
                        format!(
                            "coalesce(finite_number({expr}){}?,{})",
                            if p.op == Operator::Equals { "=" } else { "<>" },
                            if p.op == Operator::Equals { 0 } else { 1 }
                        )
                    } else {
                        args.push(SqlValue::Text(p.value.clone()));
                        format!(
                            "{expr}{}?",
                            if p.op == Operator::Equals { "=" } else { "<>" }
                        )
                    }
                }
                Operator::IsEmpty => format!("unicode_trim({expr})=''"),
                Operator::Greater | Operator::Less => {
                    let value = p.value.parse::<f64>().ok().filter(|v| v.is_finite());
                    if let Some(v) = value {
                        args.push(SqlValue::Real(v));
                        format!(
                            "finite_number({expr}){}?",
                            if p.op == Operator::Greater { ">" } else { "<" }
                        )
                    } else {
                        "0=1".into()
                    }
                }
            };
            parts.push(predicate);
        }
        (parts.join(" AND "), args)
    }
    pub fn ordered(
        &self,
        filter: &Filter,
        source: Option<&str>,
        sort: &str,
        desc: bool,
    ) -> Result<String, String> {
        self.ordered_with_bounds(filter, source, sort, desc, None)
    }
    pub fn ordered_with_bounds(
        &self,
        filter: &Filter,
        source: Option<&str>,
        sort: &str,
        desc: bool,
        viewport: Option<&GeoBounds>,
    ) -> Result<String, String> {
        self.ordered_with_cell(filter, source, sort, desc, viewport, None)
    }
    pub fn ordered_with_cell(
        &self,
        filter: &Filter,
        source: Option<&str>,
        sort: &str,
        desc: bool,
        viewport: Option<&GeoBounds>,
        cell: Option<&crate::display::Cell>,
    ) -> Result<String, String> {
        self.ordered_scoped(
            filter,
            source,
            sort,
            desc,
            TableScope {
                viewport,
                cell,
                search: "",
            },
        )
    }
    /// Intersect a table-local search with the workspace filter without changing it.
    pub fn ordered_table(
        &self,
        filter: &Filter,
        source: Option<&str>,
        sort: &str,
        desc: bool,
        cell: Option<&crate::display::Cell>,
        search: &str,
    ) -> Result<String, String> {
        self.ordered_scoped(
            filter,
            source,
            sort,
            desc,
            TableScope {
                viewport: None,
                cell,
                search,
            },
        )
    }
    fn ordered_scoped(
        &self,
        filter: &Filter,
        source: Option<&str>,
        sort: &str,
        desc: bool,
        scope: TableScope<'_>,
    ) -> Result<String, String> {
        let TableScope {
            viewport,
            cell,
            search,
        } = scope;
        let key = serde_json::to_string(&(
            self.data_revision,
            if filter.selected_only {
                self.selection_revision
            } else {
                0
            },
            filter,
            source,
            sort,
            desc,
            viewport,
            cell,
            search,
        ))
        .map_err(err)?;
        *self.clock.borrow_mut() += 1;
        let clock = *self.clock.borrow();
        if let Some(c) = self.cache.borrow_mut().get_mut(&key) {
            c.used = clock;
            return Ok(c.table.clone());
        }
        if self.cache.borrow().len() >= 4 {
            let oldest = self
                .cache
                .borrow()
                .iter()
                .min_by_key(|(_, v)| v.used)
                .map(|(k, v)| (k.clone(), v.table.clone()))
                .unwrap();
            self.connection
                .execute_batch(&format!("DROP TABLE {}", oldest.1))
                .map_err(err)?;
            self.cache.borrow_mut().remove(&oldest.0);
        }
        let table = format!("ordered_{clock}");
        let mut scoped = filter.clone();
        let spatial = viewport.is_some() || cell.is_some_and(|c| c.viewport.is_some());
        if spatial {
            scoped.selected_only = false;
        }
        let (mut where_clause, mut values) = Self::where_sql(&scoped, source);
        if !search.is_empty() {
            let extra = Filter {
                search: search.into(),
                ..Filter::default()
            };
            let (clause, parameters) = Self::where_sql(&extra, None);
            where_clause = format!("({where_clause}) AND ({clause})");
            values.extend(parameters);
        }
        if spatial && filter.selected_only {
            where_clause.push_str(" AND EXISTS(SELECT 1 FROM selection s WHERE s.id=e.id)");
        }
        if let Some(bounds) = viewport {
            let extra = Filter {
                bounds: Some(bounds.clone()),
                ..Filter::default()
            };
            let (clause, parameters) = Self::where_sql(&extra, None);
            where_clause = format!("({where_clause}) AND ({clause})");
            values.extend(parameters);
        }
        if let Some(cell) = cell {
            let (sql, args) = Self::display_cell_sql(cell)?;
            where_clause.push_str(&format!(" AND ({sql})"));
            values.extend(args);
        }
        let direction = if desc { "DESC" } else { "ASC" };
        let (join, order) = if let Some(attr) = sort.strip_prefix("attribute:") {
            values.insert(0, SqlValue::Text(attr.into()));
            ("LEFT JOIN attributes a ON a.r=e.r AND a.key=?".to_string(),format!("(a.num IS NULL) {direction}, a.num {direction},coalesce(a.text,'') {direction},e.id_key {direction}"))
        } else if matches!(sort, "altitude_m" | "altitude_reference") {
            let expr = if sort == "altitude_m" {
                "json_extract(e.payload,'$.altitude.meters')"
            } else {
                "json_extract(e.payload,'$.altitude.reference')"
            };
            (
                String::new(),
                format!("{expr} {direction},e.id_key {direction}"),
            )
        } else {
            let col = match sort {
                "id" => "id_key",
                "entity" => "entity",
                "time" => "time",
                "end" => "end",
                "lat" => "lat",
                "lon" => "lon",
                "category" => "category",
                "label" => "label",
                "value" => "value",
                "related_to" => "related_to",
                "source" => "source",
                "source_row" => "source_row",
                "tags" => "tags",
                "note" => "note",
                "mgrs_precision" => "mgrs_precision",
                _ => return Err("Unknown table sort field".into()),
            };
            (
                String::new(),
                format!("e.{col} {direction},e.id_key {direction}"),
            )
        };
        self.connection
            .execute_batch(&format!(
                "CREATE TEMP TABLE {table}(pos INTEGER PRIMARY KEY,r INTEGER NOT NULL)"
            ))
            .map_err(err)?;
        let result=self.connection.execute(&format!("INSERT INTO {table}(r) SELECT e.r FROM events e {join} WHERE {where_clause} ORDER BY {order}"),rusqlite::params_from_iter(values));
        if let Err(e) = result {
            let _ = self
                .connection
                .execute_batch(&format!("DROP TABLE {table}"));
            return Err(err(e));
        }
        self.cache.borrow_mut().insert(
            key,
            Cached {
                table: table.clone(),
                used: clock,
            },
        );
        Ok(table)
    }
    /// Locate one exact ID in the cached ordering without decoding or sending all rows.
    pub fn table_offset(&self, table: &str, id: u64) -> Result<Option<usize>, String> {
        self.connection
            .execute_batch(&format!(
                "CREATE INDEX IF NOT EXISTS {table}_row ON {table}(r)"
            ))
            .map_err(err)?;
        use rusqlite::OptionalExtension;
        self.connection
            .query_row(
                &format!("SELECT o.pos - 1 FROM {table} o JOIN events e ON e.r=o.r WHERE e.id=?"),
                [id.to_string()],
                |row| row.get(0),
            )
            .optional()
            .map_err(err)
    }
    pub fn table_count(&self, table: &str) -> Result<usize, String> {
        self.connection
            .query_row(&format!("SELECT count(*) FROM {table}"), [], |r| {
                r.get::<_, i64>(0)
            })
            .map(|v| v as usize)
            .map_err(err)
    }
    pub fn page(&self, table: &str, offset: usize, limit: usize) -> Result<Vec<Event>, String> {
        let mut q=self.connection.prepare(&format!("SELECT e.payload FROM {table} q JOIN events e ON e.r=q.r WHERE q.pos>? AND q.pos<=? ORDER BY q.pos")).map_err(err)?;
        let rows = q
            .query_map(
                params![offset as i64, offset.saturating_add(limit) as i64],
                |r| r.get::<_, String>(0),
            )
            .map_err(err)?;
        rows.map(|r| decode_event(&r.map_err(err)?)).collect()
    }
    /// Inclusive range in the same cached, stable ordering as the attribute table.
    /// Only IDs cross this boundary; row payloads are never decoded.
    pub fn table_range_ids(
        &self,
        table: &str,
        anchor: u64,
        target: u64,
    ) -> Result<Vec<u64>, String> {
        let a = self
            .table_offset(table, anchor)?
            .ok_or("CONFLICT: selection anchor is outside the table scope")?;
        let b = self
            .table_offset(table, target)?
            .ok_or("CONFLICT: selection target is outside the table scope")?;
        let mut query = self.connection.prepare(&format!("SELECT e.id FROM {table} q JOIN events e ON e.r=q.r WHERE q.pos BETWEEN ? AND ? ORDER BY q.pos")).map_err(err)?;
        let rows = query
            .query_map(params![(a.min(b) + 1) as i64, (a.max(b) + 1) as i64], |r| {
                r.get::<_, String>(0)
            })
            .map_err(err)?;
        rows.map(|v| v.map_err(err)?.parse().map_err(err)).collect()
    }
    pub fn ids(&self, table: &str) -> Result<Vec<u64>, String> {
        let mut q = self
            .connection
            .prepare(&format!(
                "SELECT e.id FROM {table} q JOIN events e ON e.r=q.r ORDER BY q.pos"
            ))
            .map_err(err)?;
        let result = q
            .query_map([], |r| r.get::<_, String>(0))
            .map_err(err)?
            .map(|v| v.map_err(err)?.parse().map_err(err))
            .collect();
        result
    }
    pub fn checkpoint(&self) -> Result<(), String> {
        self.connection
            .execute_batch("PRAGMA wal_checkpoint(TRUNCATE)")
            .map_err(err)
    }
    pub fn query_stamp(&self, selected_only: bool) -> (u64, u64) {
        (
            self.data_revision,
            if selected_only {
                self.selection_revision
            } else {
                0
            },
        )
    }
    pub fn cache_info(&self) -> Value {
        json!({"data_revision":self.data_revision,"cached_orders":self.cache.borrow().len(),"storage":"sqlite","page_lookup":"indexed_position","memory_cache_mib":32,"summary_builds":self.summary_builds.get(),"statistics_builds":self.statistics_builds.get(),"summary_cache_encoded_bytes":self.summary_cache_bytes.get()+self.selection_cache_bytes.get(),"summary_cache_encoded_limit_bytes":8388608})
    }
    pub fn materialize(&self, mut project: Project) -> Result<Project, String> {
        let t = self.ordered(&Filter::default(), None, "id", false)?;
        project.dataset.events = self.page(&t, 0, self.count()?)?;
        Ok(project)
    }
    /// Local automatic copies keep external resource references and avoid the
    /// compaction/materialization performed for a portable export.
    pub(crate) fn save_autosave(&self, path: &Path, metadata: &Project) -> Result<(), String> {
        let parent = path.parent().ok_or("Invalid autosave directory")?;
        std::fs::create_dir_all(parent).map_err(err)?;
        let tmp = tempfile::NamedTempFile::new_in(parent).map_err(err)?;
        let mut destination = Connection::open(tmp.path()).map_err(err)?;
        crate::persistence::backup(&self.connection, &mut destination)?;
        let mut external = metadata.clone();
        external.resources_external = true;
        destination
            .execute_batch("DELETE FROM resources")
            .map_err(err)?;
        destination.execute("INSERT INTO meta(key,value) VALUES('project',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",[serde_json::to_string(&external).map_err(err)?]).map_err(err)?;
        drop(destination);
        crate::persistence::persist(tmp, path)
    }
    pub fn save_as(&self, path: &Path, metadata: &Project) -> Result<(), String> {
        let parent = path
            .parent()
            .filter(|p| !p.as_os_str().is_empty())
            .unwrap_or(Path::new("."));
        let tmp = tempfile::NamedTempFile::new_in(parent).map_err(err)?;
        let mut destination = Connection::open(tmp.path()).map_err(err)?;
        destination.progress_handler(1000, Some(crate::operation::cancelled));
        crate::persistence::backup(&self.connection, &mut destination)?;
        let mut portable = metadata.clone();
        portable.resources_external = false;
        destination
            .execute_batch("DELETE FROM resources")
            .map_err(err)?;
        if let Some(workspace) = &mut portable.workspace {
            if !workspace.terrain_files.is_empty() {
                workspace.preferences.terrain_builtin = false;
            }
            let mut total = 0u64;
            for (index, file) in workspace.terrain_files.iter_mut().enumerate() {
                let size = file.metadata().map_err(err)?.len();
                total = total.checked_add(size).ok_or("Terrain size overflow")?;
                if size > 32 * 1024 * 1024 || total > 512 * 1024 * 1024 {
                    return Err("Terrain bundle exceeds 32 MiB per tile or 512 MiB total".into());
                }
                let extension = file
                    .extension()
                    .and_then(|e| e.to_str())
                    .unwrap_or("")
                    .to_ascii_lowercase();
                if !["dt0", "dt1", "dt2"].contains(&extension.as_str()) {
                    return Err("Only DTED resources can be bundled".into());
                }
                let bytes = std::fs::read(&*file).map_err(err)?;
                use sha2::{Digest, Sha256};
                let sha = format!("{:x}", Sha256::digest(&bytes));
                let name = format!("terrain/{index:04}.{extension}");
                destination
                    .execute(
                        "INSERT INTO resources VALUES(?,?,?)",
                        params![name, sha, bytes],
                    )
                    .map_err(err)?;
                *file = PathBuf::from(name);
            }
            workspace.preferences.terrain_path = None;
        }
        let mut gis_total = 0u64;
        for (index, layer) in portable.gis_layers.iter_mut().enumerate() {
            crate::gis::validate_package(layer)?;
            gis_total = gis_total
                .checked_add(layer.bytes)
                .ok_or("GIS size overflow")?;
            if gis_total > crate::gis::MAX_TOTAL {
                return Err("GIS resources exceed 2 GiB".into());
            }
            let bytes = std::fs::read(&layer.asset).map_err(err)?;
            let name = format!("gis/{index:04}.cga");
            destination
                .execute(
                    "INSERT INTO resources VALUES(?,?,?)",
                    params![name, layer.sha256, bytes],
                )
                .map_err(err)?;
            layer.asset = PathBuf::from(name);
        }
        portable.version = 7;
        portable.time_resolution = "fractional_second".into();
        destination.execute("INSERT INTO meta(key,value) VALUES('project',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",[serde_json::to_string(&portable).map_err(err)?]).map_err(err)?;
        // Portable files exclude undo history and deleted payload remnants.
        // Compaction happens on the backup, preserving the live workspace's undo.
        let portable = destination;
        portable.execute_batch("PRAGMA secure_delete=ON; DELETE FROM meta WHERE key='recovery_project'; DELETE FROM history_rows; DELETE FROM history; INSERT INTO search(search) VALUES('optimize'); VACUUM;").map_err(err)?;
        drop(portable);
        crate::persistence::persist(tmp, path)?;
        Ok(())
    }
    /// Clone only into a fresh empty staging store before append ingestion.
    /// TEMP selection/order caches belong to the destination connection and
    /// are initialized separately; the source remains untouched and leased.
    pub fn clone_empty_into(&self, target: &mut Self) -> Result<(), String> {
        if target.count()? != 0 {
            return Err("Append clone requires an empty staging store".into());
        }
        crate::persistence::backup(&self.connection, &mut target.connection)?;
        target.clear_cache()?;
        target.previous_selection.borrow_mut().clear();
        target
            .connection
            .execute("DELETE FROM selection", [])
            .map_err(err)?;
        Ok(())
    }
    pub fn copy_into(&self, target: &mut Self) -> Result<(), String> {
        target
            .connection
            .execute_batch("SAVEPOINT copy_events")
            .map_err(err)?;
        let result = (|| {
            let mut q = self
                .connection
                .prepare("SELECT payload FROM events ORDER BY id_key")
                .map_err(err)?;
            let mut rows = q.query([]).map_err(err)?;
            while let Some(row) = rows.next().map_err(err)? {
                crate::operation::check()?;
                let text: String = row.get(0).map_err(err)?;
                target.insert(&decode_event(&text)?)?;
            }
            Ok(())
        })();
        match result {
            Ok(()) => {
                target
                    .connection
                    .execute_batch("RELEASE copy_events")
                    .map_err(err)?;
                target.checkpoint()?;
                target.changed()
            }
            Err(e) => {
                let _ = target
                    .connection
                    .execute_batch("ROLLBACK TO copy_events; RELEASE copy_events");
                Err(e)
            }
        }
    }
    pub fn load_events(&mut self, events: impl IntoIterator<Item = Event>) -> Result<(), String> {
        self.connection
            .execute_batch("SAVEPOINT load_events")
            .map_err(err)?;
        let result = (|| {
            for event in events {
                self.insert(&event)?
            }
            Ok(())
        })();
        match result {
            Ok(()) => {
                self.connection
                    .execute_batch("RELEASE load_events")
                    .map_err(err)?;
                self.changed()
            }
            Err(e) => {
                let _ = self
                    .connection
                    .execute_batch("ROLLBACK TO load_events; RELEASE load_events");
                Err(e)
            }
        }
    }
    pub fn columns(&self, source: Option<&str>) -> Result<Vec<String>, String> {
        let key = source.map(str::to_owned);
        if let Some(value) = self.column_cache.borrow().get(&key) {
            return Ok(value.clone());
        }
        let sql = if source.is_some() {
            "SELECT DISTINCT a.key FROM attributes a JOIN events e ON e.r=a.r WHERE e.source=?1 ORDER BY a.key LIMIT 513"
        } else {
            "SELECT DISTINCT key FROM attributes ORDER BY key LIMIT 513"
        };
        let mut q = self.connection.prepare(sql).map_err(err)?;
        let values = if let Some(source) = source {
            vec![SqlValue::Text(source.into())]
        } else {
            vec![]
        };
        let rows = q
            .query_map(rusqlite::params_from_iter(values), |r| {
                r.get::<_, String>(0)
            })
            .map_err(err)?;
        let columns = rows.collect::<Result<Vec<_>, _>>().map_err(err)?;
        if self.column_cache.borrow().len() >= 32 {
            self.column_cache.borrow_mut().clear();
        }
        self.column_cache.borrow_mut().insert(key, columns.clone());
        Ok(columns)
    }
    pub fn render(&self, filter: &Filter, budget: usize) -> Result<(Vec<Event>, usize), String> {
        self.render_viewport(filter, budget, None)
    }
    pub fn render_viewport(
        &self,
        filter: &Filter,
        budget: usize,
        viewport: Option<&GeoBounds>,
    ) -> Result<(Vec<Event>, usize), String> {
        let mut f = filter.clone();
        f.located_only = true;
        f.predicates.push(Predicate {
            field: "lat".into(),
            op: Operator::NotEquals,
            value: String::new(),
        });
        let table = self.ordered_with_bounds(&f, None, "time", false, viewport)?;
        self.sample_render(&table, budget)
    }
    fn sample_render(&self, table: &str, budget: usize) -> Result<(Vec<Event>, usize), String> {
        let count = self.table_count(table)?;
        if count <= budget {
            return Ok((self.compact_page(table, 0, count)?, count));
        }
        // Representative positions are indexed lookups, not one random scan per frame.
        self.connection.execute_batch("CREATE TEMP TABLE IF NOT EXISTS render_positions(pos INTEGER PRIMARY KEY); DELETE FROM render_positions").map_err(err)?;
        let mut q = self
            .connection
            .prepare_cached("INSERT INTO render_positions VALUES(?)")
            .map_err(err)?;
        for i in 0..budget {
            q.execute([1 + (i as i64 * (count as i64 - 1) / (budget as i64 - 1))])
                .map_err(err)?;
        }
        let mut q=self.connection.prepare(&format!("SELECT e.id,e.entity,e.time,e.end,e.lat,e.lon,e.value,json_extract(e.payload,'$.location_kind'),json_extract(e.payload,'$.altitude') FROM render_positions p JOIN {table} o ON o.pos=p.pos JOIN events e ON e.r=o.r ORDER BY p.pos")).map_err(err)?;
        let rows = q.query_map([], compact_row).map_err(err)?;
        let events = rows.collect::<Result<Vec<_>, _>>().map_err(err)?;
        Ok((events, count))
    }
    /// Missing locations use exact visible bracketing events, never LOD
    /// neighbours. The source event/indexes remain untouched.
    pub fn inferred_markers(
        &self,
        filter: &Filter,
        budget: usize,
    ) -> Result<(Vec<Event>, usize, Vec<crate::api::InferredMarker>), String> {
        if filter.located_only {
            return Ok((vec![], 0, vec![]));
        }
        let mut missing = filter.clone();
        missing.predicates.push(Predicate {
            field: "geometry_wkt".into(),
            op: Operator::IsEmpty,
            value: String::new(),
        });
        missing.predicates.push(Predicate {
            field: "lat".into(),
            op: Operator::IsEmpty,
            value: String::new(),
        });
        let table = self.ordered(&missing, None, "time", false)?;
        let (sample, total) = self.sample_render(&table, budget.max(2))?;
        let mut located = filter.clone();
        located.located_only = true;
        located.predicates.push(Predicate {
            field: "lat".into(),
            op: Operator::NotEquals,
            value: String::new(),
        });
        let anchors = self.ordered(&located, None, "time", false)?;
        let mut result = vec![];
        let mut metadata = vec![];
        for mut event in sample {
            crate::operation::check()?;
            let source: String = self
                .connection
                .query_row(
                    "SELECT source FROM events WHERE id=?",
                    [event.id.to_string()],
                    |r| r.get(0),
                )
                .map_err(err)?;
            let mut endpoints = vec![];
            for (cmp, order) in [("<", "DESC"), (">", "ASC")] {
                let sql=format!("SELECT e.id,e.entity,e.time,e.end,e.lat,e.lon,e.value,json_extract(e.payload,'$.location_kind'),json_extract(e.payload,'$.altitude') FROM events e JOIN {anchors} o ON e.r=o.r WHERE e.entity=? AND e.source=? AND e.time {cmp} ? ORDER BY e.time {order},e.id_key {order} LIMIT 1");
                if let Some(anchor) = self
                    .connection
                    .query_row(&sql, params![event.entity, source, event.time], compact_row)
                    .optional()
                    .map_err(err)?
                {
                    endpoints.push(anchor);
                }
            }
            if endpoints.len() != 2 {
                continue;
            }
            let a = &endpoints[0];
            let b = &endpoints[1];
            let fraction = crate::timestamps::seconds_between(event.time, a.time)
                / crate::timestamps::seconds_between(b.time, a.time);
            if let Some((lat, lon)) = crate::coordinates::interpolate(
                a.location().unwrap(),
                b.location().unwrap(),
                fraction,
            ) {
                event.lat = Some(lat);
                event.lon = Some(lon);
                metadata.push(crate::api::InferredMarker{id:event.id.to_string(),before_id:a.id.to_string(),after_id:b.id.to_string(),fraction,before_time:a.time,after_time:b.time,method:"WGS84 shortest geodesic, linear time; display only; actual location unknown".into()});
                result.push(event);
            }
        }
        Ok((result, total, metadata))
    }
    pub fn begin_history(&self) -> Result<i64, String> {
        self.connection.execute_batch("CREATE TEMP TABLE IF NOT EXISTS journal_context(seq INTEGER); DELETE FROM journal_context;
        CREATE TEMP TRIGGER IF NOT EXISTS journal_delete BEFORE DELETE ON main.events WHEN EXISTS(SELECT 1 FROM journal_context) BEGIN
          INSERT OR IGNORE INTO history_rows(seq,id,before) SELECT seq,old.id,old.payload FROM journal_context; END;
        CREATE TEMP TRIGGER IF NOT EXISTS journal_insert BEFORE INSERT ON main.events WHEN EXISTS(SELECT 1 FROM journal_context) BEGIN
          INSERT OR IGNORE INTO history_rows(seq,id,before) SELECT seq,new.id,NULL FROM journal_context; END;").map_err(err)?;
        let seq: i64 = self
            .connection
            .query_row("SELECT coalesce(max(seq),0)+1 FROM history", [], |r| {
                r.get(0)
            })
            .map_err(err)?;
        self.connection
            .execute(
                "INSERT INTO history(seq,description,before_meta,after_meta) VALUES(?,'','','')",
                [seq],
            )
            .map_err(err)?;
        self.connection
            .execute("INSERT INTO journal_context VALUES(?)", [seq])
            .map_err(err)?;
        Ok(seq)
    }
    pub fn end_history(&self, seq: i64) -> Result<(), String> {
        self.connection
            .execute_batch("DELETE FROM journal_context")
            .map_err(err)?;
        self.connection.execute("UPDATE history_rows SET after=(SELECT payload FROM events WHERE events.id=history_rows.id) WHERE seq=?",[seq]).map_err(err)?;
        Ok(())
    }
    pub fn replay_history(&mut self, seq: i64, undo: bool) -> Result<(), String> {
        self.connection
            .execute_batch("SAVEPOINT history_replay")
            .map_err(err)?;
        let result = (|| -> Result<(), String> {
            let field = if undo { "before" } else { "after" };
            let mut q = self
                .connection
                .prepare(&format!("SELECT id,{field} FROM history_rows WHERE seq=?"))
                .map_err(err)?;
            let rows = q
                .query_map([seq], |r| {
                    Ok((r.get::<_, String>(0)?, r.get::<_, Option<String>>(1)?))
                })
                .map_err(err)?;
            for row in rows {
                let (id, text) = row.map_err(err)?;
                let id = id.parse().map_err(err)?;
                if let Some(text) = text {
                    self.insert(&serde_json::from_str(&text).map_err(err)?)?
                } else if self.get(id)?.is_some() {
                    self.delete(id)?
                }
            }
            drop(q);
            crate::operation::check()?;
            Ok(())
        })();
        match result {
            Ok(()) => {
                self.connection
                    .execute_batch("RELEASE history_replay")
                    .map_err(err)?;
                self.changed()
            }
            Err(e) => {
                let _ = self
                    .connection
                    .execute_batch("ROLLBACK TO history_replay; RELEASE history_replay");
                Err(e)
            }
        }
    }
    pub fn prune_history(&self, seq: i64) -> Result<(), String> {
        self.connection
            .execute("DELETE FROM history_rows WHERE seq=?", [seq])
            .map_err(err)?;
        self.connection
            .execute("DELETE FROM history WHERE seq=?", [seq])
            .map_err(err)?;
        Ok(())
    }
    pub fn aggregate(
        &self,
        filter: &Filter,
        source: Option<&str>,
        group: &str,
        field: &str,
        limit: usize,
    ) -> Result<Value, String> {
        let (clause, conditions) = Self::where_sql(filter, source);
        let mut values = vec![];
        let mut joins = String::new();
        let grouping = if let Some(key) = group.strip_prefix("attribute:") {
            values.push(SqlValue::Text(key.into()));
            joins.push_str(" LEFT JOIN attributes ga ON ga.r=e.r AND ga.key=? ");
            "ga.text"
        } else {
            match group {
                "entity" => "e.entity",
                "category" => "e.category",
                "source" => "e.source",
                "hour" => "strftime('%Y-%m-%dT%H:00:00Z',e.time,'unixepoch')",
                "day" => "strftime('%Y-%m-%d',e.time,'unixepoch')",
                "month" => "strftime('%Y-%m',e.time,'unixepoch')",
                "year" => "CAST(utc_year(e.time) AS TEXT)",
                _ => return Err("Unknown grouping".into()),
            }
        };
        let numeric = if let Some(key) = field.strip_prefix("attribute:") {
            values.push(SqlValue::Text(key.into()));
            joins.push_str(" LEFT JOIN attributes va ON va.r=e.r AND va.key=? ");
            "va.num"
        } else {
            match field {
                "altitude_m" => "json_extract(e.payload,'$.altitude.meters')",
                "value" => "e.value",
                "lat" => "e.lat",
                "lon" => "e.lon",
                _ => {
                    return Err(
                        "Unknown numeric field; use value, lat, lon or attribute:<name>".into(),
                    )
                }
            }
        };
        values.extend(conditions);
        let order = if group == "year" {
            format!("CAST({grouping} AS INTEGER)")
        } else {
            "1".into()
        };
        let mut q=self.connection.prepare(&format!("SELECT {grouping},count(*),count({numeric}),min({numeric}),max({numeric}),avg({numeric}),sum({numeric}) FROM events e {joins} WHERE {clause} GROUP BY 1 ORDER BY {order} LIMIT {}",limit+1)).map_err(err)?;
        let rows=q.query_map(rusqlite::params_from_iter(values),|r|Ok(json!({"key":r.get::<_,Option<String>>(0)?,"count":r.get::<_,u64>(1)?,"numeric_count":r.get::<_,u64>(2)?,"min":r.get::<_,Option<f64>>(3)?,"max":r.get::<_,Option<f64>>(4)?,"mean":r.get::<_,Option<f64>>(5)?,"sum":r.get::<_,Option<f64>>(6)?}))).map_err(err)?;
        let mut groups = rows.collect::<Result<Vec<_>, _>>().map_err(err)?;
        let limited = groups.len() > limit;
        groups.truncate(limit);
        Ok(json!({"groups":groups,"limited":limited,"limit":limit,"field":field,"group_by":group}))
    }
}
use rusqlite::OptionalExtension;
fn compact_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<Event> {
    let id: String = row.get(0)?;
    let id = id.parse().map_err(|e| {
        rusqlite::Error::FromSqlConversionFailure(0, rusqlite::types::Type::Text, Box::new(e))
    })?;
    let altitude = row
        .get::<_, Option<String>>(8)?
        .map(|s| {
            serde_json::from_str::<crate::altitude::Altitude>(&s).map_err(|e| {
                rusqlite::Error::FromSqlConversionFailure(
                    8,
                    rusqlite::types::Type::Text,
                    Box::new(e),
                )
            })
        })
        .transpose()?;
    Ok(Event {
        altitude,
        location_kind: row.get(7)?,
        id,
        entity: row.get(1)?,
        time: row.get(2)?,
        end: row.get(3)?,
        lat: row.get(4)?,
        lon: row.get(5)?,
        value: row.get(6)?,
        category: String::new(),
        label: String::new(),
        related_to: String::new(),
        attrs: BTreeMap::new(),
        tags: Default::default(),
        note: String::new(),
        source: String::new(),
        source_row: 0,
        geometry_wkt: None,
        mgrs_precision: None,
    })
}
