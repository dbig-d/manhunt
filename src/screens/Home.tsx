import { useState } from "react";
import { apiUrl } from "../lib/api";

const NAME_KEY = "mh:name";

export default function Home({ onEnter, error }: { onEnter: (code: string, name: string) => void; error: string | null }) {
  const [name, setName] = useState(() => localStorage.getItem(NAME_KEY) ?? "");
  // Shared invite links look like /?join=KX4P
  const [code, setCode] = useState(() => new URLSearchParams(location.search).get("join")?.toUpperCase().slice(0, 4) ?? "");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

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

  return (
    <main className="home">
      <div className="home-radar" aria-hidden="true">
        <div className="home-sweep" />
      </div>
      <header className="home-head">
        <div className="eyebrow">IRL hide &amp; seek</div>
        <h1 className="logo">MANHUNT</h1>
      </header>

      <label className="field">
        <span>Your name</span>
        <input
          value={name}
          maxLength={16}
          autoComplete="nickname"
          placeholder="e.g. Maya"
          onChange={(e) => setName(e.target.value)}
        />
      </label>

      <button className="btn btn-primary" disabled={busy} onClick={create}>
        {busy ? "Creating…" : "Create game"}
      </button>

      <div className="divider">
        <span>or join one</span>
      </div>

      <div className="join-row">
        <input
          className="code-input"
          value={code}
          maxLength={4}
          placeholder="CODE"
          autoCapitalize="characters"
          autoComplete="off"
          spellCheck={false}
          onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))}
          onKeyDown={(e) => e.key === "Enter" && join()}
        />
        <button className="btn" onClick={join}>
          Join
        </button>
      </div>

      {(problem || error) && <p className="form-error">{problem ?? error}</p>}

      <p className="home-foot">Phase 1 test build · Bots and simulated GPS available for testing</p>
    </main>
  );
}
