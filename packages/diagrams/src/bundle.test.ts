import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "tsup";
import { describe, expect, it } from "vitest";
import * as diagramApi from "./index";
import { layoutGlyphGraphElk } from "./elk";
import { layoutGlyphGraph } from "./pipeline";
import { glyphGraphFromMermaid } from "./mermaid";

it("publishes only the 2D diagram entry points", () => {
  const manifest = JSON.parse(readFileSync(resolve(__dirname, "../package.json"), "utf8"));
  expect(Object.keys(manifest.exports)).toEqual([".", "./elk", "./sequence", "./lanes"]);
  expect(manifest.typesVersions["*"]).not.toHaveProperty("3d");
  expect(diagramApi).not.toHaveProperty("glyphDiagramPlaneObject");
  expect(diagramApi).not.toHaveProperty("glyphDiagramObject");
});

describe("optional ELK boundary", () => {
  it("reserves the opt-in subpath with a tagged stub", async () => {
    const manifest = JSON.parse(readFileSync(resolve(__dirname, "../package.json"), "utf8"));
    expect(manifest.exports["./elk"]).toEqual({ types: "./dist/elk.d.ts", import: "./dist/elk.js", require: "./dist/elk.cjs" });
    expect(manifest.peerDependenciesMeta.elkjs.optional).toBe(true);
    await expect(layoutGlyphGraphElk()).rejects.toMatchObject({ code: "GLYPH_DIAGRAM_ELK_NOT_INSTALLED" });
  });

  it("rejects engine: elk at the main pipeline's own engine-selection boundary with the same tagged code", async () => {
    // Mutation: fold "elk" into the generic "not dagre" bad-options branch ->
    // code regresses to "bad-options" instead of the dedicated ELK code.
    await expect(layoutGlyphGraph(glyphGraphFromMermaid("graph LR; A"), { engine: "elk" })).rejects.toMatchObject({ code: "GLYPH_DIAGRAM_ELK_NOT_INSTALLED" });
  });

  it("imports both built root formats with ELK resolution forbidden", async () => {
    const directory = mkdtempSync(resolve(__dirname, "../.glyph-diagram-build-"));
    try {
      await build({
        entry: { index: resolve(__dirname, "index.ts") }, outDir: directory, format: ["esm", "cjs"],
        dts: false, splitting: false, target: "es2020", external: ["elkjs", "elkjs/*"], config: false, silent: true,
      });
      const hook = resolve(directory, "forbid-elk.mjs");
      writeFileSync(hook, `export function resolve(specifier, context, next) {
        if (/^elkjs(?:\\/|$)/.test(specifier)) throw new Error("ELK unexpectedly loaded: " + specifier);
        return next(specifier, context);
      }\n`);
      const esm = resolve(directory, "index.js");
      const cjs = resolve(directory, "index.cjs");
      for (const entry of [esm, cjs]) {
        const built = readFileSync(entry, "utf8");
        // Mutation: add an eager root ELK import or inline the package -> red.
        expect(built).not.toMatch(/(?:from\s*|import\s*\(|require\s*\()["']elkjs(?:[/'"])/);
        expect(built).not.toContain("elkjs/lib/");
      }
      const imported = execFileSync(process.execPath, ["--no-warnings", "--experimental-loader", hook, "--input-type=module", "-e", `
        import Module from "node:module";
        const original = Module._load;
        Module._load = function(specifier, ...rest) {
          if (/^elkjs(?:\\/|$)/.test(specifier)) throw new Error("ELK unexpectedly required: " + specifier);
          return original.call(this, specifier, ...rest);
        };
        const esm = await import(${JSON.stringify(pathToFileURL(esm).href)});
        const cjs = Module.createRequire(import.meta.url)(${JSON.stringify(cjs)});
        for (const entry of [esm, cjs]) {
          const graph = entry.glyphGraphFromMermaid("graph TD; A-->B");
          if (graph.nodes.length !== 2 || graph.edges.length !== 1) throw new Error("Empty root import");
        }
        process.stdout.write("GLYPH_DIAGRAM_ROOT_NO_ELK\\n");
      `], { encoding: "utf8" });
      expect(imported).toBe("GLYPH_DIAGRAM_ROOT_NO_ELK\n");
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  // Both real entry formats are bundled and imported in a fresh Node process.
  }, 30_000);
});
