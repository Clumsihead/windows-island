//! Settings that survive restarts. For now that's just the island size.

use std::path::PathBuf;
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri::menu::CheckMenuItem;
use tauri::{AppHandle, Emitter, Manager, State};

pub const SIZES: [&str; 3] = ["small", "medium", "large"];
/// "desktop": only on the desktop.  "peek": everywhere, but tucked to a thin edge over other apps.
pub const VISIBILITIES: [&str; 2] = ["desktop", "peek"];

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
    pub size: String,
    #[serde(default = "default_visibility")]
    pub visibility: String,
    /// install a found update right after launch (false = just tell the user)
    #[serde(default)]
    pub auto_update: bool,
}

fn default_visibility() -> String {
    "peek".into()
}

impl Default for Settings {
    fn default() -> Self {
        Self { size: "medium".into(), visibility: default_visibility(), auto_update: false }
    }
}

#[derive(Default)]
pub struct SettingsState {
    pub current: Mutex<Settings>,
    /// The tray's "Island size" tick marks, so they follow changes made inside the island too.
    pub menu: Mutex<Vec<(String, CheckMenuItem<tauri::Wry>)>>,
    /// Same for the "Visibility" submenu.
    pub vis_menu: Mutex<Vec<(String, CheckMenuItem<tauri::Wry>)>>,
}

fn file(app: &AppHandle) -> Option<PathBuf> {
    app.path().app_data_dir().ok().map(|d| d.join("settings.json"))
}

/// Reads settings.json (if there is one). Call once at startup.
pub fn load(app: &AppHandle) {
    let loaded = file(app)
        .and_then(|p| std::fs::read_to_string(p).ok())
        .and_then(|t| serde_json::from_str::<Settings>(&t).ok());
    if let Some(mut s) = loaded {
        if !VISIBILITIES.contains(&s.visibility.as_str()) {
            s.visibility = default_visibility();
        }
        if SIZES.contains(&s.size.as_str()) {
            *app.state::<SettingsState>().current.lock().unwrap() = s;
        }
    }
    // Hand the saved visibility mode to the island (it applies on the first foreground check).
    let desktop_only = app.state::<SettingsState>().current.lock().unwrap().visibility == "desktop";
    app.state::<crate::island::Island>().desktop_only.store(desktop_only, std::sync::atomic::Ordering::SeqCst);
}

fn save(app: &AppHandle, s: &Settings) {
    let Some(path) = file(app) else { return };
    if let Some(dir) = path.parent() {
        let _ = std::fs::create_dir_all(dir);
    }
    if let Ok(text) = serde_json::to_string_pretty(s) {
        let _ = std::fs::write(path, text);
    }
}

/// Ticks exactly one item in the tray's size submenu.
pub fn sync_menu(app: &AppHandle) {
    let st = app.state::<SettingsState>();
    let size = st.current.lock().unwrap().size.clone();
    for (key, item) in st.menu.lock().unwrap().iter() {
        let _ = item.set_checked(key.as_str() == size);
    }
    let vis = st.current.lock().unwrap().visibility.clone();
    for (key, item) in st.vis_menu.lock().unwrap().iter() {
        let _ = item.set_checked(key.as_str() == vis);
    }
}

pub fn set_size(app: &AppHandle, size: &str) -> Result<(), String> {
    if !SIZES.contains(&size) {
        return Err("Unknown size".into());
    }
    let snapshot = {
        let st = app.state::<SettingsState>();
        let mut cur = st.current.lock().unwrap();
        cur.size = size.to_string();
        cur.clone()
    };
    save(app, &snapshot);
    sync_menu(app);
    let _ = app.emit("settings:changed", snapshot);
    Ok(())
}

pub fn set_visibility(app: &AppHandle, mode: &str) -> Result<(), String> {
    if !VISIBILITIES.contains(&mode) {
        return Err("Unknown visibility mode".into());
    }
    let snapshot = {
        let st = app.state::<SettingsState>();
        let mut cur = st.current.lock().unwrap();
        cur.visibility = mode.to_string();
        cur.clone()
    };
    save(app, &snapshot);
    crate::island::set_desktop_only(app, mode == "desktop");
    sync_menu(app);
    let _ = app.emit("settings:changed", snapshot);
    Ok(())
}

#[tauri::command]
pub fn settings_get(st: State<'_, SettingsState>) -> Settings {
    st.current.lock().unwrap().clone()
}

#[tauri::command]
pub fn set_island_size(app: AppHandle, size: String) -> Result<(), String> {
    set_size(&app, &size)
}

#[tauri::command]
pub fn set_visibility_mode(app: AppHandle, mode: String) -> Result<(), String> {
    set_visibility(&app, &mode)
}

#[tauri::command]
pub fn set_auto_update(app: AppHandle, on: bool) -> Result<(), String> {
    let snapshot = {
        let st = app.state::<SettingsState>();
        let mut cur = st.current.lock().unwrap();
        cur.auto_update = on;
        cur.clone()
    };
    save(&app, &snapshot);
    let _ = app.emit("settings:changed", snapshot);
    Ok(())
}
