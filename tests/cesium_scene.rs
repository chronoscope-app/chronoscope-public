use chronoscope::{
    engine::Engine,
    model::Dataset,
    project::{Project, SceneState},
};
use serde_json::{json, Value};
fn camera() -> Value {
    json!({"renderer":"cesium","mode":"globe","cesium_camera":{"position":[12756274.,0.,0.],"direction":[-1.,0.,0.],"up":[0.,0.,1.]}})
}

#[test]
fn calendar_is_removed_from_commands_but_saved_workspaces_migrate() {
    let dir = tempfile::tempdir().unwrap();
    let mut project = Project::new(chronoscope::demo::dataset());
    project.selected.insert(project.dataset.events[0].id);
    let mut legacy = serde_json::to_value(&project).unwrap();
    let mut scene = camera();
    scene["mode"] = json!("calendar");
    scene["bounds"] = json!([-4., -3., 4., 3.]);
    scene["position"] = json!([1., 2., 3.]);
    scene["target"] = json!([0., 0., 0.]);
    scene["camera_zoom"] = json!(2.);
    scene["camera_up"] = json!([0., 1., 0.]);
    legacy["scene"] = scene.clone();
    legacy["mode"] = json!("Calendar");
    legacy["views"] = json!([{
        "name":"Weekly activity", "scene":scene, "mode":"Calendar",
        "filter":legacy["filter"], "selected":legacy["selected"],
        "camera":legacy["camera"]
    }]);
    let path = dir.path().join("legacy.chrono.json");
    std::fs::write(&path, serde_json::to_vec(&legacy).unwrap()).unwrap();
    let migrated = chronoscope::project::load(&path).unwrap();
    assert_eq!(
        serde_json::to_value(&migrated.dataset).unwrap(),
        legacy["dataset"]
    );
    assert_eq!(migrated.selected, project.selected);
    assert_eq!(migrated.views[0].name, "Weekly activity");
    assert_eq!(migrated.views[0].selected, project.selected);
    for state in [&migrated.scene, &migrated.views[0].scene] {
        state.validate().unwrap();
        assert_eq!(state.mode, "space-time");
        assert!(state.cesium_camera.is_none());
        assert!(state.position.is_none());
        assert!(state.target.is_none());
        assert!(state.camera_up.is_none());
        assert!(state.camera_zoom.is_none());
        assert!(state.bounds.is_none());
    }
    let engine = Engine::new(migrated, dir.path().join("profile")).unwrap();
    assert_eq!(
        engine.invoke("capabilities", json!({})).unwrap()["renderer"]["modes"],
        json!(["space-time", "map", "globe"])
    );
    assert!(engine
        .invoke("view_set", json!({"mode":"calendar"}))
        .is_err());
    assert!(engine
        .invoke("scene_sync", json!({"scene":legacy["scene"]}))
        .is_err());
    // SQLite workspaces and recovery metadata decode the same Project fields.
    let sqlite = dir.path().join("legacy.chronoscope");
    let mut store = chronoscope::store::DataStore::new(&dir.path().join("sqlite-source")).unwrap();
    store.load_events(project.dataset.events.clone()).unwrap();
    store.save_as(&sqlite, &project).unwrap();
    let db = rusqlite::Connection::open(&sqlite).unwrap();
    let text: String = db
        .query_row("SELECT value FROM meta WHERE key='project'", [], |r| {
            r.get(0)
        })
        .unwrap();
    let mut metadata: Value = serde_json::from_str(&text).unwrap();
    metadata["scene"] = legacy["scene"].clone();
    metadata["views"] = legacy["views"].clone();
    metadata["mode"] = json!("Calendar");
    db.execute(
        "UPDATE meta SET value=? WHERE key='project'",
        [metadata.to_string()],
    )
    .unwrap();
    drop(db);
    let reopened = Engine::from_path(&sqlite, dir.path().join("reopened"), None).unwrap();
    let snapshot = reopened.invoke("snapshot", json!({})).unwrap();
    assert_eq!(snapshot["scene"]["mode"], "space-time");
    assert_eq!(snapshot["count"], project.dataset.events.len());
    assert_eq!(snapshot["selected_count"], 1);
    assert_eq!(snapshot["views"][0]["scene"]["mode"], "space-time");
}
#[test]
fn cesium_camera_roundtrips_without_becoming_event_coordinates() {
    let dir = tempfile::tempdir().unwrap();
    let engine = Engine::new(
        Project::new(chronoscope::demo::dataset()),
        dir.path().join("profile"),
    )
    .unwrap();
    let events = engine.invoke("events", json!({"limit":5})).unwrap()["events"].clone();
    engine
        .invoke("scene_sync", json!({"scene":camera()}))
        .unwrap();
    let path = dir.path().join("cesium.chronoscope");
    engine.invoke("save", json!({"path":path})).unwrap();
    let loaded = Engine::from_path(&path, dir.path().join("reopen"), None).unwrap();
    let snap = loaded.invoke("snapshot", json!({})).unwrap();
    assert_eq!(snap["scene"]["renderer"], "cesium");
    assert_eq!(snap["scene"]["cesium_camera"], camera()["cesium_camera"]);
    assert_eq!(
        loaded.invoke("events", json!({"limit":5})).unwrap()["events"],
        events
    );
    let legacy: SceneState =
        serde_json::from_value(json!({"mode":"map","position":[1.,2.,3.],"target":[0.,0.,0.]}))
            .unwrap();
    legacy.validate().unwrap();
    assert!(legacy.cesium_camera.is_none());
}
#[test]
fn invalid_cesium_camera_is_rejected_and_agent_fit_clears_it() {
    let dir = tempfile::tempdir().unwrap();
    let engine = Engine::new(Project::new(Dataset::default()), dir.path().into()).unwrap();
    for patch in [
        json!({"position":[1e11,0.,0.]}),
        json!({"direction":[0.,0.,0.]}),
        json!({"up":[-1.,0.,0.]}),
        json!({"frustum_width":0.}),
    ] {
        let mut scene = camera();
        for (key, value) in patch.as_object().unwrap() {
            scene["cesium_camera"][key] = value.clone();
        }
        assert!(engine.invoke("scene_sync", json!({"scene":scene})).is_err());
    }
    engine
        .invoke("scene_sync", json!({"scene":camera()}))
        .unwrap();
    engine.invoke("view_set", json!({"mode":"map"})).unwrap();
    assert!(engine.invoke("snapshot", json!({})).unwrap()["scene"]["cesium_camera"].is_null());
    engine
        .invoke("scene_sync", json!({"scene":camera()}))
        .unwrap();
    engine.invoke("view_set", json!({"fit":true})).unwrap();
    assert!(engine.invoke("snapshot", json!({})).unwrap()["scene"]["cesium_camera"].is_null());
}
#[test]
fn terrain_datum_requires_explicit_choice_and_saves_with_workspace() {
    let dir = tempfile::tempdir().unwrap();
    let engine = Engine::new(Project::new(Dataset::default()), dir.path().join("profile")).unwrap();
    let prefs = engine.invoke("preferences", json!({})).unwrap();
    assert_eq!(prefs["terrain_vertical_datum"], "unresolved-msl");
    assert!(engine
        .invoke(
            "preferences",
            json!({"preferences":{"terrain_vertical_datum":"invented"}})
        )
        .is_err());
    let mut chosen = prefs;
    chosen["terrain_vertical_datum"] = json!("egm96");
    engine
        .invoke("preferences", json!({"preferences":chosen}))
        .unwrap();
    let path = dir.path().join("datum.chronoscope");
    engine.invoke("save", json!({"path":path})).unwrap();
    let reopened = Engine::from_path(&path, dir.path().join("reopen"), None).unwrap();
    assert_eq!(
        reopened.invoke("preferences", json!({})).unwrap()["terrain_vertical_datum"],
        "egm96"
    );
}

#[test]
fn geographic_cesium_summary_retains_polar_events_in_flat_modes() {
    let dir = tempfile::tempdir().unwrap();
    let csv = dir.path().join("polar.csv");
    std::fs::write(&csv,"entity,timestamp,latitude,longitude\nA,2026-10-15T10:00Z,89,40\nB,2026-10-15T10:01Z,-89,-40\n").unwrap();
    let engine = Engine::new(Project::new(Dataset::default()), dir.path().join("profile")).unwrap();
    let preview = engine
        .invoke("import_preview", json!({"path":csv}))
        .unwrap();
    engine
        .invoke("import_commit", json!({"import_id":preview["import_id"]}))
        .unwrap();
    for mode in ["map", "space-time", "globe"] {
        engine
            .invoke(
                "view_set",
                json!({"mode":mode,"display":{"mode":"clusters"}}),
            )
            .unwrap();
        let packet = engine
            .invoke(
                "view_snapshot_v1",
                json!({"version":1,"generation":"polar-test","include_render":true,"display_level":4}),
            )
            .unwrap();
        assert_eq!(packet["display"]["count"], 2, "{mode}");
        let mut latitudes = packet["display"]["bins"]
            .as_array()
            .unwrap()
            .iter()
            .map(|b| b["latitude"].as_f64().unwrap())
            .collect::<Vec<_>>();
        latitudes.sort_by(f64::total_cmp);
        assert_eq!(latitudes, [-89., 89.]);
    }
}

#[test]
fn globe_time_is_optional_portable_agent_state_without_changing_source_events() {
    let dir = tempfile::tempdir().unwrap();
    let e = Engine::new(
        Project::new(chronoscope::demo::dataset()),
        dir.path().join("profile"),
    )
    .unwrap();
    assert!(!SceneState::default().globe_time);
    assert!(SceneState::default().globe_time_scale.is_none());
    assert!(
        !serde_json::from_value::<SceneState>(json!({"mode":"globe"}))
            .unwrap()
            .globe_time
    );
    let before = e.invoke("events", json!({"limit":5})).unwrap()["events"].clone();
    e.invoke(
        "view_set",
        json!({"mode":"globe","globe_time":true,"globe_time_scale":1.5,"time_height":3.2}),
    )
    .unwrap();
    let scene = e.invoke("snapshot", json!({})).unwrap()["scene"].clone();
    e.invoke("save_view", json!({"name":"Globe time","scene":scene}))
        .unwrap();
    e.invoke("view_set", json!({"globe_time":false})).unwrap();
    let restored = e.invoke("restore_view", json!({"index":0})).unwrap();
    assert_eq!(restored["scene"]["globe_time"], true);
    let path = dir.path().join("globe-time.chronoscope");
    e.invoke("save", json!({"path":path})).unwrap();
    let reopened = Engine::from_path(&path, dir.path().join("reopened"), None).unwrap();
    let snap = reopened.invoke("snapshot", json!({})).unwrap();
    assert_eq!(snap["scene"]["globe_time"], true);
    assert_eq!(snap["scene"]["time_height"], 3.2);
    assert_eq!(snap["scene"]["globe_time_scale"], 1.5);
    assert_eq!(
        reopened.invoke("events", json!({"limit":5})).unwrap()["events"],
        before
    );
    assert!(reopened
        .invoke("view_set", json!({"globe_time":"yes"}))
        .is_err());
    for scale in [0., 21.] {
        assert!(reopened
            .invoke("view_set", json!({"globe_time_scale":scale}))
            .is_err());
    }
}

#[test]
fn globe_time_clusters_retain_time_slabs_and_ground_effects_stay_flat() {
    let dir = tempfile::tempdir().unwrap();
    let csv = dir.path().join("time.csv");
    std::fs::write(&csv,"entity,timestamp,latitude,longitude\nA,2026-10-15T00:00Z,0,0\nA,2026-10-15T01:00Z,0,0\nA,2026-10-15T02:00Z,0,0\n").unwrap();
    let e = Engine::new(Project::new(Dataset::default()), dir.path().join("profile")).unwrap();
    let preview = e.invoke("import_preview", json!({"path":csv})).unwrap();
    e.invoke("import_commit", json!({"import_id":preview["import_id"]}))
        .unwrap();
    let read = || {
        e.invoke(
            "view_snapshot_v1",
            json!({"version":1,"generation":"globe-time","include_render":true,"display_level":4}),
        )
        .unwrap()
    };
    e.invoke(
        "view_set",
        json!({"mode":"globe","globe_time":false,"display":{"mode":"clusters","bloom":false}}),
    )
    .unwrap();
    assert_eq!(read()["display"]["bins"].as_array().unwrap().len(), 1);
    e.invoke("view_set", json!({"globe_time":true})).unwrap();
    let elevated = read();
    assert_eq!(elevated["display"]["count"], 3);
    assert_eq!(elevated["display"]["bins"].as_array().unwrap().len(), 3);
    assert!(elevated["display"]["time_bin_minutes"].as_u64().unwrap() > 0);
    for display in [
        json!({"mode":"heatmap","bloom":false}),
        json!({"mode":"points","bloom":true}),
        json!({"mode":"density","bloom":false}),
    ] {
        e.invoke("view_set", json!({"display":display})).unwrap();
        let surface = read();
        assert_eq!(surface["display"]["time_bin_minutes"], 0);
        assert_eq!(surface["display"]["count"], 3);
    }
}
