import { useState } from "react";
import { useGps } from "../lib/location";
import { Toggle } from "./ui";

/** Phase 1 testing tools: fake GPS so you can play from a desktop. */
export default function DevPanel() {
  const gps = useGps();
  const [open, setOpen] = useState(false);
  return (
    <div className={`dev ${open ? "dev--open" : ""}`}>
      <button className={`dev-chip ${gps.simulated ? "on" : ""}`} onClick={() => setOpen(!open)}>
        {gps.simulated ? "SIM GPS" : "TEST"}
      </button>
      {open && (
        <div className="dev-panel">
          <div className="setting">
            <div className="setting-text">
              <div className="setting-label">Simulated GPS</div>
              <div className="setting-hint">For testing on a computer</div>
            </div>
            <Toggle value={gps.simulated} onChange={gps.setSimulated} />
          </div>
          {gps.simulated ? (
            <p className="setting-hint">
              Click the map to teleport. Walk with <kbd>W</kbd>
              <kbd>A</kbd>
              <kbd>S</kbd>
              <kbd>D</kbd> or arrow keys, hold <kbd>Shift</kbd> to run. Each browser tab is its own player.
            </p>
          ) : (
            <p className="setting-hint">
              Real GPS: {gps.error ?? (gps.pos ? `±${Math.round(gps.accuracy ?? 0)} m` : "waiting for a fix…")}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
