//! Opt-in authenticated loopback bridge to the desktop's shared engine.
//! CLI presents standard MCP stdio; the private HTTP hop is an implementation detail.
pub mod access;
use crate::{engine::Engine, mcp};
use axum::{
    extract::{DefaultBodyLimit, State},
    http::{header, HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    routing::post,
    Json, Router,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::BTreeMap,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
};
#[derive(Clone, Serialize, Deserialize)]
pub struct ConnectionInfo {
    pub version: u32,
    pub url: String,
    pub token: String,
    /// Private local-CLI capability; never used by the public MCP proxy.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub host_token: Option<String>,
    pub root: PathBuf,
    pub pid: u32,
    #[serde(skip)]
    pub session: String,
}
#[derive(Clone)]
struct Agent {
    engine: Arc<Engine>,
    info: ConnectionInfo,
    cancellations: Arc<Mutex<BTreeMap<String, Arc<AtomicBool>>>>,
    slots: Arc<tokio::sync::Semaphore>,
}
fn authorized(headers: &HeaderMap, token: &str) -> bool {
    !headers.contains_key(header::ORIGIN)
        && headers
            .get(header::AUTHORIZATION)
            .and_then(|h| h.to_str().ok())
            == Some(&format!("Bearer {token}"))
}
fn valid_session(headers: &HeaderMap) -> Option<&str> {
    headers
        .get("x-chronoscope-session")
        .and_then(|h| h.to_str().ok())
        .filter(|s| s.len() == 32 && s.bytes().all(|b| b.is_ascii_hexdigit()))
}
fn host_command(command: &str) -> bool {
    matches!(
        command,
        "client_connect" | "client_grants" | "client_disconnect"
    )
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct HostRequest {
    command: String,
    args: Value,
}
async fn host_request(
    State(agent): State<Agent>,
    headers: HeaderMap,
    Json(request): Json<HostRequest>,
) -> Response {
    if !agent
        .info
        .host_token
        .as_deref()
        .is_some_and(|token| authorized(&headers, token))
    {
        return (
            StatusCode::UNAUTHORIZED,
            Json(json!({"error":"Unauthorized"})),
        )
            .into_response();
    }
    if valid_session(&headers).is_none() {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({"error":"Invalid agent session"})),
        )
            .into_response();
    }
    if !host_command(&request.command) {
        return (
            StatusCode::FORBIDDEN,
            Json(json!({"ok":false,"error":{"code":"SCOPE_DENIED","message":"Host route only accepts outbound connection management"}})),
        )
            .into_response();
    }
    let permit = match agent.slots.clone().try_acquire_owned() {
        Ok(permit) => permit,
        Err(_) => {
            return (
                StatusCode::TOO_MANY_REQUESTS,
                Json(json!({"error":"Agent concurrency limit (4)"})),
            )
                .into_response()
        }
    };
    let result = tokio::task::spawn_blocking(move || {
        let _permit = permit;
        // Local host controls intentionally do not inherit an inbound MCP file scope.
        agent.engine.invoke(&request.command, request.args)
    })
    .await;
    match result {
        Ok(Ok(value)) => Json(json!({"ok":true,"result":value})).into_response(),
        Ok(Err(message)) => {
            Json(json!({"ok":false,"error":crate::error::EngineError::from(message)}))
                .into_response()
        }
        Err(_) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({"error":"Agent worker failed"})),
        )
            .into_response(),
    }
}
async fn request(
    State(agent): State<Agent>,
    headers: HeaderMap,
    Json(request): Json<Value>,
) -> Response {
    if !authorized(&headers, &agent.info.token) {
        return (
            StatusCode::UNAUTHORIZED,
            Json(json!({"error":"Unauthorized"})),
        )
            .into_response();
    }
    let Some(session) = valid_session(&headers) else {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({"error":"Invalid agent session"})),
        )
            .into_response();
    };
    if let Some(error) = mcp::envelope_error(&request) {
        return Json(error).into_response();
    }
    if request["method"] == "notifications/cancelled" {
        if let Ok(registry) = agent.cancellations.lock() {
            if let Some(flag) =
                registry.get(&format!("{session}:{}", request["params"]["requestId"]))
            {
                flag.store(true, Ordering::Relaxed)
            }
        }
        return StatusCode::ACCEPTED.into_response();
    }
    let permit = match agent.slots.clone().try_acquire_owned() {
        Ok(p) => p,
        Err(_) => {
            return (
                StatusCode::TOO_MANY_REQUESTS,
                Json(json!({"error":"Agent concurrency limit (4)"})),
            )
                .into_response()
        }
    };
    let key = format!("{session}:{}", request["id"]);
    let cancelled = Arc::new(AtomicBool::new(false));
    if let Ok(mut registry) = agent.cancellations.lock() {
        if registry.contains_key(&key) {
            return (
                StatusCode::CONFLICT,
                Json(json!({"error":"Duplicate request ID"})),
            )
                .into_response();
        }
        registry.insert(key.clone(), cancelled.clone());
    }
    let engine = agent.engine.clone();
    let root = agent.info.root.clone();
    let result = tokio::task::spawn_blocking(move || {
        let _permit = permit;
        crate::operation::with_context(
            crate::operation::Context {
                cancelled,
                progress: None,
                scope: None,
            },
            || mcp::handle(&engine, &root, request),
        )
    })
    .await;
    if let Ok(mut registry) = agent.cancellations.lock() {
        registry.remove(&key);
    }
    match result {
        Ok(Some(response)) => Json(response).into_response(),
        Ok(None) => StatusCode::ACCEPTED.into_response(),
        Err(_) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({"error":"Agent worker failed"})),
        )
            .into_response(),
    }
}
pub struct RunningAgent {
    pub info: ConnectionInfo,
    pub descriptor: PathBuf,
    shutdown: Option<tokio::sync::oneshot::Sender<()>>,
}
impl Drop for RunningAgent {
    fn drop(&mut self) {
        if let Some(sender) = self.shutdown.take() {
            let _ = sender.send(());
        }
        // An older window must not delete a newer window's descriptor.
        if std::fs::read(&self.descriptor)
            .ok()
            .filter(|b| b.len() <= 16384)
            .and_then(|b| serde_json::from_slice::<ConnectionInfo>(&b).ok())
            .is_some_and(|info| info.token == self.info.token)
        {
            let _ = std::fs::remove_file(&self.descriptor);
        }
    }
}
pub fn start(engine: Arc<Engine>, root: &Path) -> Result<RunningAgent, String> {
    let root = root.canonicalize().map_err(|e| e.to_string())?;
    if !root.is_dir() {
        return Err("Agent root must be a directory".into());
    }
    let listener = std::net::TcpListener::bind("127.0.0.1:0").map_err(|e| e.to_string())?;
    listener.set_nonblocking(true).map_err(|e| e.to_string())?;
    let address = listener.local_addr().map_err(|e| e.to_string())?;
    let mut random = [0u8; 64];
    getrandom::fill(&mut random).map_err(|e| e.to_string())?;
    let token = random[..32].iter().map(|b| format!("{b:02x}")).collect();
    let host_token = random[32..].iter().map(|b| format!("{b:02x}")).collect();
    let info = ConnectionInfo {
        version: 1,
        url: format!("http://{address}/mcp"),
        token,
        host_token: Some(host_token),
        root,
        pid: std::process::id(),
        session: random[..16].iter().map(|b| format!("{b:02x}")).collect(),
    };
    let descriptor = engine.data_dir.join("agent-connection.json");
    let mut temp = tempfile::NamedTempFile::new_in(&engine.data_dir).map_err(|e| e.to_string())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        temp.as_file()
            .set_permissions(std::fs::Permissions::from_mode(0o600))
            .map_err(|e| e.to_string())?;
    }
    serde_json::to_writer(&mut temp, &info).map_err(|e| e.to_string())?;
    temp.as_file().sync_all().map_err(|e| e.to_string())?;
    temp.persist(&descriptor).map_err(|e| e.to_string())?;
    let agent = Agent {
        engine,
        info: info.clone(),
        cancellations: Arc::new(Mutex::new(BTreeMap::new())),
        slots: Arc::new(tokio::sync::Semaphore::new(4)),
    };
    let (tx, rx) = tokio::sync::oneshot::channel();
    std::thread::spawn(move || {
        let runtime = tokio::runtime::Runtime::new().expect("agent runtime");
        runtime.block_on(async move {
            let listener = tokio::net::TcpListener::from_std(listener).expect("agent listener");
            let router = Router::new()
                .route("/mcp", post(request))
                .route("/host", post(host_request))
                .layer(DefaultBodyLimit::max(4 * 1024 * 1024))
                .with_state(agent);
            let _ = axum::serve(listener, router)
                .with_graceful_shutdown(async {
                    let _ = rx.await;
                })
                .await;
        });
    });
    Ok(RunningAgent {
        info,
        descriptor,
        shutdown: Some(tx),
    })
}
pub fn read_connection(path: &Path) -> Result<ConnectionInfo, String> {
    let bytes = std::fs::read(path).map_err(|e| {
        format!("Desktop agent connection unavailable: {e}; run chronoscope agent enable and open the app")
    })?;
    if bytes.len() > 16384 {
        return Err("Invalid connection descriptor".into());
    }
    let mut info: ConnectionInfo = serde_json::from_slice(&bytes).map_err(|e| e.to_string())?;
    let url = reqwest::Url::parse(&info.url).map_err(|e| e.to_string())?;
    if info.version != 1
        || url.scheme() != "http"
        || url.host_str() != Some("127.0.0.1")
        || url.path() != "/mcp"
        || info.token.len() != 64
        || info
            .host_token
            .as_ref()
            .is_some_and(|token| token.len() != 64)
    {
        return Err("Invalid desktop agent descriptor".into());
    }
    let mut random = [0u8; 16];
    getrandom::fill(&mut random).map_err(|e| e.to_string())?;
    info.session = random.iter().map(|b| format!("{b:02x}")).collect();
    Ok(info)
}
pub fn request_remote(info: &ConnectionInfo, request: &Value) -> Result<Option<Value>, String> {
    post_remote(info, &info.url, &info.token, request)
}
fn post_remote(
    info: &ConnectionInfo,
    url: &str,
    token: &str,
    request: &Value,
) -> Result<Option<Value>, String> {
    static CLIENT: std::sync::OnceLock<Result<reqwest::blocking::Client, String>> =
        std::sync::OnceLock::new();
    let client = CLIENT
        .get_or_init(|| {
            reqwest::blocking::Client::builder()
                .timeout(std::time::Duration::from_secs(3600))
                .no_proxy()
                .build()
                .map_err(|e| e.to_string())
        })
        .as_ref()
        .map_err(Clone::clone)?;
    let response = client
        .post(url)
        .bearer_auth(token)
        .header("x-chronoscope-session", &info.session)
        .json(request)
        .send()
        .map_err(|e| format!("Desktop agent is unavailable: {e}"))?;
    if response.status() == reqwest::StatusCode::ACCEPTED {
        return Ok(None);
    }
    let response = response.error_for_status().map_err(|e| e.to_string())?;
    use std::io::Read;
    let mut bytes = vec![];
    response
        .take(12 * 1024 * 1024 + 1)
        .read_to_end(&mut bytes)
        .map_err(|e| e.to_string())?;
    if bytes.len() > 12 * 1024 * 1024 {
        return Err("Agent response exceeds 12 MiB".into());
    }
    serde_json::from_slice(&bytes)
        .map(Some)
        .map_err(|e| e.to_string())
}
pub fn invoke_remote(info: &ConnectionInfo, command: &str, args: Value) -> Result<Value, String> {
    if host_command(command) {
        let token = info.host_token.as_deref().ok_or(
            "UNAVAILABLE: rebuild and restart the desktop to enable attached CLI connection management",
        )?;
        let mut url = reqwest::Url::parse(&info.url).map_err(|e| e.to_string())?;
        url.set_path("/host");
        let response = post_remote(
            info,
            url.as_str(),
            token,
            &json!({"command":command,"args":args}),
        )?
        .ok_or("Missing host response")?;
        if response["ok"] != true {
            let code = response["error"]["code"]
                .as_str()
                .unwrap_or("OPERATION_FAILED");
            let message = response["error"]["message"]
                .as_str()
                .unwrap_or("Host operation failed");
            return Err(if message.starts_with(&format!("{code}:")) {
                message.to_owned()
            } else {
                format!("{code}: {message}")
            });
        }
        return Ok(response["result"].clone());
    }
    let mut random = [0u8; 16];
    getrandom::fill(&mut random).map_err(|e| e.to_string())?;
    let id: String = random.iter().map(|b| format!("{b:02x}")).collect();
    let response=request_remote(info,&json!({"jsonrpc":"2.0","id":id,"method":"tools/call","params":{"name":format!("chronoscope_{command}"),"arguments":args}}))?.ok_or("Missing agent response")?;
    if response["result"]["isError"] == true {
        return Err(response["result"]["structuredContent"]["error"]["message"]
            .as_str()
            .unwrap_or("Agent operation failed")
            .into());
    }
    if let Some(error) = response.get("error") {
        return Err(error.to_string());
    }
    let mut value = response["result"]["structuredContent"].clone();
    if command == "view_capture" {
        if let Some(image) = response["result"]["content"]
            .as_array()
            .and_then(|c| c.iter().find(|c| c["type"] == "image"))
        {
            value["data_url"] = json!(format!(
                "data:image/png;base64,{}",
                image["data"].as_str().unwrap_or("")
            ));
        }
    }
    Ok(value)
}
pub fn proxy(info: ConnectionInfo) -> Result<(), String> {
    use std::io::Write;
    let (tx, rx) = std::sync::mpsc::sync_channel::<Value>(64);
    let worker_info = info.clone();
    let output = Arc::new(Mutex::new(std::io::stdout()));
    let subscriptions = Arc::new(mcp::subscriptions::Subscriptions::default());
    let subscription_info = info.clone();
    let subscription_output = output.clone();
    subscriptions.start(move || {
        let reply=request_remote(&subscription_info,&json!({"jsonrpc":"2.0","id":"subscription-version","method":"chronoscope/resource-version"}))?.ok_or("Missing version response")?;
        if reply.get("error").is_some() { return Err("Desktop version unavailable".into()); }
        Ok(reply["result"].clone())
    },move |value| {
        let mut out=subscription_output.lock().map_err(|_| "Protocol output unavailable")?;
        writeln!(out,"{value}").and_then(|_|out.flush()).map_err(|e|e.to_string())
    });
    let worker_subscriptions = subscriptions.clone();
    let writer = output.clone();
    let worker = std::thread::spawn(move || -> Result<(), String> {
        let mut initialized = false;
        let mut ui = mcp::apps::Session::default();
        for request in rx {
            if !initialized && request["method"] != "initialize" && request["method"] != "ping" {
                if request.get("id").is_some() {
                    let mut out = writer.lock().map_err(|_| "Protocol output unavailable")?;
                    writeln!(out,"{}",json!({"jsonrpc":"2.0","id":request["id"],"error":{"code":-32002,"message":"Initialize the server first"}})).map_err(|e|e.to_string())?;
                    out.flush().map_err(|e| e.to_string())?;
                }
                continue;
            }
            if let Some(response) = worker_subscriptions.handle(&request) {
                let mut out = writer.lock().map_err(|_| "Protocol output unavailable")?;
                writeln!(out, "{response}")
                    .and_then(|_| out.flush())
                    .map_err(|e| e.to_string())?;
                continue;
            }
            ui.initialize(&request);
            let method = request["method"].as_str().unwrap_or("").to_owned();
            let initialize = request["method"] == "initialize";
            let response = match request_remote(&worker_info, &request) {
                Ok(v) => v,
                Err(e) => Some(
                    json!({"jsonrpc":"2.0","id":request["id"],"error":{"code":-32000,"message":e}}),
                ),
            };
            if let Some(response) = response {
                if initialize && response.get("result").is_some() {
                    initialized = true;
                }
                let response = ui.decorate(&method, response);
                let mut out = writer.lock().map_err(|_| "Protocol output unavailable")?;
                writeln!(out, "{response}").map_err(|e| e.to_string())?;
                out.flush().map_err(|e| e.to_string())?;
            }
        }
        Ok(())
    });
    let stdin = std::io::stdin();
    let mut reader = stdin.lock();
    loop {
        let message = match mcp::read_message(&mut reader) {
            Ok(Some(v)) => v,
            Ok(None) => break,
            Err(e) => {
                let mut out = output.lock().map_err(|_| "Protocol output unavailable")?;
                writeln!(
                    out,
                    "{}",
                    json!({"jsonrpc":"2.0","id":null,"error":{"code":-32600,"message":e}})
                )
                .map_err(|e| e.to_string())?;
                out.flush().map_err(|e| e.to_string())?;
                continue;
            }
        };
        let request: Value = match serde_json::from_slice(&message) {
            Ok(v) => v,
            Err(_) => {
                let mut out = output.lock().map_err(|_| "Protocol output unavailable")?;
                writeln!(out,"{}",json!({"jsonrpc":"2.0","id":null,"error":{"code":-32700,"message":"Parse error"}})).map_err(|e|e.to_string())?;
                out.flush().map_err(|e| e.to_string())?;
                continue;
            }
        };
        if let Some(error) = mcp::envelope_error(&request) {
            let mut out = output.lock().map_err(|_| "Protocol output unavailable")?;
            writeln!(out, "{error}").map_err(|e| e.to_string())?;
            out.flush().map_err(|e| e.to_string())?;
            continue;
        }
        if request["method"] == "notifications/cancelled" {
            let _ = request_remote(&info, &request);
        } else if let Err(e) = tx.try_send(request) {
            if let std::sync::mpsc::TrySendError::Full(request) = e {
                let mut out = output.lock().map_err(|_| "Protocol output unavailable")?;
                writeln!(out,"{}",json!({"jsonrpc":"2.0","id":request["id"],"error":{"code":-32000,"message":"Request queue full"}})).map_err(|e|e.to_string())?;
            } else {
                return Err("Agent proxy worker stopped".into());
            }
        }
    }
    subscriptions.stop();
    drop(tx);
    worker.join().map_err(|_| "Agent proxy worker failed")?
}
