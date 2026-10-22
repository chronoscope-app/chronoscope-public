use chronoscope::{
    agent::{self, access},
    engine::Engine,
    model::Dataset,
    project::Project,
};
use serde_json::{json, Value};
use std::{
    io::Write,
    path::Path,
    process::{Command, Stdio},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
};
fn cli(data: &Path, args: &[&str]) -> Value {
    let output = Command::new(env!("CARGO_BIN_EXE_chronoscope"))
        .arg("--data-dir")
        .arg(data)
        .args(args)
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    serde_json::from_slice(&output.stdout).unwrap()
}
#[test]
fn cli_can_enable_discover_attach_and_disable_without_a_folder_picker() {
    let dir = tempfile::tempdir().unwrap();
    let engine = Arc::new(
        Engine::new(
            Project::new(chronoscope::demo::dataset()),
            dir.path().into(),
        )
        .unwrap(),
    );
    let stop = Arc::new(AtomicBool::new(false));
    let polling = stop.clone();
    let target = engine.clone();
    let controller = std::thread::spawn(move || {
        let mut agent = None;
        while !polling.load(Ordering::Relaxed) {
            access::refresh(&target, &mut agent).unwrap();
            std::thread::sleep(std::time::Duration::from_millis(20));
        }
    });
    let enabled = cli(dir.path(), &["agent", "enable"]);
    assert_eq!(enabled["connected"], true);
    assert_eq!(enabled["pending"], false);
    assert_eq!(
        enabled["root"],
        json!(dir.path().join("agent-files").canonicalize().unwrap())
    );
    assert!(!enabled.to_string().contains("\"token\""));
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        assert_eq!(
            std::fs::metadata(dir.path().join("agent-access.json"))
                .unwrap()
                .permissions()
                .mode()
                & 0o777,
            0o600
        );
    }
    let selected = cli(
        dir.path(),
        &[
            "--attach",
            "call",
            "select",
            "--args",
            "{\"ids\":[\"1\",\"2\"]}",
        ],
    );
    assert_eq!(selected["selected"], 2);
    assert_eq!(
        engine.invoke("snapshot", json!({"compact":true})).unwrap()["selected_count"],
        2
    );
    let before = std::fs::read_dir(dir.path()).unwrap().count();
    assert_eq!(
        cli(dir.path(), &["--attach", "call", "snapshot"])["selected_count"],
        2
    );
    assert_eq!(
        std::fs::read_dir(dir.path()).unwrap().count(),
        before,
        "Attached CLI must not create another demo/working database"
    );
    let outside = dir.path().join("outside.csv");
    std::fs::write(&outside, b"private").unwrap();
    let info = agent::read_connection(&dir.path().join("agent-connection.json")).unwrap();
    assert!(agent::invoke_remote(&info, "import_preview", json!({"path":outside})).is_err());
    let config = cli(dir.path(), &["agent", "config"]);
    let launcher = &config["mcpServers"]["chronoscope"];
    let mut child = Command::new(launcher["command"].as_str().unwrap())
        .args(
            launcher["args"]
                .as_array()
                .unwrap()
                .iter()
                .map(|v| v.as_str().unwrap()),
        )
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .unwrap();
    let mut input = child.stdin.take().unwrap();
    writeln!(input,"{}",json!({"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"agent-setup-test","version":"1"}}})).unwrap();
    writeln!(input,"{}",json!({"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"chronoscope_snapshot","arguments":{"compact":true}}})).unwrap();
    writeln!(input,"{}",json!({"jsonrpc":"2.0","id":3,"method":"resources/read","params":{"uri":"chronoscope://connection"}})).unwrap();
    drop(input);
    let result = child.wait_with_output().unwrap();
    assert!(
        result.status.success(),
        "{}",
        String::from_utf8_lossy(&result.stderr)
    );
    let messages: Vec<Value> = String::from_utf8(result.stdout)
        .unwrap()
        .lines()
        .map(|s| serde_json::from_str(s).unwrap())
        .collect();
    assert_eq!(
        messages[1]["result"]["structuredContent"]["selected_count"],
        2
    );
    let scope: Value = serde_json::from_str(
        messages[2]["result"]["contents"][0]["text"]
            .as_str()
            .unwrap(),
    )
    .unwrap();
    assert_eq!(scope["file_root"], enabled["root"]);
    let custom = dir.path().join("Chosen data");
    std::fs::create_dir(&custom).unwrap();
    let configured = cli(
        dir.path(),
        &["agent", "enable", "--root", custom.to_str().unwrap()],
    );
    assert_eq!(configured["root"], json!(custom.canonicalize().unwrap()));
    assert_eq!(configured["pending"], false);
    let disabled = cli(dir.path(), &["agent", "disable"]);
    assert_eq!(disabled["connected"], false);
    assert_eq!(disabled["enabled"], false);
    stop.store(true, Ordering::Relaxed);
    controller.join().unwrap();
}
#[test]
fn saved_access_restarts_and_invalid_settings_fail_closed() {
    let dir = tempfile::tempdir().unwrap();
    let engine =
        Arc::new(Engine::new(Project::new(Dataset::default()), dir.path().into()).unwrap());
    access::write_settings(dir.path(), true, None).unwrap();
    let mut running = None;
    access::refresh(&engine, &mut running).unwrap();
    assert!(running.is_some());
    drop(running.take());
    access::refresh(&engine, &mut running).unwrap();
    assert!(running.is_some());
    std::fs::write(dir.path().join("agent-access.json"), b"invalid").unwrap();
    assert!(access::refresh(&engine, &mut running).is_err());
    assert!(running.is_none());
    assert!(!dir.path().join("agent-connection.json").exists());
}
#[test]
fn config_keeps_executable_paths_with_spaces_and_quotes_as_exact_arguments() {
    let executable = Path::new(
        "/Applications/Analyst's Tools/Chronoscope.app/Contents/MacOS/chronoscope-desktop",
    );
    let config = access::config(executable);
    assert_eq!(
        config["mcpServers"]["chronoscope"]["command"],
        json!(executable)
    );
    assert_eq!(
        config["mcpServers"]["chronoscope"]["args"],
        json!(["mcp", "--attach"])
    );
    #[cfg(unix)]
    {
        let command = access::codex_command(executable).replacen(
            "codex mcp add chronoscope -- ",
            "printf '%s\\n' ",
            1,
        );
        let result = Command::new("sh").args(["-c", &command]).output().unwrap();
        assert!(result.status.success());
        assert_eq!(
            String::from_utf8(result.stdout)
                .unwrap()
                .lines()
                .next()
                .unwrap(),
            executable.to_str().unwrap()
        );
    }
}

#[test]
fn older_windows_do_not_remove_newer_descriptors_and_a_survivor_can_republish() {
    let dir = tempfile::tempdir().unwrap();
    let engine =
        Arc::new(Engine::new(Project::new(Dataset::default()), dir.path().into()).unwrap());
    let settings = access::Settings {
        enabled: true,
        root: None,
    };
    let mut older = None;
    access::reconcile(&engine, &mut older, &settings).unwrap();
    let newer = agent::start(engine.clone(), &dir.path().join("agent-files")).unwrap();
    let token = newer.info.token.clone();
    drop(older.take());
    assert_eq!(
        agent::read_connection(&newer.descriptor).unwrap().token,
        token
    );
    drop(newer);
    access::reconcile(&engine, &mut older, &settings).unwrap();
    std::fs::remove_file(&older.as_ref().unwrap().descriptor).unwrap();
    access::reconcile(&engine, &mut older, &settings).unwrap();
    assert!(older.as_ref().unwrap().descriptor.exists());
}
