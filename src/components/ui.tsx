import { useEffect, type ReactNode } from "react";
import { createPortal } from "react-dom";
import Icon, { type IconName } from "./Icon";

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
        <Icon name="minus" size={18} />
      </button>
      <span>{format ? format(value) : value}</span>
      <button type="button" disabled={disabled || value >= max} onClick={() => onChange(next(1))} aria-label="More">
        <Icon name="plus" size={18} />
      </button>
    </div>
  );
}

export function Toggle({ value, onChange, disabled, label }: { value: boolean; onChange: (v: boolean) => void; disabled?: boolean; label?: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={value}
      aria-label={label}
      className={`toggle ${value ? "on" : ""}`}
      disabled={disabled}
      onClick={() => onChange(!value)}
    >
      <span />
    </button>
  );
}

/** One setting: a label and hint on the left, its control on the right (or below, with `stack`). */
export function SettingRow({ label, hint, stack, children }: { label: string; hint?: ReactNode; stack?: boolean; children: ReactNode }) {
  return (
    <div className={`setting ${stack ? "setting--stack" : ""}`}>
      <div className="setting-text">
        <div className="setting-label">{label}</div>
        {hint && <div className="setting-hint">{hint}</div>}
      </div>
      <div className="setting-control">{children}</div>
    </div>
  );
}

/** A panel that slides up from the bottom. `full` makes it nearly full-screen. */
export function Sheet({
  title,
  onClose,
  children,
  full,
  head,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  full?: boolean;
  /** Replaces the default title row. */
  head?: ReactNode;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  // Rendered at the top of the page so it always covers the map.
  return createPortal(
    <div className="sheet-backdrop" onClick={onClose}>
      <div className={`sheet ${full ? "sheet--full" : ""}`} role="dialog" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <div className="sheet-head">
          {head ?? <h2>{title}</h2>}
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            <Icon name="x" />
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
  tone: "info" | "bad" | "good" | "coin";
  icon?: IconName;
}

const TOAST_ICON: Record<Toast["tone"], IconName> = { info: "info", bad: "alert", good: "target", coin: "coin" };

export function Toasts({ toasts, inGame }: { toasts: Toast[]; inGame?: boolean }) {
  return (
    <div className={`toasts ${inGame ? "toasts--game" : ""}`} aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast toast--${t.tone}`}>
          <Icon name={t.icon ?? TOAST_ICON[t.tone]} size={18} />
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
    <span className="avatar" style={{ background: isBot ? "#2b3646" : `hsl(${h} 75% 62%)`, color: isBot ? "#9fb0c4" : undefined }}>
      {isBot ? <Icon name="bot" size={16} /> : name.slice(0, 1).toUpperCase()}
    </span>
  );
}
