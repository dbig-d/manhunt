import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { LatLng } from "../../shared/protocol";
import { offset } from "../../shared/geo";

// Used when there's no GPS and no play area yet.
export const DEFAULT_CENTER: LatLng = { lat: 51.5073, lng: -0.1657 };

/**
 * needs-permission: we haven't asked yet (waiting for a tap on "Allow location").
 * asking: the phone's permission prompt is up. searching: allowed, waiting for a GPS fix.
 * on: we know where you are. denied: blocked in the browser or phone settings.
 * unavailable: this browser can't share location at all.
 */
export type LocationStatus = "needs-permission" | "asking" | "searching" | "on" | "denied" | "unavailable";

export interface Gps {
  pos: LatLng | null;
  accuracy: number | null;
  /** Last time the position changed or was confirmed (ms). */
  updatedAt: number | null;
  error: string | null;
  status: LocationStatus;
  /** Ask for location. Call it straight from a tap: that's when iPhones show their prompt. */
  request: () => void;
  /** Testing: fake GPS you move with the keyboard or by clicking the map. */
  simulated: boolean;
  setSimulated: (on: boolean) => void;
  /** Teleport (simulated only). */
  setSimPos: (p: LatLng) => void;
}

const GpsContext = createContext<Gps | null>(null);

const SIM_KEY = "mh:sim";
const SIM_POS_KEY = "mh:simpos";
/** Set once location has worked on this device, so later visits start it straight away. */
const OK_KEY = "mh:location-ok";
const GPS_OPTIONS: PositionOptions = { enableHighAccuracy: true, maximumAge: 2000, timeout: 20_000 };

const remember = (ok: boolean) => {
  try {
    if (ok) localStorage.setItem(OK_KEY, "1");
    else localStorage.removeItem(OK_KEY);
  } catch {
    // not important
  }
};
const rememberedOk = () => {
  try {
    return localStorage.getItem(OK_KEY) === "1";
  } catch {
    return false;
  }
};
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
  const [status, setStatus] = useState<LocationStatus>("needs-permission");
  const [watching, setWatching] = useState(false);
  const [sim, setSim] = useState<{ pos: LatLng; at: number } | null>(() => {
    const p = readSimPos();
    return p ? { pos: p, at: Date.now() } : null;
  });
  const simRef = useRef(sim);
  simRef.current = sim;

  // Real GPS, step 1: can we start without asking? (Already allowed, or allowed on an
  // earlier visit.) If not, wait for the player to tap "Allow location": asking on page
  // load is what made iPhones skip the prompt or refuse silently.
  useEffect(() => {
    if (simulated) return;
    if (!("geolocation" in navigator) || !window.isSecureContext) {
      setStatus("unavailable");
      return;
    }
    let perm: PermissionStatus | null = null;
    let cancelled = false;
    const apply = (state: PermissionState) => {
      if (state === "granted") setWatching(true);
      else if (state === "denied") {
        setWatching(false);
        setStatus("denied");
      } else setStatus((s) => (s === "denied" ? "needs-permission" : s));
    };
    const onChange = () => perm && apply(perm.state);
    const check = () =>
      navigator.permissions
        ?.query({ name: "geolocation" as PermissionName })
        .then((p) => {
          if (cancelled) return;
          perm?.removeEventListener("change", onChange);
          perm = p;
          apply(p.state);
          p.addEventListener("change", onChange);
        })
        .catch(() => {});
    check();
    if (rememberedOk()) setWatching(true);
    // Coming back from the Settings app after allowing location: check again.
    const onVisible = () => document.visibilityState === "visible" && check();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      perm?.removeEventListener("change", onChange);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [simulated]);

  // Step 2: once allowed, follow the position.
  useEffect(() => {
    if (simulated || !watching) return;
    setStatus((s) => (s === "on" ? s : "searching"));
    const id = navigator.geolocation.watchPosition(
      (p) => {
        setStatus("on");
        remember(true);
        setReal({ pos: { lat: p.coords.latitude, lng: p.coords.longitude }, accuracy: p.coords.accuracy, at: Date.now() });
      },
      (e) => {
        if (e.code === e.PERMISSION_DENIED) {
          remember(false);
          setWatching(false);
          setStatus("denied");
        } else setStatus((s) => (s === "on" ? s : "searching")); // no fix yet; keep waiting
      },
      GPS_OPTIONS,
    );
    return () => navigator.geolocation.clearWatch(id);
  }, [simulated, watching]);

  const request = useCallback(() => {
    if (!("geolocation" in navigator)) return;
    setStatus("asking");
    // Called straight from the tap, so iPhones show their "Allow location?" prompt.
    navigator.geolocation.getCurrentPosition(
      (p) => {
        remember(true);
        setReal({ pos: { lat: p.coords.latitude, lng: p.coords.longitude }, accuracy: p.coords.accuracy, at: Date.now() });
        setStatus("on");
        setWatching(true);
      },
      (e) => {
        if (e.code === e.PERMISSION_DENIED) {
          remember(false);
          setStatus("denied");
        } else {
          setWatching(true);
          setStatus("searching");
        }
      },
      { ...GPS_OPTIONS, maximumAge: 0 },
    );
  }, []);

  const error =
    status === "denied"
      ? "Location is blocked for this site"
      : status === "unavailable"
        ? "This browser can't share your location"
        : status === "needs-permission"
          ? "Location isn't turned on yet"
          : status === "searching" || status === "asking"
            ? "Finding your location…"
            : null;

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
        ? { pos: sim?.pos ?? null, accuracy: 5, updatedAt: sim?.at ?? null, error: null, status: "on", request, simulated, setSimulated, setSimPos }
        : {
            pos: real?.pos ?? null,
            accuracy: real?.accuracy ?? null,
            updatedAt: real?.at ?? null,
            error,
            status,
            request,
            simulated,
            setSimulated,
            setSimPos,
          },
    [simulated, sim, real, error, status, request, setSimulated, setSimPos],
  );

  return <GpsContext.Provider value={value}>{children}</GpsContext.Provider>;
}

export function useGps(): Gps {
  const gps = useContext(GpsContext);
  if (!gps) throw new Error("useGps needs a GpsProvider");
  return gps;
}
