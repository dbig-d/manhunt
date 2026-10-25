import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { cloudflare } from "@cloudflare/vite-plugin";
import { resolve } from "node:path";

const root = import.meta.dirname;

// `vite build --mode pages` builds just the website for GitHub Pages, which serves it
// from /manhunt/ and can't run the game server (that stays on Cloudflare).
export default defineConfig(({ mode }) => {
  const pages = mode === "pages";
  return {
    base: pages ? "/manhunt/" : "/",
    plugins: pages ? [react()] : [react(), cloudflare()],
    build: pages ? { outDir: "dist-pages" } : undefined,
    environments: {
      // Website pages to build (the Worker has its own entry in wrangler.jsonc).
      client: {
        build: {
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
