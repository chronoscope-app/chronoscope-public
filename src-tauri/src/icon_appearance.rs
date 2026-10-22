//! Explicit app appearance wins; System follows native appearance events.
use std::sync::Mutex;
use tauri::{AppHandle, Manager, Theme};

#[derive(Default)]
pub struct IconAppearance {
    preference: Mutex<Option<Theme>>,
    applied: Mutex<Option<Theme>>,
}

impl IconAppearance {
    pub fn new(preference: Option<Theme>) -> Self {
        Self {
            preference: Mutex::new(preference),
            applied: Mutex::new(None),
        }
    }
}

#[cfg(target_os = "macos")]
pub const PEARL: &[u8] = include_bytes!("../icons/icon-macos-light.png");
#[cfg(target_os = "macos")]
pub const DARK: &[u8] = include_bytes!("../icons/icon-macos-dark.png");
#[cfg(not(target_os = "macos"))]
pub const PEARL: &[u8] = include_bytes!("../icons/icon-light.png");
#[cfg(not(target_os = "macos"))]
pub const DARK: &[u8] = include_bytes!("../icons/icon-dark.png");

pub fn image(theme: Theme) -> &'static [u8] {
    if theme == Theme::Dark {
        DARK
    } else {
        PEARL
    }
}

pub fn apply(app: &AppHandle, theme: Theme) -> Result<(), String> {
    let png = image(theme);
    #[cfg(target_os = "macos")]
    chronoscope_dock_icon::set_image(png).map_err(str::to_owned)?;
    #[cfg(target_os = "windows")]
    for window in app.webview_windows().into_values() {
        // WM_SETICON via Tauri requires no elevation or system-wide changes.
        window
            .set_icon(tauri::image::Image::from_bytes(png).map_err(|e| e.to_string())?)
            .map_err(|e| e.to_string())?;
    }
    // Linux launchers use the packaged pearl fallback; desktop theme support varies.
    let _ = (app, png);
    Ok(())
}

fn apply_cached(app: &AppHandle, theme: Theme) -> Result<(), String> {
    let state = app.state::<IconAppearance>();
    let mut applied = state.applied.lock().map_err(|_| "Icon state unavailable")?;
    if *applied != Some(theme) {
        apply(app, theme)?;
        *applied = Some(theme);
    }
    Ok(())
}

/// Shared by the real UI IPC command and the native appearance integration test.
#[tauri::command]
pub fn desktop_icon_theme(app: AppHandle, theme: Option<Theme>) -> Result<(), String> {
    *app.state::<IconAppearance>()
        .preference
        .lock()
        .map_err(|_| "Icon state unavailable")? = theme;
    let resolved = match theme {
        Some(theme) => theme,
        None => app
            .get_webview_window("main")
            .ok_or("Main window unavailable")?
            .theme()
            .map_err(|e| e.to_string())?,
    };
    apply_cached(&app, resolved)
}

pub fn sync(app: &AppHandle, system_theme: Theme) {
    let state = app.state::<IconAppearance>();
    let result = state
        .preference
        .lock()
        .map_err(|_| "Icon state unavailable".to_owned())
        .and_then(|preference| apply_cached(app, preference.unwrap_or(system_theme)));
    if let Err(error) = result {
        eprintln!("Chronoscope icon appearance: {error}");
    }
}
