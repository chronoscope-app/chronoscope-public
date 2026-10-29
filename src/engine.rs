//! One typed domain engine, reused by desktop IPC, CLI, local HTTP and MCP.
use crate::{
    analysis::{self, Parameters, Pattern},
    coordinates,
    import::{self, Mapping, RawTable},
    model::*,
    project::{self, Group, ImportRecipe, Project, SavedView, SceneState, WorkspaceSettings},
    terrain::TerrainCatalog,
    wmts::{Capabilities, MapConfig, TileService},
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::{BTreeMap, BTreeSet},
    io::Write,
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
};
#[derive(Clone, Copy, Debug, Default, Serialize, Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "kebab-case")]
pub enum TerrainVerticalDatum {
    #[default]
    UnresolvedMsl,
    Egm96,
    Ellipsoid,
}

#[derive(Clone, Debug, Serialize, Deserialize, schemars::JsonSchema)]
#[serde(default)]
pub struct Preferences {
    #[schemars(with = "crate::api::Theme")]
    pub theme: String,
    #[schemars(with = "crate::api::CoordinateDisplay")]
    pub coordinates: String,
    #[schemars(with = "crate::api::DateFormat")]
    pub date_format: String,
    #[schemars(with = "crate::api::TimeFormat")]
    pub time_format: String,
    /// Streets is the built-in OpenFreeMap Positron map. Older projects retain
    /// their explicit WMTS presentation until the user changes their basemap.
    #[serde(default)]
    pub basemap: crate::basemap::Basemap,
    pub map: MapConfig,
    /// None preserves the legacy single-map setting. Some([]) explicitly disables the stack.
    pub map_layers: Option<Vec<crate::map_layers::MapLayer>>,
    pub terrain_path: Option<PathBuf>,
    /// Missing in older preferences means retain their previous terrain choice.
    #[serde(default)]
    pub terrain_builtin: bool,
    pub terrain_exaggeration: f32,
    #[serde(default)]
    pub terrain_vertical_datum: TerrainVerticalDatum,
    pub auto_save_unsaved: bool,
}
impl Default for Preferences {
    fn default() -> Self {
        Self {
            theme: "system".into(),
            coordinates: "dd".into(),
            date_format: "system".into(),
            time_format: "system".into(),
            basemap: crate::basemap::Basemap::Streets,
            map: MapConfig::default(),
            map_layers: Some(Vec::new()),
            terrain_path: None,
            terrain_builtin: true,
            terrain_exaggeration: 1.,
            terrain_vertical_datum: TerrainVerticalDatum::Egm96,
            auto_save_unsaved: true,
        }
    }
}
impl Preferences {
    pub fn validate(&self) -> Result<(), String> {
        if !matches!(self.theme.as_str(), "dark" | "light" | "system")
            || !matches!(self.coordinates.as_str(), "dd" | "utm" | "mgrs")
            || !matches!(
                self.date_format.as_str(),
                "system"
                    | "iso"
                    | "mdy"
                    | "mdy-short"
                    | "dmy"
                    | "dmy-short"
                    | "dmy-dots"
                    | "dmy-long"
                    | "mdy-long"
            )
            || !matches!(
                self.time_format.as_str(),
                "system" | "12h" | "12h-seconds" | "24h" | "24h-seconds"
            )
            || !self.terrain_exaggeration.is_finite()
            || !(0.1..=20.).contains(&self.terrain_exaggeration)
        {
            return Err("Invalid preferences".into());
        }
        if let Some(layers) = &self.map_layers {
            crate::map_layers::validate(layers)?;
        }
        if self.terrain_builtin
            && (self.terrain_path.is_some()
                || !matches!(self.terrain_vertical_datum, TerrainVerticalDatum::Egm96))
        {
            return Err(
                "Bundled Balanced terrain requires its EGM96 datum and no external terrain path"
                    .into(),
            );
        }
        if !self.map.url.is_empty() {
            crate::wmts::capability_url(&self.map.url)?;
        }
        Ok(())
    }
}
struct History {
    before: Project,
    after: Project,
    before_preferences: Preferences,
    after_preferences: Preferences,
    seq: i64,
    store_id: String,
    replacement: Option<crate::store::DataStore>,
}
/// One short-lived canvas pick rollback, never serialized or exposed as IDs.
struct PickRestore {
    revision: u64,
    workspace: String,
    selection_version: u64,
    data_version: u64,
    expires: std::time::Instant,
    selected: BTreeSet<u64>,
}
struct State {
    project: Project,
    store: crate::store::DataStore,
    revision: u64,
    undo: Vec<History>,
    redo: Vec<History>,
    pending: Vec<crate::stream_import::PendingImport>,
    preferences: Preferences,
    previous_store: Option<crate::store::DataStore>,
    pick_restore: Option<PickRestore>,
}
mod analytics;
mod assist;
mod charts;
mod desktop;
mod view_host;
pub use view_host::{
    HardwareAcceleration, NativeRecordingBackend, NativeRecordingHost, NativeRecordingHostProvider,
    NativeViewBackend, NativeViewHost,
};
mod fields;
mod imports;
mod patterns;
mod recovery;
mod scenarios;
mod view_identity;
mod view_snapshot;
pub use view_identity::CanonicalViewIdentity;
#[cfg(test)]
#[path = "engine/read_snapshot_tests.rs"]
mod read_snapshot_tests;
mod workspace;

type Observer = Arc<dyn Fn(Value) + Send + Sync>;
struct DesktopReply {
    command: String,
    arguments: Value,
    sender: std::sync::mpsc::SyncSender<Result<Value, String>>,
}
#[derive(Clone)]
pub struct Engine {
    resource_epoch: Arc<std::sync::atomic::AtomicU64>,
    revision_counter: Arc<std::sync::atomic::AtomicU64>,
    document_epoch: Arc<std::sync::atomic::AtomicU64>,
    lifecycle: Arc<recovery::Lifecycle>,
    pub assistant: Arc<crate::si::Assistant>,
    pub mcp_client: Arc<crate::mcp_client::Client>,
    #[cfg(feature = "experimental-browser-webmcp")]
    pub browser: Arc<crate::webmcp::Browser>,
    pub(crate) jobs: crate::jobs::Jobs,
    observer: Arc<Mutex<Option<Observer>>>,
    captures: Arc<Mutex<BTreeMap<String, DesktopReply>>>,
    native_view_host: Arc<Mutex<Option<NativeViewHost>>>,
    native_recording_host_provider: Arc<Mutex<Option<NativeRecordingHostProvider>>>,
    state: Arc<Mutex<State>>,
    operation: Arc<Mutex<()>>,
    analytics_worker: Arc<Mutex<()>>,
    pattern_cache: Arc<Mutex<BTreeMap<String, patterns::CachedScan>>>,
    retries: Arc<Mutex<BTreeMap<String, (String, Value)>>>,
    terrain: Arc<Mutex<Option<TerrainCatalog>>>,
    pub maps: Arc<TileService>,
    capabilities: Arc<Mutex<BTreeMap<String, Arc<Capabilities>>>>,
    pub data_dir: PathBuf,
    terrain_scope: Option<PathBuf>,
    gis_cache: Arc<Mutex<BTreeMap<String, Arc<Vec<crate::gis::Feature>>>>>,
}
fn arg<T: serde::de::DeserializeOwned>(v: &Value, name: &str) -> Result<T, String> {
    serde_json::from_value(
        v.get(name)
            .cloned()
            .ok_or_else(|| format!("Missing {name}"))?,
    )
    .map_err(|e| format!("Invalid {name}: {e}"))
}
fn within(path: &Path, root: &Path) -> bool {
    root.canonicalize()
        .ok()
        .is_some_and(|root| path.starts_with(root))
}
fn read_preferences(dir: &Path) -> Preferences {
    let Some(value) = std::fs::read(dir.join("preferences.json"))
        .ok()
        .filter(|b| b.len() < 1024 * 1024)
        .and_then(|b| serde_json::from_slice::<Value>(&b).ok())
    else {
        return Preferences::default();
    };
    let legacy = value.get("basemap").is_none();
    let mut prefs: Preferences = serde_json::from_value(value).unwrap_or_default();
    // Upgrade the former out-of-box single NASA reference, not custom sources
    // or explicitly saved projects. Existing user server libraries stay intact.
    let old_default = prefs.map.url == MapConfig::nasa().url
        && prefs.map.layer == "BlueMarble_ShadedRelief"
        && prefs.map.enabled
        && prefs.map_layers.is_none();
    if legacy && old_default {
        prefs.basemap = crate::basemap::Basemap::Streets;
        prefs.map.enabled = false;
        prefs.map_layers = Some(Vec::new());
    }
    prefs
}

fn preview_text(value: &str) -> String {
    let mut end = value.len().min(256);
    while !value.is_char_boundary(end) {
        end -= 1;
    }
    value[..end].into()
}
fn preview_event(mut event: Event) -> Value {
    event.attrs.clear();
    event.entity = preview_text(&event.entity);
    event.category = preview_text(&event.category);
    event.label = preview_text(&event.label);
    event.related_to = preview_text(&event.related_to);
    event.note = preview_text(&event.note);
    crate::store::event_json(&event)
}
fn context_cost(project: &Project) -> usize {
    let ids = project.selected.len()
        + project
            .views
            .iter()
            .map(|v| v.selected.len())
            .sum::<usize>()
        + project.groups.iter().map(|g| g.ids.len()).sum::<usize>();
    let texts = serde_json::to_string(&project.filter)
        .map(|v| v.len())
        .unwrap_or(0)
        + project
            .views
            .iter()
            .map(|v| {
                v.name.len()
                    + serde_json::to_string(&v.filter)
                        .map(|v| v.len())
                        .unwrap_or(0)
            })
            .sum::<usize>()
        + project.groups.iter().map(|g| g.name.len()).sum::<usize>();
    ids.saturating_mul(32)
        + texts
        + serde_json::to_string(&project.field_roles)
            .map(|v| v.len())
            .unwrap_or(0)
}
fn validate_context_budget(project: &Project) -> Result<(), String> {
    if context_cost(project) > 64 * 1024 * 1024 {
        return Err("RESOURCE_LIMIT: workspace selection/saved context exceeds 64 MiB budget; narrow selections or remove saved context".into());
    }
    Ok(())
}
fn forget_redo(state: &mut State) {
    for old in state.redo.drain(..) {
        if old.store_id == state.store.identity() {
            let _ = state.store.prune_history(old.seq);
        }
    }
}
fn trim_history(state: &mut State) {
    while state.undo.len() > 32
        || state.undo.len() > 1
            && state
                .undo
                .iter()
                .map(|h| context_cost(&h.before) + context_cost(&h.after))
                .sum::<usize>()
                > 128 * 1024 * 1024
    {
        let old = state.undo.remove(0);
        if old.store_id == state.store.identity() {
            let _ = state.store.prune_history(old.seq);
        }
    }
}
fn undoable(command: &str) -> bool {
    crate::command::Command::parse(command).is_some_and(|c| c.effects().undoable)
}
fn transactional(command: &str) -> bool {
    crate::command::Command::parse(command).is_some_and(|c| c.effects().transactional)
}
fn viewport_bounds(args: &Value) -> Result<Option<GeoBounds>, String> {
    if let Some(bounds) = args.get("bounds") {
        let [west, south, east, north]: [f64; 4] =
            serde_json::from_value(bounds.clone()).map_err(|e| e.to_string())?;
        let bounds = GeoBounds {
            west,
            south,
            east,
            north,
        };
        let mut p = Project::new(Dataset::default());
        p.filter.bounds = Some(bounds.clone());
        p.validate()?;
        Ok(Some(bounds))
    } else {
        Ok(None)
    }
}
fn query_filter(p: &Project, args: &Value, default: bool) -> Result<Filter, String> {
    let f: Filter = if let Some(f) = args.get("filter") {
        serde_json::from_value(f.clone()).map_err(|e| e.to_string())?
    } else if args["apply_filter"].as_bool().unwrap_or(default) {
        p.filter.clone()
    } else {
        Filter::default()
    };
    let mut structural = Project::new(Dataset::default());
    structural.filter = f;
    structural.validate()?;
    let mut f = structural.filter;
    if args["selected_only"].as_bool().unwrap_or(false) {
        f.selected_only = true
    }
    Ok(f)
}
impl Engine {
    fn validate_pick_restore(&self, s: &State, revision: u64) -> Result<(), String> {
        let pick = s
            .pick_restore
            .as_ref()
            .ok_or("CONFLICT: canvas pick expired or superseded")?;
        if pick.revision != revision
            || pick.selection_version != s.store.selection_version()
            || pick.data_version != s.store.query_stamp(true).0
            || pick.workspace != self.workspace_identity_locked(s)
            || pick.expires <= std::time::Instant::now()
        {
            return Err("CONFLICT: canvas pick expired or superseded".into());
        }
        Ok(())
    }
    pub fn new(project: Project, data_dir: PathBuf) -> Result<Self, String> {
        Self::new_with_terrain_scope(project, data_dir, None)
    }
    pub fn new_with_terrain_scope(
        mut project: Project,
        data_dir: PathBuf,
        root: Option<&Path>,
    ) -> Result<Self, String> {
        let root = root
            .map(Path::canonicalize)
            .transpose()
            .map_err(|e| e.to_string())?;
        let root = crate::operation::intersect_scopes(crate::operation::scope(), root)?;
        let root = root.as_deref();
        project.validate()?;
        validate_context_budget(&project)?;
        std::fs::create_dir_all(&data_dir).map_err(|e| e.to_string())?;
        let mut store = crate::store::DataStore::new(&data_dir)?;
        store.load_events(std::mem::take(&mut project.dataset.events))?;
        store.set_selection(&project.selected)?;
        let mut preferences = project
            .workspace
            .as_ref()
            .map(|w| w.preferences.clone())
            .unwrap_or_else(|| read_preferences(&data_dir));
        preferences.auto_save_unsaved = read_preferences(&data_dir).auto_save_unsaved;
        workspace::validate_resources(&project, &data_dir, root)?;
        let (terrain, _) = workspace::prepare_terrain(&project, &mut preferences, root);
        Ok(Self {
            revision_counter: Arc::new(std::sync::atomic::AtomicU64::new(1)),
            document_epoch: Arc::new(std::sync::atomic::AtomicU64::new(1)),
            lifecycle: Arc::new(recovery::Lifecycle::new()?),
            assistant: Arc::new(crate::si::Assistant::default()),
            mcp_client: Arc::new(crate::mcp_client::Client::default()),
            #[cfg(feature = "experimental-browser-webmcp")]
            browser: Arc::new(crate::webmcp::Browser::default()),
            jobs: Arc::new(Mutex::new(BTreeMap::new())),
            resource_epoch: Arc::new(std::sync::atomic::AtomicU64::new(0)),
            observer: Arc::new(Mutex::new(None)),
            captures: Arc::new(Mutex::new(BTreeMap::new())),
            native_view_host: Arc::new(Mutex::new(None)),
            native_recording_host_provider: Arc::new(Mutex::new(None)),
            state: Arc::new(Mutex::new(State {
                project,
                store,
                revision: 1,
                undo: vec![],
                redo: vec![],
                pending: vec![],
                preferences,
                previous_store: None,
                pick_restore: None,
            })),
            operation: Arc::new(Mutex::new(())),
            analytics_worker: Arc::new(Mutex::new(())),
            pattern_cache: Arc::new(Mutex::new(BTreeMap::new())),
            retries: Arc::new(Mutex::new(BTreeMap::new())),
            terrain: Arc::new(Mutex::new(terrain)),
            maps: Arc::new(TileService::new(data_dir.join("wmts-cache"))?),
            capabilities: Arc::new(Mutex::new(BTreeMap::new())),
            data_dir,
            terrain_scope: root.map(Path::to_path_buf),
            gis_cache: Arc::new(Mutex::new(BTreeMap::new())),
        })
    }
    /// Compatibility materialization for small callers; agent queries never use this path.
    pub fn project(&self) -> Result<Project, String> {
        let s = self.state.lock().map_err(|_| "Workspace unavailable")?;
        if s.store.count()? > MAX_EVENTS {
            return Err("Use paginated query or save for disk-backed workspaces".into());
        }
        s.store.materialize(s.project.clone())
    }
    pub fn set_observer(&self, observer: Observer) -> Result<(), String> {
        *self.observer.lock().map_err(|_| "Observer unavailable")? = Some(observer);
        Ok(())
    }
    /// Cheap change token for MCP subscriptions; never acquires the workspace gate.
    pub fn resource_version(&self) -> Value {
        let jobs = self
            .jobs
            .lock()
            .map(|jobs| {
                jobs.iter()
                    .map(|(id, j)| json!([id, j.status, j.progress, j.sequence]))
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default();
        json!([
            self.revision_counter
                .load(std::sync::atomic::Ordering::Acquire),
            self.document_epoch
                .load(std::sync::atomic::Ordering::Acquire),
            self.resource_epoch
                .load(std::sync::atomic::Ordering::Acquire),
            jobs
        ])
    }
    pub fn clear_observer(&self) {
        if let Ok(mut observer) = self.observer.lock() {
            *observer = None;
        }
    }
    fn notify(&self, value: Value) {
        if value["kind"] == "changed" {
            self.resource_epoch
                .fetch_add(1, std::sync::atomic::Ordering::AcqRel);
        }
        if let Ok(observer) = self.observer.lock() {
            if let Some(observer) = observer.as_ref() {
                observer(value)
            }
        }
    }
    pub fn invoke_typed(
        &self,
        command: crate::command::Command,
        args: Value,
    ) -> Result<Value, crate::error::EngineError> {
        self.invoke(command.as_str(), args).map_err(Into::into)
    }
    pub fn invoke(&self, command: &str, args: Value) -> Result<Value, String> {
        if let Some(expected) = args["expected_workspace"].as_str().map(str::to_owned) {
            if crate::operation::workspace().is_some_and(|outer| outer != expected) {
                return Err("CONFLICT: workspace identity differs from the active request".into());
            }
            crate::operation::with_workspace(expected, || self.invoke_inner(command, args))
        } else {
            self.invoke_inner(command, args)
        }
    }
    fn invoke_inner(&self, command: &str, mut args: Value) -> Result<Value, String> {
        let command = crate::command::canonical_name(command);
        if command == "job_start" {
            if let Some(name) = args["command"].as_str() {
                args["command"] = json!(crate::command::canonical_name(name));
            }
        }
        crate::schema::validate_typed(command, &args)
            .map_err(crate::error::EngineError::into_legacy)?;
        self.check_workspace()?;
        if let Some(root) = crate::operation::scope() {
            crate::mcp::scope_arguments(command, &mut args, &root)?;
        }
        crate::operation::check()?;
        let identity = crate::command::Command::parse(command).ok_or("Unknown command")?;
        if matches!(command, "assist_status" | "assist_explain" | "assist_tags") {
            let workspace = crate::operation::workspace()
                .map(Ok)
                .unwrap_or_else(|| self.workspace_identity())?;
            return crate::operation::with_workspace(workspace, || {
                crate::operation::with_deadline(std::time::Duration::from_secs(300), || {
                    self.assistant.assist_invoke(self, command, args)
                })
            });
        }
        if command == "pattern_scan" {
            return crate::operation::with_deadline(std::time::Duration::from_secs(300), || {
                self.pattern_scan(args)
            });
        }
        if command == "chart_data" {
            return crate::operation::with_deadline(std::time::Duration::from_secs(300), || {
                self.chart_invoke(args)
            });
        }
        if command == "field_profile" {
            return crate::operation::with_deadline(std::time::Duration::from_secs(300), || {
                self.field_profile(args)
            });
        }
        if command.starts_with("analytics_") {
            return crate::operation::with_deadline(std::time::Duration::from_secs(300), || {
                let result = self.analytics_invoke(command, args);
                if result.is_err() {
                    crate::operation::check()?;
                }
                result
            });
        }
        #[cfg(feature = "experimental-browser-webmcp")]
        if command.starts_with("webmcp_") {
            return self.browser.invoke(&self.mcp_client, command, &args);
        }
        if command.starts_with("client_") {
            let started = std::time::Instant::now();
            let result = self.mcp_client.invoke(command, args);
            crate::diagnostics::record(
                &self.data_dir,
                command,
                self.revision_counter
                    .load(std::sync::atomic::Ordering::Acquire),
                started.elapsed(),
                result.is_ok(),
            );
            return result;
        }
        // Resource requests and pure analysis do not hold the workspace operation
        // gate during network, native TLS, terrain decoding or CPU work.
        if identity.effects().detached {
            let started = std::time::Instant::now();
            let result = self.invoke_raw(command, args).and_then(|value| {
                crate::operation::check()?;
                Ok(value)
            });
            let revision = self
                .revision_counter
                .load(std::sync::atomic::Ordering::Acquire);
            if result.is_ok() && matches!(command, "analytics_run" | "analytics_remove") {
                self.resource_epoch
                    .fetch_add(1, std::sync::atomic::Ordering::AcqRel);
            }
            crate::diagnostics::record(
                &self.data_dir,
                command,
                revision,
                started.elapsed(),
                result.is_ok(),
            );
            return result;
        }
        if matches!(command, "analysis_prepare" | "analysis_execute") {
            return crate::analysis_assist::invoke(self, command, args);
        }
        if command.starts_with("si_") || command == "present_result" {
            return self.assistant.invoke(self, command, args);
        }
        if matches!(
            command,
            "view_capture"
                | "view_status"
                | "view_reset"
                | "view_navigate"
                | "view_recording"
                | "view_profile"
                | "view_wait"
                | "view_playback"
                | "view_scenario"
                | "assist_ui"
        ) {
            if command == "view_scenario" {
                return self
                    .scenario_request(args)
                    .map_err(crate::error::EngineError::into_legacy);
            }
            let started = std::time::Instant::now();
            let result = self.desktop_request(command, args);
            crate::diagnostics::record(
                &self.data_dir,
                command,
                self.revision_counter
                    .load(std::sync::atomic::Ordering::Acquire),
                started.elapsed(),
                result.is_ok(),
            );
            return result;
        }
        if command.starts_with("job_") {
            return crate::jobs::invoke(self, command, args);
        }
        if command == "view_response" {
            return self.desktop_response(args);
        }
        let public_fingerprint = format!("{command}:{}", args);
        if let Some(key) = args["idempotency_key"].as_str() {
            if let Some((original, result)) = self
                .retries
                .lock()
                .map_err(|_| "Retry cache unavailable")?
                .get(key)
            {
                return if original == &public_fingerprint {
                    Ok(result.clone())
                } else {
                    Err(
                        "CONFLICT: idempotency key was already used with different arguments"
                            .into(),
                    )
                };
            }
        }
        if command == "select_query"
            && (args.get("pattern_scan_id").is_some() != args.get("pattern_finding_id").is_some())
        {
            return Err("INVALID_ARGUMENT: pattern_scan_id and pattern_finding_id must be supplied together".into());
        }
        if command == "select_query"
            && (args.get("config").is_some() || args.get("pattern_scan_id").is_some())
        {
            if [
                "table_range",
                "display_cells",
                "display_cell",
                "filter",
                "source",
                "apply_filter",
                "entity",
                "bin",
                "selected_only",
            ]
            .iter()
            .any(|key| args.get(key).is_some())
            {
                return Err("INVALID_ARGUMENT: chart selection cannot be combined with another selection scope".into());
            }
            let (ids, revision) =
                crate::operation::with_deadline(std::time::Duration::from_secs(300), || {
                    if args.get("pattern_scan_id").is_some() {
                        if args.get("config").is_some() || args.get("chart_marks").is_some() {
                            return Err(
                                "INVALID_ARGUMENT: choose chart or pattern evidence selection"
                                    .into(),
                            );
                        }
                        self.pattern_members(&args)
                    } else {
                        self.chart_members(&args)
                    }
                })?;
            args["_chart_ids"] = json!(ids.iter().map(u64::to_string).collect::<Vec<_>>());
            args["expected_revision"] = json!(revision);
        }
        let _gate = loop {
            crate::operation::check()?;
            match self.operation.try_lock() {
                Ok(guard) => break guard,
                Err(std::sync::TryLockError::WouldBlock) => {
                    std::thread::sleep(std::time::Duration::from_millis(25))
                }
                Err(_) => return Err("Workspace unavailable".into()),
            }
        };
        crate::operation::check()?;
        self.check_workspace()?;
        crate::operation::progress(0, None, "Running");
        let started = std::time::Instant::now();
        let mutation = crate::schema::is_mutation(command, &args);
        let key = args["idempotency_key"].as_str().map(str::to_owned);
        let fingerprint = public_fingerprint;
        if let Some(key) = &key {
            if let Some((original, result)) = self
                .retries
                .lock()
                .map_err(|_| "Retry cache unavailable")?
                .get(key)
            {
                return if original == &fingerprint {
                    Ok(result.clone())
                } else {
                    Err(
                        "CONFLICT: idempotency key was already used with different arguments"
                            .into(),
                    )
                };
            }
        }
        let (revision, before, prefs) = {
            let mut s = self.state.lock().map_err(|_| "Workspace unavailable")?;
            if let Some(expected) = crate::operation::workspace() {
                self.check_workspace_state(&s, &expected)?;
            }
            if s.pick_restore.as_ref().is_some_and(|pick| {
                pick.expires <= std::time::Instant::now()
                    || pick.workspace != self.workspace_identity_locked(&s)
            }) {
                s.pick_restore = None;
            }
            // Reject stale receipts before a SQL savepoint is opened, so an
            // old double-click cannot invalidate the newest pick's data stamp.
            if command == "selection_restore" {
                self.validate_pick_restore(&s, arg(&args, "pick_revision")?)?;
            }
            (
                s.revision,
                if mutation {
                    s.project.clone()
                } else {
                    Project::new(Dataset::default())
                },
                s.preferences.clone(),
            )
        };
        if let Some(expected) = args["expected_revision"].as_u64() {
            if expected != revision {
                return Err(format!(
                    "CONFLICT: expected revision {expected}, current revision {revision}"
                ));
            }
        }
        let dry = args["dry_run"].as_bool().unwrap_or(false);
        if let Some(a) = args.as_object_mut() {
            a.remove("dry_run");
            a.remove("expected_revision");
            a.remove("expected_workspace");
            a.remove("idempotency_key");
        }
        if dry
            && (!transactional(command)
                || matches!(command, "selection_pick" | "selection_restore"))
        {
            return Ok(
                json!({"dry_run":true,"executed":false,"revision":revision,"command":command,"plan":args,"note":"External I/O, import, history and terrain operations are planned without execution."}),
            );
        }
        let seq = if mutation && transactional(command) {
            let s = self.state.lock().map_err(|_| "Workspace unavailable")?;
            s.store
                .connection
                .execute_batch("SAVEPOINT operation")
                .map_err(|e| e.to_string())?;
            match s.store.begin_history() {
                Ok(seq) => Some(seq),
                Err(e) => {
                    let _ = s
                        .store
                        .connection
                        .execute_batch("ROLLBACK TO operation; RELEASE operation");
                    return Err(e);
                }
            }
        } else {
            None
        };
        let file_commit = (mutation
            && matches!(
                command,
                "save"
                    | "export"
                    | "import_rejections_export"
                    | "preferences"
                    | "terrain_load"
                    | "terrain_unload"
            ))
        .then(crate::operation::track_file_commit);
        let lifecycle_path = args["path"].as_str().map(str::to_owned);
        let new_document = matches!(command, "demo" | "demo_open" | "aggregate_apply")
            || command == "import_commit" && !args["append"].as_bool().unwrap_or(false);
        let result = self.invoke_raw(command, args).and_then(|v| {
            if !file_commit.as_ref().is_some_and(|guard| guard.committed()) {
                crate::operation::check()?;
            }
            Ok(v)
        });
        let mut s = self.state.lock().map_err(|_| "Workspace unavailable")?;
        let result = result.and_then(|value| {
            if mutation {
                validate_context_budget(&s.project)?;
            }
            if let Some(seq) = seq {
                s.store.end_history(seq)?;
                let selected = s.project.selected.clone();
                s.store.selection_changed(&selected)?;
                crate::operation::check()?;
                s.store
                    .connection
                    .execute_batch(if dry {
                        "ROLLBACK TO operation; RELEASE operation"
                    } else {
                        "RELEASE operation"
                    })
                    .map_err(|e| e.to_string())?;
            }
            Ok(value)
        });
        let mut result = match result {
            Ok(mut value) => {
                if let Some(seq) = seq {
                    if dry {
                        s.project = before;
                        s.preferences = prefs;
                        let selected = s.project.selected.clone();
                        s.store.selection_changed(&selected)?;
                        s.store.changed()?;
                        if let Some(v) = value.as_object_mut() {
                            v.insert("dry_run".into(), json!(true));
                            v.insert("executed".into(), json!(false));
                        }
                    } else {
                        let history = History {
                            before,
                            after: s.project.clone(),
                            before_preferences: prefs,
                            after_preferences: s.preferences.clone(),
                            seq,
                            store_id: s.store.identity(),
                            replacement: None,
                        };
                        if undoable(command) {
                            s.undo.push(history);
                            forget_redo(&mut s);
                        } else {
                            let _ = s.store.prune_history(seq);
                        }
                        trim_history(&mut s);
                        while s.store.history_bytes().unwrap_or(0) > 128 * 1024 * 1024
                            && s.undo.len() > 1
                        {
                            let old = s.undo.remove(0);
                            if old.store_id == s.store.identity() {
                                let _ = s.store.prune_history(old.seq);
                            }
                        }
                    }
                } else if let Some(old) = s.previous_store.take() {
                    self.document_epoch
                        .fetch_add(1, std::sync::atomic::Ordering::AcqRel);
                    let history = History {
                        before,
                        after: s.project.clone(),
                        before_preferences: prefs,
                        after_preferences: s.preferences.clone(),
                        seq: 0,
                        store_id: old.identity(),
                        replacement: Some(old),
                    };
                    s.undo.push(history);
                    forget_redo(&mut s);
                    while s.undo.iter().filter(|h| h.replacement.is_some()).count() > 3 {
                        s.undo.remove(0);
                    }
                }
                if mutation && !dry {
                    s.revision += 1;
                    self.revision_counter
                        .store(s.revision, std::sync::atomic::Ordering::Release);
                    let selected = s.project.selected.clone();
                    s.store.selection_changed(&selected)?;
                }
                if command != "preferences" {
                    if let Some(v) = value.as_object_mut() {
                        v.insert("revision".into(), json!(s.revision));
                    }
                }
                Ok(value)
            }
            Err(e) => {
                if let Some(old) = s.previous_store.take() {
                    s.store = old;
                }
                if seq.is_some() {
                    let _ = s
                        .store
                        .connection
                        .execute_batch("ROLLBACK TO operation; RELEASE operation");
                    s.project = before.clone();
                    s.preferences = prefs.clone();
                    let selected = s.project.selected.clone();
                    let _ = s.store.selection_changed(&selected);
                    let _ = s.store.changed();
                }
                // Read failures have no metadata snapshot to restore. In particular,
                // a failed map request or coordinate conversion must never replace
                // the live project with the read-path placeholder above.
                if mutation {
                    s.project = before;
                    s.preferences = prefs;
                }
                Err(e)
            }
        };
        let current = s.revision;
        let store_id = s.store.opaque_identity();
        drop(s);
        if mutation && !dry {
            if let Ok(value) = &mut result {
                let external = file_commit.as_ref().is_some_and(|guard| guard.committed());
                if command != "preferences"
                    && (external || identity.effects().dirty && value["needs_review"] != true)
                {
                    value["commit_receipt"] = json!({"operation_id":format!("{store_id}:{current}"),"kind":if external {"external_file"}else{"workspace"},"store_id":store_id,"revision_before":revision.to_string(),"revision_after":current.to_string(),"committed":true,"cancel_requested":crate::operation::cancelled()});
                }
            }
        }
        if mutation && !dry && result.is_ok() {
            self.complete_workspace_change(
                command,
                current,
                lifecycle_path.as_deref(),
                new_document
                    && result
                        .as_ref()
                        .is_ok_and(|value| value["needs_review"] != true),
            );
        }
        crate::diagnostics::record(
            &self.data_dir,
            command,
            current,
            started.elapsed(),
            result.is_ok(),
        );
        if let (Some(key), Ok(value)) = (key, &result) {
            let mut cache = self.retries.lock().map_err(|_| "Retry cache unavailable")?;
            if cache.len() >= 128 {
                cache.clear()
            }
            if value.to_string().len() < 1024 * 1024 {
                cache.insert(key, (fingerprint, value.clone()));
            }
        }
        result
    }
    fn invoke_raw(&self, command: &str, args: Value) -> Result<Value, String> {
        match command {
            "workspace_status"
            | "recovery_list"
            | "recovery_checkpoint"
            | "recovery_clear"
            | "recovery_restore"
            | "recovery_discard" => self.recovery_invoke(command, args),
            "autosave_unsaved" | "recovery_archive" => self.recovery_invoke(command, args),
            "selection_contains" => {
                let s = self.state.lock().map_err(|_| "Workspace unavailable")?;
                let ids: Vec<String> = arg(&args, "ids")?;
                let mut selected = vec![];
                for id in ids {
                    let numeric = id.parse::<u64>().map_err(|_| "Invalid event ID")?;
                    if s.project.selected.contains(&numeric) {
                        selected.push(id)
                    }
                }
                Ok(json!({"selected":selected}))
            }
            "revision" => Ok(
                json!({"revision":self.revision_counter.load(std::sync::atomic::Ordering::Acquire)}),
            ),
            "file_probe" | "gis_layers" | "gis_load" | "gis_set" | "gis_remove" | "gis_read"
            | "gis_table" => self.invoke_gis(command, args),
            "capabilities" => {
                let mut capabilities = json!({"version":env!("CARGO_PKG_VERSION"),"commands":crate::schema::COMMANDS,"storage":"indexed_sqlite","renderer":{"engine":"CesiumJS","backend":"WebGL2","webgpu_backend":false,"modes":["space-time","map","globe"],"attached_tools":["view_status","view_reset","view_navigate","view_capture","view_recording","view_profile","view_wait","view_playback","view_scenario"],"profiling":{"maximum_samples":6000,"maximum_active":2,"cpu_only":true,"video_companion":true},"scenarios":{"maximum_recipes":16,"maximum_steps":80,"maximum_seconds":120,"persistent_recipes":true},"playback_actions":["status","play","pause","configure","seek","step"],"capture":{"default_target":"app","targets":["app","map"],"windows":["main","si-chat"],"app_snapshot":"native WebView visible content; desktop only","video":{"command":"view_recording","platform":"macOS 15+","backend":"ScreenCaptureKit app window","format":"H.264 MP4","audio":false,"maximum_seconds":120,"maximum_bytes":268435456,"maximum_dimensions":[1920,1080]}},"navigation":["fit","fit_layer","look_at","zoom","north_up"],"geographic_input":"WGS84 longitude, latitude, ellipsoid metres; heading clockwise from north; tilt zero=nadir","hardware_acceleration":"inspect on the target host; not inferred from API availability"},"max_csv_bytes":2147483648u64,"max_events":50000000u64,"render_budget":20000,"render_budget_options":[20000,100000],"display":{"default_mode":"auto","cluster_threshold":2000,"ui_max_cells":4000,"max_time_slabs":32,"heatmap_default":false,"bloom_default":false,"spatial_culling_default":true,"trail_tolerance_pixels":2,"exact_membership":true,"cold_query":"proportional to matching rows; cached base grids"},"page_limit":1000,"exact_ids":"decimal_u64_strings","time_resolution":"fractional_second","time_storage":"IEEE 754 binary64 Unix seconds; approximately 0.24 microsecond spacing near 2026; finer source strings retained","mutation_controls":["expected_revision","expected_workspace","dry_run","idempotency_key"],"batch":"atomic workspace operations","excel":"bounded workbook ingestion","analytics":{"discovery":"analytics_discover","describe":"analytics_describe","run":"analytics_run","result":"analytics_result","list":"analytics_list","remove":"analytics_remove","capabilities":crate::analytics::registry::NAMES,"sampling":"none","result_storage":"portable project database","max_results":32,"timeout_seconds":300},"analysis":"explicit bounded input budget","mcp_client":{"transports":["stdio","streamable_http"],"session_only":true,"explicit_tool_grants":true,"max_connections":16,"max_tools_per_connection":256,"max_response_bytes":2097152,"operation_timeout_seconds":60,"oauth":false,"browser_webmcp":cfg!(feature = "experimental-browser-webmcp")},"assistant":{"name":"Super Intelligence","commands_prefix":"si_","protocol":"OpenAI-compatible Chat Completions tools","providers":["openai-compatible"],"analysis_commands":["analysis_context","analysis_prepare","analysis_execute"],"app_intents":{"minimum_macos":"13.0","packaged_desktop":true,"actions":["workspace_summary","show_view","select_entity","recommend_analyses","find_track_gaps"]},"max_steps":16,"max_tool_calls":32,"key_storage":"session memory","file_access":"optional connection-scoped root","history":{"storage":"session memory","max_messages":32,"max_bytes":98304,"clear_command":"si_clear"}},"focused_ai":{"commands":["assist_status","assist_explain","assist_tags","assist_tags_apply"],"desktop_ui":"assist_ui","providers":["apple-local","connected"],"chat_history":false,"action_tools":false,"max_tag_events":25,"max_text_bytes_per_event":4000,"apply":"explicit additive review, expected workspace and revision, one Undo","cancellation":"job_cancel"},"aggregation":{"method":"fixed UTC windows and WGS84 anchored radius","streaming_import":true,"lossy":true,"partitions":["entity","category","source"]},"time_only_markers":"display-only geodesic triangles; source coordinates remain null","gis":{"formats":["shapefile","geopackage","geojson","topojson","kml","kmz","czml","gpx","tiles3d","gltf","glb"],"native_reference_layers":true,"event_import":true,"portable_assets":true,"max_layers":64,"max_reference_features":50000,"external_links":false},"geometry":{"polygon_anchor":"derived area-weighted WGS84 authalic surface centroid; holes subtract, multipart adds; can lie outside polygon", "format":"OGC WKT / EWKT SRID=4326","topology":"GeoRust validation and exact rectangle intersection","z_m":"preserved, not used as height/time"},"wmts":{"multiple_sources":true,"max_layers":64,"layer_preferences":"map_layers","layer_properties":["enabled","opacity","order","min_zoom","max_zoom"],"zoom":"view-centre projected camera resolution, minimum inclusive and maximum exclusive","transport":"direct disk cache, no proxy required","tile_plan":"paged full requested coverage","default_concurrency":8,"default_interval_ms":0}});
                self.apply_native_view_host(&mut capabilities)?;
                self.apply_native_recording_host(&mut capabilities)?;
                Ok(capabilities)
            }
            "diagnostics" => {
                let s = self.state.lock().map_err(|_| "Workspace unavailable")?;
                Ok(
                    json!({"revision":s.revision,"store":s.store.cache_info(),"log_directory":self.data_dir.join("logs"),"pending_imports":s.pending.len(),"undo":s.undo.len(),"redo":s.redo.len()}),
                )
            }
            "view_snapshot_v1" => self.view_snapshot_v1(args),
            "snapshot" => {
                let s = self.state.lock().map_err(|_| "Workspace unavailable")?;
                let p = &s.project;
                let mut v = if args["compact"].as_bool().unwrap_or(false) {
                    s.store.compact_summary(&p.filter)?
                } else {
                    s.store.summary_with_statistics(
                        &p.filter,
                        args["include_statistics"].as_bool().unwrap_or(true),
                    )?
                };
                let mut global_time = if v["count"] == 0 {
                    None
                } else {
                    Some(s.store.time_bounds()?)
                };
                for layer in &p.gis_layers {
                    if layer.enabled {
                        if let Some([lo, hi]) = layer.time_bounds {
                            global_time =
                                Some(global_time.map_or((lo, hi), |(a, b)| (a.min(lo), b.max(hi))));
                        }
                    }
                }
                if p.gis_layers
                    .iter()
                    .any(|l| l.enabled && l.time_bounds.is_some())
                {
                    if let Some((lo, hi)) = global_time {
                        let hi = if hi > lo { hi } else { lo + 1. };
                        if v["time_bounds"] != json!([lo, hi]) && args["compact"] != true {
                            let histogram = s.store.histogram_in_range(&p.filter, lo, hi)?;
                            v["histogram"] = histogram["histogram"].clone();
                            v["selected_histogram"] = histogram["selected_histogram"].clone();
                        }
                        v["time_bounds"] = json!([lo, hi]);
                    }
                }
                let limit = args["selection_limit"].as_u64().unwrap_or(1000) as usize;
                for (k, value) in [
                    ("revision", json!(s.revision)),
                    ("workspace_id", json!(self.workspace_identity_locked(&s))),
                    ("name", json!(p.dataset.name)),
                    (
                        "selected",
                        json!(p
                            .selected
                            .iter()
                            .take(limit)
                            .map(u64::to_string)
                            .collect::<Vec<_>>()),
                    ),
                    ("selected_count", json!(p.selected.len())),
                    ("selection_limited", json!(p.selected.len() > limit)),
                    ("filter", json!(p.filter)),
                    (
                        "views",
                        if args["compact"] == true {
                            json!([])
                        } else {
                            json!(p
                                .views
                                .iter()
                                .map(|view| {
                                    let mut value=json!({"name":view.name,"mode":view.mode,"scene":view.scene,"filter":view.filter,"camera":view.camera,"selected":view.selected.iter().take(1000).map(u64::to_string).collect::<Vec<_>>()});
                                    value["selected_count"] = json!(view.selected.len());
                                    value["selection_limited"] = json!(view.selected.len() > 1000);
                                    value
                                })
                                .collect::<Vec<_>>())
                        },
                    ),
                    (
                        "groups",
                        if args["compact"] == true {
                            json!([])
                        } else {
                            json!(p.groups.iter().map(|group|json!({"name":group.name,"ids":group.ids.iter().take(1000).map(u64::to_string).collect::<Vec<_>>(),"ids_count":group.ids.len(),"ids_limited":group.ids.len()>1000})).collect::<Vec<_>>())
                        },
                    ),
                    ("scene", json!(p.scene)),
                    ("field_roles", json!(p.field_roles)),
                    ("gis_layers", json!(p.gis_layers)),
                    ("workspace", json!(p.workspace)),
                    ("imports", json!(p.imports)),
                    ("time_resolution", json!(p.time_resolution)),
                    ("preferences", json!(s.preferences)),
                    ("lifecycle", self.workspace_status()?),
                    ("undo", json!(s.undo.len())),
                    ("redo", json!(s.redo.len())),
                ] {
                    v[k] = value;
                }
                if args["compact"].as_bool().unwrap_or(false) {
                    for k in [
                        "histogram",
                        "selected_histogram",
                        "views",
                        "groups",
                        "workspace",
                        "imports",
                    ] {
                        v.as_object_mut().unwrap().remove(k);
                    }
                }
                Ok(v)
            }
            "analysis_context" => {
                let s = self.state.lock().map_err(|_| "Workspace unavailable")?;
                let mut filter = s.project.filter.clone();
                let scope = args["scope"].as_str().unwrap_or("visible");
                if scope == "selected" {
                    filter.selected_only = true;
                }
                let table = s.store.ordered(&filter, None, "time", false)?;
                let sql = format!("SELECT COUNT(*),COUNT(e.lat),COUNT(DISTINCT CASE WHEN e.lat IS NOT NULL THEN e.entity END),MIN(e.time),MAX(e.time),SUM(CASE WHEN json_extract(e.payload,'$.location_kind')='polygon-centroid' THEN 1 ELSE 0 END) FROM {table} o JOIN events e ON e.r=o.r");
                let (count, located, entities, start, end, derived): (
                    u64,
                    u64,
                    u64,
                    Option<f64>,
                    Option<f64>,
                    u64,
                ) = s
                    .store
                    .connection
                    .query_row(&sql, [], |row| {
                        Ok((
                            row.get(0)?,
                            row.get(1)?,
                            row.get(2)?,
                            row.get(3)?,
                            row.get(4)?,
                            row.get::<_, Option<u64>>(5)?.unwrap_or(0),
                        ))
                    })
                    .map_err(|e| e.to_string())?;
                let sql = format!("SELECT COUNT(*),COALESCE(SUM(spatial),0) FROM (SELECT COUNT(e.lat)>=2 AND COUNT(DISTINCT CASE WHEN e.lat IS NOT NULL THEN e.time END)>=2 AS spatial FROM {table} o JOIN events e ON e.r=o.r GROUP BY e.entity HAVING COUNT(DISTINCT e.time)>=2)");
                let (tracks, spatial_tracks): (u64, u64) = s
                    .store
                    .connection
                    .query_row(&sql, [], |row| Ok((row.get(0)?, row.get(1)?)))
                    .map_err(|e| e.to_string())?;
                Ok(crate::analysis_assist::context(
                    s.revision,
                    scope,
                    count,
                    located,
                    entities,
                    tracks,
                    spatial_tracks,
                    derived,
                    start,
                    end,
                ))
            }
            "field_roles_set" => self.set_field_roles(args),
            "dataset_schema" => {
                let s = self.state.lock().map_err(|_| "Workspace unavailable")?;
                let search = args["attribute_search"]
                    .as_str()
                    .unwrap_or("")
                    .to_lowercase();
                let matching: Vec<_> = s
                    .store
                    .columns(None)?
                    .into_iter()
                    .filter(|name| name.to_lowercase().contains(&search))
                    .collect();
                let count = matching.len();
                let offset = args["attribute_offset"].as_u64().unwrap_or(0) as usize;
                let limit = args["attribute_limit"]
                    .as_u64()
                    .map(|n| n as usize)
                    .unwrap_or(count);
                let attributes: Vec<_> = matching.into_iter().skip(offset).take(limit).collect();
                let mut types = serde_json::Map::new();
                if args["include_attribute_types"].as_bool().unwrap_or(false) {
                    for name in &attributes {
                        crate::operation::check()?;
                        let (present, numeric): (u64, u64) = s
                            .store
                            .connection
                            .query_row(
                                "SELECT count(*),count(num) FROM attributes WHERE key=?",
                                [name],
                                |r| Ok((r.get(0)?, r.get(1)?)),
                            )
                            .map_err(|e| e.to_string())?;
                        types.insert(name.clone(),json!({"field":format!("attribute:{name}"),"kind":if numeric==present {"numeric"} else if numeric==0 {"text"} else {"mixed"},"present_count":present,"numeric_count":numeric}));
                    }
                }
                let next = offset.saturating_add(attributes.len());
                let numeric_counts: Value = if args["include_attribute_types"]
                    .as_bool()
                    .unwrap_or(false)
                {
                    s.store.connection.query_row("SELECT count(value),count(lat),count(lon),count(time),count(end),count(json_extract(payload,'$.altitude.meters')) FROM events", [], |r| {
                        Ok(json!({"value":r.get::<_,u64>(0)?,"lat":r.get::<_,u64>(1)?,"lon":r.get::<_,u64>(2)?,"time":r.get::<_,u64>(3)?,"end":r.get::<_,u64>(4)?,"altitude_m":r.get::<_,u64>(5)?}))
                    }).map_err(|e| e.to_string())?
                } else {
                    json!({})
                };
                Ok(
                    json!({"canonical":["id","entity","time","end","lat","lon","category","label","value","related_to","tags","note","source","source_row","mgrs_precision","geometry_wkt","location_kind","altitude_m","altitude_reference"],"numeric_fields":["value","lat","lon","time","end","altitude_m"],"numeric_counts":numeric_counts,"field_roles":s.project.field_roles.iter().filter(|(field,_)| !field.starts_with("attribute:") || attributes.iter().any(|name| field.strip_prefix("attribute:")==Some(name.as_str()))).collect::<BTreeMap<_,_>>(),"attribute_types":types,"attribute_types_scope":"entire dataset, irrespective of display filters; imported attributes remain strings; numeric means finite Rust f64 parsing, without inferred units","derived":{"time_utc":"read-only ISO 8601 UTC projection of time","year_utc":"read-only integer UTC calendar year of time"},"attributes":attributes,"attribute_count":count,"next_attribute_offset":if next<count {Some(next)} else {None},"attributes_limited":next<count,"id_type":"decimal string","time_type":"UTC Unix seconds including fractional seconds","coordinates":"WGS84 DD","null_location":"no point location; polygons may use explicitly derived surface centroids, labelled by location_kind","geometry":"OGC WKT, WGS84 X=longitude/Y=latitude; original Z/M retained, not used as height/time"}),
                )
            }
            "events" | "attribute_table" | "query" => {
                let s = self.state.lock().map_err(|_| "Workspace unavailable")?;
                let offset = args["offset"].as_u64().unwrap_or(0) as usize;
                let limit = args["limit"].as_u64().unwrap_or(100) as usize;
                let source = args["source"].as_str();
                let f = query_filter(&s.project, &args, command != "attribute_table")?;
                let cell = args
                    .get("display_cell")
                    .cloned()
                    .map(serde_json::from_value::<crate::display::Cell>)
                    .transpose()
                    .map_err(|e| e.to_string())?;
                let signature = serde_json::to_string(&(
                    s.store.identity(),
                    s.store.query_stamp(f.selected_only),
                    &f,
                    source,
                    args["sort_by"].as_str().unwrap_or("time"),
                    args["descending"].as_bool().unwrap_or(false),
                    &cell,
                    args["table_search"].as_str().unwrap_or(""),
                ))
                .map_err(|e| e.to_string())?;
                use sha2::Digest;
                let signature = format!("{:x}", sha2::Sha256::digest(signature.as_bytes()));
                let offset = if let Some(cursor) = args["cursor"].as_str() {
                    use base64::Engine;
                    let bytes = base64::engine::general_purpose::URL_SAFE_NO_PAD
                        .decode(cursor)
                        .map_err(|_| "Invalid cursor")?;
                    let c: Value = serde_json::from_slice(&bytes).map_err(|_| "Invalid cursor")?;
                    if c["signature"] != signature {
                        return Err("CONFLICT: cursor is stale or query changed".into());
                    }
                    c["offset"].as_u64().ok_or("Invalid cursor")? as usize
                } else {
                    offset
                };
                let table = s.store.ordered_table(
                    &f,
                    source,
                    args["sort_by"].as_str().unwrap_or("time"),
                    args["descending"].as_bool().unwrap_or(false),
                    cell.as_ref(),
                    args["table_search"].as_str().unwrap_or(""),
                )?;
                let located = args["reveal_id"]
                    .as_str()
                    .map(|id| {
                        s.store
                            .table_offset(&table, id.parse().map_err(|_| "Invalid reveal ID")?)
                    })
                    .transpose()?;
                if args.get("reveal_id").is_some()
                    && (args.get("cursor").is_some() || args.get("id").is_some())
                {
                    return Err("Choose reveal_id or cursor/id, not both".into());
                }
                let offset = located
                    .flatten()
                    .map(|rank| rank / limit * limit)
                    .unwrap_or(offset);
                let count = s.store.table_count(&table)?;
                let columns = if command == "attribute_table" {
                    s.store.columns(source)?
                } else {
                    vec![]
                };
                let limited = columns.len() > 512;
                let canonical = [
                    "id",
                    "entity",
                    "time",
                    "end",
                    "lat",
                    "lon",
                    "category",
                    "label",
                    "value",
                    "related_to",
                    "tags",
                    "note",
                    "source",
                    "source_row",
                    "mgrs_precision",
                    "geometry_wkt",
                    "location_kind",
                    "altitude_m",
                    "altitude_reference",
                ];
                let columns: Vec<_> = canonical
                    .into_iter()
                    .map(str::to_owned)
                    .chain(
                        columns
                            .into_iter()
                            .take(512)
                            .map(|k| format!("attribute:{k}")),
                    )
                    .collect();
                let total_columns = columns.len();
                let column_offset = args["column_offset"].as_u64().unwrap_or(0) as usize;
                let windowed = command == "attribute_table" && args.get("column_limit").is_some();
                let columns = if windowed {
                    columns
                        .into_iter()
                        .skip(column_offset)
                        .take(args["column_limit"].as_u64().unwrap() as usize)
                        .collect::<Vec<_>>()
                } else {
                    columns
                };
                let mut request_fields = args.get("fields").and_then(Value::as_array).cloned();
                if windowed {
                    if request_fields.is_some() {
                        return Err("Choose fields or a column window, not both".into());
                    }
                    let mut names = vec![json!("id")];
                    for name in &columns {
                        if name != "id" {
                            names.push(json!(name));
                        }
                    }
                    request_fields = Some(names);
                }
                let fast_fields = request_fields.as_deref().filter(|fields| {
                    !args["id"].is_string() && !fields.iter().any(|v| v == "coordinate_formats")
                });
                let events = if let Some(fields) = fast_fields {
                    s.store.projected_page(&table, offset, limit, fields)?
                } else {
                    let rows = if let Some(id) = args["id"].as_str() {
                        s.store
                            .get(id.parse().map_err(|_| "Invalid ID")?)?
                            .into_iter()
                            .collect()
                    } else {
                        s.store.page_bounded(&table, offset, limit)?
                    };
                    let mut events = vec![];
                    for e in rows {
                        let mut v = crate::store::event_json(&e);
                        if command == "events" {
                            if let Some((latitude, longitude)) = e.location() {
                                let mut formats =
                                    coordinates::convert(coordinates::Coordinate::Dd {
                                        latitude,
                                        longitude,
                                    })?;
                                if let Some(precision) = e.mgrs_precision {
                                    formats.mgrs =
                                        coordinates::format_mgrs(latitude, longitude, precision)?;
                                    formats.mgrs_precision = precision;
                                    formats.mgrs_cell_size_m =
                                        Some(10f64.powi(5 - i32::from(precision)));
                                }
                                v["coordinate_formats"] = json!(formats)
                            }
                        }
                        if let Some(fields) = request_fields.as_ref() {
                            let mut projection = serde_json::Map::new();
                            for field in fields {
                                let field = field.as_str().unwrap();
                                if let Some(key) = field.strip_prefix("attribute:") {
                                    projection.insert(field.into(), v["attrs"][key].clone());
                                } else if field == "time_utc" {
                                    projection.insert(
                                        field.into(),
                                        json!(crate::timestamps::utc_time(e.time)),
                                    );
                                } else if field == "year_utc" {
                                    projection.insert(
                                        field.into(),
                                        json!(crate::timestamps::utc_year(e.time)),
                                    );
                                } else if let Some(value) = v.get(field) {
                                    projection.insert(field.into(), value.clone());
                                } else if field == "coordinate_formats" {
                                    projection.insert(field.into(), Value::Null);
                                } else {
                                    return Err(format!("Unknown projection field: {field}"));
                                }
                            }
                            v = Value::Object(projection)
                        }
                        events.push(v)
                    }
                    events
                };
                use base64::Engine;
                let count = if args["id"].is_string() {
                    events.len()
                } else {
                    count
                };
                let next = if !args["id"].is_string() && offset + events.len() < count {
                    Some(base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(
                        json!({"signature":signature,"offset":offset+events.len()}).to_string(),
                    ))
                } else {
                    None
                };
                Ok(
                    json!({"events":events,"count":count,"offset":offset,"limit":limit,"reveal_found":located.map(|rank| rank.is_some()),"next_cursor":next,"columns":columns,"columns_limited":limited,"total_columns":total_columns,"column_offset":column_offset,"source":source,"apply_filter":args["apply_filter"].as_bool().unwrap_or(command!="attribute_table")}),
                )
            }
            "space_time_aggregate" | "aggregate_apply" => {
                let mut s = self.state.lock().map_err(|_| "Workspace unavailable")?;
                let options: crate::aggregation::Options = arg(&args, "aggregation")?;
                let mut accumulator =
                    crate::aggregation::Accumulator::new(&self.data_dir, options.clone())?;
                let table = s.store.ordered(
                    &query_filter(&s.project, &args, true)?,
                    args["source"].as_str(),
                    "time",
                    false,
                )?;
                let mut query = s
                    .store
                    .connection
                    .prepare(&format!(
                        "SELECT e.payload FROM {table} o JOIN events e ON e.r=o.r ORDER BY o.pos"
                    ))
                    .map_err(|e| e.to_string())?;
                let mut rows = query.query([]).map_err(|e| e.to_string())?;
                while let Some(row) = rows.next().map_err(|e| e.to_string())? {
                    let text: String = row.get(0).map_err(|e| e.to_string())?;
                    let event: Event = serde_json::from_str(&text).map_err(|e| e.to_string())?;
                    accumulator.push(&event)?;
                }
                drop(rows);
                drop(query);
                if command == "space_time_aggregate" {
                    return accumulator.preview(args["limit"].as_u64().unwrap_or(100) as usize);
                }
                let staged = crate::store::DataStore::new(&self.data_dir)?;
                let retained = accumulator.write(&staged)?;
                staged.checkpoint()?;
                let scene = s.project.scene.clone();
                let mut provenance = s.project.provenance.clone();
                for credit in &mut provenance {
                    credit.changes.push_str(&format!("; Chronoscope anchored space/time aggregation: window_minutes={}, radius_m={}, input_count={}, retained={}", options.window_minutes, options.radius_m, accumulator.input_count, retained));
                }
                let mut derived = Project::new(Dataset {
                    name: format!("{} (aggregated)", s.project.dataset.name),
                    events: vec![],
                });
                derived.scene = scene;
                derived.provenance = provenance;
                derived.validate()?;
                let old = std::mem::replace(&mut s.store, staged);
                s.previous_store = Some(old);
                s.project = derived;
                Ok(
                    json!({"input_count":accumulator.input_count,"retained":retained,"aggregated":accumulator.input_count-retained,"undoable":true}),
                )
            }
            "aggregate" => {
                let s = self.state.lock().map_err(|_| "Workspace unavailable")?;
                s.store.aggregate(
                    &query_filter(&s.project, &args, true)?,
                    args["source"].as_str(),
                    args["group_by"].as_str().unwrap_or("entity"),
                    args["field"].as_str().unwrap_or("value"),
                    args["limit"].as_u64().unwrap_or(100) as usize,
                )
            }
            "statistics" => {
                let s = self.state.lock().map_err(|_| "Workspace unavailable")?;
                let report = s.store.statistics(
                    &query_filter(&s.project, &args, true)?,
                    args["source"].as_str(),
                    args["field"].as_str().unwrap_or("value"),
                    args["other_field"].as_str(),
                )?;
                serde_json::to_value(report).map_err(|e| e.to_string())
            }
            "time_parse" => {
                let order = match args["date_order"].as_str().unwrap_or("auto") {
                    "dmy" => crate::timestamps::DateOrder::Dmy,
                    "mdy" => crate::timestamps::DateOrder::Mdy,
                    _ => crate::timestamps::DateOrder::Auto,
                };
                let epoch = crate::timestamps::parse(
                    args["value"].as_str().unwrap(),
                    &crate::timestamps::Options {
                        order,
                        offset_minutes: args["timezone_offset_minutes"].as_i64().unwrap_or(0)
                            as i32,
                        ..Default::default()
                    },
                )?;
                Ok(
                    json!({"epoch":epoch,"time_utc":crate::timestamps::utc_time(epoch),"year_utc":crate::timestamps::utc_year(epoch),"precision":"fractional_second"}),
                )
            }
            "render_geometries" => {
                let s = self.state.lock().map_err(|_| "Workspace unavailable")?;
                let f = query_filter(&s.project, &args, true)?;
                let viewport = viewport_bounds(&args)?;
                let table = s.store.ordered_with_bounds(
                    &f,
                    args["source"].as_str(),
                    "time",
                    false,
                    viewport.as_ref(),
                )?;
                let latest = s
                    .project
                    .scene
                    .measurement
                    .as_ref()
                    .is_some_and(|m| m.latest_per_entity);
                let cte = format!("WITH visible_shapes AS (SELECT e.id,e.id_key,e.entity,e.time,e.geometry_wkt,e.value,o.pos,ROW_NUMBER() OVER (PARTITION BY e.entity ORDER BY e.time DESC,e.id_key DESC) AS recency FROM {table} o JOIN events e ON e.r=o.r WHERE e.geometry_wkt IS NOT NULL AND (e.lat IS NULL OR json_extract(e.payload,'$.location_kind')='polygon-centroid'))");
                let condition = if latest { "WHERE recency=1" } else { "" };
                let count: usize = s
                    .store
                    .connection
                    .query_row(
                        &format!("{cte} SELECT count(*) FROM visible_shapes {condition}"),
                        [],
                        |r| r.get(0),
                    )
                    .map_err(|e| e.to_string())?;
                let offset = args["offset"].as_u64().unwrap_or(0) as usize;
                let limit = args["limit"].as_u64().unwrap_or(500) as usize;
                let budget = args["max_vertices"].as_u64().unwrap_or(20000) as usize;
                let mut query = s.store.connection.prepare(&format!("{cte} SELECT id,entity,time,geometry_wkt,value FROM visible_shapes {condition} ORDER BY pos LIMIT ? OFFSET ?")).map_err(|e| e.to_string())?;
                let mut rows = query
                    .query(rusqlite::params![limit, offset])
                    .map_err(|e| e.to_string())?;
                let mut features = vec![];
                let mut vertices = 0;
                let mut bounds: Option<[f64; 4]> = None;
                while let Some(row) = rows.next().map_err(|e| e.to_string())? {
                    crate::operation::check()?;
                    let text: String = row.get(3).map_err(|e| e.to_string())?;
                    let shape = crate::geometry::parse(&text)?;
                    if vertices + shape.vertex_count > budget {
                        break;
                    }
                    vertices += shape.vertex_count;
                    if let Some(b) = shape.bounds {
                        if let Some(bounds) = bounds.as_mut() {
                            bounds[0] = bounds[0].min(b[0]);
                            bounds[1] = bounds[1].min(b[1]);
                            bounds[2] = bounds[2].max(b[2]);
                            bounds[3] = bounds[3].max(b[3]);
                        } else {
                            bounds = Some(b)
                        }
                    }
                    features.push(crate::api::GeometryFeature {
                        id: row.get(0).map_err(|e| e.to_string())?,
                        entity: row.get(1).map_err(|e| e.to_string())?,
                        time: row.get(2).map_err(|e| e.to_string())?,
                        value: row.get(4).map_err(|e| e.to_string())?,
                        shape,
                    });
                }
                serde_json::to_value(crate::api::GeometryPacket{limited:offset+features.len()<count,features,count,offset,vertex_count:vertices,bounds,revision:s.revision,semantics:"WGS84 X/Y geometry; Z/M preserved in source WKT, not used as altitude/time. Polygon rings include holes.".into()}).map_err(|e|e.to_string())
            }
            "display_data" => {
                let s = self.state.lock().map_err(|_| "Workspace unavailable")?;
                let mut viewport = viewport_bounds(&args)?;
                if args["flat"] == true {
                    if let Some(bounds) = &mut viewport {
                        bounds.south = bounds.south.max(-85.0511287798066);
                        bounds.north = bounds.north.min(85.0511287798066);
                    } else {
                        viewport = Some(crate::model::GeoBounds {
                            south: -85.0511287798066,
                            north: 85.0511287798066,
                            west: -180.,
                            east: 180.,
                        });
                    }
                }
                let mut packet = s.store.display_grid(
                    &s.project.filter,
                    viewport.as_ref(),
                    crate::display::GridRequest {
                        level: args["level"].as_u64().unwrap_or(4) as u8,
                        minutes: args["time_bin_minutes"].as_i64().unwrap_or(0),
                        partition: args["partition"].as_str().unwrap_or("all"),
                        weight: args["weight"].as_str().unwrap_or("count"),
                        limit: args["max_cells"].as_u64().unwrap_or(4000) as usize,
                    },
                )?;
                packet.revision = s.revision;
                serde_json::to_value(packet).map_err(|e| e.to_string())
            }
            "render_data" => {
                let s = self.state.lock().map_err(|_| "Workspace unavailable")?;
                let budget = args["max_points"].as_u64().unwrap_or(20000) as usize;
                let mut f = s.project.filter.clone();
                if args["selected_only"].as_bool().unwrap_or(false) {
                    f.selected_only = true
                }
                let viewport = viewport_bounds(&args)?;
                let altitude_mode =
                    s.project.scene.mode == "globe" && s.project.scene.globe_altitude;
                if altitude_mode {
                    f.predicates.push(crate::model::Predicate {
                        field: "altitude_m".into(),
                        op: crate::model::Operator::Greater,
                        value: "-12001".into(),
                    });
                    f.predicates.push(crate::model::Predicate {
                        field: "altitude_reference".into(),
                        op: crate::model::Operator::NotEquals,
                        value: "unspecified".into(),
                    });
                }
                let (mut rows, count) = s.store.render_viewport(&f, budget, viewport.as_ref())?;
                let mut selected_located_count = if f.selected_only {
                    count
                } else if rows.len() == count {
                    rows.iter()
                        .filter(|e| s.project.selected.contains(&e.id))
                        .count()
                } else {
                    0
                };
                if rows.len() < count && !f.selected_only && !s.project.selected.is_empty() {
                    let mut selected_filter = f.clone();
                    selected_filter.selected_only = true;
                    let reserve = (budget / 4).clamp(1, 5000);
                    let (selected_rows, selected_count) =
                        s.store
                            .render_viewport(&selected_filter, reserve, viewport.as_ref())?;
                    selected_located_count = selected_count;
                    let ids: BTreeSet<_> = selected_rows.iter().map(|e| e.id).collect();
                    rows = rows
                        .into_iter()
                        .filter(|e| !ids.contains(&e.id))
                        .take(budget.saturating_sub(selected_rows.len()))
                        .chain(selected_rows)
                        .collect();
                }
                let inferred_filter = if args["include_time_only"] == true && !altitude_mode {
                    &s.project.filter
                } else {
                    &f
                };
                let (mut inferred, unlocated_count, inferred_metadata) = s.store.inferred_markers(
                    inferred_filter,
                    if count < budget {
                        budget - count
                    } else {
                        (budget / 4).clamp(2, 5000)
                    },
                )?;
                if altitude_mode {
                    inferred.clear();
                }
                if let Some(viewport) = &viewport {
                    inferred.retain(|e| {
                        e.location()
                            .is_some_and(|(lat, lon)| viewport.contains(lat, lon))
                    });
                }
                let inferred_ids: BTreeSet<_> = inferred.iter().map(|e| e.id).collect();
                if !inferred.is_empty() {
                    // Keep selected evidence when reserving space for time-only markers.
                    rows.sort_by_key(|e| !s.project.selected.contains(&e.id));
                    rows.truncate(budget.saturating_sub(inferred.len()));
                    rows.extend(inferred);
                }
                if rows.iter().any(|e| e.location().is_none()) {
                    return Err("Event payload does not match its location index".into());
                }
                rows.sort_by(|a, b| {
                    a.entity
                        .cmp(&b.entity)
                        .then(a.time.total_cmp(&b.time))
                        .then(a.id.cmp(&b.id))
                });
                let names: Vec<_> = rows
                    .iter()
                    .map(|e| e.entity.clone())
                    .collect::<BTreeSet<_>>()
                    .into_iter()
                    .collect();
                let stride = if rows.iter().any(|e| e.altitude.is_some()) {
                    48
                } else {
                    32
                };
                let mut bytes = Vec::with_capacity(rows.len() * stride);
                let mut ids = vec![];
                let mut centroid_ids = vec![];
                for e in rows {
                    if e.location_kind.as_deref() == Some("polygon-centroid") {
                        centroid_ids.push(e.id.to_string());
                    }
                    bytes.extend_from_slice(&e.lon.unwrap().to_le_bytes());
                    bytes.extend_from_slice(&e.lat.unwrap().to_le_bytes());
                    bytes.extend_from_slice(&e.time.to_le_bytes());
                    bytes.extend_from_slice(
                        &(names.binary_search(&e.entity).unwrap() as u32).to_le_bytes(),
                    );
                    bytes.extend_from_slice(&(e.value.unwrap_or(1.) as f32).to_le_bytes());
                    if stride == 48 {
                        bytes.extend_from_slice(
                            &e.altitude
                                .map(|a| a.meters)
                                .unwrap_or(f64::NAN)
                                .to_le_bytes(),
                        );
                        bytes.push(e.altitude.map(|a| a.reference.code()).unwrap_or(0));
                        bytes.extend_from_slice(&[0; 7]);
                    }
                    ids.push(e.id.to_string())
                }
                use base64::Engine;
                serde_json::to_value(crate::api::PackedRender {
                    revision: s.revision,
                    stride,
                    data: base64::engine::general_purpose::STANDARD.encode(bytes),
                    rendered_count: ids.len(),
                    ids,
                    entities: names,
                    located_count: count,
                    unlocated_count,
                    inferred_ids: inferred_ids.iter().map(u64::to_string).collect(),
                    inferred_markers: inferred_metadata,
                    centroid_ids,
                    lod: count + unlocated_count > budget,
                    max_points: budget,
                    sampling: "uniform time-order representatives plus selected evidence".into(),
                    selected_located_count,
                    time_bounds: s.store.time_bounds()?,
                })
                .map_err(|e| e.to_string())
            }
            "selection_pick" => {
                let selected = self
                    .state
                    .lock()
                    .map_err(|_| "Workspace unavailable")?
                    .project
                    .selected
                    .clone();
                let mut result = self.invoke_raw("select", args)?;
                let mut s = self.state.lock().map_err(|_| "Workspace unavailable")?;
                let revision = s.revision + 1;
                s.pick_restore = Some(PickRestore {
                    revision,
                    workspace: self.workspace_identity_locked(&s),
                    selection_version: s.store.selection_version(),
                    data_version: s.store.query_stamp(true).0,
                    expires: std::time::Instant::now() + std::time::Duration::from_secs(5),
                    selected,
                });
                result["pick_revision"] = json!(revision);
                Ok(result)
            }
            "selection_restore" => {
                let mut s = self.state.lock().map_err(|_| "Workspace unavailable")?;
                let revision: u64 = arg(&args, "pick_revision")?;
                self.validate_pick_restore(&s, revision)?;
                s.project.selected = s.pick_restore.take().unwrap().selected;
                let selected = s.project.selected.clone();
                s.store.selection_changed(&selected)?;
                Ok(json!({"selected":selected.len()}))
            }
            "select" | "select_visible" | "select_query" => {
                let mut s = self.state.lock().map_err(|_| "Workspace unavailable")?;
                let ids: BTreeSet<u64> = if command == "select" {
                    let ids: Vec<String> = arg(&args, "ids")?;
                    let ids = ids
                        .iter()
                        .map(|id| id.parse().map_err(|_| "Invalid event ID"))
                        .collect::<Result<BTreeSet<_>, _>>()?;
                    for id in &ids {
                        if s.store.get(*id)?.is_none() {
                            return Err("Selection refers to missing events".into());
                        }
                    }
                    ids
                } else if let Some(ids) = args["_chart_ids"].as_array() {
                    ids.iter()
                        .map(|v| {
                            v.as_str()
                                .unwrap()
                                .parse::<u64>()
                                .map_err(|e| e.to_string())
                        })
                        .collect::<Result<_, _>>()?
                } else if let Some(range) = args.get("table_range") {
                    if args.get("display_cells").is_some() {
                        return Err("INVALID_ARGUMENT: choose table_range or display_cells".into());
                    }
                    let f = query_filter(&s.project, &args, true)?;
                    let cell = args
                        .get("display_cell")
                        .cloned()
                        .map(serde_json::from_value::<crate::display::Cell>)
                        .transpose()
                        .map_err(|e| e.to_string())?;
                    let table = s.store.ordered_table(
                        &f,
                        args["source"].as_str(),
                        range["sort_by"].as_str().unwrap_or("time"),
                        range["descending"].as_bool().unwrap_or(false),
                        cell.as_ref(),
                        args["table_search"].as_str().unwrap_or(""),
                    )?;
                    let parse = |key: &str| {
                        range[key]
                            .as_str()
                            .ok_or("Missing range ID")?
                            .parse::<u64>()
                            .map_err(|_| "Invalid range ID")
                    };
                    s.store
                        .table_range_ids(&table, parse("anchor")?, parse("target")?)?
                        .into_iter()
                        .collect()
                } else if let Some(cells) = args.get("display_cells") {
                    if args.get("display_cell").is_some() {
                        return Err("INVALID_ARGUMENT: choose display_cell or display_cells".into());
                    }
                    let cells: Vec<crate::display::Cell> =
                        serde_json::from_value(cells.clone()).map_err(|e| e.to_string())?;
                    let f = query_filter(&s.project, &args, true)?;
                    s.store
                        .display_members(&f, args["source"].as_str(), &cells)?
                } else {
                    let mut f = query_filter(&s.project, &args, true)?;
                    if let Some(entity) = args["entity"].as_str() {
                        f.predicates.push(Predicate {
                            field: "entity".into(),
                            op: Operator::Equals,
                            value: entity.into(),
                        })
                    }
                    let cell = args
                        .get("display_cell")
                        .cloned()
                        .map(serde_json::from_value::<crate::display::Cell>)
                        .transpose()
                        .map_err(|e| e.to_string())?;
                    let table = s.store.ordered_table(
                        &f,
                        args["source"].as_str(),
                        "time",
                        false,
                        cell.as_ref(),
                        args["table_search"].as_str().unwrap_or(""),
                    )?;
                    if let Some(bin) = args["bin"].as_u64() {
                        let (lo, hi) = s.store.time_bounds()?;
                        let mut ids = BTreeSet::new();
                        let count = s.store.table_count(&table)?;
                        for offset in (0..count).step_by(1000) {
                            for e in s.store.page(&table, offset, 1000)? {
                                if (((e.time - lo) / (hi - lo) * 100.).floor() as u64).min(99)
                                    == bin
                                {
                                    ids.insert(e.id);
                                }
                            }
                        }
                        ids
                    } else {
                        s.store.ids(&table)?.into_iter().collect()
                    }
                };
                match args["mode"].as_str().unwrap_or("replace") {
                    "replace" => s.project.selected = ids,
                    "add" => s.project.selected.extend(ids),
                    "subtract" => s.project.selected.retain(|id| !ids.contains(id)),
                    "toggle" => {
                        for id in ids {
                            if !s.project.selected.insert(id) {
                                s.project.selected.remove(&id);
                            }
                        }
                    }
                    _ => return Err("Unknown selection mode".into()),
                }
                let selected = s.project.selected.clone();
                s.store.selection_changed(&selected)?;
                s.pick_restore = None;
                Ok(json!({"selected":s.project.selected.len()}))
            }
            "filter" => {
                let f: Filter = arg(&args, "filter")?;
                let mut p = Project::new(Dataset::default());
                p.filter = f.clone();
                p.validate()?;
                let mut state = self.state.lock().map_err(|_| "Workspace unavailable")?;
                for field in f.facet_fields.values() {
                    if let Some(key) = field.strip_prefix("attribute:") {
                        let exists: bool = state
                            .store
                            .connection
                            .query_row(
                                "SELECT EXISTS(SELECT 1 FROM attributes WHERE key=?)",
                                [key],
                                |r| r.get(0),
                            )
                            .map_err(|e| e.to_string())?;
                        if !exists {
                            return Err(format!("INVALID_ARGUMENT: unknown sidebar field {field:?}; inspect dataset_schema"));
                        }
                    }
                }
                state.project.filter = f;
                Ok(json!({"ok":true}))
            }
            "import_preview"
            | "gis_import_preview"
            | "import_validate"
            | "import_commit"
            | "import_review"
            | "import_rejections_export" => self.import_invoke(command, args),
            "demo_catalog" => Ok(json!({"demos":crate::demos::DEMOS})),
            "demo_open" => {
                let mut project = crate::demos::load(&arg::<String>(&args, "id")?, &self.data_dir)?;
                let mut store = crate::store::DataStore::new(&self.data_dir)?;
                store.load_events(std::mem::take(&mut project.dataset.events))?;
                let mut s = self.state.lock().map_err(|_| "Workspace unavailable")?;
                let old = std::mem::replace(&mut s.store, store);
                s.previous_store = Some(old);
                s.project = project;
                s.pending.clear();
                Ok(json!({"ok":true,"scene":s.project.scene,"missing_resources":[]}))
            }
            "demo" => {
                let mut s = self.state.lock().map_err(|_| "Workspace unavailable")?;
                let mut project = Project::new(crate::demo::dataset());
                let mut store = crate::store::DataStore::new(&self.data_dir)?;
                store.load_events(std::mem::take(&mut project.dataset.events))?;
                let old = std::mem::replace(&mut s.store, store);
                s.previous_store = Some(old);
                s.project = project;
                Ok(json!({"ok":true}))
            }
            "analyze" => {
                let pattern: Pattern = arg(&args, "pattern")?;
                let parameters = args
                    .get("parameters")
                    .map(|v| {
                        serde_json::from_value::<Parameters>(v.clone()).map_err(|e| e.to_string())
                    })
                    .transpose()?
                    .unwrap_or_default();
                let (mut events, count, revision) = {
                    let s = self.state.lock().map_err(|_| "Workspace unavailable")?;
                    let f = query_filter(&s.project, &args, true)?;
                    let table = s.store.ordered(&f, None, "time", false)?;
                    let count = s.store.table_count(&table)?;
                    let cap = args["max_events"].as_u64().unwrap_or(200000) as usize;
                    (
                        s.store.compact_page(&table, 0, count.min(cap))?,
                        count,
                        s.revision,
                    )
                };
                for e in &mut events {
                    e.attrs.clear();
                    e.note.clear();
                }
                let report = analysis::run(&events, pattern, &parameters);
                let limit = args["limit"].as_u64().unwrap_or(100) as usize;
                let offset = args["offset"].as_u64().unwrap_or(0) as usize;
                let findings:Vec<_>=report.findings.iter().skip(offset).take(limit).map(|f|json!({"ids":f.ids.iter().take(10000).map(u64::to_string).collect::<Vec<_>>(),"ids_count":f.ids.len(),"ids_limited":f.ids.len()>10000,"summary":f.summary,"metric":f.metric})).collect();
                Ok(
                    json!({"revision":revision,"count":report.findings.len(),"limited":report.limited||events.len()<count,"input_count":count,"evaluated_count":events.len(),"candidate_visits":report.candidate_visits,"input_limited":events.len()<count,"offset":offset,"limit":limit,"findings":findings}),
                )
            }
            "edit" | "edit_many" | "reassign" | "tag" | "assist_tags_apply" | "delete" => {
                let mut s = self.state.lock().map_err(|_| "Workspace unavailable")?;
                let ids: Vec<u64> = if command == "edit" {
                    vec![args["id"]
                        .as_str()
                        .unwrap()
                        .parse()
                        .map_err(|_| "Invalid ID")?]
                } else if command == "edit_many" {
                    arg::<Vec<String>>(&args, "ids")?
                        .iter()
                        .map(|id| id.parse().map_err(|_| "Invalid ID"))
                        .collect::<Result<_, _>>()?
                } else if command == "assist_tags_apply" {
                    let mut ids = BTreeSet::new();
                    for item in args["items"].as_array().unwrap() {
                        let id = item["id"]
                            .as_str()
                            .unwrap()
                            .parse()
                            .map_err(|_| "Invalid Event ID")?;
                        if !ids.insert(id) {
                            return Err("INVALID_ARGUMENT: duplicate Event IDs".into());
                        }
                        crate::si::features::clean_tags(&item["tags"])?;
                    }
                    ids.into_iter().collect()
                } else {
                    s.project.selected.iter().copied().collect()
                };
                if ids.is_empty() {
                    return Err("Select events first".into());
                }
                let text = args["value"].as_str().unwrap_or("").trim();
                if matches!(command, "reassign" | "tag") && text.is_empty() {
                    return Err("Provide a nonempty value".into());
                }
                for &id in &ids {
                    let old = s.store.get(id)?.ok_or("Event not found")?;
                    if command == "delete" {
                        s.store.delete(id)?;
                    } else {
                        let mut next = old.clone();
                        if command == "reassign" {
                            next.entity = text.into()
                        } else if command == "tag" {
                            next.tags.insert(text.into());
                        } else if command == "assist_tags_apply" {
                            let item = args["items"]
                                .as_array()
                                .unwrap()
                                .iter()
                                .find(|item| {
                                    item["id"].as_str().and_then(|id| id.parse::<u64>().ok())
                                        == Some(id)
                                })
                                .unwrap();
                            for tag in crate::si::features::clean_tags(&item["tags"])? {
                                if !next.tags.iter().any(|old| old.to_lowercase() == tag) {
                                    next.tags.insert(tag);
                                }
                            }
                        } else {
                            let mut value =
                                serde_json::to_value(&old).map_err(|e| e.to_string())?;
                            for (k, v) in args["changes"].as_object().unwrap() {
                                value[k] = v.clone()
                            }
                            next = serde_json::from_value(value).map_err(|e| e.to_string())?;
                            if args["changes"].get("geometry_wkt").is_some() {
                                if let Some(text) = &next.geometry_wkt {
                                    let shape = crate::geometry::parse(text)?;
                                    if shape.kind == "Point" && shape.points.len() == 1 {
                                        next.lon = Some(shape.points[0][0]);
                                        next.lat = Some(shape.points[0][1]);
                                    } else {
                                        next.lon = None;
                                        next.lat = None;
                                    }
                                }
                            } else if next.lat != old.lat || next.lon != old.lon {
                                next.geometry_wkt = None;
                            }
                            if args["changes"].get("geometry_wkt").is_some() {
                                next.location_kind = None;
                                next.derive_polygon_centroid()?;
                            } else if next.geometry_wkt.is_none() {
                                next.location_kind = None;
                            }
                            if next.lat != old.lat || next.lon != old.lon {
                                next.mgrs_precision = None
                            }
                        }
                        next.validate()?;
                        s.store.insert(&next)?;
                    }
                }
                if command == "delete" {
                    let deleted: BTreeSet<_> = ids.iter().copied().collect();
                    s.project.selected.retain(|id| !deleted.contains(id));
                    for v in &mut s.project.views {
                        v.selected.retain(|id| !deleted.contains(id));
                    }
                    for g in &mut s.project.groups {
                        g.ids.retain(|id| !deleted.contains(id));
                    }
                }
                s.store.changed()?;
                Ok(json!({"ok":true,"changed":ids.len()}))
            }
            "undo" | "redo" => {
                let mut s = self.state.lock().map_err(|_| "Workspace unavailable")?;
                let undo = command == "undo";
                let mut history =
                    if undo { s.undo.pop() } else { s.redo.pop() }.ok_or("History is empty")?;
                if let Some(store) = history.replacement.take() {
                    history.replacement = Some(std::mem::replace(&mut s.store, store));
                    self.document_epoch
                        .fetch_add(1, std::sync::atomic::Ordering::AcqRel);
                } else if let Err(e) = if history.store_id == s.store.identity() {
                    s.store.replay_history(history.seq, undo)
                } else {
                    Err("UNAVAILABLE: history references another working database".into())
                } {
                    if undo {
                        s.undo.push(history)
                    } else {
                        s.redo.push(history)
                    }
                    return Err(e);
                }
                s.project = if undo {
                    history.before.clone()
                } else {
                    history.after.clone()
                };
                s.preferences = if undo {
                    history.before_preferences.clone()
                } else {
                    history.after_preferences.clone()
                };
                *self.terrain.lock().map_err(|_| "Terrain unavailable")? =
                    TerrainCatalog::from_preferences(&s.preferences)
                        .ok()
                        .flatten();
                if undo {
                    s.redo.push(history)
                } else {
                    s.undo.push(history)
                }
                Ok(json!({"ok":true,"scene":s.project.scene}))
            }
            "save_view" | "save_group" => {
                let name: String = arg(&args, "name")?;
                if name.trim().is_empty() {
                    return Err("Provide a name".into());
                }
                let mut s = self.state.lock().map_err(|_| "Workspace unavailable")?;
                if s.project.views.len() >= 200 || s.project.groups.len() >= 500 {
                    return Err("Saved context limit reached".into());
                }
                let p = &s.project;
                if command == "save_group" {
                    let group = Group {
                        name,
                        ids: p.selected.clone(),
                    };
                    s.project.groups.push(group);
                } else {
                    let scene = args
                        .get("scene")
                        .map(|v| {
                            serde_json::from_value::<SceneState>(v.clone())
                                .map_err(|e| e.to_string())
                        })
                        .transpose()?
                        .unwrap_or_else(|| p.scene.clone());
                    scene.validate()?;
                    let view = SavedView {
                        name,
                        scene,
                        mode: p.mode,
                        filter: p.filter.clone(),
                        selected: p.selected.clone(),
                        camera: p.camera.clone(),
                    };
                    s.project.views.push(view);
                }
                Ok(json!({"ok":true}))
            }
            "restore_view" | "restore_group" => {
                let index: usize = arg(&args, "index")?;
                let mut s = self.state.lock().map_err(|_| "Workspace unavailable")?;
                if command == "restore_group" {
                    s.project.selected = s
                        .project
                        .groups
                        .get(index)
                        .ok_or("Group not found")?
                        .ids
                        .clone();
                } else {
                    let v = s.project.views.get(index).ok_or("View not found")?.clone();
                    s.project.filter = v.filter;
                    s.project.selected = v.selected;
                    s.project.camera = v.camera;
                    s.project.mode = v.mode;
                    s.project.scene = v.scene;
                }
                s.pick_restore = None;
                Ok(json!({"ok":true,"scene":s.project.scene}))
            }
            "scene_sync" | "view_set" => {
                let mut s = self.state.lock().map_err(|_| "Workspace unavailable")?;
                if command == "view_set"
                    && args["globe_time"] == true
                    && args["globe_altitude"] == true
                {
                    return Err("Time Height and Altitude cannot both be enabled".into());
                }
                if command == "scene_sync" {
                    let scene: SceneState = arg(&args, "scene")?;
                    scene.validate()?;
                    s.project.scene = scene;
                } else {
                    let scene = &mut s.project.scene;
                    for (k, v) in args.as_object().unwrap() {
                        match k.as_str() {
                            "mode" if scene.mode != v.as_str().unwrap() => {
                                scene.mode = v.as_str().unwrap().into();
                                scene.cesium_camera = None;
                                scene.position = None;
                                scene.target = None;
                                scene.camera_up = None;
                            }
                            "time_height" => scene.time_height = v.as_f64(),
                            "playback_fade" => scene.playback_fade = v.as_bool(),
                            "playback_fade_amount" => {
                                scene.playback_fade_amount = v.as_u64().map(|v| v as u8)
                            }
                            "globe_time" => {
                                scene.globe_time = v.as_bool().unwrap();
                                if scene.globe_time {
                                    scene.globe_altitude = false;
                                }
                            }
                            "globe_altitude" => {
                                scene.globe_altitude = v.as_bool().unwrap();
                                if scene.globe_altitude {
                                    scene.globe_time = false;
                                }
                            }
                            "globe_time_scale" => scene.globe_time_scale = v.as_f64(),
                            "render_budget" => scene.render_budget = v.as_u64().map(|v| v as usize),
                            "entity_colors" => {
                                scene.entity_colors =
                                    serde_json::from_value(v.clone()).map_err(|e| e.to_string())?;
                            }
                            "chart" => {
                                if v.is_null() {
                                    scene.chart = None;
                                } else {
                                    let mut merged = serde_json::to_value(
                                        scene.chart.clone().unwrap_or_default(),
                                    )
                                    .map_err(|e| e.to_string())?;
                                    for (key, value) in v.as_object().unwrap() {
                                        merged[key] = value.clone();
                                    }
                                    scene.chart = Some(
                                        serde_json::from_value(merged)
                                            .map_err(|e| e.to_string())?,
                                    );
                                }
                            }
                            "chart_presets" => {
                                scene.chart_presets =
                                    serde_json::from_value(v.clone()).map_err(|e| e.to_string())?;
                            }
                            "display" => {
                                if v.is_null() {
                                    scene.display = None;
                                } else {
                                    let mut merged = serde_json::to_value(
                                        scene.display.clone().unwrap_or_default(),
                                    )
                                    .map_err(|e| e.to_string())?;
                                    for (key, value) in v.as_object().unwrap() {
                                        merged[key] = value.clone();
                                    }
                                    scene.display = Some(
                                        serde_json::from_value(merged)
                                            .map_err(|e| e.to_string())?,
                                    );
                                }
                            }
                            "focus" => scene.focus = v.as_f64(),
                            "bounds" => {
                                scene.bounds = Some(
                                    serde_json::from_value(v.clone()).map_err(|e| e.to_string())?,
                                )
                            }
                            "gis_table" => scene.gis_table = v.as_str().map(str::to_owned),
                            "table_open" => scene.table_open = v.as_bool().unwrap(),
                            "inspector_tab" => scene.inspector_tab = v.as_str().unwrap().into(),
                            "fit" if v.as_bool().unwrap() => {
                                scene.cesium_camera = None;
                                scene.position = None;
                                scene.target = None;
                                scene.camera_up = None;
                            }
                            _ => {}
                        }
                    }
                    if args.get("fit").and_then(Value::as_bool) == Some(true) {
                        scene.view_states.remove(&scene.mode);
                    }
                    if let Some(amount) = args["playback_fade_amount"].as_u64() {
                        scene.playback_fade = Some(amount > 0);
                    } else if let Some(enabled) = args["playback_fade"].as_bool() {
                        scene.playback_fade_amount = Some(if enabled { 50 } else { 0 });
                    }
                    scene.validate()?;
                }
                Ok(json!({"scene":s.project.scene}))
            }
            "batch" => {
                let ops = args["operations"].as_array().unwrap();
                let mut results = vec![];
                for op in ops {
                    let command = op["command"].as_str().unwrap();
                    let args = op.get("args").cloned().unwrap_or(json!({}));
                    crate::schema::validate(command, &args)?;
                    if !transactional(command)
                        || command == "batch"
                        || args.get("dry_run").is_some()
                        || args.get("expected_revision").is_some()
                        || args.get("idempotency_key").is_some()
                    {
                        return Err("Batch accepts workspace operations without nested controls; file I/O and history are excluded".into());
                    }
                    results.push(self.invoke_raw(command, args)?);
                }
                Ok(json!({"results":results,"atomic":true}))
            }
            "save" => {
                let path: String = arg(&args, "path")?;
                if Path::new(&path).exists() && args["overwrite"] == false {
                    return Err("Output exists; use overwrite:true".into());
                }
                let files: Vec<PathBuf> = self
                    .terrain
                    .lock()
                    .map_err(|_| "Terrain unavailable")?
                    .as_ref()
                    .map(|c| c.resource_files())
                    .unwrap_or_default();
                let mut s = self.state.lock().map_err(|_| "Workspace unavailable")?;
                if let Some(scene) = args.get("scene") {
                    let scene: SceneState =
                        serde_json::from_value(scene.clone()).map_err(|e| e.to_string())?;
                    scene.validate()?;
                    s.project.scene = scene;
                }
                s.project.workspace = Some(WorkspaceSettings {
                    preferences: s.preferences.clone(),
                    terrain_files: files,
                });
                let format = if (s.project.gis_layers.is_empty()
                    || Path::new(&path)
                        .extension()
                        .is_some_and(|e| e.eq_ignore_ascii_case("json")))
                    && s.store.count()? <= MAX_EVENTS
                    && s.store.payload_bytes()? <= 48 * 1024 * 1024
                    && !s
                        .store
                        .connection
                        .query_row(
                            "SELECT EXISTS(SELECT 1 FROM meta WHERE key GLOB 'analytics:*')",
                            [],
                            |r| r.get::<_, bool>(0),
                        )
                        .map_err(|e| e.to_string())?
                {
                    let p = s.store.materialize(s.project.clone())?;
                    match project::save(Path::new(&path), &p) {
                        Ok(()) => {
                            if Path::new(&path)
                                .extension()
                                .is_some_and(|e| e.eq_ignore_ascii_case("json"))
                            {
                                "json_v7"
                            } else {
                                "zip_v7"
                            }
                        }
                        Err(e)
                            if !Path::new(&path)
                                .extension()
                                .is_some_and(|e| e.eq_ignore_ascii_case("json"))
                                && e.contains("64 MiB") =>
                        {
                            s.store.save_as(Path::new(&path), &s.project)?;
                            "sqlite_v3"
                        }
                        Err(e) => return Err(e),
                    }
                } else {
                    if Path::new(&path)
                        .extension()
                        .is_some_and(|e| e.eq_ignore_ascii_case("json"))
                    {
                        return Err(
                            "Large workspaces and saved analyses require the .chronoscope database format".into()
                        );
                    }
                    s.store.save_as(Path::new(&path), &s.project)?;
                    "sqlite_v3"
                };
                Ok(json!({"saved":path,"format":format}))
            }
            "open" => self.load_workspace(Path::new(&arg::<String>(&args, "path")?)),
            "export" => {
                let path: String = arg(&args, "path")?;
                let sidecar = format!("{path}.attribution.json");
                if (Path::new(&path).exists() || Path::new(&sidecar).exists())
                    && args["overwrite"] == false
                {
                    return Err("Output exists; use overwrite:true".into());
                }
                let s = self.state.lock().map_err(|_| "Workspace unavailable")?;
                let mut f = s.project.filter.clone();
                f.selected_only |= args["selected_only"]
                    .as_bool()
                    .unwrap_or(!s.project.selected.is_empty());
                let table = s.store.ordered(&f, None, "id", false)?;
                let mut q = s
                    .store
                    .connection
                    .prepare(&format!(
                        "SELECT e.payload FROM {table} o JOIN events e ON e.r=o.r ORDER BY o.pos"
                    ))
                    .map_err(|e| e.to_string())?;
                let rows = q
                    .query_map([], |r| r.get::<_, String>(0))
                    .map_err(|e| e.to_string())?;
                let events = rows.map(|row| {
                    row.map_err(|e| e.to_string()).and_then(|text| {
                        serde_json::from_str::<Event>(&text).map_err(|e| e.to_string())
                    })
                });
                let (count, attribution) = project::export_csv_attributed(
                    Path::new(&path),
                    events,
                    s.store.columns(None)?.into_iter().collect(),
                    &s.project.provenance,
                )?;
                Ok(json!({"exported":count,"path":path,"attribution":attribution}))
            }
            "coordinates" => {
                let coordinate: coordinates::Coordinate = arg(&args, "coordinate")?;
                serde_json::to_value(coordinates::convert(coordinate)?).map_err(|e| e.to_string())
            }
            "basemap_resource" => serde_json::to_value(crate::basemap::resource(
                &self.maps,
                &arg::<String>(&args, "url")?,
            )?)
            .map_err(|e| e.to_string()),
            "wmts_servers" => {
                if let Some(settings) = args.get("settings") {
                    let library: crate::map_servers::Library =
                        serde_json::from_value(settings.clone()).map_err(|e| e.to_string())?;
                    crate::map_servers::write(&self.data_dir, &library)?;
                }
                serde_json::to_value(crate::map_servers::Catalog {
                    servers: crate::map_servers::read(&self.data_dir)?.servers,
                    presets: crate::map_servers::presets(),
                })
                .map_err(|e| e.to_string())
            }
            "preferences" => {
                let preferences = if let Some(updates) = args.get("preferences") {
                    self.update_preferences(updates.clone(), false)?
                } else {
                    self.state
                        .lock()
                        .map_err(|_| "Workspace unavailable")?
                        .preferences
                        .clone()
                };
                serde_json::to_value(preferences).map_err(|e| e.to_string())
            }
            "wmts_auth_status" => crate::wmts_auth::status(&self.maps.auth),
            "wmts_auth_set" => {
                self.maps.auth.set(arg(&args, "profile")?, true)?;
                self.maps.reset_authentication()?;
                self.capabilities
                    .lock()
                    .map_err(|_| "Map metadata unavailable")?
                    .clear();
                crate::wmts_auth::status(&self.maps.auth)
            }
            "wmts_auth_remove" => {
                self.maps.auth.remove(&arg::<String>(&args, "origin")?)?;
                self.maps.reset_authentication()?;
                self.capabilities
                    .lock()
                    .map_err(|_| "Map metadata unavailable")?
                    .clear();
                crate::wmts_auth::status(&self.maps.auth)
            }
            "wmts_auth_reset" => {
                self.maps.reset_authentication()?;
                self.capabilities
                    .lock()
                    .map_err(|_| "Map metadata unavailable")?
                    .clear();
                Ok(
                    json!({"reset":true,"note":"Native TLS session closed and automatic identity cache namespace rotated. Previously cached imagery remains separate on disk."}),
                )
            }
            "wmts_access" => {
                if let Some(value) = args.get("settings") {
                    let mut merged = serde_json::to_value(self.maps.access_settings()?)
                        .map_err(|e| e.to_string())?;
                    for (key, value) in value.as_object().ok_or("Invalid WMTS settings")? {
                        merged[key] = value.clone();
                    }
                    let settings: crate::wmts::AccessSettings =
                        serde_json::from_value(merged).map_err(|e| e.to_string())?;
                    self.maps.set_access_settings(settings)?;
                }
                self.maps.cache_info()
            }
            "wmts_cache_clear" => {
                self.maps.clear_cache()?;
                self.capabilities
                    .lock()
                    .map_err(|_| "Map metadata unavailable")?
                    .clear();
                self.maps.cache_info()
            }
            "wmts_capabilities" => {
                let url: String = arg(&args, "url")?;
                let c = Arc::new(self.maps.capabilities(&url)?);
                self.capabilities
                    .lock()
                    .map_err(|_| "Map metadata unavailable")?
                    .insert(self.maps.metadata_key(&url)?, c.clone());
                serde_json::to_value(&*c).map_err(|e| e.to_string())
            }
            "wmts_plan" | "wmts_plan_page" | "wmts_rasters" => {
                let config: MapConfig = arg(&args, "config")?;
                let bounds: [f64; 4] = arg(&args, "bounds")?;
                let preferred = args["level"].as_u64().map(|v| v as usize);
                let cached = self
                    .capabilities
                    .lock()
                    .map_err(|_| "Map metadata unavailable")?
                    .get(&self.maps.metadata_key(&config.url)?)
                    .cloned();
                let c = if let Some(c) = cached {
                    c
                } else {
                    let c = Arc::new(self.maps.capabilities(&config.url)?);
                    self.capabilities
                        .lock()
                        .map_err(|_| "Map metadata unavailable")?
                        .insert(self.maps.metadata_key(&config.url)?, c.clone());
                    c
                };
                let offset = args["offset"].as_u64().unwrap_or(0);
                let limit = args["limit"].as_u64().unwrap_or(16) as usize;
                let pixels = args["target_pixels"].as_f64().unwrap_or(1400.);
                if command == "wmts_plan_page" {
                    serde_json::to_value(crate::wmts::plan_page(
                        &c, &config, bounds, preferred, offset, limit, pixels,
                    )?)
                    .map_err(|e| e.to_string())
                } else if command == "wmts_plan" {
                    serde_json::to_value(crate::wmts::plan(&c, &config, bounds, preferred)?)
                        .map_err(|e| e.to_string())
                } else {
                    serde_json::to_value(
                        self.maps
                            .rasters_page(&c, &config, bounds, preferred, offset, limit, pixels)?,
                    )
                    .map_err(|e| e.to_string())
                }
            }
            "terrain_load" | "terrain_unload" => {
                let path = if command == "terrain_load" {
                    args["path"].clone()
                } else {
                    Value::Null
                };
                let mut updates = json!({"terrain_path":path,"terrain_builtin":false});
                if command == "terrain_load"
                    && self
                        .state
                        .lock()
                        .map_err(|_| "Workspace unavailable")?
                        .preferences
                        .terrain_builtin
                {
                    updates["terrain_vertical_datum"] = json!("unresolved-msl");
                }
                self.update_preferences(updates, command == "terrain_load")?;
                if command == "terrain_load" {
                    self.invoke_raw("terrain_info", json!({}))
                } else {
                    Ok(json!({"ok":true}))
                }
            }
            "terrain_info" => {
                let guard = self.terrain.lock().map_err(|_| "Terrain unavailable")?;
                Ok(guard
                    .as_ref()
                    .map(|c| json!({"tiles":c.tiles,"bounds":c.bounds()}))
                    .unwrap_or(Value::Null))
            }
            "terrain_mesh" => {
                let bounds: [f64; 4] = arg(&args, "bounds")?;
                let resolution = args["resolution"].as_u64().unwrap_or(129) as usize;
                let mut terrain = self.terrain.lock().map_err(|_| "Terrain unavailable")?;
                let catalog = terrain.as_mut().ok_or("Load DTED first")?;
                let hits = catalog.mesh_cache_hits();
                let mesh = catalog.mesh_cached(bounds, resolution)?;
                let cache_hit = catalog.mesh_cache_hits() != hits;
                let mut value = serde_json::to_value(mesh).map_err(|e| e.to_string())?;
                value["cache_hit"] = json!(cache_hit);
                if cache_hit {
                    value["decoded_tiles"] = json!(0);
                }
                Ok(value)
            }
            "terrain_sample" => {
                let latitude: f64 = arg(&args, "latitude")?;
                let longitude: f64 = arg(&args, "longitude")?;
                if !latitude.is_finite() || !longitude.is_finite() {
                    return Err("Invalid coordinates".into());
                }
                let value = self
                    .terrain
                    .lock()
                    .map_err(|_| "Terrain unavailable")?
                    .as_mut()
                    .ok_or("Load DTED first")?
                    .sample(latitude, longitude)?;
                let builtin = self
                    .state
                    .lock()
                    .map_err(|_| "Workspace unavailable")?
                    .preferences
                    .terrain_builtin;
                Ok(
                    json!({"elevation_m":value,"datum":if builtin { "EGM96 MSL" } else { "DTED MSL" }}),
                )
            }
            _ => Err(format!("Unknown engine command: {command}")),
        }
    }
}
pub fn default_data_dir() -> PathBuf {
    crate::platform::default_data_dir()
}

mod gis;
