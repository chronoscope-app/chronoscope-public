use chronoscope::{demos, engine::Engine, project::Project};
use serde_json::json;

#[test]
fn priority_sources_preserve_measurements_and_disable_journey_lines() {
    let dir = tempfile::tempdir().unwrap();
    for (id, count) in [
        ("earthquakes", 8500),
        ("fire-detections", 50713),
        ("electricity-access", 5746),
        ("covid", 6509),
    ] {
        let project = demos::load(id, dir.path()).unwrap();
        assert_eq!(project.dataset.events.len(), count);
        assert!(!project.provenance.is_empty());
        for view in &project.views {
            let display = view.scene.display.as_ref().unwrap();
            assert!(!display.show_tracks && !display.show_trails);
        }
        for event in &project.dataset.events {
            if id == "earthquakes" {
                assert_eq!(
                    event.attrs["mag"].parse::<f64>().unwrap(),
                    event.value.unwrap()
                );
                assert!(event.attrs["time"].starts_with("2025-"));
                assert_eq!(event.attrs["net"], "us");
            } else if id == "fire-detections" {
                assert_eq!(
                    event.attrs["frp"].parse::<f64>().unwrap(),
                    event.value.unwrap()
                );
                assert!(event.value.unwrap() >= 0.);
                assert!(matches!(
                    event.attrs["confidence"].as_str(),
                    "nominal" | "high"
                ));
            } else if id == "covid" {
                assert!(event.value.unwrap() >= 0.);
                assert_eq!(event.attrs["value_unit"], "cumulative confirmed cases");
                assert!(event.attrs["position_method"].contains("not case location"));
            } else {
                assert!(event.geometry_wkt.is_some());
                assert_eq!(
                    event.value.is_none(),
                    event.attrs["observation_status"] == "missing"
                );
                assert!(event.value.is_none_or(|v| (0.0..=100.0).contains(&v)));
            }
        }
    }
}

#[test]
fn country_polygons_keep_values_and_year_filters_through_portable_reopen() {
    let dir = tempfile::tempdir().unwrap();
    let engine = Engine::new(Project::empty(), dir.path().into()).unwrap();
    engine
        .invoke("demo_open", json!({"id":"electricity-access"}))
        .unwrap();
    let shapes = engine
        .invoke(
            "render_geometries",
            json!({"limit":1000,"max_vertices":200000}),
        )
        .unwrap();
    assert_eq!(shapes["count"], 169);
    assert_eq!(shapes["limited"], false);
    let features = shapes["features"].as_array().unwrap();
    assert!(features.iter().any(|f| f["value"].is_number()));
    let before = engine.invoke("snapshot", json!({"compact":true})).unwrap();
    assert_eq!(before["visible"], 169);
    assert_eq!(before["scene"]["measurement"]["minimum"], 0.);
    assert_eq!(before["scene"]["measurement"]["maximum"], 100.);
    engine
        .invoke("filter", json!({"filter":{"start":null,"end":null}}))
        .unwrap();
    let wide = engine
        .invoke(
            "render_geometries",
            json!({"limit":1000,"max_vertices":200000}),
        )
        .unwrap();
    assert_eq!(
        wide["count"], 169,
        "Full range must not blend 34 annual polygons per country"
    );
    assert_eq!(wide["limited"], false);
    assert_eq!(
        wide["features"], shapes["features"],
        "Full range uses the latest year, including nulls"
    );
    let view = engine.invoke("restore_view", json!({"index":2})).unwrap();
    assert_eq!(view["scene"]["measurement"], before["scene"]["measurement"]);
    let path = dir.path().join("electricity.chronoscope");
    engine.invoke("save", json!({"path":path})).unwrap();
    engine.invoke("open", json!({"path":path})).unwrap();
    let after = engine.invoke("snapshot", json!({"compact":true})).unwrap();
    assert_eq!(after["visible"], 169);
    assert_eq!(
        after["scene"]["measurement"],
        before["scene"]["measurement"]
    );
    assert!(
        after["filter"]["start"].as_f64().unwrap() < before["filter"]["start"].as_f64().unwrap()
    );
    let shapes = engine
        .invoke(
            "render_geometries",
            json!({"limit":1000,"max_vertices":200000}),
        )
        .unwrap();
    assert!(shapes["features"]
        .as_array()
        .unwrap()
        .iter()
        .any(|f| f["value"].is_null()));
}

#[test]
fn invalid_measurement_ranges_are_rejected_without_replacing_the_scene() {
    let dir = tempfile::tempdir().unwrap();
    let engine = Engine::new(Project::empty(), dir.path().into()).unwrap();
    assert!(engine.invoke("scene_sync", json!({"scene":{"measurement":{"title":"Percent","unit":"%","minimum":100,"maximum":0}}})).is_err());
    assert!(engine.invoke("snapshot", json!({})).unwrap()["scene"]["measurement"].is_null());
}

#[test]
fn every_catalog_preview_points_to_a_real_saved_view() {
    let dir = tempfile::tempdir().unwrap();
    assert_eq!(demos::DEMOS.len(), 16);
    for demo in demos::DEMOS {
        let project = demos::load(demo.id, dir.path()).unwrap();
        for preview in demo.previews {
            assert!(
                preview.view_index < project.views.len(),
                "{}: {}",
                demo.id,
                preview.key
            );
        }
    }
}

#[test]
fn heat_only_demo_retains_exact_cells_without_hidden_source_glyphs() {
    let dir = tempfile::tempdir().unwrap();
    let engine = Engine::new(Project::empty(), dir.path().into()).unwrap();
    engine
        .invoke("demo_open", json!({"id":"fire-detections"}))
        .unwrap();
    let view = engine
        .invoke(
            "view_snapshot_v1",
            json!({"version":1,"generation":"fire","include_render":true,"display_level":5}),
        )
        .unwrap();
    assert_eq!(view["display"]["count"], 50713);
    assert_eq!(view["render"]["rendered_count"], 0);
    engine
        .invoke("select", json!({"ids":["1"],"mode":"replace"}))
        .unwrap();
    let selected = engine
        .invoke(
            "view_snapshot_v1",
            json!({"version":1,"generation":"selected","include_render":true,"display_level":5}),
        )
        .unwrap();
    assert_eq!(selected["display"]["count"], 50713);
    assert_eq!(selected["render"]["ids"], json!(["1"]));
}
