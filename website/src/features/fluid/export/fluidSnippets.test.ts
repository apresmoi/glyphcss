import { expect, it } from "vitest";
import {
  FLUID_CONFIG_DEFAULTS,
  findFluidExample,
  fluidExampleDefaults,
  type FluidConfig,
} from "../model/fluidExamples";
import { buildFluidSnippet } from "./fluidSnippets";

// The snippet's body (imports stripped) must at least parse as JavaScript; it awaits loads.
const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor as new (...args: string[]) => unknown;
const parses = (code: string) =>
  new AsyncFunction(
    "createGlyphFluid",
    "GlyphFluidTargets",
    "createGlyphFluidReader",
    "createGlyphOrthographicCamera",
    "loadMesh",
    "resolveGeometry",
    code.replace(/^import .*$/gm, ""),
  );

const snippet = (id: string, patch: Partial<FluidConfig> = {}, tuning = {}) => {
  const example = findFluidExample(id)!;
  const defaults = fluidExampleDefaults(example);
  return buildFluidSnippet(example, { ...defaults, ...patch }, defaults, tuning);
};

it("emits the default heading as the bare API calls", () => {
  const code = snippet("heading");
  expect(() => parses(code)).not.toThrow();
  expect(code).toContain('createGlyphFluid(document.querySelector("#stage"));');
  expect(code).toContain(`GlyphFluidTargets.text(document.querySelector("#stage h1"), { color: "${FLUID_CONFIG_DEFAULTS.color}" })`);
  expect(code).not.toContain("worker:");
  expect(code).not.toContain("melt()");
});

it("carries every changed fluid option, the tuning and the melted state", () => {
  const code = snippet(
    "heading",
    { fieldColor: "#ff0000", fieldLevel: 0.3, encoding: "mono", fps: 30, worker: false, targetCols: 90, delay: 1.5, condensed: false },
    { swirl: 1.2 },
  );
  expect(() => parses(code)).not.toThrow();
  expect(code).toContain('field: { color: "#ff0000", level: 0.3 }');
  expect(code).toContain('encoding: "mono"');
  expect(code).toContain("fps: 30");
  expect(code).toContain("worker: false");
  expect(code).toContain("grid: { targetCols: 90 }");
  expect(code).toContain("tuning: {swirl: 1.2}");
  expect(code).toContain("delay: 1.5");
  expect(code).toContain("target.melt();");
});

it("writes the reader with its own grid defaults, round shape and look", () => {
  const code = snippet("reader-glyph", { text: 'Say "hi"', wpm: 600, loop: false });
  expect(() => parses(code)).not.toThrow();
  expect(code).toContain("createGlyphFluidReader");
  expect(code).toContain('shape: "circle"');
  expect(code).toContain('look: "glyph"');
  expect(code).toContain('text: "Say \\"hi\\""');
  expect(code).toContain("loop: false");
  expect(code).not.toContain("grid:");
  expect(code).not.toContain("glue:");
});

it("writes image, mesh and zone examples as runnable code", () => {
  for (const id of ["image-poly", "mesh-teapot", "mesh-torus", "stir"]) expect(() => parses(snippet(id))).not.toThrow();
  expect(snippet("mesh-teapot")).toContain('loadMesh("/gallery/obj/teapot.obj")');
  expect(snippet("mesh-torus")).toContain('resolveGeometry("torus"');
  expect(snippet("stir", { zoneKind: "pool", zoneLevel: 3.2 })).toContain('kind: "pool", level: 3.2');
  expect(snippet("image-js", { ink: "alpha" })).toContain('ink: "alpha"');
});
