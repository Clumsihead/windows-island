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
  const pos = usePosition(media);
  const pct = media.duration > 0 ? Math.min(100, (pos / media.duration) * 100) : 0;
  return (
    <div className="wp">
      <span className="wp-t">{mmss(pos)}</span>
      <div className="wp-track">
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
