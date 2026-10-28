import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { cloudflare } from "@cloudflare/vite-plugin";
import { resolve } from "node:path";

const root = import.meta.dirname;

// Translate newer JavaScript down so iPhones from iOS 16 onwards can run it
// (Vite's default needs iOS 16.4+). Polyfills for missing functions are in src/lib/polyfills.ts.
const target = ["safari16", "chrome107", "edge107", "firefox104"];

// MapLibre's package.json says its files have no side effects, so the bundler would
// drop our worker's bare `import "…maplibre-gl-worker.mjs"`. It very much does things.
const keepMapWorker: Plugin = {
  name: "keep-maplibre-worker",
  enforce: "pre",
  async resolveId(source, importer) {
    if (!source.endsWith("maplibre-gl-worker.mjs")) return null;
    const resolved = await this.resolve(source, importer, { skipSelf: true });
    return resolved && { ...resolved, moduleSideEffects: true };
  },
};

// `vite build --mode pages` builds just the website for GitHub Pages, which serves it
// from /manhunt/ and can't run the game server (that stays on Cloudflare).
export default defineConfig(({ mode }) => {
  const pages = mode === "pages";
  return {
    base: pages ? "/manhunt/" : "/",
    plugins: pages ? [react()] : [react(), cloudflare()],
    build: pages ? { outDir: "dist-pages", target } : undefined,
    // The map's background worker is an ES module (that's how MapLibre starts it).
    worker: { format: "es" as const, plugins: () => [keepMapWorker] },
    environments: {
      // Website pages to build (the Worker has its own entry in wrangler.jsonc).
      client: {
        build: {
          target,
          rollupOptions: {
            input: {
              main: resolve(root, "index.html"),
              directions: resolve(root, "design/directions.html"),
            },
          },
        },
      },
    },
  };
});
