import { useEffect, useMemo, useState } from "react";
import type { ChatMessage, ClientMessage, PlayerPublic, Role, RoomView, Settings } from "../../shared/protocol";
import { MODES, MODE_BY_ID, isCustomized } from "../../shared/modes";
import Icon, { MODE_ICON, type IconName } from "../components/Icon";
import MapView from "../components/MapView";
import TestingTools from "../components/TestingTools";
import { Avatar, Segmented, Sheet, Stepper } from "../components/ui";
import { formatClock } from "../lib/hooks";
import { useGps } from "../lib/location";
import { buildPins } from "../lib/pins";
import { describeBoundary } from "../lib/savedAreas";
import AreaEditor from "./AreaEditor";
import Chat from "./Chat";
import HowToPlay from "./HowToPlay";
import RulesEditor, { type RulesTab } from "./RulesEditor";

const ROLE_LABEL: Record<Role, string> = { seeker: "Seeker", hider: "Hider" };
type SheetName = "mode" | "rules" | "invite" | "menu" | "player" | "howto" | "testing" | "chat";

/** The rules at a glance, each one opening the editor on its own tab. */
function ruleSummary(s: Settings): { icon: IconName; label: string; value: string; tab: RulesTab; off?: boolean }[] {
  const hiderView = { none: "Nothing", pinged: "Pinged", proximity: "Near alert" }[s.hiderView];
  return [
    { icon: "clock", label: "Head start", value: formatClock(s.headStartSec * 1000), tab: "timing" },
    { icon: "trophy", label: "Game", value: `${s.gameLengthMin} min`, tab: "timing" },
    { icon: "radar", label: "Pings", value: `Every ${s.pingIntervalSec < 60 ? `${s.pingIntervalSec}s` : formatClock(s.pingIntervalSec * 1000)}${s.pingStyle === "fuzzy" ? " · fuzzy" : ""}`, tab: "pings" },
    { icon: "eye", label: "Hiders see", value: hiderView, tab: "pings" },
    { icon: s.anonymous ? "eyeOff" : "users", label: "Names", value: s.anonymous ? "Anonymous" : "Shown", tab: "visibility" },
    { icon: "hand", label: "Tagging", value: `${s.tagMode === "qr" ? "QR scan" : "Honor"} · ${s.whenTagged === "out" ? "out" : "convert"}`, tab: "tagging" },
    { icon: "map", label: "Leaving area", value: { warn: "Warning", reveal: "Revealed", eliminate: "Eliminated" }[s.oobPenalty], tab: "area" },
    { icon: "storm", label: "Storm", value: s.storm.enabled ? `To ${s.storm.finalPct}%` : "Off", tab: "area", off: !s.storm.enabled },
    { icon: "shield", label: "Safe zones", value: s.zones.enabled ? `${s.zones.maxActive} at a time` : "Off", tab: "zones", off: !s.zones.enabled },
    { icon: "bag", label: "Power-ups", value: s.shop.enabled ? (s.shop.seekerEconomy ? "Both teams" : "Hiders") : "Off", tab: "shop", off: !s.shop.enabled },
  ];
}

export default function Lobby({
  view,
  now,
  send,
  onLeave,
  messages,
}: {
  view: RoomView;
  now: number;
  send: (m: ClientMessage) => void;
  onLeave: () => void;
  messages: ChatMessage[];
}) {
  const gps = useGps();
  const isHost = view.hostId === view.me.id;
  const s = view.settings;
  const mode = MODE_BY_ID[s.mode];
  const [sheet, setSheet] = useState<SheetName | null>(null);
  const [rulesTab, setRulesTab] = useState<RulesTab>("timing");
  const [editingArea, setEditingArea] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = view.players.find((p) => p.id === selectedId) ?? null;
  const me = view.players.find((p) => p.id === view.me.id);
  const bots = view.players.filter((p) => p.isBot).length;
  const pins = useMemo(() => buildPins(view, now), [view, now]);
  const close = () => setSheet(null);
  const [readAt, setReadAt] = useState(0);
  const unread = sheet === "chat" ? 0 : messages.filter((m) => m.channel === "all" && m.fromId !== view.me.id && m.at > readAt).length;

  const seekersPicked =
    s.roleAssignment === "random"
      ? true
      : view.players.some((p) => (s.roleAssignment === "manual" ? p.role : p.volunteer) === "seeker");
  const checks = [
    { ok: !!s.boundary, label: "Play area" },
    { ok: view.players.length >= 2, label: `${view.players.length} player${view.players.length === 1 ? "" : "s"}` },
    { ok: seekersPicked, label: seekersPicked ? "Roles" : "Pick a seeker" },
  ];
  const ready = checks.every((c) => c.ok);

  // The host manages everyone else, and can also pick their own role in "Host picks" mode.
  const canManage = (p: PlayerPublic) => isHost && (p.id !== view.me.id || s.roleAssignment === "manual");
  const roleOf = (p: PlayerPublic) => (s.roleAssignment === "manual" ? (p.role ?? "hider") : s.roleAssignment === "volunteer" ? p.volunteer : null);
  const openRules = (tab: RulesTab) => {
    setRulesTab(tab);
    setSheet("rules");
  };

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

  return (
    <main className="lobby screen">
      <header className="topbar">
        <button className="icon-btn" onClick={onLeave} aria-label="Leave room">
          <Icon name="back" />
        </button>
        <span className="topbar-title">{isHost ? "You're the host" : "Lobby"}</span>
        <div className="row" style={{ flex: "none", gap: 6 }}>
          <button className="icon-btn" style={{ position: "relative" }} onClick={() => (setReadAt(now), setSheet("chat"))} aria-label="Chat">
            <Icon name="chat" />
            {unread > 0 && <span className="dock-badge" style={{ top: -6, right: -6 }}>{unread > 9 ? "9+" : unread}</span>}
          </button>
          <button className="icon-btn" onClick={() => setSheet("menu")} aria-label="More">
            <Icon name="more" />
          </button>
        </div>
      </header>

      <section className="room-hero">
        <div className="eyebrow">Room code</div>
        <button className="room-code" onClick={() => setSheet("invite")} aria-label="Invite players">
          {view.code}
        </button>
        <button className="btn btn--sm" onClick={() => setSheet("invite")}>
          <Icon name="share" size={16} />
          Invite players
        </button>
      </section>

      {/* 1 · Mode */}
      <section className="card step">
        <div className="step-head">
          <span className="step-num done">1</span>
          <div className="step-title">
            <h2>Game mode</h2>
            <p>{isHost ? "Pick how this round plays" : "Chosen by the host"}</p>
          </div>
        </div>
        <button className="mode-current" disabled={!isHost} onClick={() => setSheet("mode")}>
          <span className={`mode-icon mode-icon--${s.mode}`}>
            <Icon name={MODE_ICON[s.mode]} size={26} />
          </span>
          <div>
            <b>
              {mode.name}
              {isCustomized(s) && <span className="custom-tag">customized</span>}
            </b>
            <small>{mode.description}</small>
          </div>
          {isHost && <Icon name="next" />}
        </button>
      </section>

      {/* 2 · Area */}
      <section className="card step">
        <div className="step-head">
          <span className={`step-num ${s.boundary ? "done" : ""}`}>{s.boundary ? <Icon name="check" size={16} /> : "2"}</span>
          <div className="step-title">
            <h2>Play area</h2>
            <p>{s.boundary ? describeBoundary(s.boundary) : isHost ? "Set where the game happens" : "Waiting for the host"}</p>
          </div>
          {isHost && (
            <button className="btn btn--sm" onClick={() => setEditingArea(true)}>
              {s.boundary ? "Edit" : "Set area"}
            </button>
          )}
        </div>
        <MapView
          boundary={s.boundary}
          pins={pins}
          me={gps.pos ? { pos: gps.pos, accuracy: gps.accuracy, role: null } : null}
          onMapClick={gps.simulated ? gps.setSimPos : undefined}
          fitKey={s.boundary ? JSON.stringify(s.boundary) : "none"}
          className="lobby-map"
          showRecenter
        />
      </section>

      {/* 3 · Players */}
      <section className="card step">
        <div className="step-head">
          <span className={`step-num ${view.players.length >= 2 && seekersPicked ? "done" : ""}`}>
            {view.players.length >= 2 && seekersPicked ? <Icon name="check" size={16} /> : "3"}
          </span>
          <div className="step-title">
            <h2>Players &amp; roles</h2>
            <p>
              {view.players.length} in the room
              {bots ? ` · ${bots} bot${bots === 1 ? "" : "s"}` : ""}
            </p>
          </div>
        </div>

        <Segmented
          value={s.roleAssignment}
          disabled={!isHost}
          onChange={(roleAssignment) => send({ type: "updateSettings", patch: { roleAssignment } })}
          options={[
            { value: "random", label: "Random" },
            { value: "manual", label: "Host picks" },
            { value: "volunteer", label: "Volunteer" },
          ]}
        />
        {s.roleAssignment === "random" && (
          <div className="area-meta">
            <span className="hint">Seekers, picked at random when the game starts</span>
            <Stepper value={s.seekerCount} min={1} max={10} step={1} disabled={!isHost} onChange={(seekerCount) => send({ type: "updateSettings", patch: { seekerCount } })} />
          </div>
        )}
        {s.roleAssignment === "manual" && <p className="hint">{isHost ? "Tap a player to make them a seeker. Everyone else hides." : "The host picks the seekers."}</p>}
        {s.roleAssignment === "volunteer" && me && (
          <div className="area-meta">
            <span className="hint">I want to be…</span>
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

        <div className="player-grid">
          {view.players.map((p) => {
            const r = roleOf(p);
            return (
              <button
                key={p.id}
                className={`player-chip ${p.connected ? "" : "player-chip--offline"}`}
                onClick={() => canManage(p) && (setSelectedId(p.id), setSheet("player"))}
                disabled={!canManage(p)}
              >
                <Avatar name={p.name} isBot={p.isBot} />
                <span>
                  <span className="player-name">
                    {p.name}
                    {p.id === view.me.id && <small> (you)</small>}
                  </span>
                  <span className="player-sub">
                    {p.isHost && <span className="badge badge--host">Host</span>}
                    {!p.connected && <span className="badge">Offline</span>}
                    {p.isBot && <span className="badge">Bot</span>}
                  </span>
                </span>
                {r && <span className={`tag tag--${r}`}>{ROLE_LABEL[r]}</span>}
              </button>
            );
          })}
        </div>

        {isHost && (
          <div className="area-meta">
            <span className="hint">
              <Icon name="bot" size={14} /> Test bots
            </span>
            <div className="row" style={{ flex: "none" }}>
              <button className="btn btn--sm" onClick={() => send({ type: "addBots", count: 1 })}>
                +1
              </button>
              <button className="btn btn--sm" onClick={() => send({ type: "addBots", count: 5 })}>
                +5
              </button>
              <button className="btn btn--sm btn--ghost" disabled={!bots} onClick={() => send({ type: "removeBots" })}>
                Clear
              </button>
            </div>
          </div>
        )}
      </section>

      {/* 4 · Rules */}
      <section className="card step">
        <div className="step-head">
          <span className="step-num done">4</span>
          <div className="step-title">
            <h2>Rules</h2>
            <p>{isHost ? "Tap anything to change it" : "Tap to see the details"}</p>
          </div>
        </div>
        <div className="rule-chips">
          {ruleSummary(s).map((r) => (
            <button key={r.label} className={`rule-chip ${r.off ? "rule-chip--off" : ""}`} onClick={() => openRules(r.tab)}>
              <Icon name={r.icon} size={18} />
              <div>
                <small>{r.label}</small>
                <b>{r.value}</b>
              </div>
            </button>
          ))}
        </div>
        <button className="btn btn--block" onClick={() => openRules("timing")}>
          <Icon name="sliders" size={18} />
          {isHost ? "All rules" : "View all rules"}
        </button>
      </section>

      <footer className="start-bar">
        <div className="ready-list">
          {checks.map((c) => (
            <span key={c.label} className={`ready-item ${c.ok ? "ok" : "bad"}`}>
              <Icon name={c.ok ? "check" : "alert"} size={14} />
              {c.label}
            </span>
          ))}
        </div>
        {isHost ? (
          <button className="btn btn--primary btn--big" disabled={!ready} onClick={() => send({ type: "start" })}>
            <Icon name="play" />
            Start game
          </button>
        ) : (
          <p className="waiting">Waiting for the host to start…</p>
        )}
      </footer>

      {sheet === "mode" && (
        <Sheet title="Game mode" onClose={close}>
          <div className="mode-grid">
            {MODES.map((m) => (
              <button
                key={m.id}
                className={`mode-card ${m.id === s.mode ? "on" : ""}`}
                onClick={() => {
                  send({ type: "updateSettings", patch: { mode: m.id } });
                  close();
                }}
              >
                <span className={`mode-icon mode-icon--${m.id}`}>
                  <Icon name={MODE_ICON[m.id]} size={26} />
                </span>
                <span>
                  <b>{m.name}</b>
                  <em>{m.tagline}</em>
                  <p>{m.description}</p>
                </span>
              </button>
            ))}
          </div>
          <p className="hint">Modes set a few rules for you. You can still change anything under Rules afterwards.</p>
        </Sheet>
      )}

      {sheet === "rules" && <RulesEditor settings={s} editable={isHost} initialTab={rulesTab} onClose={close} onChange={(patch) => send({ type: "updateSettings", patch })} />}

      {sheet === "invite" && <InviteSheet code={view.code} onClose={close} />}
      {sheet === "chat" && <Chat view={view} messages={messages} send={send} onClose={() => (setReadAt(now), close())} />}

      {sheet === "menu" && (
        <Sheet title="Menu" onClose={close}>
          <div className="menu-list">
            <button className="btn btn--block" onClick={() => setSheet("howto")}>
              <Icon name="help" size={18} />
              How to play
            </button>
            <button className="btn btn--block" onClick={() => setSheet("testing")}>
              <Icon name="wrench" size={18} />
              Testing tools
            </button>
            <button className="btn btn--block btn--danger" onClick={onLeave}>
              <Icon name="logout" size={18} />
              Leave room
            </button>
          </div>
        </Sheet>
      )}
      {sheet === "howto" && (
        <Sheet title="How to play" onClose={close}>
          <HowToPlay />
        </Sheet>
      )}
      {sheet === "testing" && (
        <Sheet title="Testing tools" onClose={close}>
          <TestingTools />
        </Sheet>
      )}

      {sheet === "player" && selected && (
        <Sheet title={selected.name} onClose={close}>
          {s.roleAssignment === "manual" && (
            <div className="setting setting--stack">
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
          {!selected.isBot && selected.id !== view.me.id && (
            <button className="btn btn--block" onClick={() => (send({ type: "transferHost", playerId: selected.id }), close())}>
              Make host
            </button>
          )}
          {selected.id !== view.me.id && (
            <button className="btn btn--block btn--danger" onClick={() => (send({ type: "kick", playerId: selected.id }), close())}>
              Remove from room
            </button>
          )}
        </Sheet>
      )}
    </main>
  );
}

function InviteSheet({ code, onClose }: { code: string; onClose: () => void }) {
  const url = `${location.origin}${import.meta.env.BASE_URL}?join=${code}`;
  const [qr, setQr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    // Loaded only when needed, to keep the first page load light.
    import("qrcode").then(({ default: QRCode }) =>
      QRCode.toDataURL(url, { margin: 1, width: 480, errorCorrectionLevel: "M", color: { dark: "#000000", light: "#ffffff" } }).then(setQr),
    );
  }, [url]);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard blocked
    }
  };
  return (
    <Sheet title="Invite players" onClose={onClose}>
      <div className="invite">
        {qr ? <img src={qr} alt="QR code to join this room" /> : <div style={{ height: 240 }} />}
        <p className="hint">Friends scan this with their camera, or enter the code on the home screen.</p>
        <div className="room-code">{code}</div>
        <div className="row" style={{ width: "100%" }}>
          {"share" in navigator && (
            <button className="btn btn--primary" onClick={() => navigator.share({ title: "Join my Manhunt game", text: `Room code ${code}`, url }).catch(() => {})}>
              <Icon name="share" size={18} />
              Share
            </button>
          )}
          <button className="btn" onClick={copy}>
            <Icon name={copied ? "check" : "copy"} size={18} />
            {copied ? "Copied" : "Copy link"}
          </button>
        </div>
      </div>
    </Sheet>
  );
}
