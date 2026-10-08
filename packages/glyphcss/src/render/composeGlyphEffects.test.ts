/**
 * `composeGlyphEffects` (AGENTS.md "Retained Glyph Effects", contract 4) —
 * the DOM-free, camera-free entry to the same compositor a mounted scene
 * effect layer runs through, over a bare `CellGrid`. `@glyphcss/charts`'
 * `composeGlyphChartEffects` is the reference consumer; these are the
 * compositor-level mechanics: no `pre`/DOM anywhere in the metadata shape,
 * explicit coverage, a tagged rejection for a hard requirement the grid
 * cannot supply, and byte-identical determinism across repeated calls.
 */
import { describe, expect, it } from "vitest";
import { defineGlyphEffect, GlyphEffectOutputChannel, type GlyphEffectDefinition } from "../api/effects";
import { buildCellGrid } from "./cells";
import {
  composeGlyphEffects,
  GLYPH_EFFECT_REQUIREMENT_UNAVAILABLE,
  GlyphEffectRequirementUnavailableError,
} from "./effectCompositor";

const GLYPH = GlyphEffectOutputChannel.Glyph;

function blankGrid(chars: string[]) {
  return buildCellGrid(chars, chars.map(() => null), new Float64Array(chars.length), chars.length, 1);
}

const paintZ = defineGlyphEffect<{ phase: number }>({
  evaluate({ target, output }) {
    for (let i = 0; i < output.coverage.length; i++) {
      if (target.coverage[i]! <= 0) continue;
      output.glyph[i] = "Z";
      output.coverage[i] = 1;
      output.channels[i] = GLYPH;
    }
  },
});

describe("composeGlyphEffects (contract 4)", () => {
  it("runs a mounted effect over a bare grid with no scene and no camera", () => {
    const grid = blankGrid(["A", "B"]);
    const composed = composeGlyphEffects(grid, [{ effect: paintZ, params: { phase: 0 }, blend: "replace" }]);
    expect(composed.char).toEqual(["Z", "Z"]);
  });

  it("defaults coverage to fully covered when the caller supplies none", () => {
    const grid = blankGrid(["A", "B", "C"]);
    const composed = composeGlyphEffects(grid, [
      { effect: paintZ, params: { phase: 0 }, blend: "replace", target: "surfaces" },
    ]);
    expect(composed.char).toEqual(["Z", "Z", "Z"]);
  });

  it("honors an explicit per-cell coverage — an uncovered cell is inactive for a 'surfaces' target", () => {
    const grid = blankGrid(["A", "B", "C"]);
    const composed = composeGlyphEffects(
      grid,
      [{ effect: paintZ, params: { phase: 0 }, blend: "replace", target: "surfaces" }],
      { coverage: [1, 0, 1] },
    );
    expect(composed.char).toEqual(["Z", "B", "Z"]);
  });

  it("rejects a hard requirement the grid cannot supply, tagged GLYPH_EFFECT_REQUIREMENT_UNAVAILABLE", () => {
    const needsDepth = defineGlyphEffect<{ phase: number }>({
      requirements: ["depth"],
      evaluate() {},
    });
    const grid = blankGrid(["A"]);
    let caught: unknown;
    try {
      // `hasDepth` defaults false — a bare grid has no camera-projected depth.
      composeGlyphEffects(grid, [{ effect: needsDepth, params: { phase: 0 } }]);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(GlyphEffectRequirementUnavailableError);
    expect((caught as GlyphEffectRequirementUnavailableError).code).toBe(GLYPH_EFFECT_REQUIREMENT_UNAVAILABLE);
    expect((caught as GlyphEffectRequirementUnavailableError).requirement).toBe("depth");
  });

  it("never silently degrades a hard requirement — an optional one degrades instead, with no throw", () => {
    const optionalDepth = defineGlyphEffect<{ phase: number }>({
      optionalRequirements: ["depth"],
      evaluate({ base, target, output }) {
        for (let i = 0; i < output.coverage.length; i++) {
          if (target.coverage[i]! <= 0) continue;
          output.glyph[i] = base.depth ? "D" : "N";
          output.coverage[i] = 1;
          output.channels[i] = GLYPH;
        }
      },
    });
    const grid = blankGrid(["A"]);
    const composed = composeGlyphEffects(grid, [{ effect: optionalDepth, params: { phase: 0 }, blend: "replace" }]);
    expect(composed.char).toEqual(["N"]);
  });

  it("hardDynamicRequirements (PLAN-3d.md §8): a camera-less grid rejects a dynamic requirement the program says it has no fallback for", () => {
    const volumetricOnly = defineGlyphEffect<{ mode: string }>({
      dynamicRequirements(params) {
        return params.mode === "carve" ? ["objectPosition", "objectExit"] : [];
      },
      hardDynamicRequirements(params) {
        return params.mode === "carve" ? ["objectPosition", "objectExit"] : [];
      },
      evaluate({ base, target, output }) {
        for (let i = 0; i < output.coverage.length; i++) {
          if (target.coverage[i]! <= 0) continue;
          output.glyph[i] = base.objectPosition ? "V" : "N";
          output.coverage[i] = 1;
          output.channels[i] = GLYPH;
        }
      },
    });
    const grid = blankGrid(["A"]);
    let caught: unknown;
    try {
      composeGlyphEffects(grid, [{ effect: volumetricOnly, params: { mode: "carve" }, blend: "replace" }]);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(GlyphEffectRequirementUnavailableError);
    expect((caught as GlyphEffectRequirementUnavailableError).code).toBe(GLYPH_EFFECT_REQUIREMENT_UNAVAILABLE);
    expect(["objectPosition", "objectExit"]).toContain((caught as GlyphEffectRequirementUnavailableError).requirement);
  });

  it("a dynamic requirement with no matching hardDynamicRequirements entry still degrades silently (no throw)", () => {
    const paintFallback = defineGlyphEffect<{ mode: string }>({
      dynamicRequirements(params) {
        return params.mode === "carve" ? ["objectPosition"] : [];
      },
      // No `hardDynamicRequirements` at all — this program claims it CAN
      // fall back to 2D, mirroring field-synth's plain `space: "object"`
      // paint path, so a camera-less grid must degrade, not reject.
      evaluate({ base, target, output }) {
        for (let i = 0; i < output.coverage.length; i++) {
          if (target.coverage[i]! <= 0) continue;
          output.glyph[i] = base.objectPosition ? "V" : "N";
          output.coverage[i] = 1;
          output.channels[i] = GLYPH;
        }
      },
    });
    const grid = blankGrid(["A"]);
    const composed = composeGlyphEffects(grid, [{ effect: paintFallback, params: { mode: "carve" }, blend: "replace" }]);
    expect(composed.char).toEqual(["N"]);
  });

  it("hasDepth: true lets a hard depth requirement read the grid's own real depth", () => {
    const readDepth = defineGlyphEffect<{ phase: number }>({
      requirements: ["depth"],
      evaluate({ base, target, output }) {
        for (let i = 0; i < output.coverage.length; i++) {
          if (target.coverage[i]! <= 0) continue;
          output.glyph[i] = base.depth![i]! > 0 ? "D" : "z";
          output.coverage[i] = 1;
          output.channels[i] = GLYPH;
        }
      },
    });
    const grid = buildCellGrid(["A"], [null], new Float64Array([5]), 1, 1);
    const composed = composeGlyphEffects(
      grid,
      [{ effect: readDepth, params: { phase: 0 }, blend: "replace" }],
      { hasDepth: true },
    );
    expect(composed.char).toEqual(["D"]);
  });

  it("composing the same grid/layers/ctx twice gives byte-identical output", () => {
    const grid = buildCellGrid(["A", "B", "C", "D"], ["#010203", null, "#abcdef", null], new Float64Array(4), 4, 1);
    const layers: Parameters<typeof composeGlyphEffects>[1] = [
      { effect: paintZ, params: { phase: 0 }, blend: "over", opacity: 0.5 },
    ];
    const first = composeGlyphEffects(grid, layers);
    const second = composeGlyphEffects(grid, layers);
    expect(second.char).toEqual(first.char);
    expect(second.color).toEqual(first.color);
  });

  it("creates fresh program state per call — no hidden state survives between compose calls", () => {
    const seenStates: object[] = [];
    const statefulEffect = defineGlyphEffect<{ phase: number }, { tag: object }>({
      createState: () => ({ tag: {} }),
      evaluate({ state, output }) {
        seenStates.push(state.tag);
        output.coverage.fill(0);
      },
    });
    const definition: GlyphEffectDefinition<{ phase: { kind: "number"; default: 0 } }, { tag: object }> = {
      id: "test.stateful",
      version: 1,
      parameterSchema: { phase: { kind: "number", default: 0 } },
      program: statefulEffect,
    };
    const grid = blankGrid(["A"]);
    composeGlyphEffects(grid, [{ effect: definition }]);
    composeGlyphEffects(grid, [{ effect: definition }]);
    expect(seenStates).toHaveLength(2);
    expect(seenStates[0]).not.toBe(seenStates[1]);
  });

  it("carries no `pre`/DOM reference anywhere — metadata is plain data", () => {
    // Compile-time proof lives in the type (`GlyphEffectOutputMetadata` has
    // no `pre` field); this is the runtime companion: composing succeeds
    // with no `document`/DOM object supplied anywhere in the call.
    const grid = blankGrid(["A"]);
    expect(() => composeGlyphEffects(grid, [{ effect: paintZ, params: { phase: 0 } }])).not.toThrow();
  });
});
