//! On-device tool discovery and dispatch share the hosted SI's grants and engine.
use super::*;
const RESULT_BYTES: usize = 4096;

pub(super) struct Tools {
    workspace: String,
    available: Vec<Value>,
    external: Vec<crate::mcp_client::Exposed>,
    edits: bool,
    external_actions: bool,
}
impl Tools {
    pub(super) fn new(
        engine: &Engine,
        edits: bool,
        external_actions: bool,
    ) -> Result<Self, String> {
        let external = engine.mcp_client.exposed(external_actions)?;
        let mut available = super::tools(edits, false);
        available.extend(external.iter().map(|t| t.schema.clone()));
        if available.len() > 128 {
            return Err(
                "RESOURCE_LIMIT: SI supports at most 128 tools; disable unused external grants"
                    .into(),
            );
        }
        Ok(Self {
            workspace: crate::operation::workspace()
                .map(Ok)
                .unwrap_or_else(|| engine.workspace_identity())?,
            available,
            external,
            edits,
            external_actions,
        })
    }
    pub(super) fn names(&self) -> Vec<String> {
        self.available
            .iter()
            .map(|t| t["function"]["name"].as_str().unwrap().to_string())
            .collect()
    }
    pub(super) fn overview(&self) -> Value {
        let names = self.names();
        let entry_points: Vec<_> = [
            "query",
            "field_profile",
            "aggregate",
            "statistics",
            "chart_data",
            "pattern_scan",
            "analytics_discover",
            "dataset_schema",
        ]
        .into_iter()
        .map(|n| format!("chronoscope_{n}"))
        .filter(|n| names.contains(n))
        .collect();
        json!({"available_count":names.len(),"entry_points":entry_points,
            "discovery":"tool_catalog with no search browses all allowed tools; tool_schema gives exact inputs"})
    }
    fn definition(&self, name: &str) -> Result<&Value, String> {
        let local = format!("chronoscope_{name}");
        self.available
            .iter()
            .map(|t| &t["function"])
            .find(|f| f["name"] == name || f["name"] == local)
            .ok_or_else(|| {
                "SCOPE_DENIED: tool is unavailable for this message; inspect tool_catalog".into()
            })
    }
    pub(super) fn execute(
        &self,
        engine: &Engine,
        name: &str,
        args: Value,
    ) -> Result<Value, String> {
        crate::operation::with_workspace(self.workspace.clone(), || {
            engine.check_workspace()?;
            let result = self.execute_inner(engine, name, args);
            engine.check_workspace()?;
            result
        })
    }
    fn execute_inner(&self, engine: &Engine, name: &str, mut args: Value) -> Result<Value, String> {
        crate::operation::check()?;
        if !args.is_object() {
            return Err("INVALID_ARGUMENT: tool arguments must be an object".into());
        }
        if name == "tool_catalog" {
            if args
                .as_object()
                .unwrap()
                .keys()
                .any(|k| k != "search" && k != "offset")
            {
                return Err("INVALID_ARGUMENT: tool_catalog accepts search and offset".into());
            }
            let search = args["search"].as_str().unwrap_or("").to_lowercase();
            let offset = args["offset"].as_u64().unwrap_or(0) as usize;
            let terms: Vec<_> = search
                .split(|c: char| !c.is_alphanumeric() && c != '_')
                .filter(|s| s.len() >= 3)
                .collect();
            let matches: Vec<_> = self
                .available
                .iter()
                .map(|t| &t["function"])
                .filter(|f| {
                    let text = format!("{} {}", f["name"], f["description"]).to_lowercase();
                    search.is_empty()
                        || text.contains(&search)
                        || terms.iter().any(|term| text.contains(term))
                })
                .collect();
            let tools:Vec<_>=matches.iter().skip(offset).take(8).map(|f|json!({
                "name":f["name"],"description":f["description"].as_str().unwrap_or("").chars().take(180).collect::<String>()
            })).collect();
            let browse: Vec<_> = if matches.is_empty() {
                self.available.iter().take(8).map(|t| json!({
                    "name":t["function"]["name"],
                    "description":t["function"]["description"].as_str().unwrap_or("").chars().take(160).collect::<String>()
                })).collect()
            } else {
                vec![]
            };
            return Ok(json!({"tools":tools,"count":matches.len(),
            "available_count":self.available.len(),"browse_tools":browse,
            "next_offset":if offset+tools.len()<matches.len(){Some(offset+tools.len())}else{None},
            "instruction":if matches.is_empty(){
                "No match for this search, NOT an absence of capabilities. browse_tools are unfiltered examples. Retry tool_catalog without search to browse all allowed tools, then tool_schema."
            } else {
                "Use tool_schema(name) to get validated input parameters, then perform_operation(name, argumentsJSON). count is the number of search matches, not total available tools."
            }}));
        }
        if name == "tool_schema" {
            let requested = args["name"]
                .as_str()
                .ok_or("INVALID_ARGUMENT: tool_schema requires name")?;
            return Ok(self.definition(requested)?.clone());
        }
        let definition = self.definition(name)?;
        let full_name = definition["name"].as_str().unwrap();
        if let Some(external) = self.external.iter().find(|t| t.name == full_name) {
            let result = engine
                .mcp_client
                .call_exposed(external, args, self.external_actions)?;
            if result["isError"] == true {
                return Err("OPERATION_FAILED: external MCP tool returned an error".into());
            }
            return Ok(result);
        }
        let command = full_name
            .strip_prefix("chronoscope_")
            .ok_or("Invalid local tool name")?;
        super::presentation_guard(command, &args, self.edits)?;
        crate::schema::validate(command, &args)?;
        if matches!(command, "query" | "events" | "attribute_table") {
            let limit = args["limit"].as_u64().unwrap_or(10).min(25);
            args["limit"] = json!(limit);
            if args.get("fields").is_none() {
                args["fields"] = json!([
                    "id", "entity", "time_utc", "year_utc", "lat", "lon", "category", "value"
                ]);
            }
        }
        if command == "snapshot" {
            args["compact"] = json!(true);
            args["include_statistics"] = json!(false);
            args["selection_limit"] = json!(5);
            let result = engine.invoke(command, args)?;
            return Ok(
                json!({"revision":result["revision"],"name":result["name"],"event_count":result["count"],"visible_count":result["visible"],"selected_count":result["selected_count"],"selected":result["selected"],"time_bounds_utc":result["time_bounds"],"filter":result["filter"],"view":result["scene"]["mode"]}),
            );
        }
        if command == "dataset_schema" && args.get("attribute_limit").is_none() {
            args["attribute_limit"] = json!(8);
        }
        let projection = args.get("fields").cloned();
        let mut result = engine.invoke(command, args)?;
        if command == "dataset_schema" {
            let object = result.as_object_mut().unwrap();
            for (from, to) in [
                ("attributes", "imported_attributes"),
                ("attribute_count", "matching_imported_column_count"),
                ("attribute_types", "imported_attribute_types"),
            ] {
                if let Some(value) = object.remove(from) {
                    object.insert(to.into(), value);
                }
            }
            result["schema_only"] = json!(true);
            result["instruction"] = json!("Column names/types only, no row values. Zero matching imported columns says nothing about canonical field values. To answer any question about a field's data, call inspect_fields with that field and the requested scope. Unknown/unread is not empty.");
        }
        if command == "field_profile" {
            // Preserve exact counts; remove complete examples only if the local
            // model's context budget requires it. Never replace real text with
            // a pretend value or discard an evidence cursor.
            while result.to_string().len() > RESULT_BYTES {
                let profiles = result["profiles"].as_array_mut().unwrap();
                let Some(profile) = profiles
                    .iter_mut()
                    .rev()
                    .find(|p| p["examples"].as_array().is_some_and(|v| !v.is_empty()))
                else {
                    break;
                };
                profile["examples"].as_array_mut().unwrap().pop();
                profile["examples_omitted_for_context"] = json!(true);
            }
        }
        if matches!(command, "query" | "events" | "attribute_table") {
            if let Some(object) = result.as_object_mut() {
                for key in [
                    "columns",
                    "columns_limited",
                    "total_columns",
                    "column_offset",
                ] {
                    object.remove(key);
                }
                object.insert("projection".into(), projection.unwrap_or(Value::Null));
            }
        }
        Ok(result)
    }
}

pub(super) fn bounded(value: Value) -> Value {
    let bytes = value.to_string().len();
    if bytes <= RESULT_BYTES {
        value
    } else {
        // Never return a partial row or a cursor that skips rows omitted here.
        let mut omitted = json!({"result_omitted":true,"operation_completed":true,"revision":value["revision"],"bytes":bytes,
            "instruction":"Output exceeds the on-device context budget; no result rows are included. Query fewer fields/rows, use an exact aggregate, or inspect analytics_result by result_id. Do not infer unseen records or repeat a completed mutation."});
        if let Some(id) = value.get("result_id") {
            omitted["result_id"] = id.clone();
        }
        omitted
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn engine(dir: &std::path::Path) -> Engine {
        Engine::new(
            crate::project::Project::new(crate::demo::dataset()),
            dir.into(),
        )
        .unwrap()
    }
    #[test]
    fn tool_initialization_keeps_the_original_request_document_after_open() {
        let d = tempfile::tempdir().unwrap();
        let e = engine(d.path());
        let original = e.workspace_identity().unwrap();
        let path = d.path().join("replacement.json");
        std::fs::write(
            &path,
            serde_json::to_vec(&crate::project::Project::new(crate::demo::dataset())).unwrap(),
        )
        .unwrap();
        e.invoke("open", json!({"path":path})).unwrap();
        // Provider setup can race with Open before native callbacks move to
        // another thread. Tools must retain the enclosing request's identity.
        let tools =
            crate::operation::with_workspace(original, || Tools::new(&e, true, false)).unwrap();
        let callback_engine = e.clone();
        let result = std::thread::spawn(move || {
            tools.execute(
                &callback_engine,
                "edit",
                json!({"id":"1","changes":{"note":"must never be written"}}),
            )
        })
        .join()
        .unwrap();
        assert!(result.unwrap_err().starts_with("CONFLICT:"));
        assert_ne!(
            e.invoke("events", json!({"id":"1"})).unwrap()["events"][0]["note"],
            "must never be written"
        );
    }
    #[test]
    fn broad_discovery_preserves_available_capabilities_and_grants() {
        let d = tempfile::tempdir().unwrap();
        let e = engine(d.path());
        let t = Tools::new(&e, false, false).unwrap();
        let broad = t
            .execute(
                &e,
                "tool_catalog",
                json!({"search":"explore raw dataset query statistics"}),
            )
            .unwrap();
        assert!(broad["tools"]
            .as_array()
            .unwrap()
            .iter()
            .any(|v| v["name"] == "chronoscope_query"));
        let absent = t
            .execute(
                &e,
                "tool_catalog",
                json!({"search":"zzunmatchedcapabilityzz"}),
            )
            .unwrap();
        assert_eq!(absent["count"], 0);
        assert!(absent["available_count"].as_u64().unwrap() > 20);
        assert!(!absent["browse_tools"].as_array().unwrap().is_empty());
        let overview = t.overview();
        for command in [
            "query",
            "aggregate",
            "statistics",
            "pattern_scan",
            "chart_data",
        ] {
            assert!(overview["entry_points"]
                .as_array()
                .unwrap()
                .contains(&json!(format!("chronoscope_{command}"))));
            assert!(t
                .execute(&e, "tool_schema", json!({"name":command}))
                .is_ok());
        }
        assert!(t
            .execute(&e, "tool_schema", json!({"name":"delete"}))
            .is_err());
    }
    #[test]
    fn catalog_schema_and_queries_use_real_records_and_preserve_exact_ids() {
        let d = tempfile::tempdir().unwrap();
        let e = engine(d.path());
        let t = Tools::new(&e, false, false).unwrap();
        let catalog = t
            .execute(&e, "tool_catalog", json!({"search":"query"}))
            .unwrap();
        assert!(catalog["tools"]
            .as_array()
            .unwrap()
            .iter()
            .any(|v| v["name"] == "chronoscope_query"));
        assert!(t
            .execute(&e, "tool_schema", json!({"name":"query"}))
            .unwrap()["parameters"]
            .is_object());
        let rows = t
            .execute(
                &e,
                "query",
                json!({"limit":1000,"fields":["id","time_utc","year_utc"]}),
            )
            .unwrap();
        assert_eq!(rows["events"].as_array().unwrap().len(), 25);
        assert!(rows["events"][0]["id"].is_string());
        assert!(rows["events"][0]["year_utc"].is_number());
        assert!(rows["next_cursor"].is_string());
        assert!(t.execute(&e, "query", json!({"limit":"wrong"})).is_err());
        assert!(t
            .execute(&e, "tool_schema", json!({"name":"si_configure"}))
            .is_err());
        assert!(t.execute(&e, "client_call", json!({})).is_err());
        assert!(t
            .execute(&e, "save", json!({"path":"/tmp/ungranted"}))
            .is_err());
    }
    #[test]
    fn reads_presentation_and_edit_grants_are_distinct() {
        let d = tempfile::tempdir().unwrap();
        let e = engine(d.path());
        let read = Tools::new(&e, false, false).unwrap();
        let id = e
            .invoke("query", json!({"limit":1,"fields":["id"]}))
            .unwrap()["events"][0]["id"]
            .clone();
        read.execute(&e, "select", json!({"ids":[id],"mode":"replace"}))
            .unwrap();
        read.execute(&e, "view_set", json!({"mode":"map"})).unwrap();
        let before = e.invoke("revision", json!({})).unwrap();
        assert!(read
            .execute(&e, "delete", json!({"ids":[id]}))
            .unwrap_err()
            .starts_with("SCOPE_DENIED:"));
        assert_eq!(before, e.invoke("revision", json!({})).unwrap());
        assert!(read
            .execute(
                &e,
                "field_roles_set",
                json!({"assignments":{"value":"measurement"}})
            )
            .unwrap_err()
            .starts_with("SCOPE_DENIED:"));
        let edit = Tools::new(&e, true, false).unwrap();
        edit.execute(
            &e,
            "field_roles_set",
            json!({"assignments":{"value":"measurement"}}),
        )
        .unwrap();

        edit.execute(&e, "tag", json!({"value":"Reviewed"}))
            .unwrap();
        let row = e
            .invoke("query", json!({"limit":1,"fields":["tags"]}))
            .unwrap();
        assert!(row["events"][0]["tags"]
            .as_array()
            .unwrap()
            .contains(&json!("Reviewed")));
        assert!(!read.names().contains(&"chronoscope_delete".to_owned()));
        assert!(edit.names().contains(&"chronoscope_delete".to_owned()));
    }
    #[test]
    fn native_analytics_grant_returns_evidence_and_handle_within_context_budget() {
        let d = tempfile::tempdir().unwrap();
        let e = engine(d.path());
        let tools = Tools::new(&e, false, false).unwrap();
        let result = tools.execute(&e, "analytics_run", json!({"plan":{"capability":"quantiles","scope":"all","parameters":{"field":"value","probabilities":[0.5]}}})).unwrap();
        let compact = bounded(result);
        assert!(compact["result_id"].is_string());
        assert!(compact["findings_preview"][0]["value"].is_number());
        assert!(compact["result_omitted"].is_null());
        assert!(tools.execute(&e, "delete", json!({"ids":["1"]})).is_err());
    }
    #[test]
    fn wide_results_are_explicitly_omitted_without_inventing_a_cursor() {
        let result = bounded(
            json!({"revision":4,"rows":[{"note":"x".repeat(9000)}],"next_cursor":"would-skip-evidence"}),
        );
        assert_eq!(result["result_omitted"], true);
        assert!(result.get("rows").is_none());
        assert!(result.get("next_cursor").is_none());
    }
    #[test]
    fn schema_is_metadata_and_generic_field_evidence_reads_requested_values() {
        let d = tempfile::tempdir().unwrap();
        let e = engine(d.path());
        let tools = Tools::new(&e, false, false).unwrap();
        let schema = tools
            .execute(&e, "dataset_schema", json!({"attribute_search":"label"}))
            .unwrap();
        assert_eq!(schema["schema_only"], true);
        assert_eq!(schema["matching_imported_column_count"], 0);
        for field in ["label", "attribute:confidence", "time_utc", "tags"] {
            let result = tools
                .execute(&e, "field_profile", json!({"fields":[field],"scope":"all"}))
                .unwrap();
            assert_eq!(result["input_count"], 192);
            assert!(bounded(result.clone())["result_omitted"].is_null());
            let preview = super::super::chat::tool_preview("field_profile", &result).unwrap();
            assert_eq!(preview["rows"][0]["field"], field);
            assert!(preview["rows"][0].get("value").is_some());
        }
    }
    #[test]
    fn context_reduction_keeps_exact_profiles_and_marks_omitted_examples() {
        let d = tempfile::tempdir().unwrap();
        let mut data = crate::demo::dataset();
        data.events.truncate(6);
        for (index, event) in data.events.iter_mut().enumerate() {
            let text = format!("{index}{}", "long text ".repeat(140));
            event.label = text.clone();
            event.note = text.clone();
            event.category = text.clone();
            event.entity = text;
        }
        let e = Engine::new(crate::project::Project::new(data), d.path().into()).unwrap();
        let tools = Tools::new(&e, false, false).unwrap();
        let r = tools
            .execute(
                &e,
                "field_profile",
                json!({"fields":["label","note","category","entity"]}),
            )
            .unwrap();
        assert!(r.to_string().len() <= RESULT_BYTES);
        assert_eq!(r["profiles"].as_array().unwrap().len(), 4);
        assert!(r["profiles"]
            .as_array()
            .unwrap()
            .iter()
            .all(|p| p["non_empty_count"] == 6));
        assert!(r["profiles"]
            .as_array()
            .unwrap()
            .iter()
            .any(|p| p["examples_omitted_for_context"] == true));
    }
}
