import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";

/** Calls `fn` on an interval (and immediately) while `enabled`. */
export function usePoll<T>(fn: () => Promise<T>, ms: number, initial: T, enabled = true): T {
  const [value, setValue] = useState<T>(initial);
  const fnRef = useRef(fn);
  fnRef.current = fn;
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    const tick = async () => {
      try {
        const r = await fnRef.current();
        if (alive) setValue(r);
      } catch (e) {
        console.error(e);
      }
    };
    tick();
    const id = setInterval(tick, ms);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [ms, enabled]);
  return value;
}

export function useClock(enabled = true) {
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    if (!enabled) return;
    setNow(new Date());
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, [enabled]);
  return now;
}
// 12/24-hour preference, shared by every place that shows the time and remembered across restarts.
const HOUR24_KEY = "island.hour24";
let hour24 = (() => {
  try {
    return localStorage.getItem(HOUR24_KEY) !== "0"; // 24-hour unless the user switched it off
  } catch {
    return true;
  }
})();
const hourSubs = new Set<() => void>();

export function useHour24(): [boolean, () => void] {
  const value = useSyncExternalStore(
    (cb) => {
      hourSubs.add(cb);
      return () => hourSubs.delete(cb);
    },
    () => hour24
  );
  const toggle = useCallback(() => {
    hour24 = !hour24;
    try {
      localStorage.setItem(HOUR24_KEY, hour24 ? "1" : "0");
    } catch {
      /* storage unavailable */
    }
    hourSubs.forEach((f) => f());
  }, []);
  return [value, toggle];
}

// hourCycle "h23" avoids the odd "24:05" some engines print at midnight with hour12: false.
export const formatTime = (d: Date, h24: boolean) =>
  d.toLocaleTimeString([], h24 ? { hour: "2-digit", minute: "2-digit", hourCycle: "h23" } : { hour: "2-digit", minute: "2-digit", hour12: true });

export const bytes = (n: number) => {
  if (!n) return "0 B";
  const u = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(u.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
  return `${(n / Math.pow(1024, i)).toFixed(i > 2 ? 1 : 0)} ${u[i]}`;
};
export const rate = (n: number) => `${bytes(n)}/s`;
export const mmss = (s: number) => {
  s = Math.max(0, Math.floor(s));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};
