import { useGps } from "../lib/location";
import { browserKind, inAppBrowser, isHomeScreenApp, type BrowserKind } from "../lib/platform";
import Icon from "./Icon";

/** Where to switch location on, for this exact phone and browser. */
function steps(kind: BrowserKind): string[] {
  const iosApp = (app: string) => [
    "Open the Settings app → Privacy & Security → Location Services, and make sure it's on.",
    `Scroll down to ${app}, choose “While Using the App”, and turn on Precise Location.`,
    "Come back here and tap Try again.",
  ];
  switch (kind) {
    case "ios-safari":
      return [
        "Open the Settings app → Privacy & Security → Location Services, and make sure it's on.",
        `Scroll down to Safari Websites, choose “While Using the App” or “Ask Next Time”, and turn on Precise Location.${isHomeScreenApp() ? " (Home-screen apps use Safari's setting.)" : ""}`,
        "Back here, tap the aA button in the address bar → Website Settings → Location → Allow.",
        "Tap Try again (or reload the page).",
      ];
    case "ios-chrome":
      return iosApp("Chrome");
    case "ios-firefox":
      return iosApp("Firefox");
    case "ios-edge":
      return iosApp("Edge");
    case "ios-other":
      return ["You're in another app's built-in browser, which usually can't share location.", "Tap ••• or the share button and choose Open in Safari, then join again there."];
    case "android-chrome":
      return [
        "Make sure your phone's Location is on: swipe down from the top and tap Location.",
        "Tap the icon to the left of the web address → Permissions → Location → Allow.",
        "Tap Try again.",
      ];
    case "android-samsung":
      return [
        "Make sure your phone's Location is on: swipe down from the top and tap Location.",
        "Tap the lock icon next to the web address → Permissions → Location → Allow.",
        "Tap Try again.",
      ];
    case "android-other":
      return ["If you opened this from another app, open it in Chrome instead.", "Allow location for this site, then tap Try again."];
    default:
      return ["Click the icon to the left of the web address and allow location.", "On a computer, Testing tools → Simulated GPS lets you play without GPS."];
  }
}

export function LocationHelp() {
  return (
    <ol className="loc-steps">
      {steps(browserKind()).map((s) => (
        <li key={s}>{s}</li>
      ))}
    </ol>
  );
}

/**
 * Location status for the lobby: a clear "Allow location" step the first time, live
 * status once it's on, and fix-it steps when it's blocked.
 */
export default function LocationCard() {
  const gps = useGps();

  if (gps.simulated) {
    return (
      <div className="loc-row">
        <Icon name="wrench" size={16} />
        Simulated GPS is on (Testing tools)
      </div>
    );
  }

  if (gps.status === "on") {
    const rough = (gps.accuracy ?? 0) > 100;
    return (
      <div className={`loc-row ${rough ? "loc-row--warn" : "loc-row--ok"}`}>
        <Icon name={rough ? "alert" : "check"} size={16} />
        {rough
          ? `Your location is very rough (±${Math.round(gps.accuracy!)} m). Turn on Precise Location for this browser.`
          : `Location on · accurate to ±${Math.round(gps.accuracy ?? 0)} m`}
      </div>
    );
  }

  if (gps.status === "denied" || gps.status === "unavailable") {
    const blocked = gps.status === "denied";
    return (
      <section className="loc-card loc-card--bad">
        <div className="loc-head">
          <span className="loc-icon">
            <Icon name="signalOff" size={22} />
          </span>
          <div>
            <b>{blocked ? "Location is blocked" : "This browser can't share location"}</b>
            <p>{blocked ? "Without it you won't show up on the map. Here's how to switch it on:" : inAppBrowser() ? "Open this page in Safari or Chrome instead." : "Try opening this page in Safari (iPhone) or Chrome (Android)."}</p>
          </div>
        </div>
        {blocked && <LocationHelp />}
        {blocked && (
          <div className="row">
            <button className="btn btn--primary" onClick={gps.request}>
              Try again
            </button>
            <button className="btn flex-none" onClick={() => location.reload()}>
              Reload
            </button>
          </div>
        )}
      </section>
    );
  }

  const asking = gps.status === "asking";
  const searching = gps.status === "searching";
  return (
    <section className="loc-card">
      <div className="loc-head">
        <span className={`loc-icon ${searching ? "loc-icon--pulse" : ""}`}>
          <Icon name="pin" size={22} />
        </span>
        <div>
          <b>{searching ? "Finding you…" : "Turn on your location"}</b>
          <p>
            {searching
              ? "The first fix can take a few seconds. Outdoors works best."
              : asking
                ? "Tap Allow when your phone asks."
                : "The game needs it to put you on the map. It's only shared with this room, and deleted after."}
          </p>
        </div>
      </div>
      {!searching && (
        <button className="btn btn--primary btn--block" disabled={asking} onClick={gps.request}>
          <Icon name="pin" size={18} />
          {asking ? "Waiting for your answer…" : "Allow location"}
        </button>
      )}
    </section>
  );
}
