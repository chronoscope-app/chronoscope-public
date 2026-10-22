#![cfg(feature = "experimental-browser-webmcp")]

use chronoscope::{engine::Engine, model::Dataset, project::Project};
use serde_json::json;
#[test]
fn browser_controls_are_host_only_and_extension_is_self_contained() {
    let dir = tempfile::tempdir().unwrap();
    let e = Engine::new(Project::new(Dataset::default()), dir.path().into()).unwrap();
    for name in [
        "webmcp_start",
        "webmcp_status",
        "webmcp_connect",
        "webmcp_stop",
        "webmcp_extension",
    ] {
        assert!(
            !chronoscope::command::Command::parse(name)
                .unwrap()
                .effects()
                .public_mcp
        );
        assert!(!chronoscope::jobs::COMMANDS.contains(&name));
    }
    assert_eq!(
        e.invoke("webmcp_status", json!({})).unwrap()["running"],
        false
    );
    assert!(e.invoke("webmcp_connect", json!({})).is_err());
    let path = dir.path().join("extension.zip");
    e.invoke("webmcp_extension", json!({"path":path})).unwrap();
    assert!(e.invoke("webmcp_extension", json!({"path":path})).is_err());
    let mut archive = zip::ZipArchive::new(std::fs::File::open(path).unwrap()).unwrap();
    assert_eq!(archive.len(), 5);
    let manifest: serde_json::Value =
        serde_json::from_reader(archive.by_name("manifest.json").unwrap()).unwrap();
    assert_eq!(manifest["manifest_version"], 3);
    assert_eq!(manifest["host_permissions"], json!(["http://127.0.0.1/*"]));
    let started = e.invoke("webmcp_start", json!({})).unwrap();
    let url = started["url"].as_str().unwrap();
    let http = reqwest::blocking::Client::new();
    assert_eq!(
        http.post(format!("{url}/pair"))
            .json(&json!({"pairing_code":started["pairing_code"]}))
            .send()
            .unwrap()
            .status(),
        401
    );
    let origin = "chrome-extension://abcdefghijklmnopabcdefghijklmnop";
    let body = json!({"pairing_code":started["pairing_code"],"origin":"https://example.org","document":"test-document","tools":[{"name":"records","description":"Example","inputSchema":{"type":"object"}}]});
    let paired: serde_json::Value = http
        .post(format!("{url}/pair"))
        .header("Origin", origin)
        .json(&body)
        .send()
        .unwrap()
        .error_for_status()
        .unwrap()
        .json()
        .unwrap();
    assert!(paired["token"].as_str().unwrap().len() >= 64);
    assert_eq!(
        http.post(format!("{url}/pair"))
            .header("Origin", origin)
            .json(&body)
            .send()
            .unwrap()
            .status(),
        401
    );
    assert_eq!(
        http.post(format!("{url}/mcp"))
            .bearer_auth(paired["token"].as_str().unwrap())
            .json(&json!({"jsonrpc":"2.0","id":1,"method":"tools/list"}))
            .send()
            .unwrap()
            .status(),
        401
    );
    let status = e.invoke("webmcp_status", json!({})).unwrap();
    assert_eq!(status["paired"], true);
    assert!(status.get("token").is_none());
    assert!(status.get("pairing_code").is_none());
    assert_eq!(
        http.post(format!("{url}/invalidate"))
            .header("Origin", origin)
            .bearer_auth(paired["token"].as_str().unwrap())
            .json(&json!({}))
            .send()
            .unwrap()
            .status(),
        204
    );
    assert_eq!(
        e.invoke("webmcp_status", json!({})).unwrap()["paired"],
        false
    );
    e.invoke("webmcp_stop", json!({})).unwrap();
}
