use chronoscope::{engine::Engine, model::Dataset, project::Project};
use serde_json::{json, Value};
fn engine(dir: &std::path::Path) -> Engine {
    let mut events = chronoscope::demo::dataset().events;
    events.truncate(8);
    for (i, event) in events.iter_mut().enumerate() {
        event.id = i as u64 + 1;
        event.entity = if i < 4 { "A" } else { "B" }.into();
        event.time = (1_000_020 + (i as i64) * 3600) as f64;
    }
    Engine::new(
        Project::new(Dataset {
            name: "Analysis fixture".into(),
            events,
        }),
        dir.into(),
    )
    .unwrap()
}
fn context(engine: &Engine, scope: &str) -> Value {
    engine
        .invoke("analysis_context", json!({"scope":scope}))
        .unwrap()
}
#[test]
fn exact_scope_and_eligibility_without_model_or_event_payloads() {
    let dir = tempfile::tempdir().unwrap();
    let e = engine(dir.path());
    let c = context(&e, "visible");
    assert_eq!(c["event_count"], 8);
    assert_eq!(c["temporal_tracks"], 2);
    assert!(c.to_string().len() < 4000);
    assert!(c["recommendations"]
        .as_array()
        .unwrap()
        .iter()
        .all(|r| r["eligible"] == true));
    e.invoke("select", json!({"ids":["1","2"],"mode":"add"}))
        .unwrap();
    assert_eq!(context(&e, "selected")["event_count"], 2);
    e.invoke("filter", json!({"filter":{"hidden_entities":["A"]}}))
        .unwrap();
    assert_eq!(context(&e, "selected")["event_count"], 0);
    assert!(context(&e, "selected")["recommendations"]
        .as_array()
        .unwrap()
        .iter()
        .all(|r| r["eligible"] == false));
}
#[test]
fn review_plan_thresholds_staleness_and_exact_results() {
    let dir = tempfile::tempdir().unwrap();
    let e = engine(dir.path());
    assert!(e
        .invoke(
            "analysis_prepare",
            json!({"pattern":"Gaps","scope":"visible","parameters":{}})
        )
        .unwrap_err()
        .contains("gap_s"));
    let plan = e
        .invoke(
            "analysis_prepare",
            json!({"pattern":"Gaps","scope":"visible","parameters":{"gap_s":1800}}),
        )
        .unwrap();
    let revision = e.invoke("revision", json!({})).unwrap();
    let report = e.invoke("analysis_execute", json!({"plan":plan})).unwrap();
    assert_eq!(report["evaluated_count"], 8);
    assert_eq!(report["count"], 6);
    assert_eq!(report["limited"], false);
    assert_eq!(e.invoke("revision", json!({})).unwrap(), revision);
    e.invoke("select", json!({"ids":["1"],"mode":"add"}))
        .unwrap();
    assert!(e
        .invoke("analysis_execute", json!({"plan":plan}))
        .unwrap_err()
        .contains("CONFLICT"));
    let mut tampered = plan;
    tampered["parameters"] = json!({});
    assert!(e
        .invoke("analysis_execute", json!({"plan":tampered}))
        .is_err());
}
#[test]
fn missing_locations_never_recommend_spatial_analyses() {
    let dir = tempfile::tempdir().unwrap();
    let mut data = chronoscope::demo::dataset();
    data.events.truncate(4);
    for event in &mut data.events {
        event.lat = None;
        event.lon = None;
        event.entity = "A".into();
    }
    let e = Engine::new(Project::new(data), dir.path().into()).unwrap();
    let c = context(&e, "visible");
    assert_eq!(c["located_count"], 0);
    assert_eq!(c["missing_locations"], 4);
    for r in c["recommendations"].as_array().unwrap() {
        assert_eq!(r["eligible"], r["pattern"] == "Gaps");
    }
}
#[test]
fn protocol_discovery_includes_native_and_analysis_commands() {
    let tools = chronoscope::mcp::tools();
    for name in [
        "analysis_context",
        "analysis_prepare",
        "analysis_execute",
        "si_apple_status",
    ] {
        assert!(tools
            .iter()
            .any(|t| t["name"] == format!("chronoscope_{name}")));
    }
    for name in ["analysis_context", "analysis_prepare"] {
        let schema = chronoscope::schema::output_schema(name);
        assert!(schema["properties"].is_object());
    }
    assert!(chronoscope::schema::validate(
        "analysis_execute",
        &json!({"plan":{"revision":1,"scope":"visible","pattern":"Gaps","parameters":{"gap_s":-1}}})
    )
    .is_err());
}
#[test]
fn unit_conversions_are_code_not_model_arithmetic() {
    use chronoscope::analysis_assist::parameters_from_prompt as parse;
    assert_eq!(
        parse("Gaps", "Find gaps longer than six hours").unwrap(),
        json!({"gap_s":21600.0})
    );
    assert_eq!(
        parse("Stationary", "Within 200 metres for 2 hours").unwrap(),
        json!({"radius_m":200.0,"duration_s":7200.0})
    );
    assert_eq!(
        parse("Proximity", "Within 2 km and 5 minutes").unwrap(),
        json!({"radius_m":2000.0,"tolerance_s":300.0})
    );
    assert_eq!(
        parse("Clusters", "5 events within 500 metres and 10 minutes").unwrap(),
        json!({"radius_m":500.0,"tolerance_s":600.0,"min_cluster":5})
    );
    assert_eq!(
        parse("Gaps", "Find gaps over 0.125 seconds").unwrap(),
        json!({"gap_s":0.125})
    );
    assert_eq!(
        parse("Proximity", "Encounters within 125 milliseconds").unwrap(),
        json!({"tolerance_s":0.125})
    );
    assert!(parse("Gaps", "-6 hours").is_err());
    assert!(parse("Gaps", "−6 hours").is_err());
    assert!(parse("Gaps", ".5 hours").is_err());
    assert!(parse("Stationary", "1,500 metres for 2 hours").is_err());
    assert!(parse("Gaps", "from 2 hours to 6 hours").is_err());
    assert!(parse("Speed", "wind speed 250 km/h and 10 minutes").is_err());
    assert_eq!(parse("Gaps", "Find gaps").unwrap(), json!({}));
}

#[test]
fn local_routing_and_speed_units_are_bounded() {
    use chronoscope::analysis_assist::{
        explicit_request_kind as kind, parameters_from_prompt as parse,
    };
    assert_eq!(kind("Recommend analyses for this scope"), Some("recommend"));
    assert_eq!(kind("Find gaps longer than six hours"), Some("gaps"));
    assert_eq!(
        kind("Find gaps in this time window over six hours"),
        Some("gaps")
    );
    assert_eq!(kind("Find gaps and speed outliers"), None);
    assert_eq!(
        kind("Find wind speed outliers at 100 mph"),
        Some("unsupported")
    );
    let value = parse("Speed", "Track speeds over 100 mph").unwrap()["speed_kmh"]
        .as_f64()
        .unwrap();
    assert!((value - 160.9344).abs() < 1e-8);
}

#[test]
fn explanations_remain_small_with_long_unicode_and_control_text() {
    let report = json!({"revision":7,"pattern":"Gaps","parameters":{"gap_s":60},"count":20,"input_count":100000,"evaluated_count":100000,"input_limited":false,"limited":true,"findings":(0..10).map(|_|json!({"summary":"🌍\n\t\"".repeat(2000),"metric":"🌍".repeat(2000)})).collect::<Vec<_>>()});
    let evidence = chronoscope::analysis_assist::explanation_evidence(&report, &json!(8));
    assert!(evidence.to_string().len() < 6000);
    assert_eq!(evidence["shown_findings"].as_array().unwrap().len(), 3);
    assert_eq!(evidence["excerpt_limited"], true);
    assert_eq!(evidence["workspace_changed"], true);
    assert_eq!(evidence["thresholds"]["gap_s"], 60);
}
