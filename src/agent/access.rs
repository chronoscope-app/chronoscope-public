//! Same-user, persisted desktop access control. No listening control service.
use super::{ConnectionInfo, RunningAgent};
use crate::engine::Engine;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    io::Write,
    path::{Path, PathBuf},
    sync::Arc,
    time::Duration,
};
#[derive(Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct Settings {
    pub enabled: bool,
    pub root: Option<PathBuf>,
}
pub fn read_settings(data: &Path) -> Result<Settings, String> {
    let path = data.join("agent-access.json");
    match std::fs::read(&path) {
        Ok(bytes) if bytes.len() <= 16384 => serde_json::from_slice(&bytes)
            .map_err(|e| format!("Invalid agent access settings: {e}")),
        Ok(_) => Err("Agent access settings exceed 16 KiB".into()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(Settings::default()),
        Err(e) => Err(e.to_string()),
    }
}
pub fn write_settings(
    data: &Path,
    enabled: bool,
    root: Option<PathBuf>,
) -> Result<Settings, String> {
    let root = root
        .map(|r| r.canonicalize().map_err(|e| e.to_string()))
        .transpose()?;
    if root.as_ref().is_some_and(|r| !r.is_dir()) {
        return Err("Agent root must be a directory".into());
    }
    std::fs::create_dir_all(data).map_err(|e| e.to_string())?;
    let settings = Settings { enabled, root };
    let mut file = tempfile::NamedTempFile::new_in(data).map_err(|e| e.to_string())?;
    serde_json::to_writer(&mut file, &settings).map_err(|e| e.to_string())?;
    file.flush().map_err(|e| e.to_string())?;
    file.as_file().sync_all().map_err(|e| e.to_string())?;
    file.persist(data.join("agent-access.json"))
        .map_err(|e| e.to_string())?;
    Ok(settings)
}
pub fn reconcile(
    engine: &Arc<Engine>,
    current: &mut Option<RunningAgent>,
    settings: &Settings,
) -> Result<(), String> {
    if !settings.enabled {
        *current = None;
        return Ok(());
    }
    let root = if let Some(root) = &settings.root {
        root.clone()
    } else {
        let root = engine.data_dir.join("agent-files");
        std::fs::create_dir_all(&root).map_err(|e| e.to_string())?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            if current.is_none() {
                std::fs::set_permissions(&root, std::fs::Permissions::from_mode(0o700))
                    .map_err(|e| e.to_string())?;
            }
        }
        root
    }
    .canonicalize()
    .map_err(|e| e.to_string())?;
    if current
        .as_ref()
        .is_some_and(|a| a.info.root == root && a.descriptor.is_file())
    {
        return Ok(());
    }
    *current = None;
    *current = Some(super::start(engine.clone(), &root)?);
    Ok(())
}
fn quote(value: &Path) -> String {
    let path = value.to_string_lossy();
    #[cfg(windows)]
    let quoted = format!("'{}'", path.replace('\'', "''"));
    #[cfg(not(windows))]
    let quoted = format!("'{}'", path.replace('\'', "'\\''"));
    quoted
}
pub fn codex_command(executable: &Path) -> String {
    codex_command_for_data(executable, None)
}
pub fn codex_command_for_data(executable: &Path, data: Option<&Path>) -> String {
    let scope = data
        .map(|d| format!(" --data-dir {}", quote(d)))
        .unwrap_or_default();
    format!(
        "codex mcp add {} -- {}{scope} mcp --attach",
        crate::platform::MCP_SERVER_NAME,
        quote(executable)
    )
}
pub fn config(executable: &Path) -> Value {
    config_for_data(executable, None)
}
pub fn config_for_data(executable: &Path, data: Option<&Path>) -> Value {
    let args = if let Some(data) = data {
        json!(["--data-dir", data, "mcp", "--attach"])
    } else {
        json!(["mcp", "--attach"])
    };
    json!({"mcpServers":{(crate::platform::MCP_SERVER_NAME):{"command":executable,"args":args}}})
}
pub fn live_status(current: Option<&RunningAgent>, executable: &Path, data: &Path) -> Value {
    let mut value=current.map(|a|json!({"enabled":true,"connected":true,"root":a.info.root,"descriptor":a.descriptor})).unwrap_or(json!({"enabled":false,"connected":false}));
    value["cli"] = json!(executable);
    value["codex_command"] = json!(codex_command_for_data(executable, Some(data)));
    value["config"] = config_for_data(executable, Some(data));
    value
}
fn probe(info: &ConnectionInfo) -> bool {
    reqwest::blocking::Client::builder()
        .no_proxy()
        .timeout(Duration::from_secs(1))
        .build()
        .ok()
        .and_then(|c| {
            c.post(&info.url)
                .bearer_auth(&info.token)
                .header("x-chronoscope-session", &info.session)
                .json(&json!({"jsonrpc":"2.0","id":"probe","method":"ping"}))
                .send()
                .ok()
        })
        .is_some_and(|r| {
            r.status().is_success() || r.status() == reqwest::StatusCode::TOO_MANY_REQUESTS
        })
}
pub fn status(data: &Path, executable: &Path) -> Result<Value, String> {
    let settings = read_settings(data)?;
    let descriptor = data.join("agent-connection.json");
    let connection = super::read_connection(&descriptor).ok().filter(probe);
    let expected_root = settings
        .root
        .clone()
        .unwrap_or_else(|| data.join("agent-files"))
        .canonicalize()
        .ok();
    let ready = connection
        .as_ref()
        .is_some_and(|c| Some(&c.root) == expected_root.as_ref());
    Ok(
        json!({"enabled":settings.enabled,"connected":connection.is_some(),"pending":if settings.enabled {!ready} else {connection.is_some()},"root":connection.as_ref().map(|c|&c.root).or(settings.root.as_ref()),"exchange_folder":data.join("agent-files"),"descriptor":descriptor,"cli":executable,"codex_command":codex_command_for_data(executable,Some(data)),"config":config_for_data(executable,Some(data)),"next_step":if connection.is_some(){"Use mcp --attach or --attach call snapshot"}else if settings.enabled{"Open Chronoscope; access will start automatically"}else{"Run agent enable, then open Chronoscope"}}),
    )
}

/// Used by the desktop and its control-loop regression. Invalid settings fail closed.
pub fn refresh(engine: &Arc<Engine>, current: &mut Option<RunningAgent>) -> Result<(), String> {
    let result =
        read_settings(&engine.data_dir).and_then(|settings| reconcile(engine, current, &settings));
    if result.is_err() {
        *current = None;
    }
    result
}
