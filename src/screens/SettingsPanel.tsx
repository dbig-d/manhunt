import type { ReactNode } from "react";
import type { Settings } from "../../shared/protocol";
import { LIMITS } from "../../shared/settings";
import { Segmented, Stepper, Toggle } from "../components/ui";
import { formatClock } from "../lib/hooks";

function Row({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="setting">
      <div className="setting-text">
        <div className="setting-label">{label}</div>
        {hint && <div className="setting-hint">{hint}</div>}
      </div>
      <div className="setting-control">{children}</div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="settings-section">
      <h3>{title}</h3>
      {children}
    </section>
  );
}

const MODE_HINT: Record<Settings["mode"], string> = {
  classic: "Tagged hiders are out and watch everyone on the map.",
  infection: "Tagged hiders join the seekers. The hunting pack grows.",
};

export default function SettingsPanel({
  settings: s,
  editable,
  onChange,
}: {
  settings: Settings;
  editable: boolean;
  onChange: (patch: Partial<Settings>) => void;
}) {
  const off = !editable;
  return (
    <div className="settings">
      <Section title="Game mode">
        <Segmented
          value={s.mode}
          disabled={off}
          onChange={(mode) => onChange({ mode })}
          options={[
            { value: "classic", label: "Classic" },
            { value: "infection", label: "Infection" },
          ]}
        />
        <p className="setting-hint">{MODE_HINT[s.mode]}</p>
      </Section>

      <Section title="Roles">
        <Segmented
          value={s.roleAssignment}
          disabled={off}
          onChange={(roleAssignment) => onChange({ roleAssignment })}
          options={[
            { value: "random", label: "Random" },
            { value: "manual", label: "Host picks" },
            { value: "volunteer", label: "Volunteer" },
          ]}
        />
        {s.roleAssignment === "random" && (
          <Row label="Seekers">
            <Stepper
              value={s.seekerCount}
              min={LIMITS.seekerCount[0]}
              max={LIMITS.seekerCount[1]}
              step={1}
              disabled={off}
              onChange={(seekerCount) => onChange({ seekerCount })}
            />
          </Row>
        )}
        {s.roleAssignment === "manual" && <p className="setting-hint">Tap a player below to set their role. Everyone else hides.</p>}
        {s.roleAssignment === "volunteer" && <p className="setting-hint">Players pick a role. Anyone who doesn't pick hides.</p>}
      </Section>

      <Section title="Timing">
        <Row label="Head start" hint="Hiders run, seekers wait">
          <Stepper
            value={s.headStartSec}
            min={LIMITS.headStartSec[0]}
            max={LIMITS.headStartSec[1]}
            step={(v, d) => ((d < 0 ? v <= 60 : v < 60) ? 15 : 30)}
            format={(v) => formatClock(v * 1000)}
            disabled={off}
            onChange={(headStartSec) => onChange({ headStartSec })}
          />
        </Row>
        <Row label="Game length">
          <Stepper
            value={s.gameLengthMin}
            min={LIMITS.gameLengthMin[0]}
            max={LIMITS.gameLengthMin[1]}
            step={(v, d) => ((d < 0 ? v <= 10 : v < 10) ? 1 : 5)}
            format={(v) => `${v} min`}
            disabled={off}
            onChange={(gameLengthMin) => onChange({ gameLengthMin })}
          />
        </Row>
      </Section>

      <Section title="Pings">
        <Row label="Ping every" hint="Seekers see hider locations">
          <Stepper
            value={s.pingIntervalSec}
            min={LIMITS.pingIntervalSec[0]}
            max={LIMITS.pingIntervalSec[1]}
            step={15}
            format={(v) => (v < 60 ? `${v} s` : formatClock(v * 1000))}
            disabled={off}
            onChange={(pingIntervalSec) => onChange({ pingIntervalSec })}
          />
        </Row>
        <Row label="Speed up at the end" hint="Pings twice as often in the final 5 min">
          <Toggle value={s.pingSpeedUp} disabled={off} onChange={(pingSpeedUp) => onChange({ pingSpeedUp })} />
        </Row>
        <Row label="Ping style">
          <Segmented
            value={s.pingStyle}
            disabled={off}
            onChange={(pingStyle) => onChange({ pingStyle })}
            options={[
              { value: "exact", label: "Exact dot" },
              { value: "fuzzy", label: "Fuzzy circle" },
            ]}
          />
        </Row>
      </Section>

      <Section title="Who sees what">
        <Row label="Hiders see seekers">
          <Segmented
            value={s.hiderView}
            disabled={off}
            onChange={(hiderView) => onChange({ hiderView })}
            options={[
              { value: "none", label: "Never" },
              { value: "pinged", label: "Pinged" },
              { value: "proximity", label: "Near alert" },
            ]}
          />
        </Row>
        {s.hiderView === "pinged" && (
          <Row label="Seeker ping every">
            <Stepper
              value={s.hiderViewIntervalSec}
              min={LIMITS.hiderViewIntervalSec[0]}
              max={LIMITS.hiderViewIntervalSec[1]}
              step={30}
              format={(v) => formatClock(v * 1000)}
              disabled={off}
              onChange={(hiderViewIntervalSec) => onChange({ hiderViewIntervalSec })}
            />
          </Row>
        )}
        {s.hiderView === "proximity" && <p className="setting-hint">Hiders get an alert when a seeker is within 50 m.</p>}
        <Row label="Hiders see other hiders">
          <Segmented
            value={s.hidersSeeHiders}
            disabled={off}
            onChange={(hidersSeeHiders) => onChange({ hidersSeeHiders })}
            options={[
              { value: "live", label: "Live" },
              { value: "pings", label: "At pings" },
              { value: "none", label: "Never" },
            ]}
          />
        </Row>
        <Row label="Seekers see each other live">
          <Toggle value={s.seekersSeeSeekers} disabled={off} onChange={(seekersSeeSeekers) => onChange({ seekersSeeSeekers })} />
        </Row>
        <Row label="Anonymous" hint="The other team's dots have no names, so you don't know who you're chasing">
          <Toggle value={s.anonymous} disabled={off} onChange={(anonymous) => onChange({ anonymous })} />
        </Row>
      </Section>

      <Section title="Leaving the area">
        <Row label="Penalty">
          <Segmented
            value={s.oobPenalty}
            disabled={off}
            onChange={(oobPenalty) => onChange({ oobPenalty })}
            options={[
              { value: "warn", label: "Warn" },
              { value: "reveal", label: "Reveal" },
              { value: "eliminate", label: "Eliminate" },
            ]}
          />
        </Row>
        <Row label="Grace period" hint="Time to get back in">
          <Stepper
            value={s.oobGraceSec}
            min={LIMITS.oobGraceSec[0]}
            max={LIMITS.oobGraceSec[1]}
            step={5}
            format={(v) => `${v} s`}
            disabled={off}
            onChange={(oobGraceSec) => onChange({ oobGraceSec })}
          />
        </Row>
      </Section>

      <Section title="Tagging">
        <Segmented
          value={s.tagMode}
          disabled={off}
          onChange={(tagMode) => onChange({ tagMode })}
          options={[
            { value: "honor", label: "Honor system" },
            { value: "qr", label: "QR scan" },
          ]}
        />
        <p className="setting-hint">
          {s.tagMode === "honor"
            ? "Hiders tap “I got tagged” when they're caught."
            : "Seekers scan a code on the hider's screen to tag them."}
        </p>
      </Section>

      <Section title="Phone went quiet">
        <Row label="If a location stops updating" hint="After 90 s, e.g. a locked phone">
          <Segmented
            value={s.stalePenalty}
            disabled={off}
            onChange={(stalePenalty) => onChange({ stalePenalty })}
            options={[
              { value: "off", label: "Ignore" },
              { value: "flag", label: "Flag" },
              { value: "reveal", label: "Reveal" },
            ]}
          />
        </Row>
      </Section>

      <Section title="Testing">
        <Row label="Seeker bots can tag" hint="Bots tag any hider within 6 m">
          <Toggle value={s.botsCanTag} disabled={off} onChange={(botsCanTag) => onChange({ botsCanTag })} />
        </Row>
      </Section>
    </div>
  );
}
