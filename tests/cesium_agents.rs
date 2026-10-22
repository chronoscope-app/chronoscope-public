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
