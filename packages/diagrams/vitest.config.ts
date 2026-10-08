import { defineConfig } from "vitest/config";
import { resolve } from "path";

export default defineConfig({
  test: {
    // glyphcss's custom-element exports need HTMLElement while loading.
    environment: "happy-dom",
    include: ["src/**/*.test.ts"],
  },
  resolve: {
    alias: {
      "glyphcss": resolve(__dirname, "../glyphcss/src/index.ts"),
      "@glyphcss/core": resolve(__dirname, "../core/src/index.ts"),
    },
  },
});
