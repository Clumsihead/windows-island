use std::collections::HashMap;
use std::sync::Mutex;
use std::time::Instant;

use serde::Serialize;
use sysinfo::{Disks, Networks, ProcessesToUpdate, System};

pub struct StatsState {
    sys: Mutex<System>,
    /// (when, total_rx, total_tx) from the previous call, to derive bytes/sec.
    net: Mutex<Option<(Instant, u64, u64)>>,
}

impl StatsState {
    pub fn new() -> Self {
        Self { sys: Mutex::new(System::new()), net: Mutex::new(None) }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiskInfo {
    mount: String,
    used: u64,
    size: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Stats {
    cpu: f32,
    cpu_name: String,
    cpu_mhz: u64,
    ram_used: u64,
    ram_total: u64,
    disks: Vec<DiskInfo>,
    rx_sec: f64,
    tx_sec: f64,
    uptime: u64,
}

#[tauri::command]
pub async fn system_stats(state: tauri::State<'_, StatsState>) -> Result<Stats, String> {
    let (cpu, cpu_name, cpu_mhz, ram_used, ram_total) = {
        let mut sys = state.sys.lock().unwrap();
        sys.refresh_cpu_all();
        sys.refresh_memory();
        let first = sys.cpus().first();
        (
            sys.global_cpu_usage(),
            first.map(|c| c.brand().trim().to_string()).unwrap_or_default(),
            first.map(|c| c.frequency()).unwrap_or(0),
            sys.used_memory(),
            sys.total_memory().max(1),
        )
    };

    let disks = Disks::new_with_refreshed_list()
        .list()
        .iter()
        .filter(|d| d.total_space() > 0)
        .map(|d| DiskInfo {
            mount: d.mount_point().to_string_lossy().to_string(),
            used: d.total_space().saturating_sub(d.available_space()),
            size: d.total_space(),
        })
        .collect();

    let nets = Networks::new_with_refreshed_list();
    let (rx, tx) = nets
        .iter()
        .fold((0u64, 0u64), |(r, t), (_, n)| (r + n.total_received(), t + n.total_transmitted()));
    let now = Instant::now();
    let (rx_sec, tx_sec) = {
        let mut prev = state.net.lock().unwrap();
        let rates = match *prev {
            Some((t0, r0, x0)) => {
                let dt = now.duration_since(t0).as_secs_f64().max(0.001);
                (rx.saturating_sub(r0) as f64 / dt, tx.saturating_sub(x0) as f64 / dt)
            }
            None => (0.0, 0.0),
        };
        *prev = Some((now, rx, tx));
        rates
    };

    Ok(Stats { cpu, cpu_name, cpu_mhz, ram_used, ram_total, disks, rx_sec, tx_sec, uptime: System::uptime() })
}

// ---------------------------------------------------------------- top apps

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AppUsage {
    name: String,
    exe: Option<String>,
    memory: u64,
    cpu: f32,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TopApps {
    by_ram: Vec<AppUsage>,
    by_cpu: Vec<AppUsage>,
    process_count: usize,
}

fn pretty(raw: &str) -> String {
    let base = raw.trim_end_matches(".exe").trim_end_matches(".EXE");
    match base.to_lowercase().as_str() {
        "dwm" => return "Desktop Window Manager".into(),
        "msedge" => return "Microsoft Edge".into(),
        "explorer" => return "Windows Explorer".into(),
        "svchost" => return "Service Host".into(),
        "searchhost" => return "Windows Search".into(),
        "msedgewebview2" => return "Edge WebView2".into(),
        _ => {}
    }
    let s = base.replace(['-', '_'], " ");
    let mut chars = s.chars();
    match chars.next() {
        Some(f) => f.to_uppercase().collect::<String>() + chars.as_str(),
        None => s,
    }
}

/// Top processes, grouped by program (all of Chrome's processes count as one).
/// Called only while the Stats tab is open, since refreshing processes is the costly part.
#[tauri::command]
pub async fn top_apps(state: tauri::State<'_, StatsState>) -> Result<TopApps, String> {
    let mut sys = state.sys.lock().unwrap();
    sys.refresh_processes(ProcessesToUpdate::All, true);
    let ncpu = sys.cpus().len().max(1) as f32;

    let mut groups: HashMap<String, AppUsage> = HashMap::new();
    for p in sys.processes().values() {
        let raw = p.name().to_string_lossy().to_string();
        let key = raw.to_lowercase();
        if matches!(
            key.as_str(),
            "system idle process" | "system" | "registry" | "memory compression" | "secure system"
        ) {
            continue;
        }
        let exe = p.exe().map(|x| x.to_string_lossy().to_string());
        let e = groups.entry(key).or_insert_with(|| AppUsage {
            name: pretty(&raw),
            exe: exe.clone(),
            memory: 0,
            cpu: 0.0,
        });
        e.memory += p.memory();
        e.cpu += p.cpu_usage() / ncpu;
        if e.exe.is_none() {
            e.exe = exe;
        }
    }
    let process_count = sys.processes().len();

    let all: Vec<AppUsage> = groups.into_values().collect();
    let mut by_ram = all.clone();
    by_ram.sort_by(|a, b| b.memory.cmp(&a.memory));
    by_ram.truncate(4);
    let mut by_cpu = all;
    by_cpu.sort_by(|a, b| b.cpu.partial_cmp(&a.cpu).unwrap_or(std::cmp::Ordering::Equal));
    by_cpu.truncate(4);

    Ok(TopApps { by_ram, by_cpu, process_count })
}
