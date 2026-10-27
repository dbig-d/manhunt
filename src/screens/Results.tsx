import { useEffect, useMemo, useState } from "react";
import type { Boundary, ClientMessage, LatLng, PlayerStats, Results as ResultsData, RoomView } from "../../shared/protocol";
import { fromLocal } from "../../shared/geo";
import Icon, { type IconName } from "../components/Icon";
import MapView, { type MapDot, type MapLine } from "../components/MapView";
import { Avatar } from "../components/ui";
import { useTheme } from "../lib/theme";

const HEADLINE = { hiders: "HIDERS WIN", seekers: "SEEKERS WIN", none: "GAME OVER" } as const;
const REASON = { time: "The timer ran out", allTagged: "Every hider was caught", host: "The host ended the game" } as const;
const AWARD_ICON: Record<string, IconName> = {
  Survivor: "shield",
  "Last one standing": "trophy",
  "Top tagger": "target",
  Marathon: "run",
  Moneybags: "coin",
};
/** The whole recap plays in about this long, however long the game was. */
const RECAP_PLAY_MS = 20_000;
// Team colors for the replay paths (deeper shades read better on the light map).
const TEAM_COLOR = { dark: { seeker: "#ff3b4e", hider: "#3dff9a" }, light: { seeker: "#e0313f", hider: "#10a85f" } } as const;

function mmss(ms: number) {
  const t = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`;
}

export default function Results({ view, send, onLeave }: { view: RoomView; send: (m: ClientMessage) => void; onLeave: () => void }) {
  const r = view.results;
  if (!r) return null;
  const isHost = view.hostId === view.me.id;
  const name = (id: string) => r.stats.find((s) => s.id === id)?.name ?? view.players.find((p) => p.id === id)?.name ?? "?";
  const rows = [...r.stats].sort((a, b) => b.tags - a.tags || (b.survivalMs ?? 0) - (a.survivalMs ?? 0));

  return (
    <main className="results screen">
      <header className={`results-hero results-hero--${r.winner}`}>
        <div className="results-rings" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
        <span className="trophy">
          <Icon name={r.winner === "none" ? "stop" : "trophy"} size={32} />
        </span>
        <div className="eyebrow">{REASON[r.reason]}</div>
        <h1>{HEADLINE[r.winner]}</h1>
        <div className="sub">Hunt lasted {mmss(r.durationMs)}</div>
      </header>

      {r.awards.length > 0 && (
        <section className="awards">
          {r.awards.map((a, i) => (
            <div key={i} className="award" style={{ animationDelay: `${0.05 * i}s` }}>
              <span>
                <Icon name={AWARD_ICON[a.title] ?? "trophy"} size={18} />
              </span>
              <div>
                <small>{a.title}</small>
                <b>{name(a.playerId)}</b>
                <small>{a.detail}</small>
              </div>
            </div>
          ))}
        </section>
      )}

      {r.recap && Object.keys(r.recap.tracks).length > 0 && <Recap results={r} boundary={view.settings.boundary} />}

      <section className="card">
        <div className="card-title">Stats</div>
        <div className="stats-table" role="table">
          <div className="stats-row stats-row--head" role="row">
            <span>Player</span>
            <span>Tags</span>
            <span>Lasted</span>
            <span>Ran</span>
          </div>
          {rows.map((s) => (
            <div key={s.id} className="stats-row" role="row">
              <span className="stats-name">
                <Avatar name={s.name} isBot={s.isBot} />
                <span>
                  <span>{s.name}</span>
                  <small className={`role-text role-text--${s.startRole}`}>
                    {s.startRole === "seeker" ? "Seeker" : s.finalRole === "seeker" ? "Hider → Seeker" : "Hider"}
                    {s.startRole === "hider" && !s.wasTagged ? " · survived" : ""}
                    {(s.coinsEarned ?? 0) > 0 ? ` · ${s.coinsEarned} coins` : ""}
                  </small>
                </span>
              </span>
              <span>{s.tags}</span>
              <span>{s.survivalMs === null ? "–" : mmss(s.survivalMs)}</span>
              <span>{s.distanceM >= 1000 ? `${(s.distanceM / 1000).toFixed(1)}k` : s.distanceM}m</span>
            </div>
          ))}
        </div>
      </section>

      <footer className="start-bar">
        {isHost ? (
          <button className="btn btn--primary btn--big" onClick={() => send({ type: "playAgain" })}>
            <Icon name="play" />
            Play again
          </button>
        ) : (
          <p className="waiting">Waiting for the host to start another round…</p>
        )}
        <button className="btn btn--ghost" onClick={onLeave}>
          Leave room
        </button>
      </footer>
    </main>
  );
}

/** Animated replay of everyone's movement, built from points recorded every 10 s. */
function Recap({ results, boundary }: { results: ResultsData; boundary: Boundary | null }) {
  const recap = results.recap!;
  const light = useTheme().mode === "light";
  const duration = Math.max(1, Math.round(results.durationMs / 1000));
  const [t, setT] = useState(0);
  const [playing, setPlaying] = useState(true);

  // About 20 frames a second is plenty for dots moving across a map.
  useEffect(() => {
    if (!playing) return;
    const step = (duration * 50) / RECAP_PLAY_MS;
    const timer = setInterval(() => {
      setT((cur) => {
        const next = cur + step;
        if (next >= duration) {
          setPlaying(false);
          return duration;
        }
        return next;
      });
    }, 50);
    return () => clearInterval(timer);
  }, [playing, duration]);

  const byId = useMemo(() => new Map<string, PlayerStats>(results.stats.map((s) => [s.id, s])), [results.stats]);

  const { lines, dots } = useMemo(() => {
    const lines: MapLine[] = [];
    const dots: MapDot[] = [];
    for (const [id, flat] of Object.entries(recap.tracks)) {
      const stats = byId.get(id);
      const role = stats?.startRole ?? "hider";
      const path: LatLng[] = [];
      let last: { x: number; y: number } | null = null;
      for (let i = 0; i < flat.length; i += 3) {
        const [x, y, pt] = [flat[i], flat[i + 1], flat[i + 2]];
        if (pt <= t) {
          path.push(fromLocal(recap.origin, x, y));
          last = { x, y };
        } else if (last) {
          // Slide smoothly between recorded points.
          const prevT = flat[i - 1];
          const f = (t - prevT) / Math.max(1, pt - prevT);
          const cur = { x: last.x + (x - last.x) * f, y: last.y + (y - last.y) * f };
          path.push(fromLocal(recap.origin, cur.x, cur.y));
          last = cur;
          break;
        } else break;
      }
      if (!path.length) continue;
      const ended = flat[flat.length - 1] < t - 10 && t < duration;
      lines.push({ id, coords: path, color: TEAM_COLOR[light ? "light" : "dark"][role], opacity: 0.75 });
      const head = path[path.length - 1];
      dots.push({ id, lat: head.lat, lng: head.lng, className: `recap-pin recap-pin--${role} ${ended ? "recap-pin--gone" : ""}` });
    }
    for (const [i, tag] of recap.tags.entries()) {
      if (tag.t > t) continue;
      const p = fromLocal(recap.origin, tag.x, tag.y);
      dots.push({ id: `tag-${i}`, lat: p.lat, lng: p.lng, className: "recap-tag" });
    }
    return { lines, dots };
  }, [recap, t, byId, duration, light]);

  return (
    <section className="card">
      <div className="card-title">
        Replay
        <span className="eyebrow">Everyone's paths</span>
      </div>
      <MapView boundary={boundary} lines={lines} dots={dots} fitKey="recap" className="recap-map" />
      <div className="recap-controls">
        <button
          className="icon-btn"
          aria-label={playing ? "Pause" : "Play"}
          onClick={() => {
            if (!playing && t >= duration) setT(0);
            setPlaying(!playing);
          }}
        >
          <Icon name={playing ? "pause" : "play"} />
        </button>
        <input type="range" min={0} max={duration} step={1} value={Math.round(t)} aria-label="Replay time" onChange={(e) => (setPlaying(false), setT(Number(e.target.value)))} />
        <span className="recap-time">{mmss(t * 1000)}</span>
      </div>
      <div className="recap-legend">
        <span>
          <i /> Hiders
        </span>
        <span>
          <i className="seeker" /> Seekers
        </span>
        <span>
          <i className="tag" /> Tags
        </span>
      </div>
      <p className="hint">Location history is deleted when the host starts the next round.</p>
    </section>
  );
}
