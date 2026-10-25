import { useCallback, useEffect, useRef, useState } from "react";
import media from "nosleep.js/src/media.js";

// Keeping the screen on is what keeps the phone sending its location.
//
// 1. The Screen Wake Lock API: Android Chrome, and iPhones on iOS 16.4+.
// 2. Fallback: a tiny silent looping video. Phones don't sleep while a video plays.
//    Covers older iPhones, and home-screen apps on iOS before 18.4, where the wake
//    lock says yes but doesn't actually work.
// Browsers only allow either one after the player has touched the page, so we also
// retry on every touch until it sticks.

const isIOS = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const isHomeScreenApp = () =>
  (navigator as Navigator & { standalone?: boolean }).standalone === true || matchMedia("(display-mode: standalone)").matches;

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
  const [awake, setAwake] = useState(false);
  const [tried, setTried] = useState(false);
  const lock = useRef<WakeLockSentinel | null>(null);
  const video = useRef<HTMLVideoElement | null>(null);
  const activeRef = useRef(active);
  activeRef.current = active;

  const enable = useCallback(async () => {
    if (!activeRef.current) return;
    let ok = false;
    if ("wakeLock" in navigator && (!lock.current || lock.current.released)) {
      try {
        const l = await navigator.wakeLock.request("screen");
        // The game may have ended while we were waiting.
        if (!activeRef.current) return void l.release().catch(() => {});
        lock.current = l;
        l.addEventListener("release", () => {
          if (lock.current === l) lock.current = null;
          setAwake(!!video.current && !video.current.paused);
        });
        ok = true;
      } catch {
        // not allowed yet (needs a tap) or not supported
      }
    } else if (lock.current && !lock.current.released) {
      ok = true;
    }
    const needVideo = !ok || (isIOS() && isHomeScreenApp());
    if (needVideo) {
      video.current ??= makeVideo();
      if (video.current.paused) {
        try {
          await video.current.play();
          if (!activeRef.current) return void video.current.pause();
          ok = true;
        } catch {
          // needs a tap first
        }
      } else ok = true;
    }
    if (activeRef.current) setAwake(ok);
    setTried(true);
  }, []);

  useEffect(() => {
    if (!active) return;
    enable();
    const onVisible = () => document.visibilityState === "visible" && enable();
    // Any touch counts as the tap browsers want before they'll keep the screen on.
    const onTouch = () => {
      const lockHeld = lock.current && !lock.current.released;
      const videoOn = video.current && !video.current.paused;
      if (!lockHeld && !videoOn) enable();
    };
    document.addEventListener("visibilitychange", onVisible);
    document.addEventListener("pointerdown", onTouch, true);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      document.removeEventListener("pointerdown", onTouch, true);
      lock.current?.release().catch(() => {});
      lock.current = null;
      video.current?.pause();
      setAwake(false);
    };
  }, [active, enable]);

  return { awake, needsTap: active && tried && !awake, enable };
}
