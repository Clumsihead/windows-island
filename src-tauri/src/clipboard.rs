//! In-memory clipboard history. Uses the clipboard sequence number to notice changes
//! (no polling the contents) and skips anything a password manager has flagged.

use std::sync::Mutex;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};
use windows::core::w;
use windows::Win32::System::DataExchange::{
    GetClipboardSequenceNumber, IsClipboardFormatAvailable, RegisterClipboardFormatW,
};

#[derive(Clone, Serialize)]
pub struct Clip {
    id: String,
    text: String,
    time: u64,
}

#[derive(Default)]
pub struct ClipState {
    items: Mutex<Vec<Clip>>,
}

pub fn start(app: AppHandle) {
    std::thread::spawn(move || {
        let exclude =
            unsafe { RegisterClipboardFormatW(w!("ExcludeClipboardContentFromMonitorProcessing")) };
        let mut last = unsafe { GetClipboardSequenceNumber() };
        let mut cb = arboard::Clipboard::new().ok();

        loop {
            std::thread::sleep(Duration::from_millis(400));
            let seq = unsafe { GetClipboardSequenceNumber() };
            if seq == last {
                continue;
            }
            last = seq;
            if unsafe { IsClipboardFormatAvailable(exclude) }.is_ok() {
                continue; // flagged as sensitive (password managers do this)
            }
            if cb.is_none() {
                cb = arboard::Clipboard::new().ok();
            }
            let Some(c) = cb.as_mut() else { continue };
            let Ok(text) = c.get_text() else { continue };
            let text: String = text.trim_end().chars().take(8000).collect();
            if text.is_empty() {
                continue;
            }

            let now = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .map(|d| d.as_millis() as u64)
                .unwrap_or(0);
            let state = app.state::<ClipState>();
            let snapshot = {
                let mut items = state.items.lock().unwrap();
                items.retain(|i| i.text != text);
                items.insert(
                    0,
                    Clip {
                        id: now.to_string(),
                        text,
                        time: now,
                    },
                );
                items.truncate(100);
                items.clone()
            };
            let _ = app.emit("clipboard:changed", snapshot);
        }
    });
}

#[tauri::command]
pub fn clipboard_history(state: State<'_, ClipState>) -> Vec<Clip> {
    state.items.lock().unwrap().clone()
}

#[tauri::command]
pub fn clipboard_copy(text: String) -> Result<(), String> {
    let text: String = text.chars().take(8000).collect();
    arboard::Clipboard::new()
        .and_then(|mut c| c.set_text(text))
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn clipboard_clear(app: AppHandle, state: State<'_, ClipState>) {
    state.items.lock().unwrap().clear();
    let _ = app.emit("clipboard:changed", Vec::<Clip>::new());
}
