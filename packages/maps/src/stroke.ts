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
 * **Slope-scaled bias, not a flat one** — reusing the exact rationale (and
 * the exact constants) AGENTS.md's wireframe `hiddenLines: "hide"` pins:
 * "a FLAT bias regresses every convex mesh at every magnitude tried... a
 * smooth surface's own silhouette needs an allowance proportional to the
 * local depth gradient, not a constant one." A border line usually sits
 * flush on the terrain surface, so its own depth and the surface's `grid.
 * depth` at that cell are the SAME value up to floating-point/quantization
 * noise on a flat cell, but proportionally MORE on a steep one (a mountain
 * flank foreshortens a lot of world-space depth range into one screen
 * cell) — a flat bias tuned for the flat case rejects real strokes on
 * slopes; one tuned for slopes swallows real occlusion on flat ground.
 */
import { inkGlyphForTangent } from "glyphcss";
import type { CellGrid } from "glyphcss";

/** Same pinned constants as AGENTS.md's wireframe `hiddenLines: "hide"` slope-scaled bias (glyphcss `render/rasterize.ts`) — the identical class of problem (a stroke's own depth vs. a solid surface's depth, both subject to discretization noise proportional to local slope). */
export const GLYPH_MAP_STROKE_DEPTH_BIAS = 0.03;
export const GLYPH_MAP_STROKE_DEPTH_SLOPE_SCALE = 0.5;

export interface GlyphMapStrokeVertex {
  readonly col: number;
  readonly row: number;
  /** `project()[3] ?? project()[2]` at this vertex — see this file's depth-contract doc. */
  readonly depth: number;
}

export interface GlyphMapStampOptions {
  readonly color?: string;
  readonly depthBias?: number;
  readonly depthSlopeScale?: number;
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
  const bias = opts.depthBias ?? GLYPH_MAP_STROKE_DEPTH_BIAS;
  const slopeScale = opts.depthSlopeScale ?? GLYPH_MAP_STROKE_DEPTH_SLOPE_SCALE;

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
        const allowed = bias + slopeScale * surfaceDepthGradient(grid, colI, rowI);
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
 */
export function stampGlyphMapContour(
  grid: CellGrid,
  elevationAt: (col: number, row: number) => number,
  opts: GlyphMapContourOptions,
): void {
  const color = opts.color ?? null;
  const requireSurface = opts.requireSurface ?? true;
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

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const idx = row * cols + col;
      if (requireSurface && !Number.isFinite(grid.depth[idx])) continue; // nothing rendered here — no surface to annotate
      const e = at(col, row);
      if (!Number.isFinite(e)) continue;
      const eRight = at(col + 1, row);
      const eLeft = at(col - 1, row);
      const eDown = at(col, row + 1);
      const eUp = at(col, row - 1);

      let crosses = false;
      for (const level of opts.levels) {
        if (Number.isFinite(eRight) && (e - level) * (eRight - level) <= 0) { crosses = true; break; }
        if (Number.isFinite(eDown) && (e - level) * (eDown - level) <= 0) { crosses = true; break; }
      }
      if (!crosses) continue;

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
      // Perpendicular to the gradient (rotate 90°) — `inkGlyphForTangent`
      // is direction-mod-180 already, so either rotation sign is equivalent.
      grid.char[idx] = inkGlyphForTangent(-gy, gx, 0.5, 0.5);
      grid.color[idx] = color;
    }
  }
}
