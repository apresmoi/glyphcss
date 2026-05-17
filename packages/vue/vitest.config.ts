import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    environment: "happy-dom",
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "json-summary"],
      include: ["src/**/*.ts"],
      exclude: [
        "src/**/*.test.ts",
        "src/**/index.ts",
        "src/**/*.d.ts",
      ],
      thresholds: {
        statements: 80,
        branches: 75,
        functions: 80,
        lines: 80,
      },
    },
  },
  resolve: {
    alias: {
      "@glyphcss/core": path.resolve(__dirname, "../core/src/index.ts"),
      // Point at source so tests work without a prior `pnpm build:packages`
      // (CI installs from frozen lockfile then runs tests; dist/ would be empty).
      "glyphcss": path.resolve(__dirname, "../glyphcss/src/index.ts"),
    },
  },
});
