import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import type { PlayerPublic, RoomView } from "../../shared/protocol";
import { ITEM_BY_ID } from "../../shared/items";
import Appearance from "../components/Appearance";
import Icon, { ITEM_ICON, type IconName } from "../components/Icon";
import LocationCard, { LocationHelp } from "../components/LocationCard";
import MapView from "../components/MapView";
import TestingTools from "../components/TestingTools";
import { Avatar, Sheet, SettingRow, Toggle } from "../components/ui";
import { buzz, formatClock } from "../lib/hooks";
import { useCompass, useTrail } from "../lib/heading";
import { useKeepAwake } from "../lib/keepAwake";
import { useGps } from "../lib/location";
import { buildPins } from "../lib/pins";
import { isMuted, onMutedChange, setMuted, sfx } from "../lib/sound";
import type { Room } from "../lib/useRoom";
import Chat from "./Chat";
import HowToPlay from "./HowToPlay";
import Shop from "./Shop";

// The QR code and camera scanner are only loaded when someone opens them.
const TagCodeCard = lazy(() => import("../components/TagCode").then((m) => ({ default: m.TagCodeCard })));
const TagScanner = lazy(() => import("../components/TagCode").then((m) => ({ default: m.TagScanner })));

type SheetName = "menu" | "players" | "chat" | "shop" | "tagSelf" | "tagCode" | "scan" | "bots" | "howto" | "testing" | "appearance" | "location" | null;
const GPS_LOST_MS = 30_000;

interface Banner {
  tone: string;
  icon: IconName;
  text: string;
  sub?: string;
  action?: { label: string; run: () => void };
  /** Lower shows first. */
  priority: number;
}

export default function GameScreen({ room, view, now, onLeave }: { room: Room; view: RoomView; now: number; onLeave: () => void }) {
  const gps = useGps();
  const keepAwake = useKeepAwake(true);
  const compass = useCompass(true);
  const { trail, heading: movingHeading } = useTrail(gps.pos);
  const s = view.settings;
  const me = view.me;
  const meP = view.players.find((p) => p.id === me.id);
  const isHost = view.hostId === me.id;
  const spectating = me.status === "out" || me.role === null;
  const isSeeker = !spectating && me.role === "seeker";
  const isHider = !spectating && me.role === "hider";
  const headstart = view.phase === "headstart";
  const night = s.mode === "night";
  const canShop = !spectating && s.shop.enabled && (isHider || s.shop.seekerEconomy);

  const [sheet, setSheet] = useState<SheetName>(null);
  const [tagger, setTagger] = useState<string | null | undefined>(undefined);
  const [confirming, setConfirming] = useState<"end" | "leave" | null>(null);
  const [flash, setFlash] = useState<{ text: string; sub?: string; tone: string; key: number } | null>(null);
  const [muted, setMutedState] = useState(isMuted);
  const [readAt, setReadAt] = useState(0);
  const viewRef = useRef(view);
  viewRef.current = view;
  const sheetRef = useRef(sheet);
  sheetRef.current = sheet;

  useEffect(() => onMutedChange(setMutedState), []);

  // Big full-screen flashes and sounds for game moments (vibration doesn't work on iPhones).
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
      switch (ev.kind) {
        case "ping":
          if (role === "seeker") show("PING", "seeker", "Hider locations updated");
          else if (role === "hider") show("PINGED", "hider", "Seekers can see where you were");
          if (role) {
            sfx.ping();
            buzz(150);
          }
          break;
        case "seekerPing":
          if (role === "hider") show("SEEKERS SPOTTED", "seeker", "Check the map");
          break;
        case "phase":
          if (ev.phase === "hunt") {
            show("HUNT ON", "seeker", role === "seeker" ? "Go find them" : "Seekers are released", 2200);
            sfx.start();
            buzz([200, 100, 200]);
          }
          break;
        case "tagged":
          if (ev.playerId === v.me.id) {
            const converted = v.settings.whenTagged === "seeker";
            show(ev.reason === "oob" ? "ELIMINATED" : "TAGGED", "seeker", converted ? "You're a seeker now. Go hunt" : "You're out. Now spectating", 3000);
            sfx.tagged();
            buzz([300, 100, 300]);
            setSheet(null);
          } else sfx.tag();
          break;
        case "revived":
          if (ev.playerId === v.me.id) {
            show("REVIVED", "hider", "You're back in. Get hidden", 2600);
            sfx.start();
          }
          break;
        case "zone":
          if (ev.what === "spawn") sfx.coin();
          else if (role === "seeker") {
            show("ZONE ALERT", "seeker", "A hider just walked into a safe zone");
            sfx.warn();
          }
          break;
        case "item": {
          const info = ITEM_BY_ID[ev.item];
          if (ev.mine) {
            show(info.name.toUpperCase(), "info", info.description, 1800);
            sfx.buy();
          } else if (ev.item === "blackout") {
            sfx.warn();
            buzz([100, 50, 100, 50, 100]);
          }
          break;
        }
        case "storm":
          show("STORM", "seeker", "The play area is shrinking. Stay inside", 2600);
          sfx.warn();
          buzz([200, 100, 200]);
          break;
        case "chat":
          if (ev.msg.fromId !== v.me.id && sheetRef.current !== "chat") sfx.message();
          break;
      }
    });
    return () => {
      unsub();
      clearTimeout(clear);
    };
  }, [room]);

  // A little chime as coins come in.
  const whole = Math.floor(me.coins);
  const lastWhole = useRef(whole);
  useEffect(() => {
    if (whole > lastWhole.current && isHider) sfx.coin();
    lastWhole.current = whole;
  }, [whole, isHider]);

  // Close sheets that no longer make sense (e.g. got tagged while scanning).
  useEffect(() => {
    if ((sheet === "tagSelf" || sheet === "tagCode") && !isHider) setSheet(null);
    if ((sheet === "scan" || sheet === "bots") && !isSeeker) setSheet(null);
    if (sheet === "shop" && !canShop) setSheet(null);
  }, [sheet, isHider, isSeeker, canShop]);

  // Unread chat badge.
  const channelMessages = room.messages.filter((m) => m.channel === me.channel && m.fromId !== me.id);
  const unread = sheet === "chat" ? 0 : channelMessages.filter((m) => m.at > readAt).length;
  const openChat = () => {
    setReadAt(now);
    setSheet("chat");
  };

  const timeLeft = view.phaseEndsAt ? view.phaseEndsAt - now : 0;
  const seekers = view.players.filter((p) => p.role === "seeker" && p.status === "alive");
  const gpsLost = !gps.simulated && (!!gps.error || !gps.updatedAt || Date.now() - gps.updatedAt > GPS_LOST_MS);

  // Ping progress ring
  const pingTotal = headstart ? s.headStartSec * 1000 : s.pingIntervalSec * 1000;
  const pingLeft = view.nextPingAt ? Math.max(0, view.nextPingAt - now) : 0;
  const pingProgress = view.nextPingAt ? Math.min(1, 1 - pingLeft / Math.max(1, pingTotal)) : 0;
  const pinned = view.markers.filter((m) => m.role === "hider" && m.kind !== "live" && m.kind !== "flag").length;
  const rolePill = spectating ? { label: me.status === "out" ? "Out" : "Watching", cls: "none" } : { label: isSeeker ? "Seeker" : "Hider", cls: me.role! };

  const banners: Banner[] = [];
  if (headstart) {
    if (isSeeker) banners.push({ priority: 5, tone: "seeker", icon: "clock", text: "Wait. Hiders are hiding", sub: `You're released in ${formatClock(timeLeft)}` });
    else if (isHider) banners.push({ priority: 5, tone: "hider", icon: "run", text: "RUN! Get hidden", sub: `Seekers released in ${formatClock(timeLeft)}` });
  }
  if (spectating && view.phase === "hunt") banners.push({ priority: 6, tone: "none", icon: "eye", text: "You're out", sub: "Spectating: you can see everyone" });
  if (me.oob) {
    const p = me.oob.penaltyAt;
    const sub = p === null ? "Get back inside the play area" : now < p ? `${s.oobPenalty === "reveal" ? "Revealed" : "Eliminated"} in ${formatClock(p - now)}` : "Everyone can see where you are";
    banners.push({ priority: 0, tone: "danger", icon: "alert", text: "OUT OF BOUNDS", sub });
  }
  if (me.proximityAlert) banners.push({ priority: 1, tone: "danger pulse", icon: "alert", text: "SEEKER NEARBY", sub: "Move. Now." });
  if (view.stormStartsAt && !spectating) {
    if (now < view.stormStartsAt && view.stormStartsAt - now < 90_000) {
      banners.push({ priority: 3, tone: "warn", icon: "storm", text: "Storm incoming", sub: `The area starts shrinking in ${formatClock(view.stormStartsAt - now)}` });
    } else if (now >= view.stormStartsAt && view.stormTarget) {
      banners.push({ priority: 7, tone: "warn", icon: "storm", text: "The storm is closing in", sub: "Head for the dotted red ring" });
    }
  }
  if (me.zoneId && isHider) banners.push({ priority: 4, tone: "zone", icon: "coin", text: "In a safe zone", sub: `Earning coins · ${s.zones.coinsPerMin}/min, shared` });
  if (gps.status === "needs-permission" || gps.status === "asking")
    banners.push({ priority: 1, tone: "danger", icon: "pin", text: "Turn on your location", sub: "You're not on the map until you do", action: { label: "Allow", run: gps.request } });
  else if (gps.status === "denied" || gps.status === "unavailable")
    banners.push({ priority: 1, tone: "danger", icon: "signalOff", text: "Location is blocked", sub: "Nobody can see you, and you can't be pinged", action: { label: "Fix", run: () => setSheet("location") } });
  else if (gpsLost)
    banners.push({ priority: 2, tone: "warn", icon: "signalOff", text: "Location lost", sub: gps.error ?? "Keep this page open with the screen on", action: { label: "Help", run: () => setSheet("location") } });
  else if (meP?.stale) banners.push({ priority: 2, tone: "warn", icon: "signalOff", text: "Your location isn't updating", sub: "Other players can see that" });
  if (keepAwake.needsTap) banners.push({ priority: 8, tone: "warn", icon: "sound", text: "Screen may turn off", sub: "Tap to keep it on, so your location keeps sending", action: { label: "Keep on", run: keepAwake.enable } });
  if (compass.status === "needs-permission") banners.push({ priority: 9, tone: "info", icon: "compass", text: "Turn on your compass", sub: "Shows which way you're facing", action: { label: "Enable", run: () => (compass.request(), keepAwake.enable()) } });
  const shown = banners.sort((a, b) => a.priority - b.priority).slice(0, 3);

  const taggable = me.taggableBots.map((id) => view.players.find((p) => p.id === id)).filter(Boolean) as PlayerPublic[];

  let primary: { label: string; icon: IconName; cls: string; run: () => void; disabled?: boolean } | null = null;
  if (isHider && s.tagMode === "honor") primary = { label: "I got tagged", icon: "hand", cls: "danger", run: () => (setTagger(undefined), setSheet("tagSelf")), disabled: headstart };
  else if (isHider) primary = { label: "My tag code", icon: "qr", cls: "hider", run: () => setSheet("tagCode"), disabled: !me.tagCode };
  else if (isSeeker && taggable.length) primary = { label: `Tag bot${taggable.length > 1 ? `s (${taggable.length})` : ""}`, icon: "target", cls: "seeker", run: () => setSheet("bots") };
  else if (isSeeker && s.tagMode === "qr") primary = { label: "Scan tag", icon: "scan", cls: "seeker", run: () => setSheet("scan"), disabled: headstart };

  const pins = useMemo(() => buildPins(view, now), [view, now]);
  const meOnMap = useMemo(
    () => (gps.pos ? { pos: gps.pos, accuracy: gps.accuracy, role: spectating ? null : me.role } : null),
    [gps.pos, gps.accuracy, spectating, me.role],
  );

  return (
    <main className={`game game--${rolePill.cls}`}>
      <MapView
        boundary={view.boundaryNow}
        stormTarget={view.stormTarget}
        pins={pins}
        zones={view.zones}
        now={now}
        myZoneId={me.zoneId}
        me={meOnMap}
        onMapClick={gps.simulated ? gps.setSimPos : undefined}
        fitKey="game"
        className="game-map"
        showRecenter
        night={night}
        compass={compass.status === "on"}
        heading={movingHeading}
        // No compass: show your last few steps so you can still tell which way you're going.
        trail={compass.status === "on" ? undefined : trail}
      />
      <div className="scanlines" aria-hidden="true" />
      {night && <div className="night-veil" aria-hidden="true" />}
      {me.blackoutUntil && (
        <div className="blackout">
          <Icon name="eyeOff" size={44} />
          <b>BLACKOUT</b>
          <span className="muted mono">A hider jammed your map · {formatClock(me.blackoutUntil - now)}</span>
        </div>
      )}

      <div className="game-top">
        <div className="hud">
          <div className={`hud-box hud-role hud-role--${rolePill.cls}`}>
            <span className="label">Role</span>
            <span className="val">{rolePill.label}</span>
          </div>
          <div className={`hud-box hud-clock ${!headstart && timeLeft < 60_000 ? "hud-clock--urgent" : ""}`}>
            <span className="label">{headstart ? "Head start" : "Time left"}</span>
            <span className="val">{formatClock(timeLeft)}</span>
          </div>
          <div className="hud-box">
            <span className="label">Hiders</span>
            <span className="val">{view.hidersLeft ?? "??"}</span>
          </div>
          {canShop && (
            <div className="hud-box hud-coins">
              <span className="label">Coins</span>
              <span className="val">
                <Icon name="coin" size={15} />
                {whole}
              </span>
            </div>
          )}
        </div>

        {me.effects.length > 0 && (
          <div className="effects">
            {me.effects.map((e) => (
              <span key={e.item} className="effect-chip">
                <Icon name={ITEM_ICON[e.item]} size={14} />
                {ITEM_BY_ID[e.item].name}
                {e.until ? ` · ${Math.ceil((e.until - now) / 1000)}s` : " · next ping"}
              </span>
            ))}
          </div>
        )}

        <div className="banners">
          {shown.map((b) => (
            <div key={b.text} className={`banner banner--${b.tone}`}>
              <Icon name={b.icon} size={18} />
              <div>
                <b>{b.text}</b>
                {b.sub && <small>{b.sub}</small>}
              </div>
              {b.action && (
                <button className="btn btn--sm" onClick={b.action.run}>
                  {b.action.label}
                </button>
              )}
            </div>
          ))}
        </div>
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
              {isSeeker && !headstart && <span>{`${pinned} hider${pinned === 1 ? "" : "s"} on map`}</span>}
              {isHider && view.nextSeekerPingAt && <span>Seekers shown in {formatClock(view.nextSeekerPingAt - now)}</span>}
              {isHider && s.hiderView === "proximity" && <span>Nearby alert on</span>}
              {!keepAwake.awake && <span className="note-warn">Screen may sleep</span>}
            </div>
          </div>
        )}
        <div className="dock">
          <button className="dock-btn" onClick={() => (setConfirming(null), setSheet("menu"))}>
            <Icon name="menu" />
            Menu
          </button>
          <button className="dock-btn" onClick={openChat}>
            <Icon name="chat" />
            Chat
            {unread > 0 && <span className="dock-badge">{unread > 9 ? "9+" : unread}</span>}
          </button>
          {primary ? (
            <button className={`btn btn--${primary.cls} dock-main`} disabled={primary.disabled} onClick={primary.run}>
              <Icon name={primary.icon} />
              {primary.label}
            </button>
          ) : (
            <div className="dock-hint">{isSeeker ? (headstart ? "Wait for the hunt" : "Hunt them down") : isHider ? "Stay hidden" : "Spectating"}</div>
          )}
          {canShop ? (
            <button className="dock-btn dock-btn--coin" onClick={() => setSheet("shop")}>
              <Icon name="bag" />
              Shop
            </button>
          ) : (
            <button className="dock-btn" onClick={() => setSheet("players")}>
              <Icon name="users" />
              Players
            </button>
          )}
        </div>
      </div>

      {flash && (
        <div key={flash.key} className={`flash flash--${flash.tone}`}>
          <b>{flash.text}</b>
          {flash.sub && <small>{flash.sub}</small>}
        </div>
      )}

      {sheet === "chat" && <Chat view={view} messages={room.messages} send={room.send} onClose={() => (setReadAt(now), setSheet(null))} />}
      {sheet === "shop" && <Shop view={view} send={room.send} onClose={() => setSheet(null)} />}

      {sheet === "players" && (
        <Sheet title="Players" onClose={() => setSheet(null)}>
          <PlayerList players={view.players} meId={me.id} secret={view.hidersLeft === null} />
        </Sheet>
      )}

      {sheet === "menu" && (
        <Sheet title="Menu" onClose={() => (setSheet(null), setConfirming(null))}>
          {confirming === null && (
            <div className="menu-list">
              <button className="btn btn--block" onClick={() => setSheet("players")}>
                <Icon name="users" size={18} />
                Players
              </button>
              <SettingRow label="Sound effects">
                <Toggle value={!muted} onChange={(on) => setMuted(!on)} label="Sound effects" />
              </SettingRow>
              <SettingRow
                label="Screen stays on"
                hint={
                  keepAwake.method === "wake-lock"
                    ? "On, using the phone's screen lock control"
                    : keepAwake.method === "video"
                      ? "On, using the silent-video backup"
                      : "Off. Tap Fix, and turn off battery saver / Low Power Mode if it won't stick"
                }
              >
                {keepAwake.awake ? (
                  <span className="tag tag--hider">
                    <Icon name="check" size={12} />
                    Active
                  </span>
                ) : (
                  <button className="btn btn--sm" onClick={keepAwake.enable}>
                    Fix
                  </button>
                )}
              </SettingRow>
              <button className="btn btn--block" onClick={() => setSheet("appearance")}>
                <Icon name="palette" size={18} />
                Appearance
              </button>
              <button className="btn btn--block" onClick={() => setSheet("howto")}>
                <Icon name="help" size={18} />
                How to play
              </button>
              <button className="btn btn--block" onClick={() => setSheet("testing")}>
                <Icon name="wrench" size={18} />
                Testing tools
              </button>
              {isHost && (
                <button className="btn btn--block btn--danger" onClick={() => setConfirming("end")}>
                  <Icon name="stop" size={18} />
                  End game for everyone
                </button>
              )}
              <button className="btn btn--block btn--ghost" onClick={() => setConfirming("leave")}>
                <Icon name="logout" size={18} />
                Leave game
              </button>
            </div>
          )}
          {confirming === "end" && (
            <>
              <p>End the game now? Everyone goes to the results screen.</p>
              <button className="btn btn--block btn--danger" onClick={() => (room.send({ type: "endGame" }), setSheet(null), setConfirming(null))}>
                Yes, end it
              </button>
              <button className="btn btn--block btn--ghost" onClick={() => setConfirming(null)}>
                Cancel
              </button>
            </>
          )}
          {confirming === "leave" && (
            <>
              <p>{isHider ? "Leave the game? You'll count as caught." : "Leave the game?"}</p>
              <button className="btn btn--block btn--danger" onClick={onLeave}>
                Yes, leave
              </button>
              <button className="btn btn--block btn--ghost" onClick={() => setConfirming(null)}>
                Cancel
              </button>
            </>
          )}
        </Sheet>
      )}
      {sheet === "howto" && (
        <Sheet title="How to play" onClose={() => setSheet(null)}>
          <HowToPlay />
        </Sheet>
      )}
      {sheet === "testing" && (
        <Sheet title="Testing tools" onClose={() => setSheet(null)}>
          <TestingTools />
        </Sheet>
      )}
      {sheet === "appearance" && (
        <Sheet title="Appearance" onClose={() => setSheet(null)}>
          <Appearance />
        </Sheet>
      )}
      {sheet === "location" && (
        <Sheet title="Location" onClose={() => setSheet(null)}>
          <LocationCard />
          {gps.status === "on" && <p>Location is on, but updates stopped. Keep Manhunt open with the screen on: phones pause location for pages in the background.</p>}
          {gps.status === "searching" && (
            <>
              <p>Still looking for a GPS signal. Head outside, away from tall buildings. If it never arrives:</p>
              <LocationHelp />
            </>
          )}
        </Sheet>
      )}

      {sheet === "tagSelf" && (
        <Sheet title="Got tagged?" onClose={() => setSheet(null)}>
          {tagger === undefined ? (
            <>
              <p>Who caught you?</p>
              {seekers.map((p) => (
                <button key={p.id} className="btn btn--block" style={{ justifyContent: "flex-start" }} onClick={() => setTagger(p.id)}>
                  <Avatar name={p.name} isBot={p.isBot} />
                  {p.name}
                </button>
              ))}
              <button className="btn btn--block btn--ghost" onClick={() => setTagger(null)}>
                Not sure
              </button>
            </>
          ) : (
            <>
              <p>
                {s.whenTagged === "seeker" ? "You'll become a seeker." : "You'll be out for the rest of the game."}
                {tagger && ` Tagged by ${view.players.find((p) => p.id === tagger)?.name}.`}
              </p>
              <button className="btn btn--block btn--danger" onClick={() => (room.send({ type: "tagSelf", byId: tagger }), setSheet(null))}>
                Yes, I got tagged
              </button>
              <button className="btn btn--block btn--ghost" onClick={() => setSheet(null)}>
                Cancel
              </button>
            </>
          )}
        </Sheet>
      )}

      {sheet === "tagCode" && me.tagCode && (
        <Sheet title="Your tag code" onClose={() => setSheet(null)}>
          <Suspense fallback={<p className="hint">Loading…</p>}>
            <TagCodeCard code={me.tagCode} refreshAt={me.tagCodeRefreshAt} now={now} />
          </Suspense>
        </Sheet>
      )}

      {sheet === "scan" && (
        <Sheet title="Scan a hider" onClose={() => setSheet(null)}>
          <Suspense fallback={<p className="hint">Starting camera…</p>}>
            <TagScanner onCode={(code) => (room.send({ type: "tagCode", code }), setSheet(null))} />
          </Suspense>
        </Sheet>
      )}

      {sheet === "bots" && (
        <Sheet title="Tag a bot" onClose={() => setSheet(null)}>
          {taggable.length === 0 && <p className="hint">No bots in range anymore.</p>}
          {taggable.map((p, i) => (
            <button key={p.id} className="btn btn--block btn--seeker" onClick={() => (room.send({ type: "tagBot", botId: p.id }), setSheet(null))}>
              {/* Anonymous mode: don't give away which bot is which. */}
              Tag {s.anonymous ? `hider ${i + 1}` : p.name}
            </button>
          ))}
        </Sheet>
      )}
    </main>
  );
}

function PlayerList({ players, meId, secret }: { players: PlayerPublic[]; meId: string; secret: boolean }) {
  const groups: [string, PlayerPublic[]][] = [
    ["Seekers", players.filter((p) => p.role === "seeker" && p.status === "alive")],
    [secret ? "Hiders (who's left is a secret)" : "Hiders", players.filter((p) => p.role === "hider" && p.status === "alive")],
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
                <span className="player-name" style={{ flex: 1 }}>
                  {p.name}
                  {p.id === meId && <small> (you)</small>}
                </span>
                {p.stale && <span className="badge badge--warn">No signal</span>}
                {p.revealed && <span className="badge badge--warn">Revealed</span>}
                {!p.connected && <span className="badge">Offline</span>}
                {p.isHost && <span className="badge badge--host">Host</span>}
              </div>
            ))}
          </div>
        ) : null,
      )}
    </div>
  );
}
