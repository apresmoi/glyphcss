/**
 * The cell canvas: a pure, browser-free 2D authoring surface over a
 * {@link CellGrid} for `@glyphcss/charts`/`@glyphcss/diagrams` (CHARTS-
 * RESEARCH Phase 0). It owns storage and painters only — layout, scales,
 * label collision and routing are later phases' own code, built on top of
 * this.
 *
 * Nothing here is imported by the existing render path (`rasterize.ts`,
 * `cells.ts`) and nothing here imports anything that would change: the
 * existing runtime/compile output stays byte-identical whether or not this
 * module is ever loaded.
 */

import { buildCellGrid, isSingleCellGlyph, type CellGrid } from "../cells";
import { isQuantizableColor } from "../paletteQuantize";
import { inkGlyphForTangent } from "../rasterize";
import { createGlyphCanvasReport, type GlyphCanvasFoldedGlyph, type GlyphCanvasReport } from "./report";
import {
  GLYPH_CANVAS_TIERS,
  type GlyphCanvasDiagonalKey,
  type GlyphCanvasTier,
  type GlyphCanvasTierName,
} from "./tiers";
import {
  createGlyphCanvasEdgeState,
  registerGlyphCanvasEdge,
  registerGlyphCanvasRoute,
  resolveGlyphCanvasJunctions,
  type GlyphCanvasEdgeOptions,
  type GlyphCanvasEdgeState,
} from "./junctions";

export type GlyphCanvasFill = "solid" | { readonly shade: number };

export interface GlyphCanvasFillOptions {
  readonly fill: GlyphCanvasFill;
  readonly color?: string | null;
  /** Omitted = leave existing `bg` untouched; `null` explicitly clears it. */
  readonly bg?: string | null;
}

export interface GlyphCanvasPoint {
  readonly x: number;
  readonly y: number;
}

export type GlyphCanvasLineStyle = "solid" | "dashed" | "dotted" | "double";

export interface GlyphCanvasLineOptions {
  readonly style?: GlyphCanvasLineStyle;
  readonly color?: string | null;
  /**
   * Recorded into `grid.depth` at every cell the line touches, for a later
   * consumer to depth-test against. The canvas itself performs no test —
   * Phase 0 has no scene to compare depth with.
   */
  readonly depth?: number;
  /**
   * Overrides the active tier's own `subcell` capability for THIS call only.
   * Default: `GLYPH_CANVAS_TIERS[canvas.tier].subcell` (unchanged behaviour).
   * `@glyphcss/charts` passes `false` explicitly for axes/rule marks under
   * `braille`/`blocks` — those stay WHOLE-CELL box-drawing (`│ ─`) even
   * though DATA marks (`line`/`area`/`dot`) rasterise at sub-cell (dot)
   * resolution under those two tiers; the canvas itself stays general (it
   * has no notion of "axis" or "data mark") and simply honours whichever
   * capability the caller asks for.
   */
  readonly subcell?: boolean;
}

export type GlyphCanvasTextAlign = "left" | "center" | "right";

export interface GlyphCanvasTextOptions {
  readonly align?: GlyphCanvasTextAlign;
  readonly color?: string | null;
  /**
   * Accepted so a later phase's obstacle-aware label layout can call this
   * signature unchanged. Phase 0 has no collision/arbitration system to
   * feed it into — `canvas.text` never rations or drops a label on its own,
   * and writes every glyph it is given (folded/substituted per the usual
   * rule) rather than reserving space ahead of time.
   */
  readonly priority?: number;
}

export interface GlyphCanvasArrowheadOptions {
  readonly color?: string | null;
}

export type GlyphCanvasDirection = "n" | "e" | "s" | "w";

export interface GlyphCanvasOptions {
  readonly cols: number;
  readonly rows: number;
  /** Cell width/height ratio; carried for a future phase's aspect-aware layout. Default `0.5`. */
  readonly cellAspect?: number;
  readonly tier?: GlyphCanvasTierName;
}

export interface GlyphCanvas {
  readonly cols: number;
  readonly rows: number;
  readonly cellAspect: number;
  readonly tier: GlyphCanvasTierName;
  /** The owned, mutable cell grid every painter writes into. */
  readonly grid: CellGrid;
  /**
   * Canvas-owned per-cell background colour — `CellGrid` has no `bg` field
   * (a scene render never needs one), so the canvas carries it alongside the
   * grid instead of extending a contract the renderer doesn't share.
   */
  readonly bg: (string | null)[];
  /**
   * Canvas-owned 2×4 sub-cell occupancy, one byte per cell, dot bits laid
   * out exactly like a Unicode braille pattern (`0x2800 + mask`): bit0..bit2
   * are the left column's rows 0..2, bit3..bit5 the right column's rows
   * 0..2, bit6 the left column's row 3, bit7 the right column's row 3. The
   * `blocks` tier reads the same buffer at 2×2 quadrant granularity (a
   * quadrant is "on" when either of its two constituent dots is).
   */
  readonly sub: Uint8Array;
  readonly report: GlyphCanvasReport;

  fillRect(x0: number, y0: number, x1: number, y1: number, opts: GlyphCanvasFillOptions): void;
  line(a: GlyphCanvasPoint, b: GlyphCanvasPoint, opts?: GlyphCanvasLineOptions): void;
  text(x: number, y: number, lines: readonly string[], opts?: GlyphCanvasTextOptions): void;
  arrowhead(x: number, y: number, dir: GlyphCanvasDirection, opts?: GlyphCanvasArrowheadOptions): void;
  /** Register `edgeId`'s graph endpoints. Must be called before any
   * `route()` call for that id — see `junctions.ts`. */
  edge(edgeId: string, opts: GlyphCanvasEdgeOptions): void;
  /**
   * Record `edgeId`'s ordered cell polyline. Consecutive cells must be
   * 4-adjacent (`RangeError` otherwise) — every N/E/S/W mask is DERIVED from
   * this polyline's own neighbours at resolution time, never supplied
   * directly. A second call for the same edge id replaces its route.
   */
  route(edgeId: string, cells: readonly GlyphCanvasPoint[]): void;
  resolveJunctions(): void;
}

function isOccludedCell(grid: CellGrid, idx: number): boolean {
  return grid.occluded !== undefined && grid.occluded[idx] === 1;
}

const AXIS_EPSILON = 1e-6;

/**
 * `fillRect`'s integer-coordinate check, generalized: any painter that
 * addresses ONE cell (`text`'s anchor, `arrowhead`'s tip) takes the same
 * `RangeError` for a non-integer or non-finite coordinate, naming itself.
 * `line()` is deliberately excluded — its endpoints are documented sub-cell
 * quantities (see `walkGlyphCanvasLine`) and rejecting a fractional one
 * would reject the feature.
 */
function assertIntegerCellCoords(painter: string, coords: readonly number[]): void {
  for (const c of coords) {
    if (!Number.isInteger(c)) {
      throw new RangeError(`glyphcss: ${painter}() requires integer cell coordinates, got (${coords.join(", ")}).`);
    }
  }
}

interface GlyphCanvasLineCell {
  readonly col: number;
  readonly row: number;
  /**
   * A representative point along the segment inside this cell — the
   * midpoint (in parametric `t`) of the sub-segment the walk traversed
   * through it. Feeds the diagonal branch's cell-local `subRow`/`subCol`
   * (see `inkGlyphForTangent`), the same quantity the old per-sample walk
   * derived from its (fixed-count) sample points.
   */
  readonly px: number;
  readonly py: number;
}

/**
 * Visit every cell whose INTERIOR the segment `a`→`b` passes through, in
 * order — a supercover / DDA walk (Amanatides–Woo) over the grid's cell
 * boundaries, not a fixed sample count. The previous implementation picked
 * `steps = round(length)` evenly-spaced samples and rounded each one to a
 * cell: a short, near-axis-aligned segment landing mid-cell at both ends
 * (`(0.49, 0) → (1.51, 0)` on a 3-wide canvas) rounds to samples at cell 0
 * and cell 2 only, skipping the middle cell the segment's interior actually
 * crosses — `"- -"` instead of `"---"`. Walking cell BOUNDARIES instead
 * visits every crossed cell by construction, at any length, angle, or
 * sub-cell endpoint.
 *
 * `line()`'s own coordinate convention centres a cell on its integer
 * coordinate (`Math.round` picks the containing cell — see the existing
 * `(0, 0)` .. `(6, 0)` fixtures), so cell BOUNDARIES sit on the
 * half-integers. The walk runs in coordinates shifted by `+0.5` — which
 * puts those boundaries on integers, the framing Amanatides–Woo assumes —
 * and reports cells back unshifted.
 */
function walkGlyphCanvasLine(a: GlyphCanvasPoint, b: GlyphCanvasPoint): GlyphCanvasLineCell[] {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const cells: GlyphCanvasLineCell[] = [];

  if (Math.abs(dx) < AXIS_EPSILON && Math.abs(dy) < AXIS_EPSILON) {
    cells.push({ col: Math.round(a.x), row: Math.round(a.y), px: a.x, py: a.y });
    return cells;
  }

  const stepX = dx > 0 ? 1 : dx < 0 ? -1 : 0;
  const stepY = dy > 0 ? 1 : dy < 0 ? -1 : 0;
  const startCol = Math.floor(a.x + 0.5);
  const startRow = Math.floor(a.y + 0.5);
  const endCol = Math.floor(b.x + 0.5);
  const endRow = Math.floor(b.y + 0.5);

  let col = startCol;
  let row = startRow;
  let tMaxX = stepX === 0 ? Infinity : ((col + (stepX > 0 ? 1 : 0)) - (a.x + 0.5)) / dx;
  let tMaxY = stepY === 0 ? Infinity : ((row + (stepY > 0 ? 1 : 0)) - (a.y + 0.5)) / dy;
  const tDeltaX = stepX === 0 ? Infinity : Math.abs(1 / dx);
  const tDeltaY = stepY === 0 ? Infinity : Math.abs(1 / dy);

  let t = 0;
  const T_EPS = 1e-9;
  // Every iteration advances `col` and/or `row` by exactly one cell (never
  // both back and forth), so the walk cannot legitimately need more steps
  // than the Manhattan distance between the start and end cell, plus one
  // for the final partial cell.
  const maxSteps = Math.abs(endCol - startCol) + Math.abs(endRow - startRow) + 2;
  for (let i = 0; i < maxSteps; i++) {
    const tExit = Math.min(tMaxX, tMaxY, 1);
    const tMid = (t + tExit) / 2;
    cells.push({ col, row, px: a.x + dx * tMid, py: a.y + dy * tMid });
    if (tExit >= 1 - T_EPS) break;
    t = tExit;
    // A tie (crossing a vertical AND a horizontal grid line at the same
    // `t`, i.e. the segment passes exactly through a grid corner — the
    // common case for an exact 45-degree diagonal between integer-ish
    // endpoints) advances BOTH axes at once, visiting the diagonal
    // neighbour directly rather than the two orthogonal neighbours either
    // side of it, neither of whose interiors the segment actually enters.
    if (tMaxX <= tExit + T_EPS) { col += stepX; tMaxX += tDeltaX; }
    if (tMaxY <= tExit + T_EPS) { row += stepY; tMaxY += tDeltaY; }
  }

  return cells;
}

/**
 * Sub-cell dot lattice: 2 columns x 4 rows per cell, FIXED regardless of
 * `cellAspect` — this is the physical dot layout a braille codepoint (and,
 * grouped into quadrants, a `blocks` glyph) actually has, not a
 * runtime-tunable resolution. It is also what "honouring the cell aspect"
 * means here: a terminal cell is roughly twice as tall as wide (`cellAspect`
 * defaults to `0.5`), and splitting it 2-wide-by-4-tall is what makes each
 * DOT itself roughly square — an equal split (e.g. a naive 2x2) would make a
 * geometrically 45-degree `line()` run look visibly off-slope once rendered.
 * See `GlyphCanvas.sub`'s doc comment for the bit layout this matches.
 */
const SUBCELL_DOT_COLS = 2;
const SUBCELL_DOT_ROWS = 4;

/**
 * Cell-space point → continuous DOT-space coordinate, using the SAME
 * "integer = centre, half-integer = boundary" convention `line()`'s own
 * cell coordinates already use, applied recursively at dot granularity: dot
 * `k` of `DOTS` sits at cell-local offset `(k + 0.5) / DOTS - 0.5`, and
 * `DOTS * x + (DOTS - 1) / 2` is exactly the affine map that sends every
 * such offset, for every integer cell `x`, onto an integer dot coordinate —
 * i.e. dot centres land on integers and dot boundaries on half-integers,
 * the framing `walkGlyphCanvasSubcellDots` (via plain Bresenham, no
 * supercover) relies on.
 */
function toSubcellSpace(p: GlyphCanvasPoint): GlyphCanvasPoint {
  return {
    x: SUBCELL_DOT_COLS * p.x + (SUBCELL_DOT_COLS - 1) / 2,
    y: SUBCELL_DOT_ROWS * p.y + (SUBCELL_DOT_ROWS - 1) / 2,
  };
}

interface GlyphCanvasDot {
  readonly x: number;
  readonly y: number;
}

/**
 * A plain (non-supercover) Bresenham walk over the dot lattice — deliberately
 * NOT `walkGlyphCanvasLine`'s supercover/DDA, which visits every cell a
 * segment's interior merely GRAZES (the right behaviour for avoiding gaps at
 * char-CELL resolution, where a whole cell is one glyph). At DOT resolution
 * that same graze-everything rule can touch `2 + 4 - 1 = 5` dots inside a
 * single 2x4 cell for a shallow diagonal — more than half that cell's own
 * dots, for what is supposed to be a single hairline stroke. Bresenham's
 * single-dot-per-major-step walk is the standard technique every
 * braille/sixel plotting library uses for exactly this reason: it stays a
 * connected, 8-adjacent, THIN path. For the endpoints `line()`'s callers
 * produce it is bounded at ≤4 dots inside any 2x4 window (`subcell.test.ts`
 * pins this on the exact case that motivated the choice).
 */
function walkGlyphCanvasSubcellDots(a: GlyphCanvasPoint, b: GlyphCanvasPoint): GlyphCanvasDot[] {
  let x = Math.round(a.x);
  let y = Math.round(a.y);
  const x1 = Math.round(b.x);
  const y1 = Math.round(b.y);
  const dx = Math.abs(x1 - x);
  const sx = x < x1 ? 1 : -1;
  const dy = -Math.abs(y1 - y);
  const sy = y < y1 ? 1 : -1;
  let err = dx + dy;
  const dots: GlyphCanvasDot[] = [];
  // A Bresenham walk visits at most `max(dx, |dy|) + 1` dots and always
  // terminates exactly at the second endpoint; the loop bound is a belt,
  // never load-bearing the way `walkGlyphCanvasLine`'s `tExit` termination is.
  const maxSteps = dx + Math.abs(dy) + 2;
  for (let i = 0; i < maxSteps; i++) {
    dots.push({ x, y });
    if (x === x1 && y === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; x += sx; }
    if (e2 <= dx) { err += dx; y += sy; }
  }
  return dots;
}

/**
 * The `GlyphCanvas.sub` dot BIT for a LOCAL (within-cell) dot position —
 * `localCol` in `{0, 1}`, `localRow` in `{0, 1, 2, 3}` — matching that
 * field's own doc comment exactly (bit0..2 left column rows 0..2, bit3..5
 * right column rows 0..2, bit6 left row 3, bit7 right row 3).
 */
function subcellDotBit(localCol: number, localRow: number): number {
  if (localCol === 0) return localRow < 3 ? localRow : 6;
  return localRow < 3 ? 3 + localRow : 7;
}

/**
 * `line()`'s sub-cell (braille/blocks) path: rasterises the segment at DOT
 * resolution into the canvas's shared `sub` buffer, deriving each touched
 * cell's glyph from the tier's own `subGlyph` — the exact same
 * mask-to-glyph step `fillRect` already uses, so a line crossing a filled
 * region (or another line) MERGES into the existing occupancy (`sub[idx] |=
 * bit`, never an assignment) instead of overwriting it. Style handling
 * mirrors the whole-cell path one level down: the dash/dot cadence advances
 * per DOT visited (finer-grained than the whole-cell path's per-CELL
 * cadence, since the walk itself is now finer), and a diagonal `"double"`
 * keeps the SAME documented contract narrowing (solid + one `report.ledger`
 * entry) — there is no more a clean single-dot-offset "parallel diagonal"
 * than there was a doubled diagonal GLYPH. An axis-aligned `"double"`
 * instead draws a second dot-thin run exactly one DOT away, perpendicular to
 * the line — the lattice always "allows" this for a horizontal/vertical run
 * (the offset run is just as valid a dot sequence as the first), so this is
 * real support, not a narrowing.
 */
function paintSubcellLine(
  grid: CellGrid,
  sub: Uint8Array,
  cols: number,
  rows: number,
  report: GlyphCanvasReport,
  tierTable: GlyphCanvasTier,
  a: GlyphCanvasPoint,
  b: GlyphCanvasPoint,
  depth: number | undefined,
  style: GlyphCanvasLineStyle,
  color: string | null,
  horizontal: boolean,
  vertical: boolean,
): void {
  const dots = walkGlyphCanvasSubcellDots(toSubcellSpace(a), toSubcellSpace(b));

  // `horizontal`/`vertical`/(implicitly) `diagonal` are the same mutually
  // exclusive, exhaustive classification `line()`'s whole-cell path already
  // computes from cell-space `dx`/`dy` — the `else` below IS the diagonal
  // case.
  let offsetDots: readonly GlyphCanvasDot[] | null = null;
  if (style === "double") {
    if (horizontal) offsetDots = dots.map((d) => ({ x: d.x, y: d.y + 1 }));
    else if (vertical) offsetDots = dots.map((d) => ({ x: d.x + 1, y: d.y }));
    else {
      report.ledger.push(
        `line(): "double" style has no diagonal analogue on a sub-cell tier and rendered solid starting at cell (${Math.round(a.x)}, ${Math.round(a.y)}).`,
      );
    }
  }

  const plotDot = (d: GlyphCanvasDot): void => {
    const cellCol = Math.floor(d.x / SUBCELL_DOT_COLS);
    const cellRow = Math.floor(d.y / SUBCELL_DOT_ROWS);
    if (cellCol < 0 || cellCol >= cols || cellRow < 0 || cellRow >= rows) return;
    const idx = cellRow * cols + cellCol;
    if (isOccludedCell(grid, idx)) return;
    const localCol = d.x - cellCol * SUBCELL_DOT_COLS;
    const localRow = d.y - cellRow * SUBCELL_DOT_ROWS;
    sub[idx] |= 1 << subcellDotBit(localCol, localRow);
    grid.char[idx] = tierTable.subGlyph!(sub[idx]);
    grid.color[idx] = color;
    if (depth !== undefined) grid.depth[idx] = depth;
  };

  // The pattern advances per DOT visited, whether or not it ends up
  // paintable — the same "never let a skipped step silently renumber
  // everything after it" discipline the whole-cell path already follows for
  // occlusion, generalized to the finer walk.
  let patternIndex = 0;
  for (let i = 0; i < dots.length; i++) {
    patternIndex++;
    const paint = style === "dotted" ? patternIndex % 2 === 1 : style === "dashed" ? patternIndex % 3 !== 0 : true;
    if (!paint) continue;
    plotDot(dots[i]!);
    if (offsetDots) plotDot(offsetDots[i]!);
  }
}

/**
 * `fillRect`'s `shade` is a continuous quantity a layout computes from a
 * scale (exactly like its `x0`/`y0`/`x1`/`y1`) — a `NaN` (an all-zero series'
 * `v / max`, a constant series' `(v - min) / (max - min)`) used to reach
 * `Math.round(NaN * (ramp.length - 1))` unclamped, i.e. `ramp[NaN]`, which is
 * `undefined`: written into `grid.char` verbatim, it shortens the encoded
 * row by one character and corrupts every column after it. Rejecting a
 * non-finite or out-of-range shade here — the same "throw immediately
 * instead of silently corrupting shared state" rule `fillRect`'s integer
 * coordinate check already follows — makes that failure loud instead of a
 * misaligned grid three encoders down the line.
 */
function resolveFillShade(fill: GlyphCanvasFill, painter: string): number {
  if (fill === "solid") return 1;
  const { shade } = fill;
  if (typeof shade !== "number" || !Number.isFinite(shade) || shade < 0 || shade > 1) {
    throw new RangeError(`glyphcss: ${painter}() fill.shade must be a finite number in [0, 1], got ${JSON.stringify(shade)}.`);
  }
  return shade;
}

/**
 * Colour validation happens ONCE, here, at the point every painter writes
 * into the shared `grid.color`/`bg` buffers — not at encode time. `CellGrid`
 * colours are contractually canonical `#rrggbb` everywhere else in glyphcss
 * (`cells.ts`'s `assertColor`, not exported, hence this module's own copy of
 * the same canonical-colour test via the already-public
 * `isQuantizableColor`); letting an arbitrary caller string (`"red"`, or a
 * string built from untrusted JSON) reach a shared buffer unvalidated is
 * what let a non-hex colour silently render as black in the ANSI exit and
 * correctly in the HTML exit, AND is what let a crafted colour string inject
 * attributes into `encodeGlyphCanvasHtml`'s `style="..."` output — a
 * `text()` label is exactly the kind of value a Phase 1 JSON/MCP entry point
 * hands this module directly. Throwing here, at the single place every
 * colour enters the canvas, means every encoder can trust `grid.color`/`bg`
 * unconditionally and never needs its own guard.
 *
 * `isQuantizableColor` alone is case-INSENSITIVE (`cells.ts`'s own
 * `assertColor` is too, by the same regex) — it validates hex, not
 * CANONICAL hex. This module's two string encoders coalesce runs by exact
 * string identity, so `#3B82F6` and `#3b82f6` (the same colour, spelled the
 * way most design tools print hex) fragment one intended run into one span
 * per cell. The extra `CANONICAL_HEX` check below rejects anything
 * `isQuantizableColor` would accept but this module's own contract
 * ("canonical `#rrggbb`") would not: uppercase, `#rgb`, `rgb(...)`, and
 * incidental whitespace all throw here rather than silently defeating run
 * coalescing downstream.
 */
const CANVAS_CANONICAL_HEX = /^#[0-9a-f]{6}$/;

function assertCanvasColor(value: string | null | undefined, painter: string): string | null {
  if (value === undefined || value === null) return null;
  if (!isQuantizableColor(value) || !CANVAS_CANONICAL_HEX.test(value)) {
    throw new TypeError(`glyphcss: ${painter}() color must be null or a canonical lowercase #rrggbb string, got ${JSON.stringify(value)}.`);
  }
  return value;
}

// Fill order for the 8 sub-cell dot bits (see `GlyphCanvas.sub`'s doc for the
// bit layout): TOP-LEFT's two dots, then TOP-RIGHT's, then BOTTOM-LEFT's,
// then BOTTOM-RIGHT's — i.e. one quadrant fully lit before the next quadrant
// gains its first dot. This is what makes `shade: 0.5` (4 of 8 dots) land on
// EXACTLY "both top dots lit, both bottom dots dark" for every tier that
// reads `sub`: the `blocks` tier's quadrant mask is `TL|TR` → `▀`, and
// braille's raw dot mask is bits {0,1,3,4} → the top FOUR dots — both the
// literal properties the "blocks/braille are sub-derived" gate requires. Any
// order that interleaves quadrants (e.g. lighting one dot in every quadrant
// before a second dot in any of them) reaches all-4-quadrants-lit — a full
// block — at `shade: 0.5` instead, which is what the un-fixed identity
// permutation effectively did in the other direction (full block reached at
// `shade: 0.75`, a quarter of the range spent fully saturated either way).
const SUB_FILL_ORDER = [0, 1, 3, 4, 2, 6, 5, 7];

function subMaskForShade(shade: number): number {
  const count = Math.round(shade * 8);
  let mask = 0;
  for (let i = 0; i < count; i++) mask |= 1 << SUB_FILL_ORDER[i]!;
  return mask;
}

// A small fold table for punctuation whose NFD form is still rejected by
// `isSingleCellGlyph` — mainly FULLWIDTH forms (CJK-adjacent input), which
// are genuinely double-width and have no decomposition to fall back on.
// Ordinary Latin symbols (em dash, curly quotes, bullets, …) already pass
// `isSingleCellGlyph` directly (it only rejects control/format/combining
// characters and wide East-Asian glyphs), so they never reach this table.
const CANVAS_TEXT_SUBSTITUTIONS: Readonly<Record<string, string>> = {
  "，": ",", "．": ".", "。": ".", "！": "!", "？": "?",
  "：": ":", "；": ";", "（": "(", "）": ")", "－": "-",
  "［": "[", "］": "]",
};

const COMBINING_MARKS = /\p{M}/gu;

/**
 * Split `text` into user-perceived characters (grapheme clusters), not UTF-16
 * code points. This is what makes the NFD fold below reachable at all: a
 * decomposed grapheme like `"e" + COMBINING ACUTE ACCENT` is TWO code points
 * but ONE grapheme, and splitting by code point (the previous implementation)
 * separates them before `resolveTextGlyph` ever sees the pair — the base "e"
 * is already a valid single-cell glyph on its own, so the fold branch never
 * runs and the accent is reported as a stray unsupported glyph instead of
 * being stripped as part of its own character. `Intl.Segmenter` is available
 * in every runtime this module targets (evergreen browsers, Node ≥ 16); the
 * code-point fallback is exactly `Array.from`'s existing behaviour for a
 * runtime that somehow lacks it.
 */
function segmentGraphemes(text: string): string[] {
  const SegmenterCtor = (Intl as { Segmenter?: new (locale: string, opts: { granularity: string }) => { segment(s: string): Iterable<{ segment: string }> } }).Segmenter;
  if (typeof SegmenterCtor === "function") {
    const segmenter = new SegmenterCtor("und", { granularity: "grapheme" });
    return Array.from(segmenter.segment(text), (s) => s.segment);
  }
  return Array.from(text);
}

/**
 * Resolve one input grapheme cluster to a single displayable cell glyph,
 * folding or substituting when `isSingleCellGlyph` rejects the original, and
 * recording every fallback in `report`. Three steps, in order: (1) already
 * valid, keep it; (2) NFD-normalize and strip combining marks — recovers a
 * base letter from an already-decomposed grapheme (`"e" + COMBINING ACUTE
 * ACCENT`, a 2-code-unit grapheme `isSingleCellGlyph` rejects on length
 * alone); (3) a small substitution table for the punctuation NFD can't fix.
 * Anything still standing (a wide CJK character, an astral emoji, …)
 * becomes `?`, and steps (2)/(3) each record the substitution actually made
 * (`report.foldedGlyphs`) rather than only the terminal `?` case.
 */
function resolveTextGlyph(raw: string, report: GlyphCanvasReport, col: number, row: number): string {
  // `isSingleCellGlyph` is `(glyph: unknown) => glyph is string` — called
  // directly on an already-`string` value, TS would narrow the negative
  // branch to `never` (the "not string" complement of `string`), so the
  // boolean is captured first to keep `raw`'s type intact for `.normalize`.
  const rawIsValid: boolean = isSingleCellGlyph(raw);
  if (rawIsValid) return raw;

  const folded = raw.normalize("NFD").replace(COMBINING_MARKS, "");
  const foldedIsValid: boolean = isSingleCellGlyph(folded);
  if (foldedIsValid) {
    report.foldedGlyphs.push({ from: raw, to: folded, col, row } satisfies GlyphCanvasFoldedGlyph);
    return folded;
  }

  const substituted = CANVAS_TEXT_SUBSTITUTIONS[raw];
  if (substituted !== undefined && isSingleCellGlyph(substituted)) {
    report.foldedGlyphs.push({ from: raw, to: substituted, col, row } satisfies GlyphCanvasFoldedGlyph);
    return substituted;
  }

  report.unsupportedGlyphs.push(raw);
  return "?";
}

export function createGlyphCanvas(options: GlyphCanvasOptions): GlyphCanvas {
  const { cols, rows } = options;
  const cellAspect = options.cellAspect ?? 0.5;
  const tier = options.tier ?? "box";
  const n = cols * rows;

  const grid = buildCellGrid(new Array<string>(n).fill(" "), null, null, cols, rows);
  const bg: (string | null)[] = new Array(n).fill(null);
  const sub = new Uint8Array(n);
  const report: GlyphCanvasReport = createGlyphCanvasReport();
  const edgeState: GlyphCanvasEdgeState = createGlyphCanvasEdgeState();

  const canvas: GlyphCanvas = {
    cols,
    rows,
    cellAspect,
    tier,
    grid,
    bg,
    sub,
    report,

    fillRect(x0, y0, x1, y1, opts) {
      assertIntegerCellCoords("fillRect", [x0, y0, x1, y1]);
      const tierTable = GLYPH_CANVAS_TIERS[tier];
      const shade = resolveFillShade(opts.fill, "fillRect");
      const color = assertCanvasColor(opts.color, "fillRect");
      const bgColor = opts.bg === undefined ? undefined : assertCanvasColor(opts.bg, "fillRect");
      const cxLo = Math.max(0, Math.min(x0, x1));
      const cxHi = Math.min(cols - 1, Math.max(x0, x1));
      const cyLo = Math.max(0, Math.min(y0, y1));
      const cyHi = Math.min(rows - 1, Math.max(y0, y1));
      for (let y = cyLo; y <= cyHi; y++) {
        for (let x = cxLo; x <= cxHi; x++) {
          const idx = y * cols + x;
          if (isOccludedCell(grid, idx)) continue;
          if (tierTable.subcell) {
            const mask = subMaskForShade(shade);
            sub[idx] = mask;
            grid.char[idx] = tierTable.subGlyph!(mask);
          } else {
            const ramp = tierTable.shadeRamp;
            const level = Math.round(shade * (ramp.length - 1));
            grid.char[idx] = ramp[level]!;
          }
          grid.color[idx] = color;
          if (bgColor !== undefined) bg[idx] = bgColor;
        }
      }
    },

    line(a, b, opts = {}) {
      const tierTable = GLYPH_CANVAS_TIERS[tier];
      const style = opts.style ?? "solid";
      const color = assertCanvasColor(opts.color, "line");
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const horizontal = Math.abs(dy) < AXIS_EPSILON;
      const vertical = Math.abs(dx) < AXIS_EPSILON;
      const diagonal = !horizontal && !vertical;

      // `braille`/`blocks` rasterise at sub-cell (dot) resolution instead of
      // picking one whole-cell glyph per cell — see `paintSubcellLine`.
      // `ascii`/`box` fall through to the unchanged whole-cell walk below.
      // `opts.subcell` lets a caller (charts' own axis/rule painters) force
      // the whole-cell path on a subcell-capable tier — see
      // `GlyphCanvasLineOptions.subcell`'s doc.
      const useSubcell = opts.subcell ?? tierTable.subcell;
      if (useSubcell) {
        paintSubcellLine(grid, sub, cols, rows, report, tierTable, a, b, opts.depth, style, color, horizontal, vertical);
        return;
      }

      let patternIndex = 0;
      let loggedDoubleDiagonal = false;
      for (const { col: cx, row: cy, px, py } of walkGlyphCanvasLine(a, b)) {
        if (cx < 0 || cx >= cols || cy < 0 || cy >= rows) continue;
        const idx = cy * cols + cx;
        // The pattern advances per DISTINCT cell the walk visits, whether or
        // not that cell is paintable — an occluded cell still occupies a
        // position along the dash/dot cadence, it just isn't drawn. Checking
        // occlusion before this increment (the previous behaviour) let a
        // hidden cell renumber every cell after it, changing which LATER,
        // visible cells the pattern shows or hides — occlusion changed the
        // pattern everywhere downstream of it, not just at the hidden cell.
        patternIndex++;
        if (isOccludedCell(grid, idx)) continue;

        let baseGlyph: string | undefined;
        if (diagonal) {
          // A diagonal has no dashed/dotted/double analogue in this glyph
          // set (`inkGlyphForTangent` already varies by sub-cell offset, so
          // there is no single extra "style" axis left to modulate); it
          // still goes through the TIER TABLE for every glyph, via
          // `tier.diagonal`, so an `ascii` canvas never emits the raw
          // (non-ASCII) ink vocabulary directly.
          const subCol = px - Math.floor(px);
          const subRow = py - Math.floor(py);
          const rawInk = inkGlyphForTangent(dx, dy, subRow, subCol);
          baseGlyph = rawInk === "·" ? tierTable.dot : tierTable.diagonal[rawInk as GlyphCanvasDiagonalKey];
          if (style === "double" && !loggedDoubleDiagonal) {
            loggedDoubleDiagonal = true;
            report.ledger.push(
              `line(): "double" style has no diagonal analogue and rendered solid starting at cell (${cx}, ${cy}).`,
            );
          }
        } else {
          const axisGlyph = horizontal ? tierTable.straight.h : tierTable.straight.v;
          if (style === "double") baseGlyph = horizontal ? tierTable.double.h : tierTable.double.v;
          else if (style === "dotted") baseGlyph = tierTable.dot;
          else baseGlyph = axisGlyph;
        }

        // Dashed/dotted skip cells on a sloped run exactly as on an
        // axis-aligned one — the pattern index increments uniformly above,
        // regardless of axis.
        let glyph: string | undefined = baseGlyph;
        if (style === "dotted") glyph = patternIndex % 2 === 1 ? baseGlyph : undefined;
        else if (style === "dashed") glyph = patternIndex % 3 !== 0 ? baseGlyph : undefined;

        if (glyph === undefined) continue;
        if (opts.depth !== undefined) grid.depth[idx] = opts.depth;
        grid.char[idx] = glyph;
        grid.color[idx] = color;
      }
    },

    text(x0, y0, lines, opts = {}) {
      assertIntegerCellCoords("text", [x0, y0]);
      const align = opts.align ?? "left";
      const color = assertCanvasColor(opts.color, "text");
      for (let r = 0; r < lines.length; r++) {
        const y = y0 + r;
        if (y < 0 || y >= rows) continue;
        const graphemes = segmentGraphemes(lines[r]!);
        const width = graphemes.length;
        const startX = align === "left"
          ? x0
          : align === "right"
            ? x0 - width + 1
            : x0 - Math.floor(width / 2);
        for (let i = 0; i < graphemes.length; i++) {
          const x = startX + i;
          if (x < 0 || x >= cols) continue;
          const idx = y * cols + x;
          if (isOccludedCell(grid, idx)) continue;
          grid.char[idx] = resolveTextGlyph(graphemes[i]!, report, x, y);
          grid.color[idx] = color;
        }
      }
    },

    arrowhead(x, y, dir, opts = {}) {
      assertIntegerCellCoords("arrowhead", [x, y]);
      const color = assertCanvasColor(opts.color, "arrowhead");
      if (x < 0 || x >= cols || y < 0 || y >= rows) return;
      const idx = y * cols + x;
      if (isOccludedCell(grid, idx)) return;
      grid.char[idx] = GLYPH_CANVAS_TIERS[tier].arrow[dir];
      grid.color[idx] = color;
    },

    edge(edgeId, opts) {
      registerGlyphCanvasEdge(edgeState, edgeId, opts);
    },

    route(edgeId, cells) {
      registerGlyphCanvasRoute(edgeState, cols, rows, edgeId, cells);
    },

    resolveJunctions() {
      resolveGlyphCanvasJunctions(grid, edgeState, GLYPH_CANVAS_TIERS[tier], report);
    },
  };

  return canvas;
}
