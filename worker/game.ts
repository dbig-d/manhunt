// All game rules live here, as plain code with no Cloudflare-specific parts,
// so they can be unit tested. The GameRoom Durable Object (room.ts) feeds it
// player messages and clock ticks, then sends each phone its own view.

import type {
  ActiveEffect,
  Award,
  Boundary,
  Channel,
  ChatMessage,
  GameEvent,
  ItemId,
  LatLng,
  Marker,
  Phase,
  PlayerPublic,
  PlayerStats,
  PlayerStatus,
  Recap,
  RecapEvent,
  Results,
  Role,
  RoomView,
  SettingsPatch,
  Settings,
  ZoneView,
} from "../shared/protocol";
import {
  ALARM_RADIUS_M,
  BOT_AUTO_TAG_M,
  BOT_TAG_RANGE_M,
  DEFAULT_SETTINGS,
  FUZZY_RADIUS_M,
  MAX_PLAYERS,
  PROXIMITY_ALERT_M,
  SPEED_UP_WINDOW_MS,
  STALE_AFTER_MS,
  STATIC_RADIUS_M,
  STORM_END_FRACTION,
  applySettingsPatch,
  normalizeSettings,
} from "../shared/settings";
import { ITEM_BY_ID } from "../shared/items";
import { MODE_BY_ID } from "../shared/modes";
import { bearing, distance, insideBoundary, offset, randomPointInBoundary, scaleBoundary, toLocal } from "../shared/geo";
import { stormBoundary, stormProgress } from "../shared/storm";

/** Omit that works across each member of a union (plain Omit merges them). */
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

/** Power-up effects on a player. Timestamps are when they wear off (0 = not active). */
interface Fx {
  ghost: boolean;
  jam: boolean;
  decoy: boolean;
  staticUntil: number;
  alarmUntil: number;
  radarUntil: number;
  scanUntil: number;
  trackerUntil: number;
  trackerTarget: string | null;
}
const noFx = (): Fx => ({
  ghost: false,
  jam: false,
  decoy: false,
  staticUntil: 0,
  alarmUntil: 0,
  radarUntil: 0,
  scanUntil: 0,
  trackerUntil: 0,
  trackerTarget: null,
});

export interface PlayerState {
  id: string;
  token: string;
  /** Random id shown instead of the real one on anonymous pins; new every game. */
  alias: string;
  name: string;
  isBot: boolean;
  connected: boolean;
  lastSeenAt: number;
  role: Role | null;
  startRole: Role | null;
  volunteer: Role | null;
  status: PlayerStatus;
  pos: LatLng | null;
  posAt: number | null;
  /** Last snapshot sent to seekers. fuzzCenter/radius are set when it's a blurry circle. */
  ping: { pos: LatLng; at: number; fuzzCenter: LatLng | null; radius: number } | null;
  /** Last snapshot sent to hiders (hiderView "pinged"). */
  seekerPing: { pos: LatLng; at: number } | null;
  oobSince: number | null;
  revealed: boolean;
  tagCode: string | null;
  prevTagCode: string | null;
  tags: number;
  distanceM: number;
  taggedAt: number | null;
  taggedBy: string | null;
  coins: number;
  coinsEarned: number;
  uses: Partial<Record<ItemId, number>>;
  fx: Fx;
  /** Recent positions as [lat, lng, time], for the jammer. */
  history: number[][];
  /** Safe zone currently stood in. */
  zoneId: string | null;
  lastChatAt: number;
  bot: { heading: number; speed: number; pauseUntil: number; zoneId: string | null } | null;
}

interface Zone {
  id: string;
  center: LatLng;
  radius: number;
  spawnedAt: number;
  endsAt: number;
  alertUntil: number;
}

/** A quick ping dropped on the map for teammates. */
interface Flag {
  id: string;
  channel: Channel;
  byId: string;
  pos: LatLng;
  text: string;
  until: number;
}

/** What's being recorded during a game, for the replay. Times are ms; positions are recorded as meters. */
interface Recording {
  startedAt: number;
  lastSampleAt: number | null;
  tracks: Record<string, number[]>;
  events: RecapEvent[];
  zones: Recap["zones"];
}

export interface GameState {
  code: string;
  createdAt: number;
  phase: Phase;
  settings: Settings;
  hostId: string | null;
  players: PlayerState[];
  phaseEndsAt: number | null;
  huntStartedAt: number | null;
  nextPingAt: number | null;
  nextSeekerPingAt: number | null;
  nextTagCodeAt: number | null;
  lastTickAt: number | null;
  results: Results | null;
  botCounter: number;
  /** For short unique ids (zones, chat messages, flags). */
  counter: number;
  zones: Zone[];
  nextZoneAt: number | null;
  blackoutUntil: number;
  /** Where the storm ends up, picked when the hunt starts. */
  stormCenter: LatLng | null;
  stormAnnounced: boolean;
  chat: ChatMessage[];
  flags: Flag[];
  /** The match being recorded right now (head start and hunt). */
  recording: Recording | null;
  /** The finished match's replay, kept for the results screen only. */
  recap: Recap | null;
}

/**
 * Who an event goes to: everyone, one team, one player, one chat channel, or a list
 * of players (plus, optionally, everyone in a channel).
 */
export type Recipient =
  | "all"
  | { team: Role }
  | { playerId: string }
  | { channel: Channel }
  | { ids: string[]; alsoChannel?: Channel };
export type Outbox = { to: Recipient; event: GameEvent }[];

/** A rule was broken (e.g. a non-host tried to start). Shown to that player only. */
export class GameError extends Error {}

const BOT_NAMES = ["Alpha", "Bravo", "Charlie", "Delta", "Echo", "Foxtrot", "Golf", "Hotel", "India", "Juliet", "Kilo", "Lima", "Mike", "November", "Oscar", "Papa", "Quebec", "Romeo", "Sierra", "Tango"];
const TAG_CODE_ROTATE_MS = 20_000;
/** Ignore GPS jitter smaller than this when adding up distance run. */
const MIN_MOVE_M = 3;
const MAX_RUN_SPEED_MS = 10;
const HOST_HANDOVER_MS = 20_000;
const LOBBY_DROP_MS = 120_000;
const HISTORY_STEP_MS = 2_000;
const HISTORY_KEEP_MS = 45_000;
const JAM_DELAY_MS = 30_000;
/** Replay positions are sampled this often... */
const TRACK_EVERY_MS = 5_000;
/** ...and thinned out past this many points per player, to keep the saved room small. */
const TRACK_MAX_POINTS = 240;
const RECAP_MAX_EVENTS = 3_000;
/** Nobody's looking at the results any more: delete the replay after this long. */
const RECAP_ABANDONED_MS = 60_000;
const CHAT_KEEP = 150;
const CHAT_MAX_LEN = 200;
const CHAT_COOLDOWN_MS = 500;
const FLAG_MS = 45_000;
const ZONE_ALERT_MS = 8_000;
const FIRST_ZONE_DELAY_MS = 30_000;

export class Game {
  outbox: Outbox = [];

  constructor(
    public state: GameState,
    private rand: () => number = Math.random,
    private makeId: () => string = () => crypto.randomUUID(),
  ) {
    Game.normalize(state, makeId);
  }

  /** Rooms saved by an older version may be missing newer fields. */
  private static normalize(st: GameState, makeId: () => string) {
    st.settings = normalizeSettings(st.settings);
    st.counter ??= 0;
    st.zones ??= [];
    st.nextZoneAt ??= null;
    st.blackoutUntil ??= 0;
    st.stormCenter ??= null;
    st.stormAnnounced ??= false;
    st.chat ??= [];
    st.flags ??= [];
    st.recording ??= null;
    st.recap ??= null;
    // Replay data from older versions is in a different shape; just drop it.
    const old = st as GameState & { tracks?: unknown; lastTrackAt?: unknown; recapTags?: unknown };
    delete old.tracks;
    delete old.lastTrackAt;
    delete old.recapTags;
    if (st.results) delete (st.results as Results & { recap?: unknown }).recap;
    for (const p of st.players) {
      p.alias ??= makeId();
      p.coins ??= 0;
      p.coinsEarned ??= 0;
      p.uses ??= {};
      p.fx = { ...noFx(), ...(p.fx ?? {}) };
      p.history ??= [];
      p.zoneId ??= null;
      p.lastChatAt ??= 0;
      if (p.ping) p.ping.radius ??= p.ping.fuzzCenter ? FUZZY_RADIUS_M : 0;
      if (p.bot) p.bot.zoneId ??= null;
    }
  }

  static create(code: string, now: number, rand?: () => number, makeId?: () => string): Game {
    return new Game(
      {
        code,
        createdAt: now,
        phase: "lobby",
        settings: structuredClone(DEFAULT_SETTINGS),
        hostId: null,
        players: [],
        phaseEndsAt: null,
        huntStartedAt: null,
        nextPingAt: null,
        nextSeekerPingAt: null,
        nextTagCodeAt: null,
        lastTickAt: null,
        results: null,
        botCounter: 0,
        counter: 0,
        zones: [],
        nextZoneAt: null,
        blackoutUntil: 0,
        stormCenter: null,
        stormAnnounced: false,
        chat: [],
        flags: [],
        recording: null,
        recap: null,
      },
      rand,
      makeId,
    );
  }

  // ---------- helpers ----------

  get active() {
    return this.state.phase === "headstart" || this.state.phase === "hunt";
  }

  player(id: string): PlayerState | undefined {
    return this.state.players.find((p) => p.id === id);
  }

  private mustPlayer(id: string): PlayerState {
    const p = this.player(id);
    if (!p) throw new GameError("You're not in this room");
    return p;
  }

  private requireHost(id: string) {
    if (this.state.hostId !== id) throw new GameError("Only the host can do that");
  }

  private requirePhase(...phases: Phase[]) {
    if (!phases.includes(this.state.phase)) throw new GameError("You can't do that right now");
  }

  private emit(to: Recipient, event: GameEvent) {
    this.outbox.push({ to, event });
  }

  private nextId(prefix: string) {
    return `${prefix}${++this.state.counter}`;
  }

  private aliveHiders() {
    return this.state.players.filter((p) => p.role === "hider" && p.status === "alive");
  }

  private uniqueName(raw: string, exceptId?: string) {
    const base = raw.trim().replace(/\s+/g, " ").slice(0, 16) || "Player";
    const taken = new Set(this.state.players.filter((p) => p.id !== exceptId).map((p) => p.name.toLowerCase()));
    if (!taken.has(base.toLowerCase())) return base;
    for (let i = 2; ; i++) if (!taken.has(`${base} ${i}`.toLowerCase())) return `${base} ${i}`;
  }

  private isStale(p: PlayerState, now: number) {
    return (
      this.active &&
      !p.isBot &&
      p.status === "alive" &&
      p.role !== null &&
      (p.posAt === null || now - p.posAt > STALE_AFTER_MS)
    );
  }

  private fresh(p: PlayerState, now: number) {
    return !!p.pos && p.posAt !== null && now - p.posAt <= STALE_AFTER_MS;
  }

  /** Which chat a player is in right now. */
  channelOf(p: PlayerState): Channel {
    if (!this.active) return "all";
    if (p.status === "out" || !p.role) return "out";
    return p.role === "seeker" ? "seekers" : "hiders";
  }

  /** Does an event addressed to `to` reach this player? */
  reaches(to: Recipient, playerId: string): boolean {
    if (to === "all") return true;
    const p = this.player(playerId);
    if (!p) return false;
    if ("team" in to) return p.role === to.team;
    if ("playerId" in to) return to.playerId === playerId;
    if ("channel" in to) return this.channelOf(p) === to.channel;
    return to.ids.includes(playerId) || (!!to.alsoChannel && this.channelOf(p) === to.alsoChannel);
  }

  pingIntervalMs(now: number) {
    const s = this.state.settings;
    const base = s.pingIntervalSec * 1000;
    const endsAt = this.state.phaseEndsAt;
    if (s.pingSpeedUp && this.state.phase === "hunt" && endsAt !== null && endsAt - now <= SPEED_UP_WINDOW_MS) {
      return Math.max(15_000, base / 2);
    }
    return base;
  }

  private stormWindow() {
    const st = this.state;
    if (!st.settings.storm.enabled || st.huntStartedAt === null || st.phaseEndsAt === null) return null;
    const len = st.phaseEndsAt - st.huntStartedAt;
    return { start: st.huntStartedAt + (len * st.settings.storm.startPct) / 100, end: st.huntStartedAt + len * STORM_END_FRACTION };
  }

  /** The play area right now: the storm shrinks it and slides it toward stormCenter. */
  boundaryAt(now: number): Boundary | null {
    const st = this.state;
    const b = st.settings.boundary;
    const w = this.stormWindow();
    if (!b || !w || st.phase !== "hunt" || !st.stormCenter) return b;
    return stormBoundary(b, st.stormCenter, st.settings.storm.finalPct, stormProgress(now, w.start, w.end));
  }

  // ---------- recording the match for the replay ----------

  /** Seconds since the game started, as the replay counts time. */
  private recT(now: number) {
    const r = this.state.recording;
    return r ? Math.round((now - r.startedAt) / 100) / 10 : 0;
  }

  /** Meters east/north of the play area's center, rounded to 1 m. */
  private local(p: LatLng): [number, number] {
    const { x, y } = toLocal(this.state.settings.boundary?.center ?? p, p);
    return [Math.round(x), Math.round(y)];
  }

  /** Note something that happened, for the replay. */
  private record(now: number, event: DistributiveOmit<RecapEvent, "t">) {
    const r = this.state.recording;
    if (!r || r.events.length >= RECAP_MAX_EVENTS) return;
    r.events.push({ t: this.recT(now), ...event } as RecapEvent);
  }

  /** Add one position to a player's replay track (thinning out old points if it gets long). */
  private samplePlayer(p: PlayerState, now: number) {
    const r = this.state.recording;
    if (!r || !p.pos) return;
    const t = this.recT(now);
    const track = (r.tracks[p.id] ??= []);
    if (track.length && track[track.length - 1] >= t) return;
    track.push(...this.local(p.pos), t);
    if (track.length / 3 > TRACK_MAX_POINTS) {
      // Keep every other point (and always the newest).
      const thinned: number[] = [];
      for (let i = 0; i < track.length - 3; i += 6) thinned.push(track[i], track[i + 1], track[i + 2]);
      thinned.push(...track.slice(-3));
      r.tracks[p.id] = thinned;
    }
  }

  /** Every few seconds, note where everyone still in play is. */
  private recordTracks(now: number) {
    const r = this.state.recording;
    if (!r) return;
    r.lastSampleAt = now;
    for (const p of this.state.players) if (p.startRole && p.status === "alive") this.samplePlayer(p, now);
  }

  private stormTarget(): Boundary | null {
    const st = this.state;
    if (!st.settings.boundary || !st.stormCenter || st.phase !== "hunt") return null;
    return scaleBoundary(st.settings.boundary, st.settings.storm.finalPct / 100, st.stormCenter);
  }

  // ---------- joining & lobby ----------

  join(name: string, token: string | undefined, now: number): PlayerState {
    if (token) {
      const existing = this.state.players.find((p) => !p.isBot && p.token === token);
      if (existing) {
        existing.connected = true;
        existing.lastSeenAt = now;
        if (!this.player(this.state.hostId ?? "")) this.state.hostId = existing.id;
        return existing;
      }
    }
    if (this.state.players.length >= MAX_PLAYERS) throw new GameError("This room is full");

    const p = this.newPlayer(this.uniqueName(name), false, now);
    // Joining mid-game: watch as a spectator until the next round.
    if (this.state.phase !== "lobby") p.status = "out";
    this.state.players.push(p);
    if (!this.player(this.state.hostId ?? "")) this.state.hostId = p.id;
    this.emit("all", { kind: "info", text: `${p.name} joined` });
    return p;
  }

  private newPlayer(name: string, isBot: boolean, now: number): PlayerState {
    return {
      id: this.makeId(),
      token: this.makeId(),
      alias: this.makeId(),
      name,
      isBot,
      connected: !isBot,
      lastSeenAt: now,
      role: null,
      startRole: null,
      volunteer: null,
      status: "alive",
      pos: null,
      posAt: null,
      ping: null,
      seekerPing: null,
      oobSince: null,
      revealed: false,
      tagCode: null,
      prevTagCode: null,
      tags: 0,
      distanceM: 0,
      taggedAt: null,
      taggedBy: null,
      coins: 0,
      coinsEarned: 0,
      uses: {},
      fx: noFx(),
      history: [],
      zoneId: null,
      lastChatAt: 0,
      bot: isBot ? { heading: this.rand() * 360, speed: 1.5, pauseUntil: 0, zoneId: null } : null,
    };
  }

  disconnect(id: string, now: number) {
    const p = this.player(id);
    if (!p) return;
    p.connected = false;
    p.lastSeenAt = now;
  }

  leave(id: string, now: number) {
    const p = this.player(id);
    if (!p) return;
    if (this.state.phase === "lobby" || this.state.phase === "results") {
      this.removePlayer(id);
      // Everyone's left the results: nobody will watch the replay, so delete it now.
      if (!this.state.players.some((q) => !q.isBot && q.connected)) this.state.recap = null;
    } else {
      p.connected = false;
      if (p.status === "alive") this.record(now, { kind: "left", playerId: p.id });
      if (p.status === "alive" && p.role === "hider") {
        p.status = "out";
        p.taggedAt = now;
        this.emit(this.state.settings.secretCount ? { channel: "out" } : "all", { kind: "info", text: `${p.name} left the game` });
        if (this.state.phase === "hunt" && this.aliveHiders().length === 0) this.finish("allTagged", now);
      } else {
        p.status = "out";
      }
    }
    if (this.state.hostId === id) this.handOverHost();
  }

  private removePlayer(id: string) {
    this.state.players = this.state.players.filter((p) => p.id !== id);
    if (this.state.hostId === id) this.handOverHost();
  }

  private handOverHost() {
    const next =
      this.state.players.find((p) => !p.isBot && p.connected && p.id !== this.state.hostId) ??
      this.state.players.find((p) => !p.isBot && p.id !== this.state.hostId);
    this.state.hostId = next?.id ?? null;
    if (next) this.emit("all", { kind: "info", text: `${next.name} is now the host` });
  }

  /** Slow background chores: host handover and clearing out players who left the lobby. */
  housekeeping(now: number) {
    const host = this.player(this.state.hostId ?? "");
    if (!host || (!host.connected && now - host.lastSeenAt > HOST_HANDOVER_MS)) {
      if (this.state.players.some((p) => !p.isBot && p.connected && p.id !== host?.id)) this.handOverHost();
    }
    if (this.state.phase === "lobby") {
      for (const p of [...this.state.players]) {
        if (!p.isBot && !p.connected && now - p.lastSeenAt > LOBBY_DROP_MS) this.removePlayer(p.id);
      }
    }
    // Everyone closed the results screen a while ago: delete the replay and its location history.
    if (this.state.recap) {
      const humans = this.state.players.filter((p) => !p.isBot);
      if (humans.every((p) => !p.connected && now - p.lastSeenAt > RECAP_ABANDONED_MS)) this.state.recap = null;
    }
  }

  private remember(p: PlayerState, now: number) {
    if (!this.active || !p.pos) return;
    const last = p.history[p.history.length - 1];
    if (!last || now - last[2] >= HISTORY_STEP_MS) p.history.push([p.pos.lat, p.pos.lng, now]);
    while (p.history.length && p.history[0][2] < now - HISTORY_KEEP_MS) p.history.shift();
  }

  /** Where the player was `ms` ago (or as far back as we remember). */
  private positionAgo(p: PlayerState, ms: number, now: number): { pos: LatLng; at: number } {
    let best = p.history[0];
    for (const h of p.history) if (h[2] <= now - ms) best = h;
    return best ? { pos: { lat: best[0], lng: best[1] }, at: best[2] } : { pos: p.pos!, at: p.posAt ?? now };
  }

  updateLocation(id: string, pos: LatLng, now: number) {
    const p = this.player(id);
    if (!p || p.isBot) return;
    if (!(Math.abs(pos.lat) <= 90 && Math.abs(pos.lng) <= 180)) return;
    if (p.pos && this.state.phase === "hunt" && p.status === "alive") {
      const moved = distance(p.pos, pos);
      const seconds = p.posAt === null ? Infinity : Math.max(0.5, (now - p.posAt) / 1000);
      // Faster than a sprint is a GPS jump (or a simulated teleport), not running.
      if (moved >= MIN_MOVE_M && moved / seconds <= MAX_RUN_SPEED_MS) p.distanceM += moved;
      else if (moved < MIN_MOVE_M && p.posAt !== null) {
        // Too small to count as movement; keep the old point so jitter can't add up.
        p.posAt = now;
        return;
      }
    }
    p.pos = pos;
    p.posAt = now;
    p.lastSeenAt = now;
    this.remember(p, now);
  }

  updateSettings(id: string, patch: SettingsPatch) {
    this.requireHost(id);
    this.requirePhase("lobby");
    let p = patch ?? {};
    // Picking a mode applies its preset; anything else sent along with it wins.
    const mode = p.mode ? MODE_BY_ID[p.mode] : undefined;
    if (mode) p = { ...mode.preset, ...p, storm: { ...mode.preset.storm, ...p.storm } };
    this.state.settings = applySettingsPatch(this.state.settings, p);
  }

  setRole(id: string, targetId: string, role: Role | null) {
    this.requireHost(id);
    this.requirePhase("lobby");
    this.mustPlayer(targetId).role = role;
  }

  volunteer(id: string, role: Role | null) {
    this.requirePhase("lobby");
    this.mustPlayer(id).volunteer = role;
  }

  kick(id: string, targetId: string) {
    this.requireHost(id);
    if (targetId === id) throw new GameError("You can't kick yourself");
    const target = this.mustPlayer(targetId);
    this.removePlayer(targetId);
    this.emit("all", { kind: "info", text: `${target.name} was removed` });
  }

  transferHost(id: string, targetId: string) {
    this.requireHost(id);
    const target = this.mustPlayer(targetId);
    if (target.isBot) throw new GameError("Bots can't be the host");
    this.state.hostId = targetId;
    this.emit("all", { kind: "info", text: `${target.name} is now the host` });
  }

  addBots(id: string, count: number, now: number) {
    this.requireHost(id);
    this.requirePhase("lobby");
    const n = Math.max(0, Math.min(Math.floor(count), MAX_PLAYERS - this.state.players.length, 10));
    const anchor = this.state.settings.boundary?.center ?? this.player(id)?.pos ?? null;
    for (let i = 0; i < n; i++) {
      const label = BOT_NAMES[this.state.botCounter % BOT_NAMES.length];
      const round = Math.floor(this.state.botCounter / BOT_NAMES.length);
      this.state.botCounter++;
      const bot = this.newPlayer(`Bot ${label}${round ? ` ${round + 1}` : ""}`, true, now);
      const b = this.state.settings.boundary;
      bot.pos = b ? randomPointInBoundary(b, 10, this.rand) : anchor ? offset(anchor, this.rand() * 60, this.rand() * 360) : null;
      bot.posAt = bot.pos ? now : null;
      this.state.players.push(bot);
    }
  }

  removeBots(id: string) {
    this.requireHost(id);
    this.requirePhase("lobby");
    this.state.players = this.state.players.filter((p) => !p.isBot);
  }

  // ---------- starting ----------

  start(id: string, now: number) {
    this.requireHost(id);
    this.requirePhase("lobby");
    const s = this.state.settings;
    const b = s.boundary;
    if (!b) throw new GameError("Set the play area first");
    const players = this.state.players;
    if (players.length < 2) throw new GameError("You need at least 2 players");

    if (s.roleAssignment === "random") {
      const shuffled = [...players];
      for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(this.rand() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
      }
      const seekers = Math.min(s.seekerCount, players.length - 1);
      shuffled.forEach((p, i) => (p.role = i < seekers ? "seeker" : "hider"));
    } else {
      for (const p of players) {
        const chosen = s.roleAssignment === "manual" ? p.role : p.volunteer;
        p.role = chosen ?? "hider";
      }
      if (!players.some((p) => p.role === "seeker")) {
        throw new GameError(s.roleAssignment === "manual" ? "Pick at least one seeker" : "Nobody volunteered to seek");
      }
      if (!players.some((p) => p.role === "hider")) throw new GameError("You need at least one hider");
    }

    for (const p of players) {
      p.startRole = p.role;
      p.alias = this.makeId();
      p.status = "alive";
      p.ping = null;
      p.seekerPing = null;
      p.oobSince = null;
      p.revealed = false;
      p.tagCode = null;
      p.prevTagCode = null;
      p.tags = 0;
      p.distanceM = 0;
      p.taggedAt = null;
      p.taggedBy = null;
      p.coins = 0;
      p.coinsEarned = 0;
      p.uses = {};
      p.fx = noFx();
      p.history = [];
      p.zoneId = null;
      if (p.isBot) {
        if (p.role === "seeker") p.pos = offset(b.center, this.rand() * 15, this.rand() * 360);
        else if (!p.pos || !insideBoundary(b, p.pos)) p.pos = randomPointInBoundary(b, 10, this.rand);
        p.posAt = now;
        p.bot = { heading: this.rand() * 360, speed: 1.5, pauseUntil: 0, zoneId: null };
      }
    }

    const st = this.state;
    st.results = null;
    st.huntStartedAt = null;
    st.nextPingAt = null;
    st.nextSeekerPingAt = null;
    st.nextTagCodeAt = null;
    st.lastTickAt = now;
    st.zones = [];
    st.nextZoneAt = null;
    st.blackoutUntil = 0;
    st.stormCenter = null;
    st.stormAnnounced = false;
    st.flags = [];
    // A new game: the last replay (and its location history) is deleted, and recording starts.
    st.recap = null;
    st.recording = { startedAt: now, lastSampleAt: null, tracks: {}, events: [], zones: [] };
    st.phase = "headstart";
    st.phaseEndsAt = now + s.headStartSec * 1000;
    this.emit("all", { kind: "phase", phase: "headstart" });
    this.recordTracks(now);
    if (s.headStartSec === 0) this.beginHunt(now);
  }

  private beginHunt(now: number) {
    const st = this.state;
    const s = st.settings;
    st.phase = "hunt";
    st.huntStartedAt = now;
    st.phaseEndsAt = now + s.gameLengthMin * 60_000;
    this.emit("all", { kind: "phase", phase: "hunt" });
    this.record(now, { kind: "hunt" });
    if (s.storm.enabled && s.boundary) {
      // Anywhere the final, smaller area still fits inside the original one.
      st.stormCenter = randomPointInBoundary(scaleBoundary(s.boundary, 1 - s.storm.finalPct / 100), 0, this.rand);
    }
    if (s.zones.enabled) st.nextZoneAt = now + Math.min(FIRST_ZONE_DELAY_MS, s.zones.everySec * 1000);
    this.doPing(now);
    st.nextPingAt = now + this.pingIntervalMs(now);
    if (s.hiderView === "pinged") {
      this.doSeekerPing(now);
      st.nextSeekerPingAt = now + s.hiderViewIntervalSec * 1000;
    }
    if (s.tagMode === "qr") this.rotateTagCodes(now);
  }

  private doPing(now: number) {
    const s = this.state.settings;
    for (const p of this.aliveHiders()) {
      if (!p.pos) continue;
      // Ghost: skip this ping, so seekers keep seeing the old spot.
      if (p.fx.ghost) {
        p.fx.ghost = false;
        continue;
      }
      let { pos, at } = { pos: p.pos, at: p.posAt ?? now };
      if (p.fx.jam) {
        ({ pos, at } = this.positionAgo(p, JAM_DELAY_MS, now));
        p.fx.jam = false;
      }
      if (p.fx.decoy) {
        pos = this.decoyPoint(pos, now);
        p.fx.decoy = false;
      }
      const blurry = s.pingStyle === "fuzzy" || (s.zones.pingEffect === "fuzzy" && p.zoneId !== null);
      const radius = p.fx.staticUntil > now ? STATIC_RADIUS_M : blurry ? FUZZY_RADIUS_M : 0;
      // The real position is somewhere inside the circle, not at its center.
      const fuzzCenter = radius ? offset(pos, this.rand() * radius * 0.7, this.rand() * 360) : null;
      p.ping = { pos, at, fuzzCenter, radius };
    }
    this.emit("all", { kind: "ping" });
    this.record(now, { kind: "ping" });
  }

  private decoyPoint(from: LatLng, now: number): LatLng {
    const b = this.boundaryAt(now);
    let q = from;
    for (let i = 0; i < 12; i++) {
      q = offset(from, 50 + this.rand() * 50, this.rand() * 360);
      if (!b || insideBoundary(b, q)) return q;
    }
    return q;
  }

  private doSeekerPing(now: number) {
    for (const p of this.state.players) {
      if (p.role === "seeker" && p.status === "alive" && p.pos) p.seekerPing = { pos: p.pos, at: p.posAt ?? now };
    }
    this.emit("all", { kind: "seekerPing" });
  }

  private rotateTagCodes(now: number) {
    const used = new Set<string>();
    for (const p of this.aliveHiders()) {
      p.prevTagCode = p.tagCode;
      if (p.tagCode) used.add(p.tagCode);
    }
    for (const p of this.aliveHiders()) p.tagCode = this.freshTagCode(used);
    this.state.nextTagCodeAt = now + TAG_CODE_ROTATE_MS;
  }

  private freshTagCode(used = new Set(this.aliveHiders().flatMap((h) => [h.tagCode, h.prevTagCode]).filter(Boolean) as string[])) {
    let code: string;
    do code = String(Math.floor(this.rand() * 10_000)).padStart(4, "0");
    while (used.has(code));
    used.add(code);
    return code;
  }

  // ---------- the clock ----------

  tick(now: number) {
    if (!this.active) return;
    const st = this.state;
    const s = st.settings;
    const dt = st.lastTickAt === null ? 1 : Math.min(5, Math.max(0, (now - st.lastTickAt) / 1000));
    st.lastTickAt = now;

    this.moveBots(dt, now);

    if (st.phase === "headstart" && st.phaseEndsAt !== null && now >= st.phaseEndsAt) {
      this.beginHunt(now);
    }

    if (st.phase === "hunt") {
      if (st.nextPingAt !== null && now >= st.nextPingAt) {
        this.doPing(now);
        st.nextPingAt = now + this.pingIntervalMs(now);
      }
      if (s.hiderView === "pinged" && st.nextSeekerPingAt !== null && now >= st.nextSeekerPingAt) {
        this.doSeekerPing(now);
        st.nextSeekerPingAt = now + s.hiderViewIntervalSec * 1000;
      }
      if (s.tagMode === "qr" && st.nextTagCodeAt !== null && now >= st.nextTagCodeAt) {
        this.rotateTagCodes(now);
      }
      const storm = this.stormWindow();
      if (storm && !st.stormAnnounced && now >= storm.start) {
        st.stormAnnounced = true;
        this.emit("all", { kind: "storm" });
        this.record(now, { kind: "storm" });
      }
      this.tickZones(dt, now);
    }
    st.flags = st.flags.filter((f) => f.until > now);
    // The replay records the head start too, so you can watch the hiders scatter.
    const rec = st.recording;
    if (rec && (rec.lastSampleAt === null || now - rec.lastSampleAt >= TRACK_EVERY_MS)) this.recordTracks(now);

    this.checkBounds(now);
    if (st.phase === "hunt") this.botTags(now);

    if (st.phase === "hunt" && st.phaseEndsAt !== null && now >= st.phaseEndsAt) {
      this.finish("time", now);
    }
  }

  private tickZones(dt: number, now: number) {
    const st = this.state;
    const z = st.settings.zones;
    st.zones = st.zones.filter((zone) => zone.endsAt > now);
    if (!z.enabled) return;
    const area = this.boundaryAt(now);

    if (area && st.nextZoneAt !== null && now >= st.nextZoneAt && st.zones.length < z.maxActive) {
      this.spawnZone(area, now);
      st.nextZoneAt = now + z.everySec * 1000;
    }

    const hiders = this.aliveHiders();
    for (const p of hiders) {
      const inside = this.fresh(p, now) ? st.zones.find((zone) => distance(zone.center, p.pos!) <= zone.radius) : undefined;
      if (inside && inside.id !== p.zoneId && z.pingEffect === "alert") {
        inside.alertUntil = now + ZONE_ALERT_MS;
        this.emit({ team: "seeker" }, { kind: "zone", what: "alert" });
      }
      p.zoneId = inside?.id ?? null;
    }
    // Each zone hands out a fixed rate, split between everyone inside it.
    for (const zone of st.zones) {
      const inside = hiders.filter((p) => p.zoneId === zone.id);
      if (!inside.length) continue;
      const share = ((z.coinsPerMin / 60) * dt) / inside.length;
      for (const p of inside) {
        p.coins += share;
        p.coinsEarned += share;
      }
    }
  }

  private spawnZone(area: Boundary, now: number) {
    const st = this.state;
    const radius = st.settings.zones.radiusM;
    let center = randomPointInBoundary(area, radius + 5, this.rand);
    for (let i = 0; i < 12; i++) {
      if (st.zones.every((o) => distance(o.center, center) > o.radius + radius + 10)) break;
      center = randomPointInBoundary(area, radius + 5, this.rand);
    }
    const endsAt = now + st.settings.zones.durationSec * 1000;
    st.zones.push({ id: this.nextId("z"), center, radius, spawnedAt: now, endsAt, alertUntil: 0 });
    this.emit("all", { kind: "zone", what: "spawn" });
    const [x, y] = this.local(center);
    st.recording?.zones.push({ x, y, r: radius, from: this.recT(now), to: this.recT(endsAt) });
  }

  private checkBounds(now: number) {
    const s = this.state.settings;
    const b = this.boundaryAt(now);
    if (!b) return;
    for (const p of this.state.players) {
      if (p.status !== "alive" || !p.role || !p.pos) continue;
      if (insideBoundary(b, p.pos)) {
        p.oobSince = null;
        p.revealed = false;
        continue;
      }
      p.oobSince ??= now;
      // Penalties only hit hiders, and only once the hunt is on.
      if (p.role !== "hider" || this.state.phase !== "hunt" || s.oobPenalty === "warn") continue;
      if (now - p.oobSince < s.oobGraceSec * 1000) continue;
      if (s.oobPenalty === "reveal") p.revealed = true;
      else this.tag(p, null, "oob", now);
    }
  }

  private moveBots(dt: number, now: number) {
    const b = this.boundaryAt(now);
    if (!b || dt <= 0) return;
    for (const p of this.state.players) {
      if (!p.isBot || !p.bot || !p.pos || p.status !== "alive" || !p.role) continue;
      const brain = p.bot;
      p.posAt = now; // a bot standing still still knows where it is
      this.remember(p, now);

      if (p.role === "seeker") {
        if (this.state.phase === "headstart") continue; // seekers wait for the head start to end
        const target = this.nearestPingFor(p.pos);
        if (target && distance(p.pos, target) > 8) {
          brain.heading = bearing(p.pos, target) + (this.rand() - 0.5) * 40;
        } else {
          brain.heading += (this.rand() - 0.5) * 60 * dt;
        }
        brain.speed = 2.5;
      } else {
        // Now and then a hider bot heads for a safe zone and camps there to collect coins.
        let zone = this.state.zones.find((z) => z.id === brain.zoneId);
        if (!zone) brain.zoneId = null;
        if (!zone && this.state.zones.length && this.rand() < 0.02 * dt) {
          zone = this.state.zones[Math.floor(this.rand() * this.state.zones.length)];
          brain.zoneId = zone.id;
        }
        if (zone) {
          if (distance(p.pos, zone.center) < zone.radius * 0.6) continue;
          brain.heading = bearing(p.pos, zone.center) + (this.rand() - 0.5) * 30;
          brain.speed = 2;
        } else {
          if (brain.pauseUntil > now) continue;
          if (this.rand() < 0.03 * dt) {
            brain.pauseUntil = now + (5 + this.rand() * 20) * 1000; // stop and "hide" for a bit
            continue;
          }
          brain.heading += (this.rand() - 0.5) * 50 * dt;
          brain.speed = 1.2 + this.rand() * 1.3;
        }
      }

      let next = offset(p.pos, brain.speed * dt, brain.heading);
      if (!insideBoundary(b, next)) {
        // Turn back toward the middle.
        brain.heading = bearing(p.pos, b.center) + (this.rand() - 0.5) * 60;
        next = offset(p.pos, brain.speed * dt, brain.heading);
        if (!insideBoundary(b, next) && insideBoundary(b, p.pos)) continue;
      }
      p.distanceM += distance(p.pos, next);
      p.pos = next;
      p.posAt = now;
    }
  }

  /** The closest place a seeker last saw a hider. */
  private nearestPingFor(from: LatLng): LatLng | null {
    let best: LatLng | null = null;
    let bestD = Infinity;
    for (const h of this.aliveHiders()) {
      if (!h.ping) continue;
      const at = h.ping.fuzzCenter ?? h.ping.pos;
      const d = distance(from, at);
      if (d < bestD) {
        bestD = d;
        best = at;
      }
    }
    return best;
  }

  private botTags(now: number) {
    if (!this.state.settings.botsCanTag) return;
    for (const seeker of this.state.players) {
      if (!seeker.isBot || seeker.role !== "seeker" || seeker.status !== "alive" || !seeker.pos) continue;
      for (const h of this.aliveHiders()) {
        if (!this.fresh(h, now)) continue;
        if (distance(seeker.pos, h.pos!) <= BOT_AUTO_TAG_M) this.tag(h, seeker.id, "tag", now);
        if (this.state.phase !== "hunt") return;
      }
    }
  }

  // ---------- tagging ----------

  private tag(hider: PlayerState, byId: string | null, reason: "tag" | "oob", now: number) {
    if (hider.status !== "alive" || hider.role !== "hider") return;
    const st = this.state;
    // For the replay: their exact last spot, and the moment it happened.
    this.samplePlayer(hider, now);
    if (hider.pos) {
      const [x, y] = this.local(hider.pos);
      const converted = st.settings.whenTagged === "seeker";
      this.record(now, { kind: "tag", playerId: hider.id, byId: byId && this.player(byId) ? byId : null, x, y, converted, oob: reason === "oob" });
    }
    hider.taggedAt = now;
    hider.taggedBy = byId;
    hider.ping = null;
    hider.oobSince = null;
    hider.revealed = false;
    hider.tagCode = null;
    hider.prevTagCode = null;
    hider.zoneId = null;
    if (st.settings.whenTagged === "seeker") hider.role = "seeker";
    else hider.status = "out";
    const by = byId ? this.player(byId) : undefined;
    if (by) {
      by.tags++;
      if (st.settings.shop.enabled && st.settings.shop.seekerEconomy) {
        by.coins += st.settings.shop.coinsPerTag;
        by.coinsEarned += st.settings.shop.coinsPerTag;
      }
    }
    const event: GameEvent = { kind: "tagged", playerId: hider.id, byId: by?.id ?? null, reason };
    // Night Time: only the two players involved (and spectators) hear about it.
    if (st.settings.secretCount) this.emit({ ids: [hider.id, by?.id].filter(Boolean) as string[], alsoChannel: "out" }, event);
    else this.emit("all", event);
    if (this.aliveHiders().length === 0) this.finish("allTagged", now);
  }

  tagSelf(id: string, byId: string | null, now: number) {
    this.requirePhase("hunt");
    if (this.state.settings.tagMode !== "honor") throw new GameError("This game uses QR tagging");
    const me = this.mustPlayer(id);
    if (me.role !== "hider" || me.status !== "alive") throw new GameError("You're not a hider");
    const by = byId ? this.player(byId) : undefined;
    this.tag(me, by?.role === "seeker" ? by.id : null, "tag", now);
  }

  tagWithCode(id: string, code: string, now: number) {
    this.requirePhase("hunt");
    if (this.state.settings.tagMode !== "qr") throw new GameError("This game uses honor tagging");
    const me = this.mustPlayer(id);
    if (me.role !== "seeker" || me.status !== "alive") throw new GameError("Only seekers can tag");
    const clean = code.trim();
    const target = this.aliveHiders().find((h) => clean && (h.tagCode === clean || h.prevTagCode === clean));
    if (!target) throw new GameError("Code not recognised. Ask them to show it again");
    this.tag(target, me.id, "tag", now);
  }

  tagBot(id: string, botId: string, now: number) {
    this.requirePhase("hunt");
    const me = this.mustPlayer(id);
    if (me.role !== "seeker" || me.status !== "alive") throw new GameError("Only seekers can tag");
    const bot = this.mustPlayer(botId);
    if (!bot.isBot || bot.role !== "hider" || bot.status !== "alive") throw new GameError("That bot can't be tagged");
    if (!me.pos || !bot.pos || distance(me.pos, bot.pos) > BOT_TAG_RANGE_M) throw new GameError("Get closer to tag them");
    this.tag(bot, me.id, "tag", now);
  }

  // ---------- the shop ----------

  buy(id: string, item: ItemId, targetId: string | undefined, now: number) {
    this.requirePhase("hunt");
    const shop = this.state.settings.shop;
    const info = ITEM_BY_ID[item];
    if (!info) throw new GameError("That item doesn't exist");
    if (!shop.enabled) throw new GameError("The shop is closed this game");
    const cfg = shop.items[item];
    if (!cfg.enabled) throw new GameError(`${info.name} is turned off this game`);
    if (info.team === "seeker" && !shop.seekerEconomy) throw new GameError("Seeker items are turned off this game");
    const me = this.mustPlayer(id);
    if (me.status !== "alive" || me.role !== info.team) throw new GameError(`Only ${info.team}s can use ${info.name}`);
    const used = me.uses[item] ?? 0;
    if (cfg.limit > 0 && used >= cfg.limit) throw new GameError(`You've used all your ${info.name} charges`);
    if (me.coins + 1e-9 < cfg.price) throw new GameError(`You need ${cfg.price} coins for ${info.name}`);
    this.useItem(me, item, targetId, now); // may refuse before charging
    this.record(now, { kind: "item", playerId: me.id, item });
    me.coins -= cfg.price;
    me.uses[item] = used + 1;
    this.emit({ playerId: me.id }, { kind: "item", item, mine: true });
  }

  private useItem(me: PlayerState, item: ItemId, targetId: string | undefined, now: number) {
    const fx = me.fx;
    const until = (current: number) => Math.max(now, current) + (ITEM_BY_ID[item].durationSec ?? 0) * 1000;
    const once = (active: boolean) => {
      if (active) throw new GameError("That's already waiting for your next ping");
    };
    switch (item) {
      case "jammer":
        once(fx.jam);
        fx.jam = true;
        return;
      case "ghost":
        once(fx.ghost);
        fx.ghost = true;
        return;
      case "decoy":
        once(fx.decoy);
        fx.decoy = true;
        return;
      case "static":
        fx.staticUntil = until(fx.staticUntil);
        return;
      case "alarm":
        fx.alarmUntil = until(fx.alarmUntil);
        return;
      case "radar":
        fx.radarUntil = until(fx.radarUntil);
        return;
      case "blackout":
        this.state.blackoutUntil = until(this.state.blackoutUntil);
        this.emit({ team: "seeker" }, { kind: "item", item, mine: false });
        return;
      case "revive":
        return this.revive(targetId, now);
      case "scan":
        fx.scanUntil = until(fx.scanUntil);
        return;
      case "instantPing":
        this.doPing(now);
        return;
      case "tracker": {
        let best: PlayerState | null = null;
        for (const h of this.aliveHiders()) {
          if (h.pos && me.pos && (!best || distance(me.pos, h.pos) < distance(me.pos, best.pos!))) best = h;
        }
        if (!best) throw new GameError("There's nobody to track right now");
        fx.trackerTarget = best.id;
        fx.trackerUntil = until(fx.trackerUntil);
        return;
      }
    }
  }

  private revive(targetId: string | undefined, now: number) {
    const target = targetId ? this.player(targetId) : undefined;
    if (!target || target.startRole !== "hider" || target.taggedAt === null || (target.role === "hider" && target.status === "alive")) {
      throw new GameError("Pick a caught hider to bring back");
    }
    target.status = "alive";
    target.role = "hider";
    target.taggedAt = null;
    target.taggedBy = null;
    target.ping = null;
    target.oobSince = null;
    target.revealed = false;
    target.fx = noFx();
    if (this.state.settings.tagMode === "qr") target.tagCode = this.freshTagCode();
    this.remember(target, now);
    this.record(now, { kind: "revive", playerId: target.id });
    this.samplePlayer(target, now);
    this.emit(this.state.settings.secretCount ? { ids: [target.id], alsoChannel: "hiders" } : "all", { kind: "revived", playerId: target.id });
  }

  // ---------- chat ----------

  chat(id: string, text: string, quick: boolean, now: number) {
    const me = this.mustPlayer(id);
    const clean = String(text ?? "").replace(/\s+/g, " ").trim().slice(0, CHAT_MAX_LEN);
    if (!clean) return;
    if (now - me.lastChatAt < CHAT_COOLDOWN_MS) throw new GameError("Slow down a little");
    me.lastChatAt = now;
    const channel = this.channelOf(me);
    const msg: ChatMessage = { id: this.nextId("m"), channel, fromId: me.id, name: me.name, text: clean, at: now, quick: !!quick };
    const chat = this.state.chat;
    chat.push(msg);
    if (chat.length > CHAT_KEEP) chat.splice(0, chat.length - CHAT_KEEP);
    // Quick pings also drop a flag on teammates' maps where you're standing.
    if (quick && me.pos && this.active) {
      this.state.flags.push({ id: this.nextId("f"), channel, byId: me.id, pos: me.pos, text: clean, until: now + FLAG_MS });
    }
    this.emit({ channel }, { kind: "chat", msg });
  }

  /** The messages a player can read right now (sent when they connect). */
  chatHistory(id: string): ChatMessage[] {
    const me = this.player(id);
    if (!me) return [];
    const channel = this.channelOf(me);
    return this.state.chat.filter((m) => m.channel === channel).slice(-60);
  }

  // ---------- ending ----------

  endGame(id: string, now: number) {
    this.requireHost(id);
    this.requirePhase("headstart", "hunt");
    this.finish("host", now);
  }

  private finish(reason: Results["reason"], now: number) {
    const st = this.state;
    // One last sample so everyone's dot ends exactly where they were.
    if (st.recording) for (const p of st.players) if (p.startRole && p.status === "alive") this.samplePlayer(p, now);
    const huntStart = st.huntStartedAt;
    const aliveHiders = this.aliveHiders().length;
    const winner: Results["winner"] =
      reason === "host" ? "none" : reason === "allTagged" ? "seekers" : aliveHiders > 0 ? "hiders" : "seekers";

    const stats: PlayerStats[] = st.players
      .filter((p) => p.startRole !== null)
      .map((p) => ({
        id: p.id,
        name: p.name,
        isBot: p.isBot,
        startRole: p.startRole,
        finalRole: p.role,
        tags: p.tags,
        survivalMs:
          p.startRole === "hider" ? (huntStart === null ? 0 : Math.max(0, (p.taggedAt ?? now) - huntStart)) : null,
        wasTagged: p.taggedAt !== null,
        distanceM: Math.round(p.distanceM),
        coinsEarned: Math.floor(p.coinsEarned),
        itemsUsed: Object.values(p.uses).reduce((a, b) => a + (b ?? 0), 0),
      }));

    const awards: Award[] = [];
    const hiders = stats.filter((s) => s.startRole === "hider");
    const survivors = hiders.filter((s) => !s.wasTagged);
    if (winner === "hiders") {
      for (const s of survivors) awards.push({ title: "Survivor", playerId: s.id, detail: "Never got caught" });
    } else if (hiders.length) {
      const last = hiders.reduce((a, b) => ((b.survivalMs ?? 0) > (a.survivalMs ?? 0) ? b : a));
      awards.push({ title: "Last one standing", playerId: last.id, detail: `Survived ${formatDuration(last.survivalMs ?? 0)}` });
    }
    const most = (key: "tags" | "distanceM" | "coinsEarned") =>
      stats.reduce<PlayerStats | null>((a, b) => (b[key] > (a?.[key] ?? 0) ? b : a), null);
    const topTagger = most("tags");
    if (topTagger) awards.push({ title: "Top tagger", playerId: topTagger.id, detail: `${topTagger.tags} tag${topTagger.tags === 1 ? "" : "s"}` });
    const runner = most("distanceM");
    if (runner) awards.push({ title: "Marathon", playerId: runner.id, detail: `${runner.distanceM} m covered` });
    const banker = most("coinsEarned");
    if (banker) awards.push({ title: "Moneybags", playerId: banker.id, detail: `${banker.coinsEarned} coins collected` });

    st.results = { winner, reason, durationMs: huntStart === null ? 0 : now - huntStart, stats, awards };
    st.recap = this.buildRecap(winner, now);
    st.recording = null;
    st.phase = "results";
    st.phaseEndsAt = null;
    st.nextPingAt = null;
    st.nextSeekerPingAt = null;
    st.nextTagCodeAt = null;
    st.zones = [];
    st.flags = [];
    st.blackoutUntil = 0;
    for (const p of st.players) {
      p.oobSince = null;
      p.revealed = false;
      p.tagCode = null;
      p.history = [];
      p.zoneId = null;
    }
    this.emit("all", { kind: "phase", phase: "results" });
  }

  /** Package the recording as the replay shown on the results screen. */
  private buildRecap(winner: Results["winner"], now: number): Recap | null {
    const st = this.state;
    const r = st.recording;
    const b = st.settings.boundary;
    if (!r || !b) return null;
    const durationS = this.recT(now);
    const storm = this.stormWindow();
    return {
      id: this.nextId("r"),
      origin: b.center,
      boundary: b,
      durationS,
      huntStartS: st.huntStartedAt === null ? null : this.recT(st.huntStartedAt),
      winner,
      players: st.players.filter((p) => p.startRole).map((p) => ({ id: p.id, name: p.name, isBot: p.isBot, startRole: p.startRole! })),
      tracks: r.tracks,
      events: r.events,
      zones: r.zones.map((z) => ({ ...z, to: Math.min(z.to, durationS) })),
      storm:
        storm && st.stormCenter
          ? { center: st.stormCenter, startS: this.recT(storm.start), endS: this.recT(storm.end), finalPct: st.settings.storm.finalPct }
          : null,
    };
  }

  playAgain(id: string) {
    this.requireHost(id);
    this.requirePhase("results");
    const st = this.state;
    st.players = st.players.filter((p) => p.isBot || p.connected);
    for (const p of st.players) {
      // Keep manual role picks so the host doesn't have to redo them.
      p.role = st.settings.roleAssignment === "manual" ? p.startRole : null;
      p.startRole = null;
      p.volunteer = null;
      p.status = "alive";
      p.ping = null;
      p.seekerPing = null;
      p.coins = 0;
      p.uses = {};
      p.fx = noFx();
    }
    st.phase = "lobby";
    // The replay has been shown; its location history goes with it.
    st.results = null;
    st.recap = null;
    st.huntStartedAt = null;
    st.stormCenter = null;
    if (!this.player(st.hostId ?? "")) this.handOverHost();
    this.emit("all", { kind: "phase", phase: "lobby" });
  }

  // ---------- what each phone gets to see ----------

  view(viewerId: string, now: number): RoomView {
    const st = this.state;
    const s = st.settings;
    const me = this.mustPlayer(viewerId);
    const spectating = !this.active || me.status === "out" || me.role === null;
    const hunting = st.phase === "hunt";
    const aliveHider = !spectating && me.role === "hider";
    const aliveSeeker = !spectating && me.role === "seeker";
    // Night Time: while you're still playing, you can't tell who's been caught.
    const secret = s.secretCount && this.active && !spectating;
    const blackedOut = aliveSeeker && st.blackoutUntil > now;
    const radar = aliveHider && me.fx.radarUntil > now;
    const tracking = aliveSeeker && me.fx.trackerUntil > now ? me.fx.trackerTarget : null;

    const players: PlayerPublic[] = st.players.map((p) => {
      const hiddenFate = secret && p.startRole === "hider";
      return {
        id: p.id,
        name: p.name,
        isBot: p.isBot,
        isHost: p.id === st.hostId,
        connected: p.isBot || p.connected,
        role: p.role,
        volunteer: p.volunteer,
        status: hiddenFate ? "alive" : p.status,
        tagged: !hiddenFate && p.startRole === "hider" && p.taggedAt !== null,
        stale: s.stalePenalty !== "off" && this.isStale(p, now),
        revealed: p.revealed,
      };
    });

    const markers: Marker[] = [];
    for (const p of st.players) {
      if (p.id === me.id || !p.pos) continue;
      const named = { key: p.id, playerId: p.id, role: p.role };

      if (spectating) {
        if (!this.active || p.status === "alive") {
          markers.push({ ...named, lat: p.pos.lat, lng: p.pos.lng, kind: "live", at: p.posAt ?? now });
        }
        continue;
      }
      if (p.status !== "alive" || !p.role) continue;

      const teammate = p.role === me.role;
      if (blackedOut && !teammate) continue;
      // Anonymous mode: the other team's pins carry a throwaway id instead of who they are.
      const who = !teammate && s.anonymous ? { key: p.alias, playerId: null, role: p.role } : named;
      const live: Marker = { ...who, lat: p.pos.lat, lng: p.pos.lng, kind: "live", at: p.posAt ?? now };

      if (p.revealed) {
        markers.push(live);
      } else if (s.stalePenalty === "reveal" && this.isStale(p, now)) {
        markers.push({ ...live, kind: "lastKnown" });
      } else if (teammate) {
        if (me.role === "seeker") {
          if (s.seekersSeeSeekers) markers.push(live);
        } else if (s.hidersSeeHiders === "live") {
          markers.push(live);
        } else if (s.hidersSeeHiders === "pings" && hunting && p.ping) {
          markers.push({ ...who, lat: p.ping.pos.lat, lng: p.ping.pos.lng, kind: "ping", at: p.ping.at });
        }
      } else if (me.role === "seeker") {
        if (tracking === p.id) {
          markers.push(live);
        } else if (hunting && p.ping) {
          const c = p.ping.fuzzCenter;
          markers.push(
            c
              ? { ...who, lat: c.lat, lng: c.lng, kind: "fuzzy", radius: p.ping.radius, at: p.ping.at }
              : { ...who, lat: p.ping.pos.lat, lng: p.ping.pos.lng, kind: "ping", at: p.ping.at },
          );
        }
      } else if (radar) {
        markers.push(live);
      } else if (s.hiderView === "pinged" && p.seekerPing) {
        markers.push({ ...who, lat: p.seekerPing.pos.lat, lng: p.seekerPing.pos.lng, kind: "ping", at: p.seekerPing.at });
      }
    }

    // Teammates' quick pings.
    const channel = this.channelOf(me);
    for (const f of st.flags) {
      if (f.channel !== channel || f.until <= now) continue;
      const by = this.player(f.byId);
      markers.push({ key: f.id, playerId: f.byId, role: by?.role ?? null, kind: "flag", label: f.text, lat: f.pos.lat, lng: f.pos.lng, at: f.until - FLAG_MS });
    }

    const canSeeOccupancy = spectating || (aliveSeeker && me.fx.scanUntil > now);
    const zones: ZoneView[] = st.zones
      .filter((z) => z.endsAt > now)
      .map((z) => ({
        id: z.id,
        lat: z.center.lat,
        lng: z.center.lng,
        radius: z.radius,
        spawnedAt: z.spawnedAt,
        endsAt: z.endsAt,
        alert: z.alertUntil > now,
        occupied: canSeeOccupancy ? this.aliveHiders().some((h) => h.zoneId === z.id) : null,
      }));

    const nearbySeeker = (radiusM: number) =>
      !!me.pos && st.players.some((p) => p.role === "seeker" && p.status === "alive" && p.pos && distance(p.pos, me.pos!) <= radiusM);
    const proximityAlert =
      hunting &&
      aliveHider &&
      ((s.hiderView === "proximity" && nearbySeeker(PROXIMITY_ALERT_M)) || (me.fx.alarmUntil > now && nearbySeeker(ALARM_RADIUS_M)));

    const effects: ActiveEffect[] = [];
    if (!spectating) {
      const fx = me.fx;
      if (fx.ghost) effects.push({ item: "ghost", until: null });
      if (fx.jam) effects.push({ item: "jammer", until: null });
      if (fx.decoy) effects.push({ item: "decoy", until: null });
      const timed: [ItemId, number][] = [
        ["static", fx.staticUntil],
        ["alarm", fx.alarmUntil],
        ["radar", fx.radarUntil],
        ["scan", fx.scanUntil],
        ["tracker", fx.trackerUntil],
      ];
      for (const [item, until] of timed) if (until > now) effects.push({ item, until });
    }

    const storm = this.stormWindow();

    return {
      code: st.code,
      phase: st.phase,
      settings: s,
      hostId: st.hostId,
      players,
      me: {
        id: me.id,
        role: me.role,
        status: me.status,
        oob:
          this.active && me.oobSince !== null && me.status === "alive"
            ? {
                since: me.oobSince,
                penaltyAt: me.role === "hider" && s.oobPenalty !== "warn" ? me.oobSince + s.oobGraceSec * 1000 : null,
              }
            : null,
        tagCode: hunting && aliveHider && s.tagMode === "qr" ? me.tagCode : null,
        tagCodeRefreshAt: hunting && aliveHider && s.tagMode === "qr" ? st.nextTagCodeAt : null,
        proximityAlert,
        taggableBots:
          hunting && aliveSeeker && me.pos
            ? st.players
                .filter((p) => p.isBot && p.role === "hider" && p.status === "alive" && p.pos && distance(p.pos, me.pos!) <= BOT_TAG_RANGE_M)
                .map((p) => p.id)
            : [],
        coins: Math.floor(me.coins * 10) / 10,
        uses: me.uses,
        effects,
        blackoutUntil: blackedOut ? st.blackoutUntil : null,
        zoneId: aliveHider ? me.zoneId : null,
        channel,
      },
      markers,
      zones,
      boundaryNow: this.boundaryAt(now),
      stormTarget: this.stormTarget(),
      stormStartsAt: hunting && storm ? storm.start : null,
      hidersLeft: secret ? null : this.aliveHiders().length,
      phaseEndsAt: st.phaseEndsAt,
      nextPingAt: hunting ? st.nextPingAt : st.phase === "headstart" ? st.phaseEndsAt : null,
      nextSeekerPingAt:
        s.hiderView !== "pinged" ? null : hunting ? st.nextSeekerPingAt : st.phase === "headstart" ? st.phaseEndsAt : null,
      results: st.results,
      recapId: st.recap?.id ?? null,
    };
  }
}

export function formatDuration(ms: number) {
  const total = Math.round(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return m ? `${m}m ${s}s` : `${s}s`;
}
