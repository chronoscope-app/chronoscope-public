use base64::Engine as _;
use chronoscope::{
    altitude::{AltitudeReference, AltitudeUnit},
    engine::Engine,
    import::{self, Mapping},
    project::{self, Project},
};
use serde_json::json;

fn imported(text: &str) -> (tempfile::TempDir, Engine) {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("altitude.csv");
    std::fs::write(&path, text).unwrap();
    let engine = Engine::new(Project::empty(), dir.path().join("profile")).unwrap();
    let preview = engine
        .invoke("import_preview", json!({"path":path}))
        .unwrap();
    engine
        .invoke("import_commit", json!({"import_id":preview["import_id"]}))
        .unwrap();
    (dir, engine)
}
#[test]
fn unit_detection_reference_and_zero_are_preserved() {
    for (header, unit, reference) in [
        (
            "Altitude (ft)",
            AltitudeUnit::Feet,
            AltitudeReference::Unspecified,
        ),
        (
            "altitude_reported_km",
            AltitudeUnit::Kilometers,
            AltitudeReference::Reported,
        ),
        (
            "altitude_WGS84_m",
            AltitudeUnit::Meters,
            AltitudeReference::Ellipsoid,
        ),
        (
            "height_egm96_m",
            AltitudeUnit::Meters,
            AltitudeReference::Egm96,
        ),
    ] {
        let headers = ["entity", "timestamp", "latitude", "longitude", header].map(str::to_owned);
        let mapping = Mapping::guess(&headers);
        assert_eq!(mapping.altitude, Some(4), "{header}");
        assert_eq!(mapping.altitude_unit, unit);
        assert_eq!(mapping.altitude_reference, reference);
    }
    let (dir,e)=imported("entity,timestamp,latitude,longitude,altitude_reported_km\na,2026-01-01,1,2,0\na,2026-01-02,1,2,1.5\na,2026-01-03,1,2,\n");
    let rows = e.invoke("events", json!({"limit":10})).unwrap();
    assert_eq!(rows["events"][0]["altitude"]["meters"], 0.);
    assert_eq!(rows["events"][1]["altitude"]["meters"], 1500.);
    assert!(rows["events"][2].get("altitude").is_none());
    for extension in ["json", "chronoscope"] {
        let path = dir.path().join(format!("copy.{extension}"));
        e.invoke("save", json!({"path":path})).unwrap();
        let p = project::load_with_resources(&path, dir.path()).unwrap();
        assert_eq!(p.version, 7);
        assert_eq!(p.dataset.events[1].altitude.unwrap().meters, 1500.);
    }
}
#[test]
fn altitude_packets_filter_only_rendering_and_keep_time_modes_mutually_exclusive() {
    let (_dir,e)=imported("entity,timestamp,latitude,longitude,altitude_m,altitude_reference\na,2026-01-01,1,2,0,ellipsoid\na,2026-01-02,1,2,1000,egm96\na,2026-01-03,1,2,2000,reported\na,2026-01-04,1,2,3000,unspecified\na,2026-01-05,1,2,,\n");
    let stats = e
        .invoke("statistics", json!({"field":"altitude_m"}))
        .unwrap();
    assert_eq!(stats["summary"]["count"], 4);
    assert_eq!(stats["summary"]["missing"], 1);
    assert_eq!(stats["summary"]["mean"], 1500.);
    let packet = e.invoke("render_data", json!({})).unwrap();
    assert_eq!(packet["stride"], 48);
    assert_eq!(packet["rendered_count"], 5);
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(packet["data"].as_str().unwrap())
        .unwrap();
    assert_eq!(bytes.len(), 5 * 48);
    assert_eq!(f64::from_le_bytes(bytes[32..40].try_into().unwrap()), 0.);
    assert_eq!(bytes[40], 1);
    assert_eq!(bytes[4 * 48 + 40], 0);
    e.invoke("view_set", json!({"mode":"globe","globe_altitude":true}))
        .unwrap();
    let p = e
        .invoke(
            "view_snapshot_v1",
            json!({"version":1,"generation":"altitude-test","include_render":true}),
        )
        .unwrap();
    assert_eq!(p["snapshot"]["count"], 5);
    assert_eq!(p["render"]["rendered_count"], 3, "{p}");
    assert!(e
        .invoke("view_set", json!({"globe_time":true,"globe_altitude":true}))
        .is_err());
    e.invoke("view_set", json!({"globe_time":true})).unwrap();
    let s = e.invoke("snapshot", json!({})).unwrap();
    assert_eq!(s["scene"]["globe_altitude"], false);
    assert_eq!(
        e.invoke("render_data", json!({})).unwrap()["rendered_count"],
        5
    );
    let projected = e
        .invoke(
            "events",
            json!({"fields":["id","altitude_m","altitude_reference"],"limit":10}),
        )
        .unwrap();
    assert_eq!(projected["events"][1]["altitude_m"], 1000.);
}
#[test]
fn csv_roundtrip_keeps_mixed_references_and_rejects_invalid_altitude() {
    let (dir,e)=imported("entity,timestamp,latitude,longitude,altitude_m,altitude_reference\na,2026-01-01,1,2,12.5,ellipsoid\na,2026-01-02,1,2,0,reported\n");
    let path = dir.path().join("export.csv");
    e.invoke("export", json!({"path":path})).unwrap();
    let raw = import::read_file(&path, b',').unwrap();
    let t = &raw.tables[0];
    let result = import::convert(t, &Mapping::guess(&t.headers), "roundtrip", 1).unwrap();
    assert_eq!(
        result.events[0].altitude.unwrap().reference,
        AltitudeReference::Ellipsoid
    );
    assert_eq!(result.events[1].altitude.unwrap().meters, 0.);
    for meters in [-12001., 100000001., f64::INFINITY] {
        assert!(chronoscope::altitude::Altitude {
            meters,
            reference: AltitudeReference::Reported
        }
        .validate()
        .is_err());
    }
    assert!(e
        .invoke(
            "edit",
            json!({"ids":["1"],"changes":{"altitude":{"meters":-12001.,"reference":"reported"}}})
        )
        .is_err());
}
#[test]
fn real_examples_have_many_distinct_tracks_and_preserved_credit() {
    let dir = tempfile::tempdir().unwrap();
    for (id, count, entities) in [
        ("flight-altitude", 88018, 100),
        ("starlink-orbits", 46208, 128),
    ] {
        let p = chronoscope::demos::load(id, dir.path()).unwrap();
        assert_eq!(p.dataset.events.len(), count);
        assert_eq!(
            p.dataset
                .events
                .iter()
                .map(|e| &e.entity)
                .collect::<std::collections::BTreeSet<_>>()
                .len(),
            entities
        );
        assert!(p.scene.globe_altitude);
        assert!(!p.scene.globe_time);
        assert!(!p.provenance.is_empty());
        p.validate().unwrap();
        assert!(p.dataset.events.iter().all(|e| e.altitude.is_some()));
    }
}
