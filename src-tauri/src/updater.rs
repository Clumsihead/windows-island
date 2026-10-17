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
/// true: an update found at launch installs straight away (the app restarts into it).
/// false: it only shows an "Update available" prompt and waits for the user.
const INSTALL_AT_LAUNCH: bool = true;

pub struct UpdaterState {
    pub configured: bool,
    pending: Mutex<Option<Update>>,
    busy: AtomicBool,
    /// The tray menu entry whose text we keep up to date.
    pub menu_item: Mutex<Option<MenuItem<tauri::Wry>>>,
}

impl UpdaterState {
    pub fn new(configured: bool) -> Self {
        Self {
            configured,
            pending: Mutex::new(None),
            busy: AtomicBool::new(false),
            menu_item: Mutex::new(None),
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

/// Asks GitHub whether a newer version exists. Remembers it and tells the UI + tray.
pub async fn check(app: &AppHandle, install_now: bool) -> Result<Option<UpdateInfo>, String> {
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
            let install_now = first && INSTALL_AT_LAUNCH;
            first = false;
            if let Err(e) = tauri::async_runtime::block_on(check(&app, install_now)) {
                eprintln!("[updater] check failed: {e}");
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
