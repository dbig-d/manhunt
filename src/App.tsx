import { useCallback, useEffect, useRef, useState } from "react";
import type { RoomView } from "../shared/protocol";
import DevPanel from "./components/DevPanel";
import { Toasts, type Toast } from "./components/ui";
import { useNow } from "./lib/hooks";
import { DEFAULT_CENTER, GpsProvider, useGps } from "./lib/location";
import { forgetRoom, useRoom } from "./lib/useRoom";
import GameScreen from "./screens/GameScreen";
import Home from "./screens/Home";
import Lobby from "./screens/Lobby";
import Results from "./screens/Results";

interface Session {
  code: string;
  name: string;
}

const SESSION_KEY = "mh:session";
/** Resend your position this often even if it hasn't changed, so you don't look "stale". */
const HEARTBEAT_MS = 10_000;

function readSession(): Session | null {
  try {
    return JSON.parse(sessionStorage.getItem(SESSION_KEY) ?? "null");
  } catch {
    return null;
  }
}

export default function App() {
  return (
    <GpsProvider>
      <Main />
      <DevPanel />
    </GpsProvider>
  );
}

function Main() {
  const [session, setSession] = useState<Session | null>(readSession);
  const [error, setError] = useState<string | null>(null);

  const enter = (code: string, name: string) => {
    const s = { code, name };
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(s));
    setError(null);
    setSession(s);
  };

  const exit = useCallback((message: string | null) => {
    setSession((s) => {
      if (s) forgetRoom(s.code);
      return null;
    });
    sessionStorage.removeItem(SESSION_KEY);
    setError(message);
  }, []);

  if (!session) return <Home onEnter={enter} error={error} />;
  return <RoomScreen key={session.code} session={session} onExit={exit} />;
}

function RoomScreen({ session, onExit }: { session: Session; onExit: (message: string | null) => void }) {
  const room = useRoom(session.code, session.name);
  const { view, status, fatal, send, subscribe, serverNow } = room;
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
    const push = (text: string, tone: Toast["tone"] = "info") => {
      const t = { id: ++id, text, tone };
      setToasts((list) => [...list.slice(-3), t]);
      setTimeout(() => setToasts((list) => list.filter((x) => x.id !== t.id)), 3500);
    };
    return subscribe((e) => {
      if (e.kind === "error") return push(e.message, "bad");
      const ev = e.event;
      const v = viewRef.current;
      const name = (pid: string | null) => v?.players.find((p) => p.id === pid)?.name ?? "Someone";
      if (ev.kind === "info") push(ev.text);
      if (ev.kind === "tagged" && ev.playerId !== v?.me.id) {
        push(
          ev.reason === "oob" ? `${name(ev.playerId)} was eliminated for leaving the area` : ev.byId ? `${name(ev.byId)} tagged ${name(ev.playerId)}` : `${name(ev.playerId)} was tagged`,
          "good",
        );
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

  return (
    <>
      {status === "reconnecting" && <div className="conn-banner">Reconnecting…</div>}
      {!view ? (
        <main className="loading">
          <div className="home-radar" aria-hidden="true">
            <div className="home-sweep" />
          </div>
          <p>Joining room {session.code}…</p>
          <button className="btn btn-ghost btn-small" onClick={() => onExit(null)}>
            Cancel
          </button>
        </main>
      ) : view.phase === "lobby" ? (
        <Lobby view={view} now={now} send={send} onLeave={leave} />
      ) : view.phase === "results" ? (
        <Results view={view} send={send} onLeave={leave} />
      ) : (
        <GameScreen room={room} view={view} now={now} onLeave={leave} />
      )}
      <Toasts toasts={toasts} />
    </>
  );
}
