import type { Boundary, LatLng } from "./protocol";
import { lerp, scaleBoundary } from "./geo";

/** How far through its shrink the storm is (0 = not started, 1 = finished). */
export function stormProgress(now: number, start: number, end: number) {
  return Math.min(1, Math.max(0, (now - start) / Math.max(1, end - start)));
}

/**
 * The play area part-way through the storm: it shrinks to `finalPct` of its size while
 * sliding toward `center`. Shared by the server (the real rules) and the replay.
 */
export function stormBoundary(base: Boundary, center: LatLng, finalPct: number, progress: number): Boundary {
  if (progress <= 0) return base;
  return scaleBoundary(base, 1 - (1 - finalPct / 100) * progress, lerp(base.center, center, progress));
}
