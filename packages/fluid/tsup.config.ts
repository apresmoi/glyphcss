import { defineConfig } from "tsup";

export default defineConfig([
  {
    entry: { index: "src/index.ts", reader: "src/reader/index.ts" },
    format: ["esm", "cjs"],
    // The CJS build needs `import.meta.url` for the worker's `new URL("./worker.js", ...)`;
    // without the shim it is `{}` and the worker silently falls back to the main thread.
    shims: true,
    dts: true,
    splitting: false,
    sourcemap: false,
    clean: true,
    minify: false,
    target: "es2020",
    tsconfig: "tsconfig.json",
  },
  {
    // The worker is a self-contained module: `createGlyphFluid` starts it with
    // `new URL("./worker.js", import.meta.url)`, which bundlers follow, and a worker
    // cannot resolve bare specifiers on its own, so glyphcss is bundled in.
    entry: { worker: "src/runtime/worker.ts" },
    format: ["esm"],
    dts: true,
    splitting: false,
    sourcemap: false,
    clean: false,
    minify: false,
    target: "es2020",
    tsconfig: "tsconfig.json",
    noExternal: ["glyphcss", "@glyphcss/core"],
  },
]);
