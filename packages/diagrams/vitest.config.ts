import { defineConfig } from "vitest/config";
import { resolve } from "path";

export default defineConfig({
  test: {
    // glyphcss's custom-element exports need HTMLElement while loading.
    environment: "happy-dom",
    include: ["src/**/*.test.ts"],
    // Fit searches take 1-4 s each; work bounds (fitWork, fitAlignment) catch slowdowns, not the clock.
    testTimeout: 30_000,
  },
  resolve: {
    alias: {
      "@glyphcss/core/mermaid": resolve(__dirname, "../core/src/mermaid/index.ts"),
      "glyphcss": resolve(__dirname, "../glyphcss/src/index.ts"),
      "@glyphcss/core": resolve(__dirname, "../core/src/index.ts"),
    },
  },
});
