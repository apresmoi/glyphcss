/**
 * Bundle the four bench renderer paths into self-contained browser ESM
 * files that the perf-*.html pages can `import` directly:
 *
 *   bench/polycss.js          ← imperative API (createPolyScene + controls
 *                                + loadMesh) used by perf-vanilla.html
 *   bench/polycss-elements.js ← side-effect bundle that registers the
 *                                custom elements; used by perf-html.html
 *   bench/polycss-react.js    ← React entry (bench/entries/react.tsx)
 *                                bundled with React + ReactDOM + @polycss/react
 *   bench/polycss-vue.js      ← Vue entry (bench/entries/vue.ts) bundled
 *                                with Vue 3 + @polycss/vue
 *
 * Why not reuse the published dists? The packages keep workspace-peer
 * imports as bare specifiers (e.g. `@polycss/core`), which the browser
 * can't resolve. esbuild here re-bundles with `bundle: true` and aliases
 * the workspace packages to their SOURCE — so editing source lands in
 * the bundle without a tsup build pass.
 *
 * Run: `node bench/build.mjs`  (or `pnpm bench:build`).
 */
import { build } from "esbuild";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");

const ALIASES = {
  "@polycss/core":     resolve(repoRoot, "packages/core/src/index.ts"),
  "polycss":           resolve(repoRoot, "packages/polycss/src/index.ts"),
  "polycss/elements":  resolve(repoRoot, "packages/polycss/src/elements/index.ts"),
  "@polycss/react":    resolve(repoRoot, "packages/react/src/index.ts"),
  "@polycss/vue":      resolve(repoRoot, "packages/vue/src/index.ts"),
  // Pin React + ReactDOM to the workspace-root copies so the alias-resolved
  // @polycss/react source AND the bench entry import the SAME instance.
  // Without this, esbuild treats two `react` imports starting from different
  // tree positions as separate modules → "Cannot read properties of null
  // (reading 'useRef')" because each copy keeps its own internal dispatcher.
  "react":             resolve(repoRoot, "node_modules/react/index.js"),
  "react/jsx-runtime": resolve(repoRoot, "node_modules/react/jsx-runtime.js"),
  "react-dom":         resolve(repoRoot, "node_modules/react-dom/index.js"),
  "react-dom/client":  resolve(repoRoot, "node_modules/react-dom/client.js"),
};

const COMMON = {
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "es2020",
  minify: false,        // keep readable for debugging
  sourcemap: false,
  alias: ALIASES,
  loader: { ".tsx": "tsx", ".ts": "ts" },
  jsx: "automatic",     // React 17+ classic-vs-automatic; React entry uses automatic
  define: {
    "process.env.NODE_ENV": "\"production\"",
  },
};

const targets = [
  {
    label: "vanilla (createPolyScene + controls + loadMesh)",
    entry: resolve(repoRoot, "packages/polycss/src/index.ts"),
    out: resolve(__dirname, "polycss.js"),
  },
  {
    label: "elements (side-effect register)",
    entry: resolve(repoRoot, "packages/polycss/src/elements/index.ts"),
    out: resolve(__dirname, "polycss-elements.js"),
  },
  {
    label: "react entry",
    entry: resolve(__dirname, "entries/react.tsx"),
    out: resolve(__dirname, "polycss-react.js"),
  },
  {
    label: "vue entry",
    entry: resolve(__dirname, "entries/vue.ts"),
    out: resolve(__dirname, "polycss-vue.js"),
  },
  {
    label: "normalize (preprocessModelPolygons + paint helper)",
    entry: resolve(__dirname, "entries/normalize.ts"),
    out: resolve(__dirname, "polycss-normalize.js"),
  },
];

const t0 = performance.now();
for (const t of targets) {
  process.stdout.write(`[bench/build] bundling ${t.label} … `);
  const start = performance.now();
  await build({ ...COMMON, entryPoints: [t.entry], outfile: t.out });
  console.log(`${(performance.now() - start).toFixed(0)}ms`);
}
console.log(`[bench/build] all bundles ready in ${(performance.now() - t0).toFixed(0)}ms`);
