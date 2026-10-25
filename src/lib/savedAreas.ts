import type { Boundary } from "../../shared/protocol";

// Saved play areas live on the host's own device.
const KEY = "mh:areas";

export interface SavedArea {
  name: string;
  boundary: Boundary;
}

export function loadAreas(): SavedArea[] {
  try {
    const list = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

export function saveArea(name: string, boundary: Boundary): SavedArea[] {
  const list = loadAreas().filter((a) => a.name !== name);
  list.unshift({ name, boundary });
  try {
    localStorage.setItem(KEY, JSON.stringify(list.slice(0, 20)));
  } catch {
    // storage full or blocked; the area just won't be remembered
  }
  return loadAreas();
}

export function deleteArea(name: string): SavedArea[] {
  try {
    localStorage.setItem(KEY, JSON.stringify(loadAreas().filter((a) => a.name !== name)));
  } catch {
    // ignore
  }
  return loadAreas();
}

export function describeBoundary(b: Boundary | null) {
  if (!b) return "Not set";
  return b.shape === "circle" ? `Circle · ${b.radius} m radius` : `Rectangle · ${b.width} × ${b.height} m`;
}
