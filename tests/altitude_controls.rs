use chronoscope::{engine::Engine, project::Project};
use serde_json::{json, Value};
use std::{
    process::Command,
    sync::{
        atomic::{AtomicUsize, Ordering},
        Arc,
    },
};
fn setup() -> (tempfile::TempDir, Arc<Engine>) {
    let d = tempfile::tempdir().unwrap();
    let e = Arc::new(Engine::new(Project::empty(), d.path().join("profile")).unwrap());
    (d, e)
}
fn status() -> Value {
    json!({"reset":true,"revision":1,"renderer":"cesium","backend":"WebGL2","webgpu_api_available":false,"hardware_acceleration":"unknown","mode":"globe","scene":{"mode":"globe","globe_altitude":true,"globe_time":false},"viewport":{"width":800,"height":600},"loading":{"imagery":false,"effects":false,"gis":0},"gis_layers":[],"diagnostics":{"globeAltitude":true}})
}
#[test]
fn mcp_discovers_altitude_mapping_height_flags_demos_and_confirmed_reset() {
    let (_d, e) = setup();
    let tools = chronoscope::mcp::tools();
    let find = |name: &str| {
        tools
            .iter()
            .find(|t| t["name"] == format!("chronoscope_{name}"))
            .unwrap()
    };
    let reset = find("view_reset");
    assert_eq!(reset["inputSchema"]["properties"]["confirm"]["const"], true);
    assert_eq!(reset["annotations"]["readOnlyHint"], false);
    assert_eq!(reset["annotations"]["idempotentHint"], false);
    assert!(find("view_set")["description"]
        .as_str()
        .unwrap()
        .contains("globe_altitude"));
    assert!(find("view_set")["inputSchema"]["properties"]
        .get("globe_altitude")
        .is_some());
    let mapping = &find("import_commit")["inputSchema"]["properties"]["mapping"];
    assert!(mapping.to_string().contains("altitude_reference_column"));
    assert!(mapping.to_string().contains("kilometers"));
    let catalog = e.invoke("demo_catalog", json!({})).unwrap();
    for (name, previews) in [
        ("flight-altitude", 2),
        ("starlink-orbits", 2),
        ("idf-uav", 3),
    ] {
        let demo = catalog["demos"]
            .as_array()
            .unwrap()
            .iter()
            .find(|d| d["id"] == name)
            .unwrap();
        assert_eq!(demo["previews"].as_array().unwrap().len(), previews);
    }
    assert!(
        e.invoke("capabilities", json!({})).unwrap()["renderer"]["attached_tools"]
            .as_array()
            .unwrap()
            .contains(&json!("view_reset"))
    );
}
#[test]
fn reset_requires_confirmation_and_typed_live_success_without_workspace_mutation() {
    let (d, e) = setup();
    let before = e.invoke("snapshot", json!({})).unwrap();
    let requests = Arc::new(AtomicUsize::new(0));
    let count = requests.clone();
    let callback = Arc::downgrade(&e);
    e.set_observer(Arc::new(move |event| {
        if event["kind"] != "view_reset" {
            return;
        }
        count.fetch_add(1, Ordering::SeqCst);
        let e = callback.upgrade().unwrap();
        e.invoke("snapshot", json!({})).unwrap();
        e.invoke(
            "view_response",
            json!({"request_id":event["request_id"],"result":status()}),
        )
        .unwrap();
    }))
    .unwrap();
    for args in [
        json!({}),
        json!({"confirm":false}),
        json!({"confirm":true,"dry_run":true}),
    ] {
        assert!(e.invoke("view_reset", args).is_err());
    }
    assert_eq!(requests.load(Ordering::SeqCst), 0);
    let response=chronoscope::mcp::handle(&e,d.path(),json!({"jsonrpc":"2.0","id":9,"method":"tools/call","params":{"name":"chronoscope_view_reset","arguments":{"confirm":true}}})).unwrap();
    assert_eq!(response["result"]["isError"], false, "{response}");
    assert_eq!(response["result"]["structuredContent"]["reset"], true);
    assert_eq!(requests.load(Ordering::SeqCst), 1);
    assert_eq!(before, e.invoke("snapshot", json!({})).unwrap());
    let mut bad = status();
    bad.as_object_mut().unwrap().remove("reset");
    assert!(chronoscope::schema::validate_output("view_reset", &bad).is_err());
    e.clear_observer();
    assert!(e
        .invoke("view_reset", json!({"confirm":true}))
        .unwrap_err()
        .starts_with("UNAVAILABLE:"));
}
#[test]
fn cli_import_keeps_altitude_units_zero_and_reference() {
    let dir = tempfile::tempdir().unwrap();
    let csv = dir.path().join("flight.csv");
    let output = dir.path().join("flight.chronoscope");
    std::fs::write(&csv,"entity,timestamp,latitude,longitude,altitude_ft,altitude_reference\na,2026-01-01,1,2,10000,reported\na,2026-01-02,1,2,0,ellipsoid\n").unwrap();
    let result = Command::new(env!("CARGO_BIN_EXE_chronoscope"))
        .args(["--data-dir"])
        .arg(dir.path().join("profile"))
        .arg("import")
        .arg(csv)
        .arg("--output")
        .arg(&output)
        .output()
        .unwrap();
    assert!(
        result.status.success(),
        "{}",
        String::from_utf8_lossy(&result.stderr)
    );
    let p = chronoscope::project::load_with_resources(&output, dir.path()).unwrap();
    assert!((p.dataset.events[0].altitude.unwrap().meters - 3048.).abs() < 1e-9);
    assert_eq!(p.dataset.events[1].altitude.unwrap().meters, 0.);
    assert_eq!(
        p.dataset.events[1].altitude.unwrap().reference,
        chronoscope::altitude::AltitudeReference::Ellipsoid
    );
    let engine = Engine::new(p, dir.path().join("inspection")).unwrap();
    let profile = engine
        .invoke(
            "field_profile",
            json!({"fields":["altitude_m","altitude_reference"],"scope":"all"}),
        )
        .unwrap();
    assert_eq!(profile["resolved_fields"]["altitude_m"], "altitude_m");
    assert_eq!(profile["profiles"][0]["finite_numeric_count"], 2);
    engine
        .invoke(
            "field_roles_set",
            json!({"assignments":{"altitude_m":"measurement","altitude_reference":"category"}}),
        )
        .unwrap();
}
#[test]
fn cli_reset_cannot_be_accidental_and_height_controls_are_discoverable() {
    let dir = tempfile::tempdir().unwrap();
    let cli = |args: &[&str]| {
        Command::new(env!("CARGO_BIN_EXE_chronoscope"))
            .arg("--data-dir")
            .arg(dir.path())
            .args(args)
            .output()
            .unwrap()
    };
    let missing = cli(&["view", "reset"]);
    assert!(!missing.status.success());
    assert!(String::from_utf8_lossy(&missing.stderr).contains("--confirm"));
    let headless = cli(&["view", "reset", "--confirm"]);
    assert!(!headless.status.success());
    assert!(String::from_utf8_lossy(&headless.stderr).contains("UNAVAILABLE"));
    let height = cli(&["view", "height", "--help"]);
    assert!(height.status.success());
    assert!(String::from_utf8_lossy(&height.stdout).contains("altitude"));
    let invalid = cli(&["view", "height", "altitude", "--scale", "2"]);
    assert!(!invalid.status.success());
    assert!(String::from_utf8_lossy(&invalid.stderr).contains("only to Time Height"));
}
