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
      "@glyphcss/charts/3d": resolve(__dirname, "../charts/src/3d/index.ts"),
      "@glyphcss/charts": resolve(__dirname, "../charts/src/index.ts"),
      "@glyphcss/diagrams/3d": resolve(__dirname, "../diagrams/src/3d/index.ts"),
      "@glyphcss/diagrams": resolve(__dirname, "../diagrams/src/index.ts"),
      "glyphcss": resolve(__dirname, "../glyphcss/src/index.ts"),
    },
  },
});
