use chronoscope::{engine::Engine, model::Dataset, project::Project};
use serde_json::{json, Value};

fn fixture(path: &std::path::Path) -> Engine {
    let mut events = chronoscope::demo::dataset()
        .events
        .into_iter()
        .take(6)
        .collect::<Vec<_>>();
    for (i, event) in events.iter_mut().enumerate() {
        event.attrs.clear();
        event.attrs.insert("Account".into(), format!("00{}", i % 2));
        event
            .attrs
            .insert("Merchant".into(), if i % 2 == 0 { "A" } else { "B" }.into());
        event.attrs.insert("Year".into(), format!("{}", 10 + i));
        event
            .attrs
            .insert("NoNumbers".into(), "not a number".into());
    }
    Engine::new(
        Project::new(Dataset {
            name: "Odd fields".into(),
            events,
        }),
        path.into(),
    )
    .unwrap()
}
fn roles(engine: &Engine) -> Value {
    engine.invoke("snapshot", json!({"compact":true})).unwrap()["field_roles"].clone()
}

#[test]
fn roles_are_portable_undoable_metadata_and_schema_pages_are_bounded() {
    let dir = tempfile::tempdir().unwrap();
    let engine = fixture(dir.path());
    let before = engine.invoke("events", json!({"limit":20})).unwrap();
    let config = json!({"kind":"histogram","y":"attribute:Year"});
    let chart = engine
        .invoke("chart_data", json!({"config":config}))
        .unwrap();
    let revision = engine.invoke("revision", json!({})).unwrap()["revision"].clone();
    let result=engine.invoke("field_roles_set",json!({"assignments":{"attribute:Account":"identifier","attribute:Merchant":"category","attribute:Year":"measurement","time":"timestamp","lat":"coordinate","value":"ignore"},"expected_revision":revision})).unwrap();
    chronoscope::schema::validate_output("field_roles_set", &result).unwrap();
    assert_eq!(result["assigned_count"], 6);
    assert_eq!(
        engine.invoke("events", json!({"limit":20})).unwrap()["events"],
        before["events"]
    );
    assert_eq!(
        engine
            .invoke("chart_data", json!({"config":config}))
            .unwrap()["rows"],
        chart["rows"]
    );
    let schema = engine
        .invoke(
            "dataset_schema",
            json!({"include_attribute_types":true,"attribute_search":"Year","attribute_limit":1}),
        )
        .unwrap();
    chronoscope::schema::validate_output("dataset_schema", &schema).unwrap();
    assert_eq!(schema["field_roles"]["attribute:Year"], "measurement");
    assert!(schema["field_roles"].get("attribute:Account").is_none());
    assert_eq!(schema["field_roles"]["time"], "timestamp");
    engine.invoke("undo", json!({})).unwrap();
    assert_eq!(roles(&engine), json!({}));
    engine.invoke("redo", json!({})).unwrap();
    assert_eq!(roles(&engine)["attribute:Account"], "identifier");
    let saved = dir.path().join("roles.chronoscope");
    engine.invoke("save", json!({"path":saved})).unwrap();
    engine
        .invoke(
            "field_roles_set",
            json!({"assignments":{"attribute:Year":null}}),
        )
        .unwrap();
    engine.invoke("open", json!({"path":saved})).unwrap();
    assert_eq!(roles(&engine)["attribute:Year"], "measurement");
    engine
        .invoke("save_view", json!({"name":"My view"}))
        .unwrap();
    engine
        .invoke(
            "field_roles_set",
            json!({"assignments":{"attribute:Year":"category"}}),
        )
        .unwrap();
    engine.invoke("restore_view", json!({"index":0})).unwrap();
    assert_eq!(
        roles(&engine)["attribute:Year"],
        "category",
        "Saved views must not overwrite dataset semantics"
    );
    assert_eq!(
        engine.invoke("workspace_status", json!({})).unwrap()["dirty"],
        true
    );
}

#[test]
fn role_patches_validate_atomically_support_reset_and_do_not_coerce_text() {
    let dir = tempfile::tempdir().unwrap();
    let engine = fixture(dir.path());
    for assignments in [
        json!({"value":"made-up"}),
        json!({"missing":"measurement"}),
        json!({"id":"measurement"}),
        json!({"attribute:Account":"identifier","attribute:Missing":"category"}),
        json!({}),
    ] {
        assert!(engine
            .invoke("field_roles_set", json!({"assignments":assignments}))
            .is_err());
        assert_eq!(roles(&engine), json!({}));
    }
    engine.invoke("field_roles_set",json!({"assignments":{"attribute:NoNumbers":"measurement","attribute:Account":"identifier"},"dry_run":true})).unwrap();
    assert_eq!(roles(&engine), json!({}));
    engine.invoke("field_roles_set",json!({"assignments":{"attribute:NoNumbers":"measurement","attribute:Account":"identifier"}})).unwrap();
    let chart = engine
        .invoke(
            "chart_data",
            json!({"config":{"kind":"histogram","y":"attribute:NoNumbers"}}),
        )
        .unwrap();
    assert_eq!(chart["evaluated_count"], 0);
    assert_eq!(chart["excluded_count"], 6);
    assert!(engine
        .invoke(
            "field_roles_set",
            json!({"assignments":{"attribute:Account":"category"},"expected_revision":1})
        )
        .unwrap_err()
        .starts_with("CONFLICT:"));
    engine
        .invoke(
            "field_roles_set",
            json!({"assignments":{"attribute:Account":null}}),
        )
        .unwrap();
    assert!(roles(&engine).get("attribute:Account").is_none());
    assert_eq!(roles(&engine)["attribute:NoNumbers"], "measurement");
    let before = roles(&engine);
    assert!(engine.invoke("batch",json!({"operations":[{"command":"field_roles_set","args":{"assignments":{"value":"identifier"}}},{"command":"field_roles_set","args":{"assignments":{"attribute:Missing":"category"}}}]})).is_err());
    assert_eq!(roles(&engine), before);
    let v = serde_json::from_value::<chronoscope::field_roles::Roles>(json!({"a":"identifier"}))
        .unwrap();
    let mut oversized = v.clone();
    for i in 0..513 {
        oversized.insert(
            format!("attribute:{i}"),
            chronoscope::field_roles::Role::Identifier,
        );
    }
    assert!(chronoscope::field_roles::validate(&oversized).is_err());
}
