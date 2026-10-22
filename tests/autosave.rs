use chronoscope::{engine::Engine, model::Dataset, project::Project};
use serde_json::json;
use std::path::PathBuf;
fn engine(dir: &std::path::Path) -> Engine {
    Engine::new(Project::new(chronoscope::demo::dataset()), dir.into()).unwrap()
}
#[test]
fn automatic_copies_preserve_rows_context_and_reuse_one_document_path() {
    let dir = tempfile::tempdir().unwrap();
    let e = engine(dir.path());
    assert_eq!(
        e.invoke("preferences", json!({})).unwrap()["auto_save_unsaved"],
        true
    );
    e.invoke(
        "edit",
        json!({"id":"1","changes":{"note":"automatically saved"}}),
    )
    .unwrap();
    e.invoke("select", json!({"ids":["1","2"]})).unwrap();
    e.invoke(
        "view_set",
        json!({"display":{"show_tracks":false,"show_trails":false}}),
    )
    .unwrap();
    let status = e.invoke("autosave_unsaved", json!({})).unwrap();
    let path = PathBuf::from(status["autosave_path"].as_str().unwrap());
    assert!(path.starts_with(dir.path().join("Documents/Autosaved")));
    assert_eq!(status["source"], serde_json::Value::Null);
    assert_eq!(status["autosave_revision"], status["revision"]);
    assert_eq!(
        e.invoke("autosave_unsaved", json!({})).unwrap()["autosave_path"],
        status["autosave_path"]
    );
    let reopened = Engine::from_path(&path, dir.path().join("reopen"), None).unwrap();
    assert_eq!(
        reopened.invoke("events", json!({"id":"1"})).unwrap()["events"][0]["note"],
        "automatically saved"
    );
    let snapshot = reopened.invoke("snapshot", json!({})).unwrap();
    assert_eq!(snapshot["selected_count"], 2);
    assert_eq!(snapshot["scene"]["display"]["show_tracks"], false);
    assert_eq!(snapshot["scene"]["display"]["show_trails"], false);
    e.invoke("edit", json!({"id":"1","changes":{"note":"latest copy"}}))
        .unwrap();
    let updated = e.invoke("autosave_unsaved", json!({})).unwrap();
    assert_eq!(updated["autosave_path"], status["autosave_path"]);
    let latest = Engine::from_path(&path, dir.path().join("latest"), None).unwrap();
    assert_eq!(
        latest.invoke("events", json!({"id":"1"})).unwrap()["events"][0]["note"],
        "latest copy"
    );
    e.invoke("demo", json!({})).unwrap();
    assert_ne!(
        e.invoke("autosave_unsaved", json!({})).unwrap()["autosave_path"],
        status["autosave_path"]
    );
}
#[test]
fn disabled_preference_is_global_and_original_documents_are_never_overwritten() {
    let dir = tempfile::tempdir().unwrap();
    let e = engine(dir.path());
    let original = dir.path().join("original.chronoscope");
    e.invoke("save", json!({"path":original})).unwrap();
    let bytes = std::fs::read(&original).unwrap();
    e.invoke("edit", json!({"id":"1","changes":{"note":"new version"}}))
        .unwrap();
    e.invoke("autosave_unsaved", json!({})).unwrap();
    assert_eq!(std::fs::read(&original).unwrap(), bytes);
    e.invoke(
        "preferences",
        json!({"preferences":{"auto_save_unsaved":false}}),
    )
    .unwrap();
    e.invoke("open", json!({"path":original})).unwrap();
    assert_eq!(
        e.invoke("preferences", json!({})).unwrap()["auto_save_unsaved"],
        false
    );
    e.invoke("edit", json!({"id":"1","changes":{"note":"manual mode"}}))
        .unwrap();
    assert_eq!(
        e.invoke("autosave_unsaved", json!({})).unwrap()["autosave_path"],
        serde_json::Value::Null
    );
}
#[test]
fn abandoned_checkpoints_become_documents_without_replacing_the_active_workspace() {
    use std::{
        io::{BufRead, Write},
        process::{Command, Stdio},
    };
    let dir = tempfile::tempdir().unwrap();
    let mut child = Command::new(env!("CARGO_BIN_EXE_chronoscope"))
        .args([
            "--demo-data",
            "--data-dir",
            dir.path().to_str().unwrap(),
            "session",
        ])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .unwrap();
    let mut input = child.stdin.take().unwrap();
    let mut output = std::io::BufReader::new(child.stdout.take().unwrap());
    for (command, args) in [
        ("edit", json!({"id":"1","changes":{"note":"crashed work"}})),
        ("recovery_checkpoint", json!({})),
    ] {
        writeln!(input, "{}", json!({"command":command,"args":args})).unwrap();
        input.flush().unwrap();
        let mut line = String::new();
        output.read_line(&mut line).unwrap();
        assert_eq!(
            serde_json::from_str::<serde_json::Value>(&line).unwrap()["ok"],
            true
        );
    }
    child.kill().unwrap();
    child.wait().unwrap();
    let e = Engine::new(Project::new(Dataset::default()), dir.path().into()).unwrap();
    let before = e.invoke("snapshot", json!({})).unwrap();
    let archived = e.invoke("recovery_archive", json!({})).unwrap();
    assert_eq!(archived["errors"], json!([]));
    assert_eq!(archived["archived"].as_array().unwrap().len(), 1);
    assert_eq!(e.invoke("snapshot", json!({})).unwrap(), before);
    assert_eq!(
        e.invoke("recovery_list", json!({})).unwrap()["checkpoints"],
        json!([])
    );
    let reopened = Engine::from_path(
        std::path::Path::new(archived["archived"][0].as_str().unwrap()),
        dir.path().join("reopened"),
        None,
    )
    .unwrap();
    assert_eq!(
        reopened.invoke("events", json!({"id":"1"})).unwrap()["events"][0]["note"],
        "crashed work"
    );
    assert_eq!(
        e.invoke("recovery_archive", json!({})).unwrap()["archived"],
        json!([])
    );
}
#[test]
fn saving_failure_retains_crash_protection_and_active_sessions_are_excluded() {
    let dir = tempfile::tempdir().unwrap();
    let e = engine(dir.path());
    e.invoke("edit", json!({"id":"1","changes":{"note":"keep me"}}))
        .unwrap();
    std::fs::create_dir(dir.path().join("Documents")).unwrap();
    std::fs::write(dir.path().join("Documents/Autosaved"), "blocked directory").unwrap();
    assert!(e.invoke("autosave_unsaved", json!({})).is_err());
    assert_eq!(
        e.invoke("workspace_status", json!({})).unwrap()["dirty"],
        true
    );
    let other = engine(dir.path());
    assert_eq!(
        other.invoke("recovery_archive", json!({})).unwrap()["archived"],
        json!([])
    );
    assert!(std::fs::read_dir(dir.path())
        .unwrap()
        .flatten()
        .any(|e| e.file_name().to_string_lossy().starts_with("recovery-")));
    let defaults: chronoscope::display::DisplayOptions = serde_json::from_value(json!({})).unwrap();
    assert!(defaults.show_tracks && defaults.show_trails);
    let names = chronoscope::mcp::tools()
        .into_iter()
        .map(|t| t["name"].as_str().unwrap().to_owned())
        .collect::<Vec<_>>();
    assert!(!names
        .iter()
        .any(|n| n == "chronoscope_autosave_unsaved" || n == "chronoscope_recovery_archive"));
}
