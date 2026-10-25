/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Game server address for builds hosted elsewhere (e.g. GitHub Pages). */
  readonly VITE_API_URL?: string;
}
