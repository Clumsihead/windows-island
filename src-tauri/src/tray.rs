use tauri::menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::AppHandle;
use tauri_plugin_autostart::ManagerExt;

use crate::island;

pub fn build(app: &AppHandle) -> tauri::Result<()> {
    let toggle = MenuItem::with_id(
        app,
        "toggle",
        "Toggle island  (Ctrl+Alt+Shift+I)",
        true,
        None::<&str>,
    )?;
    let desktop = CheckMenuItem::with_id(
        app,
        "desktop_only",
        "Only show on desktop",
        true,
        false,
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
    let sep = PredefinedMenuItem::separator(app)?;
    let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&toggle, &desktop, &autostart, &sep, &quit])?;

    let desktop_item = desktop.clone();
    let autostart_item = autostart.clone();
    let mut builder = TrayIconBuilder::new()
        .tooltip("Windows Island")
        .menu(&menu)
        .on_menu_event(move |app, event| match event.id().as_ref() {
            "toggle" => island::hotkey(app),
            "desktop_only" => {
                let on = desktop_item.is_checked().unwrap_or(true);
                island::set_desktop_only(app, on);
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
            "quit" => app.exit(0),
            _ => {}
        });
    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    }
    builder.build(app)?;
    Ok(())
}
