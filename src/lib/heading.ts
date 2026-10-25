import { useCallback, useEffect, useRef, useState } from "react";
import type { LatLng } from "../../shared/protocol";
import { bearing, distance } from "../../shared/geo";

// Which way the phone is pointing, from its compass. Updates many times a second,
// so the map listens to this store directly instead of re-rendering React.

type Listener = (heading: number | null) => void;
let current: number | null = null;
const listeners = new Set<Listener>();

export const compassStore = {
  get: () => current,
  subscribe(fn: Listener) {
    listeners.add(fn);
    return () => void listeners.delete(fn);
  },
};

function publish(raw: number) {
  const angle = (screen.orientation?.angle ?? 0) as number;
  const target = (raw + angle + 360) % 360;
  if (current === null) current = target;
  else {
    // Smooth out jitter, going the short way round (359° → 1° is +2°, not -358°).
    const delta = ((target - current + 540) % 360) - 180;
    current = (current + delta * 0.25 + 360) % 360;
  }
  listeners.forEach((fn) => fn(current));
}

/** Compass heading from Android's absolute orientation (formula from the W3C spec). */
function headingFromOrientation(alpha: number, beta: number, gamma: number) {
  const r = Math.PI / 180;
  const [x, y, z] = [beta * r, gamma * r, alpha * r];
  const vx = -Math.cos(z) * Math.sin(y) - Math.sin(z) * Math.sin(x) * Math.cos(y);
  const vy = -Math.sin(z) * Math.sin(y) + Math.cos(z) * Math.sin(x) * Math.cos(y);
  let h = Math.atan(vx / vy);
  if (vy < 0) h += Math.PI;
  else if (vx < 0) h += 2 * Math.PI;
  return h / r;
}

type IOSOrientationEvent = DeviceOrientationEvent & { webkitCompassHeading?: number };
type PermissionCtor = { requestPermission?: () => Promise<"granted" | "denied"> };

export type CompassStatus = "starting" | "on" | "needs-permission" | "unavailable";

/**
 * Turns the compass on. We start listening straight away (works on Android); if nothing
 * arrives and the browser has a permission prompt (iPhones), we ask for a tap on "Enable".
 */
export function useCompass(active: boolean) {
  const canAsk = typeof (window.DeviceOrientationEvent as unknown as PermissionCtor)?.requestPermission === "function";
  const [attempt, setAttempt] = useState(0);
  const [status, setStatus] = useState<CompassStatus>("starting");

  useEffect(() => {
    if (!active) return;
    let gotReading = false;
    const onIOS = (e: Event) => {
      const h = (e as IOSOrientationEvent).webkitCompassHeading;
      if (typeof h === "number" && !Number.isNaN(h)) {
        gotReading = true;
        publish(h);
      }
    };
    const onAbsolute = (e: Event) => {
      const o = e as DeviceOrientationEvent;
      if (o.alpha === null || o.beta === null || o.gamma === null) return;
      gotReading = true;
      publish(headingFromOrientation(o.alpha, o.beta, o.gamma));
    };
    const onRelative = (e: Event) => {
      if ((e as DeviceOrientationEvent).absolute) onAbsolute(e);
      else onIOS(e);
    };
    const hasAbsolute = "ondeviceorientationabsolute" in window;
    if (hasAbsolute) window.addEventListener("deviceorientationabsolute", onAbsolute);
    else window.addEventListener("deviceorientation", onRelative);
    // Nothing yet: either it needs permission (iPhone) or there's no compass (laptop).
    const check = setTimeout(() => {
      if (!gotReading) setStatus(canAsk && attempt === 0 ? "needs-permission" : "unavailable");
    }, 1500);
    const firstReading = compassStore.subscribe((h) => {
      if (h === null) return;
      setStatus("on");
      firstReading();
    });
    return () => {
      clearTimeout(check);
      firstReading();
      window.removeEventListener("deviceorientationabsolute", onAbsolute);
      window.removeEventListener("deviceorientation", onRelative);
      current = null;
      listeners.forEach((fn) => fn(null));
    };
  }, [active, attempt, canAsk]);

  const request = useCallback(async () => {
    const ctor = window.DeviceOrientationEvent as unknown as PermissionCtor;
    if (!ctor?.requestPermission) return;
    try {
      const answer = await ctor.requestPermission();
      if (answer === "granted") {
        setStatus("starting");
        setAttempt((n) => n + 1); // listen again, now with permission
      } else setStatus("unavailable");
    } catch {
      setStatus("unavailable");
    }
  }, []);

  return { status, request };
}

const TRAIL_STEP_M = 2;
const TRAIL_MAX_POINTS = 25;
const HEADING_FROM_M = 4;

/**
 * Your last few steps, for a trail on the map, plus the direction you've been moving,
 * which stands in for the compass when there isn't one.
 */
export function useTrail(pos: LatLng | null) {
  const [trail, setTrail] = useState<LatLng[]>([]);
  const last = useRef<LatLng | null>(null);

  useEffect(() => {
    if (!pos) return;
    if (last.current && distance(last.current, pos) < TRAIL_STEP_M) return;
    // A jump of more than ~50 m (teleport or GPS glitch) starts a fresh trail.
    const jumped = last.current && distance(last.current, pos) > 50;
    last.current = pos;
    setTrail((t) => (jumped ? [pos] : [...t, pos].slice(-TRAIL_MAX_POINTS)));
  }, [pos]);

  let heading: number | null = null;
  if (pos && trail.length > 1) {
    for (let i = trail.length - 2; i >= 0; i--) {
      if (distance(trail[i], pos) >= HEADING_FROM_M) {
        heading = bearing(trail[i], pos);
        break;
      }
    }
  }
  return { trail: pos ? [...trail.slice(0, -1), pos] : trail, heading };
}
