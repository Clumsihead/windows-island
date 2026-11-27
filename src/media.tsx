import { useEffect, useRef, useState } from "react";
import { Music2, Pause, Play, SkipBack, SkipForward } from "lucide-react";
import { api, Media } from "./api";
import { mmss } from "./hooks";

/** Playback position, advanced locally between the once-a-second polls. */
function usePosition(m: Media) {
  const [, tick] = useState(0);
  const stamp = useRef(performance.now());
  useEffect(() => {
    stamp.current = performance.now();
  }, [m]);
  useEffect(() => {
    if (!m.playing) return;
    const id = setInterval(() => tick((t) => t + 1), 400);
    return () => clearInterval(id);
  }, [m.playing]);
  const pos = m.playing ? m.position + (performance.now() - stamp.current) / 1000 : m.position;
  return m.duration > 0 ? Math.min(pos, m.duration) : pos;
}

/** The progress line is a wave: half a wavelength per segment, peaks 2.4px off the centre. */
const WAVE_H = 14;
const WAVE_HALF = 8;
const WAVE_AMP = 2.4;

function wavePath(w: number) {
  const mid = WAVE_H / 2;
  const n = Math.max(1, Math.ceil(w / WAVE_HALF));
  let d = `M0 ${mid} Q ${WAVE_HALF / 2} ${mid - WAVE_AMP * 2} ${WAVE_HALF} ${mid}`;
  for (let i = 1; i < n; i++) d += ` T${WAVE_HALF * (i + 1)} ${mid}`;
  return d;
}

export function WaveProgress({ media }: { media: Media }) {
  const livePos = usePosition(media);
  const trackRef = useRef<HTMLDivElement>(null);
  // The wave is drawn at the track's real pixel width, so it keeps its shape (not stretched) in both cards.
  const [trackW, setTrackW] = useState(0);
  useEffect(() => {
    const el = trackRef.current;
    if (!el) return;
    const read = () => setTrackW(el.clientWidth);
    read();
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const [drag, setDrag] = useState<number | null>(null); // 0..1 while the bar is being dragged
  const [seeked, setSeeked] = useState<{ pos: number; at: number } | null>(null);
  const [, tick] = useState(0);
  const canSeek = media.canSeek && media.duration > 0;

  // Tracked in a ref, not just state, so a very quick click or tap (down and up before the next
  // render) is never missed.
  const dragging = useRef(false);
  // While you drag, hold the island open: overshooting the bar a little would otherwise move the
  // cursor off the island and make it close mid-drag.
  const pinned = useRef(false);
  const setHold = (on: boolean) => {
    if (pinned.current === on) return;
    pinned.current = on;
    api.setPinned(on).catch(() => {});
  };
  useEffect(() => () => { if (pinned.current) api.setPinned(false).catch(() => {}); }, []);

  // After a seek, keep showing the new spot until the player has caught up and reported it.
  useEffect(() => {
    if (!seeked) return;
    const id = setTimeout(() => setSeeked(null), 2000);
    return () => clearTimeout(id);
  }, [seeked]);
  useEffect(() => {
    if (!seeked || !media.playing) return;
    const id = setInterval(() => tick((t) => t + 1), 400);
    return () => clearInterval(id);
  }, [seeked, media.playing]);

  const fractionAt = (clientX: number) => {
    const r = trackRef.current?.getBoundingClientRect();
    if (!r || r.width <= 0) return 0;
    return Math.min(1, Math.max(0, (clientX - r.left) / r.width));
  };
  const jumpTo = (seconds: number) => {
    const sec = Math.min(media.duration, Math.max(0, seconds));
    setSeeked({ pos: sec, at: performance.now() });
    // if the player refuses, drop the guess and show the real position again
    api.mediaSeek(sec).catch(() => setSeeked(null));
  };

  const pos =
    drag !== null
      ? drag * media.duration
      : seeked
      ? seeked.pos + (media.playing ? (performance.now() - seeked.at) / 1000 : 0)
      : livePos;
  const pct = media.duration > 0 ? Math.min(100, Math.max(0, (pos / media.duration) * 100)) : 0;
  const d = wavePath(trackW);

  return (
    <div className={`wp ${canSeek ? "can-seek" : ""} ${drag !== null ? "dragging" : ""}`}>
      <span className="wp-t">{mmss(pos)}</span>
      <div
        ref={trackRef}
        className="wp-track"
        role="slider"
        aria-label="Song position"
        aria-valuemin={0}
        aria-valuemax={Math.round(media.duration)}
        aria-valuenow={Math.round(pos)}
        tabIndex={canSeek ? 0 : -1}
        onPointerDown={(e) => {
          if (!canSeek) return;
          e.preventDefault();
          try {
            e.currentTarget.setPointerCapture(e.pointerId); // keep following the mouse outside the bar
          } catch {
            /* not supported: dragging still works inside the bar */
          }
          dragging.current = true;
          setHold(true);
          setDrag(fractionAt(e.clientX));
        }}
        onPointerMove={(e) => {
          if (dragging.current) setDrag(fractionAt(e.clientX));
        }}
        onPointerUp={(e) => {
          if (!dragging.current) return;
          dragging.current = false;
          const f = fractionAt(e.clientX);
          setDrag(null);
          setHold(false);
          jumpTo(f * media.duration);
        }}
        onPointerCancel={() => {
          dragging.current = false;
          setDrag(null);
          setHold(false);
        }}
        onKeyDown={(e) => {
          if (!canSeek || (e.key !== "ArrowLeft" && e.key !== "ArrowRight")) return;
          e.preventDefault();
          jumpTo(pos + (e.key === "ArrowRight" ? 5 : -5));
        }}
      >
        <svg className="wp-wave" width={trackW} height={WAVE_H} aria-hidden>
          <path className="wp-line" d={d} pathLength={trackW || 1} />
          <path
            className="wp-fill"
            d={d}
            pathLength={trackW || 1}
            style={{ strokeDasharray: `${(pct / 100) * (trackW || 0)} ${trackW || 1}` }}
          />
        </svg>
        <i className="wp-dot" style={{ left: `${pct}%` }} />
      </div>
      <span className="wp-t">{media.duration > 0 ? mmss(media.duration) : "--:--"}</span>
    </div>
  );
}

function Buttons({ media, big }: { media: Media; big?: boolean }) {
  return (
    <div className={`mc-btns ${big ? "big" : ""}`}>
      <button className="mc-side" onClick={() => api.mediaControl("prev")} aria-label="Previous">
        <SkipBack size={16} fill="currentColor" />
      </button>
      <button className="mc-play" onClick={() => api.mediaControl("toggle")} aria-label="Play or pause">
        {media.playing ? <Pause size={24} fill="currentColor" /> : <Play size={24} fill="currentColor" />}
      </button>
      <button className="mc-side" onClick={() => api.mediaControl("next")} aria-label="Next">
        <SkipForward size={16} fill="currentColor" />
      </button>
    </div>
  );
}

function Art({ art }: { art: string | null }) {
  return <div className="mc-art">{art ? <img src={art} alt="" /> : <Music2 size={26} />}</div>;
}

function Text({ media }: { media: Media }) {
  return (
    <div className="mc-text">
      <div className="mc-title">{media.available ? media.title || "Unknown track" : "Nothing playing"}</div>
      <div className="mc-sub">
        {media.available ? media.artist || media.app || "—" : "Play something in any media app"}
      </div>
    </div>
  );
}

/** layout "wide": the Controls tab card.  layout "peek": the small card shown when you hover the island. */
export default function MediaCard({
  media, art, device, layout,
}: { media: Media; art: string | null; device?: string | null; layout: "wide" | "peek" }) {
  if (layout === "peek") {
    return (
      <div className="mcard peek">
        <div className="mc-row">
          <Art art={art} />
          <Text media={media} />
        </div>
        <WaveProgress media={media} />
        <Buttons media={media} />
      </div>
    );
  }
  return (
    <div className="mcard wide">
      {device && <div className="mc-device">{device}</div>}
      <div className="mc-row">
        <Art art={art} />
        <Text media={media} />
        <Buttons media={media} big />
      </div>
      <WaveProgress media={media} />
    </div>
  );
}
