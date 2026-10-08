import { defineConfig } from "vitest/config";
import { resolve } from "path";

// The parent-build fixtures captured d3's local-calendar output in this zone.
// Set it before workers start so CI and developer machines compare the same dates.
process.env.TZ = "Europe/Berlin";

export default defineConfig({
  test: {
    // The chart marks/spec module imports `glyphcss` for the cell canvas,
    // and `glyphcss`'s element classes `extend HTMLElement` at module load
    // (see packages/maps/vitest.config.ts's identical note) — a DOM env is
    // needed even though this package's own pipeline never touches the DOM.
    environment: "happy-dom",
    include: ["src/**/*.test.ts"],
  },
  resolve: {
    alias: {
      // Point at source so tests work without a prior `pnpm build:packages`.
      "glyphcss": resolve(__dirname, "../glyphcss/src/index.ts"),
      "@glyphcss/core": resolve(__dirname, "../core/src/index.ts"),
      // `effectsBridge.test.ts`'s determinism gate mounts a real stock
      // effect (`GlyphScrambleEffect`) — same reason as the two aliases
      // above.
      "@glyphcss/effects": resolve(__dirname, "../effects/src/index.ts"),
    },
  },
});
