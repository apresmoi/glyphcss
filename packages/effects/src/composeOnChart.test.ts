/**
 * AGENTS.md "Charts" §8 "Effects on a 2D chart": every STOCK effect must run
 * on a bare, camera-less chart-shaped `CellGrid` through `composeGlyphEffects`
 * — none of the nine declares a static hard `requirements` entry a chart
 * grid can't supply (each lists its geometry-only inputs as
 * `optionalRequirements`, which degrade instead of rejecting). This is the
 * cross-package half of packet F3's gate; the compositor-level mechanics
 * (coverage, the tagged rejection, determinism) live in glyphcss's own
 * `composeGlyphEffects.test.ts`.
 */
import { describe, expect, it } from "vitest";
import {
  buildCellGrid,
  composeGlyphEffects,
  defineGlyphEffect,
  GlyphEffectOutputChannel,
  type GlyphEffectDefinition,
  type GlyphEffectParamSchema,
} from "glyphcss";
import { GlyphEffectCatalog } from "./stock";

function chartGrid(): ReturnType<typeof buildCellGrid> {
  const cols = 6, rows = 4;
  const n = cols * rows;
  const chars = Array.from({ length: n }, (_, i) => (i % 3 === 0 ? "#" : " "));
  const colors = chars.map((c) => (c === "#" ? "#3366ff" : null));
  return buildCellGrid(chars, colors, new Float64Array(n), cols, rows);
}

describe("stock effects on a camera-less chart grid (AGENTS.md Charts §8)", () => {
  it("catalog is exactly the documented nine", () => {
    expect(GlyphEffectCatalog.map((definition) => definition.id).sort()).toEqual(
      ["field-synth", "flow-text", "glitch", "matrix-rain", "noise-dissolve", "ripple", "scan", "scramble", "wipe"].sort(),
    );
  });

  it.each(GlyphEffectCatalog.map((definition) => [definition.id, definition] as const))(
    "%s composes over a chart grid with default params, with no throw",
    (_id, definition) => {
      const grid = chartGrid();
      // `GlyphEffectCatalog` mixes stateless and stateful (`fieldSynth`)
      // definitions; a loop over it needs an existential cast at the mount
      // site the same way `getGlyphEffect`'s own callers do.
      expect(() => composeGlyphEffects(grid, [{ effect: definition as GlyphEffectDefinition<GlyphEffectParamSchema, unknown> }])).not.toThrow();
    },
  );

  it("an explicit ink-coverage array scopes a 'surfaces'-targeted effect to painted cells only", () => {
    const grid = chartGrid();
    const coverage = grid.char.map((glyph) => (glyph === " " ? 0 : 1));
    const paintZ = defineGlyphEffect<{ phase: number }>({
      evaluate({ target, output }) {
        for (let i = 0; i < output.coverage.length; i++) {
          if (target.coverage[i]! <= 0) continue;
          output.glyph[i] = "Z";
          output.coverage[i] = 1;
          output.channels[i] = GlyphEffectOutputChannel.Glyph;
        }
      },
    });
    const composed = composeGlyphEffects(
      grid,
      [{ effect: paintZ, params: { phase: 0 }, blend: "replace" }],
      { coverage },
    );
    // Every originally-blank cell stays inactive (coverage 0 → the layer
    // never touches it); every originally-inked cell is repainted.
    for (let i = 0; i < grid.char.length; i++) {
      expect(composed.char[i]).toBe(grid.char[i] === " " ? " " : "Z");
    }
  });
});
