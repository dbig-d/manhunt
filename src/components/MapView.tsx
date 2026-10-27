import { memo, useEffect, useRef, useState } from "react";
import { LngLatBounds, Map as MlMap, Marker as MlMarker, setWorkerUrl, type GeoJSONSource } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
// MapLibre finds its background worker next to its own file, which breaks once Vite
// bundles it, so tell it exactly where the worker is.
import mapWorkerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?url";
import type * as GeoJSON from "geojson";
import type { Boundary, LatLng, Marker, Role, ZoneView } from "../../shared/protocol";
import { boundaryRing, circleRing } from "../../shared/geo";
import { DEFAULT_CENTER } from "../lib/location";
import { compassStore } from "../lib/heading";
import { formatClock } from "../lib/hooks";
import Icon from "./Icon";

setWorkerUrl(mapWorkerUrl);

// Free street map tiles (OpenStreetMap data), recolored to the Night Ops palette below.
const STYLE_URL = "https://tiles.openfreemap.org/styles/dark";

export interface MapPin {
  id: string;
  lat: number;
  lng: number;
  label: string;
  sub?: string;
  role: Role | null;
  kind: Marker["kind"];
  /** Meters, for fuzzy circles. */
  radius?: number;
  /** 0 (fresh) to 1 (old), used to fade pings as they age. */
  age?: number;
}

/** A plain dot with a CSS class (the recap uses these). */
export interface MapDot {
  id: string;
  lat: number;
  lng: number;
  className: string;
}

export interface MapLine {
  id: string;
  coords: LatLng[];
  color: string;
  opacity?: number;
}

interface Props {
  boundary: Boundary | null;
  pins?: MapPin[];
  me?: { pos: LatLng; accuracy: number | null; role: Role | null } | null;
  onMapClick?: (p: LatLng) => void;
  /** When this changes the map re-fits to the play area. */
  fitKey?: string;
  className?: string;
  showRecenter?: boolean;
  /** Your recent positions, drawn as a fading line. */
  trail?: LatLng[];
  /** Direction you're facing (degrees from north), shown as a cone. */
  heading?: number | null;
  /** Use the live compass for the cone instead of `heading`. */
  compass?: boolean;
  zones?: ZoneView[];
  /** For the zone countdown labels. */
  now?: number;
  myZoneId?: string | null;
  /** Where the storm will end up. */
  stormTarget?: Boundary | null;
  lines?: MapLine[];
  dots?: MapDot[];
  /** Night Time mode: a darker map. */
  night?: boolean;
}

const ROLE_COLOR: Record<string, string> = { seeker: "255,59,78", hider: "61,255,154", none: "230,238,247" };
const coords = (ring: LatLng[]) => ring.map((p) => [p.lng, p.lat]);
const WORLD = [[-180, -85], [180, -85], [180, 85], [-180, 85], [-180, -85]];

function featureCollection(features: GeoJSON.Feature[]): GeoJSON.FeatureCollection {
  return { type: "FeatureCollection", features };
}
function polygon(rings: number[][][], properties: GeoJSON.GeoJsonProperties = {}): GeoJSON.Feature {
  return { type: "Feature", properties, geometry: { type: "Polygon", coordinates: rings } };
}
function lineString(points: LatLng[], properties: GeoJSON.GeoJsonProperties = {}): GeoJSON.Feature {
  return { type: "Feature", properties, geometry: { type: "LineString", coordinates: coords(points) } };
}

/** Tint the stock dark map toward the Night Ops blue-black. */
function recolor(map: MlMap) {
  const paint: Record<string, [Parameters<MlMap["setPaintProperty"]>[1], string][]> = {
    background: [["background-color", "#05070b"]],
    water: [["fill-color", "#0a1624"]],
    waterway: [["line-color", "#0a1624"]],
    landuse_residential: [["fill-color", "#090d14"]],
    landcover_wood: [["fill-color", "#0c1d16"]],
    landuse_park: [["fill-color", "#0d2119"]],
    building: [["fill-color", "#131c2a"]],
    highway_path: [["line-color", "#243d33"]],
    highway_minor: [["line-color", "#223047"]],
    highway_major_casing: [["line-color", "#33476a"]],
    highway_major_inner: [["line-color", "#26354f"]],
    highway_major_subtle: [["line-color", "#26354f"]],
    highway_motorway_casing: [["line-color", "#33476a"]],
    highway_motorway_subtle: [["line-color", "#26354f"]],
  };
  for (const layer of map.getStyle().layers ?? []) {
    try {
      for (const [prop, value] of paint[layer.id] ?? []) map.setPaintProperty(layer.id, prop, value);
      if (layer.type === "symbol") {
        map.setPaintProperty(layer.id, "text-color", "#5d6f84");
        map.setPaintProperty(layer.id, "text-halo-color", "#05070b");
      }
    } catch {
      // layer without that property; skip
    }
  }
}

/** Keeps a set of HTML markers in sync with a list, creating and removing as needed. */
function syncMarkers<T extends { id: string; lat: number; lng: number }>(
  map: MlMap,
  store: Map<string, MlMarker>,
  items: T[],
  create: () => HTMLElement,
  update: (el: HTMLElement, item: T) => void,
) {
  const seen = new Set<string>();
  for (const item of items) {
    seen.add(item.id);
    let marker = store.get(item.id);
    if (!marker) {
      // MapLibre positions the outer element using its own CSS classes, so our
      // classes go on an inner element and never overwrite them.
      const outer = document.createElement("div");
      outer.appendChild(create());
      marker = new MlMarker({ element: outer, anchor: "center" }).setLngLat([item.lng, item.lat]).addTo(map);
      store.set(item.id, marker);
    }
    update(marker.getElement().firstElementChild as HTMLElement, item);
    marker.setLngLat([item.lng, item.lat]);
  }
  for (const [id, marker] of store) {
    if (!seen.has(id)) {
      marker.remove();
      store.delete(id);
    }
  }
}

function MapView({
  boundary,
  pins = [],
  me = null,
  onMapClick,
  fitKey,
  className,
  showRecenter,
  trail,
  heading,
  compass,
  zones,
  now = Date.now(),
  myZoneId,
  stormTarget,
  lines,
  dots,
  night,
}: Props) {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MlMap | null>(null);
  const pinMarkers = useRef(new Map<string, MlMarker>());
  const zoneMarkers = useRef(new Map<string, MlMarker>());
  const dotMarkers = useRef(new Map<string, MlMarker>());
  const meMarker = useRef<MlMarker | null>(null);
  const clickRef = useRef(onMapClick);
  clickRef.current = onMapClick;
  const [loaded, setLoaded] = useState(false);
  const initial = useRef({ boundary, me });

  // Create the map once.
  useEffect(() => {
    const start = initial.current.boundary?.center ?? initial.current.me?.pos ?? DEFAULT_CENTER;
    const map = new MlMap({
      container: container.current!,
      style: STYLE_URL,
      center: [start.lng, start.lat],
      zoom: 16,
      attributionControl: { compact: true },
      pitchWithRotate: false,
      // Lighter on phones: 3× screens draw at 2×, and tiles appear without fading in.
      pixelRatio: Math.min(window.devicePixelRatio || 1, 2),
      fadeDuration: 0,
    });
    mapRef.current = map;
    // Handles for poking at the map from the browser console while developing.
    if (import.meta.env.DEV) Object.assign(window, { __mhMap: map, __mhMarkers: pinMarkers.current });
    // The dark style references a texture it doesn't ship; give it a blank one.
    map.on("styleimagemissing", (e) => {
      if (!map.hasImage(e.id)) map.addImage(e.id, { width: 1, height: 1, data: new Uint8Array(4) });
    });
    // "style.load" fires as soon as the style is ready, without waiting for every tile.
    map.once("style.load", () => {
      recolor(map);
      const empty = featureCollection([]);
      for (const id of ["mh-outside", "mh-boundary", "mh-storm", "mh-zones", "mh-lines", "mh-fuzzy", "mh-accuracy"]) {
        map.addSource(id, { type: "geojson", data: empty });
      }
      map.addSource("mh-trail", { type: "geojson", data: empty, lineMetrics: true });
      map.addLayer({ id: "mh-outside", type: "fill", source: "mh-outside", paint: { "fill-color": "#000", "fill-opacity": 0.55 } });
      map.addLayer({
        id: "mh-storm",
        type: "line",
        source: "mh-storm",
        paint: { "line-color": "#ff3b4e", "line-width": 1.5, "line-dasharray": [1, 2], "line-opacity": 0.7 },
      });
      map.addLayer({
        id: "mh-boundary",
        type: "line",
        source: "mh-boundary",
        paint: { "line-color": ["get", "color"], "line-width": 2.2, "line-dasharray": [3, 2], "line-opacity": 0.95 },
      });
      map.addLayer({ id: "mh-zones-fill", type: "fill", source: "mh-zones", paint: { "fill-color": ["get", "color"], "fill-opacity": 0.16 } });
      map.addLayer({ id: "mh-zones-line", type: "line", source: "mh-zones", paint: { "line-color": ["get", "color"], "line-width": 2, "line-opacity": 0.9 } });
      map.addLayer({
        id: "mh-lines",
        type: "line",
        source: "mh-lines",
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": ["get", "color"], "line-width": 3, "line-opacity": ["get", "opacity"] },
      });
      map.addLayer({ id: "mh-accuracy", type: "fill", source: "mh-accuracy", paint: { "fill-color": "#d9e4f0", "fill-opacity": 0.06 } });
      map.addLayer({ id: "mh-trail", type: "line", source: "mh-trail", layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-width": 4 } });
      map.addLayer({ id: "mh-fuzzy-fill", type: "fill", source: "mh-fuzzy", paint: { "fill-color": "#3dff9a", "fill-opacity": ["get", "opacity"] } });
      map.addLayer({
        id: "mh-fuzzy-line",
        type: "line",
        source: "mh-fuzzy",
        paint: { "line-color": "#3dff9a", "line-width": 1.5, "line-dasharray": [2, 2], "line-opacity": ["*", ["get", "opacity"], 4] },
      });
      setLoaded(true);
    });
    map.on("click", (e) => clickRef.current?.({ lat: e.lngLat.lat, lng: e.lngLat.lng }));
    return () => {
      pinMarkers.current.clear();
      zoneMarkers.current.clear();
      dotMarkers.current.clear();
      meMarker.current = null;
      map.remove();
      mapRef.current = null;
    };
  }, []);

  const source = (id: string) => mapRef.current?.getSource(id) as GeoJSONSource | undefined;

  // Play area outline and the darkened outside. The storm shrinks it, so it turns red.
  const shrinking = !!stormTarget;
  useEffect(() => {
    if (!loaded) return;
    const ring = boundary ? coords(boundaryRing(boundary)) : null;
    source("mh-boundary")?.setData(featureCollection(ring ? [polygon([ring], { color: shrinking ? "#ff6b7a" : "#3dff9a" })] : []));
    source("mh-outside")?.setData(featureCollection(ring ? [polygon([WORLD, ring])] : []));
  }, [boundary, loaded, shrinking]);

  useEffect(() => {
    if (!loaded) return;
    source("mh-storm")?.setData(featureCollection(stormTarget ? [polygon([coords(boundaryRing(stormTarget))])] : []));
  }, [stormTarget, loaded]);

  // Fit the view to the play area when asked.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loaded) return;
    if (boundary) {
      const bounds = new LngLatBounds();
      for (const p of boundaryRing(boundary, 24)) bounds.extend([p.lng, p.lat]);
      map.fitBounds(bounds, { padding: 48, duration: 0, maxZoom: 18 });
    } else if (initial.current.me) {
      map.jumpTo({ center: [initial.current.me.pos.lng, initial.current.me.pos.lat] });
    }
    // Only refit when asked (fitKey), not every time the boundary is edited.
  }, [fitKey, loaded]);

  // Player pins and fuzzy circles.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loaded) return;
    syncMarkers(
      map,
      pinMarkers.current,
      pins,
      () => {
        const el = document.createElement("div");
        el.innerHTML = `<span class="pin-dot"></span><span class="pin-label"><b></b><small></small></span>`;
        return el;
      },
      (el, pin) => {
        el.className = `pin pin--${pin.role ?? "none"} pin--${pin.kind}`;
        el.style.opacity = String(1 - (pin.age ?? 0) * 0.55);
        el.querySelector("b")!.textContent = pin.label;
        el.querySelector("small")!.textContent = pin.sub ?? "";
      },
    );
    const fuzzy = pins
      .filter((p) => p.kind === "fuzzy" && p.radius)
      .map((p) => polygon([coords(circleRing(p, p.radius!))], { opacity: 0.2 * (1 - (p.age ?? 0) * 0.6) }));
    source("mh-fuzzy")?.setData(featureCollection(fuzzy));
  }, [pins, loaded]);

  // Safe zones: amber circles with a countdown; red when someone just walked in.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loaded) return;
    const list = zones ?? [];
    const color = (z: ZoneView) => (z.alert ? "#ff3b4e" : z.occupied ? "#3dff9a" : "#ffb020");
    source("mh-zones")?.setData(featureCollection(list.map((z) => polygon([coords(circleRing(z, z.radius))], { color: color(z) }))));
    syncMarkers(
      map,
      zoneMarkers.current,
      list,
      () => document.createElement("div"),
      (el, z) => {
        el.className = `zone-tag ${z.alert ? "zone-tag--alert" : z.occupied ? "zone-tag--busy" : ""}`;
        const left = formatClock(z.endsAt - now);
        el.textContent = z.alert
          ? "HIDER ENTERED"
          : z.id === myZoneId
            ? `IN ZONE · ${left}`
            : z.occupied === true
              ? `OCCUPIED · ${left}`
              : z.occupied === false
                ? `EMPTY · ${left}`
                : `SAFE ZONE · ${left}`;
      },
    );
  }, [zones, now, myZoneId, loaded]);

  // Plain dots (recap players and tags).
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loaded) return;
    syncMarkers(map, dotMarkers.current, dots ?? [], () => document.createElement("div"), (el, d) => (el.className = d.className));
  }, [dots, loaded]);

  // Lines (recap paths).
  useEffect(() => {
    if (!loaded) return;
    source("mh-lines")?.setData(
      featureCollection((lines ?? []).filter((l) => l.coords.length > 1).map((l) => lineString(l.coords, { color: l.color, opacity: l.opacity ?? 0.8 }))),
    );
  }, [lines, loaded]);

  // Your own position.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loaded) return;
    if (!me) {
      meMarker.current?.remove();
      meMarker.current = null;
      source("mh-accuracy")?.setData(featureCollection([]));
      return;
    }
    if (!meMarker.current) {
      const el = document.createElement("div");
      el.innerHTML = `<div class="pin-me"><div class="pin-me-cone"></div><span></span></div>`;
      // "map" alignment: the cone keeps pointing the right way when the map is rotated.
      meMarker.current = new MlMarker({ element: el, anchor: "center", rotationAlignment: "map" }).setLngLat([me.pos.lng, me.pos.lat]).addTo(map);
    }
    const inner = meMarker.current.getElement().firstElementChild as HTMLElement;
    inner.classList.remove("pin-me--seeker", "pin-me--hider", "pin-me--none");
    inner.classList.add(`pin-me--${me.role ?? "none"}`);
    meMarker.current.setLngLat([me.pos.lng, me.pos.lat]);
    const acc = me.accuracy && me.accuracy > 8 ? [polygon([coords(circleRing(me.pos, Math.min(me.accuracy, 200)))])] : [];
    source("mh-accuracy")?.setData(featureCollection(acc));
    // Depends on the parts of `me`, not the object, which is new on every render.
  }, [me?.pos, me?.accuracy, me?.role, loaded]);

  // Facing cone: live compass when there is one, otherwise the direction you've been moving.
  const meReady = !!me && loaded;
  useEffect(() => {
    const marker = meMarker.current;
    if (!meReady || !marker) return;
    const inner = marker.getElement().firstElementChild as HTMLElement;
    const show = (h: number | null) => {
      inner.classList.toggle("has-heading", h !== null);
      if (h !== null) marker.setRotation(h);
    };
    if (!compass) {
      show(heading ?? null);
      return;
    }
    let frame = 0;
    show(compassStore.get());
    const unsub = compassStore.subscribe((h) => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => show(h));
    });
    return () => {
      unsub();
      cancelAnimationFrame(frame);
    };
  }, [meReady, compass, heading]);

  // Trail of your last few steps, fading out behind you.
  const trailRole = me?.role ?? "none";
  useEffect(() => {
    if (!loaded) return;
    source("mh-trail")?.setData(featureCollection(trail && trail.length > 1 ? [lineString(trail)] : []));
  }, [trail, loaded]);
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loaded) return;
    const rgb = ROLE_COLOR[trailRole];
    map.setPaintProperty("mh-trail", "line-gradient", ["interpolate", ["linear"], ["line-progress"], 0, `rgba(${rgb},0)`, 1, `rgba(${rgb},0.7)`]);
  }, [trailRole, loaded]);

  return (
    <div className={`map ${night ? "map--night" : ""} ${className ?? ""}`}>
      <div ref={container} className="map-canvas" />
      {showRecenter && (
        <button
          className="map-recenter"
          aria-label="Center on me"
          onClick={() => me && mapRef.current?.easeTo({ center: [me.pos.lng, me.pos.lat], duration: 400 })}
        >
          <Icon name="crosshair" />
        </button>
      )}
    </div>
  );
}

// Re-render only when its inputs actually change.
export default memo(MapView);
