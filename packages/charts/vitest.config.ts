import { defineConfig } from "vitest/config";
import { resolve } from "path";

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
    },
  },
});
