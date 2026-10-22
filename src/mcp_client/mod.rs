//! Outbound MCP host. Connections/grants are local, session-only and excluded
//! from projects. SI sees only explicitly granted, namespaced tools.
mod http;
mod lines;
use rmcp::{
    model::{CallToolRequestParams, PaginatedRequestParams},
    service::RunningService,
    service::{ClientLifecycleMode, ClientServiceExt},
    RoleClient,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    collections::{BTreeMap, BTreeSet},
    future::Future,
    path::PathBuf,
    sync::{Arc, LazyLock, Mutex},
    time::Duration,
};
static RUNTIME: LazyLock<tokio::runtime::Runtime> = LazyLock::new(|| {
    tokio::runtime::Builder::new_multi_thread()
        .worker_threads(2)
        .enable_all()
        .build()
        .expect("MCP runtime")
});
#[derive(Clone, Serialize, Deserialize)]
#[serde(tag = "transport", rename_all = "snake_case", deny_unknown_fields)]
pub enum Config {
    Stdio {
        command: PathBuf,
        #[serde(default)]
        arguments: Vec<String>,
        cwd: Option<PathBuf>,
        #[serde(default)]
        environment: BTreeMap<String, String>,
    },
    Http {
        url: String,
        token: Option<String>,
    },
}
#[derive(Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum Access {
    Read,
    Action,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Grant {
    pub tool: String,
    pub fingerprint: String,
    pub access: Access,
}
struct Connection {
    id: String,
    name: String,
    kind: &'static str,
    service: RunningService<RoleClient, ()>,
    tools: Vec<Value>,
    grants: Mutex<BTreeMap<String, Grant>>,
    child: Mutex<Option<tokio::process::Child>>,
    nonce: String,
    permits: tokio::sync::Semaphore,
}
impl Drop for Connection {
    fn drop(&mut self) {
        if let Ok(slot) = self.child.get_mut() {
            if let Some(mut child) = slot.take() {
                let _ = child.start_kill();
                RUNTIME.spawn(async move {
                    let _ = child.wait().await;
                });
            }
        }
    }
}
#[derive(Default)]
pub struct Client {
    connections: Mutex<BTreeMap<String, Arc<Connection>>>,
}
#[derive(Clone)]
pub struct Exposed {
    pub name: String,
    pub schema: Value,
    pub connection: String,
    pub tool: String,
    pub fingerprint: String,
    pub access: Access,
    pub nonce: String,
}
fn fingerprint(tool: &Value) -> String {
    format!("{:x}", Sha256::digest(tool.to_string().as_bytes()))
}
fn valid_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 32
        && id
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || b"-_".contains(&c))
}
fn bounded<T>(value: &T) -> Result<(), String>
where
    T: Serialize,
{
    if serde_json::to_vec(value)
        .map_err(|_| "Invalid MCP data")?
        .len()
        > 2 * 1024 * 1024
    {
        Err("RESOURCE_LIMIT: MCP data exceeds 2 MiB".into())
    } else {
        Ok(())
    }
}
fn wait<T>(future: impl Future<Output = Result<T, String>>) -> Result<T, String> {
    let flag = crate::operation::cancellation_flag();
    RUNTIME.block_on(async {
        tokio::select! {
            result=future=>result,
            _=tokio::time::sleep(Duration::from_secs(60))=>Err("RESOURCE_LIMIT: MCP operation exceeded 60 seconds; completed external actions may remain; inspect before retrying".into()),
            _=async {if flag.is_none(){std::future::pending::<()>().await;} loop {if flag.as_ref().is_some_and(|f|f.load(std::sync::atomic::Ordering::Relaxed)){break;}tokio::time::sleep(Duration::from_millis(40)).await;}}=>Err("CANCELLED: external MCP operation stopped; completed actions may remain".into()),
        }
    })
}
/// Dropping a UI/job wait must also cancel work in the external peer.
struct CancelRequest {
    peer: rmcp::Peer<RoleClient>,
    id: Option<rmcp::model::RequestId>,
}
impl Drop for CancelRequest {
    fn drop(&mut self) {
        if let Some(id) = self.id.take() {
            let peer = self.peer.clone();
            RUNTIME.spawn(async move {
                let _ = peer
                    .notify_cancelled(rmcp::model::CancelledNotificationParam::new(
                        Some(id),
                        Some("Chronoscope call cancelled".into()),
                    ))
                    .await;
            });
        }
    }
}
fn lifecycle() -> ClientLifecycleMode {
    ClientLifecycleMode::Auto {
        preferred_versions: vec![rmcp::model::ProtocolVersion::LATEST],
        legacy_version: Some(rmcp::model::ProtocolVersion::LATEST_WITH_INITIALIZE),
    }
}
impl Client {
    /// Stop owned programs even when an in-flight call still holds its connection.
    pub fn shutdown(&self) {
        if let Ok(mut pool) = self.connections.lock() {
            for (_, c) in std::mem::take(&mut *pool) {
                c.service.cancellation_token().cancel();
                if let Ok(mut slot) = c.child.lock() {
                    if let Some(child) = slot.as_mut() {
                        let _ = child.start_kill();
                    }
                }
            }
        }
    }
    fn connection(&self, id: &str) -> Result<Arc<Connection>, String> {
        self.connections
            .lock()
            .map_err(|_| "MCP clients unavailable")?
            .get(id)
            .cloned()
            .ok_or_else(|| "NOT_FOUND: MCP connection is not active".into())
    }
    pub fn invoke(&self, command: &str, args: Value) -> Result<Value, String> {
        match command {
            "client_status" => {
                let connections = self
                    .connections
                    .lock()
                    .map_err(|_| "MCP clients unavailable")?;
                Ok(
                    json!({"connections":connections.values().map(|c|json!({"id":c.id,"name":c.name,"transport":c.kind,"connected":!c.service.is_closed(),"tool_count":c.tools.len(),"granted":c.grants.lock().map(|g|g.len()).unwrap_or(0)})).collect::<Vec<_>>(),"storage":"session memory; definitions, tokens and grants are never saved to projects"}),
                )
            }
            "client_connect" => {
                let id = args["id"].as_str().unwrap();
                let name = args["name"].as_str().unwrap();
                if !valid_id(id) || name.trim().is_empty() || name.chars().count() > 128 {
                    return Err(
                        "INVALID_ARGUMENT: connection needs a unique short ID and name".into(),
                    );
                }
                {
                    let pool = self
                        .connections
                        .lock()
                        .map_err(|_| "MCP clients unavailable")?;
                    if pool.contains_key(id) {
                        return Err("CONFLICT: disconnect before replacing a connection".into());
                    }
                    if pool.len() >= 16 {
                        return Err("RESOURCE_LIMIT: at most 16 active MCP connections".into());
                    }
                }
                let config: Config = serde_json::from_value(args["config"].clone())
                    .map_err(|_| "INVALID_ARGUMENT: invalid MCP connection settings")?;
                let connection = wait(self.connect(id, name, config))?;
                let mut pool = self
                    .connections
                    .lock()
                    .map_err(|_| "MCP clients unavailable")?;
                if pool.contains_key(id) || pool.len() >= 16 {
                    return Err("CONFLICT: MCP connections changed; retry".into());
                }
                pool.insert(id.into(), Arc::new(connection));
                Ok(json!({"connected":true,"id":id}))
            }
            "client_disconnect" => {
                let connection = self
                    .connections
                    .lock()
                    .map_err(|_| "MCP clients unavailable")?
                    .remove(args["id"].as_str().unwrap());
                if let Some(c) = connection {
                    c.service.cancellation_token().cancel();
                    if let Ok(mut slot) = c.child.lock() {
                        if let Some(child) = slot.as_mut() {
                            let _ = child.start_kill();
                        }
                    }
                }
                Ok(json!({"connected":false}))
            }
            "client_tools" => {
                let c = self.connection(args["id"].as_str().unwrap())?;
                let grants = c.grants.lock().map_err(|_| "MCP grants unavailable")?;
                Ok(
                    json!({"id":c.id,"tools":c.tools.iter().map(|t|json!({"definition":t,"fingerprint":fingerprint(t),"access":grants.get(t["name"].as_str().unwrap()).map(|g|g.access)})).collect::<Vec<_>>()}),
                )
            }
            "client_grants" => {
                let c = self.connection(args["id"].as_str().unwrap())?;
                let grants: Vec<Grant> = serde_json::from_value(args["grants"].clone())
                    .map_err(|_| "Invalid MCP tool grants")?;
                let mut chosen = BTreeMap::new();
                for grant in grants {
                    let tool = c
                        .tools
                        .iter()
                        .find(|t| t["name"] == grant.tool)
                        .ok_or("NOT_FOUND: grant names an unknown tool")?;
                    if fingerprint(tool) != grant.fingerprint {
                        return Err("CONFLICT: tool definition changed; review again".into());
                    }
                    if chosen.insert(grant.tool.clone(), grant).is_some() {
                        return Err("Invalid duplicate tool grant".into());
                    }
                }
                *c.grants.lock().map_err(|_| "MCP grants unavailable")? = chosen;
                Ok(json!({"updated":true}))
            }
            "client_call" => {
                let c = self.connection(args["id"].as_str().unwrap())?;
                self.call(
                    &c,
                    args["tool"].as_str().unwrap(),
                    args["fingerprint"].as_str().unwrap(),
                    args["arguments"].clone(),
                    args["allow_actions"].as_bool().unwrap_or(false),
                )
            }
            _ => Err("Unknown MCP client command".into()),
        }
    }
    async fn connect(&self, id: &str, name: &str, config: Config) -> Result<Connection, String> {
        let (service, child, kind) = match config {
            Config::Stdio {
                command,
                arguments,
                cwd,
                environment,
            } => {
                // Exact executable and argument vector: never a shell. No inherited secret environment.
                if !command.is_absolute()
                    || !command.is_file()
                    || arguments.len() > 128
                    || arguments.iter().any(|a| a.len() > 16384)
                    || environment.len() > 64
                    || environment.iter().any(|(k, v)| {
                        k.is_empty()
                            || k.contains(['=', '\0'])
                            || v.len() > 8192
                            || v.contains('\0')
                    })
                {
                    return Err("INVALID_ARGUMENT: choose an absolute trusted executable and bounded arguments/environment".into());
                }
                let mut process = tokio::process::Command::new(command);
                process.env_clear();
                for key in [
                    "PATH",
                    "HOME",
                    "USERPROFILE",
                    "SYSTEMROOT",
                    "WINDIR",
                    "TMPDIR",
                    "TMP",
                    "TEMP",
                    "LANG",
                    "LC_ALL",
                    "SSL_CERT_FILE",
                    "SSL_CERT_DIR",
                    "HTTP_PROXY",
                    "HTTPS_PROXY",
                    "NO_PROXY",
                ] {
                    if let Some(v) = std::env::var_os(key) {
                        process.env(key, v);
                    }
                }
                process
                    .envs(environment)
                    .args(arguments)
                    .kill_on_drop(true)
                    .stdin(std::process::Stdio::piped())
                    .stdout(std::process::Stdio::piped())
                    .stderr(std::process::Stdio::null());
                if let Some(cwd) = cwd {
                    process.current_dir(cwd);
                }
                let mut child = process
                    .spawn()
                    .map_err(|_| "MCP local server could not start")?;
                let read = lines::Lines {
                    reader: child.stdout.take().unwrap(),
                    bytes: 0,
                };
                let write = child.stdin.take().unwrap();
                let service = ()
                    .serve_with_lifecycle(
                        rmcp::transport::async_rw::AsyncRwTransport::new_client(read, write),
                        lifecycle(),
                    )
                    .await
                    .map_err(|_| {
                        "MCP initialization failed; check executable and protocol support"
                    })?;
                (service, Some(child), "stdio")
            }
            Config::Http { url, token } => {
                let address = mcp_http::Url::parse(&url).map_err(|_| "Invalid MCP URL")?;
                if !(address.scheme() == "https"
                    || address.scheme() == "http"
                        && matches!(
                            address.host_str(),
                            Some("localhost" | "127.0.0.1" | "[::1]")
                        ))
                    || !address.username().is_empty()
                    || address.password().is_some()
                    || address.query().is_some()
                    || address.fragment().is_some()
                    || url.len() > 2048
                    || token
                        .as_ref()
                        .is_some_and(|t| t.len() > 8192 || t.chars().any(char::is_control))
                {
                    return Err("INVALID_ARGUMENT: MCP requires HTTPS (HTTP only on localhost), no URL credentials/query/fragment".into());
                }
                let http = mcp_http::Client::builder()
                    .redirect(mcp_http::redirect::Policy::none())
                    .retry(mcp_http::retry::never())
                    .connect_timeout(Duration::from_secs(10))
                    .build()
                    .map_err(|_| "Cannot create MCP HTTP client")?;
                let mut options=rmcp::transport::streamable_http_client::StreamableHttpClientTransportConfig::with_uri(url);
                options.auth_header = token;
                options.max_concurrent_requests = 2;
                options.max_sse_event_size = 2 * 1024 * 1024;
                options.reinit_on_expired_session = false;
                options.retry_config =
                    Arc::new(rmcp::transport::common::client_side_sse::NeverRetry::default());
                let transport = rmcp::transport::StreamableHttpClientTransport::with_client(
                    http::BoundedHttp(http),
                    options,
                );
                let service=().serve_with_lifecycle(transport,lifecycle()).await.map_err(|_|"MCP connection failed; check endpoint/authentication/protocol. OAuth browser sign-in is not supported yet")?;
                (service, None, "http")
            }
        };
        let mut c = Connection {
            id: id.into(),
            name: name.into(),
            kind,
            service,
            child: Mutex::new(child),
            tools: vec![],
            grants: Mutex::new(BTreeMap::new()),
            permits: tokio::sync::Semaphore::new(4),
            nonce: {
                let mut bytes = [0u8; 16];
                getrandom::fill(&mut bytes).map_err(|_| "Cannot create MCP session")?;
                bytes.iter().map(|b| format!("{b:02x}")).collect()
            },
        };
        let mut cursor = None;
        let mut seen = BTreeSet::new();
        for _ in 0..16 {
            let page = c
                .service
                .list_tools(Some({
                    let mut p = PaginatedRequestParams::default();
                    p.cursor = cursor;
                    p
                }))
                .await
                .map_err(|_| "MCP tool discovery failed")?;
            bounded(&page)?;
            for tool in page.tools {
                let value = serde_json::to_value(tool).map_err(|_| "Invalid MCP tool")?;
                let name = value["name"].as_str().ok_or("Missing tool name")?;
                if !seen.insert(name.to_owned()) {
                    return Err("Invalid duplicate MCP tool".into());
                }
                let schema = value["inputSchema"].clone();
                if !schema.is_object() {
                    return Err("Invalid MCP input schema".into());
                }
                jsonschema::validator_for(&schema).map_err(|_| {
                    "Unsupported MCP tool schema (external references are not fetched)"
                })?;
                if let Some(schema) = value.get("outputSchema") {
                    jsonschema::validator_for(schema)
                        .map_err(|_| "Unsupported MCP output schema")?;
                }
                c.tools.push(value);
                if c.tools.len() > 256 {
                    return Err("RESOURCE_LIMIT: MCP connection exceeds 256 tools".into());
                }
            }
            cursor = page.next_cursor;
            if cursor.is_none() {
                bounded(&c.tools)?;
                return Ok(c);
            }
        }
        Err("RESOURCE_LIMIT: MCP discovery exceeded 16 pages".into())
    }
    fn call(
        &self,
        c: &Arc<Connection>,
        name: &str,
        expected: &str,
        arguments: Value,
        allow_actions: bool,
    ) -> Result<Value, String> {
        if !Arc::ptr_eq(&self.connection(&c.id)?, c) {
            return Err("CONFLICT: MCP connection was replaced".into());
        }
        let tool = c
            .tools
            .iter()
            .find(|t| t["name"] == name)
            .ok_or("NOT_FOUND: unknown external tool")?;
        let grant = c
            .grants
            .lock()
            .map_err(|_| "MCP grants unavailable")?
            .get(name)
            .cloned()
            .ok_or("SCOPE_DENIED: tool has no explicit grant")?;
        if grant.fingerprint != expected || fingerprint(tool) != expected {
            return Err("CONFLICT: external tool definition changed".into());
        }
        if grant.access == Access::Action && !allow_actions {
            return Err("SCOPE_DENIED: external actions are disabled for this message".into());
        }
        bounded(&arguments)?;
        let arguments = arguments
            .as_object()
            .cloned()
            .ok_or("Invalid MCP arguments: expected object")?;
        jsonschema::validator_for(&tool["inputSchema"])
            .map_err(|_| "Unsupported tool schema")?
            .validate(&Value::Object(arguments.clone()))
            .map_err(|_| "INVALID_ARGUMENT: arguments do not match the granted MCP schema")?;
        wait(async {
            let _permit = c
                .permits
                .acquire()
                .await
                .map_err(|_| "MCP connection closed")?;
            // Grants can be revoked while a call waits for capacity.
            let still_allowed = c
                .grants
                .lock()
                .map_err(|_| "MCP grants unavailable")?
                .get(name)
                .is_some_and(|g| {
                    g.fingerprint == expected && (g.access == Access::Read || allow_actions)
                });
            if !still_allowed || !Arc::ptr_eq(&self.connection(&c.id)?, c) {
                return Err("SCOPE_DENIED: external MCP grant or connection changed".into());
            }
            let request =
                rmcp::model::ClientRequest::CallToolRequest(rmcp::model::CallToolRequest::new(
                    CallToolRequestParams::new(name.to_string()).with_arguments(arguments),
                ));
            let handle = c
                .service
                .peer()
                .send_cancellable_request(request, rmcp::service::PeerRequestOptions::no_options())
                .await
                .map_err(|_| "MCP request could not start")?;
            let mut cancellation = CancelRequest {
                peer: c.service.peer().clone(),
                id: Some(handle.id.clone()),
            };
            let response = handle
                .await_response()
                .await
                .map_err(|_| "MCP tool failed; external actions may have completed")?;
            cancellation.id = None;
            let rmcp::model::ServerResult::CallToolResult(result) = response else {
                return Err("MCP service requires unsupported interactive input or asynchronous task handling; inspect external effects before retrying".into());
            };
            bounded(&result)?;
            let value = serde_json::to_value(result).map_err(|_| "Invalid MCP result")?;
            if value["isError"] != true {
                if let Some(schema) = tool.get("outputSchema") {
                    let validator = jsonschema::validator_for(schema)
                        .map_err(|_| "Invalid MCP output schema")?;
                    validator.validate(&value["structuredContent"]).map_err(|_|"INVALID_ARGUMENT: external result did not match its declared schema; actions may have completed")?;
                }
            }
            Ok(value)
        })
    }

    pub fn exposed(&self, actions: bool) -> Result<Vec<Exposed>, String> {
        let pool = self
            .connections
            .lock()
            .map_err(|_| "MCP clients unavailable")?;
        let mut exposed = vec![];
        for c in pool.values().filter(|c| !c.service.is_closed()) {
            let grants = c.grants.lock().map_err(|_| "MCP grants unavailable")?;
            for tool in &c.tools {
                let name = tool["name"].as_str().unwrap();
                if let Some(grant) = grants
                    .get(name)
                    .filter(|g| g.access == Access::Read || actions)
                {
                    let hash = fingerprint(&json!([c.nonce, tool]));
                    let alias = format!("external_{}_{}", c.id, &hash[..16]);
                    exposed.push(Exposed{name:alias.clone(),schema:json!({"type":"function","function":{"name":alias,"description":format!("External MCP tool from {}: {}. {}",c.name,name,tool["description"].as_str().unwrap_or("")),"parameters":tool["inputSchema"]}}),connection:c.id.clone(),tool:name.into(),fingerprint:grant.fingerprint.clone(),access:grant.access,nonce:c.nonce.clone()});
                }
            }
        }
        if exposed.len() > 128
            || serde_json::to_vec(&exposed.iter().map(|e| &e.schema).collect::<Vec<_>>())
                .map_err(|_| "Invalid MCP schemas")?
                .len()
                > 256 * 1024
        {
            return Err(
                "RESOURCE_LIMIT: too many granted external tools; disable unused tools".into(),
            );
        }
        Ok(exposed)
    }
    pub fn call_exposed(
        &self,
        e: &Exposed,
        args: Value,
        allow_actions: bool,
    ) -> Result<Value, String> {
        let c = self.connection(&e.connection)?;
        if c.nonce != e.nonce {
            return Err("CONFLICT: external MCP connection changed".into());
        }
        self.call(&c, &e.tool, &e.fingerprint, args, allow_actions)
    }
}
