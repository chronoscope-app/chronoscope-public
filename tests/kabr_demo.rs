use chronoscope::{altitude::AltitudeReference, demos, engine::Engine, project::Project};
use serde_json::json;
use std::collections::{BTreeMap, BTreeSet};

#[test]
fn kabr_keeps_complete_flights_real_dates_relative_heights_and_original_amsl() {
    let dir = tempfile::tempdir().unwrap();
    let p = demos::load("kabr-uav", dir.path()).unwrap();
    assert_eq!(p.dataset.events.len(), 25924);
    let sources: BTreeSet<_> = p.dataset.events.iter().map(|e| &e.source).collect();
    assert_eq!(sources.len(), 1);
    let mut flights: BTreeMap<&str, Vec<_>> = BTreeMap::new();
    let mut unlocated = 0;
    for e in &p.dataset.events {
        flights.entry(&e.entity).or_default().push(e);
        let height: f64 = e.attrs["height_above_takeoff(feet)"].parse().unwrap();
        let amsl: f64 = e.attrs["altitude_above_seaLevel(feet)"].parse().unwrap();
        let altitude = e.altitude.unwrap();
        assert_eq!(altitude.reference, AltitudeReference::Reported);
        assert_eq!(altitude.meters, height * 0.3048);
        assert_eq!(e.value, Some(altitude.meters));
        assert!((e.attrs["reported_amsl_m"].parse::<f64>().unwrap() - amsl * 0.3048).abs() < 1e-10);
        assert_eq!(
            e.time,
            chronoscope::model::parse_time(
                &format!("{}Z", e.attrs["datetime(utc)"].replace(' ', "T")),
                "",
                0
            )
            .unwrap()
        );
        assert_eq!(e.category, e.attrs["flycState"]);
        assert!(e.source_row >= 2);
        assert!(e.note.contains("above takeoff"));
        if e.location().is_none() {
            unlocated += 1;
            assert_eq!(e.attrs["latitude"], "0");
            assert_eq!(e.attrs["longitude"], "0");
        }
    }
    assert_eq!(unlocated, 6);
    assert_eq!(flights.len(), 3);
    for (entity, count) in [
        ("UAV · 2023-01-11", 6240),
        ("UAV · 2023-01-12", 7189),
        ("UAV · 2023-01-20", 12495),
    ] {
        let rows = &flights[entity];
        assert_eq!(rows.len(), count);
        assert_eq!(rows.first().unwrap().value, Some(0.));
        assert_eq!(rows.last().unwrap().value, Some(0.));
        assert!(rows.windows(2).all(|pair| pair[0].time <= pair[1].time));
        assert!(rows.iter().any(|e| e.category == "Assisted_Takeoff"));
        assert!(rows.iter().any(|e| e.category.contains("Landing")));
        assert!(rows.iter().map(|e| e.value.unwrap()).fold(0., f64::max) > 14.9);
    }
    assert!(p.scene.globe_altitude);
    assert!(!p.scene.globe_time);
    assert_eq!(p.filter.start, Some(1673523463.));
    assert_eq!(p.filter.end, Some(1673524182.));
    assert_eq!(p.views[0].scene.mode, "space-time");
    assert!(!p.views[0].scene.globe_altitude);
    assert_eq!(p.views[1].scene.mode, "globe");
    assert!(p.views[1].scene.globe_altitude);
    let demo = demos::DEMOS.iter().find(|d| d.id == "kabr-uav").unwrap();
    assert_eq!(demo.previews.len(), 2);
    assert_eq!(p.provenance[0].license, "CC0 1.0");
}

#[test]
fn kabr_saved_views_and_portable_copy_keep_the_full_dataset() {
    let dir = tempfile::tempdir().unwrap();
    let e = Engine::new(Project::empty(), dir.path().into()).unwrap();
    e.invoke("demo_open", json!({"id":"kabr-uav"})).unwrap();
    for (index, count) in [(1, 7189), (2, 6240), (3, 12495), (4, 25924)] {
        e.invoke("restore_view", json!({"index":index})).unwrap();
        let snapshot = e.invoke("snapshot", json!({"compact":false})).unwrap();
        assert_eq!(snapshot["count"], 25924);
        assert_eq!(snapshot["visible"], count);
        assert_eq!(snapshot["layers"].as_array().unwrap().len(), 1);
    }
    let file = dir.path().join("kabr-copy.chronoscope");
    e.invoke("save", json!({"path":file})).unwrap();
    e.invoke("open", json!({"path":file})).unwrap();
    assert_eq!(
        e.invoke("snapshot", json!({"compact":false})).unwrap()["count"],
        25924
    );
}
