use chronoscope::{engine::Engine, model::Dataset, project::Project};
use serde_json::json;
#[test]
fn multiple_servers_are_validated_local_persistent_and_available_to_agents() {
    let dir = tempfile::tempdir().unwrap();
    let engine = Engine::new(Project::new(Dataset::default()), dir.path().into()).unwrap();
    let initial = engine.invoke("wmts_servers", json!({})).unwrap();
    assert!(initial["servers"].as_array().unwrap().is_empty());
    let mut servers = vec![
        json!({"id":"reference","name":"Reference","config":chronoscope::wmts::MapConfig::nasa()}),
    ];
    let mut second = servers[0].clone();
    second["id"] = json!("organization");
    second["name"] = json!("Organization imagery");
    second["config"]["url"] = json!("https://example.org/wmts");
    servers.push(second);
    let expected = engine
        .invoke("wmts_servers", json!({"settings":{"servers":servers}}))
        .unwrap();
    chronoscope::schema::validate_output("wmts_servers", &expected).unwrap();
    let file = dir.path().join("workspace.chronoscope");
    engine.invoke("save", json!({"path":file})).unwrap();
    let bytes = std::fs::read(dir.path().join("map-servers.json")).unwrap();
    let mut duplicate = servers.clone();
    duplicate[1]["id"] = duplicate[0]["id"].clone();
    assert!(engine
        .invoke("wmts_servers", json!({"settings":{"servers":duplicate}}))
        .is_err());
    assert_eq!(
        std::fs::read(dir.path().join("map-servers.json")).unwrap(),
        bytes
    );
    let oversized = vec![servers[0].clone(); 33];
    assert!(engine
        .invoke("wmts_servers", json!({"settings":{"servers":oversized}}))
        .is_err());
    engine.invoke("open", json!({"path":file})).unwrap();
    assert_eq!(
        engine.invoke("wmts_servers", json!({})).unwrap()["servers"],
        expected["servers"]
    );
    let recipient = tempfile::tempdir().unwrap();
    let other = Engine::from_path(&file, recipient.path().into(), None).unwrap();
    assert_eq!(
        other.invoke("wmts_servers", json!({})).unwrap()["servers"],
        initial["servers"],
        "Opening a shared workspace must not replace a recipient's local server library"
    );
    drop(engine);
    let reopened = Engine::new(Project::new(Dataset::default()), dir.path().into()).unwrap();
    assert_eq!(
        reopened.invoke("wmts_servers", json!({})).unwrap()["servers"],
        expected["servers"]
    );
    assert!(chronoscope::mcp::tools()
        .iter()
        .any(|t| t["name"] == "chronoscope_wmts_servers"));
}

#[test]
fn server_tool_advertises_that_it_can_change_local_settings() {
    let tool = chronoscope::mcp::tools()
        .into_iter()
        .find(|t| t["name"] == "chronoscope_wmts_servers")
        .unwrap();
    assert_eq!(tool["annotations"]["readOnlyHint"], false);
}
