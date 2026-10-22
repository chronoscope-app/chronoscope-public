//! Real indexed records; no language-model calculations or sampled answers.
use chronoscope::{engine::Engine, model::Dataset, project::Project};
use serde_json::{json, Value};

fn fixture(dir: &std::path::Path) -> Engine {
    let mut events = chronoscope::demo::dataset().events;
    events.truncate(6);
    for (i, e) in events.iter_mut().enumerate() {
        e.id = 9_007_199_254_740_993 + i as u64;
        e.entity = if i < 3 { "A" } else { "B" }.into();
        e.source = "fixture".into();
        e.category = "sample".into();
        e.time = (1_704_067_200 + i as i64 * 60) as f64;
        e.end = None;
        e.value = if i < 4 { Some((i + 1) as f64) } else { None };
        e.attrs.clear();
        e.attrs.insert(
            "Output".into(),
            if i < 4 {
                ((i + 1) * 2).to_string()
            } else {
                "unknown".into()
            },
        );
        e.attrs.insert("Constant".into(), "7".into());
        e.attrs
            .insert("Inverse".into(), (-(i as i64 + 1)).to_string());
    }
    Engine::new(
        Project::new(Dataset {
            name: "Analytics fixture".into(),
            events,
        }),
        dir.into(),
    )
    .unwrap()
}
fn checked(e: &Engine, command: &str, args: Value) -> Value {
    let v = e.invoke(command, args).unwrap();
    chronoscope::schema::validate_output(command, &v).unwrap();
    v
}
fn close(v: &Value, expected: f64) {
    assert!(
        (v.as_f64().unwrap() - expected).abs() < 1e-10,
        "{v} != {expected}"
    );
}

#[test]
fn full_scope_statistics_are_deterministic_bounded_and_do_not_mutate() {
    let d = tempfile::tempdir().unwrap();
    let e = fixture(d.path());
    let revision = e.invoke("revision", json!({})).unwrap();
    let args = json!({"field":"value","other_field":"attribute:Output"});
    let r = checked(&e, "statistics", args.clone());
    assert_eq!(r, checked(&e, "statistics", args));
    assert_eq!(r["evaluated_count"], 6);
    assert_eq!(r["sampled"], false);
    let s = &r["summary"];
    assert_eq!(s["count"], 4);
    assert_eq!(s["missing"], 2);
    close(&s["min"], 1.);
    close(&s["max"], 4.);
    close(&s["sum"], 10.);
    close(&s["mean"], 2.5);
    close(&s["variance_population"], 1.25);
    close(&s["standard_deviation_population"], 1.25_f64.sqrt());
    close(&s["standard_deviation_sample"], (5. / 3_f64).sqrt());
    assert_eq!(r["paired"]["count"], 4);
    assert_eq!(r["paired"]["missing_pairs"], 2);
    close(&r["paired"]["pearson_r"], 1.);
    assert_eq!(r["paired"]["undefined_reason"], Value::Null);
    assert!(r.to_string().len() < 2200);
    assert_eq!(revision, e.invoke("revision", json!({})).unwrap());
    let r = checked(
        &e,
        "statistics",
        json!({"field":"attribute:Output","other_field":"attribute:Inverse"}),
    );
    assert_eq!(r["summary"]["missing"], 2);
    close(&r["paired"]["pearson_r"], -1.);
}

#[test]
fn filters_selection_source_and_empty_cases_have_exact_denominators() {
    let d = tempfile::tempdir().unwrap();
    let e = fixture(d.path());
    e.invoke(
        "select",
        json!({"ids":["9007199254740993","9007199254740996"],"mode":"replace"}),
    )
    .unwrap();
    e.invoke("filter", json!({"filter":{"hidden_entities":["A"]}}))
        .unwrap();
    let r = checked(&e, "statistics", json!({"field":"value"}));
    assert_eq!(r["evaluated_count"], 3);
    assert_eq!(r["summary"]["count"], 1);
    close(&r["summary"]["mean"], 4.);
    assert_eq!(r["summary"]["standard_deviation_sample"], Value::Null);
    let r = checked(
        &e,
        "statistics",
        json!({"field":"value","selected_only":true}),
    );
    assert_eq!(r["evaluated_count"], 1);
    assert_eq!(r["scope"]["selected_only"], true);
    let r = checked(
        &e,
        "statistics",
        json!({"field":"value","selected_only":true,"apply_filter":false}),
    );
    assert_eq!(r["evaluated_count"], 2);
    close(&r["summary"]["mean"], 2.5);
    let r = checked(&e, "statistics", json!({"field":"value","source":"absent"}));
    assert_eq!(r["evaluated_count"], 0);
    assert_eq!(r["summary"]["sum"], Value::Null);
    let r = checked(
        &e,
        "statistics",
        json!({"field":"attribute:Constant","other_field":"value","apply_filter":false}),
    );
    assert_eq!(r["paired"]["pearson_r"], Value::Null);
    assert!(r["paired"]["undefined_reason"].is_string());
}

#[test]
fn schema_profiles_expose_mixed_fields_without_inventing_types_or_units() {
    let d = tempfile::tempdir().unwrap();
    let e = fixture(d.path());
    let schema = checked(
        &e,
        "dataset_schema",
        json!({"include_attribute_types":true,"attribute_limit":1,"attribute_search":"out"}),
    );
    assert_eq!(schema["attributes"], json!(["Output"]));
    assert_eq!(
        schema["attribute_types"]["Output"],
        json!({"field":"attribute:Output","kind":"mixed","present_count":6,"numeric_count":4})
    );
    let schema = checked(&e, "dataset_schema", json!({"attribute_limit":1}));
    assert_eq!(schema["attribute_count"], 3);
    assert_eq!(schema["next_attribute_offset"], 1);
    assert_eq!(schema["attributes_limited"], true);
    let next = checked(
        &e,
        "dataset_schema",
        json!({"attribute_limit":2,"attribute_offset":1}),
    );
    assert_eq!(next["next_attribute_offset"], Value::Null);
    for field in [
        "id",
        "attribute:missing",
        "value; DROP TABLE events;--",
        "attribute:Output' OR 1=1 --",
    ] {
        assert!(e.invoke("statistics", json!({"field":field})).is_err());
    }
    assert_eq!(
        checked(&e, "statistics", json!({"field":"value"}))["evaluated_count"],
        6
    );
}

#[test]
fn utc_projection_and_year_grouping_match_across_epoch_and_calendar_boundaries() {
    let d = tempfile::tempdir().unwrap();
    let mut events = chronoscope::demo::dataset().events;
    events.truncate(5);
    let times = [-60, 0, 1_704_067_140, 1_704_067_200, 1_735_689_600];
    for (i, e) in events.iter_mut().enumerate() {
        e.id = i as u64 + 1;
        e.time = times[i] as f64;
        e.end = None;
    }
    let e = Engine::new(
        Project::new(Dataset {
            name: "Calendar".into(),
            events,
        }),
        d.path().into(),
    )
    .unwrap();
    let rows = checked(
        &e,
        "query",
        json!({"fields":["id","time","time_utc","year_utc"]}),
    );
    assert_eq!(rows["events"][0]["id"], "1");
    assert_eq!(rows["events"][0]["time_utc"], "1969-12-31T23:59:00Z");
    assert_eq!(rows["events"][3]["year_utc"], 2024);
    let id = checked(
        &e,
        "events",
        json!({"id":"4","fields":["time_utc","year_utc"]}),
    );
    assert_eq!(id["events"][0]["year_utc"], 2024);
    let r = checked(&e, "aggregate", json!({"group_by":"year"}));
    assert_eq!(
        r["groups"]
            .as_array()
            .unwrap()
            .iter()
            .map(|g| g["key"].as_str().unwrap())
            .collect::<Vec<_>>(),
        vec!["1969", "1970", "2023", "2024", "2025"]
    );
    let r = checked(
        &e,
        "time_parse",
        json!({"value":"2023-12-31T19:00:59.999-05:00"}),
    );
    assert_eq!(r["epoch"], 1_704_067_259.999);
    assert_eq!(r["year_utc"], 2024);
    assert_eq!(r["precision"], "fractional_second");
    assert!(e
        .invoke("time_parse", json!({"value":"01/02/2024"}))
        .is_err());
    assert_eq!(
        checked(
            &e,
            "time_parse",
            json!({"value":"01/02/2024","date_order":"dmy"})
        )["time_utc"],
        "2024-02-01T00:00:00Z"
    );
}

#[test]
fn statistics_process_more_records_than_render_or_query_pages() {
    let d = tempfile::tempdir().unwrap();
    let template = chronoscope::demo::dataset().events.remove(0);
    let events = (0..25_000)
        .map(|i| {
            let mut e = template.clone();
            e.id = i + 1;
            e.value = Some((i % 100) as f64);
            e.attrs.clear();
            e
        })
        .collect();
    let e = Engine::new(
        Project::new(Dataset {
            name: "25k exact statistics".into(),
            events,
        }),
        d.path().into(),
    )
    .unwrap();
    let r = checked(&e, "statistics", json!({"field":"value"}));
    assert_eq!(r["evaluated_count"], 25_000);
    assert_eq!(r["summary"]["count"], 25_000);
    assert_eq!(r["sampled"], false);
    close(&r["summary"]["mean"], 49.5);
    close(&r["summary"]["variance_population"], 833.25);
    assert!(r.to_string().len() < 2200);
}

#[test]
fn cli_mcp_and_background_jobs_discover_the_same_analytics_contracts() {
    for command in ["statistics", "time_parse"] {
        assert!(chronoscope::schema::command_schema(command).is_some());
        assert!(chronoscope::mcp::tools()
            .iter()
            .any(|t| t["name"] == format!("chronoscope_{command}")));
    }
    assert!(chronoscope::jobs::COMMANDS.contains(&"statistics"));
}

#[test]
fn library_compensated_sum_retains_small_residuals_and_mean() {
    let d = tempfile::tempdir().unwrap();
    let mut events = chronoscope::demo::dataset().events;
    events.truncate(3);
    for (event, value) in events.iter_mut().zip([1e16, 1., -1e16]) {
        event.value = Some(value);
    }
    let e = Engine::new(
        Project::new(Dataset {
            name: "Cancellation oracle".into(),
            events,
        }),
        d.path().into(),
    )
    .unwrap();
    let r = checked(&e, "statistics", json!({"field":"value"}));
    close(&r["summary"]["sum"], 1.);
    close(&r["summary"]["mean"], 1. / 3.);
    let snapshot = checked(&e, "snapshot", json!({"include_statistics":true}));
    close(&snapshot["stats"]["sum"], 1.);
    close(&snapshot["stats"]["mean"], 1. / 3.);
    close(&snapshot["stats"]["median"], 1.);
    assert_eq!(
        snapshot["stats"]["std_dev"],
        r["summary"]["standard_deviation_population"]
    );
    let legacy = chronoscope::analysis::statistics([1e16, 1., -1e16].into_iter());
    assert_eq!(legacy.sum, 1.);
    assert_eq!(legacy.mean, 1. / 3.);
    assert!(r["method"].as_str().unwrap().contains("average 0.17.0"));
    assert!(r["method"].as_str().unwrap().contains("accurate 0.4.1"));
}

#[test]
fn live_summary_and_tool_statistics_share_filters_and_empty_value_semantics() {
    let d = tempfile::tempdir().unwrap();
    let e = fixture(d.path());
    for filter in [
        json!({}),
        json!({"hidden_entities":["A"]}),
        json!({"search":"no match possible"}),
    ] {
        e.invoke("filter", json!({"filter":filter})).unwrap();
        let snapshot = checked(&e, "snapshot", json!({"include_statistics":true}));
        let stats = checked(&e, "statistics", json!({"field":"value"}));
        let count = stats["summary"]["count"].as_u64().unwrap();
        assert_eq!(snapshot["stats"]["count"], count);
        for field in ["mean", "min", "max"] {
            assert_eq!(snapshot["stats"][field], stats["summary"][field]);
        }
        if count > 0 {
            assert_eq!(snapshot["stats"]["sum"], stats["summary"]["sum"]);
            assert_eq!(
                snapshot["stats"]["std_dev"],
                stats["summary"]["standard_deviation_population"]
            );
        } else {
            assert_eq!(snapshot["stats"]["sum"], 0.);
            assert_eq!(snapshot["stats"]["std_dev"], 0.);
            assert!(stats["summary"]["sum"].is_null());
        }
    }
}

#[test]
fn library_range_guards_do_not_report_false_zero_correlations_or_null_overflow() {
    // average::pearson squares the scale of its moment sums. With both large
    // or small finite fields that denominator over/underflows even though the
    // mathematical correlation is +1. The adapter must request rescaling.
    for scale in [1e100, 1e-100] {
        let d = tempfile::tempdir().unwrap();
        let mut events = chronoscope::demo::dataset().events;
        events.truncate(3);
        for (i, event) in events.iter_mut().enumerate() {
            event.value = Some((i + 1) as f64 * scale);
            event.attrs.clear();
            event
                .attrs
                .insert("paired".into(), ((i + 1) as f64 * scale).to_string());
        }
        let e = Engine::new(
            Project::new(Dataset {
                name: "Pearson range oracle".into(),
                events,
            }),
            d.path().into(),
        )
        .unwrap();
        assert!(
            checked(&e, "statistics", json!({"field":"value"}))["summary"]["variance_population"]
                .as_f64()
                .unwrap()
                .is_finite()
        );
        let before = e.invoke("revision", json!({})).unwrap();
        let error = e
            .invoke(
                "statistics",
                json!({"field":"value","other_field":"attribute:paired"}),
            )
            .unwrap_err();
        assert!(
            error.starts_with("RESOURCE_LIMIT:") && error.contains("rescale"),
            "{error}"
        );
        assert_eq!(before, e.invoke("revision", json!({})).unwrap());
    }
    let d = tempfile::tempdir().unwrap();
    let mut data = chronoscope::demo::dataset();
    data.events.truncate(2);
    data.events[0].value = Some(1e308);
    data.events[1].value = Some(-1e308);
    let e = Engine::new(Project::new(data), d.path().into()).unwrap();
    assert!(e
        .invoke("statistics", json!({"field":"value"}))
        .unwrap_err()
        .starts_with("RESOURCE_LIMIT:"));
}
