// Messages and data shapes shared by the website (src/) and the game server (worker/).

export type Role = "seeker" | "hider";
export type Phase = "lobby" | "headstart" | "hunt" | "results";
export type ModeId = "classic" | "infection" | "night" | "storm";
export type PlayerStatus = "alive" | "out";
/** Who can read a chat message: everyone (lobby), one team, or the players who are out. */
export type Channel = "all" | "seekers" | "hiders" | "out";

export type ItemId =
  // hiders
  | "jammer"
  | "ghost"
  | "decoy"
  | "static"
  | "alarm"
  | "radar"
  | "blackout"
  | "revive"
  // seekers
  | "scan"
  | "instantPing"
  | "tracker";

export interface LatLng {
  lat: number;
  lng: number;
}

export type Boundary =
  | { shape: "circle"; center: LatLng; radius: number }
  // rotation: degrees clockwise from north
  | { shape: "rect"; center: LatLng; width: number; height: number; rotation: number };

export interface ZoneSettings {
  enabled: boolean;
  /** How many safe zones can be open at once. */
  maxActive: number;
  /** A new zone appears this often (when there's room for one). */
  everySec: number;
  durationSec: number;
  radiusM: number;
  /** Coins a zone hands out per minute, split between the hiders inside. */
  coinsPerMin: number;
  /** alert: seekers are told when a hider walks in. fuzzy: pings inside a zone are blurry. */
  pingEffect: "none" | "alert" | "fuzzy";
}

export interface ShopItemSettings {
  enabled: boolean;
  price: number;
  /** Uses per player per game. 0 = no limit. */
  limit: number;
}

export interface ShopSettings {
  enabled: boolean;
  /** Seekers earn coins for tags and get their own items. */
  seekerEconomy: boolean;
  coinsPerTag: number;
  items: Record<ItemId, ShopItemSettings>;
}

export interface StormSettings {
  enabled: boolean;
  /** Shrinking starts this far into the hunt (% of game length)... */
  startPct: number;
  /** ...and the play area ends up this big (% of its original size). */
  finalPct: number;
}

export interface Settings {
  /** The preset the host last picked. Individual rules below can still be changed. */
  mode: ModeId;
  /** What happens to a tagged hider. */
  whenTagged: "out" | "seeker";
  roleAssignment: "random" | "manual" | "volunteer";
  seekerCount: number;
  headStartSec: number;
  gameLengthMin: number;
  pingIntervalSec: number;
  /** Halve the ping interval in the final 5 minutes. */
  pingSpeedUp: boolean;
  pingStyle: "exact" | "fuzzy";
  /** What hiders get to know about seekers. */
  hiderView: "none" | "pinged" | "proximity";
  hiderViewIntervalSec: number;
  /** Seekers see each other live. */
  seekersSeeSeekers: boolean;
  /** How hiders see other hiders: live, only at each ping, or not at all. */
  hidersSeeHiders: "live" | "pings" | "none";
  /** Pins of the other team show no names, so you don't know who you're chasing. */
  anonymous: boolean;
  /** Nobody still playing knows how many hiders are left (Night Time). */
  secretCount: boolean;
  boundary: Boundary | null;
  oobPenalty: "warn" | "reveal" | "eliminate";
  oobGraceSec: number;
  storm: StormSettings;
  tagMode: "honor" | "qr";
  stalePenalty: "off" | "flag" | "reveal";
  zones: ZoneSettings;
  shop: ShopSettings;
  /** Testing: seeker bots tag any hider they walk into. */
  botsCanTag: boolean;
}

/** A change to the settings. Nested groups can be changed one field at a time. */
export type SettingsPatch = Partial<Omit<Settings, "zones" | "shop" | "storm">> & {
  zones?: Partial<ZoneSettings>;
  storm?: Partial<StormSettings>;
  shop?: Partial<Omit<ShopSettings, "items">> & { items?: Partial<Record<ItemId, Partial<ShopItemSettings>>> };
};

export interface PlayerPublic {
  id: string;
  name: string;
  isBot: boolean;
  isHost: boolean;
  connected: boolean;
  role: Role | null;
  /** Volunteer-mode choice, shown in the lobby. */
  volunteer: Role | null;
  status: PlayerStatus;
  /** Was a hider this game and got caught (hidden in Night Time). */
  tagged: boolean;
  /** Location hasn't updated for a while (only shown when the stale penalty is on). */
  stale: boolean;
  /** Out of bounds past the grace period with the "reveal" penalty. */
  revealed: boolean;
}

export interface Marker {
  /** Stable id for drawing the pin. Not the player id when the pin is anonymous. */
  key: string;
  /** Null when anonymous mode hides who this is. */
  playerId: string | null;
  role: Role | null;
  lat: number;
  lng: number;
  /**
   * live: current position. ping: snapshot from the last ping.
   * fuzzy: a circle the player is somewhere inside. lastKnown: stale player's last position.
   * flag: a teammate's quick ping ("Spotted one!").
   */
  kind: "live" | "ping" | "fuzzy" | "lastKnown" | "flag";
  /** Meters; fuzzy only. */
  radius?: number;
  /** flag only: what the quick ping says. */
  label?: string;
  /** Server time (ms) the position was recorded. */
  at: number;
}

export interface ZoneView {
  id: string;
  lat: number;
  lng: number;
  radius: number;
  spawnedAt: number;
  endsAt: number;
  /** A hider just walked in (zone ping effect "alert"). */
  alert: boolean;
  /** Zone scan power-up: whether hiders are inside. Null when you can't tell. */
  occupied: boolean | null;
}

export interface ActiveEffect {
  item: ItemId;
  /** Null for one-shot effects waiting for the next ping. */
  until: number | null;
}

export interface MeView {
  id: string;
  role: Role | null;
  status: PlayerStatus;
  /** Set while out of bounds. penaltyAt is when the penalty kicks in (null = warning only). */
  oob: { since: number; penaltyAt: number | null } | null;
  /** Hiders in QR mode: the code a seeker scans to tag you. */
  tagCode: string | null;
  /** When tagCode changes next (server time). */
  tagCodeRefreshAt: number | null;
  /** A seeker is close (hider "nearby alert" setting or the proximity alarm item). */
  proximityAlert: boolean;
  /** Seekers: bot hiders close enough to tag. */
  taggableBots: string[];
  coins: number;
  /** Power-ups bought this game. */
  uses: Partial<Record<ItemId, number>>;
  effects: ActiveEffect[];
  /** Seekers: your map is blacked out until then. */
  blackoutUntil: number | null;
  /** The safe zone you're standing in. */
  zoneId: string | null;
  channel: Channel;
}

export interface PlayerStats {
  id: string;
  name: string;
  isBot: boolean;
  startRole: Role | null;
  finalRole: Role | null;
  tags: number;
  /** Hiders: time survived during the hunt. */
  survivalMs: number | null;
  wasTagged: boolean;
  distanceM: number;
  coinsEarned: number;
  itemsUsed: number;
}

export interface Award {
  title: string;
  playerId: string;
  detail: string;
}

export interface Results {
  winner: "hiders" | "seekers" | "none";
  reason: "time" | "allTagged" | "host";
  durationMs: number;
  stats: PlayerStats[];
  awards: Award[];
  /** Movement recap: everyone's path as flat [eastMeters, northMeters, seconds, ...] from `origin`. */
  recap: { origin: LatLng; tracks: Record<string, number[]>; tags: { t: number; x: number; y: number; playerId: string; byId: string | null }[] } | null;
}

export interface ChatMessage {
  id: string;
  channel: Channel;
  fromId: string;
  name: string;
  text: string;
  at: number;
  /** Sent with a quick-ping button (and dropped a flag on the map). */
  quick: boolean;
}

export interface RoomView {
  code: string;
  phase: Phase;
  settings: Settings;
  hostId: string | null;
  players: PlayerPublic[];
  me: MeView;
  markers: Marker[];
  zones: ZoneView[];
  /** The play area right now (smaller than settings.boundary while the storm shrinks it). */
  boundaryNow: Boundary | null;
  /** Where the storm ends up. */
  stormTarget: Boundary | null;
  /** When the storm starts shrinking. */
  stormStartsAt: number | null;
  /** Null when it's a secret (Night Time). */
  hidersLeft: number | null;
  /** End of the head start or the hunt. */
  phaseEndsAt: number | null;
  /** When hider locations are next sent to seekers. */
  nextPingAt: number | null;
  /** hiderView "pinged": when seeker locations are next sent to hiders. */
  nextSeekerPingAt: number | null;
  results: Results | null;
}

export type ClientMessage =
  | { type: "join"; name: string; token?: string }
  | { type: "location"; lat: number; lng: number; accuracy: number }
  | { type: "updateSettings"; patch: SettingsPatch }
  | { type: "setRole"; playerId: string; role: Role | null }
  | { type: "volunteer"; role: Role | null }
  | { type: "kick"; playerId: string }
  | { type: "transferHost"; playerId: string }
  | { type: "addBots"; count: number }
  | { type: "removeBots" }
  | { type: "start" }
  | { type: "tagSelf"; byId: string | null }
  | { type: "tagCode"; code: string }
  | { type: "tagBot"; botId: string }
  | { type: "buy"; item: ItemId; targetId?: string }
  | { type: "chat"; text: string; quick?: boolean }
  | { type: "endGame" }
  | { type: "playAgain" }
  | { type: "leave" };

export type GameEvent =
  | { kind: "ping" } // hider locations were sent to seekers
  | { kind: "seekerPing" } // seeker locations were sent to hiders
  | { kind: "tagged"; playerId: string; byId: string | null; reason: "tag" | "oob" }
  | { kind: "revived"; playerId: string }
  | { kind: "phase"; phase: Phase }
  | { kind: "info"; text: string }
  | { kind: "chat"; msg: ChatMessage }
  | { kind: "zone"; what: "spawn" | "alert" }
  | { kind: "item"; item: ItemId; mine: boolean }
  | { kind: "storm" };

export type ServerMessage =
  | { type: "welcome"; playerId: string; token: string }
  | { type: "state"; now: number; view: RoomView }
  | { type: "chatHistory"; messages: ChatMessage[] }
  | { type: "event"; event: GameEvent }
  | { type: "error"; message: string; fatal?: boolean };
