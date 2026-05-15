import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "json-summary"],
      include: ["src/**/*.ts"],
      exclude: [
        "src/**/*.test.ts",
        "src/**/*.test-d.ts",
        "src/**/index.ts",
        "src/**/*.d.ts",
      ],
      thresholds: {
        // Uniform floor across @layoutit/polycss, -core, -react, -vue.
        // Reflects reality today (core is comfortably above 90 on three
        // metrics; this is the shared minimum). Ratchet up over time.
        statements: 80,
        branches: 75,
        functions: 80,
        lines: 80,
      },
    },
  },
});
