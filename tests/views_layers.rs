use chronoscope::{
    engine::Engine,
    model::Filter,
    project::{self, Project, SceneState},
};
use serde_json::{json, Value};
fn engine(dir: &std::path::Path) -> Engine {
    let mut data = chronoscope::demo::dataset();
    data.events.truncate(4);
    for (i, e) in data.events.iter_mut().enumerate() {
        e.source = if i < 2 {
            "Source A / CSV"
        } else {
            "Source B / Sheet1"
        }
        .into();
        e.attrs.insert(
            "confidence".into(),
            if i % 2 == 0 { "2" } else { "10" }.into(),
        );
        e.attrs
            .insert("mixed".into(), ["2", "10", "1a", "NaN"][i].into());
    }
    data.events[3].lat = None;
    data.events[3].lon = None;
    Engine::new(Project::new(data), dir.into()).unwrap()
}
#[test]
fn entity_colors_and_line_strengths_survive_views_and_documents() {
    let dir = tempfile::tempdir().unwrap();
    let e = engine(dir.path());
    let scene = json!({"entity_colors":{"Survey team":"#e1a344"},"display":{"show_points":false,"point_scale":1.6,"show_tracks":false,"show_trails":true,"track_opacity":0.4,"trail_opacity":0.6}});
    e.invoke("scene_sync", json!({"scene":scene})).unwrap();
    e.invoke("save_view", json!({"name":"Styled","scene":scene}))
        .unwrap();
    e.invoke("scene_sync", json!({"scene":{}})).unwrap();
    let restored = e.invoke("restore_view", json!({"index":0})).unwrap();
    assert_eq!(restored["scene"]["entity_colors"]["Survey team"], "#e1a344");
    let file = dir.path().join("styled.chronoscope");
    e.invoke("save", json!({"path":file})).unwrap();
    e.invoke("open", json!({"path":file})).unwrap();
    let snapshot = e.invoke("snapshot", json!({})).unwrap();
    assert_eq!(snapshot["scene"]["display"]["track_opacity"], 0.4);
    assert_eq!(snapshot["scene"]["display"]["trail_opacity"], 0.6);
    assert_eq!(snapshot["scene"]["display"]["show_points"], false);
    assert_eq!(snapshot["scene"]["entity_colors"]["Survey team"], "#e1a344");
    assert!(e
        .invoke(
            "view_set",
            json!({"entity_colors":{"Survey team":"url(bad)"}})
        )
        .is_err());
    assert!(e
        .invoke("view_set", json!({"display":{"point_scale":5}}))
        .is_err());
    assert_eq!(
        e.invoke("snapshot", json!({})).unwrap()["scene"]["entity_colors"]["Survey team"],
        "#e1a344"
    );
    let legacy: SceneState = serde_json::from_value(json!({"display":{"bloom":true}})).unwrap();
    assert!(legacy.entity_colors.is_empty());
    assert!(legacy.display.unwrap().show_points);
}
#[test]
fn layers_filter_render_analysis_and_keep_hidden_source_inspectable() {
    let dir = tempfile::tempdir().unwrap();
    let e = engine(dir.path());
    let before = e.invoke("snapshot", json!({})).unwrap();
    assert_eq!(before["layers"].as_array().unwrap().len(), 2);
    let f = Filter {
        hidden_sources: ["Source B / Sheet1".into()].into(),
        ..Default::default()
    };
    e.invoke("filter", json!({"filter":f})).unwrap();
    let s = e.invoke("snapshot", json!({})).unwrap();
    assert_eq!(s["visible"], 2);
    assert_eq!(s["layers"][1]["enabled"], false);
    assert_eq!(
        e.invoke("render_data", json!({})).unwrap()["ids"]
            .as_array()
            .unwrap()
            .len(),
        2
    );
    let all = e
        .invoke("attribute_table", json!({"source":"Source B / Sheet1"}))
        .unwrap();
    assert_eq!(all["count"], 2);
    assert!(all["events"]
        .as_array()
        .unwrap()
        .iter()
        .any(|r| r["lat"].is_null()));
    assert_eq!(
        e.invoke(
            "attribute_table",
            json!({"source":"Source B / Sheet1","apply_filter":true})
        )
        .unwrap()["count"],
        0
    );
    e.invoke("select_visible", json!({})).unwrap();
    assert_eq!(
        e.invoke("snapshot", json!({})).unwrap()["selected"]
            .as_array()
            .unwrap()
            .len(),
        2
    );
}
#[test]
fn attribute_table_numeric_sort_pagination_and_exact_ids() {
    let dir = tempfile::tempdir().unwrap();
    let e = engine(dir.path());
    let first = e
        .invoke(
            "attribute_table",
            json!({"source":"Source A / CSV","sort_by":"attribute:confidence","limit":1}),
        )
        .unwrap();
    assert_eq!(first["count"], 2);
    assert_eq!(first["events"][0]["attrs"]["confidence"], "2");
    assert!(first["events"][0]["id"].is_string());
    assert!(first["columns"]
        .as_array()
        .unwrap()
        .contains(&json!("attribute:confidence")));
    let second=e.invoke("attribute_table",json!({"source":"Source A / CSV","sort_by":"attribute:confidence","offset":1,"limit":1})).unwrap();
    assert_eq!(second["events"][0]["attrs"]["confidence"], "10");
    let desc = e
        .invoke(
            "attribute_table",
            json!({"sort_by":"attribute:confidence","descending":true}),
        )
        .unwrap();
    assert_eq!(desc["events"][0]["attrs"]["confidence"], "10");
    // Mixed numeric/text values must form one total order, even when lexical
    // and numeric ordering disagree (2 < 10, while "10" < "1a" < "2").
    let mixed = e
        .invoke("attribute_table", json!({"sort_by":"attribute:mixed"}))
        .unwrap();
    let values: Vec<_> = mixed["events"]
        .as_array()
        .unwrap()
        .iter()
        .map(|r| r["attrs"]["mixed"].as_str().unwrap())
        .collect();
    assert_eq!(values, ["2", "10", "1a", "NaN"]);
    assert!(e
        .invoke("attribute_table", json!({"sort_by":"unsupported"}))
        .is_err());
    assert_eq!(
        e.invoke("attribute_table", json!({"source":"absent"}))
            .unwrap()["count"],
        0
    );
}
#[test]
fn globe_map_zoom_and_attribute_table_state_roundtrip_in_v3_bundle() {
    let dir = tempfile::tempdir().unwrap();
    let e = engine(dir.path());
    let p = dir.path().join("study.chronoscope");
    let mut scene:SceneState=serde_json::from_value(json!({"mode":"globe","position":[5.,2.,1.],"target":[0.,0.,0.],"camera_zoom":1.,"camera_up":[0.6,0.8,0.],"table_source":"Source A / CSV","table_attributes":true,"table_respect_filters":true,"table_sort":"attribute:confidence","table_descending":true,"table_open":true})).unwrap();
    e.invoke(
        "filter",
        json!({"filter":{"hidden_sources":["Source B / Sheet1"]}}),
    )
    .unwrap();
    e.invoke("save", json!({"path":p,"scene":scene})).unwrap();
    let loaded = project::load_with_resources(&p, dir.path()).unwrap();
    assert_eq!(loaded.version, 7);
    assert_eq!(loaded.scene.mode, "globe");
    assert_eq!(loaded.scene.camera_up, Some([0.6, 0.8, 0.]));
    for bad in [[0., 0., 0.], [1., 1., 0.], [f64::NAN, 1., 0.]] {
        let mut invalid = loaded.scene.clone();
        invalid.camera_up = Some(bad);
        assert!(invalid.validate().is_err());
    }
    assert_eq!(loaded.scene.table_source.as_deref(), Some("Source A / CSV"));
    assert!(loaded.filter.hidden_sources.contains("Source B / Sheet1"));
    scene.mode = "map".into();
    scene.camera_zoom = Some(6.);
    e.invoke("save_view", json!({"name":"2D zoom","scene":scene}))
        .unwrap();
    let restored = e.invoke("restore_view", json!({"index":0})).unwrap();
    assert_eq!(restored["scene"]["camera_zoom"], 6.);
    assert_eq!(restored["scene"]["mode"], "map");
    let mut legacy: Value =
        serde_json::to_value(Project::new(chronoscope::demo::dataset())).unwrap();
    legacy["version"] = json!(2);
    legacy["scene"] = json!({"mode":"space-time"});
    legacy["filter"]
        .as_object_mut()
        .unwrap()
        .remove("hidden_sources");
    let path = dir.path().join("v2.json");
    std::fs::write(&path, serde_json::to_vec(&legacy).unwrap()).unwrap();
    assert_eq!(
        project::load_with_resources(&path, dir.path())
            .unwrap()
            .version,
        7
    );
}

#[test]
fn heat_and_bloom_preserve_events_in_every_map_view() {
    let dir = tempfile::tempdir().unwrap();
    let e = engine(dir.path());
    let default = chronoscope::display::DisplayOptions::default();
    assert_eq!(default.track_opacity, 0.25);
    assert_eq!(default.trail_opacity, 0.25);
    for mode in ["space-time", "map", "globe"] {
        for display in [
            json!({"mode":"heatmap","bloom":false}),
            json!({"mode":"points","bloom":true}),
            json!({"mode":"heatmap","bloom":true}),
        ] {
            e.invoke("view_set", json!({"mode":mode,"display":display}))
                .unwrap();
            let view = e
                .invoke(
                    "view_snapshot_v1",
                    json!({"version":1,"generation":"heat-overlay","include_render":true}),
                )
                .unwrap();
            assert_eq!(
                view["render"]["ids"].as_array().unwrap().len(),
                3,
                "{mode}: {display}"
            );
            assert_eq!(view["display"]["count"], 3);
        }
    }
}
