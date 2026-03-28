import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    include: ["src/**/*.test.tsx"],
    environment: "happy-dom",
  },
  resolve: {
    alias: {
      "@layoutit/voxcss-core": path.resolve(__dirname, "../core/src/index.ts"),
    },
  },
});
