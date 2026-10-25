import { useEffect, type ReactNode } from "react";
import { createPortal } from "react-dom";

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  disabled,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  disabled?: boolean;
}) {
  return (
    <div className="segmented" role="radiogroup">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          className={value === o.value ? "on" : ""}
          disabled={disabled}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Stepper({
  value,
  min,
  max,
  step,
  format,
  onChange,
  disabled,
}: {
  value: number;
  min: number;
  max: number;
  step: number | ((value: number, dir: 1 | -1) => number);
  format?: (v: number) => string;
  onChange: (v: number) => void;
  disabled?: boolean;
}) {
  const next = (dir: 1 | -1) => {
    const s = typeof step === "function" ? step(value, dir) : step;
    return Math.min(max, Math.max(min, value + dir * s));
  };
  return (
    <div className="stepper">
      <button type="button" disabled={disabled || value <= min} onClick={() => onChange(next(-1))} aria-label="Less">
        −
      </button>
      <span>{format ? format(value) : value}</span>
      <button type="button" disabled={disabled || value >= max} onClick={() => onChange(next(1))} aria-label="More">
        +
      </button>
    </div>
  );
}

export function Toggle({ value, onChange, disabled }: { value: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={value}
      className={`toggle ${value ? "on" : ""}`}
      disabled={disabled}
      onClick={() => onChange(!value)}
    >
      <span />
    </button>
  );
}

/** A panel that slides up from the bottom. */
export function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  // Rendered at the top of the page so it always covers the map and the test panel.
  return createPortal(
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" role="dialog" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <div className="sheet-head">
          <h2>{title}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        <div className="sheet-body">{children}</div>
      </div>
    </div>,
    document.body,
  );
}

export interface Toast {
  id: number;
  text: string;
  tone: "info" | "bad" | "good";
}

export function Toasts({ toasts }: { toasts: Toast[] }) {
  return (
    <div className="toasts" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast toast--${t.tone}`}>
          {t.text}
        </div>
      ))}
    </div>
  );
}

export function Avatar({ name, isBot }: { name: string; isBot?: boolean }) {
  // Stable color per name.
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) % 360;
  return (
    <span className="avatar" style={{ background: isBot ? "#3a4656" : `hsl(${h} 70% 55%)` }}>
      {isBot ? "⚙" : name.slice(0, 1).toUpperCase()}
    </span>
  );
}
