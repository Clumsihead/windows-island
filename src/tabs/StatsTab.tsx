import { Activity, Cpu, HardDrive, MemoryStick, Timer } from "lucide-react";
import type { Stats } from "../api";
import { bytes, rate } from "../hooks";

export default function StatsTab({ stats }: { stats: Stats | null }) {
  const ram = stats ? (stats.ramUsed / stats.ramTotal) * 100 : 0;
  const disk = stats?.disks[0] ? (stats.disks[0].used / stats.disks[0].size) * 100 : 0;
  const up = stats ? `${Math.floor(stats.uptime / 3600)}h ${Math.floor((stats.uptime % 3600) / 60)}m` : "—";

  return (
    <div className="page">
      <div className="stats-grid">
        <Stat icon={<Cpu size={14} />} label="CPU" value={stats ? `${Math.round(stats.cpu)}%` : "—"} pct={stats?.cpu ?? 0} />
        <Stat icon={<MemoryStick size={14} />} label="MEMORY" value={stats ? `${Math.round(ram)}%` : "—"} pct={ram} />
        <Stat icon={<HardDrive size={14} />} label="DISK" value={stats ? `${Math.round(disk)}%` : "—"} pct={disk} />
        <Stat icon={<Timer size={14} />} label="UPTIME" value={up} pct={0} />
      </div>
      <div className="card">
        <div className="card-title"><Activity size={15} /> Network</div>
        <div className="list-row"><span>Download</span><small>{stats ? rate(stats.rxSec) : "—"}</small></div>
        <div className="list-row"><span>Upload</span><small>{stats ? rate(stats.txSec) : "—"}</small></div>
      </div>
      <div className="card">
        <div className="card-title"><HardDrive size={15} /> Disks</div>
        {(stats?.disks ?? []).slice(0, 3).map((d) => (
          <div className="disk-row" key={d.mount}>
            <div className="list-row"><span>{d.mount}</span><small>{bytes(d.used)} / {bytes(d.size)}</small></div>
            <div className="bar"><i style={{ width: `${Math.min(100, (d.used / d.size) * 100)}%` }} /></div>
          </div>
        ))}
      </div>
    </div>
  );
}

function Stat({ icon, label, value, pct }: { icon: React.ReactNode; label: string; value: string; pct: number }) {
  return (
    <div className="stat-card">
      <div className="stat-top">{icon}<span>{label}</span></div>
      <strong>{value}</strong>
      <div className="bar"><i style={{ width: `${Math.max(0, Math.min(100, pct))}%` }} /></div>
    </div>
  );
}
