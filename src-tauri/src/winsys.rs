//! Windows system queries. Deliberately free of any Tauri types.

use serde::Serialize;
use windows::Devices::Bluetooth::{BluetoothConnectionStatus, BluetoothDevice, BluetoothMajorClass};
use windows::Devices::Enumeration::{DeviceClass, DeviceInformation};
use windows::Media::Devices::{AudioDeviceRole, MediaDevice};
use windows::Win32::System::Power::{GetSystemPowerStatus, SYSTEM_POWER_STATUS};

// ------------------------------------------------------------------ battery

#[derive(Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Battery {
    pub has_battery: bool,
    pub percent: u8,
    pub charging: bool,
    pub plugged_in: bool,
}

pub fn battery() -> Battery {
    let mut p = SYSTEM_POWER_STATUS::default();
    if unsafe { GetSystemPowerStatus(&mut p) }.is_err() {
        return Battery::default();
    }
    // BatteryFlag: 128 = no battery, 255 = unknown. BatteryLifePercent: 255 = unknown.
    let has = (p.BatteryFlag & 128) == 0 && p.BatteryFlag != 255 && p.BatteryLifePercent != 255;
    Battery {
        has_battery: has,
        percent: if has { p.BatteryLifePercent } else { 0 },
        charging: has && (p.BatteryFlag & 8) != 0,
        plugged_in: p.ACLineStatus == 1,
    }
}

// ------------------------------------------------------------------ audio devices

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioDevice {
    pub id: String,
    pub name: String,
    pub is_default: bool,
}

#[derive(Serialize, Default)]
pub struct AudioDevices {
    pub outputs: Vec<AudioDevice>,
    pub inputs: Vec<AudioDevice>,
}

fn endpoints(class: DeviceClass, default_id: Option<String>) -> windows::core::Result<Vec<AudioDevice>> {
    let mut out = Vec::new();
    for d in DeviceInformation::FindAllAsyncDeviceClass(class)?.get()? {
        let id = d.Id()?.to_string();
        let is_default = default_id.as_deref().map(|x| x.eq_ignore_ascii_case(&id)).unwrap_or(false);
        out.push(AudioDevice { is_default, name: d.Name()?.to_string(), id });
    }
    Ok(out)
}

pub fn audio_devices() -> windows::core::Result<AudioDevices> {
    let out_id = MediaDevice::GetDefaultAudioRenderId(AudioDeviceRole::Default).ok().map(|h| h.to_string());
    let in_id = MediaDevice::GetDefaultAudioCaptureId(AudioDeviceRole::Default).ok().map(|h| h.to_string());
    Ok(AudioDevices {
        outputs: endpoints(DeviceClass::AudioRender, out_id)?,
        inputs: endpoints(DeviceClass::AudioCapture, in_id)?,
    })
}

// ------------------------------------------------------------------ bluetooth devices

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BtDevice {
    pub id: String,
    pub name: String,
    pub connected: bool,
    /// "audio", "phone", "computer", "input" or "other"
    pub kind: String,
    /// 12 hex digits, e.g. "A1B2C3D4E5F6" (a string because it is too big for a JS number)
    pub address: String,
}

pub fn bluetooth_devices() -> windows::core::Result<Vec<BtDevice>> {
    let selector = BluetoothDevice::GetDeviceSelectorFromPairingState(true)?;
    let mut out = Vec::new();
    for info in DeviceInformation::FindAllAsyncAqsFilter(&selector)?.get()? {
        let id = info.Id()?;
        let Ok(dev) = BluetoothDevice::FromIdAsync(&id)?.get() else { continue };
        let major = dev.ClassOfDevice().and_then(|c| c.MajorClass()).ok();
        let kind = if major == Some(BluetoothMajorClass::AudioVideo) {
            "audio"
        } else if major == Some(BluetoothMajorClass::Phone) {
            "phone"
        } else if major == Some(BluetoothMajorClass::Computer) {
            "computer"
        } else if major == Some(BluetoothMajorClass::Peripheral) {
            "input"
        } else {
            "other"
        };
        out.push(BtDevice {
            id: id.to_string(),
            name: dev.Name()?.to_string(),
            connected: dev.ConnectionStatus()? == BluetoothConnectionStatus::Connected,
            kind: kind.to_string(),
            address: format!("{:012X}", dev.BluetoothAddress()?),
        });
    }
    out.sort_by(|a, b| b.connected.cmp(&a.connected).then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase())));
    Ok(out)
}
