import type { ClientMessage, Recap, RoomView } from "../../shared/protocol";
import Icon, { type IconName } from "../components/Icon";
import { Avatar } from "../components/ui";
import Replay from "./Replay";

const HEADLINE = { hiders: "HIDERS WIN", seekers: "SEEKERS WIN", none: "GAME OVER" } as const;
const REASON = { time: "The timer ran out", allTagged: "Every hider was caught", host: "The host ended the game" } as const;
const AWARD_ICON: Record<string, IconName> = {
  Survivor: "shield",
  "Last one standing": "trophy",
  "Top tagger": "target",
  Marathon: "run",
  Moneybags: "coin",
};

function mmss(ms: number) {
  const t = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`;
}

export default function Results({
  view,
  recap,
  send,
  onLeave,
}: {
  view: RoomView;
  /** The match replay, once it has arrived (it comes separately, right as the game ends). */
  recap: Recap | null;
  send: (m: ClientMessage) => void;
  onLeave: () => void;
}) {
  const r = view.results;
  if (!r) return null;
  const isHost = view.hostId === view.me.id;
  const name = (id: string) => r.stats.find((s) => s.id === id)?.name ?? view.players.find((p) => p.id === id)?.name ?? "?";
  const rows = [...r.stats].sort((a, b) => b.tags - a.tags || (b.survivalMs ?? 0) - (a.survivalMs ?? 0));
  const showReplay = recap && recap.id === view.recapId && Object.keys(recap.tracks).length > 0;

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

      {showReplay ? (
        <Replay recap={recap} />
      ) : (
        view.recapId && (
          <section className="card">
            <p className="hint">Loading the match replay…</p>
          </section>
        )
      )}

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
