//! Streaming, disk-backed anchored space/time aggregation. UTC windows are fixed,
//! half-open buckets; groups never bridge entities, categories or source layers.
use crate::{model::Event, store::DataStore};
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Options {
    pub window_minutes: i64,
    pub radius_m: f64,
}
impl Options {
    pub fn validate(&self) -> Result<(), String> {
        if !(1..=5259600).contains(&self.window_minutes)
            || !self.radius_m.is_finite()
            || !(1.0..=20040000.).contains(&self.radius_m)
        {
            return Err("Invalid aggregation: window must be 1–5259600 minutes and radius 1–20040000 metres".into());
        }
        Ok(())
    }
}
fn error(e: impl std::fmt::Display) -> String {
    format!("Aggregation: {e}")
}
// WGS84 geocentric Cartesian position at ellipsoid height zero. Any geodesic
// neighbour within r is also a chord neighbour within r, including poles/dateline.
fn cell(lat: f64, lon: f64, radius: f64) -> [i64; 3] {
    let (sin, cos) = lat.to_radians().sin_cos();
    let n = 6378137.0 / (1.0 - 6.6943799901413165e-3 * sin * sin).sqrt();
    let (sl, cl) = lon.to_radians().sin_cos();
    [
        n * cos * cl,
        n * cos * sl,
        n * (1.0 - 6.6943799901413165e-3) * sin,
    ]
    .map(|v| (v / radius).floor() as i64)
}
pub struct Accumulator {
    db: Connection,
    options: Options,
    _directory: tempfile::TempDir,
    pub input_count: usize,
}
impl Accumulator {
    pub fn new(dir: &std::path::Path, options: Options) -> Result<Self, String> {
        options.validate()?;
        let directory = tempfile::Builder::new()
            .prefix("aggregate-")
            .tempdir_in(dir)
            .map_err(error)?;
        let db = Connection::open(directory.path().join("groups.sqlite")).map_err(error)?;
        db.progress_handler(10000, Some(crate::operation::cancelled));
        db.execute_batch("PRAGMA journal_mode=OFF; PRAGMA synchronous=OFF; PRAGMA cache_size=-8192; PRAGMA max_page_count=8388608;
        CREATE TABLE groups(g INTEGER PRIMARY KEY,bucket INTEGER,entity TEXT,category TEXT,source TEXT,x INTEGER,y INTEGER,z INTEGER,lat REAL,lon REAL,payload TEXT,n INTEGER,first INTEGER,last INTEGER,last_row INTEGER,numeric_count INTEGER,mean REAL);
        CREATE INDEX neighbours ON groups(bucket,entity,category,source,x,y,z);
        BEGIN;").map_err(error)?;
        Ok(Self {
            db,
            options,
            _directory: directory,
            input_count: 0,
        })
    }
    pub fn push(&mut self, event: &Event) -> Result<(), String> {
        crate::operation::check()?;
        if event.attrs.contains_key("chronoscope.aggregate.count") {
            return Err("Aggregation input already contains summaries; use the original source records to avoid double aggregation".into());
        }
        self.input_count += 1;
        if self.input_count.is_multiple_of(10000) {
            crate::operation::progress(
                self.input_count as u64,
                None,
                "Grouping by time and proximity",
            );
        }
        let bucket = (event.time / (self.options.window_minutes * 60) as f64).floor() as i64;
        let position = event
            .location()
            .map(|(lat, lon)| cell(lat, lon, self.options.radius_m));
        let mut matched = None;
        if let Some([x, y, z]) = position {
            let mut query=self.db.prepare_cached("SELECT g,lat,lon FROM groups WHERE bucket=? AND entity=? AND category=? AND source=? AND x BETWEEN ? AND ? AND y BETWEEN ? AND ? AND z BETWEEN ? AND ? ORDER BY g LIMIT 100001").map_err(error)?;
            let mut rows = query
                .query(params![
                    bucket,
                    event.entity,
                    event.category,
                    event.source,
                    x - 1,
                    x + 1,
                    y - 1,
                    y + 1,
                    z - 1,
                    z + 1
                ])
                .map_err(error)?;
            let mut candidates = 0;
            while let Some(row) = rows.next().map_err(error)? {
                candidates += 1;
                if candidates > 100000 {
                    return Err("RESOURCE_LIMIT: aggregation neighbour budget exceeded; use a smaller radius/window".into());
                }
                let lat = row.get(1).map_err(error)?;
                let lon = row.get(2).map_err(error)?;
                if crate::analysis::geodesic_distance((lat, lon), event.location().unwrap())
                    <= self.options.radius_m
                {
                    matched = Some(row.get::<_, i64>(0).map_err(error)?);
                    break;
                }
            }
        }
        if let Some(group) = matched {
            self.db.execute("UPDATE groups SET n=n+1,first=min(first,?),last=max(last,?),last_row=max(last_row,?),mean=CASE WHEN ? IS NULL THEN mean WHEN numeric_count=0 THEN ? ELSE mean*(CAST(numeric_count AS REAL)/(numeric_count+1)) + ?/(numeric_count+1) END,numeric_count=numeric_count+CASE WHEN ? IS NULL THEN 0 ELSE 1 END WHERE g=?",params![event.time,event.end.unwrap_or(event.time),event.source_row as i64,event.value,event.value,event.value,event.value,group]).map_err(error)?;
        } else {
            let c = position.unwrap_or([i64::MIN; 3]);
            self.db.execute("INSERT INTO groups(bucket,entity,category,source,x,y,z,lat,lon,payload,n,first,last,last_row,numeric_count,mean) VALUES(?,?,?,?,?,?,?,?,?,?,1,?,?,?,?,?)",params![bucket,event.entity,event.category,event.source,c[0],c[1],c[2],event.lat,event.lon,serde_json::to_string(event).map_err(error)?,event.time,event.end.unwrap_or(event.time),event.source_row as i64,usize::from(event.value.is_some()),event.value]).map_err(error)?;
        }
        Ok(())
    }
    pub fn visit(
        &self,
        mut visit: impl FnMut(Event, usize) -> Result<(), String>,
    ) -> Result<usize, String> {
        let mut query = self
            .db
            .prepare(
                "SELECT payload,n,last,last_row,numeric_count,mean,first FROM groups ORDER BY g",
            )
            .map_err(error)?;
        let mut rows = query.query([]).map_err(error)?;
        let mut count = 0;
        while let Some(row) = rows.next().map_err(error)? {
            crate::operation::check()?;
            let text: String = row.get(0).map_err(error)?;
            let mut event: Event = serde_json::from_str(&text).map_err(error)?;
            let n: usize = row.get(1).map_err(error)?;
            if n > 1 {
                let last: f64 = row.get(2).map_err(error)?;
                let anchor_time = event.time;
                event.time = row.get(6).map_err(error)?;
                event.end = Some(last);
                event.value = row.get(5).map_err(error)?;
                for (key,value) in [
                    ("anchor_time",anchor_time.to_string()),("count",n.to_string()),("numeric_count",row.get::<_,usize>(4).map_err(error)?.to_string()),
                    ("window_minutes",self.options.window_minutes.to_string()),("radius_m",self.options.radius_m.to_string()),
                    ("last_source_row",row.get::<_,i64>(3).map_err(error)?.to_string()),
                    ("semantics","Anchor coordinate and first record attributes; value is arithmetic mean; end is latest constituent end; raw member rows are not retained".into()),
                ] {event.attrs.insert(format!("chronoscope.aggregate.{key}"),value);}
                event.label = format!(
                    "{n} events · {}",
                    event.label.chars().take(200).collect::<String>()
                );
                event.validate()?;
            }
            visit(event, n)?;
            count += 1;
        }
        Ok(count)
    }
    pub fn write(&self, store: &DataStore) -> Result<usize, String> {
        store
            .connection
            .execute_batch("SAVEPOINT aggregate_output")
            .map_err(error)?;
        let result = self.visit(|e, _| store.insert(&e));
        match result {
            Ok(count) => {
                store
                    .connection
                    .execute_batch("RELEASE aggregate_output")
                    .map_err(error)?;
                Ok(count)
            }
            Err(e) => {
                let _ = store
                    .connection
                    .execute_batch("ROLLBACK TO aggregate_output; RELEASE aggregate_output");
                Err(e)
            }
        }
    }
    pub fn preview(&self, limit: usize) -> Result<Value, String> {
        let mut groups = vec![];
        let mut preview_bytes = 0;
        let count = self.visit(|mut e, n| {
            if groups.len() < limit && preview_bytes < 1024 * 1024 {
                e.attrs.retain(|k, _| {
                    [
                        "count",
                        "numeric_count",
                        "window_minutes",
                        "radius_m",
                        "anchor_time",
                        "last_source_row",
                        "semantics",
                    ]
                    .iter()
                    .any(|field| k == &format!("chronoscope.aggregate.{field}"))
                });
                for value in e.attrs.values_mut() {
                    *value = value.chars().take(512).collect();
                }
                e.tags.clear();
                e.note.clear();
                e.label = e.label.chars().take(256).collect();
                e.entity = e.entity.chars().take(256).collect();
                e.category = e.category.chars().take(256).collect();
                e.source = e.source.chars().take(256).collect();
                e.related_to.clear();
                let group = json!({"representative":crate::store::event_json(&e),"count":n});
                let cost = group.to_string().len();
                if preview_bytes + cost <= 1024 * 1024 {
                    groups.push(group);
                    preview_bytes += cost;
                } else {
                    preview_bytes = 1024 * 1024;
                }
            }
            Ok(())
        })?;
        Ok(
            json!({"input_count":self.input_count,"group_count":count,"groups":groups,"limited":count>groups.len(),"projection":"Representative fields only; text capped at 256 characters, authored aggregation metadata at 512; other attributes/tags/notes omitted. Preview capped at 1 MiB.","options":self.options,"semantics":"UTC epoch-aligned half-open windows; within radius of first anchor, same entity/category/source; missing locations stay separate; order-dependent anchored groups, not transitive clusters"}),
        )
    }
}
