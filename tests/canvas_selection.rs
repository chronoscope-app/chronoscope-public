use chronoscope::{engine::Engine, project::Project};
use serde_json::{json, Value};

fn selected(engine: &Engine) -> Value {
    engine
        .invoke(
            "snapshot",
            json!({"selection_limit":1000000,"compact":true}),
        )
        .unwrap()["selected"]
        .clone()
}
fn pick(engine: &Engine, ids: Value) -> Value {
    let result = engine.invoke("selection_pick", json!({"ids":ids})).unwrap();
    chronoscope::schema::validate_output("selection_pick", &result).unwrap();
    result
}
fn restore(engine: &Engine, receipt: &Value) -> Result<Value, String> {
    engine.invoke(
        "selection_restore",
        json!({"pick_revision":receipt["pick_revision"]}),
    )
}

#[test]
fn viewport_selection_is_an_intersection_and_pick_restores_the_whole_selection() {
    let dir = tempfile::tempdir().unwrap();
    let dataset = chronoscope::demo::dataset();
    let second = dataset.events.iter().find(|e| e.id == 2).unwrap();
    let (lon, lat) = (second.lon.unwrap(), second.lat.unwrap());
    let engine = Engine::new(Project::new(dataset), dir.path().into()).unwrap();
    engine.invoke("select", json!({"ids":["1","2"]})).unwrap();
    let viewport = engine.invoke("view_snapshot_v1",json!({"version":1,"generation":"cull","include_render":true,"bounds":[lon-0.00001,lat-0.00001,lon+0.00001,lat+0.00001]})).unwrap();
    assert_eq!(viewport["selected"], json!(["2"]));
    assert_eq!(viewport["snapshot"]["selected_count"], 2);
    assert_eq!(selected(&engine), json!(["1", "2"]));
    let undo = viewport["snapshot"]["undo"].clone();
    let receipt = pick(&engine, json!([]));
    assert_eq!(selected(&engine), json!([]));
    // A camera/settings update doesn't invalidate a still-current selection pick.
    engine
        .invoke("scene_sync", json!({"scene":{"mode":"map"}}))
        .unwrap();
    let restored = restore(&engine, &receipt).unwrap();
    chronoscope::schema::validate_output("selection_restore", &restored).unwrap();
    assert_eq!(selected(&engine), json!(["1", "2"]));
    assert!(
        restore(&engine, &receipt).is_err(),
        "receipts are single-use"
    );
    assert_eq!(
        engine.invoke("snapshot", json!({})).unwrap()["undo"],
        undo,
        "canvas selection never creates document undo entries"
    );
}

#[test]
fn rollback_does_not_truncate_a_selection_larger_than_the_ui_snapshot_or_select_limit() {
    let dir = tempfile::tempdir().unwrap();
    let mut dataset = chronoscope::demo::dataset();
    let event = dataset.events[0].clone();
    dataset.events = (1..=20001)
        .map(|id| {
            let mut e = event.clone();
            e.id = id;
            e
        })
        .collect();
    let engine = Engine::new(Project::new(dataset), dir.path().into()).unwrap();
    engine.invoke("select_visible", json!({})).unwrap();
    let viewport = engine
        .invoke(
            "view_snapshot_v1",
            json!({"version":1,"generation":"limited"}),
        )
        .unwrap();
    assert_eq!(viewport["snapshot"]["selected_count"], 20001);
    assert_eq!(viewport["snapshot"]["selection_limited"], true);
    let receipt = pick(&engine, json!(["1"]));
    assert_eq!(receipt["selected"], 1);
    assert!(
        receipt.get("ids").is_none(),
        "the full selection stays in the engine"
    );
    restore(&engine, &receipt).unwrap();
    let ids = selected(&engine);
    assert_eq!(ids.as_array().unwrap().len(), 20001);
    assert_eq!(ids[0], "1");
    assert_eq!(ids[20000], "20001");
}

#[test]
fn rollback_cannot_override_a_new_pick_selection_edit_or_reopened_workspace() {
    let dir = tempfile::tempdir().unwrap();
    let engine = Engine::new(
        Project::new(chronoscope::demo::dataset()),
        dir.path().into(),
    )
    .unwrap();
    engine.invoke("select", json!({"ids":["1","2"]})).unwrap();
    let old = pick(&engine, json!([]));
    let new = pick(&engine, json!(["3"]));
    assert!(restore(&engine, &old).is_err());
    assert_eq!(selected(&engine), json!(["3"]));
    restore(&engine, &new).unwrap();
    assert_eq!(selected(&engine), json!([]));
    let receipt = pick(&engine, json!([]));
    // Explicitly selecting the same set is still a newer user selection intent.
    engine.invoke("select", json!({"ids":[]})).unwrap();
    assert!(restore(&engine, &receipt).is_err());
    engine.invoke("select", json!({"ids":["1","2"]})).unwrap();
    let receipt = pick(&engine, json!([]));
    engine
        .invoke("edit", json!({"id":"1","changes":{"note":"newer edit"}}))
        .unwrap();
    assert!(restore(&engine, &receipt).is_err());
    assert_eq!(selected(&engine), json!([]));
    let receipt = pick(&engine, json!([]));
    engine.invoke("demo", json!({})).unwrap();
    engine.invoke("undo", json!({})).unwrap();
    assert!(
        restore(&engine, &receipt).is_err(),
        "replacement/undo does not revive a canvas receipt"
    );
    assert_eq!(selected(&engine), json!([]));
}

#[test]
fn pick_rollback_dry_runs_do_not_consume_the_receipt() {
    let dir = tempfile::tempdir().unwrap();
    let engine = Engine::new(
        Project::new(chronoscope::demo::dataset()),
        dir.path().into(),
    )
    .unwrap();
    engine.invoke("select", json!({"ids":["1","2"]})).unwrap();
    let receipt = pick(&engine, json!([]));
    for (command, args) in [
        ("selection_pick", json!({"ids":["3"],"dry_run":true})),
        (
            "selection_restore",
            json!({"pick_revision":receipt["pick_revision"],"dry_run":true}),
        ),
    ] {
        let plan = engine.invoke(command, args).unwrap();
        chronoscope::schema::validate_output(command, &plan).unwrap();
        assert_eq!(plan["executed"], false);
        assert_eq!(selected(&engine), json!([]));
    }
    restore(&engine, &receipt).unwrap();
    assert_eq!(selected(&engine), json!(["1", "2"]));
}

#[test]
fn restoring_a_saved_view_supersedes_a_canvas_pick_even_if_selection_matches() {
    let dir = tempfile::tempdir().unwrap();
    let engine = Engine::new(
        Project::new(chronoscope::demo::dataset()),
        dir.path().into(),
    )
    .unwrap();
    engine
        .invoke("save_view", json!({"name":"empty selection"}))
        .unwrap();
    engine.invoke("select", json!({"ids":["1","2"]})).unwrap();
    let receipt = pick(&engine, json!([]));
    engine.invoke("restore_view", json!({"index":0})).unwrap();
    assert!(restore(&engine, &receipt).is_err());
    assert_eq!(selected(&engine), json!([]));
}

#[test]
fn expired_canvas_receipts_cannot_change_a_later_selection() {
    let dir = tempfile::tempdir().unwrap();
    let engine = Engine::new(
        Project::new(chronoscope::demo::dataset()),
        dir.path().into(),
    )
    .unwrap();
    engine.invoke("select", json!({"ids":["1","2"]})).unwrap();
    let receipt = pick(&engine, json!([]));
    std::thread::sleep(std::time::Duration::from_millis(5100));
    assert!(restore(&engine, &receipt).is_err());
    assert_eq!(selected(&engine), json!([]));
}
