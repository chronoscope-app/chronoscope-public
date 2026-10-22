//! Explicitly enabled loopback-only bridge for browser QA/development.
use crate::engine::Engine;
use axum::{
    extract::{DefaultBodyLimit, Path, State},
    http::{header, HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    routing::{get, post},
    Json, Router,
};
use serde::Deserialize;
use serde_json::{json, Value};
use std::{path::PathBuf, sync::Arc};
#[derive(Clone)]
struct Bridge {
    engine: Arc<Engine>,
    token: String,
    frontend: Option<PathBuf>,
}
#[derive(Deserialize)]
struct Request {
    command: String,
    #[serde(default)]
    args: Value,
}
async fn invoke(
    State(s): State<Bridge>,
    headers: HeaderMap,
    Json(request): Json<Request>,
) -> Response {
    if headers
        .get(header::AUTHORIZATION)
        .and_then(|h| h.to_str().ok())
        != Some(&format!("Bearer {}", s.token))
    {
        return (
            StatusCode::UNAUTHORIZED,
            Json(json!({"error":"Unauthorized"})),
        )
            .into_response();
    }
    let result = tokio::task::spawn_blocking(move || {
        let command = crate::command::Command::parse(&request.command).ok_or_else(|| {
            crate::error::EngineError::from("INVALID_ARGUMENT: unknown command".to_string())
        })?;
        s.engine.invoke_typed(command, request.args)
    })
    .await;
    match result {
        Ok(Ok(value)) => Json(json!({"result":value})).into_response(),
        Ok(Err(error)) => (StatusCode::BAD_REQUEST, Json(json!({"error":error}))).into_response(),
        Err(_) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({"error":"Worker failed"})),
        )
            .into_response(),
    }
}
async fn file(s: Bridge, path: &str) -> Response {
    let Some(root) = s.frontend else {
        return StatusCode::NOT_FOUND.into_response();
    };
    let root = match root.canonicalize() {
        Ok(r) => r,
        Err(_) => return StatusCode::NOT_FOUND.into_response(),
    };
    let path = root.join(if path.is_empty() { "index.html" } else { path });
    let path = match path.canonicalize() {
        Ok(p) if p.starts_with(&root) => p,
        _ => return StatusCode::NOT_FOUND.into_response(),
    };
    let bytes = match std::fs::read(&path) {
        Ok(b) => b,
        Err(_) => return StatusCode::NOT_FOUND.into_response(),
    };
    let mime = match path.extension().and_then(|s| s.to_str()).unwrap_or("") {
        "html" => "text/html",
        "js" => "text/javascript",
        "css" => "text/css",
        "json" => "application/json",
        "svg" => "image/svg+xml",
        "png" => "image/png",
        "woff2" => "font/woff2",
        "woff" => "font/woff",
        "ttf" => "font/ttf",
        _ => "application/octet-stream",
    };
    (
        [
            (header::CONTENT_TYPE, mime),
            (header::CACHE_CONTROL, "no-store"),
        ],
        bytes,
    )
        .into_response()
}
async fn index(State(s): State<Bridge>) -> Response {
    file(s, "").await
}
async fn asset(State(s): State<Bridge>, Path(path): Path<String>) -> Response {
    file(s, &path).await
}
pub async fn serve(
    engine: Arc<Engine>,
    address: std::net::SocketAddr,
    token: String,
    frontend: Option<PathBuf>,
) -> Result<(), String> {
    if !address.ip().is_loopback() {
        return Err("Loopback only".into());
    }
    let state = Bridge {
        engine,
        token,
        frontend,
    };
    let router = Router::new()
        .route("/api/invoke", post(invoke))
        .route("/", get(index))
        .route("/{*path}", get(asset))
        .layer(DefaultBodyLimit::max(4 * 1024 * 1024))
        .with_state(state);
    let listener = tokio::net::TcpListener::bind(address)
        .await
        .map_err(|e| e.to_string())?;
    eprintln!(
        "Chronoscope local development bridge: http://{}",
        listener.local_addr().map_err(|e| e.to_string())?
    );
    axum::serve(listener, router)
        .await
        .map_err(|e| e.to_string())
}
