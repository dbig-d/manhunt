import type { RoomView } from "../../shared/protocol";
import type { MapPin } from "../components/MapView";
import { formatAgo } from "./hooks";

/** Turn the server's markers into labelled map pins, fading pings as they age. */
export function buildPins(view: RoomView, now: number): MapPin[] {
  const byId = new Map(view.players.map((p) => [p.id, p]));
  const fadeOver = view.settings.pingIntervalSec * 1000 * 1.5;
  return view.markers.map((m) => {
    const p = m.playerId ? byId.get(m.playerId) : undefined;
    // Anonymous pins only say which team they're on.
    const label = p?.name ?? (m.role === "seeker" ? "Seeker" : "Hider");
    const ageMs = now - m.at;
    const sub =
      m.kind === "live"
        ? // The other team only ever shows up live when they've been revealed.
          p?.revealed || (!p && m.role !== view.me.role)
          ? "out of bounds"
          : undefined
        : m.kind === "lastKnown"
          ? `no signal · ${formatAgo(ageMs)}`
          : m.kind === "fuzzy"
            ? `±${m.radius} m · ${formatAgo(ageMs)}`
            : formatAgo(ageMs);
    return {
      id: m.key,
      lat: m.lat,
      lng: m.lng,
      label,
      sub,
      role: m.role,
      kind: m.kind,
      radius: m.radius,
      age: m.kind === "live" ? 0 : Math.min(1, ageMs / fadeOver),
    };
  });
}
