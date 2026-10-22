use chronoscope::{engine::Engine, model::Dataset, project::Project};
use serde_json::{json, Value};
fn engine(path: &std::path::Path) -> Engine {
    Engine::new(Project::new(Dataset::default()), path.into()).unwrap()
}
fn layer(id: &str, zoom: f64) -> Value {
    json!({"id":id,"name":id,"server_name":"Local reference","config":chronoscope::wmts::MapConfig::nasa(),"opacity":0.75,"min_zoom":zoom,"max_zoom":30.0})
}
#[test]
fn stack_survives_save_open_theme_updates_and_legacy_map_calls_preserve_other_layers() {
    let dir = tempfile::tempdir().unwrap();
    let e = engine(dir.path());
    assert_eq!(
        e.invoke("preferences", json!({})).unwrap()["map_layers"],
        json!([])
    );
    e.invoke("preferences", json!({"preferences":{"map_layers":null}}))
        .unwrap();
    let stack = json!([layer("streets", 0.), layer("aerial", 14.)]);
    let prefs = e
        .invoke("preferences", json!({"preferences":{"map_layers":stack}}))
        .unwrap();
    chronoscope::schema::validate_output("preferences", &prefs).unwrap();
    e.invoke("preferences", json!({"preferences":{"theme":"light"}}))
        .unwrap();
    let path = dir.path().join("stack.chronoscope");
    e.invoke("save", json!({"path":path})).unwrap();
    e.invoke("preferences", json!({"preferences":{"map_layers":[]}}))
        .unwrap();
    e.invoke("open", json!({"path":path})).unwrap();
    assert_eq!(
        e.invoke("preferences", json!({})).unwrap()["map_layers"],
        stack
    );
    let mut old = prefs["map"].clone();
    old["enabled"] = json!(false);
    let updated = e
        .invoke("preferences", json!({"preferences":{"map":old}}))
        .unwrap();
    assert_eq!(updated["map_layers"].as_array().unwrap().len(), 2);
    assert_eq!(updated["map_layers"][0]["config"]["enabled"], false);
    assert_eq!(updated["map_layers"][1]["config"]["enabled"], true);
    e.invoke("preferences", json!({"preferences":{"map_layers":null}}))
        .unwrap();
    let restored = engine(dir.path());
    assert!(restored.invoke("preferences", json!({})).unwrap()["map_layers"].is_null());
}
#[test]
fn stack_rejects_invalid_ranges_opacity_duplicate_identity_and_incomplete_enabled_sources() {
    let dir = tempfile::tempdir().unwrap();
    let e = engine(dir.path());
    for (key, value) in [
        ("min_zoom", json!(-1)),
        ("max_zoom", json!(0)),
        ("opacity", json!(1.1)),
        ("min_zoom", json!(31)),
    ] {
        let mut l = layer("invalid", 0.);
        l[key] = value;
        assert!(e
            .invoke("preferences", json!({"preferences":{"map_layers":[l]}}))
            .is_err());
    }
    assert!(e
        .invoke(
            "preferences",
            json!({"preferences":{"map_layers":[layer("same",0.),layer("same",1.)]}})
        )
        .is_err());
    let mut l = layer("bad", 0.);
    l["config"]["layer"] = json!("");
    assert!(e
        .invoke("preferences", json!({"preferences":{"map_layers":[l]}}))
        .is_err());
    e.invoke("preferences", json!({"preferences":{"map_layers":[]}}))
        .unwrap();
    assert_eq!(
        e.invoke("preferences", json!({})).unwrap()["map_layers"],
        json!([])
    );
}
