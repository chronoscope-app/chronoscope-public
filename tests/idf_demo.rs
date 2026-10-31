use chronoscope::{engine::Engine, project::Project};
use serde_json::json;

#[test]
fn complete_idf_demo_preserves_elapsed_clocks_source_fields_and_editable_views() {
    let data = tempfile::tempdir().unwrap();
    let engine = Engine::new(Project::empty(), data.path().into()).unwrap();
    let catalog = engine.invoke("demo_catalog", json!({})).unwrap();
    assert_eq!(catalog["demos"].as_array().unwrap().len(), 15);
    assert_eq!(
        catalog["demos"].as_array().unwrap().last().unwrap()["id"],
        "starlink-orbits"
    );
    let schema = chronoscope::schema::command_schema("demo_open").unwrap();
    assert!(schema["properties"]["id"]["enum"]
        .as_array()
        .unwrap()
        .contains(&json!("idf-uav")));
    engine.invoke("demo_open", json!({"id":"idf-uav"})).unwrap();
    let snapshot = engine
        .invoke(
            "snapshot",
            json!({"compact":false,"include_statistics":false}),
        )
        .unwrap();
    assert_eq!(snapshot["count"], 399331);
    assert_eq!(snapshot["entities"].as_object().unwrap().len(), 224);
    assert_eq!(snapshot["views"].as_array().unwrap().len(), 5);
    assert!(snapshot["scene"]["globe_altitude"].as_bool().unwrap());
    assert_eq!(snapshot["scene"]["display"]["show_trails"], false);
    let rows = engine.invoke("query", json!({"limit":1000})).unwrap();
    for row in rows["events"].as_array().unwrap() {
        let attrs = &row["attrs"];
        let elapsed: f64 = attrs["elapsed_seconds"].as_str().unwrap().parse().unwrap();
        assert!((row["time"].as_f64().unwrap() - 946684800.0 - elapsed).abs() < 1e-6);
        assert_eq!(row["altitude"]["reference"], "reported");
        assert!(attrs["archive_member"].as_str().unwrap().ends_with(".csv"));
        let raw_height = if row["category"] == "SpeedyBee" {
            assert!(attrs["time (us)"].is_string());
            &attrs["GPS_altitude"]
        } else {
            assert!(attrs["timestamp"].is_string());
            assert!(attrs["alt_ellipsoid"].is_string());
            &attrs["alt"]
        };
        assert_eq!(
            row["altitude"]["meters"].as_f64().unwrap(),
            raw_height.as_str().unwrap().parse::<f64>().unwrap()
        );
    }
    for (index, count) in [(3, 243662), (4, 155669), (0, 399331)] {
        engine
            .invoke("restore_view", json!({"index":index}))
            .unwrap();
        assert_eq!(
            engine.invoke("snapshot", json!({"compact":true})).unwrap()["visible"],
            count
        );
    }
    let copy = data.path().join("idf-copy.chronoscope");
    engine.invoke("save", json!({"path":copy})).unwrap();
    assert!(chronoscope::store::DataStore::is_database(&copy));
    engine.invoke("open", json!({"path":copy})).unwrap();
    assert_eq!(
        engine.invoke("snapshot", json!({"compact":true})).unwrap()["count"],
        399331
    );
}
