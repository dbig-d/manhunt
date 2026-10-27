import type { ModeId, Settings, SettingsPatch } from "./protocol";

export interface ModeInfo {
  id: ModeId;
  name: string;
  tagline: string;
  description: string;
  /** The rules this mode sets. Everything else keeps whatever the host chose. */
  preset: SettingsPatch;
}

// Game modes are presets: picking one sets a handful of rules, and the host can
// still change anything afterwards. New modes only need an entry here.
export const MODES: ModeInfo[] = [
  {
    id: "classic",
    name: "Classic",
    tagline: "Hide, run, survive",
    description: "Tagged hiders are out and spectate. Hiders win if anyone survives the timer.",
    preset: { whenTagged: "out", secretCount: false, storm: { enabled: false }, hidersSeeHiders: "none", anonymous: false },
  },
  {
    id: "infection",
    name: "Infection",
    tagline: "The hunters multiply",
    description: "Tagged hiders join the seekers. The pack grows until nobody's left hiding.",
    preset: { whenTagged: "seeker", secretCount: false, storm: { enabled: false }, hidersSeeHiders: "none", anonymous: false },
  },
  {
    id: "night",
    name: "Night Time",
    tagline: "Alone in the dark",
    description: "Hiders can't see each other, dots have no names, and nobody knows how many are left. Just the timer.",
    preset: { whenTagged: "out", secretCount: true, storm: { enabled: false }, hidersSeeHiders: "none", anonymous: true, hiderView: "none" },
  },
  {
    id: "storm",
    name: "Storm",
    tagline: "The walls close in",
    description: "The play area shrinks during the hunt, pushing everyone together for the finale.",
    preset: { whenTagged: "out", secretCount: false, storm: { enabled: true, startPct: 25, finalPct: 35 }, hidersSeeHiders: "none", anonymous: false },
  },
];

export const MODE_BY_ID = Object.fromEntries(MODES.map((m) => [m.id, m])) as Record<ModeId, ModeInfo>;

/** Has the host changed any of the rules this mode sets? */
export function isCustomized(s: Settings): boolean {
  const preset = MODE_BY_ID[s.mode]?.preset ?? {};
  return Object.entries(preset).some(([key, value]) => {
    const current = s[key as keyof Settings];
    if (value && typeof value === "object") {
      return Object.entries(value).some(([k, v]) => (current as unknown as Record<string, unknown>)[k] !== v);
    }
    return current !== value;
  });
}
