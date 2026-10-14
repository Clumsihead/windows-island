import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

export type Stats = {
  cpu: number;
  ramUsed: number;
  ramTotal: number;
  disks: { mount: string; used: number; size: number }[];
  rxSec: number;
  txSec: number;
  uptime: number;
};
export type Media = {
  available: boolean;
  title: string;
  artist: string;
  playing: boolean;
  position: number;
  duration: number;
};
export type Audio = { volume: number; muted: boolean };
export type Radios = { wifi: boolean | null; bluetooth: boolean | null };
export type Clip = { id: string; text: string; time: number };
export type AppEntry = { name: string; path: string };

export const EMPTY_MEDIA: Media = { available: false, title: "", artist: "", playing: false, position: 0, duration: 0 };

export const api = {
  // island window
  setRect: (r: { x: number; y: number; w: number; h: number }) => invoke("island_set_rect", r),
  setExpanded: (expanded: boolean) => invoke("island_set_expanded", { expanded }),
  setPinned: (pinned: boolean) => invoke("island_set_pinned", { pinned }),
  getIsland: () => invoke<{ expanded: boolean }>("island_get"),
  // data
  stats: () => invoke<Stats>("system_stats"),
  media: () => invoke<Media>("media_get"),
  mediaArt: () => invoke<string | null>("media_art"),
  mediaControl: (action: "toggle" | "next" | "prev") => invoke("media_control", { action }),
  audio: () => invoke<Audio | null>("audio_get"),
  setVolume: (volume: number) => invoke("audio_set_volume", { volume }),
  toggleMute: () => invoke("audio_toggle_mute"),
  radios: () => invoke<Radios>("radio_get"),
  setRadio: (kind: "wifi" | "bluetooth", on: boolean) => invoke("radio_set", { kind, on }),
  clips: () => invoke<Clip[]>("clipboard_history"),
  copy: (text: string) => invoke("clipboard_copy", { text }),
  clearClips: () => invoke("clipboard_clear"),
  apps: () => invoke<AppEntry[]>("apps_list"),
  launch: (path: string) => invoke("apps_launch", { path }),
  openSettings: (page: string) => invoke("open_settings", { page }),
  setWallpaper: (path: string) => invoke("wallpaper_set", { path }),
  power: (action: "lock" | "sleep" | "restart" | "shutdown") => invoke("power_action", { action }),
};

export const onExpanded = (cb: (v: boolean) => void) => listen<boolean>("island:expanded", (e) => cb(e.payload));
export const onClips = (cb: (c: Clip[]) => void) => listen<Clip[]>("clipboard:changed", (e) => cb(e.payload));
