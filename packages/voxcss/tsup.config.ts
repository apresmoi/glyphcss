import type { Plugin } from "esbuild";
import { defineConfig } from "tsup";

const externalSveltePlugin: Plugin = {
  name: "external-svelte",
  setup(build) {
    build.onResolve({ filter: /\.svelte$/ }, (args) => ({
      path: args.path,
      external: true
    }));
  }
};

export default defineConfig({
  entry: {
    index: "src/index.ts",
    "react/index": "react/index.ts",
    "vue/index": "vue/index.ts",
    "svelte/index": "svelte/index.ts"
  },
  format: ["esm", "cjs"],
  dts: true,
  splitting: false,
  sourcemap: false,
  clean: true,
  minify: true,
  target: "es2020",
  tsconfig: "tsconfig.json",
  external: ["vue", "react", "react-dom", "svelte"],
  esbuildPlugins: [externalSveltePlugin]
});
