//! Charts and analytic tools must use the same full-source numerical rules.
use chronoscope::{engine::Engine, model::Dataset, project::Project};
use serde_json::{json, Value};

fn fixture(dir: &std::path::Path, values: &[Option<f64>], times: &[f64]) -> Engine {
    let template = chronoscope::demo::dataset().events[0].clone();
    let events = values
        .iter()
        .enumerate()
        .map(|(n, value)| {
            let mut event = template.clone();
            event.id = n as u64 + 1;
            event.entity = "A".into();
            event.source = "test".into();
            event.time = times.get(n).copied().unwrap_or(0.);
            event.end = None;
            event.value = *value;
            event.attrs.clear();
            event
        })
        .collect();
    Engine::new(
        Project::new(Dataset {
            name: "Calculation parity".into(),
            events,
        }),
        dir.into(),
    )
    .unwrap()
}

fn chart(e: &Engine, config: Value) -> Value {
    let result = e.invoke("chart_data", json!({"config":config})).unwrap();
    chronoscope::schema::validate_output("chart_data", &result).unwrap();
    result
}

fn analytics(e: &Engine, capability: &str, parameters: Value) -> Vec<Value> {
    let result = e
        .invoke(
            "analytics_run",
            json!({"plan":{
                "capability":capability,"scope":"all","parameters":parameters
            }}),
        )
        .unwrap();
    chronoscope::schema::validate_output("analytics_run", &result).unwrap();
    e.invoke(
        "analytics_result",
        json!({"result_id":result["result_id"],"section":"rows","limit":200}),
    )
    .unwrap()["rows"]
        .as_array()
        .unwrap()
        .clone()
}

#[test]
fn charts_and_analytics_share_utc_calendar_buckets_at_fractional_boundaries() {
    let d = tempfile::tempdir().unwrap();
    let times = [
        -0.0000002,
        0.,
        3599.9999999,
        3600.,
        2678399.9999999,
        2678400.,
        1767225599.9999998,
        1767225600.,
        253402300800.,
    ];
    let e = fixture(d.path(), &vec![Some(1.); times.len()], &times);
    for bucket in ["second", "minute", "hour", "day", "week", "month", "year"] {
        let c = chart(
            &e,
            json!({"kind":"line","scope":"all","x":"time","x_axis":"time","time_bucket":bucket}),
        );
        let a = analytics(&e, "time_series", json!({"bucket":bucket}));
        let plotted: Vec<_> = c["rows"]
            .as_array()
            .unwrap()
            .iter()
            .map(|r| (r["x"].as_f64().unwrap(), r["count"].as_u64().unwrap()))
            .collect();
        let tool: Vec<_> = a
            .iter()
            .map(|r| {
                (
                    r["bucket_start"].as_f64().unwrap(),
                    r["count"].as_u64().unwrap(),
                )
            })
            .collect();
        assert_eq!(plotted, tool, "{bucket}");
        assert_eq!(c["evaluated_count"], times.len());
        assert_eq!(c["excluded_count"], 0);
    }
}

#[test]
fn histogram_counts_and_inclusive_quartiles_agree_without_changing_observed_whiskers() {
    let d = tempfile::tempdir().unwrap();
    let e = fixture(
        d.path(),
        &[Some(1.), Some(2.), Some(3.), Some(4.), Some(100.), None],
        &[],
    );
    let c = chart(&e, json!({"kind":"histogram","bins":4}));
    let a = analytics(&e, "histogram", json!({"field":"value","bins":4}));
    for r in c["rows"].as_array().unwrap() {
        let bin = r["x"].as_u64().unwrap();
        assert_eq!(
            r["count"],
            a.iter().find(|r| r["bin"] == bin).unwrap()["count"]
        );
    }
    assert_eq!(c["evaluated_count"], 5);
    let c = chart(&e, json!({"kind":"boxplot"}));
    let a = analytics(
        &e,
        "quantiles",
        json!({"field":"value","probabilities":[0.25,0.5,0.75]}),
    );
    for (n, r) in a.iter().enumerate() {
        assert_eq!(c["rows"][0]["box"][n + 1], r["value"]);
    }
    // ECharts' preparation would place the upper whisker at the fence (7).
    // Preserve the existing observed whisker (4) and original outlier (100).
    assert_eq!(c["rows"][0]["box"], json!([1., 2., 3., 4., 4.]));
    assert_eq!(c["rows"][0]["outliers"], json!([100.]));
    let constant = fixture(d.path(), &[Some(7.), Some(7.), None], &[]);
    let c = chart(&constant, json!({"kind":"histogram"}));
    let a = analytics(&constant, "histogram", json!({"field":"value"}));
    assert_eq!(c["rows"][0]["count"], a[0]["count"]);
    assert_eq!(c["rows"][0]["range"], json!([7., 8.]));
    assert_eq!(a[0]["start"], 7.);
    assert_eq!(a[0]["end"], 7.);
}

#[test]
fn chart_and_tool_aggregates_reuse_compensated_sums_and_preserve_missing_values() {
    let d = tempfile::tempdir().unwrap();
    let e = fixture(d.path(), &[Some(1e16), Some(1.), Some(-1e16), None], &[]);
    let a = analytics(&e, "group", json!({"group_by":["entity"],"field":"value"}));
    assert_eq!(a[0]["sum"], 1.);
    assert_eq!(a[0]["mean"], 1. / 3.);
    for (aggregate, expected) in [("sum", 1.), ("mean", 1. / 3.)] {
        let c = chart(&e, json!({"aggregate":aggregate}));
        assert_eq!(c["rows"][0]["y"], expected);
        assert_eq!(c["excluded_count"], 1);
        let heat = chart(
            &e,
            json!({"kind":"heatmap","x":"time","x_axis":"time","aggregate":aggregate}),
        );
        assert_eq!(
            heat["rows"]
                .as_array()
                .unwrap()
                .iter()
                .find(|r| r["count"] == 3)
                .unwrap()["y"],
            expected
        );
        let period = chart(&e, json!({"kind":"period","aggregate":aggregate}));
        assert_eq!(period["rows"][1]["y"], expected);
        assert!(period["rows"][0]["y"].is_null());
    }
    let a = analytics(&e, "time_series", json!({"field":"value","bucket":"day"}));
    assert_eq!(a[0]["sum"], 1.);
    assert_eq!(a[0]["mean"], 1. / 3.);
    let empty = fixture(d.path(), &[None, None], &[]);
    let a = analytics(
        &empty,
        "group",
        json!({"group_by":["entity"],"field":"value"}),
    );
    assert!(a[0]["sum"].is_null());
    assert!(a[0]["mean"].is_null());
    let huge = fixture(d.path(), &[Some(1e308), Some(1e308)], &[]);
    assert!(huge
        .invoke("chart_data", json!({"config":{"aggregate":"sum"}}))
        .unwrap_err()
        .contains("numeric range"));
}
