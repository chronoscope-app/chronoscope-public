//! Session-only, loopback browser bridge. A paired extension can only publish
//! its chosen document's tools and return their results; it has no engine IPC.
use axum::{
    extract::{DefaultBodyLimit, State},
    http::{header, HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    routing::post,
    Json, Router,
};
use serde_json::{json, Value};
use std::{
    collections::{BTreeMap, VecDeque},
    sync::{Arc, LazyLock, Mutex},
    time::{Duration, Instant},
};
use tokio::sync::{oneshot, Notify};

const LIMIT: usize = 2 * 1024 * 1024;
const CONNECTION: &str = "browser-webmcp";
static RUNTIME: LazyLock<tokio::runtime::Runtime> = LazyLock::new(|| {
    tokio::runtime::Builder::new_multi_thread()
        .worker_threads(2)
        .enable_all()
        .build()
        .expect("WebMCP runtime")
});
fn secret() -> Result<String, String> {
    let mut b = [0u8; 32];
    getrandom::fill(&mut b).map_err(|_| "Cannot create browser session")?;
    Ok(b.iter().map(|x| format!("{x:02x}")).collect())
}
struct Pending {
    rpc_id: Value,
    result: oneshot::Sender<Value>,
}
struct Session {
    pairing: String,
    expires: Instant,
    extension: Option<String>,
    browser_token: String,
    mcp_token: String,
    document: String,
    origin: String,
    tools: Vec<Value>,
    last_seen: Instant,
    queue: VecDeque<Value>,
    pending: BTreeMap<String, Pending>,
    active: bool,
}
struct Shared {
    session: Mutex<Session>,
    notify: Notify,
    host: String,
}
impl Shared {
    fn invalidate(&self) {
        if let Ok(mut s) = self.session.lock() {
            s.active = false;
            s.tools.clear();
            s.pending.clear();
            s.queue.clear();
        }
        self.notify.notify_waiters();
    }
}
struct Running {
    shared: Arc<Shared>,
    stop: Option<oneshot::Sender<()>>,
}
impl Drop for Running {
    fn drop(&mut self) {
        self.shared.invalidate();
        if let Some(stop) = self.stop.take() {
            let _ = stop.send(());
        }
    }
}
#[derive(Default)]
pub struct Browser {
    running: Mutex<Option<Running>>,
}
impl Browser {
    pub fn shutdown(&self) {
        if let Ok(mut slot) = self.running.lock() {
            slot.take();
        }
    }
    pub fn invoke(
        &self,
        client: &crate::mcp_client::Client,
        command: &str,
        args: &Value,
    ) -> Result<Value, String> {
        if command == "webmcp_extension" {
            use std::io::Write;
            let path = std::path::Path::new(args["path"].as_str().ok_or("Missing path")?);
            if !path.is_absolute() {
                return Err("INVALID_ARGUMENT: choose an absolute ZIP path".into());
            }
            let parent = path.parent().ok_or("Invalid export path")?;
            let mut file = tempfile::NamedTempFile::new_in(parent).map_err(|e| e.to_string())?;
            {
                let mut archive = zip::ZipWriter::new(file.as_file_mut());
                let options = zip::write::SimpleFileOptions::default()
                    .compression_method(zip::CompressionMethod::Deflated);
                for (name, content) in [
                    (
                        "manifest.json",
                        include_str!("../browser/webmcp-extension/manifest.json"),
                    ),
                    (
                        "background.js",
                        include_str!("../browser/webmcp-extension/background.js"),
                    ),
                    (
                        "page-adapter.js",
                        include_str!("../browser/webmcp-extension/page-adapter.js"),
                    ),
                    (
                        "popup.html",
                        include_str!("../browser/webmcp-extension/popup.html"),
                    ),
                    (
                        "popup.js",
                        include_str!("../browser/webmcp-extension/popup.js"),
                    ),
                ] {
                    archive
                        .start_file(name, options)
                        .map_err(|e| e.to_string())?;
                    archive
                        .write_all(content.as_bytes())
                        .map_err(|e| e.to_string())?;
                }
                archive.finish().map_err(|e| e.to_string())?;
            }
            file.as_file().sync_all().map_err(|e| e.to_string())?;
            if args["overwrite"] == true {
                file.persist(path)
            } else {
                file.persist_noclobber(path)
            }
            .map_err(|e| e.to_string())?;
            return Ok(json!({"path":path,"saved":true}));
        }
        if command == "webmcp_stop" {
            self.shutdown();
            client.invoke("client_disconnect", json!({"id":CONNECTION}))?;
            return Ok(json!({"running":false,"paired":false}));
        }
        if command == "webmcp_start" {
            self.shutdown();
            client.invoke("client_disconnect", json!({"id":CONNECTION}))?;
            let listener = std::net::TcpListener::bind("127.0.0.1:0")
                .map_err(|_| "Cannot bind browser bridge")?;
            listener
                .set_nonblocking(true)
                .map_err(|_| "Cannot configure browser bridge")?;
            let host = listener
                .local_addr()
                .map_err(|_| "Browser bridge address unavailable")?
                .to_string();
            let pairing = secret()?;
            let shared = Arc::new(Shared {
                host: host.clone(),
                notify: Notify::new(),
                session: Mutex::new(Session {
                    pairing: pairing.clone(),
                    expires: Instant::now() + Duration::from_secs(300),
                    extension: None,
                    browser_token: secret()?,
                    mcp_token: secret()?,
                    document: String::new(),
                    origin: String::new(),
                    tools: vec![],
                    last_seen: Instant::now(),
                    queue: VecDeque::new(),
                    pending: BTreeMap::new(),
                    active: false,
                }),
            });
            let (stop, stopped) = oneshot::channel();
            let state = shared.clone();
            RUNTIME.spawn(async move {
                let listener = match tokio::net::TcpListener::from_std(listener) {
                    Ok(l) => l,
                    Err(_) => return,
                };
                let app = Router::new()
                    .route("/pair", post(pair))
                    .route("/poll", post(poll))
                    .route("/result", post(result))
                    .route("/invalidate", post(invalidate))
                    .route("/mcp", post(mcp))
                    .layer(DefaultBodyLimit::max(LIMIT))
                    .with_state(state.clone());
                let _ = axum::serve(listener, app)
                    .with_graceful_shutdown(async {
                        let _ = stopped.await;
                    })
                    .await;
                state.invalidate();
            });
            *self
                .running
                .lock()
                .map_err(|_| "Browser bridge unavailable")? = Some(Running {
                shared,
                stop: Some(stop),
            });
            return Ok(
                json!({"running":true,"paired":false,"url":format!("http://{host}"),"pairing_code":pairing,"expires_seconds":300}),
            );
        }
        let (shared, url) = {
            let slot = self
                .running
                .lock()
                .map_err(|_| "Browser bridge unavailable")?;
            let Some(r) = slot.as_ref() else {
                return if command == "webmcp_status" {
                    Ok(json!({"running":false,"paired":false}))
                } else {
                    Err("NOT_FOUND: start browser connection first".into())
                };
            };
            (r.shared.clone(), format!("http://{}", r.shared.host))
        };
        let (paired, origin, document, tools, token) = {
            let s = shared
                .session
                .lock()
                .map_err(|_| "Browser session unavailable")?;
            (
                s.active && s.last_seen.elapsed() < Duration::from_secs(60),
                s.origin.clone(),
                s.document.clone(),
                s.tools.len(),
                s.mcp_token.clone(),
            )
        };
        if command == "webmcp_connect" {
            if !paired {
                return Err(
                    "CONFLICT: pair a browser tab first; restart after navigation or tool changes"
                        .into(),
                );
            }
            client.invoke("client_disconnect", json!({"id":CONNECTION}))?;
            let result=client.invoke("client_connect",json!({"id":CONNECTION,"name":format!("Browser · {origin}"),"config":{"transport":"http","url":format!("{url}/mcp"),"token":token}}))?;
            // Binding changed while the SDK discovered tools: discard all grants.
            if !shared
                .session
                .lock()
                .is_ok_and(|s| s.active && s.document == document)
            {
                client.invoke("client_disconnect", json!({"id":CONNECTION}))?;
                return Err("CONFLICT: browser document changed; reconnect".into());
            }
            return Ok(result);
        }
        Ok(
            json!({"running":true,"paired":paired,"url":url,"origin":origin,"tool_count":tools,"connection_id":CONNECTION}),
        )
    }
}
fn denied() -> Response {
    (
        StatusCode::UNAUTHORIZED,
        Json(json!({"error":"Browser session not authorized"})),
    )
        .into_response()
}
fn error(message: &str) -> Response {
    (StatusCode::BAD_REQUEST, Json(json!({"error":message}))).into_response()
}
fn host_ok(shared: &Shared, h: &HeaderMap) -> bool {
    h.get(header::HOST).and_then(|h| h.to_str().ok()) == Some(shared.host.as_str())
}
fn extension(h: &HeaderMap) -> Option<&str> {
    let o = h.get(header::ORIGIN)?.to_str().ok()?;
    let id = o.strip_prefix("chrome-extension://")?;
    (id.len() == 32 && id.bytes().all(|c| (b'a'..=b'p').contains(&c))).then_some(o)
}
fn browser_auth(shared: &Shared, h: &HeaderMap) -> bool {
    if !host_ok(shared, h) {
        return false;
    }
    let Ok(mut s) = shared.session.lock() else {
        return false;
    };
    if !s.active
        || s.last_seen.elapsed() > Duration::from_secs(60)
        || extension(h) != s.extension.as_deref()
        || h.get(header::AUTHORIZATION).and_then(|v| v.to_str().ok())
            != Some(format!("Bearer {}", s.browser_token).as_str())
    {
        return false;
    }
    s.last_seen = Instant::now();
    true
}
async fn pair(State(shared): State<Arc<Shared>>, h: HeaderMap, Json(v): Json<Value>) -> Response {
    if !host_ok(&shared, &h) || extension(&h).is_none() {
        return denied();
    }
    let Ok(mut s) = shared.session.lock() else {
        return denied();
    };
    if s.extension.is_some()
        || Instant::now() > s.expires
        || v["pairing_code"].as_str() != Some(s.pairing.as_str())
    {
        return denied();
    }
    let origin = v["origin"].as_str().unwrap_or("");
    let document = v["document"].as_str().unwrap_or("");
    let valid_origin = mcp_http::Url::parse(origin).is_ok_and(|u| {
        u.origin().ascii_serialization() == origin
            && (u.scheme() == "https"
                || u.scheme() == "http"
                    && matches!(u.host_str(), Some("localhost" | "127.0.0.1" | "[::1]")))
    });
    let Some(tools) = v["tools"].as_array() else {
        return error("Missing tools");
    };
    let mut names = std::collections::BTreeSet::new();
    if !valid_origin
        || document.is_empty()
        || document.len() > 128
        || tools.is_empty()
        || tools.len() > 256
    {
        return error("Invalid document or tool catalogue");
    }
    for tool in tools {
        let name = tool["name"].as_str().unwrap_or("");
        if name.is_empty()
            || name.len() > 128
            || !name
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b"_-.".contains(&b))
            || !names.insert(name)
            || tool["description"].as_str().is_none_or(|d| d.len() > 16384)
            || !tool["inputSchema"].is_object()
            || jsonschema::validator_for(&tool["inputSchema"]).is_err()
        {
            return error("Invalid tool definition");
        }
    }
    s.tools = tools.clone();
    s.document = document.into();
    s.origin = origin.into();
    s.extension = extension(&h).map(str::to_owned);
    s.pairing.clear();
    s.active = true;
    s.last_seen = Instant::now();
    Json(json!({"token":s.browser_token})).into_response()
}
async fn poll(State(shared): State<Arc<Shared>>, h: HeaderMap) -> Response {
    if !browser_auth(&shared, &h) {
        return denied();
    }
    // Register before inspecting the queue so enqueue cannot race the wait.
    let notified = shared.notify.notified();
    tokio::pin!(notified);
    notified.as_mut().enable();
    if let Some(job) = shared
        .session
        .lock()
        .ok()
        .and_then(|mut s| s.queue.pop_front())
    {
        return Json(job).into_response();
    }
    let _ = tokio::time::timeout(Duration::from_secs(20), notified).await;
    if !browser_auth(&shared, &h) {
        return denied();
    }
    let job = shared
        .session
        .lock()
        .ok()
        .and_then(|mut s| s.queue.pop_front())
        .unwrap_or(json!({"kind":"idle"}));
    Json(job).into_response()
}
async fn result(State(shared): State<Arc<Shared>>, h: HeaderMap, Json(v): Json<Value>) -> Response {
    if !browser_auth(&shared, &h) {
        return denied();
    }
    let Ok(mut s) = shared.session.lock() else {
        return denied();
    };
    if v["document"] != s.document {
        return error("Stale browser document");
    }
    if let Some(pending) = v["id"].as_str().and_then(|id| s.pending.remove(id)) {
        let _ = pending.result.send(v);
    }
    StatusCode::NO_CONTENT.into_response()
}
async fn invalidate(State(shared): State<Arc<Shared>>, h: HeaderMap) -> Response {
    if !browser_auth(&shared, &h) {
        return denied();
    }
    shared.invalidate();
    StatusCode::NO_CONTENT.into_response()
}
fn rpc(id: Value, result: Value) -> Response {
    Json(json!({"jsonrpc":"2.0","id":id,"result":result})).into_response()
}
fn rpc_error(id: Value, code: i64, message: &str) -> Response {
    Json(json!({"jsonrpc":"2.0","id":id,"error":{"code":code,"message":message}})).into_response()
}
struct PendingGuard {
    shared: Arc<Shared>,
    id: String,
}
impl Drop for PendingGuard {
    fn drop(&mut self) {
        if let Ok(mut s) = self.shared.session.lock() {
            if s.pending.remove(&self.id).is_some() {
                s.queue.retain(|q| q["id"] != self.id);
                if s.queue.len() < 16 {
                    s.queue.push_back(json!({"kind":"cancel","id":self.id}));
                }
            }
        }
        self.shared.notify.notify_one();
    }
}
async fn mcp(State(shared): State<Arc<Shared>>, h: HeaderMap, Json(v): Json<Value>) -> Response {
    if !host_ok(&shared, &h) || h.contains_key(header::ORIGIN) {
        return denied();
    }
    {
        let Ok(s) = shared.session.lock() else {
            return denied();
        };
        if !s.active
            || s.last_seen.elapsed() > Duration::from_secs(60)
            || h.get(header::AUTHORIZATION).and_then(|v| v.to_str().ok())
                != Some(format!("Bearer {}", s.mcp_token).as_str())
        {
            return denied();
        }
    }
    let id = v["id"].clone();
    match v["method"].as_str().unwrap_or("") {
        "initialize" => rpc(
            id,
            json!({"protocolVersion":"2025-11-25","capabilities":{"tools":{}},"serverInfo":{"name":"Chronoscope Browser WebMCP","version":env!("CARGO_PKG_VERSION")}}),
        ),
        "ping" => rpc(id, json!({})),
        "notifications/initialized" => StatusCode::ACCEPTED.into_response(),
        "notifications/cancelled" => {
            let request = &v["params"]["requestId"];
            let key = shared.session.lock().ok().and_then(|s| {
                s.pending
                    .iter()
                    .find(|(_, p)| &p.rpc_id == request)
                    .map(|(id, _)| id.clone())
            });
            if let Some(id) = key {
                drop(PendingGuard {
                    shared: shared.clone(),
                    id,
                });
            }
            StatusCode::ACCEPTED.into_response()
        }
        "tools/list" => {
            let tools = shared
                .session
                .lock()
                .map(|s| s.tools.clone())
                .unwrap_or_default();
            rpc(id, json!({"tools":tools}))
        }
        "tools/call" => {
            let call_id = match secret() {
                Ok(s) => s,
                Err(_) => return rpc_error(id, -32603, "Cannot create browser call"),
            };
            let (tx, rx) = oneshot::channel();
            {
                let Ok(mut s) = shared.session.lock() else {
                    return denied();
                };
                let Some(tool) = s.tools.iter().find(|t| t["name"] == v["params"]["name"]) else {
                    return rpc_error(id, -32602, "Unknown browser tool");
                };
                let args = v["params"].get("arguments").cloned().unwrap_or(json!({}));
                if !args.is_object()
                    || !jsonschema::validator_for(&tool["inputSchema"])
                        .is_ok_and(|schema| schema.is_valid(&args))
                {
                    return rpc_error(id, -32602, "Invalid browser tool arguments");
                }
                if s.pending.len() >= 4 || s.queue.len() >= 16 {
                    return rpc_error(id, -32603, "Browser call queue full");
                }
                let document = s.document.clone();
                s.queue.push_back(json!({"kind":"call","id":call_id,"document":document,"name":v["params"]["name"],"arguments":args}));
                s.pending.insert(
                    call_id.clone(),
                    Pending {
                        rpc_id: id.clone(),
                        result: tx,
                    },
                );
            }
            let _guard = PendingGuard {
                shared: shared.clone(),
                id: call_id,
            };
            shared.notify.notify_one();
            match tokio::time::timeout(Duration::from_secs(50),rx).await {
                Ok(Ok(v))=>{let failed=v["error"].as_str();let text=failed.map(str::to_owned).unwrap_or_else(||v["result"].as_str().map(str::to_owned).unwrap_or_else(||v["result"].to_string()));rpc(id,json!({"content":[{"type":"text","text":text}],"isError":failed.is_some()}))},
                _=>rpc_error(id,-32603,"Browser call stopped, timed out or document changed; inspect external effects before retrying"),
            }
        }
        _ => rpc_error(id, -32601, "Method not found"),
    }
}
