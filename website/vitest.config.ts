import { defineConfig } from "vitest/config";

// Chart snapshots captured d3's local-calendar output in this zone.
// Match that calendar before workers start, regardless of the host timezone.
process.env.TZ = "Europe/Berlin";

export default defineConfig({
  // This config runs standalone (not through Astro's Vite config, which pulls
  // in @astrojs/react), so JSX still needs its own transform. The automatic
  // runtime lets a `.test.ts` import pure helpers out of a `.tsx` component
  // module (e.g. synthKit.tsx) without every JSX-bearing export in that
  // module needing `React` in scope.
  esbuild: {
    jsx: "automatic",
  },
  test: {
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    environment: "node",
    // Render-heavy workbench suites time out when every CPU gets a DOM worker.
    maxWorkers: 2,
  },
});
