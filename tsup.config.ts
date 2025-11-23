import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    "react/index": "react/index.ts",
    "vue/index": "vue/index.ts"
  },
  format: ["esm", "cjs"],
  dts: true,
  splitting: false,
  sourcemap: false,
  clean: true,
  minify: true,
  target: "es2020",
  tsconfig: "tsconfig.json",
  external: ["vue", "react", "react-dom", "svelte"]
});
