import { defineConfig } from "vitest/config";

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
  },
});
