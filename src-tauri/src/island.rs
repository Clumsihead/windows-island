//! The island's brain: one fixed-size transparent window that never resizes.
//! The UI morphs inside it; this module decides *when* (hover, hotkey, blur)
//! and makes the transparent parts of the window click-through.

use std::error::Error;
use std::sync::atomic::{AtomicBool, AtomicIsize, Ordering::SeqCst};
use std::sync::Arc;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use serde::Serialize;
use tauri::{AppHandle, Emitter, LogicalSize, Manager, PhysicalPosition, State, WebviewWindow};
use windows::Win32::Foundation::{HWND, POINT};
use windows::Win32::UI::Input::KeyboardAndMouse::{GetAsyncKeyState, VK_LBUTTON};
use windows::Win32::UI::WindowsAndMessaging::{
    GetCursorPos, GetForegroundWindow, GetWindowLongPtrW, SetForegroundWindow, SetWindowLongPtrW,
    ShowWindow, GWL_EXSTYLE, SW_HIDE, SW_SHOWNOACTIVATE, WS_EX_TOOLWINDOW, WS_EX_TRANSPARENT,
};

pub const LABEL: &str = "island";

/// Hover must last this long before the island opens (stops accidental flicks).
const HOVER_OPEN: Duration = Duration::from_millis(90);
/// When the island is tucked away at the top edge, require a longer hover so brushing past the top
/// of an app (tabs, title-bar buttons) doesn't open it by accident.
const HOVER_OPEN_TUCKED: Duration = Duration::from_millis(350);
/// Cursor must stay away this long before it closes again.
const LEAVE_CLOSE: Duration = Duration::from_millis(220);

#[derive(Clone, Copy)]
pub struct Rect {
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
}

pub struct Island {
    pub expanded: AtomicBool,
    /// Keep open regardless of the cursor (file dialogs, etc.).
    pub pinned: AtomicBool,
    /// Opened with the hotkey: ignore mouse-leave, close on blur / Esc instead.
    pub held: AtomicBool,
    /// The window that was in front before the hotkey took focus, so "paste" can give it back.
    pub prev_fg: AtomicIsize,
    pub visible: AtomicBool,
    pub hide_pending: AtomicBool,
    pub desktop_only: AtomicBool,
    pub desktop_active: AtomicBool,
    /// "Everywhere" mode with another app in front: only the island's bottom edge shows.
    pub tucked: AtomicBool,
    /// Lets the sole foreground monitor stop promptly during application exit.
    pub foreground_running: Arc<AtomicBool>,
    /// Shown over an app because the hotkey was pressed.
    pub forced: AtomicBool,
    pub click_through: AtomicBool,
    /// Logical px, relative to the window: the island's *target* shape.
    pub rect: Mutex<Rect>,
    /// Window top-left in physical px + monitor scale factor.
    pub origin: Mutex<(i32, i32, f64)>,
}

impl Island {
    pub fn new() -> Self {
        Self {
            expanded: AtomicBool::new(false),
            pinned: AtomicBool::new(false),
            held: AtomicBool::new(false),
            prev_fg: AtomicIsize::new(0),
            visible: AtomicBool::new(false),
            hide_pending: AtomicBool::new(false),
            // Default to showing the island over every foreground window.
            // Desktop-only behavior remains an explicit tray-menu option.
            desktop_only: AtomicBool::new(false),
            desktop_active: AtomicBool::new(false),
            tucked: AtomicBool::new(false),
            foreground_running: Arc::new(AtomicBool::new(true)),
            forced: AtomicBool::new(false),
            click_through: AtomicBool::new(true),
            rect: Mutex::new(Rect {
                x: 140.0,
                y: 0.0,
                w: 280.0,
                h: 44.0,
            }),
            origin: Mutex::new((0, 0, 1.0)),
        }
    }
}

/// Sets / clears extended window-style bits directly through Win32.
///
/// IMPORTANT: after `prepare`, nothing may call tao's `set_ignore_cursor_events`,
/// `hide` or `show`. tao keeps its own copy of the window flags (including "visible")
/// and rewrites the whole window style from that copy whenever one of them changes.
/// Because we show the window with a raw `ShowWindow`, tao still believes it is hidden,
/// so its rewrite strips WS_VISIBLE and the island vanishes the moment you hover it.
fn set_ex_bits(win: &WebviewWindow, set: u32, clear: u32) {
    let Ok(h) = win.hwnd() else { return };
    let hwnd = HWND(h.0 as _);
    unsafe {
        let ex = GetWindowLongPtrW(hwnd, GWL_EXSTYLE) as u32;
        let new = (ex & !clear) | set;
        if new != ex {
            SetWindowLongPtrW(hwnd, GWL_EXSTYLE, new as isize);
        }
    }
}

/// Toggles only WS_EX_TRANSPARENT (keeps the layered state tao set up in `prepare`).
fn set_click_through(win: &WebviewWindow, on: bool) {
    if on {
        set_ex_bits(win, WS_EX_TRANSPARENT.0, 0);
    } else {
        set_ex_bits(win, 0, WS_EX_TRANSPARENT.0);
    }
}

fn hide_raw(win: &WebviewWindow) {
    if let Ok(h) = win.hwnd() {
        unsafe {
            let _ = ShowWindow(HWND(h.0 as _), SW_HIDE);
        }
    }
}

/// One-time window setup: click-through, hidden from Alt+Tab.
pub fn prepare(win: &WebviewWindow) -> Result<(), Box<dyn Error>> {
    // Let tao apply the layered + click-through state once, while the window is still
    // hidden and its bookkeeping is consistent. This rewrites the extended styles, so
    // our own bits must be added afterwards.
    win.set_ignore_cursor_events(true)?;
    set_ex_bits(win, WS_EX_TOOLWINDOW.0, 0);
    Ok(())
}

/// Centre the window on the top edge of the primary monitor.
fn place(win: &WebviewWindow, st: &Island) {
    let Ok(Some(m)) = win.primary_monitor() else {
        return;
    };
    let Ok(size) = win.outer_size() else { return };
    let x = m.position().x + (m.size().width as i32 - size.width as i32) / 2;
    let y = m.position().y;
    let _ = win.set_position(PhysicalPosition::new(x, y));
    *st.origin.lock().unwrap() = (x, y, m.scale_factor());
}

/// Window size at UI scale 1.0, in logical px. Keep in sync with BASE_W / BASE_H in App.tsx
/// and the window size in tauri.conf.json.
const BASE_W: f64 = 1320.0;
const BASE_H: f64 = 760.0;

/// The UI scales itself with a CSS transform; this shrinks or grows the transparent window to
/// match, so a small island doesn't leave a huge invisible window on the screen.
pub fn set_scale(app: &AppHandle, scale: f64) {
    let Some(win) = app.get_webview_window(LABEL) else {
        return;
    };
    let s = scale.clamp(0.4, 1.4);
    let _ = win.set_size(LogicalSize::new((BASE_W * s).ceil(), (BASE_H * s).ceil()));
    place(&win, &app.state::<Island>());
}

#[tauri::command]
pub fn island_set_scale(app: AppHandle, scale: f64) {
    set_scale(&app, scale);
}

fn show_noactivate(win: &WebviewWindow) {
    if let Ok(h) = win.hwnd() {
        unsafe {
            let _ = ShowWindow(HWND(h.0 as _), SW_SHOWNOACTIVATE);
        }
    }
}

/// Single place that decides whether the window is on screen at all.
pub fn apply_visibility(app: &AppHandle) {
    refresh_tucked(app);
    let st = app.state::<Island>();
    let Some(win) = app.get_webview_window(LABEL) else {
        return;
    };
    let want =
        !st.desktop_only.load(SeqCst) || st.desktop_active.load(SeqCst) || st.forced.load(SeqCst);
    let visible = st.visible.load(SeqCst);

    if want && !visible {
        place(&win, &st);
        show_noactivate(&win);
        st.visible.store(true, SeqCst);
    } else if !want && visible && !st.hide_pending.swap(true, SeqCst) {
        if st.expanded.load(SeqCst) {
            set_expanded(app, false);
        }
        // Let the close spring finish. Re-check policy before hiding so a quick
        // return to the desktop cannot be hidden by a stale delayed operation.
        let app = app.clone();
        std::thread::spawn(move || {
            std::thread::sleep(Duration::from_millis(500));
            let st = app.state::<Island>();
            let still_wanted = !st.desktop_only.load(SeqCst)
                || st.desktop_active.load(SeqCst)
                || st.forced.load(SeqCst);
            if !still_wanted && st.visible.load(SeqCst) && !st.expanded.load(SeqCst) {
                if let Some(win) = app.get_webview_window(LABEL) {
                    hide_raw(&win);
                }
                st.visible.store(false, SeqCst);
            }
            st.hide_pending.store(false, SeqCst);
        });
    }
}

pub fn set_expanded(app: &AppHandle, next: bool) {
    let st = app.state::<Island>();
    if st.expanded.swap(next, SeqCst) == next {
        return;
    }
    if !next {
        st.held.store(false, SeqCst);
    }
    let _ = app.emit("island:expanded", next);

    // If the hotkey summoned us over an app, hide again once the collapse animation is done.
    if !next && st.forced.load(SeqCst) {
        let app = app.clone();
        std::thread::spawn(move || {
            std::thread::sleep(Duration::from_millis(500));
            let st = app.state::<Island>();
            if !st.expanded.load(SeqCst) {
                st.forced.store(false, SeqCst);
                apply_visibility(&app);
            }
        });
    }
}

/// In "everywhere" mode, while another app is in front, the island tucks up so that only its
/// bottom edge peeks out at the top of the screen. The UI does the sliding; this says when.
fn refresh_tucked(app: &AppHandle) {
    let st = app.state::<Island>();
    let tucked = !st.desktop_only.load(SeqCst)
        && !st.desktop_active.load(SeqCst)
        && !st.forced.load(SeqCst);
    if st.tucked.swap(tucked, SeqCst) != tucked {
        let _ = app.emit("island:tucked", tucked);
    }
}

pub fn set_desktop_only(app: &AppHandle, on: bool) {
    app.state::<Island>().desktop_only.store(on, SeqCst);
    crate::foreground::recheck(app);
    apply_visibility(app);
}

/// Ctrl+Alt+Shift+I / tray "Toggle island".
pub fn hotkey(app: &AppHandle) {
    let st = app.state::<Island>();
    if st.expanded.load(SeqCst) {
        set_expanded(app, false);
        return;
    }
    if st.desktop_only.load(SeqCst) && !st.desktop_active.load(SeqCst) {
        st.forced.store(true, SeqCst);
    }
    remember_foreground(app);
    apply_visibility(app);
    st.held.store(true, SeqCst);
    set_expanded(app, true);
    // A deliberate keyboard summon may focus the island so Esc and keyboard
    // interaction work. Its own HWND is classified as neutral by foreground.rs,
    // so this cannot overwrite the last real desktop/application state. Hover
    // reveal never focuses the window.
    if let Some(window) = app.get_webview_window(LABEL) {
        let _ = window.set_focus();
    }
}

/// Notes which window is in front right now (unless it is the island itself).
fn remember_foreground(app: &AppHandle) {
    let fg = unsafe { GetForegroundWindow() };
    if fg.0.is_null() {
        return;
    }
    let own = app
        .get_webview_window(LABEL)
        .and_then(|w| w.hwnd().ok())
        .map(|h| h.0 as isize);
    if own != Some(fg.0 as isize) {
        app.state::<Island>().prev_fg.store(fg.0 as isize, SeqCst);
    }
}

/// Gives focus back to the window that was active before the island took it.
pub fn restore_previous_window(app: &AppHandle) {
    let prev = app.state::<Island>().prev_fg.swap(0, SeqCst);
    if prev != 0 {
        unsafe {
            let _ = SetForegroundWindow(HWND(prev as _));
        }
    }
}

/// Ctrl+Alt+A and similar: open the island straight onto a tab.
pub fn open_tab(app: &AppHandle, tab: &str) {
    if !app.state::<Island>().expanded.load(SeqCst) {
        hotkey(app);
    }
    let _ = app.emit("island:goto", tab.to_string());
}

pub fn on_blur(app: &AppHandle) {
    let st = app.state::<Island>();
    // Blur is the dismissal policy for keyboard-summoned (held) opens only.
    // Hover-opened islands are non-activating and dismiss through the cursor
    // leave timer; transient focus changes must not collapse them.
    if should_collapse_on_blur(
        st.expanded.load(SeqCst),
        st.held.load(SeqCst),
        st.pinned.load(SeqCst),
    ) {
        set_expanded(app, false);
    }
}

fn should_collapse_on_blur(expanded: bool, held: bool, pinned: bool) -> bool {
    expanded && held && !pinned
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn blur_only_dismisses_unpinned_keyboard_summons() {
        assert!(should_collapse_on_blur(true, true, false));
        assert!(!should_collapse_on_blur(true, false, false));
        assert!(!should_collapse_on_blur(true, true, true));
        assert!(!should_collapse_on_blur(false, true, false));
    }

    #[test]
    fn desktop_only_visibility_is_off_by_default() {
        assert!(!Island::new().desktop_only.load(SeqCst));
    }
}

/// Polls the cursor (cheap) because a click-through window gets no mouse events.
pub fn start_hover_loop(app: AppHandle) {
    std::thread::spawn(move || {
        let Some(win) = app.get_webview_window(LABEL) else {
            return;
        };
        let mut in_since: Option<Instant> = None;
        let mut out_since: Option<Instant> = None;

        loop {
            std::thread::sleep(Duration::from_millis(8));
            let st = app.state::<Island>();
            if !st.visible.load(SeqCst) {
                in_since = None;
                out_since = None;
                continue;
            }
            // Pointer hover only reveals the island on the desktop. When the
            // hotkey forces it over an app, only held/pinned state controls it.
            if st.desktop_only.load(SeqCst)
                && !st.desktop_active.load(SeqCst)
                && !st.forced.load(SeqCst)
            {
                in_since = None;
                out_since = None;
                continue;
            }

            let mut pt = POINT::default();
            if unsafe { GetCursorPos(&mut pt) }.is_err() {
                continue;
            }
            let (ox, oy, scale) = *st.origin.lock().unwrap();
            let r = *st.rect.lock().unwrap();
            let cx = (pt.x - ox) as f64 / scale;
            let cy = (pt.y - oy) as f64 / scale;
            let expanded = st.expanded.load(SeqCst);

            let slop = if expanded { 14.0 } else { 4.0 };
            let soft =
                cx >= r.x - slop && cx <= r.x + r.w + slop && cy >= -2.0 && cy <= r.y + r.h + slop;
            let strict = cx >= r.x && cx <= r.x + r.w && cy >= 0.0 && cy <= r.y + r.h;
            let dragging = unsafe { GetAsyncKeyState(VK_LBUTTON.0 as i32) } < 0;

            if !expanded {
                out_since = None;
                if soft && !dragging {
                    let t = *in_since.get_or_insert_with(Instant::now);
                    let need = if st.tucked.load(SeqCst) { HOVER_OPEN_TUCKED } else { HOVER_OPEN };
                    if t.elapsed() >= need {
                        set_expanded(&app, true);
                        in_since = None;
                    }
                } else {
                    in_since = None;
                }
            } else {
                in_since = None;
                if soft || st.held.load(SeqCst) || st.pinned.load(SeqCst) {
                    out_since = None;
                } else {
                    let t = *out_since.get_or_insert_with(Instant::now);
                    if t.elapsed() >= LEAVE_CLOSE {
                        set_expanded(&app, false);
                        out_since = None;
                    }
                }
            }

            // Only the island itself captures the mouse; the rest of the window is invisible to clicks.
            let want_ct = !(st.expanded.load(SeqCst) && strict);
            if st.click_through.swap(want_ct, SeqCst) != want_ct {
                set_click_through(&win, want_ct);
            }
        }
    });
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IslandInfo {
    expanded: bool,
    /// opened with the keyboard (so the UI should skip the media "peek" card)
    held: bool,
    /// only the bottom edge is showing ("everywhere" mode, another app in front)
    tucked: bool,
}

#[tauri::command]
pub fn island_get(st: State<'_, Island>) -> IslandInfo {
    IslandInfo {
        expanded: st.expanded.load(SeqCst),
        held: st.held.load(SeqCst),
        tucked: st.tucked.load(SeqCst),
    }
}

#[tauri::command]
pub fn island_set_rect(x: f64, y: f64, w: f64, h: f64, st: State<'_, Island>) {
    *st.rect.lock().unwrap() = Rect { x, y, w, h };
}

#[tauri::command]
pub fn island_set_expanded(app: AppHandle, expanded: bool) {
    set_expanded(&app, expanded);
}

#[tauri::command]
pub fn island_set_pinned(pinned: bool, st: State<'_, Island>) {
    st.pinned.store(pinned, SeqCst);
}
