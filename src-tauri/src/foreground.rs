//! "Is the desktop showing?" for the desktop-only visibility policy.
//!
//! Earlier versions asked *which window is in front* and classified its class name.
//! That is fragile: Win+D and "minimize all" hand focus to a rotating cast of shell
//! windows (taskbar, ForegroundStaging, ...), and hovering the island lets WebView2's
//! own helper windows grab focus, which looked like "an app is in front" and hid us.
//!
//! This version asks a steadier question instead: is there any real, visible,
//! non-minimised application window on the primary monitor? If not, the desktop is
//! showing. Focus is never consulted, so none of the above can fool it.

use std::ffi::c_void;
use std::sync::atomic::{AtomicBool, Ordering::SeqCst};
use std::time::Duration;

use tauri::{AppHandle, Manager};
use windows::Win32::Foundation::{CloseHandle, HWND, RECT};
use windows::Win32::Graphics::Dwm::{DwmGetWindowAttribute, DWMWA_CLOAKED};
use windows::Win32::System::Threading::{
    OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_WIN32, PROCESS_QUERY_LIMITED_INFORMATION,
};
use windows::Win32::UI::WindowsAndMessaging::{
    GetClassNameW, GetDesktopWindow, GetSystemMetrics, GetWindow, GetWindowLongPtrW, GetWindowRect,
    GetWindowTextLengthW, GetWindowThreadProcessId, IsIconic, IsWindowVisible, GWL_EXSTYLE, GW_CHILD,
    GW_HWNDNEXT, SM_CXSCREEN, SM_CYSCREEN, WS_EX_NOACTIVATE, WS_EX_TOOLWINDOW, WS_EX_TRANSPARENT,
};

use crate::island::{apply_visibility, Island};

/// Set by `recheck` to commit the next sample immediately (no debounce).
static FAST: AtomicBool = AtomicBool::new(false);

const POLL: Duration = Duration::from_millis(120);
/// Consecutive agreeing samples needed before the state flips (hysteresis).
const SAMPLES_TO_SHOW: u32 = 3; // ~360 ms: ride out the minimise animation
const SAMPLES_TO_HIDE: u32 = 2; // ~240 ms

/// Windows that exist but are shell chrome, not applications.
const IGNORED_CLASSES: &[&str] = &[
    "Progman",
    "WorkerW",
    "Shell_TrayWnd",
    "Shell_SecondaryTrayWnd",
    "ForegroundStaging",
    "MultitaskingViewFrame",
    "TaskSwitcherWnd",
    "Windows.UI.Core.CoreWindow",
    "XamlExplorerHostIslandWindow",
    "TopLevelWindowForOverflowXamlIsland",
    "NotifyIconOverflowWindow",
    "TaskListThumbnailWnd",
    "Shell_InputSwitchTopLevelWindow",
    "Windows.UI.Composition.DesktopWindowContentBridge",
];

/// `GetWindow` returns `Result<HWND>` in recent `windows` crates and a bare `HWND` in
/// older ones; this lets the loop below compile against either.
trait AsHwnd {
    fn hwnd(self) -> Option<HWND>;
}
impl AsHwnd for HWND {
    fn hwnd(self) -> Option<HWND> {
        if self.0.is_null() { None } else { Some(self) }
    }
}
impl AsHwnd for windows::core::Result<HWND> {
    fn hwnd(self) -> Option<HWND> {
        self.ok().filter(|h| !h.0.is_null())
    }
}

fn class_of(h: HWND) -> String {
    let mut buf = [0u16; 96];
    let n = unsafe { GetClassNameW(h, &mut buf) };
    if n <= 0 {
        return String::new();
    }
    String::from_utf16_lossy(&buf[..n as usize])
}

fn exe_of(pid: u32) -> String {
    let Ok(process) = (unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid) }) else {
        return String::new();
    };
    let mut path = [0u16; 1024];
    let mut len = path.len() as u32;
    let result = unsafe {
        QueryFullProcessImageNameW(
            process,
            PROCESS_NAME_WIN32,
            windows::core::PWSTR(path.as_mut_ptr()),
            &mut len,
        )
    };
    let _ = unsafe { CloseHandle(process) };
    if result.is_err() {
        return String::new();
    }
    let full = String::from_utf16_lossy(&path[..len as usize]);
    full.rsplit(['\\', '/']).next().unwrap_or_default().to_string()
}

/// If `h` is a real application window that covers part of the primary monitor,
/// returns a short description of it (used for logging).
fn blocks(h: HWND, screen_w: i32, screen_h: i32, own_pid: u32) -> Option<String> {
    if !unsafe { IsWindowVisible(h) }.as_bool() || unsafe { IsIconic(h) }.as_bool() {
        return None;
    }
    // Tool windows, click-through overlays and non-activating widgets aren't "apps".
    let ex = unsafe { GetWindowLongPtrW(h, GWL_EXSTYLE) } as u32;
    if ex & (WS_EX_TOOLWINDOW.0 | WS_EX_NOACTIVATE.0 | WS_EX_TRANSPARENT.0) != 0 {
        return None;
    }
    if unsafe { GetWindowTextLengthW(h) } == 0 {
        return None;
    }
    // Windows parked on other virtual desktops / suspended UWP frames are "cloaked".
    let mut cloaked = 0u32;
    let _ = unsafe {
        DwmGetWindowAttribute(h, DWMWA_CLOAKED, &mut cloaked as *mut u32 as *mut c_void, 4)
    };
    if cloaked != 0 {
        return None;
    }
    let mut r = RECT::default();
    if unsafe { GetWindowRect(h, &mut r) }.is_err() {
        return None;
    }
    let w = r.right.min(screen_w) - r.left.max(0);
    let hgt = r.bottom.min(screen_h) - r.top.max(0);
    if w < 100 || hgt < 60 {
        return None; // off-screen or sliver
    }

    let mut pid = 0u32;
    unsafe { GetWindowThreadProcessId(h, Some(&mut pid)) };
    if pid == own_pid {
        return None;
    }
    let class = class_of(h);
    if IGNORED_CLASSES.contains(&class.as_str()) {
        return None;
    }
    let exe = exe_of(pid);
    // WebView2's helper processes belong to us; they must never count as an app.
    if exe.eq_ignore_ascii_case("msedgewebview2.exe") {
        return None;
    }
    Some(format!("{class} ({exe})"))
}

/// Walks every top-level window, top of the Z-order down.
fn find_blocker() -> Option<String> {
    let (sw, sh) = unsafe { (GetSystemMetrics(SM_CXSCREEN), GetSystemMetrics(SM_CYSCREEN)) };
    let own = std::process::id();
    let mut cur = unsafe { GetWindow(GetDesktopWindow(), GW_CHILD) }.hwnd();
    let mut guard = 0;
    while let Some(h) = cur {
        guard += 1;
        if guard > 5000 {
            break;
        }
        cur = unsafe { GetWindow(h, GW_HWNDNEXT) }.hwnd();
        if let Some(desc) = blocks(h, sw, sh, own) {
            return Some(desc);
        }
    }
    None
}

pub fn start(app: AppHandle) {
    let running = app.state::<Island>().foreground_running.clone();
    let spawned = std::thread::Builder::new()
        .name("island-desktop-monitor".into())
        .spawn(move || {
            let mut committed: Option<bool> = None;
            let mut pending: Option<(bool, u32)> = None;

            while running.load(SeqCst) {
                let blocker = find_blocker();
                let desktop = blocker.is_none();
                let fast = FAST.swap(false, SeqCst);

                if committed == Some(desktop) {
                    pending = None;
                } else {
                    let need = if fast || committed.is_none() {
                        1
                    } else if desktop {
                        SAMPLES_TO_SHOW
                    } else {
                        SAMPLES_TO_HIDE
                    };
                    let count = match pending {
                        Some((d, n)) if d == desktop => n + 1,
                        _ => 1,
                    };
                    pending = Some((desktop, count));

                    if count >= need {
                        committed = Some(desktop);
                        pending = None;
                        eprintln!(
                            "[island] desktop showing = {desktop}  ({})",
                            blocker.as_deref().unwrap_or("no application windows open")
                        );
                        app.state::<Island>().desktop_active.store(desktop, SeqCst);
                        // Always apply (not only on change) so the very first result also
                        // shows or hides the window correctly.
                        apply_visibility(&app);
                    }
                }
                std::thread::sleep(POLL);
            }
        });
    if let Err(e) = spawned {
        eprintln!("[island] could not start desktop monitor: {e}");
    }
}

/// Called when the desktop-only preference changes: commit the next sample right away.
pub fn recheck(_app: &AppHandle) {
    FAST.store(true, SeqCst);
}
