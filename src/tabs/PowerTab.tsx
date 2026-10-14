import { useRef, useState } from "react";
import { BatteryCharging, ExternalLink, LockKeyhole, Moon, Power, RotateCcw } from "lucide-react";
import { api } from "../api";

type Action = "lock" | "sleep" | "restart" | "shutdown";

export default function PowerTab({ flash, collapse }: { flash: (m: string) => void; collapse: () => void }) {
  const [armed, setArmed] = useState<Action | null>(null);
  const timer = useRef<number | undefined>(undefined);

  const press = (a: Action, confirm: boolean) => {
    if (confirm && armed !== a) {
      setArmed(a);
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setArmed(null), 3000);
      return;
    }
    setArmed(null);
    api.power(a).then(() => a === "lock" && collapse()).catch((e) => flash(String(e)));
  };

  const tile = (a: Action, icon: React.ReactNode, title: string, desc: string, confirm: boolean, danger = false) => (
    <button className={`power-tile ${danger ? "danger" : ""} ${armed === a ? "armed" : ""}`} onClick={() => press(a, confirm)}>
      {icon}
      <b>{armed === a ? "Click again to confirm" : title}</b>
      <small>{desc}</small>
    </button>
  );

  return (
    <div className="page">
      <div className="power-grid">
        {tile("lock", <LockKeyhole size={20} />, "Lock", "Lock this PC", false)}
        {tile("sleep", <Moon size={20} />, "Sleep", "Suspend this session", true)}
        {tile("restart", <RotateCcw size={20} />, "Restart", "Restart Windows", true)}
        {tile("shutdown", <Power size={20} />, "Shut down", "Turn off this PC", true, true)}
      </div>
      <div className="card">
        <div className="card-title"><BatteryCharging size={15} /> Power settings</div>
        <button className="link-button" onClick={() => api.openSettings("battery").catch((e) => flash(String(e)))}>
          Open Windows battery settings <ExternalLink size={13} />
        </button>
      </div>
    </div>
  );
}
