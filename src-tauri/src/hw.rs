//! Small hardware / OS toggles: screen brightness, dark mode, current network.

use std::os::windows::process::CommandExt;
use std::process::Command;

use serde::Serialize;

const CREATE_NO_WINDOW: u32 = 0x0800_0000;
const PERSONALIZE: &str = r"HKCU\Software\Microsoft\Windows\CurrentVersion\Themes\Personalize";

fn powershell(script: &str) -> Option<String> {
    let out = Command::new("powershell")
        .args(["-NoProfile", "-NonInteractive", "-Command", script])
        .creation_flags(CREATE_NO_WINDOW)
        .output()
        .ok()?;
    if !out.status.success() {
        return None;
    }
    Some(String::from_utf8_lossy(&out.stdout).trim().to_string())
}

/// Laptop panels only (WMI). Returns None on desktops / external monitors.
#[tauri::command]
pub async fn brightness_get() -> Option<u8> {
    tauri::async_runtime::spawn_blocking(|| {
        powershell(
            "(Get-CimInstance -Namespace root/WMI -ClassName WmiMonitorBrightness -ErrorAction SilentlyContinue | Select-Object -First 1).CurrentBrightness",
        )
        .and_then(|s| s.parse::<u8>().ok())
    })
    .await
    .ok()
    .flatten()
}

#[tauri::command]
pub async fn brightness_set(percent: u8) -> Result<(), String> {
    let p = percent.min(100);
    tauri::async_runtime::spawn_blocking(move || {
        let script = format!(
            "$m = Get-CimInstance -Namespace root/WMI -ClassName WmiMonitorBrightnessMethods -ErrorAction Stop | Select-Object -First 1; Invoke-CimMethod -InputObject $m -MethodName WmiSetBrightness -Arguments @{{Timeout=1;Brightness={p}}} | Out-Null"
        );
        powershell(&script)
            .map(|_| ())
            .ok_or_else(|| "Brightness isn't supported on this display".to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

fn reg_dword(name: &str) -> Option<u32> {
    let out = Command::new("reg")
        .args(["query", PERSONALIZE, "/v", name])
        .creation_flags(CREATE_NO_WINDOW)
        .output()
        .ok()?;
    let text = String::from_utf8_lossy(&out.stdout).to_string();
    let hex = text.split_whitespace().rev().find(|w| w.starts_with("0x"))?.to_string();
    u32::from_str_radix(hex.trim_start_matches("0x"), 16).ok()
}

#[tauri::command(async)]
pub fn dark_mode_get() -> bool {
    reg_dword("AppsUseLightTheme").map(|v| v == 0).unwrap_or(false)
}

#[tauri::command(async)]
pub fn dark_mode_set(dark: bool) -> Result<(), String> {
    let value = if dark { "0" } else { "1" };
    for name in ["AppsUseLightTheme", "SystemUsesLightTheme"] {
        Command::new("reg")
            .args(["add", PERSONALIZE, "/v", name, "/t", "REG_DWORD", "/d", value, "/f"])
            .creation_flags(CREATE_NO_WINDOW)
            .output()
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[derive(Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct NetInfo {
    /// "wifi", "ethernet", or "" when offline
    kind: String,
    name: String,
}

fn read_net() -> windows::core::Result<NetInfo> {
    use windows::Networking::Connectivity::NetworkInformation;
    let profile = NetworkInformation::GetInternetConnectionProfile()?;
    let wifi = profile.IsWlanConnectionProfile()?;
    Ok(NetInfo {
        kind: if wifi { "wifi".into() } else { "ethernet".into() },
        name: profile.ProfileName()?.to_string(),
    })
}

#[tauri::command]
pub async fn network_info() -> NetInfo {
    tauri::async_runtime::spawn_blocking(|| read_net().unwrap_or_default())
        .await
        .unwrap_or_default()
}
