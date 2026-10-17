//! Start Menu app index + launching. Only things from the index (or a tiny built-in
//! list) can be launched, so the UI can never be talked into running arbitrary paths.

use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde::Serialize;
use tauri::{AppHandle, Manager, State};
use windows::core::{w, HSTRING, PCWSTR};
use windows::Win32::UI::Shell::ShellExecuteW;
use windows::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL;

#[derive(Clone, Serialize)]
pub struct AppEntry {
    name: String,
    path: String,
}

#[derive(Default)]
pub struct AppIndex {
    list: Mutex<Vec<AppEntry>>,
}

const BUILTIN: [&str; 4] = ["ms-settings:", "explorer.exe", "taskmgr.exe", "calc.exe"];

fn walk(dir: &Path, out: &mut Vec<AppEntry>, seen: &mut HashSet<String>) {
    let Ok(rd) = std::fs::read_dir(dir) else { return };
    for e in rd.flatten() {
        let p = e.path();
        if p.is_dir() {
            walk(&p, out, seen);
        } else if p.extension().map(|x| x.eq_ignore_ascii_case("lnk")).unwrap_or(false) {
            let Some(name) = p.file_stem().map(|s| s.to_string_lossy().to_string()) else { continue };
            let lower = name.to_lowercase();
            if lower.contains("uninstall") || !seen.insert(lower) {
                continue;
            }
            out.push(AppEntry { name, path: p.to_string_lossy().to_string() });
        }
    }
}

fn build_index() -> Vec<AppEntry> {
    let mut roots: Vec<PathBuf> = Vec::new();
    if let Ok(p) = std::env::var("ProgramData") {
        roots.push(PathBuf::from(p).join(r"Microsoft\Windows\Start Menu\Programs"));
    }
    if let Ok(p) = std::env::var("APPDATA") {
        roots.push(PathBuf::from(p).join(r"Microsoft\Windows\Start Menu\Programs"));
    }
    let (mut out, mut seen) = (Vec::new(), HashSet::new());
    for r in roots {
        walk(&r, &mut out, &mut seen);
    }
    out.sort_by_key(|a| a.name.to_lowercase());
    out
}

pub fn index_in_background(app: AppHandle) {
    std::thread::spawn(move || {
        let list = build_index();
        *app.state::<AppIndex>().list.lock().unwrap() = list;
    });
}

pub fn shell_open(target: &str) -> Result<(), String> {
    let t = HSTRING::from(target);
    let r = unsafe { ShellExecuteW(None, w!("open"), &t, PCWSTR::null(), PCWSTR::null(), SW_SHOWNORMAL) };
    if r.0 as isize > 32 {
        Ok(())
    } else {
        Err(format!("Windows couldn't open {target}"))
    }
}

#[tauri::command]
pub fn apps_list(state: State<'_, AppIndex>) -> Vec<AppEntry> {
    let mut list = state.list.lock().unwrap();
    if list.is_empty() {
        *list = build_index(); // index thread hadn't finished yet
    }
    list.clone()
}

#[tauri::command]
pub fn apps_launch(path: String, state: State<'_, AppIndex>) -> Result<(), String> {
    let known = BUILTIN.contains(&path.as_str())
        || state.list.lock().unwrap().iter().any(|a| a.path == path)
        || is_recent_shortcut(&path);
    if !known {
        return Err("That app isn't in the index".into());
    }
    shell_open(&path)
}

fn recent_dir() -> Option<PathBuf> {
    std::env::var("APPDATA").ok().map(|p| PathBuf::from(p).join(r"Microsoft\Windows\Recent"))
}

fn is_recent_shortcut(path: &str) -> bool {
    let Some(dir) = recent_dir() else { return false };
    let p = Path::new(path);
    p.starts_with(&dir) && p.extension().map(|e| e.eq_ignore_ascii_case("lnk")).unwrap_or(false)
}

/// Files you opened recently (Windows' own Recent folder), newest first.
#[tauri::command(async)]
pub fn recent_files() -> Vec<AppEntry> {
    let Some(dir) = recent_dir() else { return vec![] };
    let Ok(rd) = std::fs::read_dir(&dir) else { return vec![] };
    let mut found: Vec<(std::time::SystemTime, AppEntry)> = rd
        .flatten()
        .filter_map(|e| {
            let p = e.path();
            if !p.extension()?.eq_ignore_ascii_case("lnk") {
                return None;
            }
            let when = e.metadata().ok()?.modified().ok()?;
            let name = p.file_stem()?.to_string_lossy().to_string();
            Some((when, AppEntry { name, path: p.to_string_lossy().to_string() }))
        })
        .collect();
    found.sort_by(|a, b| b.0.cmp(&a.0));
    found.into_iter().take(40).map(|(_, a)| a).collect()
}
