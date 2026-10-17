//! Master volume of the default output device via Core Audio.

use serde::Serialize;
use windows::Win32::Media::Audio::Endpoints::IAudioEndpointVolume;
use windows::Win32::Media::Audio::{eConsole, eRender, IMMDeviceEnumerator, MMDeviceEnumerator};
use windows::Win32::System::Com::{CoCreateInstance, CoInitializeEx, CLSCTX_ALL, COINIT_MULTITHREADED};
use windows::Win32::UI::Input::KeyboardAndMouse::{
    keybd_event, KEYBD_EVENT_FLAGS, KEYEVENTF_KEYUP, VK_VOLUME_MUTE,
};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioState {
    volume: f32,
    muted: bool,
}

fn endpoint() -> windows::core::Result<IAudioEndpointVolume> {
    unsafe {
        // Fine if this thread was already initialised.
        let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
        let enumerator: IMMDeviceEnumerator = CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL)?;
        let device = enumerator.GetDefaultAudioEndpoint(eRender, eConsole)?;
        device.Activate::<IAudioEndpointVolume>(CLSCTX_ALL, None)
    }
}

fn read() -> windows::core::Result<AudioState> {
    let ep = endpoint()?;
    unsafe {
        Ok(AudioState {
            volume: ep.GetMasterVolumeLevelScalar()?,
            muted: ep.GetMute()?.as_bool(),
        })
    }
}

#[tauri::command]
pub async fn audio_get() -> Option<AudioState> {
    tauri::async_runtime::spawn_blocking(|| read().ok()).await.ok().flatten()
}

/// `volume` is 0.0 – 1.0.
#[tauri::command]
pub async fn audio_set_volume(volume: f32) -> Result<(), String> {
    let v = volume.clamp(0.0, 1.0);
    tauri::async_runtime::spawn_blocking(move || -> windows::core::Result<()> {
        let ep = endpoint()?;
        unsafe { ep.SetMasterVolumeLevelScalar(v, std::ptr::null()) }
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(|e| e.to_string())
}

/// Uses the real mute media key so Windows shows its own volume flyout too.
#[tauri::command]
pub fn audio_toggle_mute() {
    unsafe {
        keybd_event(VK_VOLUME_MUTE.0 as u8, 0, KEYBD_EVENT_FLAGS(0), 0);
        keybd_event(VK_VOLUME_MUTE.0 as u8, 0, KEYEVENTF_KEYUP, 0);
    }
}

/// Friendly name of the default output device, e.g. "Headphones (Nirvana Ion)".
fn device_name() -> Option<String> {
    use windows::Devices::Enumeration::DeviceInformation;
    use windows::Media::Devices::{AudioDeviceRole, MediaDevice};
    let id = MediaDevice::GetDefaultAudioRenderId(AudioDeviceRole::Default).ok()?;
    let info = DeviceInformation::CreateFromIdAsync(&id).ok()?.get().ok()?;
    Some(info.Name().ok()?.to_string())
}

#[tauri::command]
pub async fn audio_device() -> Option<String> {
    tauri::async_runtime::spawn_blocking(device_name).await.ok().flatten()
}
