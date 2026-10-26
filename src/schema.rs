//! One authoritative, enforced contract for CLI, desktop commands and MCP.
use serde_json::{json, Map, Value};
use std::{collections::BTreeMap, sync::OnceLock};
mod live;
pub fn object(properties: Value, required: &[&str]) -> Value {
    json!({"type":"object","properties":properties,"required":required,"additionalProperties":false})
}
fn string() -> Value {
    json!({"type":"string","maxLength":16384})
}
fn number() -> Value {
    json!({"type":"number"})
}
fn boolean() -> Value {
    json!({"type":"boolean"})
}
fn integer(min: i64, max: i64) -> Value {
    json!({"type":"integer","minimum":min,"maximum":max})
}
fn nullable(v: Value) -> Value {
    json!({"anyOf":[v,{"type":"null"}]})
}
fn list(items: Value, max: usize) -> Value {
    json!({"type":"array","items":items,"maxItems":max})
}
fn choice(values: &[&str]) -> Value {
    json!({"type":"string","enum":values})
}
pub fn id() -> Value {
    json!({"type":"string","pattern":"^[0-9]{1,20}$","description":"Exact unsigned 64-bit event ID, as decimal text."})
}
pub fn filter() -> Value {
    object(
        json!({
         "start":nullable(number()),"end":nullable(number()),
         "hidden_entities":list(string(),10000),"hidden_categories":list(string(),10000),"hidden_sources":list(string(),10000),
         "facet_fields":object(json!({"entity":string(),"category":string()}),&[]),
         "facet_hidden":object(json!({"entity":list(string(),10000),"category":list(string(),10000)}),&[]),
         "search":string(),"selected_only":boolean(),"located_only":boolean(),
         "bounds":nullable(object(json!({"south":{"type":"number","minimum":-90,"maximum":90},"north":{"type":"number","minimum":-90,"maximum":90},"west":{"type":"number","minimum":-180,"maximum":180},"east":{"type":"number","minimum":-180,"maximum":180}}),&["south","north","west","east"])),
         "predicates":list(object(json!({"field":string(),"op":choice(&["Contains","Equals","NotEquals","Greater","Less","IsEmpty"]),"value":string()}),&["field","op","value"]),32)
        }),
        &[],
    )
}
pub fn mapping() -> Value {
    let mut props = Map::new();
    for k in [
        "time",
        "clock",
        "end",
        "entity",
        "lat",
        "lon",
        "category",
        "label",
        "value",
        "related_to",
        "easting",
        "northing",
        "zone",
        "hemisphere",
        "mgrs",
        "coordinate_column",
        "geometry_wkt",
    ] {
        props.insert(k.into(), nullable(integer(0, 511)));
    }
    for k in [
        "custom_format",
        "default_entity",
        "default_hemisphere",
        "default_date",
    ] {
        props.insert(k.into(), string());
    }
    props.insert("coordinate_system".into(), choice(&["dd", "utm", "mgrs"]));
    props.insert("default_zone".into(), integer(0, 60));
    props.insert("offset_minutes".into(), integer(-1440, 1440));
    props.insert("date_order".into(), choice(&["auto", "dmy", "mdy"]));
    props.insert(
        "time_encoding".into(),
        choice(&[
            "auto",
            "unix_seconds",
            "unix_milliseconds",
            "unix_microseconds",
            "unix_nanoseconds",
            "excel_serial",
            "excel1904",
            "time_of_day",
        ]),
    );
    props.insert("decimal_comma".into(), boolean());
    object(Value::Object(props), &[])
}
pub fn aggregation() -> Value {
    object(
        json!({"window_minutes":integer(1,5259600),"radius_m":{"type":"number","minimum":1,"maximum":20040000}}),
        &["window_minutes", "radius_m"],
    )
}
pub fn display_options() -> Value {
    object(
        json!({"mode":choice(&["auto","points","clusters","density","heatmap"]),"cluster_pixels":{"type":"number","minimum":8,"maximum":128},"time_bin_minutes":integer(0,5259600000),"partition":choice(&["all","entity","source"]),"spatial_culling":boolean(),"show_points":boolean(),"show_centroids":boolean(),"point_scale":{"type":"number","minimum":0.4,"maximum":3},"track_opacity":{"type":"number","minimum":0,"maximum":1},"trail_opacity":{"type":"number","minimum":0,"maximum":1},"show_tracks":boolean(),"show_trails":boolean(),"trail_pixels":{"type":"number","minimum":0,"maximum":20},"trail_gap_minutes":integer(0,5259600000),"heat_radius":{"type":"number","minimum":4,"maximum":128},"heat_weight":choice(&["count","value"]),"heat_max":nullable(json!({"type":"number","exclusiveMinimum":0})),"heat_reference_zoom":nullable(json!({"type":"number","minimum":0,"maximum":24})),"bloom":boolean(),"bloom_strength":{"type":"number","minimum":0,"maximum":3},"bloom_radius":{"type":"number","minimum":0,"maximum":1},"bloom_threshold":{"type":"number","minimum":0,"maximum":1}}),
        &[],
    )
}
fn display_cell() -> Value {
    object(
        json!({"level":integer(0,24),"x":integer(0,16777215),"y":integer(0,16777215),"slab":integer(i64::MIN,i64::MAX),"time_bin_minutes":integer(0,5259600000),"partition":choice(&["all","entity","source"]),"key":string(),"viewport":nullable(vector(4))}),
        &[
            "level",
            "x",
            "y",
            "slab",
            "time_bin_minutes",
            "partition",
            "key",
        ],
    )
}
pub fn chart() -> Value {
    object(
        json!({"kind":choice(&["bar","line","area","scatter","histogram","boxplot","heatmap","period"]),"scope":choice(&["all","visible","selected"]),"source":nullable(string()),"x":string(),"y":string(),"group":string(),"aggregate":choice(&["count","sum","mean","min","max"]),"x_axis":choice(&["category","number","time"]),"time_bucket":choice(&["none","millisecond","second","minute","hour","day","week","month","year"]),"stacked":boolean(),"y2":string(),"trendline":boolean(),"bins":integer(2,100),"limit":integer(1,10000),"title":{"type":"string","maxLength":256},"x_label":{"type":"string","maxLength":256},"y_label":{"type":"string","maxLength":256},"y2_label":{"type":"string","maxLength":256},"period_a":nullable(vector(2)),"period_b":nullable(vector(2))}),
        &[],
    )
}
fn cesium_camera() -> Value {
    object(
        json!({"position":{"type":"array","items":{"type":"number","minimum":-1e10,"maximum":1e10},"minItems":3,"maxItems":3},"direction":vector(3),"up":vector(3),"frustum_width":nullable(json!({"type":"number","minimum":0.01,"maximum":1e10}))}),
        &["position", "direction", "up"],
    )
}
pub fn scene() -> Value {
    object(
        json!({"measurement":nullable(object(json!({"latest_per_entity":boolean(),"title":{"type":"string","minLength":1,"maxLength":128},"unit":{"type":"string","maxLength":32},"minimum":{"type":"number"},"maximum":{"type":"number"}}), &["title","unit","minimum","maximum"])),"renderer":choice(&["","cesium"]),"cesium_camera":nullable(cesium_camera()),"view_states":{"type":"object","maxProperties":3,"propertyNames":{"enum":["space-time","map","globe"]},"additionalProperties":object(json!({"center":vector(3),"ground_width":{"type":"number","minimum":0.01,"maximum":1e10},"heading":{"type":"number","minimum":0,"exclusiveMaximum":360},"tilt":{"type":"number","minimum":0,"maximum":89.5},"footprint":list(vector(3),4),"camera":nullable(cesium_camera())}),&["center","ground_width","heading","tilt"])},"entity_colors":{"type":"object","maxProperties":10000,"propertyNames":{"maxLength":8192},"additionalProperties":{"type":"string","pattern":"^#[0-9a-fA-F]{6}$"}},"display":nullable(display_options()),"mode":choice(&["","space-time","map","globe"]),"position":nullable(vector(3)),"target":nullable(vector(3)),"playback_fade":nullable(boolean()),"globe_time":boolean(),"globe_time_scale":nullable(json!({"type":"number","minimum":0.05,"maximum":20})),"time_height":nullable(json!({"type":"number","minimum":0,"maximum":5})),"camera_up":nullable(vector(3)),"camera_zoom":nullable(json!({"type":"number","minimum":0.1,"maximum":100})),"render_budget":nullable(json!({"enum":[20000,100000]})),"table_source":nullable(string()),"gis_table":nullable(string()),"table_attributes":boolean(),"table_respect_filters":boolean(),"table_sort":string(),"table_descending":boolean(),"table_column_offset":integer(0,528),"focus":nullable(json!({"type":"number","minimum":0,"maximum":1})),"bounds":nullable(vector(4)),"table_open":boolean(),"inspector_tab":choice(&["","inspect","patterns","charts","views"]),"expanded":boolean(),"chart":nullable(chart()),"chart_presets":list(object(json!({"name":{"type":"string","minLength":1,"maxLength":128},"config":chart()}),&["name","config"]),32)}),
        &[],
    )
}
fn vector(n: usize) -> Value {
    json!({"type":"array","items":{"type":"number"},"minItems":n,"maxItems":n})
}
pub fn changes() -> Value {
    object(
        json!({"geometry_wkt":nullable(json!({"type":"string","maxLength":524288})),"entity":string(),"time":number(),"end":nullable(number()),"lat":nullable(json!({"type":"number","minimum":-90,"maximum":90})),"lon":nullable(json!({"type":"number","minimum":-180,"maximum":180})),"category":string(),"label":string(),"value":nullable(number()),"related_to":string(),"tags":list(string(),1024),"note":string()}),
        &[],
    )
}
fn map_config() -> Value {
    object(
        json!({"url":string(),"layer":string(),"matrix_set":string(),"style":string(),"format":string(),"time":string(),"enabled":boolean(),"level":nullable(integer(0,64))}),
        &[
            "url",
            "layer",
            "matrix_set",
            "style",
            "format",
            "time",
            "enabled",
        ],
    )
}
fn map_layer() -> Value {
    object(
        json!({"id":string(),"name":string(),"server_name":string(),"config":map_config(),"opacity":{"type":"number","minimum":0,"maximum":1},"min_zoom":{"type":"number","minimum":0,"maximum":30},"max_zoom":{"type":"number","minimum":0,"maximum":30}}),
        &[
            "id",
            "name",
            "server_name",
            "config",
            "opacity",
            "min_zoom",
            "max_zoom",
        ],
    )
}
fn preferences() -> Value {
    object(
        json!({"basemap":choice(&["streets","none"]),"theme":choice(&["dark","light","system"]),"coordinates":choice(&["dd","utm","mgrs"]),"date_format":choice(&["system","iso","mdy","mdy-short","dmy","dmy-short","dmy-dots","dmy-long","mdy-long"]),"time_format":choice(&["system","12h","12h-seconds","24h","24h-seconds"]),"map":map_config(),"map_layers":{"anyOf":[{"type":"null"},{"type":"array","maxItems":64,"items":map_layer()}]},"auto_save_unsaved":boolean(),"terrain_path":nullable(string()),"terrain_builtin":boolean(),"terrain_exaggeration":{"type":"number","minimum":0.1,"maximum":20},"terrain_vertical_datum":choice(&["unresolved-msl","egm96","ellipsoid"])}),
        &[],
    )
}
pub fn analysis_parameters() -> Value {
    parameters()
}
fn parameters() -> Value {
    object(
        json!({"radius_m":{"type":"number","minimum":1,"maximum":20040000},"tolerance_s":{"type":"number","minimum":0,"maximum":31557600000i64},"duration_s":{"type":"number","exclusiveMinimum":0,"maximum":31557600000i64},"gap_s":{"type":"number","exclusiveMinimum":0,"maximum":31557600000i64},"speed_kmh":{"type":"number","minimum":0,"maximum":1000000},"min_cluster":integer(2,1000000)}),
        &[],
    )
}
pub fn is_mutation(command: &str, args: &Value) -> bool {
    crate::command::Command::parse(command).is_some_and(|c| c.mutates(args))
}
pub fn command_schema(command: &str) -> Option<Value> {
    if matches!(
        command,
        "view_profile" | "view_wait" | "view_playback" | "view_scenario"
    ) {
        return Some(live::input(command));
    }
    let command = crate::command::canonical_name(command);
    let (props, required) = match command {
        "workspace_status"
        | "recovery_list"
        | "recovery_checkpoint"
        | "recovery_clear"
        | "autosave_unsaved"
        | "recovery_archive" => (json!({}), vec![]),
        "recovery_restore" | "recovery_discard" => (
            json!({"id":{"type":"string","pattern":"^[0-9a-f]{32}$"}}),
            vec!["id"],
        ),
        #[cfg(feature = "experimental-browser-webmcp")]
        "webmcp_start" | "webmcp_status" | "webmcp_connect" | "webmcp_stop" => (json!({}), vec![]),
        "client_status" => (json!({}), vec![]),
        #[cfg(feature = "experimental-browser-webmcp")]
        "webmcp_extension" => (json!({"path":string(),"overwrite":boolean()}), vec!["path"]),
        "client_tools" | "client_disconnect" => (json!({"id":string()}), vec!["id"]),
        "client_grants" => (
            json!({"id":string(),"grants":list(object(json!({"tool":string(),"fingerprint":string(),"access":choice(&["read","action"])}), &["tool","fingerprint","access"]),256)}),
            vec!["id", "grants"],
        ),
        "client_call" => (
            json!({"id":string(),"tool":string(),"fingerprint":string(),"arguments":{"type":"object"},"allow_actions":boolean()}),
            vec!["id", "tool", "fingerprint", "arguments"],
        ),
        "client_connect" => (
            json!({"id":{"type":"string","pattern":"^[a-zA-Z0-9_-]{1,32}$"},"name":{"type":"string","minLength":1,"maxLength":128},"config":{"oneOf":[object(json!({"transport":{"const":"stdio"},"command":string(),"arguments":list(string(),128),"cwd":nullable(string()),"environment":{"type":"object","maxProperties":64,"additionalProperties":{"type":"string","maxLength":8192}}}),&["transport","command"]),object(json!({"transport":{"const":"http"},"url":string(),"token":nullable(json!({"type":"string","maxLength":8192}))}),&["transport","url"])]}}),
            vec!["id", "name", "config"],
        ),
        "analysis_context" => (json!({"scope":choice(&["visible","selected"])}), vec![]),
        "analysis_prepare" => (
            json!({"pattern":choice(&["Proximity","Stationary","Gaps","Speed","Clusters"]),"scope":choice(&["visible","selected"]),"parameters":parameters()}),
            vec!["pattern", "scope", "parameters"],
        ),
        "analysis_execute" => (
            json!({"plan":crate::analysis_assist::plan_schema()}),
            vec!["plan"],
        ),
        "assist_ui" => (
            json!({"action":choice(&["open-explain","open-tags","generate","cancel","status","close"]),"provider":choice(&["apple-local","connected"]),"field":string(),"source":object(json!({"result_id":string(),"scan_id":string(),"finding_id":string()}),&[])}),
            vec!["action"],
        ),
        "assist_status" => (json!({}), vec![]),
        "assist_explain" => (
            json!({"provider":choice(&["apple-local","connected"]),"source":{"oneOf":[object(json!({"kind":{"const":"analysis"},"result_id":string()}),&["kind","result_id"]),object(json!({"kind":{"const":"pattern"},"scan_id":string(),"finding_id":string()}),&["kind","scan_id","finding_id"])]}}),
            vec!["provider", "source"],
        ),
        "assist_tags" => (
            json!({"provider":choice(&["apple-local","connected"]),"ids":{"type":"array","items":id(),"minItems":1,"maxItems":25},"field":string(),"expected_revision":integer(0,i64::MAX),"expected_workspace":string()}),
            vec![
                "provider",
                "ids",
                "field",
                "expected_revision",
                "expected_workspace",
            ],
        ),
        "assist_tags_apply" => (
            json!({"items":{"type":"array","minItems":1,"maxItems":25,"items":object(json!({"id":id(),"tags":{"type":"array","minItems":1,"maxItems":5,"items":{"type":"string","minLength":1,"maxLength":64}}}),&["id","tags"])}}),
            vec!["items", "expected_revision", "expected_workspace"],
        ),
        "si_apple_status" => (json!({}), vec![]),
        "si_status" | "si_disconnect" | "si_cancel" | "si_history" | "si_clear" => {
            (json!({}), vec![])
        }
        "si_permissions" => (json!({"root":nullable(string())}), vec!["root"]),
        "si_configure" => (
            json!({"provider":choice(&["openai-compatible"]),"url":{"type":"string","maxLength":2048},"model":{"type":"string","minLength":1,"maxLength":256},"api_key":{"type":"string","maxLength":8192},"root":nullable(string()),"client_certificate":nullable(object(json!({"origin":string(),"kind":choice(&["disabled","macos-keychain","windows-store","pkcs11"]),"identity":string()}), &["origin","kind","identity"]))}),
            vec!["url", "model"],
        ),
        "si_chat_draft" => (
            json!({"text":{"type":"string","maxLength":1048576},"session_id":nullable(string())}),
            vec!["text"],
        ),
        "si_chat_state" => (json!({"since_revision":integer(0,i64::MAX)}), vec![]),
        "si_chat_send" => (
            json!({"request_id":{"type":"string","pattern":"^[a-f0-9]{32}$"},"prompt":{"type":"string","minLength":1,"maxLength":1048576},"allow_edits":boolean(),"allow_external_actions":boolean(),"expected_session":{"type":"string","pattern":"^[0-9]+$","maxLength":20}}),
            vec!["request_id", "prompt"],
        ),
        "si_chat_image" => (
            json!({"image_id":{"type":"string","pattern":"^[a-f0-9]{64}$"}}),
            vec!["image_id"],
        ),
        "si_chat_attach" => (
            json!({"data_url":{"type":"string","maxLength":4194326},"title":{"type":"string","maxLength":256}}),
            vec!["data_url"],
        ),
        "present_result" => (
            json!({"kind":choice(&["analysis","map"]),"result_id":{"type":"string","pattern":"^[a-f0-9]{64}$"},"chart":choice(&["auto","table","bar","line","scatter"]),"x":{"type":"string","maxLength":256},"y":{"type":"string","maxLength":256},"title":{"type":"string","maxLength":256}}),
            vec!["kind"],
        ),
        "si_run" => (
            json!({"prompt":{"type":"string","minLength":1,"maxLength":1048576},"allow_edits":boolean(),"allow_external_actions":boolean(),"max_steps":integer(1,16),"expected_session":integer(0,i64::MAX)}),
            vec!["prompt"],
        ),
        "job_start" => (
            json!({"command":choice(crate::jobs::COMMANDS),"arguments":{"type":"object"}}),
            vec!["command"],
        ),
        "job_status" | "job_result" | "job_cancel" | "job_release" => (
            json!({"job_id":json!({"type":"string","pattern":"^[0-9a-f]{32}$"}),"include_data":boolean()}),
            vec!["job_id"],
        ),
        "revision" | "undo" | "redo" | "delete" | "terrain_unload" | "terrain_info" | "demo"
        | "capabilities" | "diagnostics" | "demo_catalog" => (json!({}), vec![]),
        "demo_open" => (
            json!({"id":choice(&crate::demos::DEMOS.iter().map(|demo| demo.id).collect::<Vec<_>>())}),
            vec!["id"],
        ),
        "view_snapshot_v1" => (
            json!({"display_level":integer(0,24),"version":{"const":1},"generation":{"type":"string","minLength":1,"maxLength":64},"include_render":boolean(),"include_statistics":boolean(),"include_inspector":boolean(),"selection_ids":list(id(),100000),"max_points":integer(100,100000),"bounds":vector(4),"page":{"oneOf":[object(json!({"command":{"const":"events"},"args":command_schema("events").unwrap()}),&["command","args"]),object(json!({"command":{"const":"attribute_table"},"args":command_schema("attribute_table").unwrap()}),&["command","args"])]}}),
            vec!["version", "generation"],
        ),
        "snapshot" => (
            json!({"selection_limit":integer(0,1000000),"compact":boolean(),"include_statistics":boolean()}),
            vec![],
        ),
        "render_geometries" => (
            json!({"filter":filter(),"apply_filter":boolean(),"source":nullable(string()),"offset":integer(0,100000000),"limit":integer(1,1000),"max_vertices":integer(1,200000),"bounds":vector(4),"expected_revision":integer(1,i64::MAX)}),
            vec![],
        ),
        "display_data" => (
            json!({"flat":boolean(),"bounds":vector(4),"level":integer(0,24),"time_bin_minutes":integer(0,5259600000),"partition":choice(&["all","entity","source"]),"weight":choice(&["count","value"]),"max_cells":integer(100,8000),"expected_revision":integer(1,i64::MAX)}),
            vec![],
        ),
        "render_data" => (
            json!({"include_time_only":boolean(),"max_points":integer(100,100000),"bounds":vector(4),"selected_only":boolean(),"expected_revision":integer(1,i64::MAX)}),
            vec![],
        ),
        "events" => (
            json!({"display_cell":display_cell(),"id":id(),"reveal_id":id(),"offset":integer(0,100000000),"limit":integer(1,1000),"fields":list(string(),64)}),
            vec![],
        ),
        "attribute_table" | "query" => (
            json!({"display_cell":display_cell(),"source":nullable(string()),"reveal_id":id(),"offset":integer(0,100000000),"limit":integer(1,1000),"apply_filter":boolean(),"filter":filter(),"sort_by":string(),"descending":boolean(),"fields":list(string(),512),"cursor":string(),"selected_only":boolean()}),
            vec![],
        ),
        "space_time_aggregate" | "aggregate_apply" => (
            json!({"aggregation":aggregation(),"filter":filter(),"apply_filter":boolean(),"source":nullable(string()),"limit":integer(1,1000)}),
            vec!["aggregation"],
        ),
        "aggregate" => (
            json!({"filter":filter(),"apply_filter":boolean(),"selected_only":boolean(),"source":nullable(string()),"group_by":{"type":"string","maxLength":16384,"pattern":"^(entity|category|source|hour|day|month|year|attribute:.+)$"},"field":string(),"limit":integer(1,1000)}),
            vec![],
        ),
        "analytics_discover" => (json!({"search":string(),"offset":integer(0,1000)}), vec![]),
        "analytics_describe" => (json!({"capability":string()}), vec!["capability"]),
        "analytics_run" => (
            json!({"plan":crate::analytics::plan_schema(),"filter":filter(),"source":nullable(string()),"expected_revision":integer(1,i64::MAX),"expected_workspace":string()}),
            vec!["plan"],
        ),
        "analytics_result" => (
            json!({"result_id":{"type":"string","pattern":"^[a-f0-9]{64}$"},"section":choice(&["summary","details","rows","chart","provenance"]),"summary_fields":list(string(),16),"offset":integer(0,100000),"limit":integer(1,200)}),
            vec!["result_id"],
        ),
        "analytics_list" => (json!({}), vec![]),
        "analytics_remove" => (
            json!({"result_id":{"type":"string","pattern":"^[a-f0-9]{64}$"}}),
            vec!["result_id"],
        ),
        "statistics" => (
            json!({"filter":filter(),"apply_filter":boolean(),"selected_only":boolean(),"source":nullable(string()),"field":string(),"other_field":string()}),
            vec!["field"],
        ),
        "time_parse" => (
            json!({"value":string(),"date_order":choice(&["auto","dmy","mdy"]),"timezone_offset_minutes":integer(-1440,1440)}),
            vec!["value"],
        ),
        "pattern_scan" => (
            json!({"config":crate::pattern_scan::config_schema(),"cached_only":boolean(),"expected_revision":integer(0,i64::MAX)}),
            vec![],
        ),
        "field_profile" => (
            json!({"fields":{"type":"array","items":string(),"minItems":1,"maxItems":4,"uniqueItems":true},"scope":choice(&["all","visible","selected"]),"source":nullable(string()),"example_limit":integer(0,5),"expected_revision":integer(0,i64::MAX)}),
            vec!["fields"],
        ),
        "field_roles_set" => (
            json!({"assignments":crate::field_roles::schema(true)}),
            vec!["assignments"],
        ),
        "dataset_schema" => (
            json!({"attribute_search":string(),"attribute_offset":integer(0,1000000),"attribute_limit":integer(1,512),"include_attribute_types":boolean()}),
            vec![],
        ),
        "file_probe" => (json!({"path":string()}), vec!["path"]),
        "gis_layers" => (json!({}), vec![]),
        "gis_load" => (
            json!({"path":string(),"name":string(),"position":vector(3),"scale":{"type":"number","minimum":0.000001,"maximum":1e6}}),
            vec!["path"],
        ),
        "gis_set" => (
            json!({"id":string(),"enabled":boolean(),"selected":list(string(),1000),"name":string(),"position":vector(3),"scale":{"type":"number","minimum":0.000001,"maximum":1e6}}),
            vec!["id"],
        ),
        "gis_remove" | "gis_import_preview" => (json!({"id":string()}), vec!["id"]),
        "gis_read" => (
            json!({"id":string(),"resource":string(),"offset":integer(0,i64::MAX),"limit":integer(1,1048576)}),
            vec!["id", "resource"],
        ),
        "gis_table" => (
            json!({"id":string(),"expected_revision":integer(1,i64::MAX),"offset":integer(0,i64::MAX),"limit":integer(1,1000),"feature_id":string(),"search":string(),"sort":string(),"descending":boolean()}),
            vec!["id"],
        ),
        "import_preview" => (
            json!({"path":string(),"delimiter":choice(&["auto",",",";","\t","|"]),"storage":choice(&["auto","disk"])}),
            vec!["path"],
        ),
        "import_validate" => (
            json!({"sheet":integer(0,255),"mapping":mapping(),"import_id":string()}),
            vec!["mapping"],
        ),
        "import_review" => (
            json!({"sheet":integer(0,255),"mapping":mapping(),"import_id":string(),"expected_workspace":string()}),
            vec!["mapping", "import_id"],
        ),
        "import_rejections_export" => (
            json!({"sheet":integer(0,255),"mapping":mapping(),"import_id":string(),"path":string(),"overwrite":boolean()}),
            vec!["mapping", "import_id", "path"],
        ),
        "import_commit" => (
            json!({"sheet":integer(0,255),"mapping":mapping(),"append":boolean(),"accept_rejected":boolean(),"import_id":string(),"aggregation":aggregation()}),
            vec![],
        ),
        "filter" => (json!({"filter":filter()}), vec!["filter"]),
        "select_visible" => (
            json!({"entity":string(),"bin":integer(0,99),"mode":choice(&["replace","add","subtract","toggle"])}),
            vec![],
        ),
        "chart_data" => (
            json!({"config":chart(),"expected_revision":integer(1,i64::MAX)}),
            vec!["config"],
        ),
        "select_query" => (
            // At most 10,000 chart rows, with separate primary/secondary marks.
            json!({"pattern_scan_id":{"type":"string","pattern":"^[a-f0-9]{64}$"},"pattern_finding_id":{"type":"string","minLength":1,"maxLength":80},"config":chart(),"chart_marks":list(object(json!({"x":{},"series":{},"value":nullable(number()),"axis":integer(0,1)}),&["x","series"]),20000),"table_range":object(json!({"anchor":id(),"target":id(),"sort_by":string(),"descending":boolean()}),&["anchor","target"]),"display_cells":list(display_cell(),4000),"display_cell":display_cell(),"filter":filter(),"source":nullable(string()),"apply_filter":boolean(),"mode":choice(&["replace","add","subtract","toggle"])}),
            vec![],
        ),
        "selection_contains" => (json!({"ids":list(id(),1000000)}), vec!["ids"]),
        "selection_restore" => (
            json!({"pick_revision":integer(1,i64::MAX)}),
            vec!["pick_revision"],
        ),
        "select" | "selection_pick" => (
            json!({"ids":list(id(),10000),"mode":choice(&["replace","add","subtract","toggle"])}),
            vec!["ids"],
        ),
        "analyze" => (
            json!({"pattern":choice(&["Proximity","Stationary","Gaps","Speed","Clusters"]),"parameters":parameters(),"selected_only":boolean(),"filter":filter(),"limit":integer(1,1000),"offset":integer(0,1000000),"max_events":integer(100,1000000)}),
            vec!["pattern"],
        ),
        "coordinates" => (
            json!({"coordinate":{"oneOf":[object(json!({"system":{"const":"dd"},"latitude":{"type":"number","minimum":-90,"maximum":90},"longitude":{"type":"number","minimum":-180,"maximum":180}}),&["system","latitude","longitude"]),object(json!({"system":{"const":"utm"},"zone":integer(1,60),"hemisphere":choice(&["N","S"]),"easting":number(),"northing":number()}),&["system","zone","hemisphere","easting","northing"]),object(json!({"system":{"const":"mgrs"},"reference":string()}),&["system","reference"])]}}),
            vec!["coordinate"],
        ),
        "edit" => (
            json!({"id":id(),"changes":changes()}),
            vec!["id", "changes"],
        ),
        "edit_many" => (
            json!({"ids":list(id(),10000),"changes":changes()}),
            vec!["ids", "changes"],
        ),
        "reassign" | "tag" => (json!({"value":string()}), vec!["value"]),
        "save_view" => (json!({"name":string(),"scene":scene()}), vec!["name"]),
        "save_group" => (json!({"name":string()}), vec!["name"]),
        "restore_view" | "restore_group" => (json!({"index":integer(0,1000)}), vec!["index"]),
        "open" | "terrain_load" => (json!({"path":string()}), vec!["path"]),
        "save" => (
            json!({"path":string(),"scene":scene(),"overwrite":boolean()}),
            vec!["path"],
        ),
        "export" => (
            json!({"path":string(),"selected_only":boolean(),"overwrite":boolean()}),
            vec!["path"],
        ),
        "wmts_servers" => (
            json!({"settings":object(json!({"servers":list(object(json!({"id":{"type":"string","minLength":1,"maxLength":64,"pattern":"^[A-Za-z0-9_-]+$"},"name":{"type":"string","minLength":1,"maxLength":128},"config":map_config()}),&["id","name","config"]),32)}),&["servers"])}),
            vec![],
        ),
        "preferences" => (json!({"preferences":preferences()}), vec![]),
        "terrain_sample" => (
            json!({"latitude":{"type":"number","minimum":-90,"maximum":90},"longitude":{"type":"number","minimum":-180,"maximum":180}}),
            vec!["latitude", "longitude"],
        ),
        "terrain_mesh" => (
            json!({"bounds":vector(4),"resolution":integer(8,257)}),
            vec!["bounds"],
        ),
        "wmts_auth_status" | "wmts_auth_reset" => (json!({}), vec![]),
        "wmts_auth_set" => (
            json!({"profile":object(json!({"origin":string(),"kind":choice(&["disabled","macos-keychain","windows-store","pkcs11"]),"identity":string()}), &["origin","kind","identity"])}),
            vec!["profile"],
        ),
        "wmts_auth_remove" => (json!({"origin":string()}), vec!["origin"]),
        "wmts_access" => (
            json!({"settings":object(json!({"concurrency":integer(1,32),"request_interval_ms":integer(0,60000),"cache_limit_mb":integer(0,1048576),"tile_ttl_days":integer(1,3650),"offline":boolean()}),&[])}),
            vec![],
        ),
        "basemap_resource" => (json!({"url":string()}), vec!["url"]),
        "wmts_cache_clear" => (json!({}), vec![]),
        "wmts_capabilities" => (json!({"url":string()}), vec!["url"]),
        "wmts_plan" | "wmts_plan_page" | "wmts_rasters" => (
            json!({"config":map_config(),"bounds":vector(4),"level":integer(0,64),"include_data":boolean(),"offset":integer(0,i64::MAX),"limit":integer(1,4096),"target_pixels":{"type":"number","minimum":1,"maximum":32768}}),
            vec!["config", "bounds"],
        ),
        "scene_sync" => (json!({"scene":scene()}), vec!["scene"]),
        "view_set" => (
            json!({"chart":nullable(chart()),"chart_presets":list(object(json!({"name":{"type":"string","minLength":1,"maxLength":128},"config":chart()}),&["name","config"]),32),"entity_colors":{"type":"object","maxProperties":10000,"propertyNames":{"maxLength":8192},"additionalProperties":{"type":"string","pattern":"^#[0-9a-fA-F]{6}$"}},"display":nullable(display_options()),"mode":choice(&["space-time","map","globe"]),"render_budget":{"enum":[20000,100000]},"fit":boolean(),"bounds":vector(4),"playback_fade":boolean(),"globe_time":boolean(),"globe_time_scale":{"type":"number","minimum":0.05,"maximum":20},"time_height":{"type":"number","minimum":0,"maximum":5},"focus":{"type":"number","minimum":0,"maximum":1},"gis_table":nullable(string()),"table_open":boolean(),"inspector_tab":choice(&["inspect","patterns","charts","views"])}),
            vec![],
        ),
        "view_recording" => (
            json!({"action":choice(&["start","status","stop"]),"path":string(),"window":choice(&["main","si-chat"]),"fps":integer(15,60),"max_seconds":{"type":"number","minimum":1,"maximum":120}}),
            vec!["action", "path"],
        ),
        "view_capture" => (
            json!({"target":choice(&["app","map"]),"window":choice(&["main","si-chat"])}),
            vec![],
        ),
        "view_status" => (json!({}), vec![]),
        "view_navigate" => (
            json!({"action":choice(&["fit","fit_layer","look_at","zoom","north_up"]),"layer_id":{"type":"string","pattern":"^[0-9a-fA-F]{32}$"},"center":{"type":"array","prefixItems":[{"type":"number","minimum":-180,"maximum":180},{"type":"number","minimum":-90,"maximum":90},{"type":"number","minimum":-12000,"maximum":10000000}],"items":false,"minItems":3,"maxItems":3},"distance_m":{"type":"number","minimum":1,"maximum":100000000},"heading_degrees":{"type":"number","minimum":0,"maximum":360},"tilt_degrees":{"type":"number","minimum":0,"maximum":89},"factor":{"type":"number","minimum":0.05,"maximum":20},"whole_globe":boolean()}),
            vec!["action"],
        ),
        "view_response" => (
            json!({"request_id":string(),"data_url":{"type":"string","maxLength":8388608},"result":{"type":"object"},"error":string()}),
            vec!["request_id"],
        ),
        "batch" => (
            json!({"operations":list(object(json!({"command":string(),"args":{"type":"object"}}),&["command"]),100)}),
            vec!["operations"],
        ),
        _ => return None,
    };
    let mut schema = object(props, &required);
    if command == "view_recording" {
        let mut start = schema["properties"].clone();
        start["action"] = json!({"const":"start"});
        schema["oneOf"] = json!([
            object(start, &["action", "path"]),
            object(
                json!({"action":choice(&["status","stop"]),"path":string()}),
                &["action", "path"]
            )
        ]);
    }
    if command == "view_navigate" {
        let variants: &[(&str, &[&str], &[&str])] = &[
            ("fit", &["whole_globe"], &[]),
            ("fit_layer", &["layer_id"], &["layer_id"]),
            (
                "look_at",
                &["center", "distance_m", "heading_degrees", "tilt_degrees"],
                &["center", "distance_m"],
            ),
            ("zoom", &["factor"], &["factor"]),
            ("north_up", &[], &[]),
        ];
        schema["oneOf"] = json!(variants
            .iter()
            .map(|(action, fields, required)| {
                let mut properties = json!({"action":{"const":action}});
                for field in *fields {
                    properties[*field] = schema["properties"][*field].clone();
                }
                let mut needed = vec!["action"];
                needed.extend_from_slice(required);
                object(properties, &needed)
            })
            .collect::<Vec<_>>());
    }
    if (is_mutation(command, &json!({})) && command != "view_navigate")
        || matches!(command, "preferences" | "wmts_access" | "wmts_servers")
    {
        let props = schema["properties"].as_object_mut().unwrap();
        props.insert("dry_run".into(), boolean());
        props.insert("expected_revision".into(), integer(1, i64::MAX));
        props.insert(
            "expected_workspace".into(),
            json!({"type":"string","minLength":1,"maxLength":128}),
        );
        props.insert(
            "idempotency_key".into(),
            json!({"type":"string","minLength":1,"maxLength":128}),
        );
    }
    if command == "attribute_table" {
        let properties = schema["properties"].as_object_mut().unwrap();
        properties.insert("column_offset".into(), integer(0, 528));
        properties.insert("column_limit".into(), integer(1, 32));
    }
    if command == "job_start" {
        schema["oneOf"] = json!(crate::jobs::COMMANDS
            .iter()
            .map(|name| {
                let nested = command_schema(name).expect("registered job command");
                let required = if nested["required"].as_array().is_some_and(|v| !v.is_empty()) {
                    vec!["command", "arguments"]
                } else {
                    vec!["command"]
                };
                object(
                    json!({"command":{"const":name},"arguments":nested}),
                    &required,
                )
            })
            .collect::<Vec<_>>());
    }
    if command == "batch" {
        schema["properties"]["operations"]["items"] = json!({"oneOf":COMMANDS.iter().filter(|name| **name != "batch" && crate::command::Command::parse(name).is_some_and(|c| c.effects().transactional)).map(|name| {
            let mut nested = command_schema(name).expect("registered batch command");
            let properties = nested["properties"].as_object_mut().unwrap();
            for control in ["dry_run", "expected_revision", "expected_workspace", "idempotency_key"] { properties.remove(control); }
            let required = if nested["required"].as_array().is_some_and(|v| !v.is_empty()) { vec!["command", "args"] } else { vec!["command"] };
            object(json!({"command":{"const":name},"args":nested}), &required)
        }).collect::<Vec<_>>()});
    }
    Some(schema)
}
static VALIDATORS: OnceLock<BTreeMap<String, jsonschema::Validator>> = OnceLock::new();
pub const COMMANDS: &[&str] = crate::command::NAMES;
/// Legacy callers retain their existing human-readable validation messages.
pub fn validate(command: &str, args: &Value) -> Result<(), String> {
    validate_typed(command, args).map_err(|error| error.message)
}
pub fn validate_typed(command: &str, args: &Value) -> Result<(), crate::error::EngineError> {
    use crate::error::{EngineError, ErrorCode};
    let command = crate::command::canonical_name(command);
    let all = VALIDATORS.get_or_init(|| {
        COMMANDS
            .iter()
            .map(|c| {
                (
                    (*c).into(),
                    jsonschema::validator_for(&command_schema(c).unwrap())
                        .expect("valid authored schema"),
                )
            })
            .collect()
    });
    let v = all.get(command).ok_or_else(|| {
        EngineError::new(
            ErrorCode::InvalidArgument,
            format!("Unknown command: {command}"),
        )
    })?;
    if let Some(e) = v.iter_errors(args).next() {
        if matches!(command, "si_configure" | "client_connect") {
            Err(EngineError::new(
                ErrorCode::InvalidArgument,
                "Invalid connection arguments",
            ))
        } else {
            Err(EngineError::new(
                ErrorCode::InvalidArgument,
                format!("Invalid arguments at {}: {e}", e.instance_path()),
            ))
        }
    } else {
        Ok(())
    }
}
mod output;
pub use output::{domain_output_schema, output_schema, validate_output};
