/**
 * Post-raster stroke stamping into a rasterized `CellGrid` — the mechanism
 * `line` and `contour` layers share (MAPS.md §13 slice 5). Both stamp
 * ordinary oriented-ink glyphs (`inkGlyphForTangent`, exported from
 * `glyphcss` as of this slice — it existed internally but `index.ts` never
 * re-exported it) into the SAME grid a scene's `transformCells` hook
 * receives, after normal geometry rasterization and depth testing but
 * before the grid is stringified — so a border/contour composites with
 * whatever terrain/mesh geometry already won each cell, at zero extra
 * writes (AGENTS.md's "each render cycle writes each `<pre>` exactly
 * once" is untouched: this only runs inside the existing hook).
 *
 * **glyphcss decision, per MAPS.md §13 slice 5's prompt to pick one and say
 * why**: `@glyphcss/maps`'s widget (`widget.ts`) already owns a real
 * `createGlyphScene` instance, and that scene's `transformCells` option is
 * already exported and already mutable via `setOptions` — so line/contour
 * layers compose directly onto it (`widget.ts`'s `updateStrokeLayers`)
 * rather than adding a SECOND mechanism through `compileScene`.
 * `compileScene` is `@glyphcss/maps`'s Tier-1 static-bake analog
 * (`compile.ts`'s `compileGlyphMap`) has no 3D scene/camera concept at all
 * — it bakes classified raster BANDS straight to a flat ASCII grid, so
 * there is no existing static "compile a projected map scene" path for
 * line/contour to hook into in this slice; `buildRasterizeContext`/
 * `rasterize`/`encodeStaticGlyphHtml` stay available (already exported) for
 * a FUTURE static-map tier, but nothing in slice 5 needs them today.
 *
 * **The depth contract, pinned** (MAPS.md's explicit trap): `CellGrid.depth`
 * holds `(p[3] ?? p[2]) * biasScale` from whatever camera rendered the base
 * geometry — under `createGlyphOrthographicCamera` (the ONLY camera this
 * widget ever constructs — see `widget.ts`) that is `project()[2]` (cssZ);
 * `project()[3]` only exists on a PERSPECTIVE camera's return tuple. Larger
 * is nearer, in both conventions, so `project()[3] ?? project()[2]` against
 * a stroke vertex is the general form that stays correct if this widget
 * ever grows a perspective mode, even though it always resolves to index 2
 * today.
 *
 * **Two allowances, and only one of them is a bias.**
 *
 * 1. SLOPE-SCALED, reusing the exact rationale (and the exact constant)
 *    AGENTS.md's wireframe `hiddenLines: "hide"` pins: "a FLAT bias
 *    regresses every convex mesh at every magnitude tried... a smooth
 *    surface's own silhouette needs an allowance proportional to the local
 *    depth gradient, not a constant one." A stroke lying flush on the
 *    surface reads the same depth as it on a flat cell, but proportionally
 *    MORE on a steep one (a mountain flank foreshortens a lot of
 *    world-space depth range into one screen cell). This is the real
 *    discretization allowance and it is measured from the grid itself, so
 *    it is scale-free.
 *
 * 2. GROUND OFFSET ({@link GlyphMapStrokeVertex.groundDepth}), which is not
 *    a bias at all but a stated geometric fact: a `line` layer's vertices
 *    are projected at ELEVATION ZERO (`widget.ts`'s `createLineLayerRuntime`
 *    — a road or a border carries no elevation), while the terrain it is
 *    meant to lie on stands at the real ground elevation. A sea-level
 *    stroke under 400 m of ground is 400 m of world depth behind that
 *    ground and every depth test rightly calls it occluded. The caller
 *    therefore passes the depth the SAME lon/lat reaches at the ground
 *    elevation under it, and the difference is allowed for explicitly.
 *
 * This replaces a flat `0.03` world-unit constant, which was the same
 * allowance stated as a guess: at `/maps`' default 24x exaggeration `0.03`
 * earth radii is ~7,960 m of terrain — Earth's own relief, spent on every
 * stroke everywhere, whether or not there was any terrain under it.
 * Measured consequence, the reported defect: at a tilted city view a 60 m
 * OSM building stands 1.17e-5 world units in front of a road crossing under
 * it, against an allowance of 0.03 — 2,570x too generous, so nothing a city
 * contains could ever occlude a stroke. With the allowance derived from the
 * ground instead, a map with no terrain mounted allows nothing beyond the
 * slope term and the building occludes the road; a map with terrain allows
 * exactly the ground under each vertex and a border still draws over a
 * 4 km ridge.
 */
import { inkGlyphForTangent } from "glyphcss";
import type { CellGrid } from "glyphcss";

/** Same pinned constant as AGENTS.md's wireframe `hiddenLines: "hide"` slope-scaled bias (glyphcss `render/rasterize.ts`) — the identical class of problem (a stroke's own depth vs. a solid surface's depth, both subject to discretization noise proportional to local slope). */
export const GLYPH_MAP_STROKE_DEPTH_SLOPE_SCALE = 0.5;

/**
 * Multiplier on the ground offset ({@link GlyphMapStrokeVertex.groundDepth}).
 *
 * The offset is measured straight up: how much nearer the camera the SAME
 * lon/lat is at the ground elevation than at sea level. Under a tilt the
 * surface a cell actually shows is not the point directly above the stroke
 * — the view ray meets the raised ground at a horizontal offset of
 * `h·tan(t)` as well, which adds `h·sin(t)·tan(t)` of depth on top of the
 * `h·cos(t)` the lift itself contributes. Those sum to exactly `h / cos(t)`,
 * so the true offset at pitch `t` is the vertical one divided by `cos(t)`.
 *
 * `2` is `1 / cos(60°)`. Measured on a globe at `/maps`' own default 40°
 * pitch the factor is 1.305 (gap 1.9535e-3 against a vertical offset of
 * 1.5069e-3 over 400 m of terrain at 24x), and the widget's controls reach
 * {@link GLYPH_MAP_MAX_TILT} = 85°, where `1/cos` is 11.5 — but that limit
 * is the wrong thing to size against: at a grazing pitch the ground between
 * the camera and a sea-level stroke genuinely stands in front of it, and
 * hiding the stroke there is the correct answer, not a defect to pad away.
 * `2` covers every pitch up to 60° exactly and degrades past it into real
 * terrain occlusion.
 */
export const GLYPH_MAP_STROKE_GROUND_MARGIN = 2;

export interface GlyphMapStrokeVertex {
  readonly col: number;
  readonly row: number;
  /** `project()[3] ?? project()[2]` at this vertex — see this file's depth-contract doc. */
  readonly depth: number;
  /**
   * The same metric for this vertex's own lon/lat taken at the GROUND
   * elevation under it, when the caller can answer for it. Omitted (or
   * equal to {@link depth}) means "no ground offset here" — no terrain is
   * mounted, or the stroke is already at ground level — and leaves the
   * depth test with only the slope term, which is what lets a building
   * occlude a road. See this file's "Two allowances" doc.
   */
  readonly groundDepth?: number;
}

export interface GlyphMapStampOptions {
  readonly color?: string;
  /** Extra FLAT depth allowance, in world depth units. Default `0` — the ground offset carried per vertex is what a map's strokes actually need, and a flat constant cannot be right at two zoom levels at once. */
  readonly depthBias?: number;
  readonly depthSlopeScale?: number;
  /** Multiplier on the per-vertex ground offset. Default {@link GLYPH_MAP_STROKE_GROUND_MARGIN}. */
  readonly groundMargin?: number;
}

/** Local screen-space depth gradient of the SURFACE already in `grid` at cell `idx` — the finite-difference probe the slope-scaled bias reads, using whichever horizontal/vertical neighbor is available (an edge cell falls back to the one-sided difference). */
function surfaceDepthGradient(grid: CellGrid, col: number, row: number): number {
  const idx = row * grid.cols + col;
  const d = grid.depth[idx];
  if (!Number.isFinite(d)) return 0;
  const left = col > 0 ? grid.depth[idx - 1] : NaN;
  const right = col < grid.cols - 1 ? grid.depth[idx + 1] : NaN;
  const up = row > 0 ? grid.depth[idx - grid.cols] : NaN;
  const down = row < grid.rows - 1 ? grid.depth[idx + grid.cols] : NaN;
  let gx = 0;
  if (Number.isFinite(left) && Number.isFinite(right)) gx = (right - left) / 2;
  else if (Number.isFinite(right)) gx = right - d;
  else if (Number.isFinite(left)) gx = d - left;
  let gy = 0;
  if (Number.isFinite(up) && Number.isFinite(down)) gy = (down - up) / 2;
  else if (Number.isFinite(down)) gy = down - d;
  else if (Number.isFinite(up)) gy = d - up;
  return Math.hypot(gx, gy);
}

/**
 * Stamp one already-projected polyline (screen col/row + the pinned depth
 * metric per vertex) into `grid`. Walks each segment at roughly one sample
 * per output cell, computing the LOCAL TANGENT from the segment's own
 * endpoints — never from a synthetic "this is where the line starts/ends"
 * special case, which is what keeps a tile-clipped cut end visually
 * indistinguishable from an interior point (MAPS.md's cross-tile-seam
 * requirement: the tangent must come from the geometry, not from the
 * segment happening to end there).
 *
 * A cell whose existing `grid.depth` is nearer than the stroke (by more
 * than the slope-scaled allowance) is left untouched — the terrain (or any
 * nearer mesh) occludes the line there, exactly like a normal solid-mode
 * depth test.
 */
export function stampGlyphMapPolyline(
  grid: CellGrid,
  points: readonly GlyphMapStrokeVertex[],
  opts: GlyphMapStampOptions = {},
): void {
  const color = opts.color ?? null;
  const bias = opts.depthBias ?? 0;
  const slopeScale = opts.depthSlopeScale ?? GLYPH_MAP_STROKE_DEPTH_SLOPE_SCALE;
  const groundMargin = opts.groundMargin ?? GLYPH_MAP_STROKE_GROUND_MARGIN;

  for (let s = 0; s < points.length - 1; s++) {
    const a = points[s];
    const b = points[s + 1];
    if (!Number.isFinite(a.col) || !Number.isFinite(a.row) || !Number.isFinite(b.col) || !Number.isFinite(b.row)) continue;
    const dCol = b.col - a.col;
    const dRow = b.row - a.row;
    const cells = Math.max(1, Math.ceil(Math.hypot(dCol, dRow)));
    for (let i = 0; i <= cells; i++) {
      const t = i / cells;
      const col = a.col + dCol * t;
      const row = a.row + dRow * t;
      const colI = Math.floor(col);
      const rowI = Math.floor(row);
      if (colI < 0 || colI >= grid.cols || rowI < 0 || rowI >= grid.rows) continue;
      const idx = rowI * grid.cols + colI;
      const depth = a.depth + (b.depth - a.depth) * t;
      const surfaceDepth = grid.depth[idx];
      if (Number.isFinite(surfaceDepth)) {
        // Interpolated exactly like `depth`, from the same two endpoints, so
        // the allowance follows the ground along the segment instead of
        // stepping at vertices.
        const groundA = a.groundDepth ?? a.depth;
        const groundB = b.groundDepth ?? b.depth;
        const groundDepth = groundA + (groundB - groundA) * t;
        const groundOffset = groundDepth > depth ? (groundDepth - depth) * groundMargin : 0;
        const allowed = bias + groundOffset + slopeScale * surfaceDepthGradient(grid, colI, rowI);
        if (surfaceDepth - depth > allowed) continue; // occluded by nearer geometry
      }
      const subCol = col - colI;
      const subRow = row - rowI;
      grid.char[idx] = inkGlyphForTangent(dCol, dRow, subRow, subCol);
      grid.color[idx] = color;
      grid.depth[idx] = depth;
    }
  }
}

// ── Contour (isoline) layers ───────────────────────────────────────────

export interface GlyphMapContourOptions {
  readonly levels: readonly number[];
  readonly color?: string;
  /**
   * Gate empty (`grid.depth` non-finite) cells by requiring surface
   * coverage there — the correct behavior when SOME other layer paints
   * the base grid (don't ink over open sky/space past the map's own
   * silhouette). When the scene has NO opaque base layer at all (the
   * terrain/raster layer is hidden), every cell reads non-finite depth
   * UNIFORMLY, and that same gate would blank the contour entirely —
   * indistinguishable, from inside this per-cell function, from "this cell
   * is legitimately off the map." The caller (widget.ts) resolves that
   * ambiguity with scene-level knowledge (is any raster layer mounted?)
   * and passes the answer in; default `true` preserves the original
   * surface-gated behavior for a direct caller that doesn't set it.
   */
  readonly requireSurface?: boolean;
  /**
   * Elevation WINDOW (same unit as `elevationAt`, metres for every
   * `GlyphMapContourLayer` source in this package): a cell whose OWN
   * elevation falls outside `[minElevation, maxElevation]` never inks, even
   * when a level legitimately crosses between it and a neighbour. Defaults
   * (`-Infinity`/`Infinity`) leave the output byte-identical.
   *
   * Filtering the LEVEL list to the window is not sufficient on its own,
   * which is why this gate exists at all: the crossing scan below reads a
   * cell's RIGHT and DOWN neighbours, so on a sea cliff — one cell at
   * -5,000 m, the next at +2,000 m — a 1,000 m level crosses BETWEEN them
   * and the ink lands on the ocean cell, 5 km below a `minElevation: 0`
   * floor.
   *
   * The gate is on the cell's own value, so a level lying exactly ON the
   * floor (a `{ interval: 500 }` list's own `0` under `minElevation: 0`)
   * inks only where the crossing is detected from the in-window side. That
   * is the "no ink below the floor" guarantee seen at its own boundary, not
   * a separate rule — widening it would mean inking a cell the caller
   * excluded.
   */
  readonly minElevation?: number;
  readonly maxElevation?: number;
  /**
   * Opt into elevation LABELS. Omitted (the default) is byte-identical to
   * before this option existed: no extra buffer is allocated, no extra pass
   * runs, and {@link stampGlyphMapContour} returns `null`.
   */
  readonly labels?: GlyphMapContourLabelOptions;
}

// ── Contour labels ─────────────────────────────────────────────────────

/**
 * What real topographic maps do, and what survives the translation to a
 * monospace character grid.
 *
 * KEPT — INDEX CONTOURS. USGS US Topo and every paper convention label only
 * every Nth line (canonically every 5th, drawn heavier), so the reader gets
 * an elevation anchor without the sheet turning into a page of numbers. The
 * caller resolves that subset and passes it in as {@link levels}; nothing
 * here decides which lines are index lines.
 *
 * KEPT — THE LABEL BREAKS THE LINE. ArcGIS's own contour-labelling guidance
 * is "break lines under text" / use label masks; USGS prints the number in a
 * gap in the contour. {@link stampGlyphMapContourLabels} restores the cells
 * its own line inked back to the terrain glyph underneath, on both sides of
 * the number, rather than painting a number on top of a line.
 *
 * KEPT — CHOSEN PLACEMENT, NOT PERIODIC, AND REPEATED. Candidates are gated
 * on the contour being locally straight (a run of the SAME level across the
 * label's own width) and on how little OTHER contour ink the label would
 * destroy — the grid analogue of "gentle slope, widely spaced lines, away
 * from junctions". Repetition and crowd control both come from the caller's
 * greedy declutter with a padded box, so one long line carries several
 * labels spaced apart instead of one.
 *
 * DROPPED — ORIENTATION FOLLOWS THE LINE. A cell is one character; there is
 * no rotated text, so a label can only ever be a horizontal run of cells.
 * With it goes the "top of the number faces uphill" convention, which is
 * purely a property of rotated text.
 *
 * REPLACED, NOT INVERTED — the purpose behind that convention is kept by
 * SELECTING for it instead of rotating: a label is only offered where the
 * contour is locally NEAR-HORIZONTAL on screen
 * ({@link GLYPH_MAP_CONTOUR_LABEL_MIN_HORIZONTALITY}). This is ArcGIS's own
 * "Centered horizontal" contour placement style, which exists for exactly
 * this reason. The tempting inversion — place the label where the contour is
 * STEEP on screen, so a horizontal label crosses it in one cell — is wrong
 * here and measurably so: contour lines are locally parallel, so where one
 * line runs vertically its NEIGHBOURS are separated horizontally, and a
 * horizontal label ploughs through every one of them. Where the line runs
 * horizontally its neighbours are separated vertically, and the label
 * consumes only its own line's length — which is precisely what rotating the
 * text buys on paper.
 */
export interface GlyphMapContourLabelOptions {
  /**
   * The INDEX levels — only a cell inked by one of these is a label
   * candidate. Values must be the identical numbers passed in
   * {@link GlyphMapContourOptions.levels} (matched by value), so they are
   * already window-clipped by construction and a label can never name a
   * level outside the caller's elevation window.
   */
  readonly levels: readonly number[];
  /** `level → text`. Default is the rounded metre value, bare, as USGS prints it. */
  readonly format?: (level: number) => string;
}

export interface GlyphMapContourLabelCandidate {
  /** Anchor cell — the label's run is centred on this column, on this row. */
  readonly col: number;
  readonly row: number;
  readonly level: number;
  readonly text: string;
  /**
   * Declutter priority, deliberately QUANTIZED into
   * {@link GLYPH_MAP_CONTOUR_LABEL_SCORE_BUCKETS} + 1 buckets rather than
   * left continuous. A continuous score reshuffles the greedy order on a
   * sub-cell pan and makes labels swap places frame to frame; coarse buckets
   * leave most neighbouring candidates TIED, and a tie is broken by the
   * caller's input order — which is this array's row-major scan order, and
   * a row-major ordering is invariant under a uniform screen translation.
   * So a pan keeps picking the same geographic spot until it leaves the
   * view, which is the stability property that matters.
   */
  readonly priority: number;
}

export interface GlyphMapContourLabelPlan {
  /** Every offered placement, row-major. The caller declutters this and hands the survivors back to {@link stampGlyphMapContourLabels}. */
  readonly candidates: readonly GlyphMapContourLabelCandidate[];
  /** Per cell, the level THIS pass inked it with; `NaN` for a cell this pass did not ink. */
  readonly levelAt: Float64Array;
  /** Per inked cell, the char/color that were there BEFORE this pass overwrote them — the restore source that lets a label break its own line without punching a hole in the terrain. */
  readonly restore: ReadonlyMap<number, { readonly char: string; readonly color: string | null }>;
}

/**
 * `|gy| / |∇elev|` — 1 when the contour runs exactly horizontally on screen,
 * 0 when it runs exactly vertically. `0.77` is `cos(~40°)`: a label may lean
 * up to 40° off its own line before it starts eating the neighbouring
 * contours instead of its own.
 */
export const GLYPH_MAP_CONTOUR_LABEL_MIN_HORIZONTALITY = 0.77;
/** Fraction of the label's own columns that must carry the SAME level within ±1 row — the "locally straight" gate. */
export const GLYPH_MAP_CONTOUR_LABEL_MIN_SUPPORT = 0.75;
/** Cells kept clear on either side of the number, so the line visibly resumes rather than abutting a digit. */
export const GLYPH_MAP_CONTOUR_LABEL_GAP_CELLS = 1;
/** Priority quantization — see {@link GlyphMapContourLabelCandidate.priority}. */
export const GLYPH_MAP_CONTOUR_LABEL_SCORE_BUCKETS = 8;

const defaultContourLabelText = (level: number): string => String(Math.round(level));

function buildContourLabelCandidates(
  grid: CellGrid,
  elev: Float64Array,
  levelAt: Float64Array,
  horizontality: Float32Array,
  labels: GlyphMapContourLabelOptions,
): GlyphMapContourLabelCandidate[] {
  const cols = grid.cols;
  const rows = grid.rows;
  const indexLevels = new Set(labels.levels);
  if (indexLevels.size === 0) return [];
  const format = labels.format ?? defaultContourLabelText;
  const texts = new Map<number, string>();
  const out: GlyphMapContourLabelCandidate[] = [];

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const idx = row * cols + col;
      const level = levelAt[idx];
      if (!indexLevels.has(level)) continue;
      const hz = horizontality[idx];
      if (!(hz >= GLYPH_MAP_CONTOUR_LABEL_MIN_HORIZONTALITY)) continue;

      let text = texts.get(level);
      if (text === undefined) { text = format(level); texts.set(level, text); }
      const width = text.length;
      if (width === 0) continue;
      const start = col - (width >> 1);
      const left = start - GLYPH_MAP_CONTOUR_LABEL_GAP_CELLS;
      const right = start + width - 1 + GLYPH_MAP_CONTOUR_LABEL_GAP_CELLS;
      if (left < 0 || right >= cols) continue; // never against the map edge — the paper rule, and it also keeps the run in-grid

      // The whole run must sit over terrain the field actually answers for.
      // This is the one gate the globe needs: past the horizon `elevationAt`
      // reads NaN (the widget's `unproject` refuses a far-side cell), so a
      // label can neither be born on the far side nor straddle the limb.
      let covered = true;
      for (let c = left; c <= right && covered; c++) covered = Number.isFinite(elev[row * cols + c]);
      if (!covered) continue;

      let support = 0;
      let clutter = 0;
      for (let c = start; c < start + width; c++) {
        let sameLevel = false;
        for (let d = -1; d <= 1; d++) {
          const r = row + d;
          if (r < 0 || r >= rows) continue;
          const other = levelAt[r * cols + c];
          if (other === level) sameLevel = true;
          else if (Number.isFinite(other)) clutter++;
        }
        if (sameLevel) support++;
      }
      if (support < width * GLYPH_MAP_CONTOUR_LABEL_MIN_SUPPORT) continue;

      // Two cartographic preferences, folded into one score: lie along the
      // line (`hz`), and land where there is room — `clutter` counts the
      // cells of OTHER contours the number would destroy, which on a grid is
      // what "widely spaced lines, away from junctions" reduces to.
      const clean = 1 - Math.min(1, clutter / (width * 2));
      const score = 0.6 * hz + 0.4 * clean;
      out.push({ col, row, level, text, priority: Math.round(score * GLYPH_MAP_CONTOUR_LABEL_SCORE_BUCKETS) });
    }
  }
  return out;
}

/**
 * Paint the surviving labels, breaking each one's own line around it.
 *
 * The break restores cells to what the terrain had before the contour pass
 * overwrote them, and only cells THIS pass inked with THIS label's own level
 * — so a different contour crossing the label's footprint keeps its ink, and
 * a terrain cell the contour never touched is never blanked (blanking it
 * would punch a hole in the relief, not break a line). The ±1 row reach is
 * because a near-horizontal contour still wanders a row either side across
 * the label's width; without it the line would reappear immediately above
 * and below the number instead of stopping.
 */
export function stampGlyphMapContourLabels(
  grid: CellGrid,
  placements: readonly GlyphMapContourLabelCandidate[],
  plan: GlyphMapContourLabelPlan,
  color?: string,
): void {
  const cols = grid.cols;
  const rows = grid.rows;
  for (const placement of placements) {
    const width = placement.text.length;
    const start = placement.col - (width >> 1);
    const left = start - GLYPH_MAP_CONTOUR_LABEL_GAP_CELLS;
    const right = start + width - 1 + GLYPH_MAP_CONTOUR_LABEL_GAP_CELLS;
    if (left < 0 || right >= cols || placement.row < 0 || placement.row >= rows) continue;
    for (let r = Math.max(0, placement.row - 1); r <= Math.min(rows - 1, placement.row + 1); r++) {
      for (let c = left; c <= right; c++) {
        const idx = r * cols + c;
        if (plan.levelAt[idx] !== placement.level) continue;
        const previous = plan.restore.get(idx);
        if (!previous) continue;
        grid.char[idx] = previous.char;
        grid.color[idx] = previous.color;
      }
    }
    for (let i = 0; i < width; i++) {
      const idx = placement.row * cols + start + i;
      grid.char[idx] = placement.text[i];
      grid.color[idx] = color ?? null;
    }
  }
}

/**
 * Contour layers reuse field-synth's `subcellRes: "ink"` approach (AGENTS.md,
 * MAPS.md §13 slice 5): cut the elevation range into `levels`, ink a cell
 * where a level falls BETWEEN it and a neighbor (a sign change of
 * `value - level`), oriented perpendicular to the local gradient — exactly
 * the field-synth ink-contour rule, pointed at an elevation field instead
 * of a synth field.
 *
 * Unlike `stampGlyphMapPolyline`, this needs no depth test of its own: a
 * contour is an ANNOTATION of whatever surface already won each cell (the
 * caller's `elevationAt` is expected to answer only for cells that surface
 * actually covers — NaN elsewhere), not an independent 3D object that could
 * be nearer or farther than the terrain.
 *
 * Returns a {@link GlyphMapContourLabelPlan} when — and only when —
 * `opts.labels` asked for one; `null` otherwise, with nothing extra
 * allocated and no extra pass run, so the unlabelled render is byte-identical
 * to before labels existed. The caller declutters `plan.candidates` and hands
 * the survivors to {@link stampGlyphMapContourLabels}; splitting it there
 * rather than doing it here is what lets ONE declutter arbitrate a whole
 * map's labels instead of one per layer.
 */
export function stampGlyphMapContour(
  grid: CellGrid,
  elevationAt: (col: number, row: number) => number,
  opts: GlyphMapContourOptions,
): GlyphMapContourLabelPlan | null {
  const color = opts.color ?? null;
  const requireSurface = opts.requireSurface ?? true;
  const minElevation = opts.minElevation ?? -Infinity;
  const maxElevation = opts.maxElevation ?? Infinity;
  const cols = grid.cols;
  const rows = grid.rows;
  // `elevationAt` can be expensive (e.g. a per-cell camera-ray unprojection
  // for a globe projection) — skip a cell the base render doesn't cover
  // ONLY when a covered/uncovered distinction is actually meaningful
  // (requireSurface); with no base surface at all every cell reads
  // non-finite depth uniformly, so the gate would blank everything.
  const elev = new Float64Array(cols * rows).fill(NaN);
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const idx = row * cols + col;
      if (!requireSurface || Number.isFinite(grid.depth[idx])) elev[idx] = elevationAt(col, row);
    }
  }
  const at = (col: number, row: number): number => (col < 0 || col >= cols || row < 0 || row >= rows ? NaN : elev[row * cols + col]);

  const labels = opts.labels;
  const levelAt = labels ? new Float64Array(cols * rows).fill(NaN) : null;
  const horizontality = labels ? new Float32Array(cols * rows) : null;
  const restore = labels ? new Map<number, { readonly char: string; readonly color: string | null }>() : null;

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const idx = row * cols + col;
      if (requireSurface && !Number.isFinite(grid.depth[idx])) continue; // nothing rendered here — no surface to annotate
      const e = at(col, row);
      if (!Number.isFinite(e)) continue;
      // The elevation WINDOW gate — this cell's own value, deliberately
      // BEFORE the crossing scan and the gradient probe, both of which keep
      // reading the true neighbouring values (a clipped contour must still
      // be oriented by the real terrain, not by a masked one).
      if (e < minElevation || e > maxElevation) continue;
      const eRight = at(col + 1, row);
      const eLeft = at(col - 1, row);
      const eDown = at(col, row + 1);
      const eUp = at(col, row - 1);

      let crossed: number | null = null;
      for (const level of opts.levels) {
        if (Number.isFinite(eRight) && (e - level) * (eRight - level) <= 0) { crossed = level; break; }
        if (Number.isFinite(eDown) && (e - level) * (eDown - level) <= 0) { crossed = level; break; }
      }
      if (crossed === null) continue;

      // Centered difference where both neighbors exist; one-sided otherwise
      // — same fallback discipline as the surface-depth gradient probe above.
      let gx = 0;
      if (Number.isFinite(eLeft) && Number.isFinite(eRight)) gx = (eRight - eLeft) / 2;
      else if (Number.isFinite(eRight)) gx = eRight - e;
      else if (Number.isFinite(eLeft)) gx = e - eLeft;
      let gy = 0;
      if (Number.isFinite(eUp) && Number.isFinite(eDown)) gy = (eDown - eUp) / 2;
      else if (Number.isFinite(eDown)) gy = eDown - e;
      else if (Number.isFinite(eUp)) gy = e - eUp;

      if (gx === 0 && gy === 0) continue; // flat plateau at exactly the level — no defined orientation
      if (labels) {
        // Captured BEFORE the overwrite: a label's own gap restores the
        // terrain that was here, which is unrecoverable once the ink lands.
        restore!.set(idx, { char: grid.char[idx], color: grid.color[idx] });
        levelAt![idx] = crossed;
        // The contour's screen tangent is perpendicular to the gradient, so
        // a mostly-VERTICAL gradient is a mostly-HORIZONTAL line — which is
        // the one a horizontal label can lie along.
        horizontality![idx] = Math.abs(gy) / Math.hypot(gx, gy);
      }
      // Perpendicular to the gradient (rotate 90°) — `inkGlyphForTangent`
      // is direction-mod-180 already, so either rotation sign is equivalent.
      grid.char[idx] = inkGlyphForTangent(-gy, gx, 0.5, 0.5);
      grid.color[idx] = color;
    }
  }

  if (!labels) return null;
  return { candidates: buildContourLabelCandidates(grid, elev, levelAt!, horizontality!, labels), levelAt: levelAt!, restore: restore! };
}
