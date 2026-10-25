import type { ClientMessage, RoomView } from "../../shared/protocol";
import { Avatar } from "../components/ui";

const HEADLINE = { hiders: "HIDERS WIN", seekers: "SEEKERS WIN", none: "GAME OVER" } as const;
const REASON = { time: "The timer ran out", allTagged: "Every hider was caught", host: "The host ended the game" } as const;

function mmss(ms: number) {
  const t = Math.round(ms / 1000);
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`;
}

export default function Results({ view, send, onLeave }: { view: RoomView; send: (m: ClientMessage) => void; onLeave: () => void }) {
  const r = view.results;
  if (!r) return null;
  const isHost = view.hostId === view.me.id;
  const name = (id: string) => r.stats.find((s) => s.id === id)?.name ?? view.players.find((p) => p.id === id)?.name ?? "?";
  const rows = [...r.stats].sort((a, b) => b.tags - a.tags || (b.survivalMs ?? 0) - (a.survivalMs ?? 0));

  return (
    <main className="results">
      <header className={`results-head results-head--${r.winner}`}>
        <div className="eyebrow">{REASON[r.reason]}</div>
        <h1>{HEADLINE[r.winner]}</h1>
        <div className="sub">Hunt lasted {mmss(r.durationMs)}</div>
      </header>

      {r.awards.length > 0 && (
        <section className="awards">
          {r.awards.map((a, i) => (
            <div key={i} className="award">
              <div className="eyebrow">{a.title}</div>
              <b>{name(a.playerId)}</b>
              <small>{a.detail}</small>
            </div>
          ))}
        </section>
      )}

      <section className="card">
        <div className="card-title">Stats</div>
        <div className="stats-table" role="table">
          <div className="stats-row stats-row--head" role="row">
            <span>Player</span>
            <span>Tags</span>
            <span>Survived</span>
            <span>Distance</span>
          </div>
          {rows.map((s) => (
            <div key={s.id} className="stats-row" role="row">
              <span className="stats-name">
                <Avatar name={s.name} isBot={s.isBot} />
                <span>
                  {s.name}
                  <small className={`role-text role-text--${s.startRole}`}>
                    {s.startRole === "seeker" ? "Seeker" : s.finalRole === "seeker" ? "Hider → Seeker" : "Hider"}
                    {s.startRole === "hider" && !s.wasTagged ? " · survived" : ""}
                  </small>
                </span>
              </span>
              <span>{s.tags}</span>
              <span>{s.survivalMs === null ? "–" : mmss(s.survivalMs)}</span>
              <span>{s.distanceM} m</span>
            </div>
          ))}
        </div>
      </section>

      <footer className="lobby-foot">
        {isHost ? (
          <button className="btn btn-primary" onClick={() => send({ type: "playAgain" })}>
            Play again
          </button>
        ) : (
          <p className="waiting">Waiting for the host to start another round…</p>
        )}
        <button className="btn btn-ghost" onClick={onLeave}>
          Leave room
        </button>
      </footer>
    </main>
  );
}
