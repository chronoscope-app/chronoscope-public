//! Bounded live-WebView requests. Never hold the workspace gate while awaiting IPC.
use super::*;
impl Engine {
    pub(super) fn desktop_request(&self, command: &str, args: Value) -> Result<Value, String> {
        let mut args = args;
        if command == "assist_ui" {
            if args["action"] == "open-explain" {
                crate::schema::validate(
                    "assist_explain",
                    &json!({"provider":"apple-local","source":if args["source"].get("result_id").is_some(){json!({"kind":"analysis","result_id":args["source"]["result_id"]})}else{json!({"kind":"pattern","scan_id":args["source"]["scan_id"],"finding_id":args["source"]["finding_id"]})}}),
                )?;
            }
            if args["action"] == "generate" && args.get("provider").is_none() {
                return Err(
                    "INVALID_ARGUMENT: choose an explicit provider before AI generation".into(),
                );
            }
        }
        if command == "view_capture" {
            if args.get("target").is_none() {
                args["target"] = json!("app");
            }
            if args.get("window").is_none() {
                args["window"] = json!("main");
            }
            if args["target"] == "map" && args["window"] != "main" {
                return Err("INVALID_ARGUMENT: map capture requires window:main".into());
            }
        }
        if command == "view_recording" {
            let path = std::path::PathBuf::from(args["path"].as_str().unwrap());
            if path
                .extension()
                .and_then(|e| e.to_str())
                .is_none_or(|e| !e.eq_ignore_ascii_case("mp4"))
            {
                return Err("INVALID_ARGUMENT: video output requires .mp4".into());
            }
            let parent = path
                .parent()
                .filter(|p| !p.as_os_str().is_empty())
                .unwrap_or(std::path::Path::new("."));
            let path = parent
                .canonicalize()
                .map_err(|e| format!("INVALID_ARGUMENT: video output directory unavailable ({e})"))?
                .join(path.file_name().ok_or("Invalid video filename")?);
            if args["action"] == "start" {
                if path.symlink_metadata().is_ok() {
                    return Err("CONFLICT: video output exists; choose a new path".into());
                }
                if args.get("window").is_none() {
                    args["window"] = json!("main");
                }
                if args.get("fps").is_none() {
                    args["fps"] = json!(60);
                }
                if args.get("max_seconds").is_none() {
                    args["max_seconds"] = json!(30);
                }
            }
            args["path"] = json!(path);
        }
        if command == "view_navigate" {
            let action = args["action"].as_str().unwrap();
            let allowed: &[&str] = match action {
                "fit" => &["action", "whole_globe"],
                "fit_layer" => &["action", "layer_id"],
                "look_at" => &[
                    "action",
                    "center",
                    "distance_m",
                    "heading_degrees",
                    "tilt_degrees",
                ],
                "zoom" => &["action", "factor"],
                "north_up" => &["action"],
                _ => unreachable!(),
            };
            if args
                .as_object()
                .unwrap()
                .keys()
                .any(|key| !allowed.contains(&key.as_str()))
            {
                return Err("Invalid navigation fields for this action".into());
            }
            let required: &[&str] = match action {
                "fit_layer" => &["layer_id"],
                "look_at" => &["center", "distance_m"],
                "zoom" => &["factor"],
                _ => &[],
            };
            if required.iter().any(|key| args.get(*key).is_none()) {
                return Err("Missing required navigation arguments".into());
            }
            if action == "fit_layer" {
                self.gis_layer(args["layer_id"].as_str().unwrap())?;
            }
        }
        if self
            .observer
            .lock()
            .map_err(|_| "Desktop unavailable")?
            .is_none()
        {
            return Err(
                "UNAVAILABLE: connect to a running desktop for live view operations".into(),
            );
        }
        let mut random = [0u8; 16];
        getrandom::fill(&mut random).map_err(|e| e.to_string())?;
        let id: String = random.iter().map(|b| format!("{b:02x}")).collect();
        let (sender, receiver) = std::sync::mpsc::sync_channel(1);
        {
            let mut pending = self.captures.lock().map_err(|_| "Desktop unavailable")?;
            if pending.len() >= 8 {
                return Err("RESOURCE_LIMIT: eight desktop requests are already pending".into());
            }
            pending.insert(
                id.clone(),
                DesktopReply {
                    command: command.into(),
                    arguments: args.clone(),
                    sender,
                },
            );
        }
        self.notify(json!({"kind":if command == "view_capture" {"capture"} else {command},"request_id":id,"arguments":args,"expires_at_ms":std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_millis()+15000}));
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(15);
        let result = loop {
            if let Err(error) = crate::operation::check() {
                break Err(error);
            }
            match receiver.recv_timeout(std::time::Duration::from_millis(50)) {
                Ok(reply) => break reply,
                Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => break Err("UNAVAILABLE: desktop disconnected".into()),
                Err(_) if std::time::Instant::now() >= deadline => break Err("UNAVAILABLE: desktop request timed out; navigation may have applied, inspect view_status before retrying".into()),
                Err(_) => {}
            }
        };
        self.captures
            .lock()
            .map_err(|_| "Desktop unavailable")?
            .remove(&id);
        result
    }
    pub(super) fn desktop_response(&self, args: Value) -> Result<Value, String> {
        let pending = self
            .captures
            .lock()
            .map_err(|_| "Desktop unavailable")?
            .remove(args["request_id"].as_str().unwrap())
            .ok_or("Desktop request expired")?;
        let result = (|| {
            if let Some(error) = args["error"].as_str() {
                return Err(error.strip_prefix("Error: ").unwrap_or(error).to_owned());
            }
            if pending.command == "view_capture" {
                let data = args["data_url"].as_str().ok_or("Missing data_url")?;
                if !data.starts_with("data:image/png;base64,") {
                    return Err("Invalid capture image format".into());
                }
                return Ok(
                    json!({"data_url":data,"mime_type":"image/png","target":pending.arguments["target"],"window":pending.arguments["window"]}),
                );
            }
            let result = args.get("result").ok_or("Missing live view result")?;
            if result.to_string().len() > 512 * 1024 {
                return Err("RESOURCE_LIMIT: live view response exceeds 512 KiB".into());
            }
            if pending.command == "view_recording" {
                crate::schema::validate_output("view_recording", result)?;
                if result["path"] != pending.arguments["path"] {
                    return Err("Invalid recording output path".into());
                }
                let mut result = result.clone();
                result["uri"] = json!(reqwest::Url::from_file_path(
                    pending.arguments["path"].as_str().unwrap()
                )
                .map_err(|_| "Invalid recording file URI")?
                .to_string());
                return Ok(result);
            }
            if matches!(
                pending.command.as_str(),
                "view_profile" | "view_wait" | "view_playback" | "view_scenario"
            ) {
                crate::schema::validate_output(&pending.command, result)?;
                return Ok(result.clone());
            }
            crate::schema::validate_output(
                if pending.command == "assist_ui" {
                    "assist_ui"
                } else if pending.command == "view_reset" {
                    "view_reset"
                } else {
                    "view_status"
                },
                result,
            )?;
            Ok(result.clone())
        })();
        let _ = pending.sender.try_send(result.clone());
        result.map(|_| json!({"ok":true}))
    }
}
