import { lazy, Suspense, useCallback, useEffect, useState } from "react";
import { CrashScreen } from "./components/CrashScreen";
import { GpsProvider } from "./lib/location";
import { forgetRoom } from "./lib/useRoom";
import Home from "./screens/Home";
import type { Session } from "./RoomScreen";

// The room screens carry the map library (most of the app's size), so they load
// separately: the home screen appears fast, and the rest arrives while you type.
const loadRoom = () => import("./RoomScreen");
const RoomScreen = lazy(loadRoom);

const SESSION_KEY = "mh:session";

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
    </GpsProvider>
  );
}

function Main() {
  const [session, setSession] = useState<Session | null>(readSession);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const t = setTimeout(loadRoom, 1200);
    return () => clearTimeout(t);
  }, []);

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
  return (
    // If the room screens fail to load (old browser, bad connection), say so instead of hanging.
    <CrashScreen onReset={() => exit(null)}>
      <Suspense
        fallback={
          <main className="loading">
            <div className="radar" aria-hidden="true">
              <div className="radar-sweep" />
            </div>
            <p>Loading…</p>
          </main>
        }
      >
        <RoomScreen key={session.code} session={session} onExit={exit} />
      </Suspense>
    </CrashScreen>
  );
}
