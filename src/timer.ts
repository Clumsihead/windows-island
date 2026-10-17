import { useSyncExternalStore } from "react";

type TimerState = { total: number; remaining: number; running: boolean; endAt: number };
let state: TimerState = { total: 300, remaining: 300, running: false, endAt: 0 };
const subs = new Set<() => void>();
let id: number | undefined;

const emit = () => subs.forEach((f) => f());

function beep() {
  try {
    const ctx = new AudioContext();
    [0, 0.35, 0.7].forEach((t) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.frequency.value = 880;
      g.gain.value = 0.15;
      o.connect(g);
      g.connect(ctx.destination);
      o.start(ctx.currentTime + t);
      o.stop(ctx.currentTime + t + 0.2);
    });
    setTimeout(() => ctx.close(), 1500);
  } catch {
    /* audio unavailable */
  }
}

function stopTicking() {
  if (id !== undefined) window.clearInterval(id);
  id = undefined;
}

function tick() {
  const left = Math.max(0, Math.ceil((state.endAt - Date.now()) / 1000));
  if (left !== state.remaining) {
    state = { ...state, remaining: left };
    emit();
  }
  if (left <= 0) {
    stopTicking();
    state = { ...state, running: false };
    emit();
    beep();
    window.dispatchEvent(new CustomEvent("island:timer-done"));
  }
}

// Lives outside React so the timer keeps running while you look at other tabs.
export const timer = {
  get: () => state,
  subscribe: (cb: () => void) => {
    subs.add(cb);
    return () => subs.delete(cb);
  },
  setTotal(sec: number) {
    if (state.running) return;
    const s = Math.max(1, Math.min(sec, 99 * 3600 + 59 * 60));
    state = { ...state, total: s, remaining: s };
    emit();
  },
  start() {
    if (state.running || state.remaining <= 0) return;
    state = { ...state, running: true, endAt: Date.now() + state.remaining * 1000 };
    stopTicking();
    id = window.setInterval(tick, 250);
    emit();
  },
  pause() {
    if (!state.running) return;
    stopTicking();
    state = { ...state, running: false };
    emit();
  },
  reset() {
    stopTicking();
    state = { ...state, running: false, remaining: state.total };
    emit();
  },
};

export const useTimer = () => useSyncExternalStore(timer.subscribe, timer.get);
