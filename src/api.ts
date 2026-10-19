import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

export type Disk = { mount: string; used: number; size: number };
export type Stats = {
  cpu: number;
  cpuName: string;
  cpuMhz: number;
  ramUsed: number;
  ramTotal: number;
  disks: Disk[];
  rxSec: number;
  txSec: number;
  uptime: number;
};
export type AppUsage = { name: string; exe: string | null; memory: number; cpu: number };
export type TopApps = { byRam: AppUsage[]; byCpu: AppUsage[]; processCount: number };
export type Gpu = { available: boolean; name: string; vramTotal: number; vramUsed: number; usage: number };
export type Media = {
  available: boolean;
  title: string;
  artist: string;
  playing: boolean;
  position: number;
  duration: number;
  app: string;
};
export type Audio = { volume: number; muted: boolean };
export type Radios = { wifi: boolean | null; bluetooth: boolean | null };
export type NetInfo = { kind: string; name: string };
export type Clip = {
  id: string;
  kind: "text" | "image";
  text: string;
  thumb: string | null;
  width: number;
  height: number;
  size: number;
  time: number;
  pinned: boolean;
};
export type AppEntry = { name: string; path: string };
export type UpdateInfo = { version: string; notes: string | null };
export type SizeKey = "small" | "medium" | "large";
// "desktop": only on the desktop.  "peek": everywhere, but only a thin edge shows over other apps.
export type Visibility = "desktop" | "peek";
export type Settings = { size: SizeKey; visibility: Visibility };

export const EMPTY_MEDIA: Media = {
  available: false, title: "", artist: "", playing: false, position: 0, duration: 0, app: "",
};

export const api = {
  // island window
  setRect: (r: { x: number; y: number; w: number; h: number }) => invoke("island_set_rect", r),
  setExpanded: (expanded: boolean) => invoke("island_set_expanded", { expanded }),
  setPinned: (pinned: boolean) => invoke("island_set_pinned", { pinned }),
  setScale: (scale: number) => invoke("island_set_scale", { scale }),
  getSettings: () => invoke<Settings>("settings_get"),
  setIslandSize: (size: SizeKey) => invoke("set_island_size", { size }),
  setVisibility: (mode: Visibility) => invoke("set_visibility_mode", { mode }),
  getIsland: () => invoke<{ expanded: boolean; held: boolean; tucked: boolean }>("island_get"),
  // system
  stats: () => invoke<Stats>("system_stats"),
  topApps: () => invoke<TopApps>("top_apps"),
  gpu: () => invoke<Gpu>("gpu_stats"),
  netInfo: () => invoke<NetInfo>("network_info"),
  // media + audio
  media: () => invoke<Media>("media_get"),
  mediaArt: () => invoke<string | null>("media_art"),
  mediaControl: (action: "toggle" | "next" | "prev") => invoke("media_control", { action }),
  audio: () => invoke<Audio | null>("audio_get"),
  audioDevice: () => invoke<string | null>("audio_device"),
  setVolume: (volume: number) => invoke("audio_set_volume", { volume }),
  toggleMute: () => invoke("audio_toggle_mute"),
  // toggles
  radios: () => invoke<Radios>("radio_get"),
  setRadio: (kind: "wifi" | "bluetooth", on: boolean) => invoke("radio_set", { kind, on }),
  darkGet: () => invoke<boolean>("dark_mode_get"),
  darkSet: (dark: boolean) => invoke("dark_mode_set", { dark }),
  brightnessGet: () => invoke<number | null>("brightness_get"),
  brightnessSet: (percent: number) => invoke("brightness_set", { percent }),
  openSettings: (page: string) => invoke("open_settings", { page }),
  // clipboard
  clips: () => invoke<Clip[]>("clipboard_history"),
  clipCopy: (id: string) => invoke("clipboard_copy", { id }),
  clipPaste: (id: string) => invoke("clipboard_paste", { id }),
  clipPin: (id: string) => invoke("clipboard_pin", { id }),
  clipRemove: (id: string) => invoke("clipboard_remove", { id }),
  clipClear: () => invoke("clipboard_clear"),
  pasteText: (text: string) => invoke("clipboard_paste_text", { text }),
  // apps + files
  apps: () => invoke<AppEntry[]>("apps_list"),
  recentFiles: () => invoke<AppEntry[]>("recent_files"),
  launch: (path: string) => invoke("apps_launch", { path }),
  icons: (paths: string[], size: number) => invoke<Record<string, string>>("icons_get", { paths, size }),
  // wallpaper
  wallpaperGet: () => invoke<string | null>("wallpaper_get"),
  setWallpaper: (path: string) => invoke("wallpaper_set", { path }),
  listImages: (dir: string) => invoke<string[]>("list_images", { dir }),
  defaultWallpapers: () => invoke<string[]>("default_wallpapers"),
  // power
  power: (action: "lock" | "sleep" | "restart" | "shutdown") => invoke("power_action", { action }),
  // auto-update
  updatePending: () => invoke<UpdateInfo | null>("update_pending"),
  updateInstall: () => invoke("update_install"),
};

export const onExpanded = (cb: (v: boolean) => void) => listen<boolean>("island:expanded", (e) => cb(e.payload));
export const onSettings = (cb: (s: Settings) => void) => listen<Settings>("settings:changed", (e) => cb(e.payload));
export const onTucked = (cb: (tucked: boolean) => void) => listen<boolean>("island:tucked", (e) => cb(e.payload));
export const onBrightness = (cb: (percent: number) => void) => listen<number>("brightness:changed", (e) => cb(e.payload));
export const onGoto = (cb: (tab: string) => void) => listen<string>("island:goto", (e) => cb(e.payload));
export const onClips = (cb: (c: Clip[]) => void) => listen<Clip[]>("clipboard:changed", (e) => cb(e.payload));
export const onUpdate = (cb: (u: UpdateInfo) => void) => listen<UpdateInfo>("update:available", (e) => cb(e.payload));
export const onUpdateProgress = (cb: (pct: number | null) => void) =>
  listen<number | null>("update:progress", (e) => cb(e.payload));
