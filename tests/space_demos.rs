use chronoscope::{altitude::AltitudeReference, demos, engine::Engine, project::Project};
use serde_json::{json, Value};
use std::collections::{BTreeMap, BTreeSet};

#[test]
fn starlink_keeps_original_cadence_unique_catalog_ids_and_geographic_height() {
    let dir = tempfile::tempdir().unwrap();
    let p = demos::load("starlink-orbits", dir.path()).unwrap();
    p.validate().unwrap();
    assert_eq!(p.dataset.events.len(), 46208);
    let mut times: BTreeMap<&str, Vec<f64>> = BTreeMap::new();
    for e in &p.dataset.events {
        times.entry(&e.entity).or_default().push(e.time);
        assert!(e.entity.contains(&format!("[{}]", e.attrs["norad_id"])));
        let h = e.altitude.unwrap();
        assert_eq!(h.reference, AltitudeReference::Ellipsoid);
        assert!((279000.0..=596000.0).contains(&h.meters));
        assert!((e.value.unwrap() - h.meters / 1000.0).abs() < 1e-9);
        assert!(e.attrs["position_kind"].contains("prediction"));
    }
    assert_eq!(times.len(), 128);
    for epochs in times.values_mut() {
        epochs.sort_by(f64::total_cmp);
        assert_eq!(epochs.len(), 361);
        assert!(epochs.windows(2).all(|w| (w[1] - w[0] - 60.0).abs() < 1e-6));
    }
    assert!(p.dataset.events.iter().any(|e| e.lon.unwrap() > 179.0));
    assert!(p.dataset.events.iter().any(|e| e.lon.unwrap() < -179.0));
    assert!(p.dataset.events.iter().any(|e| e.lat.unwrap() > 69.0));
    assert!(p.dataset.events.iter().any(|e| e.lat.unwrap() < -69.0));
    assert!(p.scene.globe_altitude && !p.scene.globe_time);
    let display = p.scene.display.as_ref().unwrap();
    assert!(display.show_tracks && !display.show_trails);
    assert!(p.provenance[0].changes.contains("not measured"));
    let report: Value =
        serde_json::from_str(include_str!("../samples/public/space-provenance.json")).unwrap();
    // Independent WGS84 forward calculation checks the generator's geodetic
    // coordinates against its stored Earth-fixed transformation controls.
    for control in report["starlink"]["controls"].as_array().unwrap() {
        let lat = control["lat"].as_f64().unwrap().to_radians();
        let lon = control["lon"].as_f64().unwrap().to_radians();
        let h = control["height_m"].as_f64().unwrap();
        let e2 = 6.6943799901413165e-3;
        let n = 6378137.0 / (1.0 - e2 * lat.sin().powi(2)).sqrt();
        let xyz = [
            (n + h) * lat.cos() * lon.cos(),
            (n + h) * lat.cos() * lon.sin(),
            (n * (1.0 - e2) + h) * lat.sin(),
        ];
        for (i, value) in xyz.iter().enumerate() {
            assert!((value - control["itrs_m"][i].as_f64().unwrap()).abs() < 0.001);
        }
    }
}

#[test]
fn falcon_history_preserves_pads_dates_failures_and_unknown_flight_altitude() {
    let dir = tempfile::tempdir().unwrap();
    let p = demos::load("falcon9-launches", dir.path()).unwrap();
    p.validate().unwrap();
    assert_eq!(p.dataset.events.len(), 700);
    let entities: BTreeSet<_> = p.dataset.events.iter().map(|e| &e.entity).collect();
    assert_eq!(entities.len(), 700);
    let mut pads = BTreeMap::new();
    for e in &p.dataset.events {
        *pads.entry(e.category.as_str()).or_insert(0) += 1;
        assert!(e.altitude.is_none());
        assert_eq!(e.attrs["LV_Type"], "Falcon 9");
        assert!(e.attrs["position_kind"].contains("not flight trajectory"));
        assert!((-121.0..=-80.0).contains(&e.lon.unwrap()));
        if let Some(end) = e.end {
            assert_eq!(end - e.time, 60.0);
        }
    }
    assert_eq!(pads.values().sum::<usize>(), 700);
    assert_eq!(pads["Cape Canaveral · SLC-40"], 349);
    assert_eq!(pads["Kennedy · LC-39A"], 114);
    assert_eq!(pads["Vandenberg · SLC-4E"], 237);
    assert_eq!(
        p.dataset.events.iter().filter(|e| e.end.is_some()).count(),
        141
    );
    assert_eq!(
        p.dataset
            .events
            .iter()
            .filter(|e| e.attrs["utc_precision"] == "approximate")
            .count(),
        2
    );
    assert!(p
        .dataset
        .events
        .iter()
        .any(|e| e.attrs["LaunchCode"].starts_with("OF")));
    assert!(p
        .dataset
        .events
        .iter()
        .any(|e| e.attrs["Flight"] == "Dragon IFA"));
    assert!(p.dataset.events.first().unwrap().time < 1_280_000_000.0);
    assert!(p.dataset.events.last().unwrap().time > 1_790_000_000.0);
    assert!(p.scene.globe_time && !p.scene.globe_altitude);
    for view in &p.views {
        let d = view.scene.display.as_ref().unwrap();
        assert!(!d.show_tracks && !d.show_trails);
    }
}

#[test]
fn retired_rocket_demo_cannot_replace_a_workspace_and_new_ids_are_discoverable() {
    let dir = tempfile::tempdir().unwrap();
    let e = Engine::new(Project::empty(), dir.path().into()).unwrap();
    let before = e.invoke("snapshot", json!({})).unwrap();
    assert!(e
        .invoke("demo_open", json!({"id":"rocket-altitude"}))
        .is_err());
    assert_eq!(before, e.invoke("snapshot", json!({})).unwrap());
    let schema = chronoscope::schema::command_schema("demo_open").unwrap();
    let ids = schema["properties"]["id"]["enum"].as_array().unwrap();
    assert!(ids.contains(&json!("starlink-orbits")) && ids.contains(&json!("falcon9-launches")));
    assert!(!ids.contains(&json!("rocket-altitude")));
    assert_eq!(demos::DEMOS.len(), 16);
}

#[test]
fn bundled_starlink_data_previews_and_credit_stay_below_five_megabytes() {
    let bytes = include_bytes!("../samples/starlink-128-predicted-orbits-2024.chronoscope").len()
        + include_bytes!("../frontend/public/demos/starlink-orbits-globe.jpg").len()
        + include_bytes!("../frontend/public/demos/starlink-orbits-time.jpg").len()
        + include_bytes!(
            "../samples/public/starlink-128-predicted-orbits-2024.csv.attribution.json"
        )
        .len()
        + include_bytes!("../samples/public/space-provenance.json").len()
        + include_bytes!("../docs/SPACE-DEMOS.md").len();
    assert!(
        bytes <= 5_000_000,
        "Bundled Starlink data and credit: {bytes} bytes"
    );
    let notices = include_str!("../scripts/package-notices.mjs");
    assert!(!notices.contains("ephemeris_state.parquet"));
    assert!(!notices.contains("starlink-full-stress"));
}
