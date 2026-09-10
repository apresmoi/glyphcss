import { defineConfig } from "vitest/config";
import { resolve } from "path";

export default defineConfig({
  test: {
    // The element classes in glyphcss `extend HTMLElement` at module load, so
    // importing the glyphcss entry needs a DOM env even for this package's
    // pure sample/classify/compile pipeline.
    environment: "happy-dom",
    include: ["src/**/*.test.ts"],
    // A FLOOR under the budget, not a strategy. 83 of this package's files
    // are `widget.*` integration tests over real-shaped pyramids, and their
    // cost is real CPU work, not waiting: on a hosted runner the same test
    // runs 2-2.5x slower per thread than on a developer's machine, so
    // vitest's 5 s default left under 2x headroom on a 2 s test and three of
    // them timed out on work that was proceeding correctly. Tests whose cost
    // is genuinely large still declare their own budget inline with a line
    // saying what the work is — that is the number a reader should see.
    // Settling is NOT what this covers: that is `map.idle()`'s job (see
    // AGENTS.md's "Tests & build"), and a test that hangs waiting for a
    // widget that never goes quiet is a real failure this reports in 30 s.
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
  resolve: {
    alias: {
      // Point at source so tests work without a prior `pnpm build:packages`
      // (CI installs from a frozen lockfile then runs tests; dist/ would be empty).
      "glyphcss": resolve(__dirname, "../glyphcss/src/index.ts"),
    },
  },
});
