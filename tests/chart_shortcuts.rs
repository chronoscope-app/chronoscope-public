use chronoscope::{engine::Engine, model::Dataset, project::Project};
use serde_json::{json, Value};

fn fixture(path: &std::path::Path, rows: &[(&str, f64, Option<f64>)]) -> Engine {
    let template = chronoscope::demo::dataset().events[0].clone();
    let events = rows
        .iter()
        .enumerate()
        .map(|(i, (entity, time, value))| {
            let mut e = template.clone();
            e.id = i as u64 + 1;
            e.entity = (*entity).into();
            e.time = *time;
            e.end = None;
            e.value = *value;
            e.source = "test".into();
            e.attrs.clear();
            e
        })
        .collect();
    Engine::new(
        Project::new(Dataset {
            name: "Chart shortcuts".into(),
            events,
        }),
        path.into(),
    )
    .unwrap()
}
fn chart(e: &Engine, config: Value) -> Value {
    let v = e.invoke("chart_data", json!({"config":config})).unwrap();
    chronoscope::schema::validate_output("chart_data", &v).unwrap();
    v
}
fn row(report: &Value, x: Value, series: Value) -> &Value {
    report["rows"]
        .as_array()
        .unwrap()
        .iter()
        .find(|r| r["x"] == x && r["series"] == series)
        .unwrap()
}
fn select(e: &Engine, report: &Value, marks: Value) -> u64 {
    e.invoke("select_query", json!({"config":report["config"],"chart_marks":marks,"expected_revision":report["revision"]})).unwrap()["selected"].as_u64().unwrap()
}

#[test]
fn weekday_hour_cells_use_utc_floor_at_fractional_and_pre_epoch_boundaries() {
    let d = tempfile::tempdir().unwrap();
    let e = fixture(
        d.path(),
        &[
            ("A", -0.0000002, Some(0.)),
            ("A", 0., Some(1.)),
            ("A", 3599.9999999, Some(2.)),
            ("B", 3600., Some(3.)),
            ("B", 345600., Some(4.)),
            ("B", 950400., Some(5.)),
            ("B", 950399.9999999, None),
        ],
    );
    let r = chart(&e, json!({"kind":"heatmap","x":"time","x_axis":"time"}));
    assert_eq!(r["rows"].as_array().unwrap().len(), 168);
    assert_eq!(row(&r, json!(23), json!(2))["y"], 1); // Wed, before epoch
    assert_eq!(row(&r, json!(0), json!(3))["y"], 2); // Thursday 00:00
    assert_eq!(row(&r, json!(1), json!(3))["y"], 1);
    assert_eq!(row(&r, json!(0), json!(0))["y"], 2); // consecutive Mondays
    assert_eq!(row(&r, json!(23), json!(6))["y"], 1); // Sunday just before midnight
    assert_eq!(r["evaluated_count"], 7);
    assert_eq!(
        r["rows"]
            .as_array()
            .unwrap()
            .iter()
            .map(|r| r["count"].as_u64().unwrap())
            .sum::<u64>(),
        7
    );
    assert_eq!(select(&e, &r, json!([{"x":0,"series":3}])), 2);
    let r = chart(
        &e,
        json!({"kind":"heatmap","x":"time","x_axis":"time","aggregate":"mean"}),
    );
    assert_eq!(row(&r, json!(0), json!(3))["y"], 1.5);
    assert!(row(&r, json!(12), json!(1))["y"].is_null());
    assert_eq!(r["excluded_count"], 1);
    assert_eq!(select(&e, &r, json!([{"x":0,"series":0}])), 2);
    e.invoke("filter", json!({"filter":{"start":345600.}}))
        .unwrap();
    assert_eq!(
        chart(&e, json!({"kind":"heatmap","x":"time","x_axis":"time"}))["input_count"],
        3
    );
    assert_eq!(
        chart(
            &e,
            json!({"kind":"heatmap","x":"time","x_axis":"time","scope":"all"})
        )["input_count"],
        7
    );
}

fn comparison_fixture(path: &std::path::Path) -> Engine {
    fixture(
        path,
        &[
            ("A", 0., Some(10.)),
            ("A", 0.5, Some(20.)),
            ("A", 1., Some(30.)),
            ("B", 1.5, None),
            ("A", 2., Some(40.)),
            ("A", 2.5, Some(50.)),
            ("B", 3., Some(60.)),
            ("C", 3.5, Some(-20.)),
            ("A", 4., Some(70.)),
            ("A", -1., Some(80.)),
        ],
    )
}

#[test]
fn comparisons_pair_groups_and_distinguish_zero_missing_and_outside_windows() {
    let d = tempfile::tempdir().unwrap();
    let e = comparison_fixture(d.path());
    let c = json!({"kind":"period","period_a":[0.,2.],"period_b":[2.,4.]});
    let r = chart(&e, c.clone());
    assert_eq!(r["input_count"], 10);
    assert_eq!(r["evaluated_count"], 8);
    assert_eq!(r["excluded_count"], 0);
    assert_eq!(r["outside_period_count"], 2);
    let a = row(&r, json!("A"), json!(0));
    assert_eq!(a["before"], 3.);
    assert_eq!(a["after"], 2.);
    assert_eq!(a["change"], -1.);
    assert!((a["percent_change"].as_f64().unwrap() + 100. / 3.).abs() < 1e-12);
    let missing = row(&r, json!("C"), json!(0));
    assert_eq!(missing["y"], 0);
    assert_eq!(missing["count"], 0);
    assert_eq!(missing["after"], 1.);
    assert!(missing["percent_change"].is_null());
    // The sample exactly at 2 belongs only to B; 4 belongs to neither.
    assert_eq!(select(&e, &r, json!([{"x":"A","series":1}])), 2);
    let r = chart(
        &e,
        json!({"kind":"period","aggregate":"mean","period_a":[0.,2.],"period_b":[2.,4.]}),
    );
    assert_eq!(r["evaluated_count"], 7);
    assert_eq!(r["excluded_count"], 1);
    assert_eq!(r["outside_period_count"], 2);
    let a = row(&r, json!("A"), json!(0));
    assert_eq!(a["before"], 20.);
    assert_eq!(a["after"], 45.);
    assert_eq!(a["percent_change"], 125.);
    assert!(row(&r, json!("B"), json!(0))["y"].is_null());
    assert!(row(&r, json!("B"), json!(1))["percent_change"].is_null());
    assert_eq!(select(&e, &r, json!([{"x":"B","series":0}])), 0);
}

#[test]
fn automatic_periods_include_last_sample_and_keep_bounded_pairs_together() {
    let d = tempfile::tempdir().unwrap();
    let e = comparison_fixture(d.path());
    let r = chart(&e, json!({"kind":"period"}));
    assert_eq!(r["config"]["period_a"][1], r["config"]["period_b"][0]);
    assert_eq!(r["config"]["period_b"][1], 4f64.next_up());
    assert_eq!(r["evaluated_count"], 10);
    assert_eq!(r["outside_period_count"], 0);
    let limited = chart(&e, json!({"kind":"period","limit":3}));
    assert_eq!(limited["total_marks"], 6);
    assert_eq!(limited["rows"].as_array().unwrap().len(), 2);
    assert_eq!(limited["limited"], true);
    assert_eq!(
        select(
            &e,
            &limited,
            limited["rows"]
                .as_array()
                .unwrap()
                .iter()
                .map(|r| json!({"x":r["x"],"series":r["series"]}))
                .collect()
        ),
        7
    );
    let single = fixture(d.path(), &[("A", 0., None)]);
    let r = chart(&single, json!({"kind":"period"}));
    assert_eq!(r["evaluated_count"], 1);
    assert_eq!(row(&r, json!("A"), json!(0))["y"], 0);
    assert_eq!(row(&r, json!("A"), json!(1))["y"], 1);
    let empty = chart(
        &e,
        json!({"kind":"period","scope":"selected","period_a":[50.,60.],"period_b":[60.,70.]}),
    );
    assert!(empty["rows"].as_array().unwrap().is_empty());
    assert_eq!(empty["outside_period_count"], 7);
}

#[test]
fn invalid_windows_and_incompatible_chart_controls_are_rejected() {
    let d = tempfile::tempdir().unwrap();
    let e = comparison_fixture(d.path());
    for c in [
        json!({"kind":"period","period_a":[0.,2.],"period_b":[1.,3.]}),
        json!({"kind":"period","period_a":[0.,0.],"period_b":[2.,3.]}),
        json!({"kind":"period","period_a":[0.,2.]}),
        json!({"kind":"period","limit":1}),
        json!({"kind":"period","group":"category"}),
        json!({"kind":"heatmap","x":"entity"}),
        json!({"kind":"heatmap","x":"time","x_axis":"time","group":"entity"}),
    ] {
        assert!(e.invoke("chart_data", json!({"config":c})).is_err());
    }
    let reversed = chart(
        &e,
        json!({"kind":"period","period_a":[2.,4.],"period_b":[0.,2.]}),
    );
    assert_eq!(row(&reversed, json!("A"), json!(0))["change"], 1.);
    let unequal = chart(
        &e,
        json!({"kind":"period","period_a":[0.,1.],"period_b":[2.,4.]}),
    );
    assert!(unequal["warnings"]
        .as_array()
        .unwrap()
        .iter()
        .any(|w| w.as_str().unwrap().contains("different durations")));
}

#[test]
fn new_charts_are_portable_presets_and_available_through_view_set() {
    let d = tempfile::tempdir().unwrap();
    let e = comparison_fixture(d.path());
    let pattern = json!({"kind":"heatmap","x":"time","x_axis":"time"});
    let period = json!({"kind":"period","period_a":[0.,2.],"period_b":[2.,4.]});
    e.invoke("view_set",json!({"inspector_tab":"charts","chart":period,"chart_presets":[{"name":"Patterns","config":pattern},{"name":"Before and after","config":period}]})).unwrap();
    let path = d.path().join("eight-charts.chronoscope");
    e.invoke("save", json!({"path":path})).unwrap();
    e.invoke("open", json!({"path":path})).unwrap();
    let snap = e.invoke("snapshot", json!({"compact":true})).unwrap();
    assert_eq!(snap["scene"]["chart"]["period_b"], json!([2., 4.]));
    let report = chart(&e, snap["scene"]["chart_presets"][0]["config"].clone());
    assert_eq!(report["total_marks"], 168);
}

#[test]
fn signed_baselines_and_numeric_overflow_have_explicit_semantics() {
    let d = tempfile::tempdir().unwrap();
    let e = fixture(d.path(), &[("A", 0., Some(-10.)), ("A", 1., Some(-5.))]);
    let c = json!({"kind":"period","aggregate":"sum","period_a":[0.,1.],"period_b":[1.,2.]});
    let r = chart(&e, c.clone());
    assert_eq!(r["rows"][0]["change"], 5.);
    assert_eq!(r["rows"][0]["percent_change"], 50.);
    let huge = fixture(d.path(), &[("A", 0., Some(-1e308)), ("A", 1., Some(1e308))]);
    assert!(huge
        .invoke("chart_data", json!({"config":c}))
        .unwrap_err()
        .contains("numeric range"));
}

#[test]
fn response_byte_budget_preserves_comparison_pairs() {
    let d = tempfile::tempdir().unwrap();
    let names: Vec<_> = (0..300)
        .map(|n| format!("{n:03}{}", "x".repeat(8190)))
        .collect();
    let rows: Vec<_> = names.iter().map(|s| (s.as_str(), 0., Some(1.))).collect();
    let e = fixture(d.path(), &rows);
    let r = chart(&e, json!({"kind":"period"}));
    assert_eq!(r["limited"], true);
    assert_eq!(r["rows"].as_array().unwrap().len() % 2, 0);
    for pair in r["rows"].as_array().unwrap().as_chunks::<2>().0 {
        assert_eq!(pair[0]["x"], pair[1]["x"]);
        assert_eq!(pair[0]["series"], 0);
        assert_eq!(pair[1]["series"], 1);
    }
}

#[test]
fn hundred_thousand_events_are_aggregated_in_full_with_constant_size_pattern_grid() {
    let d = tempfile::tempdir().unwrap();
    let rows: Vec<_> = (0..100_000)
        .map(|n| ("A", n as f64, Some(n as f64)))
        .collect();
    let e = fixture(d.path(), &rows);
    let grid = chart(
        &e,
        json!({"kind":"heatmap","x":"time","x_axis":"time","aggregate":"sum"}),
    );
    assert_eq!(grid["rows"].as_array().unwrap().len(), 168);
    assert_eq!(grid["evaluated_count"], 100_000);
    let total: f64 = grid["rows"]
        .as_array()
        .unwrap()
        .iter()
        .filter_map(|r| r["y"].as_f64())
        .sum();
    assert_eq!(total, 4_999_950_000.);
    let period = chart(&e, json!({"kind":"period","limit":2}));
    assert_eq!(period["rows"].as_array().unwrap().len(), 2);
    assert_eq!(period["rows"][0]["y"], 50_000);
    assert_eq!(period["rows"][1]["y"], 50_000);
}
