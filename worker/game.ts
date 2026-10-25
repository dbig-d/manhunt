// All game rules live here, as plain code with no Cloudflare-specific parts,
// so they can be unit tested. The GameRoom Durable Object (room.ts) feeds it
// player messages and clock ticks, then sends each phone its own view.

import type {
  Award,
  GameEvent,
  LatLng,
  Marker,
  Phase,
  PlayerPublic,
  PlayerStats,
  PlayerStatus,
  Results,
  Role,
  RoomView,
  Settings,
} from "../shared/protocol";
import {
  BOT_AUTO_TAG_M,
  BOT_TAG_RANGE_M,
  DEFAULT_SETTINGS,
  FUZZY_RADIUS_M,
  MAX_PLAYERS,
  PROXIMITY_ALERT_M,
  SPEED_UP_WINDOW_MS,
  STALE_AFTER_MS,
  applySettingsPatch,
} from "../shared/settings";
import { bearing, distance, insideBoundary, offset, randomPointInBoundary } from "../shared/geo";

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
  /** Last snapshot sent to seekers. fuzzCenter is set in fuzzy mode. */
  ping: { pos: LatLng; at: number; fuzzCenter: LatLng | null } | null;
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
  bot: { heading: number; speed: number; pauseUntil: number } | null;
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
}

/** Who an event goes to: everyone, one team, or one player id. */
export type Recipient = "all" | "seekers" | "hiders" | { playerId: string };
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

export class Game {
  outbox: Outbox = [];

  constructor(
    public state: GameState,
    private rand: () => number = Math.random,
    private makeId: () => string = () => crypto.randomUUID(),
  ) {
    // Rooms saved by an older version may be missing newer fields.
    const legacy = state.settings as Settings & { teammates?: "seekers" | "both" | "none" };
    state.settings = { ...DEFAULT_SETTINGS, ...state.settings };
    if (legacy.teammates) {
      state.settings.seekersSeeSeekers = legacy.teammates !== "none";
      state.settings.hidersSeeHiders = legacy.teammates === "both" ? "live" : "none";
      delete (state.settings as { teammates?: unknown }).teammates;
    }
    for (const p of state.players) p.alias ??= this.makeId();
  }

  static create(code: string, now: number, rand?: () => number, makeId?: () => string): Game {
    return new Game(
      {
        code,
        createdAt: now,
        phase: "lobby",
        settings: { ...DEFAULT_SETTINGS },
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

  pingIntervalMs(now: number) {
    const s = this.state.settings;
    const base = s.pingIntervalSec * 1000;
    const endsAt = this.state.phaseEndsAt;
    if (s.pingSpeedUp && this.state.phase === "hunt" && endsAt !== null && endsAt - now <= SPEED_UP_WINDOW_MS) {
      return Math.max(15_000, base / 2);
    }
    return base;
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
      bot: isBot ? { heading: this.rand() * 360, speed: 1.5, pauseUntil: 0 } : null,
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
    } else {
      p.connected = false;
      if (p.status === "alive" && p.role === "hider") {
        p.status = "out";
        p.taggedAt = now;
        this.emit("all", { kind: "info", text: `${p.name} left the game` });
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
  }

  updateSettings(id: string, patch: Partial<Settings>) {
    this.requireHost(id);
    this.requirePhase("lobby");
    this.state.settings = applySettingsPatch(this.state.settings, patch);
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
      if (p.isBot) {
        if (p.role === "seeker") p.pos = offset(b.center, this.rand() * 15, this.rand() * 360);
        else if (!p.pos || !insideBoundary(b, p.pos)) p.pos = randomPointInBoundary(b, 10, this.rand);
        p.posAt = now;
        p.bot = { heading: this.rand() * 360, speed: 1.5, pauseUntil: 0 };
      }
    }

    this.state.results = null;
    this.state.huntStartedAt = null;
    this.state.nextPingAt = null;
    this.state.nextSeekerPingAt = null;
    this.state.nextTagCodeAt = null;
    this.state.lastTickAt = now;
    this.state.phase = "headstart";
    this.state.phaseEndsAt = now + s.headStartSec * 1000;
    this.emit("all", { kind: "phase", phase: "headstart" });
    if (s.headStartSec === 0) this.beginHunt(now);
  }

  private beginHunt(now: number) {
    const s = this.state.settings;
    this.state.phase = "hunt";
    this.state.huntStartedAt = now;
    this.state.phaseEndsAt = now + s.gameLengthMin * 60_000;
    this.emit("all", { kind: "phase", phase: "hunt" });
    this.doPing(now);
    this.state.nextPingAt = now + this.pingIntervalMs(now);
    if (s.hiderView === "pinged") {
      this.doSeekerPing(now);
      this.state.nextSeekerPingAt = now + s.hiderViewIntervalSec * 1000;
    }
    if (s.tagMode === "qr") this.rotateTagCodes(now);
  }

  private doPing(now: number) {
    const fuzzy = this.state.settings.pingStyle === "fuzzy";
    for (const p of this.aliveHiders()) {
      if (!p.pos) continue;
      p.ping = {
        pos: p.pos,
        at: p.posAt ?? now,
        // The real position is somewhere inside the circle, not at its center.
        fuzzCenter: fuzzy ? offset(p.pos, this.rand() * FUZZY_RADIUS_M * 0.7, this.rand() * 360) : null,
      };
    }
    this.emit("all", { kind: "ping" });
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
    for (const p of this.aliveHiders()) {
      let code: string;
      do code = String(Math.floor(this.rand() * 10_000)).padStart(4, "0");
      while (used.has(code));
      used.add(code);
      p.tagCode = code;
    }
    this.state.nextTagCodeAt = now + TAG_CODE_ROTATE_MS;
  }

  // ---------- the clock ----------

  tick(now: number) {
    if (!this.active) return;
    const s = this.state.settings;
    const dt = this.state.lastTickAt === null ? 1 : Math.min(5, Math.max(0, (now - this.state.lastTickAt) / 1000));
    this.state.lastTickAt = now;

    this.moveBots(dt, now);

    if (this.state.phase === "headstart" && this.state.phaseEndsAt !== null && now >= this.state.phaseEndsAt) {
      this.beginHunt(now);
    }

    if (this.state.phase === "hunt") {
      if (this.state.nextPingAt !== null && now >= this.state.nextPingAt) {
        this.doPing(now);
        this.state.nextPingAt = now + this.pingIntervalMs(now);
      }
      if (s.hiderView === "pinged" && this.state.nextSeekerPingAt !== null && now >= this.state.nextSeekerPingAt) {
        this.doSeekerPing(now);
        this.state.nextSeekerPingAt = now + s.hiderViewIntervalSec * 1000;
      }
      if (s.tagMode === "qr" && this.state.nextTagCodeAt !== null && now >= this.state.nextTagCodeAt) {
        this.rotateTagCodes(now);
      }
    }

    this.checkBounds(now);
    if (this.state.phase === "hunt") this.botTags(now);

    if (this.state.phase === "hunt" && this.state.phaseEndsAt !== null && now >= this.state.phaseEndsAt) {
      this.finish("time", now);
    }
  }

  private checkBounds(now: number) {
    const s = this.state.settings;
    const b = s.boundary;
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
    const b = this.state.settings.boundary;
    if (!b || dt <= 0) return;
    for (const p of this.state.players) {
      if (!p.isBot || !p.bot || !p.pos || p.status !== "alive" || !p.role) continue;
      const brain = p.bot;
      p.posAt = now; // a bot standing still still knows where it is

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
        if (brain.pauseUntil > now) continue;
        if (this.rand() < 0.03 * dt) {
          brain.pauseUntil = now + (5 + this.rand() * 20) * 1000; // stop and "hide" for a bit
          continue;
        }
        brain.heading += (this.rand() - 0.5) * 50 * dt;
        brain.speed = 1.2 + this.rand() * 1.3;
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
        if (!h.pos || h.posAt === null || now - h.posAt > STALE_AFTER_MS) continue;
        if (distance(seeker.pos, h.pos) <= BOT_AUTO_TAG_M) this.tag(h, seeker.id, "tag", now);
        if (this.state.phase !== "hunt") return;
      }
    }
  }

  // ---------- tagging ----------

  private tag(hider: PlayerState, byId: string | null, reason: "tag" | "oob", now: number) {
    if (hider.status !== "alive" || hider.role !== "hider") return;
    hider.taggedAt = now;
    hider.taggedBy = byId;
    hider.ping = null;
    hider.oobSince = null;
    hider.revealed = false;
    hider.tagCode = null;
    hider.prevTagCode = null;
    if (this.state.settings.mode === "infection") hider.role = "seeker";
    else hider.status = "out";
    const by = byId ? this.player(byId) : undefined;
    if (by) by.tags++;
    this.emit("all", { kind: "tagged", playerId: hider.id, byId: by?.id ?? null, reason });
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

  // ---------- ending ----------

  endGame(id: string, now: number) {
    this.requireHost(id);
    this.requirePhase("headstart", "hunt");
    this.finish("host", now);
  }

  private finish(reason: Results["reason"], now: number) {
    const st = this.state;
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
    const topTagger = stats.reduce<PlayerStats | null>((a, b) => (b.tags > (a?.tags ?? 0) ? b : a), null);
    if (topTagger) awards.push({ title: "Top tagger", playerId: topTagger.id, detail: `${topTagger.tags} tag${topTagger.tags === 1 ? "" : "s"}` });
    const runner = stats.reduce<PlayerStats | null>((a, b) => (b.distanceM > (a?.distanceM ?? 0) ? b : a), null);
    if (runner) awards.push({ title: "Marathon", playerId: runner.id, detail: `${runner.distanceM} m covered` });

    st.results = { winner, reason, durationMs: huntStart === null ? 0 : now - huntStart, stats, awards };
    st.phase = "results";
    st.phaseEndsAt = null;
    st.nextPingAt = null;
    st.nextSeekerPingAt = null;
    st.nextTagCodeAt = null;
    for (const p of st.players) {
      p.oobSince = null;
      p.revealed = false;
      p.tagCode = null;
    }
    this.emit("all", { kind: "phase", phase: "results" });
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
    }
    st.phase = "lobby";
    st.results = null;
    st.huntStartedAt = null;
    if (!this.player(st.hostId ?? "")) this.handOverHost();
    this.emit("all", { kind: "phase", phase: "lobby" });
  }

  // ---------- what each phone gets to see ----------

  view(viewerId: string, now: number): RoomView {
    const st = this.state;
    const s = st.settings;
    const me = this.mustPlayer(viewerId);
    const spectating = !this.active || me.status === "out" || me.role === null;

    const players: PlayerPublic[] = st.players.map((p) => ({
      id: p.id,
      name: p.name,
      isBot: p.isBot,
      isHost: p.id === st.hostId,
      connected: p.isBot || p.connected,
      role: p.role,
      volunteer: p.volunteer,
      status: p.status,
      stale: s.stalePenalty !== "off" && this.isStale(p, now),
      revealed: p.revealed,
    }));

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
        } else if (s.hidersSeeHiders === "pings" && st.phase === "hunt" && p.ping) {
          markers.push({ ...who, lat: p.ping.pos.lat, lng: p.ping.pos.lng, kind: "ping", at: p.ping.at });
        }
      } else if (me.role === "seeker") {
        if (st.phase === "hunt" && p.ping) {
          const c = p.ping.fuzzCenter;
          markers.push(
            c
              ? { ...who, lat: c.lat, lng: c.lng, kind: "fuzzy", radius: FUZZY_RADIUS_M, at: p.ping.at }
              : { ...who, lat: p.ping.pos.lat, lng: p.ping.pos.lng, kind: "ping", at: p.ping.at },
          );
        }
      } else if (s.hiderView === "pinged" && p.seekerPing) {
        markers.push({ ...who, lat: p.seekerPing.pos.lat, lng: p.seekerPing.pos.lng, kind: "ping", at: p.seekerPing.at });
      }
    }

    const aliveHider = me.role === "hider" && me.status === "alive";
    const aliveSeeker = me.role === "seeker" && me.status === "alive";
    const hunting = st.phase === "hunt";
    const seekersNearby =
      hunting &&
      aliveHider &&
      s.hiderView === "proximity" &&
      !!me.pos &&
      st.players.some((p) => p.role === "seeker" && p.status === "alive" && p.pos && distance(p.pos, me.pos!) <= PROXIMITY_ALERT_M);

    return {
      code: st.code,
      phase: st.phase,
      now,
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
        proximityAlert: seekersNearby,
        taggableBots:
          hunting && aliveSeeker && me.pos
            ? st.players
                .filter((p) => p.isBot && p.role === "hider" && p.status === "alive" && p.pos && distance(p.pos, me.pos!) <= BOT_TAG_RANGE_M)
                .map((p) => p.id)
            : [],
      },
      markers,
      phaseEndsAt: st.phaseEndsAt,
      nextPingAt: hunting ? st.nextPingAt : st.phase === "headstart" ? st.phaseEndsAt : null,
      nextSeekerPingAt:
        s.hiderView !== "pinged" ? null : hunting ? st.nextSeekerPingAt : st.phase === "headstart" ? st.phaseEndsAt : null,
      results: st.results,
    };
  }
}

export function formatDuration(ms: number) {
  const total = Math.round(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return m ? `${m}m ${s}s` : `${s}s`;
}
