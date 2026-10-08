/**
 * `glyphCanvasTextureSampler` — turns a painted `GlyphCanvas` into a
 * `TextureSampler` the scene rasteriser's own per-cell texture path already
 * knows how to read (`scene.setTextureSamplers`, AGENTS.md's "Per-cell
 * textures"). CHARTS-RESEARCH `PLAN-3d.md` §7 "A 2D chart as a texture",
 * packet F2.
 *
 * Every canvas cell becomes a `texelsPerCell` block of texels: an INK texel
 * (per `glyphInk.ts`'s `glyphInkMask`) is the cell's own foreground colour
 * at full alpha, and a non-ink texel is the cell's `bg` at full alpha when
 * one is set, or fully transparent otherwise — alpha-aware claims already
 * stop a transparent texel from occluding (AGENTS.md's "Per-cell
 * textures"), so an un-backgrounded chart cell reads as open sky rather
 * than a solid rectangle. A `null` foreground (an uncoloured chart) reads as
 * opaque white, so the host's own colour passes through the multiply
 * unchanged (`sourceRgb = texel * base / 255`) and the texel's luminance
 * still drives glyph selection — "the chart reads as the host's own ramp,
 * patterned by the chart's ink" (PLAN-3d.md §7).
 *
 * Row 0 of the returned buffer is the canvas's own row 0 (top) — no flip:
 * `sampleUv` (`@glyphcss/core`) reads `v=1` (a texture's visual TOP, under
 * the OBJ convention every glyphcss UV already uses) at row 0, which is
 * exactly a canvas's own top row.
 */

import type { TextureSampler } from "@glyphcss/core";
import { glyphInkMask } from "./glyphInk";
import type { GlyphCanvas } from "./canvas";

export interface GlyphCanvasTextureSamplerRect {
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
}

export interface GlyphCanvasTextureSamplerOptions {
  /**
   * Texels per canvas cell, `[cols, rows]`. Default `[2, 4]` — the same
   * aspect as the braille/blocks sub-cell dot lattice, so a braille/blocks
   * canvas's own texture reproduces its real sub-cell shape exactly; an
   * `ascii`/`box` canvas's structural line art (`glyphInk.ts`) degrades
   * gracefully to any resolution, including `[1, 1]`.
   */
  readonly texelsPerCell?: readonly [number, number];
  /** Cell-coordinate bounds to sample (inclusive), default the whole canvas. */
  readonly rect?: GlyphCanvasTextureSamplerRect;
}

const DEFAULT_TEXELS_PER_CELL: readonly [number, number] = [2, 4];
const WHITE_RGB: readonly [number, number, number] = [255, 255, 255];

function hexToRgb(hex: string): readonly [number, number, number] {
  return [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
}

/**
 * The ONE place a sampling rect is normalized against a canvas: reversed
 * bounds swap (`Math.min`/`Math.max` per axis), out-of-bounds bounds clamp
 * to `[0, cols-1] x [0, rows-1]`, an omitted `rect` is the whole canvas, and
 * an empty result (e.g. entirely out of bounds) throws — the SAME rule
 * `glyphCanvasTextureSampler` itself always applied, now exported so a
 * consumer sizing something else FROM the same rect (a plane object's own
 * quad, `@glyphcss/charts`'/`@glyphcss/diagrams`' `glyphChartPlaneObject`/
 * `glyphDiagramPlaneObject`) reads the identical normalized bounds the
 * sampler is about to sample, rather than re-deriving its own (packet F4b
 * fix round 1 — a raw, unclamped `rect` gave the plane one aspect and the
 * sampler another, and a reversed `rect` could size a negative height).
 */
export function resolveGlyphCanvasTextureSamplerRect(
  canvas: GlyphCanvas,
  rect: GlyphCanvasTextureSamplerRect | undefined,
): GlyphCanvasTextureSamplerRect {
  const r = rect ?? { x0: 0, y0: 0, x1: canvas.cols - 1, y1: canvas.rows - 1 };
  const x0 = Math.max(0, Math.min(r.x0, r.x1));
  const x1 = Math.min(canvas.cols - 1, Math.max(r.x0, r.x1));
  const y0 = Math.max(0, Math.min(r.y0, r.y1));
  const y1 = Math.min(canvas.rows - 1, Math.max(r.y0, r.y1));
  if (x1 < x0 || y1 < y0) {
    throw new RangeError("glyphcss: rect is empty or out of the canvas bounds.");
  }
  return { x0, y0, x1, y1 };
}

/**
 * See the module doc. Dimensions are EXACT: `width = (x1-x0+1) *
 * texelsPerCell[0]`, `height = (y1-y0+1) * texelsPerCell[1]` — never rounded
 * or padded, so a caller UV-mapping a quad to the sampled cell count gets a
 * texel grid that divides evenly.
 */
export function glyphCanvasTextureSampler(
  canvas: GlyphCanvas,
  options: GlyphCanvasTextureSamplerOptions = {},
): TextureSampler {
  const [tw, th] = options.texelsPerCell ?? DEFAULT_TEXELS_PER_CELL;
  if (!Number.isInteger(tw) || tw < 1 || !Number.isInteger(th) || th < 1) {
    throw new RangeError(`glyphcss: glyphCanvasTextureSampler() texelsPerCell must be positive integers, got [${tw}, ${th}].`);
  }
  const { x0, y0, x1, y1 } = resolveGlyphCanvasTextureSamplerRect(canvas, options.rect);

  const cellCols = x1 - x0 + 1;
  const cellRows = y1 - y0 + 1;
  const width = cellCols * tw;
  const height = cellRows * th;
  const data = new Uint8ClampedArray(width * height * 4);

  const { grid, bg, tier, cols } = canvas;
  for (let cy = 0; cy < cellRows; cy++) {
    for (let cx = 0; cx < cellCols; cx++) {
      const col = x0 + cx;
      const row = y0 + cy;
      const idx = row * cols + col;
      const glyph = grid.char[idx] ?? " ";
      const fg = grid.color[idx];
      const cellBg = bg[idx];
      const mask = glyphInkMask(glyph, tier, [tw, th]);
      const fgRgb = fg !== null ? hexToRgb(fg) : WHITE_RGB;
      const bgRgb = cellBg !== null ? hexToRgb(cellBg) : null;

      for (let ty = 0; ty < th; ty++) {
        for (let tx = 0; tx < tw; tx++) {
          const ink = mask[ty * tw + tx] === 1;
          const px = cx * tw + tx;
          const py = cy * th + ty;
          const offset = (py * width + px) * 4;
          if (ink) {
            data[offset] = fgRgb[0]; data[offset + 1] = fgRgb[1]; data[offset + 2] = fgRgb[2]; data[offset + 3] = 255;
          } else if (bgRgb !== null) {
            data[offset] = bgRgb[0]; data[offset + 1] = bgRgb[1]; data[offset + 2] = bgRgb[2]; data[offset + 3] = 255;
          } else {
            data[offset] = 0; data[offset + 1] = 0; data[offset + 2] = 0; data[offset + 3] = 0;
          }
        }
      }
    }
  }

  return { width, height, data, lowDetail: false };
}
