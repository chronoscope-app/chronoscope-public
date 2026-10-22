//! Bounded HTTP adapter for the official MCP SDK. Negotiation, schemas,
//! sessions and cancellation remain SDK responsibilities.
use futures_util::{stream::BoxStream, StreamExt};
use rmcp::{
    model::{ClientJsonRpcMessage, ServerJsonRpcMessage},
    transport::streamable_http_client::{
        StreamableHttpClient, StreamableHttpError, StreamableHttpPostResponse,
    },
};
use sse_stream::{Sse, SseStream};
use std::{collections::HashMap, sync::Arc};
type Failure = StreamableHttpError<mcp_http::Error>;
#[derive(Clone)]
pub struct BoundedHttp(pub mcp_http::Client);
const LIMIT: usize = 2 * 1024 * 1024;
impl StreamableHttpClient for BoundedHttp {
    type Error = mcp_http::Error;
    async fn post_message(
        &self,
        uri: Arc<str>,
        message: ClientJsonRpcMessage,
        session: Option<Arc<str>>,
        token: Option<String>,
        headers: HashMap<mcp_http::header::HeaderName, mcp_http::header::HeaderValue>,
    ) -> Result<StreamableHttpPostResponse, Failure> {
        let original = serde_json::to_value(&message)?;
        let mut request = self
            .0
            .post(uri.as_ref())
            .timeout(std::time::Duration::from_secs(60))
            .header("Accept", "application/json, text/event-stream");
        if let Some(token) = token {
            request = request.bearer_auth(token);
        }
        if let Some(session) = session.as_ref() {
            request = request.header("Mcp-Session-Id", session.as_ref());
        }
        for (name, value) in headers {
            request = request.header(name, value);
        }
        let mut response = request
            .json(&message)
            .send()
            .await
            .map_err(Failure::Client)?;
        let status = response.status();
        if matches!(status.as_u16(), 401 | 403) {
            return Err(Failure::UnexpectedServerResponse(
                "AUTH_REQUIRED: service rejected authentication; OAuth login is not configured"
                    .into(),
            ));
        }
        if status.as_u16() == 404 && session.is_some() {
            return Err(Failure::SessionExpired);
        }
        if matches!(status.as_u16(), 202 | 204) {
            return Ok(StreamableHttpPostResponse::Accepted);
        }
        let content_type = response
            .headers()
            .get("Content-Type")
            .and_then(|h| h.to_str().ok())
            .unwrap_or("")
            .to_string();
        let next_session = response
            .headers()
            .get("Mcp-Session-Id")
            .and_then(|h| h.to_str().ok())
            .map(str::to_owned);
        if status.is_success() && content_type.starts_with("text/event-stream") {
            // A tool response, including its progress events, has a finite byte budget.
            let stream = response.bytes_stream().scan(0usize, |size, chunk| {
                let result = chunk.map_err(std::io::Error::other).and_then(|bytes| {
                    *size += bytes.len();
                    if *size > LIMIT {
                        Err(std::io::Error::other("MCP response exceeds 2 MiB"))
                    } else {
                        Ok(bytes)
                    }
                });
                std::future::ready(Some(result))
            });
            return Ok(StreamableHttpPostResponse::Sse(
                SseStream::from_bytes_stream(stream).boxed(),
                next_session,
            ));
        }
        let mut bytes = vec![];
        while let Some(chunk) = response.chunk().await.map_err(Failure::Client)? {
            if bytes.len() + chunk.len() > LIMIT {
                return Err(Failure::Io(std::io::Error::other(
                    "MCP response exceeds 2 MiB",
                )));
            }
            bytes.extend_from_slice(&chunk);
        }
        if status.is_success() && bytes.is_empty() && original.get("id").is_none() {
            return Ok(StreamableHttpPostResponse::Accepted);
        }
        // Preserve SDK compatibility discovery for legacy servers rejecting server/discover.
        if session.is_none() && status.is_client_error() && original["method"] == "server/discover"
        {
            let error = serde_json::from_slice::<serde_json::Value>(&bytes)
                .ok()
                .and_then(|v| v.get("error").cloned())
                .unwrap_or_else(
                    || serde_json::json!({"code":-32600,"message":"Legacy discovery endpoint"}),
                );
            let value = serde_json::json!({"jsonrpc":"2.0","id":original["id"],"error":error});
            return Ok(StreamableHttpPostResponse::Json(
                serde_json::from_value(value)?,
                None,
            ));
        }
        if let Ok(parsed) = serde_json::from_slice::<ServerJsonRpcMessage>(&bytes) {
            if status.is_success() && content_type.starts_with("application/json")
                || matches!(parsed, ServerJsonRpcMessage::Error(_))
            {
                return Ok(StreamableHttpPostResponse::Json(parsed, next_session));
            }
        }
        Err(Failure::UnexpectedServerResponse(
            format!("HTTP {}: invalid MCP JSON response", status.as_u16()).into(),
        ))
    }
    async fn delete_session(
        &self,
        uri: Arc<str>,
        session: Arc<str>,
        token: Option<String>,
        headers: HashMap<mcp_http::header::HeaderName, mcp_http::header::HeaderValue>,
    ) -> Result<(), Failure> {
        self.0.delete_session(uri, session, token, headers).await
    }
    async fn get_stream(
        &self,
        uri: Arc<str>,
        session: Option<Arc<str>>,
        last: Option<String>,
        token: Option<String>,
        headers: HashMap<mcp_http::header::HeaderName, mcp_http::header::HeaderValue>,
    ) -> Result<BoxStream<'static, Result<Sse, sse_stream::Error>>, Failure> {
        self.0
            .get_stream_with_max_sse_event_size(uri, session, last, token, headers, LIMIT)
            .await
    }
}
