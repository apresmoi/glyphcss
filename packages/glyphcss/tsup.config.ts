import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    elements: "src/elements.ts",
  },
  format: ["esm", "cjs"],
  dts: true,
  splitting: false,
  sourcemap: false,
  clean: true,
  minify: true,
  target: "es2020",
  tsconfig: "tsconfig.build.json",
  external: ["@glyphcss/core"],
});
