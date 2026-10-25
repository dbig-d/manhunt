// Messages and data shapes shared by the website (src/) and the game server (worker/).

export type Role = "seeker" | "hider";
export type Phase = "lobby" | "headstart" | "hunt" | "results";
export type GameMode = "classic" | "infection";
export type PlayerStatus = "alive" | "out";

export interface LatLng {
  lat: number;
  lng: number;
}

export type Boundary =
  | { shape: "circle"; center: LatLng; radius: number }
  // rotation: degrees clockwise from north
  | { shape: "rect"; center: LatLng; width: number; height: number; rotation: number };

export interface Settings {
  mode: GameMode;
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
  /** Who sees their own teammates live. */
  teammates: "seekers" | "both" | "none";
  boundary: Boundary | null;
  oobPenalty: "warn" | "reveal" | "eliminate";
  oobGraceSec: number;
  tagMode: "honor" | "qr";
  stalePenalty: "off" | "flag" | "reveal";
  /** Testing: seeker bots tag any hider they walk into. */
  botsCanTag: boolean;
}

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
  /** Location hasn't updated for a while (only shown when the stale penalty is on). */
  stale: boolean;
  /** Out of bounds past the grace period with the "reveal" penalty. */
  revealed: boolean;
}

export interface Marker {
  playerId: string;
  lat: number;
  lng: number;
  /**
   * live: current position. ping: snapshot from the last ping.
   * fuzzy: a circle the player is somewhere inside. lastKnown: stale player's last position.
   */
  kind: "live" | "ping" | "fuzzy" | "lastKnown";
  /** Meters; fuzzy only. */
  radius?: number;
  /** Server time (ms) the position was recorded. */
  at: number;
}

export interface MeView {
  id: string;
  role: Role | null;
  status: PlayerStatus;
  /** Set while out of bounds. penaltyAt is when the penalty kicks in (null = warning only). */
  oob: { since: number; penaltyAt: number | null } | null;
  /** Hiders in QR mode: the code a seeker scans to tag you. */
  tagCode: string | null;
  /** Hiders with the proximity setting: a seeker is close. */
  proximityAlert: boolean;
  /** Seekers: bot hiders close enough to tag. */
  taggableBots: string[];
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
}

export interface RoomView {
  code: string;
  phase: Phase;
  /** Server clock, so phones can correct their countdowns. */
  now: number;
  settings: Settings;
  hostId: string | null;
  players: PlayerPublic[];
  me: MeView;
  markers: Marker[];
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
  | { type: "updateSettings"; patch: Partial<Settings> }
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
  | { type: "endGame" }
  | { type: "playAgain" }
  | { type: "leave" };

export type GameEvent =
  | { kind: "ping" } // hider locations were sent to seekers
  | { kind: "seekerPing" } // seeker locations were sent to hiders
  | { kind: "tagged"; playerId: string; byId: string | null; reason: "tag" | "oob" }
  | { kind: "phase"; phase: Phase }
  | { kind: "info"; text: string };

export type ServerMessage =
  | { type: "welcome"; playerId: string; token: string }
  | { type: "state"; view: RoomView }
  | { type: "event"; event: GameEvent }
  | { type: "error"; message: string; fatal?: boolean };
