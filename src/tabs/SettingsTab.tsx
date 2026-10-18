import { useEffect, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { api, onSettings, SizeKey, UpdateInfo } from "../api";
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

export default function SettingsTab({ flash, update, installing, updatePct, onInstall }: Props) {
  const [size, setSize] = useState<SizeKey>("medium");
  const [h24, toggleH24] = useHour24();
  const [version, setVersion] = useState("");

  useEffect(() => {
    api.getSettings().then((s) => setSize(s.size)).catch(() => {});
    const off = onSettings((s) => setSize(s.size));
    getVersion().then(setVersion).catch(() => {});
    return () => {
      off.then((f) => f());
    };
  }, []);

  return (
    <div className="settings">
      <div className="sgroup">
        <h4>APPEARANCE</h4>
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
      </div>

      <div className="sgroup">
        <h4>SHORTCUTS</h4>
        <div className="srow tight"><span>Open or close the island</span><kbd>Ctrl+Alt+Shift+I</kbd></div>
        <div className="srow tight"><span>Search apps and files</span><kbd>Ctrl+Alt+A</kbd></div>
        <div className="srow tight"><span>Close</span><kbd>Esc</kbd></div>
      </div>

      <div className="sgroup">
        <h4>ABOUT</h4>
        <div className="srow">
          <div>
            Windows Island
            <small>{version ? `Version ${version}` : "Version unknown"}</small>
          </div>
          {update ? (
            <button className="update-btn" onClick={onInstall} disabled={installing}>
              {installing ? `Updating${updatePct !== null ? ` ${updatePct}%` : "…"}` : `Update to v${update.version}`}
            </button>
          ) : (
            <small>Up to date</small>
          )}
        </div>
      </div>
    </div>
  );
}
