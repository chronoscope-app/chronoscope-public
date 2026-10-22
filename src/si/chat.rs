//! UI conversation state belongs to the engine, not to any particular WebView.
use super::*;
use std::collections::{BTreeMap, VecDeque};
#[derive(Default)]
pub(super) struct Chat {
    session: Option<u64>,
    revision: u64,
    draft: String,
    next: u64,
    messages: Vec<Value>,
    active: Option<String>,
    pending: Vec<Value>,
    receipts: BTreeMap<String, (String, String)>,
    images: VecDeque<(String, Value)>,
    image_bytes: usize,
}
impl Chat {
    fn push(&mut self, role: &str, content: &str, extra: Value) {
        self.next += 1;
        let mut end = content.len().min(65536);
        while !content.is_char_boundary(end) {
            end -= 1;
        }
        let mut message = json!({"id":self.next.to_string(),"role":role,"content":if end<content.len(){format!("{}\n[Display excerpt truncated]",&content[..end])}else{content.into()}});
        if let Some(fields) = extra.as_object() {
            for (k, v) in fields {
                message[k] = v.clone();
            }
        }
        self.messages.push(message);
        while self.messages.len() > 64
            || self.messages.len() > 1 && json!(self.messages).to_string().len() > 2 * 1024 * 1024
        {
            self.messages.remove(0);
        }
        self.revision += 1;
    }
    fn sync(&mut self, session: Option<u64>, history: &[Value]) {
        if self.session != session {
            if self.session.is_none() && session.is_some() && history.is_empty() {
                self.session = session;
                self.revision += 1;
                return;
            }
            let revision = self.revision + 1;
            *self = Self {
                session,
                revision,
                ..Self::default()
            };
            for m in history
                .iter()
                .rev()
                .take(64)
                .collect::<Vec<_>>()
                .into_iter()
                .rev()
            {
                self.push(
                    m["role"].as_str().unwrap_or("notice"),
                    m["content"].as_str().unwrap_or(""),
                    json!({}),
                );
            }
        }
    }
}
impl Assistant {
    pub(super) fn chat_clear(&self) -> Result<(), String> {
        let mut chat = self.chat.lock().map_err(|_| "SI chat unavailable")?;
        let revision = chat.revision + 1;
        *chat = Chat {
            revision,
            ..Chat::default()
        };
        Ok(())
    }
    pub(super) fn chat_record_direct(
        &self,
        session: u64,
        prompt: &str,
        answer: &str,
    ) -> Result<(), String> {
        let mut chat = self.chat.lock().map_err(|_| "SI chat unavailable")?;
        chat.sync(Some(session), &[]);
        if chat.active.is_none() {
            chat.push("user", prompt, json!({}));
            chat.push("assistant", answer, json!({}));
        }
        Ok(())
    }
    pub(super) fn chat_invoke(
        &self,
        engine: &Engine,
        command: &str,
        args: Value,
    ) -> Result<Value, String> {
        if command == "present_result" {
            if args["kind"] == "map"
                && ["result_id", "chart", "x", "y"]
                    .iter()
                    .any(|key| args.get(*key).is_some())
            {
                return Err(
                    "INVALID_ARGUMENT: map presentation accepts only kind and title".into(),
                );
            }
            if !matches!(args["chart"].as_str(), Some("bar" | "line" | "scatter"))
                && (args.get("x").is_some() || args.get("y").is_some())
            {
                return Err(
                    "INVALID_ARGUMENT: explicit axes need an explicit bar, line or scatter chart"
                        .into(),
                );
            }
            let block = if args["kind"] == "map" {
                let image = engine.invoke("view_capture", json!({"target":"map"}))?;
                self.chat_image_store(
                    engine,
                    image["data_url"].as_str().ok_or("Missing map image")?,
                    args["title"].as_str().unwrap_or("Map snapshot"),
                )?
            } else {
                let result = engine.invoke(
                    "analytics_result",
                    json!({"result_id":args["result_id"],"section":"rows","limit":200}),
                )?;
                let chart = args["chart"].as_str().unwrap_or("auto");
                if matches!(chart, "bar" | "line" | "scatter") {
                    let (x, y) = (
                        args["x"]
                            .as_str()
                            .ok_or("INVALID_ARGUMENT: chart needs x")?,
                        args["y"]
                            .as_str()
                            .ok_or("INVALID_ARGUMENT: chart needs y")?,
                    );
                    let rows = result["rows"].as_array().unwrap();
                    if !rows.iter().any(|r| {
                        r.get(x).is_some()
                            && r[y].is_number()
                            && (chart != "scatter" || r[x].is_number())
                    }) {
                        return Err("INVALID_ARGUMENT: chart fields are absent or have no suitable numeric values in the preview; inspect result rows".into());
                    }
                }
                json!({"type":"analysis","result_id":args["result_id"],"title":args["title"],"chart":chart,"x":args["x"],"y":args["y"]})
            };
            let deferred = {
                let _connection = self.connection.lock().map_err(|_| "SI unavailable")?;
                crate::operation::check()?;
                let mut chat = self.chat.lock().map_err(|_| "SI chat unavailable")?;
                if chat.active.is_none() {
                    chat.push("notice", "Presentation", json!({"blocks":[block.clone()]}));
                    false
                } else {
                    if chat.pending.len() >= 8 {
                        return Err(
                            "RESOURCE_LIMIT: at most eight inline presentations per request".into(),
                        );
                    }
                    chat.pending.push(block.clone());
                    true
                }
            };
            return Ok(
                json!({"presented":true,"presentation":block,"deferred_until_reply":deferred,"revision":engine.invoke("revision",json!({}))?["revision"],"instruction":"The app displays this structured result inline with the reply. Image bytes stay outside model context; do not claim to visually inspect them."}),
            );
        }
        if command == "si_chat_attach" {
            let block = self.chat_image_store(
                engine,
                args["data_url"].as_str().unwrap(),
                args["title"].as_str().unwrap_or("Map snapshot"),
            )?;
            self.chat.lock().map_err(|_| "SI chat unavailable")?.push(
                "notice",
                "Map snapshot",
                json!({"blocks":[block]}),
            );
            return Ok(json!({"attached":true}));
        }
        // Linearize session checks and updates with connection/clear changes.
        // Lock order is connection -> chat; job workers never invert it.
        let connection = self.connection.lock().map_err(|_| "SI unavailable")?;
        let session = connection.as_ref().map(|c| c.session);
        let history = connection
            .as_ref()
            .map(|c| c.history.clone())
            .unwrap_or_default();
        let mut chat = self.chat.lock().map_err(|_| "SI chat unavailable")?;
        chat.sync(session, &history);
        match command {
            "si_chat_draft" => {
                if args.get("session_id").is_some()
                    && args["session_id"] != json!(session.map(|s| s.to_string()))
                {
                    return Err("CONFLICT: conversation changed; old draft was not saved into the new session".into());
                }
                chat.draft = args["text"].as_str().unwrap().to_string();
                Ok(json!({"saved":true}))
            }
            "si_chat_image" => chat
                .images
                .iter()
                .find(|(id, _)| Some(id.as_str()) == args["image_id"].as_str())
                .map(|(_, v)| v.clone())
                .ok_or("NOT_FOUND: snapshot expired or conversation was cleared".into()),
            "si_chat_state" => {
                let active = chat
                    .active
                    .as_ref()
                    .map(|id| engine.invoke("job_status", json!({"job_id":id})))
                    .transpose()?;
                Ok(
                    json!({"revision":chat.revision,"session_id":session.map(|s|s.to_string()),"messages":if args["since_revision"].as_u64()==Some(chat.revision){Value::Null}else{json!(chat.messages)},"active":active,"draft":chat.draft,"limit_messages":64,"limit_bytes":2097152}),
                )
            }
            "si_chat_send" => {
                let session = session.ok_or("Connect an SI service first")?;
                let request = args["request_id"].as_str().unwrap();
                let fingerprint = crate::analytics::hash(
                    &json!({"prompt":args["prompt"],"allow_edits":args["allow_edits"].as_bool().unwrap_or(false),"allow_external_actions":args["allow_external_actions"].as_bool().unwrap_or(false)}),
                )?;
                if let Some((old, job)) = chat.receipts.get(request) {
                    if old != &fingerprint {
                        return Err(
                            "CONFLICT: request_id was already used for a different message".into(),
                        );
                    }
                    return Ok(json!({"job_id":job,"replayed":true}));
                }
                if chat.active.is_some() {
                    return Err("CONFLICT: an SI chat request is already active".into());
                }
                let job=engine.invoke("job_start",json!({"command":"si_run","arguments":{"prompt":args["prompt"],"allow_edits":args["allow_edits"].as_bool().unwrap_or(false),"allow_external_actions":args["allow_external_actions"].as_bool().unwrap_or(false),"expected_session":session}}))?;
                let id = job["job_id"].as_str().unwrap().to_string();
                chat.active = Some(id.clone());
                chat.draft.clear();
                chat.push("user", args["prompt"].as_str().unwrap(), json!({}));
                while chat.receipts.len() >= 64 {
                    let first = chat.receipts.keys().next().cloned().unwrap();
                    chat.receipts.remove(&first);
                }
                chat.receipts
                    .insert(request.into(), (fingerprint, id.clone()));
                Ok(json!({"job_id":id,"replayed":false}))
            }
            _ => Err("Unknown SI chat command".into()),
        }
    }
    /// Called by the worker even if every chat window is closed. UI-owned jobs
    /// are released by the job registry after their durable-in-session handoff.
    pub(crate) fn chat_finished(&self, id: &str, result: &Result<Value, String>) -> bool {
        let Ok(mut chat) = self.chat.lock() else {
            return false;
        };
        if chat.active.as_deref() != Some(id) {
            return false;
        }
        chat.active = None;
        let pending = std::mem::take(&mut chat.pending);
        match result {
            Ok(r) => {
                let mut blocks = pending;
                let mut seen: std::collections::BTreeSet<String> = blocks
                    .iter()
                    .filter_map(|b| b["result_id"].as_str().map(str::to_owned))
                    .collect();
                if let Some(calls) = r["tool_calls"].as_array() {
                    for call in calls {
                        if call["ok"] != true {
                            continue;
                        }
                        if let Some(block) = call.get("presentation") {
                            if !blocks.contains(block) {
                                blocks.push(block.clone());
                            }
                            if let Some(id) = block["result_id"].as_str() {
                                seen.insert(id.to_string());
                            }
                        }
                    }
                    for call in calls {
                        if call["ok"] == true {
                            if let Some(id) = call["result_id"].as_str() {
                                if seen.insert(id.into()) {
                                    blocks.push(
                                        json!({"type":"analysis","result_id":id,"chart":"auto"}),
                                    );
                                }
                            }
                        }
                    }
                }
                blocks.truncate(8);
                chat.push("assistant",r["answer"].as_str().unwrap_or("Request finished"),json!({"blocks":blocks,"tool_calls":r["tool_calls"],"proposal":r["proposal"],"completed":r["completed"],"context":r["context"]}));
            }
            Err(e) => chat.push(
                "notice",
                &format!("{e}. Completed actions remain; inspect the workspace before retrying."),
                json!({"blocks":pending}),
            ),
        }
        true
    }
    fn chat_image_store(&self, engine: &Engine, data: &str, title: &str) -> Result<Value, String> {
        use base64::Engine as _;
        let encoded = data
            .strip_prefix("data:image/png;base64,")
            .ok_or("INVALID_ARGUMENT: snapshots must be PNG images")?;
        if encoded.len() > 8 * 1024 * 1024 {
            return Err("RESOURCE_LIMIT: snapshot exceeds 8 MiB encoded budget".into());
        }
        let bytes = base64::engine::general_purpose::STANDARD
            .decode(encoded)
            .map_err(|_| "INVALID_ARGUMENT: invalid snapshot encoding")?;
        let reader =
            image::ImageReader::with_format(std::io::Cursor::new(&bytes), image::ImageFormat::Png);
        let (width, height) = reader
            .into_dimensions()
            .map_err(|_| "INVALID_ARGUMENT: invalid PNG snapshot")?;
        if width == 0
            || height == 0
            || width > 8192
            || height > 8192
            || width as u64 * height as u64 > 32_000_000
        {
            return Err("RESOURCE_LIMIT: snapshot dimensions exceed display budget".into());
        }
        let mut reader =
            image::ImageReader::with_format(std::io::Cursor::new(&bytes), image::ImageFormat::Png);
        let mut limits = image::Limits::default();
        limits.max_image_width = Some(8192);
        limits.max_image_height = Some(8192);
        limits.max_alloc = Some(128 * 1024 * 1024);
        reader.limits(limits);
        let decoded = reader.decode().map_err(|_| {
            "INVALID_ARGUMENT: snapshot could not be decoded within its image budget"
        })?;
        let thumbnail = decoded.thumbnail(1600, 1200);
        let (width, height) = (thumbnail.width(), thumbnail.height());
        let mut encoded_png = std::io::Cursor::new(Vec::new());
        thumbnail
            .write_to(&mut encoded_png, image::ImageFormat::Png)
            .map_err(|_| "Cannot encode map preview")?;
        let data = format!(
            "data:image/png;base64,{}",
            base64::engine::general_purpose::STANDARD.encode(encoded_png.into_inner())
        );
        let snapshot = engine.invoke(
            "snapshot",
            json!({"compact":true,"include_statistics":false,"selection_limit":0}),
        )?;
        let id = crate::analytics::hash(
            &json!({"data":data,"title":title,"revision":snapshot["revision"]}),
        )?;
        let block = json!({"type":"image","image_id":id,"title":title,"width":width,"height":height,"captured_utc":chrono::Utc::now().to_rfc3339(),"project_name":snapshot["name"],"source_revision":snapshot["revision"]});
        let connection = self.connection.lock().map_err(|_| "SI unavailable")?;
        crate::operation::check()?;
        let session = connection.as_ref().map(|c| c.session);
        let history = connection
            .as_ref()
            .map(|c| c.history.clone())
            .unwrap_or_default();
        let mut chat = self.chat.lock().map_err(|_| "SI chat unavailable")?;
        chat.sync(session, &history);
        if !chat.images.iter().any(|(key, _)| key == &id) {
            while !chat.images.is_empty()
                && (chat.images.len() >= 12 || chat.image_bytes + data.len() > 32 * 1024 * 1024)
            {
                let (_, v) = chat.images.pop_front().unwrap();
                chat.image_bytes -= v["data_url"].as_str().unwrap().len();
            }
            chat.image_bytes += data.len();
            chat.images
                .push_back((id, json!({"data_url":data,"metadata":block})));
        }
        Ok(block)
    }
}

/// Small read-only previews of existing tools. Full numerical work stays in the
/// engine; no service-provided table values or chart options are accepted here.
pub(super) fn tool_preview(name: &str, value: &Value) -> Option<Value> {
    let name = name.trim_start_matches("chronoscope_");
    let mut field_summary =
        json!({"Matching records":value["input_count"],"Scope":value["scope"]["mode"]});
    if name == "field_profile" {
        for p in value["profiles"].as_array().into_iter().flatten() {
            for (label, key) in [
                ("Distinct values", "distinct_count"),
                ("Non-empty records", "non_empty_count"),
                ("Null records", "null_count"),
                ("Empty strings", "empty_string_count"),
                ("Empty collections", "empty_collection_count"),
            ] {
                field_summary[format!("{} · {label}", p["field"].as_str().unwrap_or("field"))] =
                    p[key].clone();
            }
        }
        // Retain machine-readable profiles for audits and test assertions too.
        field_summary["profiles"] = value["profiles"].clone();
        field_summary["input_count"] = value["input_count"].clone();
        field_summary["scope"] = value["scope"].clone();
    }
    let field_rows = (name == "field_profile").then(|| {
        json!(value["profiles"]
            .as_array()
            .into_iter()
            .flatten()
            .flat_map(|profile| {
                profile["examples"]
                    .as_array()
                    .into_iter()
                    .flatten()
                    .map(move |example| {
                        let mut row = example.clone();
                        row["field"] = profile["field"].clone();
                        row
                    })
            })
            .collect::<Vec<_>>())
    });
    let rows = match name {
        "field_profile" => field_rows.as_ref(),
        "query" | "events" | "attribute_table" => value.get("events"),
        "analyze" => value.get("findings").or_else(|| value.get("results")),
        "analysis_execute" => value.get("findings"),
        "aggregate" => value.get("groups"),
        _ => None,
    };
    if name != "statistics" && rows.is_none() {
        return None;
    }
    let mut preview: Vec<_> = rows
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .take(20)
        .cloned()
        .collect();
    if json!(preview).to_string().len() > 16384 {
        preview.clear();
    }
    let block = json!({"type":"evidence","title":name.replace('_'," "),"rows":preview,"summary":if name=="statistics"{value["summary"].clone()}else if name=="field_profile"{field_summary}else{json!({"count":value["count"],"input_count":value["input_count"],"evaluated_count":value["evaluated_count"],"limited":value["limited"]})},"note":"Read-only preview, at most 20 rows; original tool scope and limits apply."});
    (block.to_string().len() <= 20000).then_some(block)
}
