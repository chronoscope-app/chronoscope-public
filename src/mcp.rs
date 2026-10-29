//! MCP JSON-RPC 2.0 stdio server. Stdout is reserved for protocol messages.
use crate::engine::Engine;
use serde_json::{json, Value};
use std::{
    io::{BufRead, Write},
    path::{Path, PathBuf},
    sync::Arc,
};
fn tool_input_schema(command: &str) -> Value {
    let mut schema = crate::schema::command_schema(command).unwrap();
    if matches!(
        command,
        "import_validate" | "import_commit" | "import_review" | "import_rejections_export"
    ) {
        let required = schema["required"].as_array_mut().unwrap();
        if !required.contains(&json!("import_id")) {
            required.push(json!("import_id"));
        }
    }
    if command == "job_start" {
        let commands = crate::jobs::COMMANDS;
        schema["oneOf"] = json!(commands
            .iter()
            .copied()
            .map(|command| {
                let nested = tool_input_schema(command);
                let required = if nested["required"].as_array().is_some_and(|v| !v.is_empty()) {
                    vec!["command", "arguments"]
                } else {
                    vec!["command"]
                };
                crate::schema::object(
                    json!({"command":{"const":command},"arguments":nested}),
                    &required,
                )
            })
            .collect::<Vec<_>>());
    }
    schema
}
fn tool_output_schema(command: &str) -> Value {
    let mut success = crate::schema::output_schema(command);
    let definitions = success.as_object_mut().and_then(|s| s.remove("$defs"));
    let mut output = json!({"type":"object","anyOf":[success,{"type":"object","properties":{"error":{"type":"object","properties":{"code":serde_json::to_value(schemars::schema_for!(crate::error::ErrorCode)).expect("error schema"),"message":{"type":"string"}},"required":["code","message"],"additionalProperties":false}},"required":["error"],"additionalProperties":true}]});
    if let Some(definitions) = definitions {
        output["$defs"] = definitions;
    }
    output
}
pub fn tools() -> Vec<Value> {
    let description = |name: &str| {
        match name{
 "job_start"=>"Start a bounded asynchronous import/query/analysis/save/export. Returns a job_id immediately. Nested arguments use the corresponding command schema, including mutation controls. Poll job_status, fetch job_result, then job_release; use job_cancel to interrupt.",
 "job_status"=>"Nonblocking job state and progress. Remains available while the workspace is busy with a long operation.",
 "job_result"=>"Retrieve the bounded completed result or structured failure; never assume queued/running results are complete.",
 "pattern_scan"=>"Read-only statistical screening of current filtered or selected records: numeric IQR outliers, complete-pair correlations/time associations, source/entity recording gaps, and count-timing FFT candidates. Exact scoped calculations; no causal or significance claims. config.fields chooses up to eight measurements; empty uses bounded automatic numeric discovery. cached_only:true only checks the four-report memory cache; it never starts analysis. Use job_start for progress/cancellation. Select exact evidence using select_query with pattern_scan_id and pattern_finding_id; stale/expired scope is rejected.",
 "snapshot"=>"Workspace counts, filters, scene and bounded selection IDs. compact:true reduces context. Use query for events.",
 "query"=>"Exact indexed query with filter, source, sorting, projection and revision-bound cursor. Read-only time_utc and year_utc projections expose UTC date/year without changing records. Pages contain at most 1000 events. Does not change workspace filters.",
 "present_result"=>"Display an existing analytic result inline in SI chat, optionally choosing a bar/line/scatter chart by actual result-column names or a table. kind:map captures the live map into an inline image; bytes stay outside model context. No arbitrary HTML, URLs, scripts or computed values. Requires a live desktop for map capture.",
 "analytics_discover"=>"Search the analytic capability catalog by task; short paged descriptions plus current dataset counts. Describe a capability before running. Data stays in Rust/SQLite.",
 "analytics_describe"=>"Get one capability parameter schema, execution strategy, libraries, input budgets and assumptions. Supports optional group/metric preparation before analysis.",
 "analytics_run"=>"Execute a validated analysis plan over visible, all or selected scoped Events in an independent WAL read view. Rust calculates complete data, with explicit budgets and no silent sampling. Returns a compact persistent result_id; no raw row dump. Use job_start for progress/cancellation. Persists derived artifacts without editing Events. Source revision and scope remain attached.",
 "analytics_result"=>"Inspect one persistent analysis result summary, paged rows, chart metadata or provenance. data_stale flags changed source data. Event IDs remain exact strings. Large retained results stay in the workspace.",
 "analytics_remove"=>"Remove one saved derived result without changing Events; idempotent cleanup of bounded result storage.",
 "analytics_list"=>"List persistent analysis result handles in this project, including stale-data flags.",
 "aggregate"=>"Exact count, sum, mean, min and max grouped by entity, category, source, attribute:<name> or UTC hour/day/month/year, over the full matching dataset, not the rendered sample. Supports selected_only and apply_filter:false.",
 "statistics"=>"Deterministic full-scope numeric descriptive statistics: count, missing/non-numeric exclusions, min/max, compensated sum, mean, population variance, population/sample standard deviation. Optional other_field adds pairwise Pearson correlation with explicit undefined cases. No sampling, no record modification, bounded output and constant memory. Fields: value, lat, lon, time, end, attribute:<exact schema name>. Discover schema/types first; respect requested units and scope. Correlation is not causation.",
 "time_parse"=>"Convert a date/time string to UTC Unix seconds and UTC year using Rust's import parser. Seconds and fractions are retained with binary64 clock precision; source strings remain available. Explicit offset applies to zone-free input; ambiguous day/month requires date_order. Use ISO full dates for year boundaries. Use this tool instead of mentally calculating Unix seconds for filters.",
 "field_roles_set"=>"Assign or reset workspace field roles for chart suggestions. assignments maps exact canonical or attribute:<name> fields to measurement, category, identifier, timestamp, coordinate, unit or ignore; null restores Automatic. Patches merge atomically, are undoable and portable. Roles never coerce values, convert units or remap Event Time. Inspect dataset_schema for fields, numeric counts and paginated declared roles; snapshot contains all assignments.",
 "dataset_schema"=>"Discover column names and imported attribute types, not row values. Schema metadata never establishes whether a canonical field is empty. Use field_profile for actual examples and exact scoped null/empty/distinct counts. Original attribute names use attribute:<name>.",
 "chart_data"=>"Exact full-scope bar, line/stacked area, scatter, histogram, Tukey boxplot, UTC weekday/hour heatmap and period-comparison data. heatmap uses x:time or end, x_axis:time, no group. period uses category X and optional period_a/period_b [start,end) Unix-second windows; null windows split the scope automatically. Rust computes differences and percentages; zero/missing baselines return null. Optional OLS trendline and second Y field on supported kinds. Bounded marks and explicit omissions; no automatic sampling, source edits or persistent result artifacts. Use returned revision with select_query config/chart_marks for exact linked record selection. Chart configurations and presets persist in scene state.",
 "field_profile"=>"Inspect any canonical/derived field or attribute:<name>: exact full-scope present, null, empty-string/collection, distinct and finite-numeric counts, stored types, plus bounded actual examples with Event IDs. Counts use the complete all/visible/selected scope; examples are not frequencies. Read-only, revision-bound, disk-backed; no persistent artifact or dataset edit. Unknown fields error explicitly. Use statistics/analytics for further calculations.",
 "import_preview"=>"Stream CSV or inspect bounded Excel/GIS data; autodetect mapping including altitude. Verify altitude_unit (meters/feet/kilometers) and altitude_reference (ellipsoid/egm96/reported/unspecified); altitude_reference_column supports mixed references. Unknown-reference heights are retained but omitted in Globe Altitude. Returns import_id. Pass the ticket to validate and commit. Files stay within root.",
 "file_probe"=>"Identify workspace, tabular data or native GIS document, including JSON content discrimination. Scoped local files only.",
 "gis_layers"=>"List native GIS reference layers, bounds, time ranges, warnings and packaged resource metadata. Raw payloads stay outside snapshots.",
 "gis_load"=>"Add a local WGS84 XY Shapefile/vector GeoPackage, GeoJSON/TopoJSON/KML/KMZ/CZML/GPX, 3D Tiles tileset or glTF/GLB reference layer. Model placement requires explicit WGS84 [longitude,latitude,ellipsoid_height]. Companion assets remain local and portable; external requests are blocked.",
 "gis_set"=>"Select reference rows by exact source IDs, rename, enable/disable or change model placement/scale of a GIS reference layer. Original geometry and source data remain unchanged.",
 "gis_remove"=>"Remove a GIS reference layer from the workspace; undoable. Does not delete the source file.",
 "gis_read"=>"Read a packaged GIS resource by layer ID and relative resource name, at most 1 MiB per chunk. No arbitrary filesystem or network access.",
 "gis_table"=>"Read bounded searchable/sortable original GIS feature attributes and geometry. Reference rows have optional source timestamps; no synthetic event dates or centroids.",
 "gis_import_preview"=>"Prepare Events import from an already packaged GIS layer. Returns the standard import_id and mapping. Review timestamp mapping before import_commit; use append:true to preserve events.",
 "import_commit"=>"Commit the ticketed import into indexed storage, including altitude unit/reference mapping. Rejected rows require accept_rejected:true. append:true preserves existing events.",
 "import_validate"=>"Validate a manual mapping against six sample events without committing.",
 "import_review"=>"Validate the complete source into a disposable disk store without publishing Events. Reports rejection counts, missing locations and canonical duplicate candidates; bounded reason examples are disclosed.",
 "import_rejections_export"=>"Revalidate an import ticket and atomically export every rejected source row number and reason as formula-protected CSV within the file root. Does not commit Events. Existing files require overwrite:true.",
 "select_query"=>"Select every exact backend match, including events omitted by rendering LOD. mode replace/add/subtract/toggle.",
 "edit_many"=>"Atomically apply typed canonical field changes to up to 10000 exact string IDs; retains source attributes.",
 "batch"=>"Atomically apply up to 100 workspace operations as one revision and one undo entry. File I/O, imports, nested batches and history operations are excluded. Any failure rolls back all changes.",
 "assist_ui"=>"Inspect or drive the focused AI dialogs in the running desktop: open-explain/open-tags, explicit-provider generate, cancel, status, close. No arbitrary DOM or scripts. Use assist_tags_apply separately to apply reviewed additions. Generation starts asynchronously; poll status to verify its busy indicator.",
 "assist_status"=>"Discover focused AI providers and availability without connecting chat. Apple runs on-device; connected uses the explicitly configured SI service. No automatic provider fallback.",
 "assist_explain"=>"Explain one existing pattern finding or saved analytic result using bounded engine evidence. Tool-free inference; no chat history, calculations or edits. Use job_start for progress and cancellation.",
 "assist_tags"=>"Suggest topic tags for up to 25 explicit Event IDs from one note/label/imported text field. No edits; returns per-record source text, proposals and revision for review. Use job_start for progress/cancellation.",
 "assist_tags_apply"=>"Add reviewed tags to explicit Events atomically, preserving existing tags. Requires original expected_revision and expected_workspace; one Undo reverses the additions.",
 "analysis_context"=>"Exact compact eligibility checks for five built-in analyses over visible events or selected events within current filters. Recommendations are computed, not model guesses. No event payloads or sampling.",
 "analysis_prepare"=>"Prepare a read-only analysis configuration for review. Required thresholds must be supplied explicitly in metres/seconds/kmh. Returns a revision-bound plan; does not run the analysis.",
 "analysis_execute"=>"Run an explicitly reviewed analysis plan. Rejects stale workspace revisions and revalidates thresholds/scope. Reports all input and finding limits; no dataset mutation.",
 "si_apple_status"=>"Check actual on-device Apple Intelligence model availability. macOS 26+ only; no PCC or network fallback.",
 "analyze"=>"Analyze visible or selected events. Explicit input and finding budgets; reports evaluated_count/input_limited. No partial result should be interpreted as exhaustive.",
 "view_set"=>"Configure chart fields, scopes, chart types and portable chart_presets, as well as map presentation. chart merges partial settings; null restores the default chart. Set semantic display state (space-time/map/globe), display options (automatic clusters/points/density/heatmap, trail simplification, optional bloom), fit, bounds, time height, Globe time elevation/scale, physical altitude, playback_fade_amount (0-100), focus and GIS attribute panels. Higher fade keeps less playback history and removes departures faster; 100 keeps the latest few time slices. Set globe_altitude:true for physical altitude in Globe (disables globe_time), globe_time:true for timestamp elevation (disables altitude), or both false for ground. globe_time_scale is retained while Altitude disables its slider. Set time_height:0 to flatten Space-time. playback_fade is the legacy boolean: false/true maps to amount 0/50. playback_fade_amount takes precedence when both are supplied. Partial display objects merge into current settings. Attached desktop applies the change; use view_status to inspect the live result.",
 "view_reset"=>"Recreate the attached map graphics and reload map layers. Requires confirm:true; omitted or false confirmation is rejected. Preserves Events, filters, selection, camera and saved workspace. Returns reset:true with live view_status fields only after successful recovery. This is a graphics reload, not a dataset or camera reset. No batch/dry_run/idempotency or automatic retries; after timeout inspect view_status before retrying.",
 "view_status"=>"Inspect the actual attached desktop view: current camera/scene, renderer/backend, hardware acceleration status, browser WebGPU API exposure, loading state, GIS readiness and rendering diagnostics. Inspect capabilities for host-specific incomplete features; API presence is not backend selection. Requires a responsive desktop.",
 "view_navigate"=>"Navigate the attached desktop: fit Events, fit an enabled native GIS layer, look_at WGS84 [longitude,latitude,ellipsoid_height_m], zoom (factor>1 in), or north_up. look_at distance_m is eye-to-target range except 2D Map where it is map width; heading clockwise from north, tilt 0=nadir. Use view_set to choose the mode. Returns live state after camera persistence, not a promise that assets finished streaming. No batch/dry_run/idempotency controls; after timeout inspect view_status before retrying relative zoom.",
 "view_profile"=>"Start/status/stop a bounded per-render CPU and loading diagnostic trace. Relative sample timestamps align with started_unix_ms and video metadata. CPU submission is not GPU time. At most 6000 samples, two active traces and eight retained sessions. Video recordings start a companion trace automatically. Requires attached desktop.",
 "view_wait"=>"Wait up to 10 seconds for imagery, terrain, effects and enabled GIS layers to settle, with a stable interval. Per-condition flags may opt out. Fails on timeout; does not assert every visual artifact is absent. Requires attached desktop.",
 "view_playback"=>"Control the real desktop timeline: status, play, pause, configure, seek or step. Configure speed, increment_seconds and fade_amount (integer 0-100). Higher fade keeps less history and fades departures faster; 100 keeps about three recent time slices including concurrent entities; 0 retains history until looping. Legacy fade false/true maps to 0/50, and fade_amount takes precedence. Seek uses UTC Unix seconds; step uses signed increments. Seek/step pause first; seek rejects times outside the dataset. Shares the UI controls and clock without editing records. Requires attached desktop.",
 "view_scenario"=>"Save/list/remove named bounded navigation recipes in this profile; run/status/cancel them asynchronously in the desktop. Recipes allow only view_set/view_navigate/view_wait/view_playback and bounded waits, at most 80 steps and 120 seconds. One active run; telemetry and per-step trace included. Workspace changes abort a run; cancellation preserves completed actions. Recipes are persistent, run handles session-local; list returns portable steps for cross-build replay. No arbitrary scripts or shell.",
 "view_recording"=>"Record the attached Chronoscope app window to H.264 MP4. Inspect renderer.capture.video in capabilities for the actual backend, platform support and encoder prerequisites. action:start begins asynchronously (path required, fps 15-60 default 60, max_seconds 1-120 default 30, window main/si-chat). action:status inspects the same path; action:stop finalizes it and is repeatable. One recording at a time; no audio; 1920x1080 maximum, 256 MiB size limit, automatic stop. Existing files are never replaced. Output is confined to the MCP root; completed results include a video resource link. Requires an attached desktop with a ready host recording backend. Encoder discovery alone does not prove successful recording. After a timeout inspect status before retrying start.",
 "view_capture"=>"Capture the whole visible Chronoscope app window as PNG (default target:app, window:main), including panels, charts, tables and app dialogs. Use target:map for an attributed map-only export, or window:si-chat for the open detached SI chat. Captures app content, excluding native OS menus/file pickers and window decorations. Requires an attached, responsive desktop; app capture is unavailable in browser preview. Returns MCP image content and scope metadata, not a desktop-control session.",
 "delete"=>"Delete selected events and remove their references from saved context. Undoable. Preview with dry_run:true; guard with expected_revision.",
 "save"=>"Atomically save a portable .chronoscope workspace, including resources; indexed database for large datasets. overwrite defaults false for agent calls.",
 "demo_catalog"=>"List bundled, offline real-world demo datasets and their sources/licenses. Does not change the current workspace.",
 "demo_open"=>"Replace the current workspace with an editable copy of a bundled real-world demo, including its saved views. Use demo_catalog for IDs. Does not overwrite the bundled original; save your copy separately.",
 "export"=>"Stream exact filtered events as formula-protected CSV. Dataset credit is written to a companion path returned as attribution; share both files. overwrite defaults false for agent calls and covers the sidecar too.",
 "capabilities"=>"Discover engine limits, version, storage and supported agent workflows.",
 "diagnostics"=>"Bounded, privacy-conscious runtime health and indexed query cache statistics.",
 "wmts_auth_status"=>"Inspect native automatic TLS client-authentication availability and local origin overrides. No keys/PINs are returned. macOS/Windows use OS certificate/PIN handling; Linux needs PKCS#11 middleware and a certificate URI.",
 "wmts_auth_set"=>"Set an optional local HTTPS-origin identity override, or disabled for anonymous requests. No key files, PINs, PIN sources or module paths accepted. Default macOS/Windows authentication is automatic. Never part of saved projects.",
 "wmts_auth_remove"=>"Remove a local origin override and restore automatic OS client authentication on macOS/Windows. Linux returns to unauthenticated requests.",
 "wmts_auth_reset"=>"Close native TLS sessions and forget in-memory certificate choices. Does not delete OS credentials, unlock state or cached imagery.",
 "client_status"=>"Inspect active outbound MCP connections and grant counts; no credentials or program arguments are returned.",
 "client_tools"=>"Inspect discovered external tools, definition fingerprints and explicit local grants. Server metadata is untrusted; tool annotations do not authorize access.",
 "client_call"=>"Call an explicitly granted external MCP tool. Requires its reviewed definition fingerprint; action grants additionally need allow_actions=true. External actions are outside Chronoscope filesystem scope and undo; inspect outcomes before retrying. Use job_start for cancellation/progress.",
 "si_run"=>"Run the configured SI provider: free-form on-device Apple conversation with recent history and a workspace summary, or an OpenAI-compatible assistant using domain tools. Both providers can query/analyze data and use permitted app tools; record changes require allow_edits=true. Use job_start for asynchronous execution. May transmit requested tool data to the configured service. No shell execution.",
 "si_history"=>"Read the bounded session-only Super Intelligence conversation (up to 32 messages / 96 KiB). Never saved to projects or disk.",
 "si_clear"=>"Clear Super Intelligence conversation history; stop any active request first. Does not undo completed actions.",
 "si_permissions"=>"Grant or revoke optional folder-scoped Super Intelligence file access without reconnecting. Session-only grant; root=null revokes. File tools also require allow_edits=true on each request.",
 "si_configure"=>"Connect SI Chat to an OpenAI-compatible model service with endpoint/model. Apple Intelligence is not an SI Chat provider. API key stays in memory; use a protected args-file with CLI. HTTPS SI uses automatic native client certificates on macOS/Windows; optional origin-bound client_certificate overrides use OS identities (Linux PKCS#11 requires middleware). Optional root confines assistant file operations. Never included in projects.",
 "coordinates"=>"Convert WGS84 DD, UTM or spaced/unspaced variable precision MGRS, retaining grid precision.",
 "space_time_aggregate"=>"Read-only exact time/proximity aggregation preview. UTC fixed half-open windows; WGS84 anchored radius per entity/category/source. Missing locations remain separate. Count and bounded representative groups, no input sampling.",
 "aggregate_apply"=>"Replace the entire workspace with summaries of the matched records. Lossy, undoable; other records are excluded. Use space_time_aggregate to preview, expected_revision to guard and save the original first. First-anchor location, mean value, constituent count, first/latest times; raw members not retained in summaries.",
 "render_geometries"=>"Bounded WKT lines, polygons including holes, multiparts and geometry collections for display. WGS84 longitude/latitude, original Z/M preserved in geometry_wkt but not used as elevation/time. Polygon Events also have explicitly derived surface-centroid coordinates, identified by location_kind; point analyses use those anchors, not polygon-to-polygon distances. Lines and other non-point shapes have null scalar coordinates.",
 "basemap_resource"=>"Read a bounded public OpenFreeMap Streets style, tile, font or sprite through the direct local map cache. Fixed HTTPS provider allowlist; not an arbitrary URL fetcher. preferences.basemap selects streets or none. Network work never holds the workspace operation gate.",
 "wmts_servers"=>"List or replace the custom named WMTS server library (up to 32). The sole built-in map is OpenFreeMap Positron, selected using preferences.basemap=streets; the legacy preset list is empty. Each connection retains its imagery layer, matrix set, style, time and resolution. Library presets stay on this computer; preferences.map_layers selects the ordered, independently enabled workspace layers with opacity and zoom rules. preferences.map remains the legacy single-source setting.",
 "wmts_access"=>"Inspect or configure local concurrent WMTS loading and direct disk caching, optional offline mode and request pacing. No proxy/server required. Default has no imposed rate delay. cache_limit_mb=0 means unlimited disk cache. Settings stay local.",
 "wmts_plan_page"=>"Page all tiles at the requested resolution without testing-only downsampling/tile caps. Pass offset/limit and optional target_pixels for automatic resolution; next_offset continues coverage.",
 "display_data"=>"Exact reversible hierarchical display bins over all matching located events, optionally scoped to a viewport and UTC time slabs. Returns count, selection count, weights, time coverage and exact cell membership descriptors. Pass a cell to query/attribute_table/select_query; summaries never replace records. Not DBSCAN or inferential density analysis.",
 "render_data"=>"Bounded packed representative render points: stride 32, or 48 when altitude is present (Float64 metres at offset 32 and reference code at 40). Globe Altitude omits missing/unresolved heights and inferred locations. Use query for exhaustive data and dataset_schema to discover altitude_m/altitude_reference.",
 _=>"Typed Chronoscope domain operation; use its enforced schema. Mutations support dry_run, expected_revision and idempotency_key."
 }
    };
    crate::schema::COMMANDS.iter().filter(|name|crate::command::Command::parse(name).is_some_and(|c|c.effects().public_mcp)).map(|name|{let readonly=!crate::schema::is_mutation(name,&json!({}))&&!matches!(*name,"view_reset"|"view_recording"|"view_profile"|"view_playback"|"view_scenario"|"assist_ui"|"client_call"|"si_run"|"si_configure"|"si_disconnect"|"si_cancel"|"si_clear"|"si_permissions"|"wmts_access"|"wmts_servers"|"preferences"|"job_start"|"job_cancel"|"job_release"|"analytics_run"|"analytics_remove"|"present_result");json!({"name":format!("chronoscope_{name}"),"description":description(name),"inputSchema":tool_input_schema(name),"outputSchema":tool_output_schema(name),"annotations":{"readOnlyHint":readonly,"destructiveHint":matches!(*name,"client_call"|"aggregate_apply"|"si_run"|"delete"|"edit"|"edit_many"|"reassign"|"open"|"demo_open"|"import_commit"|"batch"|"job_start"|"save"|"export"|"import_rejections_export"|"wmts_auth_set"|"wmts_auth_remove"),"idempotentHint":readonly,"openWorldHint":name.starts_with("wmts_")||*name=="basemap_resource"||matches!(*name,"view_reset"|"si_run"|"client_call"|"assist_explain"|"assist_tags")}})}).collect()
}
pub fn error_code(message: &str) -> &'static str {
    crate::error::ErrorCode::classify(message).as_str()
}
fn rpc_error(id: Value, code: i32, message: &str) -> Value {
    json!({"jsonrpc":"2.0","id":id,"error":{"code":code,"message":message}})
}
pub(crate) fn scoped(path: &str, root: &Path, write: bool) -> Result<PathBuf, String> {
    let path = PathBuf::from(path);
    let path = if path.is_absolute() {
        path
    } else {
        root.join(path)
    };
    let canonical = if write {
        if path.exists() {
            path.canonicalize().map_err(|e| e.to_string())?
        } else {
            path.parent()
                .ok_or("Invalid output path")?
                .canonicalize()
                .map_err(|e| e.to_string())?
                .join(path.file_name().ok_or("Invalid output filename")?)
        }
    } else {
        path.canonicalize().map_err(|e| e.to_string())?
    };
    if !canonical.starts_with(root) {
        return Err("Path is outside the MCP --root scope".into());
    }
    Ok(canonical)
}
pub(crate) fn scope_arguments(command: &str, args: &mut Value, root: &Path) -> Result<(), String> {
    let command = crate::command::canonical_name(command);
    if command == "job_start" {
        if let Some(name) = args["command"].as_str() {
            args["command"] = json!(crate::command::canonical_name(name));
        }
    }
    crate::schema::validate(command, args)?;
    if matches!(
        command,
        "import_validate" | "import_commit" | "import_review" | "import_rejections_export"
    ) && args.get("import_id").is_none()
    {
        return Err("Invalid arguments: MCP imports require import_id from import_preview".into());
    }
    if matches!(command, "si_configure" | "si_permissions") {
        if let Some(path) = args["root"].as_str() {
            args["root"] = json!(scoped(path, root, false)?);
        }
    }
    if let Some(path) = args["path"].as_str() {
        if matches!(
            command,
            "save" | "export" | "import_rejections_export" | "view_recording"
        ) {
            let extension = Path::new(path)
                .extension()
                .and_then(|e| e.to_str())
                .unwrap_or("")
                .to_ascii_lowercase();
            if command == "view_recording" && extension != "mp4" {
                return Err("Invalid video extension: use .mp4".into());
            }
            if command == "save" && !matches!(extension.as_str(), "chronoscope" | "json")
                || matches!(command, "export" | "import_rejections_export") && extension != "csv"
            {
                return Err("Invalid output extension: MCP save accepts .chronoscope/.json and export accepts .csv".into());
            }
        }
    }
    if let Some(path) = args["path"].as_str() {
        let path = scoped(
            path,
            root,
            matches!(
                command,
                "save" | "export" | "import_rejections_export" | "view_recording"
            ),
        )?;
        args["path"] = json!(path);
    }
    if let Some(path) = args["preferences"]["terrain_path"].as_str() {
        args["preferences"]["terrain_path"] = json!(scoped(path, root, false)?);
    }
    if matches!(command, "save" | "export" | "import_rejections_export")
        && args.get("overwrite").is_none()
    {
        args["overwrite"] = json!(false);
    }
    if command == "snapshot" && args.get("compact").is_none() {
        args["compact"] = json!(true);
    }
    if command == "job_start" {
        let inner = args["command"].as_str().unwrap().to_owned();
        if args.get("arguments").is_none() {
            args["arguments"] = json!({})
        }
        scope_arguments(&inner, &mut args["arguments"], root)?;
    }
    if command == "batch" {
        for op in args["operations"].as_array_mut().unwrap() {
            let command = op["command"].as_str().unwrap().to_owned();
            if op.get("args").is_none() {
                op["args"] = json!({});
            }
            scope_arguments(&command, &mut op["args"], root)?;
        }
    }
    Ok(())
}
pub fn envelope_error(request: &Value) -> Option<Value> {
    let id = request.get("id").cloned().unwrap_or(Value::Null);
    let valid_id =
        id.is_null() || id.as_str().is_some_and(|s| s.len() <= 256) || id.is_i64() || id.is_u64();
    if !valid_id {
        return Some(rpc_error(
            Value::Null,
            -32600,
            "Invalid JSON-RPC request ID",
        ));
    }
    if !request.is_object()
        || request["jsonrpc"] != "2.0"
        || !request["method"].is_string()
        || request["method"].as_str().is_some_and(|m| m.len() > 256)
        || request.as_object().is_some_and(|r| {
            r.keys()
                .any(|k| !["jsonrpc", "id", "method", "params"].contains(&k.as_str()))
        })
        || request.get("params").is_some_and(|v| !v.is_object())
    {
        Some(rpc_error(id, -32600, "Invalid JSON-RPC request"))
    } else {
        None
    }
}
pub fn handle(engine: &Engine, root: &Path, request: Value) -> Option<Value> {
    let id = request.get("id").cloned().unwrap_or(Value::Null);
    if let Some(error) = envelope_error(&request) {
        return Some(error);
    }
    let method = request["method"].as_str().unwrap();
    let notification = request.get("id").is_none();
    if notification {
        return None;
    }
    // Canonicalize here as well as in serve(): embedded clients and tests may
    // supply /var aliases while SI grants have canonical /private/var roots.
    let canonical_root = match root.canonicalize() {
        Ok(root) => root,
        Err(_) => return Some(rpc_error(id, -32602, "MCP file root is unavailable")),
    };
    let root = canonical_root.as_path();
    let result: Result<Value, (i32, String)> = match method {
        "initialize" => {
            let requested = request["params"]["protocolVersion"]
                .as_str()
                .unwrap_or("2025-06-18");
            let version =
                if ["2024-11-05", "2025-03-26", "2025-06-18", "2025-11-25"].contains(&requested) {
                    requested
                } else {
                    "2025-06-18"
                };
            Ok(
                json!({"protocolVersion":version,"capabilities":{"tools":{"listChanged":false},"resources":{"listChanged":false,"subscribe":true},"prompts":{"listChanged":false}},"serverInfo":{"name":crate::platform::MCP_SERVER_NAME,"version":env!("CARGO_PKG_VERSION")},"instructions":"Discover dataset_schema, then query with bounded projections/cursors. Query and select_query examine full indexed data; rendering may use representative LOD. Inspect analysis input_limited. Mutations support expected_revision, dry_run and idempotency_key; batch is atomic. Files are confined to root; relative paths resolve there. Read chronoscope://connection for the effective root. Preview tickets persist only within this server/session. Cancellation is cooperative; inspect revision after interrupted operations. For native GIS reference content discover gis_layers/gis_table; convert via gis_import_preview for Event analysis. view_set controls display and Globe time elevation; view_navigate uses geographic camera inputs, view_status inspects the live desktop view, view_capture defaults to the whole app window as a PNG; use target:map for a map-only export or window:si-chat for the detached chat. view_recording starts/statuses/stops a bounded attached app-window MP4; inspect renderer.capture.video in capabilities for the actual backend, platform support and encoder prerequisites, and use a new .mp4 path within the file root. Live tools need an attached desktop. Read capabilities and view_status for the attached renderer, actual backend, hardware acceleration status and incomplete features; browser WebGPU API presence does not establish the rendering backend. WMTS uses a direct local cache with configurable concurrency and no default request delay."}),
            )
        }
        "ping" => Ok(json!({})),
        "chronoscope/resource-version" => Ok(engine.resource_version()),
        "tools/list" => Ok(json!({"tools":tools()})),
        "resources/templates/list" => Ok(json!({"resourceTemplates":[]})),
        "resources/list" => Ok(
            json!({"resources":[{"uri":"ui://chronoscope/explorer","name":"Interactive Chronoscope results","mimeType":"text/html;profile=mcp-app"},{"uri":"chronoscope://results","name":"Saved analytic results","mimeType":"application/json"},{"uri":"chronoscope://jobs","name":"Asynchronous jobs","mimeType":"application/json"},{"uri":"chronoscope://workspace","name":"Current workspace","mimeType":"application/json"},{"uri":"chronoscope://schema","name":"Dataset schema","mimeType":"application/json"},{"uri":"chronoscope://capabilities","name":"Engine capabilities","mimeType":"application/json"},{"uri":"chronoscope://view","name":"Live desktop view (attached desktop required)","mimeType":"application/json"},{"uri":"chronoscope://connection","name":"Connection and file scope","mimeType":"application/json"}]}),
        ),
        "resources/read" => {
            if request["params"]["uri"] == apps::URI {
                return Some(
                    json!({"jsonrpc":"2.0","id":id,"result":{"contents":[apps::resource()]}}),
                );
            }
            let command = match request["params"]["uri"].as_str() {
                Some("chronoscope://workspace") => Some("snapshot"),
                Some("chronoscope://schema") => Some("dataset_schema"),
                Some("chronoscope://capabilities") => Some("capabilities"),
                Some("chronoscope://view") => Some("view_status"),
                Some("chronoscope://results") => Some("analytics_list"),
                _ => None,
            };
            if let Some(command) = command {
                engine.invoke(command,if command=="snapshot"{json!({"compact":true})}else{json!({})}).map(|v|json!({"contents":[{"uri":request["params"]["uri"],"mimeType":"application/json","text":v.to_string()}]})).map_err(|e|(-32603,e))
            } else if request["params"]["uri"] == "chronoscope://jobs" {
                Ok(
                    json!({"contents":[{"uri":"chronoscope://jobs","mimeType":"application/json","text":engine.resource_version()[3].to_string()}]}),
                )
            } else if request["params"]["uri"] == "chronoscope://connection" {
                Ok(
                    json!({"contents":[{"uri":"chronoscope://connection","mimeType":"application/json","text":json!({"file_root":root,"relative_paths":true,"file_scope":"read/write within this root; embedded validated terrain remains readable"}).to_string()}]}),
                )
            } else {
                Err((-32602, "Unknown resource".into()))
            }
        }
        "prompts/list" => Ok(
            json!({"prompts":[{"name":"investigate","description":"Evidence-based spatial-temporal investigation workflow"}]}),
        ),
        "prompts/get" => {
            if request["params"]["name"] == "investigate" {
                Ok(
                    json!({"description":"Chronoscope investigation","messages":[{"role":"user","content":{"type":"text","text":"Inspect workspace/schema. Query exact evidence with small field projections, UTC time filters (fractional seconds supported) and spatial bounds. Aggregate before fetching many records. State observed facts separately from hypotheses. Analyze with explicit thresholds; disclose input_limited and finding limits. Preview changes using dry_run, then apply with expected_revision and a stable idempotency key. Use batch for atomic related edits. Save a portable workspace and report paths, revision, counts and any limitations. When attached to desktop, set the scene and capture the whole app to check panels and rendered content; use target:map for a clean map export."}}]}),
                )
            } else {
                Err((-32602, "Unknown prompt".into()))
            }
        }
        "tools/call" => {
            let params = &request["params"];
            if !params["name"].is_string()
                || params.get("arguments").is_some_and(|v| !v.is_object())
                || params.get("_meta").is_some_and(|v| !v.is_object())
                || params.as_object().is_none_or(|p| {
                    p.keys()
                        .any(|k| !["name", "arguments", "_meta"].contains(&k.as_str()))
                })
            {
                return Some(rpc_error(
                    id,
                    -32602,
                    "Invalid tools/call parameters; mutation controls belong inside arguments",
                ));
            }
            let name = request["params"]["name"].as_str().unwrap_or("");
            let command =
                crate::command::canonical_name(name.strip_prefix("chronoscope_").unwrap_or(""));
            if !crate::schema::COMMANDS.contains(&command)
                || !crate::command::Command::parse(command).is_some_and(|c| c.effects().public_mcp)
            {
                Err((-32602, "Unknown tool".into()))
            } else {
                let mut args = request["params"]
                    .get("arguments")
                    .cloned()
                    .unwrap_or(json!({}));
                let action = (|| -> Result<Value, String> {
                    scope_arguments(command, &mut args, root)?;
                    let workspace = if matches!(command, "query" | "chart_data") {
                        Some(engine.workspace_identity()?)
                    } else {
                        None
                    };
                    let mut value = crate::operation::with_scope(root.to_path_buf(), || {
                        if let Some(workspace) = &workspace {
                            crate::operation::with_workspace(workspace.clone(), || {
                                engine.invoke(command, args.clone())
                            })
                        } else {
                            engine.invoke(command, args.clone())
                        }
                    })?;
                    if let Some(workspace) = workspace {
                        value["workspace_id"] = json!(workspace);
                    }
                    let raster_job = command == "job_result" && value["command"] == "wmts_rasters";
                    if (command == "wmts_rasters" || raster_job)
                        && !args["include_data"].as_bool().unwrap_or(false)
                    {
                        let value = if raster_job {
                            &mut value["result"]
                        } else {
                            &mut value
                        };
                        if let Some(tiles) = value["tiles"].as_array_mut() {
                            for tile in tiles {
                                tile.as_object_mut().unwrap().remove("data_url");
                            }
                        }
                    }
                    let mut content = vec![];
                    if command == "view_capture" {
                        if let Some(url) = value["data_url"].as_str() {
                            if let Some(data) = url.strip_prefix("data:image/png;base64,") {
                                content.push(
                                    json!({"type":"image","mimeType":"image/png","data":data}),
                                );
                            }
                        }
                        value.as_object_mut().unwrap().remove("data_url");
                    }
                    if command == "view_recording" && value["state"] == "complete" {
                        content.push(json!({"type":"resource_link","uri":value["uri"],"name":std::path::Path::new(value["path"].as_str().unwrap_or("recording.mp4")).file_name().unwrap_or_default().to_string_lossy(),"mimeType":"video/mp4","size":value["bytes"],"description":"Native Chronoscope app-window recording"}));
                    }
                    let structured = if value.is_object() {
                        value
                    } else {
                        json!({"result":value})
                    };
                    let bytes = structured.to_string().len();
                    if bytes > 4 * 1024 * 1024 {
                        return Err("RESOURCE_LIMIT: response exceeds 4 MiB; reduce page, fields, render or analysis budgets".into());
                    }
                    crate::schema::validate_output(command, &structured)?;
                    content.push(json!({"type":"text","text":format!("{command} completed{}.",structured["revision"].as_u64().map(|r|format!(" at revision {r}")).unwrap_or_default())}));
                    Ok(json!({"content":content,"structuredContent":structured,"isError":false}))
                })();
                Ok(match action {
                    Ok(v) => v,
                    Err(error) => {
                        json!({"content":[{"type":"text","text":error}],"structuredContent":{"error":{"code":error_code(&error),"message":error}},"isError":true})
                    }
                })
            }
        }
        _ => Err((-32601, "Method not found".into())),
    };
    Some(match result {
        Ok(value) => json!({"jsonrpc":"2.0","id":id,"result":value}),
        Err((code, message)) => rpc_error(id, code, &message),
    })
}
const MAX_REQUEST: usize = 4 * 1024 * 1024;
/// Recover after oversized input by draining the rest of that line without allocating it.
pub fn read_message(reader: &mut impl BufRead) -> Result<Option<Vec<u8>>, String> {
    let mut line = vec![];
    let mut oversized = false;
    loop {
        let bytes = reader.fill_buf().map_err(|e| e.to_string())?;
        if bytes.is_empty() {
            if line.is_empty() && !oversized {
                return Ok(None);
            }
            break;
        }
        let end = bytes
            .iter()
            .position(|b| *b == b'\n')
            .map(|i| i + 1)
            .unwrap_or(bytes.len());
        if line.len() + end > MAX_REQUEST {
            oversized = true;
        }
        if !oversized {
            line.extend_from_slice(&bytes[..end]);
        }
        let done = bytes[end - 1] == b'\n';
        reader.consume(end);
        if done {
            break;
        }
    }
    if oversized {
        Err("Request exceeds 4 MiB".into())
    } else {
        Ok(Some(line))
    }
}
pub fn serve(engine: Arc<Engine>, root: PathBuf) -> Result<(), String> {
    use std::sync::{
        atomic::{AtomicBool, Ordering},
        mpsc, Mutex,
    };
    let root = root.canonicalize().map_err(|e| e.to_string())?;
    if !root.is_dir() {
        return Err("MCP root must be a directory".into());
    }
    let output = Arc::new(Mutex::new(std::io::stdout()));
    let cancellations: Arc<Mutex<std::collections::BTreeMap<String, Arc<AtomicBool>>>> =
        Arc::new(Mutex::new(Default::default()));
    let (sender, queue) = mpsc::sync_channel::<(Value, Arc<AtomicBool>)>(64);
    let write = move |value: &Value, out: &Arc<Mutex<std::io::Stdout>>| {
        let mut out = out.lock().map_err(|_| "Protocol output unavailable")?;
        serde_json::to_writer(&mut *out, value).map_err(|e| e.to_string())?;
        writeln!(out).map_err(|e| e.to_string())?;
        out.flush().map_err(|e| e.to_string())
    };
    let subscriptions = Arc::new(subscriptions::Subscriptions::default());
    let subscription_engine = engine.clone();
    let subscription_output = output.clone();
    subscriptions.start(
        move || Ok(subscription_engine.resource_version()),
        move |value| write(&value, &subscription_output),
    );
    let worker_subscriptions = subscriptions.clone();
    let worker_output = output.clone();
    let worker_cancel = cancellations.clone();
    let worker_engine = engine.clone();
    let worker_root = root.clone();
    let worker = std::thread::spawn(move || -> Result<(), String> {
        let mut initialized = false;
        let mut ui = apps::Session::default();
        for (request, cancelled) in queue {
            let id = request.get("id").cloned().unwrap_or(Value::Null);
            let key = id.to_string();
            let method = request["method"].as_str().unwrap_or("").to_owned();
            ui.initialize(&request);
            let token = request["params"]["_meta"]["progressToken"].clone();
            let progress_output = worker_output.clone();
            let progress = if token.is_string() || token.is_number() {
                Some(Arc::new(move |progress, total, message: &str| {
                    let mut params =
                        json!({"progressToken":token,"progress":progress,"message":message});
                    if let Some(total) = total {
                        params["total"] = json!(total);
                    }
                    let _ = write(
                        &json!({"jsonrpc":"2.0","method":"notifications/progress","params":params}),
                        &progress_output,
                    );
                })
                    as Arc<dyn Fn(u64, Option<u64>, &str) + Send + Sync>)
            } else {
                None
            };
            let response = if cancelled.load(Ordering::Relaxed) {
                Some(rpc_error(id.clone(), -32800, "Request cancelled"))
            } else if !initialized
                && request["method"] != "initialize"
                && request["method"] != "ping"
            {
                Some(rpc_error(id.clone(), -32002, "Initialize the server first"))
            } else {
                if let Some(response) = worker_subscriptions.handle(&request) {
                    write(&response, &worker_output)?;
                    worker_cancel
                        .lock()
                        .map_err(|_| "Request registry unavailable")?
                        .remove(&key);
                    continue;
                }
                let is_initialize = request["method"] == "initialize";
                let response = crate::operation::with_context(
                    crate::operation::Context {
                        cancelled: cancelled.clone(),
                        progress,
                        scope: None,
                    },
                    || handle(&worker_engine, &worker_root, request),
                );
                if is_initialize && response.as_ref().is_some_and(|r| r.get("result").is_some()) {
                    initialized = true;
                }
                response
            };
            if let Some(response) = response {
                write(&ui.decorate(&method, response), &worker_output)?;
            }
            worker_cancel
                .lock()
                .map_err(|_| "Request registry unavailable")?
                .remove(&key);
        }
        Ok(())
    });
    let stdin = std::io::stdin();
    let mut reader = stdin.lock();
    let result = (|| {
        loop {
            let bytes = match read_message(&mut reader) {
                Ok(Some(bytes)) => bytes,
                Ok(None) => break,
                Err(message) => {
                    write(&rpc_error(Value::Null, -32600, &message), &output)?;
                    continue;
                }
            };
            let request: Value = match serde_json::from_slice(&bytes) {
                Ok(v) => v,
                Err(_) => {
                    write(&rpc_error(Value::Null, -32700, "Parse error"), &output)?;
                    continue;
                }
            };
            if let Some(error) = envelope_error(&request) {
                write(&error, &output)?;
                continue;
            }
            if request["method"] == "notifications/cancelled" {
                let key = request["params"]["requestId"].to_string();
                if let Some(flag) = cancellations
                    .lock()
                    .map_err(|_| "Request registry unavailable")?
                    .get(&key)
                {
                    flag.store(true, Ordering::Relaxed);
                }
                continue;
            }
            if request.get("id").is_none() {
                if let Some(response) = handle(&engine, &root, request) {
                    write(&response, &output)?;
                }
                continue;
            }
            let key = request["id"].to_string();
            let flag = Arc::new(AtomicBool::new(false));
            {
                let mut registry = cancellations
                    .lock()
                    .map_err(|_| "Request registry unavailable")?;
                if registry.contains_key(&key) {
                    write(
                        &rpc_error(request["id"].clone(), -32600, "Duplicate active request ID"),
                        &output,
                    )?;
                    continue;
                }
                registry.insert(key.clone(), flag.clone());
            }
            if let Err(e) = sender.try_send((request, flag)) {
                cancellations
                    .lock()
                    .map_err(|_| "Request registry unavailable")?
                    .remove(&key);
                if let mpsc::TrySendError::Full((request, _)) = e {
                    write(
                        &rpc_error(
                            request["id"].clone(),
                            -32000,
                            "Request queue is full (64 requests)",
                        ),
                        &output,
                    )?;
                } else {
                    return Err("Protocol worker stopped".into());
                }
            }
        }
        Ok(())
    })();
    subscriptions.stop();
    drop(sender);
    let worker = worker.join().map_err(|_| "Protocol worker failed")?;
    result.and(worker)
}
pub mod apps;
pub mod subscriptions;
