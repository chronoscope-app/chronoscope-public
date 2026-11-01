use chronoscope::{
    engine::Engine,
    model::{Dataset, Event, Filter},
    project::Project,
    store::DataStore,
};
use serde_json::json;

fn events() -> Vec<Event> {
    let template = chronoscope::demo::dataset().events.remove(0);
    (0..3)
        .map(|i| {
            let mut e = template.clone();
            e.id = i + 1;
            e.entity = "track".into();
            e.source = "track.csv".into();
            e.time = i as f64 * 300.;
            e.end = None;
            e.geometry_wkt = None;
            e.location_kind = None;
            e.mgrs_precision = None;
            e.lat = Some(0.);
            e.lon = Some(i as f64 * 0.5);
            e
        })
        .collect()
}

#[test]
fn empty_inference_skips_anchor_order_and_still_handles_later_missing_events() {
    let dir = tempfile::tempdir().unwrap();
    let mut store = DataStore::new(dir.path()).unwrap();
    store.load_events(events()).unwrap();
    let empty = store.inferred_markers(&Filter::default(), 100).unwrap();
    assert!(empty.0.is_empty() && empty.2.is_empty());
    assert_eq!(empty.1, 0);
    // The empty missing-event ordering exists, but no all-located anchor table.
    assert_eq!(store.cache_info()["cached_orders"], 1);
    let mut changed = events();
    changed[1].lat = None;
    changed[1].lon = None;
    store.load_events(changed).unwrap();
    // Absence is scoped to the current filter, never cached across filters/data.
    let excluded = store
        .inferred_markers(
            &Filter {
                end: Some(100.),
                ..Filter::default()
            },
            100,
        )
        .unwrap();
    assert_eq!(excluded.1, 0);
    assert_eq!(store.cache_info()["cached_orders"], 1);
    let inferred = store.inferred_markers(&Filter::default(), 100).unwrap();
    assert_eq!(inferred.1, 1);
    assert_eq!(inferred.0.len(), 1);
    assert_eq!(inferred.0[0].id, 2);
    assert!((inferred.0[0].lon.unwrap() - 0.5).abs() < 1e-10);
    assert_eq!(inferred.2[0].before_id, "1");
    assert_eq!(inferred.2[0].after_id, "3");
    assert!(store.get(2).unwrap().unwrap().location().is_none());
}

#[test]
fn inference_after_empty_reads_follows_coordinate_edits_undo_and_redo() {
    let dir = tempfile::tempdir().unwrap();
    let engine = Engine::new(
        Project::new(Dataset {
            name: "anchors".into(),
            events: events(),
        }),
        dir.path().into(),
    )
    .unwrap();
    let render = || {
        engine
            .invoke(
                "render_data",
                json!({"max_points":100,"bounds":[-180,-90,180,90],"include_time_only":true}),
            )
            .unwrap()
    };
    assert_eq!(render()["inferred_ids"], json!([]));
    engine
        .invoke("edit", json!({"id":"2","changes":{"lat":null,"lon":null}}))
        .unwrap();
    assert_eq!(render()["inferred_ids"], json!(["2"]));
    assert!(engine.invoke("events", json!({"id":"2"})).unwrap()["events"][0]["lat"].is_null());
    engine.invoke("undo", json!({})).unwrap();
    assert_eq!(render()["inferred_ids"], json!([]));
    engine.invoke("redo", json!({})).unwrap();
    assert_eq!(render()["inferred_ids"], json!(["2"]));
}

#[test]
fn empty_inference_preserves_cached_overview_order_through_viewport_churn() {
    use chronoscope::model::{GeoBounds, Operator, Predicate};
    let dir = tempfile::tempdir().unwrap();
    let mut store = DataStore::new(dir.path()).unwrap();
    store.load_events(events()).unwrap();
    let filter = Filter::default();
    let mut located = filter.clone();
    located.located_only = true;
    located.predicates.push(Predicate {
        field: "lat".into(),
        op: Operator::NotEquals,
        value: String::new(),
    });
    let original = store.ordered(&located, None, "time", false).unwrap();
    for i in 0..6 {
        let viewport = GeoBounds {
            west: -180. + i as f64,
            east: 180.,
            south: -90.,
            north: 90.,
        };
        store
            .render_viewport(&filter, 100, Some(&viewport))
            .unwrap();
        assert_eq!(store.inferred_markers(&filter, 100).unwrap().1, 0);
    }
    // Reuse the original table after more distinct viewports than cache slots.
    assert_eq!(
        store.ordered(&located, None, "time", false).unwrap(),
        original
    );
}
