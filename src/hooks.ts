import { useEffect, useRef, useState } from "react";

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
