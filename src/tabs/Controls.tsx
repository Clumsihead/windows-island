import { useEffect, useRef, useState, type ReactNode } from "react";
import { Bluetooth, ChevronDown, ChevronUp, Moon, Sun, Volume, Volume1, Volume2, VolumeX, Wifi } from "lucide-react";
import { api, Audio, BatteryInfo, Media, NetInfo, onBrightness, Radios } from "../api";
import { AudioPanel, BluetoothPanel, WifiPanel } from "./Panels";
import { usePoll } from "../hooks";
import { PillSlider } from "../ui";
import MediaCard from "../media";
import type { TabProps } from "../App";

/** Every glyph in the Controls panel is drawn at this size, with the same thin stroke. */
const ICO = 27;
const STROKE = 2.2;

function Tile({
  icon, title, sub, onMain, onMore, open, on,
}: { icon: ReactNode; title: string; sub: string; onMain: () => void; onMore?: () => void; open?: boolean; on?: boolean }) {
  return (
    <div className={`qtile ${on ? "on" : ""}`}>
      <button className="qtile-main" onClick={onMain}>
        <span className="qtile-ico">{icon}</span>
        <span className="qtile-text">
          <b>{title}</b>
          <small>{sub}</small>
        </span>
      </button>
      {onMore && (
        <button className="qtile-more" onClick={onMore} aria-label={`${title} ${open ? "close" : "details"}`} aria-expanded={!!open}>
          {open ? <ChevronUp size={22} strokeWidth={STROKE} /> : <ChevronDown size={22} strokeWidth={STROKE} />}
        </button>
      )}
    </div>
  );
}

/** The "dark mode" mark: a ring with its right half filled in. */
function Halved() {
  return <span className="glyph-half" aria-hidden />;
}

/** The airplane-mode mark: a solid plane pointing up (Material "flight"). */
function Plane() {
  return (
    <svg width={30} height={ICO} viewBox="0 0 24 24" preserveAspectRatio="none" fill="currentColor" aria-hidden>
      <path d="M21 16v-2l-8-5V3.5a1.5 1.5 0 0 0-3 0V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5z" />
    </svg>
  );
}

/** The battery mark: a chunky rounded body with a pill-shaped terminal (always the empty outline). */
function BatteryMark() {
  return (
    <svg width={27} height={16} viewBox="0 0 27 16" fill="none" stroke="currentColor" strokeWidth={2.2} aria-hidden>
      <rect x="1.1" y="1.1" width="21.2" height="13.8" rx="5" />
      <rect x="23.8" y="4.8" width="2.4" height="6.4" rx="1.2" fill="currentColor" stroke="none" />
    </svg>
  );
}

/** Software airplane mode: Wi-Fi and Bluetooth go off together, and come back as they were. */
const AIR_KEY = "island.airplane";
type AirSaved = { wifi: boolean; bluetooth: boolean };
const loadAir = (): AirSaved | null => {
  try {
    const raw = localStorage.getItem(AIR_KEY);
    return raw ? (JSON.parse(raw) as AirSaved) : null;
  } catch {
    return null;
  }
};
const saveAir = (v: AirSaved | null) => {
  try {
    if (v) localStorage.setItem(AIR_KEY, JSON.stringify(v));
    else localStorage.removeItem(AIR_KEY);
  } catch {
    /* storage unavailable: airplane mode just won't survive a restart */
  }
};

/** Volume glyph follows the level, like the system one. */
const volumeIcon = (muted: boolean, v: number) =>
  muted ? <VolumeX size={ICO} strokeWidth={STROKE} /> :
  v <= 0 ? <Volume size={ICO} strokeWidth={STROKE} /> :
  v < 50 ? <Volume1 size={ICO} strokeWidth={STROKE} /> :
  <Volume2 size={ICO} strokeWidth={STROKE} />;

export default function Controls({
  flash, media, art, onPanel, night, onNight,
}: TabProps & {
  media: Media; art: string | null; onPanel?: (panel: "wifi" | "bluetooth" | "audio" | null) => void;
  night: boolean; onNight: (on: boolean) => void;
}) {
  const audio = usePoll<Audio | null>(api.audio, 700, null);
  const device = usePoll<string | null>(api.audioDevice, 4000, null);
  const net = usePoll<NetInfo>(api.netInfo, 5000, { kind: "", name: "" });
  const [radios, setRadios] = useState<Radios>({ wifi: null, bluetooth: null });
  const [dark, setDark] = useState(false);
  const [airSaved, setAirSaved] = useState<AirSaved | null>(loadAir);
  // which expandable panel is open under the tiles (one at a time). Chevrons toggle these.
  const [panel, setPanel] = useState<null | "wifi" | "bluetooth" | "audio">(null);
  const [battery, setBattery] = useState<BatteryInfo | null>(null);
  useEffect(() => {
    let alive = true;
    const load = () => api.battery().then((b) => alive && setBattery(b)).catch(() => {});
    load();
    const id = setInterval(load, 20000);
    return () => { alive = false; clearInterval(id); };
  }, []);
  const togglePanel = (p: "wifi" | "bluetooth" | "audio") => setPanel((cur) => (cur === p ? null : p));
  useEffect(() => { onPanel?.(panel); }, [panel, onPanel]);
  const [vol, setVol] = useState(0);
  const [bright, setBright] = useState<number | null>(null);
  const [nightStrength, setNightStrength] = useState(35);
  const nightTimer = useRef<number | undefined>(undefined);
  const draggingVol = useRef(false);
  const brightTimer = useRef<number | undefined>(undefined);
  const draggingBright = useRef(false);

  const refreshRadios = () => api.radios().then(setRadios).catch(() => {});
  useEffect(() => {
    refreshRadios();
    api.darkGet().then(setDark).catch(() => {});
    api.brightnessGet().then(setBright).catch(() => setBright(null));
    api.getSettings().then((s) => setNightStrength(s.nightStrength)).catch(() => {});

    // Follow brightness changes made anywhere else (Fn keys, the Windows Settings slider...).
    // While you're dragging the island's own slider we ignore these, so it doesn't fight your hand;
    // the last one after you let go is applied, which snaps to whatever the screen really settled on.
    const off = onBrightness((v) => {
      if (!draggingBright.current) setBright(v);
    });
    const release = () => {
      draggingBright.current = false;
    };
    window.addEventListener("pointerup", release);
    window.addEventListener("pointercancel", release);
    return () => {
      off.then((f) => f());
      window.removeEventListener("pointerup", release);
      window.removeEventListener("pointercancel", release);
    };
  }, []);
  useEffect(() => {
    if (audio && !draggingVol.current) setVol(Math.round(audio.volume * 100));
  }, [audio]);

  const open = (page: string) => api.openSettings(page).catch((e) => flash(String(e)));

  const toggleRadio = async (kind: "wifi" | "bluetooth") => {
    const cur = radios[kind];
    if (cur === null) return open(kind);
    setRadios({ ...radios, [kind]: !cur }); // optimistic
    try {
      await api.setRadio(kind, !cur);
    } catch {
      setRadios({ ...radios, [kind]: cur });
      flash("Windows blocked the switch, opening Settings");
      open(kind);
    }
    refreshRadios();
  };

  const toggleDark = () => {
    const next = !dark;
    setDark(next);
    api.darkSet(next).catch(() => {
      setDark(!next);
      flash("Couldn't change the theme");
    });
  };

  // The island's own night light: a warm tint over every display (Windows has no supported way to
  // change the strength of its built-in one, so this is separate from it).
  const toggleNight = () => {
    const next = !night;
    onNight(next);
    api.nightSet(next, nightStrength).catch((e) => {
      onNight(!next);
      flash(String(e));
    });
  };

  const setNight = (v: number) => {
    setNightStrength(v);
    window.clearTimeout(nightTimer.current);
    nightTimer.current = window.setTimeout(() => {
      api.nightSet(true, v).catch(() => flash("Your display driver didn't accept the colour change"));
    }, 120);
  };

  const setBrightness = (v: number) => {
    setBright(v);
    window.clearTimeout(brightTimer.current);
    brightTimer.current = window.setTimeout(() => {
      api.brightnessSet(v).catch(() => flash("Brightness isn't supported on this display"));
    }, 150);
  };

  // Airplane mode counts as on only while we switched the radios off and they are still off.
  const airplane = airSaved !== null && radios.wifi !== true && radios.bluetooth !== true;
  const toggleAirplane = async () => {
    const kinds = (["wifi", "bluetooth"] as const).filter((k) => radios[k] !== null);
    try {
      if (airplane) {
        const prev = airSaved!;
        setAirSaved(null);
        saveAir(null);
        for (const k of kinds) if (prev[k]) await api.setRadio(k, true);
      } else {
        const prev: AirSaved = { wifi: radios.wifi === true, bluetooth: radios.bluetooth === true };
        setAirSaved(prev);
        saveAir(prev);
        setRadios({ wifi: radios.wifi === null ? null : false, bluetooth: radios.bluetooth === null ? null : false });
        for (const k of kinds) if (prev[k]) await api.setRadio(k, false);
      }
    } catch {
      flash("Windows blocked the switch, opening Settings");
      open("wifi");
    }
    refreshRadios();
  };

  const wifiSub =
    radios.wifi === null ? "Not available" : radios.wifi === false ? "Off" : net.kind === "wifi" ? net.name : "Not connected";

  return (
    <div className="controls">
      <div className="qgrid">
        <Tile icon={<Wifi size={ICO} strokeWidth={STROKE} />} title="Wi-Fi" sub={wifiSub} on={radios.wifi === true}
          onMain={() => toggleRadio("wifi")} onMore={() => togglePanel("wifi")} open={panel === "wifi"} />
        <Tile icon={<Bluetooth size={ICO} strokeWidth={STROKE} />} title="Bluetooth" on={radios.bluetooth === true}
          sub={radios.bluetooth === null ? "Not available" : radios.bluetooth ? "On" : "Off"}
          onMain={() => toggleRadio("bluetooth")}
          onMore={() => togglePanel("bluetooth")} open={panel === "bluetooth"} />
        <Tile icon={audio?.muted ? <VolumeX size={ICO} strokeWidth={STROKE} /> : <Volume2 size={ICO} strokeWidth={STROKE} />} title="Audio" on={!!audio && !audio.muted}
          sub={device ?? (audio?.muted ? "Muted" : "Output")}
          onMain={() => api.toggleMute()} onMore={() => togglePanel("audio")} open={panel === "audio"} />
        <Tile icon={<BatteryMark />} title={battery ? `Battery ${battery.percent}%` : "Battery"}
          sub={battery ? (battery.charging ? "Charging" : battery.pluggedIn ? (battery.percent >= 100 ? "Fully charged" : "Plugged in") : "On battery") : "Not available"}
          onMain={() => {}} />
        <Tile icon={<Halved />} title="Dark mode" sub={dark ? "On" : "Off"} on={dark} onMain={toggleDark} />
        <Tile icon={<Plane />} title="Airplane mode" sub={airplane ? "On" : "Off"} on={airplane} onMain={toggleAirplane} />
      </div>
      {panel === "wifi" && <WifiPanel flash={flash} onSettings={() => open("wifi")} />}
      {panel === "bluetooth" && <BluetoothPanel flash={flash} onSettings={() => open("bluetooth")} />}
      {panel === "audio" && <AudioPanel flash={flash} onSettings={() => open("sound")} />}

      {!panel && (
        <>
        <PillSlider
          label="Volume" icon={volumeIcon(!!audio?.muted, vol)} value={vol}
          onChange={(v) => {
            draggingVol.current = true;
            setVol(v);
            api.setVolume(v / 100).catch(() => {});
            window.setTimeout(() => (draggingVol.current = false), 600);
          }}
        />
        <PillSlider
          label="Brightness" icon={<Sun size={ICO} strokeWidth={STROKE} fill="currentColor" />} value={bright ?? 0} disabled={bright === null}
          hint={bright === null ? "Brightness control works on laptop screens" : undefined} onChange={setBrightness}
          onDragStart={() => (draggingBright.current = true)}
        />
        {night && (
          <PillSlider
            label="Night light strength" icon={<Moon size={ICO} strokeWidth={STROKE} />} value={nightStrength}
            onChange={setNight}
          />
        )}

        {media.available && <MediaCard media={media} art={art} device={device} layout="wide" />}
        </>
      )}
    </div>
  );
}
