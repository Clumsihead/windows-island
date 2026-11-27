import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  Bluetooth, ExternalLink, Headphones, Laptop, Lock, Mic, Mouse, RefreshCw, Smartphone, Speaker, Trash2, Wifi,
} from "lucide-react";
import { api, AudioDevice, AudioDevices, BtDevice, WifiRaw } from "../api";
import { parseWifi, WifiNet } from "../wifi";

type PanelProps = { flash: (m: string) => void; onSettings: () => void };

/** Runs `load` now and then every `ms`, and exposes a manual refresh + a "busy" flag. */
function useRefreshing<T>(load: () => Promise<T>, ms: number) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const loadRef = useRef(load);
  loadRef.current = load;
  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setData(await loadRef.current());
      setError(null);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    refresh();
    const id = setInterval(refresh, ms);
    return () => clearInterval(id);
  }, [refresh, ms]);
  return { data, error, loading, refresh };
}

function Shell({
  title, subtitle, loading, onRefresh, onSettings, children,
}: { title: string; subtitle: string; loading: boolean; onRefresh: () => void; onSettings: () => void; children: ReactNode }) {
  return (
    <div className="cpanel">
      <div className="cpanel-head">
        <div>
          <b>{title}</b>
          <small>{subtitle}</small>
        </div>
        <div className="cpanel-actions">
          <button className="icon-btn" onClick={onSettings} aria-label="Open Windows settings" title="Windows settings">
            <ExternalLink size={16} />
          </button>
          <button className={`icon-btn ${loading ? "spin" : ""}`} onClick={onRefresh} aria-label="Refresh" title="Refresh">
            <RefreshCw size={17} />
          </button>
        </div>
      </div>
      {children}
    </div>
  );
}

// ======================================================================= Wi-Fi

function WifiRow({
  net, busy, asking, onConnect, onDisconnect, onForget, onAsk,
}: {
  net: WifiNet; busy: boolean; asking: boolean;
  onConnect: () => void; onDisconnect: () => void; onForget: () => void; onAsk: () => void;
}) {
  let action: ReactNode = null;
  if (busy) action = <span className="prow-note">Working…</span>;
  else if (net.connected) action = <button className="prow-act" onClick={onDisconnect}>Disconnect</button>;
  else if (net.security === "WEP") action = <span className="prow-note" title="Old WEP networks aren't supported here">Not supported</span>;
  else if (net.enterprise) action = <span className="prow-note" title="Needs a work or school sign-in. Use Windows' Wi-Fi settings">Sign-in needed</span>;
  else if (net.saved || !net.secured) action = <button className="prow-act" onClick={onConnect}>Connect</button>;
  else action = <button className="prow-act" onClick={onAsk} aria-expanded={asking}>Password</button>;
  return (
    <div className={`prow ${net.connected ? "sel" : ""}`}>
      <span className="prow-ico"><Wifi size={20} /></span>
      <span className="prow-text">
        <b>{net.ssid}</b>
        <small>{net.security}{net.signal ? ` • ${net.signal}%` : ""}</small>
      </span>
      {action}
      {net.saved && !busy && (
        <button className="icon-btn small" onClick={onForget} aria-label={`Forget ${net.ssid}`} title="Forget this network">
          <Trash2 size={15} />
        </button>
      )}
    </div>
  );
}

export function WifiPanel({ flash, onSettings }: PanelProps) {
  const { data, error, loading, refresh } = useRefreshing<WifiRaw>(api.wifiScan, 10000);
  const [working, setWorking] = useState<string | null>(null);
  const [asking, setAsking] = useState<string | null>(null);
  const [pw, setPw] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const list = useMemo(() => (data ? parseWifi(data) : null), [data]);

  const act = async (ssid: string, job: () => Promise<unknown>, done?: string) => {
    setWorking(ssid);
    setProblem(null);
    try {
      await job();
      if (done) flash(done);
    } catch (e) {
      setProblem(String(e));
    } finally {
      setWorking(null);
      setAsking(null);
      setPw("");
      refresh();
      window.setTimeout(refresh, 3000); // Windows takes a moment to finish joining
    }
  };
  const connect = (n: WifiNet, password: string | null) =>
    act(n.ssid, () => api.wifiConnect(n.ssid, password, n.security, n.saved), `Connecting to ${n.ssid}…`);

  const current = list?.nets.find((n) => n.connected) ?? null;
  const others = list?.nets.filter((n) => !n.connected) ?? [];
  const subtitle = !list ? "Looking for networks…" : list.nets.length ? `${list.nets.length} available` : list.note;

  const row = (n: WifiNet) => (
    <div key={n.ssid}>
      <WifiRow
        net={n} busy={working === n.ssid} asking={asking === n.ssid}
        onConnect={() => connect(n, null)}
        onDisconnect={() => act(n.ssid, () => api.wifiDisconnect())}
        onForget={() => act(n.ssid, () => api.wifiForget(n.ssid), `Forgot ${n.ssid}`)}
        onAsk={() => { setAsking(asking === n.ssid ? null : n.ssid); setPw(""); setProblem(null); }}
      />
      {asking === n.ssid && (
        <form className="pw-row" onSubmit={(e) => { e.preventDefault(); if (pw) connect(n, pw); }}>
          <Lock size={15} />
          <input autoFocus type="password" value={pw} placeholder="Password" onChange={(e) => setPw(e.target.value)} />
          <button type="submit" className="prow-act" disabled={!pw}>Connect</button>
          <button type="button" className="prow-act dim" onClick={() => setAsking(null)}>Cancel</button>
        </form>
      )}
    </div>
  );

  return (
    <Shell title="Wi-Fi networks" subtitle={subtitle} loading={loading} onRefresh={refresh} onSettings={onSettings}>
      <div className="cpanel-body two">
        <div className="pcol" data-scroll>{current ? row(current) : <div className="pempty">Not connected</div>}</div>
        <div className="pcol" data-scroll>
          {others.map(row)}
          {list && others.length === 0 && !current && <div className="pempty">{list.note || "No networks found"}</div>}
        </div>
      </div>
      {(problem || error) && <div className="perr">{problem ?? error}</div>}
    </Shell>
  );
}

// ======================================================================= Bluetooth

const btIcon = (k: BtDevice["kind"]) =>
  k === "audio" ? <Headphones size={20} /> : k === "phone" ? <Smartphone size={20} /> :
  k === "computer" ? <Laptop size={20} /> : k === "input" ? <Mouse size={20} /> : <Bluetooth size={20} />;

export function BluetoothPanel({ onSettings }: PanelProps) {
  const { data, error, loading, refresh } = useRefreshing<BtDevice[]>(api.bluetoothDevices, 10000);
  const [working, setWorking] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  const toggle = async (d: BtDevice) => {
    setWorking(d.address);
    setProblem(null);
    try {
      await api.setBluetooth(d.address, !d.connected);
    } catch (e) {
      setProblem(`${String(e)}. You can also do this in Windows' Bluetooth settings.`);
    } finally {
      setWorking(null);
      refresh();
      window.setTimeout(refresh, 3500); // connecting takes a few seconds
    }
  };

  const subtitle = !data ? "Looking for devices…" : data.length ? `${data.length} paired device${data.length === 1 ? "" : "s"}` : "No paired devices";
  return (
    <Shell title="Bluetooth devices" subtitle={subtitle} loading={loading} onRefresh={refresh} onSettings={onSettings}>
      <div className="cpanel-body two">
        <div className="pcol span" data-scroll>
          {(data ?? []).map((d) => (
            <div key={d.address} className={`prow ${d.connected ? "sel" : ""}`}>
              <span className="prow-ico">{btIcon(d.kind)}</span>
              <span className="prow-text">
                <b>{d.name || "Unknown device"}</b>
                <small>{d.connected ? "Connected" : "Paired"}</small>
              </span>
              {working === d.address ? (
                <span className="prow-note">Working…</span>
              ) : (
                <button className="prow-act" onClick={() => toggle(d)}>{d.connected ? "Disconnect" : "Connect"}</button>
              )}
            </div>
          ))}
          {data && data.length === 0 && <div className="pempty">Pair a device in Windows' Bluetooth settings and it will show up here</div>}
        </div>
      </div>
      {(problem || error) && <div className="perr">{problem ?? error}</div>}
    </Shell>
  );
}

// ======================================================================= Audio

export function AudioPanel({ onSettings }: PanelProps) {
  const { data, error, loading, refresh } = useRefreshing<AudioDevices>(api.audioDevices, 8000);
  const [problem, setProblem] = useState<string | null>(null);
  const [pick, setPick] = useState<string | null>(null);

  const choose = async (d: AudioDevice) => {
    if (d.isDefault || pick) return;
    setPick(d.id);
    setProblem(null);
    try {
      await api.setDefaultAudio(d.id);
    } catch (e) {
      setProblem(`${String(e)}. You can also change it in Windows' Sound settings.`);
    } finally {
      setPick(null);
      refresh();
    }
  };

  const column = (title: string, list: AudioDevice[], input: boolean) => (
    <div className="pcol" data-scroll>
      <div className="pcol-title">{title}</div>
      {list.map((d) => {
        const shown = pick ? d.id === pick : d.isDefault; // the tapped one lights up straight away
        return (
          <button key={d.id} className={`prow clickable ${shown ? "sel" : ""}`} onClick={() => choose(d)}>
            <span className="prow-ico">{input ? <Mic size={20} /> : /head/i.test(d.name) ? <Headphones size={20} /> : <Speaker size={20} />}</span>
            <span className="prow-text">
              <b>{d.name}</b>
              {shown && <small>{pick === d.id ? "Switching…" : "Default"}</small>}
            </span>
          </button>
        );
      })}
      {list.length === 0 && <div className="pempty">None found</div>}
    </div>
  );

  const subtitle = data ? `${data.outputs.length} output${data.outputs.length === 1 ? "" : "s"} • ${data.inputs.length} input${data.inputs.length === 1 ? "" : "s"}` : "Looking for devices…";
  return (
    <Shell title="Audio devices" subtitle={subtitle} loading={loading} onRefresh={refresh} onSettings={onSettings}>
      <div className="cpanel-body two">
        {column("OUTPUT", data?.outputs ?? [], false)}
        {column("INPUT", data?.inputs ?? [], true)}
      </div>
      {(problem || error) && <div className="perr">{problem ?? error}</div>}
    </Shell>
  );
}
