import type { WifiRaw } from "./api";

export type WifiNet = {
  ssid: string;
  /** "Open", "WPA", "WPA2", "WPA3", "WEP" or "Secured" (couldn't tell) */
  security: string;
  secured: boolean;
  /** work / school networks that sign in with an account: can't be joined with just a password */
  enterprise: boolean;
  signal: number; // 0-100
  saved: boolean;
  connected: boolean;
};

export type WifiList = { nets: WifiNet[]; current: string | null; note: string };

// "Key : value", splitting at the FIRST colon (values like MAC addresses contain more).
const kv = (line: string): [string, string] | null => {
  const m = line.match(/^\s*([^:]+?)\s*:\s*(.*?)\s*$/);
  return m ? [m[1], m[2]] : null;
};

/** Reads the authentication line netsh prints. Written to cope with other languages too. */
export function securityOf(auth: string, encryption: string): { label: string; enterprise: boolean } {
  const a = auth.toLowerCase();
  const enterprise = /enterprise|802\.1x|eap/.test(a);
  const open = /\b(open|offen|ouvert|abierta?|aperta|aberta|openbaar)\b/.test(a) || (a === "" && /^none$/i.test(encryption));
  let label = "Secured";
  if (open) label = "Open";
  else if (/wpa3/.test(a)) label = "WPA3";
  else if (/wpa2/.test(a)) label = "WPA2";
  else if (/wpa/.test(a)) label = "WPA";
  else if (/wep/.test(a)) label = "WEP";
  return { label, enterprise };
}

/**
 * Turns the text of `netsh wlan show networks mode=bssid`, `show interfaces` and `show profiles`
 * into one list. It reads by position and by symbols (%, :) rather than by English words, so it
 * keeps working when Windows is set to another language.
 */
export function parseWifi(raw: WifiRaw): WifiList {
  type Block = { ssid: string; attrs: string[]; signals: number[] };
  const blocks: Block[] = [];
  let cur: Block | null = null;
  let inBssid = false;
  for (const line of raw.networks.split(/\r?\n/)) {
    const head = line.match(/^SSID\s+\d+\s*:\s*(.*?)\s*$/);
    if (head) {
      cur = { ssid: head[1], attrs: [], signals: [] };
      blocks.push(cur);
      inBssid = false;
      continue;
    }
    if (!cur) continue;
    const pair = kv(line);
    if (!pair) continue;
    const [key, val] = pair;
    if (/^BSSID\b/i.test(key)) {
      inBssid = true;
      continue;
    }
    if (inBssid) {
      const s = val.match(/^(\d+)\s*%$/);
      if (s) cur.signals.push(Number(s[1]));
      continue;
    }
    cur.attrs.push(val); // network type, authentication, encryption, in that order
  }

  // profiles Windows has saved: indented "label : name" lines
  const saved = new Set<string>();
  for (const line of raw.profiles.split(/\r?\n/)) {
    const m = line.match(/^\s{2,}[^:]+?\s*:\s*(.+?)\s*$/);
    if (m) saved.add(m[1].toLowerCase());
  }

  // the network we're on now: the interface's "SSID : name" line (not BSSID)
  let current: string | null = null;
  for (const line of raw.interfaces.split(/\r?\n/)) {
    const m = line.match(/^\s*SSID\s*:\s*(.+?)\s*$/);
    if (m) {
      current = m[1];
      break;
    }
  }

  const bySsid = new Map<string, WifiNet>();
  for (const b of blocks) {
    if (!b.ssid) continue; // hidden network
    const { label, enterprise } = securityOf(b.attrs[1] ?? "", b.attrs[2] ?? "");
    const signal = b.signals.length ? Math.max(...b.signals) : 0;
    const net: WifiNet = {
      ssid: b.ssid,
      security: label,
      secured: label !== "Open",
      enterprise,
      signal,
      saved: saved.has(b.ssid.toLowerCase()),
      connected: current !== null && current === b.ssid,
    };
    const prev = bySsid.get(b.ssid);
    if (!prev || prev.signal < net.signal) bySsid.set(b.ssid, net);
  }
  // connected to something that isn't in the scan list (hidden, or just out of the last scan)
  if (current && !bySsid.has(current)) {
    bySsid.set(current, { ssid: current, security: "Secured", secured: true, enterprise: false, signal: 0, saved: saved.has(current.toLowerCase()), connected: true });
  }

  const nets = Array.from(bySsid.values()).sort(
    (a, b) => Number(b.connected) - Number(a.connected) || Number(b.saved) - Number(a.saved) || b.signal - a.signal
  );

  let note = "";
  if (nets.length === 0) {
    const first = raw.networks.split(/\r?\n/).map((l) => l.trim()).find(Boolean) ?? "";
    note = /location/i.test(raw.networks)
      ? "Windows needs Location turned on to list Wi-Fi networks"
      : first || "No networks found";
  }
  return { nets, current, note };
}
