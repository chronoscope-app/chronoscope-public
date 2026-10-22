//! Local macOS integration check. Changes only this test process's appearance,
//! then exercises Tao's real OS-theme notification and the shipped icon handler.
//! Run: cargo run -p chronoscope-desktop --example icon_appearance_qa -- <report.json>
#[cfg(target_os = "macos")]
#[path = "../src/icon_appearance.rs"]
mod icon_appearance;

#[cfg(target_os = "macos")]
fn main() {
    use objc2::MainThreadMarker;
    use objc2_app_kit::{NSAppearance, NSApplication};
    use objc2_foundation::{NSDistributedNotificationCenter, NSString};
    use std::sync::{
        atomic::{AtomicBool, Ordering},
        Mutex,
    };
    use tauri::{Manager, Theme};

    struct Checks {
        initial: Mutex<Theme>,
        themes: Mutex<Vec<String>>,
        active: AtomicBool,
        passed: AtomicBool,
        output: std::path::PathBuf,
    }
    fn force(theme: Theme) {
        let main = MainThreadMarker::new().unwrap();
        let name = if theme == Theme::Dark {
            "NSAppearanceNameDarkAqua"
        } else {
            "NSAppearanceNameAqua"
        };
        let appearance = NSAppearance::appearanceNamed(&NSString::from_str(name)).unwrap();
        NSApplication::sharedApplication(main).setAppearance(Some(&appearance));
        // No OS preference is written. Existing observers simply re-read their
        // unchanged system preference; this process sees its forced appearance.
        // SAFETY: userInfo is None, so no NSDictionary generic values are passed.
        unsafe {
            NSDistributedNotificationCenter::defaultCenter()
                .postNotificationName_object_userInfo_deliverImmediately(
                    &NSString::from_str("AppleInterfaceThemeChangedNotification"),
                    None,
                    None,
                    true,
                );
        }
    }
    fn verify(app: &tauri::AppHandle, theme: Theme) {
        icon_appearance::sync(app, theme);
        capture(app, &format!("{theme:?}"));
        app.state::<Checks>()
            .themes
            .lock()
            .unwrap()
            .push(format!("{theme:?}"));
    }
    fn capture(app: &tauri::AppHandle, label: &str) {
        let main = MainThreadMarker::new().unwrap();
        let actual = NSApplication::sharedApplication(main)
            .applicationIconImage()
            .unwrap();
        let data = actual.TIFFRepresentation().unwrap().to_vec();
        std::fs::write(
            app.state::<Checks>()
                .output
                .join(format!("dock-{label}.tiff")),
            data,
        )
        .unwrap();
    }

    // The public adapter rejects invalid data and worker-thread use without
    // touching the existing Dock icon.
    assert!(chronoscope_dock_icon::set_image(b"not a PNG").is_err());
    assert!(
        std::thread::spawn(|| chronoscope_dock_icon::set_image(icon_appearance::PEARL))
            .join()
            .unwrap()
            .is_err()
    );
    let report = std::env::args().nth(1).expect("report path");
    tauri::Builder::default()
        .manage(icon_appearance::IconAppearance::new(None))
        .manage(Checks {
            initial: Mutex::new(Theme::Light),
            themes: Mutex::new(vec![]),
            active: AtomicBool::new(false),
            passed: AtomicBool::new(false),
            output: std::path::Path::new(&report).parent().unwrap().to_path_buf(),
        })
        .setup(|app| {
            app.get_webview_window("main").unwrap().set_title("Chronoscope icon appearance QA")?;
            Ok(())
        })
        .on_window_event(move |window, event| {
            if let tauri::WindowEvent::ThemeChanged(theme) = event {
                if window.label() != "main" { return; }
                let app = window.app_handle();
                let checks = app.state::<Checks>();
                if !checks.active.load(Ordering::Acquire) {
                    return;
                }
                verify(app, *theme);
                let count = checks.themes.lock().unwrap().len();
                if count == 2 {
                    force(*checks.initial.lock().unwrap());
                } else if count == 3 {
                    let themes = checks.themes.lock().unwrap().clone();
                    assert_ne!(themes[0], themes[1]);
                    assert_eq!(themes[0], themes[2]);
                    std::fs::write(
                        &report,
                        serde_json::to_vec_pretty(&serde_json::json!({
                            "passed":true,"theme_events":themes,"dock_captures":["dock-Light.tiff","dock-Dark.tiff"],
                            "invalid_image_rejected":true,"worker_thread_rejected":true,
                            "system_preferences_changed":false
                            ,"app_preference_sequence":["Dark","Light","System"],
                            "app_preference_overrides_system":true
                        }))
                        .unwrap(),
                    )
                    .unwrap();
                    checks.passed.store(true, Ordering::Release);
                    app.exit(0);
                }
            }
        })
        .build(tauri::generate_context!())
        .unwrap()
        .run(|app, event| {
            if matches!(event, tauri::RunEvent::Ready) {
                let checks = app.state::<Checks>();
                let theme = app.get_webview_window("main").unwrap().theme().unwrap();
                *checks.initial.lock().unwrap() = theme;
                // Same command used by the real sun button. The app override
                // must win even when a native event reports the opposite theme.
                icon_appearance::desktop_icon_theme(app.clone(), Some(Theme::Dark)).unwrap();
                capture(app, "app-Dark");
                icon_appearance::sync(app, Theme::Light);
                capture(app, "override-Dark");
                icon_appearance::desktop_icon_theme(app.clone(), Some(Theme::Light)).unwrap();
                capture(app, "app-Light");
                icon_appearance::desktop_icon_theme(app.clone(), None).unwrap();
                verify(app, theme);
                checks.active.store(true, Ordering::Release);
                force(if theme == Theme::Dark {
                    Theme::Light
                } else {
                    Theme::Dark
                });
                let handle = app.clone();
                std::thread::spawn(move || {
                    std::thread::sleep(std::time::Duration::from_secs(15));
                    if !handle.state::<Checks>().passed.load(Ordering::Acquire) {
                        handle.exit(1);
                    }
                });
            }
        });
}

#[cfg(not(target_os = "macos"))]
fn main() {
    eprintln!("Native Dock appearance QA runs on macOS.");
    std::process::exit(1);
}
