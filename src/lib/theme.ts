import { useSyncExternalStore } from "react";

// The look of the app: a base theme plus an accent color, saved on this device.
// index.css holds the actual colors (keyed off <html data-theme data-accent>);
// index.html applies the saved choice before the first paint, so there's no flash.

export type ThemeMode = "dark" | "gray" | "light";
export type AccentId = "green" | "blue" | "cyan" | "purple" | "pink" | "red" | "orange" | "yellow" | "white" | "gray";
export interface Theme {
  mode: ThemeMode;
  accent: AccentId;
}

export const DEFAULT_THEME: Theme = { mode: "dark", accent: "green" };
const KEY = "mh:theme";

/** Preview colors for each base theme (matching index.css), for the picker's thumbnails. */
export const THEME_MODES: { id: ThemeMode; name: string; hint: string; bg: string; panel: string; ink: string; line: string }[] = [
  { id: "dark", name: "Dark", hint: "Night Ops. Best after sunset", bg: "#05070b", panel: "#111925", ink: "#e6eef7", line: "rgba(140,170,210,.22)" },
  { id: "gray", name: "Gray", hint: "Softer and easier on the eyes", bg: "#181b20", panel: "#2a2f37", ink: "#eef1f5", line: "rgba(210,220,235,.19)" },
  { id: "light", name: "Light", hint: "Readable in bright sunshine", bg: "#eef1f5", panel: "#ffffff", ink: "#0f1722", line: "rgba(15,35,65,.18)" },
];

/** Accent colors (matching index.css): a bright shade for dark themes, a deeper one for light. */
export const ACCENTS: { id: AccentId; name: string; lightName?: string; dark: string; light: string }[] = [
  { id: "green", name: "Green", dark: "#3dff9a", light: "#0f9f5c" },
  { id: "cyan", name: "Cyan", dark: "#2fe0f0", light: "#0a8fa3" },
  { id: "blue", name: "Blue", dark: "#5aa9ff", light: "#1d6fe0" },
  { id: "purple", name: "Purple", dark: "#b392ff", light: "#6d45dc" },
  { id: "pink", name: "Pink", dark: "#ff70cf", light: "#cf2f8a" },
  { id: "red", name: "Red", dark: "#ff5464", light: "#d02a3b" },
  { id: "orange", name: "Orange", dark: "#ffa040", light: "#d2650a" },
  { id: "yellow", name: "Yellow", dark: "#ffd23f", light: "#b38600" },
  // On a light background, white becomes its opposite so it's still visible.
  { id: "white", name: "White", lightName: "Black", dark: "#f2f5f9", light: "#1c2430" },
  { id: "gray", name: "Gray", dark: "#a9b4c1", light: "#576272" },
];

const MODE_IDS = THEME_MODES.map((m) => m.id);
const ACCENT_IDS = ACCENTS.map((a) => a.id);

function load(): Theme {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "{}") as Partial<Theme>;
    return {
      mode: MODE_IDS.includes(raw.mode as ThemeMode) ? (raw.mode as ThemeMode) : DEFAULT_THEME.mode,
      accent: ACCENT_IDS.includes(raw.accent as AccentId) ? (raw.accent as AccentId) : DEFAULT_THEME.accent,
    };
  } catch {
    return DEFAULT_THEME;
  }
}

let current = load();
const listeners = new Set<() => void>();

function apply(t: Theme) {
  const root = document.documentElement;
  root.dataset.theme = t.mode;
  root.dataset.accent = t.accent;
  // The phone's status bar / browser chrome color.
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", THEME_MODES.find((m) => m.id === t.mode)!.bg);
}

apply(current);

export function setTheme(patch: Partial<Theme>) {
  current = { ...current, ...patch };
  apply(current);
  try {
    localStorage.setItem(KEY, JSON.stringify(current));
  } catch {
    // private mode: the choice just won't be remembered
  }
  listeners.forEach((fn) => fn());
}

export function useTheme(): Theme {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => void listeners.delete(fn);
    },
    () => current,
  );
}

export function accentHex(t: Theme) {
  const a = ACCENTS.find((x) => x.id === t.accent)!;
  return t.mode === "light" ? a.light : a.dark;
}

export function accentName(id: AccentId, mode: ThemeMode) {
  const a = ACCENTS.find((x) => x.id === id)!;
  return mode === "light" && a.lightName ? a.lightName : a.name;
}
