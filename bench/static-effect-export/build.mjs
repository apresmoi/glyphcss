// Bundle generate.ts (which imports library SOURCE via aliases) into a Node ESM
// bundle, then run it to emit both export strategies + size table.
import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));

await build({
  entryPoints: [resolve(here, "generate.ts")],
  outfile: resolve(here, "generate.bundle.mjs"),
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node18",
  logLevel: "info",
  alias: {
    "glyphcss": resolve(here, "../../packages/glyphcss/src/index.ts"),
    "@glyphcss/core": resolve(here, "../../packages/core/src/index.ts"),
    "@glyphcss/effects": resolve(here, "../../packages/effects/src/index.ts"),
  },
});

await import(resolve(here, "generate.bundle.mjs"));
