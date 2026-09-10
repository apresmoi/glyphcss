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
 * **The surface is RECONSTRUCTED at the stroke's own sub-cell position, and
 * only what that cannot explain is forgiven.**
 *
 * THREE different things separate a draped stroke's depth from the surface's,
 * and they want different treatments — one is corrected, one is bounded from
 * the depth buffer, and one can only be supplied by the caller that drapes:
 *
 * 1. A SAMPLING OFFSET, which is exactly computable and so is corrected
 *    rather than forgiven. `grid.depth[idx]` was sampled by the rasterizer
 *    at the cell CENTRE (`rasterize.ts`: `px = x + 0.5`); the stroke sits
 *    wherever inside that cell its own geometry puts it. On any tilted view
 *    a stroke lying flush on the surface therefore reads up to half a cell
 *    of depth away from it for no reason but that, so the surface's own
 *    local slope is used to evaluate it AT the stroke and the comparison is
 *    made there.
 * 2. FACETING, which is not computable from here and is what the allowance
 *    is for: the drape reads the terrain FIELD (bilinear over a tile's full
 *    vertex grid) while the terrain rasterizes from a COARSENED quad mesh
 *    whose chord cuts under every rise inside a quad. The two are
 *    near-coplanar, not coplanar.
 * 3. THE GROUND'S OWN RELIEF across the span this comparison reads from,
 *    which nothing here can see and which the caller supplies per vertex as
 *    {@link GlyphMapStrokeVertex.slack}. The two terms above are both
 *    statements about the DEPTH BUFFER; this one is a statement about the
 *    FIELD, and at a world view it is the largest of the three by an order of
 *    magnitude — one output cell is 0.12 degrees there, i.e. ~13 km of real
 *    relief. Absent, it is zero and this stamp is byte for byte what it was.
 *
 * The third term is why a `line` is stamped per CELL rather than per source
 * vertex: this stamper walks a segment one sample per cell but interpolates
 * both position AND depth linearly between the vertices it is handed, so a
 * ruler-straight border with two vertices 600 km apart carries a depth chord
 * across every mountain in between. `widget.ts` drapes each inserted sample on
 * its own ground and reads the slack off those samples (`drapedRunPerCell`,
 * `GLYPH_MAP_STROKE_GROUND_SUPPORT_CELLS`).
 *
 * Faceting is a statement about the surface's ROUGHNESS, so the allowance
 * scales with the SECOND difference of the depth buffer and not the first. A
 * plane has none however steeply the camera foreshortens it, and that is the
 * whole difference: scaling on the slope granted a full half cell of depth
 * on flat ground under a tilt — measured on the vendored Zürich tile, one
 * row of a horizontal surface is 1.73e-6 of depth at 60 degrees (~12 m),
 * where a two-storey building stands only 1.06e-6 in front of the road
 * beside it — so the allowance swallowed the building whole and the road
 * drew straight through it. At `/maps`' own default 40 degree pitch every
 * building of 6 m or under was drawn through, cell for cell, and a 60 m one
 * was not: the height at which a real occluder became invisible was a
 * function of nothing but the camera's pitch
 * (`widget.strokeOcclusion.test.ts`).
 *
 * {@link GLYPH_MAP_STROKE_DEPTH_CURVATURE_SCALE} has a bound behind it
 * rather than a tuning: for a locally quadratic surface BOTH remaining
 * errors are one EIGHTH of the second difference — a linear reconstruction
 * evaluated at most half a cell away departs by `f''·(1/2)²/2`, and a
 * chord's greatest departure from a parabola through its own endpoints is
 * `f''·L²/8` — and `0.25` is that doubled, because real relief is not
 * quadratic and a three-point second difference is itself a noisy estimate
 * of its curvature.
 *
 * **Two allowances died here, and each one's premise is worth keeping
 * written down.** Both existed only because a `line` vertex used to be
 * projected at ELEVATION ZERO while the terrain it belongs on stood at the
 * real ground elevation:
 *
 * 1. A flat `0.03` world-unit constant — that offset guessed at. At
 *    `/maps`' default 24x exaggeration `0.03` earth radii is ~7,960 m of
 *    terrain, i.e. Earth's own relief spent on every stroke everywhere,
 *    whether or not there was any terrain under it. Measured consequence: at
 *    a tilted city view a 60 m OSM building stands 1.17e-5 world units in
 *    front of a road crossing under it, against an allowance 2,570x larger,
 *    so nothing a city contained could ever occlude a stroke.
 * 2. `GLYPH_MAP_STROKE_GROUND_MARGIN` — that same offset MEASURED, per
 *    vertex, by projecting each lon/lat a second time at the ground
 *    elevation under it and forgiving the difference. Correct about
 *    WHETHER a stroke was occluded, and silent about WHERE IT WAS DRAWN:
 *    the stroke still landed at the datum, 16 rows from its own ground at
 *    `/maps`' defaults over 10 m of terrain (2,000 rows over 400 m), so a
 *    road and the building standing beside it no longer coincided.
 *
 * `widget.ts` now hands the ground elevation to the PROJECTION instead
 * (`createLineLayerRuntime`'s drape), which is the same second projection
 * spent on the stroke's real position rather than on excusing its wrong one.
 * A draped stroke's own depth already IS the ground's depth, so there is
 * nothing left to forgive and no per-vertex offset to carry: what remains is
 * a surface and a curve lying on it, which is precisely the case the
 * reconstruction above was written for.
 */
import { inkGlyphForTangent } from "glyphcss";
import type { CellGrid } from "glyphcss";

/** How much of the surface's own local CURVATURE — the second difference of the depth buffer at a cell — a draped stroke may read behind it before that surface is taken to occlude it. See this file's doc for the eighth this doubles. */
export const GLYPH_MAP_STROKE_DEPTH_CURVATURE_SCALE = 0.25;

export interface GlyphMapStrokeVertex {
  readonly col: number;
  readonly row: number;
  /** `project()[3] ?? project()[2]` at this vertex — see this file's depth-contract doc. */
  readonly depth: number;
  /**
   * EXTRA depth allowance carried by this vertex, interpolated along each
   * segment exactly as {@link depth} is. Absent (or `0`) everywhere is byte
   * for byte the stamp without it, and every caller that hands this stamper
   * synthetic vertices — {@link stampGlyphMapContourGeometry} included — omits
   * it.
   *
   * It exists because the two OTHER terms here are both statements about the
   * DEPTH BUFFER (its half-cell sampling offset, corrected; its own second
   * difference, forgiven) and neither can see the quantity that actually
   * separates a DRAPED stroke from the terrain under it: the ground's own
   * relief across the span the comparison reads from. Only the caller that
   * drapes knows that — it holds the elevation field — so it is supplied per
   * vertex rather than derived here. See `widget.ts`'s
   * `GLYPH_MAP_STROKE_GROUND_SUPPORT_CELLS`.
   */
  readonly slack?: number;
}

export interface GlyphMapStampOptions {
  readonly color?: string;
  /** Extra FLAT depth allowance, in world depth units. Default `0` — a draped stroke lies on the surface, and a flat constant cannot be right at two zoom levels at once anyway (see this file's doc for the 0.03 that was). */
  readonly depthBias?: number;
  /** Overrides {@link GLYPH_MAP_STROKE_DEPTH_CURVATURE_SCALE}. */
  readonly depthCurvatureScale?: number;
  /**
   * Skip a cell the base render left EMPTY (`grid.depth` non-finite) instead
   * of drawing through it. Default `false`, which is the `line` rule — no
   * base surface there means nothing to be occluded by.
   *
   * A `contour` sets it: a contour is an ANNOTATION of whatever surface won
   * each cell, so past the map's own silhouette (open sky, the far side of a
   * globe) there is nothing to annotate. The caller decides, because from in
   * here an empty cell is indistinguishable from a scene with no opaque base
   * layer mounted at all — see {@link GlyphMapContourOptions.requireSurface}.
   */
  readonly requireSurface?: boolean;
  /**
   * Called once for every cell this stamp actually inks, BEFORE the write, with
   * that cell's index, what was there, and the segment's own screen tangent.
   *
   * It exists so a contour's LABEL pass can be built out of the ordinary
   * stroke path rather than a second one: the label plan needs the level each
   * cell was inked with, the terrain glyph underneath it (a label breaks its
   * own line by restoring that), and how horizontal the line runs there. All
   * three are known here and nowhere else, since only this loop knows which
   * cells survived the depth test.
   */
  readonly onInk?: (idx: number, previousChar: string, previousColor: string | null, tangentCol: number, tangentRow: number) => void;
}

/**
 * One axis of the surface's own screen-space depth slope at a cell, SIGNED
 * and in depth units per cell — the ordinary central difference, falling back
 * to whichever one-sided difference exists at an edge or beside an empty
 * cell.
 *
 * This is no longer what the ALLOWANCE is built on (see {@link curvature});
 * it is what evaluates the surface AT the stroke's own sub-cell position, so
 * that the half cell between there and the cell centre `grid.depth` was
 * sampled at is corrected rather than forgiven.
 */
function surfaceSlope(d: number, back: number, forward: number): number {
  if (Number.isFinite(back) && Number.isFinite(forward)) return (forward - back) / 2;
  if (Number.isFinite(forward)) return forward - d;
  if (Number.isFinite(back)) return d - back;
  return 0;
}

/**
 * One axis of the surface's own SECOND difference at a cell — how much its
 * two one-sided slopes disagree across it, in depth units per cell squared.
 *
 * This is what the allowance scales on, because the faceting it exists to
 * forgive is a property of the surface's ROUGHNESS and not of how steeply
 * the camera foreshortens it (see this file's doc). An edge cell has only
 * one side and so reports no curvature at all rather than half of one: it is
 * missing the evidence, and manufacturing an allowance out of a single
 * difference is exactly what the slope scaling used to do everywhere.
 */
/**
 * Whether this cell belongs to a DIFFERENT output layer than the grid being
 * stamped — glyphcss's cross-layer occlusion verdict, surfaced on
 * {@link CellGrid.occluded} because nothing else in the grid can express it
 * (a blanked cell is `" "` at `-Infinity`, byte for byte what open sky is).
 *
 * The depth test cannot answer this and never could: a grid's `depth` holds
 * only the geometry of the pass that produced it, so a mesh that separated
 * into its own `<pre>` — for a `density`, a private `renderMode`, a
 * `glyphPalette` — is simply ABSENT from the base grid's buffer, at every
 * allowance. That was the third "the roads are on top of the buildings"
 * report: with `omt-buildings` alone at `1.7` and every other OSM row at `1`,
 * all 23 cells of a road inside a 60 m footprint inked over base cells
 * reading `-Infinity`, unchanged across `781486f` and its parent — the
 * curvature allowance was never in the path.
 *
 * Skipping costs nothing: the composed hook stamps into EVERY grid the frame
 * renders, so the cell is drawn by the layer that owns it, against that
 * layer's own real depth. Undefined on every grid glyphcss rendered without a
 * shared id-map (no detail layer in the scene), where this is byte-identical
 * to the test not existing.
 */
export function glyphMapForeignOwned(grid: CellGrid, idx: number): boolean {
  return grid.occluded !== undefined && grid.occluded[idx] === 1;
}

function curvature(d: number, back: number, forward: number): number {
  const a = Number.isFinite(back) ? d - back : NaN;
  const b = Number.isFinite(forward) ? forward - d : NaN;
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
  return Math.abs(a - b);
}

/**
 * The ONE depth verdict every post-raster stamp in this package takes:
 * whether the surface already in `grid` at cell `idx` stands NEARER than
 * something being stamped at depth `depth`, at the stamp's own sub-cell
 * position `(subCol, subRow)`.
 *
 * Lifted out of {@link stampGlyphMapPolyline}'s inner loop verbatim — the
 * sampling-offset CORRECTION (evaluate the surface where the stamp actually
 * is, not at the cell centre `grid.depth` was sampled at) and the
 * second-difference ALLOWANCE (forgive the terrain's own faceting, never the
 * camera's foreshortening) are two different quantities and only the second
 * is an allowance. See this file's header.
 *
 * It is exported because a stamped POINT (`point.ts`) is the same problem: a
 * mark drawn at a lon/lat on the exaggerated relief is coplanar with the
 * terrain it stands on to within that terrain's own faceting, exactly as a
 * draped stroke is, and a second, independently-tuned test for it would be a
 * second answer to one question.
 *
 * `true` = occluded, leave the cell alone. A cell the base render left EMPTY
 * (`grid.depth` non-finite) is never occluded — there is no surface there to
 * be behind.
 */
export function glyphMapSurfaceOccludes(
  grid: CellGrid,
  colI: number,
  rowI: number,
  subCol: number,
  subRow: number,
  depth: number,
  allowance: number,
  curvatureScale: number,
): boolean {
  const idx = rowI * grid.cols + colI;
  const surfaceDepth = grid.depth[idx];
  if (!Number.isFinite(surfaceDepth)) return false;
  const gx = surfaceSlope(surfaceDepth, colI > 0 ? grid.depth[idx - 1] : NaN, colI < grid.cols - 1 ? grid.depth[idx + 1] : NaN);
  const gy = surfaceSlope(surfaceDepth, rowI > 0 ? grid.depth[idx - grid.cols] : NaN, rowI < grid.rows - 1 ? grid.depth[idx + grid.cols] : NaN);
  const atStroke = surfaceDepth + gx * (subCol - 0.5) + gy * (subRow - 0.5);
  const cx = curvature(surfaceDepth, colI > 0 ? grid.depth[idx - 1] : NaN, colI < grid.cols - 1 ? grid.depth[idx + 1] : NaN);
  const cy = curvature(surfaceDepth, rowI > 0 ? grid.depth[idx - grid.cols] : NaN, rowI < grid.rows - 1 ? grid.depth[idx + grid.cols] : NaN);
  return atStroke - depth > allowance + curvatureScale * Math.hypot(cx, cy);
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
 * A cell whose surface — reconstructed at the stroke's own sub-cell position
 * — is nearer than the stroke by more than the curvature-scaled allowance is
 * left untouched: the terrain (or any nearer mesh) occludes the line there,
 * exactly like a normal solid-mode depth test.
 */
export function stampGlyphMapPolyline(
  grid: CellGrid,
  points: readonly GlyphMapStrokeVertex[],
  opts: GlyphMapStampOptions = {},
): void {
  const color = opts.color ?? null;
  const bias = opts.depthBias ?? 0;
  const curvatureScale = opts.depthCurvatureScale ?? GLYPH_MAP_STROKE_DEPTH_CURVATURE_SCALE;
  const requireSurface = opts.requireSurface ?? false;
  const onInk = opts.onInk;

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
      if (glyphMapForeignOwned(grid, idx)) continue;
      const depth = a.depth + (b.depth - a.depth) * t;
      const subCol = col - colI;
      const subRow = row - rowI;
      const surfaceDepth = grid.depth[idx];
      if (requireSurface && !Number.isFinite(surfaceDepth)) continue; // nothing rendered here — no surface to annotate
      // Correct the sampling offset, then forgive only the faceting — two
      // different quantities, and only the second one is an allowance. See
      // `glyphMapSurfaceOccludes`, which is that loop body verbatim.
      const slack = (a.slack ?? 0) + ((b.slack ?? 0) - (a.slack ?? 0)) * t;
      if (glyphMapSurfaceOccludes(grid, colI, rowI, subCol, subRow, depth, bias + slack, curvatureScale)) continue;
      if (onInk) onInk(idx, grid.char[idx], grid.color[idx], dCol, dRow);
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
  /** Whether a cell sits over terrain the layer actually answers for — the one gate the globe horizon needs. See the call sites for what each path can prove. */
  covered: (idx: number) => boolean,
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
      let onTerrain = true;
      for (let c = left; c <= right && onTerrain; c++) onTerrain = covered(row * cols + c);
      if (!onTerrain) continue;

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
 * The PER-CELL contour primitive: cut the elevation range into `levels`, ink a
 * cell where a level falls BETWEEN it and a neighbor (a sign change of
 * `value - level`), oriented perpendicular to the local gradient — field
 * synth's `subcellRes: "ink"` rule pointed at an elevation field.
 *
 * **`@glyphcss/maps`' own `contour` LAYER no longer uses this.** A mounted
 * contour is real geometry at its own elevation
 * ({@link stampGlyphMapContourGeometry}), because answering "what elevation is
 * under this cell" needs `unproject`, and `unproject` inverts at elevation
 * ZERO — so under a tilt the answer describes the sea-level point beneath the
 * view ray rather than the terrain point actually drawn there. This stays
 * exported as the primitive for a caller who genuinely holds a SCREEN-SPACE
 * scalar field (one with no lon/lat domain to cut an isoline in), which is a
 * different input shape rather than a second way of doing the same thing; the
 * label plan and {@link stampGlyphMapContourLabels} are shared with the
 * geometry path.
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
  // This path holds a real per-cell elevation array, so "over terrain" is
  // literally "the field answered here" — past a globe's horizon `elevationAt`
  // reads NaN, so a label can neither be born on the far side nor straddle
  // the limb.
  return { candidates: buildContourLabelCandidates(grid, (idx) => Number.isFinite(elev[idx]), levelAt!, horizontality!, labels), levelAt: levelAt!, restore: restore! };
}

// ── Contour GEOMETRY (the mounted `contour` layer's path) ──────────────

/** One isoline, already projected: every vertex stands at `level`, so the whole run is at a single known height. */
export interface GlyphMapContourPolyline {
  readonly level: number;
  readonly points: readonly GlyphMapStrokeVertex[];
}

export interface GlyphMapContourGeometryOptions {
  readonly color?: string;
  /** @see GlyphMapStampOptions.requireSurface — default `true` here, the contour ANNOTATION rule. */
  readonly requireSurface?: boolean;
  readonly depthBias?: number;
  readonly depthCurvatureScale?: number;
  /** @see GlyphMapContourOptions.labels — omitted allocates nothing and returns `null`. */
  readonly labels?: GlyphMapContourLabelOptions;
  /**
   * Whether a cell sits over terrain this layer answers for — the globe's
   * HORIZON gate for label placement, and the one thing geometry cannot read
   * off the grid by itself.
   *
   * With a surface mounted the default is exact and free: after this pass a
   * cell's depth is finite exactly where the terrain drew or this contour
   * inked, and past the limb it is neither. With `requireSurface` false — the
   * "no raster layer mounted anywhere" degrade — every cell reads non-finite
   * uniformly and the grid has nothing left to say, so a caller that CAN
   * answer (the widget, which owns the projection and can ask `unproject`)
   * passes the answer in. Omitted there, no label is refused on horizon
   * grounds; the geometry is still clipped to the visible hemisphere, so only
   * a label's own padding could reach past it.
   */
  readonly covered?: (col: number, row: number) => boolean;
}

/**
 * Stamp contour lines that are REAL GEOMETRY — each one a polyline whose
 * vertices were projected at the level's own elevation
 * (`contourGeometry.ts`), so the line stands on the terrain it annotates
 * instead of at the datum under it and stays there at every tilt.
 *
 * This is deliberately NOT a second stamping path: every cell it inks is
 * inked by {@link stampGlyphMapPolyline}, so an elevated contour inherits the
 * `line` layer's depth test (the sub-cell surface reconstruction plus the
 * curvature-scaled faceting allowance), its cross-`<pre>` ownership skip, and
 * its no-endpoint-special-case tangent — all three of which a contour now
 * needs and the per-cell scan could not have: a contour with a height is an
 * object in the scene that a ridge in front of it must be able to hide.
 *
 * The label plan is accumulated through that stamp's own `onInk` hook rather
 * than rebuilt from the grid afterwards, because only the stamp knows which
 * cells survived the depth test. `restore` keeps the FIRST writer's glyph (the
 * terrain), while `levelAt` keeps the LAST (the level actually visible), which
 * is what lets a label break its own line without punching a hole in the
 * relief or erasing a contour crossing it.
 */
export function stampGlyphMapContourGeometry(
  grid: CellGrid,
  polylines: readonly GlyphMapContourPolyline[],
  opts: GlyphMapContourGeometryOptions = {},
): GlyphMapContourLabelPlan | null {
  const requireSurface = opts.requireSurface ?? true;
  const labels = opts.labels;
  const cells = grid.cols * grid.rows;
  const levelAt = labels ? new Float64Array(cells).fill(NaN) : null;
  const horizontality = labels ? new Float32Array(cells) : null;
  const restore = labels ? new Map<number, { readonly char: string; readonly color: string | null }>() : null;

  for (const line of polylines) {
    if (line.points.length < 2) continue;
    const level = line.level;
    stampGlyphMapPolyline(grid, line.points, {
      color: opts.color,
      requireSurface,
      depthBias: opts.depthBias,
      depthCurvatureScale: opts.depthCurvatureScale,
      onInk: labels
        ? (idx, previousChar, previousColor, dCol, dRow) => {
            if (!restore!.has(idx)) restore!.set(idx, { char: previousChar, color: previousColor });
            levelAt![idx] = level;
            const len = Math.hypot(dCol, dRow);
            // The stroke's own screen tangent: 1 when the line runs exactly
            // horizontally (the orientation a horizontal label can lie along),
            // 0 when it runs exactly vertically. The per-cell path derives the
            // same number from the elevation gradient, which is this tangent
            // rotated 90 degrees.
            horizontality![idx] = len > 0 ? Math.abs(dCol) / len : 0;
          }
        : undefined,
    });
  }

  if (!labels) return null;
  // With geometry there is no per-cell elevation array to read coverage off,
  // so the grid's own depth answers instead: after this pass a cell is finite
  // exactly where the terrain drew or this contour inked, which past a globe's
  // limb is neither. With `requireSurface` false — the "no raster layer
  // mounted anywhere" degrade — every cell reads non-finite uniformly and the
  // question is meaningless, so it is not asked; the geometry is already
  // clipped to the visible hemisphere by its caller, and the locally-straight
  // support gate still refuses a label whose run leaves its own line.
  const covered = opts.covered
    ? (idx: number) => opts.covered!(idx % grid.cols, (idx / grid.cols) | 0)
    : requireSurface
      ? (idx: number) => Number.isFinite(grid.depth[idx])
      : () => true;
  return { candidates: buildContourLabelCandidates(grid, covered, levelAt!, horizontality!, labels), levelAt: levelAt!, restore: restore! };
}
