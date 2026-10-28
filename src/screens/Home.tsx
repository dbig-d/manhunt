import { useState } from "react";
import Appearance from "../components/Appearance";
import { tooOld } from "../components/CrashScreen";
import Icon from "../components/Icon";
import TestingTools from "../components/TestingTools";
import { Sheet } from "../components/ui";
import { apiUrl } from "../lib/api";
import HowToPlay from "./HowToPlay";

const NAME_KEY = "mh:name";

export default function Home({ onEnter, error }: { onEnter: (code: string, name: string) => void; error: string | null }) {
  const [name, setName] = useState(() => localStorage.getItem(NAME_KEY) ?? "");
  // Shared invite links look like /?join=KX4P
  const [code, setCode] = useState(() => new URLSearchParams(location.search).get("join")?.toUpperCase().slice(0, 4) ?? "");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [sheet, setSheet] = useState<"howto" | "testing" | "appearance" | null>(null);
  const [tooOldMessage] = useState(tooOld);

  const cleanName = name.trim();
  const remember = () => {
    try {
      localStorage.setItem(NAME_KEY, cleanName);
    } catch {
      // private mode; not important
    }
  };

  const create = async () => {
    if (!cleanName) return setProblem("Enter your name first");
    setBusy(true);
    setProblem(null);
    try {
      const res = await fetch(apiUrl("/api/rooms"), { method: "POST" }).catch(() => null);
      if (!res || !res.headers.get("content-type")?.includes("json")) throw new Error("Couldn't reach the game server");
      const data = (await res.json()) as { code?: string; error?: string };
      if (!data.code) throw new Error(data.error ?? "Couldn't create a room");
      remember();
      onEnter(data.code, cleanName);
    } catch (e) {
      setProblem(e instanceof Error ? e.message : "Couldn't create a room");
    } finally {
      setBusy(false);
    }
  };

  const join = () => {
    if (!cleanName) return setProblem("Enter your name first");
    if (code.length !== 4) return setProblem("Room codes are 4 characters");
    remember();
    onEnter(code, cleanName);
  };

  const shownError = problem ?? error;

  return (
    <main className="home screen">
      <button className="home-theme-btn" onClick={() => setSheet("appearance")} aria-label="Change theme">
        <i />
        Theme
      </button>
      <header className="home-hero">
        <div className="radar" aria-hidden="true">
          <div className="radar-sweep" />
          <span className="radar-blip" style={{ left: "66%", top: "30%" }} />
          <span className="radar-blip" style={{ left: "28%", top: "64%", animationDelay: "-0.8s" }} />
          <span className="radar-blip radar-blip--seeker" style={{ left: "52%", top: "52%" }} />
        </div>
        <div className="eyebrow">Real-life hide &amp; seek</div>
        <h1 className="logo">MANHUNT</h1>
        <p className="tagline">Run. Hide. Get pinged.</p>
      </header>

      {tooOldMessage && (
        <p className="form-error">
          <Icon name="alert" size={18} />
          {tooOldMessage}
        </p>
      )}

      <section className="card home-card">
        <label className="field">
          <span>Your name</span>
          <input
            value={name}
            maxLength={16}
            autoComplete="nickname"
            placeholder="e.g. Maya"
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && (code.length === 4 ? join() : create())}
          />
        </label>

        {code.length === 4 && new URLSearchParams(location.search).has("join") ? (
          <button className="btn btn--primary btn--big" onClick={join}>
            Join room {code}
          </button>
        ) : (
          <button className="btn btn--primary btn--big" disabled={busy} onClick={create}>
            <Icon name="plus" />
            {busy ? "Creating…" : "Create game"}
          </button>
        )}

        <div className="divider">or join with a code</div>

        <div className="row">
          <input
            className="code-input"
            value={code}
            maxLength={4}
            placeholder="CODE"
            aria-label="Room code"
            autoCapitalize="characters"
            autoComplete="off"
            spellCheck={false}
            onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))}
            onKeyDown={(e) => e.key === "Enter" && join()}
          />
          <button className="btn flex-none" style={{ width: 96 }} onClick={join}>
            Join
          </button>
        </div>

        {shownError && (
          <p className="form-error">
            <Icon name="alert" size={18} />
            {shownError}
          </p>
        )}
      </section>

      <nav className="home-links">
        <button className="link-btn" onClick={() => setSheet("howto")}>
          <Icon name="help" size={18} />
          How to play
        </button>
        <button className="link-btn" onClick={() => setSheet("appearance")}>
          <Icon name="palette" size={18} />
          Appearance
        </button>
        <button className="link-btn" onClick={() => setSheet("testing")}>
          <Icon name="wrench" size={18} />
          Testing tools
        </button>
      </nav>
      <p className="home-foot">Test build · Play outdoors, stay safe</p>

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
    </main>
  );
}
