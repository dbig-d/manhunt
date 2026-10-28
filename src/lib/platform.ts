// Which phone and browser this is, for showing the right instructions.

export const isIOS = () =>
  /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

export const isAndroid = () => /Android/i.test(navigator.userAgent);

export const isHomeScreenApp = () =>
  (navigator as Navigator & { standalone?: boolean }).standalone === true || matchMedia("(display-mode: standalone)").matches;

/** iOS version, e.g. 17.5 (Infinity if it can't tell). */
export function iosVersion() {
  const m = /OS (\d+)_(\d+)/.exec(navigator.userAgent);
  return m ? Number(m[1]) + Number(m[2]) / 10 : Infinity;
}

export type BrowserKind = "ios-safari" | "ios-chrome" | "ios-firefox" | "ios-edge" | "ios-other" | "android-chrome" | "android-samsung" | "android-other" | "desktop";

export function browserKind(): BrowserKind {
  const ua = navigator.userAgent;
  if (isIOS()) {
    if (/CriOS/.test(ua)) return "ios-chrome";
    if (/FxiOS/.test(ua)) return "ios-firefox";
    if (/EdgiOS/.test(ua)) return "ios-edge";
    if (/Instagram|FBAN|FBAV|Snapchat|TikTok|Line\//.test(ua)) return "ios-other";
    return "ios-safari";
  }
  if (isAndroid()) {
    if (/SamsungBrowser/.test(ua)) return "android-samsung";
    if (/Chrome/.test(ua) && !/wv\)|Instagram|FBAN|FBAV|Snapchat/.test(ua)) return "android-chrome";
    return "android-other";
  }
  return "desktop";
}

/** Opened inside an app like Instagram or Snapchat, whose built-in browser often can't share location. */
export const inAppBrowser = () => /Instagram|FBAN|FBAV|Snapchat|TikTok|Line\/|; wv\)/.test(navigator.userAgent);
