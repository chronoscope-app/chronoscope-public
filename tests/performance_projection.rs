use chronoscope::{engine::Engine, model::Dataset, project::Project};
use serde_json::json;
#[test]
fn c07_scalar_event_projection_and_wide_attribute_windows_are_exact() {
    let dir = tempfile::tempdir().unwrap();
    let mut e = chronoscope::demo::dataset().events.remove(0);
    e.lat = Some(-0.);
    e.lon = Some(-0.);
    e.value = Some(-0.);
    e.attrs.clear();
    for i in 0..512 {
        e.attrs
            .insert(format!("field{i:03}"), format!("raw Évidence {i}"));
    }
    let engine = Engine::new(
        Project::new(Dataset {
            name: "wide".into(),
            events: vec![e],
        }),
        dir.path().into(),
    )
    .unwrap();
    let scalar = engine
        .invoke(
            "events",
            json!({"fields":["id","time","lat","lon","value"]}),
        )
        .unwrap();
    assert_eq!(scalar["events"][0].as_object().unwrap().len(), 5);
    for field in ["lat", "lon", "value"] {
        assert!(scalar["events"][0][field]
            .as_f64()
            .unwrap()
            .is_sign_negative());
    }
    let last = engine
        .invoke(
            "attribute_table",
            json!({"column_offset":512,"column_limit":32}),
        )
        .unwrap();
    assert_eq!(last["total_columns"], 531);
    assert_eq!(last["columns"].as_array().unwrap().len(), 19);
    assert_eq!(last["events"][0]["attribute:field511"], "raw Évidence 511");
    assert!(last["events"][0].get("attrs").is_none());
    assert_eq!(last["events"][0].as_object().unwrap().len(), 20);
}
#[test]
fn c07_unlocated_projection_has_null_coordinate_formats_instead_of_failing() {
    let dir = tempfile::tempdir().unwrap();
    let mut e = chronoscope::demo::dataset().events.remove(0);
    e.lat = None;
    e.lon = None;
    let engine = Engine::new(
        Project::new(Dataset {
            name: "unknown".into(),
            events: vec![e],
        }),
        dir.path().into(),
    )
    .unwrap();
    let result = engine
        .invoke("events", json!({"fields":["id","coordinate_formats"]}))
        .unwrap();
    assert!(result["events"][0]["coordinate_formats"].is_null());
}
