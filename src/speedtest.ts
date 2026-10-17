import { useCallback, useState } from "react";
import { useLocal } from "./hooks";

export type SpeedResult = { down: number; up: number; city: string; at: number };

const HOST = "https://speed.cloudflare.com";

async function download(ms = 7000): Promise<number> {
  const ctl = new AbortController();
  const stop = setTimeout(() => ctl.abort(), ms);
  const t0 = performance.now();
  let got = 0;
  try {
    const res = await fetch(`${HOST}/__down?bytes=30000000`, { signal: ctl.signal, cache: "no-store" });
    const reader = res.body!.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      got += value.length;
    }
  } catch {
    /* aborted on purpose once the time budget is used */
  } finally {
    clearTimeout(stop);
  }
  const secs = (performance.now() - t0) / 1000;
  return got > 0 ? (got * 8) / secs / 1e6 : 0;
}

async function upload(): Promise<number> {
  const body = new Blob([new Uint8Array(6_000_000)]);
  const t0 = performance.now();
  await fetch(`${HOST}/__up`, { method: "POST", body, cache: "no-store" });
  return (body.size * 8) / ((performance.now() - t0) / 1000) / 1e6;
}

/**
 * Runs only when you press the button, and talks to speed.cloudflare.com.
 * The last result is remembered between launches.
 */
export function useSpeedTest() {
  const [last, setLast] = useLocal<SpeedResult | null>("island.speed", null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState(false);

  const run = useCallback(async () => {
    setRunning(true);
    setError(false);
    try {
      let city = "";
      try {
        city = (await (await fetch(`${HOST}/meta`)).json()).city ?? "";
      } catch {
        /* location label is optional */
      }
      const down = await download();
      const up = await upload();
      if (!down) throw new Error("no data");
      setLast({ down, up, city, at: Date.now() });
    } catch {
      setError(true);
    } finally {
      setRunning(false);
    }
  }, [setLast]);

  return { last, running, error, run };
}
