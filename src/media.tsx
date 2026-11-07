import { useEffect, useRef, useState } from "react";
import { Music2, Pause, Play, SkipBack, SkipForward, Volume2 } from "lucide-react";
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

export function WaveProgress({ media }: { media: Media }) {
  const livePos = usePosition(media);
  const trackRef = useRef<HTMLDivElement>(null);
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
        <div className="wp-line" />
        <div className={`wp-wave ${media.playing ? "on" : ""}`} style={{ width: `${pct}%` }} />
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
      {device && (
        <div className="mc-device">
          <Volume2 size={14} /> {device}
        </div>
      )}
      <div className="mc-row">
        <Art art={art} />
        <Text media={media} />
        <Buttons media={media} big />
      </div>
      <WaveProgress media={media} />
    </div>
  );
}
