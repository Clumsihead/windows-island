import { useCallback, useEffect, useRef, useState } from "react";
import {
  Activity, ChevronUp, Clipboard, Grid2X2, Image as ImageIcon, Music2, Power,
  SlidersHorizontal, CalendarDays,
} from "lucide-react";
import { api, onExpanded, EMPTY_MEDIA, Stats, Media } from "./api";
import { usePoll, useClock } from "./hooks";
import { SpringBox, OPEN, RETAB, CLOSE, Box } from "./spring";
import Controls from "./tabs/Controls";
import Today from "./tabs/Today";
import StatsTab from "./tabs/StatsTab";
import ClipboardTab from "./tabs/ClipboardTab";
import Apps from "./tabs/Apps";
import Wallpaper from "./tabs/Wallpaper";
import PowerTab from "./tabs/PowerTab";

// Keep in sync with "width" in src-tauri/tauri.conf.json.
const WIN_W = 560;
const PANEL_W = 520;
const COMPACT_H = 44;

export type Tab = "Controls" | "Today" | "Stats" | "Clipboard" | "Apps" | "Wallpaper" | "Power";
const TABS: { name: Tab; icon: typeof Power; h: number }[] = [
  { name: "Controls", icon: SlidersHorizontal, h: 430 },
  { name: "Today", icon: CalendarDays, h: 300 },
  { name: "Stats", icon: Activity, h: 440 },
  { name: "Clipboard", icon: Clipboard, h: 430 },
  { name: "Apps", icon: Grid2X2, h: 420 },
  { name: "Wallpaper", icon: ImageIcon, h: 250 },
  { name: "Power", icon: Power, h: 290 },
];

const reduceMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export default function App() {
  const [expanded, setExpanded] = useState(false);
  const [tab, setTab] = useState<Tab>("Controls");
  const [art, setArt] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const boxRef = useRef<HTMLDivElement>(null);
  const spring = useRef<SpringBox | null>(null);
  const prev = useRef({ expanded: false, tab: "Controls" as Tab });
  const msgTimer = useRef<number | undefined>(undefined);

  const stats = usePoll<Stats | null>(api.stats, expanded ? 1000 : 5000, null);
  const media = usePoll<Media>(api.media, expanded ? 1000 : 2000, EMPTY_MEDIA);
  const now = useClock(!expanded);

  // Window <-> Rust state
  useEffect(() => {
    api.getIsland().then((s) => setExpanded(s.expanded)).catch(() => {});
    const off = onExpanded(setExpanded);
    return () => {
      off.then((f) => f());
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") api.setExpanded(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Album art: fetched once per track.
  const trackKey = media.available ? `${media.title}|${media.artist}` : "";
  useEffect(() => {
    if (!trackKey) return setArt(null);
    let alive = true;
    api.mediaArt().then((a) => alive && setArt(a)).catch(() => {});
    return () => {
      alive = false;
    };
  }, [trackKey]);

  // The morph.
  const tabH = TABS.find((t) => t.name === tab)!.h;
  const compactW = media.available && media.playing ? 340 : 280;
  const target: Box = expanded ? { w: PANEL_W, h: tabH, r: 28 } : { w: compactW, h: COMPACT_H, r: 20 };

  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    if (!spring.current) spring.current = new SpringBox(el, target);
    const p = prev.current;
    const cfg = !expanded ? CLOSE : p.expanded ? RETAB : OPEN;
    spring.current.to(target, cfg, reduceMotion());
    prev.current = { expanded, tab };
    // Tell Rust the island's target shape so hover / click-through use the right area.
    api.setRect({ x: (WIN_W - target.w) / 2, y: 0, w: target.w, h: target.h }).catch(() => {});
  }, [target.w, target.h, target.r, expanded, tab]);

  const flash = useCallback((m: string) => {
    setMessage(m);
    window.clearTimeout(msgTimer.current);
    msgTimer.current = window.setTimeout(() => setMessage(""), 2400);
  }, []);

  const collapse = useCallback(() => api.setExpanded(false), []);
  const tabProps = { flash, collapse, stats, media, art };

  return (
    <main className="stage">
      <div ref={boxRef} className={`island ${expanded ? "open" : "closed"}`}>
        {/* compact face */}
        <div className="compact">
          <span className="mark">
            {art ? <img src={art} alt="" /> : <Music2 size={14} />}
          </span>
          <span className="compact-title">
            {media.available && media.playing
              ? media.title || "Playing"
              : now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
          </span>
          {media.available && media.playing ? (
            <span className="eq" aria-hidden><i /><i /><i /><i /></span>
          ) : (
            <span className="chip">{stats ? `CPU ${Math.round(stats.cpu)}%` : "Ready"}</span>
          )}
        </div>

        {/* expanded face: fixed size per tab, revealed by the growing box */}
        <div className="panel" style={{ width: PANEL_W, height: tabH }}>
          <header className="topbar">
            <nav className="tabs">
              {TABS.map(({ name, icon: Icon }) => (
                <button key={name} className={`tab ${tab === name ? "selected" : ""}`} onClick={() => setTab(name)} title={name}>
                  <Icon size={14} />
                  <span>{name}</span>
                </button>
              ))}
            </nav>
            <button className="collapse" onClick={collapse} title="Collapse (Esc)">
              <ChevronUp size={16} />
            </button>
          </header>
          <section className="content" key={tab}>
            {tab === "Controls" && <Controls {...tabProps} />}
            {tab === "Today" && <Today />}
            {tab === "Stats" && <StatsTab stats={stats} />}
            {tab === "Clipboard" && <ClipboardTab flash={flash} />}
            {tab === "Apps" && <Apps flash={flash} collapse={collapse} />}
            {tab === "Wallpaper" && <Wallpaper flash={flash} />}
            {tab === "Power" && <PowerTab flash={flash} collapse={collapse} />}
          </section>
          <footer className="footer">
            <span className="live-dot" />
            <span>{message || "Windows Island"}</span>
            <span className="spacer" />
            <span>{stats ? `CPU ${Math.round(stats.cpu)}% · RAM ${Math.round((stats.ramUsed / stats.ramTotal) * 100)}%` : "Connecting…"}</span>
          </footer>
        </div>
      </div>
    </main>
  );
}

export type TabProps = {
  flash: (m: string) => void;
  collapse: () => void;
  stats: Stats | null;
  media: Media;
  art: string | null;
};
