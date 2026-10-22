use serde_json::{json, Value};
use std::process::Command;

fn snapshot(args: &[&str]) -> Value {
    let data = tempfile::tempdir().unwrap();
    let output = Command::new(env!("CARGO_BIN_EXE_chronoscope"))
        .arg("--data-dir")
        .arg(data.path())
        .arg("--json")
        .args(args)
        .args([
            "call",
            "snapshot",
            "--args",
            r#"{"compact":false,"selection_limit":0}"#,
        ])
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stdout)
    );
    serde_json::from_slice::<Value>(&output.stdout).unwrap()["result"].clone()
}
#[test]
fn fresh_cli_starts_empty_and_synthetic_data_requires_explicit_opt_in() {
    let empty = snapshot(&[]);
    assert_eq!(empty["name"], "Untitled workspace");
    assert_eq!(empty["count"], 0);
    assert_eq!(empty["visible"], 0);
    assert_eq!(empty["selected_count"], 0);
    assert!(empty["layers"].as_array().unwrap().is_empty());
    let fixture = snapshot(&["--demo-data"]);
    assert_eq!(fixture["count"], 192);
}
#[test]
fn an_explicit_hurricane_project_opens_without_generated_records() {
    let source = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("samples/atlantic-hurricanes-2016-2025.chronoscope");
    let result = snapshot(&["--project", source.to_str().unwrap()]);
    assert_eq!(result["count"], 3568);
    assert_eq!(result["visible"], 3568);
    assert_eq!(result["entities"].as_object().unwrap().len(), 83);
}
#[test]
fn demo_seed_cannot_be_mixed_with_an_attached_workspace() {
    let output = Command::new(env!("CARGO_BIN_EXE_chronoscope"))
        .args(["--demo-data", "--attach", "call", "snapshot"])
        .output()
        .unwrap();
    assert!(!output.status.success());
    assert!(String::from_utf8_lossy(&output.stderr).contains("cannot be used with"));
    assert_eq!(
        chronoscope::project::Project::empty().dataset.events.len(),
        0
    );
    assert_eq!(
        json!(chronoscope::project::Project::empty().selected.len()),
        0
    );
}
