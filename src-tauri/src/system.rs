use std::os::windows::process::CommandExt;
use std::path::Path;
use std::process::Command;

use windows::Win32::UI::WindowsAndMessaging::{
    SystemParametersInfoW, SPIF_SENDCHANGE, SPIF_UPDATEINIFILE, SPI_GETDESKWALLPAPER,
    SPI_SETDESKWALLPAPER, SYSTEM_PARAMETERS_INFO_UPDATE_FLAGS,
};

use crate::apps::shell_open;

const CREATE_NO_WINDOW: u32 = 0x0800_0000;

#[tauri::command]
pub fn open_settings(page: String) -> Result<(), String> {
    let uri = match page.as_str() {
        "wifi" => "ms-settings:network-wifi",
        "bluetooth" => "ms-settings:bluetooth",
        "sound" => "ms-settings:sound",
        "display" => "ms-settings:display",
        "nightlight" => "ms-settings:nightlight",
        "battery" => "ms-settings:batterysaver",
        _ => return Err("Unsupported settings page".into()),
    };
    shell_open(uri)
}

#[tauri::command]
pub fn wallpaper_set(path: String) -> Result<(), String> {
    let p = Path::new(&path);
    if !p.is_absolute() || !p.is_file() {
        return Err("Pick an existing image file".into());
    }
    let ok_ext = p
        .extension()
        .map(|e| {
            let e = e.to_string_lossy().to_lowercase();
            ["jpg", "jpeg", "png", "bmp"].contains(&e.as_str())
        })
        .unwrap_or(false);
    if !ok_ext {
        return Err("Use a .jpg, .png or .bmp image".into());
    }
    let mut wide: Vec<u16> = path.encode_utf16().collect();
    wide.push(0);
    unsafe {
        SystemParametersInfoW(
            SPI_SETDESKWALLPAPER,
            0,
            Some(wide.as_mut_ptr() as *mut _),
            SPIF_UPDATEINIFILE | SPIF_SENDCHANGE,
        )
        .map_err(|e| e.to_string())
    }
}

#[tauri::command]
pub fn power_action(action: String) -> Result<(), String> {
    let (exe, args): (&str, &[&str]) = match action.as_str() {
        "lock" => ("rundll32.exe", &["user32.dll,LockWorkStation"]),
        "sleep" => ("rundll32.exe", &["powrprof.dll,SetSuspendState", "0,1,0"]),
        "restart" => ("shutdown.exe", &["/r", "/t", "0"]),
        "shutdown" => ("shutdown.exe", &["/s", "/t", "0"]),
        _ => return Err("Unsupported power action".into()),
    };
    Command::new(exe)
        .args(args)
        .creation_flags(CREATE_NO_WINDOW)
        .spawn()
        .map(|_| ())
        .map_err(|e| e.to_string())
}

/// Path of the current desktop wallpaper.
#[tauri::command]
pub fn wallpaper_get() -> Option<String> {
    let mut buf = [0u16; 520];
    unsafe {
        SystemParametersInfoW(
            SPI_GETDESKWALLPAPER,
            buf.len() as u32,
            Some(buf.as_mut_ptr() as *mut _),
            SYSTEM_PARAMETERS_INFO_UPDATE_FLAGS(0),
        )
        .ok()?;
    }
    let n = buf.iter().position(|&c| c == 0).unwrap_or(buf.len());
    let s = String::from_utf16_lossy(&buf[..n]);
    if s.is_empty() { None } else { Some(s) }
}

fn is_wallpaper_ext(p: &Path) -> bool {
    p.extension()
        .map(|e| {
            let e = e.to_string_lossy().to_lowercase();
            ["jpg", "jpeg", "png", "bmp"].contains(&e.as_str())
        })
        .unwrap_or(false)
}

/// Images in a folder, newest first.
#[tauri::command(async)]
pub fn list_images(dir: String) -> Vec<String> {
    let Ok(rd) = std::fs::read_dir(&dir) else { return vec![] };
    let mut found: Vec<(std::time::SystemTime, String)> = rd
        .flatten()
        .filter_map(|e| {
            let p = e.path();
            if !p.is_file() || !is_wallpaper_ext(&p) {
                return None;
            }
            let when = e.metadata().ok()?.modified().ok()?;
            Some((when, p.to_string_lossy().to_string()))
        })
        .collect();
    found.sort_by(|a, b| b.0.cmp(&a.0));
    found.into_iter().take(80).map(|(_, p)| p).collect()
}

/// A few of the wallpapers that ship with Windows, to seed the "Recent" row.
#[tauri::command(async)]
pub fn default_wallpapers() -> Vec<String> {
    let root = std::env::var("SystemRoot").unwrap_or_else(|_| r"C:\Windows".into());
    let Ok(rd) = std::fs::read_dir(Path::new(&root).join(r"Web\Wallpaper")) else { return vec![] };
    let mut out = Vec::new();
    for sub in rd.flatten() {
        if let Ok(files) = std::fs::read_dir(sub.path()) {
            for f in files.flatten() {
                let p = f.path();
                if p.is_file() && is_wallpaper_ext(&p) {
                    out.push(p.to_string_lossy().to_string());
                }
            }
        }
    }
    out.truncate(8);
    out
}
