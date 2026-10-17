//! GPU name, memory and load.
//!
//! Windows has no simple API for GPU load, so this reads the same performance counters
//! Task Manager uses (through `typeperf`). The adapter name and total VRAM come from the
//! display-driver registry keys once, then are cached.

use std::collections::HashMap;
use std::os::windows::process::CommandExt;
use std::process::Command;
use std::sync::OnceLock;

use serde::Serialize;
use serde_json::Value;

const CREATE_NO_WINDOW: u32 = 0x0800_0000;

#[derive(Serialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct GpuInfo {
    available: bool,
    name: String,
    vram_total: u64,
    vram_used: u64,
    usage: f32,
}

static ADAPTER: OnceLock<Option<(String, u64)>> = OnceLock::new();

fn run(exe: &str, args: &[&str]) -> Option<String> {
    let out = Command::new(exe).args(args).creation_flags(CREATE_NO_WINDOW).output().ok()?;
    if !out.status.success() {
        return None;
    }
    Some(String::from_utf8_lossy(&out.stdout).to_string())
}

/// The adapter with the most dedicated memory (the discrete GPU on hybrid laptops).
fn find_adapter() -> Option<(String, u64)> {
    let script = r#"$k='HKLM:\SYSTEM\CurrentControlSet\Control\Class\{4d36e968-e325-11ce-bfc1-08002be10318}\0*'; Get-ItemProperty $k -ErrorAction SilentlyContinue | Where-Object { $_.DriverDesc } | ForEach-Object { $v=$_.'HardwareInformation.qwMemorySize'; if ($v -is [byte[]]) { $v=[BitConverter]::ToInt64($v,0) }; [pscustomobject]@{ name=$_.DriverDesc; mem=[int64]$v } } | ConvertTo-Json -Compress"#;
    let text = run("powershell", &["-NoProfile", "-NonInteractive", "-Command", script])?;
    let parsed: Value = serde_json::from_str(text.trim()).ok()?;
    let list = match parsed {
        Value::Array(a) => a,
        o @ Value::Object(_) => vec![o],
        _ => return None,
    };
    list.iter()
        .filter_map(|g| Some((g["name"].as_str()?.to_string(), g["mem"].as_u64().unwrap_or(0))))
        .max_by_key(|(_, mem)| *mem)
}

/// (load %, dedicated memory in use) from the GPU performance counters.
fn read_counters() -> Option<(f32, u64)> {
    let text = run(
        "typeperf",
        &[
            r"\GPU Engine(*)\Utilization Percentage",
            r"\GPU Adapter Memory(*)\Dedicated Usage",
            "-sc",
            "1",
        ],
    )?;
    let mut rows = text.lines().filter(|l| l.starts_with('"'));
    let header = rows.next()?;
    let values = rows.next()?;
    let heads: Vec<&str> = header.trim_matches('"').split("\",\"").collect();
    let vals: Vec<&str> = values.trim_matches('"').split("\",\"").collect();

    let mut engines: HashMap<String, f64> = HashMap::new();
    let mut mem_used = 0f64;
    for (h, v) in heads.iter().zip(vals.iter()).skip(1) {
        let Ok(n) = v.trim().parse::<f64>() else { continue };
        if h.contains("GPU Engine(") {
            // ..._luid_0x0_0x1234_phys_0_eng_0_engtype_3D)
            let kind = h.split("engtype_").nth(1).and_then(|s| s.split(')').next()).unwrap_or("?");
            let luid = h.split("luid_").nth(1).and_then(|s| s.split("_phys").next()).unwrap_or("?");
            *engines.entry(format!("{luid}/{kind}")).or_insert(0.0) += n;
        } else if h.contains("GPU Adapter Memory(") {
            mem_used = mem_used.max(n);
        }
    }
    let usage = engines.values().cloned().fold(0.0, f64::max).min(100.0);
    Some((usage as f32, mem_used as u64))
}

#[tauri::command]
pub async fn gpu_stats() -> GpuInfo {
    tauri::async_runtime::spawn_blocking(|| {
        let Some((name, total)) = ADAPTER.get_or_init(find_adapter).clone() else {
            return GpuInfo::default();
        };
        let (usage, used) = read_counters().unwrap_or((0.0, 0));
        GpuInfo { available: true, name, vram_total: total, vram_used: used, usage }
    })
    .await
    .unwrap_or_default()
}
