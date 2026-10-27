import { useGps } from "../lib/location";
import { SettingRow, Toggle } from "./ui";

/** Phase 1 testing aids: fake GPS so you can play from a computer. Lives in menus, not on screen. */
export default function TestingTools() {
  const gps = useGps();
  return (
    <>
      <SettingRow label="Simulated GPS" hint="Play from a computer: your position comes from the keyboard and mouse instead.">
        <Toggle value={gps.simulated} onChange={gps.setSimulated} label="Simulated GPS" />
      </SettingRow>
      {gps.simulated ? (
        <p className="hint">
          Click the map to teleport. Walk with <kbd>W</kbd>
          <kbd>A</kbd>
          <kbd>S</kbd>
          <kbd>D</kbd> or the arrow keys, and hold <kbd>Shift</kbd> to run. Every browser tab is its own player.
        </p>
      ) : (
        <p className="hint">Real GPS: {gps.error ?? (gps.pos ? `accurate to ±${Math.round(gps.accuracy ?? 0)} m` : "waiting for a fix…")}</p>
      )}
    </>
  );
}
