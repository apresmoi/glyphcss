import { expect, it } from "vitest";
import { FLUID_DEFAULTS, FLUID_READER_DEFAULTS } from "../model/fluidWorkbench";
import { buildFluidSnippet } from "./fluidSnippets";

// The snippet's body (imports stripped) must at least parse as JavaScript.
const parses = (code: string) => new Function("createGlyphFluid", "GlyphFluidTargets", "createGlyphFluidReader", code.replace(/^import .*$/gm, ""));

it("emits the defaults as the bare API calls", () => {
  const code = buildFluidSnippet(FLUID_DEFAULTS, FLUID_READER_DEFAULTS);
  expect(() => parses(code)).not.toThrow();
  expect(code).toContain('createGlyphFluid(document.querySelector("#stage"));');
  expect(code).toContain('shape: "circle"');
  expect(code).toContain(`wpm: ${FLUID_READER_DEFAULTS.wpm}`);
  expect(code).not.toContain("worker:");
});

it("carries every changed setting into both calls where it applies", () => {
  const code = buildFluidSnippet(
    { fieldColor: "#ff0000", fieldLevel: 0.3, encoding: "mono", fps: 30, worker: false },
    { text: 'Say "hi"', wpm: 600, loop: false },
  );
  expect(() => parses(code)).not.toThrow();
  expect(code).toContain('field: { color: "#ff0000", level: 0.3 }');
  expect(code.match(/encoding: "mono"/g)).toHaveLength(2);
  expect(code.match(/fps: 30/g)).toHaveLength(2);
  expect(code.match(/worker: false/g)).toHaveLength(2);
  expect(code.match(/field:/g)).toHaveLength(1);
  expect(code).toContain('text: "Say \\"hi\\""');
  expect(code).toContain("loop: false");
});
