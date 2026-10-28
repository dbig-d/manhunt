import { useEffect, useMemo, useRef, useState } from "react";
import { LngLatBounds, type GeoJSONSource, type Map as MlMap } from "maplibre-gl";
import type * as GeoJSON from "geojson";
import type { Boundary, LatLng, Recap, Role } from "../../shared/protocol";
import { boundaryRing, circleRing, fromLocal } from "../../shared/geo";
import { stormBoundary, stormProgress } from "../../shared/storm";
import { ITEM_BY_ID } from "../../shared/items";
import Icon, { type IconName } from "../components/Icon";
import { createThemedMap, MAP_THEME } from "../components/MapView";
import { Segmented } from "../components/ui";
import { accentHex, useTheme } from "../lib/theme";

// ---------- the timeline, worked out once ----------

interface Life {
  from: number;
  to: number;
  role: Role;
}

interface Actor {
  id: string;
  name: string;
  xs: number[];
  ys: number[];
  ts: number[];
  /** When they were in play, and on which team. Gaps are time spent out (spectating). */
  lives: Life[];
}

interface Moment {
  t: number;
  icon: IconName;
  tone: "accent" | "seeker" | "hider" | "zone" | "info";
  text: string;
  /** Where to flash a ring on the map. */
  at?: LatLng;
  /** Marked on the timeline under the scrubber. */
  mark?: boolean;
  ping?: boolean;
}

function buildModel(recap: Recap) {
  const toLL = (x: number, y: number) => fromLocal(recap.origin, x, y);
  const name = (id: string | null) => recap.players.find((p) => p.id === id)?.name ?? "Someone";
  const events = [...recap.events].sort((a, b) => a.t - b.t);

  const actors: Actor[] = recap.players.map((p) => {
    const flat = recap.tracks[p.id] ?? [];
    const xs: number[] = [];
    const ys: number[] = [];
    const ts: number[] = [];
    for (let i = 0; i + 2 < flat.length; i += 3) {
      xs.push(flat[i]);
      ys.push(flat[i + 1]);
      ts.push(flat[i + 2]);
    }
    const lives: Life[] = [];
    let cur: Life | null = { from: 0, to: recap.durationS, role: p.startRole };
    for (const e of events) {
      if (!("playerId" in e) || e.playerId !== p.id) continue;
      if (e.kind === "tag" || e.kind === "left") {
        if (cur) lives.push({ ...cur, to: e.t });
        cur = e.kind === "tag" && e.converted ? { from: e.t, to: recap.durationS, role: "seeker" } : null;
      } else if (e.kind === "revive" && !cur) {
        cur = { from: e.t, to: recap.durationS, role: "hider" };
      }
    }
    if (cur) lives.push(cur);
    return { id: p.id, name: p.name, xs, ys, ts, lives };
  });

  const moments: Moment[] = [];
  for (const e of events) {
    switch (e.kind) {
      case "hunt":
        moments.push({ t: e.t, icon: "run", tone: "accent", text: "Head start over. The hunt is on", mark: true });
        break;
      case "ping":
        moments.push({ t: e.t, icon: "radar", tone: "info", text: "", ping: true });
        break;
      case "storm":
        moments.push({ t: e.t, icon: "storm", tone: "seeker", text: "The storm started closing in", mark: true });
        break;
      case "tag": {
        const who = name(e.playerId);
        const text = e.oob
          ? `${who} left the area and was eliminated`
          : `${e.byId ? name(e.byId) : "A seeker"} tagged ${who}. ${who} ${e.converted ? "joined the seekers" : "is now spectating"}`;
        moments.push({ t: e.t, icon: e.converted ? "virus" : "target", tone: "seeker", text, at: toLL(e.x, e.y), mark: true });
        break;
      }
      case "revive":
        moments.push({ t: e.t, icon: "hand", tone: "hider", text: `${name(e.playerId)} was revived and is back in` });
        break;
      case "left":
        moments.push({ t: e.t, icon: "logout", tone: "info", text: `${name(e.playerId)} left the game` });
        break;
      case "item":
        moments.push({ t: e.t, icon: "bag", tone: "zone", text: `${name(e.playerId)} used ${ITEM_BY_ID[e.item]?.name ?? "a power-up"}` });
        break;
    }
  }
  for (const z of recap.zones) moments.push({ t: z.from, icon: "shield", tone: "zone", text: "A safe zone opened", at: toLL(z.x, z.y), mark: true });
  const ending = { hiders: "Time's up. Hiders win", seekers: "Every hider caught. Seekers win", none: "The host ended the game" }[recap.winner];
  moments.push({ t: recap.durationS, icon: "trophy", tone: "accent", text: ending });
  moments.sort((a, b) => a.t - b.t);

  return { actors, moments, toLL };
}

/** Where an actor was at time t, smoothly between recorded points. */
function positionAt(a: Actor, t: number): [number, number] | null {
  const n = a.ts.length;
  if (!n) return null;
  if (t <= a.ts[0]) return [a.xs[0], a.ys[0]];
  if (t >= a.ts[n - 1]) return [a.xs[n - 1], a.ys[n - 1]];
  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (a.ts[mid] <= t) lo = mid;
    else hi = mid;
  }
  const f = (t - a.ts[lo]) / Math.max(0.001, a.ts[hi] - a.ts[lo]);
  return [a.xs[lo] + (a.xs[hi] - a.xs[lo]) * f, a.ys[lo] + (a.ys[hi] - a.ys[lo]) * f];
}

function roleAt(a: Actor, t: number): Role | null {
  for (const l of a.lives) if (t >= l.from && (t < l.to || (t === l.to && l.to >= a.lives[a.lives.length - 1].to))) return l.role;
  return null;
}

function clock(s: number) {
  const t = Math.max(0, Math.floor(s));
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`;
}

// ---------- map drawing helpers ----------

const fc = (features: GeoJSON.Feature[]): GeoJSON.FeatureCollection => ({ type: "FeatureCollection", features });
const ring = (pts: LatLng[]) => pts.map((p) => [p.lng, p.lat]);
const poly = (pts: LatLng[], properties: GeoJSON.GeoJsonProperties = {}): GeoJSON.Feature => ({ type: "Feature", properties, geometry: { type: "Polygon", coordinates: [ring(pts)] } });
const point = (p: LatLng, properties: GeoJSON.GeoJsonProperties = {}): GeoJSON.Feature => ({ type: "Feature", properties, geometry: { type: "Point", coordinates: [p.lng, p.lat] } });
const WORLD = [[-180, -85], [180, -85], [180, 85], [-180, 85], [-180, -85]];

/** How much of the recent path follows each dot (game seconds). */
const TRAIL_S = 45;
/** A flash ring lasts this long on screen (real milliseconds). */
const FLASH_MS = 900;
/** Normal speed plays the whole match in about this long (real seconds). */
const NORMAL_PLAY_S = 40;
const SPEEDS = { slow: 0.5, normal: 1, fast: 2 } as const;

/**
 * The match replay: a fast-forwarded map of everyone's positions from the start of the
 * head start to the end, with tags, players switching sides or spectating, safe zones,
 * and the storm, all as they really happened.
 *
 * Built for phones: the moving parts are drawn by the map's own graphics engine (no page
 * elements per player), redrawn at most 30 times a second, and only while on screen.
 */
export default function Replay({ recap }: { recap: Recap }) {
  const theme = useTheme();
  const palette = MAP_THEME[theme.mode];
  const accent = accentHex(theme);
  const model = useMemo(() => buildModel(recap), [recap]);
  const marks = useMemo(() => model.moments.filter((m) => m.mark), [model]);

  const wrap = useRef<HTMLDivElement>(null);
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MlMap | null>(null);
  const tRef = useRef(0);
  const playingRef = useRef(false);
  const cursor = useRef(0);
  const flashes = useRef<{ at: LatLng; start: number; color: string }[]>([]);

  const [ready, setReady] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [shownT, setShownT] = useState(0);
  const [speed, setSpeed] = useState<keyof typeof SPEEDS>("normal");
  const [names, setNames] = useState(true);
  const [trails, setTrails] = useState(true);
  const [full, setFull] = useState(false);
  const [feed, setFeed] = useState<(Moment & { key: number })[]>([]);
  playingRef.current = playing;

  const opts = useRef({ names, trails, speed });
  opts.current = { names, trails, speed };
  const rate = useMemo(() => Math.min(240, Math.max(6, recap.durationS / NORMAL_PLAY_S)), [recap.durationS]);

  // Create the map (once per theme) with all the replay layers.
  useEffect(() => {
    const map = createThemedMap(container.current!, theme.mode, recap.boundary.center, 15);
    mapRef.current = map;
    map.once("style.load", () => {
      const empty = fc([]);
      for (const id of ["rp-outside", "rp-base", "rp-storm", "rp-target", "rp-zones", "rp-tags", "rp-rings", "rp-dots"]) map.addSource(id, { type: "geojson", data: empty });
      map.addSource("rp-trails", { type: "geojson", data: empty, lineMetrics: true });
      map.addLayer({ id: "rp-outside", type: "fill", source: "rp-outside", paint: { "fill-color": palette.outside[0], "fill-opacity": palette.outside[1] } });
      map.addLayer({ id: "rp-base", type: "line", source: "rp-base", paint: { "line-color": accent, "line-width": 2, "line-dasharray": [3, 2], "line-opacity": ["get", "o"] } });
      map.addLayer({ id: "rp-target", type: "line", source: "rp-target", paint: { "line-color": palette.seeker, "line-width": 1.5, "line-dasharray": [1, 2], "line-opacity": 0.6 } });
      map.addLayer({ id: "rp-storm", type: "line", source: "rp-storm", paint: { "line-color": palette.seeker, "line-width": 2.5, "line-opacity": 0.9 } });
      map.addLayer({ id: "rp-zones-fill", type: "fill", source: "rp-zones", paint: { "fill-color": palette.zone, "fill-opacity": ["get", "o"] } });
      map.addLayer({ id: "rp-zones-line", type: "line", source: "rp-zones", paint: { "line-color": palette.zone, "line-width": 1.5, "line-opacity": 0.85 } });
      for (const role of ["hider", "seeker"] as const) {
        map.addLayer({
          id: `rp-trails-${role}`,
          type: "line",
          source: "rp-trails",
          filter: ["==", ["get", "role"], role],
          layout: { "line-cap": "round", "line-join": "round" },
          paint: {
            "line-width": 3,
            "line-gradient": ["interpolate", ["linear"], ["line-progress"], 0, `rgba(${palette.roleRgb[role]},0)`, 1, `rgba(${palette.roleRgb[role]},0.75)`],
          },
        });
      }
      map.addLayer({ id: "rp-tags", type: "circle", source: "rp-tags", paint: { "circle-radius": 5, "circle-color": theme.mode === "light" ? "#c48f00" : "#ffd23f", "circle-stroke-width": 2, "circle-stroke-color": palette.halo, "circle-opacity": 0.9 } });
      map.addLayer({
        id: "rp-rings",
        type: "circle",
        source: "rp-rings",
        paint: { "circle-radius": ["get", "r"], "circle-color": "rgba(0,0,0,0)", "circle-stroke-width": 2, "circle-stroke-color": ["get", "c"], "circle-stroke-opacity": ["get", "o"] },
      });
      map.addLayer({ id: "rp-glow", type: "circle", source: "rp-dots", paint: { "circle-radius": 11, "circle-color": ["get", "c"], "circle-opacity": 0.28, "circle-blur": 0.8 } });
      map.addLayer({ id: "rp-dots", type: "circle", source: "rp-dots", paint: { "circle-radius": 6, "circle-color": ["get", "c"], "circle-stroke-width": 2, "circle-stroke-color": palette.halo } });
      map.addLayer({
        id: "rp-labels",
        type: "symbol",
        source: "rp-dots",
        layout: { "text-field": ["get", "name"], "text-font": ["Noto Sans Regular"], "text-size": 11, "text-offset": [0, -1.5], "text-allow-overlap": false },
        paint: { "text-color": theme.mode === "light" ? "#0f1722" : "#e6eef7", "text-halo-color": palette.halo, "text-halo-width": 1.5 },
      });
      const bounds = new LngLatBounds();
      for (const p of boundaryRing(recap.boundary, 24)) bounds.extend([p.lng, p.lat]);
      map.fitBounds(bounds, { padding: 28, duration: 0, maxZoom: 18 });
      setReady(true);
    });
    return () => {
      map.remove();
      mapRef.current = null;
      setReady(false);
    };
    // The palette and accent come from the theme, so the map is rebuilt when the theme changes.
  }, [recap, theme.mode, accent]);

  // Draw one frame of the replay at time t.
  const draw = useRef<(t: number, realNow: number, full?: boolean) => void>(() => {});
  draw.current = (t, realNow, everything = false) => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const src = (id: string) => map.getSource(id) as GeoJSONSource | undefined;
    const color = (role: Role) => (role === "seeker" ? palette.seeker : palette.hider);

    // Players: dots, names and short trails.
    const dots: GeoJSON.Feature[] = [];
    const lines: GeoJSON.Feature[] = [];
    for (const a of model.actors) {
      const role = roleAt(a, t);
      if (!role) continue;
      const xy = positionAt(a, t);
      if (!xy) continue;
      dots.push(point(model.toLL(xy[0], xy[1]), { c: color(role), name: opts.current.names ? a.name : "" }));
      if (opts.current.trails) {
        const life = a.lives.find((l) => t >= l.from && t <= l.to)!;
        const from = Math.max(t - TRAIL_S, life.from);
        const coords: number[][] = [];
        for (let i = 0; i < a.ts.length; i++) {
          if (a.ts[i] > from && a.ts[i] < t) {
            const p = model.toLL(a.xs[i], a.ys[i]);
            coords.push([p.lng, p.lat]);
          }
        }
        const s = positionAt(a, from)!;
        const start = model.toLL(s[0], s[1]);
        const end = model.toLL(xy[0], xy[1]);
        const all = [[start.lng, start.lat], ...coords, [end.lng, end.lat]];
        if (all.length > 1) lines.push({ type: "Feature", properties: { role }, geometry: { type: "LineString", coordinates: all } });
      }
    }
    src("rp-dots")?.setData(fc(dots));
    src("rp-trails")?.setData(fc(lines));

    // Flash rings for pings and tags (timed in real time, so they read at any speed).
    flashes.current = flashes.current.filter((f) => realNow - f.start < FLASH_MS);
    src("rp-rings")?.setData(
      fc(
        flashes.current.map((f) => {
          const k = (realNow - f.start) / FLASH_MS;
          return point(f.at, { r: 6 + k * 26, o: 1 - k, c: f.color });
        }),
      ),
    );

    // Slower-changing things only need redrawing now and then.
    if (everything || Math.round(t * 4) % 2 === 0) {
      const storm = recap.storm;
      let area: Boundary = recap.boundary;
      let shrinking = false;
      if (storm && t >= storm.startS) {
        area = stormBoundary(recap.boundary, storm.center, storm.finalPct, stormProgress(t, storm.startS, storm.endS));
        shrinking = true;
      }
      const areaRing = boundaryRing(area);
      src("rp-outside")?.setData(fc([{ type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [WORLD, ring(areaRing)] } }]));
      src("rp-base")?.setData(fc([poly(boundaryRing(recap.boundary), { o: shrinking ? 0.35 : 0.9 })]));
      src("rp-storm")?.setData(fc(shrinking ? [poly(areaRing)] : []));
      src("rp-target")?.setData(fc(shrinking && storm ? [poly(boundaryRing(stormBoundary(recap.boundary, storm.center, storm.finalPct, 1)))] : []));
      src("rp-zones")?.setData(
        fc(
          recap.zones
            .filter((z) => t >= z.from && t < z.to)
            .map((z) => poly(circleRing(model.toLL(z.x, z.y), z.r), { o: 0.1 + 0.15 * (1 - (t - z.from) / Math.max(1, z.to - z.from)) })),
        ),
      );
      src("rp-tags")?.setData(fc(model.moments.filter((m) => m.at && m.icon !== "shield" && m.t <= t).map((m) => point(m.at!))));
    }
  };

  // Jump to a time: rebuild everything for that moment, and show what just happened.
  const seek = (t: number) => {
    tRef.current = Math.min(recap.durationS, Math.max(0, t));
    cursor.current = model.moments.findIndex((m) => m.t > tRef.current);
    if (cursor.current < 0) cursor.current = model.moments.length;
    flashes.current = [];
    const recent = model.moments.filter((m) => m.text && m.t <= tRef.current && m.t > tRef.current - 30).slice(-2);
    setFeed(recent.map((m, i) => ({ ...m, key: m.t * 1000 + i })));
    setShownT(tRef.current);
    draw.current(tRef.current, performance.now(), true);
  };

  // First frame once the map is ready (the final picture, until someone presses play).
  useEffect(() => {
    if (ready) seek(0);
    // Only when the map (re)appears: running it on other changes would restart the replay.
  }, [ready]);

  // Redraw straight away when names or trails are toggled while paused.
  useEffect(() => {
    if (ready && !playingRef.current) draw.current(tRef.current, performance.now(), true);
  }, [names, trails, ready]);

  // The playback loop.
  useEffect(() => {
    if (!playing || !ready) return;
    let frame = 0;
    let last = performance.now();
    let lastDraw = 0;
    let lastUi = 0;
    const loop = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      const prev = tRef.current;
      const t = Math.min(recap.durationS, prev + dt * rate * SPEEDS[opts.current.speed]);
      tRef.current = t;
      // Things that happened since the last frame: flash them and add them to the feed.
      const fresh: Moment[] = [];
      while (cursor.current < model.moments.length && model.moments[cursor.current].t <= t) {
        const m = model.moments[cursor.current++];
        if (m.ping) {
          for (const a of model.actors) {
            if (roleAt(a, m.t) !== "hider") continue;
            const xy = positionAt(a, m.t);
            if (xy) flashes.current.push({ at: model.toLL(xy[0], xy[1]), start: now, color: palette.hider });
          }
        } else {
          if (m.at) flashes.current.push({ at: m.at, start: now, color: m.tone === "zone" ? palette.zone : palette.seeker });
          if (m.text) fresh.push(m);
        }
      }
      if (fresh.length) setFeed((f) => [...f, ...fresh.map((m, i) => ({ ...m, key: now + i }))].slice(-2));
      if (now - lastDraw > 33) {
        draw.current(t, now);
        lastDraw = now;
      }
      if (now - lastUi > 120) {
        setShownT(t);
        lastUi = now;
      }
      if (t >= recap.durationS) {
        draw.current(t, now, true);
        setShownT(t);
        setPlaying(false);
        return;
      }
      frame = requestAnimationFrame(loop);
    };
    frame = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(frame);
  }, [playing, ready, recap.durationS, rate, model, palette]);

  // Start playing the first time the replay scrolls into view; pause when it's off screen
  // or the phone switches away, so it never burns battery unseen.
  useEffect(() => {
    if (!ready || !wrap.current) return;
    let started = false;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && !started) {
          started = true;
          setPlaying(true);
        } else if (!entry.isIntersecting) setPlaying(false);
      },
      { threshold: 0.5 },
    );
    io.observe(wrap.current);
    const onHide = () => document.visibilityState === "hidden" && setPlaying(false);
    document.addEventListener("visibilitychange", onHide);
    return () => {
      io.disconnect();
      document.removeEventListener("visibilitychange", onHide);
    };
  }, [ready]);

  // Full screen needs the map to measure itself again.
  useEffect(() => {
    const t = setTimeout(() => mapRef.current?.resize(), 50);
    return () => clearTimeout(t);
  }, [full]);

  const toggle = () => {
    if (!playing && tRef.current >= recap.durationS) seek(0);
    setPlaying(!playing);
  };

  // The HUD at time t.
  const hidersLeft = model.actors.filter((a) => roleAt(a, shownT) === "hider").length;
  const seekersNow = model.actors.filter((a) => roleAt(a, shownT) === "seeker").length;
  const phase =
    recap.huntStartS === null || shownT < recap.huntStartS ? "Head start" : recap.storm && shownT >= recap.storm.startS ? "Storm" : "Hunt";
  const ended = shownT >= recap.durationS;
  const pct = (t: number) => `${(t / Math.max(1, recap.durationS)) * 100}%`;

  return (
    <section ref={wrap} className={`card replay ${full ? "replay--full" : ""}`}>
      <div className="card-title">
        <span>
          Match replay
          <span className="eyebrow replay-sub"> · the whole game, fast-forwarded</span>
        </span>
        <button className="icon-btn" onClick={() => setFull(!full)} aria-label={full ? "Exit full screen" : "Full screen"}>
          <Icon name={full ? "x" : "expand"} size={18} />
        </button>
      </div>

      <div className="replay-stage">
        <div ref={container} className="replay-map" />
        <div className="replay-hud">
          <span className={`replay-phase replay-phase--${phase.replace(" ", "").toLowerCase()}`}>{phase}</span>
          <span className="replay-clock">
            {clock(shownT)}
            <small> / {clock(recap.durationS)}</small>
          </span>
          <span className="replay-count">
            <i className="dot dot--hider" />
            {hidersLeft}
            <i className="dot dot--seeker" />
            {seekersNow}
          </span>
        </div>
        <div className="replay-feed" aria-live="polite">
          {feed.map((m) => (
            <div key={m.key} className={`replay-event replay-event--${m.tone}`}>
              <Icon name={m.icon} size={14} />
              <span className="mono">{clock(m.t)}</span>
              {m.text}
            </div>
          ))}
        </div>
        {!playing && (
          <button className="replay-big-play" onClick={toggle} aria-label={ended ? "Watch again" : "Play"}>
            <Icon name="play" size={30} />
            <span>{ended ? "Watch again" : shownT > 0 ? "Resume" : "Play replay"}</span>
          </button>
        )}
      </div>

      <div className="replay-timeline">
        <div className="replay-track">
          {recap.huntStartS !== null && <div className="replay-headstart" style={{ width: pct(recap.huntStartS) }} title="Head start" />}
          {recap.storm && <div className="replay-stormband" style={{ left: pct(recap.storm.startS), width: `calc(${pct(Math.min(recap.durationS, recap.storm.endS))} - ${pct(recap.storm.startS)})` }} />}
          <div className="replay-progress" style={{ width: pct(shownT) }} />
          {marks.map((m, i) => (
            <i key={i} className={`replay-mark replay-mark--${m.tone}`} style={{ left: pct(m.t) }} title={m.text} />
          ))}
        </div>
        <input
          type="range"
          min={0}
          max={recap.durationS}
          step={0.5}
          value={shownT}
          aria-label="Replay time"
          onChange={(e) => {
            setPlaying(false);
            seek(Number(e.target.value));
          }}
        />
      </div>

      <div className="replay-controls">
        <button className="icon-btn" onClick={toggle} aria-label={playing ? "Pause" : "Play"}>
          <Icon name={playing ? "pause" : "play"} />
        </button>
        <Segmented
          value={speed}
          onChange={setSpeed}
          options={[
            { value: "slow", label: "½×" },
            { value: "normal", label: "1×" },
            { value: "fast", label: "2×" },
          ]}
        />
        <button className={`chip-toggle ${names ? "on" : ""}`} onClick={() => setNames(!names)} aria-pressed={names}>
          Names
        </button>
        <button className={`chip-toggle ${trails ? "on" : ""}`} onClick={() => setTrails(!trails)} aria-pressed={trails}>
          Trails
        </button>
      </div>

      <div className="recap-legend">
        <span>
          <i className="dot dot--hider" /> Hiders
        </span>
        <span>
          <i className="dot dot--seeker" /> Seekers
        </span>
        <span>
          <i className="dot dot--tag" /> Tags
        </span>
        {recap.zones.length > 0 && (
          <span>
            <i className="dot dot--zone" /> Safe zones
          </span>
        )}
        {recap.storm && (
          <span>
            <i className="dot dot--storm" /> Storm
          </span>
        )}
      </div>
      <p className="hint">This replay and everyone's location history are deleted when the next game starts or everyone leaves.</p>
    </section>
  );
}
