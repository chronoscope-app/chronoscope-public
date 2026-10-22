use chronoscope::{
    analysis::{self, Parameters, Pattern},
    import::{self, Mapping},
    model::*,
    project,
};
use std::{collections::BTreeSet, path::Path};
fn sample(name: &str) -> std::path::PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("tests/fixtures/import")
        .join(name)
}
#[test]
fn csv_and_excel_agree_including_native_dates_and_source_rows() {
    let csv = import::read_file(&sample("small-study.csv"), b',').unwrap();
    let workbook = import::read_file(&sample("small-study.xlsx"), b',').unwrap();
    let base = import::convert(
        &csv.tables[0],
        &Mapping::guess(&csv.tables[0].headers),
        "csv",
        1,
    )
    .unwrap();
    assert_eq!(base.events.len(), 5);
    assert_eq!(workbook.tables.len(), 2);
    for table in &workbook.tables {
        let result = import::convert(table, &Mapping::guess(&table.headers), "excel", 1).unwrap();
        assert_eq!(result.rejected_count, 0);
        assert_eq!(result.events.len(), base.events.len());
        for (a, b) in base.events.iter().zip(&result.events) {
            assert!(
                (a.time - b.time).abs() < 0.00001,
                "Excel serial uncertainty: {} vs {}",
                a.time,
                b.time
            );
            assert_eq!(a.location(), b.location());
            assert_eq!(a.entity, b.entity);
        }
    }
    assert_eq!(workbook.tables[0].row_numbers, [2, 3, 5, 6, 7]);
    assert_eq!(workbook.tables[1].row_numbers, [5, 6, 8, 9, 10]);
}
#[test]
fn explicit_locale_and_rejection_report() {
    let raw = import::read_file(&sample("custom-dates.csv"), b';').unwrap();
    let mut mapping = Mapping::guess(&raw.tables[0].headers);
    assert_eq!(
        import::convert(&raw.tables[0], &mapping, "custom", 1)
            .unwrap()
            .rejected_count,
        0
    );
    mapping.custom_format = "%d/%m/%Y %H:%M:%S".into();
    mapping.offset_minutes = 120;
    let result = import::convert(&raw.tables[0], &mapping, "custom", 1).unwrap();
    assert_eq!(result.rejected_count, 0);
    assert_eq!(
        result.events[0].time,
        parse_time("2025-06-17T06:00:00Z", "", 0).unwrap()
    );
    let raw = import::read_file(&sample("rejected-rows.csv"), b',').unwrap();
    let report = import::convert(
        &raw.tables[0],
        &Mapping::guess(&raw.tables[0].headers),
        "bad",
        1,
    )
    .unwrap();
    assert_eq!(report.rejected_count, 3);
    assert_eq!(report.rejected[0].0, 3);
}
#[test]
fn interval_filters_compose_with_attributes_and_selection() {
    let mut e = chronoscope::demo::dataset().events[0].clone();
    e.time = 0.0;
    e.end = Some(100.0);
    e.value = Some(10.);
    let mut f = Filter {
        start: Some(50.0),
        end: Some(60.0),
        selected_only: true,
        predicates: vec![Predicate {
            field: "value".into(),
            op: Operator::Greater,
            value: "5".into(),
        }],
        ..Default::default()
    };
    let selected = BTreeSet::from([e.id]);
    assert!(f.matches(&e, &selected));
    assert!(!f.matches(&e, &BTreeSet::new()));
    f.predicates[0].value = "15".into();
    assert!(!f.matches(&e, &selected));
    f.predicates.clear();
    f.hidden_entities.insert(e.entity.clone());
    assert!(!f.matches(&e, &selected));
}
#[test]
fn stationary_requires_observed_samples_and_bounded_gaps() {
    let mut a = chronoscope::demo::dataset().events[0].clone();
    a.time = 0.0;
    a.end = None;
    let mut b = a.clone();
    b.id = 999;
    b.time = 900.0;
    let p = Parameters::default();
    assert_eq!(
        analysis::run(&[a.clone(), b.clone()], Pattern::Stationary, &p)
            .findings
            .len(),
        1
    );
    b.time = 7200.0;
    assert!(analysis::run(&[a, b], Pattern::Stationary, &p)
        .findings
        .is_empty());
}
#[test]
fn project_rejects_duplicate_ids_and_nonfinite_numbers() {
    let mut p = project::Project::new(chronoscope::demo::dataset());
    p.dataset.events[1].id = p.dataset.events[0].id;
    assert!(p.validate().is_err());
    p.dataset.events[1].id = 999;
    p.dataset.events[0].value = Some(f64::NAN);
    assert!(p.validate().is_err());
}
#[test]
fn boundary_inputs_do_not_panic() {
    assert!(parse_time("-922337203685477580800000", "", 0).is_err());
    let raw = import::read_file(&sample("small-study.csv"), b',').unwrap();
    assert!(import::convert(
        &raw.tables[0],
        &Mapping::guess(&raw.tables[0].headers),
        "test",
        u64::MAX
    )
    .is_err());
}

#[test]
fn indexed_proximity_matches_brute_force_at_dateline_and_poles() {
    let template = chronoscope::demo::dataset().events[0].clone();
    for (lat, lon) in [(0., 179.999), (89.999, 0.), (-89.999, -179.999)] {
        let mut events = Vec::new();
        for i in 0..80u64 {
            let mut e = template.clone();
            e.id = i + 1;
            e.entity = format!("E{}", i % 5);
            e.time = ((i * 37) as i64) as f64;
            e.end = None;
            e.lat = Some((lat + (i % 8) as f64 * 0.00005).clamp(-90., 90.));
            let x = lon + (i % 10) as f64 * 0.0005;
            e.lon = Some((x + 180.).rem_euclid(360.) - 180.);
            events.push(e);
        }
        let p = Parameters {
            radius_m: 180.,
            tolerance_s: 250.0,
            ..Default::default()
        };
        let result = analysis::run(&events, Pattern::Proximity, &p);
        assert!(!result.limited);
        let actual: BTreeSet<_> = result
            .findings
            .iter()
            .map(|f| (f.ids[0].min(f.ids[1]), f.ids[0].max(f.ids[1])))
            .collect();
        let mut expected = BTreeSet::new();
        for (i, a) in events.iter().enumerate() {
            for b in &events[i + 1..] {
                if a.entity != b.entity
                    && (a.time - b.time).abs() <= p.tolerance_s
                    && analysis::haversine(a.location().unwrap(), b.location().unwrap())
                        <= p.radius_m
                {
                    expected.insert((a.id, b.id));
                }
            }
        }
        assert_eq!(actual, expected);
    }
}
#[test]
fn clusters_are_explicitly_transitive() {
    let mut events = Vec::new();
    let template = chronoscope::demo::dataset().events[0].clone();
    for i in 0..3u64 {
        let mut e = template.clone();
        e.id = i;
        e.time = (i as i64) as f64;
        e.lat = Some(0.);
        e.lon = Some(i as f64 * 0.001);
        events.push(e);
    }
    let result = analysis::run(&events, Pattern::Clusters, &Parameters::default());
    assert_eq!(result.findings.len(), 1);
    assert_eq!(result.findings[0].ids.len(), 3);
}

#[test]
fn unsafe_saved_context_is_rejected_before_it_reaches_ui() {
    let mut p = project::Project::new(chronoscope::demo::dataset());
    p.filter.start = Some(i64::MIN as f64);
    assert!(p.validate().is_err());
    p.filter = Filter::default();
    p.views.push(project::SavedView {
        scene: Default::default(),
        name: "Bad view".into(),
        mode: Default::default(),
        filter: Filter::default(),
        selected: BTreeSet::new(),
        camera: project::Camera {
            zoom: 100_000.,
            ..Default::default()
        },
    });
    assert!(p.validate().is_err());
}
