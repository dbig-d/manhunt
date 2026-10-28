import { Component, type ReactNode } from "react";
import { iosVersion, isIOS } from "../lib/platform";
import Icon from "./Icon";

/** Oldest iPhone software that runs the game (the map needs it). */
export const MIN_IOS = 16;

/** Is this phone too old to run the game? Shown on the home screen before anyone tries. */
export function tooOld(): string | null {
  if (isIOS() && iosVersion() < MIN_IOS) return `Manhunt needs iOS ${MIN_IOS} or newer. Update in Settings → General → Software Update.`;
  try {
    const gl = document.createElement("canvas").getContext("webgl2");
    if (!gl) return "This browser can't draw the map (no WebGL 2). Try updating it, or use Safari or Chrome.";
    // Just checking: hand the graphics memory straight back.
    gl.getExtension("WEBGL_lose_context")?.loseContext();
  } catch {
    return "This browser can't draw the map. Try Safari or Chrome.";
  }
  return null;
}

/**
 * If part of the app fails to load or crashes (an old browser, a dropped connection
 * while loading), show what happened and a way out instead of a blank screen.
 */
export class CrashScreen extends Component<{ children: ReactNode; onReset: () => void }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    const loadFailed = /dynamically imported module|Importing a module script failed|Failed to fetch|Load failed/i.test(error.message);
    const old = tooOld();
    return (
      <main className="loading screen">
        <span className="loc-icon" style={{ width: 64, height: 64, borderRadius: 20 }}>
          <Icon name="alert" size={30} />
        </span>
        <h2>{loadFailed ? "Couldn't load the game" : "Something went wrong"}</h2>
        <p className="hint" style={{ maxWidth: 320 }}>
          {old ?? (loadFailed ? "Check your connection and try again." : "Reload to get back in. You'll rejoin your room.")}
        </p>
        <div className="row" style={{ width: "min(320px, 90vw)" }}>
          <button className="btn btn--primary" onClick={() => location.reload()}>
            Reload
          </button>
          <button className="btn" onClick={() => (this.setState({ error: null }), this.props.onReset())}>
            Home
          </button>
        </div>
      </main>
    );
  }
}
