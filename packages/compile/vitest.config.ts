import { defineConfig } from "vitest/config";
import { resolve } from "path";

export default defineConfig({
  test: {
    // The element classes in glyphcss `extend HTMLElement` at module load, so
    // importing the glyphcss entry needs a DOM env even for the pure compile API.
    environment: "happy-dom",
    include: ["src/**/*.test.ts"],
  },
  resolve: {
    alias: {
      // Point at source so tests work without a prior `pnpm build:packages`
      // (CI installs from a frozen lockfile then runs tests; dist/ would be empty).
      "@glyphcss/core": resolve(__dirname, "../core/src/index.ts"),
      "glyphcss": resolve(__dirname, "../glyphcss/src/index.ts"),
    },
  },
});
