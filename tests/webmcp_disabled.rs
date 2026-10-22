#![cfg(not(feature = "experimental-browser-webmcp"))]

use chronoscope::{engine::Engine, model::Dataset, project::Project};
use serde_json::json;

#[test]
fn extension_bridge_is_unavailable_in_standard_builds() {
    let dir = tempfile::tempdir().unwrap();
    let engine = Engine::new(Project::new(Dataset::default()), dir.path().into()).unwrap();
    let export = dir.path().join("extension.zip");
    for name in [
        "webmcp_start",
        "webmcp_status",
        "webmcp_connect",
        "webmcp_stop",
        "webmcp_extension",
    ] {
        assert!(chronoscope::command::Command::parse(name).is_none());
        assert!(!chronoscope::schema::COMMANDS.contains(&name));
        assert!(chronoscope::schema::command_schema(name).is_none());
        assert!(!chronoscope::jobs::COMMANDS.contains(&name));
        let args = if name == "webmcp_extension" {
            json!({"path": export})
        } else {
            json!({})
        };
        assert!(engine.invoke(name, args).is_err());
    }
    assert!(!export.exists());
    let capabilities = engine.invoke("capabilities", json!({})).unwrap();
    assert_eq!(capabilities["mcp_client"]["browser_webmcp"], false);
    assert_eq!(
        capabilities["mcp_client"]["transports"],
        json!(["stdio", "streamable_http"])
    );
    assert!(
        engine.invoke("client_status", json!({})).unwrap()["connections"]
            .as_array()
            .unwrap()
            .is_empty()
    );
}
