//! Small pure helpers (no Windows or Tauri types), so they can be unit-tested anywhere.

/// Escapes text for use inside XML element content.
pub fn xml_escape(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for c in s.chars() {
        match c {
            '&' => out.push_str("&amp;"),
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            '"' => out.push_str("&quot;"),
            '\'' => out.push_str("&apos;"),
            _ => out.push(c),
        }
    }
    out
}

/// A Wi-Fi profile wants the SSID as upper-case hex of its UTF-8 bytes.
pub fn ssid_hex(ssid: &str) -> String {
    ssid.bytes().map(|b| format!("{b:02X}")).collect()
}

/// A network name that is safe to hand to `netsh ... name="<this>"`.
pub fn valid_wifi_name(name: &str) -> bool {
    !name.is_empty() && name.len() <= 32 && !name.chars().any(|c| c == '"' || c.is_control())
}

/// Builds a Wi-Fi profile for an open network or a password-protected personal one.
/// `security` is what the UI shows: "Open", "WPA", "WPA2" or "WPA3".
pub fn wifi_profile_xml(ssid: &str, password: Option<&str>, security: &str) -> Result<String, String> {
    if !valid_wifi_name(ssid) {
        return Err("That network name can't be used".into());
    }
    let (auth, enc, needs_key) = match security {
        "Open" => ("open", "none", false),
        "WPA" => ("WPAPSK", "AES", true),
        "WPA3" => ("WPA3SAE", "AES", true),
        // anything else personal is treated as WPA2, by far the most common
        _ => ("WPA2PSK", "AES", true),
    };
    let key_block = if needs_key {
        let pw = password.unwrap_or("");
        let n = pw.chars().count();
        if !(8..=63).contains(&n) {
            return Err("The password must be 8 to 63 characters".into());
        }
        format!(
            "<sharedKey><keyType>passPhrase</keyType><protected>false</protected><keyMaterial>{}</keyMaterial></sharedKey>",
            xml_escape(pw)
        )
    } else {
        String::new()
    };
    let name = xml_escape(ssid);
    Ok(format!(
        "<?xml version=\"1.0\"?>\n<WLANProfile xmlns=\"http://www.microsoft.com/networking/WLAN/profile/v1\">\
<name>{name}</name><SSIDConfig><SSID><hex>{hex}</hex><name>{name}</name></SSID></SSIDConfig>\
<connectionType>ESS</connectionType><connectionMode>auto</connectionMode>\
<MSM><security><authEncryption><authentication>{auth}</authentication><encryption>{enc}</encryption><useOneX>false</useOneX></authEncryption>{key_block}</security></MSM></WLANProfile>",
        hex = ssid_hex(ssid)
    ))
}

/// `{0.0.1.00000000}.{guid}`: the id Windows' audio policy API wants for one device.
pub fn valid_endpoint_id(id: &str) -> bool {
    let b = id.as_bytes();
    if id.len() != 55 || !id.is_ascii() || !id.starts_with("{0.0.") || !id.ends_with('}') {
        return false;
    }
    (b[5] == b'0' || b[5] == b'1')
        && &id[6..16] == ".00000000}"
        && &id[16..18] == ".{"
        && id[18..54].chars().all(|c| c.is_ascii_hexdigit() || c == '-')
}

/// Pulls that id out of the longer path WinRT gives, e.g.
/// `\\?\SWD#MMDEVAPI#{0.0.0.00000000}.{abc...}#{e6327cad-...}`.
pub fn endpoint_id_from_path(path: &str) -> Option<String> {
    let rest = &path[path.find("{0.0.")?..];
    let id = &rest[..rest.find('#').unwrap_or(rest.len())];
    if valid_endpoint_id(id) { Some(id.to_string()) } else { None }
}

/// A Bluetooth address as 12 hex digits.
pub fn valid_bt_address(s: &str) -> bool {
    s.len() == 12 && s.chars().all(|c| c.is_ascii_hexdigit())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn escapes_xml() {
        assert_eq!(xml_escape(r#"a&b<c>"d'e"#), "a&amp;b&lt;c&gt;&quot;d&apos;e");
        assert_eq!(xml_escape("plain"), "plain");
    }

    #[test]
    fn hex_of_ssid() {
        assert_eq!(ssid_hex("MAST"), "4D415354");
        assert_eq!(ssid_hex("é"), "C3A9"); // UTF-8 bytes, not code points
    }

    #[test]
    fn wifi_name_rules() {
        assert!(valid_wifi_name("Airtel_Bat man ?"));
        assert!(!valid_wifi_name(""));
        assert!(!valid_wifi_name("bad\"quote"));
        assert!(!valid_wifi_name("new\nline"));
        assert!(!valid_wifi_name(&"x".repeat(33)));
        assert!(valid_wifi_name(&"x".repeat(32)));
    }

    #[test]
    fn wpa2_profile_has_key_and_hex() {
        let x = wifi_profile_xml("MAST", Some("hunter22"), "WPA2").unwrap();
        assert!(x.contains("<hex>4D415354</hex>"));
        assert!(x.contains("<authentication>WPA2PSK</authentication>"));
        assert!(x.contains("<keyMaterial>hunter22</keyMaterial>"));
        assert!(x.contains("<protected>false</protected>"));
        assert!(x.starts_with("<?xml version=\"1.0\"?>"));
    }

    #[test]
    fn password_is_escaped_so_it_cannot_break_the_xml() {
        let x = wifi_profile_xml("n", Some("a&b<c>d\"e'f"), "WPA2").unwrap();
        assert!(x.contains("<keyMaterial>a&amp;b&lt;c&gt;d&quot;e&apos;f</keyMaterial>"));
        assert!(!x.contains("a&b"));
        let evil = wifi_profile_xml("x</name><evil/>", Some("password1"), "WPA2").unwrap();
        assert!(!evil.contains("<evil/>"));
    }

    #[test]
    fn open_network_has_no_key() {
        let x = wifi_profile_xml("Cafe", None, "Open").unwrap();
        assert!(x.contains("<authentication>open</authentication>"));
        assert!(x.contains("<encryption>none</encryption>"));
        assert!(!x.contains("sharedKey"));
    }

    #[test]
    fn security_types_map_to_the_right_auth() {
        assert!(wifi_profile_xml("n", Some("password1"), "WPA3").unwrap().contains("WPA3SAE"));
        assert!(wifi_profile_xml("n", Some("password1"), "WPA").unwrap().contains("WPAPSK"));
        assert!(wifi_profile_xml("n", Some("password1"), "Secured").unwrap().contains("WPA2PSK"));
    }

    #[test]
    fn password_length_is_checked() {
        assert!(wifi_profile_xml("n", Some("short"), "WPA2").is_err());
        assert!(wifi_profile_xml("n", None, "WPA2").is_err());
        assert!(wifi_profile_xml("n", Some(&"p".repeat(64)), "WPA2").is_err());
        assert!(wifi_profile_xml("n", Some(&"p".repeat(63)), "WPA2").is_ok());
        assert!(wifi_profile_xml("n", Some("pässwörd1"), "WPA2").is_ok()); // counts characters, not bytes
    }

    #[test]
    fn bad_names_are_rejected() {
        assert!(wifi_profile_xml("", None, "Open").is_err());
        assert!(wifi_profile_xml("a\"b", None, "Open").is_err());
    }

    #[test]
    fn endpoint_ids() {
        let ok = "{0.0.0.00000000}.{2a4b9c3e-1d2f-4a5b-8c7d-0123456789ab}";
        assert_eq!(ok.len(), 55);
        assert!(valid_endpoint_id(ok));
        assert!(valid_endpoint_id("{0.0.1.00000000}.{2A4B9C3E-1D2F-4A5B-8C7D-0123456789AB}"));
        assert!(!valid_endpoint_id("{0.0.2.00000000}.{2a4b9c3e-1d2f-4a5b-8c7d-0123456789ab}")); // not render/capture
        assert!(!valid_endpoint_id("{0.0.0.00000000}.{2a4b9c3e-1d2f-4a5b-8c7d-0123456789ab}'; calc"));
        assert!(!valid_endpoint_id("{0.0.0.00000000}.{zzzzzzzz-1d2f-4a5b-8c7d-0123456789ab}"));
        assert!(!valid_endpoint_id(""));
    }

    #[test]
    fn endpoint_id_from_a_winrt_path() {
        let p = r"\\?\SWD#MMDEVAPI#{0.0.0.00000000}.{2a4b9c3e-1d2f-4a5b-8c7d-0123456789ab}#{e6327cad-dcec-4949-ae8a-991e976a79d2}";
        assert_eq!(endpoint_id_from_path(p).as_deref(), Some("{0.0.0.00000000}.{2a4b9c3e-1d2f-4a5b-8c7d-0123456789ab}"));
        assert_eq!(endpoint_id_from_path("nothing here"), None);
        assert_eq!(endpoint_id_from_path(r"\\?\SWD#MMDEVAPI#{0.0.0.00000000}.{short}#x"), None);
    }

    #[test]
    fn bluetooth_addresses() {
        assert!(valid_bt_address("A1B2C3D4E5F6"));
        assert!(valid_bt_address("a1b2c3d4e5f6"));
        assert!(!valid_bt_address("A1B2C3D4E5F"));
        assert!(!valid_bt_address("A1B2C3D4E5FG"));
        assert!(!valid_bt_address("A1B2C3D4E5F6'; calc"));
    }
}
