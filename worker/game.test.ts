import { describe, expect, it } from "vitest";
import { Game, GameError } from "./game";
import { distance, offset } from "../shared/geo";
import { CENTER, T0, run, seeded, setup } from "./test-helpers";

describe("visibility", () => {
  it("seekers see no hiders during the head start", () => {
    const { game, host } = setup();
    run(game, T0, T0 + 30_000);
    expect(game.view(host.id, T0 + 30_000).markers).toEqual([]);
  });

  it("seekers see the ping snapshot, not where hiders moved afterwards", () => {
    const { game, host, h1 } = setup();
    run(game, T0, T0 + 60_000); // head start ends -> first ping
    const pingedAt = game.player(h1.id)!.pos!;
    game.updateLocation(h1.id, offset(pingedAt, 50, 90), T0 + 61_000);

    const m = game.view(host.id, T0 + 61_000).markers.find((x) => x.playerId === h1.id)!;
    expect(m.kind).toBe("ping");
    expect(distance(m, pingedAt)).toBeLessThan(0.01);
  });

  it("fuzzy pings are a circle the hider is inside, but not centered on them", () => {
    const { game, host, h1 } = setup({ pingStyle: "fuzzy" });
    run(game, T0, T0 + 60_000);
    const m = game.view(host.id, T0 + 60_000).markers.find((x) => x.playerId === h1.id)!;
    expect(m.kind).toBe("fuzzy");
    const d = distance(m, game.player(h1.id)!.pos!);
    expect(d).toBeLessThanOrEqual(m.radius!);
  });

  it("hiders see nothing about seekers by default, and nothing about each other", () => {
    const { game, h1 } = setup();
    run(game, T0, T0 + 90_000);
    expect(game.view(h1.id, T0 + 90_000).markers).toEqual([]);
  });

  it("hiders see seekers when the 'pinged' setting is on", () => {
    const { game, host, h1 } = setup({ hiderView: "pinged" });
    run(game, T0, T0 + 60_000);
    const ms = game.view(h1.id, T0 + 60_000).markers;
    expect(ms.map((m) => m.playerId)).toEqual([host.id]);
  });

  it("pings repeat on the interval", () => {
    const { game, host, h1 } = setup();
    run(game, T0, T0 + 60_000);
    game.updateLocation(h1.id, offset(CENTER, 10, 90), T0 + 70_000);
    run(game, T0 + 70_000, T0 + 120_000);
    const m = game.view(host.id, T0 + 120_000).markers.find((x) => x.playerId === h1.id)!;
    expect(distance(m, offset(CENTER, 10, 90))).toBeLessThan(0.01);
  });
});

describe("anonymous mode and teammates", () => {
  it("anonymous: seekers see hider pings without knowing who they are", () => {
    const { game, host, h1, h2 } = setup({ anonymous: true });
    run(game, T0, T0 + 60_000);
    const ms = game.view(host.id, T0 + 60_000).markers;
    expect(ms).toHaveLength(2);
    for (const m of ms) {
      expect(m.playerId).toBeNull();
      expect(m.role).toBe("hider");
      expect([h1.id, h2.id]).not.toContain(m.key);
    }
    // The throwaway id stays the same between pings so the pin doesn't jump around.
    run(game, T0 + 60_000, T0 + 75_000);
    expect(game.view(host.id, T0 + 75_000).markers.map((m) => m.key).sort()).toEqual(ms.map((m) => m.key).sort());
  });

  it("anonymous mode doesn't hide teammates or anyone from spectators", () => {
    const { game, host, h1, h2 } = setup({ anonymous: true, hidersSeeHiders: "live" });
    run(game, T0, T0 + 60_000);
    expect(game.view(h1.id, T0 + 60_000).markers.map((m) => m.playerId)).toEqual([h2.id]);
    game.tagSelf(h1.id, host.id, T0 + 61_000);
    expect(game.view(h1.id, T0 + 61_000).markers.every((m) => m.playerId !== null)).toBe(true);
  });

  it("hiders can see other hiders live", () => {
    const { game, h1, h2 } = setup({ hidersSeeHiders: "live" });
    run(game, T0, T0 + 10_000);
    const m = game.view(h1.id, T0 + 10_000).markers;
    expect(m.map((x) => [x.playerId, x.kind])).toEqual([[h2.id, "live"]]);
  });

  it("hiders can see other hiders only at pings", () => {
    const { game, h1, h2 } = setup({ hidersSeeHiders: "pings" });
    run(game, T0, T0 + 30_000);
    expect(game.view(h1.id, T0 + 30_000).markers).toEqual([]); // no ping yet during the head start
    run(game, T0 + 30_000, T0 + 60_000);
    const pingedAt = game.player(h2.id)!.pos!;
    game.updateLocation(h2.id, offset(pingedAt, 40, 90), T0 + 61_000);
    const m = game.view(h1.id, T0 + 61_000).markers;
    expect(m.map((x) => x.kind)).toEqual(["ping"]);
    expect(distance(m[0], pingedAt)).toBeLessThan(0.01);
  });

  it("seekers can be hidden from each other", () => {
    let n = 0;
    const game = Game.create("TEST", T0, seeded(), () => `id${n++}`);
    const a = game.join("A", undefined, T0);
    const b = game.join("B", undefined, T0);
    const c = game.join("C", undefined, T0);
    game.updateSettings(a.id, { boundary: { shape: "circle", center: CENTER, radius: 200 }, roleAssignment: "manual", seekersSeeSeekers: false });
    game.setRole(a.id, a.id, "seeker");
    game.setRole(a.id, b.id, "seeker");
    game.setRole(a.id, c.id, "hider");
    for (const p of [a, b, c]) game.updateLocation(p.id, CENTER, T0);
    game.start(a.id, T0);
    expect(game.view(a.id, T0).markers).toEqual([]);
  });

  it("old saved rooms with the 'teammates' setting still load", () => {
    const { game } = setup();
    const saved = JSON.parse(JSON.stringify(game.state));
    delete saved.settings.seekersSeeSeekers;
    delete saved.settings.hidersSeeHiders;
    saved.settings.teammates = "both";
    const loaded = new Game(saved);
    expect(loaded.state.settings.seekersSeeSeekers).toBe(true);
    expect(loaded.state.settings.hidersSeeHiders).toBe("live");
  });
});

describe("tagging and winning", () => {
  it("classic: a tagged hider is out and can spectate everyone", () => {
    const { game, host, h1, h2 } = setup();
    run(game, T0, T0 + 60_000);
    game.tagSelf(h1.id, host.id, T0 + 61_000);
    expect(game.player(h1.id)!.status).toBe("out");
    expect(game.player(host.id)!.tags).toBe(1);
    const ids = game.view(h1.id, T0 + 61_000).markers.map((m) => m.playerId).sort();
    expect(ids).toEqual([host.id, h2.id].sort());
  });

  it("infection: a tagged hider becomes a seeker", () => {
    const { game, host, h1 } = setup({ mode: "infection" });
    run(game, T0, T0 + 60_000);
    game.tagSelf(h1.id, host.id, T0 + 61_000);
    expect(game.player(h1.id)!.role).toBe("seeker");
    expect(game.player(h1.id)!.status).toBe("alive");
  });

  it("seekers win when every hider is tagged", () => {
    const { game, host, h1, h2 } = setup();
    run(game, T0, T0 + 60_000);
    game.tagSelf(h1.id, host.id, T0 + 61_000);
    game.tagSelf(h2.id, host.id, T0 + 62_000);
    expect(game.state.phase).toBe("results");
    expect(game.state.results!.winner).toBe("seekers");
    expect(game.state.results!.reason).toBe("allTagged");
  });

  it("hiders win when the timer runs out", () => {
    const { game } = setup({ gameLengthMin: 1 });
    run(game, T0, T0 + 60_000 + 60_000);
    expect(game.state.results!.winner).toBe("hiders");
  });

  it("QR tagging: a seeker tags with the hider's current code", () => {
    const { game, host, h1 } = setup({ tagMode: "qr" });
    run(game, T0, T0 + 60_000);
    const me = game.view(h1.id, T0 + 60_000).me;
    const code = me.tagCode!;
    expect(code).toMatch(/^\d{4}$/);
    expect(me.tagCodeRefreshAt).toBe(T0 + 60_000 + 20_000);
    expect(() => game.tagWithCode(host.id, "nope", T0 + 61_000)).toThrow(GameError);
    game.tagWithCode(host.id, code, T0 + 61_000);
    expect(game.player(h1.id)!.status).toBe("out");
  });

  it("only the host can start or end the game", () => {
    const { game, h1 } = setup();
    expect(() => game.endGame(h1.id, T0 + 1000)).toThrow(GameError);
  });
});

describe("boundaries", () => {
  it("'eliminate' penalty tags a hider who stays out past the grace period", () => {
    const { game, h1 } = setup({ oobPenalty: "eliminate", oobGraceSec: 10 });
    run(game, T0, T0 + 60_000);
    game.updateLocation(h1.id, offset(CENTER, 300, 0), T0 + 61_000);
    run(game, T0 + 61_000, T0 + 65_000);
    expect(game.player(h1.id)!.status).toBe("alive");
    expect(game.view(h1.id, T0 + 65_000).me.oob).not.toBeNull();
    run(game, T0 + 65_000, T0 + 72_000);
    expect(game.player(h1.id)!.status).toBe("out");
  });

  it("'reveal' penalty shows the hider live to seekers", () => {
    const { game, host, h1 } = setup({ oobPenalty: "reveal", oobGraceSec: 5 });
    run(game, T0, T0 + 60_000);
    const out = offset(CENTER, 300, 0);
    game.updateLocation(h1.id, out, T0 + 61_000);
    run(game, T0 + 61_000, T0 + 67_000);
    const m = game.view(host.id, T0 + 67_000).markers.find((x) => x.playerId === h1.id)!;
    expect(m.kind).toBe("live");
  });
});

describe("bots", () => {
  it("bots wander but stay inside the play area", () => {
    const { game, host } = setup();
    game.state.phase = "lobby";
    game.addBots(host.id, 5, T0);
    game.state.phase = "headstart";
    run(game, T0, T0 + 300_000);
    for (const bot of game.state.players.filter((p) => p.isBot)) {
      expect(distance(bot.pos!, CENTER)).toBeLessThanOrEqual(200);
    }
  });

  it("a seeker can tag a nearby bot hider", () => {
    let n = 0;
    const game = Game.create("TEST", T0, seeded(), () => `id${n++}`);
    const host = game.join("Hana", undefined, T0);
    game.updateSettings(host.id, { boundary: { shape: "circle", center: CENTER, radius: 200 }, roleAssignment: "manual", headStartSec: 0 });
    game.updateLocation(host.id, CENTER, T0);
    game.addBots(host.id, 1, T0);
    const bot = game.state.players.find((p) => p.isBot)!;
    game.setRole(host.id, host.id, "seeker");
    game.start(host.id, T0);
    bot.pos = offset(CENTER, 100, 0);
    expect(() => game.tagBot(host.id, bot.id, T0 + 1000)).toThrow(GameError);
    bot.pos = offset(CENTER, 10, 0);
    game.tagBot(host.id, bot.id, T0 + 1000);
    expect(game.state.results?.winner).toBe("seekers");
  });
});
