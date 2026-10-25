import type { Boundary, Settings } from "./protocol";

export const DEFAULT_SETTINGS: Settings = {
  mode: "classic",
  roleAssignment: "random",
  seekerCount: 2,
  headStartSec: 300,
  gameLengthMin: 30,
  pingIntervalSec: 60,
  pingSpeedUp: false,
  pingStyle: "exact",
  hiderView: "none",
  hiderViewIntervalSec: 180,
  teammates: "seekers",
  boundary: null,
  oobPenalty: "reveal",
  oobGraceSec: 15,
  tagMode: "honor",
  stalePenalty: "flag",
  botsCanTag: true,
};

export const LIMITS = {
  seekerCount: [1, 10],
  headStartSec: [0, 900],
  gameLengthMin: [1, 120],
  pingIntervalSec: [15, 300],
  hiderViewIntervalSec: [30, 600],
  oobGraceSec: [0, 120],
  radius: [25, 2000],
  rectSide: [25, 3000],
} as const;

/** The final stretch where pings speed up. */
export const SPEED_UP_WINDOW_MS = 5 * 60_000;
/** Location older than this counts as stale. */
export const STALE_AFTER_MS = 90_000;
export const FUZZY_RADIUS_M = 25;
export const PROXIMITY_ALERT_M = 50;
/** How close a seeker must be to tag a bot (generous because of GPS error). */
export const BOT_TAG_RANGE_M = 25;
/** Seeker bots tag hiders within this distance. */
export const BOT_AUTO_TAG_M = 6;
export const MAX_PLAYERS = 40;

const clamp = (n: unknown, [lo, hi]: readonly [number, number], fallback: number) =>
  typeof n === "number" && Number.isFinite(n) ? Math.min(hi, Math.max(lo, Math.round(n))) : fallback;

function oneOf<T extends string>(v: unknown, options: readonly T[], fallback: T): T {
  return options.includes(v as T) ? (v as T) : fallback;
}

function validLatLng(p: unknown): p is { lat: number; lng: number } {
  const q = p as { lat?: unknown; lng?: unknown } | null;
  return (
    !!q &&
    typeof q.lat === "number" &&
    typeof q.lng === "number" &&
    Math.abs(q.lat) <= 90 &&
    Math.abs(q.lng) <= 180
  );
}

function sanitizeBoundary(b: unknown, fallback: Boundary | null): Boundary | null {
  if (b === null) return null;
  const q = b as Partial<Record<string, unknown>> | undefined;
  if (!q || !validLatLng(q.center)) return fallback;
  const center = { lat: q.center.lat, lng: q.center.lng };
  if (q.shape === "circle") {
    return { shape: "circle", center, radius: clamp(q.radius, LIMITS.radius, 150) };
  }
  if (q.shape === "rect") {
    return {
      shape: "rect",
      center,
      width: clamp(q.width, LIMITS.rectSide, 200),
      height: clamp(q.height, LIMITS.rectSide, 200),
      rotation: clamp(q.rotation, [0, 359], 0),
    };
  }
  return fallback;
}

/** Apply an untrusted settings patch from a phone, keeping every value in range. */
export function applySettingsPatch(current: Settings, patch: Partial<Settings>): Settings {
  const p = patch as Record<string, unknown>;
  const has = (k: keyof Settings) => Object.prototype.hasOwnProperty.call(p, k);
  return {
    mode: has("mode") ? oneOf(p.mode, ["classic", "infection"], current.mode) : current.mode,
    roleAssignment: has("roleAssignment")
      ? oneOf(p.roleAssignment, ["random", "manual", "volunteer"], current.roleAssignment)
      : current.roleAssignment,
    seekerCount: has("seekerCount") ? clamp(p.seekerCount, LIMITS.seekerCount, current.seekerCount) : current.seekerCount,
    headStartSec: has("headStartSec") ? clamp(p.headStartSec, LIMITS.headStartSec, current.headStartSec) : current.headStartSec,
    gameLengthMin: has("gameLengthMin") ? clamp(p.gameLengthMin, LIMITS.gameLengthMin, current.gameLengthMin) : current.gameLengthMin,
    pingIntervalSec: has("pingIntervalSec")
      ? clamp(p.pingIntervalSec, LIMITS.pingIntervalSec, current.pingIntervalSec)
      : current.pingIntervalSec,
    pingSpeedUp: has("pingSpeedUp") ? p.pingSpeedUp === true : current.pingSpeedUp,
    pingStyle: has("pingStyle") ? oneOf(p.pingStyle, ["exact", "fuzzy"], current.pingStyle) : current.pingStyle,
    hiderView: has("hiderView") ? oneOf(p.hiderView, ["none", "pinged", "proximity"], current.hiderView) : current.hiderView,
    hiderViewIntervalSec: has("hiderViewIntervalSec")
      ? clamp(p.hiderViewIntervalSec, LIMITS.hiderViewIntervalSec, current.hiderViewIntervalSec)
      : current.hiderViewIntervalSec,
    teammates: has("teammates") ? oneOf(p.teammates, ["seekers", "both", "none"], current.teammates) : current.teammates,
    boundary: has("boundary") ? sanitizeBoundary(p.boundary, current.boundary) : current.boundary,
    oobPenalty: has("oobPenalty") ? oneOf(p.oobPenalty, ["warn", "reveal", "eliminate"], current.oobPenalty) : current.oobPenalty,
    oobGraceSec: has("oobGraceSec") ? clamp(p.oobGraceSec, LIMITS.oobGraceSec, current.oobGraceSec) : current.oobGraceSec,
    tagMode: has("tagMode") ? oneOf(p.tagMode, ["honor", "qr"], current.tagMode) : current.tagMode,
    stalePenalty: has("stalePenalty") ? oneOf(p.stalePenalty, ["off", "flag", "reveal"], current.stalePenalty) : current.stalePenalty,
    botsCanTag: has("botsCanTag") ? p.botsCanTag === true : current.botsCanTag,
  };
}
