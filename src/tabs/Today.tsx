import { useState } from "react";
import { ArrowRight, Plus, Trash2 } from "lucide-react";
import { useClock, useHour24, useLocal } from "../hooks";
import { Ring } from "../ui";
import { timer, useTimer } from "../timer";
import { describe, useWeather } from "../weather";
import type { TabProps } from "../App";

const pad = (n: number) => String(n).padStart(2, "0");

function ClockCard() {
  const now = useClock();
  const [h24, toggle] = useHour24();
  const hours = h24 ? now.getHours() : now.getHours() % 12 || 12;
  const date = `${now.toLocaleDateString(undefined, { weekday: "short" })} ${now.getDate()}`;
  return (
    <button className="card clockcard" onClick={toggle} title={h24 ? "Switch to 12-hour" : "Switch to 24-hour"}>
      <span className="clock-big">{pad(hours)}</span>
      <span className="clock-dots"><i /><i /><i /></span>
      <span className="clock-big">{pad(now.getMinutes())}</span>
      <small>{h24 ? date : `${now.getHours() < 12 ? "AM" : "PM"} • ${date}`}</small>
    </button>
  );
}

function WeatherCard() {
  const { weather, failed } = useWeather();
  if (!weather) {
    return (
      <div className="card weather">
        <small className="muted-note">{failed ? "Weather unavailable (offline?)" : "Loading weather…"}</small>
      </div>
    );
  }
  const { text, icon: Icon } = describe(weather.code);
  return (
    <div className="card weather">
      <Icon size={34} className="wx-icon" />
      <b className="wx-temp">{weather.temp}°C</b>
      <small>{text}{weather.city ? ` • ${weather.city}` : ""}</small>
    </div>
  );
}

function WeekCard() {
  const today = new Date();
  const monday = new Date(today);
  monday.setDate(today.getDate() - ((today.getDay() + 6) % 7));
  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    return d;
  });
  const last = days[6];
  const range =
    monday.getMonth() === last.getMonth()
      ? `${monday.toLocaleDateString(undefined, { month: "short" })} ${monday.getDate()} – ${last.getDate()}`
      : `${monday.toLocaleDateString(undefined, { month: "short", day: "numeric" })} – ${last.toLocaleDateString(undefined, { month: "short", day: "numeric" })}`;
  return (
    <div className="card week">
      <div className="card-head"><b>This week</b><small>{range}</small></div>
      <div className="week-days">
        {days.map((d) => {
          const isToday = d.toDateString() === today.toDateString();
          return (
            <div key={d.toISOString()} className="wd">
              <small>{d.toLocaleDateString(undefined, { weekday: "short" })}</small>
              <span className={isToday ? "now" : ""}>{d.getDate()}</span>
            </div>
          );
        })}
      </div>
      <div className="agenda">
        <i />
        <div>
          <b>Calendar not connected</b>
          <small>Event sync is planned for a later version</small>
        </div>
      </div>
    </div>
  );
}

function TimerCard() {
  const t = useTimer();
  const h = Math.floor(t.total / 3600);
  const m = Math.floor((t.total % 3600) / 60);
  const rh = Math.floor(t.remaining / 3600);
  const text = rh > 0 ? `${rh}:${pad(Math.floor((t.remaining % 3600) / 60))}:${pad(t.remaining % 60)}` : `${pad(Math.floor(t.remaining / 60))}:${pad(t.remaining % 60)}`;
  const setHM = (hh: number, mm: number) => timer.setTotal(hh * 3600 + mm * 60);
  const presets = [1, 5, 10, 15, 20];
  return (
    <div className="card timer">
      <Ring pct={(t.remaining / t.total) * 100} color="var(--orange)" size={132} stroke={8}>
        <span className="timer-text">{text}</span>
      </Ring>
      <div className="timer-side">
        <div className="timer-inputs">
          <label><input type="number" min={0} max={99} value={h} disabled={t.running}
            onChange={(e) => setHM(Math.max(0, Number(e.target.value) || 0), m)} /> <small>h</small></label>
          <label><input type="number" min={0} max={59} value={m} disabled={t.running}
            onChange={(e) => setHM(h, Math.min(59, Math.max(0, Number(e.target.value) || 0)))} /> <small>min</small></label>
        </div>
        <div className="presets">
          {presets.map((p) => (
            <button key={p} className={t.total === p * 60 ? "on" : ""} disabled={t.running} onClick={() => timer.setTotal(p * 60)}>{p}m</button>
          ))}
        </div>
        <div className="timer-btns">
          <button className="orange" onClick={() => (t.running ? timer.pause() : timer.start())}>
            {t.running ? "Pause" : t.remaining < t.total && t.remaining > 0 ? "Resume" : "Start"}
          </button>
          <button className="grey" onClick={() => timer.reset()}>Reset</button>
        </div>
      </div>
    </div>
  );
}

type Todo = { id: string; text: string; done: boolean };

function TodoCard() {
  const [todos, setTodos] = useLocal<Todo[]>("island.todos", []);
  const [text, setText] = useState("");
  const done = todos.filter((t) => t.done).length;
  const add = () => {
    const v = text.trim();
    if (!v) return;
    setTodos((p) => [...p, { id: String(Date.now()), text: v, done: false }]);
    setText("");
  };
  return (
    <div className="card todos">
      <div className="card-head">
        <b>Today</b>
        <Ring pct={todos.length ? (done / todos.length) * 100 : 0} color="var(--olive)" size={44} stroke={5}>
          <span className="todo-count">{done}/{todos.length}</span>
        </Ring>
      </div>
      <div className="todo-list">
        {todos.length === 0 && <div className="todo-empty">Nothing for today yet.<br />Add one below.</div>}
        {todos.map((t) => (
          <div key={t.id} className={`todo ${t.done ? "done" : ""}`}>
            <button className="check" aria-label="Toggle done"
              onClick={() => setTodos((p) => p.map((x) => (x.id === t.id ? { ...x, done: !x.done } : x)))}>{t.done ? "✓" : ""}</button>
            <span>{t.text}</span>
            <button className="del" aria-label="Delete" onClick={() => setTodos((p) => p.filter((x) => x.id !== t.id))}><Trash2 size={14} /></button>
          </div>
        ))}
      </div>
      <div className="todo-input">
        <Plus size={18} />
        <input value={text} placeholder="Add a to-do…" onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === "Enter" && add()} />
        <button onClick={add} aria-label="Add"><ArrowRight size={18} /></button>
      </div>
    </div>
  );
}

export default function Today(_: TabProps) {
  return (
    <div className="today">
      <div className="col-left"><ClockCard /><WeatherCard /></div>
      <div className="col-mid"><WeekCard /><TimerCard /></div>
      <TodoCard />
    </div>
  );
}
