/// <reference types="vite/client" />

// A tiny silent video that keeps older iPhones awake while it plays.
declare module "nosleep.js/src/media.js" {
  const media: { webm: string; mp4: string };
  export default media;
}

interface ImportMetaEnv {
  /** Game server address for builds hosted elsewhere (e.g. GitHub Pages). */
  readonly VITE_API_URL?: string;
}
