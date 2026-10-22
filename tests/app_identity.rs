use chronoscope::{agent, engine::Engine, project::Project};
use serde_json::{json, Value};
use std::{path::PathBuf, process::Command, sync::Arc};

#[test]
fn canonical_identity_uses_chronoscope_profile_documents_and_client_registration() {
    let expected = directories::ProjectDirs::from("org", "Chronoscope", "Chronoscope")
        .map(|d| PathBuf::from(d.data_local_dir()))
        .unwrap_or_else(|| PathBuf::from(".chronoscope"));
    let profile = chronoscope::engine::default_data_dir();
    assert_eq!(profile, expected);
    if let Some(documents) =
        directories::UserDirs::new().and_then(|d| d.document_dir().map(PathBuf::from))
    {
        assert_eq!(
            chronoscope::platform::autosave_directory(&profile),
            documents.join("Chronoscope/Autosaved")
        );
    }
    let custom = tempfile::tempdir().unwrap();
    assert_eq!(
        chronoscope::platform::autosave_directory(custom.path()),
        custom.path().join("Documents/Autosaved")
    );
    let config = agent::access::config_for_data(
        std::path::Path::new("/Applications/Chronoscope.app/Contents/MacOS/chronoscope-desktop"),
        Some(&profile),
    );
    assert_eq!(
        config["mcpServers"]["chronoscope"]["args"],
        json!(["--data-dir", profile, "mcp", "--attach"])
    );
    assert!(config["mcpServers"].get("chronoscope-cesium").is_none());
}

#[test]
fn explicit_profiles_attach_to_their_own_live_engine() {
    let root = tempfile::tempdir().unwrap();
    let original_data = root.path().join("original app");
    let second_data = root.path().join("second profile");
    let original = Arc::new(
        Engine::new(
            Project::new(chronoscope::demo::dataset()),
            original_data.clone(),
        )
        .unwrap(),
    );
    let second = Arc::new(
        Engine::new(
            Project::new(chronoscope::demo::dataset()),
            second_data.clone(),
        )
        .unwrap(),
    );
    let original_root = root.path().join("original exchange");
    let second_root = root.path().join("second exchange");
    std::fs::create_dir_all(&original_root).unwrap();
    std::fs::create_dir_all(&second_root).unwrap();
    let _original_agent = agent::start(original.clone(), &original_root).unwrap();
    let _second_agent = agent::start(second.clone(), &second_root).unwrap();
    let original_descriptor = std::fs::read(original_data.join("agent-connection.json")).unwrap();
    let output = Command::new(env!("CARGO_BIN_EXE_chronoscope"))
        .arg("--data-dir")
        .arg(&second_data)
        .args([
            "--attach",
            "call",
            "select",
            "--args",
            "{\"ids\":[\"1\",\"2\"]}",
        ])
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    let result: Value = serde_json::from_slice(&output.stdout).unwrap();
    assert_eq!(result["selected"], 2);
    assert_eq!(
        second.invoke("snapshot", json!({"compact":true})).unwrap()["selected_count"],
        2
    );
    assert_eq!(
        original
            .invoke("snapshot", json!({"compact":true}))
            .unwrap()["selected_count"],
        0
    );
    assert_eq!(
        std::fs::read(original_data.join("agent-connection.json")).unwrap(),
        original_descriptor
    );
}
