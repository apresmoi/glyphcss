import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    include: ["src/**/*.test.tsx", "src/**/*.test.ts"],
    environment: "happy-dom",
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "json-summary"],
      include: ["src/**/*.{ts,tsx}"],
      exclude: [
        "src/**/*.test.ts",
        "src/**/*.test.tsx",
        "src/**/index.ts",
        "src/**/*.d.ts",
      ],
      thresholds: {
        statements: 85,
        branches: 75,
        functions: 85,
        lines: 85,
      },
    },
  },
  resolve: {
    alias: {
      "@polycss/core": path.resolve(__dirname, "../core/src/index.ts"),
    },
  },
});
