use chronoscope::{
    engine::Engine,
    project::{Project, SceneState},
};
use serde_json::json;

#[test]
fn time_axis_controls_are_validated_portable_and_legacy_defaults_remain_optional() {
    let legacy: SceneState = serde_json::from_value(json!({"mode":"space-time"})).unwrap();
    assert!(legacy.time_axis_anchor.is_none());
    assert!(legacy.show_grab_handles.is_none());
    for anchor in [[-0.1, 0.5], [0.5, 1.1], [f64::NAN, 0.5]] {
        let scene = SceneState {
            time_axis_anchor: Some(anchor),
            ..Default::default()
        };
        assert!(scene.validate().is_err());
    }
    let dir = tempfile::tempdir().unwrap();
    let engine = Engine::new(
        Project::new(chronoscope::demo::dataset()),
        dir.path().join("work"),
    )
    .unwrap();
    for anchor in [json!([-0.1, 0.5]), json!([0.5, 1.1]), json!([0.5])] {
        assert!(engine
            .invoke("view_set", json!({"time_axis_anchor":anchor}))
            .is_err());
    }
    engine
        .invoke(
            "view_set",
            json!({"time_axis_anchor":[0.4,0.2],"show_grab_handles":false,"time_altitude":true}),
        )
        .unwrap();
    assert_eq!(
        engine.invoke("render_data", json!({})).unwrap()["rendered_count"],
        0
    );
    engine.invoke("view_set", json!({"mode":"globe"})).unwrap();
    assert_eq!(
        engine.invoke("render_data", json!({})).unwrap()["rendered_count"],
        192
    );
    engine
        .invoke("view_set", json!({"mode":"space-time"}))
        .unwrap();
    let file = dir.path().join("axis.chronoscope");
    engine.invoke("save", json!({"path":file})).unwrap();
    let opened = Engine::from_path(&file, dir.path().join("reopened"), None).unwrap();
    let snapshot = opened.invoke("snapshot", json!({"compact":true})).unwrap();
    assert_eq!(snapshot["scene"]["time_axis_anchor"], json!([0.4, 0.2]));
    assert_eq!(snapshot["scene"]["show_grab_handles"], false);
    assert_eq!(snapshot["scene"]["time_altitude"], true);
    assert_eq!(snapshot["scene"]["globe_altitude"], false);
    assert_eq!(snapshot["count"], 192);
}
