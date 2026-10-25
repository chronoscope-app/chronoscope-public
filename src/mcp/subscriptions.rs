//! Per-stdio-session, coalesced notifications. No workspace observer replacement.
use serde_json::{json, Value};
use std::{
    collections::BTreeSet,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    time::Duration,
};
pub const URIS: &[&str] = &[
    "chronoscope://workspace",
    "chronoscope://schema",
    "chronoscope://view",
    "chronoscope://results",
    "chronoscope://jobs",
];
#[derive(Default)]
pub struct Subscriptions {
    uris: Mutex<BTreeSet<String>>,
    stopped: AtomicBool,
}
impl Subscriptions {
    pub fn handle(&self, request: &Value) -> Option<Value> {
        let method = request["method"].as_str()?;
        if !matches!(method, "resources/subscribe" | "resources/unsubscribe") {
            return None;
        }
        let uri = request["params"]["uri"].as_str().unwrap_or("");
        let result = if !URIS.contains(&uri)
            || request["params"]
                .as_object()
                .is_none_or(|p| p.keys().any(|k| k != "uri"))
        {
            json!({"error":{"code":-32602,"message":"Unknown subscribable resource or invalid arguments"}})
        } else {
            let mut uris = self.uris.lock().unwrap_or_else(|e| e.into_inner());
            if method == "resources/subscribe" {
                uris.insert(uri.into());
            } else {
                uris.remove(uri);
            }
            json!({"result":{}})
        };
        let mut reply = result;
        reply["jsonrpc"] = json!("2.0");
        reply["id"] = request["id"].clone();
        Some(reply)
    }
    pub fn start(
        self: &Arc<Self>,
        poll: impl Fn() -> Result<Value, String> + Send + 'static,
        emit: impl Fn(Value) -> Result<(), String> + Send + 'static,
    ) {
        let this = Arc::downgrade(self);
        std::thread::spawn(move || {
            let mut last = None;
            loop {
                std::thread::sleep(Duration::from_millis(500));
                let Some(this) = this.upgrade() else {
                    break;
                };
                if this.stopped.load(Ordering::Acquire) {
                    break;
                }
                let active = this.uris.lock().map(|u| !u.is_empty()).unwrap_or(false);
                if !active {
                    last = None;
                    continue;
                }
                if let Ok(current) = poll() {
                    let changed = last.as_ref().is_none_or(|old| old != &current);
                    last = Some(current);
                    if changed && !this.stopped.load(Ordering::Acquire) {
                        let uris = this.uris.lock().map(|u| u.clone()).unwrap_or_default();
                        for uri in uris {
                            if emit(json!({"jsonrpc":"2.0","method":"notifications/resources/updated","params":{"uri":uri}})).is_err() { return; }
                        }
                    }
                }
            }
        });
    }
    pub fn stop(&self) {
        self.stopped.store(true, Ordering::Release);
    }
}
