use chronoscope::{engine::Engine, project::Project};
use serde_json::json;

fn check_demos(cases: &[(&str, usize, usize, &str)]) {
    let data = tempfile::tempdir().unwrap();
    let engine = Engine::new(Project::empty(), data.path().into()).unwrap();
    let catalog = engine.invoke("demo_catalog", json!({})).unwrap();
    assert_eq!(catalog["demos"].as_array().unwrap().len(), 16);
    assert_eq!(engine.invoke("snapshot", json!({})).unwrap()["count"], 0);
    for &(id, count, entities, attribute) in cases {
        let opened = engine.invoke("demo_open", json!({"id":id})).unwrap();
        assert!(opened["scene"].is_object());
        let snapshot = engine.invoke("snapshot", json!({"compact":false})).unwrap();
        assert_eq!(snapshot["count"], count);
        assert_eq!(snapshot["entities"].as_object().unwrap().len(), entities);
        assert!(snapshot["views"].as_array().unwrap().len() >= 3);
        let rows = engine.invoke("query", json!({"limit":1})).unwrap();
        assert!(rows["events"][0]["attrs"][attribute].is_string(), "{rows}");
        let status = engine.invoke("workspace_status", json!({})).unwrap();
        assert!(
            status["source"].is_null(),
            "Never save over a bundled example"
        );
        assert_eq!(status["dirty"], true);
        let copy = data.path().join(format!("{id}.chronoscope"));
        engine.invoke("save", json!({"path":copy})).unwrap();
        engine.invoke("open", json!({"path":copy})).unwrap();
        assert_eq!(
            engine.invoke("snapshot", json!({})).unwrap()["count"],
            count
        );
    }
}

#[test]
fn representative_demo_is_an_editable_portable_copy() {
    check_demos(&[("local-wildlife", 3439, 3, "event-id")]);
}

#[test]
#[ignore = "full bundled-data matrix; run validate_local.py --tier full"]
fn bundled_demos_are_editable_copies_with_original_attributes_and_saved_views() {
    check_demos(&[
        ("noaa-ais", 8473, 10, "mmsi"),
        ("animal-gps", 15697, 3, "event-id"),
        ("hurricanes", 3568, 83, "storm_id"),
        ("local-wildlife", 3439, 3, "event-id"),
        ("stork-migration", 6090, 3, "individual-local-identifier"),
        ("elephant-seals", 15501, 3, "MAXDEPTH"),
    ]);
}

#[test]
fn invalid_demo_id_preserves_current_workspace_and_scoped_mcp_can_open_known_demos() {
    let data = tempfile::tempdir().unwrap();
    let root = tempfile::tempdir().unwrap();
    let engine = Engine::new(Project::empty(), data.path().into()).unwrap();
    assert!(engine
        .invoke("demo_open", json!({"id":"../../private"}))
        .is_err());
    assert_eq!(engine.invoke("snapshot", json!({})).unwrap()["count"], 0);
    let result = chronoscope::mcp::handle(&engine, root.path(), json!({"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"chronoscope_demo_open","arguments":{"id":"noaa-ais"}}})).unwrap();
    assert_eq!(result["result"]["isError"], false, "{result}");
    assert_eq!(engine.invoke("snapshot", json!({})).unwrap()["count"], 8473);
    let before = engine.invoke("snapshot", json!({})).unwrap();
    assert!(engine.invoke("demo_open", json!({"id":"missing"})).is_err());
    assert_eq!(engine.invoke("snapshot", json!({})).unwrap(), before);
}

#[test]
fn seal_dive_values_intervals_and_saved_chart_keep_the_published_meaning() {
    let data = tempfile::tempdir().unwrap();
    let project = chronoscope::demos::load("elephant-seals", data.path()).unwrap();
    let mut deepest = 0.0_f64;
    for event in &project.dataset.events {
        let depth: f64 = event.attrs["MAXDEPTH"].parse().unwrap();
        let duration: f64 = event.attrs["DURATION"].parse().unwrap();
        assert_eq!(event.value, Some(depth));
        assert_eq!(event.attrs["value_unit"], "m");
        assert!(event.attrs["position_method"].contains("modelled"));
        // Both endpoints use the app's minute clock, with original seconds kept.
        assert!(((event.end.unwrap() - event.time) - duration).abs() < 60.0);
        deepest = deepest.max(depth);
    }
    assert_eq!(
        project.scene.chart_presets[0].name,
        "Daily deepest dive (m)"
    );
    let config = project.scene.chart.clone().unwrap();
    let engine = Engine::new(project, data.path().into()).unwrap();
    let chart = engine
        .invoke("chart_data", json!({"config":config}))
        .unwrap();
    assert_eq!(chart["input_count"], 15501);
    assert_eq!(chart["evaluated_count"], 15501);
    assert_eq!(chart["excluded_count"], 0);
    let chart_max = chart["rows"]
        .as_array()
        .unwrap()
        .iter()
        .filter_map(|row| row["y"].as_f64())
        .fold(0.0_f64, f64::max);
    assert_eq!(chart_max, deepest);
}
