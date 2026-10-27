// Little synthesized sound effects (no audio files to download). Phones only allow
// sound after a tap, so the audio engine wakes up on the first touch.

const KEY = "mh:muted";
let ctx: AudioContext | null = null;
let muted = (() => {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
})();
const listeners = new Set<(m: boolean) => void>();

function audio() {
  if (!ctx) {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    ctx = new Ctor();
  }
  if (ctx.state === "suspended") ctx.resume().catch(() => {});
  return ctx;
}

if (typeof window !== "undefined") {
  const unlock = () => {
    audio();
    window.removeEventListener("pointerdown", unlock, true);
  };
  window.addEventListener("pointerdown", unlock, true);
}

function tone(freq: number, start: number, length: number, { type = "sine" as OscillatorType, gain = 0.18, to }: { type?: OscillatorType; gain?: number; to?: number } = {}) {
  const a = audio();
  if (!a || muted) return;
  const t = a.currentTime + start;
  const osc = a.createOscillator();
  const vol = a.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  if (to) osc.frequency.exponentialRampToValueAtTime(to, t + length);
  vol.gain.setValueAtTime(0.0001, t);
  vol.gain.exponentialRampToValueAtTime(gain, t + 0.015);
  vol.gain.exponentialRampToValueAtTime(0.0001, t + length);
  osc.connect(vol).connect(a.destination);
  osc.start(t);
  osc.stop(t + length + 0.02);
}

export const sfx = {
  /** Sonar blip: locations went out. */
  ping: () => {
    tone(1320, 0, 0.35, { gain: 0.14 });
    tone(990, 0.12, 0.45, { gain: 0.08 });
  },
  tagged: () => {
    tone(440, 0, 0.18, { type: "square", gain: 0.08 });
    tone(220, 0.16, 0.4, { type: "square", gain: 0.08, to: 110 });
  },
  /** Someone else got tagged. */
  tag: () => tone(660, 0, 0.18, { type: "triangle", gain: 0.12, to: 880 }),
  coin: () => {
    tone(988, 0, 0.08, { type: "square", gain: 0.06 });
    tone(1319, 0.07, 0.25, { type: "square", gain: 0.06 });
  },
  buy: () => {
    tone(523, 0, 0.1, { type: "triangle" });
    tone(784, 0.08, 0.2, { type: "triangle" });
  },
  warn: () => {
    tone(880, 0, 0.12, { type: "sawtooth", gain: 0.07 });
    tone(880, 0.2, 0.12, { type: "sawtooth", gain: 0.07 });
  },
  start: () => {
    tone(392, 0, 0.15, { type: "triangle" });
    tone(523, 0.15, 0.15, { type: "triangle" });
    tone(784, 0.3, 0.35, { type: "triangle" });
  },
  message: () => tone(1046, 0, 0.12, { gain: 0.08 }),
};

export function isMuted() {
  return muted;
}

export function setMuted(m: boolean) {
  muted = m;
  try {
    localStorage.setItem(KEY, m ? "1" : "0");
  } catch {
    // not important
  }
  listeners.forEach((fn) => fn(m));
}

export function onMutedChange(fn: (m: boolean) => void) {
  listeners.add(fn);
  return () => void listeners.delete(fn);
}
