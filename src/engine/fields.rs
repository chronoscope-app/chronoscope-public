//! Field evidence and semantic metadata shared by SI, CLI and MCP. Counts
//! examine the complete requested scope; only examples are bounded. Role
//! updates change project metadata without rewriting source values.
use super::*;
use crate::analytics::{Input, Plan};

impl Engine {
    pub(super) fn field_profile(&self, args: Value) -> Result<Value, String> {
        let scope = args["scope"].as_str().unwrap_or("visible");
        let requested_fields = args["fields"].as_array().unwrap();
        let limit = args["example_limit"].as_u64().unwrap_or(3) as usize;
        let mut plan = Plan {
            capability: "profile".into(),
            scope: scope.into(),
            parameters: json!({"fields":requested_fields}),
            prepare: None,
            output_limit: 4,
        };
        plan.validate()?;
        // Share the existing analytic worker budget; concurrent clients must
        // not create an unbounded number of disk-backed inspection copies.
        let _worker = loop {
            crate::operation::check()?;
            match self.analytics_worker.try_lock() {
                Ok(worker) => break worker,
                Err(std::sync::TryLockError::WouldBlock) => {
                    std::thread::sleep(std::time::Duration::from_millis(25))
                }
                Err(_) => return Err("OPERATION_FAILED: analytics worker unavailable".into()),
            }
        };
        // Pin one revision, then release the workspace lock before scans and
        // disk-backed distinct/group operations. Navigation remains responsive.
        let (read, filter, selected, revision) = {
            let _gate =
                super::view_identity::cooperative_lock(&self.operation, "Workspace operation")
                    .map_err(|e| e.to_string())?;
            let s = self.state.lock().map_err(|_| "Workspace unavailable")?;
            self.check_workspace_locked(&s)?;
            if args["expected_revision"]
                .as_u64()
                .is_some_and(|r| r != s.revision)
            {
                return Err("CONFLICT: workspace changed before field inspection".into());
            }
            let mut scope_args = args.clone();
            scope_args["apply_filter"] = json!(scope != "all");
            scope_args["selected_only"] = json!(scope == "selected");
            let filter = query_filter(&s.project, &scope_args, true)?;
            (
                s.store.analytics_read()?,
                filter,
                s.project.selected.clone(),
                s.revision,
            )
        };
        let mut fields = Vec::new();
        let mut resolved_fields = serde_json::Map::new();
        for field in requested_fields {
            let name = field.as_str().unwrap();
            let canonical = matches!(
                name,
                "id" | "entity"
                    | "time"
                    | "end"
                    | "lat"
                    | "lon"
                    | "category"
                    | "label"
                    | "value"
                    | "related_to"
                    | "tags"
                    | "note"
                    | "source"
                    | "source_row"
                    | "mgrs_precision"
                    | "geometry_wkt"
                    | "location_kind"
                    | "altitude_m"
                    | "altitude_reference"
                    | "attrs"
                    | "time_utc"
                    | "year_utc"
            );
            let resolved = if canonical || name.starts_with("attribute:") {
                name.to_owned()
            } else {
                let exact: bool = read
                    .connection
                    .query_row(
                        "SELECT EXISTS(SELECT 1 FROM attributes WHERE key=?)",
                        [name],
                        |r| r.get(0),
                    )
                    .map_err(|e| e.to_string())?;
                if exact {
                    format!("attribute:{name}")
                } else {
                    let mut q = read
                        .connection
                        .prepare(
                            "SELECT DISTINCT key FROM attributes WHERE lower(key)=lower(?) LIMIT 2",
                        )
                        .map_err(|e| e.to_string())?;
                    let names = q
                        .query_map([name], |r| r.get::<_, String>(0))
                        .map_err(|e| e.to_string())?
                        .collect::<Result<Vec<_>, _>>()
                        .map_err(|e| e.to_string())?;
                    match names.as_slice() {
                        [key]=>format!("attribute:{key}"),
                        []=>return Err(format!("INVALID_ARGUMENT: unknown field {name:?}; inspect dataset_schema. Unread/unknown does not mean empty.")),
                        _=>return Err(format!("INVALID_ARGUMENT: ambiguous imported field {name:?}; specify the exact attribute:<name> from dataset_schema")),
                    }
                }
            };
            if fields.contains(&json!(resolved)) {
                return Err("INVALID_ARGUMENT: fields resolve to duplicate columns".into());
            }
            resolved_fields.insert(name.to_owned(), json!(resolved));
            fields.push(json!(resolved));
        }
        plan.parameters = json!({"fields":fields});
        let input = Input::build(read, &filter, args["source"].as_str(), &selected, &plan)?;
        let mut profiles = vec![];
        for field in &fields {
            crate::operation::check()?;
            let field = field.as_str().unwrap();
            let col = input.col(field)?;
            let collection = matches!(field, "tags" | "attrs");
            let empty_collection = if collection {
                format!("{col} IN ('[]','{{}}')")
            } else {
                "0".into()
            };
            let mut profile = input.rows(&format!("SELECT count({col}) AS present_count,count(DISTINCT {col}) AS distinct_count,count(an_num({col})) AS finite_numeric_count,coalesce(sum(CASE WHEN typeof({col})='text' AND {col}='' THEN 1 ELSE 0 END),0) AS empty_string_count,coalesce(sum(CASE WHEN {empty_collection} THEN 1 ELSE 0 END),0) AS empty_collection_count FROM analytic_input"),vec![],1)?.remove(0);
            profile["field"] = json!(field);
            profile["null_count"] = json!(input.count - profile["present_count"].as_u64().unwrap());
            profile["non_empty_count"] = json!(
                profile["present_count"].as_u64().unwrap()
                    - profile["empty_string_count"].as_u64().unwrap()
                    - profile["empty_collection_count"].as_u64().unwrap()
            );
            profile["stored_types"] = json!(input.rows(&format!("SELECT typeof({col}) AS type,count(*) AS count FROM analytic_input GROUP BY typeof({col})"),vec![],5)?);
            profile["value_kind"] = json!(match field {
                "tags" => "array",
                "attrs" => "object",
                _ => "scalar",
            });
            profile["semantic_type"] = json!(match field {
                "id" => "exact decimal string identifier; not a numeric measurement",
                "time" | "end" => "UTC Unix seconds including fractional seconds",
                "time_utc" => "ISO 8601 UTC datetime",
                "year_utc" => "UTC calendar year",
                "lat" => "WGS84 latitude in degrees",
                "lon" => "WGS84 longitude in degrees",
                "geometry_wkt" => "OGC WKT; WGS84 X=longitude, Y=latitude",
                _ => "stored value; no units or domain meaning inferred",
            });
            let mut examples = input.rows(&format!("SELECT min(event_id) AS id,{col} AS value FROM analytic_input GROUP BY {col} ORDER BY ({col} IS NULL OR {col}=''),min(rowid) LIMIT {limit}"),vec![],limit)?;
            for example in &mut examples {
                if collection {
                    if let Some(text) = example["value"].as_str() {
                        example["value"] = serde_json::from_str(text)
                            .map_err(|e| format!("Invalid stored collection: {e}"))?;
                    }
                }
                // Give small text models an explicit typed description for
                // empty values; an empty array is data, not a column name.
                example["value_description"] = json!(match &example["value"] {
                    Value::Null => "null value",
                    Value::String(text) if text.is_empty() => "empty string \"\"",
                    Value::String(_) => "stored text string",
                    Value::Array(values) if values.is_empty() => "empty JSON array []",
                    Value::Array(_) => "stored JSON array",
                    Value::Object(values) if values.is_empty() => "empty JSON object {}",
                    Value::Object(_) => "stored JSON object",
                    Value::Number(_) => "stored number",
                    Value::Bool(_) => "stored boolean",
                });
                let bytes = example["value"].to_string().len();
                if bytes > 2048 {
                    example.as_object_mut().unwrap().remove("value");
                    example["value_omitted"] = json!(true);
                    example["value_bytes"] = json!(bytes);
                }
            }
            profile["examples"] = json!(examples);
            profile["count_summary"] = json!(format!("{} matching records; {} distinct non-null values; {} non-empty records; {} null records; {} empty-string records; {} empty-collection records. Record counts and distinct-value counts are different quantities.",input.count,profile["distinct_count"],profile["non_empty_count"],profile["null_count"],profile["empty_string_count"],profile["empty_collection_count"]));
            profiles.push(profile);
        }
        Ok(
            json!({"revision":revision,"input_count":input.count,"resolved_fields":resolved_fields,"scope":{"mode":scope,"filter":filter,"source":args["source"]},"profiles":profiles,"sampled":false,"method":"Exact counts over all scoped records; distinct_count excludes null but includes empty values. Empty strings and empty collections are separate from null. finite_numeric_count means finite parsing, not inferred units or meaning. Examples are distinct stored values with source Event IDs, not frequencies; long values are explicitly omitted. No dataset-wide claim may be inferred from examples alone."}),
        )
    }
    pub(super) fn set_field_roles(&self, args: Value) -> Result<Value, String> {
        let updates: BTreeMap<String, Option<crate::field_roles::Role>> =
            arg(&args, "assignments")?;
        if updates.is_empty() {
            return Err("INVALID_ARGUMENT: provide at least one field role assignment".into());
        }
        let mut s = self.state.lock().map_err(|_| "Workspace unavailable")?;
        let mut roles = s.project.field_roles.clone();
        for (field, role) in &updates {
            let exists = if let Some(name) = field.strip_prefix("attribute:") {
                s.store
                    .connection
                    .query_row(
                        "SELECT EXISTS(SELECT 1 FROM attributes WHERE key=?)",
                        [name],
                        |r| r.get::<_, bool>(0),
                    )
                    .map_err(|e| e.to_string())?
            } else {
                matches!(
                    field.as_str(),
                    "id" | "entity"
                        | "time"
                        | "end"
                        | "lat"
                        | "lon"
                        | "category"
                        | "label"
                        | "value"
                        | "related_to"
                        | "tags"
                        | "note"
                        | "source"
                        | "source_row"
                        | "mgrs_precision"
                        | "geometry_wkt"
                        | "location_kind"
                        | "altitude_m"
                        | "altitude_reference"
                        | "time_utc"
                        | "year_utc"
                )
            };
            if !exists && !(role.is_none() && roles.contains_key(field)) {
                return Err(format!(
                    "INVALID_ARGUMENT: unknown field {field:?}; inspect dataset_schema"
                ));
            }
            if *role == Some(crate::field_roles::Role::Measurement)
                && !field.starts_with("attribute:")
                && !crate::field_roles::numeric_canonical(field)
            {
                return Err("INVALID_ARGUMENT: this canonical field is not a numeric measurement; use its original numeric attribute instead".into());
            }
            if let Some(role) = role {
                roles.insert(field.clone(), *role);
            } else {
                roles.remove(field);
            }
        }
        crate::field_roles::validate(&roles)?;
        s.project.field_roles = roles;
        Ok(json!({"updated_count":updates.len(),"assigned_count":s.project.field_roles.len()}))
    }
}
