//! The island's own night light: a warm tint applied through each display's colour curve (its
//! "gamma ramp"). Windows has no supported way to change the strength of its built-in Night Light,
//! so this is separate from it. If you use both, they stack.
//!
//! Windows (or a driver) can reset the curve, for example after sleep or a display change, so a
//! small background thread puts it back while the filter is on. Quitting the island clears it.

use std::time::Duration;

use tauri::{AppHandle, Manager};
use windows::core::{w, PCWSTR};
use windows::Win32::Graphics::Gdi::{CreateDCW, DeleteDC, EnumDisplayDevicesW, DISPLAY_DEVICEW, DISPLAY_DEVICE_ACTIVE, HDC};
use windows::Win32::UI::ColorSystem::{GetDeviceGammaRamp, SetDeviceGammaRamp};

use crate::colormath::{self, Ramp};

/// Runs `f` once for every display that is switched on.
fn each_display(mut f: impl FnMut(HDC)) {
    let mut index = 0u32;
    loop {
        let mut dev = DISPLAY_DEVICEW::default();
        dev.cb = std::mem::size_of::<DISPLAY_DEVICEW>() as u32;
        if !unsafe { EnumDisplayDevicesW(PCWSTR::null(), index, &mut dev, 0) }.as_bool() {
            break;
        }
        index += 1;
        if dev.StateFlags.0 & DISPLAY_DEVICE_ACTIVE.0 == 0 {
            continue;
        }
        let name = PCWSTR(dev.DeviceName.as_ptr());
        let hdc = unsafe { CreateDCW(w!("DISPLAY"), name, PCWSTR::null(), None) };
        if hdc.is_invalid() {
            continue;
        }
        f(hdc);
        let _ = unsafe { DeleteDC(hdc) };
    }
}

/// Gives every display this curve. True if at least one display took it.
fn set_ramp(ramp: &Ramp) -> bool {
    let mut any = false;
    each_display(|hdc| {
        let ok = unsafe { SetDeviceGammaRamp(hdc, ramp.as_ptr() as *const core::ffi::c_void) };
        if ok.as_bool() {
            any = true;
        }
    });
    any
}

/// True if every display currently has exactly this curve.
fn ramp_is_set(ramp: &Ramp) -> bool {
    let mut seen = false;
    let mut all = true;
    each_display(|hdc| {
        let mut cur: Ramp = [[0u16; 256]; 3];
        let ok = unsafe { GetDeviceGammaRamp(hdc, cur.as_mut_ptr() as *mut core::ffi::c_void) };
        seen = true;
        if !ok.as_bool() || &cur != ramp {
            all = false;
        }
    });
    seen && all
}

pub fn apply(strength: u8) -> Result<(), String> {
    if set_ramp(&colormath::ramp_for_strength(strength)) {
        Ok(())
    } else {
        Err("Your display driver didn't accept the colour change".into())
    }
}

/// Back to normal colours.
pub fn reset() {
    let _ = set_ramp(&colormath::identity_ramp());
}

/// While the filter is on, checks every few seconds that it is still in place and puts it back if not.
/// Also applies it right after launch if it was left on.
pub fn start(app: AppHandle) {
    std::thread::spawn(move || {
        loop {
            let (enabled, strength) = {
                let state = app.state::<crate::settings::SettingsState>();
                let cur = state.current.lock().unwrap();
                (cur.night_enabled, cur.night_strength)
            };
            if enabled {
                let ramp = colormath::ramp_for_strength(strength);
                if !ramp_is_set(&ramp) {
                    let _ = set_ramp(&ramp);
                }
            }
            std::thread::sleep(Duration::from_secs(8));
        }
    });
}

#[tauri::command(async)]
pub fn night_set(app: AppHandle, enabled: bool, strength: u8) -> Result<(), String> {
    let strength = strength.min(100);
    if enabled {
        apply(strength)?;
    } else {
        reset();
    }
    crate::settings::set_night(&app, enabled, strength);
    Ok(())
}
