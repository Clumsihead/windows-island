import { useEffect, useMemo, useRef, useState } from "react";
import { FolderOpen } from "lucide-react";
import { open } from "@tauri-apps/plugin-dialog";
import { api } from "../api";
import { useIcons, useLocal } from "../hooks";
import type { TabProps } from "../App";

type Source = "Recent" | "My folder";

export default function Wallpaper({ flash }: TabProps) {
  const [source, setSource] = useState<Source>("Recent");
  const [folder, setFolder] = useLocal<string>("island.wpfolder", "");
  const [history, setHistory] = useLocal<string[]>("island.wprecent", []);
  const [defaults, setDefaults] = useState<string[]>([]);
  const [current, setCurrent] = useState<string | null>(null);
  const [folderImages, setFolderImages] = useState<string[]>([]);
  const [sel, setSel] = useState(0);
  const wheelLock = useRef(0);

  useEffect(() => {
    api.defaultWallpapers().then(setDefaults).catch(() => {});
    api.wallpaperGet().then(setCurrent).catch(() => {});
  }, []);
  useEffect(() => {
    if (folder) api.listImages(folder).then(setFolderImages).catch(() => setFolderImages([]));
  }, [folder]);

  const items = useMemo(() => {
    if (source === "My folder") return folderImages;
    return Array.from(new Set([...(current ? [current] : []), ...history, ...defaults])).slice(0, 14);
  }, [source, folderImages, current, history, defaults]);

  useEffect(() => setSel(0), [source]);
  const n = items.length;
  const visible = useMemo(() => {
    if (n === 0) return [];
    if (n < 5) return items.map((p, i) => ({ p, i, o: i - sel })).filter((v) => Math.abs(v.o) <= 2);
    return [-2, -1, 0, 1, 2].map((o) => {
      const i = (((sel + o) % n) + n) % n; // wraps around
      return { p: items[i], i, o };
    });
  }, [items, sel, n]);
  const thumb = useIcons(visible.map((v) => v.p), 640);

  const apply = (path: string) =>
    api.setWallpaper(path).then(() => {
      setCurrent(path);
      setHistory((h) => [path, ...h.filter((x) => x !== path)].slice(0, 12));
      flash("Wallpaper changed");
    }).catch((e) => flash(String(e)));

  const chooseFolder = async () => {
    // The dialog steals focus and the cursor leaves the island: keep it open meanwhile.
    await api.setPinned(true);
    try {
      const picked = await open({ directory: true, multiple: false });
      if (typeof picked === "string") {
        setFolder(picked);
        setSource("My folder");
      }
    } finally {
      await api.setPinned(false);
    }
  };

  const onWheel = (e: React.WheelEvent) => {
    const now = performance.now();
    if (now - wheelLock.current < 140) return;
    wheelLock.current = now;
    const dir = e.deltaY > 0 || e.deltaX > 0 ? 1 : -1;
    setSel((s) => (n >= 5 ? (s + dir + n) % n : Math.max(0, Math.min(n - 1, s + dir))));
  };

  return (
    <div className="wall">
      <div className="wall-top">
        {(["Recent", "My folder"] as Source[]).map((s) => (
          <button key={s} className={`pillbtn ${source === s ? "on" : ""}`} onClick={() => setSource(s)}>{s}</button>
        ))}
        <small>{items.length} {items.length === 1 ? "picture" : "pictures"}</small>
        <button className="round-btn" onClick={chooseFolder} aria-label="Choose a folder" title="Choose a folder"><FolderOpen size={20} /></button>
      </div>

      <div className="wall-strip" onWheel={onWheel}>
        {visible.map(({ p, i, o }) => {
          const src = thumb(p);
          return (
            <button
              key={p}
              className={`wall-item ${o === 0 ? "center" : "side"} ${p === current ? "current" : ""}`}
              onClick={() => (o === 0 ? apply(p) : setSel(i))}
              title={o === 0 ? "Click to set as wallpaper" : undefined}
            >
              {src ? <img src={src} alt="" /> : <span className="wall-ph" />}
            </button>
          );
        })}
        {items.length === 0 && (
          <div className="empty"><p>{source === "My folder" ? "Pick a folder with the button at the top right." : "No wallpapers found yet."}</p></div>
        )}
      </div>
    </div>
  );
}
