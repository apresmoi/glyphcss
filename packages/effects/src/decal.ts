/**
 * `glyphGridDecalEffect` (AGENTS.md's "Charts" §7 "Exact glyphs") — a
 * mesh-targeted effect that samples a bare `CellGrid` (a chart's own
 * `build.canvas.grid`, a diagram's, or any hand-built one) by `uv0` and
 * writes the SOURCE grid's own glyph and colour verbatim onto whatever mesh
 * cell that `uv0` lands on. It exists because `glyphCanvasTextureSampler`
 * (the per-glyph-ink-mask texel path) can only ever read as character
 * VARIETY — below roughly one output cell per source cell, a chart's own
 * text becomes a density blob. The decal is the alternative for a reader who
 * needs the chart's own glyphs LEGIBLE on the mesh: it is exact wherever a
 * source cell covers at least one output cell, and aliases (drops source
 * cells with no output cell landing on them) below that — the same honest
 * trade-off a magnified sprite sheet makes.
 *
 * The grid rides as `program` (VOLUMETRIC-3.md §4's opaque, definition-owned,
 * immutable-after-mount payload) rather than a `params` field, because a
 * `CellGrid` is exactly the payload shape `program` exists for: data a
 * definition interprets and glyphcss never touches. Immutable after mount
 * means a live data update (a chart re-rendering under a new dataset)
 * remounts the layer — `scene.addEffectLayer`'s existing remove-and-re-add
 * rule, not a new one.
 */
import {
  GlyphEffectOutputChannel,
  parseGlyphEffectColor,
  type CellGrid,
  type GlyphEffectDefinition,
  type GlyphEffectParamSchema,
} from "glyphcss";

const GLYPH = GlyphEffectOutputChannel.Glyph;
const COLOR = GlyphEffectOutputChannel.Color;

function isDecalSourceGrid(value: unknown): value is CellGrid {
  if (!value || typeof value !== "object") return false;
  const grid = value as CellGrid;
  const n = grid.cols * grid.rows;
  return (
    Number.isInteger(grid.cols) && grid.cols > 0
    && Number.isInteger(grid.rows) && grid.rows > 0
    && Array.isArray(grid.char) && grid.char.length === n
    && Array.isArray(grid.color) && grid.color.length === n
  );
}

function validateDecalProgram(program: unknown): void {
  if (!isDecalSourceGrid(program)) {
    throw new TypeError("glyphcss: glyphGridDecalEffect's program must be a CellGrid (cols/rows plus matching char/color arrays).");
  }
}

const decalSchema = {} as const satisfies GlyphEffectParamSchema;

export const glyphGridDecalEffect: GlyphEffectDefinition<typeof decalSchema> = {
  id: "glyph-grid-decal",
  version: 1,
  parameterSchema: decalSchema,
  program: {
    // `uv0` is a HARD requirement — the decal has no fallback for a cell with
    // no authored UV (it simply skips it, per-cell, below), but the buffer
    // itself must exist at all, which needs solid mode (VOLUMETRIC.md).
    requirements: ["uv0"],
    validateProgram: validateDecalProgram,
    evaluate(context) {
      const grid = context.program as CellGrid;
      const uv0 = context.base.uv0!;
      const n = context.base.length;
      for (let i = 0; i < n; i++) {
        if (context.target.coverage[i]! <= 0) continue;
        const u = uv0[i * 2]!;
        const v = uv0[i * 2 + 1]!;
        // No authored UV at this cell (uv0's own NaN-fill for an unauthored
        // surface) — nothing to decal here, exactly like every other
        // uv0-driven stock effect degrades per cell.
        if (!Number.isFinite(u) || !Number.isFinite(v)) continue;
        // NEAREST sample, deliberately: a bilinear blend of two ADJACENT
        // source cells' colours produces a THIRD colour no source cell
        // carries, and there is no such thing as a blended GLYPH — so
        // averaging would silently corrupt colour while leaving glyph
        // picked from an arbitrary one of the two anyway. `glyphGridDecal.
        // test.ts`'s 1:1 gate asserts colour equality precisely because
        // glyph equality alone can't catch that regression.
        const col = Math.min(grid.cols - 1, Math.max(0, Math.floor(u * grid.cols)));
        const row = Math.min(grid.rows - 1, Math.max(0, Math.floor(v * grid.rows)));
        const sample = row * grid.cols + col;
        const glyph = grid.char[sample]!;
        context.output.glyph[i] = glyph;
        context.output.channels[i] |= GLYPH;
        context.output.coverage[i] = glyph === " " ? 0 : 1;
        const color = grid.color[sample];
        if (color != null) {
          context.output.color[i] = parseGlyphEffectColor(color).packed;
          context.output.channels[i] |= COLOR;
        }
      }
    },
  },
};
