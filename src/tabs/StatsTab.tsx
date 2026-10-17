import { useState } from "react";
import { ArrowLeftRight, Play } from "lucide-react";
import { api, AppUsage, Gpu, Stats, TopApps } from "../api";
import { bytes, gb, rate, timeAgo, usePoll, useIcons } from "../hooks";
import { Ring } from "../ui";
import { useSpeedTest } from "../speedtest";

const NO_GPU: Gpu = { available: false, name: "", vramTotal: 0, vramUsed: 0, usage: 0 };
const NO_APPS: TopApps = { byRam: [], byCpu: [], processCount: 0 };

function Chip({ children }: { children: string }) {
  return <span className="chip">{children}</span>;
}

function AppRow({ app, max, metric, icon }: { app: AppUsage; max: number; metric: "ram" | "cpu"; icon?: string }) {
  const value = metric === "ram" ? app.memory : app.cpu;
  return (
    <div className="arow">
      <span className="arow-ico">{icon ? <img src={icon} alt="" /> : app.name.slice(0, 1).toUpperCase()}</span>
      <div className="arow-body">
        <div className="arow-head">
          <span>{app.name}</span>
          <small>{metric === "ram" ? bytes(app.memory) : `${app.cpu.toFixed(1)}%`}</small>
        </div>
        <div className="arow-bar"><i style={{ width: `${max > 0 ? Math.max(3, (value / max) * 100) : 0}%` }} /></div>
      </div>
    </div>
  );
}

export default function StatsTab() {
  const stats = usePoll<Stats | null>(api.stats, 1000, null);
  const gpu = usePoll<Gpu>(api.gpu, 3000, NO_GPU);
  const apps = usePoll<TopApps>(api.topApps, 2500, NO_APPS);
  const [metric, setMetric] = useState<"ram" | "cpu">("ram");
  const speed = useSpeedTest();

  const list = metric === "ram" ? apps.byRam : apps.byCpu;
  const icon = useIcons(list.map((a) => a.exe), 32);
  const max = Math.max(1, ...list.map((a) => (metric === "ram" ? a.memory : a.cpu)));

  const ramPct = stats ? (stats.ramUsed / stats.ramTotal) * 100 : 0;
  const disk = stats?.disks.find((d) => d.mount.toUpperCase().startsWith("C:")) ?? stats?.disks[0];
  const up = stats ? `${Math.floor(stats.uptime / 3600)} h ${Math.floor((stats.uptime % 3600) / 60)} m` : "--";
  const cpuName = (stats?.cpuName ?? "").replace(/\((R|TM)\)/g, "").replace(/\s+/g, " ").trim();

  return (
    <div className="stats">
      <div className="gauge">
        <Ring pct={stats?.cpu ?? 0} color="var(--olive)" size={124} stroke={12}>
          <span className="ring-num">{stats ? Math.round(stats.cpu) : "--"}%</span>
        </Ring>
        <b>CPU</b>
        <small className="gauge-sub">{cpuName || "Processor"}</small>
        <div className="chips">
          {stats && stats.cpuMhz > 0 && <Chip>{`${(stats.cpuMhz / 1000).toFixed(1)} GHz`}</Chip>}
          {apps.processCount > 0 && <Chip>{`${apps.processCount} proc`}</Chip>}
        </div>
      </div>

      <div className="gauge">
        <Ring pct={gpu.usage} color="var(--lav)" size={124} stroke={12}>
          <span className="ring-num">{gpu.available ? `${Math.round(gpu.usage)}%` : "--"}</span>
        </Ring>
        <b>GPU</b>
        <small className="gauge-sub">{gpu.available ? gpu.name : "No GPU data"}</small>
        <div className="chips">
          {gpu.available && gpu.vramTotal > 0 && <Chip>{`${gb(gpu.vramUsed)} / ${gb(gpu.vramTotal)} GB`}</Chip>}
        </div>
      </div>

      <div className="gauge">
        <Ring pct={ramPct} color="var(--green)" size={124} stroke={12}>
          <span className="ring-num">{stats ? Math.round(ramPct) : "--"}%</span>
        </Ring>
        <b>RAM</b>
        <small className="gauge-sub">{stats ? `${gb(stats.ramUsed)} / ${gb(stats.ramTotal)} GB` : "Memory"}</small>
        <div className="chips">{stats && <Chip>{`${gb(stats.ramTotal - stats.ramUsed)} GB free`}</Chip>}</div>
      </div>

      <div className="minis">
        <div className="mini">
          <small>DISK {disk ? disk.mount.replace(/\\$/, "") : ""}</small>
          <b>{disk ? `${Math.round(disk.used / 1024 ** 3)} / ${Math.round(disk.size / 1024 ** 3)} GB` : "--"}</b>
        </div>
        <div className="mini">
          <small>NETWORK</small>
          <b>{stats ? `↓ ${rate(stats.rxSec)}  ↑ ${rate(stats.txSec)}` : "--"}</b>
        </div>
        <div className="mini">
          <small>UP FOR</small>
          <b>{up}</b>
        </div>
      </div>

      <div className="side">
        <div className="card topapps">
          <div className="card-head">
            <span>Top apps · {metric === "ram" ? "RAM" : "CPU"}</span>
            <button className="swap" onClick={() => setMetric(metric === "ram" ? "cpu" : "ram")}>
              {metric === "ram" ? "CPU" : "RAM"} <ArrowLeftRight size={13} />
            </button>
          </div>
          {list.map((a) => (
            <AppRow key={a.name} app={a} max={max} metric={metric} icon={icon(a.exe)} />
          ))}
          {list.length === 0 && <div className="muted-note">Reading processes…</div>}
        </div>

        <div className="card speed">
          <div className="card-head">
            <span>Internet speed</span>
            <small>{speed.last ? `last: ${timeAgo(speed.last.at)} ago${speed.last.city ? ` • ${speed.last.city}` : ""}` : "not run yet"}</small>
          </div>
          <div className="speed-nums">
            <div><b>{speed.last ? Math.round(speed.last.down) : "--"}</b> <small>Mbps ↓</small></div>
            <div><b>{speed.last ? Math.round(speed.last.up) : "--"}</b> <small>Mbps ↑</small></div>
          </div>
          <button className="olive-btn" onClick={speed.run} disabled={speed.running}>
            <Play size={13} fill="currentColor" /> {speed.running ? "Testing…" : speed.error ? "Failed, try again" : "Run speed test"}
          </button>
        </div>
      </div>
    </div>
  );
}
