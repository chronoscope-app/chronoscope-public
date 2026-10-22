use chronoscope::{
    engine::Engine,
    model::Dataset,
    project::{Project, SceneState},
};
use serde_json::json;
#[test]
fn c22_render_budget_is_explicit_validated_and_portable() {
    let dir = tempfile::tempdir().unwrap();
    let engine = Engine::new(Project::new(Dataset::default()), dir.path().into()).unwrap();
    assert!(engine
        .invoke("view_set", json!({"render_budget":999999}))
        .is_err());
    engine
        .invoke("view_set", json!({"render_budget":100000}))
        .unwrap();
    let result = engine
        .invoke(
            "view_snapshot_v1",
            json!({"version":1,"generation":"1","include_render":true}),
        )
        .unwrap();
    assert_eq!(result["render"]["max_points"], 100000);
    let file = dir.path().join("display.chronoscope");
    engine.invoke("save", json!({"path":file})).unwrap();
    engine.invoke("open", json!({"path":file})).unwrap();
    assert_eq!(
        engine.invoke("snapshot", json!({"compact":true})).unwrap()["scene"]["render_budget"],
        100000
    );
    let old: SceneState = serde_json::from_value(json!({"mode":"map"})).unwrap();
    assert!(old.render_budget.is_none());
    old.validate().unwrap();
}
