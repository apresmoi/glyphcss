import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { defineConfig } from "vitest/config";

const directory = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  test: {
    environment: "node",
    include: ["probes/**/*.test.ts", "schema/**/*.test.ts", "tests/**/*.test.ts"],
  },
  resolve: {
    alias: {
      "@glyphcss/core": resolve(directory, "../../packages/core/src"),
      "react": resolve(directory, "../../website/node_modules/react"),
      "react-dom": resolve(directory, "../../website/node_modules/react-dom"),
    },
  },
});
