import type { CSSProperties, ReactNode } from "react";

export function Ring({
  pct, color, size = 120, stroke = 12, children,
}: { pct: number; color: string; size?: number; stroke?: number; children?: ReactNode }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const p = Math.max(0, Math.min(100, pct));
  return (
    <div className="ring" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle className="ring-track" cx={size / 2} cy={size / 2} r={r} strokeWidth={stroke} />
        <circle
          className="ring-fill" cx={size / 2} cy={size / 2} r={r} strokeWidth={stroke} stroke={color}
          strokeLinecap="round" strokeDasharray={`${(c * p) / 100} ${c}`}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </svg>
      <div className="ring-center">{children}</div>
    </div>
  );
}

/** Flat bar slider: the row splits into two tones at the handle, icon on the left, reading right. */
export function PillSlider({
  icon, value, onChange, disabled, label, hint, onDragStart,
}: {
  icon: ReactNode; value: number; onChange: (v: number) => void; disabled?: boolean; label: string; hint?: string;
  onDragStart?: () => void;
}) {
  const v = Math.max(0, Math.min(100, Math.round(value)));
  return (
    <label
      className={`bslider ${disabled ? "disabled" : ""}`}
      title={hint}
      onPointerDown={onDragStart}
      style={{ ["--v" as string]: `${v}%` } as CSSProperties}
    >
      <span className="bs-ico">{icon}</span>
      <span className="bs-fill" aria-hidden />
      <span className="bs-track">
        <i className="bs-tick" aria-hidden />
      </span>
      <b className="bs-val">{disabled ? "n/a" : `${v}%`}</b>
      <input
        type="range" min={0} max={100} value={value} disabled={disabled} aria-label={label}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </label>
  );
}
