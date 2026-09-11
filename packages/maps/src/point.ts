/**
 * Post-raster POINT stamping into a rasterized `CellGrid` — a point feature
 * drawn as GLYPHS IN THE GRID, the same mechanism `line` and `contour`
 * already use (`stroke.ts`), rather than as a positioned DOM node the way
 * `symbol` and `circle` do.
 *
 * ## Why a point belongs in the grid at all
 *
 * A `circle` is a `<div>` with `border-radius: 50%` sitting above the
 * `<pre>`, and a `symbol` is a `<div>` of text. Both are correct for what
 * they were built for — a click anchor, a place name the reader selects and
 * copies — and both are outside the picture: they do not survive "Copy
 * ASCII", they are not occluded by the terrain in front of them, they do not
 * disappear round the limb of a globe, and on a page whose whole premise is
 * that the render IS TEXT they read as an overlay from a different program.
 *
 * The stamped path gets all four for free, because it is the SAME path a
 * border already takes: one write per `<pre>` (this only ever runs inside the
 * scene's existing `transformCells` hook), the depth test in
 * {@link glyphMapSurfaceOccludes}, cross-`<pre>` cell ownership through
 * {@link glyphMapForeignOwned}, and the projection's own horizon capability
 * applied by the caller before a mark is ever handed here.
 *
 * ## Size is a GLYPH, not a pixel radius
 *
 * A `circle` layer expresses magnitude as a CSS pixel radius, which a
 * character grid cannot draw: the smallest thing it can paint is one cell,
 * and everything below that rounds to the same dot. The unit here is
 * therefore a disc radius in CELL ROWS, and there is exactly ONE rule for
 * turning it into characters — {@link glyphMapPointCells}: rasterize the disc,
 * and pick each cell's glyph by HOW MUCH OF THAT CELL THE DISC COVERS, out of
 * an ordered ramp of increasing ink.
 *
 * That is not a new idea; it is the solid rasterizer's own rule (glyphcss
 * picks a cell's glyph from a `CharRamp` by intensity), applied to a disc
 * instead of to a Lambert term. It is what makes ONE expression serve both
 * halves of "bigger": under one cell the disc grows by climbing the ramp
 * (`·` -> `•` -> `●`, three centred discs of increasing size, so the reader
 * sees ONE shape getting bigger rather than three different symbols), and
 * past one cell it grows by covering more cells, with the partially-covered
 * rim automatically landing on the smaller ramp entries. No threshold, no
 * second mode.
 *
 * ## The ramp's glyphs, and why these
 *
 * {@link GLYPH_MAP_POINT_RAMP} is `· • ●` — U+00B7, U+2022, U+25CF. Three
 * properties made the choice, in this order:
 *
 * 1. **They are the same shape at three sizes.** A ramp of `.` `+` `*` `#`
 *    also increases in ink but reads as four different marks; a reader
 *    comparing two quakes has to learn the order. Three discs need no
 *    legend.
 * 2. **They are CENTRED in the cell.** A full stop sits on the baseline, so a
 *    ramp starting at `.` makes the smallest mark land visibly below its own
 *    feature. The middle dot does not.
 * 3. **All three are in `GLYPH_FONT_ATLAS`** (glyphcss's checked-in COLR/CPAL
 *    colour font, 212 glyphs) AND in the ordinary monospace fonts a page
 *    falls back to. The first is a hard requirement on this page: a glyph
 *    outside the atlas LATCHES THE WHOLE SCENE to the span encoder for the
 *    rest of the frame (AGENTS.md's `colorEncoding` clause), so one exotic
 *    marker would quietly cost the entire map its zero-span rendering. The
 *    second is why the ramp stops at U+25CF rather than reaching for U+2B24
 *    (BLACK LARGE CIRCLE): it is in the atlas but missing from most system
 *    monospace stacks, where it would render as tofu at a non-monospace
 *    advance and tear the grid.
 *
 * A layer may supply its own ramp, and the four rows on `/maps` do exactly
 * that where the mark carries an IDENTITY rather than a magnitude (a launch
 * pad is `▲`, a satellite is a star) — see `mapsLive.ts`.
 */
import type { CellGrid } from "glyphcss";
import { glyphMapForeignOwned, glyphMapSurfaceOccludes } from "./stroke";

/**
 * The default mark ramp, smallest ink first — see this file's header for why
 * these three characters and not others.
 */
export const GLYPH_MAP_POINT_RAMP: readonly string[] = ["·", "•", "●"];

/**
 * Sub-samples per cell AXIS used to measure how much of a cell the disc
 * covers, so 16 samples per cell.
 *
 * Coverage only has to pick one of a handful of ramp entries, so the question
 * is how finely the ANSWER is quantized, not how exact the integral is: with
 * a 3-entry ramp the boundaries sit at 1/3 and 2/3, and 16 samples resolve
 * those to ±1/16 of a cell's area — well under the difference between two
 * adjacent ramp steps. Exact analytic circle-rectangle area would be a page
 * of case work for a distinction no reader can see.
 */
export const GLYPH_MAP_POINT_COVERAGE_SAMPLES = 4;

/**
 * Coverage below which a cell is NOT inked at all.
 *
 * A disc's bounding box always includes corner cells the disc barely touches;
 * inking them would square off a mark that is supposed to read as round. An
 * eighth of a cell is the smallest sliver that still reads as part of the
 * mark rather than as a stray dot beside it.
 */
export const GLYPH_MAP_POINT_MIN_COVERAGE = 0.125;

/**
 * Largest disc radius, in cell rows, a mark may resolve to.
 *
 * Not a design limit but a BLAST RADIUS: `size` is computed from a feature's
 * own property (`sizeProperty * sizeScale`), and a source that ships a
 * population column where a magnitude was expected would otherwise ask this
 * to walk a bounding box the size of the viewport, per feature. Eight rows is
 * already an enormous mark — a sixth of a 63-row frame — so nothing legitimate
 * is clipped by it.
 */
export const GLYPH_MAP_POINT_MAX_SIZE_ROWS = 8;

/** One cell of a stamped mark: an offset from the mark's own cell, and the glyph its coverage picked. */
export interface GlyphMapPointCell {
  readonly col: number;
  readonly row: number;
  readonly glyph: string;
  /** Fraction of this cell the disc covers, `0..1` — exposed so a test can assert the ramp mapping without re-deriving it. */
  readonly coverage: number;
}

/**
 * The cells a disc of radius `size` centred on the fractional grid position
 * `(col, row)` covers, each with the ramp glyph its own coverage picks.
 *
 * `size` is in cell ROWS. Columns are stretched by `cellAspect` (a cell is
 * `cellAspect` times taller than it is wide, so a disc that is `size` rows
 * tall is `size * cellAspect` columns wide) — without that a "circle" on a
 * 2:1 character grid renders as a vertical ellipse.
 *
 * **`size <= 0` is exactly ONE cell carrying the ramp's LARGEST glyph**, and
 * that is the documented default rather than a degenerate case: a point layer
 * whose features carry no magnitude at all (a launch pad, a satellite) wants
 * one crisp mark per feature, and letting the disc rule answer that would
 * spread a fixed mark over two cells whenever it happened to straddle a
 * column boundary — two stars where the data has one satellite.
 */
export function glyphMapPointCells(
  col: number,
  row: number,
  size: number,
  cellAspect: number,
  ramp: readonly string[] = GLYPH_MAP_POINT_RAMP,
): readonly GlyphMapPointCell[] {
  const glyphs = ramp.length > 0 ? ramp : GLYPH_MAP_POINT_RAMP;
  const largest = glyphs[glyphs.length - 1]!;
  if (!Number.isFinite(col) || !Number.isFinite(row)) return [];
  if (!(size > 0)) return [{ col: Math.floor(col), row: Math.floor(row), glyph: largest, coverage: 1 }];
  const r = Math.min(size, GLYPH_MAP_POINT_MAX_SIZE_ROWS);
  const rCol = r * (cellAspect > 0 ? cellAspect : 1);
  const c0 = Math.floor(col - rCol);
  const c1 = Math.floor(col + rCol);
  const r0 = Math.floor(row - r);
  const r1 = Math.floor(row + r);
  const n = GLYPH_MAP_POINT_COVERAGE_SAMPLES;
  const out: GlyphMapPointCell[] = [];
  for (let cr = r0; cr <= r1; cr++) {
    for (let cc = c0; cc <= c1; cc++) {
      let hit = 0;
      for (let sy = 0; sy < n; sy++) {
        const dy = (cr + (sy + 0.5) / n - row) / r;
        for (let sx = 0; sx < n; sx++) {
          const dx = (cc + (sx + 0.5) / n - col) / rCol;
          if (dx * dx + dy * dy <= 1) hit++;
        }
      }
      const coverage = hit / (n * n);
      if (coverage < GLYPH_MAP_POINT_MIN_COVERAGE) continue;
      const step = Math.min(glyphs.length - 1, Math.floor(coverage * glyphs.length));
      out.push({ col: cc, row: cr, glyph: glyphs[step]!, coverage });
    }
  }
  // A disc small enough that no cell clears the floor is still a feature that
  // exists, and dropping it would make a layer's smallest class invisible
  // rather than small. The centre cell takes the ramp's SMALLEST entry, which
  // is what "as small as this grid can draw" means.
  if (out.length === 0) out.push({ col: Math.floor(col), row: Math.floor(row), glyph: glyphs[0]!, coverage: 0 });
  return out;
}

/**
 * Characters a NFD decomposition cannot reduce, and what they read as on a
 * character grid.
 *
 * Everything with a combining form (`é`, `î`, `ā`, `ü`) is handled by the
 * decomposition itself; this table is the residue that has no decomposition
 * at all — a stroked or ligatured letter, and the typographic punctuation a
 * feed's own copy uses.
 */
const GLYPH_MAP_LABEL_SUBSTITUTIONS: Readonly<Record<string, string>> = {
  " ": " ",
  "‘": "'", "’": "'", "‚": "'", "‛": "'",
  "“": '"', "”": '"', "«": '"', "»": '"',
  "–": "-", "—": "-", "―": "-", "−": "-",
  "…": "...",
  "×": "x", "÷": "/",
  "ß": "ss", "æ": "ae", "Æ": "AE", "œ": "oe", "Œ": "OE",
  "ø": "o", "Ø": "O", "đ": "d", "Đ": "D",
  "ł": "l", "Ł": "L", "ð": "d", "Ð": "D",
  "þ": "th", "Þ": "Th",
};

/**
 * One label reduced to the characters a stamped grid can actually carry:
 * printable ASCII, with accents folded and typographic punctuation
 * substituted.
 *
 * **This is not a style choice, it is what keeps the page's rendering
 * mode.** `/maps` renders with `colorEncoding: "atlas"`, and glyphcss LATCHES
 * THE WHOLE SCENE back to the span encoder for any frame containing a glyph
 * the 212-glyph colour font does not carry (AGENTS.md's `colorEncoding`
 * clause). Real place names carry exactly such glyphs: measured on the
 * vendored USGS week, 385 event titles contain `î`, `é`, `ā`, `ü`, `í`, `ó`,
 * `ū`, `á` and a right single quote — 25 characters in all, none of them in
 * the atlas, and ONE of them anywhere on screen is enough to cost the entire
 * map its zero-span rendering, silently, for as long as that label is drawn.
 *
 * It is applied unconditionally rather than only when the scene is on the
 * atlas, because nothing here can know: the encoder a frame ends up on is
 * decided by that frame's own glyphs, i.e. after this text is already in the
 * grid. Given the choice between a stripped diacritic and a scene-wide silent
 * downgrade, the diacritic goes. It is also what a monospace grid does to
 * text anyway — the `"dense"` ramp is printable-ASCII-only for the same
 * family of reasons.
 *
 * A label with nothing left (a wholly non-Latin script) returns the empty
 * string, and the caller draws no label. That is the honest answer: this
 * atlas cannot write those scripts, and a row of substitution boxes would be
 * worse than a name the reader looks up elsewhere.
 */
export function glyphMapAsciiLabel(label: string): string {
  let out = "";
  for (const ch of label.normalize("NFD").replace(/\p{M}+/gu, "")) {
    const substitute = GLYPH_MAP_LABEL_SUBSTITUTIONS[ch];
    if (substitute !== undefined) { out += substitute; continue; }
    if (ch >= " " && ch <= "~") out += ch;
  }
  return out.trim();
}

export interface GlyphMapPointStampOptions {
  readonly color?: string;
  /** Cell aspect of the grid being stamped (`cellHeight / cellWidth`) — see {@link glyphMapPointCells}. */
  readonly cellAspect?: number;
  /** Ordered mark ramp, least ink first. Defaults to {@link GLYPH_MAP_POINT_RAMP}. */
  readonly ramp?: readonly string[];
  /** Extra FLAT depth allowance in world depth units, on top of the terrain's own faceting. Default `0` — a marker planted on the ground is coplanar with it. */
  readonly depthBias?: number;
  /** Overrides `stroke.ts`'s `GLYPH_MAP_STROKE_DEPTH_CURVATURE_SCALE`. */
  readonly depthCurvatureScale?: number;
}

/** One point mark, already projected into the grid being stamped. */
export interface GlyphMapPointMark {
  readonly col: number;
  readonly row: number;
  /** `project()[3] ?? project()[2]` at the mark — `stroke.ts`'s pinned depth metric. */
  readonly depth: number;
  /** Disc radius in cell ROWS; `0` (the default) is exactly one cell. See {@link glyphMapPointCells}. */
  readonly size?: number;
}

/**
 * Stamp one mark, depth-tested cell by cell.
 *
 * PER CELL and not per mark, deliberately: a mark large enough to span
 * several cells can straddle a ridge, and the half behind it must go dark
 * exactly as a stroke crossing the same ridge does. The verdict is
 * {@link glyphMapSurfaceOccludes} — the SAME test a draped stroke takes, at
 * each cell's own sub-cell position, so a mark planted on the terrain is
 * coplanar with it to within that terrain's own faceting and neither
 * z-fights nor floats.
 *
 * Returns the number of cells actually inked, which is `0` for a mark wholly
 * behind the surface — that count IS the visibility answer, and the widget
 * uses it to decide whether the feature is clickable and whether its label is
 * drawn.
 */
export function stampGlyphMapPoint(grid: CellGrid, mark: GlyphMapPointMark, opts: GlyphMapPointStampOptions = {}): number {
  if (!Number.isFinite(mark.col) || !Number.isFinite(mark.row) || !Number.isFinite(mark.depth)) return 0;
  const color = opts.color ?? null;
  const bias = opts.depthBias ?? 0;
  const curvatureScale = opts.depthCurvatureScale;
  const cells = glyphMapPointCells(mark.col, mark.row, mark.size ?? 0, opts.cellAspect ?? 2, opts.ramp);
  let inked = 0;
  for (const cell of cells) {
    if (cell.col < 0 || cell.col >= grid.cols || cell.row < 0 || cell.row >= grid.rows) continue;
    const idx = cell.row * grid.cols + cell.col;
    if (glyphMapForeignOwned(grid, idx)) continue;
    // The mark's own sub-cell position, used for EVERY cell of the mark: the
    // depth being compared is the mark's single projected depth, so the point
    // the surface must be evaluated at is where the mark IS, not where each
    // covered cell's own centre happens to fall.
    const subCol = mark.col - Math.floor(mark.col);
    const subRow = mark.row - Math.floor(mark.row);
    if (glyphMapSurfaceOccludes(grid, cell.col, cell.row, subCol, subRow, mark.depth, bias, curvatureScale ?? 0.25)) continue;
    grid.char[idx] = cell.glyph;
    grid.color[idx] = color;
    grid.depth[idx] = mark.depth;
    inked++;
  }
  return inked;
}

/**
 * Stamp one already-placed label into the grid, one character per cell.
 *
 * The label is NOT depth-tested per character, and that is the design rather
 * than an omission: a label is an annotation of a feature, so the question
 * "is this readable here" has exactly one honest answer and it is the
 * FEATURE's — the caller stamps a label only for a mark that inked at least
 * one cell (see {@link stampGlyphMapPoint}'s return). Testing each character
 * instead would let a name half-vanish into a hillside it is not describing,
 * which is illegible rather than informative.
 *
 * Cross-`<pre>` ownership is still honoured per cell: a cell another output
 * layer owns is skipped, because writing it would paint over a layer that is
 * about to paint it itself.
 *
 * Returns the number of cells inked.
 */
export function stampGlyphMapPointLabel(
  grid: CellGrid,
  lines: readonly string[],
  col: number,
  row: number,
  depth: number,
  color?: string,
): number {
  let inked = 0;
  for (let li = 0; li < lines.length; li++) {
    const line = lines[li]!;
    const r = Math.round(row) + li;
    if (r < 0 || r >= grid.rows) continue;
    // Centred on the anchor column, which is what the declutter arbiter
    // reserved: it measures the box as the longest line wide, placed on the
    // candidate's own col/row.
    const start = Math.round(col - line.length / 2);
    for (let i = 0; i < line.length; i++) {
      const c = start + i;
      if (c < 0 || c >= grid.cols) continue;
      const idx = r * grid.cols + c;
      if (glyphMapForeignOwned(grid, idx)) continue;
      const ch = line[i]!;
      if (ch === " ") continue; // a space is transparent, not a blank stamped over the terrain
      grid.char[idx] = ch;
      grid.color[idx] = color ?? null;
      grid.depth[idx] = depth;
      inked++;
    }
  }
  return inked;
}
