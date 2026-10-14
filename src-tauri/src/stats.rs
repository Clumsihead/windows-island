use std::sync::Mutex;
use std::time::Instant;

use serde::Serialize;
use sysinfo::{Disks, Networks, System};

pub struct StatsState {
    sys: Mutex<System>,
    /// (when, total_rx, total_tx) from the previous call, to derive bytes/sec.
    net: Mutex<Option<(Instant, u64, u64)>>,
}

impl StatsState {
    pub fn new() -> Self {
        Self {
            sys: Mutex::new(System::new()),
            net: Mutex::new(None),
        }
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
    ram_used: u64,
    ram_total: u64,
    disks: Vec<DiskInfo>,
    rx_sec: f64,
    tx_sec: f64,
    uptime: u64,
}

#[tauri::command]
pub async fn system_stats(state: tauri::State<'_, StatsState>) -> Result<Stats, String> {
    let (cpu, ram_used, ram_total) = {
        let mut sys = state.sys.lock().unwrap();
        sys.refresh_cpu_usage();
        sys.refresh_memory();
        (
            sys.global_cpu_usage(),
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
    let (rx, tx) = nets.iter().fold((0u64, 0u64), |(r, t), (_, n)| {
        (r + n.total_received(), t + n.total_transmitted())
    });
    let now = Instant::now();
    let (rx_sec, tx_sec) = {
        let mut prev = state.net.lock().unwrap();
        let rates = match *prev {
            Some((t0, r0, x0)) => {
                let dt = now.duration_since(t0).as_secs_f64().max(0.001);
                (
                    rx.saturating_sub(r0) as f64 / dt,
                    tx.saturating_sub(x0) as f64 / dt,
                )
            }
            None => (0.0, 0.0),
        };
        *prev = Some((now, rx, tx));
        rates
    };

    Ok(Stats {
        cpu,
        ram_used,
        ram_total,
        disks,
        rx_sec,
        tx_sec,
        uptime: System::uptime(),
    })
}
