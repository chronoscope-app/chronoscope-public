use chronoscope::{engine::Engine, model::Dataset, project::Project};
use serde_json::{json, Value};
fn engine(path: &std::path::Path) -> Engine {
    Engine::new(Project::new(Dataset::default()), path.into()).unwrap()
}
fn connect(e: &Engine, path: &std::path::Path) {
    e.invoke("client_connect",json!({"id":"child","name":"Separate workspace","config":{"transport":"stdio","command":env!("CARGO_BIN_EXE_chronoscope"),"arguments":["--demo-data","--data-dir",path.to_str().unwrap(),"mcp","--root",path.to_str().unwrap()]}})).unwrap();
}
fn tool(e: &Engine, name: &str) -> Value {
    e.invoke("client_tools", json!({"id":"child"})).unwrap()["tools"]
        .as_array()
        .unwrap()
        .iter()
        .find(|t| t["definition"]["name"] == name)
        .unwrap()
        .clone()
}
#[test]
fn actual_stdio_server_discovery_grants_arguments_call_revocation_and_disconnect() {
    let dir = tempfile::tempdir().unwrap();
    let child = tempfile::tempdir().unwrap();
    let e = engine(dir.path());
    connect(&e, child.path());
    assert_eq!(
        e.invoke("client_status", json!({})).unwrap()["connections"][0]["connected"],
        true
    );
    let query = tool(&e, "chronoscope_query");
    let name = query["definition"]["name"].as_str().unwrap();
    let fingerprint = query["fingerprint"].as_str().unwrap();
    let args = json!({"id":"child","tool":name,"fingerprint":fingerprint,"arguments":{"limit":1,"fields":["id","entity"]}});
    assert!(e
        .invoke("client_call", args.clone())
        .unwrap_err()
        .contains("SCOPE_DENIED"));
    e.invoke(
        "client_grants",
        json!({"id":"child","grants":[{"tool":name,"fingerprint":fingerprint,"access":"read"}]}),
    )
    .unwrap();
    let exposed = e.mcp_client.exposed(false).unwrap();
    assert_eq!(exposed.len(), 1);
    assert!(exposed[0].name.starts_with("external_child_"));
    let result = e.invoke("client_call", args.clone()).unwrap();
    assert_ne!(result["isError"], true);
    assert!(
        result["structuredContent"]["events"]
            .as_array()
            .unwrap()
            .len()
            <= 1
    );
    let mut invalid = args.clone();
    invalid["arguments"]["limit"] = json!(99999);
    assert!(e
        .invoke("client_call", invalid)
        .unwrap_err()
        .contains("INVALID_ARGUMENT"));
    let mut stale = args.clone();
    stale["fingerprint"] = json!("stale");
    assert!(e
        .invoke("client_call", stale)
        .unwrap_err()
        .contains("CONFLICT"));
    let select = tool(&e, "chronoscope_select");
    e.invoke("client_grants",json!({"id":"child","grants":[{"tool":"chronoscope_select","fingerprint":select["fingerprint"],"access":"action"}]})).unwrap();
    assert!(e.mcp_client.exposed(false).unwrap().is_empty());
    assert_eq!(e.mcp_client.exposed(true).unwrap().len(), 1);
    let mut action = json!({"id":"child","tool":"chronoscope_select","fingerprint":select["fingerprint"],"arguments":{"ids":["1"]}});
    assert!(e
        .invoke("client_call", action.clone())
        .unwrap_err()
        .contains("SCOPE_DENIED"));
    action["allow_actions"] = json!(true);
    assert_ne!(e.invoke("client_call", action).unwrap()["isError"], true);
    assert!(e.invoke("client_call", args.clone()).is_err()); // replacing grants revoked query
    e.invoke("client_disconnect", json!({"id":"child"}))
        .unwrap();
    assert!(e.mcp_client.exposed(true).unwrap().is_empty());
    assert!(e
        .invoke("client_call", args)
        .unwrap_err()
        .contains("NOT_FOUND"));
    connect(&e, child.path());
    e.mcp_client.shutdown();
    assert_eq!(
        e.invoke("client_status", json!({})).unwrap()["connections"],
        json!([])
    );
    assert!(e.mcp_client.exposed(true).unwrap().is_empty());
    let restored = engine(dir.path());
    assert_eq!(
        restored.invoke("client_status", json!({})).unwrap()["connections"],
        json!([])
    );
}
#[test]
fn inbound_mcp_and_si_cannot_configure_connections_or_execute_ungranted_programs() {
    let dir = tempfile::tempdir().unwrap();
    let e = engine(dir.path());
    let tools = chronoscope::mcp::tools();
    for name in ["client_connect", "client_grants", "client_disconnect"] {
        assert!(!tools
            .iter()
            .any(|t| t["name"] == format!("chronoscope_{name}")));
        let reply=chronoscope::mcp::handle(&e,dir.path(),json!({"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":format!("chronoscope_{name}"),"arguments":{}}})).unwrap();
        assert!(reply.get("error").is_some());
    }
    assert!(e
        .invoke(
            "job_start",
            json!({"command":"client_connect","arguments":{}})
        )
        .is_err());
    assert!(e.invoke("client_connect",json!({"id":"bad","name":"bad","config":{"transport":"stdio","command":"sh","arguments":["-c","true"]}})).is_err());
    for url in [
        "http://example.com/mcp",
        "https://name:secret@example.com/mcp",
        "https://example.com/mcp?key=secret",
    ] {
        assert!(e
            .invoke(
                "client_connect",
                json!({"id":"bad","name":"bad","config":{"transport":"http","url":url}})
            )
            .is_err());
    }
}
