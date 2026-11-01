use chronoscope::{
    engine::Engine,
    model::{Dataset, Filter},
    project::Project,
    store::DataStore,
};
use serde_json::{json, Value};
use std::collections::BTreeSet;

#[test]
fn filtered_layers_match_full_scan_with_hidden_empty_and_selected_sources() {
    let dir = tempfile::tempdir().unwrap();
    let mut store = DataStore::new(dir.path()).unwrap();
    let template = chronoscope::demo::dataset().events.remove(0);
    let events = (0..120).map(|i| {
        let mut e = template.clone();
        e.id = i + 1;
        e.source = format!("source-{}", i % 5);
        e.entity = format!("entity-{}", i % 7);
        e.category = format!("category-{}", i % 3);
        e.time = 1_700_000_000. + i as f64;
        e.end = Some(e.time + (i % 9) as f64);
        e
    });
    store.load_events(events).unwrap();
    store
        .selection_changed(&BTreeSet::from([1, 3, 5, 17, 119]))
        .unwrap();
    // More than four distinct filters also exercises filtered-cache eviction.
    for i in 0..12 {
        let mut f = Filter {
            start: Some(1_700_000_000. + i as f64 * 12.),
            end: Some(1_700_000_040. + i as f64 * 12.),
            selected_only: i % 3 == 1,
            ..Filter::default()
        };
        if i % 2 == 0 {
            f.hidden_sources.insert("source-0".into());
        }
        let table = store.ordered(&f, None, "time", false).unwrap();
        let sql = format!("SELECT e.source,count(*),sum(e.r IN (SELECT r FROM {table})) FROM events e GROUP BY e.source ORDER BY e.source LIMIT 5000");
        let mut q = store.connection.prepare(&sql).unwrap();
        let expected = q.query_map([], |r| {let source: String = r.get(0)?; Ok(json!({"source":source,"count":r.get::<_,u64>(1)?,"visible":r.get::<_,u64>(2)?,"enabled":!f.hidden_sources.contains(&source)}))}).unwrap().collect::<Result<Vec<_>,_>>().unwrap();
        let summary = store.summary_with_statistics(&f, false).unwrap();
        assert_eq!(summary["layers"], json!(expected));
        assert_eq!(summary["entities"]["entity-0"], 18);
        assert_eq!(summary["categories"]["category-0"], 40);
        let cache = store.cache_info();
        assert!(
            cache["summary_cache_encoded_bytes"].as_u64().unwrap()
                <= cache["summary_cache_encoded_limit_bytes"].as_u64().unwrap()
        );
    }
}

fn totals(engine: &Engine) -> Value {
    let summary = engine
        .invoke("snapshot", json!({"include_statistics":false}))
        .unwrap();
    json!({"entities":summary["entities"],"categories":summary["categories"],"layers":summary["layers"],"count":summary["count"]})
}

#[test]
fn dataset_totals_invalidate_after_edits_undo_redo_delete_and_open() {
    let dir = tempfile::tempdir().unwrap();
    let mut event = chronoscope::demo::dataset().events.remove(0);
    event.id = 1;
    event.entity = "original".into();
    event.category = "original".into();
    event.source = "original".into();
    let engine = Engine::new(
        Project::new(Dataset {
            name: "totals".into(),
            events: vec![event],
        }),
        dir.path().into(),
    )
    .unwrap();
    let before = totals(&engine);
    let path = dir.path().join("original.chronoscope");
    engine.invoke("save", json!({"path":path})).unwrap();
    engine
        .invoke(
            "edit",
            json!({"id":"1","changes":{"entity":"edited","category":"edited"}}),
        )
        .unwrap();
    let after = totals(&engine);
    assert_eq!(after["entities"], json!({"edited":1}));
    assert_eq!(after["categories"], json!({"edited":1}));
    assert_eq!(after["layers"][0]["source"], "original");
    engine.invoke("undo", json!({})).unwrap();
    assert_eq!(totals(&engine), before);
    engine.invoke("redo", json!({})).unwrap();
    assert_eq!(totals(&engine), after);
    engine.invoke("select", json!({"ids":["1"]})).unwrap();
    engine.invoke("delete", json!({})).unwrap();
    assert_eq!(
        totals(&engine),
        json!({"entities":{},"categories":{},"layers":[],"count":0})
    );
    engine.invoke("open", json!({"path":path})).unwrap();
    assert_eq!(totals(&engine), before);
}

#[test]
fn dataset_totals_refresh_after_appending_events() {
    let dir = tempfile::tempdir().unwrap();
    let mut store = DataStore::new(dir.path()).unwrap();
    assert_eq!(
        store
            .summary_with_statistics(&Filter::default(), false)
            .unwrap()["layers"],
        json!([])
    );
    let mut event = chronoscope::demo::dataset().events.remove(0);
    event.source = "new".into();
    store.load_events(vec![event.clone()]).unwrap();
    assert_eq!(
        store
            .summary_with_statistics(&Filter::default(), false)
            .unwrap()["layers"][0]["count"],
        1
    );
    event.id += 1_000_000;
    store.load_events(vec![event]).unwrap();
    assert_eq!(
        store
            .summary_with_statistics(&Filter::default(), false)
            .unwrap()["layers"][0]["count"],
        2
    );
}

#[test]
fn source_limit_keeps_global_order_even_when_only_later_sources_are_visible() {
    let dir = tempfile::tempdir().unwrap();
    let mut store = DataStore::new(dir.path()).unwrap();
    let template = chronoscope::demo::dataset().events.remove(0);
    store
        .load_events((0..5002).map(|i| {
            let mut event = template.clone();
            event.id = i + 1;
            event.source = format!("source-{i:05}");
            event.time = 1_700_000_000. + i as f64;
            event.end = None;
            event
        }))
        .unwrap();
    let f = Filter {
        start: Some(1_700_005_000.),
        ..Filter::default()
    };
    let result = store.summary_with_statistics(&f, false).unwrap();
    let layers = result["layers"].as_array().unwrap();
    assert_eq!(result["visible"], 2);
    assert_eq!(layers.len(), 5000);
    assert_eq!(layers[0]["source"], "source-00000");
    assert_eq!(layers[4999]["source"], "source-04999");
    assert!(layers.iter().all(|layer| layer["visible"] == 0));
}
