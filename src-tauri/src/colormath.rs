//! Colour maths for the island's night-light filter. Pure functions (no Windows or Tauri types),
//! so they can be unit-tested anywhere.

/// Light that looks "neutral" on a screen: no tint at all.
pub const NEUTRAL_K: f64 = 6500.0;
/// The warmest the filter goes, at 100% strength. Windows refuses colour curves that dim a channel
/// by more than about half, so this stays comfortably inside that limit.
pub const WARMEST_K: f64 = 3600.0;

/// One 256-step curve for each of red, green and blue, as GDI's SetDeviceGammaRamp wants them.
pub type Ramp = [[u16; 256]; 3];

/// 0% = no tint, 100% = the warmest setting.
pub fn kelvin_for_strength(strength: u8) -> f64 {
    let s = f64::from(strength.min(100)) / 100.0;
    NEUTRAL_K - s * (NEUTRAL_K - WARMEST_K)
}

/// Approximate colour (0-255 per channel) of a glowing black body at `kelvin`
/// (Tanner Helland's well-known curve fit).
fn blackbody(kelvin: f64) -> (f64, f64, f64) {
    let t = kelvin / 100.0;
    let r = if t <= 66.0 { 255.0 } else { 329.698727446 * (t - 60.0).powf(-0.1332047592) };
    let g = if t <= 66.0 {
        99.4708025861 * t.ln() - 161.1195681661
    } else {
        288.1221695283 * (t - 60.0).powf(-0.0755148492)
    };
    let b = if t >= 66.0 {
        255.0
    } else if t <= 19.0 {
        0.0
    } else {
        138.5177312231 * (t - 10.0).ln() - 305.0447927307
    };
    (r.clamp(0.0, 255.0), g.clamp(0.0, 255.0), b.clamp(0.0, 255.0))
}

/// How much to scale red, green and blue so white looks like `kelvin` light,
/// measured against the neutral setting (so neutral gives exactly 1, 1, 1).
pub fn multipliers(kelvin: f64) -> (f64, f64, f64) {
    let (r, g, b) = blackbody(kelvin);
    let (r0, g0, b0) = blackbody(NEUTRAL_K);
    ((r / r0).min(1.0), (g / g0).min(1.0), (b / b0).min(1.0))
}

fn scaled(m: (f64, f64, f64)) -> Ramp {
    let mut ramp: Ramp = [[0; 256]; 3];
    for i in 0..256usize {
        let base = i as f64 * 257.0; // 0..=65535
        ramp[0][i] = (base * m.0).round() as u16;
        ramp[1][i] = (base * m.1).round() as u16;
        ramp[2][i] = (base * m.2).round() as u16;
    }
    ramp
}

/// The curve that changes nothing.
pub fn identity_ramp() -> Ramp {
    scaled((1.0, 1.0, 1.0))
}

pub fn ramp_for_strength(strength: u8) -> Ramp {
    scaled(multipliers(kelvin_for_strength(strength)))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn zero_strength_changes_nothing() {
        assert_eq!(ramp_for_strength(0), identity_ramp());
        let id = identity_ramp();
        assert_eq!(id[0][0], 0);
        assert_eq!(id[0][255], 65535);
        assert_eq!(id[1][128], 128 * 257);
    }

    #[test]
    fn strength_maps_to_temperature() {
        assert_eq!(kelvin_for_strength(0), 6500.0);
        assert_eq!(kelvin_for_strength(100), 3600.0);
        assert_eq!(kelvin_for_strength(200), 3600.0); // clamped
        assert!(kelvin_for_strength(35) > kelvin_for_strength(36));
    }

    #[test]
    fn warmer_means_less_blue_then_less_green_and_never_less_red() {
        for s in 1..=100u8 {
            let (r, g, b) = multipliers(kelvin_for_strength(s));
            assert!((r - 1.0).abs() < 1e-9, "red stays put at {s}%");
            assert!(g <= r && b <= g, "order r>=g>=b at {s}%: {r} {g} {b}");
        }
    }

    #[test]
    fn each_step_is_a_little_warmer() {
        let mut prev = multipliers(kelvin_for_strength(0));
        for s in 1..=100u8 {
            let cur = multipliers(kelvin_for_strength(s));
            assert!(cur.1 <= prev.1 + 1e-12 && cur.2 <= prev.2 + 1e-12, "not warmer at {s}%");
            prev = cur;
        }
    }

    #[test]
    fn curves_are_always_increasing() {
        for s in 0..=100u8 {
            for ch in ramp_for_strength(s) {
                assert!(ch.windows(2).all(|w| w[0] <= w[1]), "not monotonic at {s}%");
            }
        }
    }

    #[test]
    fn stays_inside_the_limit_windows_enforces() {
        // Windows rejects a curve if any entry falls below (i * 256 - 32768), i.e. dims a channel too far.
        for s in 0..=100u8 {
            let ramp = ramp_for_strength(s);
            for ch in &ramp {
                for (i, &v) in ch.iter().enumerate() {
                    assert!(i32::from(v) >= i as i32 * 256 - 32768, "entry {i} too dim at {s}%");
                }
            }
        }
        // and the strongest setting still leaves blue at more than half
        let strongest = multipliers(kelvin_for_strength(100));
        assert!(strongest.2 > 0.55, "blue at 100% is {}", strongest.2);
    }

    #[test]
    fn typical_values_look_right() {
        let (_, g, b) = multipliers(kelvin_for_strength(35));
        assert!(g > 0.9 && b > 0.85 && b < 0.92, "35% should be a gentle warm tint: g={g} b={b}");
    }
}
