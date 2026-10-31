use chronoscope::{
    coordinates::{self, Coordinate, CoordinateSystem},
    engine::Engine,
    import::{self, Mapping, RawTable},
    project::Project,
};
use serde_json::json;

#[test]
fn dms_parsing_formatting_and_axis_validation() {
    for text in ["40°44′54.000″N", "N40:44:54", "40 44 54 N", "40°44'54\"N"] {
        assert!(
            (coordinates::parse_dms(text, true).unwrap() - 40.7483333333333).abs() < 1e-12,
            "{text}"
        );
    }
    assert!((coordinates::parse_dms("-73:59:6", false).unwrap() + 73.985).abs() < 1e-12);
    assert_eq!(
        coordinates::parse_dms("0 0 1 S", true).unwrap(),
        -1. / 3600.
    );
    for (text, lat) in [
        ("40 60 0 N", true),
        ("40 0 60 N", true),
        ("90 0 0.01 N", true),
        ("180 0 1 E", false),
        ("40 0 0 E", true),
        ("-40 0 0 N", true),
        ("+40 0 0 S", true),
        ("40°N", true),
        ("N40 0 0 N", true),
        ("NaN 0 0", true),
    ] {
        assert!(coordinates::parse_dms(text, lat).is_err(), "{text}");
    }
    assert_eq!(
        coordinates::format_dms(12. + 59. / 60. + 59.9999 / 3600., true),
        "13°00′00.000″N"
    );
    assert_eq!(coordinates::format_dms(-0., false), "0°00′00.000″E");
    for pair in [
        "40°44′54″N, 73°59′6″W",
        "40°44′54″N 73°59′6″W",
        "N40:44:54 W73:59:6",
        "40 44 54 -73 59 6",
        "40:44:54; -73:59:6",
    ] {
        let (lat, lon) = coordinates::parse_dms_pair(pair).unwrap();
        assert!((lat - 40.7483333333333).abs() < 1e-12);
        assert!((lon + 73.985).abs() < 1e-12);
    }
    for (lat, lon) in [(90., 180.), (-90., -180.), (0., 0.), (-33.8688, 151.2093)] {
        let c = coordinates::convert(Coordinate::Dd {
            latitude: lat,
            longitude: lon,
        })
        .unwrap();
        let d = coordinates::convert(Coordinate::Dms {
            latitude: c.dms.latitude,
            longitude: c.dms.longitude,
        })
        .unwrap();
        assert!((c.latitude - d.latitude).abs() < 1e-7);
        assert!((c.longitude - d.longitude).abs() < 1e-7);
    }
}

#[test]
fn import_detects_dms_and_feedback_uses_the_same_parser() {
    let table = RawTable {
        sheet: "DMS".into(),
        row_numbers: vec![2],
        headers: vec!["time".into(), "latitude_dms".into(), "longitude_dms".into()],
        rows: vec![vec![
            "2026-10-31".into(),
            "40 44 54 N".into(),
            "73 59 6 W".into(),
        ]],
    };
    let detection = Mapping::detect(&table);
    let mapping = detection.mapping;
    assert_eq!(mapping.coordinate_system, CoordinateSystem::Dms);
    let feedback = import::field_feedback(&table, &mapping);
    assert_eq!(feedback["lat"].state, "valid");
    assert_eq!(feedback["lon"].state, "valid");
    let result = import::convert(&table, &mapping, "DMS", 1).unwrap();
    assert_eq!(result.events.len(), 1);
    assert!((result.events[0].lon.unwrap() + 73.985).abs() < 1e-12);
    let mut combined = table.clone();
    combined.headers = vec!["time".into(), "coordinates".into()];
    combined.rows = vec![vec!["2026-10-31".into(), "40°44′54″N, 73°59′6″W".into()]];
    let mapping = Mapping::detect(&combined).mapping;
    assert_eq!(mapping.coordinate_system, CoordinateSystem::Dms);
    assert_eq!(
        import::convert(&combined, &mapping, "DMS", 1)
            .unwrap()
            .events
            .len(),
        1
    );
}

#[test]
fn dms_api_and_preferences_persist_without_changing_source_precision() {
    let dir = tempfile::tempdir().unwrap();
    let engine = Engine::new(
        Project::new(chronoscope::demo::dataset()),
        dir.path().into(),
    )
    .unwrap();
    let c = engine
        .invoke(
            "coordinates",
            json!({"coordinate":{"system":"dms","latitude":"40 44 54 N","longitude":"73 59 6 W"}}),
        )
        .unwrap();
    assert_eq!(c["dms"]["longitude"], "73°59′06.000″W");
    let mut preferences = engine.invoke("preferences", json!({})).unwrap();
    preferences["coordinates"] = json!("dms");
    engine
        .invoke("preferences", json!({"preferences":preferences}))
        .unwrap();
    assert_eq!(
        engine.invoke("preferences", json!({})).unwrap()["coordinates"],
        "dms"
    );
    assert!(
        engine.invoke("events", json!({"id":"1"})).unwrap()["events"][0]["coordinate_formats"]
            ["dms"]["latitude"]
            .is_string()
    );
}
