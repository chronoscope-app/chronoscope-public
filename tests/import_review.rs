use chronoscope::{engine::Engine, project::Project};
use serde_json::{json, Value};

fn preview(e: &Engine, path: &std::path::Path) -> Value {
    let p = e.invoke("import_preview", json!({"path":path})).unwrap();
    json!({"import_id":p["import_id"],"sheet":0,"mapping":p["sheets"][0]["mapping"]})
}

fn scoped_tool(e: &Engine, root: &std::path::Path, command: &str, args: Value) -> Value {
    chronoscope::mcp::handle(
        e,
        root,
        json!({
            "jsonrpc":"2.0","id":1,"method":"tools/call",
            "params":{"name":format!("chronoscope_{command}"),"arguments":args}
        }),
    )
    .unwrap()["result"]
        .clone()
}

#[test]
fn streaming_ticket_rechecks_current_root_for_validation_review_and_commit() {
    let dir = tempfile::tempdir().unwrap();
    let narrow = dir.path().join("narrow");
    std::fs::create_dir(&narrow).unwrap();
    std::fs::write(
        dir.path().join("data.csv"),
        "entity,timestamp,latitude,longitude,value\nA,2026-10-01T12:00:00Z,40,-70,3\n",
    )
    .unwrap();
    let e = Engine::new(Project::empty(), dir.path().join("profile")).unwrap();
    let p = scoped_tool(&e, dir.path(), "import_preview", json!({"path":"data.csv"}));
    let p = &p["structuredContent"];
    let args = json!({"import_id":p["import_id"],"sheet":0,"mapping":p["sheets"][0]["mapping"]});
    let before = e.invoke("snapshot", json!({"compact":true})).unwrap();
    for command in ["import_validate", "import_review", "import_commit"] {
        let denied = scoped_tool(&e, &narrow, command, args.clone());
        assert_eq!(denied["isError"], true, "{command}: {denied}");
        assert!(denied.to_string().contains("outside the MCP --root scope"));
        assert_eq!(
            e.invoke("snapshot", json!({"compact":true})).unwrap(),
            before
        );
    }
    let allowed = scoped_tool(&e, dir.path(), "import_commit", args);
    assert_ne!(allowed["isError"], true, "{allowed}");
    assert_eq!(
        e.invoke("snapshot", json!({"compact":true})).unwrap()["count"],
        1
    );
}

#[test]
fn gui_streaming_ticket_cannot_escape_background_job_root() {
    let dir = tempfile::tempdir().unwrap();
    let narrow = dir.path().join("narrow");
    std::fs::create_dir(&narrow).unwrap();
    let path = dir.path().join("data.csv");
    std::fs::write(
        &path,
        "entity,timestamp,latitude,longitude,value\nA,2026-10-01T12:00:00Z,40,-70,3\n",
    )
    .unwrap();
    let e = Engine::new(Project::empty(), dir.path().join("profile")).unwrap();
    let args = preview(&e, &path);
    for (root, expected) in [
        (&narrow, "failed"),
        (&dir.path().to_path_buf(), "completed"),
    ] {
        let job = scoped_tool(
            &e,
            root,
            "job_start",
            json!({"command":"import_commit","arguments":args}),
        );
        let job_id = job["structuredContent"]["job_id"].clone();
        assert!(job_id.is_string(), "{job}");
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(5);
        let result = loop {
            let result = scoped_tool(&e, root, "job_result", json!({"job_id":job_id}));
            let status = result["structuredContent"]["status"]
                .as_str()
                .unwrap()
                .to_owned();
            if !["queued", "running"].contains(&status.as_str()) {
                break result["structuredContent"].clone();
            }
            assert!(std::time::Instant::now() < deadline, "job did not finish");
            std::thread::sleep(std::time::Duration::from_millis(10));
        };
        assert_eq!(result["status"], expected, "{result}");
        if expected == "failed" {
            assert!(result["error"]["message"]
                .as_str()
                .unwrap()
                .contains("outside the MCP --root scope"));
            assert_eq!(
                e.invoke("snapshot", json!({"compact":true})).unwrap()["count"],
                0
            );
        }
    }
    assert_eq!(
        e.invoke("snapshot", json!({"compact":true})).unwrap()["count"],
        1
    );
}

#[test]
fn full_review_and_complete_rejection_export_leave_the_workspace_unchanged() {
    let dir = tempfile::tempdir().unwrap();
    let e = Engine::new(Project::empty(), dir.path().join("profile")).unwrap();
    let path = dir.path().join("=source.csv");
    let mut csv = "entity,timestamp,latitude,longitude,value\n".to_string();
    csv.push_str("A,2026-10-01T12:00:00Z,40,-70,3\nA,2026-10-01T12:00:00Z,40,-70,3\nB,2026-10-02T12:00:00Z,,,4\n");
    for _ in 0..1501 {
        csv.push_str("Invalid,2026-10-02T12:00:00Z,95,-70,5\n");
    }
    std::fs::write(&path, csv).unwrap();
    let args = preview(&e, &path);
    let before = e.invoke("snapshot", json!({"compact":true})).unwrap();
    let report = e.invoke("import_review", args.clone()).unwrap();
    chronoscope::schema::validate_output("import_review", &report).unwrap();
    assert_eq!(report["accepted"], 3);
    assert_eq!(report["rejected"], 1501);
    assert_eq!(report["missing_locations"], 1);
    assert_eq!(report["duplicate_candidates"], 1);
    assert_eq!(report["reasons_limited"], true);
    assert_eq!(
        e.invoke("snapshot", json!({"compact":true})).unwrap(),
        before
    );

    let out = dir.path().join("rejections.csv");
    let mut export = args.clone();
    export["path"] = json!(out);
    let exported = e
        .invoke("import_rejections_export", export.clone())
        .unwrap();
    assert_eq!(exported["exported"], 1501);
    let mut reader = csv::Reader::from_path(&out).unwrap();
    let rows = reader.records().collect::<Result<Vec<_>, _>>().unwrap();
    assert_eq!(rows.len(), 1501);
    assert_eq!(&rows[0][0], "'=source.csv");
    assert_eq!(&rows[0][2], "5");
    assert_eq!(&rows[0][4], "Invalid");
    assert_eq!(&rows[0][6], "95");
    assert_eq!(&rows[1500][2], "1505");
    assert!(e
        .invoke("import_rejections_export", export.clone())
        .unwrap_err()
        .contains("exists"));
    export["path"] = json!(path);
    export["overwrite"] = json!(true);
    assert!(e
        .invoke("import_rejections_export", export)
        .unwrap_err()
        .contains("source"));
    let mut commit = args;
    commit["accept_rejected"] = json!(true);
    e.invoke("import_commit", commit).unwrap();
    assert_eq!(
        e.invoke("snapshot", json!({"compact":true})).unwrap()["count"],
        3
    );
}

#[test]
fn reviews_reject_changed_sources_and_scoped_exports_cannot_escape() {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path().join("root");
    std::fs::create_dir(&root).unwrap();
    let root = root.canonicalize().unwrap();
    let e = Engine::new(Project::empty(), dir.path().join("profile")).unwrap();
    let path = root.join("source.csv");
    std::fs::write(&path, "entity,timestamp\nA,not a date\n").unwrap();
    let args = preview(&e, &path);
    let mut export = args.clone();
    export["path"] = json!(dir.path().join("outside.csv"));
    let scoped = |args: Value| {
        chronoscope::operation::with_context(
            chronoscope::operation::Context {
                cancelled: std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false)),
                progress: None,
                scope: Some(root.clone()),
            },
            || e.invoke("import_rejections_export", args),
        )
    };
    assert!(scoped(export.clone()).is_err());
    export["path"] = json!(root.join("inside.csv"));
    let mut dry = export.clone();
    dry["dry_run"] = json!(true);
    assert_eq!(scoped(dry).unwrap()["plan"]["overwrite"], false);
    std::fs::write(&path, "entity,timestamp\nA,2026-10-01T12:00:00Z\n").unwrap();
    assert!(e
        .invoke("import_review", args)
        .unwrap_err()
        .contains("changed"));
    assert!(e.invoke("import_rejections_export", export).is_err());
    assert!(!root.join("inside.csv").exists());
}

#[test]
fn cancelling_review_preserves_data_and_does_not_publish_a_partial_report() {
    use std::sync::{atomic::AtomicBool, Arc};
    let dir = tempfile::tempdir().unwrap();
    let e = Engine::new(Project::empty(), dir.path().join("profile")).unwrap();
    let path = dir.path().join("source.csv");
    std::fs::write(&path, "entity,timestamp\nA,bad\n").unwrap();
    let mut args = preview(&e, &path);
    let out = dir.path().join("report.csv");
    args["path"] = json!(out);
    let error = chronoscope::operation::with_context(
        chronoscope::operation::Context {
            cancelled: Arc::new(AtomicBool::new(true)),
            progress: None,
            scope: None,
        },
        || e.invoke("import_rejections_export", args),
    )
    .unwrap_err();
    assert!(error.contains("CANCELLED"));
    assert!(!out.exists());
    assert_eq!(
        e.invoke("snapshot", json!({"compact":true})).unwrap()["count"],
        0
    );
}

#[test]
fn a_late_export_cancellation_reports_the_committed_file_honestly() {
    use std::sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    };
    let dir = tempfile::tempdir().unwrap();
    let e = Engine::new(Project::empty(), dir.path().join("profile")).unwrap();
    let source = dir.path().join("source.csv");
    std::fs::write(&source, "entity,timestamp\nA,bad\n").unwrap();
    let mut args = preview(&e, &source);
    let output = dir.path().join("report.csv");
    args["path"] = json!(output);
    let cancelled = Arc::new(AtomicBool::new(false));
    let flag = cancelled.clone();
    let report = chronoscope::operation::with_context(
        chronoscope::operation::Context {
            cancelled,
            progress: Some(Arc::new(move |_, _, message| {
                if message == "Committed external file" {
                    flag.store(true, Ordering::Relaxed);
                }
            })),
            scope: None,
        },
        || e.invoke("import_rejections_export", args),
    )
    .unwrap();
    assert!(output.is_file());
    assert_eq!(report["commit_receipt"]["committed"], true);
    assert_eq!(report["commit_receipt"]["cancel_requested"], true);
    assert_eq!(report["commit_receipt"]["kind"], "external_file");
}

#[test]
fn empty_geometry_is_reported_as_unlocated_but_real_shapes_have_a_location() {
    let dir = tempfile::tempdir().unwrap();
    let e = Engine::new(Project::empty(), dir.path().join("profile")).unwrap();
    let source = dir.path().join("shapes.csv");
    std::fs::write(
        &source,
        "entity,timestamp,geometry_wkt\nA,2026-10-01,POINT EMPTY\nB,2026-10-01,POINT (10 20)\n",
    )
    .unwrap();
    let report = e.invoke("import_review", preview(&e, &source)).unwrap();
    assert_eq!(report["accepted"], 2);
    assert_eq!(report["missing_locations"], 1);
}

#[test]
fn interactive_field_feedback_is_bounded_read_only_and_preserves_legacy_validation_errors() {
    let dir = tempfile::tempdir().unwrap();
    let e = Engine::new(Project::empty(), dir.path().join("profile")).unwrap();
    let path = dir.path().join("source.csv");
    let mut csv = "entity,timestamp,latitude,mystery,value\n".to_string();
    for _ in 0..8 {
        csv.push_str("A,03/04/2026,40,-70,2\n");
    }
    csv.push_str("B,2026-10-01,40,-70,bad\n");
    std::fs::write(&path, csv).unwrap();
    let mut args = preview(&e, &path);
    assert!(e.invoke("import_validate", args.clone()).is_err());
    args["field_feedback"] = json!(true);
    let result = e.invoke("import_validate", args.clone()).unwrap();
    chronoscope::schema::validate_output("import_validate", &result).unwrap();
    assert!(result["error"]
        .as_str()
        .unwrap()
        .contains("both coordinate"));
    assert_eq!(result["fields"]["time"]["state"], "invalid");
    assert_eq!(result["fields"]["lat"]["state"], "valid");
    assert_eq!(result["fields"]["lon"]["state"], "invalid");
    assert_eq!(result["fields"]["value"]["state"], "valid");
    args["mapping"]["lon"] = json!(3);
    args["mapping"]["date_order"] = json!("dmy");
    let result = e.invoke("import_validate", args.clone()).unwrap();
    assert_eq!(result["events"].as_array().unwrap().len(), 6);
    assert_eq!(result["fields"]["time"]["state"], "valid");
    assert_eq!(result["fields"]["lon"]["state"], "valid");
    args.as_object_mut().unwrap().remove("field_feedback");
    let report = e.invoke("import_review", args).unwrap();
    assert_eq!(report["rejected"], 1);
    assert_eq!(
        e.invoke("snapshot", json!({"compact":true})).unwrap()["count"],
        0
    );
}
