use chronoscope::{engine::Engine, project::Project};
use serde_json::{json, Value};
use std::{
    io::Write,
    sync::{Arc, Mutex},
};

fn fixture(name: &str) -> std::path::PathBuf {
    std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("tests/fixtures")
        .join(name)
}
fn write_project(path: &std::path::Path, project: &Project) {
    std::fs::write(path, serde_json::to_vec(project).unwrap()).unwrap();
}

#[test]
fn startup_and_open_enforce_gis_scope_and_checksums() {
    let d = tempfile::tempdir().unwrap();
    let root = d.path().join("allowed");
    std::fs::create_dir(&root).unwrap();
    let archive = d.path().join("outside.zip");
    let mut zip = zip::ZipWriter::new(std::fs::File::create(&archive).unwrap());
    zip.start_file(
        "secret.txt",
        zip::write::SimpleFileOptions::default().compression_method(zip::CompressionMethod::Stored),
    )
    .unwrap();
    zip.write_all(b"private-outside-root").unwrap();
    zip.finish().unwrap();
    let mut project = Project::empty();
    project.gis_layers.push(
        serde_json::from_value(json!({
            "id":"1".repeat(32),"name":"forged","format":"geojson","enabled":true,
            "asset":archive,"sha256":"0".repeat(64),"entrypoint":"secret.txt",
            "bytes":1,"resource_count":1,"feature_count":0,"bounds":null,
            "time_bounds":null,"position":null,"scale":1.0,"warnings":[]
        }))
        .unwrap(),
    );
    let file = root.join("project.json");
    write_project(&file, &project);
    assert!(Engine::from_path(&file, d.path().join("startup"), Some(&root)).is_err());
    // A permitted location still must pass the package checksum, not just the descriptor schema.
    let local = root.join("inside.zip");
    std::fs::copy(&archive, &local).unwrap();
    project.gis_layers[0].asset = local;
    write_project(&file, &project);
    assert!(Engine::from_path(&file, d.path().join("checksum"), Some(&root)).is_err());
    let engine =
        Engine::new_with_terrain_scope(Project::empty(), d.path().join("open"), Some(&root))
            .unwrap();
    let before = engine.invoke("snapshot", json!({})).unwrap();
    assert!(engine.invoke("open", json!({"path":file})).is_err());
    assert_eq!(before, engine.invoke("snapshot", json!({})).unwrap());
}

#[test]
fn sqlite_autosave_external_resources_cannot_bypass_startup_scope() {
    let d = tempfile::tempdir().unwrap();
    let source = Engine::new(Project::empty(), d.path().join("source")).unwrap();
    source
        .invoke("gis_load", json!({"path":fixture("gis/events.geojson")}))
        .unwrap();
    let autosave = source.invoke("autosave_unsaved", json!({})).unwrap();
    let root = d.path().join("allowed");
    std::fs::create_dir(&root).unwrap();
    let file = root.join("external.chronoscope");
    std::fs::copy(autosave["autosave_path"].as_str().unwrap(), &file).unwrap();
    assert!(Engine::from_path(&file, d.path().join("target"), Some(&root)).is_err());
    // Portable embedded packages are valid even when original assets were outside root.
    source.invoke("save", json!({"path":file})).unwrap();
    let restored = Engine::from_path(&file, d.path().join("portable"), Some(&root)).unwrap();
    assert_eq!(
        restored.invoke("gis_layers", json!({})).unwrap()["layers"]
            .as_array()
            .unwrap()
            .len(),
        1
    );
}

#[test]
fn failed_terrain_load_and_unload_preserve_catalog_preferences_and_revision() {
    let d = tempfile::tempdir().unwrap();
    let e = Engine::new(Project::empty(), d.path().join("profile")).unwrap();
    let tile = fixture("terrain/synthetic-n43.dt0");
    let prefs = e.data_dir.join("preferences.json");
    std::fs::create_dir(&prefs).unwrap();
    let before = e.invoke("snapshot", json!({})).unwrap();
    let before_terrain = e.invoke("terrain_info", json!({})).unwrap();
    assert!(e.invoke("terrain_load", json!({"path":tile})).is_err());
    assert_eq!(e.invoke("terrain_info", json!({})).unwrap(), before_terrain);
    assert_eq!(before, e.invoke("snapshot", json!({})).unwrap());
    std::fs::remove_dir(&prefs).unwrap();
    e.invoke("terrain_load", json!({"path":tile})).unwrap();
    let terrain = e.invoke("terrain_info", json!({})).unwrap();
    let before = e.invoke("snapshot", json!({})).unwrap();
    std::fs::remove_file(&prefs).unwrap();
    std::fs::create_dir(&prefs).unwrap();
    assert!(e.invoke("terrain_unload", json!({})).is_err());
    assert_eq!(terrain, e.invoke("terrain_info", json!({})).unwrap());
    // Ignore the disk-based autosave preference in lifecycle; the live metadata stays fixed.
    assert_eq!(before, e.invoke("snapshot", json!({})).unwrap());
}

#[test]
fn analytics_commits_publish_once_and_cache_hits_publish_nothing() {
    let d = tempfile::tempdir().unwrap();
    let e = Engine::new(Project::new(chronoscope::demo::dataset()), d.path().into()).unwrap();
    let seen = Arc::new(Mutex::new(Vec::<Value>::new()));
    let sink = seen.clone();
    e.set_observer(Arc::new(move |v| sink.lock().unwrap().push(v)))
        .unwrap();
    let args = json!({"plan":{"capability":"quantiles","scope":"all","parameters":{"field":"value","probabilities":[0.5]}}});
    let result = e.invoke("analytics_run", args.clone()).unwrap();
    assert!(e.workspace_dirty());
    assert_eq!(seen.lock().unwrap().len(), 1);
    assert_eq!(seen.lock().unwrap()[0]["command"], "analytics_run");
    e.invoke("analytics_run", args).unwrap();
    assert_eq!(seen.lock().unwrap().len(), 1);
    e.invoke("analytics_remove", json!({"result_id":result["result_id"]}))
        .unwrap();
    assert_eq!(seen.lock().unwrap().len(), 2);
    e.invoke("analytics_remove", json!({"result_id":result["result_id"]}))
        .unwrap();
    assert_eq!(seen.lock().unwrap().len(), 2);
}

#[test]
fn stale_workspace_tokens_fail_even_after_undo_restores_the_same_store() {
    let d = tempfile::tempdir().unwrap();
    let e = Engine::new(
        Project::new(chronoscope::demo::dataset()),
        d.path().join("profile"),
    )
    .unwrap();
    let initial = e.invoke("snapshot", json!({})).unwrap()["workspace_id"].clone();
    let file = d.path().join("other.json");
    write_project(&file, &Project::new(chronoscope::demo::dataset()));
    e.invoke("open", json!({"path":file})).unwrap();
    for undone in [false, true] {
        if undone {
            e.invoke("undo", json!({})).unwrap();
        }
        let result = e.invoke(
            "edit",
            json!({"id":"1","expected_workspace":initial,"changes":{"note":"wrong document"}}),
        );
        assert!(result.unwrap_err().starts_with("CONFLICT:"));
        assert_ne!(
            e.invoke("events", json!({"id":"1"})).unwrap()["events"][0]["note"],
            "wrong document"
        );
    }
}

#[test]
fn terrain_commit_is_successful_when_cancellation_arrives_after_preferences_are_durable() {
    use std::sync::atomic::{AtomicBool, Ordering};
    let dir = tempfile::tempdir().unwrap();
    let engine = Engine::new(Project::empty(), dir.path().into()).unwrap();
    let cancelled = Arc::new(AtomicBool::new(false));
    let late_cancel = cancelled.clone();
    let result = chronoscope::operation::with_context(
        chronoscope::operation::Context {
            cancelled,
            scope: None,
            progress: Some(Arc::new(move |_, _, message| {
                if message == "Committed external file" {
                    late_cancel.store(true, Ordering::Relaxed);
                }
            })),
        },
        || {
            engine.invoke(
                "terrain_load",
                json!({"path":fixture("terrain/synthetic-n43.dt0")}),
            )
        },
    )
    .unwrap();
    assert_eq!(result["commit_receipt"]["committed"], true);
    assert_eq!(result["commit_receipt"]["cancel_requested"], true);
    assert_eq!(
        engine.invoke("terrain_info", json!({})).unwrap()["tiles"]
            .as_array()
            .unwrap()
            .len(),
        1
    );
    assert!(!engine.invoke("preferences", json!({})).unwrap()["terrain_path"].is_null());
}

#[test]
fn legacy_startup_without_workspace_settings_keeps_user_terrain_defaults() {
    let dir = tempfile::tempdir().unwrap();
    let profile = dir.path().join("profile");
    let engine = Engine::new(Project::empty(), profile.clone()).unwrap();
    engine
        .invoke(
            "terrain_load",
            json!({"path":fixture("terrain/synthetic-n43.dt0")}),
        )
        .unwrap();
    let file = dir.path().join("legacy.json");
    write_project(&file, &Project::empty());
    let restored = Engine::from_path(&file, profile, None).unwrap();
    assert_eq!(
        restored.invoke("terrain_info", json!({})).unwrap()["tiles"]
            .as_array()
            .unwrap()
            .len(),
        1
    );
}

#[test]
fn explicitly_reloading_the_same_terrain_folder_refreshes_its_catalog() {
    let dir = tempfile::tempdir().unwrap();
    let input = dir.path().join("tiles");
    std::fs::create_dir(&input).unwrap();
    std::fs::copy(
        fixture("terrain/synthetic-n43.dt0"),
        input.join("first.dt0"),
    )
    .unwrap();
    let engine = Engine::new(Project::empty(), dir.path().join("profile")).unwrap();
    assert_eq!(
        engine
            .invoke("terrain_load", json!({"path":input}))
            .unwrap()["tiles"]
            .as_array()
            .unwrap()
            .len(),
        1
    );
    std::fs::copy(
        fixture("terrain/synthetic-n43.dt0"),
        input.join("second.dt0"),
    )
    .unwrap();
    assert_eq!(
        engine
            .invoke("terrain_load", json!({"path":input}))
            .unwrap()["tiles"]
            .as_array()
            .unwrap()
            .len(),
        2
    );
}

#[test]
fn in_flight_si_cannot_edit_newly_opened_workspace() {
    use std::{io::Read, net::TcpListener, sync::mpsc, time::Duration};
    let d = tempfile::tempdir().unwrap();
    let e = Engine::new(
        Project::new(chronoscope::demo::dataset()),
        d.path().join("profile"),
    )
    .unwrap();
    let mut replacement = Project::new(chronoscope::demo::dataset());
    replacement.dataset.name = "Different project".into();
    replacement.dataset.events[0].note = "Untouched new workspace".into();
    let path = d.path().join("replacement.json");
    std::fs::write(&path, serde_json::to_vec(&replacement).unwrap()).unwrap();
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let addr = listener.local_addr().unwrap();
    let (arrived_tx, arrived_rx) = mpsc::channel();
    let (release_tx, release_rx) = mpsc::channel();
    let server = std::thread::spawn(move || {
        for turn in 0..1 {
            let (mut stream, _) = listener.accept().unwrap();
            stream
                .set_read_timeout(Some(Duration::from_secs(15)))
                .unwrap();
            let mut header = vec![];
            while !header.ends_with(b"\r\n\r\n") {
                let mut b = [0];
                stream.read_exact(&mut b).unwrap();
                header.push(b[0]);
            }
            let header = String::from_utf8(header).unwrap();
            let len: usize = header
                .lines()
                .find_map(|line| {
                    line.to_lowercase()
                        .strip_prefix("content-length:")
                        .map(|s| s.trim().parse().unwrap())
                })
                .unwrap();
            let mut body = vec![0; len];
            stream.read_exact(&mut body).unwrap();
            if turn == 0 {
                arrived_tx.send(()).unwrap();
                release_rx.recv_timeout(Duration::from_secs(15)).unwrap();
            }
            let message = if turn == 0 {
                json!({"role":"assistant","content":null,"tool_calls":[{"id":"edit-1","type":"function","function":{"name":"chronoscope_edit","arguments":json!({"id":"1","changes":{"note":"Edit intended for original workspace"}}).to_string()}}]})
            } else {
                json!({"role":"assistant","content":"Done"})
            };
            let text = json!({"choices":[{"message":message}]}).to_string();
            write!(stream,"HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",text.len(),text).unwrap();
        }
    });
    e.invoke(
        "si_configure",
        json!({"url":format!("http://{addr}/v1"),"model":"test"}),
    )
    .unwrap();
    let run_engine = e.clone();
    let run = std::thread::spawn(move || {
        run_engine.invoke(
            "si_run",
            json!({"prompt":"Edit the original workspace record","allow_edits":true}),
        )
    });
    arrived_rx.recv_timeout(Duration::from_secs(15)).unwrap();
    e.invoke("open", json!({"path":path})).unwrap();
    release_tx.send(()).unwrap();
    let error = run.join().unwrap().unwrap_err();
    server.join().unwrap();
    assert!(error.starts_with("CONFLICT:"), "{error}");
    let row = e.invoke("events", json!({"id":"1"})).unwrap();
    assert_eq!(row["events"][0]["note"], "Untouched new workspace", "{row}");
}
