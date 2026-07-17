import { defineConfig } from "vitest/config";
import { resolve } from "path";

export default defineConfig({
  test: {
    environment: "happy-dom",
    include: ["src/**/*.test.ts"],
  },
  resolve: {
    alias: {
      glyphcss: resolve(__dirname, "../glyphcss/src/index.ts"),
    },
  },
});
