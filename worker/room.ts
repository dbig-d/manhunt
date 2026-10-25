import { DurableObject } from "cloudflare:workers";
import { Game, GameError, type GameState, type Recipient } from "./game";
import type { ClientMessage, ServerMessage } from "../shared/protocol";

/** What we remember about each phone connection (survives the room going to sleep). */
type Attachment = { playerId: string | null };

const ACTIVE_TICK_MS = 1000;
const LOBBY_TICK_MS = 2000;
const RESULTS_TICK_MS = 5000;
/** Rooms nobody is connected to are deleted (with all location data) after this long. */
const IDLE_DELETE_MS = 2 * 60 * 60_000;
/** Player locations are saved at most this often; everything else is saved right away. */
const SAVE_POSITIONS_MS = 5000;

/**
 * One GameRoom per room code. It holds the game, runs the clock with alarms,
 * and sends every phone its own filtered view after each change.
 */
export class GameRoom extends DurableObject<Env> {
  private game: Game | null = null;
  private lastSavedAt = 0;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      const state = await ctx.storage.get<GameState>("game");
      if (state) this.game = new Game(state);
    });
    // Phones send "ping" to keep the connection alive; answer without waking the room.
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
  }

  /** Called by the Worker when a host creates a room. False means the code is already in use. */
  async create(code: string): Promise<boolean> {
    if (this.game) return false;
    const now = Date.now();
    this.game = Game.create(code, now);
    await this.save(now);
    await this.ctx.storage.setAlarm(now + IDLE_DELETE_MS);
    return true;
  }

  async fetch(_request: Request): Promise<Response> {
    const [client, server] = Object.values(new WebSocketPair());
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ playerId: null } satisfies Attachment);
    if (!this.game) {
      this.send(server, { type: "error", message: "Room not found. Check the code", fatal: true });
      server.close(4004, "Room not found");
    }
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer) {
    const game = this.game;
    if (!game || typeof raw !== "string") return;
    let msg: ClientMessage;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    const now = Date.now();
    const playerId = (ws.deserializeAttachment() as Attachment).playerId;

    try {
      if (msg.type === "join") {
        const p = game.join(String(msg.name ?? ""), typeof msg.token === "string" ? msg.token : undefined, now);
        // Same player opened the game somewhere else: keep only the newest connection.
        for (const other of this.sockets()) {
          if (other !== ws && this.playerOf(other) === p.id) {
            other.serializeAttachment({ playerId: null } satisfies Attachment);
            this.send(other, { type: "error", message: "You opened the game on another tab or device", fatal: true });
            other.close(4001, "Replaced");
          }
        }
        ws.serializeAttachment({ playerId: p.id } satisfies Attachment);
        this.send(ws, { type: "welcome", playerId: p.id, token: p.token });
      } else if (!playerId || !game.player(playerId)) {
        this.send(ws, { type: "error", message: "You're no longer in this room", fatal: true });
        ws.close(4003, "Not in room");
        return;
      } else if (msg.type === "location") {
        // Very frequent: just record it. The next clock tick sends it out.
        game.updateLocation(playerId, { lat: Number(msg.lat), lng: Number(msg.lng) }, now);
        return;
      } else {
        this.handle(ws, playerId, msg, now);
      }
    } catch (err) {
      if (!(err instanceof GameError)) throw err;
      this.send(ws, { type: "error", message: err.message });
    }
    await this.flush(now, true);
  }

  private handle(ws: WebSocket, id: string, msg: ClientMessage, now: number) {
    const game = this.game!;
    switch (msg.type) {
      case "updateSettings":
        return game.updateSettings(id, msg.patch ?? {});
      case "setRole":
        return game.setRole(id, msg.playerId, msg.role);
      case "volunteer":
        return game.volunteer(id, msg.role);
      case "kick": {
        game.kick(id, msg.playerId);
        for (const other of this.sockets()) {
          if (this.playerOf(other) === msg.playerId) {
            other.serializeAttachment({ playerId: null } satisfies Attachment);
            this.send(other, { type: "error", message: "The host removed you from the room", fatal: true });
            other.close(4003, "Kicked");
          }
        }
        return;
      }
      case "transferHost":
        return game.transferHost(id, msg.playerId);
      case "addBots":
        return game.addBots(id, Number(msg.count) || 1, now);
      case "removeBots":
        return game.removeBots(id);
      case "start":
        return game.start(id, now);
      case "tagSelf":
        return game.tagSelf(id, msg.byId ?? null, now);
      case "tagCode":
        return game.tagWithCode(id, String(msg.code ?? ""), now);
      case "tagBot":
        return game.tagBot(id, String(msg.botId ?? ""), now);
      case "endGame":
        return game.endGame(id, now);
      case "playAgain":
        return game.playAgain(id);
      case "leave":
        game.leave(id, now);
        ws.serializeAttachment({ playerId: null } satisfies Attachment);
        ws.close(1000, "Left");
        return;
    }
  }

  async webSocketClose(ws: WebSocket, code: number, reason: string) {
    try {
      ws.close(code, reason);
    } catch {
      // already closed
    }
    await this.dropSocket(ws);
  }

  async webSocketError(ws: WebSocket) {
    await this.dropSocket(ws);
  }

  private async dropSocket(ws: WebSocket) {
    const id = this.playerOf(ws);
    if (!this.game || !id) return;
    const stillHere = this.sockets().some((other) => other !== ws && this.playerOf(other) === id);
    if (stillHere) return;
    const now = Date.now();
    this.game.disconnect(id, now);
    await this.flush(now, true);
  }

  async alarm() {
    const game = this.game;
    if (!game) return;
    const now = Date.now();
    const connected = this.sockets().filter((ws) => this.playerOf(ws));

    if (connected.length === 0) {
      // Nobody's here: stop the clock, and delete the room once it's been empty long enough.
      const lastSeen = Math.max(game.state.createdAt, ...game.state.players.filter((p) => !p.isBot).map((p) => p.lastSeenAt));
      if (now - lastSeen >= IDLE_DELETE_MS) {
        this.game = null;
        await this.ctx.storage.deleteAll();
        return;
      }
      await this.ctx.storage.setAlarm(lastSeen + IDLE_DELETE_MS);
      return;
    }

    game.housekeeping(now);
    game.tick(now);
    await this.flush(now, game.outbox.length > 0);
  }

  // ---------- helpers ----------

  private sockets() {
    return this.ctx.getWebSockets().filter((ws) => ws.readyState === WebSocket.OPEN);
  }

  private playerOf(ws: WebSocket): string | null {
    return (ws.deserializeAttachment() as Attachment | null)?.playerId ?? null;
  }

  private send(ws: WebSocket, msg: ServerMessage) {
    try {
      ws.send(JSON.stringify(msg));
    } catch {
      // connection went away; its close handler will clean up
    }
  }

  private async save(now: number) {
    if (!this.game) return;
    await this.ctx.storage.put("game", this.game.state);
    this.lastSavedAt = now;
  }

  /** Save, send every phone its view plus any events, and keep the clock running. */
  private async flush(now: number, important: boolean) {
    const game = this.game;
    if (!game) return;
    if (important || now - this.lastSavedAt >= SAVE_POSITIONS_MS) await this.save(now);

    const outbox = game.outbox;
    game.outbox = [];
    for (const ws of this.sockets()) {
      const id = this.playerOf(ws);
      const p = id ? game.player(id) : undefined;
      if (!p) continue;
      this.send(ws, { type: "state", view: game.view(p.id, now) });
      for (const { to, event } of outbox) {
        if (this.reaches(to, p.id, p.role)) this.send(ws, { type: "event", event });
      }
    }

    const tickMs = game.active ? ACTIVE_TICK_MS : game.state.phase === "lobby" ? LOBBY_TICK_MS : RESULTS_TICK_MS;
    const next = now + tickMs;
    const current = await this.ctx.storage.getAlarm();
    if (current === null || current > next) await this.ctx.storage.setAlarm(next);
  }

  private reaches(to: Recipient, id: string, role: string | null) {
    if (to === "all") return true;
    if (to === "seekers") return role === "seeker";
    if (to === "hiders") return role === "hider";
    return to.playerId === id;
  }
}
