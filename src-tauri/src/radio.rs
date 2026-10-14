//! Real Wi-Fi / Bluetooth on-off through the Windows.Devices.Radios API.

use serde::Serialize;
use windows::Devices::Radios::{Radio, RadioAccessStatus, RadioKind, RadioState};

#[derive(Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Radios {
    wifi: Option<bool>,
    bluetooth: Option<bool>,
}

fn read() -> windows::core::Result<Radios> {
    let mut out = Radios::default();
    for r in Radio::GetRadiosAsync()?.get()? {
        let on = r.State()? == RadioState::On;
        match r.Kind()? {
            RadioKind::WiFi => out.wifi = Some(on),
            RadioKind::Bluetooth => out.bluetooth = Some(on),
            _ => {}
        }
    }
    Ok(out)
}

fn set(kind: &str, on: bool) -> windows::core::Result<()> {
    if Radio::RequestAccessAsync()?.get()? != RadioAccessStatus::Allowed {
        return Err(windows::core::Error::from_hresult(windows::core::HRESULT(
            0x80070005u32 as i32,
        )));
    }
    let want = match kind {
        "wifi" => RadioKind::WiFi,
        "bluetooth" => RadioKind::Bluetooth,
        _ => return Ok(()),
    };
    let state = if on { RadioState::On } else { RadioState::Off };
    for r in Radio::GetRadiosAsync()?.get()? {
        if r.Kind()? == want {
            r.SetStateAsync(state)?.get()?;
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn radio_get() -> Radios {
    tauri::async_runtime::spawn_blocking(|| read().unwrap_or_default())
        .await
        .unwrap_or_default()
}

/// The UI falls back to the Windows Settings page when this errors.
#[tauri::command]
pub async fn radio_set(kind: String, on: bool) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || set(&kind, on))
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())
}
