use std::os::windows::process::CommandExt;
use std::path::Path;
use std::process::Command;

use windows::Win32::UI::WindowsAndMessaging::{
    SystemParametersInfoW, SPIF_SENDCHANGE, SPIF_UPDATEINIFILE, SPI_SETDESKWALLPAPER,
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
