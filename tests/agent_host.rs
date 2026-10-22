use chronoscope::{agent, engine::Engine, mcp, project::Project};
use serde_json::{json, Value};
use std::{
    io::Write,
    path::Path,
    process::{Command, Output, Stdio},
    sync::Arc,
    time::Duration,
};

fn engine(data: &Path) -> Arc<Engine> {
    Arc::new(Engine::new(Project::new(chronoscope::demo::dataset()), data.into()).unwrap())
}
fn cli(descriptor: &Path, command: &str, args: Value) -> Output {
    Command::new(env!("CARGO_BIN_EXE_chronoscope"))
        .args(["--json", "--connect"])
        .arg(descriptor)
        .args(["call", command, "--args", &args.to_string()])
        .output()
        .unwrap()
}
fn success(output: Output) -> Value {
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stdout)
    );
    let value: Value = serde_json::from_slice(&output.stdout).unwrap();
    assert_eq!(value["ok"], true);
    value["result"].clone()
}
fn failure(output: Output, exit: i32, code: &str) -> Value {
    assert_eq!(
        output.status.code(),
        Some(exit),
        "{}",
        String::from_utf8_lossy(&output.stdout)
    );
    let value: Value = serde_json::from_slice(&output.stdout).unwrap();
    assert_eq!(value["ok"], false);
    assert_eq!(value["error"]["code"], code);
    value
}
fn tool(engine: &Engine, name: &str) -> Value {
    engine
        .invoke("client_tools", json!({"id":"child"}))
        .unwrap()["tools"]
        .as_array()
        .unwrap()
        .iter()
        .find(|t| t["definition"]["name"] == name)
        .unwrap()
        .clone()
}

#[test]
fn attached_cli_manages_a_real_child_without_exposing_host_controls_to_mcp() {
    let data = tempfile::tempdir().unwrap();
    let child = tempfile::tempdir().unwrap();
    let engine = engine(data.path());
    let running = agent::start(engine.clone(), data.path()).unwrap();
    let configuration = json!({"id":"child","name":"Managed QA child","config":{
        "transport":"stdio","command":env!("CARGO_BIN_EXE_chronoscope"),
        "arguments":["--demo-data","--data-dir",child.path(),"mcp","--root",child.path()]}});
    success(cli(
        &running.descriptor,
        "client_connect",
        configuration.clone(),
    ));
    assert_eq!(
        engine.invoke("client_status", json!({})).unwrap()["connections"][0]["connected"],
        true
    );
    let query = tool(&engine, "chronoscope_query");
    success(cli(
        &running.descriptor,
        "client_grants",
        json!({"id":"child","grants":[{
        "tool":"chronoscope_query","fingerprint":query["fingerprint"],"access":"read"}]}),
    ));
    let call = json!({"id":"child","tool":"chronoscope_query","fingerprint":query["fingerprint"],
        "arguments":{"limit":1,"fields":["id","entity"]}});
    let result = success(cli(&running.descriptor, "client_call", call.clone()));
    assert_eq!(result["structuredContent"]["count"], 192);
    assert_eq!(
        result["structuredContent"]["events"]
            .as_array()
            .unwrap()
            .len(),
        1
    );

    let names: Vec<_> = mcp::tools()
        .into_iter()
        .map(|t| t["name"].clone())
        .collect();
    for command in ["client_connect", "client_grants", "client_disconnect"] {
        assert!(!names.contains(&json!(format!("chronoscope_{command}"))));
        let response = agent::request_remote(&running.info, &json!({"jsonrpc":"2.0","id":command,
            "method":"tools/call","params":{"name":format!("chronoscope_{command}"),"arguments":configuration}}))
            .unwrap().unwrap();
        assert_eq!(response["error"]["code"], -32602);
    }
    success(cli(
        &running.descriptor,
        "client_grants",
        json!({"id":"child","grants":[]}),
    ));
    failure(
        cli(&running.descriptor, "client_call", call),
        4,
        "SCOPE_DENIED",
    );
    success(cli(
        &running.descriptor,
        "client_disconnect",
        json!({"id":"child"}),
    ));
    assert_eq!(
        engine.invoke("client_status", json!({})).unwrap()["connections"],
        json!([])
    );
    assert_eq!(
        engine.invoke("snapshot", json!({"compact":true})).unwrap()["count"],
        192
    );
}

#[test]
fn host_route_requires_its_own_credential_and_only_accepts_management_commands() {
    let data = tempfile::tempdir().unwrap();
    let engine = engine(data.path());
    let running = agent::start(engine.clone(), data.path()).unwrap();
    let host_token = running.info.host_token.as_ref().unwrap();
    assert_ne!(host_token, &running.info.token);
    let host_url = running.info.url.replace("/mcp", "/host");
    let client = reqwest::blocking::Client::builder()
        .no_proxy()
        .timeout(Duration::from_secs(5))
        .build()
        .unwrap();
    let args = json!({"command":"client_disconnect","args":{"id":"missing"}});
    for token in [None, Some(running.info.token.as_str())] {
        let mut request = client
            .post(&host_url)
            .header("x-chronoscope-session", &running.info.session)
            .json(&args);
        if let Some(token) = token {
            request = request.bearer_auth(token);
        }
        assert_eq!(
            request.send().unwrap().status(),
            reqwest::StatusCode::UNAUTHORIZED
        );
    }
    assert_eq!(
        client
            .post(&host_url)
            .bearer_auth(host_token)
            .header("x-chronoscope-session", &running.info.session)
            .header("Origin", "http://localhost")
            .json(&args)
            .send()
            .unwrap()
            .status(),
        reqwest::StatusCode::UNAUTHORIZED
    );
    assert_eq!(
        client
            .post(&host_url)
            .bearer_auth(host_token)
            .json(&args)
            .send()
            .unwrap()
            .status(),
        reqwest::StatusCode::BAD_REQUEST
    );
    assert_eq!(
        client
            .post(&running.info.url)
            .bearer_auth(host_token)
            .header("x-chronoscope-session", &running.info.session)
            .json(&json!({"jsonrpc":"2.0","id":1,"method":"ping"}))
            .send()
            .unwrap()
            .status(),
        reqwest::StatusCode::UNAUTHORIZED
    );
    let denied = client
        .post(&host_url)
        .bearer_auth(host_token)
        .header("x-chronoscope-session", &running.info.session)
        .json(&json!({"command":"demo","args":{}}))
        .send()
        .unwrap();
    assert_eq!(denied.status(), reqwest::StatusCode::FORBIDDEN);
    assert_eq!(
        denied.json::<Value>().unwrap()["error"]["code"],
        "SCOPE_DENIED"
    );
    let invalid = client
        .post(&host_url)
        .bearer_auth(host_token)
        .header("x-chronoscope-session", &running.info.session)
        .json(&json!({"command":"client_disconnect","args":{"id":"missing","extra":true}}))
        .send()
        .unwrap()
        .json::<Value>()
        .unwrap();
    assert_eq!(invalid["error"]["code"], "INVALID_ARGUMENT");
    assert_eq!(
        engine.invoke("client_status", json!({})).unwrap()["connections"],
        json!([])
    );
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        assert_eq!(
            std::fs::metadata(&running.descriptor)
                .unwrap()
                .permissions()
                .mode()
                & 0o777,
            0o600
        );
    }
}

#[test]
fn attached_errors_keep_exit_codes_and_legacy_descriptors_fail_clearly() {
    let data = tempfile::tempdir().unwrap();
    let running = agent::start(engine(data.path()), data.path()).unwrap();
    assert_eq!(
        success(cli(
            &running.descriptor,
            "client_disconnect",
            json!({"id":"missing"})
        ))["connected"],
        false
    );
    failure(
        cli(
            &running.descriptor,
            "client_grants",
            json!({"id":"missing","grants":[]}),
        ),
        7,
        "NOT_FOUND",
    );
    failure(
        cli(
            &running.descriptor,
            "client_disconnect",
            json!({"id":"missing","extra":true}),
        ),
        2,
        "INVALID_ARGUMENT",
    );
    let mut descriptor: Value =
        serde_json::from_slice(&std::fs::read(&running.descriptor).unwrap()).unwrap();
    descriptor.as_object_mut().unwrap().remove("host_token");
    std::fs::write(&running.descriptor, descriptor.to_string()).unwrap();
    assert_eq!(
        success(cli(&running.descriptor, "query", json!({"limit":1})))["count"],
        192
    );
    let error = failure(
        cli(
            &running.descriptor,
            "client_disconnect",
            json!({"id":"missing"}),
        ),
        1,
        "UNAVAILABLE",
    );
    assert!(error["error"]["message"]
        .as_str()
        .unwrap()
        .contains("rebuild and restart"));
}

#[test]
fn stdio_proxy_cannot_dispatch_host_management_requests() {
    let data = tempfile::tempdir().unwrap();
    let engine = engine(data.path());
    let running = agent::start(engine.clone(), data.path()).unwrap();
    let mut proxy = Command::new(env!("CARGO_BIN_EXE_chronoscope"))
        .arg("--connect")
        .arg(&running.descriptor)
        .args(["mcp", "--attach"])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .unwrap();
    let mut input = proxy.stdin.take().unwrap();
    for request in [
        json!({"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-11-25"}}),
        json!({"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"chronoscope_client_connect","arguments":{}}}),
        json!({"jsonrpc":"2.0","id":3,"method":"host/call","params":{"command":"client_disconnect","args":{"id":"missing"}}}),
        json!({"jsonrpc":"2.0","id":4,"method":"ping"}),
    ] {
        writeln!(input, "{request}").unwrap();
    }
    drop(input);
    let result = proxy.wait_with_output().unwrap();
    assert!(result.status.success());
    let replies: Vec<Value> = String::from_utf8(result.stdout)
        .unwrap()
        .lines()
        .map(|l| serde_json::from_str(l).unwrap())
        .collect();
    assert_eq!(replies[1]["error"]["code"], -32602);
    assert_eq!(replies[2]["error"]["code"], -32601);
    assert!(replies[3].get("result").is_some());
    assert_eq!(
        engine.invoke("client_status", json!({})).unwrap()["connections"],
        json!([])
    );
}
