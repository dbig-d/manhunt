import type { Boundary, ItemId, Settings, SettingsPatch, ShopItemSettings } from "./protocol";
import { ITEMS } from "./items";

export const DEFAULT_SETTINGS: Settings = {
  mode: "classic",
  whenTagged: "out",
  roleAssignment: "random",
  seekerCount: 2,
  headStartSec: 300,
  gameLengthMin: 30,
  pingIntervalSec: 60,
  pingSpeedUp: false,
  pingStyle: "exact",
  hiderView: "none",
  hiderViewIntervalSec: 180,
  seekersSeeSeekers: true,
  hidersSeeHiders: "none",
  anonymous: false,
  secretCount: false,
  boundary: null,
  oobPenalty: "reveal",
  oobGraceSec: 15,
  storm: { enabled: false, startPct: 25, finalPct: 35 },
  tagMode: "honor",
  stalePenalty: "flag",
  zones: { enabled: true, maxActive: 1, everySec: 240, durationSec: 180, radiusM: 20, coinsPerMin: 6, pingEffect: "none" },
  shop: {
    enabled: true,
    seekerEconomy: false,
    coinsPerTag: 20,
    items: Object.fromEntries(ITEMS.map((i) => [i.id, { enabled: true, price: i.price, limit: i.limit }])) as Record<ItemId, ShopItemSettings>,
  },
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
  stormStartPct: [0, 80],
  stormFinalPct: [15, 80],
  zoneMaxActive: [1, 4],
  zoneEverySec: [30, 900],
  zoneDurationSec: [30, 900],
  zoneRadiusM: [10, 60],
  zoneCoinsPerMin: [1, 30],
  coinsPerTag: [0, 100],
  itemPrice: [0, 300],
  itemLimit: [0, 10],
} as const;

/** The final stretch where pings speed up. */
export const SPEED_UP_WINDOW_MS = 5 * 60_000;
/** Location older than this counts as stale. */
export const STALE_AFTER_MS = 90_000;
export const FUZZY_RADIUS_M = 25;
export const STATIC_RADIUS_M = 60;
export const PROXIMITY_ALERT_M = 50;
export const ALARM_RADIUS_M = 40;
/** How close a seeker must be to tag a bot (generous because of GPS error). */
export const BOT_TAG_RANGE_M = 25;
/** Seeker bots tag hiders within this distance. */
export const BOT_AUTO_TAG_M = 6;
export const MAX_PLAYERS = 40;
/** The storm finishes shrinking this far into the hunt. */
export const STORM_END_FRACTION = 0.9;

// ---------- validation ----------
// Every setting from a phone is untrusted, so each field has a type and range here.

type Spec = { kind: "bool" } | { kind: "int"; range: readonly [number, number] } | { kind: "enum"; options: readonly string[] };
const bool: Spec = { kind: "bool" };
const int = (range: readonly [number, number]): Spec => ({ kind: "int", range });
const oneOf = (...options: string[]): Spec => ({ kind: "enum", options });

const TOP: Record<string, Spec> = {
  mode: oneOf("classic", "infection", "night", "storm"),
  whenTagged: oneOf("out", "seeker"),
  roleAssignment: oneOf("random", "manual", "volunteer"),
  seekerCount: int(LIMITS.seekerCount),
  headStartSec: int(LIMITS.headStartSec),
  gameLengthMin: int(LIMITS.gameLengthMin),
  pingIntervalSec: int(LIMITS.pingIntervalSec),
  pingSpeedUp: bool,
  pingStyle: oneOf("exact", "fuzzy"),
  hiderView: oneOf("none", "pinged", "proximity"),
  hiderViewIntervalSec: int(LIMITS.hiderViewIntervalSec),
  seekersSeeSeekers: bool,
  hidersSeeHiders: oneOf("live", "pings", "none"),
  anonymous: bool,
  secretCount: bool,
  oobPenalty: oneOf("warn", "reveal", "eliminate"),
  oobGraceSec: int(LIMITS.oobGraceSec),
  tagMode: oneOf("honor", "qr"),
  stalePenalty: oneOf("off", "flag", "reveal"),
  botsCanTag: bool,
};
const STORM: Record<string, Spec> = { enabled: bool, startPct: int(LIMITS.stormStartPct), finalPct: int(LIMITS.stormFinalPct) };
const ZONES: Record<string, Spec> = {
  enabled: bool,
  maxActive: int(LIMITS.zoneMaxActive),
  everySec: int(LIMITS.zoneEverySec),
  durationSec: int(LIMITS.zoneDurationSec),
  radiusM: int(LIMITS.zoneRadiusM),
  coinsPerMin: int(LIMITS.zoneCoinsPerMin),
  pingEffect: oneOf("none", "alert", "fuzzy"),
};
const SHOP: Record<string, Spec> = { enabled: bool, seekerEconomy: bool, coinsPerTag: int(LIMITS.coinsPerTag) };
const ITEM: Record<string, Spec> = { enabled: bool, price: int(LIMITS.itemPrice), limit: int(LIMITS.itemLimit) };

function check(spec: Spec, value: unknown, fallback: unknown) {
  switch (spec.kind) {
    case "bool":
      return typeof value === "boolean" ? value : fallback;
    case "int":
      return typeof value === "number" && Number.isFinite(value)
        ? Math.min(spec.range[1], Math.max(spec.range[0], Math.round(value)))
        : fallback;
    case "enum":
      return spec.options.includes(value as string) ? value : fallback;
  }
}

/** Copy the allowed fields of `patch` over `current`, ignoring anything invalid. */
function applyGroup<T extends object>(specs: Record<string, Spec>, current: T, patch: unknown): T {
  const out = { ...current } as Record<string, unknown>;
  if (!patch || typeof patch !== "object") return current;
  for (const [key, spec] of Object.entries(specs)) {
    if (Object.prototype.hasOwnProperty.call(patch, key)) out[key] = check(spec, (patch as Record<string, unknown>)[key], out[key]);
  }
  return out as T;
}

function validLatLng(p: unknown): p is { lat: number; lng: number } {
  const q = p as { lat?: unknown; lng?: unknown } | null;
  return !!q && typeof q.lat === "number" && typeof q.lng === "number" && Math.abs(q.lat) <= 90 && Math.abs(q.lng) <= 180;
}

function sanitizeBoundary(b: unknown, fallback: Boundary | null): Boundary | null {
  if (b === null) return null;
  const q = b as Partial<Record<string, unknown>> | undefined;
  if (!q || !validLatLng(q.center)) return fallback;
  const center = { lat: q.center.lat, lng: q.center.lng };
  const n = (v: unknown, range: readonly [number, number], d: number) => check(int(range), v, d) as number;
  if (q.shape === "circle") return { shape: "circle", center, radius: n(q.radius, LIMITS.radius, 150) };
  if (q.shape === "rect") {
    return {
      shape: "rect",
      center,
      width: n(q.width, LIMITS.rectSide, 200),
      height: n(q.height, LIMITS.rectSide, 200),
      rotation: n(q.rotation, [0, 359], 0),
    };
  }
  return fallback;
}

/** Apply an untrusted settings patch from a phone, keeping every value in range. */
export function applySettingsPatch(current: Settings, patch: SettingsPatch): Settings {
  const p = (patch ?? {}) as Record<string, unknown>;
  const next = applyGroup(TOP, current, p);
  if ("boundary" in p) next.boundary = sanitizeBoundary(p.boundary, current.boundary);
  if ("storm" in p) next.storm = applyGroup(STORM, current.storm, p.storm);
  if ("zones" in p) next.zones = applyGroup(ZONES, current.zones, p.zones);
  if ("shop" in p && p.shop && typeof p.shop === "object") {
    const shopPatch = p.shop as Record<string, unknown>;
    next.shop = { ...applyGroup(SHOP, current.shop, shopPatch), items: { ...current.shop.items } };
    const items = shopPatch.items as Record<string, unknown> | undefined;
    if (items && typeof items === "object") {
      for (const { id } of ITEMS) {
        if (id in items) next.shop.items[id] = applyGroup(ITEM, current.shop.items[id], items[id]);
      }
    }
  }
  return next;
}

/** Settings saved by an older version: fill in anything new with defaults. */
export function normalizeSettings(raw: unknown): Settings {
  const r = (raw ?? {}) as Record<string, unknown> & { teammates?: string };
  const s = applySettingsPatch(DEFAULT_SETTINGS, r as SettingsPatch);
  // Before modes became presets, "infection" was the only way to turn tagged hiders into seekers.
  if (!("whenTagged" in r) && r.mode === "infection") s.whenTagged = "seeker";
  if (r.teammates) {
    s.seekersSeeSeekers = r.teammates !== "none";
    s.hidersSeeHiders = r.teammates === "both" ? "live" : "none";
  }
  return s;
}
