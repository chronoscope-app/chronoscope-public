use chronoscope::{engine::Engine, project::Project};
use serde_json::{json, Value};

fn preview(e: &Engine, path: &std::path::Path) -> Value {
    let p = e.invoke("import_preview", json!({"path":path})).unwrap();
    json!({"import_id":p["import_id"],"sheet":0,"mapping":p["sheets"][0]["mapping"]})
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
