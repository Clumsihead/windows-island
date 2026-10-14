import { useEffect, useState } from "react";
import { Clipboard, Copy, Search, Trash2 } from "lucide-react";
import { api, onClips, Clip } from "../api";

export default function ClipboardTab({ flash }: { flash: (m: string) => void }) {
  const [clips, setClips] = useState<Clip[]>([]);
  const [q, setQ] = useState("");

  useEffect(() => {
    api.clips().then(setClips).catch(() => {});
    const off = onClips(setClips);
    return () => {
      off.then((f) => f());
    };
  }, []);

  const shown = clips.filter((c) => c.text.toLowerCase().includes(q.toLowerCase()));

  return (
    <div className="page fill-page">
      <div className="page-heading">
        <div><h2>Clipboard</h2><p>Text copied while Island is running. Kept in memory only.</p></div>
        <button className="ghost" onClick={() => api.clearClips()} title="Clear history"><Trash2 size={13} /> Clear</button>
      </div>
      <div className="search"><Search size={14} /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search clipboard…" /></div>
      <div className="clip-list">
        {shown.map((c) => (
          <div className="clip-item" key={c.id}>
            <p>{c.text}</p>
            <div>
              <small>{new Date(c.time).toLocaleTimeString()}</small>
              <button onClick={() => api.copy(c.text).then(() => flash("Copied")).catch((e) => flash(String(e)))}><Copy size={13} /> Copy</button>
            </div>
          </div>
        ))}
        {shown.length === 0 && (
          <div className="empty"><Clipboard /><p>{clips.length ? "No matches." : "Copy some text and it will show up here."}</p></div>
        )}
      </div>
    </div>
  );
}
