import { useEffect, useRef, useState } from "react";
import type { RoomView } from "../shared/protocol";
import { Toasts, type Toast } from "./components/ui";
import { useNow } from "./lib/hooks";
import { DEFAULT_CENTER, useGps } from "./lib/location";
import { useRoom } from "./lib/useRoom";
import GameScreen from "./screens/GameScreen";
import Lobby from "./screens/Lobby";
import Results from "./screens/Results";

export interface Session {
  code: string;
  name: string;
}

/** Resend your position this often even if it hasn't changed, so you don't look "stale". */
const HEARTBEAT_MS = 10_000;

/** Everything once you're in a room: the live connection, your location feed, and the screen for each phase. */
export default function RoomScreen({ session, onExit }: { session: Session; onExit: (message: string | null) => void }) {
  const room = useRoom(session.code, session.name);
  const { view, status, fatal, send, subscribe, serverNow, messages } = room;
  const gps = useGps();
  const now = useNow(serverNow);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const viewRef = useRef<RoomView | null>(view);
  viewRef.current = view;

  useEffect(() => {
    if (fatal) onExit(fatal);
  }, [fatal, onExit]);

  // Toasts for things happening in the room.
  useEffect(() => {
    let id = 0;
    const push = (text: string, tone: Toast["tone"] = "info", icon?: Toast["icon"]) => {
      const t = { id: ++id, text, tone, icon };
      setToasts((list) => [...list.slice(-2), t]);
      setTimeout(() => setToasts((list) => list.filter((x) => x.id !== t.id)), 3500);
    };
    return subscribe((e) => {
      if (e.kind === "error") return push(e.message, "bad");
      const ev = e.event;
      const v = viewRef.current;
      const name = (pid: string | null) => v?.players.find((p) => p.id === pid)?.name ?? "Someone";
      switch (ev.kind) {
        case "info":
          return push(ev.text);
        case "tagged":
          if (ev.playerId !== v?.me.id) {
            push(
              ev.reason === "oob" ? `${name(ev.playerId)} was eliminated for leaving the area` : ev.byId ? `${name(ev.byId)} tagged ${name(ev.playerId)}` : `${name(ev.playerId)} was tagged`,
              "good",
            );
          }
          return;
        case "revived":
          if (ev.playerId !== v?.me.id) push(`${name(ev.playerId)} is back in the game`, "info", "hand");
          return;
        case "zone":
          if (ev.what === "spawn") push("A safe zone just opened", "coin", "shield");
          return;
        case "item":
          if (!ev.mine && ev.item === "blackout") push("Blackout! A hider jammed your map", "bad", "eyeOff");
          return;
      }
    });
  }, [subscribe]);

  // With simulated GPS and no position yet, start in the middle of the play area.
  useEffect(() => {
    if (gps.simulated && !gps.pos && view) gps.setSimPos(view.settings.boundary?.center ?? DEFAULT_CENTER);
  }, [gps, view]);

  // Send our position: at most once a second while moving, plus a regular heartbeat.
  const gpsRef = useRef(gps);
  gpsRef.current = gps;
  const lastSentAt = useRef(0);
  useEffect(() => {
    if (status !== "open" || !gps.pos) return;
    const pos = gps.pos;
    const sendNow = () => {
      send({ type: "location", lat: pos.lat, lng: pos.lng, accuracy: gps.accuracy ?? 0 });
      lastSentAt.current = Date.now();
    };
    const wait = 1000 - (Date.now() - lastSentAt.current);
    if (wait <= 0) return void sendNow();
    const t = setTimeout(sendNow, wait);
    return () => clearTimeout(t);
  }, [gps.pos, gps.accuracy, status, send]);

  useEffect(() => {
    if (status !== "open") return;
    const t = setInterval(() => {
      const g = gpsRef.current;
      const fresh = g.simulated || (g.updatedAt !== null && Date.now() - g.updatedAt < 120_000);
      // A real phone with the game hidden should go stale; simulated players are tabs you're not looking at.
      const visible = g.simulated || document.visibilityState === "visible";
      if (g.pos && fresh && visible && Date.now() - lastSentAt.current > HEARTBEAT_MS / 2) {
        send({ type: "location", lat: g.pos.lat, lng: g.pos.lng, accuracy: g.accuracy ?? 0 });
        lastSentAt.current = Date.now();
      }
    }, HEARTBEAT_MS);
    return () => clearInterval(t);
  }, [status, send]);

  const leave = () => {
    send({ type: "leave" });
    onExit(null);
  };

  const inGame = view?.phase === "headstart" || view?.phase === "hunt";

  return (
    <>
      {status === "reconnecting" && <div className="conn-banner">Reconnecting…</div>}
      {!view ? (
        <Loading text={`Joining room ${session.code}…`} onCancel={() => onExit(null)} />
      ) : view.phase === "lobby" ? (
        <Lobby view={view} now={now} send={send} onLeave={leave} messages={messages} />
      ) : view.phase === "results" ? (
        <Results view={view} recap={room.recap} send={send} onLeave={leave} />
      ) : (
        <GameScreen room={room} view={view} now={now} onLeave={leave} />
      )}
      <Toasts toasts={toasts} inGame={inGame} />
    </>
  );
}

export function Loading({ text, onCancel }: { text: string; onCancel?: () => void }) {
  return (
    <main className="loading screen">
      <div className="radar" aria-hidden="true">
        <div className="radar-sweep" />
      </div>
      <p>{text}</p>
      {onCancel && (
        <button className="btn btn--ghost btn--sm" onClick={onCancel}>
          Cancel
        </button>
      )}
    </main>
  );
}
