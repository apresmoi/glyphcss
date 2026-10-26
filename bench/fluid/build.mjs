// Bundle the fluid bench pages against the LOCAL package sources (no dist build needed).
//   node bench/fluid/build.mjs && node bench/fluid/serve.mjs &     # http://127.0.0.1:4361/
//   node bench/fluid/parity.mjs 600 [drop-push]                    # real-Worker parity (+ mutation)
//   node bench/fluid/reader.mjs [shot.png] [capture.txt]               # speed reader: words advance, ORP on centre
//   node bench/fluid/dots.mjs <out.png>                            # dot geometry vs molty's canvas
//   node bench/fluid/bench.mjs <out.json> --setups desktop --throttle 1,4 --scenarios idle,stirred
import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../..");
const alias = {
  "@glyphcss/fluid/reader": resolve(root, "packages/fluid/src/reader/index.ts"),
  "@glyphcss/fluid": resolve(root, "packages/fluid/src/index.ts"),
  glyphcss: resolve(root, "packages/glyphcss/src/index.ts"),
  "@glyphcss/core": resolve(root, "packages/core/src/index.ts"),
  three: resolve(root, "node_modules/three/build/three.module.js"),
};
const page = (entry, out) => ({
  entryPoints: [resolve(here, entry)], outfile: resolve(here, out),
  bundle: true, format: "esm", target: "es2022", sourcemap: true, logLevel: "warning", alias,
});
await Promise.all([
  build(page("src/main.ts", "fluid.bundle.js")),
  build(page("../../packages/fluid/src/runtime/worker.ts", "fluid-worker.bundle.js")),
  build(page("src/parity.ts", "parity.bundle.js")),
  build(page("src/dots.ts", "dots.bundle.js")),
  build(page("src/text.ts", "text.bundle.js")),
  build(page("src/reader.ts", "reader.bundle.js")),
]);
console.log("[fluid bench] built");
