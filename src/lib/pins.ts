import type { RoomView } from "../../shared/protocol";
import type { MapPin } from "../components/MapView";
import { formatAgo } from "./hooks";

/** Turn the server's markers into labelled map pins, fading pings as they age. */
export function buildPins(view: RoomView, now: number): MapPin[] {
  const byId = new Map(view.players.map((p) => [p.id, p]));
  const fadeOver = view.settings.pingIntervalSec * 1000 * 1.5;
  return view.markers.map((m) => {
    const p = byId.get(m.playerId);
    const ageMs = now - m.at;
    const sub =
      m.kind === "live"
        ? p?.revealed
          ? "out of bounds"
          : undefined
        : m.kind === "lastKnown"
          ? `no signal · ${formatAgo(ageMs)}`
          : m.kind === "fuzzy"
            ? `±${m.radius} m · ${formatAgo(ageMs)}`
            : formatAgo(ageMs);
    return {
      id: m.playerId,
      lat: m.lat,
      lng: m.lng,
      label: p?.name ?? "?",
      sub,
      role: p?.role ?? null,
      kind: m.kind,
      radius: m.radius,
      age: m.kind === "live" ? 0 : Math.min(1, ageMs / fadeOver),
    };
  });
}
