use chronoscope::{
    engine::{Engine, HardwareAcceleration, NativeViewBackend, NativeViewHost},
    project::Project,
};
use serde_json::{json, Value};
use std::sync::Arc;

fn status(renderer: &str, backend: &str, acceleration: &str) -> Value {
    json!({"revision":1,"renderer":renderer,"backend":backend,"webgpu_api_available":false,
        "hardware_acceleration":acceleration,"mode":"globe","scene":{"renderer":"cesium","mode":"globe"},
        "viewport":{"width":1280,"height":800},"loading":{"imagery":false,"effects":false,"gis":0},
        "gis_layers":[],"diagnostics":{}})
}
fn native_host() -> NativeViewHost {
    NativeViewHost {
        backend: NativeViewBackend::Metal,
        hardware_acceleration: HardwareAcceleration::Hardware,
        incomplete_features: vec![
            "terrain mesh presentation".into(),
            "streamed basemap presentation".into(),
        ],
    }
}
fn setup() -> (tempfile::TempDir, Arc<Engine>) {
    let dir = tempfile::tempdir().unwrap();
    let engine = Arc::new(Engine::new(Project::empty(), dir.path().join("profile")).unwrap());
    (dir, engine)
}
#[test]
fn correlated_receipts_accept_old_cesium_and_explicit_native_backends() {
    for command in ["view_status", "view_navigate"] {
        chronoscope::schema::validate_output(command, &status("cesium", "WebGL2", "unknown"))
            .unwrap();
        for backend in ["Metal", "Vulkan", "Dx12"] {
            for acceleration in ["unknown", "hardware", "software"] {
                chronoscope::schema::validate_output(
                    command,
                    &status("wgpu-native", backend, acceleration),
                )
                .unwrap();
            }
        }
        for (renderer, backend, acceleration) in [
            ("cesium", "Metal", "unknown"),
            ("cesium", "Vulkan", "unknown"),
            ("cesium", "Dx12", "unknown"),
            ("wgpu-native", "WebGL2", "hardware"),
            ("wgpu-native", "WebGPU", "hardware"),
            ("wgpu-native", "metal", "hardware"),
            ("wgpu-native", "Metal", "accelerated"),
            ("other", "Metal", "hardware"),
        ] {
            assert!(
                chronoscope::schema::validate_output(
                    command,
                    &status(renderer, backend, acceleration)
                )
                .is_err(),
                "{command}: {renderer}/{backend}/{acceleration}"
            );
        }
        let mut missing = status("wgpu-native", "Vulkan", "software");
        missing.as_object_mut().unwrap().remove("viewport");
        assert!(chronoscope::schema::validate_output(command, &missing).is_err());
        let mut malformed = status("wgpu-native", "Metal", "hardware");
        malformed["loading"]["gis"] = json!(-1);
        assert!(chronoscope::schema::validate_output(command, &malformed).is_err());
    }
}
#[test]
fn saved_scene_contract_is_not_relabelled_or_relaxed_by_native_receipts() {
    let (_dir, engine) = setup();
    let before = engine.invoke("snapshot", json!({})).unwrap();
    assert!(engine
        .invoke(
            "scene_sync",
            json!({"scene":{"renderer":"wgpu-native","mode":"globe"}})
        )
        .is_err());
    assert_eq!(before, engine.invoke("snapshot", json!({})).unwrap());
    let mut receipt = status("wgpu-native", "Metal", "hardware");
    receipt["scene"]["renderer"] = json!("wgpu-native");
    assert!(chronoscope::schema::validate_output("view_status", &receipt).is_err());
}
#[test]
fn runtime_descriptor_changes_capabilities_not_document_revision_history_or_dirty_state() {
    let (_dir, engine) = setup();
    let before = engine.invoke("snapshot", json!({})).unwrap();
    let project = serde_json::to_value(engine.project().unwrap()).unwrap();
    let default = engine.invoke("capabilities", json!({})).unwrap();
    assert_eq!(default["renderer"]["engine"], "CesiumJS");
    assert_eq!(default["renderer"]["backend"], "WebGL2");
    assert!(default["renderer"].get("native_wgpu").is_none());
    let resource_before = engine.resource_version();
    let descriptor = native_host();
    engine
        .set_native_view_host(Some(descriptor.clone()))
        .unwrap();
    let changed = engine.invoke("capabilities", json!({})).unwrap();
    assert_eq!(changed["renderer"]["engine"], "wgpu-native");
    assert_eq!(changed["renderer"]["backend"], "Metal");
    assert_eq!(changed["renderer"]["hardware_acceleration"], "hardware");
    assert_eq!(changed["renderer"]["native_wgpu"], true);
    assert_eq!(changed["renderer"]["webgpu_backend"], false);
    assert_eq!(changed["renderer"]["full_desktop_parity"], false);
    assert_eq!(
        changed["renderer"]["capture"]["app_snapshot"],
        "host-provided native scene and UI composition; inspect attached host status"
    );
    assert_eq!(
        changed["renderer"]["incomplete_features"],
        json!(descriptor.incomplete_features)
    );
    assert_eq!(before, engine.invoke("snapshot", json!({})).unwrap());
    assert_eq!(
        project,
        serde_json::to_value(engine.project().unwrap()).unwrap()
    );
    assert!(!engine.workspace_dirty());
    assert_ne!(resource_before, engine.resource_version());
    let resource_after = engine.resource_version();
    engine.set_native_view_host(Some(descriptor)).unwrap();
    assert_eq!(resource_after, engine.resource_version());
    assert!(engine.invoke("undo", json!({})).is_err());
    engine.set_native_view_host(None).unwrap();
    assert_eq!(default, engine.invoke("capabilities", json!({})).unwrap());
}
#[test]
fn invalid_host_metadata_cannot_replace_existing_descriptor() {
    let (_dir, engine) = setup();
    engine.set_native_view_host(Some(native_host())).unwrap();
    let before = engine.invoke("capabilities", json!({})).unwrap();
    let resource = engine.resource_version();
    for features in [
        vec![String::new()],
        vec!["a\nb".into()],
        vec!["x".repeat(257)],
        vec!["x".into(); 129],
    ] {
        let mut host = native_host();
        host.incomplete_features = features;
        assert!(engine.set_native_view_host(Some(host)).is_err());
        assert_eq!(before, engine.invoke("capabilities", json!({})).unwrap());
        assert_eq!(resource, engine.resource_version());
    }
}
#[test]
fn native_desktop_request_response_is_validated_without_holding_workspace_gate() {
    let (_dir, engine) = setup();
    engine.set_native_view_host(Some(native_host())).unwrap();
    let callback = Arc::downgrade(&engine);
    engine
        .set_observer(Arc::new(move |event| {
            if event["kind"] != "view_status" && event["kind"] != "view_navigate" {
                return;
            }
            let engine = callback.upgrade().unwrap();
            let snapshot = engine.invoke("snapshot", json!({"compact":true})).unwrap();
            let mut result = status("wgpu-native", "Metal", "hardware");
            result["revision"] = snapshot["revision"].clone();
            engine
                .invoke(
                    "view_response",
                    json!({"request_id":event["request_id"],"result":result}),
                )
                .unwrap();
        }))
        .unwrap();
    for (command, args) in [
        ("view_status", json!({})),
        ("view_navigate", json!({"action":"zoom","factor":2})),
    ] {
        let result = engine.invoke(command, args).unwrap();
        assert_eq!(result["renderer"], "wgpu-native");
        chronoscope::schema::validate_output(command, &result).unwrap();
    }
    let callback = Arc::downgrade(&engine);
    engine.set_observer(Arc::new(move |event| {
        if event["kind"] != "view_status" { return; }
        assert!(callback.upgrade().unwrap().invoke("view_response",json!({"request_id":event["request_id"],"result":status("cesium","Metal","hardware")})).is_err());
    })).unwrap();
    assert!(engine.invoke("view_status", json!({})).is_err());
}
#[test]
fn mcp_discovery_is_renderer_neutral_and_native_capability_resource_is_truthful() {
    let (dir, engine) = setup();
    engine.set_native_view_host(Some(native_host())).unwrap();
    let invoke = |method: &str, params: Value| {
        chronoscope::mcp::handle(
            &engine,
            dir.path(),
            json!({"jsonrpc":"2.0","id":1,"method":method,"params":params}),
        )
        .unwrap()
    };
    let initialized = invoke("initialize", json!({"protocolVersion":"2025-06-18"}));
    let instructions = initialized["result"]["instructions"].as_str().unwrap();
    assert!(instructions.contains("incomplete features"));
    assert!(!instructions.contains("WebGL2 is the Cesium backend"));
    assert!(!instructions.contains("live Cesium view"));
    let resources = invoke("resources/list", json!({}));
    let view = resources["result"]["resources"]
        .as_array()
        .unwrap()
        .iter()
        .find(|v| v["uri"] == "chronoscope://view")
        .unwrap();
    assert_eq!(
        view["name"],
        "Live desktop view (attached desktop required)"
    );
    let resource = invoke(
        "resources/read",
        json!({"uri":"chronoscope://capabilities"}),
    );
    let capabilities: Value =
        serde_json::from_str(resource["result"]["contents"][0]["text"].as_str().unwrap()).unwrap();
    assert_eq!(capabilities["renderer"]["backend"], "Metal");
    assert_eq!(capabilities["renderer"]["full_desktop_parity"], false);
    assert_eq!(
        capabilities["renderer"]["incomplete_features"]
            .as_array()
            .unwrap()
            .len(),
        2
    );
}

#[test]
fn legacy_cesium_acceleration_stays_unknown_while_native_can_report_actual_device_type() {
    for command in ["view_status", "view_navigate"] {
        chronoscope::schema::validate_output(command, &status("cesium", "WebGL2", "unknown"))
            .unwrap();
        for acceleration in ["hardware", "software"] {
            assert!(chronoscope::schema::validate_output(
                command,
                &status("cesium", "WebGL2", acceleration)
            )
            .is_err());
            for backend in ["Metal", "Vulkan", "Dx12"] {
                chronoscope::schema::validate_output(
                    command,
                    &status("wgpu-native", backend, acceleration),
                )
                .unwrap();
            }
        }
    }
}
