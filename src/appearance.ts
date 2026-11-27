import { useSyncExternalStore } from "react";

/** The island's own colour and see-through-ness, remembered across restarts. */
export type Appearance = {
  /** Island colour, "#rrggbb". */
  color: string;
  /** Opacity in percent: 100 is solid, lower lets the desktop show through. */
  opacity: number;
};

export const DEFAULT_APPEARANCE: Appearance = { color: "#0e0d09", opacity: 100 };
export const MIN_OPACITY = 30;
/** Brightest the colour picker goes (HSL lightness, %). Keeps the light text readable. */
export const MAX_LIGHTNESS = 40;

const KEY = "island.appearance";

export type Hsl = { h: number; s: number; l: number };

export function hexToRgb(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  const n = m ? parseInt(m[1], 16) : 0x0e0d09;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function hexToHsl(hex: string): Hsl {
  const [r, g, b] = hexToRgb(hex).map((v) => v / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  let h = 0;
  let s = 0;
  if (d > 0) {
    s = d / (1 - Math.abs(2 * l - 1));
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return { h: Math.round(h), s: Math.round(s * 100), l: Math.round(l * 1000) / 10 };
}

export function hslToHex({ h, s, l }: Hsl): string {
  const sat = s / 100;
  const lig = l / 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = sat * Math.min(lig, 1 - lig);
  const f = (n: number) => lig - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  const hex = (v: number) => Math.round(v * 255).toString(16).padStart(2, "0");
  return `#${hex(f(0))}${hex(f(8))}${hex(f(4))}`;
}

const clampOpacity = (v: number) => Math.min(100, Math.max(MIN_OPACITY, Math.round(v)));

function load(): Appearance {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const j = JSON.parse(raw) as Partial<Appearance>;
      const color = typeof j.color === "string" && /^#[0-9a-f]{6}$/i.test(j.color) ? j.color.toLowerCase() : DEFAULT_APPEARANCE.color;
      const opacity = typeof j.opacity === "number" ? clampOpacity(j.opacity) : DEFAULT_APPEARANCE.opacity;
      return { color, opacity };
    }
  } catch {
    /* storage unavailable or corrupt: fall back to the default look */
  }
  return DEFAULT_APPEARANCE;
}

export const isDefaultAppearance = (a: Appearance) =>
  a.opacity >= 100 && a.color.toLowerCase() === DEFAULT_APPEARANCE.color;

// Every surface variable the stylesheet defines, so a reset can remove exactly what we set.
const SURFACES: Record<string, string> = {
  "--card": "rgba(255,255,255,0.055)",
  "--card2": "rgba(255,255,255,0.087)",
  "--card3": "rgba(255,255,255,0.115)",
  "--tile": "rgba(255,255,255,0.08)",
  "--tile2": "rgba(255,255,255,0.12)",
  "--tile-fill": "rgba(255,255,255,0.13)",
  "--chip-off": "rgba(255,255,255,0.1)",
  "--sel-bg": "rgba(189,181,90,0.2)",
};

function apply(a: Appearance) {
  const style = document.documentElement.style;
  if (isDefaultAppearance(a)) {
    // Untouched: let the stylesheet's own palette through, pixel for pixel.
    style.removeProperty("--bg");
    Object.keys(SURFACES).forEach((k) => style.removeProperty(k));
    return;
  }
  const [r, g, b] = hexToRgb(a.color);
  style.setProperty("--bg", `rgba(${r},${g},${b},${a.opacity / 100})`);
  // Cards and tiles become light veils over the island colour, so they follow whatever colour
  // and opacity is picked instead of staying the default olive-grey.
  for (const [k, v] of Object.entries(SURFACES)) style.setProperty(k, v);
}

let current: Appearance = DEFAULT_APPEARANCE;
const subs = new Set<() => void>();

export function initAppearance() {
  current = load();
  apply(current);
}

export function setAppearance(patch: Partial<Appearance>) {
  const next: Appearance = {
    color: (patch.color ?? current.color).toLowerCase(),
    opacity: clampOpacity(patch.opacity ?? current.opacity),
  };
  current = next;
  apply(next);
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* storage unavailable */
  }
  subs.forEach((f) => f());
}

export const resetAppearance = () => setAppearance(DEFAULT_APPEARANCE);

export function useAppearance(): Appearance {
  return useSyncExternalStore(
    (cb) => {
      subs.add(cb);
      return () => subs.delete(cb);
    },
    () => current
  );
}
