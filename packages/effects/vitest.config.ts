import { defineConfig } from "vitest/config";
import { resolve } from "path";

export default defineConfig({
  test: {
    environment: "happy-dom",
    include: ["src/**/*.test.ts"],
  },
  resolve: {
    // Point at source so tests work without a prior `pnpm build:packages`
    // (CI installs from a frozen lockfile then runs tests; dist/ would be empty).
    // glyphcss's source re-exports @glyphcss/core, so that must be aliased too.
    alias: {
      "@glyphcss/core/three": resolve(__dirname, "../core/src/three/index.ts"),
      "@glyphcss/core": resolve(__dirname, "../core/src/index.ts"),
      "glyphcss/three": resolve(__dirname, "../glyphcss/src/three.ts"),
      glyphcss: resolve(__dirname, "../glyphcss/src/index.ts"),
    },
  },
});
