use chronoscope::{engine::Engine, model::Dataset, project::Project};
use serde_json::{json, Value};
fn fixture(path: &std::path::Path) -> Engine {
    let mut events = chronoscope::demo::dataset().events;
    events.truncate(80);
    for (i, e) in events.iter_mut().enumerate() {
        e.id = 9_007_199_254_740_993 + i as u64;
        e.entity = "A".into();
        e.source = "One".into();
        e.time = (1577836800 + if i == 79 { 200 } else { i as i64 } * 3600) as f64;
        e.end = None;
        let wind = if i == 79 { 999. } else { (i % 10) as f64 };
        e.value = Some(wind);
        e.attrs.clear();
        e.attrs.insert("Wind".into(), wind.to_string());
        e.attrs.insert("Copy".into(), wind.to_string());
        if i != 2 {
            e.attrs
                .insert("Pressure".into(), (1000. - 2. * wind).to_string());
        }
        e.attrs.insert("station_id".into(), i.to_string());
    }
    Engine::new(
        Project::new(Dataset {
            name: "Scan".into(),
            events,
        }),
        path.into(),
    )
    .unwrap()
}
fn config() -> Value {
    json!({"fields":["attribute:Wind","attribute:Pressure","attribute:Copy"]})
}
fn scan(e: &Engine, c: Value) -> Value {
    let report = e.invoke("pattern_scan", json!({"config":c})).unwrap();
    chronoscope::schema::validate_output("pattern_scan", &report).unwrap();
    report
}
fn finding(r: &Value, kind: &str) -> Value {
    r["report"]["findings"]
        .as_array()
        .unwrap()
        .iter()
        .find(|f| f["kind"] == kind)
        .unwrap()
        .clone()
}
#[test]
fn full_scope_known_statistics_and_exact_evidence_preserve_u64_ids() {
    let dir = tempfile::tempdir().unwrap();
    let e = fixture(dir.path());
    let revision = e.invoke("revision", json!({})).unwrap();
    let r = scan(&e, config());
    assert_eq!(r["cache_hit"], false);
    assert_eq!(r["report"]["input_count"], 80);
    assert_eq!(r["report"]["sampled"], false);
    assert_eq!(r["report"]["numeric_fields"].as_array().unwrap().len(), 2);
    let out = finding(&r, "outliers");
    assert_eq!(out["count"], 1);
    assert_eq!(out["examples"][0]["event_id"], "9007199254741072");
    assert_eq!(finding(&r, "duplicates")["count"], 80);
    assert_eq!(finding(&r, "missing")["count"], 1);
    let correlation = finding(&r, "correlation");
    assert_eq!(correlation["count"], 79);
    assert!((correlation["metrics"]["pearson_r"].as_f64().unwrap() + 1.).abs() < 1e-12);
    let gap = finding(&r, "gaps");
    assert_eq!(gap["count"], 1);
    assert_eq!(gap["metrics"]["threshold_seconds"], 10800.);
    assert_eq!(revision, e.invoke("revision", json!({})).unwrap());
    e.invoke(
        "select_query",
        json!({"pattern_scan_id":r["scan_id"],"pattern_finding_id":out["id"]}),
    )
    .unwrap();
    assert_eq!(
        e.invoke("snapshot", json!({})).unwrap()["selected"],
        json!(["9007199254741072"])
    );
    e.invoke(
        "select_query",
        json!({"pattern_scan_id":r["scan_id"],"pattern_finding_id":gap["id"]}),
    )
    .unwrap();
    assert_eq!(
        e.invoke("snapshot", json!({})).unwrap()["selected_count"],
        2
    );
    e.invoke(
        "select_query",
        json!({"pattern_scan_id":r["scan_id"],"pattern_finding_id":correlation["id"]}),
    )
    .unwrap();
    assert_eq!(
        e.invoke("snapshot", json!({})).unwrap()["selected_count"],
        79
    );
    assert_eq!(scan(&e, config())["cache_hit"], true);
}
#[test]
fn cache_tracks_data_filters_and_relevant_selection_without_presentation_churn() {
    let dir = tempfile::tempdir().unwrap();
    let e = fixture(dir.path());
    let c = config();
    assert!(e
        .invoke("pattern_scan", json!({"config":c,"cached_only":true}))
        .unwrap()["report"]
        .is_null());
    let first = scan(&e, c.clone());
    e.invoke("view_set", json!({"mode":"globe"})).unwrap();
    let same = scan(&e, c.clone());
    assert_eq!(same["scan_id"], first["scan_id"]);
    assert_eq!(same["cache_hit"], true);
    e.invoke("filter", json!({"filter":{"start":1577836800+40*3600}}))
        .unwrap();
    let miss = e
        .invoke("pattern_scan", json!({"config":c,"cached_only":true}))
        .unwrap();
    assert!(miss["report"].is_null());
    assert_ne!(miss["scan_id"], first["scan_id"]);
    assert!(e.invoke("select_query",json!({"pattern_scan_id":first["scan_id"],"pattern_finding_id":finding(&first,"outliers")["id"]})).unwrap_err().starts_with("CONFLICT:"));
    assert_eq!(scan(&e, c.clone())["report"]["input_count"], 40);
    e.invoke("filter", json!({"filter":{}})).unwrap();
    assert_eq!(scan(&e, c.clone())["cache_hit"], true);
    e.invoke(
        "edit",
        json!({"id":"9007199254740993","changes":{"label":"changed"}}),
    )
    .unwrap();
    assert_eq!(scan(&e, c)["cache_hit"], false);
}
#[test]
fn selected_scope_empty_scope_validation_and_selection_retries_are_safe() {
    let dir = tempfile::tempdir().unwrap();
    let e = fixture(dir.path());
    let mut c = config();
    c["scope"] = json!("selected");
    let empty = scan(&e, c.clone());
    assert_eq!(empty["report"]["input_count"], 0);
    assert_eq!(empty["report"]["findings"], json!([]));
    e.invoke("select_query",json!({"filter":{"predicates":[{"field":"id","op":"Less","value":"9007199254741033"}]},"apply_filter":false})).unwrap();
    let r = scan(&e, c);
    assert_eq!(r["report"]["input_count"], 40);
    let corr = finding(&r, "correlation");
    let args = json!({"pattern_scan_id":r["scan_id"],"pattern_finding_id":corr["id"],"idempotency_key":"pattern-select"});
    let selected = e.invoke("select_query", args.clone()).unwrap();
    assert_eq!(selected, e.invoke("select_query", args).unwrap());
    assert_eq!(
        e.invoke("snapshot", json!({})).unwrap()["selected_count"],
        39
    );
    assert!(e
        .invoke(
            "select_query",
            json!({"pattern_scan_id":r["scan_id"],"pattern_finding_id":corr["id"]})
        )
        .unwrap_err()
        .starts_with("CONFLICT:"));
    assert!(e
        .invoke("select_query", json!({"pattern_finding_id":"outliers:0"}))
        .is_err());
    assert!(e
        .invoke(
            "select_query",
            json!({"pattern_scan_id":r["scan_id"],"pattern_finding_id":corr["id"],"filter":{}})
        )
        .is_err());
    assert!(e
        .invoke(
            "pattern_scan",
            json!({"config":{"fields":["attribute:Unknown"]}})
        )
        .is_err());
    assert!(e
        .invoke("pattern_scan", json!({"config":{"minimum_records":1}}))
        .is_err());
    assert!(e
        .invoke("pattern_scan", json!({"config":{"scope":"all"}}))
        .is_err());
}
#[test]
fn periodic_count_cycle_has_known_period_and_automatic_discovery_omits_named_identifiers() {
    let dir = tempfile::tempdir().unwrap();
    let base = chronoscope::demo::dataset().events[0].clone();
    let mut events = vec![];
    for day in 0..64 {
        for j in 0..if day % 4 == 0 { 8 } else { 1 } {
            let mut e = base.clone();
            e.id = events.len() as u64 + 1;
            e.time = (1577836800 + day * 86400 + j * 60) as f64;
            e.entity = "A".into();
            e.source = "One".into();
            e.value = None;
            e.attrs.clear();
            e.attrs.insert("station_id".into(), day.to_string());
            events.push(e);
        }
    }
    let e = Engine::new(
        Project::new(Dataset {
            name: "Cycles".into(),
            events,
        }),
        dir.path().into(),
    )
    .unwrap();
    let r = scan(&e, json!({}));
    assert!(!r["report"]["inspected_fields"]
        .as_array()
        .unwrap()
        .contains(&json!("attribute:station_id")));
    let period = finding(&r, "periodicity")["metrics"]["period_seconds"]
        .as_f64()
        .unwrap();
    assert!((period - 4. * 86400.).abs() < 1.);
}
#[test]
fn evidence_selection_is_not_limited_to_examples_or_ten_thousand_rows() {
    let dir = tempfile::tempdir().unwrap();
    let base = chronoscope::demo::dataset().events[0].clone();
    let mut events = vec![];
    for j in 0..12050 {
        let mut e = base.clone();
        e.id = j + 1;
        e.time = (1577836800 + j as i64 * 60) as f64;
        e.value = Some(j as f64);
        e.attrs.clear();
        e.attrs.insert("Measurement".into(), (2 * j).to_string());
        events.push(e);
    }
    let e = Engine::new(
        Project::new(Dataset {
            name: "Large evidence".into(),
            events,
        }),
        dir.path().into(),
    )
    .unwrap();
    let r = scan(&e, json!({"fields":["value","attribute:Measurement"]}));
    let f = finding(&r, "correlation");
    assert_eq!(f["count"], 12050);
    assert_eq!(f["examples"].as_array().unwrap().len(), 5);
    e.invoke(
        "select_query",
        json!({"pattern_scan_id":r["scan_id"],"pattern_finding_id":f["id"]}),
    )
    .unwrap();
    assert_eq!(
        e.invoke("snapshot", json!({"compact":true})).unwrap()["selected_count"],
        12050
    );
}
#[test]
fn cancellation_never_caches_a_partial_scan_and_async_jobs_return_the_typed_report() {
    use std::sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    };
    let dir = tempfile::tempdir().unwrap();
    let e = fixture(dir.path());
    let cancelled = Arc::new(AtomicBool::new(false));
    let signal = cancelled.clone();
    let result = chronoscope::operation::with_context(
        chronoscope::operation::Context {
            cancelled,
            scope: None,
            progress: Some(Arc::new(move |_, _, message| {
                if message.starts_with("Screening") {
                    signal.store(true, Ordering::Relaxed);
                }
            })),
        },
        || e.invoke("pattern_scan", json!({"config":config()})),
    );
    assert!(result.unwrap_err().starts_with("CANCELLED:"));
    assert!(e
        .invoke(
            "pattern_scan",
            json!({"config":config(),"cached_only":true})
        )
        .unwrap()["report"]
        .is_null());
    let job = e
        .invoke(
            "job_start",
            json!({"command":"pattern_scan","arguments":{"config":config()}}),
        )
        .unwrap();
    let result = loop {
        let r = e
            .invoke("job_result", json!({"job_id":job["job_id"]}))
            .unwrap();
        if r["status"] == "completed" {
            break r;
        }
        assert_ne!(r["status"], "failed", "{r}");
        std::thread::sleep(std::time::Duration::from_millis(10));
    };
    assert_eq!(result["result"]["report"]["input_count"], 80);
    chronoscope::schema::validate_output("pattern_scan", &result["result"]).unwrap();
    e.invoke("job_release", json!({"job_id":job["job_id"]}))
        .unwrap();
}
