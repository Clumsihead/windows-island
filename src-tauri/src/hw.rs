//! Small hardware / OS toggles: screen brightness, dark mode, current network.

use std::io::{BufRead, BufReader};
use std::os::windows::process::CommandExt;
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicI32, Ordering::SeqCst};
use std::time::Duration;

use serde::Serialize;
use tauri::{AppHandle, Emitter};

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

/// Last brightness seen (0-100), or -1 if unknown. Kept fresh by the watcher below, so the UI
/// can read it instantly instead of launching PowerShell every time.
static BRIGHTNESS: AtomicI32 = AtomicI32::new(-1);

fn read_brightness() -> Option<u8> {
    powershell(
        "(Get-CimInstance -Namespace root/WMI -ClassName WmiMonitorBrightness -ErrorAction SilentlyContinue | Select-Object -First 1).CurrentBrightness",
    )
    .and_then(|s| s.parse::<u8>().ok())
}

/// Laptop panels only (WMI). Returns None on desktops / external monitors.
#[tauri::command]
pub async fn brightness_get() -> Option<u8> {
    let cached = BRIGHTNESS.load(SeqCst);
    if cached >= 0 {
        return Some(cached as u8);
    }
    let value = tauri::async_runtime::spawn_blocking(read_brightness).await.ok().flatten();
    if let Some(v) = value {
        BRIGHTNESS.store(v as i32, SeqCst);
    }
    value
}

#[tauri::command]
pub async fn brightness_set(percent: u8) -> Result<(), String> {
    let p = percent.min(100);
    tauri::async_runtime::spawn_blocking(move || {
        let script = format!(
            "$m = Get-CimInstance -Namespace root/WMI -ClassName WmiMonitorBrightnessMethods -ErrorAction Stop | Select-Object -First 1; Invoke-CimMethod -InputObject $m -MethodName WmiSetBrightness -Arguments @{{Timeout=1;Brightness={p}}} | Out-Null"
        );
        let ok = powershell(&script).is_some();
        if ok {
            BRIGHTNESS.store(p as i32, SeqCst);
        }
        if ok { Ok(()) } else { Err("Brightness isn't supported on this display".to_string()) }
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Runs inside one long-lived PowerShell. Windows raises WmiMonitorBrightnessEvent whenever the
/// brightness changes (Fn keys, the Settings slider, auto-brightness...); a 2-second fallback check
/// covers hardware that doesn't raise it. It prints the new value only when it actually changed, and
/// exits by itself if the island has gone, so it never outlives the app.
const WATCH_SCRIPT: &str = r#"
$ErrorActionPreference = 'SilentlyContinue'
$parentPid = PARENT_PID
Register-WmiEvent -Namespace root\wmi -Query 'SELECT * FROM WmiMonitorBrightnessEvent' -SourceIdentifier IslandBrightness | Out-Null
$last = -1
while ($true) {
  if (-not (Get-Process -Id $parentPid -ErrorAction SilentlyContinue)) { break }
  $e = Wait-Event -SourceIdentifier IslandBrightness -Timeout 2
  if ($e) { Remove-Event -EventIdentifier $e.EventIdentifier }
  $m = Get-CimInstance -Namespace root/WMI -ClassName WmiMonitorBrightness | Select-Object -First 1
  if ($m -ne $null -and $m.CurrentBrightness -ne $last) {
    $last = $m.CurrentBrightness
    [Console]::Out.WriteLine($last)
    [Console]::Out.Flush()
  }
}
"#;

/// Pushes "brightness:changed" to the UI whenever the screen brightness changes, however it was
/// changed. Does nothing (and starts no process) on PCs without a controllable built-in panel.
pub fn start_brightness_watcher(app: AppHandle) {
    std::thread::spawn(move || {
        let Some(first) = read_brightness() else { return };
        BRIGHTNESS.store(first as i32, SeqCst);
        let _ = app.emit("brightness:changed", first);

        let script = WATCH_SCRIPT.replace("PARENT_PID", &std::process::id().to_string());
        loop {
            let spawned = Command::new("powershell")
                .args(["-NoProfile", "-NonInteractive", "-Command", &script])
                .stdin(Stdio::null())
                .stdout(Stdio::piped())
                .stderr(Stdio::null())
                .creation_flags(CREATE_NO_WINDOW)
                .spawn();
            if let Ok(mut child) = spawned {
                if let Some(out) = child.stdout.take() {
                    for line in BufReader::new(out).lines().map_while(Result::ok) {
                        if let Ok(v) = line.trim().parse::<u8>() {
                            BRIGHTNESS.store(v as i32, SeqCst);
                            let _ = app.emit("brightness:changed", v);
                        }
                    }
                }
                let _ = child.wait();
            }
            std::thread::sleep(Duration::from_secs(10)); // it died: try again shortly
        }
    });
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
