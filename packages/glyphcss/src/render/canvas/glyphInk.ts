/**
 * Per-glyph ink coverage: a single, table-driven answer to "how much of this
 * cell does this glyph's own printed shape actually cover" — the engine
 * behind the cell canvas's `shade` bookkeeping (`canvas.ts`) and
 * `glyphCanvasTextureSampler` (`sampler.ts`, CHARTS-RESEARCH `PLAN-3d.md`
 * §7 "A 2D chart as a texture", AGENTS.md's "Cell canvas" contract 5).
 *
 * Three families, in resolution order — mirroring the plan's own table:
 *
 * 1. **Braille** (`tier === "braille"`, a real U+2800..28FF codepoint) and
 *    **blocks/quadrant glyphs** (`tier === "blocks" | "braille"`, a member of
 *    `GLYPH_CANVAS_QUADRANT_GLYPHS` — braille's own `fillSubGlyph` reuses
 *    that table for solid fills, so both tiers must recognise it) decode
 *    EXACTLY: the glyph's own dot/quadrant bits ARE the mask, nearest-scaled
 *    to the caller's requested resolution.
 * 2. **Box-drawing line art** — the Unicode stems (`│─└┘┌┐├┤┬┴┼═║╌╎`), the
 *    diagonal family (`‾▔▏▕/\\_`) and the four arrow glyphs — is rendered
 *    STRUCTURALLY: a stroke down the connected sides, a diagonal walk, an
 *    edge row/column, or a directional half-fill. This is the "derived from
 *    the N/E/S/W table" row: an ASCII SUBSTITUTE for the same stem (`|`,
 *    `-`, `+`) is deliberately NOT included here — it is genuinely
 *    ambiguous with plain text (a caller's `canvas.text("+")` is far more
 *    likely a plus sign than a crossing) and falls through to family 3.
 * 3. **Everything else** — the shading ramps (`░▒▓█`/`.:-=+*#`/…), the
 *    measured `glyphInkCoverage` fixture's own glyphs, and arbitrary text —
 *    gets a flat DENSITY (0 blank, `index/(len-1)` for a ramp step, a
 *    measured value, or a flat default) turned into a mask via ordered
 *    (Bayer) dithering, so an unrecognised glyph still reads as texture
 *    rather than nothing.
 *
 * A caller never sees "no mask for this glyph": every branch terminates,
 * with family 3's flat default as the final catch-all — see
 * `glyphInk.test.ts`'s coverage-walk gate, which enumerates every glyph
 * every tier's own tables (`GLYPH_CANVAS_TIERS`) can emit and asserts each
 * resolves through the family the plan assigns it, not merely "some mask".
 */

import { GLYPH_CANVAS_DIRECTION_BITS, GLYPH_CANVAS_QUADRANT_GLYPHS, GLYPH_CANVAS_TIERS, type GlyphCanvasTierName } from "./tiers";

const { n: N, e: E, s: S, w: W } = GLYPH_CANVAS_DIRECTION_BITS;

/** The braille dot lattice `canvas.ts`'s own `sub` buffer is laid out on — see `GlyphCanvas.sub`'s doc for the bit layout this mirrors. */
const DOT_COLS = 2;
const DOT_ROWS = 4;

/** `GlyphCanvas.sub`'s own bit convention, reproduced here (not imported — `canvas.ts` has no exported access to it, and this module must not depend on `canvas.ts` to avoid a cycle with `sampler.ts`, which imports both). */
function braileDotBit(col: number, row: number): number {
  if (col === 0) return row < 3 ? row : 6;
  return row < 3 ? 3 + row : 7;
}

/** `GLYPH_CANVAS_QUADRANT_GLYPHS`'s own bit convention (bit0 TL, bit1 TR, bit2 BL, bit3 BR — see its doc in `tiers.ts`). */
function quadrantBit(col: number, row: number, cols: number, rows: number): number {
  const left = col < cols / 2;
  const top = row < rows / 2;
  return top ? (left ? 0 : 1) : (left ? 2 : 3);
}

/**
 * Nearest-scale a small source bit-grid (`srcCols x srcRows`, tested via
 * `bitAt`) up or down onto an arbitrary `cols x rows` texel grid. Shared by
 * the braille and quadrant exact-decode paths — each just supplies its own
 * `bitAt`.
 */
function resampleBitGrid(
  srcCols: number,
  srcRows: number,
  bitAt: (col: number, row: number) => number,
  cols: number,
  rows: number,
): Uint8Array {
  const mask = new Uint8Array(cols * rows);
  for (let row = 0; row < rows; row++) {
    const sr = Math.min(srcRows - 1, Math.floor((row * srcRows) / rows));
    for (let col = 0; col < cols; col++) {
      const sc = Math.min(srcCols - 1, Math.floor((col * srcCols) / cols));
      mask[row * cols + col] = bitAt(sc, sr);
    }
  }
  return mask;
}

/** A vertical/horizontal stroke through the cell's centre, extended toward each connected side (`N|E|S|W` bit). Corners/tees/crosses fall out of this same expression — see `glyphInk.test.ts`'s per-shape assertions. */
function strokeMask(dirBits: number, cols: number, rows: number): Uint8Array {
  const mask = new Uint8Array(cols * rows);
  const midCol = Math.round((cols - 1) / 2);
  const midRow = Math.round((rows - 1) / 2);
  const hasV = (dirBits & (N | S)) !== 0;
  const hasH = (dirBits & (E | W)) !== 0;
  if (!hasV && !hasH) {
    mask[midRow * cols + midCol] = 1;
    return mask;
  }
  if (hasV) {
    const top = dirBits & N ? 0 : midRow;
    const bottom = dirBits & S ? rows - 1 : midRow;
    for (let r = top; r <= bottom; r++) mask[r * cols + midCol] = 1;
  }
  if (hasH) {
    const left = dirBits & W ? 0 : midCol;
    const right = dirBits & E ? cols - 1 : midCol;
    for (let c = left; c <= right; c++) mask[midRow * cols + c] = 1;
  }
  return mask;
}

/** A directional half-fill for the four arrow glyphs — not a pixel-true triangle (this is a texture approximation, AGENTS.md's "Cell canvas" contract 5), but a half lit toward the arrow's own direction. */
function arrowMask(dir: "n" | "e" | "s" | "w", cols: number, rows: number): Uint8Array {
  const mask = new Uint8Array(cols * rows);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const inHalf = dir === "n" ? r < rows / 2 : dir === "s" ? r >= rows / 2 : dir === "w" ? c < cols / 2 : c >= cols / 2;
      if (inHalf) mask[r * cols + c] = 1;
    }
  }
  return mask;
}

function rowMask(row: number, cols: number, rows: number): Uint8Array {
  const mask = new Uint8Array(cols * rows);
  const r = Math.max(0, Math.min(rows - 1, row));
  for (let c = 0; c < cols; c++) mask[r * cols + c] = 1;
  return mask;
}

function colMask(col: number, cols: number, rows: number): Uint8Array {
  const mask = new Uint8Array(cols * rows);
  const c = Math.max(0, Math.min(cols - 1, col));
  for (let r = 0; r < rows; r++) mask[r * cols + c] = 1;
  return mask;
}

function centerDotMask(cols: number, rows: number): Uint8Array {
  const mask = new Uint8Array(cols * rows);
  mask[Math.round((rows - 1) / 2) * cols + Math.round((cols - 1) / 2)] = 1;
  return mask;
}

/** A thin Bresenham walk from corner to corner — the same walk style `canvas.ts`'s own sub-cell line rasteriser uses, reproduced locally (not imported, for the same no-cycle reason as `braileDotBit`). */
function diagonalMask(from: [number, number], to: [number, number], cols: number, rows: number): Uint8Array {
  const mask = new Uint8Array(cols * rows);
  let [x, y] = from;
  const [x1, y1] = to;
  const dx = Math.abs(x1 - x);
  const sx = x < x1 ? 1 : -1;
  const dy = -Math.abs(y1 - y);
  const sy = y < y1 ? 1 : -1;
  let err = dx + dy;
  const maxSteps = dx + Math.abs(dy) + 2;
  for (let i = 0; i < maxSteps; i++) {
    if (x >= 0 && x < cols && y >= 0 && y < rows) mask[y * cols + x] = 1;
    if (x === x1 && y === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; x += sx; }
    if (e2 <= dx) { err += dx; y += sy; }
  }
  return mask;
}

interface LineArtGlyph {
  readonly density: number;
  mask(cols: number, rows: number): Uint8Array;
}

/**
 * The Unicode-only "box drawing: derived from the N/E/S/W table" family
 * (plan §7). Deliberately excludes every ASCII substitute (`| - + = # ~ :`)
 * — those are genuinely ambiguous with plain text and are left to the flat
 * density family instead (`lookupGlyphDensity`), matching the plan's own
 * "ASCII and text: flat density" row. `/` and `\` ARE included even though
 * they can appear as plain text too — a real diagonal stroke is a strictly
 * better approximation than a density blob for a slash, and both tiers'
 * `diagonal` tables use these two glyphs as genuine diagonal ink (never as
 * arbitrary text) in every caller this repo has.
 */
const LINE_ART_GLYPHS: ReadonlyMap<string, LineArtGlyph> = new Map<string, LineArtGlyph>([
  ["│", { density: 0.2, mask: (c, r) => strokeMask(N | S, c, r) }],
  ["─", { density: 0.2, mask: (c, r) => strokeMask(E | W, c, r) }],
  ["└", { density: 0.25, mask: (c, r) => strokeMask(N | E, c, r) }],
  ["┘", { density: 0.25, mask: (c, r) => strokeMask(N | W, c, r) }],
  ["┌", { density: 0.25, mask: (c, r) => strokeMask(S | E, c, r) }],
  ["┐", { density: 0.25, mask: (c, r) => strokeMask(S | W, c, r) }],
  ["├", { density: 0.3, mask: (c, r) => strokeMask(N | E | S, c, r) }],
  ["┤", { density: 0.3, mask: (c, r) => strokeMask(N | S | W, c, r) }],
  ["┬", { density: 0.3, mask: (c, r) => strokeMask(E | S | W, c, r) }],
  ["┴", { density: 0.3, mask: (c, r) => strokeMask(N | E | W, c, r) }],
  ["┼", { density: 0.35, mask: (c, r) => strokeMask(N | E | S | W, c, r) }],
  ["═", { density: 0.35, mask: (c, r) => strokeMask(E | W, c, r) }],
  ["║", { density: 0.35, mask: (c, r) => strokeMask(N | S, c, r) }],
  ["╌", { density: 0.15, mask: (c, r) => strokeMask(E | W, c, r) }],
  ["╎", { density: 0.15, mask: (c, r) => strokeMask(N | S, c, r) }],
  ["▲", { density: 0.25, mask: (c, r) => arrowMask("n", c, r) }],
  ["▶", { density: 0.25, mask: (c, r) => arrowMask("e", c, r) }],
  ["▼", { density: 0.25, mask: (c, r) => arrowMask("s", c, r) }],
  ["◀", { density: 0.25, mask: (c, r) => arrowMask("w", c, r) }],
  ["‾", { density: 0.15, mask: (c, r) => rowMask(0, c, r) }],
  ["▔", { density: 0.15, mask: (c, r) => rowMask(0, c, r) }],
  ["_", { density: 0.15, mask: (c, r) => rowMask(r - 1, c, r) }],
  ["▏", { density: 0.15, mask: (c, r) => colMask(0, c, r) }],
  ["▕", { density: 0.15, mask: (c, r) => colMask(c - 1, c, r) }],
  ["·", { density: 0.12, mask: (c, r) => centerDotMask(c, r) }],
  ["/", { density: 0.2, mask: (c, r) => diagonalMask([0, r - 1], [c - 1, 0], c, r) }],
  ["\\", { density: 0.2, mask: (c, r) => diagonalMask([0, 0], [c - 1, r - 1], c, r) }],
]);

/**
 * Measured glyph ink coverage, mirroring `packages/charts/src/fixtures/
 * glyphInkCoverage.json`'s `glyphMonoFt` column (the site's own font,
 * FreeType-rasterised) — duplicated rather than imported because glyphcss
 * cannot depend on `@glyphcss/charts` (the dependency runs the other way).
 * Only glyphs NOT already resolved by a shading ramp or the line-art table
 * above are ever consulted here (`▚ ╱ ▌ # % + . = @ : |` and `-`, the ramp
 * glyphs' own measurements are read from the ramp position instead — see
 * `lookupGlyphDensity`).
 */
const GLYPH_INK_DENSITY: Readonly<Record<string, number>> = {
  "▚": 0.5, "╱": 0.19, "▌": 0.5, "#": 0.29, "%": 0.28, "+": 0.15,
  ".": 0.03, "=": 0.15, "@": 0.34, ":": 0.06, "|": 0.16, "-": 0.08,
};

const DEFAULT_GLYPH_DENSITY = 0.3;

// The four `GLYPH_CANVAS_TIERS[*].shadeRamp` arrays, read live rather than
// re-declared — a glyph's ramp POSITION is its exact caller-requested
// density (`resolveFillShade`'s own semantics), always preferred over a
// flat measurement.
function densityRamps(): readonly (readonly string[])[] {
  return [
    GLYPH_CANVAS_TIERS.ascii.shadeRamp,
    GLYPH_CANVAS_TIERS.box.shadeRamp,
    GLYPH_CANVAS_TIERS.blocks.shadeRamp,
    GLYPH_CANVAS_TIERS.braille.shadeRamp,
  ];
}

function lookupGlyphDensity(glyph: string): number {
  for (const ramp of densityRamps()) {
    const idx = ramp.indexOf(glyph);
    if (idx >= 0) return ramp.length > 1 ? idx / (ramp.length - 1) : idx;
  }
  const measured = GLYPH_INK_DENSITY[glyph];
  if (measured !== undefined) return Math.min(1, Math.max(0, measured));
  return DEFAULT_GLYPH_DENSITY;
}

/**
 * `glyphInkMask`'s own density for a glyph, decoupled from any particular
 * texel resolution — the cell canvas's `shade` field (`canvas.ts`) reads
 * this directly rather than building and averaging a mask (cheap: O(1) for
 * every family, never a per-write texel-grid allocation on a canvas that
 * may paint thousands of cells).
 */
export function glyphInkDensity(glyph: string, tier: GlyphCanvasTierName): number {
  if (glyph === " ") return 0;
  if (tier === "braille") {
    const cp = glyph.codePointAt(0);
    if (cp !== undefined && cp >= 0x2800 && cp <= 0x28ff) return popcount(cp - 0x2800) / 8;
  }
  if (tier === "blocks" || tier === "braille") {
    const qIdx = GLYPH_CANVAS_QUADRANT_GLYPHS.indexOf(glyph);
    if (qIdx >= 0) return popcount(qIdx) / 4;
  }
  const lineArt = LINE_ART_GLYPHS.get(glyph);
  if (lineArt) return lineArt.density;
  return lookupGlyphDensity(glyph);
}

function popcount(n: number): number {
  let c = 0;
  let v = n;
  while (v) { c += v & 1; v >>= 1; }
  return c;
}

// Standard order-4 Bayer dithering matrix, tiled over any `cols x rows` —
// see the module doc's family 3. Values 0..15; ties (repeats past a 4x4
// tile) broken by row-major index so the ranking stays a total order.
const BAYER4: readonly (readonly number[])[] = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 5, 13],
];

function orderedFillMask(density: number, cols: number, rows: number): Uint8Array {
  const total = cols * rows;
  const mask = new Uint8Array(total);
  if (total === 0 || density <= 0) return mask;
  if (density >= 1) { mask.fill(1); return mask; }
  const count = Math.round(density * total);
  if (count <= 0) return mask;
  const order: number[] = [];
  for (let i = 0; i < total; i++) order.push(i);
  order.sort((a, b) => {
    const va = BAYER4[Math.floor(a / cols) % 4]![a % cols % 4]!;
    const vb = BAYER4[Math.floor(b / cols) % 4]![b % cols % 4]!;
    return va !== vb ? va - vb : a - b;
  });
  for (let i = 0; i < count; i++) mask[order[i]!] = 1;
  return mask;
}

/**
 * A glyph's own ink coverage at an arbitrary `[cols, rows]` texel
 * resolution — the engine behind `glyphCanvasTextureSampler` (`sampler.ts`).
 * See the module doc for the three resolution families. Never throws and
 * never returns `undefined`/a wrong-length array: every glyph any
 * `GLYPH_CANVAS_TIERS` table can emit resolves through one of the three
 * families, with family 3's flat default as the final catch-all.
 */
export function glyphInkMask(glyph: string, tier: GlyphCanvasTierName, dims: readonly [number, number]): Uint8Array {
  const [cols, rows] = dims;
  if (!Number.isInteger(cols) || cols < 1 || !Number.isInteger(rows) || rows < 1) {
    throw new RangeError(`glyphcss: glyphInkMask() dims must be positive integers, got [${cols}, ${rows}].`);
  }
  if (glyph === " ") return new Uint8Array(cols * rows);
  if (tier === "braille") {
    const cp = glyph.codePointAt(0);
    if (cp !== undefined && cp >= 0x2800 && cp <= 0x28ff) {
      const dots = cp - 0x2800;
      return resampleBitGrid(DOT_COLS, DOT_ROWS, (c, r) => (dots >> braileDotBit(c, r)) & 1, cols, rows);
    }
  }
  if (tier === "blocks" || tier === "braille") {
    const qIdx = GLYPH_CANVAS_QUADRANT_GLYPHS.indexOf(glyph);
    if (qIdx >= 0) {
      return resampleBitGrid(2, 2, (c, r) => (qIdx >> quadrantBit(c, r, 2, 2)) & 1, cols, rows);
    }
  }
  const lineArt = LINE_ART_GLYPHS.get(glyph);
  if (lineArt) return lineArt.mask(cols, rows);
  return orderedFillMask(lookupGlyphDensity(glyph), cols, rows);
}
