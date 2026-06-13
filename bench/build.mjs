// Bundle the bench entry (which imports the local library SOURCE, so edits to
// packages/* are reflected on rebuild — no package dist build needed).
import { build, context } from "esbuild";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const opts = {
  entryPoints: [resolve(here, "main.ts")],
  outfile: resolve(here, "bench.bundle.js"),
  bundle: true,
  format: "esm",
  target: "es2022",
  sourcemap: true,
  logLevel: "info",
};

if (process.argv.includes("--watch")) {
  const ctx = await context(opts);
  await ctx.watch();
  console.log("[bench] watching…");
} else {
  await build(opts);
}
