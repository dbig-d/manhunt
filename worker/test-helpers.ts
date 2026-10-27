import { Game } from "./game";
import { offset } from "../shared/geo";
import type { LatLng, SettingsPatch } from "../shared/protocol";

export const CENTER: LatLng = { lat: 51.5, lng: -0.1 };
export const T0 = 1_000_000;

/** Deterministic random numbers so tests behave the same every run. */
export function seeded(seed = 42) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

/** A started game: Hana (host) is the seeker, Ivan and Jo are hiders. 60 s head start. */
export function setup(settings: SettingsPatch = {}) {
  let n = 0;
  const game = Game.create("TEST", T0, seeded(), () => `id${n++}`);
  const host = game.join("Hana", undefined, T0);
  const h1 = game.join("Ivan", undefined, T0);
  const h2 = game.join("Jo", undefined, T0);
  game.updateSettings(host.id, {
    boundary: { shape: "circle", center: CENTER, radius: 200 },
    roleAssignment: "manual",
    headStartSec: 60,
    pingIntervalSec: 60,
    ...settings,
  });
  game.setRole(host.id, host.id, "seeker");
  game.setRole(host.id, h1.id, "hider");
  game.setRole(host.id, h2.id, "hider");
  game.updateLocation(host.id, CENTER, T0);
  game.updateLocation(h1.id, offset(CENTER, 80, 0), T0);
  game.updateLocation(h2.id, offset(CENTER, 80, 180), T0);
  game.start(host.id, T0);
  return { game, host, h1, h2 };
}

/** Advance the clock second by second, keeping everyone's GPS fresh. */
export function run(game: Game, from: number, to: number) {
  for (let t = from + 1000; t <= to; t += 1000) {
    for (const p of game.state.players) if (!p.isBot && p.pos) game.updateLocation(p.id, p.pos, t);
    game.tick(t);
  }
}
