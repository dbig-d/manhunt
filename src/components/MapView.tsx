import { useEffect, useRef, useState } from "react";
import { LngLatBounds, Map as MlMap, Marker as MlMarker, setWorkerUrl, type GeoJSONSource } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
// MapLibre finds its background worker next to its own file, which breaks once Vite
// bundles it, so tell it exactly where the worker is.
import mapWorkerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?url";
import type * as GeoJSON from "geojson";
import type { Boundary, LatLng, Marker, Role } from "../../shared/protocol";
import { boundaryRing, circleRing } from "../../shared/geo";
import { DEFAULT_CENTER } from "../lib/location";
import { compassStore } from "../lib/heading";

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

interface Props {
  boundary: Boundary | null;
  pins: MapPin[];
  me: { pos: LatLng; accuracy: number | null; role: Role | null } | null;
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
}

const ROLE_COLOR: Record<string, string> = { seeker: "255,59,78", hider: "61,255,154", none: "217,228,240" };

const coords = (ring: LatLng[]) => ring.map((p) => [p.lng, p.lat]);
const WORLD = [[-180, -85], [180, -85], [180, 85], [-180, 85], [-180, -85]];

function featureCollection(features: GeoJSON.Feature[]): GeoJSON.FeatureCollection {
  return { type: "FeatureCollection", features };
}
function polygon(rings: number[][][]): GeoJSON.Feature {
  return { type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: rings } };
}

/** Tint the stock dark map toward the Night Ops blue-black. */
function recolor(map: MlMap) {
  const paint: Record<string, [Parameters<MlMap["setPaintProperty"]>[1], string][]> = {
    background: [["background-color", "#070a0f"]],
    water: [["fill-color", "#0a1624"]],
    waterway: [["line-color", "#0a1624"]],
    landuse_residential: [["fill-color", "#0a0e15"]],
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
        map.setPaintProperty(layer.id, "text-halo-color", "#070a0f");
      }
    } catch {
      // layer without that property; skip
    }
  }
}

export default function MapView({ boundary, pins, me, onMapClick, fitKey, className, showRecenter, trail, heading, compass }: Props) {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MlMap | null>(null);
  const markers = useRef(new Map<string, MlMarker>());
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
    });
    mapRef.current = map;
    // Handles for poking at the map from the browser console while developing.
    if (import.meta.env.DEV) Object.assign(window, { __mhMap: map, __mhMarkers: markers.current });
    // The dark style references a texture it doesn't ship; give it a blank one.
    map.on("styleimagemissing", (e) => {
      if (!map.hasImage(e.id)) map.addImage(e.id, { width: 1, height: 1, data: new Uint8Array(4) });
    });
    // "style.load" fires as soon as the style is ready, without waiting for every tile.
    map.once("style.load", () => {
      recolor(map);
      const empty = featureCollection([]);
      map.addSource("mh-outside", { type: "geojson", data: empty });
      map.addSource("mh-boundary", { type: "geojson", data: empty });
      map.addSource("mh-fuzzy", { type: "geojson", data: empty });
      map.addSource("mh-accuracy", { type: "geojson", data: empty });
      map.addSource("mh-trail", { type: "geojson", data: empty, lineMetrics: true });
      map.addLayer({ id: "mh-outside", type: "fill", source: "mh-outside", paint: { "fill-color": "#000", "fill-opacity": 0.55 } });
      map.addLayer({
        id: "mh-boundary",
        type: "line",
        source: "mh-boundary",
        paint: { "line-color": "#3dff9a", "line-width": 2, "line-dasharray": [3, 2], "line-opacity": 0.9 },
      });
      map.addLayer({ id: "mh-accuracy", type: "fill", source: "mh-accuracy", paint: { "fill-color": "#d9e4f0", "fill-opacity": 0.06 } });
      map.addLayer({
        id: "mh-trail",
        type: "line",
        source: "mh-trail",
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-width": 4 },
      });
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
      markers.current.clear();
      meMarker.current = null;
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // Play area outline and the darkened outside.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loaded) return;
    const ring = boundary ? coords(boundaryRing(boundary)) : null;
    (map.getSource("mh-boundary") as GeoJSONSource).setData(featureCollection(ring ? [polygon([ring])] : []));
    (map.getSource("mh-outside") as GeoJSONSource).setData(featureCollection(ring ? [polygon([WORLD, ring])] : []));
  }, [boundary, loaded]);

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
    const seen = new Set<string>();
    for (const pin of pins) {
      seen.add(pin.id);
      let marker = markers.current.get(pin.id);
      if (!marker) {
        // MapLibre positions the outer element using its own CSS classes, so our
        // classes go on an inner element and never overwrite them.
        const el = document.createElement("div");
        el.innerHTML = `<div class="pin"><span class="pin-dot"></span><span class="pin-label"><b></b><small></small></span></div>`;
        marker = new MlMarker({ element: el, anchor: "center" }).setLngLat([pin.lng, pin.lat]).addTo(map);
        markers.current.set(pin.id, marker);
      }
      const el = marker.getElement().firstElementChild as HTMLElement;
      el.className = `pin pin--${pin.role ?? "none"} pin--${pin.kind}`;
      el.style.opacity = String(1 - (pin.age ?? 0) * 0.55);
      el.querySelector("b")!.textContent = pin.label;
      el.querySelector("small")!.textContent = pin.sub ?? "";
      marker.setLngLat([pin.lng, pin.lat]);
    }
    for (const [id, marker] of markers.current) {
      if (!seen.has(id)) {
        marker.remove();
        markers.current.delete(id);
      }
    }
    const fuzzy = pins
      .filter((p) => p.kind === "fuzzy" && p.radius)
      .map((p) => ({ ...polygon([coords(circleRing(p, p.radius!))]), properties: { opacity: 0.2 * (1 - (p.age ?? 0) * 0.6) } }));
    (map.getSource("mh-fuzzy") as GeoJSONSource).setData(featureCollection(fuzzy));
  }, [pins, loaded]);

  // Your own position.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loaded) return;
    if (!me) {
      meMarker.current?.remove();
      meMarker.current = null;
      (map.getSource("mh-accuracy") as GeoJSONSource).setData(featureCollection([]));
      return;
    }
    if (!meMarker.current) {
      const el = document.createElement("div");
      el.innerHTML = `<div class="pin-me"><div class="pin-me-cone"></div><span></span></div>`;
      // "map" alignment: the cone keeps pointing the right way when the map is rotated.
      meMarker.current = new MlMarker({ element: el, anchor: "center", rotationAlignment: "map" })
        .setLngLat([me.pos.lng, me.pos.lat])
        .addTo(map);
    }
    const inner = meMarker.current.getElement().firstElementChild as HTMLElement;
    inner.classList.remove("pin-me--seeker", "pin-me--hider", "pin-me--none");
    inner.classList.add(`pin-me--${me.role ?? "none"}`);
    meMarker.current.setLngLat([me.pos.lng, me.pos.lat]);
    const acc = me.accuracy && me.accuracy > 8 ? [polygon([coords(circleRing(me.pos, Math.min(me.accuracy, 200)))])] : [];
    (map.getSource("mh-accuracy") as GeoJSONSource).setData(featureCollection(acc));
  }, [me, loaded]);

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
    const map = mapRef.current;
    if (!map || !loaded) return;
    const line: GeoJSON.Feature[] =
      trail && trail.length > 1
        ? [{ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: coords(trail) } }]
        : [];
    (map.getSource("mh-trail") as GeoJSONSource).setData(featureCollection(line));
  }, [trail, loaded]);
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loaded) return;
    const rgb = ROLE_COLOR[trailRole];
    map.setPaintProperty("mh-trail", "line-gradient", ["interpolate", ["linear"], ["line-progress"], 0, `rgba(${rgb},0)`, 1, `rgba(${rgb},0.7)`]);
  }, [trailRole, loaded]);

  return (
    <div className={`map ${className ?? ""}`}>
      <div ref={container} className="map-canvas" />
      {showRecenter && (
        <button
          className="map-recenter"
          aria-label="Center on me"
          onClick={() => me && mapRef.current?.easeTo({ center: [me.pos.lng, me.pos.lat], duration: 400 })}
        >
          ◎
        </button>
      )}
    </div>
  );
}
