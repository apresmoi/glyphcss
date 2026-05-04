import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    environment: "happy-dom",
  },
  resolve: {
    alias: {
      "@polycss/core": path.resolve(__dirname, "../core/src/index.ts"),
    },
  },
});
