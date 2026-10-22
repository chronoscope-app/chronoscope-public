//! End-to-end temporal regressions: distinct instants must remain distinct through
//! the authoritative indexed engine, not just through the import preview.
use chronoscope::{
    analysis::{self, Parameters, Pattern},
    engine::Engine,
    import,
    model::{Dataset, Event},
    project::{self, Project},
    timestamps::{self, Options, TimeEncoding},
};
use serde_json::{json, Value};

fn parse(s: &str) -> f64 {
    timestamps::parse(s, &Options::default()).unwrap()
}
fn checked(engine: &Engine, command: &str, args: Value) -> Value {
    let v = engine.invoke(command, args).unwrap();
    chronoscope::schema::validate_output(command, &v).unwrap();
    v
}
fn event(id: u64, clock: &str) -> Event {
    let mut e = chronoscope::demo::dataset().events.remove(0);
    e.id = id;
    e.entity = "track".into();
    e.time = parse(clock);
    e.end = None;
    e.lat = Some(0.);
    e.lon = Some(id as f64 * 0.0001);
    e.source = "precision.csv".into();
    e
}

#[test]
fn formats_offsets_and_negative_epochs_preserve_fractions() {
    let expected = parse("2026-10-13T08:15:59.123456Z");
    for text in [
        "2026-10-13T08:15:59.123456Z",
        "2026/10/13 08:15:59.123456",
        "13 October 2026 08:15:59.123456",
        "2026-10-13 10:15:59.123456+02:00",
    ] {
        assert_eq!(parse(text), expected, "{text}");
    }
    assert_eq!(
        timestamps::parse_fields("2026-10-13", Some("08:15:59.123456"), &Options::default())
            .unwrap(),
        expected
    );
    assert_eq!(
        timestamps::utc_time(expected).unwrap(),
        "2026-10-13T08:15:59.123456Z"
    );
    assert_eq!(parse("1969-12-31T23:59:59.125Z"), -0.875);
    assert_eq!(
        timestamps::utc_time(-0.875).unwrap(),
        "1969-12-31T23:59:59.125Z"
    );
    for (encoding, text) in [
        (TimeEncoding::UnixSeconds, "-0.125"),
        (TimeEncoding::UnixMilliseconds, "-125"),
        (TimeEncoding::UnixMicroseconds, "-125000"),
        (TimeEncoding::UnixNanoseconds, "-125000000"),
    ] {
        assert_eq!(
            timestamps::parse(
                text,
                &Options {
                    encoding,
                    ..Default::default()
                }
            )
            .unwrap(),
            -0.125
        );
    }
    let seconds = expected.floor() as i128;
    for (encoding, scale) in [
        (TimeEncoding::UnixSeconds, 1),
        (TimeEncoding::UnixMilliseconds, 1000),
        (TimeEncoding::UnixMicroseconds, 1_000_000),
        (TimeEncoding::UnixNanoseconds, 1_000_000_000),
    ] {
        let text = if scale == 1 {
            format!("{seconds}.123456")
        } else if scale == 1000 {
            format!("{}.456", seconds * scale + 123)
        } else {
            (seconds * scale + 123456 * (scale / 1_000_000)).to_string()
        };
        assert_eq!(
            timestamps::parse(
                &text,
                &Options {
                    encoding,
                    ..Default::default()
                }
            )
            .unwrap(),
            expected,
            "{text}"
        );
    }
    assert!(parse("2026-10-13T08:15:01Z") < parse("2026-10-13T08:15:59Z"));
    assert!(parse("2026-10-13T08:15:59.000001Z") < parse("2026-10-13T08:15:59.000002Z"));
    assert_eq!(
        timestamps::seconds_between(
            parse("2026-10-13T08:15:59.000002Z"),
            parse("2026-10-13T08:15:59.000001Z")
        ),
        0.000001
    );
    assert_eq!(
        timestamps::seconds_between(
            parse("2026-10-13T08:15:59.1Z"),
            parse("2026-10-13T08:15:59Z")
        ),
        0.1
    );
    for bad in [
        "2026-10-13 24:00:00.1",
        "2026-10-13 08:15:60",
        "2026-10-13T08:15:60Z",
    ] {
        assert!(
            timestamps::parse(bad, &Default::default()).is_err(),
            "{bad}"
        );
    }
    // CZML offsets must preserve fractions without narrowing their calendar span.
    let dir = tempfile::tempdir().unwrap();
    let file = dir.path().join("long-clock.czml");
    std::fs::write(&file, json!([
        {"id":"document","version":"1.0"},
        {"id":"long","position":{"epoch":"1900-01-01T00:00:00Z", "cartographicDegrees":[0,-80,35,0,12622780800.125,-79,36,0]}}
    ]).to_string()).unwrap();
    let raw = chronoscope::gis::raw_import(&file).unwrap();
    let mapping = import::Mapping::detect(&raw.tables[0]).mapping;
    let imported = import::convert(&raw.tables[0], &mapping, "CZML", 1).unwrap();
    assert_eq!(imported.rejected_count, 0);
    assert_eq!(imported.events[1].time, parse("2300-01-01T00:00:00.125Z"));
}

#[test]
fn indexed_order_filters_edits_undo_render_and_portable_roundtrips() {
    use base64::Engine as _;
    let dir = tempfile::tempdir().unwrap();
    let events = vec![
        event(1, "2026-10-13T08:15:59.875Z"),
        event(2, "2026-10-13T08:15:59.125Z"),
        event(3, "2026-10-13T08:15:01Z"),
    ];
    let e = Engine::new(
        Project::new(Dataset {
            events: events.clone(),
            name: "precision".into(),
        }),
        dir.path().into(),
    )
    .unwrap();
    let all = checked(
        &e,
        "query",
        json!({"sort_by":"time", "fields":["id","time","time_utc"]}),
    );
    assert_eq!(
        all["events"]
            .as_array()
            .unwrap()
            .iter()
            .map(|v| v["id"].as_str().unwrap())
            .collect::<Vec<_>>(),
        vec!["3", "2", "1"]
    );
    assert_eq!(all["events"][1]["time_utc"], "2026-10-13T08:15:59.125Z");
    let filtered = checked(
        &e,
        "query",
        json!({"filter":{"start":events[1].time,"end":events[1].time + 0.25}, "fields":["id","time"]}),
    );
    assert_eq!(filtered["events"].as_array().unwrap().len(), 1);
    assert_eq!(filtered["events"][0]["id"], "2");
    let render = checked(&e, "render_data", json!({}));
    let raw = base64::engine::general_purpose::STANDARD
        .decode(render["data"].as_str().unwrap())
        .unwrap();
    let stride = render["stride"].as_u64().unwrap() as usize;
    let ids = render["ids"].as_array().unwrap();
    let index = ids.iter().position(|v| v == "2").unwrap();
    // Packed layout: f64 longitude, latitude, epoch; u32 entity; f32 numeric value.
    let offset = index * stride + 16;
    assert_eq!(
        f64::from_le_bytes(raw[offset..offset + 8].try_into().unwrap()),
        events[1].time
    );
    checked(
        &e,
        "edit",
        json!({"id":"2","changes":{"time":events[1].time + 0.0625,"end":events[1].time + 0.1875}}),
    );
    assert!(e
        .invoke("edit", json!({"id":"2","changes":{"end":events[1].time}}))
        .is_err());
    checked(&e, "undo", json!({}));
    checked(&e, "redo", json!({}));
    let file = dir.path().join("precise.chronoscope");
    checked(&e, "save", json!({"path":file}));
    let loaded = project::load_with_resources(&file, dir.path()).unwrap();
    assert_eq!(loaded.version, 6);
    assert_eq!(loaded.time_resolution, "fractional_second");
    let restored = loaded.dataset.events.iter().find(|v| v.id == 2).unwrap();
    assert_eq!(restored.time, events[1].time + 0.0625);
    assert_eq!(restored.end, Some(events[1].time + 0.1875));
    let csv = dir.path().join("roundtrip.csv");
    project::export_csv(&csv, loaded.dataset.events.iter().cloned()).unwrap();
    let raw = import::read_file(&csv, b',').unwrap();
    let mapping = import::Mapping::detect(&raw.tables[0]).mapping;
    let imported = import::convert(&raw.tables[0], &mapping, "roundtrip", 1).unwrap();
    assert_eq!(imported.rejected_count, 0);
    let restored = imported
        .events
        .iter()
        .find(|v| v.time == restored.time)
        .unwrap();
    assert_eq!(restored.end, Some(events[1].time + 0.1875));
    // Persisting analytics selects the indexed SQLite container instead of ZIP.
    checked(
        &e,
        "analytics_run",
        json!({"plan":{"capability":"trajectories","scope":"all","parameters":{}}}),
    );
    let indexed = dir.path().join("precise-indexed.chronoscope");
    assert_eq!(
        checked(&e, "save", json!({"path":indexed}))["format"],
        "sqlite_v3"
    );
    let reopened = Engine::from_path(&indexed, dir.path().join("recipient"), None).unwrap();
    let row = checked(&reopened, "events", json!({"id":"2"}));
    assert_eq!(row["events"][0]["time"], events[1].time + 0.0625);
    assert_eq!(row["events"][0]["end"], events[1].time + 0.1875);
}

#[test]
fn subsecond_encounters_speeds_and_analytics_use_canonical_times() {
    let dir = tempfile::tempdir().unwrap();
    let a = event(1, "2026-10-13T08:15:59.125Z");
    let mut b = event(2, "2026-10-13T08:15:59.375Z");
    let params = Parameters {
        tolerance_s: 0.2,
        radius_m: 100.,
        ..Default::default()
    };
    b.entity = "other".into();
    assert!(
        analysis::run(&[a.clone(), b.clone()], Pattern::Proximity, &params)
            .findings
            .is_empty()
    );
    assert_eq!(
        analysis::run(
            &[a.clone(), b.clone()],
            Pattern::Proximity,
            &Parameters {
                tolerance_s: 0.25,
                ..params
            }
        )
        .findings
        .len(),
        1
    );
    b.entity = a.entity.clone();
    let gaps = analysis::run(
        &[a.clone(), b.clone()],
        Pattern::Gaps,
        &Parameters {
            gap_s: 0.125,
            ..Default::default()
        },
    );
    assert!(gaps.findings[0].metric.contains("0.25 seconds"));
    let engine = Engine::new(
        Project::new(Dataset {
            events: vec![b, a],
            ..Default::default()
        }),
        dir.path().into(),
    )
    .unwrap();
    let out = checked(
        &engine,
        "analytics_run",
        json!({"plan":{"capability":"trajectories","scope":"all","parameters":{}}}),
    );
    let rows = checked(
        &engine,
        "analytics_result",
        json!({"result_id":out["result_id"],"section":"rows"}),
    );
    assert_eq!(rows["rows"][0]["elapsed_seconds"], 0.25);
    assert_eq!(rows["rows"][0]["same_time_location_conflicts"], 0);
    let speed = rows["rows"][0]["max_segment_speed_kmh"].as_f64().unwrap();
    let expected = analysis::geodesic_distance((0., 0.0001), (0., 0.0002)) / 0.25 * 3.6;
    assert!((speed - expected).abs() < 1e-9);
    checked(
        &engine,
        "analytics_run",
        json!({"plan":{"capability":"compare","scope":"all","parameters":{"group_by":"entity","baseline":[parse("2026-10-13T08:15:59.125Z"),parse("2026-10-13T08:15:59.375Z")],"comparison":[parse("2026-10-13T08:15:59.375Z"),parse("2026-10-13T08:16:00Z")]}}}),
    );
    let chart = checked(
        &engine,
        "chart_data",
        json!({"config":{"x":"time","x_axis":"time","time_bucket":"millisecond","scope":"all"}}),
    );
    assert_eq!(chart["rows"].as_array().unwrap().len(), 2);
}

#[test]
fn old_minute_workspace_migrates_without_rescaling_or_inventing_detail() {
    let dir = tempfile::tempdir().unwrap();
    let mut p = Project::new(Dataset {
        events: vec![event(1, "2026-10-13T08:15:00Z")],
        ..Default::default()
    });
    p.version = 3;
    p.time_resolution = "minute".into();
    let path = dir.path().join("old.chrono.json");
    std::fs::write(&path, serde_json::to_vec(&p).unwrap()).unwrap();
    let loaded = project::load_with_resources(&path, dir.path()).unwrap();
    assert_eq!(loaded.dataset.events[0].time, p.dataset.events[0].time);
    assert_eq!(loaded.time_resolution, "fractional_second");
    assert_eq!(loaded.version, 6);
}

#[test]
fn legacy_sqlite_version_two_upgrades_on_a_copy_and_preserves_indices() {
    let dir = tempfile::tempdir().unwrap();
    let p = Project::new(Dataset {
        events: vec![event(1, "2026-10-13T08:15:00Z")],
        ..Default::default()
    });
    let mut store = chronoscope::store::DataStore::new(dir.path()).unwrap();
    store.load_events(p.dataset.events.clone()).unwrap();
    let path = dir.path().join("old-sqlite.chronoscope");
    store.save_as(&path, &p).unwrap();
    let db = rusqlite::Connection::open(&path).unwrap();
    let mut meta: Value = serde_json::from_str(
        &db.query_row("SELECT value FROM meta WHERE key='project'", [], |r| {
            r.get::<_, String>(0)
        })
        .unwrap(),
    )
    .unwrap();
    meta["version"] = json!(3);
    meta["time_resolution"] = json!("minute");
    db.execute(
        "UPDATE meta SET value=? WHERE key='project'",
        [meta.to_string()],
    )
    .unwrap();
    db.pragma_update(None, "user_version", 2).unwrap();
    drop(db);
    let before = std::fs::read(&path).unwrap();
    let reopened = Engine::from_path(&path, dir.path().join("recipient"), None).unwrap();
    assert_eq!(
        checked(&reopened, "snapshot", json!({}))["time_resolution"],
        "fractional_second"
    );
    assert_eq!(
        checked(&reopened, "events", json!({"id":"1"}))["events"][0]["time"],
        p.dataset.events[0].time
    );
    assert_eq!(
        std::fs::read(&path).unwrap(),
        before,
        "Opening must leave the original file intact"
    );
}
