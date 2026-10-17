import { useEffect, useMemo, useRef, useState } from "react";
import { Plus, Search, Star, Trash2 } from "lucide-react";
import { api, AppEntry } from "../api";
import { useIcons, useLocal } from "../hooks";
import type { TabProps } from "../App";

const BUILTIN: AppEntry[] = [
  { name: "Settings", path: "ms-settings:" },
  { name: "File Explorer", path: "explorer.exe" },
  { name: "Task Manager", path: "taskmgr.exe" },
  { name: "Calculator", path: "calc.exe" },
];

type Snippet = { id: string; name: string; text: string };
type Row = { kind: "app" | "file" | "snippet"; key: string; name: string; path?: string; text?: string; id?: string };
type Section = { title: string; rows: Row[]; action?: "newSnippet" };

const label = { app: "Application", file: "File", snippet: "Snippet" } as const;

export default function Apps({ flash, collapse }: TabProps) {
  const [apps, setApps] = useState<AppEntry[]>([]);
  const [files, setFiles] = useState<AppEntry[]>([]);
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);
  const [recents, setRecents] = useLocal<string[]>("island.recent", []);
  const [favs, setFavs] = useLocal<string[]>("island.fav", []);
  const [snippets, setSnippets] = useLocal<Snippet[]>("island.snippets", []);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState({ name: "", text: "" });
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api.apps().then(setApps).catch(() => {});
    api.recentFiles().then(setFiles).catch(() => {});
  }, []);

  const all = useMemo(() => [...BUILTIN, ...apps], [apps]);

  const sections = useMemo<Section[]>(() => {
    const needle = q.trim().toLowerCase();
    const byPath = new Map(all.map((a) => [a.path, a]));
    const appRow = (a: AppEntry): Row => ({ kind: "app", key: `a:${a.path}`, name: a.name, path: a.path });
    const snipRow = (s: Snippet): Row => ({ kind: "snippet", key: `s:${s.id}`, name: s.name, text: s.text, id: s.id });
    const out: Section[] = [];

    if (!needle) {
      const recentPaths = Array.from(new Set([...favs, ...recents])).filter((p) => byPath.has(p)).slice(0, 6);
      if (recentPaths.length) out.push({ title: "RECENT", rows: recentPaths.map((p) => appRow(byPath.get(p)!)) });
      out.push({ title: "APPLICATIONS", rows: all.slice(0, 40).map(appRow) });
      out.push({ title: "SNIPPETS", rows: snippets.map(snipRow), action: "newSnippet" });
    } else {
      const matches = all.filter((a) => a.name.toLowerCase().includes(needle));
      matches.sort((a, b) => Number(!a.name.toLowerCase().startsWith(needle)) - Number(!b.name.toLowerCase().startsWith(needle)));
      if (matches.length) out.push({ title: "APPLICATIONS", rows: matches.slice(0, 12).map(appRow) });
      const f = files.filter((x) => x.name.toLowerCase().includes(needle)).slice(0, 8);
      if (f.length) out.push({ title: "FILES", rows: f.map((x) => ({ kind: "file" as const, key: `f:${x.path}`, name: x.name, path: x.path })) });
      const s = snippets.filter((x) => x.name.toLowerCase().includes(needle) || x.text.toLowerCase().includes(needle));
      if (s.length) out.push({ title: "SNIPPETS", rows: s.map(snipRow) });
    }
    return out;
  }, [q, all, files, favs, recents, snippets]);

  const flat = useMemo(() => sections.flatMap((s) => s.rows), [sections]);
  const icon = useIcons(flat.map((r) => r.path), 40);

  useEffect(() => setSel(0), [q]);
  useEffect(() => {
    listRef.current?.querySelector(".arow2.sel")?.scrollIntoView({ block: "nearest" });
  }, [sel]);

  const run = (row: Row) => {
    if (row.kind === "snippet") {
      api.pasteText(row.text ?? "").catch((e) => flash(String(e)));
      return;
    }
    api.launch(row.path!).then(() => {
      if (row.kind === "app") setRecents((p) => [row.path!, ...p.filter((x) => x !== row.path)].slice(0, 8));
      collapse();
    }).catch((e) => flash(String(e)));
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setSel((s) => Math.min(flat.length - 1, s + 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setSel((s) => Math.max(0, s - 1)); }
    else if (e.key === "Enter" && flat[sel] && !adding) { e.preventDefault(); run(flat[sel]); }
  };

  const saveSnippet = () => {
    if (!draft.name.trim() || !draft.text.trim()) return;
    setSnippets((p) => [...p, { id: String(Date.now()), name: draft.name.trim(), text: draft.text }]);
    setDraft({ name: "", text: "" });
    setAdding(false);
  };

  let index = -1;
  return (
    <div className="apps" onKeyDown={onKeyDown}>
      <div className="searchbar big">
        <Search size={24} />
        <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search apps, files and snippets…" />
        <span className="hint">Ctrl+Alt+A</span>
      </div>

      <div className="alist" ref={listRef}>
        {sections.map((s) => (
          <div key={s.title}>
            <div className="sec">
              <span>{s.title}</span>
              {s.action === "newSnippet" && (
                <button onClick={() => setAdding((a) => !a)}><Plus size={13} /> New</button>
              )}
            </div>
            {s.action === "newSnippet" && adding && (
              <div className="snip-form">
                <input value={draft.name} placeholder="Name (e.g. My email)" onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
                <input value={draft.text} placeholder="Text to paste" onChange={(e) => setDraft({ ...draft, text: e.target.value })} onKeyDown={(e) => e.key === "Enter" && saveSnippet()} />
                <button onClick={saveSnippet}>Save</button>
              </div>
            )}
            {s.rows.map((r) => {
              index += 1;
              const i = index;
              const on = i === sel;
              const img = icon(r.path);
              return (
                <div key={r.key} className={`arow2 ${on ? "sel" : ""}`} onMouseMove={() => sel !== i && setSel(i)} onClick={() => run(r)}>
                  <span className="aico">{img ? <img src={img} alt="" /> : r.name.slice(0, 1).toUpperCase()}</span>
                  <span className="aname">{r.name}</span>
                  {on ? (
                    <span className="aact">
                      <small>↵ {r.kind === "snippet" ? "Paste" : "Open"}</small>
                      {r.kind === "app" && (
                        <button aria-label="Favorite" onClick={(e) => { e.stopPropagation(); setFavs((p) => (p.includes(r.path!) ? p.filter((x) => x !== r.path) : [...p, r.path!])); }}>
                          <Star size={19} fill={favs.includes(r.path!) ? "currentColor" : "none"} />
                        </button>
                      )}
                      {r.kind === "snippet" && (
                        <button aria-label="Delete snippet" onClick={(e) => { e.stopPropagation(); setSnippets((p) => p.filter((x) => x.id !== r.id)); }}><Trash2 size={17} /></button>
                      )}
                    </span>
                  ) : (
                    <small className="alabel">{label[r.kind]}</small>
                  )}
                </div>
              );
            })}
          </div>
        ))}
        {flat.length === 0 && <div className="empty"><p>{apps.length ? `Nothing matches “${q}”.` : "Indexing apps…"}</p></div>}
      </div>
    </div>
  );
}
