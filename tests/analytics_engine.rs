use chronoscope::{engine::Engine, model::Dataset, project::Project};
use serde_json::{json, Value};
fn engine(dir: &std::path::Path) -> Engine {
    let mut events = chronoscope::demo::dataset().events;
    events.truncate(8);
    for (j, e) in events.iter_mut().enumerate() {
        e.id = 9_007_199_254_740_993 + j as u64;
        e.entity = if j < 4 { "A" } else { "B" }.into();
        e.related_to = if j < 4 { "B" } else { "C" }.into();
        e.category = if j < 4 { "one" } else { "two" }.into();
        e.time = (1_704_067_200 + j as i64 * 86400) as f64;
        e.end = None;
        e.lat = Some(0.);
        e.lon = Some(j as f64 * 0.01);
        e.value = Some([1., 2., 3., 4., 6., 8., 10., 12.][j]);
        e.attrs.clear();
        e.attrs.insert("x".into(), e.value.unwrap().to_string());
        e.attrs
            .insert("y".into(), (e.value.unwrap() * 3. + 2.).to_string());
        e.source = "fixture.csv".into();
    }
    Engine::new(
        Project::new(Dataset {
            name: "Analytics oracle".into(),
            events,
        }),
        dir.into(),
    )
    .unwrap()
}
fn run(e: &Engine, cap: &str, params: Value) -> Value {
    let r = e
        .invoke(
            "analytics_run",
            json!({"plan":{"capability":cap,"scope":"all","parameters":params}}),
        )
        .unwrap_or_else(|error| panic!("{cap}: {error}"));
    chronoscope::schema::validate_output("analytics_run", &r).unwrap();
    r
}
fn rows(e: &Engine, r: &Value) -> Vec<Value> {
    e.invoke(
        "analytics_result",
        json!({"result_id":r["result_id"],"section":"rows","limit":200}),
    )
    .unwrap()["rows"]
        .as_array()
        .unwrap()
        .clone()
}
fn close(v: &Value, x: f64) {
    assert!((v.as_f64().unwrap() - x).abs() < 1e-7, "{v} != {x}");
}
#[test]
fn every_capability_has_valid_schema_and_sql_operations_have_known_answers() {
    let d = tempfile::tempdir().unwrap();
    let e = engine(d.path());
    for cap in chronoscope::analytics::registry::NAMES {
        let s = e
            .invoke("analytics_describe", json!({"capability":cap}))
            .unwrap();
        jsonschema::validator_for(&s["parameters_schema"]).unwrap();
    }
    let r = run(&e, "profile", json!({"fields":["attribute:x","entity"]}));
    assert_eq!(rows(&e, &r)[0]["numeric_count"], 8);
    let r = run(&e, "group", json!({"group_by":["entity"],"field":"value"}));
    let v = rows(&e, &r);
    assert_eq!(v.len(), 2);
    assert_eq!(v[0]["count"], 4);
    close(&v[0]["mean"], 2.5);
    let r = run(&e, "duplicates", json!({"fields":["entity","category"]}));
    assert_eq!(rows(&e, &r).len(), 2);
    let r = run(
        &e,
        "quantiles",
        json!({"field":"value","probabilities":[0.,0.5,1.]}),
    );
    let v = rows(&e, &r);
    close(&v[0]["value"], 1.);
    close(&v[1]["value"], 5.);
    close(&v[2]["value"], 12.);
    let r = run(&e, "histogram", json!({"field":"value","bins":4}));
    assert_eq!(
        rows(&e, &r)
            .iter()
            .map(|r| r["count"].as_u64().unwrap())
            .sum::<u64>(),
        8
    );
    let r = run(
        &e,
        "outliers",
        json!({"field":"value","method":"zscore","threshold":1.}),
    );
    assert_eq!(r["summary"]["outlier_count"], 4);
    let r = run(
        &e,
        "compare",
        json!({"group_by":"entity","baseline":[1704067200,1704412800],"comparison":[1704412800,1704758400]}),
    );
    let v = rows(&e, &r);
    assert_eq!(v[0]["group_key"], "B");
    assert_eq!(v[0]["count_change"], 4);
    assert!(v[0]["percent_change"].is_null());
    let r = run(
        &e,
        "time_series",
        json!({"bucket":"day","rolling_window":2}),
    );
    assert_eq!(rows(&e, &r).len(), 8);
    close(&rows(&e, &r)[7]["rolling_count_mean"], 1.);
    let r = run(&e, "chi_square", json!({"fields":["entity","category"]}));
    close(&r["summary"]["chi_square"], 8.);
    close(&r["summary"]["cramers_v"], 1.);
}
#[test]
fn numerical_models_graphs_tracks_and_text_are_real_library_operations() {
    let d = tempfile::tempdir().unwrap();
    let e = engine(d.path());
    let r = run(
        &e,
        "correlation",
        json!({"fields":["attribute:x","attribute:y"]}),
    );
    close(&rows(&e, &r)[0]["pearson_r"], 1.);
    let r = run(
        &e,
        "one_sample_t",
        json!({"field":"value","expected_mean":5.75}),
    );
    close(&r["summary"]["t"], 0.);
    close(&r["summary"]["p_two_sided"], 1.);
    let r = run(
        &e,
        "welch_t",
        json!({"field":"value","group_by":"entity","group_a":"A","group_b":"B"}),
    );
    close(&r["summary"]["mean_difference"], -6.5);
    assert!(r["summary"]["p_two_sided"].as_f64().unwrap() < 0.02);
    let r = run(
        &e,
        "regression",
        json!({"fields":["attribute:x"],"target":"attribute:y"}),
    );
    close(&r["summary"]["intercept"], 2.);
    close(&r["summary"]["coefficients"][0], 3.);
    close(&r["summary"]["r_squared"], 1.);
    assert_eq!(rows(&e, &r)[0]["event_id"], "9007199254740993");
    let r = run(
        &e,
        "kmeans",
        json!({"fields":["attribute:x","attribute:y"],"clusters":2,"seed":42}),
    );
    assert_eq!(
        r["summary"]["cluster_sizes"]
            .as_array()
            .unwrap()
            .iter()
            .map(|x| x.as_u64().unwrap())
            .sum::<u64>(),
        8
    );
    let r = run(
        &e,
        "pca",
        json!({"fields":["attribute:x","attribute:y"],"dimensions":1}),
    );
    let detail = e
        .invoke(
            "analytics_result",
            json!({"result_id":r["result_id"],"section":"details"}),
        )
        .unwrap();
    close(&detail["summary"]["explained_fraction_of_total"][0], 1.);
    let r = run(
        &e,
        "graph",
        json!({"source_field":"entity","target_field":"related_to"}),
    );
    assert_eq!(r["summary"]["node_count"], 3);
    assert_eq!(r["summary"]["weak_components"], 1);
    assert_eq!(rows(&e, &r)[0]["entity"], "B");
    let r = run(&e, "trajectories", json!({}));
    let v = rows(&e, &r);
    close(&v[0]["track_distance_m"], 3339.584723798207);
    assert_eq!(v[0]["elapsed_seconds"], 259200.);
    let r = run(
        &e,
        "similar_text",
        json!({"field":"entity","query":"a","minimum_score":1.}),
    );
    assert_eq!(rows(&e, &r)[0]["value"], "A");
}
#[test]
fn preparation_persistence_cache_scope_and_staleness_are_bound_to_the_data() {
    let d = tempfile::tempdir().unwrap();
    let e = engine(d.path());
    let args = json!({"plan":{"capability":"quantiles","scope":"all","parameters":{"field":"peak","probabilities":[0.5]},"prepare":{"group_by":["entity","year_utc"],"metrics":[{"alias":"peak","op":"max","field":"value"}]}}});
    let r = e.invoke("analytics_run", args.clone()).unwrap();
    assert_eq!(r["input_count"], 8);
    assert_eq!(r["prepared_count"], 2);
    close(&rows(&e, &r)[0]["value"], 8.);
    let revision = e.invoke("revision", json!({})).unwrap();
    assert_eq!(r, e.invoke("analytics_run", args).unwrap());
    assert_eq!(revision, e.invoke("revision", json!({})).unwrap());
    assert!(e.workspace_dirty());
    let file = d.path().join("analytics.chronoscope");
    e.invoke("save", json!({"path":file})).unwrap();
    let restored = Engine::from_path(&file, d.path().join("reopened"), None).unwrap();
    let loaded = restored
        .invoke("analytics_result", json!({"result_id":r["result_id"]}))
        .unwrap();
    assert_eq!(loaded["data_stale"], false);
    restored
        .invoke(
            "edit",
            json!({"id":"9007199254740993","changes":{"value":99.}}),
        )
        .unwrap();
    assert_eq!(
        restored
            .invoke("analytics_result", json!({"result_id":r["result_id"]}))
            .unwrap()["data_stale"],
        true
    );
    let other = engine(&d.path().join("other"));
    assert!(other
        .invoke("analytics_result", json!({"result_id":r["result_id"]}))
        .is_err());
}
#[test]
fn invalid_plans_do_not_mutate_records_and_spatial_degrees_cannot_be_feature_distances() {
    let d = tempfile::tempdir().unwrap();
    let e = engine(d.path());
    let rev = e.invoke("revision", json!({})).unwrap();
    for plan in [
        json!({"capability":"group","parameters":{"group_by":["entity"],"arbitrary":true}}),
        json!({"capability":"regression","parameters":{"fields":["value"],"target":"value"}}),
        json!({"capability":"kmeans","parameters":{"fields":["lat","lon"],"clusters":2}}),
        json!({"capability":"quantiles","parameters":{"field":"attribute:x' OR 1=1 --"}}),
    ] {
        assert!(e.invoke("analytics_run", json!({"plan":plan})).is_err());
    }
    assert_eq!(rev, e.invoke("revision", json!({})).unwrap());
    assert!(e.invoke("analytics_run",json!({"expected_revision":999,"plan":{"capability":"profile","parameters":{"fields":["value"]}}})).unwrap_err().starts_with("CONFLICT:"));
    e.invoke(
        "select",
        json!({"ids":["9007199254740993","9007199254740994"]}),
    )
    .unwrap();
    e.invoke("filter", json!({"filter":{"hidden_entities":["A"]}}))
        .unwrap();
    let r=e.invoke("analytics_run",json!({"plan":{"capability":"profile","scope":"selected","parameters":{"fields":["value"]}}})).unwrap();
    assert_eq!(r["input_count"], 0);
}
#[test]
fn periodicity_has_a_known_spectral_peak() {
    let d = tempfile::tempdir().unwrap();
    let mut data = chronoscope::demo::dataset();
    data.events.truncate(16);
    for (j, e) in data.events.iter_mut().enumerate() {
        e.id = j as u64 + 1;
        e.time = (1704067200 + j as i64 * 3600) as f64;
        e.end = None;
        e.value = Some((j as f64 * std::f64::consts::PI / 2.).sin());
    }
    let e = Engine::new(Project::new(data), d.path().into()).unwrap();
    let r = run(
        &e,
        "periodicity",
        json!({"field":"value","bucket_seconds":3600}),
    );
    close(&rows(&e, &r)[0]["period_seconds"], 14400.);
}

#[test]
fn large_scope_is_complete_and_matrix_budget_never_silently_samples() {
    let d = tempfile::tempdir().unwrap();
    let template = chronoscope::demo::dataset().events.remove(0);
    let count = 200_001usize;
    let events = (0..count)
        .map(|j| {
            let mut e = template.clone();
            e.id = j as u64 + 1;
            e.entity = format!("entity-{}", j % 100);
            e.value = Some(j as f64);
            e.attrs.clear();
            e.attrs.insert("x".into(), (j % 97).to_string());
            e.attrs.insert("y".into(), (j % 53).to_string());
            e
        })
        .collect();
    let e = Engine::new(
        Project::new(Dataset {
            name: "Full scope".into(),
            events,
        }),
        d.path().into(),
    )
    .unwrap();
    let r = run(&e, "profile", json!({"fields":["value"]}));
    assert_eq!(r["input_count"], count);
    assert_eq!(r["sampled"], false);
    close(&rows(&e, &r)[0]["mean"], 100_000.);
    let g = e.invoke("analytics_run", json!({"plan":{"capability":"group","scope":"all","parameters":{"group_by":["entity"]},"output_limit":3}})).unwrap();
    assert_eq!(g["total_rows"], 100);
    assert_eq!(g["retained_rows"], 3);
    assert_eq!(g["limited"], true);
    assert_eq!(g["input_count"], count);
    assert!(e.invoke("analytics_run",json!({"plan":{"capability":"kmeans","scope":"all","parameters":{"fields":["attribute:x","attribute:y"],"clusters":2}}})).unwrap_err().starts_with("RESOURCE_LIMIT:"));
    let prepared = e.invoke("analytics_run",json!({"plan":{"capability":"kmeans","scope":"all","parameters":{"fields":["mean_x","mean_y"],"clusters":2},"prepare":{"group_by":["entity"],"metrics":[{"alias":"mean_x","op":"mean","field":"attribute:x"},{"alias":"mean_y","op":"mean","field":"attribute:y"}]}}})).unwrap();
    assert_eq!(prepared["input_count"], count);
    assert_eq!(prepared["prepared_count"], 100);
    assert_eq!(prepared["evaluated_count"], 100);
    assert!(rows(&e, &prepared).iter().all(|r| r["event_id"].is_null()));
}

#[test]
fn independent_read_view_survives_edits_and_results_can_be_removed() {
    use std::sync::{atomic::AtomicBool, Arc, Barrier};
    let d = tempfile::tempdir().unwrap();
    let e = Arc::new(engine(d.path()));
    let ready = Arc::new(Barrier::new(2));
    let resumed = Arc::new(Barrier::new(2));
    let (r, go) = (ready.clone(), resumed.clone());
    let worker = e.clone();
    let job = std::thread::spawn(move || {
        chronoscope::operation::with_context(
            chronoscope::operation::Context {
                cancelled: Arc::new(AtomicBool::new(false)),
                scope: None,
                progress: Some(Arc::new(move |_, _, message| {
                    if message == "Reading scoped analytic columns" {
                        r.wait();
                        go.wait();
                    }
                })),
            },
            || run(&worker, "profile", json!({"fields":["value"]})),
        )
    });
    ready.wait();
    // Must complete while the analytics reader is paused, without blocking the map.
    e.invoke(
        "edit",
        json!({"id":"9007199254740993","changes":{"value":999.}}),
    )
    .unwrap();
    resumed.wait();
    let result = job.join().unwrap();
    close(&rows(&e, &result)[0]["mean"], 5.75);
    assert_eq!(result["data_stale"], true);
    assert_eq!(
        e.invoke("analytics_remove", json!({"result_id":result["result_id"]}))
            .unwrap()["removed"],
        true
    );
    assert_eq!(
        e.invoke("analytics_remove", json!({"result_id":result["result_id"]}))
            .unwrap()["removed"],
        false
    );
    assert_eq!(
        e.invoke("analytics_list", json!({})).unwrap()["results"],
        json!([])
    );
    assert!(
        chronoscope::operation::with_deadline(std::time::Duration::ZERO, || e
            .invoke("analytics_discover", json!({})))
        .unwrap_err()
        .starts_with("CANCELLED:")
    );
}

#[test]
fn project_replacement_cancellation_and_output_limits_preserve_ownership() {
    use std::sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Barrier,
    };
    let d = tempfile::tempdir().unwrap();
    let e = Arc::new(engine(d.path()));
    let other = engine(&d.path().join("replacement"));
    let file = d.path().join("replacement.chronoscope");
    other.invoke("save", json!({"path":file})).unwrap();
    let ready = Arc::new(Barrier::new(2));
    let resume = Arc::new(Barrier::new(2));
    let (r, go, worker) = (ready.clone(), resume.clone(), e.clone());
    let job = std::thread::spawn(move || {
        chronoscope::operation::with_context(
            chronoscope::operation::Context {
                cancelled: Arc::new(AtomicBool::new(false)),
                scope: None,
                progress: Some(Arc::new(move |_, _, message| {
                    if message == "Reading scoped analytic columns" {
                        r.wait();
                        go.wait();
                    }
                })),
            },
            || {
                worker.invoke(
                    "analytics_run",
                    json!({"plan":{"capability":"profile","parameters":{"fields":["value"]}}}),
                )
            },
        )
    });
    ready.wait();
    e.invoke("open", json!({"path":file})).unwrap();
    resume.wait();
    assert!(job.join().unwrap().unwrap_err().starts_with("CONFLICT:"));
    assert_eq!(
        e.invoke("analytics_list", json!({})).unwrap()["results"],
        json!([])
    );
    let cancelled = Arc::new(AtomicBool::new(false));
    let flag = cancelled.clone();
    let result = chronoscope::operation::with_context(
        chronoscope::operation::Context {
            cancelled,
            scope: None,
            progress: Some(Arc::new(move |_, _, message| {
                if message == "Reading scoped analytic columns" {
                    flag.store(true, Ordering::Relaxed);
                }
            })),
        },
        || {
            e.invoke(
                "analytics_run",
                json!({"plan":{"capability":"profile","parameters":{"fields":["value"]}}}),
            )
        },
    );
    assert!(result.unwrap_err().starts_with("CANCELLED:"));
    assert_eq!(
        e.invoke("analytics_list", json!({})).unwrap()["results"],
        json!([])
    );
    let result=e.invoke("analytics_run",json!({"plan":{"capability":"profile","parameters":{"fields":["entity","value"]},"output_limit":1}})).unwrap();
    assert_eq!(result["retained_rows"], 1);
    assert_eq!(result["total_rows"], 2);
    assert_eq!(result["limited"], true);
}
