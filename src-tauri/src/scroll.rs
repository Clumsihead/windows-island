//! Wheel capture for the scroll ladder (notch -> media card -> control panel -> other tabs).
//!
//! The island window is click-through while it sits in the notch, so Windows never sends it
//! WM_MOUSEWHEEL. A low-level mouse hook watches the wheel instead and reports one step whenever
//! the cursor is over the island. The callback always forwards the event to the next hook, so
//! scrolling the app underneath keeps working; nothing is ever swallowed.

use std::sync::atomic::{AtomicIsize, Ordering::SeqCst};
use std::sync::{Mutex, MutexGuard, OnceLock};
use std::time::{Duration, Instant};

use tauri::{AppHandle, Emitter, Manager};
use windows::Win32::Foundation::{HINSTANCE, LPARAM, LRESULT, WPARAM};
use windows::Win32::System::LibraryLoader::GetModuleHandleW;
use windows::Win32::UI::WindowsAndMessaging::{
    CallNextHookEx, GetMessageW, SetWindowsHookExW, UnhookWindowsHookEx, MSG, MSLLHOOKSTRUCT,
    WH_MOUSE_LL, WM_MOUSEWHEEL,
};

use crate::island::Island;

static APP: OnceLock<AppHandle> = OnceLock::new();
static HOOK: AtomicIsize = AtomicIsize::new(0);

/// A mouse notch is 120 units; touchpads send a stream of much smaller deltas, so the bar is set
/// well below one notch — a short two-finger flick must still move exactly one rung.
const STEP: i32 = 40;
/// One step per third of a second, so a single flick moves exactly one rung.
const COOLDOWN: Duration = Duration::from_millis(320);
/// How far outside the island's rectangle the pointer still counts as "over it".
const SLOP: f64 = 6.0;

static ACC: Mutex<Acc> = Mutex::new(Acc { sum: 0, last: None });

struct Acc {
    sum: i32,
    last: Option<Instant>,
}

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct WheelStep {
    /// 1 = scrolled down, -1 = up.
    dir: i32,
    /// Cursor in window-relative logical px, which is what the webview's CSS uses.
    x: f64,
    y: f64,
}

fn acc() -> MutexGuard<'static, Acc> {
    match ACC.lock() {
        Ok(g) => g,
        Err(poisoned) => poisoned.into_inner(),
    }
}

fn lock<T>(m: &Mutex<T>) -> MutexGuard<'_, T> {
    match m.lock() {
        Ok(g) => g,
        Err(poisoned) => poisoned.into_inner(),
    }
}

unsafe extern "system" fn hook(code: i32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
    // Keep this trivial: Windows waits on the callback before continuing mouse input.
    if code >= 0 && wparam.0 as u32 == WM_MOUSEWHEEL {
        if let Some(app) = APP.get() {
            observe(app, &*(lparam.0 as *const MSLLHOOKSTRUCT));
        }
    }
    CallNextHookEx(None, code, wparam, lparam)
}

fn observe(app: &AppHandle, info: &MSLLHOOKSTRUCT) {
    let st = app.state::<Island>();
    let (ox, oy, scale) = *lock(&st.origin);
    let r = *lock(&st.rect);
    let x = (info.pt.x - ox) as f64 / scale;
    let y = (info.pt.y - oy) as f64 / scale;

    if x < r.x - SLOP || x > r.x + r.w + SLOP || y < -SLOP || y > r.y + r.h + SLOP {
        acc().sum = 0;
        return;
    }

    // The high word of mouseData is a signed wheel delta.
    let delta = ((info.mouseData >> 16) & 0xffff) as u16 as i16 as i32;
    let mut a = acc();
    let now = Instant::now();
    if a.last.map(|t| now.duration_since(t) < COOLDOWN).unwrap_or(false) {
        a.sum = 0;
        return;
    }
    a.sum += delta;
    if a.sum.abs() < STEP {
        return;
    }
    let dir = if a.sum > 0 { 1 } else { -1 };
    a.sum = 0;
    a.last = Some(now);
    drop(a);

    let _ = app.emit("island:wheel", WheelStep { dir, x, y });
}

/// Installs the hook on its own thread (the callback runs there, so it needs a message pump).
pub fn start(app: AppHandle) {
    if APP.set(app).is_err() {
        return; // already watching
    }
    std::thread::spawn(move || unsafe {
        // A global low-level hook is registered against this module, not against a thread.
        let hmod = GetModuleHandleW(None).map(|m| HINSTANCE(m.0)).ok();
        let hook = match SetWindowsHookExW(WH_MOUSE_LL, Some(hook), hmod, 0) {
            Ok(h) => h,
            Err(e) => {
                eprintln!("Could not watch the mouse wheel for the scroll ladder: {e}");
                return;
            }
        };
        HOOK.store(hook.0 as isize, SeqCst);
        let mut msg = MSG::default();
        while GetMessageW(&mut msg, None, 0, 0).0 > 0 {
            // The hook does all the work; there is nothing to dispatch.
        }
        let _ = UnhookWindowsHookEx(hook);
        HOOK.store(0, SeqCst);
    });
}
