use chronoscope::{engine::Engine, project::Project};
use serde_json::{json, Value};
fn import(engine: &Engine, path: &std::path::Path, target: Option<&str>) -> Value {
    let preview = engine
        .invoke("import_preview", json!({"path":path}))
        .unwrap();
    let mut args = json!({"import_id":preview["import_id"],"mapping":preview["sheets"][0]["mapping"],"append":target.is_some()});
    if let Some(target) = target {
        args["target_source"] = json!(target);
    }
    engine.invoke("import_commit", args).unwrap()
}
#[test]
fn merge_import_retains_one_layer_original_file_rows_and_undo() {
    let dir = tempfile::tempdir().unwrap();
    let engine = Engine::new(Project::empty(), dir.path().into()).unwrap();
    let first = dir.path().join("first.csv");
    let second = dir.path().join("second.csv");
    std::fs::write(
        &first,
        "entity,time,latitude,longitude\nA,2026-10-31T12:00:00Z,40,-73\n",
    )
    .unwrap();
    let mut csv = String::from("entity,time,latitude,longitude,chronoscope_original_source\n");
    for i in 0..1100 {
        csv.push_str(&format!("B,2026-10-31T12:00:00Z,41,-74,user value {i}\n"));
    }
    std::fs::write(&second, csv).unwrap();
    import(&engine, &first, None);
    let snap = engine.invoke("snapshot", json!({})).unwrap();
    let target = snap["layers"][0]["source"].as_str().unwrap();
    import(&engine, &second, Some(target));
    let snap = engine.invoke("snapshot", json!({})).unwrap();
    assert_eq!(snap["count"], 1101);
    assert_eq!(snap["layers"].as_array().unwrap().len(), 1);
    let events = engine
        .invoke("query", json!({"offset":1099,"limit":2}))
        .unwrap();
    for row in events["events"].as_array().unwrap() {
        assert_eq!(row["source"], target);
        assert_eq!(
            row["attrs"]["chronoscope_original_source"],
            "second.csv / CSV"
        );
        assert!(row["attrs"]["chronoscope_original_source_attribute"]
            .as_str()
            .unwrap()
            .starts_with("user value"));
        assert!(row["source_row"].as_u64().unwrap() > 1000);
    }
    engine.invoke("undo", json!({})).unwrap();
    assert_eq!(engine.invoke("snapshot", json!({})).unwrap()["count"], 1);
    engine.invoke("redo", json!({})).unwrap();
    assert_eq!(engine.invoke("snapshot", json!({})).unwrap()["count"], 1101);
}
#[test]
fn merge_requires_append_and_an_existing_layer() {
    let dir = tempfile::tempdir().unwrap();
    let e = Engine::new(Project::empty(), dir.path().into()).unwrap();
    let file = dir.path().join("new.csv");
    std::fs::write(&file, "time,latitude,longitude\n2026-10-31,40,-73\n").unwrap();
    let p = e.invoke("import_preview", json!({"path":file})).unwrap();
    for append in [false, true] {
        assert!(e
            .invoke(
                "import_commit",
                json!({"import_id":p["import_id"],"append":append,"target_source":"missing"})
            )
            .is_err());
        assert_eq!(e.invoke("snapshot", json!({})).unwrap()["count"], 0);
    }
}
