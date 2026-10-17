import { useEffect, useState } from "react";
import { Cloud, CloudDrizzle, CloudFog, CloudLightning, CloudRain, CloudSnow, CloudSun, Sun } from "lucide-react";

export type Weather = { temp: number; code: number; city: string; at: number };
const KEY = "island.weather";
const MAX_AGE = 30 * 60 * 1000;

export function describe(code: number): { text: string; icon: typeof Sun } {
  if (code === 0) return { text: "Clear sky", icon: Sun };
  if (code <= 2) return { text: "Partly cloudy", icon: CloudSun };
  if (code === 3) return { text: "Overcast", icon: Cloud };
  if (code === 45 || code === 48) return { text: "Fog", icon: CloudFog };
  if (code >= 51 && code <= 57) return { text: "Drizzle", icon: CloudDrizzle };
  if ((code >= 61 && code <= 67) || (code >= 80 && code <= 82)) return { text: "Rain", icon: CloudRain };
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return { text: "Snow", icon: CloudSnow };
  if (code >= 95) return { text: "Thunderstorm", icon: CloudLightning };
  return { text: "Cloudy", icon: Cloud };
}

function cached(): Weather | null {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Weather) : null;
  } catch {
    return null;
  }
}

/**
 * Rough location from your IP address (ipwho.is), then the current weather from Open-Meteo.
 * Neither needs an account. Results are cached for 30 minutes, and nothing is requested
 * until the Today tab is opened.
 */
export function useWeather(): { weather: Weather | null; failed: boolean } {
  const [weather, setWeather] = useState<Weather | null>(cached);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const have = cached();
    if (have && Date.now() - have.at < MAX_AGE) return;
    let alive = true;
    (async () => {
      try {
        const loc = await (await fetch("https://ipwho.is/")).json();
        if (!loc.success) throw new Error("no location");
        const url = `https://api.open-meteo.com/v1/forecast?latitude=${loc.latitude}&longitude=${loc.longitude}&current=temperature_2m,weather_code`;
        const w = await (await fetch(url)).json();
        const next: Weather = {
          temp: Math.round(w.current.temperature_2m),
          code: w.current.weather_code,
          city: loc.city ?? "",
          at: Date.now(),
        };
        try {
          localStorage.setItem(KEY, JSON.stringify(next));
        } catch {
          /* storage unavailable */
        }
        if (alive) {
          setWeather(next);
          setFailed(false);
        }
      } catch {
        if (alive) setFailed(true);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  return { weather, failed };
}
