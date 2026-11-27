import { useEffect, useState, type CSSProperties } from "react";
import { api, onSettings, FullscreenMode, SizeKey, UpdateInfo, UpdaterStatus, Visibility } from "../api";
import { useHour24 } from "../hooks";
import {
  DEFAULT_APPEARANCE,
  MAX_LIGHTNESS,
  MIN_OPACITY,
  hexToHsl,
  hslToHex,
  isDefaultAppearance,
  resetAppearance,
  setAppearance,
  useAppearance,
  type Hsl,
} from "../appearance";
import type { TabProps } from "../App";

const SIZES: { key: SizeKey; label: string }[] = [
  { key: "small", label: "Small" },
  { key: "medium", label: "Medium" },
  { key: "large", label: "Large" },
];

const SWATCHES: { name: string; hex: string }[] = [
  { name: "Default", hex: DEFAULT_APPEARANCE.color },
  { name: "Graphite", hex: "#16171a" },
  { name: "Midnight", hex: "#0b1426" },
  { name: "Ocean", hex: "#0a2029" },
  { name: "Forest", hex: "#0e1f14" },
  { name: "Plum", hex: "#21112b" },
  { name: "Wine", hex: "#2a0f16" },
  { name: "Slate", hex: "#232830" },
];

type Props = TabProps & {
  update: UpdateInfo | null;
  installing: boolean;
  updatePct: number | null;
  onInstall: () => void;
};

const clock = (ms: number) => new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

export default function SettingsTab({ flash, update, installing, updatePct, onInstall }: Props) {
  const [size, setSize] = useState<SizeKey>("medium");
  const [visibility, setVisibility] = useState<Visibility>("peek");
  const [fullscreen, setFullscreen] = useState<FullscreenMode>("visible");
  const [autoUpdate, setAutoUpdate] = useState(false);
  const [h24, toggleH24] = useHour24();
  const [status, setStatus] = useState<UpdaterStatus | null>(null);
  const [checking, setChecking] = useState(false);
  const [result, setResult] = useState<{ text: string; bad: boolean } | null>(null);

  const look = useAppearance();
  // The sliders work in HSL, so keep that locally: round-tripping through hex on every tick would
  // snap the hue back to 0 whenever the colour is grey or black.
  const [hsl, setHsl] = useState<Hsl>(() => hexToHsl(look.color));
  useEffect(() => {
    // A swatch or Reset changed the colour from outside the sliders.
    if (hslToHex(hsl) !== look.color) setHsl(hexToHsl(look.color));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [look.color]);
  const pickHsl = (patch: Partial<Hsl>) => {
    const next = { ...hsl, ...patch };
    setHsl(next);
    setAppearance({ color: hslToHex(next) });
  };

  const refreshStatus = () => api.updaterStatus().then(setStatus).catch(() => {});

  useEffect(() => {
    const apply = (s: { size: SizeKey; visibility: Visibility; fullscreen?: FullscreenMode; autoUpdate?: boolean }) => {
      setSize(s.size);
      setVisibility(s.visibility);
      setFullscreen(s.fullscreen === "hidden" ? "hidden" : "visible");
      setAutoUpdate(!!s.autoUpdate);
    };
    api.getSettings().then(apply).catch(() => {});
    const off = onSettings(apply);
    refreshStatus();
    return () => {
      off.then((f) => f());
    };
  }, []);

  const checkNow = async () => {
    setChecking(true);
    setResult(null);
    try {
      const info = await api.updateCheck();
      setResult({ text: info ? `Update v${info.version} found` : "You're up to date", bad: false });
    } catch (e) {
      setResult({ text: String(e), bad: true });
    } finally {
      setChecking(false);
      refreshStatus();
    }
  };

  const notSetUp = status !== null && !status.configured;
  let checkNote = "Checked automatically a few seconds after launch, then every few hours";
  let noteClass = "";
  if (notSetUp) {
    checkNote = "Auto-update isn't switched on in this build. Install the newest release from GitHub once to turn it on";
    noteClass = "warn";
  } else if (result) {
    checkNote = result.text;
    noteClass = result.bad ? "bad" : "";
  } else if (status?.lastResult) {
    checkNote = `${status.lastResult}${status.lastChecked ? ` at ${clock(status.lastChecked)}` : ""}`;
    noteClass = status.lastResult.startsWith("Check failed") ? "bad" : "";
  }

  return (
    <div className="settings" data-scroll>
      <div className="sgroup">
        <h4>GENERAL</h4>
        <div className="srow">
          <div>
            Island size
            <small>How big it looks on screen, whatever your Windows display scaling is</small>
          </div>
          <div className="seg" role="group" aria-label="Island size">
            {SIZES.map((s) => (
              <button
                key={s.key}
                className={size === s.key ? "on" : ""}
                onClick={() => {
                  setSize(s.key);
                  api.setIslandSize(s.key).catch((e) => flash(String(e)));
                }}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>
        <div className="srow">
          <div>
            Clock format
            <small>Used in the notch and on the Today tab</small>
          </div>
          <div className="seg" role="group" aria-label="Clock format">
            <button className={h24 ? "on" : ""} onClick={() => !h24 && toggleH24()}>24-hour</button>
            <button className={!h24 ? "on" : ""} onClick={() => h24 && toggleH24()}>12-hour</button>
          </div>
        </div>
        <div className="srow">
          <div>
            Visibility
            <small>
              {visibility === "peek"
                ? "Over other apps only a thin edge shows at the top of the screen. Hover it to open"
                : "Hidden whenever an app is in front, shown on the desktop"}
            </small>
          </div>
          <div className="seg" role="group" aria-label="Visibility">
            <button
              className={visibility === "desktop" ? "on" : ""}
              onClick={() => {
                setVisibility("desktop");
                api.setVisibility("desktop").catch((e) => flash(String(e)));
              }}
            >
              Desktop only
            </button>
            <button
              className={visibility === "peek" ? "on" : ""}
              onClick={() => {
                setVisibility("peek");
                api.setVisibility("peek").catch((e) => flash(String(e)));
              }}
            >
              Everywhere
            </button>
          </div>
        </div>
        <div className="srow">
          <div>
            In full screen
            <small>
              {fullscreen === "hidden"
                ? "The notch is hidden while an app is full screen (F11, video, games). The shortcut still opens it"
                : "The notch with the clock stays visible while an app is full screen (F11, video, games)"}
            </small>
          </div>
          <div className="seg" role="group" aria-label="In full screen">
            <button
              className={fullscreen === "visible" ? "on" : ""}
              onClick={() => {
                setFullscreen("visible");
                api.setFullscreenMode("visible").catch((e) => flash(String(e)));
              }}
            >
              Visible
            </button>
            <button
              className={fullscreen === "hidden" ? "on" : ""}
              onClick={() => {
                setFullscreen("hidden");
                api.setFullscreenMode("hidden").catch((e) => flash(String(e)));
              }}
            >
              Hidden
            </button>
          </div>
        </div>
      </div>

      <div className="sgroup">
        <h4>APPEARANCE</h4>
        <div className="srow">
          <div>
            Island colour
            <small>Pick a preset, or fine-tune it below</small>
          </div>
          <div className="swatches" role="group" aria-label="Island colour presets">
            {SWATCHES.map((c) => (
              <button
                key={c.hex}
                className={`swatch${look.color === c.hex ? " on" : ""}`}
                style={{ ["--sw" as string]: c.hex } as CSSProperties}
                title={c.name}
                aria-label={c.name}
                aria-pressed={look.color === c.hex}
                onClick={() => setAppearance({ color: c.hex })}
              />
            ))}
          </div>
        </div>
        <div className="srow">
          <div>
            Custom colour
            <small>Darker shades keep the text easy to read</small>
          </div>
          <div className="sliders">
            <span>Hue</span>
            <input
              className="rng"
              type="range"
              min={0}
              max={360}
              step={1}
              value={hsl.h}
              aria-label="Hue"
              style={{ ["--track" as string]: "linear-gradient(90deg,#c0392b,#c9a227,#4f9d3a,#2a9d9d,#2f5fc4,#8e44ad,#c0392b)" } as CSSProperties}
              onChange={(e) => pickHsl({ h: +e.target.value })}
            />
            <span>Intensity</span>
            <input
              className="rng"
              type="range"
              min={0}
              max={100}
              step={1}
              value={hsl.s}
              aria-label="Colour intensity"
              style={{ ["--track" as string]: `linear-gradient(90deg,hsl(${hsl.h} 0% 30%),hsl(${hsl.h} 100% 30%))` } as CSSProperties}
              onChange={(e) => pickHsl({ s: +e.target.value })}
            />
            <span>Brightness</span>
            <input
              className="rng"
              type="range"
              min={0}
              max={MAX_LIGHTNESS}
              step={0.5}
              value={Math.min(hsl.l, MAX_LIGHTNESS)}
              aria-label="Brightness"
              style={{ ["--track" as string]: `linear-gradient(90deg,#000,hsl(${hsl.h} ${hsl.s}% ${MAX_LIGHTNESS}%))` } as CSSProperties}
              onChange={(e) => pickHsl({ l: +e.target.value })}
            />
          </div>
        </div>
        <div className="srow">
          <div>
            Transparency
            <small>{look.opacity >= 100 ? "Solid" : "Lower it to let the desktop show through"}</small>
          </div>
          <div className="rng-wrap">
            <input
              className="rng"
              type="range"
              min={MIN_OPACITY}
              max={100}
              step={1}
              value={look.opacity}
              aria-label="Island opacity"
              style={{ ["--track" as string]: "linear-gradient(90deg,#ffffff1f,#ffffffb0)" } as CSSProperties}
              onChange={(e) => setAppearance({ opacity: +e.target.value })}
            />
            <span className="rng-val">{look.opacity}%</span>
          </div>
        </div>
        {!isDefaultAppearance(look) && (
          <div className="srow tight">
            <span>Back to the original look</span>
            <button className="pillbtn" onClick={resetAppearance}>Reset</button>
          </div>
        )}
      </div>

      <div className="sgroup">
        <h4>UPDATES</h4>
        <div className="srow">
          <div>
            Windows Island
            <small>{status?.current ? `Version ${status.current}` : "Version unknown"}</small>
          </div>
          {update ? (
            <button className="update-btn" onClick={onInstall} disabled={installing}>
              {installing ? `Updating${updatePct !== null ? ` ${updatePct}%` : "…"}` : `Update to v${update.version}`}
            </button>
          ) : (
            <small>Up to date</small>
          )}
        </div>
        <div className="srow">
          <div>
            Install updates
            <small>
              {autoUpdate
                ? "New versions install themselves shortly after launch, then the app restarts"
                : "You'll be told when one is ready and can install it with one click"}
            </small>
          </div>
          <div className="seg" role="group" aria-label="Install updates">
            <button
              className={!autoUpdate ? "on" : ""}
              onClick={() => {
                setAutoUpdate(false);
                api.setAutoUpdate(false).catch((e) => flash(String(e)));
              }}
            >
              Ask me
            </button>
            <button
              className={autoUpdate ? "on" : ""}
              onClick={() => {
                setAutoUpdate(true);
                api.setAutoUpdate(true).catch((e) => flash(String(e)));
              }}
            >
              Automatically
            </button>
          </div>
        </div>
        <div className="srow">
          <div>
            Check for updates
            <small className={noteClass}>{checkNote}</small>
          </div>
          <button className="update-btn" onClick={checkNow} disabled={checking || notSetUp}>
            {checking ? "Checking…" : "Check now"}
          </button>
        </div>
      </div>

      <div className="sgroup">
        <h4>SHORTCUTS</h4>
        <div className="srow tight"><span>Open or close the island</span><kbd>Ctrl+Alt+Shift+I</kbd></div>
        <div className="srow tight"><span>Search apps and files</span><kbd>Ctrl+Alt+A</kbd></div>
        <div className="srow tight"><span>Close</span><kbd>Esc</kbd></div>
      </div>
    </div>
  );
}
