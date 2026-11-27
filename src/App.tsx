import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { ChevronDown } from "lucide-react";
import {
  api, onExpanded, onGoto, onSettings, onTucked, onUpdate, onUpdateProgress, onWheel,
  EMPTY_MEDIA, Media, SizeKey, UpdateInfo,
} from "./api";
import { usePoll, useClock, useHour24, formatTime, mmss } from "./hooks";
import { useTimer } from "./timer";
import { SpringBox, OPEN, RETAB, CLOSE, Box } from "./spring";
import MediaCard from "./media";
import Notch from "./notch";
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

export type Tab =
  | "Controls" | "Today" | "Stats" | "Clipboard" | "Apps" | "Wallpaper" | "Power" | "Settings";
// Panel size per tab, in logical px.
const TABS: { name: Tab; w: number; h: number }[] = [
  { name: "Controls", w: 940, h: 448 },
  { name: "Today", w: 1056, h: 532 },
  { name: "Stats", w: 1056, h: 404 },
  { name: "Clipboard", w: 1056, h: 536 },
  { name: "Apps", w: 940, h: 700 },
  { name: "Wallpaper", w: 1248, h: 376 },
  { name: "Power", w: 800, h: 200 },
  { name: "Settings", w: 800, h: 724 },
];
const PEEK = { w: 470, h: 196 };
// Thickness of the notch (stage 0). Keep in sync with .v-compact height and .is-tucked in styles.css.
const COMPACT_H = 38;
// Width of the notch: the same small size for both; a touch wider when a player adds bars and its icon.
const NOTCH_W = 282;
const NOTCH_W_MEDIA = 288;
// Island height while a Controls panel is open. The window is 760px tall, so keep these below that.
const PANEL_H = { wifi: 750, bluetooth: 673, audio: 673 } as const;
// One more slider row (66px) and its gap: the Controls panel grows by this while the night light is on.
const NIGHT_ROW = 83;
// The media card (150px) and its gap: the Controls panel grows by this while something is loaded.
const MEDIA_ROW = 167;
// In "Everywhere" mode, with another app in front, the notch slides up until only this much of its
// bottom edge (logical px) is left showing at the top of the screen.
const TUCK_SHOW = 8;
// How far below the island's top edge a wheel still counts as "over the tab bar".
const TAB_BAND = 72;
// Webview wheel fallback: enough travel to mean "one notch", and one rung per third of a second.
const DOM_WHEEL_STEP = 30;
const DOM_WHEEL_COOLDOWN = 320;
// While the native hook (src-tauri/src/scroll.rs) keeps reporting steps, the fallback stays quiet
// so one flick never moves two rungs.
const HOOK_WHEEL_TRUST = 1500;

type Mode = "compact" | "peek" | "full";
/** 0 = the notch, 1 = the media card, 2 = the full panel. Scrolling walks up and down this ladder. */
type Stage = 0 | 1 | 2;

const reduceMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export type TabProps = { flash: (m: string) => void; collapse: () => void };

export default function App() {
  const [expanded, setExpanded] = useState(false);
  const [held, setHeld] = useState(false);
  const [stage, setStage] = useState<Stage>(0);
  // Whether this open started on the notch rung. Decided once when the island opens, so a media
  // poll landing a moment later can't shrink an already-open panel back to the notch.
  const [armed, setArmed] = useState(false);
  const [tucked, setTucked] = useState(false);
  const [tab, setTab] = useState<Tab>("Controls");
  const [controlsPanel, setControlsPanel] = useState<keyof typeof PANEL_H | null>(null);
  const [art, setArt] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [update, setUpdate] = useState<UpdateInfo | null>(null);
  const [updatePct, setUpdatePct] = useState<number | null>(null);
  const [installing, setInstalling] = useState(false);
  const [nudgeOff, setNudgeOff] = useState(false); // "not now" for this update
  const [preset, setPreset] = useState<SizeKey>("medium");
  const [night, setNight] = useState(false);
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
    api.getIsland()
      .then((s) => {
        setExpanded(s.expanded);
        setHeld(s.held);
        setStage(s.expanded && !s.held ? 0 : 2);
        setArmed(s.expanded && !s.held);
      })
      .catch(() => {});
    const offT = onTucked(setTucked);
    const offA = onExpanded((v) => {
      setExpanded(v);
      if (!v) {
        setStage(0);
        setHeld(false);
        return;
      }
      api.getIsland()
        .then((s) => {
          setHeld(s.held);
          setStage(s.held ? 2 : 0);
          // Only stop at the notch when something is playing right now; otherwise open fully.
          setArmed(!s.held && mediaRef.current);
        })
        .catch(() => setStage(2));
    });
    const offB = onGoto((t) => {
      if (TABS.some((x) => x.name === t)) {
        setTab(t as Tab);
        setStage(2);
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
    api.getSettings()
      .then((s) => {
        setPreset(s.size);
        setNight(s.nightEnabled);
      })
      .catch(() => {});
    const off = onSettings((s) => {
      setPreset(s.size);
      setNight(s.nightEnabled);
    });
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
  // Hovering while something plays stops at the notch (stage 0) and waits for a scroll;
  // without media, and whenever the hotkey opens it, the panel shows straight away.
  const mode: Mode = !expanded
    ? "compact"
    : armed && !held && stage < 2
    ? stage === 1
      ? "peek"
      : "compact"
    : "full";
  const base = TABS.find((t) => t.name === tab)!;
  // Controls grows when one of its panels (Wi-Fi, Bluetooth...) is open, by a row while the
  // night light is on, and by the media card while something is loaded. Must stay under the window's 760px height.
  const size =
    tab === "Controls" && controlsPanel
      ? { ...base, h: PANEL_H[controlsPanel] }
      : tab === "Controls"
      ? { ...base, h: base.h + (night ? NIGHT_ROW : 0) + (media.available ? MEDIA_ROW : 0) }
      : base;
  const tuckedNow = tucked && !expanded; // only the bottom edge shows
  const target: Box =
    mode === "compact"
      ? { w: media.available ? NOTCH_W_MEDIA : NOTCH_W, h: COMPACT_H, r: 16, e: 10 }
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

  // ---- scroll ladder: notch -> media card -> Controls -> other tabs
  const expandedRef = useRef(expanded);
  expandedRef.current = expanded;
  const mediaRef = useRef(media.available);
  mediaRef.current = media.available;
  const heldRef = useRef(held);
  heldRef.current = held;
  const tabRef = useRef<Tab>(tab);
  tabRef.current = tab;
  const armedRef = useRef(false);
  armedRef.current = armed;
  const stageRef = useRef<Stage>(2);
  // Without the notch rung the island is always fully open, so a wheel is on the last rung.
  stageRef.current = armedRef.current && !heldRef.current ? stage : 2;
  const wheelAt = useRef(0);
  const hookAt = useRef(performance.now());
  const domWheel = useRef({ sum: 0, last: 0 });

  /** Over the tab bar, or over something that doesn't scroll: a wheel there switches tabs. */
  const allowsTabWheel = (x: number, y: number) => {
    if (y < TAB_BAND * eff) return true;
    const el = document.elementFromPoint(x, y);
    return !el?.closest("[data-scroll]");
  };

  const stepWheel = (dir: 1 | -1, x: number, y: number) => {
    if (!expandedRef.current) return;
    const at = performance.now();
    if (at - wheelAt.current < 140) return; // Rust already throttles; this only kills double steps
    wheelAt.current = at;
    const s = stageRef.current;

    if (dir === 1) {
      if (s === 0) return setStage(1);
      if (s === 1) {
        setTab("Controls");
        setControlsPanel(null);
        return setStage(2);
      }
      if (!allowsTabWheel(x, y)) return;
      const i = TABS.findIndex((t) => t.name === tabRef.current);
      setTab(TABS[(i + 1) % TABS.length].name);
      return;
    }

    if (s === 2) {
      // The panel is the top rung: a wheel here always moves between tabs. It never walks back
      // down to the media card or the notch — the island closes (or the cursor leaves) for that.
      // Scrolling up is the previous tab, the same way a list would scroll back.
      if (!allowsTabWheel(x, y)) return;
      const i = TABS.findIndex((t) => t.name === tabRef.current);
      setTab(TABS[(i - 1 + TABS.length) % TABS.length].name);
      return;
    }
    if (s === 1) setStage(0);
  };
  const stepRef = useRef(stepWheel);
  stepRef.current = stepWheel;

  useEffect(() => {
    const off = onWheel((e) => {
      hookAt.current = performance.now();
      stepRef.current(e.dir === 1 ? 1 : -1, e.x, e.y);
    });
    return () => {
      off.then((f) => f());
    };
  }, []);

  // Fallback: while the island is hit-testable the webview gets the wheel itself, so the ladder
  // still works if the low-level hook cannot see it (or was never installed).
  useEffect(() => {
    const onDomWheel = (e: WheelEvent) => {
      if (!expandedRef.current) return;
      if (performance.now() - hookAt.current < HOOK_WHEEL_TRUST) return;
      // deltaMode 1 = lines, 2 = pages: bring both into the same pixel-sized scale as deltaMode 0.
      const d = e.deltaMode === 1 ? e.deltaY * 40 : e.deltaMode === 2 ? e.deltaY * 400 : e.deltaY;
      const now = performance.now();
      const acc = domWheel.current;
      if (now - acc.last < DOM_WHEEL_COOLDOWN) {
        acc.sum = 0;
        return;
      }
      acc.sum += d;
      if (Math.abs(acc.sum) < DOM_WHEEL_STEP) return;
      const dir = acc.sum > 0 ? 1 : -1;
      acc.sum = 0;
      acc.last = now;
      stepRef.current(dir, e.clientX, e.clientY);
    };
    window.addEventListener("wheel", onDomWheel, { passive: true });
    return () => window.removeEventListener("wheel", onDomWheel);
  }, []);

  const tabProps: TabProps = { flash, collapse };

  return (
    <main className="stage" style={{ ["--ui" as string]: eff } as CSSProperties}>
      <div ref={boxRef} className={`island is-${mode}${tuckedNow ? " is-tucked" : ""}`}>
        <i className="shape" aria-hidden />
        <div className="body">
          {/* compact: the little notch. While a track is playing this rung is the island's resting
              state after a hover, so a click on it opens the panel straight away. */}
          <div className="v-compact" onClick={() => setStage(2)}>
            <Notch
              media={media}
              playing={playing}
              active={mode === "compact"}
              art={art}
              text={timer.running ? `⏱ ${mmss(timer.remaining)}` : formatTime(now, h24)}
              updateVersion={update?.version ?? null}
            />
          </div>

          {/* peek: the media card shown one rung below the notch */}
          <div
            className="v-peek"
            onClick={(e) => {
              if (!(e.target as HTMLElement).closest("button, .wp-track")) setStage(2);
            }}
          >
            <MediaCard media={media} art={art} layout="peek" />
            <button className="peek-more" onClick={() => setStage(2)} aria-label="Open everything" title="Open everything">
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
              {tab === "Controls" && (
                <Controls {...tabProps} media={media} art={art} onPanel={setControlsPanel} night={night} onNight={setNight} />
              )}
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
