import { useEffect, useState } from "react";
import { Zap } from "lucide-react";
import { useClock } from "../hooks";

const KEY = "island.note";

export default function Today() {
  const now = useClock();
  const [note, setNote] = useState(() => {
    try {
      return localStorage.getItem(KEY) ?? "";
    } catch {
      return "";
    }
  });
  useEffect(() => {
    const id = setTimeout(() => {
      try {
        localStorage.setItem(KEY, note);
      } catch {
        /* storage unavailable */
      }
    }, 300);
    return () => clearTimeout(id);
  }, [note]);

  return (
    <div className="page">
      <div className="hero-date">
        <span>{now.toLocaleDateString(undefined, { weekday: "long" })}</span>
        <strong>{now.getDate()}</strong>
        <span>{now.toLocaleDateString(undefined, { month: "long", year: "numeric" })}</span>
        <span className="hero-time">{now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
      </div>
      <div className="card">
        <div className="card-title"><Zap size={15} /> Quick note</div>
        <textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Jot something down — it's saved on this PC." />
      </div>
    </div>
  );
}
