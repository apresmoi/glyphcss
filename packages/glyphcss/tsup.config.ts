import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    elements: "src/elements.ts",
    three: "src/three.ts",
  },
  format: ["esm", "cjs"],
  dts: true,
  // Load-bearing, not a preference: the ~44KB base64 atlas WOFF2 is reached
  // only through `import("./render/fontAtlasPayload")`. With splitting off,
  // esbuild INLINES a dynamic import back into its importing bundle, which
  // would put the payload straight back into `dist/index.js` for every
  // consumer. Splitting is what makes it a real, separately-fetched chunk.
  // `bundle.atlas.test.ts` asserts that boundary against the built output.
  splitting: true,
  sourcemap: false,
  clean: true,
  minify: true,
  target: "es2020",
  tsconfig: "tsconfig.build.json",
  external: ["@glyphcss/core"],
});
