//! Choose spatial pruning without changing exact point/geometry predicates.
use super::*;

impl DataStore {
    pub(super) fn viewport_sql(
        &self,
        bounds: &GeoBounds,
    ) -> Result<(String, Vec<SqlValue>), String> {
        let key = serde_json::to_string(bounds).map_err(err)?;
        let cached = self.viewport_plan_cache.borrow().get(&key).copied();
        let use_index = if let Some(use_index) = cached {
            use_index
        } else {
            // A broad RTree IN materializes/sorts many rowids before SQLite can
            // use a selective time index. Probe only up to a quarter of the data,
            // then retain the exact predicates without this redundant prefilter.
            // Narrow views keep the RTree. Cache at most 32 viewport decisions;
            // clear_cache invalidates them after data edits, imports and Undo.
            // Complex shapes retain the existing path: testing every geometry
            // directly can be expensive even at broad map scales.
            let use_index = self.has_geometries()? || self.viewport_index_is_selective(bounds)?;
            let mut cache = self.viewport_plan_cache.borrow_mut();
            if cache.len() >= 32 {
                cache.clear();
            }
            cache.insert(key, use_index);
            use_index
        };
        Ok(Self::where_sql_with_spatial_index(
            &Filter {
                bounds: Some(bounds.clone()),
                ..Filter::default()
            },
            None,
            use_index,
        ))
    }

    fn viewport_index_is_selective(&self, bounds: &GeoBounds) -> Result<bool, String> {
        let threshold = (self.count()? / 4).max(1);
        let longitude = if bounds.west <= bounds.east {
            "lon_max>=? AND lon_min<=?"
        } else {
            "(lon_max>=? OR lon_min<=?)"
        };
        let sql = format!("SELECT count(*) FROM (SELECT r FROM spatial WHERE lat_max>=? AND lat_min<=? AND {longitude} LIMIT ?)");
        let candidates: usize = self
            .connection
            .query_row(
                &sql,
                params![
                    bounds.south,
                    bounds.north,
                    bounds.west,
                    bounds.east,
                    threshold
                ],
                |row| row.get(0),
            )
            .map_err(err)?;
        Ok(candidates < threshold)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn viewport_plan_uses_density_and_invalidates_after_data_changes() {
        let dir = tempfile::tempdir().unwrap();
        let mut store = DataStore::new(dir.path()).unwrap();
        let mut events = point_events();
        store.load_events(events.clone()).unwrap();
        let bounds = GeoBounds {
            west: -1.,
            south: -1.,
            east: 1.,
            north: 1.,
        };
        assert!(!store
            .viewport_sql(&bounds)
            .unwrap()
            .0
            .contains("SELECT r FROM spatial"));
        events[0].geometry_wkt = Some("LINESTRING(-1 -1,1 1)".into());
        events[0].lat = None;
        events[0].lon = None;
        store.load_events(events.clone()).unwrap();
        assert!(store
            .viewport_sql(&bounds)
            .unwrap()
            .0
            .contains("SELECT r FROM spatial"));
        events[0].geometry_wkt = None;
        for event in &mut events {
            event.lat = Some(45.);
            event.lon = Some(45.);
        }
        store.load_events(events).unwrap();
        assert!(store.viewport_plan_cache.borrow().is_empty());
        assert!(store
            .viewport_sql(&bounds)
            .unwrap()
            .0
            .contains("SELECT r FROM spatial"));
        for i in 0..40 {
            store
                .viewport_sql(&GeoBounds {
                    west: -1.,
                    south: -1.,
                    east: 1. + i as f64,
                    north: 1.,
                })
                .unwrap();
        }
        assert!(store.viewport_plan_cache.borrow().len() <= 32);
    }
    fn point_events() -> Vec<Event> {
        let template = crate::demo::dataset().events.remove(0);
        (0..8)
            .map(|i| {
                let mut event = template.clone();
                event.id = i + 1;
                event.lat = Some(0.);
                event.lon = Some(0.);
                event.geometry_wkt = None;
                event
            })
            .collect()
    }
}
