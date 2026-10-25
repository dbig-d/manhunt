import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { LatLng } from "../../shared/protocol";
import { offset } from "../../shared/geo";

// Used when there's no GPS and no play area yet.
export const DEFAULT_CENTER: LatLng = { lat: 51.5073, lng: -0.1657 };

export interface Gps {
  pos: LatLng | null;
  accuracy: number | null;
  /** Last time the position changed or was confirmed (ms). */
  updatedAt: number | null;
  error: string | null;
  /** Testing: fake GPS you move with the keyboard or by clicking the map. */
  simulated: boolean;
  setSimulated: (on: boolean) => void;
  /** Teleport (simulated only). */
  setSimPos: (p: LatLng) => void;
}

const GpsContext = createContext<Gps | null>(null);

const SIM_KEY = "mh:sim";
const SIM_POS_KEY = "mh:simpos";
const WALK_MS = 1.6;
const RUN_MS = 4.5;

function readSimPos(): LatLng | null {
  try {
    return JSON.parse(sessionStorage.getItem(SIM_POS_KEY) ?? "null");
  } catch {
    return null;
  }
}

export function GpsProvider({ children }: { children: ReactNode }) {
  const [simulated, setSimulatedState] = useState(() => sessionStorage.getItem(SIM_KEY) === "1");
  const [real, setReal] = useState<{ pos: LatLng; accuracy: number; at: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sim, setSim] = useState<{ pos: LatLng; at: number } | null>(() => {
    const p = readSimPos();
    return p ? { pos: p, at: Date.now() } : null;
  });
  const simRef = useRef(sim);
  simRef.current = sim;

  // Real GPS
  useEffect(() => {
    if (simulated) return;
    if (!("geolocation" in navigator)) {
      setError("This browser has no location access");
      return;
    }
    const id = navigator.geolocation.watchPosition(
      (p) => {
        setError(null);
        setReal({ pos: { lat: p.coords.latitude, lng: p.coords.longitude }, accuracy: p.coords.accuracy, at: Date.now() });
      },
      (e) => {
        setError(
          e.code === e.PERMISSION_DENIED
            ? "Location permission was denied"
            : e.code === e.TIMEOUT
              ? "Waiting for a GPS fix…"
              : "Couldn't get your location",
        );
      },
      { enableHighAccuracy: true, maximumAge: 2000, timeout: 20_000 },
    );
    return () => navigator.geolocation.clearWatch(id);
  }, [simulated]);

  const setSimPos = useCallback((p: LatLng) => {
    setSim({ pos: p, at: Date.now() });
    sessionStorage.setItem(SIM_POS_KEY, JSON.stringify(p));
  }, []);

  const setSimulated = useCallback(
    (on: boolean) => {
      sessionStorage.setItem(SIM_KEY, on ? "1" : "0");
      setSimulatedState(on);
      if (on && !simRef.current) setSimPos(real?.pos ?? DEFAULT_CENTER);
    },
    [real, setSimPos],
  );

  // Simulated walking: WASD / arrow keys, hold Shift to run.
  useEffect(() => {
    if (!simulated) return;
    const held = new Set<string>();
    const keyDir: Record<string, [number, number]> = {
      w: [0, 1], arrowup: [0, 1], s: [0, -1], arrowdown: [0, -1],
      a: [-1, 0], arrowleft: [-1, 0], d: [1, 0], arrowright: [1, 0],
    };
    let running = false;
    const typing = (e: KeyboardEvent) => e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement;
    const down = (e: KeyboardEvent) => {
      if (typing(e)) return;
      const k = e.key.toLowerCase();
      running = e.shiftKey;
      if (keyDir[k]) {
        held.add(k);
        e.preventDefault();
      }
    };
    const up = (e: KeyboardEvent) => {
      held.delete(e.key.toLowerCase());
      running = e.shiftKey;
    };
    const timer = setInterval(() => {
      const cur = simRef.current;
      if (!held.size || !cur) return;
      let x = 0;
      let y = 0;
      held.forEach((k) => {
        x += keyDir[k][0];
        y += keyDir[k][1];
      });
      if (!x && !y) return;
      const step = (running ? RUN_MS : WALK_MS) * 0.1;
      setSimPos(offset(cur.pos, step, (Math.atan2(x, y) * 180) / Math.PI));
    }, 100);
    const blur = () => held.clear();
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", blur);
    return () => {
      clearInterval(timer);
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", blur);
    };
  }, [simulated, setSimPos]);

  const value = useMemo<Gps>(
    () =>
      simulated
        ? { pos: sim?.pos ?? null, accuracy: 5, updatedAt: sim?.at ?? null, error: null, simulated, setSimulated, setSimPos }
        : {
            pos: real?.pos ?? null,
            accuracy: real?.accuracy ?? null,
            updatedAt: real?.at ?? null,
            error,
            simulated,
            setSimulated,
            setSimPos,
          },
    [simulated, sim, real, error, setSimulated, setSimPos],
  );

  return <GpsContext.Provider value={value}>{children}</GpsContext.Provider>;
}

export function useGps(): Gps {
  const gps = useContext(GpsContext);
  if (!gps) throw new Error("useGps needs a GpsProvider");
  return gps;
}
