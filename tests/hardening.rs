use chronoscope::{engine::Engine, model::Dataset, project::Project, store::DataStore};
use serde_json::json;
#[test]
fn failed_reads_preserve_the_entire_workspace_and_revision() {
    let dir = tempfile::tempdir().unwrap();
    let e = Engine::new(
        Project::new(chronoscope::demo::dataset()),
        dir.path().into(),
    )
    .unwrap();
    e.invoke("filter", json!({"filter":{"search":"Aurora"}}))
        .unwrap();
    e.invoke("select", json!({"ids":["1"]})).unwrap();
    e.invoke("save_group", json!({"name":"evidence"})).unwrap();
    e.invoke("save_view", json!({"name":"context"})).unwrap();
    let before = e.invoke("snapshot", json!({})).unwrap();
    for (command, args) in [
        (
            "coordinates",
            json!({"coordinate":{"system":"mgrs","reference":"invalid"}}),
        ),
        ("terrain_sample", json!({"latitude":0,"longitude":0})),
        ("query", json!({"cursor":"broken"})),
        ("query", json!({"fields":["unknown_field"]})),
    ] {
        assert!(e.invoke(command, args).is_err(), "{command}");
        assert_eq!(
            e.invoke("snapshot", json!({})).unwrap(),
            before,
            "{command} changed workspace"
        );
    }
}
#[test]
fn database_open_rejects_modified_derived_indexes_without_touching_source() {
    for tamper in [
        "DELETE FROM spatial",
        "UPDATE attributes SET text='forged' WHERE key='proof'",
        "UPDATE search SET text='forged'",
        "UPDATE spatial SET lon_min=-100,lon_max=-100",
        "DROP INDEX events_time; CREATE INDEX events_time ON events(category)",
    ] {
        let dir = tempfile::tempdir().unwrap();
        let mut event = chronoscope::demo::dataset().events.remove(0);
        event.attrs.insert("proof".into(), "original".into());
        let mut store = DataStore::new(&dir.path().join("working")).unwrap();
        store.load_events(vec![event]).unwrap();
        let path = dir.path().join("study.chronoscope");
        store
            .save_as(&path, &Project::new(Dataset::default()))
            .unwrap();
        let c = rusqlite::Connection::open(&path).unwrap();
        c.execute_batch(tamper).unwrap();
        drop(c);
        let before = std::fs::read(&path).unwrap();
        assert!(
            Engine::from_path(&path, dir.path().join("opened"), None).is_err(),
            "accepted {tamper}"
        );
        assert_eq!(std::fs::read(&path).unwrap(), before);
    }
}
#[test]
fn nested_filesystem_capabilities_always_choose_the_narrower_root() {
    use chronoscope::operation::intersect_scopes;
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path().canonicalize().unwrap();
    let child = root.join("child");
    std::fs::create_dir(&child).unwrap();
    assert_eq!(
        intersect_scopes(Some(root.clone()), Some(child.clone())).unwrap(),
        Some(child.clone())
    );
    assert_eq!(
        intersect_scopes(Some(child.clone()), Some(root)).unwrap(),
        Some(child.clone())
    );
    assert!(intersect_scopes(Some(child), Some(dir.path().join("other"))).is_err());
}

#[test]
fn recovery_keeps_unsaved_rows_and_context_without_a_portable_copy() {
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
        (
            "edit",
            json!({"id":"1","changes":{"note":"survives process crash"}}),
        ),
        ("select", json!({"ids":["1"]})),
        ("save_group", json!({"name":"recovered evidence"})),
        ("recovery_checkpoint", json!({})),
    ] {
        writeln!(input, "{}", json!({"command":command,"args":args})).unwrap();
        input.flush().unwrap();
        let mut line = String::new();
        output.read_line(&mut line).unwrap();
        let response: serde_json::Value = serde_json::from_str(&line).unwrap();
        assert_eq!(response["ok"], true, "{response}");
    }
    child.kill().unwrap();
    child.wait().unwrap();
    let e = Engine::new(Project::new(Dataset::default()), dir.path().into()).unwrap();
    let list = e.invoke("recovery_list", json!({})).unwrap();
    let id = list["checkpoints"][0]["id"].clone();
    assert!(id.is_string(), "{list}");
    e.invoke("recovery_restore", json!({"id":id})).unwrap();
    assert_eq!(
        e.invoke("events", json!({"id":"1"})).unwrap()["events"][0]["note"],
        "survives process crash"
    );
    let snapshot = e.invoke("snapshot", json!({})).unwrap();
    assert_eq!(snapshot["groups"][0]["name"], "recovered evidence");
    assert_eq!(
        e.invoke("workspace_status", json!({})).unwrap()["dirty"],
        true
    );
    let saved = dir.path().join("recovered.chronoscope");
    e.invoke("save", json!({"path":saved})).unwrap();
    assert_eq!(
        e.invoke("workspace_status", json!({})).unwrap()["dirty"],
        false
    );
    e.invoke("recovery_discard", json!({"id":id})).unwrap();
    assert!(e.invoke("recovery_list", json!({})).unwrap()["checkpoints"]
        .as_array()
        .unwrap()
        .is_empty());
}

#[test]
fn active_recovery_checkpoints_cannot_be_recovered_or_deleted_by_another_engine() {
    let dir = tempfile::tempdir().unwrap();
    let e = Engine::new(
        Project::new(chronoscope::demo::dataset()),
        dir.path().into(),
    )
    .unwrap();
    e.invoke("edit", json!({"id":"1","changes":{"note":"work"}}))
        .unwrap();
    e.invoke("recovery_checkpoint", json!({})).unwrap();
    let id = std::fs::read_dir(dir.path())
        .unwrap()
        .flatten()
        .find_map(|e| {
            let n = e.file_name().to_string_lossy().into_owned();
            n.strip_prefix("recovery-")
                .and_then(|n| n.strip_suffix(".json"))
                .map(str::to_owned)
        })
        .unwrap();
    let other = Engine::new(Project::new(Dataset::default()), dir.path().into()).unwrap();
    assert!(
        other.invoke("recovery_list", json!({})).unwrap()["checkpoints"]
            .as_array()
            .unwrap()
            .is_empty()
    );
    assert!(other
        .invoke("recovery_restore", json!({"id":id}))
        .unwrap_err()
        .contains("still open"));
    assert!(other
        .invoke("recovery_discard", json!({"id":id}))
        .unwrap_err()
        .contains("still open"));
    e.invoke("recovery_clear", json!({})).unwrap();
}
#[test]
fn dense_single_entity_proximity_is_exact_without_pair_work() {
    let event = chronoscope::demo::dataset().events.remove(0);
    let rows = (0..20000)
        .map(|i| {
            let mut e = event.clone();
            e.id = i;
            e.time = 0.0;
            e.end = None;
            e
        })
        .collect::<Vec<_>>();
    let result = chronoscope::analysis::run(
        &rows,
        chronoscope::analysis::Pattern::Proximity,
        &Default::default(),
    );
    assert!(!result.limited);
    assert_eq!(result.candidate_visits, 0);
    assert!(result.findings.is_empty());
}
#[test]
fn selecting_does_not_rebuild_dataset_statistics_and_compact_reads_skip_them() {
    let dir = tempfile::tempdir().unwrap();
    let e = Engine::new(
        Project::new(chronoscope::demo::dataset()),
        dir.path().into(),
    )
    .unwrap();
    e.invoke("snapshot", json!({"compact":true})).unwrap();
    assert_eq!(
        e.invoke("diagnostics", json!({})).unwrap()["store"]["statistics_builds"],
        0
    );
    let before = e.invoke("snapshot", json!({})).unwrap();
    let metrics = e.invoke("diagnostics", json!({})).unwrap()["store"].clone();
    e.invoke("select", json!({"ids":["1"]})).unwrap();
    let after = e.invoke("snapshot", json!({})).unwrap();
    let next = e.invoke("diagnostics", json!({})).unwrap()["store"].clone();
    assert_eq!(metrics["statistics_builds"], next["statistics_builds"]);
    assert_eq!(metrics["summary_builds"], next["summary_builds"]);
    assert_eq!(before["stats"], after["stats"]);
    assert_eq!(
        after["selected_histogram"]
            .as_array()
            .unwrap()
            .iter()
            .map(|v| v.as_u64().unwrap())
            .sum::<u64>(),
        1
    );
}
#[test]
fn all_exposed_saved_context_ids_are_exact_strings() {
    let dir = tempfile::tempdir().unwrap();
    let mut event = chronoscope::demo::dataset().events.remove(0);
    event.id = 9007199254740993;
    let e = Engine::new(
        Project::new(Dataset {
            name: "high IDs".into(),
            events: vec![event],
        }),
        dir.path().into(),
    )
    .unwrap();
    e.invoke("select", json!({"ids":["9007199254740993"]}))
        .unwrap();
    e.invoke("save_group", json!({"name":"group"})).unwrap();
    e.invoke("save_view", json!({"name":"view"})).unwrap();
    let r = e.invoke("snapshot", json!({})).unwrap();
    assert_eq!(r["groups"][0]["ids"][0], "9007199254740993");
    assert_eq!(r["views"][0]["selected"][0], "9007199254740993");
}
#[test]
fn automatic_authentication_cache_rotates_on_reset_and_online_restart() {
    use chronoscope::wmts::TileService;
    let dir = tempfile::tempdir().unwrap();
    let cache = dir.path().join("wmts-cache");
    let maps = TileService::new(cache.clone()).unwrap();
    let first = maps.automatic_cache_scope().unwrap();
    maps.reset_authentication().unwrap();
    let second = maps.automatic_cache_scope().unwrap();
    assert_ne!(first, second);
    let mut settings = maps.access_settings().unwrap();
    settings.offline = true;
    maps.set_access_settings(settings).unwrap();
    drop(maps);
    let maps = TileService::new(cache.clone()).unwrap();
    assert_eq!(maps.automatic_cache_scope().unwrap(), second);
    let mut settings = maps.access_settings().unwrap();
    settings.offline = false;
    maps.set_access_settings(settings).unwrap();
    let third = maps.automatic_cache_scope().unwrap();
    assert_ne!(third, second);
    drop(maps);
    assert_ne!(
        TileService::new(cache)
            .unwrap()
            .automatic_cache_scope()
            .unwrap(),
        third
    );
}
#[test]
fn slow_map_io_does_not_hold_the_workspace_operation_lock() {
    use std::{
        io::{Read, Write},
        net::TcpListener,
        sync::{mpsc, Arc},
        time::Duration,
    };
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let address = listener.local_addr().unwrap();
    let (started_tx, started_rx) = mpsc::channel();
    let (release_tx, release_rx) = mpsc::channel();
    let server = std::thread::spawn(move || {
        let (mut stream, _) = listener.accept().unwrap();
        let mut b = [0u8; 4096];
        assert!(stream.read(&mut b).unwrap() > 0);
        started_tx.send(()).unwrap();
        release_rx.recv().unwrap();
        let _ = write!(
            stream,
            "HTTP/1.1 200 OK\r\nContent-Length: 3\r\nConnection: close\r\n\r\nbad"
        );
    });
    let dir = tempfile::tempdir().unwrap();
    let e = Arc::new(
        Engine::new(
            Project::new(chronoscope::demo::dataset()),
            dir.path().into(),
        )
        .unwrap(),
    );
    let cloned = e.clone();
    let network = std::thread::spawn(move || {
        cloned.invoke(
            "wmts_capabilities",
            json!({"url":format!("http://{address}/caps")}),
        )
    });
    started_rx.recv_timeout(Duration::from_secs(5)).unwrap();
    let (query_tx, query_rx) = mpsc::channel();
    let cloned = e.clone();
    let query = std::thread::spawn(move || {
        query_tx
            .send(cloned.invoke("snapshot", json!({"compact":true})))
            .unwrap()
    });
    let result = query_rx.recv_timeout(Duration::from_secs(1));
    release_tx.send(()).unwrap();
    assert_eq!(
        result
            .expect("map download blocked workspace query")
            .unwrap()["count"],
        192
    );
    assert!(network.join().unwrap().is_err());
    query.join().unwrap();
    server.join().unwrap();
}
#[test]
fn cancelled_http_reads_stop_without_waiting_for_the_server_timeout() {
    use std::{
        io::{Read, Write},
        net::TcpListener,
        sync::{
            atomic::{AtomicBool, Ordering},
            mpsc, Arc,
        },
        time::Duration,
    };
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let address = listener.local_addr().unwrap();
    let (started_tx, started_rx) = mpsc::channel();
    let (release_tx, release_rx) = mpsc::channel();
    let server = std::thread::spawn(move || {
        let (mut stream, _) = listener.accept().unwrap();
        let mut b = [0u8; 4096];
        assert!(stream.read(&mut b).unwrap() > 0);
        write!(
            stream,
            "HTTP/1.1 200 OK\r\nContent-Length: 100\r\nConnection: close\r\n\r\na"
        )
        .unwrap();
        stream.flush().unwrap();
        started_tx.send(()).unwrap();
        release_rx.recv().unwrap();
    });
    let dir = tempfile::tempdir().unwrap();
    let maps =
        Arc::new(chronoscope::wmts::TileService::new(dir.path().join("wmts-cache")).unwrap());
    let cancelled = Arc::new(AtomicBool::new(false));
    let flag = cancelled.clone();
    let (result_tx, result_rx) = mpsc::channel();
    let worker = std::thread::spawn(move || {
        result_tx
            .send(chronoscope::operation::with_context(
                chronoscope::operation::Context {
                    cancelled: flag,
                    progress: None,
                    scope: None,
                },
                || {
                    maps.fetch(
                        &format!("http://{address}/tile"),
                        1024,
                        Duration::from_secs(60),
                    )
                },
            ))
            .unwrap()
    });
    started_rx.recv_timeout(Duration::from_secs(5)).unwrap();
    cancelled.store(true, Ordering::Relaxed);
    let result = result_rx.recv_timeout(Duration::from_secs(1));
    release_tx.send(()).unwrap();
    assert!(result
        .expect("cancelled HTTP read did not stop")
        .unwrap_err()
        .starts_with("CANCELLED:"));
    worker.join().unwrap();
    server.join().unwrap();
}
#[test]
fn render_viewport_intersects_workspace_filters_instead_of_replacing_them() {
    let dir = tempfile::tempdir().unwrap();
    let mut event = chronoscope::demo::dataset().events.remove(0);
    event.lat = Some(43.);
    event.lon = Some(-79.);
    let e = Engine::new(
        Project::new(Dataset {
            name: "viewport".into(),
            events: vec![event],
        }),
        dir.path().into(),
    )
    .unwrap();
    e.invoke(
        "filter",
        json!({"filter":{"bounds":{"west":0,"south":0,"east":1,"north":1}}}),
    )
    .unwrap();
    assert_eq!(
        e.invoke("render_data", json!({"bounds":[-80,42,-78,44]}))
            .unwrap()["located_count"],
        0
    );
    let before = e.invoke("snapshot", json!({})).unwrap();
    assert!(e
        .invoke(
            "render_data",
            json!({"bounds":[-80,42,-78,44],"expected_revision":1})
        )
        .unwrap_err()
        .starts_with("CONFLICT:"));
    assert_eq!(e.invoke("snapshot", json!({})).unwrap(), before);
}
#[test]
fn recovery_reconciles_context_when_deletions_commit_after_its_checkpoint() {
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
        ("select", json!({"ids":["1"]})),
        ("save_group", json!({"name":"review"})),
        ("recovery_checkpoint", json!({})),
        ("delete", json!({})),
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
    let list = e.invoke("recovery_list", json!({})).unwrap();
    e.invoke(
        "recovery_restore",
        json!({"id":list["checkpoints"][0]["id"]}),
    )
    .unwrap();
    let snapshot = e.invoke("snapshot", json!({})).unwrap();
    assert_eq!(snapshot["count"], 191);
    assert_eq!(snapshot["groups"][0]["ids"], json!([]));
    assert_eq!(snapshot["selected_count"], 0);
    e.invoke("recovery_clear", json!({})).unwrap();
}

#[test]
fn preferences_dry_run_has_a_valid_output_contract_and_does_not_change_state() {
    let dir = tempfile::tempdir().unwrap();
    let e = Engine::new(Project::new(Dataset::default()), dir.path().into()).unwrap();
    let before = e.invoke("preferences", json!({})).unwrap();
    let mut preferences = before.clone();
    preferences["theme"] = json!("light");
    let result = e
        .invoke(
            "preferences",
            json!({"preferences":preferences,"dry_run":true}),
        )
        .unwrap();
    chronoscope::schema::validate_output("preferences", &result).unwrap();
    assert_eq!(e.invoke("preferences", json!({})).unwrap(), before);
}
#[test]
fn explicit_error_codes_are_not_reclassified_by_message_words() {
    use chronoscope::error::ErrorCode;
    for code in [
        ErrorCode::Conflict,
        ErrorCode::Cancelled,
        ErrorCode::ScopeDenied,
        ErrorCode::InvalidArgument,
        ErrorCode::NotFound,
        ErrorCode::ResourceLimit,
        ErrorCode::Unavailable,
        ErrorCode::OperationFailed,
    ] {
        assert_eq!(
            ErrorCode::classify(&format!(
                "{}: invalid missing limit interrupted",
                code.as_str()
            )),
            code
        );
    }
}
#[test]
fn nested_commands_are_validated_before_jobs_or_batches_start() {
    assert!(
        chronoscope::schema::validate("job_start", &json!({"command":"terrain_mesh"})).is_err()
    );
    assert!(chronoscope::schema::validate(
        "batch",
        &json!({"operations":[{"command":"save","args":{"path":"x"}}]})
    )
    .is_err());
    assert!(chronoscope::schema::validate(
        "batch",
        &json!({"operations":[{"command":"select","args":{"ids":[1]}}]})
    )
    .is_err());
    chronoscope::schema::validate(
        "batch",
        &json!({"operations":[{"command":"select","args":{"ids":["1"]}}]}),
    )
    .unwrap();
}

#[test]
fn every_advertised_mcp_output_schema_resolves_its_resource_definitions() {
    for tool in chronoscope::mcp::tools() {
        jsonschema::validator_for(&tool["outputSchema"])
            .unwrap_or_else(|e| panic!("{}: {e}", tool["name"]));
    }
}

#[test]
fn entity_selection_summary_is_exact_beyond_id_limits_and_tracks_edits() {
    let dir = tempfile::tempdir().unwrap();
    let template = chronoscope::demo::dataset().events.remove(0);
    let events = (0..21002)
        .map(|i| {
            let mut e = template.clone();
            e.id = i + 1;
            e.entity = if i < 21000 { "Atlas" } else { "Beacon" }.into();
            e
        })
        .collect();
    let engine = Engine::new(
        Project::new(Dataset {
            events,
            ..Dataset::default()
        }),
        dir.path().into(),
    )
    .unwrap();
    engine
        .invoke("select_query", json!({"filter":{},"mode":"replace"}))
        .unwrap();
    let snapshot = engine
        .invoke("snapshot", json!({"selection_limit":1}))
        .unwrap();
    assert_eq!(snapshot["selected"].as_array().unwrap().len(), 1);
    assert_eq!(
        snapshot["selected_entities"],
        json!({"Atlas":21000,"Beacon":2})
    );
    // List shading follows selection even for events hidden by a time/search filter.
    engine
        .invoke("filter", json!({"filter":{"search":"no-matching-event"}}))
        .unwrap();
    assert_eq!(
        engine.invoke("snapshot", json!({})).unwrap()["selected_entities"],
        snapshot["selected_entities"]
    );
    engine
        .invoke("edit", json!({"id":"21002","changes":{"entity":"Cedar"}}))
        .unwrap();
    assert_eq!(
        engine.invoke("snapshot", json!({})).unwrap()["selected_entities"],
        json!({"Atlas":21000,"Beacon":1,"Cedar":1})
    );
    engine.invoke("undo", json!({})).unwrap();
    assert_eq!(
        engine.invoke("snapshot", json!({})).unwrap()["selected_entities"],
        snapshot["selected_entities"]
    );
    engine.invoke("select", json!({"ids":[]})).unwrap();
    assert_eq!(
        engine.invoke("snapshot", json!({})).unwrap()["selected_entities"],
        json!({})
    );
}
