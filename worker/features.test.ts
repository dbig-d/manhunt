import { describe, expect, it } from "vitest";
import { GameError } from "./game";
import { distance, offset } from "../shared/geo";
import { CENTER, T0, run, setup } from "./test-helpers";
import type { Boundary } from "../shared/protocol";

const HUNT = T0 + 60_000; // the 60 s head start ends here and the first ping goes out

describe("safe zones and coins", () => {
  it("a zone opens after the hunt starts and pays a hider standing in it", () => {
    const { game, h1 } = setup({ zones: { everySec: 60, durationSec: 300, coinsPerMin: 6 } });
    run(game, T0, HUNT + 30_000);
    const zone = game.state.zones[0];
    expect(zone).toBeDefined();
    game.updateLocation(h1.id, zone.center, HUNT + 30_000);
    run(game, HUNT + 30_000, HUNT + 90_000);
    const me = game.view(h1.id, HUNT + 90_000).me;
    expect(me.zoneId).toBe(zone.id);
    expect(me.coins).toBeGreaterThan(5.5);
    expect(me.coins).toBeLessThan(6.5);
  });

  it("hiders in the same zone split the coins", () => {
    const { game, h1, h2 } = setup({ zones: { everySec: 60, durationSec: 300, coinsPerMin: 6 } });
    run(game, T0, HUNT + 30_000);
    const zone = game.state.zones[0];
    game.updateLocation(h1.id, zone.center, HUNT + 30_000);
    game.updateLocation(h2.id, offset(zone.center, 3, 90), HUNT + 30_000);
    run(game, HUNT + 30_000, HUNT + 90_000);
    expect(game.player(h1.id)!.coins).toBeCloseTo(3, 0);
    expect(game.player(h2.id)!.coins).toBeCloseTo(3, 0);
  });

  it("everyone can see zones, and they close when their time is up", () => {
    const { game, host } = setup({ zones: { everySec: 600, durationSec: 60 } });
    run(game, T0, HUNT + 30_000);
    expect(game.view(host.id, HUNT + 30_000).zones).toHaveLength(1);
    run(game, HUNT + 30_000, HUNT + 91_000);
    expect(game.view(host.id, HUNT + 91_000).zones).toHaveLength(0);
  });

  it("'alert' tells seekers when a hider walks into a zone", () => {
    const { game, host, h1 } = setup({ zones: { everySec: 60, pingEffect: "alert" } });
    run(game, T0, HUNT + 30_000);
    game.outbox = [];
    game.updateLocation(h1.id, game.state.zones[0].center, HUNT + 30_500);
    run(game, HUNT + 30_000, HUNT + 31_000);
    const alert = game.outbox.find((o) => o.event.kind === "zone" && o.event.what === "alert")!;
    expect(game.reaches(alert.to, host.id)).toBe(true);
    expect(game.reaches(alert.to, h1.id)).toBe(false);
    expect(game.view(host.id, HUNT + 31_000).zones[0].alert).toBe(true);
  });
});

describe("power-ups", () => {
  const rich = (settings = {}) => {
    const g = setup(settings);
    run(g.game, T0, HUNT);
    g.game.player(g.h1.id)!.coins = 200;
    return g;
  };
  const pinOf = (game: ReturnType<typeof setup>["game"], viewer: string, target: string, t: number) =>
    game.view(viewer, t).markers.find((m) => m.playerId === target);

  it("Ghost skips your next ping", () => {
    const { game, host, h1 } = rich();
    const firstPing = game.player(h1.id)!.pos!;
    game.buy(h1.id, "ghost", undefined, HUNT + 1000);
    game.updateLocation(h1.id, offset(firstPing, 60, 90), HUNT + 10_000);
    run(game, HUNT + 10_000, HUNT + 61_000);
    expect(distance(pinOf(game, host.id, h1.id, HUNT + 61_000)!, firstPing)).toBeLessThan(0.01);
  });

  it("Jammer pings where you were 30 seconds earlier", () => {
    const { game, host, h1 } = rich();
    const start = game.player(h1.id)!.pos!;
    for (let s = 1; s <= 60; s++) {
      game.updateLocation(h1.id, offset(start, s * 2, 90), HUNT + s * 1000);
      if (s === 40) game.buy(h1.id, "jammer", undefined, HUNT + s * 1000);
      game.tick(HUNT + s * 1000);
    }
    // Pinged at s = 60, so it should show roughly where they were at s = 30 (60 m east).
    expect(distance(pinOf(game, host.id, h1.id, HUNT + 60_000)!, offset(start, 60, 90))).toBeLessThan(6);
  });

  it("Decoy puts your ping 50–100 m away", () => {
    const { game, host, h1 } = rich();
    game.buy(h1.id, "decoy", undefined, HUNT + 1000);
    run(game, HUNT, HUNT + 60_000);
    const d = distance(pinOf(game, host.id, h1.id, HUNT + 60_000)!, game.player(h1.id)!.pos!);
    expect(d).toBeGreaterThanOrEqual(49);
    expect(d).toBeLessThanOrEqual(101);
  });

  it("Static turns your pings into a big blurry circle", () => {
    const { game, host, h1 } = rich();
    game.buy(h1.id, "static", undefined, HUNT + 1000);
    run(game, HUNT, HUNT + 60_000);
    const pin = pinOf(game, host.id, h1.id, HUNT + 60_000)!;
    expect(pin.kind).toBe("fuzzy");
    expect(pin.radius).toBe(60);
  });

  it("Blackout hides hiders from seekers' maps for 20 s", () => {
    const { game, host, h1 } = rich();
    game.buy(h1.id, "blackout", undefined, HUNT + 1000);
    const v = game.view(host.id, HUNT + 2000);
    expect(v.me.blackoutUntil).toBe(HUNT + 21_000);
    expect(v.markers.filter((m) => m.role === "hider")).toEqual([]);
    expect(game.view(host.id, HUNT + 22_000).markers.some((m) => m.role === "hider")).toBe(true);
  });

  it("Radar shows the hider every seeker live", () => {
    const { game, host, h1 } = rich();
    expect(pinOf(game, h1.id, host.id, HUNT + 1000)).toBeUndefined();
    game.buy(h1.id, "radar", undefined, HUNT + 1000);
    expect(pinOf(game, h1.id, host.id, HUNT + 2000)?.kind).toBe("live");
  });

  it("Revive brings a caught hider back", () => {
    const { game, host, h1, h2 } = rich();
    game.tagSelf(h2.id, host.id, HUNT + 1000);
    expect(game.player(h2.id)!.status).toBe("out");
    game.buy(h1.id, "revive", h2.id, HUNT + 2000);
    expect(game.player(h2.id)!.status).toBe("alive");
    expect(game.player(h2.id)!.role).toBe("hider");
  });

  it("needs enough coins, respects limits, and doesn't charge for a refused buy", () => {
    const { game, h1, h2 } = rich();
    expect(() => game.buy(h2.id, "radar", undefined, HUNT + 1000)).toThrow(GameError); // h2 has no coins
    game.buy(h1.id, "blackout", undefined, HUNT + 1000);
    expect(() => game.buy(h1.id, "blackout", undefined, HUNT + 2000)).toThrow(/used all/); // limit 1
    const before = game.player(h1.id)!.coins;
    expect(() => game.buy(h1.id, "revive", h2.id, HUNT + 3000)).toThrow(GameError); // h2 isn't caught
    expect(game.player(h1.id)!.coins).toBe(before);
  });

  it("seekers only shop when seeker economy is on, and earn coins per tag", () => {
    const { game, host, h1, h2 } = setup({ shop: { seekerEconomy: true, coinsPerTag: 20 } });
    run(game, T0, HUNT);
    expect(() => game.buy(host.id, "tracker", undefined, HUNT + 500)).toThrow(/need/);
    game.tagSelf(h1.id, host.id, HUNT + 1000);
    expect(game.player(host.id)!.coins).toBe(20);
    game.player(host.id)!.coins = 30;
    game.buy(host.id, "tracker", undefined, HUNT + 2000);
    expect(pinOf(game, host.id, h2.id, HUNT + 3000)?.kind).toBe("live");
  });

  it("turned-off items can't be bought", () => {
    const { game, h1 } = rich({ shop: { items: { radar: { enabled: false } } } });
    expect(() => game.buy(h1.id, "radar", undefined, HUNT + 1000)).toThrow(/turned off/);
  });
});

describe("team chat and quick pings", () => {
  it("messages only reach your own team, and quick pings drop a flag for teammates", () => {
    const { game, host, h1, h2 } = setup();
    run(game, T0, HUNT);
    game.outbox = [];
    game.chat(h1.id, "  going   north ", false, HUNT + 1000);
    const sent = game.outbox.find((o) => o.event.kind === "chat")!;
    expect(sent.event.kind === "chat" && sent.event.msg.text).toBe("going north");
    expect(game.reaches(sent.to, h2.id)).toBe(true);
    expect(game.reaches(sent.to, host.id)).toBe(false);

    game.chat(h1.id, "Spotted one!", true, HUNT + 2000);
    expect(game.view(h2.id, HUNT + 3000).markers.find((m) => m.kind === "flag")?.label).toBe("Spotted one!");
    expect(game.view(host.id, HUNT + 3000).markers.some((m) => m.kind === "flag")).toBe(false);
  });

  it("slows down spammers", () => {
    const { game, h1 } = setup();
    game.chat(h1.id, "a", false, T0 + 1000);
    expect(() => game.chat(h1.id, "b", false, T0 + 1200)).toThrow(/Slow down/);
  });
});

describe("modes", () => {
  it("picking a mode applies its preset but keeps the host's other choices", () => {
    const { game, host } = setup();
    game.state.phase = "lobby";
    game.updateSettings(host.id, { pingIntervalSec: 90 });
    game.updateSettings(host.id, { mode: "night" });
    let s = game.state.settings;
    expect([s.secretCount, s.anonymous, s.pingIntervalSec]).toEqual([true, true, 90]);
    game.updateSettings(host.id, { mode: "classic" });
    s = game.state.settings;
    expect([s.secretCount, s.anonymous]).toEqual([false, false]);
  });

  it("Storm shrinks the play area to its final size by 90% of the game", () => {
    const { game, host } = setup({ mode: "storm", gameLengthMin: 10 }); // shrinks from 25% to 90%, down to 35%
    run(game, T0, HUNT);
    const at = (s: number) => game.boundaryAt(HUNT + s * 1000) as Extract<Boundary, { shape: "circle" }>;
    expect(at(100).radius).toBe(200);
    expect(at(345).radius).toBeCloseTo(135, 0); // halfway between 150 s and 540 s
    const end = at(540);
    expect(end.radius).toBeCloseTo(70, 0);
    expect(distance(end.center, CENTER) + end.radius).toBeLessThanOrEqual(200.5);
    game.outbox = [];
    run(game, HUNT, HUNT + 151_000);
    expect(game.outbox.some((o) => o.event.kind === "storm")).toBe(true);
    expect(game.view(host.id, HUNT + 151_000).stormTarget).not.toBeNull();
  });

  it("Night Time keeps the number of hiders left, and who got caught, a secret", () => {
    const { game, host, h1, h2 } = setup({ mode: "night" });
    run(game, T0, HUNT);
    game.outbox = [];
    game.tagSelf(h1.id, host.id, HUNT + 1000);
    const tagged = game.outbox.find((o) => o.event.kind === "tagged")!;
    expect(game.reaches(tagged.to, h1.id)).toBe(true);
    expect(game.reaches(tagged.to, host.id)).toBe(true);
    expect(game.reaches(tagged.to, h2.id)).toBe(false);
    const v = game.view(h2.id, HUNT + 2000);
    expect(v.hidersLeft).toBeNull();
    expect(v.players.find((p) => p.id === h1.id)!.status).toBe("alive");
    // Spectators see the truth.
    expect(game.view(h1.id, HUNT + 2000).hidersLeft).toBe(1);
  });
});

describe("match replay", () => {
  const times = (track: number[]) => track.filter((_, i) => i % 3 === 2);

  it("records everyone from the start of the head start, every 5 s, plus the hunt and pings", () => {
    const { game, host, h1 } = setup();
    run(game, T0, HUNT + 60_000);
    game.endGame(host.id, HUNT + 60_000);
    const recap = game.state.recap!;
    expect(recap.huntStartS).toBe(60);
    expect(recap.durationS).toBe(120);
    const t = times(recap.tracks[h1.id]);
    expect(t[0]).toBe(0); // the head start is in there
    expect(t.slice(0, 4)).toEqual([0, 5, 10, 15]);
    expect(t[t.length - 1]).toBe(120);
    expect(recap.events.filter((e) => e.kind === "hunt").map((e) => e.t)).toEqual([60]);
    expect(recap.events.filter((e) => e.kind === "ping").length).toBe(2); // at 60 s and 120 s
    expect(recap.players.map((p) => [p.name, p.startRole])).toEqual([["Hana", "seeker"], ["Ivan", "hider"], ["Jo", "hider"]]);
    expect(game.view(host.id, HUNT + 61_000).recapId).toBe(recap.id);
  });

  it("records tags where they happened, and whether the hider switched sides", () => {
    const { game, host, h1 } = setup({ mode: "infection" });
    run(game, T0, HUNT + 10_000);
    game.tagSelf(h1.id, host.id, HUNT + 12_000);
    game.endGame(host.id, HUNT + 20_000);
    const tag = game.state.recap!.events.find((e) => e.kind === "tag")!;
    expect(tag).toMatchObject({ t: 72, playerId: h1.id, byId: host.id, converted: true, oob: false });
    // Their track has a point at the exact moment of the tag, then carries on as a seeker.
    const t = times(game.state.recap!.tracks[h1.id]);
    expect(t).toContain(72);
    expect(t[t.length - 1]).toBe(80);
  });

  it("records safe zones opening and closing, the storm, and power-ups", () => {
    const { game, host, h1 } = setup({ mode: "storm", gameLengthMin: 4, zones: { everySec: 60, durationSec: 60 } });
    run(game, T0, HUNT + 30_000);
    game.player(h1.id)!.coins = 50;
    game.buy(h1.id, "radar", undefined, HUNT + 31_000);
    run(game, HUNT + 30_000, HUNT + 120_000);
    game.endGame(host.id, HUNT + 120_000);
    const recap = game.state.recap!;
    expect(recap.zones[0]).toMatchObject({ from: 90, to: 150, r: 20 });
    expect(recap.storm).toMatchObject({ startS: 120, finalPct: 35 });
    expect(recap.storm!.endS).toBeCloseTo(60 + 240 * 0.9, 1);
    expect(recap.events.some((e) => e.kind === "item" && e.item === "radar" && e.playerId === h1.id)).toBe(true);
  });

  it("is deleted when the next game starts", () => {
    const { game, host } = setup();
    run(game, T0, HUNT);
    game.endGame(host.id, HUNT);
    expect(game.state.recap).not.toBeNull();
    game.playAgain(host.id);
    expect(game.state.recap).toBeNull();
    expect(game.view(host.id, HUNT + 1000).recapId).toBeNull();
  });

  it("is deleted when everyone leaves the results, or abandons them", () => {
    const a = setup();
    run(a.game, T0, HUNT);
    a.game.endGame(a.host.id, HUNT);
    for (const p of [a.host, a.h1, a.h2]) a.game.leave(p.id, HUNT + 5000);
    expect(a.game.state.recap).toBeNull();

    const b = setup();
    run(b.game, T0, HUNT);
    b.game.endGame(b.host.id, HUNT);
    for (const p of [b.host, b.h1, b.h2]) b.game.disconnect(p.id, HUNT + 1000);
    b.game.housekeeping(HUNT + 30_000);
    expect(b.game.state.recap).not.toBeNull(); // they might just be reconnecting
    b.game.housekeeping(HUNT + 70_000);
    expect(b.game.state.recap).toBeNull();
  });
});

describe("settings safety", () => {
  it("clamps nested values and ignores unknown items", () => {
    const { game, host } = setup();
    game.state.phase = "lobby";
    game.updateSettings(host.id, {
      zones: { radiusM: 999, pingEffect: "nope" as never },
      shop: { items: { radar: { price: -5 }, fake: { price: 1 } } as never },
    });
    const s = game.state.settings;
    expect(s.zones.radiusM).toBe(60);
    expect(s.zones.pingEffect).toBe("none");
    expect(s.shop.items.radar.price).toBe(0);
    expect("fake" in s.shop.items).toBe(false);
  });
});
