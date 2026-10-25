import { useEffect, useRef, useState } from "react";
import type { PlayerPublic, RoomView } from "../../shared/protocol";
import MapView from "../components/MapView";
import { TagCodeCard, TagScanner } from "../components/TagCode";
import { Avatar, Sheet } from "../components/ui";
import { buzz, formatClock, useWakeLock } from "../lib/hooks";
import { useGps } from "../lib/location";
import { buildPins } from "../lib/pins";
import type { Room } from "../lib/useRoom";

type SheetName = "players" | "menu" | "tagSelf" | "tagCode" | "scan" | "bots" | null;
const GPS_LOST_MS = 30_000;

export default function GameScreen({ room, view, now, onLeave }: { room: Room; view: RoomView; now: number; onLeave: () => void }) {
  const gps = useGps();
  const wakeLock = useWakeLock(true);
  const s = view.settings;
  const me = view.me;
  const meP = view.players.find((p) => p.id === me.id);
  const isHost = view.hostId === me.id;
  const spectating = me.status === "out" || me.role === null;
  const isSeeker = !spectating && me.role === "seeker";
  const isHider = !spectating && me.role === "hider";
  const headstart = view.phase === "headstart";

  const [sheet, setSheet] = useState<SheetName>(null);
  const [tagger, setTagger] = useState<string | null | undefined>(undefined);
  const [confirming, setConfirming] = useState<"end" | "leave" | null>(null);
  const [flash, setFlash] = useState<{ text: string; sub?: string; tone: string; key: number } | null>(null);
  const viewRef = useRef(view);
  viewRef.current = view;

  // Big full-screen flashes for pings and tags (vibration doesn't work on iPhones).
  useEffect(() => {
    let clear: ReturnType<typeof setTimeout> | undefined;
    const show = (text: string, tone: string, sub?: string, ms = 1400) => {
      setFlash({ text, tone, sub, key: Date.now() });
      clearTimeout(clear);
      clear = setTimeout(() => setFlash(null), ms);
    };
    const unsub = room.subscribe((e) => {
      if (e.kind !== "event") return;
      const v = viewRef.current;
      const role = v.me.status === "alive" ? v.me.role : null;
      const ev = e.event;
      if (ev.kind === "ping") {
        if (role === "seeker") show("PING", "seeker", "Hider locations updated");
        else if (role === "hider") show("PINGED", "hider", "Seekers can see where you were");
        if (role) buzz(150);
      } else if (ev.kind === "seekerPing" && role === "hider") {
        show("SEEKERS SPOTTED", "seeker", "Check the map");
      } else if (ev.kind === "phase" && ev.phase === "hunt") {
        show("HUNT ON", "seeker", role === "seeker" ? "Go find them" : "Seekers are released", 2200);
        buzz([200, 100, 200]);
      } else if (ev.kind === "tagged" && ev.playerId === v.me.id) {
        const infected = v.settings.mode === "infection";
        show(ev.reason === "oob" ? "ELIMINATED" : "TAGGED", "seeker", infected ? "You're a seeker now. Go hunt" : "You're out. Now spectating", 3000);
        buzz([300, 100, 300]);
        setSheet(null);
      }
    });
    return () => {
      unsub();
      clearTimeout(clear);
    };
  }, [room]);

  // Close sheets that no longer make sense (e.g. got tagged while scanning).
  useEffect(() => {
    if ((sheet === "tagSelf" || sheet === "tagCode") && !isHider) setSheet(null);
    if ((sheet === "scan" || sheet === "bots") && !isSeeker) setSheet(null);
  }, [sheet, isHider, isSeeker]);

  const timeLeft = view.phaseEndsAt ? view.phaseEndsAt - now : 0;
  const hidersLeft = view.players.filter((p) => p.role === "hider" && p.status === "alive").length;
  const seekers = view.players.filter((p) => p.role === "seeker" && p.status === "alive");
  const gpsLost = !gps.simulated && (!!gps.error || !gps.updatedAt || Date.now() - gps.updatedAt > GPS_LOST_MS);

  // Ping progress ring
  const pingTotal = headstart ? s.headStartSec * 1000 : s.pingIntervalSec * 1000;
  const pingLeft = view.nextPingAt ? Math.max(0, view.nextPingAt - now) : 0;
  const pingProgress = view.nextPingAt ? Math.min(1, 1 - pingLeft / Math.max(1, pingTotal)) : 0;

  const pinned = view.markers.filter((m) => m.kind !== "live").length;
  const rolePill = spectating ? { label: me.status === "out" ? "Out" : "Watching", cls: "none" } : { label: isSeeker ? "Seeker" : "Hider", cls: me.role! };

  const banners: { tone: string; text: string; sub?: string; action?: { label: string; run: () => void } }[] = [];
  if (headstart) {
    if (isSeeker) banners.push({ tone: "seeker", text: "Wait. Hiders are hiding", sub: `You're released in ${formatClock(timeLeft)}` });
    else if (isHider) banners.push({ tone: "hider", text: "RUN! Get hidden", sub: `Seekers released in ${formatClock(timeLeft)}` });
  }
  if (spectating && view.phase === "hunt") banners.push({ tone: "none", text: "You're out", sub: "Spectating: you can see everyone" });
  if (me.oob) {
    const p = me.oob.penaltyAt;
    const sub =
      p === null
        ? "Get back inside the play area"
        : now < p
          ? `${s.oobPenalty === "reveal" ? "Revealed" : "Eliminated"} in ${formatClock(p - now)}`
          : "Everyone can see where you are";
    banners.push({ tone: "danger", text: "OUT OF BOUNDS", sub });
  }
  if (me.proximityAlert) banners.push({ tone: "danger pulse", text: "SEEKER NEARBY", sub: "Within 50 m" });
  if (gpsLost)
    banners.push({
      tone: "warn",
      text: "Location lost",
      sub: gps.error ?? "Keep this page open with the screen on",
      action: { label: "Simulate", run: () => gps.setSimulated(true) },
    });
  else if (meP?.stale) banners.push({ tone: "warn", text: "Your location isn't updating", sub: "Other players can see that" });

  const taggable = me.taggableBots.map((id) => view.players.find((p) => p.id === id)).filter(Boolean) as PlayerPublic[];

  let primary: { label: string; cls: string; run: () => void; disabled?: boolean } | null = null;
  if (isHider && s.tagMode === "honor") primary = { label: "I got tagged", cls: "danger", run: () => (setTagger(undefined), setSheet("tagSelf")), disabled: headstart };
  else if (isHider) primary = { label: "My tag code", cls: "hider", run: () => setSheet("tagCode"), disabled: !me.tagCode };
  else if (isSeeker && taggable.length) primary = { label: `Tag bot${taggable.length > 1 ? `s (${taggable.length})` : ""}`, cls: "seeker", run: () => setSheet("bots") };
  else if (isSeeker && s.tagMode === "qr") primary = { label: "Scan tag", cls: "seeker", run: () => setSheet("scan"), disabled: headstart };

  return (
    <main className={`game game--${rolePill.cls}`}>
      <MapView
        boundary={s.boundary}
        pins={buildPins(view, now)}
        me={gps.pos && !spectating ? { pos: gps.pos, accuracy: gps.accuracy, role: me.role } : gps.pos ? { pos: gps.pos, accuracy: gps.accuracy, role: null } : null}
        onMapClick={gps.simulated ? gps.setSimPos : undefined}
        fitKey="game"
        className="game-map"
        showRecenter
      />
      <div className="scanlines" aria-hidden="true" />

      <div className="hud">
        <div className={`hud-box hud-role hud-role--${rolePill.cls}`}>
          <span className="label">Role</span>
          <span className="val">{rolePill.label}</span>
        </div>
        <div className="hud-box hud-clock">
          <span className="label">{headstart ? "Head start" : "Time left"}</span>
          <span className="val">{formatClock(timeLeft)}</span>
        </div>
        <div className="hud-box">
          <span className="label">Hiders</span>
          <span className="val">{hidersLeft}</span>
        </div>
      </div>

      <div className="banners">
        {banners.map((b) => (
          <div key={b.text} className={`banner banner--${b.tone}`}>
            <div>
              <b>{b.text}</b>
              {b.sub && <small>{b.sub}</small>}
            </div>
            {b.action && (
              <button className="btn btn-small" onClick={b.action.run}>
                {b.action.label}
              </button>
            )}
          </div>
        ))}
      </div>

      <div className="bottom">
        {!spectating && (
          <div className="pingbar">
            <div className="ring" style={{ "--p": `${pingProgress * 100}%` } as React.CSSProperties} />
            <div>
              <div className="label">{headstart ? "First ping" : isHider ? "You're pinged in" : "Next ping"}</div>
              <div className="val">{formatClock(pingLeft)}</div>
            </div>
            <div className="note">
              {isSeeker && !headstart && `${pinned} hider${pinned === 1 ? "" : "s"} on map`}
              {isHider && view.nextSeekerPingAt && `Seekers shown in ${formatClock(view.nextSeekerPingAt - now)}`}
              {isHider && s.hiderView === "proximity" && "Nearby alert on"}
              {!wakeLock && "wakeLock" in navigator && <span className="note-warn">Screen may sleep</span>}
            </div>
          </div>
        )}
        <div className="actions">
          <button className="btn" onClick={() => setSheet("players")}>
            Players
          </button>
          {primary ? (
            <button className={`btn btn-${primary.cls}`} disabled={primary.disabled} onClick={primary.run}>
              {primary.label}
            </button>
          ) : (
            <div className="actions-hint">{isSeeker ? (headstart ? "Wait for the hunt" : "Hunt them down") : "Spectating"}</div>
          )}
          <button className="btn" onClick={() => (setConfirming(null), setSheet("menu"))}>
            Menu
          </button>
        </div>
      </div>

      {flash && (
        <div key={flash.key} className={`flash flash--${flash.tone}`}>
          <b>{flash.text}</b>
          {flash.sub && <small>{flash.sub}</small>}
        </div>
      )}

      {sheet === "players" && (
        <Sheet title="Players" onClose={() => setSheet(null)}>
          <PlayerList players={view.players} meId={me.id} />
        </Sheet>
      )}

      {sheet === "menu" && (
        <Sheet title="Menu" onClose={() => (setSheet(null), setConfirming(null))}>
          {confirming === null && (
            <>
              {isHost && (
                <button className="btn btn-danger" onClick={() => setConfirming("end")}>
                  End game for everyone
                </button>
              )}
              <button className="btn" onClick={() => setConfirming("leave")}>
                Leave game
              </button>
            </>
          )}
          {confirming === "end" && (
            <>
              <p>End the game now? Everyone goes to the results screen.</p>
              <button
                className="btn btn-danger"
                onClick={() => {
                  room.send({ type: "endGame" });
                  setSheet(null);
                  setConfirming(null);
                }}
              >
                Yes, end it
              </button>
              <button className="btn btn-ghost" onClick={() => setConfirming(null)}>
                Cancel
              </button>
            </>
          )}
          {confirming === "leave" && (
            <>
              <p>{isHider ? "Leave the game? You'll count as caught." : "Leave the game?"}</p>
              <button className="btn btn-danger" onClick={onLeave}>
                Yes, leave
              </button>
              <button className="btn btn-ghost" onClick={() => setConfirming(null)}>
                Cancel
              </button>
            </>
          )}
        </Sheet>
      )}

      {sheet === "tagSelf" && (
        <Sheet title="Got tagged?" onClose={() => setSheet(null)}>
          {tagger === undefined ? (
            <>
              <p className="setting-hint">Who caught you?</p>
              {seekers.map((p) => (
                <button key={p.id} className="btn" onClick={() => setTagger(p.id)}>
                  {p.name}
                </button>
              ))}
              <button className="btn btn-ghost" onClick={() => setTagger(null)}>
                Not sure
              </button>
            </>
          ) : (
            <>
              <p>
                {s.mode === "infection" ? "You'll become a seeker." : "You'll be out for the rest of the game."}
                {tagger && ` Tagged by ${view.players.find((p) => p.id === tagger)?.name}.`}
              </p>
              <button
                className="btn btn-danger"
                onClick={() => {
                  room.send({ type: "tagSelf", byId: tagger });
                  setSheet(null);
                }}
              >
                Yes, I got tagged
              </button>
              <button className="btn btn-ghost" onClick={() => setSheet(null)}>
                Cancel
              </button>
            </>
          )}
        </Sheet>
      )}

      {sheet === "tagCode" && me.tagCode && (
        <Sheet title="Your tag code" onClose={() => setSheet(null)}>
          <TagCodeCard code={me.tagCode} />
        </Sheet>
      )}

      {sheet === "scan" && (
        <Sheet title="Scan a hider" onClose={() => setSheet(null)}>
          <TagScanner
            onCode={(code) => {
              room.send({ type: "tagCode", code });
              setSheet(null);
            }}
          />
        </Sheet>
      )}

      {sheet === "bots" && (
        <Sheet title="Tag a bot" onClose={() => setSheet(null)}>
          {taggable.length === 0 && <p className="setting-hint">No bots in range anymore.</p>}
          {taggable.map((p) => (
            <button
              key={p.id}
              className="btn btn-seeker"
              onClick={() => {
                room.send({ type: "tagBot", botId: p.id });
                setSheet(null);
              }}
            >
              Tag {p.name}
            </button>
          ))}
        </Sheet>
      )}
    </main>
  );
}

function PlayerList({ players, meId }: { players: PlayerPublic[]; meId: string }) {
  const groups: [string, PlayerPublic[]][] = [
    ["Seekers", players.filter((p) => p.role === "seeker" && p.status === "alive")],
    ["Hiders", players.filter((p) => p.role === "hider" && p.status === "alive")],
    ["Out", players.filter((p) => p.status === "out")],
  ];
  return (
    <div className="player-list">
      {groups.map(([title, list]) =>
        list.length ? (
          <div key={title}>
            <h3>
              {title} · {list.length}
            </h3>
            {list.map((p) => (
              <div key={p.id} className="player-line">
                <Avatar name={p.name} isBot={p.isBot} />
                <span className="player-name">
                  {p.name}
                  {p.id === meId && <small> (you)</small>}
                </span>
                {p.stale && <span className="badge badge--warn">no signal</span>}
                {p.revealed && <span className="badge badge--warn">revealed</span>}
                {!p.connected && <span className="badge">offline</span>}
                {p.isHost && <span className="badge">host</span>}
              </div>
            ))}
          </div>
        ) : null,
      )}
    </div>
  );
}
