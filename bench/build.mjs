// Bundle each bench entry (which imports the local library SOURCE, so edits to
// packages/* are reflected on rebuild — no package dist build needed).
import { build, context } from "esbuild";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));

// One entry per bench page. `out` is what its .html loads via <script src>.
const ENTRIES = [
  { in: "main.ts", out: "bench.bundle.js" },      // render-perf harness (army.vox drag)
  { in: "lod.ts", out: "lod.bundle.js" },         // per-mesh density: full-screen vs fitted vs occlusion
  { in: "lod-lib.ts", out: "lod-lib.bundle.js" }, // density + transparent demo (library API)
  { in: "lod-fpv.ts", out: "lod-fpv.bundle.js" }, // walkable FPV detail + occlusion demo
  { in: "parity.ts", out: "parity.bundle.js" },   // glyphcss/polycss synchronized footprint parity
  { in: "three-parity.ts", out: "three-parity.bundle.js" }, // three.js ↔ glyphcss adapter ↔ native conversion
];

const opts = (e) => ({
  entryPoints: [resolve(here, e.in)],
  outfile: resolve(here, e.out),
  bundle: true,
  format: "esm",
  target: "es2022",
  sourcemap: true,
  logLevel: "info",
  alias: {
    "glyphcss": resolve(here, "../packages/glyphcss/src/index.ts"),
    "glyphcss/three": resolve(here, "../packages/glyphcss/src/three.ts"),
    "@glyphcss/core": resolve(here, "../packages/core/src/index.ts"),
    "@glyphcss/core/three": resolve(here, "../packages/core/src/three/index.ts"),
    "@layoutit/polycss": resolve(here, "../../Documents/voxcss/packages/polycss/src/index.ts"),
    "@layoutit/polycss-core": resolve(here, "../../Documents/voxcss/packages/core/src/index.ts"),
    "three": resolve(here, "../node_modules/three/build/three.module.js"),
  },
});

if (process.argv.includes("--watch")) {
  for (const e of ENTRIES) {
    const ctx = await context(opts(e));
    await ctx.watch();
  }
  console.log("[bench] watching…");
} else {
  await Promise.all(ENTRIES.map((e) => build(opts(e))));
}
