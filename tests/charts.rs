use chronoscope::{engine::Engine, model::Dataset, project::Project};
use serde_json::{json, Value};
fn fixture(path: &std::path::Path) -> Engine {
    let mut events = chronoscope::demo::dataset()
        .events
        .into_iter()
        .take(8)
        .collect::<Vec<_>>();
    for (i, e) in events.iter_mut().enumerate() {
        e.entity = if i < 4 { "A" } else { "B" }.into();
        e.time = (i as i64 * 3600) as f64;
        e.value = (i != 3).then_some(i as f64);
        e.attrs.clear();
        e.attrs.insert("Wind".into(), (2 * i + 1).to_string());
        e.attrs.insert("Pressure".into(), (1000 - i).to_string());
        e.attrs.insert("Hostile '\" ]".into(), "yes".into());
    }
    Engine::new(
        Project::new(Dataset {
            name: "Charts".into(),
            events,
        }),
        path.into(),
    )
    .unwrap()
}
fn chart(e: &Engine, c: Value) -> Value {
    let v = e.invoke("chart_data", json!({"config":c})).unwrap();
    chronoscope::schema::validate_output("chart_data", &v).unwrap();
    v
}
#[test]
fn presentation_labels_roundtrip_without_changing_calculations_or_selection() {
    let d = tempfile::tempdir().unwrap();
    let e = fixture(d.path());
    let plain = chart(&e, json!({"aggregate":"mean"}));
    let labels = json!({"aggregate":"mean","title":"Wind <comparison>","x_label":"Animal","y_label":"Mean wind (knots)","y2_label":"Pressure"});
    let labelled = chart(&e, labels.clone());
    assert_eq!(plain["rows"], labelled["rows"]);
    e.invoke(
        "select_query",
        json!({"config":labelled["config"],"chart_marks":[{"x":"B","series":null}]}),
    )
    .unwrap();
    assert_eq!(chart(&e, json!({"scope":"selected"}))["input_count"], 4);
    e.invoke("scene_sync",json!({"scene":{"chart":labels,"chart_presets":[{"name":"Wind","config":labelled["config"]}]}})).unwrap();
    let file = d.path().join("labelled.chronoscope");
    e.invoke("save", json!({"path":file})).unwrap();
    e.invoke("open", json!({"path":file})).unwrap();
    let s = e.invoke("snapshot", json!({"compact":true})).unwrap();
    assert_eq!(s["scene"]["chart"]["title"], "Wind <comparison>");
    assert_eq!(
        s["scene"]["chart_presets"][0]["config"]["y_label"],
        "Mean wind (knots)"
    );
    assert!(e
        .invoke("chart_data", json!({"config":{"title":"x".repeat(257)}}))
        .is_err());
}
#[test]
fn automatic_units_require_uniform_complete_scope_metadata() {
    let d = tempfile::tempdir().unwrap();
    let mut events = chronoscope::demo::dataset()
        .events
        .into_iter()
        .take(4)
        .collect::<Vec<_>>();
    for (i, event) in events.iter_mut().enumerate() {
        event.entity = if i < 2 { "A" } else { "B" }.into();
        event.value = Some(i as f64);
        event.attrs.clear();
        event.attrs.insert(
            "value_unit".into(),
            if i < 2 {
                "m"
            } else if i == 2 {
                "ft"
            } else {
                ""
            }
            .into(),
        );
        event
            .attrs
            .insert("value_description".into(), "Published depth".into());
    }
    let e = Engine::new(
        Project::new(Dataset {
            name: "Units".into(),
            events,
        }),
        d.path().into(),
    )
    .unwrap();
    let all = chart(&e, json!({"aggregate":"max"}));
    assert!(
        chart(&e, json!({}))["value_metadata"].is_null(),
        "An Event-count chart must not acquire measurement units or descriptions"
    );
    assert!(all["value_metadata"]["unit"].is_null());
    assert!(all["warnings"]
        .as_array()
        .unwrap()
        .iter()
        .any(|w| w.as_str().unwrap().contains("Source Value units")));
    assert_eq!(all["value_metadata"]["description"], "Published depth");
    assert_eq!(all["value_extent"], json!([0., 3.]));
    e.invoke(
        "filter",
        json!({"filter":{"predicates":[{"field":"entity","op":"Equals","value":"A"}]}}),
    )
    .unwrap();
    let filtered = chart(&e, json!({"aggregate":"max"}));
    assert_eq!(filtered["value_metadata"]["unit"], "m");
    assert_eq!(filtered["value_extent"], json!([0., 1.]));
    assert!(
        chart(&e, json!({"scope":"all","aggregate":"max"}))["value_metadata"]["unit"].is_null()
    );
    e.invoke(
        "filter",
        json!({"filter":{"predicates":[{"field":"entity","op":"Equals","value":"B"}]}}),
    )
    .unwrap();
    assert!(
        chart(&e, json!({"aggregate":"max"}))["value_metadata"]["unit"].is_null(),
        "Partial unit declarations must not label the whole scope"
    );
    let schema = e
        .invoke("dataset_schema", json!({"include_attribute_types":true}))
        .unwrap();
    assert_eq!(schema["numeric_counts"]["value"], 4);
    e.invoke("select", json!({"ids":[]})).unwrap();
    let empty = chart(&e, json!({"scope":"selected","aggregate":"max"}));
    assert!(empty["value_metadata"].is_null());
}
#[test]
fn aggregations_scopes_imported_fields_and_linked_members_are_exact() {
    let d = tempfile::tempdir().unwrap();
    let e = fixture(d.path());
    let rev = e.invoke("revision", json!({})).unwrap();
    let r = chart(&e, json!({"x":"entity","aggregate":"count"}));
    assert_eq!(r["input_count"], 8);
    assert_eq!(r["rows"][0]["y"], 4);
    assert_eq!(r["rows"][1]["y"], 4);
    assert_eq!(rev, e.invoke("revision", json!({})).unwrap());
    let r = chart(
        &e,
        json!({"x":"entity","y":"attribute:Wind","aggregate":"mean"}),
    );
    assert_eq!(r["rows"][0]["y"], 4.);
    assert_eq!(r["rows"][1]["y"], 12.);
    e.invoke("select_query",json!({"config":r["config"],"chart_marks":[{"x":"B","series":null}],"expected_revision":r["revision"]})).unwrap();
    assert_eq!(chart(&e, json!({"scope":"selected"}))["input_count"], 4);
    assert!(e.invoke("select_query",json!({"config":r["config"],"chart_marks":[{"x":"A","series":null}],"expected_revision":r["revision"]})).unwrap_err().starts_with("CONFLICT:"));
    e.invoke(
        "filter",
        json!({"filter":{"predicates":[{"field":"entity","op":"Equals","value":"A"}]}}),
    )
    .unwrap();
    assert_eq!(chart(&e, json!({"scope":"visible"}))["input_count"], 4);
    assert_eq!(chart(&e, json!({"scope":"selected"}))["input_count"], 0);
    assert_eq!(chart(&e, json!({"scope":"all"}))["input_count"], 8);
}
#[test]
fn histogram_edges_and_box_quantiles_use_full_scope() {
    let d = tempfile::tempdir().unwrap();
    let e = fixture(d.path());
    let r = chart(
        &e,
        json!({"kind":"histogram","y":"attribute:Wind","bins":2}),
    );
    assert_eq!(r["rows"].as_array().unwrap().len(), 2);
    assert_eq!(r["rows"][0]["count"], 4);
    assert_eq!(r["rows"][1]["count"], 4);
    e.invoke(
        "select_query",
        json!({"config":r["config"],"chart_marks":[{"x":1,"series":null}]}),
    )
    .unwrap();
    assert_eq!(chart(&e, json!({"scope":"selected"}))["input_count"], 4);
    let r = chart(
        &e,
        json!({"kind":"boxplot","x":"entity","y":"attribute:Wind"}),
    );
    assert_eq!(r["rows"][0]["box"], json!([1., 2.5, 4., 5.5, 7.]));
    assert_eq!(r["rows"][1]["box"], json!([9., 10.5, 12., 13.5, 15.]));
}
#[test]
fn scatter_pairs_trendline_secondary_axis_and_limits() {
    let d = tempfile::tempdir().unwrap();
    let e = fixture(d.path());
    let r = chart(
        &e,
        json!({"kind":"scatter","x":"attribute:Wind","y":"attribute:Pressure","x_axis":"number","trendline":true,"limit":2}),
    );
    assert_eq!(r["input_count"], 8);
    assert_eq!(r["evaluated_count"], 8);
    assert_eq!(r["limited"], true);
    assert_eq!(r["trend"]["slope"], -0.5);
    assert_eq!(r["trend"]["intercept"], 1000.5);
    e.invoke("select_query",json!({"config":r["config"],"chart_marks":[{"x":r["rows"][0]["x"],"series":null,"value":r["rows"][0]["y"]}]})).unwrap();
    assert_eq!(chart(&e, json!({"scope":"selected"}))["input_count"], 1);
    let r = chart(
        &e,
        json!({"kind":"line","x":"time","x_axis":"time","time_bucket":"hour","aggregate":"mean","y":"value","y2":"attribute:Pressure"}),
    );
    assert!(r["rows"][3]["y"].is_null());
    assert_eq!(r["rows"][3]["y2"], 997.);
    e.invoke(
        "select_query",
        json!({"config":r["config"],"chart_marks":[{"x":10800,"series":null,"axis":0}]}),
    )
    .unwrap();
    assert_eq!(chart(&e, json!({"scope":"selected"}))["input_count"], 0);
    e.invoke(
        "select_query",
        json!({"config":r["config"],"chart_marks":[{"x":10800,"series":null,"axis":1}]}),
    )
    .unwrap();
    assert_eq!(chart(&e, json!({"scope":"selected"}))["input_count"], 1);
}
#[test]
fn presets_round_trip_and_unknown_fields_do_not_become_empty_charts() {
    let d = tempfile::tempdir().unwrap();
    let e = fixture(d.path());
    e.invoke("scene_sync",json!({"scene":{"chart":{"kind":"histogram"},"chart_presets":[{"name":"Wind","config":{"kind":"histogram","y":"attribute:Wind"}}]}})).unwrap();
    let file = d.path().join("charts.chronoscope");
    e.invoke("save", json!({"path":file})).unwrap();
    e.invoke("open", json!({"path":file})).unwrap();
    let s = e.invoke("snapshot", json!({})).unwrap();
    assert_eq!(s["scene"]["chart_presets"][0]["name"], "Wind");
    assert!(e
        .invoke(
            "chart_data",
            json!({"config":{"y":"attribute:missing","aggregate":"mean"}})
        )
        .is_err());
    assert!(e
        .invoke(
            "chart_data",
            json!({"config":{"kind":"scatter","y2":"value"}})
        )
        .is_err());
    let r = chart(
        &e,
        json!({"x":"attribute:Hostile '\" ]","aggregate":"count"}),
    );
    assert_eq!(r["rows"][0]["y"], 8);
}
#[test]
fn selection_retries_and_internal_keys_are_safe() {
    let d = tempfile::tempdir().unwrap();
    let e = fixture(d.path());
    let r = chart(&e, json!({"aggregate":"count"}));
    let a = json!({"config":r["config"],"chart_marks":[{"x":"A","series":null}],"expected_revision":r["revision"],"idempotency_key":"chart-test"});
    let first = e.invoke("select_query", a.clone()).unwrap();
    let second = e.invoke("select_query", a).unwrap();
    assert_eq!(first, second);
    assert!(e
        .invoke("select_query", json!({"_chart_ids":["1"]}))
        .is_err());
    assert!(e
        .invoke(
            "select_query",
            json!({"config":r["config"],"chart_marks":[],"filter":{}})
        )
        .is_err());
}
#[test]
fn one_mark_can_select_more_than_ten_thousand_records_without_paging() {
    let d = tempfile::tempdir().unwrap();
    let mut events = chronoscope::demo::dataset().events;
    let original = events[0].clone();
    events.clear();
    for n in 0..10050 {
        let mut row = original.clone();
        row.id = n + 1;
        row.entity = "Large group".into();
        events.push(row);
    }
    let e = Engine::new(
        Project::new(Dataset {
            name: "Large".into(),
            events,
        }),
        d.path().into(),
    )
    .unwrap();
    let r = chart(&e, json!({"limit":1}));
    assert_eq!(r["rows"][0]["count"], 10050);
    let s = e
        .invoke(
            "select_query",
            json!({"config":r["config"],"chart_marks":[{"x":"Large group","series":null}]}),
        )
        .unwrap();
    assert_eq!(s["selected"], 10050);
}
#[test]
fn public_view_set_merges_chart_settings_and_validates_presets() {
    let d = tempfile::tempdir().unwrap();
    let e = fixture(d.path());
    e.invoke("view_set",json!({"chart":{"kind":"scatter","x":"attribute:Wind","y":"attribute:Pressure","x_axis":"number"},"chart_presets":[{"name":"Wind","config":{"kind":"histogram","y":"attribute:Wind"}}],"inspector_tab":"charts"})).unwrap();
    let r = e
        .invoke("view_set", json!({"chart":{"trendline":true}}))
        .unwrap();
    chronoscope::schema::validate_output("view_set", &r).unwrap();
    assert_eq!(r["scene"]["chart"]["x"], "attribute:Wind");
    assert_eq!(r["scene"]["chart"]["trendline"], true);
    assert_eq!(r["scene"]["chart_presets"][0]["name"], "Wind");
    assert!(e
        .invoke("view_set", json!({"chart":{"kind":"histogram"}}))
        .is_err());
    let r = e.invoke("view_set", json!({"chart":null})).unwrap();
    assert!(r["scene"]["chart"].is_null());
}

#[test]
fn calendar_buckets_floor_fractional_instants_before_month_and_year_boundaries() {
    let d = tempfile::tempdir().unwrap();
    let mut events = chronoscope::demo::dataset().events;
    events.truncate(6);
    let times = [
        -0.0000002,
        0.,
        2678399.9999999,
        2678400.,
        1767225599.9999998,
        1767225600.,
    ];
    for (event, time) in events.iter_mut().zip(times) {
        event.time = time;
        event.end = None;
    }
    let e = Engine::new(
        Project::new(Dataset {
            name: "Calendar edges".into(),
            events,
        }),
        d.path().into(),
    )
    .unwrap();
    for (bucket, expected) in [
        (
            "month",
            json!([
                [-2678400., 1],
                [0., 2],
                [2678400., 1],
                [1764547200., 1],
                [1767225600., 1]
            ]),
        ),
        (
            "year",
            json!([[-31536000., 1], [0., 3], [1735689600., 1], [1767225600., 1]]),
        ),
    ] {
        let r = chart(
            &e,
            json!({"kind":"line", "x":"time", "x_axis":"time", "time_bucket":bucket}),
        );
        let actual: Vec<_> = r["rows"]
            .as_array()
            .unwrap()
            .iter()
            .map(|r| json!([r["x"], r["count"]]))
            .collect();
        assert_eq!(json!(actual), expected, "{bucket}");
        let selected = e.invoke("select_query", json!({"config":r["config"], "chart_marks":[{"x":1767225600.,"series":null}], "expected_revision":r["revision"]})).unwrap();
        assert_eq!(
            selected["selected"], 1,
            "{bucket} selection must exclude the instant before New Year"
        );
    }
}

#[test]
fn secondary_axis_union_selects_all_displayed_evidence_within_public_mark_budget() {
    let d = tempfile::tempdir().unwrap();
    let e = fixture(d.path());
    let r = chart(&e, json!({"aggregate":"mean", "y2":"attribute:Pressure"}));
    let marks: Vec<_> = r["rows"]
        .as_array()
        .unwrap()
        .iter()
        .flat_map(|r| [0, 1].map(|axis| json!({"x":r["x"], "series":r["series"], "axis":axis})))
        .collect();
    let selected = e
        .invoke(
            "select_query",
            json!({"config":r["config"], "chart_marks":marks, "expected_revision":r["revision"]}),
        )
        .unwrap();
    assert_eq!(
        selected["selected"], 8,
        "includes the Event missing its primary measurement"
    );
    // A report can contain 10,000 rows, each with two selectable axes.
    chronoscope::schema::validate(
        "select_query",
        &json!({"config":r["config"], "chart_marks":vec![json!({"x":"A","series":null});20_000]}),
    )
    .unwrap();
    assert!(chronoscope::schema::validate(
        "select_query",
        &json!({"config":r["config"], "chart_marks":vec![json!({"x":"A","series":null});20_001]})
    )
    .is_err());
}

#[test]
fn full_dual_axis_mark_budget_selects_every_event_without_sampling() {
    let d = tempfile::tempdir().unwrap();
    let template = chronoscope::demo::dataset().events[0].clone();
    let events = (0..10_000)
        .map(|n| {
            let mut event = template.clone();
            event.id = n + 1;
            event.time = n as f64;
            event.end = None;
            event.value = (n % 2 == 0).then_some(n as f64);
            event.attrs.clear();
            event.attrs.insert("Secondary".into(), n.to_string());
            event
        })
        .collect();
    let e = Engine::new(
        Project::new(Dataset {
            name: "Full mark budget".into(),
            events,
        }),
        d.path().into(),
    )
    .unwrap();
    let r = chart(
        &e,
        json!({"kind":"line","x":"time","x_axis":"time","time_bucket":"none","aggregate":"mean","y2":"attribute:Secondary","limit":10_000}),
    );
    assert_eq!(r["rows"].as_array().unwrap().len(), 10_000);
    assert_eq!(r["limited"], false);
    let marks: Vec<_> = r["rows"]
        .as_array()
        .unwrap()
        .iter()
        .flat_map(|r| [0, 1].map(|axis| json!({"x":r["x"],"series":r["series"],"axis":axis})))
        .collect();
    let selected = e
        .invoke(
            "select_query",
            json!({"config":r["config"],"chart_marks":marks,"expected_revision":r["revision"]}),
        )
        .unwrap();
    assert_eq!(selected["selected"], 10_000);
}

#[test]
fn displayed_long_category_keys_remain_selectable() {
    let d = tempfile::tempdir().unwrap();
    let mut events = chronoscope::demo::dataset().events;
    events.truncate(2);
    let label = "Long category '\" ".repeat(2_000);
    events[0].entity = label.clone();
    events[0]
        .attrs
        .insert("Long category".into(), label.clone());
    events[1].entity = "Short category".into();
    events[1]
        .attrs
        .insert("Long category".into(), "Short category".into());
    events[0].value = Some(1.);
    events[1].value = Some(2.);
    let e = Engine::new(
        Project::new(Dataset {
            name: "Long labels".into(),
            events,
        }),
        d.path().into(),
    )
    .unwrap();
    for (field, kind) in [
        ("entity", "bar"),
        ("attribute:Long category", "bar"),
        ("entity", "boxplot"),
        ("attribute:Long category", "boxplot"),
    ] {
        let r = chart(&e, json!({"x":field,"kind":kind}));
        assert!(r["rows"]
            .as_array()
            .unwrap()
            .iter()
            .any(|r| r["x"] == label));
        let selected = e.invoke("select_query", json!({"config":r["config"], "chart_marks":[{"x":label,"series":null}], "expected_revision":r["revision"]})).unwrap();
        assert_eq!(selected["selected"], 1);
    }
}
