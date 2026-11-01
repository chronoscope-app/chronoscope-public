use chronoscope::{engine::Engine, model::Dataset, project::Project, store::DataStore};
use serde_json::json;

#[test]
fn point_only_shape_packet_tracks_geometry_edits_and_undo() {
    let dir = tempfile::tempdir().unwrap();
    let event = chronoscope::demo::dataset().events.remove(0);
    let id = event.id.to_string();
    let engine = Engine::new(
        Project::new(Dataset {
            name: "shape probe".into(),
            events: vec![event],
        }),
        dir.path().into(),
    )
    .unwrap();
    let empty = engine
        .invoke("render_geometries", json!({"offset":7}))
        .unwrap();
    assert_eq!(empty["count"], 0);
    assert_eq!(empty["offset"], 7);
    assert_eq!(empty["limited"], false);
    assert_eq!(empty["features"], json!([]));
    assert_eq!(empty["bounds"], serde_json::Value::Null);
    assert_eq!(empty["vertex_count"], 0);
    engine
        .invoke(
            "edit",
            json!({"id":id,"changes":{"geometry_wkt":"LINESTRING(-74 40,-73 41)"}}),
        )
        .unwrap();
    assert_eq!(
        engine.invoke("render_geometries", json!({})).unwrap()["count"],
        1
    );
    engine.invoke("undo", json!({})).unwrap();
    assert_eq!(
        engine.invoke("render_geometries", json!({})).unwrap()["count"],
        0
    );
    engine.invoke("redo", json!({})).unwrap();
    assert_eq!(
        engine.invoke("render_geometries", json!({})).unwrap()["count"],
        1
    );
}

#[test]
fn geometry_presence_uses_the_existing_partial_index() {
    let dir = tempfile::tempdir().unwrap();
    let store = DataStore::new(dir.path()).unwrap();
    assert!(!store.has_geometries().unwrap());
    let mut statement = store.connection.prepare("EXPLAIN QUERY PLAN SELECT EXISTS(SELECT 1 FROM events INDEXED BY events_geometry WHERE geometry_wkt IS NOT NULL)").unwrap();
    let plans = statement
        .query_map([], |r| r.get::<_, String>(3))
        .unwrap()
        .collect::<Result<Vec<_>, _>>()
        .unwrap()
        .join(" ");
    assert!(plans.contains("events_geometry"), "{plans}");
}
