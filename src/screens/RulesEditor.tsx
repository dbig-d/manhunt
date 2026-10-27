import { useState, type ReactNode } from "react";
import type { ItemId, Settings, SettingsPatch } from "../../shared/protocol";
import { LIMITS } from "../../shared/settings";
import { ITEMS } from "../../shared/items";
import { MODE_BY_ID, isCustomized } from "../../shared/modes";
import Icon, { ITEM_ICON, MODE_ICON, type IconName } from "../components/Icon";
import TestingTools from "../components/TestingTools";
import { Segmented, SettingRow, Sheet, Stepper, Toggle } from "../components/ui";
import { formatClock } from "../lib/hooks";

export type RulesTab = "timing" | "pings" | "visibility" | "area" | "tagging" | "zones" | "shop" | "phone";

export const RULE_TABS: { id: RulesTab; label: string; icon: IconName }[] = [
  { id: "timing", label: "Timing", icon: "clock" },
  { id: "pings", label: "Pings", icon: "radar" },
  { id: "visibility", label: "Visibility", icon: "eye" },
  { id: "area", label: "Area", icon: "map" },
  { id: "tagging", label: "Tagging", icon: "hand" },
  { id: "zones", label: "Safe zones", icon: "shield" },
  { id: "shop", label: "Power-ups", icon: "bag" },
  { id: "phone", label: "Phone", icon: "wrench" },
];

const secs = (v: number) => (v < 60 ? `${v} s` : formatClock(v * 1000));
/** Fine steps for small values, bigger steps further up. */
const steps = (fine: number, coarse: number, threshold: number) => (v: number, d: 1 | -1) =>
  (d < 0 ? v <= threshold : v < threshold) ? fine : coarse;

function Group({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <section className="card rules-group">
      {title && <h3>{title}</h3>}
      {children}
    </section>
  );
}

export default function RulesEditor({
  settings: s,
  editable,
  onChange,
  onClose,
  initialTab = "timing",
}: {
  settings: Settings;
  editable: boolean;
  onChange: (patch: SettingsPatch) => void;
  onClose: () => void;
  initialTab?: RulesTab;
}) {
  const [tab, setTab] = useState<RulesTab>(initialTab);
  const off = !editable;
  const mode = MODE_BY_ID[s.mode];
  const item = (id: ItemId, patch: Partial<Settings["shop"]["items"][ItemId]>) => onChange({ shop: { items: { [id]: patch } } });

  const stormStartMin = Math.round((s.gameLengthMin * s.storm.startPct) / 100);
  const stormEndMin = Math.round(s.gameLengthMin * 0.9);

  const head = (
    <div className="rules-head" style={{ padding: 0 }}>
      <span className={`mode-icon mode-icon--${s.mode}`} style={{ width: 40, height: 40, borderRadius: 12 }}>
        <Icon name={MODE_ICON[s.mode]} />
      </span>
      <div>
        <h2>Rules</h2>
        <div className="eyebrow">
          {mode.name}
          {isCustomized(s) && <span className="custom-tag">customized</span>}
        </div>
      </div>
    </div>
  );

  return (
    <Sheet title="Rules" onClose={onClose} full head={head}>
      <div className="rules">
        <nav className="tabs" role="tablist">
          {RULE_TABS.map((t) => (
            <button
              key={t.id}
              role="tab"
              aria-selected={tab === t.id}
              className={`tab ${tab === t.id ? "on" : ""}`}
              ref={(el) => {
                if (el && tab === t.id) el.scrollIntoView({ block: "nearest", inline: "center", behavior: "smooth" });
              }}
              onClick={() => setTab(t.id)}
            >
              <Icon name={t.icon} size={16} />
              {t.label}
            </button>
          ))}
        </nav>

        <div className="rules-body" key={tab}>
          {off && <p className="hint">Only the host can change the rules. Here's everything that's set.</p>}

          {tab === "timing" && (
            <Group>
              <SettingRow label="Head start" hint="Hiders run while seekers wait">
                <Stepper value={s.headStartSec} min={LIMITS.headStartSec[0]} max={LIMITS.headStartSec[1]} step={steps(15, 30, 60)} format={(v) => formatClock(v * 1000)} disabled={off} onChange={(headStartSec) => onChange({ headStartSec })} />
              </SettingRow>
              <SettingRow label="Game length" hint="Hiders win if anyone lasts this long">
                <Stepper value={s.gameLengthMin} min={LIMITS.gameLengthMin[0]} max={LIMITS.gameLengthMin[1]} step={steps(1, 5, 10)} format={(v) => `${v} min`} disabled={off} onChange={(gameLengthMin) => onChange({ gameLengthMin })} />
              </SettingRow>
            </Group>
          )}

          {tab === "pings" && (
            <>
              <Group title="Seekers see hiders">
                <SettingRow label="Ping every" hint="How often hider locations are sent to seekers">
                  <Stepper value={s.pingIntervalSec} min={LIMITS.pingIntervalSec[0]} max={LIMITS.pingIntervalSec[1]} step={15} format={secs} disabled={off} onChange={(pingIntervalSec) => onChange({ pingIntervalSec })} />
                </SettingRow>
                <SettingRow label="Speed up at the end" hint="Pings twice as often in the final 5 minutes">
                  <Toggle value={s.pingSpeedUp} disabled={off} onChange={(pingSpeedUp) => onChange({ pingSpeedUp })} />
                </SettingRow>
                <SettingRow label="Ping style" hint={s.pingStyle === "fuzzy" ? "A 25 m circle the hider is somewhere inside" : "An exact dot where the hider was"} stack>
                  <Segmented value={s.pingStyle} disabled={off} onChange={(pingStyle) => onChange({ pingStyle })} options={[{ value: "exact", label: "Exact dot" }, { value: "fuzzy", label: "Fuzzy circle" }]} />
                </SettingRow>
              </Group>
              <Group title="Hiders see seekers">
                <SettingRow
                  label="What hiders know"
                  hint={s.hiderView === "none" ? "Nothing. Hiders are on their own." : s.hiderView === "pinged" ? "Seeker locations, now and then" : "A warning when a seeker is within 50 m"}
                  stack
                >
                  <Segmented value={s.hiderView} disabled={off} onChange={(hiderView) => onChange({ hiderView })} options={[{ value: "none", label: "Nothing" }, { value: "pinged", label: "Pinged" }, { value: "proximity", label: "Near alert" }]} />
                </SettingRow>
                {s.hiderView === "pinged" && (
                  <SettingRow label="Seeker ping every">
                    <Stepper value={s.hiderViewIntervalSec} min={LIMITS.hiderViewIntervalSec[0]} max={LIMITS.hiderViewIntervalSec[1]} step={30} format={secs} disabled={off} onChange={(hiderViewIntervalSec) => onChange({ hiderViewIntervalSec })} />
                  </SettingRow>
                )}
              </Group>
            </>
          )}

          {tab === "visibility" && (
            <Group>
              <SettingRow label="Hiders see other hiders" hint={s.hidersSeeHiders === "live" ? "Live, all the time" : s.hidersSeeHiders === "pings" ? "Only where they were at each ping" : "Not at all"} stack>
                <Segmented value={s.hidersSeeHiders} disabled={off} onChange={(hidersSeeHiders) => onChange({ hidersSeeHiders })} options={[{ value: "live", label: "Live" }, { value: "pings", label: "At pings" }, { value: "none", label: "Never" }]} />
              </SettingRow>
              <SettingRow label="Seekers see each other" hint="Live positions of the other seekers">
                <Toggle value={s.seekersSeeSeekers} disabled={off} onChange={(seekersSeeSeekers) => onChange({ seekersSeeSeekers })} />
              </SettingRow>
              <SettingRow label="Anonymous" hint="The other team's dots have no names, so you don't know who you're chasing">
                <Toggle value={s.anonymous} disabled={off} onChange={(anonymous) => onChange({ anonymous })} />
              </SettingRow>
              <SettingRow label="Secret hider count" hint="Nobody still playing knows how many hiders are left, or who got caught">
                <Toggle value={s.secretCount} disabled={off} onChange={(secretCount) => onChange({ secretCount })} />
              </SettingRow>
            </Group>
          )}

          {tab === "area" && (
            <>
              <Group title="Leaving the play area">
                <SettingRow
                  label="Penalty"
                  hint={s.oobPenalty === "warn" ? "Just a warning" : s.oobPenalty === "reveal" ? "Hiders who stay out are shown live to everyone" : "Hiders who stay out are eliminated"}
                  stack
                >
                  <Segmented value={s.oobPenalty} disabled={off} onChange={(oobPenalty) => onChange({ oobPenalty })} options={[{ value: "warn", label: "Warn" }, { value: "reveal", label: "Reveal" }, { value: "eliminate", label: "Eliminate" }]} />
                </SettingRow>
                <SettingRow label="Grace period" hint="Time to get back in before the penalty">
                  <Stepper value={s.oobGraceSec} min={LIMITS.oobGraceSec[0]} max={LIMITS.oobGraceSec[1]} step={5} format={(v) => `${v} s`} disabled={off} onChange={(oobGraceSec) => onChange({ oobGraceSec })} />
                </SettingRow>
              </Group>
              <Group title="Storm">
                <SettingRow label="Shrinking play area" hint="The area closes in during the hunt, like a battle royale">
                  <Toggle value={s.storm.enabled} disabled={off} onChange={(enabled) => onChange({ storm: { enabled } })} />
                </SettingRow>
                {s.storm.enabled && (
                  <>
                    <SettingRow label="Starts shrinking" hint={`About ${stormStartMin} min into the hunt`}>
                      <Stepper value={s.storm.startPct} min={LIMITS.stormStartPct[0]} max={LIMITS.stormStartPct[1]} step={5} format={(v) => `${v}%`} disabled={off} onChange={(startPct) => onChange({ storm: { startPct } })} />
                    </SettingRow>
                    <SettingRow label="Final size" hint={`Of the original area, reached at ${stormEndMin} min`}>
                      <Stepper value={s.storm.finalPct} min={LIMITS.stormFinalPct[0]} max={LIMITS.stormFinalPct[1]} step={5} format={(v) => `${v}%`} disabled={off} onChange={(finalPct) => onChange({ storm: { finalPct } })} />
                    </SettingRow>
                  </>
                )}
              </Group>
            </>
          )}

          {tab === "tagging" && (
            <Group>
              <SettingRow label="How tags work" hint={s.tagMode === "honor" ? "Hiders tap “I got tagged” when they're caught" : "Seekers scan a QR code on the hider's screen"} stack>
                <Segmented value={s.tagMode} disabled={off} onChange={(tagMode) => onChange({ tagMode })} options={[{ value: "honor", label: "Honor system" }, { value: "qr", label: "QR scan" }]} />
              </SettingRow>
              <SettingRow label="When a hider is tagged" hint={s.whenTagged === "out" ? "They're out and watch everyone on the map" : "They switch sides and start hunting"} stack>
                <Segmented value={s.whenTagged} disabled={off} onChange={(whenTagged) => onChange({ whenTagged })} options={[{ value: "out", label: "They're out" }, { value: "seeker", label: "Become a seeker" }]} />
              </SettingRow>
            </Group>
          )}

          {tab === "zones" && (
            <Group>
              <SettingRow label="Safe zones" hint="Amber circles that pop up for a while. Hiders inside earn coins, but everyone can see them.">
                <Toggle value={s.zones.enabled} disabled={off} onChange={(enabled) => onChange({ zones: { enabled } })} />
              </SettingRow>
              {s.zones.enabled && (
                <>
                  <SettingRow label="Open at once">
                    <Stepper value={s.zones.maxActive} min={LIMITS.zoneMaxActive[0]} max={LIMITS.zoneMaxActive[1]} step={1} disabled={off} onChange={(maxActive) => onChange({ zones: { maxActive } })} />
                  </SettingRow>
                  <SettingRow label="New zone every">
                    <Stepper value={s.zones.everySec} min={LIMITS.zoneEverySec[0]} max={LIMITS.zoneEverySec[1]} step={30} format={secs} disabled={off} onChange={(everySec) => onChange({ zones: { everySec } })} />
                  </SettingRow>
                  <SettingRow label="Each lasts">
                    <Stepper value={s.zones.durationSec} min={LIMITS.zoneDurationSec[0]} max={LIMITS.zoneDurationSec[1]} step={30} format={secs} disabled={off} onChange={(durationSec) => onChange({ zones: { durationSec } })} />
                  </SettingRow>
                  <SettingRow label="Size" hint="Radius of each zone">
                    <Stepper value={s.zones.radiusM} min={LIMITS.zoneRadiusM[0]} max={LIMITS.zoneRadiusM[1]} step={5} format={(v) => `${v} m`} disabled={off} onChange={(radiusM) => onChange({ zones: { radiusM } })} />
                  </SettingRow>
                  <SettingRow label="Coins per minute" hint="Split between everyone inside, so hiders want their own zone">
                    <Stepper value={s.zones.coinsPerMin} min={LIMITS.zoneCoinsPerMin[0]} max={LIMITS.zoneCoinsPerMin[1]} step={1} disabled={off} onChange={(coinsPerMin) => onChange({ zones: { coinsPerMin } })} />
                  </SettingRow>
                  <SettingRow
                    label="Extra risk"
                    hint={s.zones.pingEffect === "alert" ? "Seekers are told when a hider walks in" : s.zones.pingEffect === "fuzzy" ? "Pings inside a zone are blurry, a small reward" : "Zones only pay coins"}
                    stack
                  >
                    <Segmented value={s.zones.pingEffect} disabled={off} onChange={(pingEffect) => onChange({ zones: { pingEffect } })} options={[{ value: "none", label: "None" }, { value: "alert", label: "Alert seekers" }, { value: "fuzzy", label: "Blurry pings" }]} />
                  </SettingRow>
                </>
              )}
            </Group>
          )}

          {tab === "shop" && (
            <>
              <Group>
                <SettingRow label="Power-up shop" hint={s.zones.enabled ? "Spend coins from safe zones on advantages" : "Turn on safe zones too, or hiders have no way to earn coins"}>
                  <Toggle value={s.shop.enabled} disabled={off} onChange={(enabled) => onChange({ shop: { enabled } })} />
                </SettingRow>
                {s.shop.enabled && (
                  <>
                    <SettingRow label="Seeker shop" hint="Seekers earn coins for each tag and get their own items">
                      <Toggle value={s.shop.seekerEconomy} disabled={off} onChange={(seekerEconomy) => onChange({ shop: { seekerEconomy } })} />
                    </SettingRow>
                    {s.shop.seekerEconomy && (
                      <SettingRow label="Coins per tag">
                        <Stepper value={s.shop.coinsPerTag} min={LIMITS.coinsPerTag[0]} max={LIMITS.coinsPerTag[1]} step={5} disabled={off} onChange={(coinsPerTag) => onChange({ shop: { coinsPerTag } })} />
                      </SettingRow>
                    )}
                  </>
                )}
              </Group>
              {s.shop.enabled &&
                (["hider", "seeker"] as const)
                  .filter((team) => team === "hider" || s.shop.seekerEconomy)
                  .map((team) => (
                    <Group key={team} title={team === "hider" ? "Hider items" : "Seeker items"}>
                      {ITEMS.filter((i) => i.team === team).map((info) => {
                        const cfg = s.shop.items[info.id];
                        return (
                          <div key={info.id} className={`item-row ${cfg.enabled ? "" : "item-row--off"}`}>
                            <div className="item-row-head">
                              <span className={`item-icon ${team === "seeker" ? "item-icon--seeker" : ""}`}>
                                <Icon name={ITEM_ICON[info.id]} />
                              </span>
                              <div>
                                <b>{info.name}</b>
                                <p>{info.description}</p>
                              </div>
                              <Toggle value={cfg.enabled} disabled={off} label={`${info.name} available`} onChange={(enabled) => item(info.id, { enabled })} />
                            </div>
                            <div className="item-row-controls">
                              <label>
                                Price
                                <Stepper value={cfg.price} min={LIMITS.itemPrice[0]} max={LIMITS.itemPrice[1]} step={5} disabled={off} onChange={(price) => item(info.id, { price })} />
                              </label>
                              <label>
                                Uses each
                                <Stepper value={cfg.limit} min={LIMITS.itemLimit[0]} max={LIMITS.itemLimit[1]} step={1} format={(v) => (v === 0 ? "∞" : String(v))} disabled={off} onChange={(limit) => item(info.id, { limit })} />
                              </label>
                            </div>
                          </div>
                        );
                      })}
                    </Group>
                  ))}
            </>
          )}

          {tab === "phone" && (
            <>
              <Group title="Phone went quiet">
                <SettingRow
                  label="If a location stops updating"
                  hint={`After 90 s, e.g. a locked phone or another app open. ${s.stalePenalty === "off" ? "Ignored." : s.stalePenalty === "flag" ? "Everyone sees a warning." : "Their last known spot is shown to everyone."}`}
                  stack
                >
                  <Segmented value={s.stalePenalty} disabled={off} onChange={(stalePenalty) => onChange({ stalePenalty })} options={[{ value: "off", label: "Ignore" }, { value: "flag", label: "Flag" }, { value: "reveal", label: "Reveal" }]} />
                </SettingRow>
              </Group>
              <Group title="Testing">
                <SettingRow label="Seeker bots can tag" hint="Bots tag any hider who comes within 6 m">
                  <Toggle value={s.botsCanTag} disabled={off} onChange={(botsCanTag) => onChange({ botsCanTag })} />
                </SettingRow>
                <TestingTools />
              </Group>
            </>
          )}
        </div>

        <footer className="rules-foot">
          {editable && (
            <button className="btn btn--ghost" onClick={() => onChange({ mode: s.mode })} title={`Put back ${mode.name}'s own rules`}>
              Reset {mode.name}
            </button>
          )}
          <button className="btn btn--primary" onClick={onClose}>
            <Icon name="check" />
            Done
          </button>
        </footer>
      </div>
    </Sheet>
  );
}
