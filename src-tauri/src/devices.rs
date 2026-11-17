//! Commands behind the Controls tab's expandable panels: battery, Wi-Fi networks,
//! Bluetooth devices and audio devices.

use std::os::windows::process::CommandExt;
use std::process::{Command, Stdio};

use base64::{engine::general_purpose::STANDARD as B64, Engine};
use serde::Serialize;

use crate::textutil;
use crate::winsys::{self, AudioDevices, Battery, BtDevice};

const CREATE_NO_WINDOW: u32 = 0x0800_0000;
const AUDIO_SCRIPT: &str = include_str!("scripts/audio_default.ps1");
const BLUETOOTH_SCRIPT: &str = include_str!("scripts/bt_toggle.ps1");

/// Runs a program hidden and returns (succeeded, its output).
fn run(cmd: &mut Command) -> Result<(bool, String), String> {
    let out = cmd
        .creation_flags(CREATE_NO_WINDOW)
        .stdin(Stdio::null())
        .output()
        .map_err(|e| format!("Couldn't start the program: {e}"))?;
    let mut text = String::from_utf8_lossy(&out.stdout).to_string();
    let err = String::from_utf8_lossy(&out.stderr);
    if !err.trim().is_empty() {
        text.push('\n');
        text.push_str(err.trim());
    }
    Ok((out.status.success(), text))
}

/// Runs PowerShell code. It is passed encoded, so nothing in it can be mangled by quoting.
fn powershell(script: &str) -> Result<String, String> {
    let utf16: Vec<u8> = script.encode_utf16().flat_map(|u| u.to_le_bytes()).collect();
    let encoded = B64.encode(utf16);
    let mut cmd = Command::new("powershell");
    cmd.arg("-NoProfile")
        .arg("-NonInteractive")
        .arg("-ExecutionPolicy")
        .arg("Bypass")
        .arg("-EncodedCommand")
        .arg(encoded.as_str());
    let (_, text) = run(&mut cmd)?;
    Ok(text)
}

fn first_line(text: &str) -> String {
    text.lines().map(|l| l.trim()).find(|l| !l.is_empty()).unwrap_or("Windows didn't say why").to_string()
}

fn said_ok(text: &str) -> bool {
    text.lines().any(|l| l.trim() == "ok")
}

// ---------------------------------------------------------------- battery

#[tauri::command]
pub async fn battery_get() -> Battery {
    tauri::async_runtime::spawn_blocking(winsys::battery).await.unwrap_or_default()
}

// ---------------------------------------------------------------- audio devices

#[tauri::command]
pub async fn audio_devices() -> Result<AudioDevices, String> {
    tauri::async_runtime::spawn_blocking(|| winsys::audio_devices().map_err(|e| e.to_string()))
        .await
        .map_err(|e| e.to_string())?
}

/// `id` is the device id the list gave us. Windows has no public call for this, so it goes through
/// the same internal interface the Sound settings page uses (inside a short-lived PowerShell).
#[tauri::command]
pub async fn audio_set_default(id: String) -> Result<(), String> {
    let endpoint = if textutil::valid_endpoint_id(&id) {
        Some(id.clone())
    } else {
        textutil::endpoint_id_from_path(&id)
    };
    let endpoint = endpoint.ok_or_else(|| "That isn't a valid audio device".to_string())?;
    let script = AUDIO_SCRIPT.replace("__ENDPOINT_ID__", &endpoint);
    let text = tauri::async_runtime::spawn_blocking(move || powershell(&script))
        .await
        .map_err(|e| e.to_string())??;
    if said_ok(&text) { Ok(()) } else { Err(first_line(&text)) }
}

// ---------------------------------------------------------------- bluetooth

#[tauri::command]
pub async fn bluetooth_devices() -> Result<Vec<BtDevice>, String> {
    tauri::async_runtime::spawn_blocking(|| winsys::bluetooth_devices().map_err(|e| e.to_string()))
        .await
        .map_err(|e| e.to_string())?
}

/// Best effort: Windows has no friendly call for connecting a paired device, so this switches the
/// device's audio services off (disconnect) or off-and-on (connect). Works for headphones and
/// headsets; other kinds of device usually need Windows' own Bluetooth settings.
#[tauri::command]
pub async fn bluetooth_set_connected(address: String, connect: bool) -> Result<(), String> {
    if !textutil::valid_bt_address(&address) {
        return Err("That isn't a valid Bluetooth address".into());
    }
    let script = BLUETOOTH_SCRIPT
        .replace("__ADDRESS__", &address)
        .replace("__CONNECT__", if connect { "$true" } else { "$false" });
    let text = tauri::async_runtime::spawn_blocking(move || powershell(&script))
        .await
        .map_err(|e| e.to_string())??;
    if said_ok(&text) { Ok(()) } else { Err(first_line(&text)) }
}

// ---------------------------------------------------------------- wi-fi

#[derive(Serialize)]
pub struct WifiRaw {
    networks: String,
    interfaces: String,
    profiles: String,
}

/// Read-only `netsh` queries. The UI turns the text into a list; this just fetches it
/// (in UTF-8, so network names with accents or emoji survive).
fn netsh_show(what: &str) -> String {
    let mut cmd = Command::new("cmd");
    cmd.raw_arg(format!("/C chcp 65001 >nul & netsh wlan show {what}"));
    run(&mut cmd).map(|(_, t)| t).unwrap_or_default()
}

#[tauri::command]
pub async fn wifi_scan() -> Result<WifiRaw, String> {
    tauri::async_runtime::spawn_blocking(|| WifiRaw {
        networks: netsh_show("networks mode=bssid"),
        interfaces: netsh_show("interfaces"),
        profiles: netsh_show("profiles"),
    })
    .await
    .map_err(|e| e.to_string())
}

fn netsh(args: String) -> Result<(), String> {
    let mut cmd = Command::new("netsh");
    cmd.raw_arg(args);
    let (ok, text) = run(&mut cmd)?;
    if ok { Ok(()) } else { Err(first_line(&text)) }
}

/// `saved` = Windows already has a profile (and password) for this network. Otherwise a profile is
/// created from `password` first. The temporary profile file is deleted straight away.
#[tauri::command]
pub async fn wifi_connect(ssid: String, password: Option<String>, security: String, saved: bool) -> Result<(), String> {
    if !textutil::valid_wifi_name(&ssid) {
        return Err("That network name can't be used".into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        if !saved {
            let xml = textutil::wifi_profile_xml(&ssid, password.as_deref().filter(|p| !p.is_empty()), &security)?;
            let nanos = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_nanos())
                .unwrap_or(0);
            let path = std::env::temp_dir().join(format!("island-wifi-{}-{nanos}.xml", std::process::id()));
            std::fs::write(&path, xml).map_err(|e| format!("Couldn't write the profile: {e}"))?;
            let added = netsh(format!("wlan add profile filename=\"{}\" user=current", path.display()));
            let _ = std::fs::remove_file(&path);
            added?;
        }
        netsh(format!("wlan connect name=\"{ssid}\""))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn wifi_disconnect() -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(|| netsh("wlan disconnect".to_string()))
        .await
        .map_err(|e| e.to_string())?
}

/// Removes the saved profile (and with it the stored password).
#[tauri::command]
pub async fn wifi_forget(name: String) -> Result<(), String> {
    if !textutil::valid_wifi_name(&name) {
        return Err("That network name can't be used".into());
    }
    tauri::async_runtime::spawn_blocking(move || netsh(format!("wlan delete profile name=\"{name}\"")))
        .await
        .map_err(|e| e.to_string())?
}
