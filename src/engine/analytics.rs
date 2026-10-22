use super::*;
use crate::analytics::{self, Artifact, Plan};
use rusqlite::OptionalExtension;
fn load(c: &rusqlite::Connection, id: &str) -> Result<Artifact, String> {
    if id.len() != 64 || !id.bytes().all(|b| b.is_ascii_hexdigit()) {
        return Err("INVALID_ARGUMENT: invalid result_id".into());
    }
    let size: Option<u64> = c
        .query_row(
            "SELECT length(CAST(value AS BLOB)) FROM meta WHERE key=?",
            [format!("analytics:{id}")],
            |r| r.get(0),
        )
        .optional()
        .map_err(|e| e.to_string())?;
    if size.is_none() {
        return Err("NOT_FOUND: analysis result is not in this workspace".into());
    }
    if size.unwrap() > analytics::MAX_RESULT_BYTES as u64 {
        return Err("RESOURCE_LIMIT: result metadata exceeds 32 MiB".into());
    }
    let text: String = c
        .query_row(
            "SELECT value FROM meta WHERE key=?",
            [format!("analytics:{id}")],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())?;
    let envelope: Value = serde_json::from_str(&text).map_err(|e| e.to_string())?;
    if envelope["sha256"] != analytics::hash(&envelope["artifact"])? {
        return Err("OPERATION_FAILED: result checksum mismatch".into());
    }
    let artifact: Artifact =
        serde_json::from_value(envelope["artifact"].clone()).map_err(|e| e.to_string())?;
    if artifact.result_id != id {
        return Err("OPERATION_FAILED: result identity mismatch".into());
    }
    Ok(artifact)
}
fn generation(c: &rusqlite::Connection) -> Result<String, String> {
    c.query_row(
        "SELECT value FROM meta WHERE key='analytics_generation'",
        [],
        |r| r.get(0),
    )
    .optional()
    .map(|v| v.unwrap_or_default())
    .map_err(|e| e.to_string())
}
impl Engine {
    pub(super) fn analytics_invoke(&self, command: &str, args: Value) -> Result<Value, String> {
        if command == "analytics_discover" {
            let mut result = analytics::registry::discover(
                args["search"].as_str().unwrap_or(""),
                args["offset"].as_u64().unwrap_or(0) as usize,
            );
            let s = self.state.lock().map_err(|_| "Workspace unavailable")?;
            result["dataset"] = json!({"revision":s.revision,"event_count":s.store.count()?,"fields_command":"dataset_schema","selection_count":s.project.selected.len()});
            return Ok(result);
        }
        if command == "analytics_describe" {
            return analytics::registry::describe(args["capability"].as_str().unwrap());
        }
        if command == "analytics_list" {
            let s = self.state.lock().map_err(|_| "Workspace unavailable")?;
            let gen = generation(&s.store.connection)?;
            let mut q=s.store.connection.prepare("SELECT substr(key,11) FROM meta WHERE key GLOB 'analytics:*' ORDER BY key LIMIT 32").map_err(|e|e.to_string())?;
            let ids = q
                .query_map([], |r| r.get::<_, String>(0))
                .map_err(|e| e.to_string())?
                .collect::<Result<Vec<_>, _>>()
                .map_err(|e| e.to_string())?;
            let mut results = vec![];
            for id in ids {
                let a = load(&s.store.connection, &id)?;
                results.push(json!({"result_id":id,"capability":a.capability,"created_utc":a.created_utc,"data_stale":a.generation!=gen,"total_rows":a.total_rows,"limited":a.limited}));
            }
            return Ok(json!({"results":results,"revision":s.revision}));
        }
        if command == "analytics_result" {
            let s = self.state.lock().map_err(|_| "Workspace unavailable")?;
            let a = load(&s.store.connection, args["result_id"].as_str().unwrap())?;
            let gen = generation(&s.store.connection)?;
            let mut result = a.preview(&gen);
            if let Some(fields) = args["summary_fields"].as_array() {
                let mut selected = serde_json::Map::new();
                for key in fields {
                    let key = key.as_str().unwrap();
                    if let Some(value) = a.summary.get(key) {
                        selected.insert(key.into(), value.clone());
                    }
                }
                result["summary"] = Value::Object(selected);
            }
            let offset = args["offset"].as_u64().unwrap_or(0) as usize;
            let limit = args["limit"].as_u64().unwrap_or(10) as usize;
            match args["section"].as_str().unwrap_or("summary") {
                "details" => {
                    result["summary"] = a.summary.clone();
                    result["chart"] = a.chart.clone();
                }
                "rows" => {
                    let rows: Vec<_> = a.rows.iter().skip(offset).take(limit).cloned().collect();
                    let next = offset.saturating_add(rows.len());
                    result["rows"] = json!(rows);
                    result["offset"] = json!(offset);
                    result["next_offset"] = json!(if next < a.rows.len() {
                        Some(next)
                    } else {
                        None
                    });
                }
                "chart" => {
                    result["chart"] = a.chart;
                    result["rows"] =
                        json!(a.rows.iter().skip(offset).take(limit).collect::<Vec<_>>());
                }
                "provenance" => {
                    result["scope"] = a.scope;
                    result["parameters"] = a.parameters;
                    result["prepare"] = json!(a.preparation);
                    result["generation"] = json!(a.generation);
                }
                _ => {}
            }
            if result.to_string().len() > 1024 * 1024 {
                return Err("RESOURCE_LIMIT: result page exceeds 1 MiB; reduce limit".into());
            }
            return Ok(result);
        }
        if command == "analytics_remove" {
            let _gate = self.operation.lock().map_err(|_| "Workspace unavailable")?;
            let mut s = self.state.lock().map_err(|_| "Workspace unavailable")?;
            self.check_workspace_locked(&s)?;
            let id = args["result_id"].as_str().unwrap();
            let removed = s
                .store
                .connection
                .execute("DELETE FROM meta WHERE key=?", [format!("analytics:{id}")])
                .map_err(|e| e.to_string())?
                > 0;
            if removed {
                s.revision += 1;
                self.revision_counter
                    .store(s.revision, std::sync::atomic::Ordering::Release);
            }
            let revision = s.revision;
            drop(s);
            if removed {
                self.complete_workspace_change("analytics_remove", revision, None, false);
            }
            return Ok(json!({"removed":removed,"result_id":id,"revision":revision}));
        }
        let _worker = loop {
            crate::operation::check()?;
            match self.analytics_worker.try_lock() {
                Ok(g) => break g,
                Err(std::sync::TryLockError::WouldBlock) => {
                    std::thread::sleep(std::time::Duration::from_millis(25))
                }
                Err(_) => return Err("OPERATION_FAILED: analytics worker unavailable".into()),
            }
        };
        let plan: Plan = serde_json::from_value(args["plan"].clone())
            .map_err(|e| format!("INVALID_ARGUMENT: {e}"))?;
        plan.validate()?;
        // Pin a WAL read view under the brief state lock. All projection, grouping
        // and numerical work below happens after releasing both workspace locks.
        let (read, filter, selection, revision, identity, gen, cached_id) = {
            let _gate = loop {
                crate::operation::check()?;
                match self.operation.try_lock() {
                    Ok(g) => break g,
                    Err(std::sync::TryLockError::WouldBlock) => {
                        std::thread::sleep(std::time::Duration::from_millis(25))
                    }
                    Err(_) => return Err("Workspace unavailable".into()),
                }
            };
            let s = self.state.lock().map_err(|_| "Workspace unavailable")?;
            self.check_workspace_locked(&s)?;
            if args["expected_revision"]
                .as_u64()
                .is_some_and(|r| r != s.revision)
            {
                return Err("CONFLICT: analytics source revision changed".into());
            }
            let mut scope_args = args.clone();
            scope_args["apply_filter"] = json!(plan.scope != "all");
            scope_args["selected_only"] = json!(plan.scope == "selected");
            let filter = query_filter(&s.project, &scope_args, true)?;
            let read = s.store.analytics_read()?;
            let gen = generation(&read.connection)?;
            let selected = if filter.selected_only {
                s.project.selected.clone()
            } else {
                BTreeSet::new()
            };
            let id = analytics::hash(
                &json!({"generation":gen,"algorithm_version":analytics::ALGORITHM_VERSION,"plan":plan,"filter":filter,"source":args["source"],"selection":selected}),
            )?;
            match load(&s.store.connection, &id) {
                Ok(a) => return Ok(a.preview(&gen)),
                Err(e) if e.starts_with("NOT_FOUND:") => {}
                Err(e) => return Err(e),
            }
            (
                read,
                filter,
                selected,
                s.revision,
                s.store.identity(),
                gen,
                id,
            )
        };
        let scope = json!({"filter":filter,"source":args["source"],"selected_count":selection.len(),"selection_sha256":analytics::hash(&selection)?});
        let input =
            analytics::Input::build(read, &filter, args["source"].as_str(), &selection, &plan)?;
        crate::operation::progress(0, Some(input.count), "Computing analysis in Rust");
        let output = analytics::execute(&input, &plan)?;
        crate::operation::check()?;
        let artifact = Artifact {
            result_id: cached_id.clone(),
            capability: plan.capability.clone(),
            source_revision: revision,
            generation: gen,
            scope,
            input_count: input.input_count,
            prepared_count: input.count,
            evaluated_count: output.evaluated,
            excluded_count: output.excluded,
            sampled: false,
            algorithm_version: analytics::ALGORITHM_VERSION,
            created_utc: chrono::Utc::now().to_rfc3339(),
            parameters: plan.parameters,
            preparation: plan.prepare,
            summary: output.summary,
            limited: output.total_rows > output.rows.len() as u64,
            rows: output.rows,
            total_rows: output.total_rows,
            chart: output.chart,
            warnings: output.warnings,
        };
        let body = serde_json::to_value(&artifact).map_err(|e| e.to_string())?;
        let text = json!({"sha256":analytics::hash(&body)?,"artifact":body}).to_string();
        if text.len() > analytics::MAX_RESULT_BYTES {
            return Err("RESOURCE_LIMIT: result exceeds 32 MiB; reduce output_limit (the calculation still uses the full input)".into());
        }
        drop(input);
        let _gate = loop {
            crate::operation::check()?;
            match self.operation.try_lock() {
                Ok(g) => break g,
                Err(std::sync::TryLockError::WouldBlock) => {
                    std::thread::sleep(std::time::Duration::from_millis(25))
                }
                Err(_) => return Err("Workspace unavailable".into()),
            }
        };
        let mut s = self.state.lock().map_err(|_| "Workspace unavailable")?;
        self.check_workspace_locked(&s)?;
        if identity != s.store.identity() {
            return Err("CONFLICT: a different project was opened during analysis; result was not attached to it".into());
        }
        let (count,bytes):(u64,u64)=s.store.connection.query_row("SELECT count(*),coalesce(sum(length(CAST(value AS BLOB))),0) FROM meta WHERE key GLOB 'analytics:*'",[],|r|Ok((r.get(0)?,r.get(1)?))).map_err(|e|e.to_string())?;
        if count >= 32 || bytes + text.len() as u64 > 256 * 1024 * 1024 {
            return Err("RESOURCE_LIMIT: persistent analysis store has reached 32 results or 256 MiB; remove unneeded results with analytics_remove or the Results window".into());
        }
        crate::operation::check()?;
        s.store
            .connection
            .execute(
                "INSERT OR REPLACE INTO meta VALUES(?,?)",
                rusqlite::params![format!("analytics:{cached_id}"), text],
            )
            .map_err(|e| e.to_string())?;
        s.revision += 1;
        let current = s.revision;
        self.revision_counter
            .store(current, std::sync::atomic::Ordering::Release);
        let result = artifact.preview(&generation(&s.store.connection)?);
        drop(s);
        self.complete_workspace_change("analytics_run", current, None, false);
        crate::operation::progress(1, Some(1), "Analysis result stored");
        Ok(result)
    }
}
