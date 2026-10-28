import { useCallback, useEffect, useRef, useState } from "react";
import media from "nosleep.js/src/media.js";
import { iosVersion, isHomeScreenApp, isIOS } from "./platform";

// Keeping the screen on is what keeps the phone sending its location.
//
// 1. The Screen Wake Lock API: Android (Chrome, Samsung Internet, Edge…) and
//    iPhones on iOS 16.4+.
// 2. Fallback: a tiny silent looping video. Phones don't sleep while a video plays.
//    Covers older iPhones, and home-screen apps on iOS before 18.4, where the wake
//    lock says yes but doesn't actually work.
// Browsers only allow these after the player has touched the page, so we also retry
// on every touch until the right one is running.

export type KeepAwakeMethod = "wake-lock" | "video" | null;

/** The wake lock can't be trusted on its own here, so the video runs as well. */
const wakeLockUnreliable = () => !("wakeLock" in navigator) || (isIOS() && isHomeScreenApp() && iosVersion() < 18.4);

function makeVideo() {
  const v = document.createElement("video");
  v.setAttribute("title", "Keep screen on");
  v.setAttribute("playsinline", "");
  for (const [type, src] of [["webm", media.webm], ["mp4", media.mp4]] as const) {
    const s = document.createElement("source");
    s.src = src;
    s.type = `video/${type}`;
    v.appendChild(s);
  }
  v.addEventListener("loadedmetadata", () => {
    if (v.duration <= 1) v.loop = true;
    // The mp4 is longer; keep it in its first half so it never actually ends.
    else v.addEventListener("timeupdate", () => v.currentTime > 0.5 && (v.currentTime = Math.random()));
  });
  return v;
}

export function useKeepAwake(active: boolean) {
  const [method, setMethod] = useState<KeepAwakeMethod>(null);
  const [tried, setTried] = useState(false);
  const lock = useRef<WakeLockSentinel | null>(null);
  const video = useRef<HTMLVideoElement | null>(null);
  const activeRef = useRef(active);
  activeRef.current = active;

  const lockHeld = () => !!lock.current && !lock.current.released;
  const videoOn = () => !!video.current && !video.current.paused;
  /** Which method is genuinely keeping the screen on right now. */
  const current = (): KeepAwakeMethod => (videoOn() ? "video" : lockHeld() && !wakeLockUnreliable() ? "wake-lock" : null);

  const enable = useCallback(async () => {
    if (!activeRef.current) return;
    if ("wakeLock" in navigator && !lockHeld()) {
      try {
        const l = await navigator.wakeLock.request("screen");
        // The game may have ended while we were waiting.
        if (!activeRef.current) return void l.release().catch(() => {});
        lock.current = l;
        l.addEventListener("release", () => {
          if (lock.current === l) lock.current = null;
          setMethod(current());
        });
      } catch {
        // Not allowed yet (needs a tap), or refused (e.g. battery saver).
      }
    }
    if ((wakeLockUnreliable() || !lockHeld()) && !videoOn()) {
      video.current ??= makeVideo();
      try {
        await video.current.play();
        if (!activeRef.current) return void video.current.pause();
      } catch {
        // needs a tap first
      }
    }
    if (activeRef.current) setMethod(current());
    setTried(true);
  }, []);

  useEffect(() => {
    if (!active) return;
    enable();
    const onVisible = () => document.visibilityState === "visible" && enable();
    // Any touch counts as the tap browsers want before they'll keep the screen on.
    const onTouch = () => current() === null && enable();
    document.addEventListener("visibilitychange", onVisible);
    document.addEventListener("pointerdown", onTouch, true);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      document.removeEventListener("pointerdown", onTouch, true);
      lock.current?.release().catch(() => {});
      lock.current = null;
      video.current?.pause();
      setMethod(null);
    };
  }, [active, enable]);

  return { awake: method !== null, method, needsTap: active && tried && method === null, enable };
}
