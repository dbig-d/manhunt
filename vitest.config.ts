import { defineConfig } from "vitest/config";

// Separate from vite.config.ts so tests don't start the Cloudflare dev runtime.
export default defineConfig({
  test: {
    include: ["worker/**/*.test.ts", "shared/**/*.test.ts"],
  },
});
