//! MCP Apps progressive enhancement of existing exact query/chart tools.
use serde_json::{json, Value};
pub const URI: &str = "ui://chronoscope/explorer";
pub fn resource() -> Value {
    json!({"uri":URI,"mimeType":"text/html;profile=mcp-app","text":include_str!("app.html"),"_meta":{"ui":{"prefersBorder":true,"csp":{"connectDomains":[],"resourceDomains":[],"frameDomains":[]}}}})
}
#[derive(Default)]
pub struct Session {
    enabled: bool,
}
impl Session {
    pub fn initialize(&mut self, request: &Value) {
        if request["method"] == "initialize" {
            self.enabled = request["params"]["capabilities"]["extensions"]
                ["io.modelcontextprotocol/ui"]["mimeTypes"]
                .as_array()
                .is_some_and(|a| a.iter().any(|v| v == "text/html;profile=mcp-app"));
        }
    }
    pub fn decorate(&self, method: &str, mut response: Value) -> Value {
        if self.enabled && method == "tools/list" {
            if let Some(tools) = response["result"]["tools"].as_array_mut() {
                for tool in tools {
                    if matches!(
                        tool["name"].as_str(),
                        Some("chronoscope_query" | "chronoscope_chart_data")
                    ) {
                        tool["_meta"] =
                            json!({"ui":{"resourceUri":URI,"visibility":["model","app"]}});
                    }
                }
            }
        }
        response
    }
}
