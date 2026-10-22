//! Dataset statistics and selection summaries have separate cache dependencies.
use super::*;
impl DataStore {
    pub(super) fn cache_summary(
        &self,
        key: String,
        value: &Value,
        selected: bool,
    ) -> Result<(), String> {
        const LIMIT: usize = 8 * 1024 * 1024;
        let bytes = key.len() + serde_json::to_vec(value).map_err(err)?.len();
        if bytes > LIMIT {
            return Ok(());
        }
        let (cache, count) = if selected {
            (&self.selection_summary_cache, &self.selection_cache_bytes)
        } else {
            (&self.summary_cache, &self.summary_cache_bytes)
        };
        if cache.borrow().len() >= 4 {
            cache.borrow_mut().clear();
            count.set(0);
        }
        if self.summary_cache_bytes.get() + self.selection_cache_bytes.get() + bytes > LIMIT {
            self.summary_cache.borrow_mut().clear();
            self.selection_summary_cache.borrow_mut().clear();
            self.summary_cache_bytes.set(0);
            self.selection_cache_bytes.set(0);
        }
        cache.borrow_mut().insert(key, value.clone());
        count.set(count.get() + bytes);
        Ok(())
    }
    pub fn summary(&self, filter: &Filter) -> Result<Value, String> {
        self.summary_with_statistics(filter, true)
    }
    pub fn summary_with_statistics(
        &self,
        filter: &Filter,
        include_statistics: bool,
    ) -> Result<Value, String> {
        let mut result = self.base_summary(filter, include_statistics)?;
        result["selected_histogram"] = self.selected_histogram(filter)?;
        result["selected_entities"] = self.selected_entities()?;
        result["facets"] = self.sidebar_facets(filter)?;
        Ok(result)
    }
    fn sidebar_facets(&self, filter: &Filter) -> Result<Value, String> {
        let mut facets = serde_json::Map::new();
        for (kind, field) in &filter.facet_fields {
            if field == kind {
                continue;
            }
            let mut data = json!({"field":field,"counts":{},"selected":{},"limited":false});
            for selected in [false, true] {
                let key = serde_json::to_string(&(selected, field)).map_err(err)?;
                let selection_revision = if selected { self.selection_revision } else { 0 };
                let cached = self
                    .facet_cache
                    .borrow()
                    .get(&key)
                    .filter(|(data, selection, _)| {
                        *data == self.data_revision && *selection == selection_revision
                    })
                    .map(|(_, _, v)| v.clone());
                let result = if let Some(cached) = cached {
                    cached
                } else {
                    let mut args = vec![];
                    let expression = Self::facet_expression(field, &mut args);
                    let from = if selected {
                        "selection s JOIN events e ON e.id=s.id"
                    } else {
                        "events e"
                    };
                    let mut query = self.connection.prepare(&format!("SELECT {expression} AS facet_value,count(*) FROM {from} GROUP BY 1 ORDER BY 1 LIMIT 5001")).map_err(err)?;
                    let mut counts = serde_json::Map::new();
                    let mut limited = false;
                    let mut bytes = 0;
                    for row in query
                        .query_map(rusqlite::params_from_iter(args), |r| {
                            Ok((r.get::<_, String>(0)?, r.get::<_, u64>(1)?))
                        })
                        .map_err(err)?
                    {
                        crate::operation::check()?;
                        if counts.len() == 5000 {
                            limited = true;
                            break;
                        }
                        let (value, count) = row.map_err(err)?;
                        bytes += value.len() + 32;
                        if value.len() > 8192 || bytes > 2 * 1024 * 1024 {
                            limited = true;
                            break;
                        }
                        counts.insert(value, json!(count));
                    }
                    let result = json!({"counts":counts,"limited":limited});
                    if serde_json::to_vec(&result).map_err(err)?.len() <= 2 * 1024 * 1024 {
                        let mut cache = self.facet_cache.borrow_mut();
                        if !cache.contains_key(&key) && cache.len() >= 4 {
                            cache.clear();
                        }
                        cache.insert(
                            key,
                            (self.data_revision, selection_revision, result.clone()),
                        );
                    }
                    result
                };
                data[if selected { "selected" } else { "counts" }] = result["counts"].clone();
                data["limited"] = json!(data["limited"] == true || result["limited"] == true);
            }
            facets.insert(kind.clone(), data);
        }
        Ok(Value::Object(facets))
    }
    fn base_summary(&self, filter: &Filter, include_statistics: bool) -> Result<Value, String> {
        let key = serde_json::to_string(&(
            self.data_revision,
            if filter.selected_only {
                self.selection_revision
            } else {
                0
            },
            filter,
            include_statistics,
        ))
        .map_err(err)?;
        if let Some(v) = self.summary_cache.borrow().get(&key) {
            return Ok(v.clone());
        }
        self.summary_builds.set(self.summary_builds.get() + 1);
        let table = self.ordered(filter, None, "time", false)?;
        let visible = self.table_count(&table)?;
        let (lo, hi) = self.time_bounds()?;
        let groups = |column: &str| -> Result<Value, String> {
            let mut q=self.connection.prepare(&format!("SELECT {column},count(*) FROM events GROUP BY {column} ORDER BY {column} LIMIT 5000")).map_err(err)?;
            let rows = q
                .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, u64>(1)?)))
                .map_err(err)?;
            let mut value = serde_json::Map::new();
            for row in rows {
                let (k, n) = row.map_err(err)?;
                value.insert(k, json!(n));
            }
            Ok(Value::Object(value))
        };
        let mut q=self.connection.prepare(&format!("SELECT min(99,cast((e.time-?1)*100.0/(?2-?1) AS INTEGER)),count(*) FROM {table} o JOIN events e ON e.r=o.r GROUP BY 1")).map_err(err)?;
        let rows = q
            .query_map(params![lo, hi], |r| {
                Ok((r.get::<_, usize>(0)?, r.get::<_, u64>(1)?))
            })
            .map_err(err)?;
        let mut histogram = vec![0u64; 100];

        for row in rows {
            let (b, n) = row.map_err(err)?;
            histogram[b] = n;
        }
        let stats = if include_statistics {
            self.statistics_builds.set(self.statistics_builds.get() + 1);
            let mut accumulator = super::statistics::SummaryAccumulator::default();
            let mut q=self.connection.prepare(&format!("SELECT e.value FROM {table} o JOIN events e ON e.r=o.r WHERE e.value IS NOT NULL ORDER BY e.r")).map_err(err)?;
            for (index, value) in q
                .query_map([], |r| r.get::<_, f64>(0))
                .map_err(err)?
                .enumerate()
            {
                if index.is_multiple_of(1024) {
                    crate::operation::check()?;
                }
                accumulator.add(value.map_err(err)?)?;
            }
            let summary = accumulator.summary(visible as u64);
            let mut stats = json!({"count":summary.count,"mean":summary.mean,"min":summary.min,"max":summary.max,"sum":summary.sum.unwrap_or(0.),"std_dev":summary.standard_deviation_population.unwrap_or(0.)});
            let n = stats["count"].as_u64().unwrap() as usize;
            let numeric = self.ordered(filter, None, "value", false)?;
            let mut q=self.connection.prepare(&format!("SELECT e.value FROM {numeric} o JOIN events e ON e.r=o.r WHERE o.pos>? AND o.pos<=? ORDER BY o.pos")).map_err(err)?;
            let skip = visible - n + (n.saturating_sub(1)) / 2;
            let middle = q
                .query_map(
                    params![
                        skip as i64,
                        (skip + if n.is_multiple_of(2) { 2 } else { 1 }) as i64
                    ],
                    |r| r.get::<_, Option<f64>>(0),
                )
                .map_err(err)?
                .filter_map(|r| r.ok().flatten())
                .collect::<Vec<_>>();
            stats["median"] = json!(if middle.is_empty() {
                0.
            } else {
                middle.iter().sum::<f64>() / middle.len() as f64
            });
            stats
        } else {
            Value::Null
        };
        let mut q=self.connection.prepare(&format!("SELECT e.source,count(*),sum(e.r IN (SELECT r FROM {table})) FROM events e GROUP BY e.source ORDER BY e.source LIMIT 5000")).map_err(err)?;
        let rows=q.query_map([],|r|Ok(json!({"source":r.get::<_,String>(0)?,"count":r.get::<_,u64>(1)?,"visible":r.get::<_,u64>(2)?,"enabled":!filter.hidden_sources.contains(&r.get::<_,String>(0)?)}))).map_err(err)?;
        let layers = rows.collect::<Result<Vec<_>, _>>().map_err(err)?;
        let result = json!({"count":self.count()?,"visible":visible,"time_bounds":[lo,hi],"entities":groups("entity")?,"categories":groups("category")?,"histogram":histogram,"layers":layers,"stats":stats,"category_limit":5000});
        self.cache_summary(key, &result, false)?;
        Ok(result)
    }
    // Independent of viewport/filter and bounded selection IDs: a selected row
    // must remain shaded even when its events are outside the current window.
    // Cache against selection/data changes, never per playback frame.
    fn selected_entities(&self) -> Result<Value, String> {
        if let Some((data, selection, value)) = self.selected_entities_cache.borrow().as_ref() {
            if *data == self.data_revision && *selection == self.selection_revision {
                return Ok(value.clone());
            }
        }
        let mut query = self.connection.prepare(
            "SELECT e.entity,count(*) FROM selection s JOIN events e ON e.id=s.id GROUP BY e.entity ORDER BY e.entity LIMIT 5000",
        ).map_err(err)?;
        let mut entities = serde_json::Map::new();
        for row in query
            .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, u64>(1)?)))
            .map_err(err)?
        {
            let (name, count) = row.map_err(err)?;
            entities.insert(name, json!(count));
        }
        let result = Value::Object(entities);
        *self.selected_entities_cache.borrow_mut() =
            Some((self.data_revision, self.selection_revision, result.clone()));
        Ok(result)
    }
    fn selected_histogram(&self, filter: &Filter) -> Result<Value, String> {
        let key = serde_json::to_string(&(self.data_revision, self.selection_revision, filter))
            .map_err(err)?;
        if let Some(v) = self.selection_summary_cache.borrow().get(&key) {
            return Ok(v.clone());
        }
        let (lo, hi) = self.time_bounds()?;
        let (clause, conditions) = Self::where_sql(filter, None);
        let mut parameters = vec![SqlValue::Real(lo), SqlValue::Real(hi)];
        parameters.extend(conditions);
        let mut q=self.connection.prepare(&format!("SELECT min(99,cast((e.time-?1)*100.0/(?2-?1) AS INTEGER)),count(*) FROM events e WHERE e.id IN (SELECT id FROM selection) AND {clause} GROUP BY 1")).map_err(err)?;
        let mut histogram = vec![0u64; 100];
        for row in q
            .query_map(rusqlite::params_from_iter(parameters), |r| {
                Ok((r.get::<_, usize>(0)?, r.get::<_, u64>(1)?))
            })
            .map_err(err)?
        {
            let (bin, count) = row.map_err(err)?;
            histogram[bin] = count;
        }
        let result = json!(histogram);
        self.cache_summary(key, &result, true)?;
        Ok(result)
    }
    pub fn histogram_in_range(&self, filter: &Filter, lo: f64, hi: f64) -> Result<Value, String> {
        let key = serde_json::to_string(&(
            "gis-global-time",
            self.data_revision,
            self.selection_revision,
            filter,
            lo,
            hi,
        ))
        .map_err(err)?;
        if let Some(hit) = self.selection_summary_cache.borrow().get(&key) {
            return Ok(hit.clone());
        }
        let table = self.ordered(filter, None, "time", false)?;
        let sql=format!("SELECT min(99,max(0,cast((e.time-?1)*100.0/(?2-?1) AS INTEGER))),count(*),sum(EXISTS(SELECT 1 FROM selection s WHERE s.id=e.id)) FROM {table} o JOIN events e ON e.r=o.r GROUP BY 1");
        let mut q = self.connection.prepare(&sql).map_err(err)?;
        let mut rows = q
            .query(params![lo, hi.max(lo + f64::EPSILON)])
            .map_err(err)?;
        let mut counts = vec![0u64; 100];
        let mut selected = vec![0u64; 100];
        while let Some(row) = rows.next().map_err(err)? {
            let index: usize = row.get(0).map_err(err)?;
            counts[index] = row.get(1).map_err(err)?;
            selected[index] = row.get(2).map_err(err)?;
        }
        let result = json!({"histogram":counts,"selected_histogram":selected});
        self.cache_summary(key, &result, true)?;
        Ok(result)
    }
    pub fn compact_summary(&self, filter: &Filter) -> Result<Value, String> {
        let (clause, args) = Self::where_sql(filter, None);
        let count: usize = self
            .connection
            .query_row(
                &format!("SELECT count(*) FROM events e WHERE {clause}"),
                rusqlite::params_from_iter(args),
                |r| r.get(0),
            )
            .map_err(err)?;
        Ok(json!({"count":self.count()?,"visible":count,"time_bounds":self.time_bounds()?}))
    }
}
