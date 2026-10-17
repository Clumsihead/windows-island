//! Clipboard history: text and images, pinning, and "paste into the app you were using".
//! Everything lives in memory only. Items a password manager flags as sensitive are skipped.

use std::borrow::Cow;
use std::io::Cursor;
use std::sync::Mutex;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use base64::{engine::general_purpose::STANDARD as B64, Engine};
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};
use windows::core::w;
use windows::Win32::System::DataExchange::{
    GetClipboardSequenceNumber, IsClipboardFormatAvailable, RegisterClipboardFormatW,
};
use windows::Win32::UI::Input::KeyboardAndMouse::{
    keybd_event, KEYBD_EVENT_FLAGS, KEYEVENTF_KEYUP, VK_CONTROL, VK_V,
};

const MAX_UNPINNED: usize = 60;
const MAX_IMAGES: usize = 12;
const MAX_IMAGE_PIXELS: usize = 40_000_000; // about 8K
const THUMB_WIDTH: u32 = 640;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Clip {
    id: String,
    /// "text" or "image"
    kind: String,
    text: String,
    /// small PNG preview for images, as a data: URL
    thumb: Option<String>,
    width: u32,
    height: u32,
    /// bytes (text length, or compressed image size)
    size: u64,
    time: u64,
    pinned: bool,
}

struct Stored {
    clip: Clip,
    /// the full image, PNG-compressed so a dozen screenshots don't eat memory
    png: Option<Vec<u8>>,
    hash: u64,
}

#[derive(Default)]
pub struct ClipState {
    items: Mutex<Vec<Stored>>,
}

fn fnv1a(bytes: &[u8]) -> u64 {
    let mut h: u64 = 0xcbf29ce484222325;
    for b in bytes {
        h ^= *b as u64;
        h = h.wrapping_mul(0x100000001b3);
    }
    h
}

fn encode_png(w: u32, h: u32, rgba: &[u8], fast: bool) -> Option<Vec<u8>> {
    let mut out = Vec::new();
    {
        let mut enc = png::Encoder::new(&mut out, w, h);
        enc.set_color(png::ColorType::Rgba);
        enc.set_depth(png::BitDepth::Eight);
        if fast {
            enc.set_compression(png::Compression::Fast);
        }
        let mut writer = enc.write_header().ok()?;
        writer.write_image_data(rgba).ok()?;
    }
    Some(out)
}

fn decode_png(bytes: &[u8]) -> Option<(u32, u32, Vec<u8>)> {
    let decoder = png::Decoder::new(Cursor::new(bytes));
    let mut reader = decoder.read_info().ok()?;
    let mut buf = vec![0; reader.output_buffer_size()];
    let info = reader.next_frame(&mut buf).ok()?;
    if info.color_type != png::ColorType::Rgba || info.bit_depth != png::BitDepth::Eight {
        return None;
    }
    buf.truncate(info.buffer_size());
    Some((info.width, info.height, buf))
}

/// Box-filter shrink by a whole-number factor (plenty for a preview).
fn downscale(w: u32, h: u32, rgba: &[u8], max_w: u32) -> (u32, u32, Vec<u8>) {
    let f = ((w + max_w - 1) / max_w).max(1);
    if f == 1 {
        return (w, h, rgba.to_vec());
    }
    let (nw, nh) = ((w / f).max(1), (h / f).max(1));
    let mut out = vec![0u8; (nw * nh * 4) as usize];
    for y in 0..nh {
        for x in 0..nw {
            let mut acc = [0u32; 4];
            let mut n = 0u32;
            for dy in 0..f {
                for dx in 0..f {
                    let (sx, sy) = (x * f + dx, y * f + dy);
                    if sx >= w || sy >= h {
                        continue;
                    }
                    let i = ((sy * w + sx) * 4) as usize;
                    for c in 0..4 {
                        acc[c] += rgba[i + c] as u32;
                    }
                    n += 1;
                }
            }
            let o = ((y * nw + x) * 4) as usize;
            for c in 0..4 {
                out[o + c] = (acc[c] / n.max(1)) as u8;
            }
        }
    }
    (nw, nh, out)
}

fn now_ms() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

fn snapshot(items: &[Stored]) -> Vec<Clip> {
    items.iter().map(|i| i.clip.clone()).collect()
}

fn emit_all(app: &AppHandle, state: &ClipState) {
    let snap = snapshot(&state.items.lock().unwrap());
    let _ = app.emit("clipboard:changed", snap);
}

fn read_current(cb: &mut arboard::Clipboard) -> Option<Stored> {
    let now = now_ms();
    if let Ok(text) = cb.get_text() {
        let text: String = text.trim_end().chars().take(8000).collect();
        if text.is_empty() {
            return None;
        }
        return Some(Stored {
            hash: fnv1a(text.as_bytes()),
            png: None,
            clip: Clip {
                id: now.to_string(),
                kind: "text".into(),
                size: text.len() as u64,
                text,
                thumb: None,
                width: 0,
                height: 0,
                time: now,
                pinned: false,
            },
        });
    }
    let img = cb.get_image().ok()?;
    let (w, h) = (img.width as u32, img.height as u32);
    if w == 0 || h == 0 || (w as usize) * (h as usize) > MAX_IMAGE_PIXELS {
        return None;
    }
    let rgba = img.bytes.as_ref();
    let png = encode_png(w, h, rgba, true)?;
    let (tw, th, thumb_px) = downscale(w, h, rgba, THUMB_WIDTH);
    let thumb = encode_png(tw, th, &thumb_px, true)?;
    Some(Stored {
        hash: fnv1a(rgba),
        clip: Clip {
            id: now.to_string(),
            kind: "image".into(),
            text: String::new(),
            thumb: Some(format!("data:image/png;base64,{}", B64.encode(thumb))),
            width: w,
            height: h,
            size: png.len() as u64,
            time: now,
            pinned: false,
        },
        png: Some(png),
    })
}

fn insert(items: &mut Vec<Stored>, new: Stored) {
    if let Some(pos) = items.iter().position(|i| i.hash == new.hash && i.clip.kind == new.clip.kind) {
        let mut old = items.remove(pos);
        old.clip.time = new.clip.time;
        items.insert(0, old);
    } else {
        items.insert(0, new);
    }
    // drop the oldest unpinned items beyond the limits
    let mut unpinned = 0;
    let mut images = 0;
    items.retain(|i| {
        if i.clip.pinned {
            return true;
        }
        unpinned += 1;
        if i.clip.kind == "image" {
            images += 1;
            if images > MAX_IMAGES {
                return false;
            }
        }
        unpinned <= MAX_UNPINNED
    });
    items.sort_by_key(|i| !i.clip.pinned); // stable: pinned first, newest first within each group
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
                continue; // flagged sensitive by a password manager
            }
            if cb.is_none() {
                cb = arboard::Clipboard::new().ok();
            }
            let Some(c) = cb.as_mut() else { continue };
            let Some(new) = read_current(c) else { continue };

            let state = app.state::<ClipState>();
            insert(&mut state.items.lock().unwrap(), new);
            emit_all(&app, &state);
        }
    });
}

#[tauri::command]
pub fn clipboard_history(state: State<'_, ClipState>) -> Vec<Clip> {
    snapshot(&state.items.lock().unwrap())
}

fn put_on_clipboard(state: &ClipState, id: &str) -> Result<(), String> {
    let (kind, text, png) = {
        let items = state.items.lock().unwrap();
        let it = items.iter().find(|i| i.clip.id == id).ok_or("That item is gone")?;
        (it.clip.kind.clone(), it.clip.text.clone(), it.png.clone())
    };
    let mut cb = arboard::Clipboard::new().map_err(|e| e.to_string())?;
    if kind == "image" {
        let (w, h, rgba) = decode_png(&png.ok_or("No image data")?).ok_or("Couldn't read the image")?;
        cb.set_image(arboard::ImageData { width: w as usize, height: h as usize, bytes: Cow::Owned(rgba) })
            .map_err(|e| e.to_string())
    } else {
        cb.set_text(text).map_err(|e| e.to_string())
    }
}

#[tauri::command(async)]
pub fn clipboard_copy(id: String, state: State<'_, ClipState>) -> Result<(), String> {
    put_on_clipboard(&state, &id)
}

/// Copies the item, closes the island, returns focus to the app you were in, and presses Ctrl+V.
#[tauri::command(async)]
pub fn clipboard_paste(app: AppHandle, id: String, state: State<'_, ClipState>) -> Result<(), String> {
    put_on_clipboard(&state, &id)?;
    paste_into_previous_window(&app);
    Ok(())
}

/// Pastes a snippet's text (from the Apps tab) into the app you were using.
#[tauri::command(async)]
pub fn clipboard_paste_text(app: AppHandle, text: String) -> Result<(), String> {
    let text: String = text.chars().take(8000).collect();
    arboard::Clipboard::new()
        .and_then(|mut c| c.set_text(text))
        .map_err(|e| e.to_string())?;
    paste_into_previous_window(&app);
    Ok(())
}

fn paste_into_previous_window(app: &AppHandle) {
    crate::island::set_expanded(app, false);
    std::thread::sleep(Duration::from_millis(160));
    crate::island::restore_previous_window(app);
    std::thread::sleep(Duration::from_millis(90));
    unsafe {
        keybd_event(VK_CONTROL.0 as u8, 0, KEYBD_EVENT_FLAGS(0), 0);
        keybd_event(VK_V.0 as u8, 0, KEYBD_EVENT_FLAGS(0), 0);
        keybd_event(VK_V.0 as u8, 0, KEYEVENTF_KEYUP, 0);
        keybd_event(VK_CONTROL.0 as u8, 0, KEYEVENTF_KEYUP, 0);
    }
}

#[tauri::command]
pub fn clipboard_pin(app: AppHandle, id: String, state: State<'_, ClipState>) {
    {
        let mut items = state.items.lock().unwrap();
        if let Some(it) = items.iter_mut().find(|i| i.clip.id == id) {
            it.clip.pinned = !it.clip.pinned;
        }
        items.sort_by_key(|i| !i.clip.pinned);
    }
    emit_all(&app, &state);
}

#[tauri::command]
pub fn clipboard_remove(app: AppHandle, id: String, state: State<'_, ClipState>) {
    state.items.lock().unwrap().retain(|i| i.clip.id != id);
    emit_all(&app, &state);
}

/// Clears everything except pinned items.
#[tauri::command]
pub fn clipboard_clear(app: AppHandle, state: State<'_, ClipState>) {
    state.items.lock().unwrap().retain(|i| i.clip.pinned);
    emit_all(&app, &state);
}
