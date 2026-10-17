import { useEffect, useMemo, useRef, useState } from "react";
import { FileText, Image as ImageIcon, Link2, Pin, Search, Settings } from "lucide-react";
import { api, onClips, Clip } from "../api";
import { bytes, timeAgo } from "../hooks";
import type { TabProps } from "../App";

type Filter = "All" | "Text" | "Images" | "Links";
const FILTERS: Filter[] = ["All", "Text", "Images", "Links"];
const isLink = (c: Clip) => c.kind === "text" && /^https?:\/\/\S+$/i.test(c.text.trim());

function title(c: Clip) {
  if (c.kind === "image") return `Image • ${c.width}×${c.height}`;
  const first = c.text.split("\n").find((l) => l.trim()) ?? c.text;
  return first.length > 70 ? first.slice(0, 70) + "…" : first;
}

export default function ClipboardTab({ flash }: TabProps) {
  const [clips, setClips] = useState<Clip[]>([]);
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<Filter>("All");
  const [sel, setSel] = useState<string | null>(null);
  const [menu, setMenu] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api.clips().then(setClips).catch(() => {});
    const off = onClips(setClips);
    return () => {
      off.then((f) => f());
    };
  }, []);

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return clips.filter((c) => {
      if (filter === "Text" && c.kind !== "text") return false;
      if (filter === "Images" && c.kind !== "image") return false;
      if (filter === "Links" && !isLink(c)) return false;
      if (!needle) return true;
      return c.kind === "image" ? "image".includes(needle) : c.text.toLowerCase().includes(needle);
    });
  }, [clips, q, filter]);

  // keep the selection valid
  const active = shown.find((c) => c.id === sel) ?? shown[0] ?? null;
  useEffect(() => {
    listRef.current?.querySelector(".crow.sel")?.scrollIntoView({ block: "nearest" });
  }, [active?.id]);

  const run = (p: Promise<unknown>, ok?: string) => p.then(() => ok && flash(ok)).catch((e) => flash(String(e)));

  const onKeyDown = (e: React.KeyboardEvent) => {
    const i = active ? shown.findIndex((c) => c.id === active.id) : -1;
    if (e.key === "ArrowDown") { e.preventDefault(); setSel(shown[Math.min(shown.length - 1, i + 1)]?.id ?? null); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setSel(shown[Math.max(0, i - 1)]?.id ?? null); }
    else if (e.key === "Tab") { e.preventDefault(); setFilter(FILTERS[(FILTERS.indexOf(filter) + 1) % FILTERS.length]); }
    else if (!active) return;
    else if (e.key === "Enter") { e.preventDefault(); run(api.clipPaste(active.id)); }
    else if (e.key === "Delete") { e.preventDefault(); run(api.clipRemove(active.id)); }
    else if (e.ctrlKey && e.key.toLowerCase() === "p") { e.preventDefault(); run(api.clipPin(active.id)); }
    else if (e.ctrlKey && e.key.toLowerCase() === "c" && !window.getSelection()?.toString()) {
      e.preventDefault();
      run(api.clipCopy(active.id), "Copied");
    }
  };

  return (
    <div className="clip" onKeyDown={onKeyDown}>
      <div className="searchbar">
        <Search size={20} />
        <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder={`Search ${clips.length} items…`} />
        <div className="filters">
          {FILTERS.map((f) => (
            <button key={f} className={filter === f ? "on" : ""} onClick={() => setFilter(f)}>{f}</button>
          ))}
        </div>
        <div className="gear">
          <button onClick={() => setMenu((m) => !m)} aria-label="Clipboard options"><Settings size={19} /></button>
          {menu && (
            <div className="gear-menu">
              <button onClick={() => { api.clipClear(); setMenu(false); flash("History cleared (pinned items kept)"); }}>Clear history</button>
            </div>
          )}
        </div>
      </div>

      <div className="clip-body">
        <div className="clist" ref={listRef}>
          {shown.map((c) => (
            <button key={c.id} className={`crow ${active?.id === c.id ? "sel" : ""}`} onClick={() => setSel(c.id)} onDoubleClick={() => run(api.clipPaste(c.id))}>
              <span className="cthumb">
                {c.thumb ? <img src={c.thumb} alt="" /> : isLink(c) ? <Link2 size={18} /> : <FileText size={18} />}
              </span>
              <span className="ctitle">{title(c)}</span>
              {c.pinned && <Pin size={13} className="cpin" />}
              <small>{timeAgo(c.time)}</small>
            </button>
          ))}
          {shown.length === 0 && (
            <div className="empty"><ImageIcon size={26} /><p>{clips.length ? "No matches." : "Copy some text or an image and it shows up here."}</p></div>
          )}
        </div>

        <div className="cpreview">
          {active ? (
            <>
              <div className="cprev-main">
                {active.thumb ? <img src={active.thumb} alt="" /> : <pre>{active.text}</pre>}
              </div>
              <dl>
                <div><dt>Type</dt><dd>{active.kind === "image" ? "Image" : isLink(active) ? "Link" : "Text"}</dd></div>
                <div><dt>Size</dt><dd>{active.kind === "image" ? `${active.width} × ${active.height} px` : `${active.text.length} characters`}{active.kind === "image" ? ` • ${bytes(active.size)}` : ""}</dd></div>
                <div><dt>Copied</dt><dd>{new Date(active.time).toLocaleString([], { weekday: undefined, hour: "2-digit", minute: "2-digit" })}</dd></div>
              </dl>
            </>
          ) : (
            <div className="empty"><p>Nothing selected</p></div>
          )}
        </div>
      </div>

      <div className="keys">
        <span><kbd>↵</kbd> Paste</span>
        <span><kbd>Ctrl C</kbd> Copy</span>
        <span><kbd>Ctrl P</kbd> Pin</span>
        <span><kbd>Del</kbd> Remove</span>
        <span className="keys-r">↑↓ Move • Tab Filter</span>
      </div>
    </div>
  );
}
