import { defineConfig } from "vitest/config";
import { resolve } from "path";

export default defineConfig({
  test: {
    environment: "happy-dom",
    include: [
      "src/**/*.test.ts",
      "tests/**/*.test.ts",
    ],
    coverage: {
      provider: "v8",
      include: ["src/**/*.{ts,tsx}"],
      exclude: ["**/*.test.ts", "**/*.test.tsx"],
    },
  },
  resolve: {
    alias: {
      "@voxcss": resolve(__dirname, "src"),
      "@voxcss-core": resolve(__dirname, "../core/src"),
      "@layoutit/voxcss-core": resolve(__dirname, "../core/src"),
      "@layoutit/voxcss-html": resolve(__dirname, "../html/src"),
    },
  },
});
