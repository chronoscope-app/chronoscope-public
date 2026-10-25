use base64::Engine as _;
use chronoscope::{engine::Engine, project::Project};
use serde_json::{json, Value};
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc,
};

#[test]
fn capture_defaults_to_app_and_mcp_returns_image_with_authoritative_scope() {
    let (dir, e) = setup();
    let callback = Arc::downgrade(&e);
    let bytes = base64::engine::general_purpose::STANDARD.encode(b"\x89PNG\r\n\x1a\nfixture");
    let expected = bytes.clone();
    e.set_observer(Arc::new(move |event| {
        if event["kind"] != "capture" { return; }
        let callback = callback.upgrade().unwrap();
        assert!(matches!(event["arguments"]["target"].as_str(), Some("app" | "map")));
        assert!(matches!(event["arguments"]["window"].as_str(), Some("main" | "si-chat")));
        // A capture wait must never hold the workspace gate.
        callback.invoke("snapshot", json!({"compact":true})).unwrap();
        callback.invoke("view_response", json!({"request_id":event["request_id"],"data_url":format!("data:image/png;base64,{bytes}")})).unwrap();
    })).unwrap();
    for (args, target, window) in [
        (json!({}), "app", "main"),
        (json!({"target":"map"}), "map", "main"),
        (json!({"window":"si-chat"}), "app", "si-chat"),
    ] {
        let response = chronoscope::mcp::handle(&e, dir.path(), json!({"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"chronoscope_view_capture","arguments":args}})).unwrap();
        let result = &response["result"];
        assert_eq!(result["isError"], false, "{response}");
        let metadata = &result["structuredContent"];
        assert_eq!(metadata["target"], target);
        assert_eq!(metadata["window"], window);
        assert!(metadata.get("data_url").is_none());
        let image = result["content"]
            .as_array()
            .unwrap()
            .iter()
            .find(|item| item["type"] == "image")
            .unwrap();
        assert_eq!(image["mimeType"], "image/png");
        assert_eq!(image["data"], expected);
    }
}

#[test]
fn capture_rejects_arbitrary_windows_invalid_scope_and_propagates_native_failure() {
    let (_dir, e) = setup();
    for args in [
        json!({"window":"other-app"}),
        json!({"target":"screen"}),
        json!({"target":"map","window":"si-chat"}),
    ] {
        let error = e.invoke("view_capture", args).unwrap_err();
        assert_eq!(
            chronoscope::error::ErrorCode::classify(&error),
            chronoscope::error::ErrorCode::InvalidArgument,
            "{error}"
        );
    }
    assert!(e
        .invoke("view_capture", json!({}))
        .unwrap_err()
        .starts_with("UNAVAILABLE:"));
    let callback = Arc::downgrade(&e);
    e.set_observer(Arc::new(move |event| {
        if event["kind"] == "capture" {
            let callback = callback.upgrade().unwrap();
            assert!(callback.invoke("view_response", json!({"request_id":event["request_id"],"error":"UNAVAILABLE: requested app window is not open"})).is_err());
        }
    })).unwrap();
    assert_eq!(
        e.invoke("view_capture", json!({"window":"si-chat"}))
            .unwrap_err(),
        "UNAVAILABLE: requested app window is not open"
    );
}
fn setup() -> (tempfile::TempDir, Arc<Engine>) {
    let dir = tempfile::tempdir().unwrap();
    let engine = Arc::new(
        Engine::new(
            Project::new(chronoscope::demo::dataset()),
            dir.path().into(),
        )
        .unwrap(),
    );
    (dir, engine)
}
fn status() -> Value {
    json!({"revision":1,"renderer":"cesium","backend":"WebGL2","webgpu_api_available":false,"hardware_acceleration":"unknown","mode":"globe","scene":{"renderer":"cesium","mode":"globe"},"viewport":{"width":1280,"height":800},"loading":{"imagery":false,"effects":false,"gis":0},"gis_layers":[],"diagnostics":{}})
}
#[test]
fn discover_live_tools_and_explicit_headless_limits() {
    let (_dir, e) = setup();
    let tools = chronoscope::mcp::tools();
    for name in ["view_status", "view_navigate", "view_capture"] {
        assert!(tools
            .iter()
            .any(|t| t["name"] == format!("chronoscope_{name}")));
        assert!(e
            .invoke(
                name,
                if name == "view_navigate" {
                    json!({"action":"fit"})
                } else {
                    json!({})
                }
            )
            .unwrap_err()
            .starts_with("UNAVAILABLE:"));
    }
    let schema = chronoscope::schema::command_schema("view_navigate").unwrap();
    assert!(schema["properties"].get("dry_run").is_none());
    assert!(e
        .invoke("view_navigate", json!({"action":"zoom"}))
        .unwrap_err()
        .contains("Invalid arguments"));
    assert!(e
        .invoke("view_navigate", json!({"action":"fit","factor":2}))
        .unwrap_err()
        .contains("Invalid arguments"));
    assert!(e
        .invoke(
            "view_navigate",
            json!({"action":"look_at","center":[0,91,0],"distance_m":1000})
        )
        .is_err());
    let capabilities = e.invoke("capabilities", json!({})).unwrap();
    assert_eq!(capabilities["renderer"]["webgpu_backend"], false);
}
#[test]
fn display_patches_and_repeated_mode_retain_existing_camera_and_style() {
    let (_dir, e) = setup();
    let camera =
        json!({"position":[7000000.0,0.0,0.0],"direction":[-1.0,0.0,0.0],"up":[0.0,0.0,1.0]});
    e.invoke("scene_sync",json!({"scene":{"renderer":"cesium","mode":"globe","cesium_camera":camera,"display":{"bloom":true,"point_scale":1.6,"show_tracks":false},"globe_time":true,"globe_time_scale":2}})).unwrap();
    let updated = e
        .invoke(
            "view_set",
            json!({"mode":"globe","display":{"bloom":false}}),
        )
        .unwrap();
    assert_eq!(updated["scene"]["cesium_camera"], camera);
    assert_eq!(updated["scene"]["display"]["point_scale"], 1.6);
    assert_eq!(updated["scene"]["display"]["show_tracks"], false);
    assert_eq!(updated["scene"]["globe_time_scale"], 2.0);
    assert_eq!(updated["scene"]["display"]["bloom"], false);
    let changed = e.invoke("view_set", json!({"mode":"map"})).unwrap();
    assert!(changed["scene"].get("cesium_camera").is_none());
}
#[test]
fn live_responses_are_typed_and_do_not_deadlock_the_workspace_gate() {
    let (_dir, e) = setup();
    let callback = e.clone();
    e.set_observer(Arc::new(move |event| {
        if ["view_status", "view_navigate"]
            .iter()
            .any(|k| event["kind"] == *k)
        {
            // A frontend can read the engine while the live request is pending.
            callback
                .invoke("snapshot", json!({"compact":true}))
                .unwrap();
            callback
                .invoke(
                    "view_response",
                    json!({"request_id":event["request_id"],"result":status()}),
                )
                .unwrap();
        }
    }))
    .unwrap();
    for (command, args) in [
        ("view_status", json!({})),
        ("view_navigate", json!({"action":"zoom","factor":2})),
    ] {
        let result = e.invoke(command, args).unwrap();
        chronoscope::schema::validate_output(command, &result).unwrap();
        assert_eq!(result["backend"], "WebGL2");
    }
    let callback = e.clone();
    e.set_observer(Arc::new(move |event| {
        if event["kind"] == "view_status" {
            assert!(callback
                .invoke(
                    "view_response",
                    json!({"request_id":event["request_id"],"result":{"backend":"WebGPU"}})
                )
                .is_err());
        }
    }))
    .unwrap();
    assert!(e.invoke("view_status", json!({})).is_err());
}
#[test]
fn cancelled_live_request_expires_its_response_ticket() {
    let (_dir, e) = setup();
    let cancel = Arc::new(AtomicBool::new(false));
    let copied = cancel.clone();
    let ticket = Arc::new(std::sync::Mutex::new(Value::Null));
    let saved = ticket.clone();
    e.set_observer(Arc::new(move |event| {
        *saved.lock().unwrap() = event["request_id"].clone();
        copied.store(true, Ordering::Release);
    }))
    .unwrap();
    let error = chronoscope::operation::with_context(
        chronoscope::operation::Context {
            cancelled: cancel,
            progress: None,
            scope: None,
        },
        || e.invoke("view_status", json!({})),
    )
    .unwrap_err();
    assert!(error.starts_with("CANCELLED:"));
    assert!(e
        .invoke(
            "view_response",
            json!({"request_id":*ticket.lock().unwrap(),"result":status()})
        )
        .unwrap_err()
        .contains("expired"));
}
#[test]
fn native_selection_uses_real_ids_and_removal_cleans_saved_table_context() {
    let (_dir, e) = setup();
    let source =
        std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/gis/events.geojson");
    let id = e.invoke("gis_load", json!({"path":source})).unwrap()["layer"]["id"].clone();
    assert!(e
        .invoke("gis_set", json!({"id":id,"selected":["nonexistent"]}))
        .is_err());
    let selected = e
        .invoke("gis_set", json!({"id":id,"selected":["zone-1","zone-1"]}))
        .unwrap();
    assert_eq!(selected["layer"]["selected"], json!(["zone-1"]));
    e.invoke("view_set", json!({"gis_table":id,"table_open":true}))
        .unwrap();
    e.invoke("save_view", json!({"name":"Reference"})).unwrap();
    e.invoke("gis_remove", json!({"id":id})).unwrap();
    let snapshot = e.invoke("snapshot", json!({"compact":true})).unwrap();
    assert!(snapshot["scene"].get("gis_table").is_none());
    assert!(snapshot["views"][0]["scene"].get("gis_table").is_none());
}
#[test]
fn byte_limited_gis_pages_have_lossless_continuation_and_revision_guard() {
    let (dir, e) = setup();
    let features:Vec<_>=(0..6).map(|i|json!({"type":"Feature","id":format!("f{i}"),"properties":{"payload":"x".repeat(850000)},"geometry":{"type":"Point","coordinates":[i,0]}})).collect();
    let path = dir.path().join("large-properties.geojson");
    std::fs::write(
        &path,
        serde_json::to_vec(&json!({"type":"FeatureCollection","features":features})).unwrap(),
    )
    .unwrap();
    let id = e.invoke("gis_load", json!({"path":path})).unwrap()["layer"]["id"].clone();
    let first = e
        .invoke("gis_table", json!({"id":id,"limit":1000}))
        .unwrap();
    assert!(first["returned_count"].as_u64().unwrap() < 6);
    let second=e.invoke("gis_table",json!({"id":id,"limit":1000,"offset":first["next_offset"],"expected_revision":first["revision"]})).unwrap();
    let mut ids: Vec<_> = first["rows"]
        .as_array()
        .unwrap()
        .iter()
        .chain(second["rows"].as_array().unwrap())
        .map(|r| r["id"].clone())
        .collect();
    ids.sort_by_key(Value::to_string);
    ids.dedup();
    assert_eq!(ids.len(), 6);
    assert!(second["next_offset"].is_null());
    e.invoke("gis_set", json!({"id":id,"enabled":false}))
        .unwrap();
    assert!(e
        .invoke(
            "gis_table",
            json!({"id":id,"expected_revision":first["revision"]})
        )
        .unwrap_err()
        .starts_with("CONFLICT:"));
}

#[test]
fn reference_feature_lookup_does_not_alias_slash_ids_or_unrelated_source_properties() {
    let (dir, e) = setup();
    let file = dir.path().join("identities.geojson");
    std::fs::write(&file,serde_json::to_vec(&json!({"type":"FeatureCollection","features":[
      {"type":"Feature","id":"group","properties":{},"geometry":{"type":"Point","coordinates":[1,1]}},
      {"type":"Feature","id":"group/child","properties":{"czml_id":"group","chronoscope_native_id":"group"},"geometry":{"type":"Point","coordinates":[2,2]}}
    ]})).unwrap()).unwrap();
    let id = e.invoke("gis_load", json!({"path":file})).unwrap()["layer"]["id"].clone();
    let table = e
        .invoke("gis_table", json!({"id":id,"feature_id":"group"}))
        .unwrap();
    assert_eq!(table["count"], 1);
    assert_eq!(table["rows"][0]["id"], "group");
}

#[test]
fn recording_discovery_scope_defaults_and_video_resource_do_not_block_workspace() {
    let (dir, engine) = setup();
    let tool = chronoscope::mcp::tools()
        .into_iter()
        .find(|t| t["name"] == "chronoscope_view_recording")
        .unwrap();
    assert_eq!(tool["annotations"]["readOnlyHint"], false);
    let weak = Arc::downgrade(&engine);
    engine.set_observer(Arc::new(move |event| {
        if event["kind"] != "view_recording" { return; }
        let engine = weak.upgrade().unwrap();
        engine.invoke("snapshot", json!({"compact":true})).unwrap();
        let args = &event["arguments"];
        if args["action"] == "start" {
            assert_eq!(args["fps"], 60);
            assert_eq!(args["max_seconds"], 30);
            assert_eq!(args["window"], "main");
        }
        let state = if args["action"] == "stop" { "complete" } else { "recording" };
        engine.invoke("view_response", json!({"request_id":event["request_id"],"result":{
            "path":args["path"],"uri":"file:///scoped/video%20recording.mp4","state":state,"backend":"screencapturekit","mime_type":"video/mp4","window":"main","fps":60,"max_seconds":30,"width":1920,"height":1080,"duration_seconds":1.5,"bytes":1024,"started_unix_ms":1,"error":null
        }})).unwrap();
    })).unwrap();
    for action in ["start", "status", "stop", "stop"] {
        let response = chronoscope::mcp::handle(&engine, dir.path(), json!({"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"chronoscope_view_recording","arguments":{"action":action,"path":"video recording.mp4"}}})).unwrap();
        assert_eq!(response["result"]["isError"], false, "{response}");
        if action == "stop" {
            let resource = response["result"]["content"]
                .as_array()
                .unwrap()
                .iter()
                .find(|c| c["type"] == "resource_link")
                .unwrap();
            assert_eq!(resource["mimeType"], "video/mp4");
            assert!(resource["uri"]
                .as_str()
                .unwrap()
                .ends_with("video%20recording.mp4"));
            assert_ne!(resource["uri"], "file:///scoped/video%20recording.mp4");
            assert_eq!(resource["size"], 1024);
            assert!(response["result"]["structuredContent"]
                .get("data")
                .is_none());
        }
    }
    let response = chronoscope::mcp::handle(&engine, dir.path(), json!({"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"chronoscope_view_recording","arguments":{"action":"start","path":"../outside.mp4"}}})).unwrap();
    assert_eq!(response["result"]["isError"], true);
}

#[test]
fn recording_rejects_invalid_limits_targets_and_overwrite_before_native_dispatch() {
    let (dir, engine) = setup();
    let path = dir.path().join("recording.mp4");
    for args in [
        json!({"action":"start","path":path,"fps":120}),
        json!({"action":"start","path":path,"max_seconds":121}),
        json!({"action":"start","path":path,"window":"screen"}),
        json!({"action":"stop","path":path,"fps":60}),
        json!({"action":"start","path":dir.path().join("recording.txt")}),
    ] {
        assert!(engine.invoke("view_recording", args).is_err());
    }
    assert!(engine
        .invoke("view_recording", json!({"action":"start","path":path}))
        .unwrap_err()
        .starts_with("UNAVAILABLE:"));
    std::fs::write(&path, b"existing movie").unwrap();
    assert!(engine
        .invoke("view_recording", json!({"action":"start","path":path}))
        .unwrap_err()
        .starts_with("CONFLICT:"));
    assert_eq!(std::fs::read(path).unwrap(), b"existing movie");
}

#[test]
fn navigation_recipe_library_is_persistent_bounded_and_validates_nested_tools() {
    let (dir, engine) = setup();
    let steps = json!([
        {"command":"view_set","arguments":{"mode":"map"}},
        {"command":"view_navigate","arguments":{"action":"zoom","factor":1.2}},
        {"command":"view_wait","arguments":{"timeout_ms":1000}},
        {"command":"view_playback","arguments":{"action":"pause"}},
        {"command":"wait","arguments":{"milliseconds":10}}
    ]);
    let save = json!({"action":"save","name":"Pan test","steps":steps});
    assert_eq!(
        engine.invoke("view_scenario", save.clone()).unwrap()["saved"],
        true
    );
    assert!(engine
        .invoke("view_scenario", save.clone())
        .unwrap_err()
        .starts_with("CONFLICT:"));
    let mut overwrite = save.clone();
    overwrite["overwrite"] = json!(true);
    engine.invoke("view_scenario", overwrite).unwrap();
    assert_eq!(
        engine
            .invoke("view_scenario", json!({"action":"list"}))
            .unwrap()["scenarios"]["Pan test"],
        steps
    );
    let weak = Arc::downgrade(&engine);
    engine.set_observer(Arc::new(move |event| {
        if event["kind"]!="view_scenario" { return; }
        assert_eq!(event["arguments"]["steps"].as_array().unwrap().len(),5);
        weak.upgrade().unwrap().invoke("view_response",json!({"request_id":event["request_id"],"result":{"id":"run-1","state":"running","completed_steps":0,"error":null}})).unwrap();
    })).unwrap();
    assert_eq!(
        engine
            .invoke("view_scenario", json!({"action":"run","name":"Pan test"}))
            .unwrap()["state"],
        "running"
    );
    for step in [
        json!({"command":"save","arguments":{"path":"outside.json"}}),
        json!({"command":"wait","arguments":{"milliseconds":90000}}),
        json!({"command":"view_navigate","arguments":{"action":"zoom","factor":0}}),
    ] {
        assert!(engine
            .invoke(
                "view_scenario",
                json!({"action":"save","name":"invalid","steps":[step]})
            )
            .is_err());
    }
    drop(engine);
    let restored = Engine::new(
        Project::new(chronoscope::demo::dataset()),
        dir.path().into(),
    )
    .unwrap();
    assert_eq!(
        restored
            .invoke("view_scenario", json!({"action":"list"}))
            .unwrap()["scenarios"]["Pan test"],
        steps
    );
    restored
        .invoke(
            "view_scenario",
            json!({"action":"remove","name":"Pan test"}),
        )
        .unwrap();
    assert!(restored
        .invoke("view_scenario", json!({"action":"run","name":"Pan test"}))
        .unwrap_err()
        .starts_with("NOT_FOUND:"));
}

#[test]
fn profiling_playback_and_readiness_reject_invalid_arguments_and_require_desktop() {
    let (_, engine) = setup();
    for (command, args) in [
        ("view_profile", json!({"action":"start","max_seconds":121})),
        ("view_playback", json!({"action":"play","time":0})),
        ("view_playback", json!({"action":"configure","speed":100})),
        ("view_playback", json!({"action":"step","steps":101})),
        ("view_wait", json!({"timeout_ms":11000})),
    ] {
        assert!(engine.invoke(command, args).is_err());
    }
    for (command, args) in [
        ("view_profile", json!({"action":"start"})),
        ("view_playback", json!({"action":"status"})),
        ("view_wait", json!({})),
    ] {
        assert!(engine
            .invoke(command, args)
            .unwrap_err()
            .starts_with("UNAVAILABLE:"));
    }
}

#[test]
fn interactive_mcp_results_have_workspace_identity_and_progressive_ui_discovery() {
    let (dir, engine) = setup();
    let request = |method: &str, params: Value| json!({"jsonrpc":"2.0","id":1,"method":method,"params":params});
    let mut ui = chronoscope::mcp::apps::Session::default();
    let list =
        chronoscope::mcp::handle(&engine, dir.path(), request("tools/list", json!({}))).unwrap();
    assert!(ui.decorate("tools/list", list.clone())["result"]["tools"]
        .as_array()
        .unwrap()
        .iter()
        .all(|t| t.get("_meta").is_none()));
    ui.initialize(&request("initialize",json!({"capabilities":{"extensions":{"io.modelcontextprotocol/ui":{"mimeTypes":["text/html;profile=mcp-app"]}}}})));
    let enhanced = ui.decorate("tools/list", list);
    assert_eq!(
        enhanced["result"]["tools"]
            .as_array()
            .unwrap()
            .iter()
            .filter(|t| t["_meta"]["ui"]["resourceUri"] == chronoscope::mcp::apps::URI)
            .count(),
        2
    );
    let resource = chronoscope::mcp::handle(
        &engine,
        dir.path(),
        request("resources/read", json!({"uri":chronoscope::mcp::apps::URI})),
    )
    .unwrap();
    assert_eq!(
        resource["result"]["contents"][0]["mimeType"],
        "text/html;profile=mcp-app"
    );
    assert_eq!(
        resource["result"]["contents"][0]["_meta"]["ui"]["csp"]["connectDomains"],
        json!([])
    );
    let result = chronoscope::mcp::handle(
        &engine,
        dir.path(),
        request(
            "tools/call",
            json!({"name":"chronoscope_query","arguments":{"limit":1,"fields":["id","label"]}}),
        ),
    )
    .unwrap();
    assert_eq!(result["result"]["isError"], false, "{result}");
    assert!(result["result"]["structuredContent"]["workspace_id"]
        .as_str()
        .is_some());
    let chart=chronoscope::mcp::handle(&engine,dir.path(),request("tools/call",json!({"name":"chronoscope_chart_data","arguments":{"config":{"kind":"bar","x":"entity","aggregate":"count","limit":8}}}))).unwrap();
    assert_eq!(chart["result"]["isError"], false, "{chart}");
    assert!(chart["result"]["structuredContent"]["workspace_id"]
        .as_str()
        .is_some());
}

#[test]
fn subscriptions_coalesce_changes_unsubscribe_and_never_replace_the_desktop_observer() {
    let (_, engine) = setup();
    let subscriptions = Arc::new(chronoscope::mcp::subscriptions::Subscriptions::default());
    let request = |method: &str, uri: &str| json!({"jsonrpc":"2.0","id":1,"method":method,"params":{"uri":uri}});
    assert!(subscriptions
        .handle(&request("resources/subscribe", "file:///outside"))
        .unwrap()
        .get("error")
        .is_some());
    let (send, recv) = std::sync::mpsc::channel();
    let polled = engine.clone();
    subscriptions.start(
        move || Ok(polled.resource_version()),
        move |v| send.send(v).map_err(|e| e.to_string()),
    );
    subscriptions.handle(&request("resources/subscribe", "chronoscope://workspace"));
    recv.recv_timeout(std::time::Duration::from_secs(3))
        .unwrap(); // initial invalidation
    engine
        .invoke("filter", json!({"filter":{"search":"test"}}))
        .unwrap();
    assert_eq!(
        recv.recv_timeout(std::time::Duration::from_secs(3))
            .unwrap()["params"]["uri"],
        "chronoscope://workspace"
    );
    subscriptions.handle(&request("resources/unsubscribe", "chronoscope://workspace"));
    engine
        .invoke("filter", json!({"filter":{"search":"other"}}))
        .unwrap();
    assert!(recv
        .recv_timeout(std::time::Duration::from_millis(700))
        .is_err());
    subscriptions.stop();
}
