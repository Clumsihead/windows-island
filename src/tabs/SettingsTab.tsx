import { useEffect, useState } from "react";
import { api, onSettings, SizeKey, UpdateInfo, UpdaterStatus, Visibility } from "../api";
import { useHour24 } from "../hooks";
import type { TabProps } from "../App";

const SIZES: { key: SizeKey; label: string }[] = [
  { key: "small", label: "Small" },
  { key: "medium", label: "Medium" },
  { key: "large", label: "Large" },
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
  const [autoUpdate, setAutoUpdate] = useState(false);
  const [h24, toggleH24] = useHour24();
  const [status, setStatus] = useState<UpdaterStatus | null>(null);
  const [checking, setChecking] = useState(false);
  const [result, setResult] = useState<{ text: string; bad: boolean } | null>(null);

  const refreshStatus = () => api.updaterStatus().then(setStatus).catch(() => {});

  useEffect(() => {
    const apply = (s: { size: SizeKey; visibility: Visibility; autoUpdate?: boolean }) => {
      setSize(s.size);
      setVisibility(s.visibility);
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
    <div className="settings">
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
