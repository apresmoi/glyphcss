import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
process.env.TZ = "Europe/Berlin";

const source = (path: string) => fileURLToPath(new URL(path, import.meta.url));

export default defineConfig({
  resolve: {
    alias: [
      {
        find: /^@glyphcss\/core\/mermaid$/,
        replacement: source("../packages/core/src/mermaid/index.ts"),
      },
      {
        find: /^@glyphcss\/core$/,
        replacement: source("../packages/core/src/index.ts"),
      },
      {
        find: /^glyphcss$/,
        replacement: source("../packages/glyphcss/src/index.ts"),
      },
      {
        find: /^@glyphcss\/diagrams\/sequence$/,
        replacement: source("../packages/diagrams/src/sequence/index.ts"),
      },
      {
        find: /^@glyphcss\/diagrams\/lanes$/,
        replacement: source("../packages/diagrams/src/lanes/index.ts"),
      },
      {
        find: /^@glyphcss\/diagrams$/,
        replacement: source("../packages/diagrams/src/index.ts"),
      },
      {
        find: /^@glyphcss\/charts$/,
        replacement: source("../packages/charts/src/index.ts"),
      },
    ],
  },
  test: {
    include: ["src/services/docs-render/*.test.ts"],
    environment: "happy-dom",
    testTimeout: 30000,
    maxWorkers: 2,
    setupFiles: ["./src/test/eventLoop.ts"],
  },
});
