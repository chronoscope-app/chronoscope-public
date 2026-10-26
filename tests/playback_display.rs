use chronoscope::{
    engine::Engine,
    project::{Project, SceneState},
};
use serde_json::json;
#[test]
fn zero_height_and_fade_choice_roundtrip_through_engine_views_and_workspace() {
    let dir = tempfile::tempdir().unwrap();
    let e = Engine::new(
        Project::new(chronoscope::demo::dataset()),
        dir.path().join("profile"),
    )
    .unwrap();
    e.invoke("view_set", json!({"time_height":0,"playback_fade":false}))
        .unwrap();
    let scene = e.invoke("snapshot", json!({})).unwrap()["scene"].clone();
    assert_eq!(scene["time_height"], 0.0);
    assert_eq!(scene["playback_fade"], false);
    e.invoke(
        "save_view",
        json!({"name":"Persistent playback","scene":scene}),
    )
    .unwrap();
    e.invoke("view_set", json!({"time_height":2.8,"playback_fade":true}))
        .unwrap();
    e.invoke("restore_view", json!({"index":0})).unwrap();
    let file = dir.path().join("playback.chronoscope");
    e.invoke("save", json!({"path":file})).unwrap();
    e.invoke("open", json!({"path":file})).unwrap();
    let restored = e.invoke("snapshot", json!({})).unwrap();
    assert_eq!(restored["scene"]["time_height"], 0.0);
    assert_eq!(restored["scene"]["playback_fade"], false);
}
#[test]
fn legacy_scenes_default_to_fading_and_height_validation_stays_bounded() {
    let old: SceneState = serde_json::from_value(json!({})).unwrap();
    assert!(old.playback_fade.unwrap_or(true));
    for height in [0.0, 0.1, 1.2, 2.8, 5.0] {
        let s: SceneState = serde_json::from_value(json!({"time_height":height})).unwrap();
        s.validate().unwrap();
    }
    for height in [-0.1, 5.1] {
        let s: SceneState = serde_json::from_value(json!({"time_height":height})).unwrap();
        assert!(s.validate().is_err());
    }
    let dir = tempfile::tempdir().unwrap();
    let e = Engine::new(
        Project::new(chronoscope::demo::dataset()),
        dir.path().into(),
    )
    .unwrap();
    assert!(e
        .invoke("view_set", json!({"playback_fade":"false"}))
        .is_err());
    assert!(e.invoke("view_set", json!({"time_height":-0.1})).is_err());
}

#[test]
fn agent_playback_configuration_exposes_fade() {
    let schema = chronoscope::schema::command_schema("view_playback").unwrap();
    let text = serde_json::to_string(&schema).unwrap();
    assert!(text.contains("fade"));
    assert_eq!(
        chronoscope::schema::domain_output_schema("view_playback")["properties"]["fade"]["type"],
        "boolean"
    );
    assert!(chronoscope::schema::validate(
        "view_playback",
        &json!({"action":"configure","fade":false})
    )
    .is_ok());
}

#[test]
fn display_preferences_default_to_system_and_preserve_explicit_legacy_choices() {
    use chronoscope::engine::Preferences;
    let defaults = Preferences::default();
    assert_eq!(defaults.theme, "system");
    assert_eq!(defaults.date_format, "system");
    assert_eq!(defaults.time_format, "system");
    let legacy: Preferences = serde_json::from_value(json!({"theme":"dark"})).unwrap();
    assert_eq!(legacy.theme, "dark");
    assert_eq!(legacy.date_format, "system");
    legacy.validate().unwrap();
}

#[test]
fn display_formats_persist_without_changing_event_times_and_reject_unknown_formats() {
    let dir = tempfile::tempdir().unwrap();
    let engine = Engine::new(
        Project::new(chronoscope::demo::dataset()),
        dir.path().into(),
    )
    .unwrap();
    let before = engine
        .invoke("query", json!({"limit":3,"fields":["id","time"]}))
        .unwrap();
    for date in [
        "system",
        "iso",
        "mdy",
        "mdy-short",
        "dmy",
        "dmy-short",
        "dmy-dots",
        "dmy-long",
        "mdy-long",
    ] {
        engine
            .invoke(
                "preferences",
                json!({"preferences":{"date_format":date,"time_format":"12h-seconds"}}),
            )
            .unwrap();
    }
    assert!(engine
        .invoke(
            "preferences",
            json!({"preferences":{"date_format":"unknown"}})
        )
        .is_err());
    assert!(engine
        .invoke(
            "preferences",
            json!({"preferences":{"time_format":"unknown"}})
        )
        .is_err());
    let after = engine
        .invoke("query", json!({"limit":3,"fields":["id","time"]}))
        .unwrap();
    assert_eq!(before["events"], after["events"]);
    drop(engine);
    let reopened = Engine::new(
        Project::new(chronoscope::demo::dataset()),
        dir.path().into(),
    )
    .unwrap();
    let preferences = reopened.invoke("preferences", json!({})).unwrap();
    assert_eq!(preferences["date_format"], "mdy-long");
    assert_eq!(preferences["time_format"], "12h-seconds");
}
