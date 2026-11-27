import { useEffect, useRef, useState } from "react";
import { Music2 } from "lucide-react";
import { api, Media } from "./api";
import { useIcons } from "./hooks";

const BARS = 5;
/** How often the level is read while a track plays. ~12 times a second looks live without costing much. */
const LEVEL_MS = 80;
const BAR_MIN = 4; // px: a resting bar is a round dot
const BAR_MAX = 20;

/**
 * Level bars for the left of the notch. They follow Windows' own peak meter for the output device
 * (the same thing the volume mixer's little green bar shows), so they move with whatever is playing.
 * Each bar shows the level from a moment earlier than its neighbour, which gives a rolling,
 * varied shape from a single number. Heights are written straight to the DOM: no React renders at 12 Hz.
 */
function LevelBars({ active }: { active: boolean }) {
  const els = useRef<(HTMLElement | null)[]>([]);

  useEffect(() => {
    const draw = (hs: number[]) =>
      hs.forEach((h, i) => {
        const el = els.current[i];
        if (el) el.style.height = `${BAR_MIN + h * (BAR_MAX - BAR_MIN)}px`;
      });
    if (!active) {
      draw(new Array(BARS).fill(0));
      return;
    }
    let alive = true;
    let busy = false;
    let ref = 0.12; // slowly-decaying loudest level seen, so quiet and loud tracks both fill the bars
    const hist = new Array(BARS).fill(0);
    const id = setInterval(async () => {
      if (busy) return;
      busy = true;
      let raw = 0;
      try {
        raw = await api.audioLevel();
      } catch {
        /* no meter: bars just rest */
      }
      busy = false;
      if (!alive) return;
      ref = Math.max(0.08, raw, ref * 0.992);
      let v = Math.min(1, Math.pow(raw / ref, 0.85));
      if (raw < 0.003) v = 0;
      // quick to rise, a bit slower to fall
      const prev = hist[BARS - 1];
      const smooth = v > prev ? prev + (v - prev) * 0.75 : prev + (v - prev) * 0.4;
      hist.shift();
      hist.push(smooth);
      draw(hist);
    }, LEVEL_MS);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [active]);

  return (
    <span className="lvl" aria-hidden>
      {Array.from({ length: BARS }, (_, i) => (
        <i key={i} ref={(el) => (els.current[i] = el)} />
      ))}
    </span>
  );
}

/** The icon of the app playing the media (Brave, Spotify...). Falls back to the album art, then a note. */
function SourceIcon({ media, art }: { media: Media; art: string | null }) {
  const [exe, setExe] = useState<string | null>(null);
  useEffect(() => {
    if (!media.available) return setExe(null);
    let alive = true;
    api.mediaSourceExe().then((p) => alive && setExe(p)).catch(() => {});
    return () => {
      alive = false;
    };
  }, [media.available, media.app]);
  const icon = useIcons([exe], 48)(exe);
  const src = icon ?? art;
  return (
    <span className="src" title={media.app || undefined}>
      {src ? <img src={src} alt="" /> : <Music2 size={14} />}
    </span>
  );
}

export default function Notch({
  media, playing, active, art, text, updateVersion,
}: {
  media: Media; playing: boolean; active: boolean; art: string | null; text: string; updateVersion: string | null;
}) {
  return (
    <>
      {media.available && (
        <span className="nside left">
          <LevelBars active={active && playing} />
        </span>
      )}
      <span className="nmid">
        <span className="ctext">{text}</span>
      </span>
      {media.available && (
        <span className="nside right">
          <SourceIcon media={media} art={art} />
        </span>
      )}
      {updateVersion && <i className="udot" title={`Update v${updateVersion} available`} />}
    </>
  );
}
