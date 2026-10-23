//! Auto-update through GitHub Releases (tauri-plugin-updater).
//!
//! The updater is only wired up when the build was given updater config (see the
//! "Auto-update" section of the README). Dev and local builds skip all of this.

use std::sync::atomic::{AtomicBool, Ordering::SeqCst};
use std::sync::Mutex;
use std::time::Duration;

use serde::Serialize;
use tauri::menu::MenuItem;
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_updater::{Update, UpdaterExt};

/// Wait this long after launch before the first check (let the desktop settle).
const FIRST_CHECK_DELAY: Duration = Duration::from_secs(30);
/// How often to look again while the app stays running.
const CHECK_EVERY: Duration = Duration::from_secs(6 * 60 * 60);
/// If a check fails (no network just after boot, say) try again after this long, a few times,
/// instead of waiting the full six hours.
const RETRY_AFTER: Duration = Duration::from_secs(120);
const MAX_RETRIES: u32 = 4;

pub struct UpdaterState {
    pub configured: bool,
    pending: Mutex<Option<Update>>,
    busy: AtomicBool,
    /// The tray menu entry whose text we keep up to date.
    pub menu_item: Mutex<Option<MenuItem<tauri::Wry>>>,
    /// When the last check ran (ms since 1970) and what it found, so the Settings tab can show it.
    last: Mutex<Option<(u64, String)>>,
}

impl UpdaterState {
    pub fn new(configured: bool) -> Self {
        Self {
            configured,
            pending: Mutex::new(None),
            busy: AtomicBool::new(false),
            menu_item: Mutex::new(None),
            last: Mutex::new(None),
        }
    }
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInfo {
    pub version: String,
    pub notes: Option<String>,
}

fn set_label(app: &AppHandle, text: &str) {
    if let Some(item) = app.state::<UpdaterState>().menu_item.lock().unwrap().as_ref() {
        let _ = item.set_text(text);
    }
}

fn record(app: &AppHandle, text: String) {
    let at = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);
    eprintln!("[updater] {text}");
    // Also keep it in a small file, so it can be read even when nothing is running.
    if let Ok(dir) = app.path().app_data_dir() {
        let _ = std::fs::create_dir_all(&dir);
        let _ = std::fs::write(dir.join("last-update-check.txt"), format!("{at}\n{text}\n"));
    }
    *app.state::<UpdaterState>().last.lock().unwrap() = Some((at, text));
}

/// Asks GitHub whether a newer version exists, and remembers what it said.
pub async fn check(app: &AppHandle, install_now: bool) -> Result<Option<UpdateInfo>, String> {
    let result = check_inner(app, install_now).await;
    let current = app.package_info().version.to_string();
    let text = match &result {
        Ok(Some(u)) => format!("Version {} is available (you have {current})", u.version),
        Ok(None) => format!("You're up to date (v{current})"),
        Err(e) => format!("Check failed: {e}"),
    };
    record(app, text);
    result
}

/// Remembers a found update and tells the UI + tray.
async fn check_inner(app: &AppHandle, install_now: bool) -> Result<Option<UpdateInfo>, String> {
    let st = app.state::<UpdaterState>();
    if !st.configured {
        return Err("Updates aren't set up in this build".into());
    }
    let found = app
        .updater()
        .map_err(|e| e.to_string())?
        .check()
        .await
        .map_err(|e| e.to_string())?;
    let Some(update) = found else {
        return Ok(None);
    };

    let info = UpdateInfo { version: update.version.clone(), notes: update.body.clone() };
    *st.pending.lock().unwrap() = Some(update);
    set_label(app, &format!("Install update v{}", info.version));
    let _ = app.emit("update:available", info.clone());

    if install_now {
        install(app.clone()).await?;
    }
    Ok(Some(info))
}

/// Downloads and installs the pending update. On Windows the app exits when the
/// installer starts and the new version launches itself afterwards.
pub async fn install(app: AppHandle) -> Result<(), String> {
    let st = app.state::<UpdaterState>();
    if st.busy.swap(true, SeqCst) {
        return Ok(()); // already running
    }
    let pending = st.pending.lock().unwrap().clone();
    let Some(update) = pending else {
        st.busy.store(false, SeqCst);
        return Err("No update is ready".into());
    };

    let mut downloaded: u64 = 0;
    let progress_app = app.clone();
    let result = update
        .download_and_install(
            move |chunk, total| {
                downloaded += chunk as u64;
                let pct = total.map(|t| ((downloaded as f64 / t.max(1) as f64) * 100.0) as u32);
                let _ = progress_app.emit("update:progress", pct);
            },
            || {},
        )
        .await;
    st.busy.store(false, SeqCst);
    result.map_err(|e| e.to_string())
}

/// Tray click: check if nothing is pending yet, then install.
pub async fn on_tray_click(app: AppHandle) {
    let pending = app.state::<UpdaterState>().pending.lock().unwrap().is_some();
    if !pending {
        set_label(&app, "Checking for updates...");
        match check(&app, false).await {
            Ok(Some(_)) => {} // found one: carry on and install it
            Ok(None) => {
                set_label(&app, "You're up to date");
                return;
            }
            Err(_) => {
                set_label(&app, "Update check failed - click to retry");
                return;
            }
        }
    }
    set_label(&app, "Installing update...");
    if install(app.clone()).await.is_err() {
        set_label(&app, "Update failed - click to retry");
    }
}

/// Background checks: once shortly after launch, then every few hours.
pub fn start(app: AppHandle) {
    if !app.state::<UpdaterState>().configured {
        return;
    }
    std::thread::spawn(move || {
        std::thread::sleep(FIRST_CHECK_DELAY);
        let mut first = true;
        loop {
            // "Install updates automatically" is a setting; by default the user is asked instead.
            let auto = app.state::<crate::settings::SettingsState>().current.lock().unwrap().auto_update;
            let install_now = first && auto;
            first = false;
            let mut tries = 0;
            loop {
                match tauri::async_runtime::block_on(check(&app, install_now)) {
                    Err(_) if tries < MAX_RETRIES => {
                        tries += 1;
                        std::thread::sleep(RETRY_AFTER);
                    }
                    _ => break,
                }
            }
            std::thread::sleep(CHECK_EVERY);
        }
    });
}

#[tauri::command]
pub async fn update_check(app: AppHandle) -> Result<Option<UpdateInfo>, String> {
    check(&app, false).await
}

#[tauri::command]
pub async fn update_install(app: AppHandle) -> Result<(), String> {
    install(app).await
}

/// Lets the UI pick up an update that was found before it finished loading.
#[tauri::command]
pub fn update_pending(st: State<'_, UpdaterState>) -> Option<UpdateInfo> {
    st.pending
        .lock()
        .unwrap()
        .as_ref()
        .map(|u| UpdateInfo { version: u.version.clone(), notes: u.body.clone() })
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdaterStatus {
    /// false when this build wasn't made with the updater turned on (so it can never update itself)
    configured: bool,
    current: String,
    last_checked: Option<u64>,
    last_result: String,
}

#[tauri::command]
pub fn updater_status(app: AppHandle, st: State<'_, UpdaterState>) -> UpdaterStatus {
    let last = st.last.lock().unwrap().clone();
    UpdaterStatus {
        configured: st.configured,
        current: app.package_info().version.to_string(),
        last_checked: last.as_ref().map(|l| l.0),
        last_result: last.map(|l| l.1).unwrap_or_default(),
    }
}
