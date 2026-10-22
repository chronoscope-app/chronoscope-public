use chronoscope::{engine::Engine, mcp, model::*, project::Project, store::DataStore};
use serde_json::{json, Value};
fn engine() -> (tempfile::TempDir, Engine) {
    let dir = tempfile::tempdir().unwrap();
    let e = Engine::new(
        Project::new(chronoscope::demo::dataset()),
        dir.path().into(),
    )
    .unwrap();
    (dir, e)
}
fn revision(e: &Engine) -> u64 {
    e.invoke("revision", json!({})).unwrap()["revision"]
        .as_u64()
        .unwrap()
}
#[test]
fn enforced_nested_contracts_and_dry_run_never_delete() {
    let (_d, e) = engine();
    e.invoke("select", json!({"ids":["1","2"]})).unwrap();
    let r = revision(&e);
    for args in [json!("hello"), json!({"extra":true})] {
        assert!(e.invoke("snapshot", args).is_err())
    }
    assert!(e
        .invoke("filter", json!({"filter":{"selected_only":"yes"}}))
        .is_err());
    assert!(e
        .invoke("edit", json!({"id":"1","changes":{"attrs":{"x":"y"}}}))
        .is_err());
    assert!(e.invoke("delete", json!({"dry_run":"true"})).is_err());
    let result = e
        .invoke("delete", json!({"dry_run":true,"expected_revision":r}))
        .unwrap();
    assert_eq!(result["changed"], 2);
    assert_eq!(revision(&e), r);
    assert_eq!(e.invoke("snapshot", json!({})).unwrap()["count"], 192);
    assert_eq!(
        e.invoke("events", json!({"id":"1"})).unwrap()["events"][0]["id"],
        "1"
    );
}
#[test]
fn cas_and_retry_keys_prevent_duplicate_mutations() {
    let (_d, e) = engine();
    let r = revision(&e);
    let args = json!({"ids":["1"],"mode":"toggle","expected_revision":r,"idempotency_key":"op-a"});
    let a = e.invoke("select", args.clone()).unwrap();
    let b = e.invoke("select", args).unwrap();
    assert_eq!(a, b);
    assert_eq!(
        e.invoke("snapshot", json!({})).unwrap()["selected_count"],
        1
    );
    assert!(e
        .invoke("delete", json!({"expected_revision":r}))
        .unwrap_err()
        .starts_with("CONFLICT:"));
    assert!(e
        .invoke("select", json!({"ids":["2"],"idempotency_key":"op-a"}))
        .is_err());
}
#[test]
fn atomic_batch_rolls_back_partial_edits_and_has_one_undo() {
    let (_d, e) = engine();
    let original = e.invoke("events", json!({"id":"1"})).unwrap();
    let r = revision(&e);
    assert!(e.invoke("batch",json!({"operations":[{"command":"edit","args":{"id":"1","changes":{"label":"changed"}}},{"command":"edit","args":{"id":"99999999","changes":{"label":"bad"}}}]})).is_err());
    assert_eq!(revision(&e), r);
    assert_eq!(e.invoke("events", json!({"id":"1"})).unwrap(), original);
    let batch = json!({"operations":[{"command":"select","args":{"ids":["1"]}},{"command":"tag","args":{"value":"review"}},{"command":"edit","args":{"id":"1","changes":{"label":"changed"}}}]});
    e.invoke("batch", batch).unwrap();
    assert_eq!(revision(&e), r + 1);
    assert_eq!(
        e.invoke("events", json!({"id":"1"})).unwrap()["events"][0]["label"],
        "changed"
    );
    e.invoke("undo", json!({})).unwrap();
    assert_eq!(
        e.invoke("events", json!({"id":"1"})).unwrap()["events"],
        original["events"]
    );
    e.invoke("redo", json!({})).unwrap();
    assert_eq!(
        e.invoke("events", json!({"id":"1"})).unwrap()["events"][0]["label"],
        "changed"
    );
}
#[test]
fn cursor_is_bound_to_data_and_projection_is_bounded() {
    let (_d, e) = engine();
    let first = e
        .invoke(
            "query",
            json!({"limit":2,"fields":["id","entity"],"sort_by":"id"}),
        )
        .unwrap();
    assert_eq!(first["events"][0].as_object().unwrap().len(), 2);
    let next=e.invoke("query",json!({"limit":2,"fields":["id","entity"],"sort_by":"id","cursor":first["next_cursor"]})).unwrap();
    assert_ne!(first["events"][0]["id"], next["events"][0]["id"]);
    e.invoke("edit", json!({"id":"1","changes":{"note":"changed data"}}))
        .unwrap();
    assert!(e
        .invoke(
            "query",
            json!({"cursor":first["next_cursor"],"sort_by":"id"})
        )
        .is_err());
    assert!(e.invoke("query", json!({"limit":1001})).is_err());
}
#[test]
fn sqlite_filters_match_domain_semantics_including_unicode_and_non_numeric() {
    let dir = tempfile::tempdir().unwrap();
    let mut store = DataStore::new(dir.path()).unwrap();
    let mut events = chronoscope::demo::dataset().events;
    events[0].label = "Évidence 100%_\\".into();
    events[0].attrs.insert("reading".into(), "banana".into());
    events[1].attrs.insert("reading".into(), "-2".into());
    events[0].tags.insert("red".into());
    events[0].tags.insert("blue".into());
    store.load_events(events.clone()).unwrap();
    for f in [
        Filter {
            search: "éVID".into(),
            ..Default::default()
        },
        Filter {
            search: "100%_\\".into(),
            ..Default::default()
        },
        Filter {
            predicates: vec![Predicate {
                field: "reading".into(),
                op: Operator::Less,
                value: "0".into(),
            }],
            ..Default::default()
        },
        Filter {
            predicates: vec![Predicate {
                field: "tags".into(),
                op: Operator::Equals,
                value: "blue,red".into(),
            }],
            ..Default::default()
        },
    ] {
        let table = store.ordered(&f, None, "id", false).unwrap();
        let actual = store.ids(&table).unwrap();
        let expected: Vec<_> = events
            .iter()
            .filter(|e| f.matches(e, &Default::default()))
            .map(|e| e.id)
            .collect();
        assert_eq!(actual, expected);
    }
}
#[test]
fn portable_database_roundtrip_preserves_high_ids_and_rejects_wrong_format() {
    let dir = tempfile::tempdir().unwrap();
    let mut store = DataStore::new(dir.path()).unwrap();
    let mut event = chronoscope::demo::dataset().events[0].clone();
    event.id = u64::MAX;
    store.load_events([event.clone()]).unwrap();
    let mut metadata = Project::new(Dataset {
        name: "disk study".into(),
        events: vec![],
    });
    metadata.selected.insert(u64::MAX);
    store.set_selection(&metadata.selected).unwrap();
    let path = dir.path().join("study.chronoscope");
    store.save_as(&path, &metadata).unwrap();
    let (copy, p) = DataStore::open_copy(&path, dir.path()).unwrap();
    assert_eq!(copy.get(u64::MAX).unwrap(), Some(event));
    assert!(p.selected.contains(&u64::MAX));
    let e = Engine::from_path(&path, dir.path().join("app"), None).unwrap();
    assert_eq!(
        e.invoke("events", json!({"id":u64::MAX.to_string()}))
            .unwrap()["events"][0]["id"],
        u64::MAX.to_string()
    );
    assert_eq!(e.invoke("query",json!({"filter":{"predicates":[{"field":"id","op":"Greater","value":(u64::MAX-1).to_string()}]}})).unwrap()["count"],1);
    assert_eq!(
        e.invoke("snapshot", json!({})).unwrap()["selected_count"],
        1
    );
}
#[test]
fn database_embeds_terrain_without_original_file() {
    let dir = tempfile::tempdir().unwrap();
    let mut store = DataStore::new(dir.path()).unwrap();
    store
        .load_events(chronoscope::demo::dataset().events)
        .unwrap();
    let original = dir.path().join("source.dt0");
    std::fs::copy(
        std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("tests/fixtures/terrain/synthetic-n43.dt0"),
        &original,
    )
    .unwrap();
    let mut p = Project::new(Dataset::default());
    p.workspace = Some(chronoscope::project::WorkspaceSettings {
        preferences: Default::default(),
        terrain_files: vec![original.clone()],
    });
    let path = dir.path().join("terrain.chronoscope");
    store.save_as(&path, &p).unwrap();
    std::fs::remove_file(original).unwrap();
    let (_copy, p) = DataStore::open_copy(&path, dir.path()).unwrap();
    let loaded = chronoscope::terrain::TerrainCatalog::load(
        &p.workspace.unwrap().preferences.terrain_path.unwrap(),
    )
    .unwrap();
    assert_eq!(loaded.tiles.len(), 1);
}
#[test]
fn mcp_errors_are_structured_and_requests_are_validated() {
    let (dir, e) = engine();
    let root = dir.path().canonicalize().unwrap();
    for request in [
        json!({"id":1,"method":"ping"}),
        json!({"jsonrpc":"2.0","id":{},"method":"ping"}),
        json!({"jsonrpc":"2.0","id":1,"method":"ping","params":[]}),
    ] {
        assert_eq!(
            mcp::handle(&e, &root, request).unwrap()["error"]["code"],
            -32600
        )
    }
    let response=mcp::handle(&e,&root,json!({"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"chronoscope_delete","arguments":{"dry_run":"true"}}})).unwrap();
    assert_eq!(response["result"]["isError"], true);
    assert_eq!(
        response["result"]["structuredContent"]["error"]["code"],
        "INVALID_ARGUMENT"
    );
    assert!(e
        .invoke("view_capture", json!({}))
        .unwrap_err()
        .starts_with("UNAVAILABLE:"));
}
#[test]
fn oversized_protocol_line_does_not_poison_next_message() {
    use std::io::Cursor;
    let mut data = vec![b'x'; 4 * 1024 * 1024 + 1000];
    data.extend_from_slice(b"\n{\"ok\":true}\n");
    let mut input = Cursor::new(data);
    assert!(mcp::read_message(&mut input).is_err());
    let next: Value =
        serde_json::from_slice(&mcp::read_message(&mut input).unwrap().unwrap()).unwrap();
    assert_eq!(next["ok"], true);
    assert!(mcp::read_message(&mut input).unwrap().is_none());
}
#[test]
fn render_budget_does_not_limit_exact_queries_or_selection() {
    let dir = tempfile::tempdir().unwrap();
    let mut data = chronoscope::demo::dataset();
    let original = data.events[0].clone();
    data.events = (0..1500)
        .map(|i| {
            let mut e = original.clone();
            e.id = i + 1;
            e.time += (i as i64 * 60) as f64;
            e
        })
        .collect();
    let e = Engine::new(Project::new(data), dir.path().into()).unwrap();
    let render = e.invoke("render_data", json!({"max_points":100})).unwrap();
    assert_eq!(render["rendered_count"], 100);
    assert_eq!(render["located_count"], 1500);
    assert_eq!(render["lod"], true);
    assert_eq!(
        e.invoke("query", json!({"limit":1})).unwrap()["count"],
        1500
    );
    assert_eq!(
        e.invoke("select_query", json!({"filter":{}})).unwrap()["selected"],
        1500
    );
    assert_eq!(
        e.invoke("selection_contains", json!({"ids":["1500","1"]}))
            .unwrap()["selected"],
        json!(["1500", "1"])
    );
    let r = revision(&e);
    assert_eq!(revision(&e), r);
}
#[test]
fn live_agent_shares_engine_authenticates_and_respects_scope() {
    let (dir, e) = engine();
    let e = std::sync::Arc::new(e);
    let agent = chronoscope::agent::start(e.clone(), dir.path()).unwrap();
    let info = chronoscope::agent::read_connection(&agent.descriptor).unwrap();
    let selected =
        chronoscope::agent::invoke_remote(&info, "select", json!({"ids":["1","2"]})).unwrap();
    assert_eq!(selected["selected"], 2);
    assert_eq!(
        e.invoke("snapshot", json!({})).unwrap()["selected_count"],
        2
    );
    let mut wrong = info.clone();
    wrong.token = "0".repeat(64);
    assert!(chronoscope::agent::invoke_remote(&wrong, "snapshot", json!({})).is_err());
    assert!(
        chronoscope::agent::invoke_remote(&info, "open", json!({"path":"/etc/passwd"})).is_err()
    );
    let descriptor = agent.descriptor.clone();
    drop(agent);
    assert!(!descriptor.exists());
}
#[test]
fn cli_session_preserves_import_ticket_and_json_errors_have_stable_exit_codes() {
    use std::{
        io::Write,
        process::{Command, Stdio},
    };
    let dir = tempfile::tempdir().unwrap();
    let source = dir.path().join("rows.csv");
    std::fs::write(
        &source,
        "entity,timestamp,latitude,longitude\nOne,2025-01-01T01:02:59Z,38,-121\n",
    )
    .unwrap();
    let mut child = Command::new(env!("CARGO_BIN_EXE_chronoscope"))
        .args([
            "--demo-data",
            "--data-dir",
            dir.path().to_str().unwrap(),
            "session",
        ])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .unwrap();
    let mut input = child.stdin.take().unwrap();
    for request in [
        json!({"id":1,"command":"import_preview","args":{"path":source}}),
        json!({"id":2,"command":"import_commit"}),
        json!({"id":3,"command":"snapshot"}),
    ] {
        writeln!(input, "{request}").unwrap();
    }
    drop(input);
    let result = child.wait_with_output().unwrap();
    assert!(
        result.status.success(),
        "{}",
        String::from_utf8_lossy(&result.stderr)
    );
    let lines: Vec<Value> = String::from_utf8(result.stdout)
        .unwrap()
        .lines()
        .map(|l| serde_json::from_str(l).unwrap())
        .collect();
    assert_eq!(lines[1]["result"]["accepted"], 1);
    assert_eq!(lines[2]["result"]["count"], 1);
    let result = Command::new(env!("CARGO_BIN_EXE_chronoscope"))
        .args([
            "--data-dir",
            dir.path().to_str().unwrap(),
            "--json",
            "call",
            "delete",
            "--args",
            "{\"dry_run\":\"true\"}",
        ])
        .output()
        .unwrap();
    assert_eq!(result.status.code(), Some(2));
    let value: Value = serde_json::from_slice(&result.stdout).unwrap();
    assert_eq!(value["error"]["code"], "INVALID_ARGUMENT");
}
#[test]
fn preview_tickets_detect_file_changes_and_do_not_cross_imports() {
    let (dir, e) = engine();
    let a = dir.path().join("a.csv");
    let b = dir.path().join("b.csv");
    std::fs::write(&a, "entity,timestamp\nA,2025-01-01\n").unwrap();
    std::fs::write(&b, "entity,timestamp\nB,2025-01-02\n").unwrap();
    let pa = e.invoke("import_preview", json!({"path":a})).unwrap();
    e.invoke("import_preview", json!({"path":b})).unwrap();
    e.invoke("import_commit", json!({"import_id":pa["import_id"]}))
        .unwrap();
    assert_eq!(
        e.invoke("events", json!({"id":"1"})).unwrap()["events"][0]["entity"],
        "A"
    );
    let p = e.invoke("import_preview", json!({"path":a})).unwrap();
    std::fs::write(&a, "entity,timestamp\nChanged,2025-01-01\n").unwrap();
    assert!(e
        .invoke("import_commit", json!({"import_id":p["import_id"]}))
        .is_err());
}
#[test]
fn cooperative_cancel_rolls_back_and_keeps_workspace_usable() {
    use std::sync::{atomic::AtomicBool, Arc};
    let (_dir, e) = engine();
    let cancelled = Arc::new(AtomicBool::new(true));
    let error = chronoscope::operation::with_context(
        chronoscope::operation::Context {
            cancelled,
            progress: None,
            scope: None,
        },
        || e.invoke("delete", json!({})),
    )
    .unwrap_err();
    assert!(error.starts_with("CANCELLED:"));
    assert_eq!(e.invoke("snapshot", json!({})).unwrap()["count"], 192);
}
#[test]
fn scene_capture_returns_real_gui_response_and_standalone_is_explicit() {
    let (_dir, e) = engine();
    let e = std::sync::Arc::new(e);
    let callback = e.clone();
    e.set_observer(std::sync::Arc::new(move|event|{if event["kind"]=="capture"{callback.invoke("view_response",json!({"request_id":event["request_id"],"data_url":"data:image/png;base64,aGVsbG8="})).unwrap();}})).unwrap();
    let capture = e.invoke("view_capture", json!({})).unwrap();
    assert_eq!(capture["mime_type"], "image/png");
}
#[test]
fn real_stdio_progress_cancellation_interrupts_import_and_ping_recovers() {
    use std::{
        io::{BufRead, BufReader, Write},
        process::{Command, Stdio},
    };
    let dir = tempfile::tempdir().unwrap();
    let csv = dir.path().join("cancel.csv");
    let mut rows = std::io::BufWriter::new(std::fs::File::create(&csv).unwrap());
    writeln!(rows, "entity,timestamp,latitude,longitude").unwrap();
    for _ in 0..100000 {
        writeln!(rows, "One,2025-01-01T00:00:00Z,35,-120").unwrap();
    }
    rows.flush().unwrap();
    let mut child = Command::new(env!("CARGO_BIN_EXE_chronoscope"))
        .args([
            "--data-dir",
            dir.path().to_str().unwrap(),
            "mcp",
            "--root",
            dir.path().to_str().unwrap(),
        ])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .unwrap();
    let mut input = child.stdin.take().unwrap();
    let mut output = BufReader::new(child.stdout.take().unwrap());
    writeln!(input,"{}",json!({"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18"}})).unwrap();
    input.flush().unwrap();
    let mut line = String::new();
    output.read_line(&mut line).unwrap();
    assert!(serde_json::from_str::<Value>(&line)
        .unwrap()
        .get("result")
        .is_some());
    writeln!(input,"{}",json!({"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"chronoscope_import_preview","arguments":{"path":csv},"_meta":{"progressToken":"import-progress"}}})).unwrap();
    input.flush().unwrap();
    loop {
        line.clear();
        assert!(output.read_line(&mut line).unwrap() > 0);
        let message: Value = serde_json::from_str(&line).unwrap();
        if message["method"] == "notifications/progress" {
            assert_eq!(message["params"]["progressToken"], "import-progress");
            break;
        }
    }
    writeln!(input,"{}",json!({"jsonrpc":"2.0","method":"notifications/cancelled","params":{"requestId":2,"reason":"Test cancellation"}})).unwrap();
    input.flush().unwrap();
    loop {
        line.clear();
        assert!(output.read_line(&mut line).unwrap() > 0);
        let message: Value = serde_json::from_str(&line).unwrap();
        if message["id"] == 2 {
            assert_eq!(
                message["result"]["structuredContent"]["error"]["code"],
                "CANCELLED"
            );
            break;
        }
    }
    writeln!(input, "{}", json!({"jsonrpc":"2.0","id":3,"method":"ping"})).unwrap();
    input.flush().unwrap();
    line.clear();
    output.read_line(&mut line).unwrap();
    assert_eq!(serde_json::from_str::<Value>(&line).unwrap()["id"], 3);
    drop(input);
    assert!(child.wait().unwrap().success());
}
#[test]
fn advertised_output_schemas_match_actual_success_payloads() {
    let (_dir, e) = engine();
    for (command, args) in [
        ("snapshot", json!({"compact":true})),
        ("query", json!({"limit":2,"fields":["id"]})),
        ("aggregate", json!({})),
        ("analyze", json!({"pattern":"Speed"})),
        ("render_data", json!({"max_points":100})),
        ("selection_contains", json!({"ids":["1"]})),
    ] {
        let value = e.invoke(command, args).unwrap();
        let validator =
            jsonschema::validator_for(&chronoscope::schema::output_schema(command)).unwrap();
        assert!(
            validator.is_valid(&value),
            "{command}: {}",
            validator
                .iter_errors(&value)
                .map(|e| e.to_string())
                .collect::<Vec<_>>()
                .join(",")
        );
    }
}
#[test]
fn snapshot_contract_preserves_fractional_earthquake_timestamps() {
    let dir = tempfile::tempdir().unwrap();
    let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("samples/usgs-global-earthquakes-2025-01.chronoscope");
    let project = chronoscope::project::load_with_resources(&path, dir.path()).unwrap();
    let e = Engine::new(project, dir.path().into()).unwrap();
    for compact in [true, false] {
        let value = e.invoke("snapshot", json!({"compact":compact})).unwrap();
        assert_eq!(value["count"], 652);
        assert_eq!(
            value["time_bounds"],
            json!([1735696019.538, 1738367859.481])
        );
        chronoscope::schema::validate_output("snapshot", &value).unwrap();
    }
}
#[test]
fn saved_terrain_canonical_paths_work_through_symlinked_data_directory() {
    #[cfg(unix)]
    {
        let root = tempfile::tempdir().unwrap();
        let actual = root.path().join("actual");
        std::fs::create_dir(&actual).unwrap();
        let alias = root.path().join("alias");
        std::os::unix::fs::symlink(&actual, &alias).unwrap();
        let source = root.path().join("n43.dt0");
        std::fs::copy(
            std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
                .join("tests/fixtures/terrain/synthetic-n43.dt0"),
            &source,
        )
        .unwrap();
        let engine = Engine::new(
            Project::new(chronoscope::demo::dataset()),
            actual.join("sender"),
        )
        .unwrap();
        engine
            .invoke("terrain_load", json!({"path":source}))
            .unwrap();
        let workspace = root.path().join("terrain.chronoscope");
        engine.invoke("save", json!({"path":workspace})).unwrap();
        let p = chronoscope::project::load_with_resources(&workspace, &alias).unwrap();
        let receiving = Engine::new_with_terrain_scope(p, alias, Some(root.path())).unwrap();
        assert!(receiving.invoke("terrain_info", json!({})).unwrap()["tiles"].is_array());
    }
}
#[test]
fn asynchronous_jobs_report_completion_and_scope_without_blocking_status() {
    let (_dir, e) = engine();
    let started = e
        .invoke(
            "job_start",
            json!({"command":"aggregate","arguments":{"group_by":"category"}}),
        )
        .unwrap();
    let id = started["job_id"].clone();
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(5);
    loop {
        let status = e.invoke("job_status", json!({"job_id":id})).unwrap();
        if status["status"] == "completed" {
            break;
        }
        assert!(std::time::Instant::now() < deadline, "{status}");
        std::thread::sleep(std::time::Duration::from_millis(5));
    }
    let result = e.invoke("job_result", json!({"job_id":id})).unwrap();
    assert!(result["result"]["groups"].is_array());
    e.invoke("job_release", json!({"job_id":id})).unwrap();
    assert!(e.invoke("job_status", json!({"job_id":id})).is_err());
    assert!(e.invoke("job_start", json!({"command":"delete"})).is_err());
}
#[test]
fn nested_job_arguments_cannot_escape_mcp_scope() {
    let (dir, e) = engine();
    let root = dir.path().canonicalize().unwrap();
    let outside = tempfile::tempdir().unwrap();
    let file = outside.path().join("outside.csv");
    std::fs::write(&file, "entity,timestamp\nA,2025-01-01\n").unwrap();
    let request = json!({"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"chronoscope_job_start","arguments":{"command":"import_preview","arguments":{"path":file}}}});
    let response = mcp::handle(&e, &root, request).unwrap();
    assert_eq!(
        response["result"]["structuredContent"]["error"]["code"],
        "SCOPE_DENIED"
    );
}
#[test]
fn selection_and_filter_navigation_do_not_consume_data_undo() {
    let (_dir, e) = engine();
    e.invoke("select", json!({"ids":["1"]})).unwrap();
    e.invoke("delete", json!({})).unwrap();
    e.invoke("select", json!({"ids":[]})).unwrap();
    e.invoke("filter", json!({"filter":{}})).unwrap();
    e.invoke("undo", json!({})).unwrap();
    assert_eq!(e.invoke("snapshot", json!({})).unwrap()["count"], 192);
}
#[test]
fn cancellation_inside_sql_write_never_leaves_partial_tags() {
    use std::sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    };
    let dir = tempfile::tempdir().unwrap();
    let template = chronoscope::demo::dataset().events[0].clone();
    let events = (1..=2000)
        .map(|id| {
            let mut e = template.clone();
            e.id = id;
            e
        })
        .collect();
    let e = Engine::new(
        Project::new(Dataset {
            name: "Cancel write".into(),
            events,
        }),
        dir.path().into(),
    )
    .unwrap();
    e.invoke("select_visible", json!({})).unwrap();
    let revision_before = revision(&e);
    let cancelled = Arc::new(AtomicBool::new(false));
    let signal = cancelled.clone();
    let result = chronoscope::operation::with_context(
        chronoscope::operation::Context {
            cancelled,
            scope: None,
            progress: Some(Arc::new(move |_, _, _| {
                signal.store(true, Ordering::Relaxed);
            })),
        },
        || e.invoke("tag", json!({"value":"must-rollback"})),
    );
    assert!(result.is_err());
    assert_eq!(revision(&e), revision_before);
    let filtered=e.invoke("query",json!({"filter":{"predicates":[{"field":"tags","op":"Contains","value":"must-rollback"}]},"limit":1})).unwrap();
    assert_eq!(filtered["count"], 0);
    assert_eq!(
        e.invoke("snapshot", json!({})).unwrap()["selected_count"],
        2000
    );
}
#[test]
fn portable_database_excludes_unsaved_history_and_removed_payloads() {
    let dir = tempfile::tempdir().unwrap();
    let mut store = DataStore::new(dir.path()).unwrap();
    let mut event = chronoscope::demo::dataset().events[0].clone();
    let marker = "removed-payload-secret-chronoscope-05-unit";
    event.note = marker.into();
    store.load_events([event]).unwrap();
    store.connection.execute_batch("SAVEPOINT edit").unwrap();
    let seq = store.begin_history().unwrap();
    store.delete(1).unwrap();
    store.end_history(seq).unwrap();
    store.connection.execute_batch("RELEASE edit").unwrap();
    let path = dir.path().join("clean.chronoscope");
    store
        .save_as(&path, &Project::new(Dataset::default()))
        .unwrap();
    let bytes = std::fs::read(&path).unwrap();
    assert!(!bytes.windows(marker.len()).any(|v| v == marker.as_bytes()));
    let sqlite = rusqlite::Connection::open(&path).unwrap();
    let rows: u64 = sqlite
        .query_row("SELECT count(*) FROM history_rows", [], |r| r.get(0))
        .unwrap();
    assert_eq!(rows, 0);
    drop(sqlite);
    store.replay_history(seq, true).unwrap();
    assert_eq!(store.get(1).unwrap().unwrap().note, marker);
}
#[test]
fn altered_database_payload_is_rejected_before_rendering() {
    let dir = tempfile::tempdir().unwrap();
    let mut store = DataStore::new(dir.path()).unwrap();
    store
        .load_events(chronoscope::demo::dataset().events)
        .unwrap();
    let path = dir.path().join("altered.chronoscope");
    store
        .save_as(&path, &Project::new(Dataset::default()))
        .unwrap();
    let sqlite = rusqlite::Connection::open(&path).unwrap();
    sqlite
        .execute(
            "UPDATE events SET payload=json_set(payload,'$.lat',100) WHERE id='1'",
            [],
        )
        .unwrap();
    drop(sqlite);
    assert!(DataStore::open_copy(&path, dir.path()).is_err());
}
#[test]
fn misplaced_mutation_controls_are_rejected_instead_of_ignored() {
    let (dir, e) = engine();
    e.invoke("select", json!({"ids":["1"]})).unwrap();
    let root = dir.path().canonicalize().unwrap();
    for request in [
        json!({"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"chronoscope_delete","arguments":{},"dry_run":true}}),
        json!({"jsonrpc":"2.0","id":2,"method":"tools/call","dry_run":true,"params":{"name":"chronoscope_delete","arguments":{}}}),
    ] {
        assert!(mcp::handle(&e, &root, request)
            .unwrap()
            .get("error")
            .is_some());
    }
    assert_eq!(e.invoke("snapshot", json!({})).unwrap()["count"], 192);
}
#[test]
fn streaming_csv_handles_literal_quotes_and_bounds_multiline_records() {
    let (dir, e) = engine();
    let path = dir.path().join("quotes.csv");
    let mut data = String::from("entity,timestamp,label\nOne,2025-01-01,5\" height\n");
    for _ in 0..50000 {
        data.push_str("One,2025-01-01,ordinary description\n")
    }
    std::fs::write(&path, data).unwrap();
    let preview = e.invoke("import_preview", json!({"path":path})).unwrap();
    assert_eq!(preview["sheets"][0]["count"], 50001);
    let malicious = dir.path().join("multiline.csv");
    let mut file = std::fs::File::create(&malicious).unwrap();
    use std::io::Write;
    file.write_all(b"\xef\xbb\xbfentity,timestamp,label\nOne,2025-01-01,\"")
        .unwrap();
    for _ in 0..20000 {
        file.write_all(b"long multiline payload long multiline payload long multiline payload\n")
            .unwrap();
    }
    file.write_all(b"\"\n").unwrap();
    assert!(e
        .invoke("import_preview", json!({"path":malicious}))
        .is_err());
}
#[test]
fn large_visibility_filters_keep_small_cursors_and_canonical_predicates() {
    let dir = tempfile::tempdir().unwrap();
    let mut template = chronoscope::demo::dataset().events[0].clone();
    template.time = 1735689600.0;
    template.lat = Some(40.);
    template.lon = Some(-73.);
    template.value = Some(7.);
    template.attrs.insert("value".into(), "900".into());
    let events = (1..=3)
        .map(|id| {
            let mut event = template.clone();
            event.id = id;
            event.time += ((id - 1) as i64 * 60) as f64;
            event
        })
        .collect();
    let e = Engine::new(
        Project::new(Dataset {
            name: "namespaces".into(),
            events,
        }),
        dir.path().into(),
    )
    .unwrap();
    let hidden: Vec<_> = (0..2000)
        .map(|i| format!("An unrelated hidden entity {i}"))
        .collect();
    let mut args = json!({"filter":{"hidden_entities":hidden,"start":1735689601,"predicates":[{"field":"lat","op":"Greater","value":"0"}]},"limit":1,"fields":["id"]});
    let first = e.invoke("query", args.clone()).unwrap();
    assert_eq!(first["count"], 2);
    assert!(first["next_cursor"].as_str().unwrap().len() < 256);
    args["cursor"] = first["next_cursor"].clone();
    let next = e.invoke("query", args).unwrap();
    assert_eq!(next["events"][0]["id"], "3");
    let canonical = e
        .invoke(
            "query",
            json!({"filter":{"predicates":[{"field":"value","op":"Greater","value":"100"}]}}),
        )
        .unwrap();
    let original=e.invoke("query",json!({"filter":{"predicates":[{"field":"attribute:value","op":"Greater","value":"100"}]}})).unwrap();
    let equal = e
        .invoke(
            "query",
            json!({"filter":{"predicates":[{"field":"value","op":"Equals","value":"7.00"}]}}),
        )
        .unwrap();
    assert_eq!(equal["count"], 3);
    assert_eq!(canonical["count"], 0);
    assert_eq!(original["count"], 3);
}
#[test]
fn selected_evidence_omitted_by_lod_is_brought_into_the_render_packet() {
    let dir = tempfile::tempdir().unwrap();
    let template = chronoscope::demo::dataset().events[0].clone();
    let events = (1..=1500)
        .map(|id| {
            let mut e = template.clone();
            e.id = id;
            e.time += (id as i64 * 60) as f64;
            e
        })
        .collect();
    let e = Engine::new(
        Project::new(Dataset {
            name: "Evidence LOD".into(),
            events,
        }),
        dir.path().into(),
    )
    .unwrap();
    let packet = e.invoke("render_data", json!({"max_points":100})).unwrap();
    let omitted = (1..=1500)
        .map(|id| id.to_string())
        .find(|id| !packet["ids"].as_array().unwrap().contains(&json!(id)))
        .unwrap();
    e.invoke("select", json!({"ids":[omitted]})).unwrap();
    let updated = e.invoke("render_data", json!({"max_points":100})).unwrap();
    assert!(updated["ids"].as_array().unwrap().contains(&json!(omitted)));
    assert!(updated["ids"].as_array().unwrap().len() <= 100);
    assert_eq!(updated["located_count"], 1500);
}
#[test]
fn scoped_domain_writes_cannot_overwrite_unrelated_control_files() {
    let (dir, e) = engine();
    let root = dir.path().canonicalize().unwrap();
    let path = root.join("startup.sh");
    std::fs::write(&path, "keep this file intact").unwrap();
    let response=mcp::handle(&e,&root,json!({"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"chronoscope_save","arguments":{"path":path,"overwrite":true}}})).unwrap();
    assert_eq!(response["result"]["isError"], true);
    assert_eq!(
        std::fs::read_to_string(path).unwrap(),
        "keep this file intact"
    );
}
