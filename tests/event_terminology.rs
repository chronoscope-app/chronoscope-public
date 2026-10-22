use chronoscope::{engine::Engine, model::Dataset, project::Project};
use serde_json::{json, Value};
use std::io::{BufRead, Write};

#[test]
fn default_entity_is_events_but_legacy_source_headers_and_values_are_preserved() {
    let dir = tempfile::tempdir().unwrap();
    let csv = dir.path().join("legacy.csv");
    std::fs::write(&csv,"observationDate,observationTime,latitude,longitude,label\n2026-10-15,10:20:59.999,33.749,-84.388,Original observation wording\n").unwrap();
    let engine = Engine::new(Project::new(Dataset::default()), dir.path().join("profile")).unwrap();
    let preview = engine
        .invoke("import_preview", json!({"path":csv}))
        .unwrap();
    assert_eq!(preview["sheets"][0]["mapping"]["default_entity"], "Events");
    engine
        .invoke("import_commit", json!({"import_id":preview["import_id"]}))
        .unwrap();
    let result = engine.invoke("events", json!({})).unwrap();
    let event = &result["events"][0];
    assert_eq!(event["entity"], "Events");
    assert_eq!(event["label"], "Original observation wording");
    assert_eq!(event["attrs"]["observationDate"], "2026-10-15");
    assert_eq!(event["attrs"]["observationTime"], "10:20:59.999");
    assert_eq!(
        event["time"].as_f64().unwrap(),
        chronoscope::model::parse_time("2026-10-15T10:20:59.999Z", "", 0).unwrap()
    );
    let path = dir.path().join("preserved.chronoscope");
    engine.invoke("save", json!({"path":path})).unwrap();
    let reopened = Engine::from_path(&path, dir.path().join("recipient"), None).unwrap();
    assert_eq!(
        reopened.invoke("events", json!({})).unwrap()["events"][0]["label"],
        "Original observation wording"
    );
}

#[test]
fn display_uses_event_bounds_and_reads_legacy_bounds_without_changing_coordinates() {
    let dir = tempfile::tempdir().unwrap();
    let engine = Engine::new(
        Project::new(chronoscope::demo::dataset()),
        dir.path().into(),
    )
    .unwrap();
    let packet = engine.invoke("display_data", json!({"level":8})).unwrap();
    chronoscope::schema::validate_output("display_data", &packet).unwrap();
    let bin = &packet["bins"][0];
    assert!(bin["event_bounds"].is_array());
    assert!(bin.get("observation_bounds").is_none());
    let current: chronoscope::display::Bin = serde_json::from_value(bin.clone()).unwrap();
    let mut legacy = bin.clone();
    let bounds = legacy
        .as_object_mut()
        .unwrap()
        .remove("event_bounds")
        .unwrap();
    legacy["observation_bounds"] = bounds;
    let decoded: chronoscope::display::Bin = serde_json::from_value(legacy.clone()).unwrap();
    assert_eq!(decoded.event_bounds, current.event_bounds);
    assert_eq!(decoded.latitude, current.latitude);
    assert_eq!(decoded.longitude, current.longitude);
    legacy.as_object_mut().unwrap().remove("observation_bounds");
    assert!(serde_json::from_value::<chronoscope::display::Bin>(legacy).is_err());
    assert_eq!(
        engine.invoke("capabilities", json!({})).unwrap()["max_events"],
        50_000_000
    );
}

#[test]
fn pre_rename_recovery_database_keeps_its_events_and_context() {
    let dir = tempfile::tempdir().unwrap();
    let mut child = std::process::Command::new(env!("CARGO_BIN_EXE_chronoscope"))
        .args([
            "--demo-data",
            "--data-dir",
            dir.path().to_str().unwrap(),
            "session",
        ])
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::null())
        .spawn()
        .unwrap();
    let mut input = child.stdin.take().unwrap();
    let mut output = std::io::BufReader::new(child.stdout.take().unwrap());
    for (command, args) in [
        (
            "edit",
            json!({"id":"1","changes":{"note":"Legacy events remain intact"}}),
        ),
        ("select", json!({"ids":["1"]})),
        ("save_group", json!({"name":"Original group"})),
        ("recovery_checkpoint", json!({})),
    ] {
        writeln!(input, "{}", json!({"command":command,"args":args})).unwrap();
        input.flush().unwrap();
        let mut line = String::new();
        output.read_line(&mut line).unwrap();
        let response: Value = serde_json::from_str(&line).unwrap();
        assert_eq!(response["ok"], true, "{response}");
    }
    child.kill().unwrap();
    child.wait().unwrap();
    let descriptor = std::fs::read_dir(dir.path())
        .unwrap()
        .map(|e| e.unwrap().path())
        .find(|p| {
            p.file_name()
                .unwrap()
                .to_string_lossy()
                .starts_with("recovery-")
        })
        .unwrap();
    let mut record: Value = serde_json::from_slice(&std::fs::read(&descriptor).unwrap()).unwrap();
    let current = dir.path().join(record["database"].as_str().unwrap());
    assert_eq!(current.file_name().unwrap(), "events.sqlite");
    let old = current.with_file_name("observations.sqlite");
    for suffix in ["", "-wal", "-shm"] {
        let from = std::path::PathBuf::from(format!("{}{suffix}", current.display()));
        if from.exists() {
            std::fs::rename(from, format!("{}{suffix}", old.display())).unwrap();
        }
    }
    record["database"] = json!(old.strip_prefix(dir.path()).unwrap());
    std::fs::write(&descriptor, serde_json::to_vec(&record).unwrap()).unwrap();
    let engine = Engine::new(Project::new(Dataset::default()), dir.path().into()).unwrap();
    let list = engine.invoke("recovery_list", json!({})).unwrap();
    assert_eq!(list["checkpoints"].as_array().unwrap().len(), 1);
    engine
        .invoke(
            "recovery_restore",
            json!({"id":list["checkpoints"][0]["id"]}),
        )
        .unwrap();
    assert_eq!(
        engine.invoke("events", json!({"id":"1"})).unwrap()["events"][0]["note"],
        "Legacy events remain intact"
    );
    assert_eq!(
        engine.invoke("snapshot", json!({})).unwrap()["groups"][0]["name"],
        "Original group"
    );
    engine.invoke("recovery_clear", json!({})).unwrap();
}
