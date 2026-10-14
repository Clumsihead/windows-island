import { useEffect, useRef, useState } from "react";
import {
  Bluetooth, Cpu, ExternalLink, HardDrive, MemoryStick, Moon, Pause, Play, SkipBack, SkipForward,
  Sun, Volume2, VolumeX, Wifi, Music2,
} from "lucide-react";
import { api, Audio, Radios } from "../api";
import { mmss, usePoll } from "../hooks";
import type { TabProps } from "../App";

export default function Controls({ flash, stats, media, art }: TabProps) {
  const audio = usePoll<Audio | null>(api.audio, 700, null);
  const [radios, setRadios] = useState<Radios>({ wifi: null, bluetooth: null });
  const [vol, setVol] = useState(0);
  const dragging = useRef(false);

  const refreshRadios = () => api.radios().then(setRadios).catch(() => {});
  useEffect(() => {
    refreshRadios();
  }, []);
  useEffect(() => {
    if (audio && !dragging.current) setVol(Math.round(audio.volume * 100));
  }, [audio]);

  const toggleRadio = async (kind: "wifi" | "bluetooth") => {
    const cur = radios[kind];
    if (cur === null) return api.openSettings(kind).catch((e) => flash(String(e)));
    setRadios({ ...radios, [kind]: !cur }); // optimistic
    try {
      await api.setRadio(kind, !cur);
    } catch {
      // Windows refused (permissions / policy): send them to the real settings page.
      setRadios({ ...radios, [kind]: cur });
      flash("Windows blocked the switch — opening Settings");
      api.openSettings(kind).catch(() => {});
    }
    refreshRadios();
  };

  const open = (page: string) => api.openSettings(page).catch((e) => flash(String(e)));
  const ramPct = stats ? Math.round((stats.ramUsed / stats.ramTotal) * 100) : null;
  const diskPct = stats?.disks[0] ? Math.round((stats.disks[0].used / stats.disks[0].size) * 100) : null;

  return (
    <div className="controls">
      <MediaCard media={media} art={art} />

      <div className="tiles">
        <Tile icon={<Wifi size={17} />} label="Wi-Fi" sub={radios.wifi === null ? "Settings" : radios.wifi ? "On" : "Off"} active={!!radios.wifi} onClick={() => toggleRadio("wifi")} />
        <Tile icon={<Bluetooth size={17} />} label="Bluetooth" sub={radios.bluetooth === null ? "Settings" : radios.bluetooth ? "On" : "Off"} active={!!radios.bluetooth} onClick={() => toggleRadio("bluetooth")} />
        <Tile icon={audio?.muted ? <VolumeX size={17} /> : <Volume2 size={17} />} label="Mute" sub={audio?.muted ? "Muted" : "Sound on"} active={!!audio?.muted} onClick={() => api.toggleMute()} />
        <Tile icon={<Moon size={17} />} label="Night Light" sub="Settings" active={false} onClick={() => open("nightlight")} />
      </div>

      <div className="card slider-row">
        {audio?.muted ? <VolumeX size={15} /> : <Volume2 size={15} />}
        <input
          type="range" min={0} max={100} value={vol} className="slider" aria-label="Volume"
          style={{ ["--fill" as string]: `${vol}%` }}
          onPointerDown={() => (dragging.current = true)}
          onPointerUp={() => (dragging.current = false)}
          onChange={(e) => {
            const v = Number(e.target.value);
            setVol(v);
            api.setVolume(v / 100).catch(() => {});
          }}
        />
        <b>{vol}</b>
      </div>

      <button className="row-link" onClick={() => open("display")}>
        <span><Sun size={14} /> Display &amp; brightness</span>
        <ExternalLink size={13} />
      </button>

      <div className="mini-stats">
        <Mini icon={<Cpu />} label="CPU" value={stats ? `${Math.round(stats.cpu)}%` : "—"} />
        <Mini icon={<MemoryStick />} label="RAM" value={ramPct === null ? "—" : `${ramPct}%`} />
        <Mini icon={<HardDrive />} label="DISK" value={diskPct === null ? "—" : `${diskPct}%`} />
      </div>
    </div>
  );
}

function MediaCard({ media, art }: { media: TabProps["media"]; art: string | null }) {
  // Interpolate between polls so the progress bar moves smoothly.
  const [tick, setTick] = useState(0);
  const stamp = useRef(performance.now());
  useEffect(() => {
    stamp.current = performance.now();
  }, [media]);
  useEffect(() => {
    if (!media.playing) return;
    const id = setInterval(() => setTick((t) => t + 1), 500);
    return () => clearInterval(id);
  }, [media.playing]);
  void tick;

  const pos = media.playing ? media.position + (performance.now() - stamp.current) / 1000 : media.position;
  const pct = media.duration > 0 ? Math.min(100, (pos / media.duration) * 100) : 0;

  return (
    <div className="card media-card">
      <div className="art">{art ? <img src={art} alt="" /> : <Music2 size={22} />}</div>
      <div className="media-body">
        <div className="media-title">{media.available ? media.title || "Unknown track" : "Nothing playing"}</div>
        <div className="media-artist">{media.available ? media.artist || "—" : "Play something in any media app"}</div>
        <div className="progress"><i style={{ width: `${pct}%` }} /></div>
        <div className="times"><span>{mmss(pos)}</span><span>{media.duration > 0 ? mmss(media.duration) : ""}</span></div>
      </div>
      <div className="media-controls">
        <button onClick={() => api.mediaControl("prev")} aria-label="Previous"><SkipBack size={16} /></button>
        <button className="play" onClick={() => api.mediaControl("toggle")} aria-label="Play or pause">
          {media.playing ? <Pause size={18} /> : <Play size={18} />}
        </button>
        <button onClick={() => api.mediaControl("next")} aria-label="Next"><SkipForward size={16} /></button>
      </div>
    </div>
  );
}

function Tile({ icon, label, sub, active, onClick }: { icon: React.ReactNode; label: string; sub: string; active: boolean; onClick: () => void }) {
  return (
    <button className={`tile ${active ? "active" : ""}`} onClick={onClick}>
      {icon}
      <span><b>{label}</b><small>{sub}</small></span>
    </button>
  );
}

function Mini({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="mini">
      {icon}
      <span>{label}</span>
      <b>{value}</b>
    </div>
  );
}
