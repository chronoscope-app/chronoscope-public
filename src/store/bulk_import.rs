//! Fresh staged imports only. Schema changes share ingestion's rollback boundary.
use super::*;

impl DataStore {
    pub(crate) fn begin_bulk_import(&self) -> Result<(), String> {
        if self.count()? != 0 {
            return Err("Bulk import requires an empty staging store".into());
        }
        // Keep primary/unique constraints. Build secondary B-trees once instead
        // of maintaining ten of them while rows and original attributes arrive.
        for sql in SCHEMA.lines().filter(|s| s.starts_with("CREATE INDEX ")) {
            let name = sql.split_whitespace().nth(2).expect("static index name");
            self.connection
                .execute_batch(&format!("DROP INDEX {name}"))
                .map_err(err)?;
        }
        // Keep the write working set bounded, but avoid interleaving R-tree
        // page updates with hundreds of thousands of attribute writes. TEMP
        // tables spill to disk for large imports and share the savepoint.
        self.connection.execute_batch("PRAGMA cache_size=-131072; PRAGMA temp.cache_size=-16384;
            CREATE TEMP TABLE bulk_search(r INTEGER PRIMARY KEY,text TEXT NOT NULL);
            CREATE TEMP TABLE bulk_spatial(r INTEGER PRIMARY KEY,south REAL,north REAL,west REAL,east REAL);").map_err(err)?;
        Ok(())
    }

    pub(crate) fn finish_bulk_import(&self) -> Result<(), String> {
        for sql in SCHEMA.lines().filter(|s| s.starts_with("CREATE INDEX ")) {
            crate::operation::check()?;
            self.connection.execute_batch(sql).map_err(err)?;
        }
        self.connection
            .execute_batch(
                "INSERT INTO search(rowid,text) SELECT r,text FROM bulk_search;
            INSERT INTO spatial SELECT r,south,north,west,east FROM bulk_spatial;
            DROP TABLE bulk_search; DROP TABLE bulk_spatial;
            PRAGMA cache_size=-32768; PRAGMA temp.cache_size=-2000;",
            )
            .map_err(err)?;
        Ok(())
    }

    pub(crate) fn insert_import_batch(&self, events: &[Event]) -> Result<(), String> {
        let mut rowid: i64 = self
            .connection
            .query_row("SELECT coalesce(max(r),0) FROM events", [], |r| r.get(0))
            .map_err(err)?;
        let mut rows = Vec::new();
        let mut attributes = Vec::new();
        let mut searches = Vec::new();
        let mut spatial = Vec::new();
        let flush = |rows: &mut Vec<Vec<SqlValue>>,
                     attributes: &mut Vec<Vec<SqlValue>>,
                     searches: &mut Vec<Vec<SqlValue>>,
                     spatial: &mut Vec<Vec<SqlValue>>| {
            self.insert_import_rows("events(r,id,id_key,entity,time,t_end,lat,lon,category,label,value,related_to,source,source_row,end,tags,note,mgrs_precision,geometry_wkt,payload)", rows)?;
            self.insert_import_rows("attributes(r,key,text,num)", attributes)?;
            self.insert_import_rows("bulk_search(r,text)", searches)?;
            self.insert_import_rows("bulk_spatial(r,south,north,west,east)", spatial)
        };
        for event in events {
            crate::operation::check()?;
            event.validate()?;
            rowid = rowid.checked_add(1).ok_or("Event row capacity exhausted")?;
            let payload = serde_json::to_string(event).map_err(err)?;
            rows.push(vec![
                rowid.into(),
                event.id.to_string().into(),
                format!("{:020}", event.id).into(),
                event.entity.clone().into(),
                event.time.into(),
                event.end.unwrap_or(event.time).into(),
                event.lat.into(),
                event.lon.into(),
                event.category.clone().into(),
                event.label.clone().into(),
                event.value.into(),
                event.related_to.clone().into(),
                event.source.clone().into(),
                (event.source_row as i64).into(),
                event.end.into(),
                event
                    .tags
                    .iter()
                    .cloned()
                    .collect::<Vec<_>>()
                    .join(",")
                    .into(),
                event.note.clone().into(),
                event.mgrs_precision.map(i64::from).into(),
                event.geometry_wkt.clone().into(),
                payload.into(),
            ]);
            for (key, value) in &event.attrs {
                let numeric = value.trim().parse::<f64>().ok().filter(|v| v.is_finite());
                attributes.push(vec![
                    rowid.into(),
                    key.clone().into(),
                    value.clone().into(),
                    numeric.into(),
                ]);
            }
            searches.push(vec![rowid.into(), search_text(event).into()]);
            let footprint = if let Some(text) = event.geometry_wkt.as_ref() {
                crate::geometry::parse(text)?.bounds
            } else {
                event.location().map(|(lat, lon)| [lon, lat, lon, lat])
            };
            if let Some([west, south, east, north]) = footprint {
                spatial.push(vec![
                    rowid.into(),
                    south.into(),
                    north.into(),
                    west.into(),
                    east.into(),
                ]);
            }
            // Bounded by both record count and the caller's 4 MiB raw batch.
            if rows.len() >= 100 {
                flush(&mut rows, &mut attributes, &mut searches, &mut spatial)?;
            }
        }
        flush(&mut rows, &mut attributes, &mut searches, &mut spatial)
    }

    fn insert_import_rows(
        &self,
        target: &str,
        rows: &mut Vec<Vec<SqlValue>>,
    ) -> Result<(), String> {
        if rows.is_empty() {
            return Ok(());
        }
        let columns = rows[0].len();
        // Stay below even SQLite's older 999-variable limit.
        for chunk in rows.chunks(900 / columns) {
            let tuple = format!("({})", vec!["?"; columns].join(","));
            let sql = format!(
                "INSERT INTO {target} VALUES {}",
                vec![tuple; chunk.len()].join(",")
            );
            self.connection
                .prepare_cached(&sql)
                .map_err(err)?
                .execute(rusqlite::params_from_iter(
                    chunk.iter().flat_map(|r| r.iter()),
                ))
                .map_err(err)?;
        }
        rows.clear();
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn events() -> Vec<Event> {
        let seed = crate::demo::dataset().events.remove(0);
        (0..2205)
            .map(|i| {
                let mut e = seed.clone();
                e.id = if i == 2204 { u64::MAX } else { i + 1 };
                e.time += i as f64 * 0.125;
                e.entity = format!("track-{}", i % 17);
                e.attrs.insert("original ✓".into(), format!("00{i} nebula"));
                e.attrs.insert("number".into(), format!("{}.5", i));
                if i % 3 == 0 {
                    e.lat = None;
                    e.lon = None;
                }
                if i == 1001 {
                    e.geometry_wkt = Some("POLYGON((-74 40,-73 40,-73 41,-74 40))".into());
                    e.lat = None;
                    e.lon = None;
                    e.derive_polygon_centroid().unwrap();
                }
                e
            })
            .collect()
    }

    fn contents(store: &DataStore, sql: &str) -> Vec<Vec<SqlValue>> {
        let mut statement = store.connection.prepare(sql).unwrap();
        let width = statement.column_count();
        statement
            .query_map([], |row| (0..width).map(|i| row.get(i)).collect())
            .unwrap()
            .collect::<Result<_, _>>()
            .unwrap()
    }

    #[test]
    fn fresh_bulk_matches_general_insert_including_indexes_search_spatial_and_originals() {
        let dir = tempfile::tempdir().unwrap();
        let normal = DataStore::new(dir.path()).unwrap();
        let bulk = DataStore::new(dir.path()).unwrap();
        let events = events();
        normal
            .connection
            .execute_batch("SAVEPOINT ingestion")
            .unwrap();
        for e in &events {
            normal.insert(e).unwrap();
        }
        normal
            .connection
            .execute_batch("RELEASE ingestion")
            .unwrap();
        bulk.connection
            .execute_batch("SAVEPOINT ingestion")
            .unwrap();
        bulk.begin_bulk_import().unwrap();
        for chunk in events.chunks(1000) {
            bulk.insert_import_batch(chunk).unwrap();
        }
        bulk.finish_bulk_import().unwrap();
        bulk.connection.execute_batch("RELEASE ingestion").unwrap();
        for sql in [
            "SELECT * FROM events ORDER BY r",
            "SELECT * FROM attributes ORDER BY r,key",
            "SELECT rowid,text FROM search ORDER BY rowid",
            "SELECT * FROM spatial ORDER BY r",
            "SELECT name,sql FROM sqlite_master WHERE type='index' ORDER BY name",
            "SELECT rowid FROM search WHERE text LIKE '%nebula%' ORDER BY rowid",
            "SELECT r FROM spatial WHERE lat_min>=40 AND lon_max<=0 ORDER BY r",
        ] {
            assert_eq!(contents(&normal, sql), contents(&bulk, sql), "{sql}");
        }
        assert_eq!(
            bulk.connection
                .query_row("PRAGMA integrity_check", [], |r| r.get::<_, String>(0))
                .unwrap(),
            "ok"
        );
        assert!(bulk.begin_bulk_import().is_err());
    }

    #[test]
    fn failed_bulk_rolls_back_rows_and_schema_for_retry() {
        let dir = tempfile::tempdir().unwrap();
        let store = DataStore::new(dir.path()).unwrap();
        let before = contents(&store, "SELECT name,sql FROM sqlite_master ORDER BY name");
        let events = events();
        store
            .connection
            .execute_batch("SAVEPOINT ingestion")
            .unwrap();
        store.begin_bulk_import().unwrap();
        store.insert_import_batch(&events[..1000]).unwrap();
        assert!(store.insert_import_batch(&events[..1]).is_err());
        store
            .connection
            .execute_batch("ROLLBACK TO ingestion; RELEASE ingestion")
            .unwrap();
        assert_eq!(store.count().unwrap(), 0);
        assert_eq!(
            contents(&store, "SELECT name,sql FROM sqlite_master ORDER BY name"),
            before
        );
        store
            .connection
            .execute_batch("SAVEPOINT ingestion")
            .unwrap();
        store.begin_bulk_import().unwrap();
        store.insert_import_batch(&events[..1]).unwrap();
        store.finish_bulk_import().unwrap();
        store.connection.execute_batch("RELEASE ingestion").unwrap();
        assert_eq!(store.count().unwrap(), 1);
    }

    #[test]
    fn cancelled_index_build_rolls_back_before_publication() {
        let dir = tempfile::tempdir().unwrap();
        let store = DataStore::new(dir.path()).unwrap();
        let before = contents(&store, "SELECT name,sql FROM sqlite_master ORDER BY name");
        store
            .connection
            .execute_batch("SAVEPOINT ingestion")
            .unwrap();
        store.begin_bulk_import().unwrap();
        store.insert_import_batch(&events()[..1000]).unwrap();
        let cancelled = crate::operation::Context {
            cancelled: std::sync::Arc::new(std::sync::atomic::AtomicBool::new(true)),
            progress: None,
            scope: None,
        };
        assert!(crate::operation::with_context(cancelled, || store.finish_bulk_import()).is_err());
        store
            .connection
            .execute_batch("ROLLBACK TO ingestion; RELEASE ingestion")
            .unwrap();
        assert_eq!(store.count().unwrap(), 0);
        assert_eq!(
            contents(&store, "SELECT name,sql FROM sqlite_master ORDER BY name"),
            before
        );
    }
}
