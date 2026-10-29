//! Host discovery only: no encoder, desktop snapshot or OS capture is invoked.
use chronoscope::{
    engine::{Engine, NativeRecordingBackend, NativeRecordingHost, NativeRecordingHostProvider},
    project::Project,
};
use serde_json::{json, Value};
use std::sync::{
    atomic::{AtomicBool, AtomicUsize, Ordering},
    Arc,
};

fn setup() -> (tempfile::TempDir, Engine) {
    let dir = tempfile::tempdir().unwrap();
    let engine = Engine::new(Project::empty(), dir.path().join("profile")).unwrap();
    (dir, engine)
}
fn capabilities(engine: &Engine) -> Value {
    engine.invoke("capabilities", json!({})).unwrap()
}
fn provider(available: Arc<AtomicBool>) -> NativeRecordingHostProvider {
    Arc::new(move || NativeRecordingHost {
        backend: NativeRecordingBackend::FfmpegNativeComposite,
        encoder_available: available.load(Ordering::Acquire),
    })
}
#[test]
fn default_next_keeps_the_complete_legacy_screencapturekit_document() {
    let (_dir, engine) = setup();
    let before = capabilities(&engine);
    assert_eq!(
        before["renderer"]["capture"]["video"],
        json!({
            "command":"view_recording","platform":"macOS 15+","backend":"ScreenCaptureKit app window",
            "format":"H.264 MP4","audio":false,"maximum_seconds":120,
            "maximum_bytes":268435456,"maximum_dimensions":[1920,1080]
        })
    );
    engine.set_native_recording_host_provider(None).unwrap();
    assert_eq!(capabilities(&engine), before);
}
#[test]
fn provider_refreshes_encoder_availability_without_document_or_history_changes() {
    let (_dir, engine) = setup();
    let before = engine.invoke("snapshot", json!({})).unwrap();
    let project = serde_json::to_value(engine.project().unwrap()).unwrap();
    let available = Arc::new(AtomicBool::new(false));
    let calls = Arc::new(AtomicUsize::new(0));
    let probe_available = available.clone();
    let probe_calls = calls.clone();
    engine
        .set_native_recording_host_provider(Some(Arc::new(move || {
            probe_calls.fetch_add(1, Ordering::AcqRel);
            NativeRecordingHost {
                backend: NativeRecordingBackend::FfmpegNativeComposite,
                encoder_available: probe_available.load(Ordering::Acquire),
            }
        })))
        .unwrap();
    assert_eq!(
        calls.load(Ordering::Acquire),
        0,
        "registration must not invoke the provider"
    );
    let first = capabilities(&engine);
    let video = &first["renderer"]["capture"]["video"];
    assert_eq!(video["backend"], "ffmpeg-native-composite");
    assert_eq!(video["encoder_available"], false);
    assert_eq!(video["requires_installed_ffmpeg"], true);
    assert_eq!(video["os_screen_capture"], false);
    assert_eq!(video["platforms"], json!(["macOS", "Windows", "Linux"]));
    assert!(video["source_scope"]
        .as_str()
        .unwrap()
        .contains("app-owned WebView"));
    assert!(video["platform_runtime_acceptance"]
        .as_str()
        .unwrap()
        .contains("does not prove"));
    assert_eq!(video["maximum_dimensions"], json!([1920, 1080]));
    assert_eq!(video["maximum_bytes"], 268435456);
    assert_eq!(video["maximum_seconds"], 120);
    available.store(true, Ordering::Release);
    let second = capabilities(&engine.clone());
    assert_eq!(
        second["renderer"]["capture"]["video"]["encoder_available"],
        true
    );
    assert_eq!(calls.load(Ordering::Acquire), 2);
    assert_eq!(before, engine.invoke("snapshot", json!({})).unwrap());
    assert_eq!(
        project,
        serde_json::to_value(engine.project().unwrap()).unwrap()
    );
    assert!(!engine.workspace_dirty());
    assert!(engine.invoke("undo", json!({})).is_err());
}
#[test]
fn clearing_provider_restores_legacy_and_registration_is_identity_idempotent() {
    let (_dir, engine) = setup();
    let original = capabilities(&engine);
    let resource = engine.resource_version();
    let probe = provider(Arc::new(AtomicBool::new(true)));
    engine
        .set_native_recording_host_provider(Some(probe.clone()))
        .unwrap();
    assert_ne!(engine.resource_version(), resource);
    let registered = engine.resource_version();
    engine
        .set_native_recording_host_provider(Some(probe))
        .unwrap();
    assert_eq!(engine.resource_version(), registered);
    engine.set_native_recording_host_provider(None).unwrap();
    assert_ne!(engine.resource_version(), registered);
    assert_eq!(capabilities(&engine), original);
    let cleared = engine.resource_version();
    engine.set_native_recording_host_provider(None).unwrap();
    assert_eq!(engine.resource_version(), cleared);
}
#[test]
fn typed_provider_descriptor_and_its_schema_reject_unknown_backends() {
    let schema = serde_json::to_value(schemars::schema_for!(NativeRecordingHost)).unwrap();
    let validator = jsonschema::validator_for(&schema).unwrap();
    let valid = json!({"backend":"ffmpeg-native-composite","encoder_available":false});
    assert!(validator.is_valid(&valid));
    let typed: NativeRecordingHost = serde_json::from_value(valid).unwrap();
    assert_eq!(typed.backend, NativeRecordingBackend::FfmpegNativeComposite);
    for invalid in [
        json!({"backend":"screencapturekit","encoder_available":true}),
        json!({"backend":"ffmpeg","encoder_available":true}),
        json!({"backend":"FfmpegNativeComposite","encoder_available":true}),
        json!({"backend":"unknown","encoder_available":false}),
        json!({"backend":"ffmpeg-native-composite","encoder_available":"yes"}),
        json!({"backend":"ffmpeg-native-composite"}),
        json!({"backend":"ffmpeg-native-composite","encoder_available":false,"ready":true}),
    ] {
        assert!(!validator.is_valid(&invalid), "{invalid}");
        assert!(serde_json::from_value::<NativeRecordingHost>(invalid).is_err());
    }
}
#[test]
fn complete_mcp_discovery_and_capability_resource_use_the_live_provider() {
    let (dir, engine) = setup();
    let available = Arc::new(AtomicBool::new(false));
    engine
        .set_native_recording_host_provider(Some(provider(available.clone())))
        .unwrap();
    let rpc = |method: &str, params: Value| {
        chronoscope::mcp::handle(
            &engine,
            dir.path(),
            json!({"jsonrpc":"2.0","id":1,"method":method,"params":params}),
        )
        .unwrap()
    };
    let initialize = rpc("initialize", json!({"protocolVersion":"2025-06-18"}));
    let instructions = initialize["result"]["instructions"].as_str().unwrap();
    assert!(instructions.contains("renderer.capture.video"));
    assert!(!instructions.contains("MP4 on macOS"));
    let listed = rpc("tools/list", json!({}));
    let tools = listed["result"]["tools"].as_array().unwrap();
    assert_eq!(tools.len(), 118);
    let recording = tools
        .iter()
        .find(|tool| tool["name"] == "chronoscope_view_recording")
        .unwrap();
    let description = recording["description"].as_str().unwrap();
    assert!(description.contains("renderer.capture.video"));
    assert!(description.contains("encoder prerequisites"));
    assert!(!description.contains("macOS 15+"));
    assert!(!description.contains("other platforms return UNAVAILABLE"));
    assert_eq!(
        recording["outputSchema"]["anyOf"][0]["properties"]["backend"]["enum"],
        json!(["screencapturekit", "ffmpeg-native-composite"])
    );
    let read_video = || {
        let response = rpc(
            "resources/read",
            json!({"uri":"chronoscope://capabilities"}),
        );
        let document: Value =
            serde_json::from_str(response["result"]["contents"][0]["text"].as_str().unwrap())
                .unwrap();
        document["renderer"]["capture"]["video"].clone()
    };
    assert_eq!(read_video()["encoder_available"], false);
    available.store(true, Ordering::Release);
    assert_eq!(read_video()["encoder_available"], true);
    let tool_result = rpc(
        "tools/call",
        json!({"name":"chronoscope_capabilities","arguments":{}}),
    );
    assert_eq!(tool_result["result"]["isError"], false);
    assert_eq!(
        tool_result["result"]["structuredContent"]["renderer"]["capture"]["video"]
            ["encoder_available"],
        true
    );
}
