use chronoscope::{
    engine::Engine,
    project::{self, Project},
};
use serde_json::json;

#[test]
fn black_rock_credit_survives_portable_json_zip_and_csv_exports() {
    let dir = tempfile::tempdir().unwrap();
    let p = chronoscope::demos::load("local-wildlife", dir.path()).unwrap();
    assert_eq!(p.dataset.events.len(), 3439);
    let credit = p.provenance.clone();
    assert_eq!(credit.len(), 1);
    assert_eq!(credit[0].creator, "Scott LaPoint (2026)");
    assert_eq!(credit[0].license, "CC BY 4.0");
    assert!(credit[0].source_url.ends_with("10.5441/001/1.652"));
    assert!(credit[0].changes.contains("no thinning"));
    for extension in ["json", "chronoscope"] {
        let path = dir.path().join(format!("copy.{extension}"));
        project::save(&path, &p).unwrap();
        assert_eq!(
            project::load_with_resources(&path, dir.path())
                .unwrap()
                .provenance,
            credit
        );
    }
    let engine = Engine::new(p, dir.path().into()).unwrap();
    let path = dir.path().join("subset.csv");
    let out = engine.invoke("export", json!({"path":path})).unwrap();
    assert_eq!(out["exported"], 3439);
    chronoscope::schema::validate_output("export", &out).unwrap();
    let protected = dir.path().join("protected.csv");
    std::fs::write(
        format!("{}.attribution.json", protected.display()),
        b"existing credit",
    )
    .unwrap();
    assert!(engine
        .invoke("export", json!({"path":protected,"overwrite":false}))
        .is_err());
    assert!(!protected.exists());
    let text = std::fs::read_to_string(out["attribution"].as_str().unwrap()).unwrap();
    assert_eq!(
        serde_json::from_str::<Vec<project::DatasetProvenance>>(&text).unwrap(),
        credit
    );
    assert_eq!(
        csv::Reader::from_path(path).unwrap().records().count(),
        3439
    );
}

#[test]
fn older_projects_default_to_no_provenance_and_credit_is_bounded() {
    let p = Project::empty();
    let value = serde_json::to_value(&p).unwrap();
    assert!(value.get("provenance").is_none());
    assert!(serde_json::from_value::<Project>(value)
        .unwrap()
        .provenance
        .is_empty());
    let dir = tempfile::tempdir().unwrap();
    let mut p = chronoscope::demos::load("local-wildlife", dir.path()).unwrap();
    p.provenance[0].changes = "x".repeat(16385);
    assert!(p.validate().is_err());
}

fn saved(engine: &Engine, dir: &std::path::Path, name: &str) -> Project {
    let path = dir.join(format!("{name}.chronoscope"));
    engine.invoke("save", json!({"path":path})).unwrap();
    project::load_with_resources(&path, dir).unwrap()
}

#[test]
fn successful_overwrites_reconcile_credited_and_uncredited_pairs() {
    let dir = tempfile::tempdir().unwrap();
    let p = chronoscope::demos::load("local-wildlife", dir.path()).unwrap();
    let engine = Engine::new(p, dir.path().into()).unwrap();
    let empty_dir = tempfile::tempdir().unwrap();
    let uncredited = Engine::new(Project::empty(), empty_dir.path().into()).unwrap();
    let path = dir.path().join("out.csv");
    let sidecar = dir.path().join("out.csv.attribution.json");
    engine.invoke("export", json!({"path":path})).unwrap();
    let old_csv = std::fs::read(&path).unwrap();
    let old_credit = std::fs::read(&sidecar).unwrap();
    assert!(uncredited
        .invoke("export", json!({"path":path,"overwrite":false}))
        .is_err());
    assert_eq!(std::fs::read(&path).unwrap(), old_csv);
    assert_eq!(std::fs::read(&sidecar).unwrap(), old_credit);
    let output = uncredited
        .invoke("export", json!({"path":path,"overwrite":true}))
        .unwrap();
    assert_eq!(output["exported"], 0);
    assert_eq!(
        std::fs::read_to_string(output["attribution"].as_str().unwrap())
            .unwrap()
            .trim(),
        "[]"
    );
    assert_eq!(csv::Reader::from_path(&path).unwrap().records().count(), 0);
    let empty_csv = std::fs::read(&path).unwrap();
    let empty_credit = std::fs::read(&sidecar).unwrap();
    assert!(engine
        .invoke("export", json!({"path":path,"overwrite":false}))
        .is_err());
    assert_eq!(std::fs::read(&path).unwrap(), empty_csv);
    assert_eq!(std::fs::read(&sidecar).unwrap(), empty_credit);
    engine
        .invoke("export", json!({"path":path,"overwrite":true}))
        .unwrap();
    assert_eq!(std::fs::read(&sidecar).unwrap(), old_credit);
    // Default desktop/API overwrite behavior must reconcile credit too.
    uncredited.invoke("export", json!({"path":path})).unwrap();
    engine.invoke("export", json!({"path":path})).unwrap();
    assert_eq!(std::fs::read(&path).unwrap(), old_csv);
    assert_eq!(std::fs::read(&sidecar).unwrap(), old_credit);
    uncredited.invoke("export", json!({"path":path})).unwrap();
    assert_eq!(std::fs::read_to_string(&sidecar).unwrap().trim(), "[]");
}

#[test]
fn serialization_failure_preserves_existing_csv_and_credit() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("out.csv");
    let sidecar = dir.path().join("out.csv.attribution.json");
    let p = chronoscope::demos::load("local-wildlife", dir.path()).unwrap();
    std::fs::write(&path, b"previous matching csv").unwrap();
    std::fs::write(&sidecar, b"previous matching credit").unwrap();
    for failure in [Err("controlled row failure".into()), {
        let mut event = p.dataset.events[0].clone();
        event.time = f64::NAN;
        Ok(event)
    }] {
        assert!(project::export_csv_attributed(
            &path,
            vec![Ok(p.dataset.events[0].clone()), failure].into_iter(),
            Default::default(),
            &p.provenance
        )
        .is_err());
        assert_eq!(std::fs::read(&path).unwrap(), b"previous matching csv");
        assert_eq!(
            std::fs::read(&sidecar).unwrap(),
            b"previous matching credit"
        );
    }
}

#[test]
fn aggregate_preserves_derived_credit_through_save_export_undo_redo() {
    let dir = tempfile::tempdir().unwrap();
    let p = chronoscope::demos::load("local-wildlife", dir.path()).unwrap();
    let original = p.provenance.clone();
    let engine = Engine::new(p, dir.path().into()).unwrap();
    let result = engine
        .invoke(
            "aggregate_apply",
            json!({"aggregation":{"window_minutes":60,"radius_m":1000}}),
        )
        .unwrap();
    assert_eq!(result["input_count"], 3439);
    let aggregate = saved(&engine, dir.path(), "derived");
    let credit = aggregate.provenance.clone();
    assert_eq!(credit[0].creator, original[0].creator);
    assert!(credit[0].changes.starts_with(&original[0].changes));
    assert!(credit[0]
        .changes
        .contains("window_minutes=60, radius_m=1000"));
    engine.invoke("undo", json!({})).unwrap();
    assert_eq!(saved(&engine, dir.path(), "undone").provenance, original);
    engine.invoke("redo", json!({})).unwrap();
    assert_eq!(saved(&engine, dir.path(), "redone").provenance, credit);
    let portable = dir.path().join("derived.chronoscope");
    engine.invoke("open", json!({"path":portable})).unwrap();
    let output = engine
        .invoke("export", json!({"path":dir.path().join("derived.csv")}))
        .unwrap();
    let exported: Vec<project::DatasetProvenance> =
        serde_json::from_slice(&std::fs::read(output["attribution"].as_str().unwrap()).unwrap())
            .unwrap();
    assert_eq!(exported, credit);
}

#[test]
fn true_sqlite_save_open_preserves_dataset_credit() {
    let dir = tempfile::tempdir().unwrap();
    let p = chronoscope::demos::load("local-wildlife", dir.path()).unwrap();
    let mut store = chronoscope::store::DataStore::new(dir.path()).unwrap();
    store.load_events(p.dataset.events.clone()).unwrap();
    let path = dir.path().join("sqlite.chronoscope");
    store.save_as(&path, &p).unwrap();
    assert!(std::fs::read(&path)
        .unwrap()
        .starts_with(b"SQLite format 3\0"));
    let (copy, metadata) = chronoscope::store::DataStore::open_copy(&path, dir.path()).unwrap();
    assert_eq!(metadata.provenance, p.provenance);
    assert_eq!(
        copy.materialize(metadata).unwrap().dataset.events.len(),
        3439
    );
    let engine = Engine::new(Project::empty(), dir.path().into()).unwrap();
    engine.invoke("open", json!({"path":path})).unwrap();
    let out = engine
        .invoke("export", json!({"path":dir.path().join("sqlite.csv")}))
        .unwrap();
    assert_eq!(
        serde_json::from_slice::<Vec<project::DatasetProvenance>>(
            &std::fs::read(out["attribution"].as_str().unwrap()).unwrap()
        )
        .unwrap(),
        p.provenance
    );
}

#[test]
fn csv_sidecar_import_is_not_automatic_and_replacement_drops_unrelated_credit() {
    let dir = tempfile::tempdir().unwrap();
    let p = chronoscope::demos::load("local-wildlife", dir.path()).unwrap();
    let engine = Engine::new(p, dir.path().into()).unwrap();
    let csv = dir.path().join("incoming.csv");
    std::fs::write(
        &csv,
        "entity,timestamp,latitude,longitude\nother,2026-01-01T00:00:00Z,43,-79\n",
    )
    .unwrap();
    std::fs::write(
        dir.path().join("incoming.csv.attribution.json"),
        r#"[{"creator":"Not automatically imported"}]"#,
    )
    .unwrap();
    let preview = engine
        .invoke("import_preview", json!({"path":csv}))
        .unwrap();
    engine
        .invoke(
            "import_commit",
            json!({"import_id":preview["import_id"],"append":false}),
        )
        .unwrap();
    assert!(saved(&engine, dir.path(), "replaced-import")
        .provenance
        .is_empty());
    let output = engine
        .invoke(
            "export",
            json!({"path":dir.path().join("after-import.csv")}),
        )
        .unwrap();
    assert_eq!(
        std::fs::read_to_string(output["attribution"].as_str().unwrap())
            .unwrap()
            .trim(),
        "[]"
    );
}

#[test]
fn rejected_aggregation_credit_budget_does_not_replace_workspace() {
    let dir = tempfile::tempdir().unwrap();
    let mut p = chronoscope::demos::load("local-wildlife", dir.path()).unwrap();
    p.provenance[0].changes = "x".repeat(16384);
    let credit = p.provenance.clone();
    let engine = Engine::new(p, dir.path().into()).unwrap();
    assert!(engine
        .invoke(
            "aggregate_apply",
            json!({"aggregation":{"window_minutes":60,"radius_m":1000}})
        )
        .is_err());
    assert_eq!(engine.invoke("snapshot", json!({})).unwrap()["count"], 3439);
    assert_eq!(saved(&engine, dir.path(), "unchanged").provenance, credit);
}
