import { useState } from "react";
import type { ClientMessage, PlayerPublic, Role, RoomView } from "../../shared/protocol";
import MapView from "../components/MapView";
import { Avatar, Segmented, Sheet } from "../components/ui";
import { useGps } from "../lib/location";
import { buildPins } from "../lib/pins";
import { describeBoundary } from "../lib/savedAreas";
import AreaEditor from "./AreaEditor";
import SettingsPanel from "./SettingsPanel";

const ROLE_LABEL: Record<Role, string> = { seeker: "Seeker", hider: "Hider" };

export default function Lobby({ view, now, send, onLeave }: {
  view: RoomView;
  now: number;
  send: (m: ClientMessage) => void;
  onLeave: () => void;
}) {
  const gps = useGps();
  const isHost = view.hostId === view.me.id;
  const s = view.settings;
  const [editingArea, setEditingArea] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const selected = view.players.find((p) => p.id === selectedId) ?? null;
  const me = view.players.find((p) => p.id === view.me.id);
  const bots = view.players.filter((p) => p.isBot).length;

  const share = async () => {
    const url = `${location.origin}${import.meta.env.BASE_URL}?join=${view.code}`;
    try {
      if (navigator.share) await navigator.share({ title: "Join my Manhunt game", text: `Room code ${view.code}`, url });
      else {
        await navigator.clipboard.writeText(view.code);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }
    } catch {
      // share cancelled
    }
  };

  const startProblem = !s.boundary ? "Set the play area first" : view.players.length < 2 ? "Waiting for more players (or add bots)" : null;

  if (editingArea) {
    return (
      <AreaEditor
        initial={s.boundary}
        onCancel={() => setEditingArea(false)}
        onSave={(boundary) => {
          send({ type: "updateSettings", patch: { boundary } });
          setEditingArea(false);
        }}
      />
    );
  }

  // The host manages everyone else, and can also pick their own role in "Host picks" mode.
  const canManage = (p: PlayerPublic) => isHost && (p.id !== view.me.id || s.roleAssignment === "manual");
  const isSelf = selected?.id === view.me.id;

  const roleBadge = (p: PlayerPublic) => {
    // In "Host picks" mode anyone not picked hides, so show that.
    const r = s.roleAssignment === "manual" ? (p.role ?? "hider") : s.roleAssignment === "volunteer" ? p.volunteer : null;
    return r ? <span className={`role-tag role-tag--${r}`}>{ROLE_LABEL[r]}</span> : null;
  };

  return (
    <main className="lobby">
      <header className="lobby-head">
        <button className="btn btn-small btn-ghost" onClick={onLeave}>
          ← Leave
        </button>
        <div className="eyebrow">Room code</div>
        <button className="room-code" onClick={share} title="Share room code">
          {view.code}
        </button>
        <div className="sub">{copied ? "Code copied" : `${view.players.length} in lobby · tap the code to share`}</div>
      </header>

      <section className="card">
        <div className="card-title">
          Play area
          <span className="card-meta">{describeBoundary(s.boundary)}</span>
        </div>
        <MapView
          boundary={s.boundary}
          pins={buildPins(view, now)}
          me={gps.pos ? { pos: gps.pos, accuracy: gps.accuracy, role: null } : null}
          onMapClick={gps.simulated ? gps.setSimPos : undefined}
          fitKey={s.boundary ? JSON.stringify(s.boundary) : "none"}
          className="lobby-map"
          showRecenter
        />
        {isHost ? (
          <button className="btn btn-small" onClick={() => setEditingArea(true)}>
            {s.boundary ? "Edit play area" : "Set play area"}
          </button>
        ) : (
          !s.boundary && <p className="setting-hint">The host hasn't set the play area yet.</p>
        )}
      </section>

      <section className="card">
        <div className="card-title">
          Players
          {isHost && <span className="chip">HOST</span>}
        </div>
        <div className="players">
          {view.players.map((p) => (
            <button
              key={p.id}
              className={`player ${p.connected ? "" : "player--offline"}`}
              onClick={() => canManage(p) && setSelectedId(p.id)}
              disabled={!canManage(p)}
            >
              <Avatar name={p.name} isBot={p.isBot} />
              <span className="player-name">
                {p.name}
                {p.id === view.me.id && <small> (you)</small>}
              </span>
              {roleBadge(p)}
              {p.isHost && <span className="badge">host</span>}
              {!p.connected && <span className="badge">offline</span>}
            </button>
          ))}
        </div>

        {s.roleAssignment === "volunteer" && me && (
          <div className="setting">
            <div className="setting-label">I want to be</div>
            <Segmented
              value={me.volunteer ?? "either"}
              onChange={(v) => send({ type: "volunteer", role: v === "either" ? null : v })}
              options={[
                { value: "hider", label: "Hider" },
                { value: "seeker", label: "Seeker" },
                { value: "either", label: "Either" },
              ]}
            />
          </div>
        )}

        {isHost && (
          <div className="bot-row">
            <span>Test bots{bots ? ` · ${bots}` : ""}</span>
            <button className="btn btn-small" onClick={() => send({ type: "addBots", count: 1 })}>
              +1
            </button>
            <button className="btn btn-small" onClick={() => send({ type: "addBots", count: 5 })}>
              +5
            </button>
            <button className="btn btn-small btn-ghost" disabled={!bots} onClick={() => send({ type: "removeBots" })}>
              Remove
            </button>
          </div>
        )}
      </section>

      <section className="card">
        <div className="card-title">Game settings</div>
        <SettingsPanel settings={s} editable={isHost} onChange={(patch) => send({ type: "updateSettings", patch })} />
      </section>

      <footer className="lobby-foot">
        {isHost ? (
          <>
            {startProblem && <p className="setting-hint">{startProblem}</p>}
            <button className="btn btn-primary" disabled={!!startProblem} onClick={() => send({ type: "start" })}>
              Start game
            </button>
          </>
        ) : (
          <p className="waiting">Waiting for the host to start…</p>
        )}
      </footer>

      {selected && (
        <Sheet title={selected.name} onClose={() => setSelectedId(null)}>
          {s.roleAssignment === "manual" && (
            <div className="setting">
              <div className="setting-label">Role</div>
              <Segmented
                value={selected.role ?? "hider"}
                onChange={(role) => send({ type: "setRole", playerId: selected.id, role })}
                options={[
                  { value: "hider", label: "Hider" },
                  { value: "seeker", label: "Seeker" },
                ]}
              />
            </div>
          )}
          {!selected.isBot && !isSelf && (
            <button
              className="btn"
              onClick={() => {
                send({ type: "transferHost", playerId: selected.id });
                setSelectedId(null);
              }}
            >
              Make host
            </button>
          )}
          {!isSelf && (
            <button
              className="btn btn-danger"
              onClick={() => {
                send({ type: "kick", playerId: selected.id });
                setSelectedId(null);
              }}
            >
              Remove from room
            </button>
          )}
        </Sheet>
      )}
    </main>
  );
}
