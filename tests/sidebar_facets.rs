use chronoscope::{
    engine::Engine,
    model::{Dataset, Filter},
    project::Project,
};
use serde_json::json;

#[test]
fn sidebar_columns_filter_exact_records_without_changing_entity_identities() {
    let dir = tempfile::tempdir().unwrap();
    let mut events = chronoscope::demo::dataset().events;
    events.truncate(6);
    for (i, e) in events.iter_mut().enumerate() {
        e.entity = if i < 3 { "A" } else { "B" }.into();
        e.label = ["Port", "Port", "Park", "Park", "", ""][i].into();
        e.attrs.clear();
        if i < 5 {
            e.attrs.insert(
                "Quoted '\" field".into(),
                if i % 2 == 0 { "red" } else { "blue" }.into(),
            );
        }
    }
    let expected_entities = events.iter().map(|e| e.entity.clone()).collect::<Vec<_>>();
    let engine = Engine::new(
        Project::new(Dataset {
            name: "Facets".into(),
            events: events.clone(),
        }),
        dir.path().into(),
    )
    .unwrap();
    let filter = json!({"facet_fields":{"entity":"label","category":"attribute:Quoted '\" field"},"facet_hidden":{"entity":["Port"],"category":["red"]}});
    engine.invoke("filter", json!({"filter":filter})).unwrap();
    let model: Filter = serde_json::from_value(filter.clone()).unwrap();
    let expected = events
        .iter()
        .filter(|e| model.matches(e, &Default::default()))
        .count();
    let snapshot = engine.invoke("snapshot", json!({})).unwrap();
    chronoscope::schema::validate_output("snapshot", &snapshot).unwrap();
    assert_eq!(snapshot["visible"], expected);
    assert_eq!(
        snapshot["facets"]["entity"]["counts"],
        json!({"Port":2,"Park":2,"":2})
    );
    assert_eq!(
        snapshot["facets"]["category"]["counts"],
        json!({"red":3,"blue":2,"":1})
    );
    assert_eq!(snapshot["entities"], json!({"A":3,"B":3}));
    engine.invoke("select_query",json!({"filter":{"predicates":[{"field":"label","op":"Equals","value":"Park"}]},"apply_filter":false,"mode":"add"})).unwrap();
    let selected = engine.invoke("snapshot", json!({})).unwrap();
    assert_eq!(selected["facets"]["entity"]["selected"], json!({"Park":2}));
    assert_eq!(
        selected["facets"]["category"]["selected"],
        json!({"red":1,"blue":1})
    );
    engine.invoke("select", json!({"ids":[]})).unwrap();
    assert_eq!(
        engine.invoke("snapshot", json!({})).unwrap()["facets"]["entity"]["selected"],
        json!({})
    );
    let path = dir.path().join("facets.chronoscope");
    engine.invoke("save", json!({"path":path})).unwrap();
    engine.invoke("open", json!({"path":path})).unwrap();
    let restored = engine.invoke("snapshot", json!({})).unwrap();
    assert_eq!(restored["filter"]["facet_fields"], filter["facet_fields"]);
    assert_eq!(restored["filter"]["facet_hidden"], filter["facet_hidden"]);
    assert_eq!(restored["visible"], expected);
    assert_eq!(
        events.iter().map(|e| e.entity.clone()).collect::<Vec<_>>(),
        expected_entities
    );
}

#[test]
fn field_filter_validation_and_empty_values_are_explicit() {
    let dir = tempfile::tempdir().unwrap();
    let engine = Engine::new(
        Project::new(chronoscope::demo::dataset()),
        dir.path().into(),
    )
    .unwrap();
    assert!(engine
        .invoke(
            "filter",
            json!({"filter":{"facet_fields":{"unexpected":"label"}}})
        )
        .is_err());
    assert!(engine
        .invoke(
            "filter",
            json!({"filter":{"facet_hidden":{"unexpected":["x"]}}})
        )
        .is_err());
    assert!(engine
        .invoke(
            "filter",
            json!({"filter":{"facet_fields":{"entity":"unknown"}}})
        )
        .is_err());
    assert!(engine
        .invoke(
            "filter",
            json!({"filter":{"facet_fields":{"entity":"attribute:Unknown"}}})
        )
        .is_err());
    engine
        .invoke(
            "filter",
            json!({"filter":{"facet_fields":{"entity":"note"},"facet_hidden":{"entity":[""]}}}),
        )
        .unwrap();
    let snapshot = engine.invoke("snapshot", json!({})).unwrap();
    let empty = snapshot["facets"]["entity"]["counts"][""]
        .as_u64()
        .unwrap_or(0);
    assert_eq!(
        snapshot["visible"].as_u64().unwrap(),
        snapshot["count"].as_u64().unwrap() - empty
    );
}
