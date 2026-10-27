// Small geometry helpers. Play areas are a few hundred meters wide, so a flat
// "meters east / meters north" approximation around a center point is plenty accurate.

import type { Boundary, LatLng } from "./protocol";

const M_PER_DEG_LAT = 110_574;
const mPerDegLng = (lat: number) => 111_320 * Math.cos((lat * Math.PI) / 180);

/** Meters east (x) and north (y) of origin. */
export function toLocal(origin: LatLng, p: LatLng): { x: number; y: number } {
  return {
    x: (p.lng - origin.lng) * mPerDegLng(origin.lat),
    y: (p.lat - origin.lat) * M_PER_DEG_LAT,
  };
}

export function fromLocal(origin: LatLng, x: number, y: number): LatLng {
  return {
    lat: origin.lat + y / M_PER_DEG_LAT,
    lng: origin.lng + x / mPerDegLng(origin.lat),
  };
}

export function distance(a: LatLng, b: LatLng): number {
  const { x, y } = toLocal(a, b);
  return Math.hypot(x, y);
}

/** Move `meters` from p in direction `bearingDeg` (0 = north, 90 = east). */
export function offset(p: LatLng, meters: number, bearingDeg: number): LatLng {
  const rad = (bearingDeg * Math.PI) / 180;
  return fromLocal(p, Math.sin(rad) * meters, Math.cos(rad) * meters);
}

export function bearing(from: LatLng, to: LatLng): number {
  const { x, y } = toLocal(from, to);
  return ((Math.atan2(x, y) * 180) / Math.PI + 360) % 360;
}

/** Rotate a local point into the rectangle's own frame. */
function toRectFrame(b: Extract<Boundary, { shape: "rect" }>, p: LatLng) {
  const { x, y } = toLocal(b.center, p);
  const r = (b.rotation * Math.PI) / 180;
  return { x: x * Math.cos(r) - y * Math.sin(r), y: x * Math.sin(r) + y * Math.cos(r) };
}

export function insideBoundary(b: Boundary, p: LatLng): boolean {
  if (b.shape === "circle") return distance(b.center, p) <= b.radius;
  const { x, y } = toRectFrame(b, p);
  return Math.abs(x) <= b.width / 2 && Math.abs(y) <= b.height / 2;
}

/** Radius of a circle that contains the whole boundary. */
export function boundaryExtent(b: Boundary): number {
  return b.shape === "circle" ? b.radius : Math.hypot(b.width, b.height) / 2;
}

/** Outline of the boundary as a closed ring of points. */
export function boundaryRing(b: Boundary, steps = 72): LatLng[] {
  if (b.shape === "circle") {
    const ring: LatLng[] = [];
    for (let i = 0; i <= steps; i++) ring.push(offset(b.center, b.radius, (i / steps) * 360));
    return ring;
  }
  const r = (b.rotation * Math.PI) / 180;
  const corners = [
    [-1, 1],
    [1, 1],
    [1, -1],
    [-1, -1],
    [-1, 1],
  ].map(([sx, sy]) => {
    const x = (sx * b.width) / 2;
    const y = (sy * b.height) / 2;
    // rotate clockwise by `rotation`
    return fromLocal(b.center, x * Math.cos(r) + y * Math.sin(r), -x * Math.sin(r) + y * Math.cos(r));
  });
  return corners;
}

/** The same shape, `factor` times the size, moved to `center`. */
export function scaleBoundary(b: Boundary, factor: number, center: LatLng = b.center): Boundary {
  return b.shape === "circle"
    ? { ...b, center, radius: b.radius * factor }
    : { ...b, center, width: b.width * factor, height: b.height * factor };
}

/** The point `t` of the way from a to b (t from 0 to 1). */
export function lerp(a: LatLng, b: LatLng, t: number): LatLng {
  return { lat: a.lat + (b.lat - a.lat) * t, lng: a.lng + (b.lng - a.lng) * t };
}

export function circleRing(center: LatLng, radius: number, steps = 48): LatLng[] {
  return boundaryRing({ shape: "circle", center, radius }, steps);
}

export function randomPointInBoundary(b: Boundary, margin = 0, rand = Math.random): LatLng {
  if (b.shape === "circle") {
    const r = Math.max(0, b.radius - margin) * Math.sqrt(rand());
    return offset(b.center, r, rand() * 360);
  }
  const x = (rand() - 0.5) * Math.max(0, b.width - margin * 2);
  const y = (rand() - 0.5) * Math.max(0, b.height - margin * 2);
  const r = (b.rotation * Math.PI) / 180;
  return fromLocal(b.center, x * Math.cos(r) + y * Math.sin(r), -x * Math.sin(r) + y * Math.cos(r));
}
