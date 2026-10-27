import { ACCENTS, DEFAULT_THEME, THEME_MODES, accentName, setTheme, useTheme, type ThemeMode } from "../lib/theme";
import Icon, { type IconName } from "./Icon";
import { Segmented, Toggle } from "./ui";

const MODE_ICON: Record<ThemeMode, IconName> = { dark: "moon", gray: "contrast", light: "sun" };

/** Theme picker: base theme and accent color, applied live everywhere. */
export default function Appearance() {
  const theme = useTheme();
  const isDefault = theme.mode === DEFAULT_THEME.mode && theme.accent === DEFAULT_THEME.accent;

  return (
    <div className="appearance">
      {/* A tiny live sample of the app in the chosen look. */}
      <div className="theme-preview" aria-hidden="true" inert>
        <div className="theme-preview-head">
          <span className="theme-preview-logo">MANHUNT</span>
          <span className="tag tag--hider">Hider</span>
          <span className="tag tag--seeker">Seeker</span>
        </div>
        <div className="theme-preview-row">
          <Segmented value="a" onChange={() => {}} options={[{ value: "a", label: "Classic" }, { value: "b", label: "Night" }]} />
          <Toggle value onChange={() => {}} label="Sample switch" />
        </div>
        <span className="btn btn--primary btn--block">
          <Icon name="play" size={18} />
          Start game
        </span>
      </div>

      <section>
        <div className="eyebrow appearance-label">Theme</div>
        <div className="theme-modes" role="radiogroup" aria-label="Theme">
          {THEME_MODES.map((m) => (
            <button
              key={m.id}
              role="radio"
              aria-checked={theme.mode === m.id}
              className={`theme-mode ${theme.mode === m.id ? "on" : ""}`}
              onClick={() => setTheme({ mode: m.id })}
            >
              <span className="theme-thumb" style={{ background: m.bg, borderColor: m.line }}>
                <i style={{ background: m.panel, borderColor: m.line }} />
                <i style={{ background: m.panel, borderColor: m.line }} />
                <b style={{ background: ACCENTS.find((a) => a.id === theme.accent)![m.id === "light" ? "light" : "dark"] }} />
              </span>
              <span className="theme-mode-name">
                <Icon name={MODE_ICON[m.id]} size={15} />
                {m.name}
              </span>
              <small>{m.hint}</small>
            </button>
          ))}
        </div>
      </section>

      <section>
        <div className="eyebrow appearance-label">Accent color</div>
        <div className="swatches" role="radiogroup" aria-label="Accent color">
          {ACCENTS.map((a) => {
            const color = theme.mode === "light" ? a.light : a.dark;
            const on = theme.accent === a.id;
            return (
              <button
                key={a.id}
                role="radio"
                aria-checked={on}
                aria-label={accentName(a.id, theme.mode)}
                className={`swatch ${on ? "on" : ""}`}
                style={{ "--swatch": color } as React.CSSProperties}
                onClick={() => setTheme({ accent: a.id })}
              >
                <i>{on && <Icon name="check" size={16} />}</i>
                <span>{accentName(a.id, theme.mode)}</span>
              </button>
            );
          })}
        </div>
        <p className="hint">Hiders stay green and seekers stay red on the map, whatever accent you pick.</p>
      </section>

      <button className="btn btn--ghost btn--block" disabled={isDefault} onClick={() => setTheme(DEFAULT_THEME)}>
        Reset to Night Ops green
      </button>
    </div>
  );
}
