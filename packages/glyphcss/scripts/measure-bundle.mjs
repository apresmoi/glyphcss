/**
 * Measure what a consumer actually pays for `import "glyphcss"`.
 *
 * With `splitting: true` the entry file alone is meaningless — `dist/index.js`
 * statically imports shared chunks, and a bundler pulls every one of them into
 * the consumer's main bundle. The honest number is the transitive closure over
 * STATIC imports only; a chunk reached solely through `import()` is exactly
 * what we want excluded, so this script is also the measurement that proves
 * the atlas payload is out.
 *
 * Usage: node scripts/measure-bundle.mjs [distDir]
 */
import { readFileSync, existsSync } from "node:fs";
import { dirname, join, resolve, basename } from "node:path";
import { gzipSync } from "node:zlib";

const dist = resolve(process.argv[2] ?? new URL("../dist", import.meta.url).pathname);

// Static: `from "./x.js"` / `require("./x.cjs")`. Dynamic `import("./x.js")`
// is deliberately NOT matched — that is the boundary being measured.
const STATIC_ESM = /(?:^|[;}\s])(?:import|export)\b(?:[^"';]*?from)?\s*["'](\.[^"']+)["']/g;
const STATIC_CJS = /(?<!\.then\([^)]{0,40})require\(["'](\.[^"']+)["']\)/g;

function staticDeps(file) {
  const src = readFileSync(file, "utf8");
  const out = new Set();
  for (const re of [STATIC_ESM, STATIC_CJS]) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(src)) !== null) out.add(resolve(dirname(file), m[1]));
  }
  // A dynamic import compiles to `Promise.resolve().then(() => require(...))`
  // in CJS, which the negative lookbehind above only partly catches; drop any
  // specifier that appears inside a `.then(` on the same line as a safety net.
  for (const dep of [...out]) {
    const needle = basename(dep);
    if (new RegExp(`\\.then\\([^\\n]*${needle.replace(/[.*+?^$()|[\]\\]/g, "\\$&")}`).test(src)) out.delete(dep);
  }
  return [...out].filter(existsSync);
}

function closure(entry) {
  const seen = new Set();
  const queue = [resolve(dist, entry)];
  while (queue.length) {
    const file = queue.pop();
    if (seen.has(file)) continue;
    seen.add(file);
    queue.push(...staticDeps(file));
  }
  return [...seen];
}

const rows = [];
for (const entry of ["index.js", "index.cjs", "elements.js", "three.js"]) {
  if (!existsSync(join(dist, entry))) continue;
  const files = closure(entry);
  const buf = Buffer.concat(files.map((f) => readFileSync(f)));
  rows.push({
    entry,
    files: files.map((f) => basename(f)).sort().join(" + "),
    raw: buf.length,
    gzip: gzipSync(buf, { level: 9 }).length,
  });
}

for (const r of rows) console.log(`${r.entry.padEnd(13)} raw=${String(r.raw).padStart(7)}  gzip=${String(r.gzip).padStart(6)}   [${r.files}]`);
