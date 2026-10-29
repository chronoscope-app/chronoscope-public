use chronoscope::{
    coordinates::{self, Coordinate},
    engine::{Engine, Preferences},
    import::{self, Mapping},
    model::parse_time,
    project::{self, Project, SceneState},
    timestamps::{self, DateOrder, Options, TimeEncoding},
};
use serde_json::{json, Value};
use std::{
    fs,
    io::Write,
    path::{Path, PathBuf},
};
fn sample(s: &str) -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("tests/fixtures")
        .join(s)
}
fn expected(s: &str) -> f64 {
    parse_time(s, "", 0).unwrap()
}
#[test]
fn broad_dates_clocks_and_seconds_are_preserved() {
    for (input, clock) in [
        ("2026-10-13T08:15:59.999Z", "08:15:59.999"),
        ("2026/10/13 08:15:59.123456789123", "08:15:59.123456789"),
        ("13/10/2026 8:15:42 AM", "08:15:42"),
        ("10/13/2026 08:15:22", "08:15:22"),
        ("13 Oct 2026 08:15:00", "08:15:00"),
        ("October 13, 2026 8:15 AM", "08:15:00"),
        ("20261013081559", "08:15:59"),
        ("202610130815", "08:15:00"),
        ("2026-Oct-13 08:15:59", "08:15:59"),
        ("2026 10 13 08:15:59", "08:15:59"),
        ("2026-10-13 081559", "08:15:59"),
        ("20261013T081559", "08:15:59"),
        ("2026-286 08:15:59", "08:15:59"),
        ("2026-W42-2 08:15", "08:15:00"),
        ("2026年10月13日 08:15:00", "08:15:00"),
        ("Tue, 13 Oct 2026 08:15:59 +0000", "08:15:59"),
    ] {
        assert_eq!(
            timestamps::parse(input, &Default::default())
                .unwrap_or_else(|e| panic!("{input}: {e}")),
            expected(&format!("2026-10-13T{clock}Z")),
            "{input}"
        );
    }
    assert_eq!(expected("2026-10-13 8PM"), expected("2026-10-13T20:00:00Z"));
    assert_eq!(
        expected("2026-10-13 8 PM"),
        expected("2026-10-13T20:00:00Z")
    );
    assert_eq!(expected("2026-10-13 24:00:00"), expected("2026-10-14"));
}
#[test]
fn timezone_offsets_and_pre_epoch_fractions_are_preserved() {
    assert_eq!(
        expected("2026-10-13 10:15:59.9+02:00"),
        expected("2026-10-13T08:15:59.9Z")
    );
    assert_eq!(
        expected("2026-10-13T03:15:23-0500"),
        expected("2026-10-13T08:15:23Z")
    );
    assert_eq!(expected("1969-12-31T23:59:59.999Z"), -0.001);
    for s in ["-0.1", "-1", "-1.999", "-1000", "-1001"] {
        let encoding = if s.starts_with("-100") {
            TimeEncoding::UnixMilliseconds
        } else {
            TimeEncoding::UnixSeconds
        };
        assert_eq!(
            timestamps::parse(
                s,
                &Options {
                    encoding,
                    ..Default::default()
                }
            )
            .unwrap(),
            s.parse::<f64>().unwrap()
                / if encoding == TimeEncoding::UnixMilliseconds {
                    1000.
                } else {
                    1.
                }
        );
    }
    assert!(timestamps::parse("99999999999999999999999999999", &Default::default()).is_err());
}
#[test]
fn epoch_units_and_excel_systems_match() {
    let t = expected("2026-10-13T08:15:00Z") + 59.;
    for scale in [1i64, 1000, 1000000, 1000000000] {
        assert_eq!(expected(&((t as i128) * i128::from(scale)).to_string()), t);
    }
    let day = expected("2026-10-13") / 86400.;
    for (base, encoding) in [
        (25569., TimeEncoding::ExcelSerial),
        (24107., TimeEncoding::Excel1904),
    ] {
        let text = (day + base + (8. * 3600. + 15. * 60. + 59.) / 86400.).to_string();
        let actual = timestamps::parse(
            &text,
            &Options {
                encoding,
                ..Default::default()
            },
        )
        .unwrap();
        assert!((actual - expected("2026-10-13T08:15:59Z")).abs() < 0.00001);
    }
    assert!(timestamps::parse(
        "60",
        &Options {
            encoding: TimeEncoding::ExcelSerial,
            ..Default::default()
        }
    )
    .is_err());
}
#[test]
fn ambiguity_and_manual_formats_are_explicit() {
    assert!(timestamps::parse("03/04/2026 08:15:59", &Default::default()).is_err());
    assert_eq!(
        timestamps::parse(
            "03/04/2026 08:15:59",
            &Options {
                order: DateOrder::Dmy,
                ..Default::default()
            }
        )
        .unwrap(),
        expected("2026-04-03T08:15:59Z")
    );
    assert_eq!(
        timestamps::infer_order(["13/04/2026", "03/04/2026"].into_iter()),
        DateOrder::Dmy
    );
    assert_eq!(
        timestamps::infer_order(["13/04/2026", "04/13/2026"].into_iter()),
        DateOrder::Auto
    );
    assert_eq!(
        timestamps::parse(
            "13-10-2026 08:15:59.1",
            &Options {
                custom: "%d-%m-%Y %H:%M:%S%.f",
                ..Default::default()
            }
        )
        .unwrap(),
        expected("2026-10-13T08:15:59.1Z")
    );
    assert!(timestamps::parse(
        "2026-10-13",
        &Options {
            custom: "%d/%m/%Y",
            ..Default::default()
        }
    )
    .is_err());
}
#[test]
fn separate_fields_and_time_only_require_a_date() {
    for (clock, utc) in [
        ("08:15:59.999", "08:15:59.999"),
        ("8:15AM", "08:15:00"),
        ("081559", "08:15:59"),
        ("08:15:22Z", "08:15:22"),
    ] {
        assert_eq!(
            timestamps::parse_fields("2026-10-13", Some(clock), &Default::default()).unwrap(),
            expected(&format!("2026-10-13T{utc}Z"))
        );
    }
    assert!(timestamps::parse("08:15:59", &Default::default()).is_err());
    for (value, utc) in [
        ("08:15:59.99", "08:15:59.99"),
        ("0815", "08:15:00"),
        ("081559", "08:15:59"),
    ] {
        assert_eq!(
            timestamps::parse(
                value,
                &Options {
                    default_date: "2026-10-13",
                    ..Default::default()
                }
            )
            .unwrap(),
            expected(&format!("2026-10-13T{utc}Z"))
        );
    }
    assert_eq!(
        timestamps::parse_fields(
            "2026-10-13",
            Some("2026-10-13 08:15:59"),
            &Default::default()
        )
        .unwrap(),
        expected("2026-10-13T08:15:59Z")
    );
    assert_eq!(
        timestamps::parse_fields("2026-10-13", Some("0.5"), &Default::default()).unwrap(),
        expected("2026-10-13T12:00:00Z")
    );
}
#[test]
fn malformed_times_do_not_panic_or_get_silently_repaired() {
    for s in [
        "2026-02-30 08:15",
        "2026-10-13 25:00",
        "2026-10-13 08:60",
        "2026-10-13 08:15:61",
        "2026-10-13 24:00:01",
        "2026-10-13 08:15:00.a",
        "2026-10-13 08:15 EST",
        "💡",
        "",
        "9999/999999/99999",
    ] {
        assert!(timestamps::parse(s, &Default::default()).is_err(), "{s}");
    }
}
#[test]
fn mgrs_precision_uses_independent_easting_and_northing_and_square_centre() {
    for (reference, precision, e, n) in [
        ("18TWL", 0, 550000., 4550000.),
        ("18TWL81", 1, 585000., 4515000.),
        ("18TWL8511", 2, 585500., 4511500.),
        ("18TWL856113", 3, 585650., 4511350.),
        ("18T WL 8566 1131", 4, 585665., 4511315.),
        ("18twl8566411315", 5, 585664.5, 4511315.5),
    ] {
        let c = coordinates::convert(Coordinate::Mgrs {
            reference: reference.into(),
        })
        .unwrap();
        assert_eq!(c.mgrs_precision, precision);
        assert_eq!(c.mgrs, coordinates::normalize_mgrs(reference));
        assert_eq!(
            c.mgrs_cell_size_m,
            Some(10f64.powi(5 - i32::from(precision)))
        );
        let Coordinate::Utm {
            easting, northing, ..
        } = c.utm
        else {
            panic!()
        };
        assert!((easting - e).abs() < 0.01, "{reference} {easting}");
        assert!((northing - n).abs() < 0.01);
    }
    for reference in ["18TWL123", "18T", "18TWL123456789012"] {
        assert!(coordinates::convert(Coordinate::Mgrs {
            reference: reference.into()
        })
        .is_err());
    }
}
#[test]
fn automatic_delimiter_separate_time_mgrs_and_decimal_commas() {
    let dir = tempfile::tempdir().unwrap();
    let p = dir.path().join("data.csv");
    fs::write(&p,"name;date;time;position\nA;13/10/2026;08:15:59.99;18T WL 8566 1131\nB;03/10/2026;8:16 AM;18TWL856113\n").unwrap();
    let raw = import::read_file(&p, 0).unwrap();
    assert_eq!(raw.delimiter, Some(b';'));
    let detection = Mapping::detect(&raw.tables[0]);
    assert_eq!(detection.mapping.clock, Some(2));
    assert_eq!(detection.mapping.mgrs, Some(3));
    assert_eq!(detection.mapping.date_order, DateOrder::Dmy);
    let r = import::convert(&raw.tables[0], &detection.mapping, "x", 1).unwrap();
    assert_eq!(r.rejected_count, 0);
    assert_eq!(r.events[1].time, expected("2026-10-03T08:16:00Z"));
    assert_eq!(r.events[0].mgrs_precision, Some(4));
    fs::write(
        &p,
        "timestamp;latitude;longitude\n2026-10-13 08:15:22;40,7483;-73,9857\n",
    )
    .unwrap();
    let raw = import::read_file(&p, 0).unwrap();
    let d = Mapping::detect(&raw.tables[0]);
    assert!(d.mapping.decimal_comma);
    let r = import::convert(&raw.tables[0], &d.mapping, "x", 1).unwrap();
    assert_eq!(r.events[0].lat, Some(40.7483));
}
#[test]
fn content_based_timestamp_and_combined_coordinates() {
    let dir = tempfile::tempdir().unwrap();
    let p = dir.path().join("data.csv");
    for (value, system) in [("40.7483 -73.9857", "dd"), ("18N 585664 4511315", "utm")] {
        fs::write(
            &p,
            format!("who,when_unknown,where_unknown\nA,2026-10-13T08:15:59.999Z,{value}\n"),
        )
        .unwrap();
        let r = import::read_file(&p, 0).unwrap();
        let d = Mapping::detect(&r.tables[0]);
        assert_eq!(d.mapping.time, Some(1));
        assert_eq!(
            serde_json::to_value(&d.mapping.coordinate_system).unwrap(),
            system
        );
        let r = import::convert(&r.tables[0], &d.mapping, "x", 1).unwrap();
        assert_eq!(r.rejected_count, 0);
        assert!(r.events[0].location().is_some());
    }
}
#[test]
fn utm_defaults_are_never_invented() {
    let dir = tempfile::tempdir().unwrap();
    let p = dir.path().join("data.csv");
    fs::write(&p, "date,easting,northing\n2026-10-13,585664,4511315\n").unwrap();
    let r = import::read_file(&p, 0).unwrap();
    let mut d = Mapping::detect(&r.tables[0]);
    assert_eq!(d.mapping.default_zone, 0);
    assert!(d.mapping.default_hemisphere.is_empty());
    assert!(!d.warnings.is_empty());
    assert_eq!(
        import::convert(&r.tables[0], &d.mapping, "x", 1)
            .unwrap()
            .rejected_count,
        1
    );
    d.mapping.default_zone = 18;
    d.mapping.default_hemisphere = "N".into();
    assert_eq!(
        import::convert(&r.tables[0], &d.mapping, "x", 1)
            .unwrap()
            .events
            .len(),
        1
    );
}
fn scene() -> Value {
    json!({"mode":"map","position":[1.,7.,2.],"target":[0.,0.,0.],"time_height":3.5,"playback_fade":false,"globe_time":false,"globe_altitude":false,"globe_time_scale":null,"focus":0.6,"bounds":[-80.,43.,-79.,44.],"table_open":true,"inspector_tab":"views","expanded":true,"camera_zoom":null,"table_source":null,"table_attributes":false,"table_respect_filters":false,"table_sort":"","table_descending":false,"table_column_offset":32,"render_budget":100000,"display":null,"chart":null,"chart_presets":[]})
}
#[test]
fn portable_workspace_restores_edited_data_context_and_terrain_without_originals() {
    let source = tempfile::tempdir().unwrap();
    let recipient = tempfile::tempdir().unwrap();
    let cache = tempfile::tempdir().unwrap();
    let engine = Engine::new(
        Project::new(chronoscope::demo::dataset()),
        source.path().join("app"),
    )
    .unwrap();
    let tile = source.path().join("n43.dt0");
    fs::copy(sample("terrain/synthetic-n43.dt0"), &tile).unwrap();
    engine.invoke("terrain_load", json!({"path":tile})).unwrap();
    engine.invoke("select", json!({"ids":["1"]})).unwrap();
    engine.invoke("tag", json!({"value":"shared"})).unwrap();
    engine
        .invoke(
            "edit",
            json!({"id":"1","changes":{"note":"analyst context"}}),
        )
        .unwrap();
    engine
        .invoke("save_view", json!({"name":"saved camera","scene":scene()}))
        .unwrap();
    engine
        .invoke("save_group", json!({"name":"evidence"}))
        .unwrap();
    let mut filter = engine.invoke("snapshot", json!({})).unwrap()["filter"].clone();
    filter["search"] = json!("Atlas");
    engine
        .invoke("filter", json!({"filter":filter.clone()}))
        .unwrap();
    let bundle = recipient.path().join("shared.chronoscope");
    engine
        .invoke("save", json!({"path":bundle,"scene":scene()}))
        .unwrap();
    fs::remove_file(tile).unwrap();
    let mut archive = zip::ZipArchive::new(fs::File::open(&bundle).unwrap()).unwrap();
    assert_eq!(archive.len(), 2);
    let manifest: Value =
        serde_json::from_reader(archive.by_name("manifest.json").unwrap()).unwrap();
    assert_eq!(
        manifest["workspace"]["terrain_files"][0],
        "terrain/0000.dt0"
    );
    assert!(manifest["workspace"]["preferences"]["terrain_path"].is_null());
    let loaded = project::load_with_resources(&bundle, cache.path()).unwrap();
    let other = Engine::new_with_terrain_scope(loaded, cache.path().into(), Some(recipient.path()))
        .unwrap();
    let s = other.invoke("snapshot", json!({})).unwrap();
    assert_eq!(s["filter"], filter);
    assert_eq!(s["scene"], scene());
    assert_eq!(s["views"][0]["scene"], scene());
    assert_eq!(s["groups"][0]["ids"], json!(["1"]));
    let e = other.invoke("events", json!({"id":"1"})).unwrap();
    assert_eq!(e["events"][0]["note"], "analyst context");
    assert_eq!(e["events"][0]["tags"], json!(["shared"]));
    assert!(other.invoke("terrain_info", json!({})).unwrap()["tiles"].is_array());
    assert!(
        (other
            .invoke("terrain_sample", json!({"latitude":43.5,"longitude":-79.5}))
            .unwrap()["elevation_m"]
            .as_f64()
            .unwrap()
            - 75.)
            .abs()
            < 0.01
    );
}
#[test]
fn legacy_project_seconds_migrate_and_invalid_scene_is_rejected() {
    let dir = tempfile::tempdir().unwrap();
    let mut value = serde_json::to_value(Project::new(chronoscope::demo::dataset())).unwrap();
    value["version"] = json!(1);
    value["dataset"]["events"][0]["time"] = json!(expected("2026-10-13T08:15:00Z") + 59.);
    value.as_object_mut().unwrap().remove("scene");
    let p = dir.path().join("legacy.json");
    fs::write(&p, serde_json::to_vec(&value).unwrap()).unwrap();
    let migrated = project::load_with_resources(&p, dir.path()).unwrap();
    assert_eq!(migrated.version, 7);
    assert_eq!(
        migrated.dataset.events[0].time,
        expected("2026-10-13T08:15:59Z")
    );
    assert_eq!(migrated.scene.table_column_offset, 0);
    assert!(migrated.scene.render_budget.is_none());
    let invalid: SceneState =
        serde_json::from_value(json!({"time_height":99.,"bounds":[1.,0.,-1.,2.]})).unwrap();
    assert!(invalid.validate().is_err());
}
fn zip_file(path: &Path, entries: Vec<(&str, Vec<u8>)>) {
    let mut w = zip::ZipWriter::new(fs::File::create(path).unwrap());
    for (name, bytes) in entries {
        w.start_file(name, zip::write::SimpleFileOptions::default())
            .unwrap();
        w.write_all(&bytes).unwrap();
    }
    w.finish().unwrap();
}
#[test]
fn malformed_bundles_reject_traversal_unlisted_resources_and_future_versions() {
    let dir = tempfile::tempdir().unwrap();
    let p = dir.path().join("bad.chronoscope");
    let manifest = serde_json::to_vec(&Project::new(chronoscope::demo::dataset())).unwrap();
    zip_file(
        &p,
        vec![
            ("manifest.json", manifest.clone()),
            ("../escape.dt0", b"anything".to_vec()),
        ],
    );
    assert!(project::load_with_resources(&p, dir.path()).is_err());
    assert!(!dir.path().join("escape.dt0").exists());
    zip_file(
        &p,
        vec![
            ("manifest.json", manifest.clone()),
            ("terrain/0000.dt0", b"anything".to_vec()),
        ],
    );
    assert!(project::load_with_resources(&p, dir.path()).is_err());
    let mut v: Value = serde_json::from_slice(&manifest).unwrap();
    v["version"] = json!(999);
    zip_file(&p, vec![("manifest.json", serde_json::to_vec(&v).unwrap())]);
    assert!(project::load_with_resources(&p, dir.path()).is_err());
}
#[test]
fn new_install_has_streets_and_fractional_edits_keep_mgrs_accuracy() {
    let prefs = Preferences::default();
    assert_eq!(prefs.basemap, chronoscope::basemap::Basemap::Streets);
    assert!(!prefs.map.enabled);
    assert!(prefs.map_layers.as_ref().is_some_and(Vec::is_empty));
    let dir = tempfile::tempdir().unwrap();
    let p = dir.path().join("mgrs.csv");
    fs::write(&p, "time,mgrs\n2026-10-13T08:15:59Z,18T WL 8566 1131\n").unwrap();
    let engine = Engine::new(
        Project::new(chronoscope::demo::dataset()),
        dir.path().into(),
    )
    .unwrap();
    engine.invoke("import_preview", json!({"path":p})).unwrap();
    engine.invoke("import_commit", json!({})).unwrap();
    let row = engine.invoke("events", json!({"id":"1"})).unwrap()["events"][0].clone();
    assert_eq!(row["coordinate_formats"]["mgrs"], "18TWL85661131");
    engine.invoke("edit",json!({"id":"1","changes":{"time":row["time"].as_f64().unwrap()+0.125,"lat":row["lat"],"lon":row["lon"]}})).unwrap();
    let row = engine.invoke("events", json!({"id":"1"})).unwrap()["events"][0].clone();
    assert_eq!(row["mgrs_precision"], 4);
    assert_eq!(
        row["time"].as_f64().unwrap(),
        expected("2026-10-13T08:15:59.125Z")
    );
}
#[test]
fn excel_native_separate_clocks_preserve_submillisecond_times() {
    let raw = import::read_file(&sample("import/flexible-import.xlsx"), 0).unwrap();
    for table in &raw.tables {
        let d = Mapping::detect(table);
        let r = import::convert(table, &d.mapping, "excel", 1).unwrap();
        assert_eq!(r.rejected_count, 0, "{:?}", r.rejected);
        assert!((r.events[0].time - expected("2026-10-13T08:15:59.9999Z")).abs() < 0.00001);
        if r.events.len() > 1 {
            assert_eq!(r.events[1].time, expected("2026-10-14T08:16:00Z"));
        }
    }
}
#[test]
fn generic_headers_ambiguous_dates_and_clocks_are_detected_and_reviewable() {
    let dir = tempfile::tempdir().unwrap();
    let p = dir.path().join("generic.csv");
    fs::write(
        &p,
        "who,calendar_unknown,clock_unknown\nA,03/04/2026,08:15:59.999\n",
    )
    .unwrap();
    let raw = import::read_file(&p, 0).unwrap();
    let mut d = Mapping::detect(&raw.tables[0]);
    assert_eq!(d.mapping.time, Some(1));
    assert_eq!(d.mapping.clock, Some(2));
    assert!(!d.warnings.is_empty());
    d.mapping.date_order = DateOrder::Dmy;
    let r = import::convert(&raw.tables[0], &d.mapping, "x", 1).unwrap();
    assert_eq!(r.events[0].time, expected("2026-04-03T08:15:59.999Z"));
    fs::write(&p, "entity,time\nA,0.5\n").unwrap();
    let raw = import::read_file(&p, 0).unwrap();
    let mut d = Mapping::detect(&raw.tables[0]);
    assert_eq!(d.mapping.time_encoding, TimeEncoding::TimeOfDay);
    assert_eq!(
        import::convert(&raw.tables[0], &d.mapping, "x", 1)
            .unwrap()
            .rejected_count,
        1
    );
    d.mapping.default_date = "2026-10-13".into();
    assert_eq!(
        import::convert(&raw.tables[0], &d.mapping, "x", 1)
            .unwrap()
            .events[0]
            .time,
        expected("2026-10-13T12:00:00Z")
    );
}
#[test]
fn reopening_unchanged_bundles_reuses_extraction_and_json_keeps_external_terrain() {
    let dir = tempfile::tempdir().unwrap();
    let engine = Engine::new(
        Project::new(chronoscope::demo::dataset()),
        dir.path().join("app"),
    )
    .unwrap();
    engine
        .invoke(
            "terrain_load",
            json!({"path":sample("terrain/synthetic-n43.dt0")}),
        )
        .unwrap();
    let bundle = dir.path().join("s.chronoscope");
    engine.invoke("save", json!({"path":bundle})).unwrap();
    let cache = dir.path().join("recipient-cache");
    let first = project::load_with_resources(&bundle, &cache).unwrap();
    let second = project::load_with_resources(&bundle, &cache).unwrap();
    assert_eq!(first.resource_dir, second.resource_dir);
    assert_eq!(
        fs::read_dir(cache.join("project-assets")).unwrap().count(),
        1
    );
    let json = dir.path().join("s.json");
    engine.invoke("save", json!({"path":json})).unwrap();
    let loaded = project::load_with_resources(&json, &cache).unwrap();
    assert!(loaded.resource_dir.is_none());
    assert_eq!(
        loaded.workspace.unwrap().terrain_files[0],
        sample("terrain/synthetic-n43.dt0")
    );
}
#[test]
fn csv_reimport_uses_edited_coordinates_instead_of_original_mgrs_attributes() {
    let dir = tempfile::tempdir().unwrap();
    let engine = Engine::new(
        Project::new(chronoscope::demo::dataset()),
        dir.path().into(),
    )
    .unwrap();
    let input = dir.path().join("mgrs.csv");
    fs::write(&input, "time,mgrs\n2026-10-13T08:15:59Z,18TWL85661131\n").unwrap();
    engine
        .invoke("import_preview", json!({"path":input}))
        .unwrap();
    engine.invoke("import_commit", json!({})).unwrap();
    engine
        .invoke("edit", json!({"id":"1","changes":{"lat":43.5,"lon":-79.5}}))
        .unwrap();
    let csv = dir.path().join("export.csv");
    engine.invoke("export", json!({"path":csv})).unwrap();
    let raw = import::read_file(&csv, 0).unwrap();
    let d = Mapping::detect(&raw.tables[0]);
    assert_eq!(
        serde_json::to_value(&d.mapping.coordinate_system).unwrap(),
        "dd"
    );
    let r = import::convert(&raw.tables[0], &d.mapping, "x", 1).unwrap();
    assert_eq!(r.events[0].location(), Some((43.5, -79.5)));
    assert_eq!(r.events[0].time, expected("2026-10-13T08:15:59Z"));
    assert!(fs::read_to_string(csv).unwrap().contains("08:15:59Z"));
}

#[test]
fn acquisition_date_and_compact_clocks_keep_firms_event_seconds() {
    for (date_name, time_name) in [
        ("acq_date", "acq_time"),
        ("Acquisition Date", "Acquisition Time"),
    ] {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("fire-detections.csv");
        fs::write(&path, format!("latitude,longitude,{date_name},{time_name},frp\n51.39613,-3.39611,2026-10-14,0310,0.91\n50.83786,-1.36048,2026-10-14,310,1.09\n48.98283,1.76136,2026-10-14,12345,1.2\n48,1,2026-10-14,2360,1.0\n")).unwrap();
        let raw = import::read_file(&path, b',').unwrap();
        let detected = Mapping::detect(&raw.tables[0]);
        assert_eq!(detected.mapping.time, Some(2));
        assert_eq!(detected.mapping.clock, Some(3));
        let result = import::convert(&raw.tables[0], &detected.mapping, "fires", 1).unwrap();
        assert_eq!(result.rejected_count, 1);
        assert_eq!(result.events.len(), 3);
        assert_eq!(result.events[0].time, expected("2026-10-14T03:10:00Z"));
        assert_eq!(result.events[1].time, expected("2026-10-14T03:10:00Z"));
        assert_eq!(result.events[2].time, expected("2026-10-14T01:23:45Z"));
    }
}

#[test]
fn darwin_core_iso_event_intervals_preserve_precise_endpoints() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("biodiversity.csv");
    fs::write(&path, "entity,eventDate,decimalLatitude,decimalLongitude\nA,2025-01-01T11:28/2025-01-01T14:42,24.57,120.98\nB,2025-01-01T11:28:59.99Z/2025-01-01T14:42:12Z,24.57,120.98\nC,2025-01-01/2025-01-02,24.57,120.98\nD,2025-01-02/2025-01-01,24.57,120.98\nE,2025-01-01/P1D,24.57,120.98\nF,13/01/2025,24.57,120.98\n").unwrap();
    let raw = import::read_file(&path, b',').unwrap();
    let mapping = Mapping::detect(&raw.tables[0]).mapping;
    let result = import::convert(&raw.tables[0], &mapping, "occurrences", 1).unwrap();
    assert_eq!(result.rejected_count, 2);
    assert_eq!(result.events.len(), 4);
    assert_eq!(result.events[0].time, expected("2025-01-01T11:28:00Z"));
    assert_eq!(result.events[0].end, Some(expected("2025-01-01T14:42:00Z")));
    assert_eq!(result.events[1].time, expected("2025-01-01T11:28:59.99Z"));
    assert_eq!(result.events[1].end, Some(expected("2025-01-01T14:42:12Z")));
    assert_eq!(result.events[2].end, Some(expected("2025-01-02")));
    assert_eq!(result.events[3].time, expected("2025-01-13"));
    assert_eq!(result.events[3].end, None);
}

#[test]
fn month_precision_events_keep_the_full_month_as_an_inclusive_interval() {
    let options = Options::default();
    for (input, first, last) in [
        ("2025-01", "2025-01-01", "2025-02-01"),
        ("2024-02", "2024-02-01", "2024-03-01"),
        ("2025-12", "2025-12-01", "2026-01-01"),
    ] {
        assert_eq!(
            timestamps::parse_interval(input, &options).unwrap(),
            Some((
                expected(first),
                f64::from_bits(expected(last).to_bits() - 1)
            ))
        );
    }
    assert!(timestamps::parse_interval("2025-13", &options).is_err());
}
