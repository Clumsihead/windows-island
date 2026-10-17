import { useRef, useState, type ReactNode } from "react";
import { LockKeyhole, Moon, Power, RotateCcw } from "lucide-react";
import { api } from "../api";
import type { TabProps } from "../App";

type Action = "lock" | "sleep" | "restart" | "shutdown";

export default function PowerTab({ flash, collapse }: TabProps) {
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

  const tile = (a: Action, icon: ReactNode, title: string, confirm: boolean, danger = false) => (
    <button className={`ptile ${danger ? "danger" : ""} ${armed === a ? "armed" : ""}`} onClick={() => press(a, confirm)}>
      {icon}
      <b>{armed === a ? "Click again to confirm" : title}</b>
    </button>
  );

  return (
    <div className="power">
      {tile("lock", <LockKeyhole size={24} />, "Lock", false)}
      {tile("sleep", <Moon size={24} />, "Sleep", true)}
      {tile("restart", <RotateCcw size={24} />, "Restart", true)}
      {tile("shutdown", <Power size={24} />, "Shut down", true, true)}
    </div>
  );
}
