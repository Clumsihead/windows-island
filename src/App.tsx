import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { ChevronDown, Music2 } from "lucide-react";
import {
  api, onExpanded, onGoto, onSettings, onTucked, onUpdate, onUpdateProgress, EMPTY_MEDIA, Media, SizeKey, UpdateInfo,
} from "./api";
import { usePoll, useClock, useHour24, formatTime, mmss } from "./hooks";
import { useTimer } from "./timer";
import { SpringBox, OPEN, RETAB, CLOSE, Box } from "./spring";
import MediaCard from "./media";
import Controls from "./tabs/Controls";
import Today from "./tabs/Today";
import StatsTab from "./tabs/StatsTab";
import ClipboardTab from "./tabs/ClipboardTab";
import Apps from "./tabs/Apps";
import Wallpaper from "./tabs/Wallpaper";
import PowerTab from "./tabs/PowerTab";
import SettingsTab from "./tabs/SettingsTab";

// Layout size at scale 1.0 (logical px). Keep in sync with "width" / "height" in
// src-tauri/tauri.conf.json and BASE_W / BASE_H in src-tauri/src/island.rs.
export const BASE_W = 1320;

// Island size presets. They describe how big the island *looks on screen*, whatever Windows'
// display scaling is: 1.0 is about 960 physical px wide for the Controls tab. The design is
// drawn for 125% display scaling (REF_DPR), so other scales are compensated for automatically.
const SIZE_FACTOR: Record<SizeKey, number> = { small: 0.7, medium: 0.85, large: 1 };
const REF_DPR = 1.25;

export type Tab = "Controls" | "Today" | "Stats" | "Clipboard" | "Apps" | "Wallpaper" | "Power" | "Settings";
// Panel size per tab, in logical px.
const TABS: { name: Tab; w: number; h: number }[] = [
  { name: "Controls", w: 800, h: 524 },
  { name: "Today", w: 1056, h: 532 },
  { name: "Stats", w: 1056, h: 404 },
  { name: "Clipboard", w: 1056, h: 536 },
  { name: "Apps", w: 864, h: 692 },
  { name: "Wallpaper", w: 1248, h: 376 },
  { name: "Power", w: 800, h: 200 },
  { name: "Settings", w: 800, h: 724 },
];
const PEEK = { w: 456, h: 180 };
const COMPACT_H = 32;
// In "Everywhere" mode, with another app in front, the notch slides up until only this much of its
// bottom edge (logical px) is left showing at the top of the screen.
const TUCK_SHOW = 5;

type Mode = "compact" | "peek" | "full";

const reduceMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export type TabProps = { flash: (m: string) => void; collapse: () => void };

export default function App() {
  const [expanded, setExpanded] = useState(false);
  const [view, setView] = useState<"peek" | "full">("peek");
  const [tucked, setTucked] = useState(false);
  const [tab, setTab] = useState<Tab>("Controls");
  const [art, setArt] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [update, setUpdate] = useState<UpdateInfo | null>(null);
  const [updatePct, setUpdatePct] = useState<number | null>(null);
  const [installing, setInstalling] = useState(false);
  const [nudgeOff, setNudgeOff] = useState(false); // "not now" for this update
  const [preset, setPreset] = useState<SizeKey>("medium");
  const [dpr, setDpr] = useState(window.devicePixelRatio || 1);
  const boxRef = useRef<HTMLDivElement>(null);
  const spring = useRef<SpringBox | null>(null);
  const prevMode = useRef<Mode>("compact");
  const msgTimer = useRef<number | undefined>(undefined);

  const media = usePoll<Media>(api.media, expanded ? 1000 : 2500, EMPTY_MEDIA);
  const now = useClock(!expanded);
  const [h24] = useHour24();
  const timer = useTimer();

  // UI scale = chosen preset, corrected for this display's Windows scaling
  const eff = Math.min(1.4, Math.max(0.4, (SIZE_FACTOR[preset] * REF_DPR) / dpr));

  const flash = useCallback((m: string) => {
    setMessage(m);
    window.clearTimeout(msgTimer.current);
    msgTimer.current = window.setTimeout(() => setMessage(""), 2600);
  }, []);
  const collapse = useCallback(() => api.setExpanded(false), []);

  // Window <-> Rust state
  useEffect(() => {
    api.getIsland().then((s) => { setExpanded(s.expanded); setView(s.held ? "full" : "peek"); setTucked(s.tucked); }).catch(() => {});
    const offT = onTucked(setTucked);
    const offA = onExpanded((v) => {
      setExpanded(v);
      if (!v) setView("peek");
      else api.getIsland().then((s) => setView(s.held ? "full" : "peek")).catch(() => {});
    });
    const offB = onGoto((t) => {
      if (TABS.some((x) => x.name === t)) {
        setTab(t as Tab);
        setView("full");
      }
    });
    return () => {
      offA.then((f) => f());
      offB.then((f) => f());
      offT.then((f) => f());
    };
  }, []);

  // Size preset (from the tray or the Power tab) and display-scale changes
  useEffect(() => {
    api.getSettings().then((s) => setPreset(s.size)).catch(() => {});
    const off = onSettings((s) => setPreset(s.size));
    const onResize = () => setDpr(window.devicePixelRatio || 1);
    window.addEventListener("resize", onResize);
    return () => {
      off.then((f) => f());
      window.removeEventListener("resize", onResize);
    };
  }, []);

  // Make the (transparent) window match the scaled island
  useEffect(() => {
    api.setScale(eff).catch(() => {});
  }, [eff]);

  // Auto-update prompt
  useEffect(() => {
    api.updatePending().then((u) => u && setUpdate(u)).catch(() => {});
    const offA = onUpdate(setUpdate);
    const offP = onUpdateProgress((p) => setUpdatePct(p));
    return () => {
      offA.then((f) => f());
      offP.then((f) => f());
    };
  }, []);
  useEffect(() => setNudgeOff(false), [update?.version]);
  const installUpdate = useCallback(() => {
    setInstalling(true);
    api.updateInstall().catch(() => {
      setInstalling(false);
      flash("Update failed. Try again from the tray menu");
    });
  }, [flash]);

  // Timer finished (it keeps running while you're on other tabs)
  useEffect(() => {
    const done = () => {
      setTab("Today");
      flash("Timer finished");
    };
    window.addEventListener("island:timer-done", done);
    return () => window.removeEventListener("island:timer-done", done);
  }, [flash]);

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

  // The morph
  const playing = media.available && media.playing;
  const mode: Mode = !expanded ? "compact" : view === "peek" && media.available ? "peek" : "full";
  const size = TABS.find((t) => t.name === tab)!;
  const tuckedNow = tucked && !expanded; // only the bottom edge shows
  const target: Box =
    mode === "compact"
      ? { w: playing || timer.running ? 232 : 190, h: COMPACT_H, r: 16, e: 10 }
      : mode === "peek"
      ? { ...PEEK, r: 34, e: 22 }
      : { w: size.w, h: size.h, r: 38, e: 30 };

  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    if (!spring.current) spring.current = new SpringBox(el, target);
    const cfg = mode === "compact" ? CLOSE : prevMode.current === "compact" ? OPEN : RETAB;
    spring.current.to(target, cfg, reduceMotion());
    prevMode.current = mode;
    // Tell Rust the island's target shape so hover and click-through use the right area.
    // (window-relative logical px, so scaled by eff)
    // While tucked, the island sits above the screen edge, so its rectangle starts at a negative y and
    // only its bottom few pixels are inside the hover zone.
    const y = tuckedNow ? -(COMPACT_H - TUCK_SHOW) * eff : 0;
    api.setRect({ x: ((BASE_W - target.w) / 2) * eff, y, w: target.w * eff, h: target.h * eff }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, target.w, target.h, eff, tuckedNow]);

  const tabProps: TabProps = { flash, collapse };

  return (
    <main className="stage" style={{ ["--ui" as string]: eff } as CSSProperties}>
      <div ref={boxRef} className={`island is-${mode}${tuckedNow ? " is-tucked" : ""}`}>
        <i className="ear l" />
        <i className="ear r" />
        <div className="body">
          {/* compact: the little notch */}
          <div className="v-compact">
            {playing && (
              <span className="cart">{art ? <img src={art} alt="" /> : <Music2 size={12} />}</span>
            )}
            <span className="ctext">{timer.running ? `⏱ ${mmss(timer.remaining)}` : formatTime(now, h24)}</span>
            {playing && (
              <span className="eq" aria-hidden><i /><i /><i /><i /></span>
            )}
            {update && <i className="udot" title={`Update v${update.version} available`} />}
          </div>

          {/* peek: the media card shown on hover while something is playing */}
          <div
            className="v-peek"
            onClick={(e) => {
              if (!(e.target as HTMLElement).closest("button")) setView("full");
            }}
          >
            <MediaCard media={media} art={art} layout="peek" />
            <button className="peek-more" onClick={() => setView("full")} aria-label="Open everything" title="Open everything">
              <ChevronDown size={18} />
            </button>
          </div>

          {/* full: tabs */}
          <div className="v-panel" style={{ width: size.w, height: size.h }}>
            <header className="topbar">
              <nav className="tabs">
                {TABS.map((t) => (
                  <button key={t.name} className={`tab ${tab === t.name ? "on" : ""}`} onClick={() => setTab(t.name)}>
                    {t.name}
                    {t.name === "Settings" && update && <i className="tdot" title="Update available" />}
                  </button>
                ))}
              </nav>
            </header>
            <section className="content" key={tab}>
              {tab === "Controls" && <Controls {...tabProps} media={media} art={art} />}
              {tab === "Today" && <Today {...tabProps} />}
              {tab === "Stats" && <StatsTab />}
              {tab === "Clipboard" && <ClipboardTab {...tabProps} />}
              {tab === "Apps" && <Apps {...tabProps} />}
              {tab === "Wallpaper" && <Wallpaper {...tabProps} />}
              {tab === "Power" && <PowerTab {...tabProps} />}
              {tab === "Settings" && (
                <SettingsTab {...tabProps} update={update} installing={installing} updatePct={updatePct} onInstall={installUpdate} />
              )}
            </section>
            {update && !nudgeOff && tab !== "Settings" && (
              <div className="nudge" role="status">
                <span>Update v{update.version} is available</span>
                <button className="update-btn" onClick={installUpdate} disabled={installing}>
                  {installing ? `Updating${updatePct !== null ? ` ${updatePct}%` : "…"}` : "Update now"}
                </button>
                <button className="nudge-x" onClick={() => setNudgeOff(true)} aria-label="Not now" title="Not now">×</button>
              </div>
            )}
            {message && <div className="toast">{message}</div>}
          </div>
        </div>
      </div>
    </main>
  );
}
