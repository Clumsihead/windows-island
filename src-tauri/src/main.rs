#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod apps;
mod audio;
mod clipboard;
mod foreground;
mod gpu;
mod hw;
mod icons;
mod island;
mod media;
mod radio;
mod settings;
mod stats;
mod system;
mod tray;
mod updater;

use tauri::{Manager, RunEvent, WindowEvent};
use tauri_plugin_autostart::MacosLauncher;
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, ShortcutState};

/// Register "launch at login" automatically the first time an installed build runs.
/// Set to false if you'd rather users opt in from the tray menu.
#[cfg(not(debug_assertions))]
const AUTOSTART_BY_DEFAULT: bool = true;

fn main() {
    let context = tauri::generate_context!();
    // Updates are only wired up when the build was given updater config (README, "Auto-update").
    // Dev and local builds skip it, so contributors never need the signing key.
    let updater_configured = context.config().plugins.0.contains_key("updater");

    let builder = tauri::Builder::default();

    // Release builds only: starting a second copy (say autostart plus a manual launch)
    // should just toggle the running island instead of fighting it for the hotkey.
    // Skipped in debug so `tauri dev` still runs while an installed copy is open.
    // Must be the first plugin registered.
    #[cfg(not(debug_assertions))]
    let builder = builder.plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
        island::hotkey(app);
    }));

    let builder = if updater_configured {
        builder.plugin(tauri_plugin_updater::Builder::new().build())
    } else {
        builder
    };

    let app = builder
        .plugin(tauri_plugin_autostart::init(MacosLauncher::LaunchAgent, None))
        .plugin(tauri_plugin_dialog::init())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, shortcut, event| {
                    if event.state() == ShortcutState::Pressed {
                        if shortcut.matches(Modifiers::CONTROL | Modifiers::ALT, Code::KeyA) {
                            island::open_tab(app, "Apps"); // Ctrl+Alt+A: straight to app search
                        } else {
                            island::hotkey(app);
                        }
                    }
                })
                .build(),
        )
        .manage(island::Island::new())
        .manage(stats::StatsState::new())
        .manage(clipboard::ClipState::default())
        .manage(apps::AppIndex::default())
        .manage(updater::UpdaterState::new(updater_configured))
        .manage(settings::SettingsState::default())
        .invoke_handler(tauri::generate_handler![
            island::island_set_rect,
            island::island_set_expanded,
            island::island_set_pinned,
            island::island_set_scale,
            settings::settings_get,
            settings::set_island_size,
            settings::set_visibility_mode,
            settings::set_auto_update,
            island::island_get,
            stats::system_stats,
            media::media_get,
            media::media_art,
            media::media_control,
            audio::audio_get,
            audio::audio_set_volume,
            audio::audio_toggle_mute,
            radio::radio_get,
            radio::radio_set,
            clipboard::clipboard_history,
            clipboard::clipboard_copy,
            clipboard::clipboard_clear,
            apps::apps_list,
            apps::apps_launch,
            system::open_settings,
            system::wallpaper_set,
            system::power_action,
            system::wallpaper_get,
            system::list_images,
            system::default_wallpapers,
            stats::top_apps,
            gpu::gpu_stats,
            hw::brightness_get,
            hw::brightness_set,
            hw::dark_mode_get,
            hw::dark_mode_set,
            hw::network_info,
            audio::audio_device,
            icons::icons_get,
            clipboard::clipboard_pin,
            clipboard::clipboard_remove,
            clipboard::clipboard_paste,
            clipboard::clipboard_paste_text,
            apps::recent_files,
            updater::update_check,
            updater::update_install,
            updater::update_pending,
            updater::updater_status,
        ])
        .setup(|app| {
            let handle = app.handle().clone();
            let win = app
                .get_webview_window(island::LABEL)
                .ok_or("island window missing from tauri.conf.json")?;

            island::prepare(&win)?;
            settings::load(&handle);
            tray::build(&handle)?;

            #[cfg(not(debug_assertions))]
            enable_autostart_on_first_run(app);

            if let Err(e) = app.global_shortcut().register("Ctrl+Alt+Shift+I") {
                eprintln!("Could not register Ctrl+Alt+Shift+I (already taken?): {e}");
            }
            if let Err(e) = app.global_shortcut().register("Ctrl+Alt+A") {
                eprintln!("Could not register Ctrl+Alt+A (already taken?): {e}");
            }

            apps::index_in_background(handle.clone());
            clipboard::start(handle.clone());
            island::start_hover_loop(handle.clone());
            foreground::start(handle.clone());
            updater::start(handle.clone());
            hw::start_brightness_watcher(handle.clone());
            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::Focused(false) = event {
                if window.label() == island::LABEL {
                    island::on_blur(window.app_handle());
                }
            }
        })
        .build(context)
        .expect("error while building Windows Island");

    app.run(|handle, event| {
        if let RunEvent::Exit = event {
            handle
                .state::<island::Island>()
                .foreground_running
                .store(false, std::sync::atomic::Ordering::SeqCst);
        }
    });
}

/// First run of an installed build: turn on "launch at login" once. After that the tray
/// checkbox is the source of truth, so a user who unticks it stays opted out.
#[cfg(not(debug_assertions))]
fn enable_autostart_on_first_run(app: &tauri::App) {
    use tauri_plugin_autostart::ManagerExt;

    let Ok(dir) = app.path().app_data_dir() else { return };
    let marker = dir.join("first-run-done");
    if marker.exists() {
        return;
    }
    let _ = std::fs::create_dir_all(&dir);
    let _ = std::fs::write(&marker, b"1");
    if AUTOSTART_BY_DEFAULT {
        if let Err(e) = app.autolaunch().enable() {
            eprintln!("Could not enable launch at login: {e}");
        }
    }
}
