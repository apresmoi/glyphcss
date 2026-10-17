import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    mermaid: "src/mermaid/index.ts",
    index: "src/index.ts",
    three: "src/three/index.ts",
  },
  format: ["esm", "cjs"],
  dts: true,
  splitting: false,
  sourcemap: false,
  clean: true,
  minify: true,
  target: "es2020",
  tsconfig: "tsconfig.json"
});
