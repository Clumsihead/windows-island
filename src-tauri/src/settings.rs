//! Settings that survive restarts. For now that's just the island size.

use std::path::PathBuf;
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri::menu::CheckMenuItem;
use tauri::{AppHandle, Emitter, Manager, State};

pub const SIZES: [&str; 3] = ["small", "medium", "large"];

#[derive(Serialize, Deserialize, Clone)]
pub struct Settings {
    pub size: String,
}

impl Default for Settings {
    fn default() -> Self {
        Self { size: "medium".into() }
    }
}

#[derive(Default)]
pub struct SettingsState {
    pub current: Mutex<Settings>,
    /// The tray's "Island size" tick marks, so they follow changes made inside the island too.
    pub menu: Mutex<Vec<(String, CheckMenuItem<tauri::Wry>)>>,
}

fn file(app: &AppHandle) -> Option<PathBuf> {
    app.path().app_data_dir().ok().map(|d| d.join("settings.json"))
}

/// Reads settings.json (if there is one). Call once at startup.
pub fn load(app: &AppHandle) {
    let loaded = file(app)
        .and_then(|p| std::fs::read_to_string(p).ok())
        .and_then(|t| serde_json::from_str::<Settings>(&t).ok());
    if let Some(s) = loaded {
        if SIZES.contains(&s.size.as_str()) {
            *app.state::<SettingsState>().current.lock().unwrap() = s;
        }
    }
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

#[tauri::command]
pub fn settings_get(st: State<'_, SettingsState>) -> Settings {
    st.current.lock().unwrap().clone()
}

#[tauri::command]
pub fn set_island_size(app: AppHandle, size: String) -> Result<(), String> {
    set_size(&app, &size)
}
