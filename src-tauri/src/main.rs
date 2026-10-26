#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
#![forbid(unsafe_code)]
mod icon_appearance;
mod si_window;
mod table_window;
mod window_capture;
use chronoscope::engine::Engine;
use serde_json::Value;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Mutex,
};
use tauri::Manager;
use tauri::{Emitter, State};
#[tauri::command]
async fn dispatch(
    engine: State<'_, Arc<Engine>>,
    command: String,
    args: Value,
) -> Result<Value, chronoscope::error::EngineError> {
    let engine = engine.inner().clone();
    let command = chronoscope::command::Command::parse(&command).ok_or_else(|| {
        chronoscope::error::EngineError::from("INVALID_ARGUMENT: unknown command".to_string())
    })?;
    tauri::async_runtime::spawn_blocking(move || engine.invoke_typed(command, args))
        .await
        .map_err(|e| {
            chronoscope::error::EngineError::from(format!("OPERATION_FAILED: worker failed ({e})"))
        })?
}
#[tauri::command]
fn desktop_close(app: tauri::AppHandle, engine: State<'_, Arc<Engine>>) -> Result<(), String> {
    engine.invoke("autosave_unsaved", serde_json::json!({}))?;
    engine.invoke("recovery_clear", serde_json::json!({}))?;
    app.exit(0);
    Ok(())
}
struct AgentState {
    running: Arc<Mutex<Option<chronoscope::agent::RunningAgent>>>,
    stop: Arc<AtomicBool>,
}
#[tauri::command]
fn agent_access(
    engine: State<'_, Arc<Engine>>,
    state: State<'_, AgentState>,
    root: Option<String>,
    enabled: bool,
) -> Result<Value, String> {
    let settings = chronoscope::agent::access::write_settings(
        &engine.data_dir,
        enabled,
        root.map(Into::into),
    )?;
    let mut current = state
        .running
        .lock()
        .map_err(|_| "Agent state unavailable")?;
    chronoscope::agent::access::reconcile(engine.inner(), &mut current, &settings)?;
    Ok(chronoscope::agent::access::live_status(
        current.as_ref(),
        &std::env::current_exe().map_err(|e| e.to_string())?,
        &engine.data_dir,
    ))
}
#[tauri::command]
fn agent_status(
    engine: State<'_, Arc<Engine>>,
    state: State<'_, AgentState>,
) -> Result<Value, String> {
    let current = state
        .running
        .lock()
        .map_err(|_| "Agent state unavailable")?;
    Ok(chronoscope::agent::access::live_status(
        current.as_ref(),
        &std::env::current_exe().map_err(|e| e.to_string())?,
        &engine.data_dir,
    ))
}

fn main() {
    let context = tauri::generate_context!();
    if let Ok(directory) =
        tauri::utils::platform::resource_dir(context.package_info(), &tauri::utils::Env::default())
    {
        chronoscope::balanced_terrain::set_resource_path(
            directory.join("terrain/balanced.cterrain"),
        );
    }
    // The bundled executable is also the CLI/MCP launcher. Finder's legacy
    // process-serial argument is not a CLI request.
    if std::env::args().skip(1).any(|a| !a.starts_with("-psn_")) {
        chronoscope::cli::main();
        return;
    }
    let running = Arc::new(Mutex::new(None));
    let stop = Arc::new(AtomicBool::new(false));
    let engine = Arc::new(
        Engine::new(
            chronoscope::project::Project::empty(),
            chronoscope::platform::prepare_default_profile()
                .expect("Chronoscope profile migration failed"),
        )
        .expect("User data directory must be writable"),
    );
    let poll_engine = engine.clone();
    let icon_theme = engine
        .invoke("preferences", serde_json::json!({}))
        .ok()
        .and_then(|p| match p["theme"].as_str() {
            Some("dark") => Some(tauri::Theme::Dark),
            Some("light") => Some(tauri::Theme::Light),
            _ => None,
        });
    let poll_running = running.clone();
    let poll_stop = stop.clone();
    std::thread::spawn(move || {
        while !poll_stop.load(Ordering::Relaxed) {
            if let Ok(mut current) = poll_running.lock() {
                if !poll_stop.load(Ordering::Relaxed) {
                    let _ = chronoscope::agent::access::refresh(&poll_engine, &mut current);
                }
            }
            std::thread::sleep(std::time::Duration::from_millis(400));
        }
    });
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .manage(engine.clone())
        .manage(icon_appearance::IconAppearance::new(icon_theme))
        .manage(AgentState { running, stop })
        .invoke_handler(tauri::generate_handler![
            dispatch,
            agent_access,
            agent_status,
            desktop_close,
            si_window::si_window,
            table_window::table_window,
            si_window::si_open_link,
            window_capture::capture_app_window,
            window_capture::record_app_window,
            icon_appearance::desktop_icon_theme
        ])
        .on_window_event(|window, event| {
            if window.label() == "attribute-tables" {
                if matches!(event, tauri::WindowEvent::Destroyed) {
                    let _ = window
                        .app_handle()
                        .emit_to("main", "table-window-docked", ());
                }
                return;
            }
            if window.label() == "si-chat" {
                if matches!(event, tauri::WindowEvent::Destroyed) {
                    let _ = window.app_handle().emit_to("main", "si-window-docked", ());
                }
                return;
            }
            if window.label() != "main" {
                return;
            }
            if let tauri::WindowEvent::ThemeChanged(theme) = event {
                icon_appearance::sync(window.app_handle(), *theme);
            }
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                if window.state::<Arc<Engine>>().workspace_dirty() {
                    api.prevent_close();
                    let _ = window.emit("workspace-close-request", ());
                } else if window.app_handle().get_webview_window("si-chat").is_some()
                    || window
                        .app_handle()
                        .get_webview_window("attribute-tables")
                        .is_some()
                {
                    // A detached chat is not a second workspace. Keep main alive
                    // until the app-level exit check accepts closing both windows.
                    api.prevent_close();
                    window.app_handle().exit(0);
                }
            }
            if matches!(event, tauri::WindowEvent::Destroyed) {
                window.state::<Arc<Engine>>().clear_observer();
                window
                    .state::<AgentState>()
                    .stop
                    .store(true, Ordering::Relaxed);
                if let Ok(mut agent) = window.state::<AgentState>().running.lock() {
                    *agent = None;
                }
            }
        })
        .on_menu_event(|app, event| {
            if matches!(event.id().as_ref(), "help-guide" | "help-shortcuts") {
                if let Some(main) = app.get_webview_window("main") {
                    let _ = main.unminimize();
                    let _ = main.set_focus();
                }
                let _ = app.emit("app-menu", event.id().as_ref());
            }
        })
        .setup(move |app| {
            if let Some(main) = app.get_webview_window("main") {
                main.set_title(&format!("Chronoscope {}", app.package_info().version))?;
            }
            #[cfg(target_os = "macos")]
            {
                let intent_engine = engine.clone();
                chronoscope_apple_intents::install(Arc::new(move |input| {
                    let result = (|| -> Result<Value, String> {
                        let request: Value =
                            serde_json::from_str(input).map_err(|_| "Invalid intent request")?;
                        let command = request["command"]
                            .as_str()
                            .ok_or("Missing intent command")?;
                        if !matches!(
                            command,
                            "snapshot"
                                | "view_set"
                                | "select_query"
                                | "analysis_context"
                                | "analysis_prepare"
                                | "analysis_execute"
                        ) {
                            return Err("Intent command unavailable".into());
                        }
                        intent_engine.invoke(command, request["args"].clone())
                    })();
                    result
                        .unwrap_or_else(|e| serde_json::json!({"error":e}))
                        .to_string()
                }));
            }
            let handle = app.handle().clone();
            engine
                .set_observer(Arc::new(move |event| {
                    let _ = handle.emit("engine-event", event);
                }))
                .map_err(std::io::Error::other)?;
            let menu = tauri::menu::Menu::default(app.handle())?;
            for item in menu.items()? {
                if let Some(sub) = item.as_submenu() {
                    if sub.text()? == "Help" {
                        sub.append(&tauri::menu::MenuItem::with_id(
                            app,
                            "help-guide",
                            "Chronoscope User Guide",
                            true,
                            None::<&str>,
                        )?)?;
                        sub.append(&tauri::menu::MenuItem::with_id(
                            app,
                            "help-shortcuts",
                            "Keyboard Shortcuts",
                            true,
                            None::<&str>,
                        )?)?;
                    }
                }
            }
            app.set_menu(menu)?;
            #[cfg(debug_assertions)]
            if std::env::var_os("CHRONOSCOPE_WEBVIEW_DEBUG").is_some() {
                if let Some(w) = app.get_webview_window("main") {
                    w.open_devtools();
                }
            }
            Ok(())
        })
        .build(context)
        .expect("Desktop runtime failed")
        .run(|app, event| {
            if matches!(event, tauri::RunEvent::Ready) {
                if let Some(window) = app.get_webview_window("main") {
                    if let Ok(theme) = window.theme() {
                        icon_appearance::sync(app, theme);
                    }
                }
            }
            if matches!(event, tauri::RunEvent::Exit) {
                #[cfg(feature = "experimental-browser-webmcp")]
                app.state::<Arc<Engine>>().browser.shutdown();
                app.state::<Arc<Engine>>().mcp_client.shutdown();
                let state = app.state::<AgentState>();
                state.stop.store(true, Ordering::Relaxed);
                if let Ok(mut agent) = state.running.lock() {
                    *agent = None;
                };
            }
            if let tauri::RunEvent::ExitRequested { api, .. } = event {
                if app.state::<Arc<Engine>>().workspace_dirty() {
                    api.prevent_exit();
                    if let Some(main) = app.get_webview_window("main") {
                        let _ = main.unminimize();
                        let _ = main.set_focus();
                    }
                    let _ = app.emit("workspace-close-request", ());
                }
            }
        });
}
