use chronoscope::{engine::Engine, model::Dataset, project::Project};
use serde_json::json;

#[test]
fn playback_pool_is_read_only_and_preserves_non_time_filters() {
    let dir = tempfile::tempdir().unwrap();
    let mut events = chronoscope::demo::dataset().events;
    events.truncate(3);
    for (i, e) in events.iter_mut().enumerate() {
        e.id = i as u64 + 1;
        e.entity = if i == 2 { "excluded" } else { "track" }.into();
        e.time = 1735689600. + i as f64;
        e.end = None;
        e.geometry_wkt = None;
        e.location_kind = None;
        e.lat = Some(32.);
        e.lon = Some(-80.);
    }
    let engine = Engine::new(
        Project::new(Dataset {
            name: "pool".into(),
            events,
        }),
        dir.path().into(),
    )
    .unwrap();
    engine.invoke("filter", json!({"filter":{"start":1735689601.,"end":1735689601.,"hidden_entities":["excluded"]}})).unwrap();
    let before = engine.invoke("snapshot", json!({"compact":true})).unwrap();
    let live = engine.invoke("render_data", json!({})).unwrap();
    assert_eq!(live["ids"], json!(["2"]));
    let pool = engine.invoke("render_data", json!({"playback_pool":true,"max_points":100000,"expected_revision":before["revision"]})).unwrap();
    chronoscope::schema::validate_output("render_data", &pool).unwrap();
    assert_eq!(pool["ids"], json!(["1", "2"]));
    let after = engine.invoke("snapshot", json!({"compact":true})).unwrap();
    assert_eq!(before["filter"], after["filter"]);
    assert_eq!(before["revision"], after["revision"]);
    assert!(engine
        .invoke(
            "render_data",
            json!({"playback_pool":true,"expected_revision":1})
        )
        .is_err());
}

#[test]
fn playback_pool_rejects_duration_geometry_and_unknown_location() {
    for kind in ["duration", "geometry", "unlocated", "unlocated_geometry"] {
        let dir = tempfile::tempdir().unwrap();
        let mut event = chronoscope::demo::dataset().events.remove(0);
        event.end = None;
        event.geometry_wkt = None;
        event.location_kind = None;
        match kind {
            "duration" => event.end = Some(event.time + 10.),
            "geometry" => {
                event.geometry_wkt = Some(format!(
                    "POINT ({} {})",
                    event.lon.unwrap(),
                    event.lat.unwrap()
                ))
            }
            "unlocated_geometry" => {
                event.lat = None;
                event.lon = None;
                event.geometry_wkt = Some("LINESTRING (-80 32, -79 33)".into());
            }
            _ => {
                event.lat = None;
                event.lon = None;
            }
        }
        let engine = Engine::new(
            Project::new(Dataset {
                name: kind.into(),
                events: vec![event],
            }),
            dir.path().into(),
        )
        .unwrap();
        let error = engine
            .invoke("render_data", json!({"playback_pool":true}))
            .unwrap_err();
        assert!(error.to_string().contains("UNAVAILABLE"), "{kind}: {error}");
        assert!(engine.invoke("render_data", json!({})).is_ok());
    }
}
