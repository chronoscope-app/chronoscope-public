//! Attached-host output compatibility; these tests do not encode or capture video.
use chronoscope::schema::{validate, validate_output};
use serde_json::{json, Value};

fn receipt(backend: &str) -> Value {
    json!({"path":"recording.mp4","uri":"file:///recording.mp4","state":"recording",
        "backend":backend,"mime_type":"video/mp4","window":"main","fps":60,
        "max_seconds":120,"width":1920,"height":1080,"duration_seconds":0,
        "bytes":0,"started_unix_ms":1,"error":null})
}
fn composite() -> Value {
    let mut value = receipt("ffmpeg-native-composite");
    value.as_object_mut().unwrap().extend(
        json!({
            "source_width":3200,"source_height":2000,"wall_duration_seconds":123.5,
            "timeline_started_unix_ms":null,"captured_frames":7200,"encoded_frames":7200,
            "held_frames":7200,"missed_capture_slots":7200,"capture_failures":21600,
            "last_capture_error":null,"capture_timestamps_us":[],
            "timestamp_basis":"constant frame rate, measured capture request/completion times",
            "source_scope":"internal WebView snapshot with pinned native scene composition",
            "scaling":"fit without cropping","capture_transport":"internal WebView snapshot",
            "audio":false
        })
        .as_object()
        .unwrap()
        .clone(),
    );
    value
}
#[test]
fn both_backends_preserve_all_legacy_fields_states_and_starting_dimensions() {
    for backend in ["screencapturekit", "ffmpeg-native-composite"] {
        for state in ["starting", "recording", "stopping", "complete", "failed"] {
            let mut value = receipt(backend);
            value["state"] = json!(state);
            if state == "starting" {
                value["width"] = json!(0);
                value["height"] = json!(0);
            }
            validate_output("view_recording", &value).unwrap();
        }
    }
    // Existing ScreenCaptureKit optional diagnostics remain compatible.
    let mut old = receipt("screencapturekit");
    old["timestamp_basis"] =
        json!("ScreenCaptureKit start delegate; approximate presentation alignment");
    old["error_details"] =
        json!({"domain":"com.apple.ReplayKit.RPRecordingErrorDomain","code":-5822});
    validate_output("view_recording", &old).unwrap();
    for field in receipt("screencapturekit").as_object().unwrap().keys() {
        let mut missing = receipt("ffmpeg-native-composite");
        missing.as_object_mut().unwrap().remove(field);
        assert!(
            validate_output("view_recording", &missing).is_err(),
            "{field}"
        );
    }
}
#[test]
fn invalid_backends_and_existing_output_limits_are_rejected() {
    for backend in [
        "ffmpeg",
        "webm",
        "ScreenCaptureKit",
        "",
        "ffmpeg-native-composite-v2",
    ] {
        assert!(validate_output("view_recording", &receipt(backend)).is_err());
    }
    for (field, value) in [
        ("fps", json!(14)),
        ("fps", json!(61)),
        ("max_seconds", json!(0)),
        ("max_seconds", json!(121)),
        ("width", json!(1921)),
        ("height", json!(1081)),
        ("bytes", json!(-1)),
        ("duration_seconds", json!(-1)),
        ("window", json!("screen")),
        ("state", json!("cancelled")),
        ("mime_type", json!("video/webm")),
    ] {
        for backend in ["screencapturekit", "ffmpeg-native-composite"] {
            let mut out = receipt(backend);
            out[field] = value.clone();
            assert!(
                validate_output("view_recording", &out).is_err(),
                "{backend} {field} {value}"
            );
        }
    }
}
#[test]
fn full_120_second_trace_is_valid_bounded_and_optional() {
    let mut value = composite();
    value["capture_timestamps_us"] = json!((0u64..7200)
        .map(|slot| [slot * 16666, slot * 16666 + 2000, slot])
        .collect::<Vec<_>>());
    value["last_capture_error"] = json!("界".repeat(2048));
    value["source_scope"] = json!("x".repeat(2048));
    validate_output("view_recording", &value).unwrap();
    assert!(serde_json::to_vec(&value).unwrap().len() < 512 * 1024);
    value["source_width"] = json!(0);
    value["source_height"] = json!(0);
    value["capture_timestamps_us"] = json!([]);
    validate_output("view_recording", &value).unwrap();
}
#[test]
fn trace_shapes_counter_types_and_text_bounds_are_validated() {
    for (field, invalid) in [
        ("capture_timestamps_us", json!(vec![[0u64, 1, 0]; 7201])),
        ("capture_timestamps_us", json!([[0, 1]])),
        ("capture_timestamps_us", json!([[0, 1, 0, 0]])),
        ("capture_timestamps_us", json!([[0, 1, 7200]])),
        ("capture_timestamps_us", json!([[-1, 1, 0]])),
        ("capture_timestamps_us", json!([[0, 1.5, 0]])),
        ("encoded_frames", json!(7201)),
        ("held_frames", json!(7201)),
        ("captured_frames", json!(-1)),
        ("missed_capture_slots", json!(4294967296u64)),
        ("capture_failures", json!(-1)),
        ("source_width", json!(16385)),
        ("source_height", json!(-1)),
        ("wall_duration_seconds", json!(-1)),
        ("timeline_started_unix_ms", json!(-1)),
        ("last_capture_error", json!("界".repeat(2049))),
        ("source_scope", json!("x".repeat(2049))),
        ("timestamp_basis", json!("x".repeat(2049))),
        ("scaling", json!("x".repeat(2049))),
        ("capture_transport", json!("x".repeat(2049))),
        ("audio", json!(true)),
    ] {
        let mut value = composite();
        value[field] = invalid;
        assert!(
            validate_output("view_recording", &value).is_err(),
            "{field}"
        );
    }
}
#[test]
fn recording_inputs_keep_legacy_ranges_and_action_shapes() {
    for fps in [15, 60] {
        for seconds in [1, 120] {
            validate(
                "view_recording",
                &json!({"action":"start","path":"recording.mp4","fps":fps,"max_seconds":seconds}),
            )
            .unwrap();
        }
    }
    validate(
        "view_recording",
        &json!({"action":"start","path":"recording.mp4"}),
    )
    .unwrap();
    for action in ["status", "stop"] {
        validate(
            "view_recording",
            &json!({"action":action,"path":"recording.mp4"}),
        )
        .unwrap();
        assert!(validate(
            "view_recording",
            &json!({"action":action,"path":"recording.mp4","fps":60})
        )
        .is_err());
    }
    for invalid in [
        json!({"action":"start","path":"recording.mp4","fps":14}),
        json!({"action":"start","path":"recording.mp4","fps":61}),
        json!({"action":"start","path":"recording.mp4","max_seconds":0}),
        json!({"action":"start","path":"recording.mp4","max_seconds":121}),
    ] {
        assert!(validate("view_recording", &invalid).is_err());
    }
}

#[test]
fn attached_native_response_accepts_full_trace_without_changing_workspace() {
    use chronoscope::{engine::Engine, project::Project};
    use std::sync::Arc;
    let dir = tempfile::tempdir().unwrap();
    let engine = Arc::new(Engine::new(Project::empty(), dir.path().join("profile")).unwrap());
    let before = engine.invoke("snapshot", json!({"compact":true})).unwrap();
    let weak = Arc::downgrade(&engine);
    engine
        .set_observer(Arc::new(move |event| {
            if event["kind"] != "view_recording" {
                return;
            }
            let engine = weak.upgrade().unwrap();
            // Attached host work runs outside the workspace gate.
            engine.invoke("snapshot", json!({"compact":true})).unwrap();
            assert_eq!(event["arguments"]["fps"], 60);
            assert_eq!(event["arguments"]["max_seconds"], 120);
            assert_eq!(event["arguments"]["window"], "main");
            let mut result = composite();
            result["path"] = event["arguments"]["path"].clone();
            result["max_seconds"] = json!(120);
            result["capture_timestamps_us"] = json!((0u64..7200)
                .map(|slot| [slot * 16666, slot * 16666 + 2000, slot])
                .collect::<Vec<_>>());
            engine
                .invoke(
                    "view_response",
                    json!({"request_id":event["request_id"],"result":result}),
                )
                .unwrap();
        }))
        .unwrap();
    let result = engine
        .invoke(
            "view_recording",
            json!({"action":"start","path":dir.path().join("recording.mp4"),"max_seconds":120}),
        )
        .unwrap();
    assert_eq!(result["backend"], "ffmpeg-native-composite");
    assert_eq!(
        result["capture_timestamps_us"].as_array().unwrap().len(),
        7200
    );
    assert_eq!(
        engine.invoke("snapshot", json!({"compact":true})).unwrap(),
        before
    );
}
