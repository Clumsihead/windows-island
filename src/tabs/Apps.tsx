import { useEffect, useMemo, useState } from "react";
import { AppWindow, Search } from "lucide-react";
import { api, AppEntry } from "../api";

const BUILTIN: AppEntry[] = [
  { name: "Settings", path: "ms-settings:" },
  { name: "File Explorer", path: "explorer.exe" },
  { name: "Task Manager", path: "taskmgr.exe" },
  { name: "Calculator", path: "calc.exe" },
];

export default function Apps({ flash, collapse }: { flash: (m: string) => void; collapse: () => void }) {
  const [apps, setApps] = useState<AppEntry[]>([]);
  const [q, setQ] = useState("");

  useEffect(() => {
    api.apps().then(setApps).catch(() => {});
  }, []);

  const results = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return [...BUILTIN, ...apps].slice(0, 24);
    const all = [...BUILTIN, ...apps].filter((a) => a.name.toLowerCase().includes(needle));
    // prefix matches first
    all.sort((a, b) => Number(!a.name.toLowerCase().startsWith(needle)) - Number(!b.name.toLowerCase().startsWith(needle)));
    return all.slice(0, 24);
  }, [q, apps]);

  const launch = (a: AppEntry) =>
    api.launch(a.path).then(collapse).catch((e) => flash(String(e)));

  return (
    <div className="page fill-page">
      <div className="search">
        <Search size={14} />
        <input
          value={q}
          autoFocus
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && results[0] && launch(results[0])}
          placeholder={apps.length ? `Search ${apps.length} apps…` : "Indexing apps…"}
        />
      </div>
      <div className="app-grid">
        {results.map((a) => (
          <button className="app-tile" key={a.path} onClick={() => launch(a)}>
            <span className="app-glyph">{a.name.slice(0, 1).toUpperCase()}</span>
            <b>{a.name}</b>
          </button>
        ))}
        {results.length === 0 && <div className="empty"><AppWindow /><p>No apps match “{q}”.</p></div>}
      </div>
    </div>
  );
}
