import { useEffect, useRef, useState, type ReactNode } from "react";
import { Bluetooth, ChevronDown, Contrast, Moon, Sun, Volume2, VolumeX, Wifi } from "lucide-react";
import { api, Audio, Media, NetInfo, onBrightness, Radios } from "../api";
import { usePoll } from "../hooks";
import { PillSlider } from "../ui";
import MediaCard from "../media";
import type { TabProps } from "../App";

function Tile({
  icon, title, sub, active, onMain, onMore,
}: { icon: ReactNode; title: string; sub: string; active: boolean; onMain: () => void; onMore?: () => void }) {
  return (
    <div className={`qtile ${active ? "on" : ""}`}>
      <button className="qtile-main" onClick={onMain}>
        <span className="qtile-ico">{icon}</span>
        <span className="qtile-text">
          <b>{title}</b>
          <small>{sub}</small>
        </span>
      </button>
      {onMore && (
        <>
          <i className="qtile-sep" />
          <button className="qtile-more" onClick={onMore} aria-label={`${title} settings`}>
            <ChevronDown size={18} />
          </button>
        </>
      )}
    </div>
  );
}

export default function Controls({ flash, media, art }: TabProps & { media: Media; art: string | null }) {
  const audio = usePoll<Audio | null>(api.audio, 700, null);
  const device = usePoll<string | null>(api.audioDevice, 4000, null);
  const net = usePoll<NetInfo>(api.netInfo, 5000, { kind: "", name: "" });
  const [radios, setRadios] = useState<Radios>({ wifi: null, bluetooth: null });
  const [dark, setDark] = useState(false);
  const [vol, setVol] = useState(0);
  const [bright, setBright] = useState<number | null>(null);
  const draggingVol = useRef(false);
  const brightTimer = useRef<number | undefined>(undefined);
  const draggingBright = useRef(false);

  const refreshRadios = () => api.radios().then(setRadios).catch(() => {});
  useEffect(() => {
    refreshRadios();
    api.darkGet().then(setDark).catch(() => {});
    api.brightnessGet().then(setBright).catch(() => setBright(null));

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

  const setBrightness = (v: number) => {
    setBright(v);
    window.clearTimeout(brightTimer.current);
    brightTimer.current = window.setTimeout(() => {
      api.brightnessSet(v).catch(() => flash("Brightness isn't supported on this display"));
    }, 150);
  };

  const wifiSub =
    radios.wifi === null ? "Not available" : radios.wifi === false ? "Off" : net.kind === "wifi" ? net.name : "Not connected";

  return (
    <div className="controls">
      <div className="grid3">
        <Tile icon={<Wifi size={20} />} title="Wi-Fi" sub={wifiSub} active={radios.wifi === true}
          onMain={() => toggleRadio("wifi")} onMore={() => open("wifi")} />
        <Tile icon={<Bluetooth size={20} />} title="Bluetooth"
          sub={radios.bluetooth === null ? "Not available" : radios.bluetooth ? "On" : "Off"}
          active={radios.bluetooth === true} onMain={() => toggleRadio("bluetooth")} onMore={() => open("bluetooth")} />
        <Tile icon={audio?.muted ? <VolumeX size={20} /> : <Volume2 size={20} />} title="Audio"
          sub={device ?? (audio?.muted ? "Muted" : "Output")} active={!audio?.muted}
          onMain={() => api.toggleMute()} onMore={() => open("sound")} />
      </div>
      <div className="grid2">
        <Tile icon={<Moon size={20} />} title="Night Light" sub="Open settings" active={false}
          onMain={() => open("nightlight")} onMore={() => open("nightlight")} />
        <Tile icon={<Contrast size={20} />} title="Dark mode" sub={dark ? "On" : "Off"} active={dark} onMain={toggleDark} />
      </div>

      <PillSlider
        label="Volume" icon={audio?.muted ? <VolumeX size={18} /> : <Volume2 size={18} />} value={vol}
        onChange={(v) => {
          draggingVol.current = true;
          setVol(v);
          api.setVolume(v / 100).catch(() => {});
          window.setTimeout(() => (draggingVol.current = false), 600);
        }}
      />
      <PillSlider
        label="Brightness" icon={<Sun size={18} />} value={bright ?? 0} disabled={bright === null}
        hint={bright === null ? "Brightness control works on laptop screens" : undefined} onChange={setBrightness}
        onDragStart={() => (draggingBright.current = true)}
      />

      <MediaCard media={media} art={art} device={device} layout="wide" />
    </div>
  );
}
