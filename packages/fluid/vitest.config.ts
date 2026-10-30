import { defineConfig } from "vitest/config";
import { resolve } from "path";

export default defineConfig({
  test: {
    // The DOM runtime and targets are exercised under happy-dom; the sim, cells and
    // protocol layers never touch it.
    environment: "happy-dom",
    include: ["src/**/*.test.ts"],
  },
  resolve: {
    alias: {
      // Point at source so tests work without a prior `pnpm build:packages`.
      "glyphcss": resolve(__dirname, "../glyphcss/src/index.ts"),
      "@glyphcss/core": resolve(__dirname, "../core/src/index.ts"),
    },
  },
});
