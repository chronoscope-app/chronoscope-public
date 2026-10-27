//! Output contracts derive resource/render DTOs from their Rust definitions.
use super::*;
fn derived(command: &str) -> Option<Value> {
    macro_rules! schema {
        ($ty:ty) => {
            serde_json::to_value(schemars::schema_for!($ty)).expect("serializable authored schema")
        };
    }
    let mut schema = match command {
        "analysis_context" => schema!(crate::analysis_assist::Context),
        "chart_data" => schema!(crate::charts::Report),
        "pattern_scan" => schema!(crate::pattern_scan::Response),
        "demo_catalog" => schema!(crate::demos::Catalog),
        "statistics" => schema!(crate::store::statistics::Report),
        "analysis_prepare" => schema!(crate::analysis_assist::Plan),
        "gis_load" | "gis_set" => schema!(crate::gis::LayerResult),
        "gis_layers" => schema!(crate::gis::LayersResult),
        "gis_table" => schema!(crate::gis::TableResult),
        "basemap_resource" => schema!(crate::basemap::Resource),
        "wmts_capabilities" => schema!(crate::wmts::Capabilities),
        "wmts_plan" => schema!(Vec<crate::wmts::TileRequest>),
        "wmts_plan_page" => schema!(crate::wmts::PlanPage),
        "wmts_rasters" => schema!(crate::wmts::RasterResult),
        "terrain_info" => schema!(Option<crate::api::TerrainInfo>),
        "terrain_mesh" => schema!(crate::terrain::TerrainMesh),
        "coordinates" => schema!(crate::coordinates::Converted),
        "display_data" => schema!(crate::display::Packet),
        "render_data" => schema!(crate::api::PackedRender),
        "render_geometries" => schema!(crate::api::GeometryPacket),
        "workspace_status" | "recovery_checkpoint" | "recovery_clear" | "autosave_unsaved" => {
            schema!(crate::api::LifecycleStatus)
        }
        "wmts_servers" => schema!(crate::map_servers::Catalog),
        "preferences" => schema!(crate::engine::Preferences),
        _ => return None,
    };
    // These DTOs always serialize their Option fields as null; serde(default)
    // affects input decoding, not the presence of fields in actual results.
    fn required_outputs(value: &mut Value) {
        let Some(schema) = value.as_object_mut() else {
            return;
        };
        if let Some(properties) = schema.get_mut("properties").and_then(Value::as_object_mut) {
            let names = properties.keys().map(|key| json!(key)).collect::<Vec<_>>();
            for child in properties.values_mut() {
                required_outputs(child);
            }
            schema.insert("required".into(), json!(names));
        }
        for key in ["$defs", "definitions", "patternProperties"] {
            if let Some(definitions) = schema.get_mut(key).and_then(Value::as_object_mut) {
                for child in definitions.values_mut() {
                    required_outputs(child);
                }
            }
        }
        for key in [
            "items",
            "additionalProperties",
            "contains",
            "not",
            "if",
            "then",
            "else",
        ] {
            if let Some(child) = schema.get_mut(key) {
                required_outputs(child);
            }
        }
        for key in ["anyOf", "oneOf", "allOf", "prefixItems"] {
            if let Some(children) = schema.get_mut(key).and_then(Value::as_array_mut) {
                for child in children {
                    required_outputs(child);
                }
            }
        }
    }
    if command == "wmts_servers" {
        schema["properties"]["revision"] = json!({"type":"integer","minimum":1});
    }
    if command == "terrain_mesh" {
        schema["properties"]["cache_hit"] = json!({"type":"boolean"});
    }
    required_outputs(&mut schema);
    Some(schema)
}
pub fn domain_output_schema(command: &str) -> Value {
    let command = crate::command::canonical_name(command);
    if let Some(schema) = derived(command) {
        return with_plan(command, schema);
    }
    let mut properties = json!({"revision":{"type":"integer","minimum":1}});
    let mut required = vec![];
    let fields = match command {
        "view_status" | "view_navigate" => {
            required = vec![
                "revision",
                "renderer",
                "backend",
                "webgpu_api_available",
                "hardware_acceleration",
                "mode",
                "scene",
                "viewport",
                "loading",
                "gis_layers",
                "diagnostics",
            ];
            json!({"renderer":{"const":"cesium"},"backend":{"const":"WebGL2"},"webgpu_api_available":{"type":"boolean"},"hardware_acceleration":{"const":"unknown"},"mode":choice(&["space-time","map","globe"]),"scene":scene(),"viewport":object(json!({"width":integer(0,65536),"height":integer(0,65536)}),&["width","height"]),"loading":object(json!({"imagery":boolean(),"effects":boolean(),"gis":integer(0,64)}),&["imagery","effects","gis"]),"gis_layers":list(object(json!({"id":string(),"format":string(),"enabled":boolean(),"loaded":boolean(),"ready":boolean(),"error":nullable(string())}),&["id","format","enabled","loaded","ready","error"]),64),"diagnostics":{"type":"object"}})
        }
        "file_probe" => {
            required = vec!["kind", "format"];
            json!({"kind":{"enum":["workspace","gis","data"]},"format":{"type":["string","null"]}})
        }
        "gis_layers" => {
            required = vec!["layers"];
            json!({"layers":{"type":"array","items":serde_json::to_value(schemars::schema_for!(crate::gis::Layer)).unwrap()}})
        }
        "gis_load" | "gis_set" => {
            required = vec!["layer"];
            json!({"layer":serde_json::to_value(schemars::schema_for!(crate::gis::Layer)).unwrap()})
        }
        "gis_remove" => {
            required = vec!["removed"];
            json!({"removed":{"type":"string"}})
        }
        "gis_read" => {
            required = vec!["data", "offset", "total", "mime"];
            json!({"data":{"type":"string"},"offset":{"type":"integer","minimum":0},"total":{"type":"integer","minimum":0},"mime":{"type":"string"}})
        }
        "gis_table" => {
            required = vec![
                "rows",
                "count",
                "offset",
                "limit",
                "columns",
                "source",
                "semantics",
                "total_columns",
                "column_offset",
            ];
            json!({"rows":{"type":"array","items":serde_json::to_value(schemars::schema_for!(crate::gis::Feature)).unwrap()},"count":{"type":"integer","minimum":0},"offset":{"type":"integer","minimum":0},"limit":{"type":"integer","minimum":1},"columns":{"type":"array","items":{"type":"string"}},"total_columns":{"type":"integer","minimum":0},"column_offset":{"type":"integer","minimum":0},"source":{"type":"string"},"semantics":{"type":"string"}})
        }
        "query" | "events" | "attribute_table" => {
            required = vec!["events", "count", "offset", "limit"];
            json!({"events":{"type":"array","maxItems":1000,"items":{"type":"object","additionalProperties":true}},"count":{"type":"integer","minimum":0},"offset":{"type":"integer","minimum":0},"limit":{"type":"integer","minimum":1,"maximum":1000},"reveal_found":{"type":["boolean","null"]},"next_cursor":{"type":["string","null"]},"columns":{"type":"array","items":{"type":"string"}},"columns_limited":{"type":"boolean"}})
        }
        "revision" => {
            required = vec!["revision"];
            json!({})
        }
        "edit" | "edit_many" | "reassign" | "tag" | "delete" => {
            required = vec!["ok", "changed"];
            json!({"ok":{"const":true},"changed":{"type":"integer","minimum":0}})
        }
        "filter" | "save_group" | "demo" | "terrain_unload" => {
            required = vec!["ok"];
            json!({"ok":{"const":true}})
        }
        "selection_pick" => {
            required = vec!["selected", "pick_revision"];
            json!({"selected":{"type":"integer","minimum":0},"pick_revision":{"type":"integer","minimum":1}})
        }
        "select" | "select_visible" | "select_query" | "selection_restore" => {
            required = vec!["selected"];
            json!({"selected":{"type":"integer","minimum":0}})
        }
        "undo" | "redo" | "restore_group" | "restore_view" => {
            required = vec!["ok", "scene"];
            json!({"ok":{"const":true},"scene":scene()})
        }
        "save_view" => {
            required = vec!["ok"];
            json!({"ok":{"const":true}})
        }
        "view_set" | "scene_sync" => {
            required = vec!["scene"];
            json!({"scene":scene()})
        }
        "view_response" => {
            required = vec!["ok"];
            json!({"ok":{"const":true}})
        }
        "view_wait" => {
            required = vec!["ready", "elapsed_ms", "status"];
            json!({"ready":{"const":true},"elapsed_ms":{"type":"number","minimum":0},"status":{"type":"object"}})
        }
        "view_playback" => {
            required = vec![
                "playing",
                "speed",
                "increment_seconds",
                "time",
                "window",
                "workspace_id",
            ];
            json!({"fade":{"type":"boolean"},"playing":{"type":"boolean"},"speed":{"type":"number"},"increment_seconds":{"type":"number"},"time":{"type":"number"},"window":{"type":"array","items":{"type":["number","null"]},"minItems":2,"maxItems":2},"workspace_id":{"type":"string"}})
        }
        "view_profile" => {
            required = vec![
                "id",
                "state",
                "started_unix_ms",
                "columns",
                "samples",
                "summary",
            ];
            json!({"id":{"type":"string"},"state":{"enum":["recording","complete"]},"started_unix_ms":{"type":"number"},"columns":{"type":"array","items":{"type":"string"}},"samples":{"type":"array","maxItems":6000,"items":{"type":"array","items":{"type":"number"},"maxItems":10}},"summary":{"type":"object"}})
        }
        "view_scenario" => {
            // Library replies and asynchronous run replies are distinct shapes.
            json!({"id":{"type":"string"},"state":{"enum":["running","complete","failed","cancelled"]},"scenarios":{"type":"object"},"steps":{"type":"array"},"profile_id":{"type":"string"},"completed_steps":{"type":"integer","minimum":0},"error":{"type":["string","null"]}})
        }
        "view_recording" => {
            required = vec![
                "path",
                "uri",
                "state",
                "backend",
                "mime_type",
                "window",
                "fps",
                "max_seconds",
                "width",
                "height",
                "duration_seconds",
                "bytes",
                "started_unix_ms",
                "error",
            ];
            json!({"path":{"type":"string"},"uri":{"type":"string"},"state":{"enum":["starting","recording","stopping","complete","failed"]},"backend":{"const":"screencapturekit"},"mime_type":{"const":"video/mp4"},"window":{"enum":["main","si-chat"]},"fps":{"type":"integer","minimum":15,"maximum":60},"max_seconds":{"type":"number","minimum":1,"maximum":120},"width":{"type":"integer","minimum":0,"maximum":1920},"height":{"type":"integer","minimum":0,"maximum":1080},"duration_seconds":{"type":"number","minimum":0},"bytes":{"type":"integer","minimum":0},"started_unix_ms":{"type":"number"},"error":{"type":["string","null"]}})
        }
        "view_capture" => {
            required = vec!["data_url", "mime_type", "target", "window"];
            json!({"data_url":{"type":"string"},"mime_type":{"const":"image/png"},"target":{"enum":["app","map"]},"window":{"enum":["main","si-chat"]}})
        }
        "save" => {
            required = vec!["saved", "format"];
            json!({"saved":{"type":"string"},"format":{"enum":["json_v6","zip_v6","sqlite_v3"]}})
        }
        "open" | "demo_open" => {
            required = vec!["ok", "scene"];
            json!({"ok":{"const":true},"scene":scene(),"missing_resources":{"type":"array","items":{"type":"string"}}})
        }
        "export" => {
            required = vec!["exported", "path"];
            json!({"exported":{"type":"integer","minimum":0},"path":{"type":"string"},"attribution":{"type":["string","null"]}})
        }
        "terrain_sample" => {
            required = vec!["elevation_m", "datum"];
            json!({"elevation_m":{"type":["number","null"]},"datum":{"type":"string"}})
        }
        "terrain_load" => {
            required = vec!["tiles", "bounds"];
            json!({"tiles":{"type":"array","items":{"type":"object"}},"bounds":vector(4)})
        }
        "job_start" | "job_status" | "job_result" | "job_cancel" => {
            required = vec!["job_id", "command", "status", "progress", "has_result"];
            json!({"job_id":{"type":"string"},"command":{"type":"string"},"status":{"enum":["queued","running","completed","failed","cancelled"]},"progress":{"type":"integer","minimum":0},"total":{"type":["integer","null"]},"message":{"type":"string"},"created":{"type":"string"},"has_result":{"type":"boolean"},"error":{"type":["object","null"]},"result":{}})
        }
        "job_release" => {
            required = vec!["released", "job_id"];
            json!({"released":{"const":true},"job_id":{"type":"string"}})
        }
        "webmcp_extension" => json!({"path":{"type":"string"},"saved":{"const":true}}),
        "webmcp_start" | "webmcp_status" | "webmcp_stop" => {
            required = vec!["running", "paired"];
            json!({"running":{"type":"boolean"},"paired":{"type":"boolean"},"url":{"type":"string"},"pairing_code":{"type":"string"},"origin":{"type":"string"},"tool_count":{"type":"integer"},"expires_seconds":{"type":"integer"},"connection_id":{"type":"string"}})
        }
        "client_status" => {
            required = vec!["connections", "storage"];
            json!({"connections":{"type":"array","items":{"type":"object"}},"storage":{"type":"string"}})
        }
        "client_tools" => {
            required = vec!["id", "tools"];
            json!({"id":{"type":"string"},"tools":{"type":"array","maxItems":256,"items":{"type":"object"}}})
        }
        "webmcp_connect" | "client_connect" => {
            required = vec!["connected", "id"];
            json!({"connected":{"const":true},"id":{"type":"string"}})
        }
        "client_disconnect" => {
            required = vec!["connected"];
            json!({"connected":{"const":false}})
        }
        "client_grants" => {
            required = vec!["updated"];
            json!({"updated":{"const":true}})
        }
        "client_call" => {
            json!({"content":{"type":"array"},"structuredContent":{},"isError":{"type":"boolean"}})
        }
        "si_history" | "si_clear" => {
            required = vec!["messages", "limit_messages", "limit_bytes"];
            json!({"messages":{"type":"array","items":{"type":"object","properties":{"role":{"enum":["user","assistant"]},"content":{"type":"string"}},"required":["role","content"],"additionalProperties":false}},"limit_messages":{"anyOf":[{"const":32},{"type":"null"}]},"limit_bytes":{"anyOf":[{"const":98304},{"type":"null"}]}})
        }
        "si_permissions" => {
            required = vec!["root"];
            json!({"root":{"type":["string","null"]}})
        }
        "si_configure" | "si_disconnect" => {
            required = vec!["connected"];
            json!({"connected":{"type":"boolean"},"key_storage":{"type":"string"}})
        }
        "si_cancel" => {
            required = vec!["cancel_requested"];
            json!({"cancel_requested":{"const":true}})
        }
        "wmts_auth_status" | "wmts_auth_set" | "wmts_auth_remove" => {
            required = vec!["profiles"];
            json!({"profiles":{"type":"array","items":{"type":"object"}},"hardware_verified":{"type":"boolean"}})
        }
        "wmts_auth_reset" => {
            required = vec!["reset", "note"];
            json!({"reset":{"const":true},"note":{"type":"string"}})
        }
        "wmts_access" | "wmts_cache_clear" => {
            required = vec!["directory", "bytes", "settings"];
            json!({"directory":{"type":"string"},"bytes":{"type":"integer","minimum":0},"settings":{"type":"object"}})
        }
        "gis_import_preview" | "import_preview" => {
            required = vec!["import_id", "source", "sheets", "streaming"];
            json!({"import_id":{"type":"string"},"source":{"type":"string"},"delimiter":{"type":["string","null"]},"sheets":{"type":"array","items":{"type":"object"}},"storage":{"const":"disk"},"streaming":{"type":"boolean"}})
        }
        "import_validate" => {
            required = vec!["import_id", "events", "rejected", "sample_only"];
            json!({"import_id":{"type":"string"},"events":{"type":"array","items":{"type":"object"}},"rejected":{"type":"array"},"sample_only":{"const":true},"text_limit_bytes":{"type":"integer"},"error":{"type":["string","null"]},"fields":{"type":"object","additionalProperties":{"type":"object","properties":{"state":{"enum":["valid","invalid","optional","inactive"]},"message":{"type":"string"},"required":{"type":"boolean"}},"required":["state","message","required"],"additionalProperties":false}}})
        }
        "import_commit" => {
            required = vec!["accepted", "rejected"];
            json!({"accepted":{"type":"integer","minimum":0},"rejected":{"type":"integer","minimum":0},"retained":{"type":"integer","minimum":0},"aggregated":{"type":"integer","minimum":0},"needs_review":{"type":"boolean"},"reasons":{"type":"array"}})
        }
        "import_review" | "import_rejections_export" => {
            required = vec![
                "import_id",
                "accepted",
                "rejected",
                "missing_locations",
                "duplicate_candidates",
                "reasons",
            ];
            json!({"import_id":{"type":"string"},"accepted":{"type":"integer"},"rejected":{"type":"integer"},"missing_locations":{"type":"integer"},"duplicate_candidates":{"type":"integer"},"reasons":{"type":"array"},"reasons_limited":{"type":"boolean"},"path":{"type":"string"},"exported":{"type":"integer"}})
        }
        "capabilities" => {
            required = vec!["version", "commands", "storage"];
            json!({"version":{"type":"string"},"commands":{"type":"array","items":{"type":"string"}},"storage":{"const":"indexed_sqlite"}})
        }
        "diagnostics" => {
            required = vec!["revision", "store", "log_directory"];
            json!({"store":{"type":"object"},"log_directory":{"type":"string"},"pending_imports":{"type":"integer"},"undo":{"type":"integer"},"redo":{"type":"integer"}})
        }
        "field_profile" => {
            required = vec![
                "revision",
                "input_count",
                "scope",
                "profiles",
                "sampled",
                "method",
            ];
            json!({"revision":integer(0,i64::MAX),"input_count":integer(0,i64::MAX),"scope":{"type":"object"},"profiles":list(json!({"type":"object"}),4),"sampled":{"const":false},"method":string()})
        }
        "field_roles_set" => {
            required = vec!["updated_count", "assigned_count"];
            json!({"updated_count":{"type":"integer","minimum":0},"assigned_count":{"type":"integer","minimum":0,"maximum":512}})
        }
        "dataset_schema" => {
            required = vec!["canonical", "attributes", "id_type", "time_type"];
            json!({"field_roles":crate::field_roles::schema(false),"numeric_fields":list(string(),16),"numeric_counts":{"type":"object","additionalProperties":{"type":"integer","minimum":0}},"attribute_types":{"type":"object","additionalProperties":{"type":"object"}},"attribute_types_scope":string(),"attribute_count":{"type":"integer"},"next_attribute_offset":{"type":["integer","null"]},"attributes_limited":{"type":"boolean"},"derived":{"type":"object","additionalProperties":{"type":"string"}},"canonical":{"type":"array","items":{"type":"string"}},"attributes":{"type":"array","items":{"type":"string"}},"id_type":{"const":"decimal string"},"time_type":{"type":"string"}})
        }
        "recovery_list" => {
            required = vec!["checkpoints"];
            json!({"checkpoints":{"type":"array","items":{"type":"object"}}})
        }
        "recovery_archive" => {
            required = vec!["archived", "errors", "directory"];
            json!({"archived":list(string(),10000),"errors":list(string(),10000),"directory":string()})
        }
        "recovery_restore" => {
            required = vec!["restored", "scene", "source_checkpoint"];
            json!({"restored":{"const":true},"scene":scene(),"source_checkpoint":{"type":"string"}})
        }
        "recovery_discard" => {
            required = vec!["discarded"];
            json!({"discarded":{"const":true}})
        }
        "snapshot" => {
            required = vec![
                "count",
                "visible",
                "selected",
                "selected_count",
                "scene",
                "filter",
            ];
            json!({"workspace_id":string(),"field_roles":crate::field_roles::schema(false),"facets":{"type":"object","additionalProperties":{"type":"object","properties":{"field":{"type":"string"},"counts":{"type":"object","additionalProperties":{"type":"integer"}},"selected":{"type":"object","additionalProperties":{"type":"integer"}},"limited":{"type":"boolean"}},"required":["field","counts","selected","limited"],"additionalProperties":false}},"count":{"type":"integer","minimum":0},"visible":{"type":"integer","minimum":0},"selected":{"type":"array","items":id()},"selected_count":{"type":"integer","minimum":0},"selection_limited":{"type":"boolean"},"scene":scene(),"filter":filter(),"time_bounds":{"type":"array","items":{"type":"number"},"minItems":2,"maxItems":2},"name":{"type":"string"},"groups":{"type":"array","items":{"type":"object","properties":{"name":{"type":"string"},"ids":{"type":"array","items":id()},"ids_count":{"type":"integer"},"ids_limited":{"type":"boolean"}},"required":["name","ids","ids_count","ids_limited"]}},"views":{"type":"array","items":{"type":"object","properties":{"name":{"type":"string"},"selected":{"type":"array","items":id()},"scene":scene()},"required":["name","selected","scene"]}},"preferences":preferences(),"entities":{"type":"object","additionalProperties":{"type":"integer"}},"categories":{"type":"object","additionalProperties":{"type":"integer"}},"histogram":{"type":"array","items":{"type":"integer"}},"selected_histogram":{"type":"array","items":{"type":"integer"}},"stats":{"type":["object","null"]},"gis_layers":{"type":"array","items":{"type":"object"}},"layers":{"type":"array","items":{"type":"object"}},"undo":{"type":"integer"},"redo":{"type":"integer"}})
        }
        "selection_contains" => {
            required = vec!["selected"];
            json!({"selected":{"type":"array","items":id()}})
        }
        "analyze" | "analysis_execute" => {
            required = vec![
                "count",
                "limited",
                "input_count",
                "evaluated_count",
                "input_limited",
                "findings",
            ];
            json!({"count":{"type":"integer","minimum":0},"limited":{"type":"boolean"},"input_count":{"type":"integer","minimum":0},"evaluated_count":{"type":"integer","minimum":0},"input_limited":{"type":"boolean"},"findings":{"type":"array","maxItems":1000,"items":{"type":"object","properties":{"ids":{"type":"array","maxItems":10000,"items":id()},"summary":{"type":"string"},"metric":{"type":"string"}},"required":["ids","summary","metric"],"additionalProperties":true}}})
        }
        "assist_ui" => {
            required = vec![
                "open",
                "busy",
                "status",
                "provider",
                "field",
                "explanation",
                "tag_rows",
            ];
            json!({"open":{"type":"boolean"},"busy":{"type":"boolean"},"status":string(),"provider":string(),"field":string(),"explanation":string(),"tag_rows":{"type":"integer","minimum":0}})
        }
        "assist_status" => {
            required = vec!["providers", "max_tag_events", "running"];
            json!({"providers":{"type":"array","items":object(json!({"id":{"enum":["apple-local","connected"]},"label":string(),"available":{"type":"boolean"},"reason":string()}),&["id","label","available","reason"])},"max_tag_events":{"type":"integer"},"running":{"type":"boolean"}})
        }
        "assist_explain" => {
            required = vec![
                "provider",
                "text",
                "workspace_id",
                "source_revision",
                "current_revision",
                "source_changed",
                "evidence",
            ];
            json!({"provider":string(),"text":string(),"workspace_id":string(),"source_revision":{"type":"integer"},"current_revision":{"type":"integer"},"source_changed":{"type":"boolean"},"evidence":{"type":"object"}})
        }
        "assist_tags" => {
            required = vec![
                "provider",
                "revision",
                "workspace_id",
                "field",
                "records",
                "processed_count",
                "skipped_count",
            ];
            json!({"provider":string(),"revision":{"type":"integer"},"workspace_id":string(),"field":string(),"records":{"type":"array","items":object(json!({"id":id(),"text":string(),"tags":{"type":"array","items":string()},"existing_tags":{"type":"array","items":string()},"skipped":{"type":"boolean"}}),&["id","text","tags","existing_tags","skipped"])},"processed_count":{"type":"integer"},"skipped_count":{"type":"integer"}})
        }
        "assist_tags_apply" => {
            required = vec!["ok", "changed", "revision"];
            json!({"ok":{"type":"boolean"},"changed":{"type":"integer"},"revision":{"type":"integer"}})
        }
        "si_apple_status" => {
            required = vec!["available", "reason", "provider", "context_tokens"];
            json!({"available":{"type":"boolean"},"reason":{"type":"string"},"provider":{"const":"apple-local"},"context_tokens":{"type":"integer"}})
        }
        "si_chat_draft" => {
            required = vec!["saved"];
            json!({"saved":{"const":true}})
        }
        "si_chat_state" => {
            required = vec![
                "revision",
                "session_id",
                "messages",
                "active",
                "limit_messages",
                "limit_bytes",
            ];
            json!({"revision":{"type":"integer"},"session_id":{"type":["string","null"]},"messages":{"type":["array","null"],"items":{"type":"object"}},"active":{"type":["object","null"]},"draft":string(),"limit_messages":{"const":64},"limit_bytes":{"const":2097152}})
        }
        "si_chat_send" => {
            required = vec!["job_id", "replayed"];
            json!({"job_id":string(),"replayed":boolean()})
        }
        "si_chat_image" => {
            required = vec!["data_url", "metadata"];
            json!({"data_url":string(),"metadata":{"type":"object"}})
        }
        "si_chat_attach" => {
            required = vec!["attached"];
            json!({"attached":{"const":true}})
        }
        "present_result" => {
            required = vec!["presented", "presentation"];
            json!({"presented":{"const":true},"presentation":{"type":"object"},"instruction":string()})
        }
        "si_run" => {
            required = vec!["answer", "steps", "tool_calls", "completed"];
            json!({"answer":{"type":"string"},"steps":{"type":"integer","minimum":1,"maximum":16},"completed":{"type":"boolean"},"context":{"type":"object","properties":{"context_tokens":{"type":"integer","minimum":1},"input_tokens":{"type":["integer","null"],"minimum":0},"history_messages":{"type":"integer","minimum":0},"omitted_history_messages":{"type":"integer","minimum":0},"workspace_included":{"type":"boolean"},"generation_retries":{"type":"integer","minimum":0,"maximum":1}},"required":["context_tokens","input_tokens","history_messages","omitted_history_messages","workspace_included"],"additionalProperties":false},"proposal":{"anyOf":[crate::analysis_assist::plan_schema(),{"type":"null"}]},"tool_calls":{"type":"array","maxItems":32,"items":{"type":"object","properties":{"tool":{"type":"string"},"ok":{"type":"boolean"},"error":{"type":["string","null"]},"result_id":{"type":"string"},"presentation":{"type":"object"}},"required":["tool","ok","error"],"additionalProperties":false}}})
        }
        "si_status" => {
            required = vec![
                "url",
                "model",
                "connected",
                "running",
                "key_present",
                "root",
                "protocol",
                "key_storage",
            ];
            json!({"provider":{"const":"openai-compatible"},"url":{"type":"string"},"model":{"type":"string"},"connected":{"type":"boolean"},"running":{"type":"boolean"},"key_present":{"type":"boolean"},"root":{"type":["string","null"]},"protocol":{"type":"string"},"key_storage":{"type":"string"},"client_certificate":{"type":["object","null"]},"client_certificate_kind":{"enum":["macos-keychain","windows-store","pkcs11"]},"automatic_client_certificate":{"type":"boolean"}})
        }
        "space_time_aggregate" => {
            required = vec![
                "input_count",
                "group_count",
                "groups",
                "limited",
                "options",
                "semantics",
            ];
            json!({"input_count":{"type":"integer","minimum":0},"group_count":{"type":"integer","minimum":0},"groups":{"type":"array","maxItems":1000,"items":{"type":"object","properties":{"representative":{"type":"object"},"count":{"type":"integer","minimum":1}},"required":["representative","count"],"additionalProperties":false}},"limited":{"type":"boolean"},"options":aggregation(),"semantics":{"type":"string"}})
        }
        "aggregate_apply" => {
            required = vec!["input_count", "retained", "aggregated", "undoable"];
            json!({"input_count":{"type":"integer","minimum":0},"retained":{"type":"integer","minimum":0},"aggregated":{"type":"integer","minimum":0},"undoable":{"const":true}})
        }
        "analytics_discover" => {
            required = vec!["capabilities", "count", "dataset", "instruction"];
            json!({"capabilities":{"type":"array","items":{"type":"object"}},"count":{"type":"integer"},"dataset":{"type":"object"},"instruction":string(),"next_offset":{"type":["integer","null"]}})
        }
        "analytics_describe" => {
            required = vec![
                "capability",
                "description",
                "parameters_schema",
                "strategy",
                "library",
            ];
            json!({"capability":string(),"description":string(),"parameters_schema":{"type":"object"},"strategy":string(),"library":string()})
        }
        "analytics_list" => {
            required = vec!["results", "revision"];
            json!({"results":{"type":"array","maxItems":32,"items":{"type":"object"}},"revision":{"type":"integer"}})
        }
        "analytics_remove" => {
            required = vec!["removed", "result_id", "revision"];
            json!({"removed":boolean(),"result_id":string(),"revision":{"type":"integer"}})
        }
        "analytics_run" | "analytics_result" => {
            required = vec![
                "result_id",
                "capability",
                "source_revision",
                "data_stale",
                "input_count",
                "evaluated_count",
                "excluded_count",
                "sampled",
                "summary",
            ];
            json!({"result_id":string(),"capability":string(),"source_revision":{"type":"integer"},"data_stale":boolean(),"input_count":{"type":"integer"},"prepared_count":{"type":"integer"},"evaluated_count":{"type":"integer"},"excluded_count":{"type":"integer"},"sampled":{"const":false},"total_rows":{"type":"integer"},"limited":boolean(),"summary":{"type":"object"},"rows":{"type":"array","items":{"type":"object"}}})
        }
        "time_parse" => {
            required = vec!["epoch", "time_utc", "year_utc", "precision"];
            json!({"epoch":{"type":"number"},"time_utc":string(),"year_utc":{"type":"integer"},"precision":{"const":"fractional_second"}})
        }
        "aggregate" => {
            required = vec!["groups", "limited", "limit"];
            json!({"groups":{"type":"array","maxItems":1000,"items":{"type":"object","properties":{"key":{"type":["string","null"]},"count":{"type":"integer","minimum":0},"numeric_count":{"type":"integer","minimum":0},"min":{"type":["number","null"]},"max":{"type":["number","null"]},"mean":{"type":["number","null"]},"sum":{"type":["number","null"]}},"required":["key","count","numeric_count","min","max","mean","sum"],"additionalProperties":false}},"limited":{"type":"boolean"},"limit":{"type":"integer","minimum":1,"maximum":1000}})
        }
        "batch" => {
            required = vec!["results", "atomic"];
            json!({"results":{"type":"array","maxItems":100,"items":{"type":"object"}},"atomic":{"const":true}})
        }
        "render_data" => {
            required = vec![
                "ids",
                "stride",
                "data",
                "entities",
                "located_count",
                "rendered_count",
                "lod",
            ];
            json!({"ids":{"type":"array","items":id()},"stride":{"const":32},"data":{"type":"string","contentEncoding":"base64"},"entities":{"type":"array","items":{"type":"string"}},"inferred_ids":{"type":"array","items":id()},"inferred_markers":{"type":"array","items":{"type":"object"}},"unlocated_count":{"type":"integer","minimum":0},"located_count":{"type":"integer","minimum":0},"rendered_count":{"type":"integer","minimum":0},"lod":{"type":"boolean"}})
        }
        _ => json!({}),
    };
    properties
        .as_object_mut()
        .unwrap()
        .extend(fields.as_object().unwrap().clone());
    let versioned = command == "analyze"
        || crate::command::Command::parse(command).is_some_and(|c| !c.effects().detached)
            && !command.starts_with("assist_")
            && !command.starts_with("si_")
            && !command.starts_with("client_")
            && !command.starts_with("job_")
            && !matches!(
                command,
                "view_capture"
                    | "view_response"
                    | "view_recording"
                    | "view_profile"
                    | "view_wait"
                    | "view_playback"
                    | "view_scenario"
            );
    if versioned && !required.contains(&"revision") {
        required.push("revision");
    }
    let output = json!({"type":"object","properties":properties,"required":required,"additionalProperties":true});
    with_plan(command, output)
}
fn with_plan(command: &str, mut output: Value) -> Value {
    if command != "view_navigate"
        && crate::command::Command::parse(command).is_some_and(|c| {
            c.mutates(&json!({}))
                || matches!(
                    c.effects().mutation,
                    crate::command::Mutation::Preferences | crate::command::Mutation::MapAccess
                )
        })
    {
        let definitions = output.as_object_mut().and_then(|o| o.remove("$defs"));
        let mut wrapped = json!({"anyOf":[output,object(json!({"dry_run":{"const":true},"executed":{"const":false},"revision":{"type":"integer"},"command":{"const":command},"plan":{"type":"object"},"note":{"type":"string"}}),&["dry_run","executed","revision","command","plan"])]});
        if let Some(definitions) = definitions {
            wrapped["$defs"] = definitions;
        }
        wrapped
    } else {
        output
    }
}

pub fn output_schema(command: &str) -> Value {
    let command = crate::command::canonical_name(command);
    let mut output = domain_output_schema(command);
    match command {
        "wmts_plan" => {
            let definitions = output.as_object_mut().and_then(|o| o.remove("$defs"));
            let mut wrapped = object(json!({"result":output}), &["result"]);
            if let Some(definitions) = definitions {
                wrapped["$defs"] = definitions;
            }
            wrapped
        }
        "terrain_info" => {
            if let Some(branches) = output["anyOf"].as_array_mut() {
                for branch in branches {
                    if branch["type"] == "null" {
                        *branch = object(json!({"result":{"type":"null"}}), &["result"]);
                    }
                }
            }
            output
        }
        "wmts_rasters" => {
            if let Some(required) = output["$defs"]["RasterTile"]["required"].as_array_mut() {
                required.retain(|v| v != "data_url");
            }
            output
        }
        "view_capture" => {
            if let Some(required) = output["required"].as_array_mut() {
                required.retain(|v| v != "data_url");
            }
            output
        }
        _ => output,
    }
}
pub fn validate_output(command: &str, value: &Value) -> Result<(), String> {
    let command = crate::command::canonical_name(command);
    static VALIDATORS: OnceLock<BTreeMap<String, jsonschema::Validator>> = OnceLock::new();
    let validators = VALIDATORS.get_or_init(|| {
        COMMANDS
            .iter()
            .map(|name| {
                (
                    (*name).into(),
                    jsonschema::validator_for(&output_schema(name)).expect("valid output schema"),
                )
            })
            .collect()
    });
    let validator = validators.get(command).ok_or("Unknown output contract")?;
    if validator.is_valid(value) {
        Ok(())
    } else {
        Err(format!(
            "OPERATION_FAILED: {command} returned a result outside its output contract"
        ))
    }
}
