use chronoscope::{engine::Engine, model::Dataset, project::Project};
use serde_json::{json, Value};

fn fixture(dir: &std::path::Path) -> Engine {
    let mut events = chronoscope::demo::dataset().events;
    events.truncate(6);
    for (i, event) in events.iter_mut().enumerate() {
        event.id = 9_007_199_254_740_993 + i as u64;
        event.entity = if i < 3 { "A" } else { "B" }.into();
        event.source = if i < 4 { "one" } else { "two" }.into();
        event.label = ["port", "", "port", "market", "park", "park"][i].into();
        event.note = String::new();
        event.value = (i < 4).then_some(i as f64);
        event.attrs.clear();
        if i < 5 {
            event
                .attrs
                .insert("Mixed".into(), ["003", "8.5", "text", "", " "][i].into());
        }
        if i == 0 {
            event.tags.insert("reviewed".into());
        }
    }
    Engine::new(
        Project::new(Dataset {
            name: "Profile fixture".into(),
            events,
        }),
        dir.into(),
    )
    .unwrap()
}
fn checked(e: &Engine, args: Value) -> Value {
    let value = e.invoke("field_profile", args).unwrap();
    chronoscope::schema::validate_output("field_profile", &value).unwrap();
    value
}
#[test]
fn exact_completeness_preserves_text_numeric_null_and_collection_semantics() {
    let d = tempfile::tempdir().unwrap();
    let e = fixture(d.path());
    let revision = e.invoke("revision", json!({})).unwrap();
    let r = checked(
        &e,
        json!({"fields":["label","value","attribute:Mixed","tags"],"scope":"all"}),
    );
    assert_eq!(r["input_count"], 6);
    assert_eq!(r["sampled"], false);
    let p = &r["profiles"];
    assert_eq!(p[0]["present_count"], 6);
    assert_eq!(p[0]["empty_string_count"], 1);
    assert_eq!(p[0]["null_count"], 0);
    assert_eq!(p[0]["distinct_count"], 4);
    assert_eq!(p[1]["null_count"], 2);
    assert_eq!(p[1]["finite_numeric_count"], 4);
    assert_eq!(p[2]["null_count"], 1);
    assert_eq!(p[2]["empty_string_count"], 1);
    assert_eq!(p[2]["finite_numeric_count"], 2);
    assert_eq!(p[2]["non_empty_count"], 4);
    assert!(p[2]["examples"]
        .as_array()
        .unwrap()
        .iter()
        .any(|x| x["value"] == "003"));
    assert_eq!(p[3]["value_kind"], "array");
    assert_eq!(p[3]["empty_collection_count"], 5);
    assert_eq!(p[3]["non_empty_count"], 1);
    assert!(p[3]["examples"]
        .as_array()
        .unwrap()
        .iter()
        .all(|x| x["value"].is_array()));
    // Every example ID identifies an actual row with exactly that stored value.
    let rows=e.invoke("query",json!({"apply_filter":false,"fields":["id","label","value","attribute:Mixed","tags"],"limit":6})).unwrap();
    for profile in p.as_array().unwrap() {
        for example in profile["examples"].as_array().unwrap() {
            let row = rows["events"]
                .as_array()
                .unwrap()
                .iter()
                .find(|row| row["id"] == example["id"])
                .unwrap();
            assert_eq!(row[profile["field"].as_str().unwrap()], example["value"]);
        }
    }
    assert_eq!(revision, e.invoke("revision", json!({})).unwrap());
    assert!(e.invoke("analytics_list", json!({})).unwrap()["results"]
        .as_array()
        .unwrap()
        .is_empty());
}
#[test]
fn every_canonical_and_derived_field_is_supported_and_unknown_is_not_empty() {
    let d = tempfile::tempdir().unwrap();
    let e = fixture(d.path());
    let mut names = e.invoke("dataset_schema", json!({})).unwrap()["canonical"]
        .as_array()
        .unwrap()
        .clone();
    names.extend([json!("time_utc"), json!("year_utc"), json!("attrs")]);
    for fields in names.chunks(4) {
        let r = checked(&e, json!({"fields":fields}));
        assert_eq!(r["profiles"].as_array().unwrap().len(), fields.len());
    }
    for field in [
        "not_a_field",
        "attribute:absent",
        "label);DROP TABLE events;--",
    ] {
        assert!(e
            .invoke("field_profile", json!({"fields":[field]}))
            .is_err());
    }
    assert_eq!(checked(&e, json!({"fields":["label"]}))["input_count"], 6);
    assert!(e.invoke("field_profile", json!({"fields":[]})).is_err());
    assert!(e
        .invoke("field_profile", json!({"fields":["label","label"]}))
        .is_err());
}
#[test]
fn filters_selection_sources_empty_scopes_and_revision_guards_are_explicit() {
    let d = tempfile::tempdir().unwrap();
    let e = fixture(d.path());
    e.invoke(
        "select",
        json!({"ids":["9007199254740993","9007199254740996"],"mode":"replace"}),
    )
    .unwrap();
    e.invoke("filter", json!({"filter":{"hidden_entities":["A"]}}))
        .unwrap();
    assert_eq!(
        checked(&e, json!({"fields":["label"],"scope":"visible"}))["input_count"],
        3
    );
    assert_eq!(
        checked(&e, json!({"fields":["label"],"scope":"selected"}))["input_count"],
        1
    );
    assert_eq!(
        checked(&e, json!({"fields":["label"],"scope":"all"}))["input_count"],
        6
    );
    assert_eq!(
        checked(&e, json!({"fields":["label"],"scope":"all","source":"two"}))["input_count"],
        2
    );
    let empty = checked(&e, json!({"fields":["label"],"source":"absent"}));
    assert_eq!(empty["input_count"], 0);
    assert_eq!(empty["profiles"][0]["present_count"], 0);
    assert!(empty["profiles"][0]["examples"]
        .as_array()
        .unwrap()
        .is_empty());
    let revision = e.invoke("revision", json!({})).unwrap()["revision"]
        .as_u64()
        .unwrap();
    assert!(e
        .invoke(
            "field_profile",
            json!({"fields":["label"],"expected_revision":revision-1})
        )
        .unwrap_err()
        .starts_with("CONFLICT:"));
    let r = checked(
        &e,
        json!({"fields":["label"],"expected_revision":revision,"example_limit":0}),
    );
    assert!(r["profiles"][0]["examples"].as_array().unwrap().is_empty());
    assert_eq!(r["revision"], revision);
}
#[test]
fn long_values_are_disclosed_as_omitted_while_counts_remain_exact() {
    let d = tempfile::tempdir().unwrap();
    let mut data = chronoscope::demo::dataset();
    for event in &mut data.events {
        event.note = "x".repeat(9000);
    }
    let e = Engine::new(Project::new(data), d.path().into()).unwrap();
    let r = checked(&e, json!({"fields":["note"]}));
    assert_eq!(r["profiles"][0]["non_empty_count"], 192);
    assert_eq!(r["profiles"][0]["examples"][0]["value_omitted"], true);
    assert!(r["profiles"][0]["examples"][0].get("value").is_none());
}
#[test]
fn imported_display_names_resolve_explicitly_without_substituting_columns() {
    let d = tempfile::tempdir().unwrap();
    let e = fixture(d.path());
    let r = checked(&e, json!({"fields":["Mixed"]}));
    assert_eq!(r["profiles"][0]["field"], "attribute:Mixed");
    assert_eq!(r["resolved_fields"]["Mixed"], "attribute:Mixed");
    assert_eq!(
        checked(&e, json!({"fields":["mixed"]}))["profiles"][0]["field"],
        "attribute:Mixed"
    );
    assert!(e
        .invoke(
            "field_profile",
            json!({"fields":["Mixed","attribute:Mixed"]})
        )
        .is_err());
    assert!(e
        .invoke("field_profile", json!({"fields":["Unrelated"]}))
        .unwrap_err()
        .contains("unknown field"));
}

#[test]
fn ambiguous_imported_names_require_an_explicit_column() {
    let d = tempfile::tempdir().unwrap();
    let mut data = chronoscope::demo::dataset();
    for event in &mut data.events {
        event.attrs.insert("Reading".into(), "one".into());
        event.attrs.insert("READING".into(), "two".into());
    }
    let e = Engine::new(Project::new(data), d.path().into()).unwrap();
    assert!(e
        .invoke("field_profile", json!({"fields":["reading"]}))
        .unwrap_err()
        .contains("ambiguous"));
    let r = checked(
        &e,
        json!({"fields":["attribute:Reading","attribute:READING"]}),
    );
    assert_eq!(r["profiles"][0]["examples"][0]["value"], "one");
    assert_eq!(r["profiles"][1]["examples"][0]["value"], "two");
}
