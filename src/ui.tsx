import type { ReactNode } from "react";

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

/** Big rounded slider with the icon inside the fill and the value on the right. */
export function PillSlider({
  icon, value, onChange, disabled, label, hint, onDragStart,
}: {
  icon: ReactNode; value: number; onChange: (v: number) => void; disabled?: boolean; label: string; hint?: string;
  onDragStart?: () => void;
}) {
  return (
    <label className={`pslider ${disabled ? "disabled" : ""}`} title={hint} onPointerDown={onDragStart}>
      <span className="pslider-fill" style={{ width: `max(56px, ${value}%)` }}>
        <span className="pslider-icon">{icon}</span>
        {value >= 88 && !disabled && <b className="pslider-val in">{value}%</b>}
      </span>
      <input
        type="range" min={0} max={100} value={value} disabled={disabled} aria-label={label}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      {(value < 88 || disabled) && <b className="pslider-val">{disabled ? "n/a" : `${value}%`}</b>}
    </label>
  );
}
