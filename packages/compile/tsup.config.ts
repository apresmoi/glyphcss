import { defineConfig } from "tsup";

export default defineConfig({
  entry: { index: "src/index.ts", vite: "src/vite.ts", cli: "src/cli.ts" },
  format: ["esm", "cjs"],
  dts: true,
  splitting: false,
  sourcemap: false,
  clean: true,
  minify: false,
  target: "es2020",
  tsconfig: "tsconfig.json",
});
