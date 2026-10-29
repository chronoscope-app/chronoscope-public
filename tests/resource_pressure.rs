use chronoscope::{engine::Engine, model::Dataset, project::Project};
use serde_json::json;

#[test]
fn automatic_caps_bound_only_the_render_packet_and_never_persist_as_user_settings() {
    let dir = tempfile::tempdir().unwrap();
    let seed = chronoscope::demo::dataset().events.remove(0);
    let events = (0..1024)
        .map(|i| {
            let mut event = seed.clone();
            event.id = i + 1;
            event.time += i as f64;
            event.lon = Some(-74. + (i % 32) as f64 * 0.001);
            event.lat = Some(40. + (i / 32) as f64 * 0.001);
            event
        })
        .collect();
    let engine = Engine::new(
        Project::new(Dataset {
            events,
            ..Dataset::default()
        }),
        dir.path().into(),
    )
    .unwrap();
    engine
        .invoke(
            "view_set",
            json!({"mode":"globe","render_budget":100000,"display":{"mode":"points"}}),
        )
        .unwrap();
    engine.invoke("select", json!({"ids":["1","512"]})).unwrap();
    let before = engine.invoke("snapshot", json!({"compact":true})).unwrap();
    let full = engine
        .invoke(
            "view_snapshot_v1",
            json!({"version":1,"generation":"full","include_render":true}),
        )
        .unwrap();
    let limited = engine.invoke("view_snapshot_v1", json!({"version":1,"generation":"pressure","include_render":true,"resource_max_points":100,"resource_max_vertices":1000})).unwrap();
    assert_eq!(full["render"]["ids"].as_array().unwrap().len(), 1024);
    assert!(limited["render"]["ids"].as_array().unwrap().len() <= 100);
    let after = engine.invoke("snapshot", json!({"compact":true})).unwrap();
    assert_eq!(after["revision"], before["revision"]);
    assert_eq!(after["scene"], before["scene"]);
    assert_eq!(after["filter"], before["filter"]);
    assert_eq!(after["selected_count"], 2);
    assert_eq!(after["visible"], 1024);
    assert_eq!(
        engine.invoke("query", json!({"limit":1})).unwrap()["count"],
        1024
    );
    let restored = engine
        .invoke(
            "view_snapshot_v1",
            json!({"version":1,"generation":"recovered","include_render":true}),
        )
        .unwrap();
    assert_eq!(restored["render"]["ids"], full["render"]["ids"]);
    for args in [
        json!({"resource_max_points":99}),
        json!({"resource_max_vertices":999}),
    ] {
        let mut request = json!({"version":1,"generation":"invalid"});
        request
            .as_object_mut()
            .unwrap()
            .extend(args.as_object().unwrap().clone());
        assert!(engine.invoke("view_snapshot_v1", request).is_err());
    }
}

#[test]
fn system_resource_discovery_is_read_only_and_exposes_bounded_os_values() {
    let dir = tempfile::tempdir().unwrap();
    let engine = Engine::new(Project::empty(), dir.path().into()).unwrap();
    let before = engine.invoke("revision", json!({})).unwrap();
    let value = engine.invoke("system_resources", json!({})).unwrap();
    assert!(value["available_bytes"].as_u64().unwrap() <= value["total_bytes"].as_u64().unwrap());
    assert!(value["sample_age_ms"].as_u64().unwrap() < 5000);
    assert_eq!(engine.invoke("revision", json!({})).unwrap(), before);
    assert!(engine
        .invoke("system_resources", json!({"throttle":false}))
        .is_err());
}
