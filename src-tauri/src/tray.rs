use tauri::menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, Manager};
use tauri_plugin_autostart::ManagerExt;

use crate::{island, settings, updater};

pub fn build(app: &AppHandle) -> tauri::Result<()> {
    let st = app.state::<updater::UpdaterState>();
    let version = MenuItem::with_id(
        app,
        "version",
        format!("Windows Island v{}", app.package_info().version),
        false,
        None::<&str>,
    )?;
    let updates = MenuItem::with_id(
        app,
        "check_updates",
        if st.configured { "Check for updates" } else { "Updates not set up in this build" },
        st.configured,
        None::<&str>,
    )?;
    *st.menu_item.lock().unwrap() = Some(updates.clone());
    let sep_top = PredefinedMenuItem::separator(app)?;
    let toggle = MenuItem::with_id(
        app,
        "toggle",
        "Toggle island  (Ctrl+Alt+Shift+I)",
        true,
        None::<&str>,
    )?;
    let autostart = CheckMenuItem::with_id(
        app,
        "autostart",
        "Launch at login",
        true,
        app.autolaunch().is_enabled().unwrap_or(false),
        None::<&str>,
    )?;
    let size_now = app.state::<settings::SettingsState>().current.lock().unwrap().size.clone();
    let mut size_items: Vec<(String, CheckMenuItem<tauri::Wry>)> = Vec::new();
    for (key, label) in [("small", "Small"), ("medium", "Medium"), ("large", "Large")] {
        let item = CheckMenuItem::with_id(app, format!("size_{key}"), label, true, key == size_now, None::<&str>)?;
        size_items.push((key.to_string(), item));
    }
    let size_menu = Submenu::with_items(
        app,
        "Island size",
        true,
        &[&size_items[0].1, &size_items[1].1, &size_items[2].1],
    )?;
    *app.state::<settings::SettingsState>().menu.lock().unwrap() = size_items;

    let vis_now = app.state::<settings::SettingsState>().current.lock().unwrap().visibility.clone();
    let mut vis_items: Vec<(String, CheckMenuItem<tauri::Wry>)> = Vec::new();
    for (key, label) in [("desktop", "Only on desktop"), ("peek", "Everywhere (peek over apps)")] {
        let item = CheckMenuItem::with_id(app, format!("vis_{key}"), label, true, key == vis_now, None::<&str>)?;
        vis_items.push((key.to_string(), item));
    }
    let vis_menu = Submenu::with_items(app, "Visibility", true, &[&vis_items[0].1, &vis_items[1].1])?;
    *app.state::<settings::SettingsState>().vis_menu.lock().unwrap() = vis_items;

    let sep = PredefinedMenuItem::separator(app)?;
    let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
    let menu = Menu::with_items(
        app,
        &[&version, &sep_top, &toggle, &vis_menu, &autostart, &size_menu, &updates, &sep, &quit],
    )?;

    let autostart_item = autostart.clone();
    let mut builder = TrayIconBuilder::new()
        .tooltip("Windows Island")
        .menu(&menu)
        .on_menu_event(move |app, event| match event.id().as_ref() {
            "toggle" => island::hotkey(app),
            "vis_desktop" => {
                let _ = settings::set_visibility(app, "desktop");
            }
            "vis_peek" => {
                let _ = settings::set_visibility(app, "peek");
            }
            "autostart" => {
                let on = autostart_item.is_checked().unwrap_or(false);
                let result = if on {
                    app.autolaunch().enable()
                } else {
                    app.autolaunch().disable()
                };
                if let Err(e) = result {
                    eprintln!("Could not change launch at login: {e}");
                    let _ = autostart_item.set_checked(!on); // put the tick back
                }
            }
            "check_updates" => {
                let app = app.clone();
                tauri::async_runtime::spawn(async move {
                    updater::on_tray_click(app).await;
                });
            }
            "size_small" => {
                let _ = settings::set_size(app, "small");
            }
            "size_medium" => {
                let _ = settings::set_size(app, "medium");
            }
            "size_large" => {
                let _ = settings::set_size(app, "large");
            }
            "quit" => app.exit(0),
            _ => {}
        });
    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    }
    builder.build(app)?;
    Ok(())
}
