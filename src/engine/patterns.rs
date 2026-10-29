use super::*;
use crate::{
    analytics::Input,
    pattern_scan::{self, Config, Report, Response},
};
#[derive(Clone)]
pub(super) struct CachedScan {
    pub config: Config,
    pub report: Report,
}
fn config(args: &Value) -> Result<Config, String> {
    let c: Config = serde_json::from_value(args.get("config").cloned().unwrap_or(json!({})))
        .map_err(|e| format!("INVALID_ARGUMENT: {e}"))?;
    c.validate()?;
    Ok(c)
}
pub(super) fn key(s: &State, c: &Config) -> Result<String, String> {
    let mut filter = query_filter(
        &s.project,
        &json!({"selected_only":c.scope=="selected"}),
        true,
    )?;
    filter.facet_hidden.retain(|_, values| !values.is_empty());
    filter
        .facet_fields
        .retain(|kind, _| filter.facet_hidden.contains_key(kind));
    crate::analytics::hash(
        &json!({"algorithm":1,"workspace":s.store.opaque_identity(),"data":s.store.data_revision,"selection":if filter.selected_only {s.store.selection_version()}else{0},"filter":filter,"config":c}),
    )
}
impl Engine {
    pub(super) fn pattern_scan(&self, args: Value) -> Result<Value, String> {
        let c = config(&args)?;
        {
            let _gate =
                super::view_identity::cooperative_lock(&self.operation, "Workspace operation")
                    .map_err(|e| e.to_string())?;
            let s = self.state.lock().map_err(|_| "Workspace unavailable")?;
            self.check_workspace_locked(&s)?;
            if args["expected_revision"]
                .as_u64()
                .is_some_and(|r| r != s.revision)
            {
                return Err("CONFLICT: workspace changed before pattern scan".into());
            }
            let scan_id = key(&s, &c)?;
            let cached = self
                .pattern_cache
                .lock()
                .map_err(|_| "Pattern cache unavailable")?
                .get(&scan_id)
                .cloned();
            if cached.is_some() || args["cached_only"] == true {
                return serde_json::to_value(Response {
                    revision: s.revision,
                    scan_id,
                    cache_hit: cached.is_some(),
                    report: cached.map(|v| v.report),
                })
                .map_err(|e| e.to_string());
            }
        }
        let _worker = loop {
            crate::operation::check()?;
            match self.analytics_worker.try_lock() {
                Ok(g) => break g,
                Err(std::sync::TryLockError::WouldBlock) => {
                    std::thread::sleep(std::time::Duration::from_millis(25))
                }
                Err(_) => return Err("Analytics worker unavailable".into()),
            }
        };
        let (read, filter, selected, revision, scan_id) = {
            let _gate =
                super::view_identity::cooperative_lock(&self.operation, "Workspace operation")
                    .map_err(|e| e.to_string())?;
            let s = self.state.lock().map_err(|_| "Workspace unavailable")?;
            self.check_workspace_locked(&s)?;
            if args["expected_revision"]
                .as_u64()
                .is_some_and(|r| r != s.revision)
            {
                return Err("CONFLICT: workspace changed while waiting for pattern scan".into());
            }
            let id = key(&s, &c)?;
            if let Some(cache) = self
                .pattern_cache
                .lock()
                .map_err(|_| "Pattern cache unavailable")?
                .get(&id)
                .cloned()
            {
                return serde_json::to_value(Response {
                    revision: s.revision,
                    scan_id: id,
                    cache_hit: true,
                    report: Some(cache.report),
                })
                .map_err(|e| e.to_string());
            }
            (
                s.store.analytics_read()?,
                query_filter(
                    &s.project,
                    &json!({"selected_only":c.scope=="selected"}),
                    true,
                )?,
                if c.scope == "selected" || s.project.filter.selected_only {
                    s.project.selected.clone()
                } else {
                    BTreeSet::new()
                },
                s.revision,
                id,
            )
        };
        crate::operation::progress(0, None, "Discovering numeric columns");
        let mut fields = c.fields.clone();
        let mut warnings = vec![];
        if fields.is_empty() {
            fields.push("value".into());
            let mut query=read.connection.prepare("SELECT DISTINCT key FROM attributes WHERE num IS NOT NULL ORDER BY key LIMIT 513").map_err(|e|e.to_string())?;
            let names = query
                .query_map([], |r| r.get::<_, String>(0))
                .map_err(|e| e.to_string())?
                .collect::<Result<Vec<_>, _>>()
                .map_err(|e| e.to_string())?;
            let candidates = names
                .iter()
                .take(512)
                .filter(|n| pattern_scan::automatic_field(n))
                .collect::<Vec<_>>();
            fields.extend(candidates.iter().take(7).map(|n| format!("attribute:{n}")));
            if candidates.len() > 7 || names.len() == 513 {
                warnings.push("Automatic discovery examines at most 512 numeric imported column names and scans Value plus the first seven eligible imported columns. Choose fields in Scan options to inspect other columns; records within each chosen column are not sampled.".into());
            }
            warnings.push("Automatic field choices exclude coordinate, calendar and identifier-named imported columns. Names do not establish semantic meaning or units; review the chosen columns.".into());
        }
        let plan = c.plan(&fields);
        plan.validate()?;
        let input = Input::build(read, &filter, None, &selected, &plan)?;
        let report = pattern_scan::scan(&input, c.clone(), fields, warnings)?;
        drop(input);
        crate::operation::check()?;
        if serde_json::to_vec(&report)
            .map_err(|e| e.to_string())?
            .len()
            > 2 * 1024 * 1024
        {
            return Err("RESOURCE_LIMIT: pattern report exceeds 2 MiB; reduce fields".into());
        }
        let mut cache = self
            .pattern_cache
            .lock()
            .map_err(|_| "Pattern cache unavailable")?;
        if cache.len() >= 4 {
            cache.clear();
        }
        cache.insert(
            scan_id.clone(),
            CachedScan {
                config: c,
                report: report.clone(),
            },
        );
        serde_json::to_value(Response {
            revision,
            scan_id,
            cache_hit: false,
            report: Some(report),
        })
        .map_err(|e| e.to_string())
    }
    pub(super) fn pattern_members(&self, args: &Value) -> Result<(BTreeSet<u64>, u64), String> {
        let id = args["pattern_scan_id"]
            .as_str()
            .ok_or("INVALID_ARGUMENT: pattern_scan_id required")?;
        let cached = self
            .pattern_cache
            .lock()
            .map_err(|_| "Pattern cache unavailable")?
            .get(id)
            .cloned()
            .ok_or("CONFLICT: pattern scan expired; press Find patterns again")?;
        let finding = cached
            .report
            .findings
            .iter()
            .find(|f| Some(f.id.as_str()) == args["pattern_finding_id"].as_str())
            .ok_or("INVALID_ARGUMENT: unknown pattern finding")?;
        let _worker = loop {
            crate::operation::check()?;
            match self.analytics_worker.try_lock() {
                Ok(g) => break g,
                Err(std::sync::TryLockError::WouldBlock) => {
                    std::thread::sleep(std::time::Duration::from_millis(25))
                }
                Err(_) => return Err("Analytics worker unavailable".into()),
            }
        };
        let (read, filter, selected, revision) = {
            let _gate =
                super::view_identity::cooperative_lock(&self.operation, "Workspace operation")
                    .map_err(|e| e.to_string())?;
            let s = self.state.lock().map_err(|_| "Workspace unavailable")?;
            self.check_workspace_locked(&s)?;
            if key(&s, &cached.config)? != id
                || args["expected_revision"]
                    .as_u64()
                    .is_some_and(|r| r != s.revision)
            {
                return Err(
                    "CONFLICT: pattern scope or data changed; press Find patterns again".into(),
                );
            }
            (
                s.store.analytics_read()?,
                query_filter(
                    &s.project,
                    &json!({"selected_only":cached.config.scope=="selected"}),
                    true,
                )?,
                if cached.config.scope == "selected" || s.project.filter.selected_only {
                    s.project.selected.clone()
                } else {
                    BTreeSet::new()
                },
                s.revision,
            )
        };
        let plan = cached.config.plan(&cached.report.inspected_fields);
        let input = Input::build(read, &filter, None, &selected, &plan)?;
        Ok((pattern_scan::members(&input, &finding.evidence)?, revision))
    }
}
