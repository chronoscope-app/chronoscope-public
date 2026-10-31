use chronoscope::{engine::Engine, project::Project};
use serde_json::json;

#[test]
fn retired_aligned_uav_demo_is_not_advertised_or_loadable() {
    let data = tempfile::tempdir().unwrap();
    let engine = Engine::new(Project::empty(), data.path().into()).unwrap();
    let catalog = engine.invoke("demo_catalog", json!({})).unwrap();
    assert!(!catalog["demos"]
        .as_array()
        .unwrap()
        .iter()
        .any(|demo| demo["id"] == "idf-uav"));
    assert!(engine.invoke("demo_open", json!({"id":"idf-uav"})).is_err());
    assert_eq!(engine.invoke("snapshot", json!({})).unwrap()["count"], 0);
}
