import type { RasterizeContext, TemporalHistory } from "../api/rasterizeContext";
import { createGlyphOrthographicCamera, createGlyphPerspectiveCamera, type GlyphCamera, type GlyphProjectionMetrics } from "../api/createGlyphCamera";
import type { Polygon, Vec2, Vec3, TextureSampler } from "@glyphcss/core";
import { sampleTexel, polygonTexture } from "@glyphcss/core";
import { getWireframeGlyphs } from "./ramps";
import { applyCellHook, buildCellGrid, colorRunExtends, encodeGlyphBuffers, encodeGlyphBuffersDual } from "./cells";
import type { CellGrid } from "./cells";

/**
 * Render the scene to a string.
 *
 * `wireframe` — Bresenham-draws each edge into a Uint8Array stamp with three
 * weight tiers (1=thin, 2=normal, 3=core) and maps to glyphs via the active
 * palette. The palette is picked from `scene.glyphPalette`.
 *
 * `solid` — scan-fills each triangle with Lambert shading, depth-buffered so
 * closer faces overwrite farther ones. Intensity is mapped to SOLID_RAMP.
 *
 * When cells carry `.color`, output contains `<span style="color:#xyz">…</span>`
 * HTML fragments. The consumer must set `innerHTML` (not `textContent`).
 *
 * This is a direct generalization of RadiantHero's `frameForRotation`:
 * same stamp, same weight scheme, same projection.
 */
/** Minimal camera shape needed to project for the occlusion depth pass. */
interface ProjectCamera {
  project(v: Vec3, cols: number, rows: number, cellAspect: number, metrics?: GlyphProjectionMetrics): [number, number, number, number?];
}

/**
 * `hiddenLines: "hide"` depth-test allowance: `bias + slopeScale * |grad
 * depth|` (standard shadow-map slope-scaled bias). Internal constants, not
 * public options — measured in `research/contour-first-text/decisions.md`
 * (subpath 05). `HLR_SLOPE_SCALE` must stay > 0: a FLAT bias (slope 0)
 * regresses every convex mesh at every magnitude tried (cube -11..-32,
 * icosahedron -5..-44, sphere -12..-158 inked cells vs ground truth) because
 * a silhouette that grazes its own surface needs a depth allowance
 * proportional to the local screen-space depth gradient there, not a
 * constant one. `0.5` converges within ~0-4% of ground truth (cube 115->115,
 * icosahedron 177->173-175, sphere 431->426-430) — the gradient term does
 * the real work; the flat term only guards near-zero-gradient (head-on) cells.
 */
const HLR_BIAS = 0.03;
const HLR_SLOPE_SCALE = 0.5;

// `winnerMeshBuf`'s "no winner yet" / occlusion-blanked sentinel (see its
// declaration and `exitScanFillTriangle`'s gate below) is `-1`. A polygon's
// meshId fallback when the caller supplies no `polygonMeshIds` array at all
// must be a DIFFERENT constant — otherwise every polygon implicitly carries
// the same value as an unclaimed cell, and the exit sweep's
// `winnerMeshBuf[idx] !== meshId` restriction passes on every cell in a
// triangle's bounding box regardless of whether that cell actually has a
// winner, leaking finite `objectExit` data into empty/occluded cells (a
// back-facing-only polygon is the sharpest case: it never wins any cell in
// the entry pass, so every cell it touches in the exit sweep must be
// rejected). `NO_MESH_ID_SUPPLIED` is used consistently by both the entry
// and exit sweeps' meshId fallback, so a legitimately-won cell in a
// no-mesh-ids scene still matches itself in the exit sweep.
const NO_MESH_ID_SUPPLIED = -2;

function projectionMetricsForGrid(
  cols: number,
  rows: number,
  cellAspect: number,
  grid: {
    cellWidth?: number;
    cellHeight?: number;
    centerCol?: number;
    centerRow?: number;
  },
  scale = 1,
): GlyphProjectionMetrics {
  const fallbackCellW = 50 / cellAspect;
  const fallbackCellH = 50;
  return {
    cellWidth: (grid.cellWidth ?? fallbackCellW) / scale,
    cellHeight: (grid.cellHeight ?? fallbackCellH) / scale,
    centerCol: grid.centerCol !== undefined ? grid.centerCol * scale : undefined,
    centerRow: grid.centerRow !== undefined ? grid.centerRow * scale : undefined,
  };
}

/**
 * Build a shared occlusion id-map: depth-rasterize each layer group's polygons
 * into a `cols × rows` buffer and record, per cell, the id of the layer whose
 * surface is nearest (`-1` = empty). Depth-only (no shading/glyph/color/shadow),
 * so far cheaper than a full rasterize. Returned to `rasterize` via
 * {@link OcclusionMap} so layers blank where a DIFFERENT layer is nearest.
 */
export function computeOcclusionIds(
  groups: { polygons: Polygon[]; id: number }[],
  rawCamera: ProjectCamera,
  outCols: number,
  outRows: number,
  cellAspect: number,
  supersample = 1,
  metrics: GlyphProjectionMetrics = projectionMetricsForGrid(outCols, outRows, cellAspect, {}),
): Int32Array {
  // Build the id-map at the WORLD layer's INTERNAL (supersampled) resolution using
  // the same offset-scaling wrapper rasterizeSolid uses, so the world's supersampled
  // silhouette and its id-map hole coincide subcell-for-subcell (no 1-cell seam at
  // the world/entity boundary). No-op when supersample===1 (id-map = output res).
  const ss = supersample > 1 ? Math.floor(supersample) : 1;
  const cols = outCols * ss, rows = outRows * ss;
  const scaledMetrics = ss > 1
    ? {
        ...metrics,
        cellWidth: metrics.cellWidth !== undefined ? metrics.cellWidth / ss : undefined,
        cellHeight: metrics.cellHeight !== undefined ? metrics.cellHeight / ss : undefined,
        centerCol: metrics.centerCol !== undefined ? metrics.centerCol * ss : undefined,
        centerRow: metrics.centerRow !== undefined ? metrics.centerRow * ss : undefined,
      }
    : metrics;
  const depth = new Float64Array(cols * rows).fill(-Infinity);
  const idMap = new Int32Array(cols * rows).fill(-1);
  for (const g of groups) {
    for (const poly of g.polygons) {
      const vs = poly.vertices;
      if (vs.length < 3) continue;
      const p0 = rawCamera.project(vs[0]!, cols, rows, cellAspect, scaledMetrics);
      let prev = rawCamera.project(vs[1]!, cols, rows, cellAspect, scaledMetrics);
      for (let k = 2; k < vs.length; k++) {
        const cur = rawCamera.project(vs[k]!, cols, rows, cellAspect, scaledMetrics);
        fillDepthTri(p0, prev, cur, depth, idMap, g.id, cols, rows);
        prev = cur;
      }
    }
  }
  return idMap;
}

function fillDepthTri(
  a: [number, number, number, number?],
  b: [number, number, number, number?],
  c: [number, number, number, number?],
  depth: Float64Array, idMap: Int32Array, id: number, W: number, H: number,
): void {
  const x0 = a[0], y0 = a[1], z0 = a[2], x1 = b[0], y1 = b[1], z1 = b[2], x2 = c[0], y2 = c[1], z2 = c[2];
  if (!(Number.isFinite(x0) && Number.isFinite(y0) && Number.isFinite(x1) && Number.isFinite(y1) && Number.isFinite(x2) && Number.isFinite(y2))) return;
  const minX = Math.max(0, Math.floor(Math.min(x0, x1, x2)));
  const maxX = Math.min(W - 1, Math.ceil(Math.max(x0, x1, x2)));
  const minY = Math.max(0, Math.floor(Math.min(y0, y1, y2)));
  const maxY = Math.min(H - 1, Math.ceil(Math.max(y0, y1, y2)));
  if (minX > maxX || minY > maxY) return;
  const area = (x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0);
  if (Math.abs(area) < 1e-9) return;
  const inv = 1 / area;
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const px = x + 0.5, py = y + 0.5;
      const w0 = ((x1 - px) * (y2 - py) - (x2 - px) * (y1 - py)) * inv;
      const w1 = ((x2 - px) * (y0 - py) - (x0 - px) * (y2 - py)) * inv;
      const w2 = 1 - w0 - w1;
      if (w0 < -1e-6 || w1 < -1e-6 || w2 < -1e-6) continue;
      const z = w0 * z0 + w1 * z1 + w2 * z2;
      const idx = y * W + x;
      if (z > depth[idx]!) { depth[idx] = z; idMap[idx] = id; }
    }
  }
}

/**
 * Surface depth-only prepass for `hiddenLines: "hide"` wireframe removal,
 * reusing `fillDepthTri` (the same triangle-depth rasterizer
 * `computeOcclusionIds` uses) rather than a second depth rasterizer.
 *
 * Projects each polygon at the CELL grid's resolution (same call
 * `camera.project` already gets for wireframe edges), then scales the
 * resulting screen x/y by `(sx, sy)` before filling — this matches how
 * `rasterizeWireframeBraille` derives subcell coordinates by scaling a
 * cell-space projection (`a[0] * 2`, `a[1] * 4`), so `sx=2, sy=4` builds a
 * depth buffer at SUBCELL resolution with no second projection pass, and
 * `sx=1, sy=1` (the ASCII path, and braille's coarser per-cell option)
 * builds it at cell resolution directly.
 */
function buildSurfaceDepth(
  polygons: Polygon[],
  camera: ProjectCamera,
  cellCols: number, cellRows: number, cellAspect: number,
  metrics: GlyphProjectionMetrics,
  sx = 1, sy = 1,
): Float64Array {
  const W = cellCols * sx, H = cellRows * sy;
  const depth = new Float64Array(W * H).fill(-Infinity);
  const idMap = new Int32Array(W * H).fill(-1);
  for (const poly of polygons) {
    const vs = poly.vertices;
    if (vs.length < 3 || poly.hidden) continue;
    const proj = (v: Vec3): [number, number, number, number?] => {
      const p = camera.project(v, cellCols, cellRows, cellAspect, metrics);
      return [p[0] * sx, p[1] * sy, p[2], p[3]];
    };
    const p0 = proj(vs[0]! as Vec3);
    let prev = proj(vs[1]! as Vec3);
    for (let k = 2; k < vs.length; k++) {
      const cur = proj(vs[k]! as Vec3);
      fillDepthTri(p0, prev, cur, depth, idMap, 0, W, H);
      prev = cur;
    }
  }
  return depth;
}

/**
 * Local screen-space depth-gradient magnitude at `(x, y)`
 * in a depth buffer of size `W×H`, via central differences (one-sided at
 * buffer edges or next to an unpopulated — `-Infinity` — neighbor cell,
 * which is treated as "no constraint" rather than a cliff, since a missing
 * neighbor means no surface, not a large real depth jump). Feeds the
 * slope-scaled bias: a surface seen at a grazing angle (e.g. a sphere's
 * silhouette, which lies ON the contour it outlines) has a large screen-space
 * depth gradient there, so it earns a larger depth-test allowance than a
 * head-on, nearly depth-constant surface — the standard shadow-map
 * slope-scaled-bias technique, applied to wireframe hidden-line removal.
 */
function depthGradient(depth: Float64Array, W: number, H: number, x: number, y: number): number {
  const idx = y * W + x;
  const d = depth[idx]!;
  if (!Number.isFinite(d)) return 0;
  const dl = x > 0 ? depth[idx - 1]! : NaN;
  const dr = x < W - 1 ? depth[idx + 1]! : NaN;
  let gx = 0;
  if (Number.isFinite(dl) && Number.isFinite(dr)) gx = (dr - dl) / 2;
  else if (Number.isFinite(dr)) gx = dr - d;
  else if (Number.isFinite(dl)) gx = d - dl;
  const du = y > 0 ? depth[idx - W]! : NaN;
  const dd = y < H - 1 ? depth[idx + W]! : NaN;
  let gy = 0;
  if (Number.isFinite(du) && Number.isFinite(dd)) gy = (dd - du) / 2;
  else if (Number.isFinite(dd)) gy = dd - d;
  else if (Number.isFinite(du)) gy = d - du;
  return Math.hypot(gx, gy);
}

/**
 * Depth-test a single wireframe stroke sample (`hiddenLines: "hide"`): visible when
 * there is no surface at this cell at all (nothing to occlude against — a
 * stroke drawn off any mesh's silhouette, or over background), or when the
 * stroke's own camera-space depth `edgeZ` (larger = nearer, matching
 * `fillDepthTri`'s `z >` convention) is no farther than the surface depth
 * minus an allowance. The allowance is `bias` (flat) plus `slopeScale` times
 * the local surface depth gradient (see `depthGradient`) — zero `slopeScale`
 * reproduces a flat bias.
 */
function wireframeVisibleAtCell(
  surfaceDepth: Float64Array, W: number, H: number,
  cx: number, cy: number, edgeZ: number,
  bias: number, slopeScale: number,
): boolean {
  const idx = cy * W + cx;
  const sd = surfaceDepth[idx]!;
  if (!Number.isFinite(sd)) return true;
  const grad = slopeScale > 0 ? depthGradient(surfaceDepth, W, H, cx, cy) : 0;
  const allowed = bias + slopeScale * grad;
  return edgeZ >= sd - allowed;
}

/**
 * `hiddenLines: "hide"` for `mode: "ink"` (third design — see
 * `research/contour-first-text/decisions.md`, 2026-08-02 entries, for the two
 * ruled-out bias-based attempts this replaces). Both prior attempts fought
 * SELF-occlusion with a depth-test margin (flat, then slope-scaled): a
 * sphere's silhouette lies ON the sphere, so the surface occludes its own
 * outline, and any bias large enough to prevent that ate 38-46% of the
 * silhouette anyway — a margin can't tell "this edge's own tangent face" from
 * "a genuinely nearer, different surface" because both look like "a surface
 * at roughly this depth".
 *
 * The fix is identity, not margin — the same principle as excluding the
 * caster from its own shadow map. `buildInkOcclusionMap` rasterizes every ink
 * triangle into a depth+id buffer (id = triangle index, reusing
 * `fillDepthTri` exactly as `computeOcclusionIds` does for cross-layer
 * occlusion). A stroke sample is hidden only when a DIFFERENT triangle wins
 * that cell AND that winner is strictly nearer than the sample — never when
 * the winner is one of the edge's own adjacent faces (recorded per kept edge
 * as `faceIds`, 1 for a boundary edge, 2 for a silhouette/crease).
 *
 * A sphere silhouette sample's own adjacent triangles are exempt, so identity
 * alone already prevents the coarse failure the prior attempts hit. It does
 * NOT fully close the gap, though: a piecewise-flat mesh approximates a
 * curved surface with CHORDS, so on a finely tessellated convex surface a
 * non-adjacent triangle a vertex or two away can legitimately win the same
 * screen cell's depth test by a tiny margin at a grazing angle — a
 * discretization artifact, not a real occluder. `faceIds` (built by
 * `edgeOwnFaceIds`) widens the exemption to a small vertex-topology
 * neighborhood (`INK_HLR_RING` hops) to absorb that, and the residual margin
 * is bounded by `depthGradient` (the same screen-space depth-slope probe
 * `wireframeVisibleAtCell` uses) rather than a flat constant — a flat
 * constant is scale-dependent (measured: fixed at world scale ~3 it rescues
 * subdiv-3, but the SAME constant regresses a 10x-larger sphere in the same
 * projection by -60%, reproducing the original flat-bias failure one scale
 * away). The gradient term instead scales with the mesh's own local
 * screen-space depth variation, so it stays proportionate across world scale
 * and camera zoom. A letter's back/side wall is occluded by the front cap, a
 * DIFFERENT triangle both outside the ring AND with a real depth gap far
 * larger than the local gradient allowance — correctly hidden.
 *
 * Per-SAMPLE, not per-edge: with self-occlusion mostly handled by identity
 * instead of margin, a per-sample test is finally safe (proven by the convex
 * table in `rasterize.ink.hiddenlines.test.ts` and the research doc — cube,
 * icosahedron, sphere subdiv 2 and 3 all hold to 0 delta, at five different
 * world scales/projections). Per-sample is also strictly better fidelity than
 * the old per-edge "all samples must fail" rule: a wall edge only PARTLY
 * behind a cap now hides just the covered portion instead of drawing (or
 * dropping) the whole segment.
 *
 * `INK_HLR_RING` / `INK_HLR_SLOPE_SCALE` were swept together (`research/
 * contour-first-text/experiments/16-ink-identity-hlr-convex-table.mjs` and
 * `17-ink-hlr-scale-invariance.mjs`) for the SMALLEST combination that holds
 * cube/icosahedron/sphere(subdiv 2,3) to exactly 0 delta across five
 * world-scale/projection combinations: `RING 1` (each edge's own 2 faces plus
 * their immediate vertex neighbors) with `SLOPE_SCALE 2.5` is that point —
 * `RING 1` alone needed slope up to 2.5 before the last convex case closed;
 * larger rings closed the gap at a smaller slope but only by over-exempting
 * nearby GENUINE occluders too, measurably weakening removal on the
 * motivating repro (`13-ink-repro-glyphcss.mjs`: `RING 1, SLOPE 2.5` →
 * 1152→914 inked cells, -20.7%; `RING 3` needed only `SLOPE 0.5` for the same
 * convex parity but only reached 1152→1011, -12.3%). This is the minimal safe
 * point measured, not a rounder "looks tuned enough" number.
 */
const INK_HLR_RING = 1;
const INK_HLR_SLOPE_SCALE = 2.5;

/**
 * Depth+id prepass for ink's `hiddenLines: "hide"` occlusion test — one
 * `fillDepthTri` call per ink triangle (same rasterizer `computeOcclusionIds`
 * and `buildSurfaceDepth` use), keyed by that triangle's own index so the
 * render loop can exempt an edge's adjacent faces by identity.
 */
function buildInkOcclusionMap(
  tris: { v0: Vec3; v1: Vec3; v2: Vec3 }[],
  camera: ProjectCamera, cols: number, rows: number, cellAspect: number, metrics: GlyphProjectionMetrics,
): { depth: Float64Array; id: Int32Array } {
  const depth = new Float64Array(cols * rows).fill(-Infinity);
  const id = new Int32Array(cols * rows).fill(-1);
  for (let i = 0; i < tris.length; i++) {
    const t = tris[i]!;
    const p0 = camera.project(t.v0, cols, rows, cellAspect, metrics);
    const p1 = camera.project(t.v1, cols, rows, cellAspect, metrics);
    const p2 = camera.project(t.v2, cols, rows, cellAspect, metrics);
    fillDepthTri(p0, p1, p2, depth, id, i, cols, rows);
  }
  return { depth, id };
}

/**
 * `charMode: "halfblock"` (B4) is solid-mode-only and needs a genuine top/
 * bottom subcell split to draw from, so it only engages when nothing else
 * already owns the single-color-per-cell downsample path: no `transformCells`
 * hook (which — like `rasterizeToCells` always setting one — expects and
 * returns the existing one-color {@link CellGrid} contract; see `cells.ts`'s
 * `encodeGlyphBuffersDual` doc) and no active reprojection TAA (which blends
 * a single ramp-index + RGB history, with no top/bottom equivalent). Outside
 * those cases it's a documented no-op — the scene renders exactly as it
 * would under `charMode: "ascii"` — mirroring how `charMode: "braille"` is a
 * documented no-op outside wireframe mode.
 */
function wantsHalfblockSolid(scene: RasterizeContext): boolean {
  return scene.charMode === "halfblock"
    && !scene.transformCells
    && !(scene.temporalBlend > 0 && !!scene.temporalHistory);
}

/**
 * `charMode: "quadrant"` (solid-mode-only, see the doc comment above
 * {@link encodeQuadrantSolid}) has the exact same eligibility rule as
 * `wantsHalfblockSolid`: it needs the raw supersampled subcell buffers
 * (nothing downsampled/reprojected yet) and produces a two-color-per-cell
 * span that neither `transformCells` nor temporal reprojection understand.
 */
function wantsQuadrantSolid(scene: RasterizeContext): boolean {
  return scene.charMode === "quadrant"
    && !scene.transformCells
    && !(scene.temporalBlend > 0 && !!scene.temporalHistory);
}

export function rasterize(scene: RasterizeContext): string {
  const { camera, grid, wireframe, mode } = scene;
  const { cols, rows, cellAspect } = grid;
  const metrics = projectionMetricsForGrid(cols, rows, cellAspect, grid);

  if (mode === "solid") {
    const baseSS = scene.supersample && scene.supersample > 1 ? Math.floor(scene.supersample) : 1;
    // Halfblock needs at least two EVEN subcell rows per output cell (a clean
    // top/bottom split) to sample from — borrow the existing supersample
    // machinery rather than inventing a second subcell mechanism. Forcing this
    // only when halfblock will actually apply keeps every other charMode/
    // supersample combination byte-identical to before.
    // `quadrant` needs the same even-supersample subcell split as `halfblock`
    // (a clean 2×2 quadrant bisection instead of halfblock's top/bottom one),
    // so it forces the same minimum — see `wantsQuadrantSolid`.
    let ss = baseSS;
    if (wantsHalfblockSolid(scene) || wantsQuadrantSolid(scene)) {
      ss = Math.max(2, baseSS);
      if (ss % 2 !== 0) ss++;
    }
    return rasterizeSolid(scene, cols, rows, cellAspect, ss, metrics);
  }

  if (mode === "ink") {
    return rasterizeInk(scene, cols, rows, cellAspect, metrics);
  }

  // wireframe (and voxel falls through to wireframe for now)

  // `charMode: "braille"` only encodes wireframe mode — voxel falls through to
  // this same branch but keeps the ASCII path (braille coverage is binary and
  // has no voxel-face-normal glyph mapping). Default/absent `charMode` and
  // `"ascii"` both take the untouched path below, so default output stays
  // byte-identical.
  if (scene.charMode === "braille" && mode === "wireframe") {
    return rasterizeWireframeBraille(scene, cols, rows, cellAspect, metrics);
  }

  const glyphs = getWireframeGlyphs(scene.glyphPalette);
  const stamp = new Uint8Array(cols * rows);
  // Color buffer: one entry per cell. null means "no color" (use CSS fallback).
  // When colors are disabled, we don't even allocate the buffer (saves GC).
  const colorBuf: (string | null)[] | null = scene.useColors ? new Array(cols * rows).fill(null) : null;
  // Per-cell N/E/S/W side mask for the box-drawing junction resolve pass.
  // `null` (the default) skips the pass entirely — byte-identical output.
  const junctionMask: Uint8Array | null = scene.wireframeJunctions ? new Uint8Array(cols * rows) : null;

  // `hiddenLines: "hide"` depth-tests each wireframe stroke against a solid
  // surface prepass so an edge genuinely BEHIND another mesh's (or the same
  // mesh's back side) surface doesn't paint through it. `"show"` (the
  // default) skips every line below and leaves this function byte-identical
  // to before the option existed.
  const hlr = scene.hiddenLines === "hide";
  const surfaceDepth = hlr ? buildSurfaceDepth(scene.polygons, camera, cols, rows, cellAspect, metrics) : null;

  for (const e of wireframe) {
    const a = camera.project(e.from, cols, rows, cellAspect, metrics);
    const b = camera.project(e.to, cols, rows, cellAspect, metrics);
    // Near-plane culled vertices come back as NaN — skip the line entirely.
    if (a[0] !== a[0] || b[0] !== b[0]) continue;
    if (surfaceDepth) {
      drawLineToStampDepthTested(
        stamp, colorBuf, a[0] | 0, a[1] | 0, b[0] | 0, b[1] | 0, a[2]!, b[2]!,
        e.weight ?? 2, e.color ?? null, cols, rows, surfaceDepth, HLR_BIAS, HLR_SLOPE_SCALE,
      );
    } else {
      drawLineToStamp(stamp, colorBuf, a[0] | 0, a[1] | 0, b[0] | 0, b[1] | 0, e.weight ?? 2, e.color ?? null, cols, rows);
    }
    if (junctionMask) accumulateJunctionMask(junctionMask, a[0], a[1], b[0], b[1], cols, rows);
  }

  // Post-rasterize cell hook (wireframe). No-op path below is the untouched
  // original stampToGlyphs → byte-identical when no hook is supplied.
  if (scene.transformCells) {
    const n = cols * rows;
    const cChar: string[] = new Array(n);
    const cColor: (string | null)[] | null = colorBuf ? new Array(n) : null;
    for (let i = 0; i < n; i++) {
      const v = stamp[i];
      if (v === 0) {
        cChar[i] = " ";
        if (cColor) cColor[i] = null;
      } else {
        cChar[i] = wireframeGlyphForCell(v, junctionMask ? junctionMask[i]! : 0, glyphs);
        if (cColor) cColor[i] = colorBuf ? (colorBuf[i] ?? null) : null;
      }
    }
    const applied = applyCellHook(scene.transformCells, cChar, cColor, null, cols, rows);
    return solidBufToString(applied.char, applied.color, cols, rows, true, scene.colorTolerance);
  }

  return stampToGlyphs(stamp, colorBuf, cols, rows, glyphs, junctionMask, scene.colorTolerance);
}

/** N/E/S/W side bits for the box-drawing junction resolve pass. */
const JUNCTION_N = 1;
const JUNCTION_E = 2;
const JUNCTION_S = 4;
const JUNCTION_W = 8;

/** Mask → box-drawing glyph. A single bit (a dangling stub at a clipped or
 *  unjoined endpoint) still reads as a straight rule on its axis. */
const JUNCTION_GLYPHS: Record<number, string> = {
  [JUNCTION_N]: "│",
  [JUNCTION_S]: "│",
  [JUNCTION_N | JUNCTION_S]: "│",
  [JUNCTION_E]: "─",
  [JUNCTION_W]: "─",
  [JUNCTION_E | JUNCTION_W]: "─",
  [JUNCTION_N | JUNCTION_E]: "└",
  [JUNCTION_N | JUNCTION_W]: "┘",
  [JUNCTION_S | JUNCTION_E]: "┌",
  [JUNCTION_S | JUNCTION_W]: "┐",
  [JUNCTION_N | JUNCTION_E | JUNCTION_S]: "├",
  [JUNCTION_N | JUNCTION_S | JUNCTION_W]: "┤",
  [JUNCTION_E | JUNCTION_W | JUNCTION_S]: "┬",
  [JUNCTION_E | JUNCTION_W | JUNCTION_N]: "┴",
  [JUNCTION_N | JUNCTION_E | JUNCTION_S | JUNCTION_W]: "┼",
};

/**
 * Accumulate N/E/S/W side bits for a single wireframe edge into `mask`.
 *
 * An edge only contributes when it is near-axis-aligned: its two projected
 * endpoints round to the same output ROW (near-horizontal) or the same
 * output COLUMN (near-vertical) — under half a cell of perpendicular drift
 * across its whole screen-space length. This threshold scales with edge
 * length instead of a fixed angle constant, and needs no extra tuning knob.
 * A diagonal-dominant edge (endpoints round to neither) contributes nothing;
 * its cells keep the existing per-tier slope-glyph selection untouched.
 */
function accumulateJunctionMask(
  mask: Uint8Array,
  ax: number, ay: number, bx: number, by: number,
  cols: number, rows: number,
): void {
  const rowA = Math.round(ay), rowB = Math.round(by);
  const colA = Math.round(ax), colB = Math.round(bx);
  if (rowA === rowB) {
    markHorizontalRun(mask, colA, colB, rowA, cols, rows);
  } else if (colA === colB) {
    markVerticalRun(mask, rowA, rowB, colA, cols, rows);
  }
}

function markHorizontalRun(mask: Uint8Array, colStart: number, colEnd: number, row: number, cols: number, rows: number): void {
  if (row < 0 || row >= rows) return;
  const lo = Math.min(colStart, colEnd), hi = Math.max(colStart, colEnd);
  const cLo = Math.max(0, lo), cHi = Math.min(cols - 1, hi);
  const base = row * cols;
  for (let c = cLo; c <= cHi; c++) {
    const idx = base + c;
    if (c > lo) mask[idx] |= JUNCTION_W;
    if (c < hi) mask[idx] |= JUNCTION_E;
  }
}

function markVerticalRun(mask: Uint8Array, rowStart: number, rowEnd: number, col: number, cols: number, rows: number): void {
  if (col < 0 || col >= cols) return;
  const lo = Math.min(rowStart, rowEnd), hi = Math.max(rowStart, rowEnd);
  const rLo = Math.max(0, lo), rHi = Math.min(rows - 1, hi);
  for (let r = rLo; r <= rHi; r++) {
    const idx = r * cols + col;
    if (r > lo) mask[idx] |= JUNCTION_N;
    if (r < hi) mask[idx] |= JUNCTION_S;
  }
}

/** Resolve a single wireframe cell's glyph: junction mask wins when set (and
 *  maps to a known combination), otherwise the existing random per-tier pick. */
function wireframeGlyphForCell(
  stampValue: number,
  maskValue: number,
  glyphs: { thin: string[]; normal: string[]; core: string[] },
): string {
  if (maskValue !== 0) {
    const jg = JUNCTION_GLYPHS[maskValue];
    if (jg !== undefined) return jg;
  }
  return stampValue === 1
    ? glyphs.thin[(Math.random() * glyphs.thin.length) | 0]!
    : stampValue === 2
      ? glyphs.normal[(Math.random() * glyphs.normal.length) | 0]!
      : glyphs.core[(Math.random() * glyphs.core.length) | 0]!;
}

// ── Ink mode ─────────────────────────────────────────────────────────────────

/**
 * Dihedral-angle threshold for a CREASE edge in `ink` mode: adjacent face
 * normals diverging by more than this many degrees are a hard edge (e.g. a
 * cube corner) and are always drawn, independent of the view-dependent
 * silhouette test below. 35° mirrors the common NPR/toon-outline default
 * (Blender Freestyle ships ~30°) — sharp enough to skip a sphere/torus's
 * naturally smooth curvature (no false creases) while still catching a cube's
 * 90° edges and similar hard corners.
 */
const INK_CREASE_ANGLE_DEG = 35;
const INK_CREASE_COS_THRESHOLD = Math.cos((INK_CREASE_ANGLE_DEG * Math.PI) / 180);

/**
 * Relative tolerance (fraction of the mesh's bounding-box diagonal) used to
 * snap two vertices that are the SAME solid corner but differ by float
 * rounding noise onto one adjacency key. Picked to sit comfortably inside
 * the gap between two measured floors:
 *
 * - Noise ceiling: accumulated float error through a chain of curve
 *   flattening + rotation/extrusion transforms stays within ~1e-10 relative
 *   to the operands' magnitude in practice (a few ULPs per op, hundreds of
 *   ops) — well above IEEE754's ~1e-16 per-op precision but still tiny.
 * - Distinct-vertex floor: measured directly on the shipped Roboto-Bold
 *   fixture's extruded "h p y o" meshes (`research/contour-first-text/
 *   experiments/33-min-edge-length.mjs`), the tightest real mesh edge
 *   (curve tessellation on "y") is ~8.6e-4 of the bounding-box diagonal.
 *   A conservative floor one order of magnitude below that, ~1e-4, is used
 *   for margin.
 *
 * `1e-7` sits ~3 orders of magnitude above the noise ceiling and ~3 orders
 * below the distinct-vertex floor on both sides — it snaps float-noise
 * duplicates without ever being able to fuse two genuinely distinct corners
 * this mesh family is expected to produce.
 */
const INK_VERTEX_EPSILON_REL = 1e-7;

/** Absolute fallback quantum for a degenerate (empty or single-point) mesh,
 *  where a bounding-box diagonal can't derive a relative tolerance. */
const INK_VERTEX_QUANTUM_FALLBACK = 1e-9;

/**
 * Derive a SCALE-AWARE snapping quantum from the mesh's own extent (the
 * bounding-box diagonal of every triangle vertex `ink` will key), once per
 * render rather than per vertex. A fixed decimal quantum is wrong across
 * authored scales (a mesh at `size: 0.1` vs one at `size: 50`); deriving it
 * from the mesh's own diagonal keeps the same RELATIVE tolerance at any
 * scale.
 */
function computeInkVertexQuantum(tris: { v0: Vec3; v1: Vec3; v2: Vec3 }[]): number {
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (const t of tris) {
    for (const v of [t.v0, t.v1, t.v2]) {
      if (v[0] < minX) minX = v[0]; if (v[0] > maxX) maxX = v[0];
      if (v[1] < minY) minY = v[1]; if (v[1] > maxY) maxY = v[1];
      if (v[2] < minZ) minZ = v[2]; if (v[2] > maxZ) maxZ = v[2];
    }
  }
  const diag = Math.hypot(maxX - minX, maxY - minY, maxZ - minZ);
  return diag > 0 ? diag * INK_VERTEX_EPSILON_REL : INK_VERTEX_QUANTUM_FALLBACK;
}

/**
 * Build a tolerant vertex-adjacency key: each coordinate snaps to the
 * nearest multiple of `quantum` via integer rounding (`Math.round`), so the
 * key string is built from exact integers — never from a re-multiplied
 * float, which could reintroduce the same formatting noise this exists to
 * remove.
 */
function makeInkVertexKey(quantum: number): (v: Vec3) => string {
  const inv = 1 / quantum;
  return (v: Vec3): string => {
    const ix = Math.round(v[0] * inv);
    const iy = Math.round(v[1] * inv);
    const iz = Math.round(v[2] * inv);
    return `${ix},${iy},${iz}`;
  };
}

function normalize2(v: [number, number]): [number, number] {
  const len = Math.hypot(v[0], v[1]);
  return len < 1e-9 ? [0, 0] : [v[0] / len, v[1] / len];
}

/**
 * Bias a smoothed vertex tangent toward the screen-space direction of the
 * specific segment it's about to be interpolated across.
 *
 * `tangent` (the >2-neighbor "most anti-parallel pair" junction heuristic,
 * smoothed) is a per-VERTEX quantity shared by every edge touching that
 * vertex — at a >=3-edge junction (a cube corner, an icosahedron crease
 * vertex) the picked pair can be unrelated to any one of those edges, so a
 * segment can inherit an orientation that has nothing to do with itself
 * (P2: a cube's vertical edges rendering as horizontal glyphs). `segDir` is
 * this segment's OWN direction (`b - a`), always correct for a straight
 * edge and never junction-contaminated.
 *
 * `agreement` — the absolute cosine between the (sign-aligned) vertex
 * tangent and `segDir` — is how much the two already agree. `segDir` is
 * always given full weight; `vt` is given weight `agreement`. So: a smooth
 * contour, where the vertex tangent is already close to every one of its
 * segments' own directions (agreement ~= 1), keeps close to full smoothing
 * (the blend is close to a straight average, still correcting the
 * chord-vs-tangent stair-step). A junction where the picked pair is
 * unrelated to this segment (agreement ~= 0) collapses to `segDir` alone —
 * exactly the straight, isolated-segment behavior a hard edge needs.
 */
function biasTangentToSegment(vt: [number, number], segDir: [number, number]): [number, number] {
  if (segDir[0] === 0 && segDir[1] === 0) return vt;
  const rawDot = vt[0] * segDir[0] + vt[1] * segDir[1];
  const aligned: [number, number] = rawDot < 0 ? [-vt[0], -vt[1]] : vt;
  const agreement = Math.abs(rawDot);
  return normalize2([segDir[0] + aligned[0] * agreement, segDir[1] + aligned[1] * agreement]);
}

/**
 * Map a screen-space contour tangent (+ the cell's fractional vertical/
 * horizontal position, used by the horizontal and vertical glyphs
 * respectively) to an oriented ink glyph. `theta = atan2(dy, dx)` is folded
 * into `[0, π)` (a tangent and its negation trace the same line) and
 * quantized into four 45°-wide buckets centered on horizontal / "\" /
 * vertical / "/". Exported so the quantization can be unit tested directly,
 * independent of the full silhouette + smoothing pipeline.
 *
 * Sub-cell discrimination is only added where a monospace font actually
 * renders font-distinct, consistent-weight glyphs for it. Measured by
 * rasterizing each candidate codepoint in the real font (Menlo) and taking
 * PCA over its inked pixels — see
 * `research/contour-first-text/experiments/11-line-glyph-census.mjs` (angle
 * census) and `.../14-subcell-quantization-census.mjs` (this finer
 * row/column census). Every level below is ordered by MEASURED centroid,
 * not assumption:
 *
 * - Horizontal: "‾" (row .16) / "▔" (row .28, UPPER ONE EIGHTH BLOCK) /
 *   "-" (row .68) / "_" (row 1.12). "▔" was added because it measures at
 *   4.3% coverage / 0.90 eccentricity — in family with "‾"/"_" at
 *   2.5-2.8% coverage / 0.90-0.95 eccentricity, not a visible weight jump.
 *   "▁" (LOWER ONE EIGHTH BLOCK) was measured too but its centroid (row
 *   1.17) sits only .05 away from "_" (row 1.12) — far closer to "_" than
 *   any other adjacent pair here — so it was DROPPED as positionally
 *   redundant, not a real new level. "▂"/"▃" (LOWER ONE QUARTER / THREE
 *   EIGHTHS BLOCK) were DROPPED for weight: 8.1%/11.9% coverage (2-4x the
 *   ~3% baseline) and eccentricity 0.68/0.42 (no longer thin-line shaped at
 *   this cell aspect) — a visibly heavier, more block-like stroke.
 * - Vertical stays at three levels: "▏" (col .02, LEFT ONE EIGHTH BLOCK) /
 *   "|" (col .31) / "▕" (col .56, RIGHT ONE EIGHTH BLOCK) — unchanged from
 *   db5703c. "▎" (LEFT ONE QUARTER BLOCK, col .06) measured plausibly by
 *   coverage alone (7.3% vs the shipped ~3-5.5% baseline) and was tried, but
 *   the rendered visual proof on the motivating extruded-text case
 *   (`research/contour-first-text/experiments/15-render-visual-proof.mjs`,
 *   `after16-headon.txt` vs `before16-headon.txt`) showed 20 of 21 "▏"
 *   instances in that render converting to "▎" — not occasional finer
 *   positioning but a near-total, systemic replacement that reads as the
 *   whole word's vertical strokes getting uniformly heavier, not smoother.
 *   Real extruded-text geometry clusters many parallel strokes at similar
 *   sub-column offsets, so this isn't a fluke of one fixture; it's dropped
 *   for real observed weight inconsistency, per the "a visibly uneven stroke
 *   is worse than a coarser one" rule. "▍"/"▌"/"▐" (11.3%/15.3%/16.1%
 *   coverage, 2-3x the baseline) were dropped outright on the coverage
 *   measurement alone, without needing a render to confirm.
 * - Diagonals ("\\" and "/") do NOT get sub-cell discrimination: ASCII and
 *   the Unicode box-drawing diagonals (U+2571/U+2572) have exactly one
 *   glyph per direction with no left/right-shifted variant a monospace font
 *   renders distinctly, and a diagonal stroke already spans corner-to-corner
 *   within its cell, so there's no analogous "offset within the cell" to
 *   express even if a variant existed.
 *
 * Bucket thresholds are 1/6, 1/3, 2/3 on both axes: the original even
 * trisection (1/3, 2/3) is unchanged (so every pre-existing threshold-facing
 * test keeps its result), and the new finer level only subdivides the first
 * third in half. This is a placement choice, not a claim that 1/6 equals a
 * measured centroid midpoint — the existing 1/3-2/3 split was already a
 * round-number simplification over the measured centroids, not an exact fit.
 */
const SUB_SIXTH = 1 / 6;
const SUB_THIRD = 1 / 3;
const SUB_TWO_THIRDS = 2 / 3;

export function inkGlyphForTangent(dx: number, dy: number, subRow = 0.5, subCol = 0.5): string {
  if (Math.hypot(dx, dy) < 1e-6) return "·"; // "·" — degenerate/point contour
  let theta = Math.atan2(dy, dx);
  if (theta < 0) theta += Math.PI;
  const EIGHTH = Math.PI / 8;
  if (theta < EIGHTH || theta >= Math.PI - EIGHTH) {
    // Near-horizontal: use the cell's fractional vertical position to pick
    // among four vertically-offset glyphs instead of always "-".
    if (subRow < SUB_SIXTH) return "‾"; // "‾" OVERLINE
    if (subRow < SUB_THIRD) return "▔"; // "▔" UPPER ONE EIGHTH BLOCK
    if (subRow < SUB_TWO_THIRDS) return "-";
    return "_";
  }
  if (theta < 3 * EIGHTH) return "\\";
  if (theta < 5 * EIGHTH) {
    // Near-vertical: mirror the horizontal case onto the column axis. Stays
    // at three levels — see the doc comment above for why a finer "▎" level
    // was tried and dropped.
    if (subCol < SUB_THIRD) return "▏"; // "▏" LEFT ONE EIGHTH BLOCK
    if (subCol < SUB_TWO_THIRDS) return "|";
    return "▕"; // "▕" RIGHT ONE EIGHTH BLOCK
  }
  return "/";
}

/**
 * `ink` mode: oriented silhouette + crease outline rasterizer.
 *
 * 1. Fan-triangulates every polygon and projects each triangle to determine
 *    front/back facing — the SAME signed-screen-area convention `scanFillTriangle`
 *    uses for its backface cull (`area2 <= 0` = front-facing) — so silhouette
 *    detection is view-dependent and correct under both ortho and perspective.
 * 2. Builds a shared-edge adjacency map (glyphcss's existing feature-edge
 *    convention from `featureEdges.ts`: canonical key from vertex position).
 *    An edge is KEPT when it is a silhouette (adjacent faces disagree on
 *    facing), a crease (dihedral angle beyond `INK_CREASE_COS_THRESHOLD`), or
 *    a boundary (single adjacent face) — and always requires at least one
 *    adjacent face to be front-facing (a crease entirely on the mesh's far
 *    side is invisible and must not draw through the surface).
 * 3. Chains kept edges into a per-vertex neighbor graph in SCREEN space, takes
 *    a raw central-difference tangent per vertex (or, at a junction with more
 *    than two neighbors, the most anti-parallel neighbor pair), then runs two
 *    sign-aligned neighbor-averaging smoothing passes over the tangent field —
 *    this is what turns the per-triangle-edge stair-stepping into a tangent
 *    that reads as continuous along the chain.
 * 4. Walks each kept edge in screen space, interpolating the two endpoints'
 *    smoothed tangents, and writes ONE oriented glyph per covered cell via
 *    `inkGlyphForTangent`. Interior cells stay empty (`" "`) — texture/hatch
 *    fills are deliberately out of scope for this mode; see AGENTS.md.
 *
 * `charMode` and `wireframeJunctions` are wireframe-path-only concerns (braille
 * subcell dot coverage / box-drawing corner resolution) and are simply never
 * consulted here — `ink` always renders its own fixed oriented-glyph set as
 * plain ASCII, regardless of those options.
 */
function rasterizeInk(
  scene: RasterizeContext,
  cols: number,
  rows: number,
  cellAspect: number,
  metrics: GlyphProjectionMetrics,
): string {
  const { camera, polygons } = scene;
  const charBuf: string[] = new Array(cols * rows).fill(" ");
  const colorBuf: (string | null)[] | null = scene.useColors ? new Array(cols * rows).fill(null) : null;

  interface InkTri {
    id: number;
    v0: Vec3; v1: Vec3; v2: Vec3;
    normal: [number, number, number];
    color: string | undefined;
    frontFacing: boolean;
  }
  const tris: InkTri[] = [];
  for (const poly of polygons) {
    const verts = poly.vertices;
    if (verts.length < 3 || poly.hidden) continue;
    for (let f = 1; f < verts.length - 1; f++) {
      const v0 = verts[0]! as Vec3, v1 = verts[f]! as Vec3, v2 = verts[f + 1]! as Vec3;
      const ux = v1[0] - v0[0], uy = v1[1] - v0[1], uz = v1[2] - v0[2];
      const vx = v2[0] - v0[0], vy = v2[1] - v0[1], vz = v2[2] - v0[2];
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      const nLen = Math.hypot(nx, ny, nz) || 1;
      const normal: [number, number, number] = [nx / nLen, ny / nLen, nz / nLen];
      const pa = camera.project(v0, cols, rows, cellAspect, metrics);
      const pb = camera.project(v1, cols, rows, cellAspect, metrics);
      const pc = camera.project(v2, cols, rows, cellAspect, metrics);
      const projected = pa[0] === pa[0] && pb[0] === pb[0] && pc[0] === pc[0];
      const area2 = projected ? (pb[0] - pa[0]) * (pc[1] - pa[1]) - (pb[1] - pa[1]) * (pc[0] - pa[0]) : 0;
      tris.push({ id: tris.length, v0, v1, v2, normal, color: poly.color, frontFacing: projected && area2 <= 0 });
    }
  }

  // Scale-aware tolerant key, derived once from this mesh's own bounding-box
  // diagonal — see `computeInkVertexQuantum`'s doc comment for the noise-vs-
  // distinct-vertex margin this tolerance is picked inside.
  const inkVertexKey = makeInkVertexKey(computeInkVertexQuantum(tris));

  // Vertex → adjacent-triangle-ids map, keyed the same way `edgeMap` keys
  // vertices. Used below to exempt a kept edge from `hiddenLines: "hide"`
  // occlusion by every triangle touching either of its OWN endpoints — not
  // just the 1-2 triangles the edge itself bounds. A single silhouette-edge's
  // 2 adjacent faces are not always the nearest surface at their shared
  // screen cell on a finely tessellated convex surface (a neighboring,
  // non-adjacent triangle one vertex over can win the depth test by a
  // sub-pixel margin at the same grazing angle); the full vertex ring is
  // still exactly the LOCAL neighborhood a silhouette vertex belongs to, so
  // it keeps the exemption self-contained (a spatially distant part of the
  // same mesh — e.g. a letter's far wall behind its own front cap — shares no
  // vertices with the occluder and is still correctly hidden).
  const vertexTriIds = new Map<string, number[]>();
  const registerVertexTri = (v: Vec3, id: number): void => {
    const key = inkVertexKey(v);
    let ids = vertexTriIds.get(key);
    if (!ids) { ids = []; vertexTriIds.set(key, ids); }
    ids.push(id);
  };
  for (const t of tris) {
    registerVertexTri(t.v0, t.id);
    registerVertexTri(t.v1, t.id);
    registerVertexTri(t.v2, t.id);
  }
  const edgeOwnFaceIds = (a: Vec3, b: Vec3): number[] => {
    let ringIds = new Set<number>();
    let ringKeys = new Set<string>([inkVertexKey(a), inkVertexKey(b)]);
    for (let hop = 0; hop < INK_HLR_RING; hop++) {
      const nextKeys = new Set<string>();
      for (const k of ringKeys) {
        const ids = vertexTriIds.get(k);
        if (!ids) continue;
        for (const id of ids) {
          if (ringIds.has(id)) continue;
          ringIds.add(id);
          const t = tris[id]!;
          nextKeys.add(inkVertexKey(t.v0));
          nextKeys.add(inkVertexKey(t.v1));
          nextKeys.add(inkVertexKey(t.v2));
        }
      }
      ringKeys = nextKeys;
    }
    return [...ringIds];
  };

  interface InkEdgeEntry {
    fromWorld: Vec3; toWorld: Vec3;
    contribs: { normal: [number, number, number]; frontFacing: boolean; color: string | undefined }[];
  }
  const edgeMap = new Map<string, InkEdgeEntry>();
  const addEdge = (a: Vec3, b: Vec3, normal: [number, number, number], frontFacing: boolean, color: string | undefined): void => {
    const ka = inkVertexKey(a), kb = inkVertexKey(b);
    if (ka === kb) return;
    const canon = ka < kb;
    const key = canon ? `${ka}|${kb}` : `${kb}|${ka}`;
    let entry = edgeMap.get(key);
    if (!entry) {
      entry = { fromWorld: canon ? a : b, toWorld: canon ? b : a, contribs: [] };
      edgeMap.set(key, entry);
    }
    entry.contribs.push({ normal, frontFacing, color });
  };
  for (const t of tris) {
    addEdge(t.v0, t.v1, t.normal, t.frontFacing, t.color);
    addEdge(t.v1, t.v2, t.normal, t.frontFacing, t.color);
    addEdge(t.v2, t.v0, t.normal, t.frontFacing, t.color);
  }

  // `rank` orders how a cell shared by two edges resolves: a silhouette or
  // crease is the outline a person would draw, so it must win over a lone
  // front-facing triangle's boundary edge running off it at another angle.
  // `faceIds` records this edge's own local vertex-ring (`edgeOwnFaceIds`) —
  // consulted by `hiddenLines: "hide"` below to exempt an edge from being
  // occluded by its own immediate neighborhood (see `buildInkOcclusionMap`'s
  // doc comment).
  const keptEdges: { fromWorld: Vec3; toWorld: Vec3; color: string | undefined; rank: number; faceIds: number[] }[] = [];
  for (const entry of edgeMap.values()) {
    const { contribs } = entry;
    const ownFaceIds = edgeOwnFaceIds(entry.fromWorld, entry.toWorld);
    if (contribs.length === 1) {
      if (contribs[0]!.frontFacing) {
        keptEdges.push({ fromWorld: entry.fromWorld, toWorld: entry.toWorld, color: contribs[0]!.color, rank: 0, faceIds: ownFaceIds });
      }
      continue;
    }
    let silhouette = false;
    let crease = false;
    let anyFront = false;
    let frontColor: string | undefined;
    for (let i = 0; i < contribs.length; i++) {
      if (contribs[i]!.frontFacing) { anyFront = true; frontColor = frontColor ?? contribs[i]!.color; }
      for (let j = i + 1; j < contribs.length; j++) {
        if (contribs[i]!.frontFacing !== contribs[j]!.frontFacing) silhouette = true;
        const ni = contribs[i]!.normal, nj = contribs[j]!.normal;
        const dot = ni[0] * nj[0] + ni[1] * nj[1] + ni[2] * nj[2];
        if (dot < INK_CREASE_COS_THRESHOLD) crease = true;
      }
    }
    if (!anyFront) continue;
    if (silhouette || crease) {
      keptEdges.push({
        fromWorld: entry.fromWorld, toWorld: entry.toWorld, color: frontColor ?? contribs[0]!.color, rank: 1,
        faceIds: ownFaceIds,
      });
    }
  }

  // `hiddenLines: "hide"` occlusion map — see `buildInkOcclusionMap`'s doc
  // comment for the identity-exemption design. `"show"` (the default) skips
  // this, leaving `rasterizeInk` byte-identical to before the option existed.
  const inkOcclusion = scene.hiddenLines === "hide"
    ? buildInkOcclusionMap(tris, camera, cols, rows, cellAspect, metrics)
    : null;

  // Per-vertex camera-space depth (`p[2]`, same "larger = nearer" convention
  // as `fillDepthTri`'s `z > depth[idx]` test), cached alongside the screen
  // position from the SAME `camera.project` call — no second projection pass.
  // Used below to break ties between two equal-`rank` strokes contesting the
  // same cell (e.g. a front-face silhouette edge and an extrusion side-wall
  // edge, both `rank: 1`) in favor of the nearer one.
  const vertexScreen = new Map<string, [number, number] | null>();
  const vertexDepth = new Map<string, number>();
  const projectVertex = (v: Vec3): [number, number] | null => {
    const key = inkVertexKey(v);
    const cached = vertexScreen.get(key);
    if (cached !== undefined) return cached;
    const p = camera.project(v, cols, rows, cellAspect, metrics);
    const s: [number, number] | null = p[0] === p[0] ? [p[0], p[1]] : null;
    vertexScreen.set(key, s);
    vertexDepth.set(key, p[2]!);
    return s;
  };
  const neighbors = new Map<string, { screen: [number, number]; nbrKeys: string[] }>();
  const ensureNode = (v: Vec3): string | null => {
    const s = projectVertex(v);
    if (!s) return null;
    const key = inkVertexKey(v);
    if (!neighbors.has(key)) neighbors.set(key, { screen: s, nbrKeys: [] });
    return key;
  };
  const edgeSegments: { fromKey: string; toKey: string; color: string | undefined; rank: number; fromZ: number; toZ: number; faceIds: number[] }[] = [];
  for (const e of keptEdges) {
    const fk = ensureNode(e.fromWorld);
    const tk = ensureNode(e.toWorld);
    if (!fk || !tk || fk === tk) continue;
    neighbors.get(fk)!.nbrKeys.push(tk);
    neighbors.get(tk)!.nbrKeys.push(fk);
    edgeSegments.push({ fromKey: fk, toKey: tk, color: e.color, rank: e.rank, fromZ: vertexDepth.get(fk)!, toZ: vertexDepth.get(tk)!, faceIds: e.faceIds });
  }

  // Raw per-vertex tangent: central difference between two neighbors (the
  // common contour case), the single neighbor direction at a chain endpoint,
  // or — at a >2-neighbor junction — the most anti-parallel neighbor pair.
  let tangent = new Map<string, [number, number]>();
  for (const [key, node] of neighbors) {
    const self = node.screen;
    if (node.nbrKeys.length === 0) { tangent.set(key, [0, 0]); continue; }
    if (node.nbrKeys.length === 1) {
      const n = neighbors.get(node.nbrKeys[0]!)!.screen;
      tangent.set(key, normalize2([self[0] - n[0], self[1] - n[1]]));
      continue;
    }
    const dirs = node.nbrKeys.map((nk) => {
      const n = neighbors.get(nk)!.screen;
      return normalize2([n[0] - self[0], n[1] - self[1]]);
    });
    let bestI = 0, bestJ = 1, bestDot = Infinity;
    for (let i = 0; i < dirs.length; i++) {
      for (let j = i + 1; j < dirs.length; j++) {
        const dot = dirs[i]![0] * dirs[j]![0] + dirs[i]![1] * dirs[j]![1];
        if (dot < bestDot) { bestDot = dot; bestI = i; bestJ = j; }
      }
    }
    const a = neighbors.get(node.nbrKeys[bestI]!)!.screen;
    const b = neighbors.get(node.nbrKeys[bestJ]!)!.screen;
    tangent.set(key, normalize2([b[0] - a[0], b[1] - a[1]]));
  }

  // Smoothing: two passes of sign-aligned neighbor averaging. Raw per-vertex
  // tangents come from single triangle edges and stair-step on a curved
  // surface (a sphere/torus silhouette is a smooth curve, but its polygonal
  // chord directions jump cell to cell); this pass blends each vertex's
  // tangent with its neighbors', flipping a neighbor's tangent first when it
  // points the "wrong way" (negative dot) so smoothing doesn't cancel itself.
  for (let pass = 0; pass < 2; pass++) {
    const next = new Map<string, [number, number]>();
    for (const [key, node] of neighbors) {
      const t0 = tangent.get(key)!;
      let sx = t0[0], sy = t0[1];
      for (const nk of node.nbrKeys) {
        const tn = tangent.get(nk)!;
        const dot = t0[0] * tn[0] + t0[1] * tn[1];
        const s = dot < 0 ? -1 : 1;
        sx += tn[0] * s;
        sy += tn[1] * s;
      }
      next.set(key, normalize2([sx, sy]));
    }
    tangent = next;
  }

  // Conflict resolution when two strokes contest the same cell: `rank` is
  // still the primary key (a silhouette/crease always beats a lone
  // front-facing boundary edge), but two EQUAL-rank strokes — e.g. a front
  // face's own silhouette and a farther extrusion side wall, both `rank: 1`
  // — used to resolve by draw order alone (whichever segment rasterized
  // last won), with no regard for which one the camera actually sees. This
  // is the reported "sides instead of front" defect on extruded word-art.
  // `cellDepth` breaks that tie by nearest-camera-space-depth (same
  // "larger = nearer" convention as `fillDepthTri`): among segments of equal
  // rank, only a STRICTLY nearer sample overwrites a cell's already-drawn
  // depth. This never removes a stroke — every contested cell still gets
  // whichever equal-rank segment is nearest, so it cannot punch the
  // mid-stroke holes the per-sample hidden-line attempts did.
  const cellRank = new Int8Array(cols * rows).fill(-1);
  const cellDepth = new Float64Array(cols * rows).fill(-Infinity);
  for (const seg of [...edgeSegments].sort((l, r) => l.rank - r.rank)) {
    const a = neighbors.get(seg.fromKey)!.screen;
    const b = neighbors.get(seg.toKey)!.screen;
    const dx = b[0] - a[0], dy = b[1] - a[1];
    // Anchor both endpoint tangents to THIS segment's own direction before
    // interpolating across it — see `biasTangentToSegment`. Both endpoints
    // are biased toward the same `segDir`, so they're already sign-consistent
    // with each other; no separate a/b sign-alignment step is needed.
    const segDir = normalize2([dx, dy]);
    const ta = biasTangentToSegment(tangent.get(seg.fromKey)!, segDir);
    const tb = biasTangentToSegment(tangent.get(seg.toKey)!, segDir);
    const dz = seg.toZ - seg.fromZ;
    const steps = Math.max(1, Math.round(Math.max(Math.abs(dx), Math.abs(dy))));
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const x = a[0] + dx * t, y = a[1] + dy * t;
      const cx = Math.floor(x), cy = Math.floor(y);
      if (cx < 0 || cx >= cols || cy < 0 || cy >= rows) continue;
      const idx = cy * cols + cx;
      const z = seg.fromZ + dz * t;
      // `hiddenLines: "hide"`: skip this SAMPLE (not the whole segment) when
      // a different, nearer surface occludes it — see `buildInkOcclusionMap`.
      // The winning face is exempt when it's within this edge's own local
      // vertex-ring (`seg.faceIds`), so a silhouette sample is never hidden by
      // the surface it outlines. The residual allowance for a foreign winner
      // is `depthGradient`-scaled (see the design doc above `INK_HLR_RING`),
      // not flat, so it stays proportionate at any world scale.
      if (inkOcclusion) {
        const winner = inkOcclusion.id[idx]!;
        if (winner >= 0 && !seg.faceIds.includes(winner)) {
          const allowed = INK_HLR_SLOPE_SCALE * depthGradient(inkOcclusion.depth, cols, rows, cx, cy);
          if (inkOcclusion.depth[idx]! > z + allowed) continue;
        }
      }
      const tx = ta[0] + (tb[0] - ta[0]) * t, ty = ta[1] + (tb[1] - ta[1]) * t;
      if (cellRank[idx]! > seg.rank) continue;
      if (cellRank[idx]! === seg.rank && cellDepth[idx]! >= z) continue;
      cellRank[idx] = seg.rank;
      cellDepth[idx] = z;
      charBuf[idx] = inkGlyphForTangent(tx, ty, y - cy, x - cx);
      if (colorBuf) colorBuf[idx] = seg.color ?? null;
    }
  }

  if (scene.transformCells) {
    const applied = applyCellHook(scene.transformCells, charBuf, colorBuf, null, cols, rows);
    return solidBufToString(applied.char, applied.color, cols, rows, true, scene.colorTolerance);
  }
  return solidBufToString(charBuf, colorBuf, cols, rows, false, scene.colorTolerance);
}

/** Solid-mode: scan-fill polygons (fan-triangulated) with Lambert shading + depth buffer. */
function rasterizeSolid(
  scene: RasterizeContext,
  outCols: number,
  outRows: number,
  cellAspect: number,
  supersample: number,
  metrics: GlyphProjectionMetrics,
): string {
  // Supersampled anti-aliasing: rasterize the geometry at `supersample`× the
  // output grid resolution, then box-average every S×S block of subcells down
  // to one output cell (glyph density + colour). This removes the motion crawl
  // where a sub-cell-sized surface's per-cell winner flips frame-to-frame — the
  // averaged cell changes smoothly instead of snapping to whatever won.
  const cols = outCols * supersample;
  const rows = outRows * supersample;
  const { camera: rawCamera, polygons, directionalLight, ambientLight, smoothShading, creaseAngle, doubleSided, castShadowFlags, receiveShadowFlags } = scene;
  const depthBiases = scene.depthBiases;
  const polygonMeshIds = scene.polygonMeshIds;
  const depthEpsilon = scene.depthEpsilon ?? 0;
  const scaledMetrics: GlyphProjectionMetrics = supersample > 1
    ? {
        ...metrics,
        cellWidth: metrics.cellWidth !== undefined ? metrics.cellWidth / supersample : undefined,
        cellHeight: metrics.cellHeight !== undefined ? metrics.cellHeight / supersample : undefined,
        centerCol: metrics.centerCol !== undefined ? metrics.centerCol * supersample : undefined,
        centerRow: metrics.centerRow !== undefined ? metrics.centerRow * supersample : undefined,
      }
    : metrics;
  const camera = rawCamera;
  // Pick the solid ramp from the active palette so the glyph palette dropdown
  // affects solid mode too — not just wireframe.
  const paletteRamp = getWireframeGlyphs(scene.glyphPalette).solid;
  // `solidWeightRamp` (opt-in, default undefined): a font-weight-calibrated
  // ramp REPLACES the palette ramp's glyph sequence with its own
  // measurement-ordered (glyph, weight) steps, same darkest→densest index
  // convention as `paletteRamp` — so `rampMax`/dithering/downsampling below
  // are unchanged, just indexing a different glyph sequence with a parallel
  // weight lookup. `undefined`/empty means "off": `ramp` stays `paletteRamp`
  // and `weightRamp` stays `null`, so `weightBuf` is never allocated or
  // written and output is byte-identical to before this option existed.
  const weightSteps = scene.solidWeightRamp;
  const weightRamp: Uint16Array | null =
    weightSteps && weightSteps.length > 0 ? new Uint16Array(weightSteps.map((s) => s.weight)) : null;
  const ramp = weightRamp ? weightSteps!.map((s) => s.glyph) : paletteRamp;
  const rampMax = ramp.length - 1;

  // Per-cell scratch buffers (glyph + colour + depth + optional surface fields). These
  // are cols*rows (up to ~80k entries at a fine supersampled grid) and were
  // allocated fresh every render — the dominant per-frame garbage, which shows up
  // as periodic GC frame-hitches. Reuse them across renders, stashed on the
  // persistent camera (one camera per scene in practice); re-`fill` each frame
  // (cheap, cache-friendly) and only reallocate when the grid size changes.
  const n = cols * rows;
  const useColors = scene.useColors;
  const reproject = scene.temporalBlend > 0 && !!scene.temporalHistory;
  const needSurfaceUv = !!scene.transformCells && polygons.some((polygon) => (
    polygon.uvs !== undefined && polygon.uvs.length >= polygon.vertices.length
  ));
  const camHost = rawCamera as unknown as {
    __glyphScratch?: {
      n: number;
      glyph: string[];
      color: (string | null)[];
      depth: Float64Array;
      shade: Float32Array | null;
      world: Float32Array | null;
      objectPos: Float32Array | null;
      normal: Float32Array | null;
      objectNormal: Float32Array | null;
      surfaceUv: Float32Array | null;
      winnerPolygon: Int32Array | null;
      winnerMesh: Int32Array | null;
      objectExit: Float32Array | null;
      objectExitDepth: Float64Array | null;
      albedoRgb: Uint32Array | null;
      targetRgb: Uint32Array | null;
      weight: Uint16Array | null;
    };
  };
  let scratch = camHost.__glyphScratch;
  if (!scratch || scratch.n !== n) {
    scratch = {
      n,
      glyph: new Array(n),
      color: new Array(n),
      depth: new Float64Array(n),
      shade: null,
      world: null,
      objectPos: null,
      normal: null,
      objectNormal: null,
      surfaceUv: null,
      winnerPolygon: null,
      winnerMesh: null,
      objectExit: null,
      objectExitDepth: null,
      albedoRgb: null,
      targetRgb: null,
      weight: null,
    };
    camHost.__glyphScratch = scratch;
  }
  // Glyph buffer: one char per cell (space = empty).
  const glyphBuf: string[] = scratch.glyph;
  glyphBuf.fill(" ");
  const colorBuf: (string | null)[] | null = useColors ? (scratch.color.fill(null), scratch.color) : null;
  // Depth buffer: -Infinity = nothing drawn yet. Higher `r[2]` = closer to the
  // viewer in our camera convention, so newer triangles win when their depth is
  // GREATER than the existing buffer entry.
  const depthBuf = scratch.depth;
  depthBuf.fill(-Infinity);
  let shadeBuf: Float32Array | null = null;
  if (scene.retainShade) {
    if (!scratch.shade || scratch.shade.length !== n) scratch.shade = new Float32Array(n);
    shadeBuf = scratch.shade;
    shadeBuf.fill(NaN);
  }
  // World position is shared by reprojection TAA and surface-space effects.
  // NaN marks "no surface here" (empty cell).
  let worldPosBuf: Float32Array | null = null;
  if (reproject || scene.retainWorldPosition) {
    if (!scratch.world || scratch.world.length !== n * 3) scratch.world = new Float32Array(n * 3);
    worldPosBuf = scratch.world;
    worldPosBuf.fill(NaN);
  }
  // Object-space position: same shape as worldPosBuf but interpolated against
  // each polygon's PRE-transform vertices (`objectVertices`, falling back to
  // `vertices` for untransformed meshes where the two frames coincide). Never
  // driven by `reproject` — that TAA reprojection is inherently a WORLD-space
  // concern — so this buffer is allocated ONLY when an effect's requirement
  // asked for it (`scene.retainObjectPosition`), unlike worldPosBuf which is
  // also forced on by temporal reprojection.
  let objectPosBuf: Float32Array | null = null;
  if (scene.retainObjectPosition) {
    if (!scratch.objectPos || scratch.objectPos.length !== n * 3) scratch.objectPos = new Float32Array(n * 3);
    objectPosBuf = scratch.objectPos;
    objectPosBuf.fill(NaN);
  }
  let normalBuf: Float32Array | null = null;
  if (scene.retainNormal) {
    if (!scratch.normal || scratch.normal.length !== n * 3) scratch.normal = new Float32Array(n * 3);
    normalBuf = scratch.normal;
    normalBuf.fill(NaN);
  }
  // Object-space face normal (VOLUMETRIC-4.md "Phase 0"): the object-frame
  // sibling of `objectPosBuf`, computed from the same `ov0/ov1/ov2` object
  // vertices at the same scan-fill call site. Never driven by `retainNormal`
  // — the world `normal` buffer stays untouched (the generated-surface basis
  // still needs it) — so this is allocated ONLY when an effect's requirement
  // asked for it, exactly like `objectPosBuf`.
  let objectNormalBuf: Float32Array | null = null;
  if (scene.retainObjectNormal) {
    if (!scratch.objectNormal || scratch.objectNormal.length !== n * 3) {
      scratch.objectNormal = new Float32Array(n * 3);
    }
    objectNormalBuf = scratch.objectNormal;
    objectNormalBuf.fill(NaN);
  }
  let surfaceUvBuf: Float32Array | null = null;
  if (needSurfaceUv) {
    if (!scratch.surfaceUv || scratch.surfaceUv.length !== n * 2) {
      scratch.surfaceUv = new Float32Array(n * 2);
    }
    surfaceUvBuf = scratch.surfaceUv;
    surfaceUvBuf.fill(NaN);
  }
  let winnerPolygonBuf: Int32Array | null = null;
  if (scene.retainWinnerPolygon) {
    if (!scratch.winnerPolygon || scratch.winnerPolygon.length !== n) {
      scratch.winnerPolygon = new Int32Array(n);
    }
    winnerPolygonBuf = scratch.winnerPolygon;
    winnerPolygonBuf.fill(-1);
  }
  // Winner-mesh buffer: which mesh id won each cell in THIS pass, at the
  // pass's supersample resolution. Independent of `retainWinnerPolygon`
  // (semantic-mode-only). Allocated under EITHER `retainObjectExit` (which
  // needs it to restrict the exit sweep's farthest-depth scan per cell to
  // the mesh that actually won there) OR `retainWinnerMesh` (per-object
  // effect targeting's `targetCoverage` substrate — VOLUMETRIC-3.md §1),
  // whichever is live. Downsampled and exposed on `CellGrid.winnerMesh`
  // whenever EITHER gate is live — see the exposure assignment below
  // (revised in VOLUMETRIC-3.md Phase 2: `retainObjectExit` alone used to
  // allocate the buffer without ever surfacing it, which left every carve
  // volumetric-subcell program — always `retainObjectExit`, rarely
  // mesh-targeted — with no way to test exact mesh-boundary equality
  // between neighboring cells; two coplanar same-normal meshes were
  // otherwise indistinguishable to those programs, the Phase 2 P1 fix).
  let winnerMeshBuf: Int32Array | null = null;
  if (scene.retainObjectExit || scene.retainWinnerMesh) {
    if (!scratch.winnerMesh || scratch.winnerMesh.length !== n) scratch.winnerMesh = new Int32Array(n);
    winnerMeshBuf = scratch.winnerMesh;
    winnerMeshBuf.fill(-1);
  }
  let albedoRgbBuf: Uint32Array | null = null;
  if (scene.retainAlbedoRgb) {
    if (!scratch.albedoRgb || scratch.albedoRgb.length !== n) scratch.albedoRgb = new Uint32Array(n);
    albedoRgbBuf = scratch.albedoRgb;
    albedoRgbBuf.fill(0);
  }
  let targetRgbBuf: Uint32Array | null = null;
  if (scene.retainTargetRgb) {
    if (!scratch.targetRgb || scratch.targetRgb.length !== n) scratch.targetRgb = new Uint32Array(n);
    targetRgbBuf = scratch.targetRgb;
    targetRgbBuf.fill(0);
  }
  // `solidWeightRamp` per-cell `font-weight` buffer. Only allocated when the
  // option is active — absent scene.solidWeightRamp means weightBuf stays
  // null for this render, `encodeGlyphBuffers` never receives a weight
  // buffer, and output is byte-identical to before this feature existed.
  let weightBuf: Uint16Array | null = null;
  if (weightRamp) {
    if (!scratch.weight || scratch.weight.length !== n) scratch.weight = new Uint16Array(n);
    weightBuf = scratch.weight;
    weightBuf.fill(0);
  }

  // Normalize the light direction once.
  const ld = directionalLight.direction;
  const ldLen = Math.hypot(ld[0], ld[1], ld[2]) || 1;
  const lx = ld[0] / ldLen, ly = ld[1] / ldLen, lz = ld[2] / ldLen;
  const keyIntensity = directionalLight.intensity ?? 1;
  const ambIntensity = ambientLight.intensity ?? 0.4;
  const keyRgb = hexToRgb(directionalLight.color ?? "#ffffff");
  const ambRgb = hexToRgb(ambientLight.color ?? "#ffffff");

  // Per-vertex normals for Gouraud shading. `null` when flat-shading.
  // Index: [polyIdx][vertIdx] → normalized Vec3.
  const vertexNormals = smoothShading && creaseAngle > 0
    ? computeVertexNormals(polygons, creaseAngle)
    : null;

  // Lit-color cache for this render. Meshes share a handful of distinct
  // base colors (palette buckets) and the shaded output is an 8-bit RGB hex
  // string, so per-triangle `hexToRgb` parsing + `toHex2` formatting is the
  // bulk of the color cost (≈doubles rasterize time at high poly counts).
  // Key on (color, intensity quantized to 8 bits) — lossless for 8-bit
  // output — and reuse the formatted string across all triangles that match.
  const litCache = new Map<string, string>();

  // Per-cell texture sampling: when a polygon carries a texture + UVs and its
  // sampler is available, the rasterizer samples the texture per cell (the
  // image at glyph resolution) instead of the flat baked color. Null → all flat.
  const textureSamplers = scene.textureSamplers ?? null;

  // Build shadow map (null when shadows are disabled or no casters).
  // Zero cost when scene.shadow is undefined.
  const shadowOpts = scene.shadow;
  const shadowMap: ShadowMapData | null = (shadowOpts != null && castShadowFlags.length > 0)
    ? buildShadowMap(polygons, castShadowFlags, lx, ly, lz)
    : null;
  const shadowOpacity = shadowOpts?.opacity ?? 0.25;
  const shadowLift = shadowOpts?.lift ?? 0.05;
  const shadowColorHex = shadowOpts?.color ?? "#000000";
  const shadowColorRgb: [number, number, number] = shadowMap ? hexToRgb(shadowColorHex) : [0, 0, 0];

  // Optional phase profiler: set globalThis.__glyphPerfDetail = {} to record
  // loop (shade+scanfill) vs string-build time. Zero cost when unset. Removable.
  const __detail = (globalThis as { __glyphPerfDetail?: { loop?: number[]; string?: number[] } }).__glyphPerfDetail;
  const __tLoop = __detail ? performance.now() : 0;

  // Reused scratch for per-polygon projected vertices, so a fan re-uses each
  // projection instead of re-projecting v0/v2 once per triangle (a quad fan
  // would otherwise project 6 corners for 4 unique verts).
  const projScratch: [number, number, number, number?][] = [];
  // Cross-frame shading cache (camera-invariant per-triangle intensities + lit
  // color). `triT` is a positional triangle index — incremented for every fan
  // triangle regardless of culling — so cache slots stay aligned frame to frame.
  const shadeCache = scene.shadeCache ?? null;
  let triT = -1;

  // Build a per-triangle shadow context from three world-space vertices. Used
  // for both whole triangles and near-clipped sub-triangles (whose vertices are
  // interpolated and so need fresh light-space UVs). Returns null when shadows
  // are off or the triangle's mesh doesn't receive them.
  const makeShadowCtx = (wa: Vec3, wb: Vec3, wc: Vec3, receive: boolean): ScanFillShadowCtx | null => {
    if (shadowMap === null || !receive) return null;
    const sm = shadowMap;
    const uvA = toLightUV(wa, sm.right[0], sm.right[1], sm.right[2], sm.up[0], sm.up[1], sm.up[2], sm.dir[0], sm.dir[1], sm.dir[2], sm.uMin, sm.uMax, sm.vMin, sm.vMax);
    const uvB = toLightUV(wb, sm.right[0], sm.right[1], sm.right[2], sm.up[0], sm.up[1], sm.up[2], sm.dir[0], sm.dir[1], sm.dir[2], sm.uMin, sm.uMax, sm.vMin, sm.vMax);
    const uvC = toLightUV(wc, sm.right[0], sm.right[1], sm.right[2], sm.up[0], sm.up[1], sm.up[2], sm.dir[0], sm.dir[1], sm.dir[2], sm.uMin, sm.uMax, sm.vMin, sm.vMax);
    return {
      map: sm,
      luA: uvA[0], lvA: uvA[1], ldA: uvA[2],
      luB: uvB[0], lvB: uvB[1], ldB: uvB[2],
      luC: uvC[0], lvC: uvC[1], ldC: uvC[2],
      lift: shadowLift,
      opacity: shadowOpacity,
      ambientIntensity: ambIntensity,
      shadowColorRgb,
      shadowColorHex,
      litCache,
    };
  };
  for (let polyIdx = 0; polyIdx < polygons.length; polyIdx++) {
    const poly = polygons[polyIdx]!;
    const verts = poly.vertices;
    if (verts.length < 3) continue;
    // Pre-transform vertices, parallel to `verts` — see `objectPosBuf`.
    const objVerts = poly.objectVertices ?? verts;
    // Owning-mesh id for the winner-mesh buffer (`objectExit`'s second sweep
    // restricts its farthest-depth scan to whichever mesh won each cell
    // here). `NO_MESH_ID_SUPPLIED` when the scene didn't supply `polygonMeshIds`
    // — distinct from the `-1` "no winner" sentinel; see its declaration.
    const meshId = polygonMeshIds ? polygonMeshIds[polyIdx]! : NO_MESH_ID_SUPPLIED;
    // Consumer-driven cull (e.g. BSP PVS): a hidden polygon is skipped before any
    // projection/shading/scan-fill. `triT` must still advance by this polygon's
    // triangle count so the positional cross-frame shadeCache stays aligned when
    // the hidden set changes between frames.
    if (poly.hidden) { triT += verts.length - 2; continue; }
    // Texture for this polygon: sample per cell when a sampler + matching UVs
    // exist; otherwise fall back to the flat per-face color.
    const polyUvs = poly.uvs && poly.uvs.length >= verts.length ? poly.uvs : null;
    let polySampler: TextureSampler | null = null;
    if (textureSamplers !== null && polyUvs) {
      const texUrl = polygonTexture(poly);
      if (texUrl) polySampler = textureSamplers.get(texUrl) ?? null;
    }
    // Project each unique vertex once.
    for (let k = 0; k < verts.length; k++) {
      projScratch[k] = camera.project(verts[k]! as Vec3, cols, rows, cellAspect, scaledMetrics);
    }
    // Fan-triangulate: (v[0], v[i], v[i+1]) for i in [1, N-2].
    // For N=3 this produces exactly one triangle.
    for (let fanIdx = 1; fanIdx < verts.length - 1; fanIdx++) {
      triT++;
      const vi0 = 0, vi1 = fanIdx, vi2 = fanIdx + 1;
      const v0 = verts[vi0]! as Vec3;
      const v1 = verts[vi1]! as Vec3;
      const v2 = verts[vi2]! as Vec3;
      const ov0 = objVerts[vi0]! as Vec3;
      const ov1 = objVerts[vi1]! as Vec3;
      const ov2 = objVerts[vi2]! as Vec3;

      const pa = projScratch[vi0]!;
      const pb = projScratch[vi1]!;
      const pc = projScratch[vi2]!;
      // A vertex behind the near plane projects to NaN. Count how many.
      // 3 → wholly behind, skip. 0 → wholly visible, fast path. 1–2 → the
      // triangle straddles the near plane and must be clipped (otherwise large
      // surfaces like floors vanish the moment one corner passes the eye).
      const nanCount =
        (pa[0] !== pa[0] ? 1 : 0) + (pb[0] !== pb[0] ? 1 : 0) + (pc[0] !== pc[0] ? 1 : 0);
      if (nanCount === 3) continue;

      // Off-grid cull (fast path): a fully-projected triangle whose screen-space
      // bounding box lies entirely outside the cell grid covers zero cells, so
      // its shading + scan-fill are pure waste. Skipping it is visually exact.
      // `triT` has already advanced, so the cross-frame shadeCache stays
      // positionally aligned. Straddling tris (nanCount 1–2) are clipped below
      // and can re-enter the grid, so they're never culled here. With the whole
      // BSP submitted every frame (no PVS), most of the level is off-screen at
      // any interior view — this is the bulk of the saved rasterize time.
      if (nanCount === 0) {
        const minX = Math.min(pa[0], pb[0], pc[0]);
        if (minX >= cols) continue;
        const maxX = Math.max(pa[0], pb[0], pc[0]);
        if (maxX < 0) continue;
        const minY = Math.min(pa[1], pb[1], pc[1]);
        if (minY >= rows) continue;
        const maxY = Math.max(pa[1], pb[1], pc[1]);
        if (maxY < 0) continue;
      }

      // Hoisted backface cull (fast path only — straddling triangles can't be
      // culled on NaN-bearing projected verts; their sub-triangles are culled
      // after clipping). `scanFillTriangle` also drops `area2 > 0`, but doing it
      // here skips the face normal, Lambert shading and shadow context below for
      // back faces (≈half a closed mesh).
      if (nanCount === 0 && !doubleSided) {
        const area2 = (pb[0] - pa[0]) * (pc[1] - pa[1]) - (pb[1] - pa[1]) * (pc[0] - pa[0]);
        if (area2 > 0) continue;
      }

      // Per-triangle shading — face normal → Lambert intensities → lit color —
      // is camera-invariant, so reuse it across frames via the optional
      // shadeCache (lazily filled by positional triangle index). On a camera-
      // only change (orbit/zoom drag) every populated entry is a hit; the scene
      // clears the cache when geometry, light, or shading options change.
      const shadeCacheHit = shadeCache !== null && shadeCache.iA[triT] !== undefined;
      let fnxN = 0, fnyN = 0, fnzN = 0;
      if (normalBuf !== null || !shadeCacheHit) {
        const ux = v1[0] - v0[0], uy = v1[1] - v0[1], uz = v1[2] - v0[2];
        const vvx = v2[0] - v0[0], vvy = v2[1] - v0[1], vvz = v2[2] - v0[2];
        const fnx = uy * vvz - uz * vvy;
        const fny = uz * vvx - ux * vvz;
        const fnz = ux * vvy - uy * vvx;
        const fnLen = Math.hypot(fnx, fny, fnz) || 1;
        fnxN = fnx / fnLen;
        fnyN = fny / fnLen;
        fnzN = fnz / fnLen;
      }
      // Object-space face normal (VOLUMETRIC-4.md "Phase 0"): same cross
      // product as the world normal above, but against the PRE-transform
      // `ov0/ov1/ov2` object vertices `objectPosBuf` already interpolates —
      // never against `v0/v1/v2`. This is deliberately the object-frame
      // GEOMETRIC normal with no inverse-transpose: under non-uniform scale
      // that would diverge from a true shading normal, but it is the exact
      // self-consistent pair for `objectPosition`/`objectExit`, which are
      // themselves plain (non-inverse-transformed) barycentric interpolations
      // of the same object vertices.
      let onxN = 0, onyN = 0, onzN = 0;
      if (objectNormalBuf !== null) {
        const oux = ov1[0] - ov0[0], ouy = ov1[1] - ov0[1], ouz = ov1[2] - ov0[2];
        const ovx = ov2[0] - ov0[0], ovy = ov2[1] - ov0[1], ovz = ov2[2] - ov0[2];
        const onx = ouy * ovz - ouz * ovy;
        const ony = ouz * ovx - oux * ovz;
        const onz = oux * ovy - ouy * ovx;
        const onLen = Math.hypot(onx, ony, onz) || 1;
        onxN = onx / onLen;
        onyN = ony / onLen;
        onzN = onz / onLen;
      }
      let iA: number, iB: number, iC: number;
      let litColor: string | null = null;
      if (shadeCacheHit && shadeCache !== null) {
        iA = shadeCache.iA[triT]!;
        iB = shadeCache.iB[triT]!;
        iC = shadeCache.iC[triT]!;
        litColor = shadeCache.lit[triT]!;
      } else {
        // Pick per-vertex normals. Smooth-shaded → look up from precomputed
        // table. Flat-shaded → all three vertices use the face normal.
        let nAx: number, nAy: number, nAz: number;
        let nBx: number, nBy: number, nBz: number;
        let nCx: number, nCy: number, nCz: number;
        if (vertexNormals) {
          const polyNormals = vertexNormals[polyIdx]!;
          const nA = polyNormals[vi0]!, nB = polyNormals[vi1]!, nC = polyNormals[vi2]!;
          nAx = nA[0]; nAy = nA[1]; nAz = nA[2];
          nBx = nB[0]; nBy = nB[1]; nBz = nB[2];
          nCx = nC[0]; nCy = nC[1]; nCz = nC[2];
        } else {
          nAx = nBx = nCx = fnxN;
          nAy = nBy = nCy = fnyN;
          nAz = nBz = nCz = fnzN;
        }

        // Per-vertex Lambert intensity (ambient + clamped key).
        // Convention (mirrors polycss / computeShapeLighting): `direction` is
        // the source vector from the surface toward the distant light.
        // lambert = max(0, dot(n, dir)).
        //
        // `doubleSided` controls visibility only. Lighting still uses the
        // polygon's authored normal; otherwise a wall's back side gets lit by
        // `abs(dot)` as if the surface were translucent.
        const dotA = nAx * lx + nAy * ly + nAz * lz;
        const dotB = nBx * lx + nBy * ly + nBz * lz;
        const dotC = nCx * lx + nCy * ly + nCz * lz;
        const lambertA = Math.max(0, dotA);
        const lambertB = Math.max(0, dotB);
        const lambertC = Math.max(0, dotC);
        iA = Math.min(1, ambIntensity + lambertA * keyIntensity);
        iB = Math.min(1, ambIntensity + lambertB * keyIntensity);
        iC = Math.min(1, ambIntensity + lambertC * keyIntensity);

        // Triangle color: tint poly.color by the AVERAGE of the three vertex
        // intensities. Keeping a single color per triangle preserves run-
        // coalescing in `solidBufToString` — a per-cell color would force one
        // <span> per cell and hurt innerHTML parse time. The intensity gradient
        // already lives in the glyph selection per cell.
        if (useColors) {
          const avgI = (iA + iB + iC) / 3;
          const avgKey = Math.max(0, avgI - ambIntensity);
          const baseColor = poly.color ?? "#ffffff";
          // Cache key: base color + intensity quantized to 0..255. Two triangles
          // with the same base and intensity-to-8-bits produce identical output.
          const q = (avgKey * 255) | 0;
          const cacheKey = `${baseColor}:${q}`;
          let cached = litCache.get(cacheKey);
          if (cached === undefined) {
            const triRgb = hexToRgb(baseColor); // memoized internally
            const tintR = ambIntensity * ambRgb[0] / 255 + avgKey * keyRgb[0] / 255;
            const tintG = ambIntensity * ambRgb[1] / 255 + avgKey * keyRgb[1] / 255;
            const tintB = ambIntensity * ambRgb[2] / 255 + avgKey * keyRgb[2] / 255;
            const litR = Math.min(255, triRgb[0] * tintR);
            const litG = Math.min(255, triRgb[1] * tintG);
            const litB = Math.min(255, triRgb[2] * tintB);
            cached = `#${toHex2(litR)}${toHex2(litG)}${toHex2(litB)}`;
            litCache.set(cacheKey, cached);
          }
          litColor = cached;
        }

        if (shadeCache !== null) {
          shadeCache.iA[triT] = iA;
          shadeCache.iB[triT] = iB;
          shadeCache.iC[triT] = iC;
          shadeCache.lit[triT] = litColor;
        }
      }

      const receiveShadow = receiveShadowFlags[polyIdx] ?? false;
      // Per-mesh depth bias (z-fight resolution): scale the screen-linear depth so
      // a biased mesh wins coincident/coplanar cells. Larger zbuf = nearer.
      const biasScale = 1 + (depthBiases?.[polyIdx] ?? 0);

      // Per-cell texture context for this triangle (null when not textured). The
      // tint is the same per-triangle light multiplier the flat path bakes into
      // litColor — here it shades each sampled texel instead of one base color.
      let surfaceUvCtx: ScanFillSurfaceUvCtx | null = null;
      if (surfaceUvBuf !== null && polyUvs) {
        const uvA = polyUvs[vi0]!, uvB = polyUvs[vi1]!, uvC = polyUvs[vi2]!;
        surfaceUvCtx = {
          ua: uvA[0], va: uvA[1], ub: uvB[0], vb: uvB[1], uc: uvC[0], vc: uvC[1],
        };
      }
      let texCtx: ScanFillTexCtx | null = null;
      if (polySampler !== null && polyUvs) {
        const uvA = polyUvs[vi0]!, uvB = polyUvs[vi1]!, uvC = polyUvs[vi2]!;
        const avgKey = Math.max(0, (iA + iB + iC) / 3 - ambIntensity);
        texCtx = {
          sampler: polySampler,
          ua: uvA[0], va: uvA[1], ub: uvB[0], vb: uvB[1], uc: uvC[0], vc: uvC[1],
          tintR: ambIntensity * ambRgb[0] / 255 + avgKey * keyRgb[0] / 255,
          tintG: ambIntensity * ambRgb[1] / 255 + avgKey * keyRgb[1] / 255,
          tintB: ambIntensity * ambRgb[2] / 255 + avgKey * keyRgb[2] / 255,
        };
      }

      if (nanCount === 0) {
        // Fully visible: scan-fill the projected triangle directly. Depth and
        // intensity are interpolated per cell via barycentric coordinates so
        // adjacent triangles on a curved surface never disagree at their edge.
        // Use the screen-space-linear z-buffer depth (4th element) so overlapping
        // triangles are ordered perspective-correctly; ortho omits it → fall back
        // to the linear depth, which is already screen-linear there.
        scanFillTriangle(
          pa[0], pa[1], (pa[3] ?? pa[2]) * biasScale, pa[3] ?? 1, iA,
          pb[0], pb[1], (pb[3] ?? pb[2]) * biasScale, pb[3] ?? 1, iB,
          pc[0], pc[1], (pc[3] ?? pc[2]) * biasScale, pc[3] ?? 1, iC,
          ramp, rampMax, litColor,
          glyphBuf, colorBuf, depthBuf, shadeBuf,
          cols, rows,
          makeShadowCtx(v0, v1, v2, receiveShadow),
          doubleSided,
          v0, v1, v2, worldPosBuf,
          ov0, ov1, ov2, objectPosBuf,
          fnxN, fnyN, fnzN, normalBuf,
          onxN, onyN, onzN, objectNormalBuf,
          surfaceUvCtx, surfaceUvBuf,
          depthEpsilon,
          texCtx,
          polyIdx,
          winnerPolygonBuf,
          albedoRgbBuf,
          targetRgbBuf,
          ambIntensity, ambRgb, keyRgb,
          poly.color ?? "#ffffff",
          weightRamp, weightBuf,
          meshId, winnerMeshBuf,
        );
      } else {
        // Straddles the near plane: clip the triangle to the visible half-space
        // (`eyeDepth > 0`) and scan-fill the resulting sub-triangles. The face
        // normal, colour and shading are unchanged by clipping; only positions
        // and per-vertex intensities are interpolated at the crossings.
        const cw: Vec3[] = [];
        // Clipped OBJECT-space verts, parallel to `cw` — same `e`/`t` crossings,
        // interpolated against `objTri` instead of `tri`, so a straddling
        // triangle's object position stays correct under near-plane clipping.
        const cow: Vec3[] | null = objectPosBuf ? [] : null;
        const ci: number[] = [];
        const cuv: Vec2[] | null = polyUvs ? [] : null;
        const tri: Vec3[] = [v0, v1, v2];
        const objTri: Vec3[] = [ov0, ov1, ov2];
        const triI = [iA, iB, iC];
        const triUv: [Vec2, Vec2, Vec2] | null = polyUvs
          ? [polyUvs[vi0]!, polyUvs[vi1]!, polyUvs[vi2]!]
          : null;
        const d0 = camera.eyeDepth(v0);
        const d1 = camera.eyeDepth(v1);
        const d2 = camera.eyeDepth(v2);
        const triD = [d0, d1, d2];
        for (let e = 0; e < 3; e++) {
          const n = (e + 1) % 3;
          const de = triD[e]!;
          const dn = triD[n]!;
          if (de > 0) {
            cw.push(tri[e]!);
            if (cow) cow.push(objTri[e]!);
            ci.push(triI[e]!);
            if (cuv && triUv) cuv.push(triUv[e]!);
          }
          if ((de > 0) !== (dn > 0)) {
            const t = de / (de - dn);
            const ve = tri[e]!, vn = tri[n]!;
            cw.push([
              ve[0] + t * (vn[0] - ve[0]),
              ve[1] + t * (vn[1] - ve[1]),
              ve[2] + t * (vn[2] - ve[2]),
            ] as Vec3);
            if (cow) {
              const oe = objTri[e]!, on = objTri[n]!;
              cow.push([
                oe[0] + t * (on[0] - oe[0]),
                oe[1] + t * (on[1] - oe[1]),
                oe[2] + t * (on[2] - oe[2]),
              ] as Vec3);
            }
            ci.push(triI[e]! + t * (triI[n]! - triI[e]!));
            if (cuv && triUv) {
              const ue = triUv[e]!, un = triUv[n]!;
              cuv.push([
                ue[0] + t * (un[0] - ue[0]),
                ue[1] + t * (un[1] - ue[1]),
              ]);
            }
          }
        }
        if (cw.length >= 3) {
          const cp = cw.map((w) => camera.project(w, cols, rows, cellAspect, scaledMetrics));
          for (let f = 1; f < cw.length - 1; f++) {
            const qa = cp[0]!, qb = cp[f]!, qc = cp[f + 1]!;
            const area2c = (qb[0] - qa[0]) * (qc[1] - qa[1]) - (qb[1] - qa[1]) * (qc[0] - qa[0]);
            if (!doubleSided && area2c > 0) continue;
            const clippedUvCtx: ScanFillSurfaceUvCtx | null = surfaceUvBuf !== null && cuv
              ? {
                  ua: cuv[0]![0], va: cuv[0]![1],
                  ub: cuv[f]![0], vb: cuv[f]![1],
                  uc: cuv[f + 1]![0], vc: cuv[f + 1]![1],
                }
              : null;
            scanFillTriangle(
              qa[0], qa[1], (qa[3] ?? qa[2]) * biasScale, qa[3] ?? 1, ci[0]!,
              qb[0], qb[1], (qb[3] ?? qb[2]) * biasScale, qb[3] ?? 1, ci[f]!,
              qc[0], qc[1], (qc[3] ?? qc[2]) * biasScale, qc[3] ?? 1, ci[f + 1]!,
              ramp, rampMax, litColor,
              glyphBuf, colorBuf, depthBuf, shadeBuf,
              cols, rows,
              makeShadowCtx(cw[0]!, cw[f]!, cw[f + 1]!, receiveShadow),
              doubleSided,
              cw[0]!, cw[f]!, cw[f + 1]!, worldPosBuf,
              cow ? cow[0]! : ov0, cow ? cow[f]! : ov1, cow ? cow[f + 1]! : ov2, objectPosBuf,
              fnxN, fnyN, fnzN, normalBuf,
              onxN, onyN, onzN, objectNormalBuf,
              clippedUvCtx, surfaceUvBuf,
              depthEpsilon,
              // Near-plane-clipped sub-triangles do not yet rebuild the bitmap
              // texture sampling context; fall back to flat color for that rare
              // eye-straddling case. Surface-effect UVs remain available above.
              null,
              polyIdx,
              winnerPolygonBuf,
              albedoRgbBuf,
              targetRgbBuf,
              ambIntensity, ambRgb, keyRgb,
              poly.color ?? "#ffffff",
              weightRamp, weightBuf,
              meshId, winnerMeshBuf,
            );
          }
        }
      }
    }
  }

  // Cross-layer occlusion: blank any cell whose own surface is behind the shared
  // nearest-depth (another layer occludes it). Done on the cell buffers (pre-string)
  // so it works for plain text AND colored spans; clearing depth lets the
  // supersample downsample skip the blanked subcells.
  const occ = scene.occlusion;
  if (occ) {
    const idm = occ.idMap, ocols = occ.cols, orows = occ.rows, myId = occ.layerId;
    const invSS = supersample > 1 ? 1 / supersample : 1;
    for (let r = 0; r < rows; r++) {
      const refRow = Math.floor(occ.rowScale * (r * invSS) + occ.rowOffset);
      if (refRow < 0 || refRow >= orows) continue;
      const refRowBase = refRow * ocols;
      const rowBase = r * cols;
      for (let c = 0; c < cols; c++) {
        const idx = rowBase + c;
        if (depthBuf[idx] === -Infinity) continue;
        const refCol = Math.floor(occ.colScale * (c * invSS) + occ.colOffset);
        if (refCol < 0 || refCol >= ocols) continue;
        const owner = idm[refRowBase + refCol]!;
        // A different layer is nearest here → this cell is occluded. Owner === myId
        // (or empty) → keep; a layer never occludes itself.
        if (owner !== -1 && owner !== myId) {
          glyphBuf[idx] = " ";
          depthBuf[idx] = -Infinity;
          if (shadeBuf) shadeBuf[idx] = NaN;
          if (colorBuf) colorBuf[idx] = null;
          if (worldPosBuf) {
            worldPosBuf[idx * 3] = NaN;
            worldPosBuf[idx * 3 + 1] = NaN;
            worldPosBuf[idx * 3 + 2] = NaN;
          }
          if (objectPosBuf) {
            objectPosBuf[idx * 3] = NaN;
            objectPosBuf[idx * 3 + 1] = NaN;
            objectPosBuf[idx * 3 + 2] = NaN;
          }
          if (normalBuf) {
            normalBuf[idx * 3] = NaN;
            normalBuf[idx * 3 + 1] = NaN;
            normalBuf[idx * 3 + 2] = NaN;
          }
          if (objectNormalBuf) {
            objectNormalBuf[idx * 3] = NaN;
            objectNormalBuf[idx * 3 + 1] = NaN;
            objectNormalBuf[idx * 3 + 2] = NaN;
          }
          if (surfaceUvBuf) {
            surfaceUvBuf[idx * 2] = NaN;
            surfaceUvBuf[idx * 2 + 1] = NaN;
          }
          if (winnerPolygonBuf) winnerPolygonBuf[idx] = -1;
          if (winnerMeshBuf) winnerMeshBuf[idx] = -1;
          if (albedoRgbBuf) albedoRgbBuf[idx] = 0;
          if (targetRgbBuf) targetRgbBuf[idx] = 0;
          if (weightBuf) weightBuf[idx] = 0;
        }
      }
    }
  }

  // Second sweep — `objectExit` (see VOLUMETRIC.md "Step 1"): the farthest
  // intersection of the depth-winning mesh along each cell's view ray, in
  // that mesh's own pre-transform frame. Cannot be produced inside the pass
  // above (the winner is only final after the last polygon, and back faces
  // never reach scan-fill there at all — they're culled before it). Runs at
  // this pass's supersample resolution, gated per cell by `winnerMeshBuf` so
  // a farther, non-winning mesh's back face never leaks in. Allocated and
  // run ONLY when a mounted effect's requirement asked for it.
  let exitPosBuf: Float32Array | null = null;
  if (scene.retainObjectExit && winnerMeshBuf !== null) {
    if (!scratch.objectExit || scratch.objectExit.length !== n * 3) {
      scratch.objectExit = new Float32Array(n * 3);
    }
    exitPosBuf = scratch.objectExit;
    exitPosBuf.fill(NaN);
    if (!scratch.objectExitDepth || scratch.objectExitDepth.length !== n) {
      scratch.objectExitDepth = new Float64Array(n);
    }
    const exitDepthBuf = scratch.objectExitDepth;
    exitDepthBuf.fill(Infinity);
    rasterizeObjectExit(
      polygons, polygonMeshIds ?? null, camera, cols, rows, cellAspect, scaledMetrics,
      winnerMeshBuf, depthBiases, depthEpsilon, exitPosBuf, exitDepthBuf,
    );
  }

  if (__detail) { (__detail.loop ??= []).push(performance.now() - __tLoop); }
  const __tStr = __detail ? performance.now() : 0;
  // Final output buffers at the OUTPUT resolution (downsampled if supersampling).
  let finalGlyph = glyphBuf;
  let finalColor = colorBuf;
  let finalDepth = depthBuf;
  let finalShade: Float32Array | null = shadeBuf;
  let finalWorldPos: Float32Array | null = worldPosBuf;
  let finalObjectPos: Float32Array | null = objectPosBuf;
  let finalExitPos: Float32Array | null = exitPosBuf;
  let finalNormal: Float32Array | null = normalBuf;
  let finalObjectNormal: Float32Array | null = objectNormalBuf;
  let finalSurfaceUv: Float32Array | null = surfaceUvBuf;
  let finalWinnerPolygon: Int32Array | null = winnerPolygonBuf;
  let finalAlbedoRgb: Uint32Array | null = albedoRgbBuf;
  let finalTargetRgb: Uint32Array | null = targetRgbBuf;
  let finalWeight: Uint16Array | null = weightBuf;
  // Exposed on `CellGrid.winnerMesh` whenever the buffer above was actually
  // allocated (`retainWinnerMesh` for per-object targeting OR
  // `retainObjectExit` for every carve/volumetric-subcell effect — see the
  // allocation comment above for why `retainObjectExit` alone must expose
  // it too, as of VOLUMETRIC-3.md Phase 2).
  let finalWinnerMesh: Int32Array | null = (scene.retainWinnerMesh || scene.retainObjectExit) ? winnerMeshBuf : null;
  if (supersample > 1 && wantsHalfblockSolid(scene)) {
    // Two-color (`▀`/`▄`/`█`) encoding straight from the raw supersampled
    // subcells — see `encodeHalfblockSolid` for the per-cell decision table
    // and `encodeGlyphBuffersDual` (cells.ts) for the span/dedupe rules. This
    // terminates the function here: `reproject` and `transformCells` are both
    // guaranteed false by `wantsHalfblockSolid`, so the single-color
    // downsample/TAA/hook machinery below is never reached for this cell path.
    const out = encodeHalfblockSolid(colorBuf, depthBuf, outCols, outRows, supersample, useColors, scene.colorTolerance);
    if (__detail) { (__detail.string ??= []).push(performance.now() - __tStr); }
    return out;
  }
  if (supersample > 1 && wantsQuadrantSolid(scene)) {
    // Four-color-region (16-glyph quadrant) encoding straight from the raw
    // supersampled subcells — see `encodeQuadrantSolid`. Same early-return
    // shape as the halfblock branch above: `wantsQuadrantSolid` already
    // guarantees no `transformCells`/reprojection, so the downsample/TAA/hook
    // machinery below is never reached for this cell path.
    const out = encodeQuadrantSolid(colorBuf, depthBuf, outCols, outRows, supersample, useColors, scene.colorTolerance);
    if (__detail) { (__detail.string ??= []).push(performance.now() - __tStr); }
    return out;
  }
  if (supersample > 1) {
    const ds = downsampleSolid(
      glyphBuf,
      colorBuf,
      depthBuf,
      shadeBuf,
      worldPosBuf,
      normalBuf,
      surfaceUvBuf,
      winnerPolygonBuf,
      albedoRgbBuf,
      targetRgbBuf,
      outCols,
      outRows,
      supersample,
      ramp,
      objectPosBuf,
      weightRamp,
      exitPosBuf,
      finalWinnerMesh,
      objectNormalBuf,
    );
    finalGlyph = ds.glyphBuf;
    finalColor = ds.colorBuf;
    finalDepth = ds.depth;
    finalShade = ds.shade;
    finalWorldPos = ds.worldPos;
    finalNormal = ds.normal;
    finalObjectNormal = ds.objectNormal;
    finalSurfaceUv = ds.surfaceUv;
    finalWinnerPolygon = ds.winnerPolygon;
    finalAlbedoRgb = ds.albedoRgb;
    finalTargetRgb = ds.targetRgb;
    finalObjectPos = ds.objectPos;
    finalExitPos = ds.exitPos;
    finalWeight = ds.weight;
    finalWinnerMesh = ds.winnerMesh;
  }
  if (reproject) {
    applyReprojectionTAA(finalGlyph, finalColor, finalWorldPos!, outCols, outRows, cellAspect, metrics, ramp, scene.temporalBlend, scene.temporalHistory!, rawCamera);
    // `solidWeightRamp` is a documented no-op under active temporal-blend
    // reprojection: `applyReprojectionTAA` blends ramp INDEX continuously
    // across frames and has no notion of a parallel weight lookup, so
    // forwarding a stale weight buffer here would desync it from the
    // reprojected glyph. Drop it — same precedent as `charMode: "halfblock"`
    // being a no-op alongside `temporalBlend` reprojection.
    finalWeight = null;
  }
  // Post-rasterize cell hook (M4 composition effects). No-op + byte-identical
  // when scene.transformCells is absent (block skipped entirely). Output-res
  // depth/surface fields share one representative winner after downsampling.
  // Runs BEFORE the single string is built (<pre>-write-once).
  if (scene.transformCells) {
    const applied = applyCellHook(
      scene.transformCells, finalGlyph, finalColor,
      finalDepth, outCols, outRows, finalSurfaceUv, finalShade,
      finalWorldPos, finalNormal,
      finalWinnerPolygon,
      finalAlbedoRgb,
      finalTargetRgb,
      finalObjectPos,
      finalWeight,
      finalExitPos,
      finalWinnerMesh,
      finalObjectNormal,
    );
    finalGlyph = applied.char;
    finalColor = applied.color;
    finalWeight = applied.weight;
  }
  // `finalWeight` is non-null only when `solidWeightRamp` is active (and
  // temporal reprojection didn't drop it) — the byte-identical default path
  // (`finalWeight === null`) keeps using the original unweighted encoder.
  const out = finalWeight
    ? encodeGlyphBuffers(finalGlyph, finalColor ?? new Array(outCols * outRows).fill(null), outCols, outRows, useColors, finalWeight, scene.colorTolerance)
    : solidBufToString(finalGlyph, finalColor, outCols, outRows, !!scene.transformCells, scene.colorTolerance);
  if (__detail) { (__detail.string ??= []).push(performance.now() - __tStr); }
  return out;
}

/**
 * Reprojection temporal AA. The plain blend ghosts during motion because it
 * mixes cells at fixed screen positions while the world scrolled underneath.
 * Here we blend each cell with where its WORLD point was in the previous frame:
 * project the cell's world position with the previous camera, sample the history
 * there, and exponentially blend. A static surface keeps a coherent colour as it
 * scrolls across the grid → the per-frame colour crawl disappears, without
 * smearing (the history follows the surface, not the screen).
 */
function applyReprojectionTAA(
  glyphBuf: string[],
  colorBuf: (string | null)[] | null,
  worldPos: Float32Array,
  cols: number,
  rows: number,
  cellAspect: number,
  metrics: GlyphProjectionMetrics,
  ramp: string[],
  blend: number,
  H: TemporalHistory,
  curCam: {
    kind: "perspective" | "orthographic";
    rotX: number; rotY: number; target: Vec3; zoom: number;
    perspective: number; distance: number; stretch: number; fovScale: number;
    center: [number, number];
  },
): void {
  const n = cols * rows;
  const rampMax = ramp.length - 1;
  const rampIndex = new Map<string, number>();
  for (let i = 0; i < ramp.length; i++) rampIndex.set(ramp[i]!, i);

  // (Re)allocate history on size change; no previous frame to reproject from yet.
  let prevCam = H.cam;
  if (H.cols !== cols || H.rows !== rows || H.idx.length !== n) {
    H.cols = cols; H.rows = rows;
    H.idx = new Float32Array(n); H.r = new Float32Array(n); H.g = new Float32Array(n); H.b = new Float32Array(n);
    prevCam = null;
  }

  // Build a projector for the previous frame's camera to reproject world points.
  let reproj: ((w: Vec3) => [number, number, number, number?]) | null = null;
  if (prevCam) {
    const pc = prevCam.kind === "orthographic"
      ? createGlyphOrthographicCamera({
          rotX: prevCam.rotX, rotY: prevCam.rotY, zoom: prevCam.zoom,
          center: prevCam.center,
        })
      : createGlyphPerspectiveCamera({
          rotX: prevCam.rotX, rotY: prevCam.rotY, distance: prevCam.distance,
          perspective: prevCam.perspective, zoom: prevCam.zoom, stretch: prevCam.stretch,
          fovScale: prevCam.fovScale, center: prevCam.center,
        });
    pc.target = prevCam.target;
    pc.fovScale = prevCam.fovScale;
    reproj = (w: Vec3) => pc.project(w, cols, rows, cellAspect, prevCam.metrics);
  }

  // Read current cell value, blend with the reprojected history, write back +
  // store as new history. We write into temp arrays first so reprojection always
  // samples the *previous* frame, never this frame's already-blended cells.
  const nIdx = new Float32Array(n), nR = new Float32Array(n), nG = new Float32Array(n), nB = new Float32Array(n);
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const i = row * cols + col;
      const idxNow = rampIndex.get(glyphBuf[i]!) ?? 0;
      let rNow = 0, gNow = 0, bNow = 0;
      const c = colorBuf ? colorBuf[i] : null;
      if (c) { const rgb = hexToRgb(c); rNow = rgb[0]; gNow = rgb[1]; bNow = rgb[2]; }

      let b = 0; // effective history weight (0 when no valid reprojection)
      let hIdx = 0, hR = 0, hG = 0, hB = 0;
      const wx = worldPos[i * 3]!;
      if (reproj && wx === wx) { // wx===wx → not NaN (cell has a surface)
        const p = reproj([wx, worldPos[i * 3 + 1]!, worldPos[i * 3 + 2]!]);
        const pcCol = Math.round(p[0]), pcRow = Math.round(p[1]);
        if (p[0] === p[0] && pcCol >= 0 && pcCol < cols && pcRow >= 0 && pcRow < rows) {
          const j = pcRow * cols + pcCol;
          hIdx = H.idx[j]!; hR = H.r[j]!; hG = H.g[j]!; hB = H.b[j]!;
          b = blend;
        }
      }
      const cur = 1 - b;
      const bi = cur * idxNow + b * hIdx;
      const br = cur * rNow + b * hR;
      const bg = cur * gNow + b * hG;
      const bb = cur * bNow + b * hB;
      nIdx[i] = bi; nR[i] = br; nG[i] = bg; nB[i] = bb;
      let gi = Math.round(bi);
      if (gi < 0) gi = 0; else if (gi > rampMax) gi = rampMax;
      glyphBuf[i] = ramp[gi]!;
      if (colorBuf) colorBuf[i] = gi === 0 ? null : `#${toHex2(br)}${toHex2(bg)}${toHex2(bb)}`;
    }
  }
  H.idx = nIdx; H.r = nR; H.g = nG; H.b = nB;
  H.cam = {
    kind: curCam.kind,
    rotX: curCam.rotX, rotY: curCam.rotY,
    target: [curCam.target[0]!, curCam.target[1]!, curCam.target[2]!],
    zoom: curCam.zoom, perspective: curCam.perspective, distance: curCam.distance,
    stretch: curCam.stretch, fovScale: curCam.fovScale,
    center: [curCam.center[0], curCam.center[1]],
    metrics: { ...metrics },
  };
}

/**
 * Box-downsample the S×-oversampled glyph + colour buffers to the output grid.
 * For each output cell: average the ramp index over all S² subcells (empty
 * subcells count as 0 → partial coverage dims the cell, anti-aliasing edges),
 * and average the RGB of the covered subcells. The result is a single glyph +
 * colour per output cell whose value moves continuously as geometry shifts,
 * instead of snapping to a single sub-cell winner.
 */
function downsampleSolid(
  glyphBuf: string[],
  colorBuf: (string | null)[] | null,
  depthBuf: Float64Array,
  shadeBuf: Float32Array | null,
  worldPosIn: Float32Array | null,
  normalIn: Float32Array | null,
  surfaceUvIn: Float32Array | null,
  winnerPolygonIn: Int32Array | null,
  albedoRgbIn: Uint32Array | null,
  targetRgbIn: Uint32Array | null,
  outCols: number,
  outRows: number,
  S: number,
  ramp: string[],
  objectPosIn: Float32Array | null = null,
  // `solidWeightRamp` (opt-in): same darkest→densest index as `ramp`. The
  // downsampled weight is looked up from the coverage-weighted averaged
  // ramp index `gi` (the SAME index that picks `og[oi]`'s glyph) rather than
  // a representative subcell's own weight, so a cell's glyph and its
  // `font-weight` always describe the same ramp step — never a glyph from
  // one step paired with the weight of another. `null` → no weight buffer.
  weightRamp: Uint16Array | null = null,
  // `objectExit` (opt-in): downsampled from the SAME representative subcell
  // as `objectPosIn` — the exit sweep is gated by the entry pass's own
  // winner buffer, so entry and exit always describe one subcell's ray.
  exitPosIn: Float32Array | null = null,
  // `retainWinnerMesh` (opt-in): downsampled from the SAME representative
  // subcell as every other winner-keyed field above — see
  // VOLUMETRIC-3.md §1's winner-mesh plumbing checklist. `null` → no
  // winnerMesh buffer (byte-identical to before this option existed).
  winnerMeshIn: Int32Array | null = null,
  // `objectNormal` (opt-in, VOLUMETRIC-4.md "Phase 0"): downsampled from the
  // SAME representative subcell as `objectPosIn`/`exitPosIn`/`normalIn` —
  // they must all agree subcell-for-subcell.
  objectNormalIn: Float32Array | null = null,
): {
  glyphBuf: string[];
  colorBuf: (string | null)[] | null;
  depth: Float64Array;
  shade: Float32Array | null;
  worldPos: Float32Array | null;
  normal: Float32Array | null;
  objectNormal: Float32Array | null;
  surfaceUv: Float32Array | null;
  winnerPolygon: Int32Array | null;
  albedoRgb: Uint32Array | null;
  targetRgb: Uint32Array | null;
  objectPos: Float32Array | null;
  weight: Uint16Array | null;
  exitPos: Float32Array | null;
  winnerMesh: Int32Array | null;
} {
  const rampIndex = new Map<string, number>();
  for (let i = 0; i < ramp.length; i++) rampIndex.set(ramp[i]!, i);
  const rampMax = ramp.length - 1;
  const inCols = outCols * S;
  const og: string[] = new Array(outCols * outRows).fill(" ");
  const oc: (string | null)[] | null = colorBuf ? new Array(outCols * outRows).fill(null) : null;
  const od = new Float64Array(outCols * outRows);
  od.fill(-Infinity);
  const os: Float32Array | null = shadeBuf ? new Float32Array(outCols * outRows).fill(NaN) : null;
  const ow: Float32Array | null = worldPosIn ? new Float32Array(outCols * outRows * 3).fill(NaN) : null;
  const on: Float32Array | null = normalIn ? new Float32Array(outCols * outRows * 3).fill(NaN) : null;
  const oon: Float32Array | null = objectNormalIn ? new Float32Array(outCols * outRows * 3).fill(NaN) : null;
  const ouv: Float32Array | null = surfaceUvIn ? new Float32Array(outCols * outRows * 2).fill(NaN) : null;
  const owinner: Int32Array | null = winnerPolygonIn ? new Int32Array(outCols * outRows).fill(-1) : null;
  const oalbedo: Uint32Array | null = albedoRgbIn ? new Uint32Array(outCols * outRows) : null;
  const otarget: Uint32Array | null = targetRgbIn ? new Uint32Array(outCols * outRows) : null;
  const oobj: Float32Array | null = objectPosIn ? new Float32Array(outCols * outRows * 3).fill(NaN) : null;
  const oexit: Float32Array | null = exitPosIn ? new Float32Array(outCols * outRows * 3).fill(NaN) : null;
  const oweight: Uint16Array | null = weightRamp ? new Uint16Array(outCols * outRows) : null;
  const owinnerMesh: Int32Array | null = winnerMeshIn ? new Int32Array(outCols * outRows).fill(-1) : null;
  const inv = 1 / (S * S);
  for (let oy = 0; oy < outRows; oy++) {
    for (let ox = 0; ox < outCols; ox++) {
      let idxSum = 0, shadeSum = 0, cov = 0, r = 0, g = 0, b = 0;
      let representativeDistance = Infinity;
      let representative = -1;
      for (let sy = 0; sy < S; sy++) {
        const base = (oy * S + sy) * inCols + ox * S;
        for (let sx = 0; sx < S; sx++) {
          const si = base + sx;
          // Coverage comes from the depth buffer, not the glyph: `ramp[0]` is a
          // space, so a covered-but-dim subcell looks identical to an empty one
          // in `glyphBuf`. Using depth keeps dim surfaces (and their colour).
          if (depthBuf[si] === -Infinity) continue;
          idxSum += rampIndex.get(glyphBuf[si]!) ?? 0;
          if (os) shadeSum += shadeBuf![si]!;
          cov++;
          if (oc) { const c = colorBuf![si]; if (c) { const rgb = hexToRgb(c); r += rgb[0]; g += rgb[1]; b += rgb[2]; } }
          const dx = sx - (S - 1) / 2;
          const dy = sy - (S - 1) / 2;
          const distance = dx * dx + dy * dy;
          if (distance < representativeDistance) {
            representativeDistance = distance;
            representative = si;
          }
        }
      }
      const oi = oy * outCols + ox;
      if (cov === 0) continue; // stays space
      let gi = Math.round(idxSum * inv); // coverage-weighted intensity (empty subcells = 0)
      if (gi < 0) gi = 0; else if (gi > rampMax) gi = rampMax;
      og[oi] = ramp[gi]!;
      if (oweight) oweight[oi] = weightRamp![gi] ?? 0;
      od[oi] = depthBuf[representative]!;
      if (os) os[oi] = shadeSum * inv;
      if (oc) oc[oi] = `#${toHex2(r / cov)}${toHex2(g / cov)}${toHex2(b / cov)}`;
      if (ow && representative >= 0) {
        ow[oi * 3] = worldPosIn![representative * 3]!;
        ow[oi * 3 + 1] = worldPosIn![representative * 3 + 1]!;
        ow[oi * 3 + 2] = worldPosIn![representative * 3 + 2]!;
      }
      if (on && representative >= 0) {
        on[oi * 3] = normalIn![representative * 3]!;
        on[oi * 3 + 1] = normalIn![representative * 3 + 1]!;
        on[oi * 3 + 2] = normalIn![representative * 3 + 2]!;
      }
      if (oon && representative >= 0) {
        oon[oi * 3] = objectNormalIn![representative * 3]!;
        oon[oi * 3 + 1] = objectNormalIn![representative * 3 + 1]!;
        oon[oi * 3 + 2] = objectNormalIn![representative * 3 + 2]!;
      }
      if (ouv && representative >= 0) {
        ouv[oi * 2] = surfaceUvIn![representative * 2]!;
        ouv[oi * 2 + 1] = surfaceUvIn![representative * 2 + 1]!;
      }
      if (owinner && representative >= 0) owinner[oi] = winnerPolygonIn![representative]!;
      if (oalbedo && representative >= 0) oalbedo[oi] = albedoRgbIn![representative]!;
      if (otarget && representative >= 0) otarget[oi] = targetRgbIn![representative]!;
      if (oobj && representative >= 0) {
        oobj[oi * 3] = objectPosIn![representative * 3]!;
        oobj[oi * 3 + 1] = objectPosIn![representative * 3 + 1]!;
        oobj[oi * 3 + 2] = objectPosIn![representative * 3 + 2]!;
      }
      if (oexit && representative >= 0) {
        oexit[oi * 3] = exitPosIn![representative * 3]!;
        oexit[oi * 3 + 1] = exitPosIn![representative * 3 + 1]!;
        oexit[oi * 3 + 2] = exitPosIn![representative * 3 + 2]!;
      }
      if (owinnerMesh && representative >= 0) owinnerMesh[oi] = winnerMeshIn![representative]!;
    }
  }
  return { glyphBuf: og, colorBuf: oc, depth: od, shade: os, worldPos: ow, normal: on, objectNormal: oon, surfaceUv: ouv, winnerPolygon: owinner, albedoRgb: oalbedo, targetRgb: otarget, objectPos: oobj, weight: oweight, exitPos: oexit, winnerMesh: owinnerMesh };
}

/**
 * `charMode: "halfblock"` (B4): pack TWO independently colored subcells into
 * one output cell instead of averaging them into a single shade, buying 2×
 * vertical color resolution at the cost of coarser shape (the mirror
 * trade-off to braille, which buys shape at one color per cell — see the
 * `charMode` doc). `S` (the forced-even supersample factor) subcell ROWS
 * split evenly: `[0, S/2)` is "top", `[S/2, S)` is "bottom"; each half is
 * independently box-averaged over its `S/2 × S` subcells, exactly like
 * `downsampleSolid`'s single average but computed twice.
 *
 * Coverage (not glyph) again drives whether a subcell counts, so a dim but
 * covered subcell is never mistaken for empty. Per output cell:
 *  - neither half covered → `" "`, no color, no background: a cell with no
 *    geometry must never paint an opaque rectangle.
 *  - both halves covered, SAME resolved color (common on a flat-shaded
 *    surface, and after the 8-bit lit-color cache collapses near-identical
 *    shades) → `█` (full block) with just `color` set — no `background-color`
 *    at all, saving a style property and letting the cell merge into a
 *    same-color run exactly like the ASCII solid path.
 *  - both halves covered, DIFFERENT colors → `▀` with `color` = the TOP
 *    subcell's average (the glyph's own ink) and `background-color` = the
 *    BOTTOM subcell's average (the rest of the cell box) — this is the
 *    literal "two pixels, one cell" case video-to-ascii-style renderers use.
 *  - only one half covered → the half-block glyph for THAT half (`▀` top-
 *    only, `▄` bottom-only) with its color as the foreground and no
 *    background — the uncovered half shows through to the page/`<pre>`
 *    background instead of a painted rectangle.
 *
 * Terminal (not fed through `downsampleSolid`/reprojection/`transformCells` —
 * see `wantsHalfblockSolid`): builds the final string directly via
 * `encodeGlyphBuffersDual` (cells.ts), which is a sibling encoder to
 * `encodeGlyphBuffers` and does not extend the shared {@link CellGrid}
 * contract — the `transformCells` hook and the generic effect compositor
 * stay exactly as one-color-per-cell as they are today.
 */
export function encodeHalfblockSolid(
  colorBuf: (string | null)[] | null,
  depthBuf: Float64Array,
  outCols: number,
  outRows: number,
  S: number,
  useColors: boolean,
  colorTolerance = 0,
): string {
  const inCols = outCols * S;
  const half = S / 2; // S is forced even by `rasterize()` whenever this path is taken.
  const n = outCols * outRows;
  const charBuf: string[] = new Array(n);
  const fgBuf: (string | null)[] = new Array(n).fill(null);
  const bgBuf: (string | null)[] = new Array(n).fill(null);

  for (let oy = 0; oy < outRows; oy++) {
    for (let ox = 0; ox < outCols; ox++) {
      let topCov = 0, topR = 0, topG = 0, topB = 0;
      let botCov = 0, botR = 0, botG = 0, botB = 0;
      for (let sy = 0; sy < S; sy++) {
        const base = (oy * S + sy) * inCols + ox * S;
        const isTop = sy < half;
        for (let sx = 0; sx < S; sx++) {
          const si = base + sx;
          if (depthBuf[si] === -Infinity) continue;
          if (isTop) {
            topCov++;
            if (colorBuf) { const c = colorBuf[si]; if (c) { const rgb = hexToRgb(c); topR += rgb[0]; topG += rgb[1]; topB += rgb[2]; } }
          } else {
            botCov++;
            if (colorBuf) { const c = colorBuf[si]; if (c) { const rgb = hexToRgb(c); botR += rgb[0]; botG += rgb[1]; botB += rgb[2]; } }
          }
        }
      }
      const oi = oy * outCols + ox;
      if (topCov === 0 && botCov === 0) {
        charBuf[oi] = " ";
        continue;
      }
      const topColor = useColors && topCov > 0
        ? `#${toHex2(topR / topCov)}${toHex2(topG / topCov)}${toHex2(topB / topCov)}`
        : null;
      const botColor = useColors && botCov > 0
        ? `#${toHex2(botR / botCov)}${toHex2(botG / botCov)}${toHex2(botB / botCov)}`
        : null;
      if (topCov > 0 && botCov > 0) {
        if (!useColors || topColor === botColor) {
          charBuf[oi] = "█";
          fgBuf[oi] = topColor;
        } else {
          charBuf[oi] = "▀";
          fgBuf[oi] = topColor;
          bgBuf[oi] = botColor;
        }
      } else if (topCov > 0) {
        charBuf[oi] = "▀";
        fgBuf[oi] = topColor;
      } else {
        charBuf[oi] = "▄";
        fgBuf[oi] = botColor;
      }
    }
  }
  return encodeGlyphBuffersDual(charBuf, fgBuf, bgBuf, outCols, outRows, useColors, colorTolerance);
}

/** Quadrant bit ordering: TL/TR/BL/BR, matching the classic sixel/chafa quadrant convention. */
const QUAD_TL = 1;
const QUAD_TR = 2;
const QUAD_BL = 4;
const QUAD_BR = 8;

/**
 * Coverage-mask → Unicode quadrant glyph. All 16 combinations exist as real
 * codepoints — the empty and full masks reuse the plain space/`█` (`FULL
 * BLOCK`) rather than a "quadrant" variant, so a fully (or emptily) covered
 * quadrant cell still merges into a same-glyph run with ordinary solid-mode
 * or halfblock output. The other 14 are the Block Elements quadrant set
 * (U+2596..U+259F) plus the two half-block glyphs (`▀`/`▌`/`▐`/`▄`) halfblock
 * mode also uses — half-block's top/bottom split is a strict SUBSET of this
 * table (masks `TL|TR` and `BL|BR`).
 */
const QUADRANT_GLYPHS: Record<number, string> = {
  0: " ",
  [QUAD_TL]: "▘",
  [QUAD_TR]: "▝",
  [QUAD_TL | QUAD_TR]: "▀",
  [QUAD_BL]: "▖",
  [QUAD_TL | QUAD_BL]: "▌",
  [QUAD_TR | QUAD_BL]: "▞",
  [QUAD_TL | QUAD_TR | QUAD_BL]: "▛",
  [QUAD_BR]: "▗",
  [QUAD_TL | QUAD_BR]: "▚",
  [QUAD_TR | QUAD_BR]: "▐",
  [QUAD_TL | QUAD_TR | QUAD_BR]: "▜",
  [QUAD_BL | QUAD_BR]: "▄",
  [QUAD_TL | QUAD_BL | QUAD_BR]: "▙",
  [QUAD_TR | QUAD_BL | QUAD_BR]: "▟",
  [QUAD_TL | QUAD_TR | QUAD_BL | QUAD_BR]: "█",
};

/**
 * `charMode: "quadrant"`: pack a 2×2 subcell coverage mask into one of the 16
 * Unicode quadrant/half/full-block glyphs, generalizing `charMode:
 * "halfblock"` from a 1×2 (top/bottom) split to a full 2×2 split — twice the
 * shape resolution at the SAME two-colors-per-cell markup cost (see
 * `encodeGlyphBuffersDual`, the same dual-color encoder halfblock uses).
 * Half-block's `▀`/`▄` are two of these 16 masks (`TL|TR` and `BL|BR`).
 *
 * `S` (forced even, ≥2 — see `wantsQuadrantSolid`) subcell rows AND columns
 * split evenly into four regions: TL/TR are `[0,S/2)` rows, BL/BR are
 * `[S/2,S)`; TL/BL are `[0,S/2)` cols, TR/BR are `[S/2,S)`. Coverage (not
 * glyph) drives whether a region counts, exactly like `encodeHalfblockSolid`.
 *
 * Per output cell:
 *  - no region covered → `" "`, no color, no background — a cell with no
 *    geometry never paints an opaque rectangle (same rule halfblock enforces).
 *  - 1-3 regions covered (the SHAPE win over halfblock: 14 distinct partial
 *    silhouettes instead of just "top" or "bottom") → the glyph for that exact
 *    coverage mask, `color` = the coverage-weighted average of the covered
 *    regions' subcells, no `background-color` — a background would have to
 *    paint the WHOLE cell rectangle, including the uncovered regions, which
 *    is exactly the "never paint an empty subcell" rule this mode (like
 *    halfblock) must not violate. Distinct colors among the covered regions
 *    collapse into that one average: with no room left to paint a `bg` behind
 *    an uncovered region, a second on-cell color has nowhere to go.
 *  - all 4 regions covered → the COLOR win over plain solid-mode averaging:
 *    if every region resolves to the same color (common on a flat-shaded
 *    triangle interior, and after the 8-bit lit-color cache collapses
 *    near-identical shades), emit `█` with just `color` set — no
 *    `background-color`, cheaper markup, same run-merging as the ASCII solid
 *    path. Otherwise, split the 4 regions into a "high" and "low" group by
 *    each region's average luminance vs. the mean of the 4 (deterministic,
 *    no real k-means clustering): `color` = the coverage-weighted average of
 *    the high group, `background-color` = the coverage-weighted average of
 *    the low group, and the glyph is whichever of the 16 masks matches the
 *    high group's quadrant membership. A degenerate split (every region ends
 *    up on the same side of the mean, e.g. three near-identical regions plus
 *    one float-rounding outlier) falls back to the same-color `█` case. This
 *    is a genuine two-tone split of the WHOLE cell, unlike the partial-
 *    coverage case above — full coverage is the only state where painting a
 *    `background-color` can never touch an uncovered region.
 *
 * What's lost vs. exact per-subcell color: a partially-covered cell with
 * more than one true subcell color still collapses to one `color` (no
 * background slot available); a fully-covered cell with more than two true
 * colors collapses to whichever two-group luminance split the mean threshold
 * produces, not a globally optimal 2-cluster partition.
 *
 * Terminal, like `encodeHalfblockSolid`: builds the final string directly via
 * `encodeGlyphBuffersDual`, so `CellGrid`/`transformCells`/the generic effect
 * compositor stay exactly one-color-per-cell, untouched by this path.
 */
export function encodeQuadrantSolid(
  colorBuf: (string | null)[] | null,
  depthBuf: Float64Array,
  outCols: number,
  outRows: number,
  S: number,
  useColors: boolean,
  colorTolerance = 0,
): string {
  const inCols = outCols * S;
  const half = S / 2; // S is forced even by `rasterize()` whenever this path is taken.
  const n = outCols * outRows;
  const charBuf: string[] = new Array(n);
  const fgBuf: (string | null)[] = new Array(n).fill(null);
  const bgBuf: (string | null)[] = new Array(n).fill(null);

  for (let oy = 0; oy < outRows; oy++) {
    for (let ox = 0; ox < outCols; ox++) {
      // Per-quadrant coverage-weighted color sums, indexed [TL, TR, BL, BR].
      const cov = [0, 0, 0, 0];
      const sumR = [0, 0, 0, 0];
      const sumG = [0, 0, 0, 0];
      const sumB = [0, 0, 0, 0];
      for (let sy = 0; sy < S; sy++) {
        const base = (oy * S + sy) * inCols + ox * S;
        const rowIsTop = sy < half;
        for (let sx = 0; sx < S; sx++) {
          const si = base + sx;
          if (depthBuf[si] === -Infinity) continue;
          const q = (rowIsTop ? 0 : 2) + (sx < half ? 0 : 1); // 0=TL 1=TR 2=BL 3=BR
          cov[q]!++;
          if (colorBuf) {
            const c = colorBuf[si];
            if (c) {
              const rgb = hexToRgb(c);
              sumR[q]! += rgb[0]; sumG[q]! += rgb[1]; sumB[q]! += rgb[2];
            }
          }
        }
      }
      const oi = oy * outCols + ox;
      const coveredMask =
        (cov[0]! > 0 ? QUAD_TL : 0) | (cov[1]! > 0 ? QUAD_TR : 0) |
        (cov[2]! > 0 ? QUAD_BL : 0) | (cov[3]! > 0 ? QUAD_BR : 0);
      if (coveredMask === 0) {
        charBuf[oi] = " ";
        continue;
      }
      const avgColor = (bit: number): string | null => {
        if (!useColors) return null;
        let r = 0, g = 0, b = 0, count = 0;
        for (let q = 0; q < 4; q++) {
          if (!(bit & (1 << q))) continue;
          count += cov[q]!;
          r += sumR[q]!; g += sumG[q]!; b += sumB[q]!;
        }
        return count > 0 ? `#${toHex2(r / count)}${toHex2(g / count)}${toHex2(b / count)}` : null;
      };
      if (coveredMask !== (QUAD_TL | QUAD_TR | QUAD_BL | QUAD_BR)) {
        // Partial coverage: shape carries the resolution — one collapsed
        // average color across every covered region, no background (would
        // have to paint an uncovered region).
        charBuf[oi] = QUADRANT_GLYPHS[coveredMask]!;
        fgBuf[oi] = avgColor(coveredMask);
        continue;
      }
      // Full coverage: try a two-tone luminance split across all 4 regions.
      if (useColors) {
        const lum = [0, 1, 2, 3].map((q) => {
          if (cov[q]! === 0) return 0;
          return (0.299 * sumR[q]! + 0.587 * sumG[q]! + 0.114 * sumB[q]!) / cov[q]!;
        });
        const mean = (lum[0]! + lum[1]! + lum[2]! + lum[3]!) / 4;
        let highMask = 0;
        for (let q = 0; q < 4; q++) if (lum[q]! >= mean) highMask |= 1 << q;
        if (highMask !== 0 && highMask !== 15) {
          charBuf[oi] = QUADRANT_GLYPHS[highMask]!;
          fgBuf[oi] = avgColor(highMask);
          bgBuf[oi] = avgColor(15 & ~highMask);
          continue;
        }
      }
      // Same color (or useColors: false, or a degenerate split) — cheapest
      // markup: solid glyph, single color, no background.
      charBuf[oi] = "█";
      fgBuf[oi] = avgColor(15);
    }
  }
  return encodeGlyphBuffersDual(charBuf, fgBuf, bgBuf, outCols, outRows, useColors, colorTolerance);
}

/**
 * Half-space triangle rasterizer with per-pixel barycentric depth.
 *
 * For each cell in the triangle's bounding box, evaluate three edge functions.
 * A cell is inside iff all three weights have the same sign as the signed
 * 2× triangle area. The weights also give barycentric coordinates → we
 * interpolate per-vertex depth so adjacent triangles on a curved surface
 * never disagree at a shared edge (the previous per-triangle average depth
 * flipped winners at angle-dependent epsilons and showed up as dark bands
 * across solid surfaces).
 *
 * Shared edges between adjacent triangles get drawn twice (no top-left bias).
 * That's fine: both triangles write the same per-pixel depth at the shared
 * edge, so whichever is rasterized second either confirms or correctly loses
 * the depth test. We can't use the GPU's fixed-point top-left bias trick here
 * because our edge functions are in floating point — a constant −1 subtracted
 * from a fractional weight near 0 turns valid interior pixels (w ≈ 0.4) into
 * "outside" (w ≈ −0.6) and punches holes through every triangle.
 */
/**
 * 4×4 Bayer ordered-dither thresholds, normalized to (0, 1). Indexed by
 * `(row & 3) * 4 + (col & 3)`. The `+0.5` recentring keeps every cell strictly
 * inside the open interval so neither boundary glyph is favored when intensity
 * lands exactly on a ramp step.
 */
const BAYER_4X4 = new Float64Array([
  ( 0 + 0.5) / 16, ( 8 + 0.5) / 16, ( 2 + 0.5) / 16, (10 + 0.5) / 16,
  (12 + 0.5) / 16, ( 4 + 0.5) / 16, (14 + 0.5) / 16, ( 6 + 0.5) / 16,
  ( 3 + 0.5) / 16, (11 + 0.5) / 16, ( 1 + 0.5) / 16, ( 9 + 0.5) / 16,
  (15 + 0.5) / 16, ( 7 + 0.5) / 16, (13 + 0.5) / 16, ( 5 + 0.5) / 16,
]);

// ── Shadow map ────────────────────────────────────────────────────────────────

const SHADOW_MAP_SIZE = 256;

interface ShadowMapData {
  buf: Float64Array;              // SHADOW_MAP_SIZE × SHADOW_MAP_SIZE, lightDepth (higher = closer to light)
  right: [number, number, number];
  up: [number, number, number];
  dir: [number, number, number];  // normalized source vector toward the light
  uMin: number; uMax: number;
  vMin: number; vMax: number;
}

/** Shadow context passed into `scanFillTriangle` for receiver triangles. */
interface ScanFillShadowCtx {
  map: ShadowMapData;
  luA: number; lvA: number; ldA: number;
  luB: number; lvB: number; ldB: number;
  luC: number; lvC: number; ldC: number;
  lift: number;
  opacity: number;
  ambientIntensity: number;
  shadowColorRgb: [number, number, number];
  shadowColorHex: string;
  litCache: Map<string, string>;
}

/** Per-cell texture sampling context for one triangle (see {@link RasterizeContext.textureSamplers}). */
interface ScanFillTexCtx {
  sampler: TextureSampler;
  ua: number; va: number; ub: number; vb: number; uc: number; vc: number;
  // Per-triangle light multiplier (ambient + key·lambert) applied to each texel.
  tintR: number; tintG: number; tintB: number;
}

/** Authored face UVs retained for a post-rasterize surface-space cell effect. */
interface ScanFillSurfaceUvCtx {
  ua: number; va: number; ub: number; vb: number; uc: number; vc: number;
}

/**
 * Project a world vertex to light-space [texelU, texelV, lightDepth].
 * `lightDepth = dot(v, dir)` — higher = closer to light.
 */
function toLightUV(
  v: Vec3,
  rx: number, ry: number, rz: number,
  ux: number, uy: number, uz: number,
  lx: number, ly: number, lz: number,
  uMin: number, uMax: number, vMin: number, vMax: number,
): [number, number, number] {
  const u = rx * v[0] + ry * v[1] + rz * v[2];
  const vv = ux * v[0] + uy * v[1] + uz * v[2];
  const depth = lx * v[0] + ly * v[1] + lz * v[2];
  const tu = ((u - uMin) / (uMax - uMin)) * (SHADOW_MAP_SIZE - 1);
  const tv = ((vv - vMin) / (vMax - vMin)) * (SHADOW_MAP_SIZE - 1);
  return [tu, tv, depth];
}

/**
 * Scan-fill a triangle into the shadow depth buffer.
 * No backface cull — we want depth from ALL caster faces so the shadow map
 * correctly captures the full caster silhouette from the light's perspective.
 */
function scanFillShadowTriangle(
  buf: Float64Array,
  a: [number, number, number],
  b: [number, number, number],
  c: [number, number, number],
): void {
  const ax = a[0], ay = a[1], az = a[2];
  const bx = b[0], by = b[1], bz = b[2];
  const cx = c[0], cy = c[1], cz = c[2];

  const area2 = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
  if (area2 === 0) return;
  const invArea2 = 1 / area2;

  let minX = ax < bx ? ax : bx; if (cx < minX) minX = cx;
  let maxX = ax > bx ? ax : bx; if (cx > maxX) maxX = cx;
  let minY = ay < by ? ay : by; if (cy < minY) minY = cy;
  let maxY = ay > by ? ay : by; if (cy > maxY) maxY = cy;
  const colLeft = Math.max(0, Math.ceil(minX));
  const colRight = Math.min(SHADOW_MAP_SIZE - 1, Math.floor(maxX));
  const rowTop = Math.max(0, Math.ceil(minY));
  const rowBot = Math.min(SHADOW_MAP_SIZE - 1, Math.floor(maxY));
  if (colLeft > colRight || rowTop > rowBot) return;

  const ccw = area2 > 0;
  for (let row = rowTop; row <= rowBot; row++) {
    for (let col = colLeft; col <= colRight; col++) {
      const px = col, py = row;
      const wA = (bx - px) * (cy - py) - (by - py) * (cx - px);
      const wB = (cx - px) * (ay - py) - (cy - py) * (ax - px);
      const wC = (ax - px) * (by - py) - (ay - py) * (bx - px);
      if (ccw ? (wA < 0 || wB < 0 || wC < 0) : (wA > 0 || wB > 0 || wC > 0)) continue;
      const depth = (wA * az + wB * bz + wC * cz) * invArea2;
      const idx = row * SHADOW_MAP_SIZE + col;
      if (depth > buf[idx]!) buf[idx] = depth;
    }
  }
}

/**
 * Build a shadow map from all castShadow polygons.
 * Returns null when there are no casters (shadow pass is skipped entirely).
 *
 * The shadow map is an ortho depth buffer in light-space, aligned to the bounding
 * box of all caster vertices. `lightDepth = dot(vertex, lightDir)` — higher = closer
 * to light. During the main pass, a receiver cell is in shadow when its interpolated
 * lightDepth (+ bias lift) is less than the stored maximum caster depth at that texel.
 */
function buildShadowMap(
  polygons: Polygon[],
  castFlags: boolean[],
  lx: number, ly: number, lz: number,  // normalized source vector toward light
): ShadowMapData | null {
  // Build an orthonormal basis for the light view.
  // Choose 'right' perpendicular to dir.
  let rx: number, ry: number, rz: number;
  if (Math.abs(lx) < 0.9) {
    // cross(dir, worldX=[1,0,0])
    rx = 0; ry = lz; rz = -ly;
  } else {
    // cross(dir, worldY=[0,1,0])
    rx = -lz; ry = 0; rz = lx;
  }
  const rLen = Math.hypot(rx, ry, rz);
  rx /= rLen; ry /= rLen; rz /= rLen;
  // up = cross(right, dir) — completes the orthonormal basis
  const ux = ry * lz - rz * ly;
  const uy = rz * lx - rx * lz;
  const uz = rx * ly - ry * lx;

  // Find light-space bounding box of all castShadow vertices.
  let uMin = Infinity, uMax = -Infinity, vMin = Infinity, vMax = -Infinity;
  let hasCasters = false;
  for (let i = 0; i < polygons.length; i++) {
    if (!castFlags[i]) continue;
    hasCasters = true;
    for (const v of polygons[i]!.vertices) {
      const u = rx * v[0] + ry * v[1] + rz * v[2];
      const vv = ux * v[0] + uy * v[1] + uz * v[2];
      if (u < uMin) uMin = u; if (u > uMax) uMax = u;
      if (vv < vMin) vMin = vv; if (vv > vMax) vMax = vv;
    }
  }
  if (!hasCasters) return null;

  // Pad the bounds slightly to avoid edge clipping.
  const uPad = (uMax - uMin) * 0.05 + 0.01;
  const vPad = (vMax - vMin) * 0.05 + 0.01;
  uMin -= uPad; uMax += uPad; vMin -= vPad; vMax += vPad;

  const buf = new Float64Array(SHADOW_MAP_SIZE * SHADOW_MAP_SIZE).fill(-Infinity);

  // Rasterize all castShadow triangles (fan-triangulated) into the depth buffer.
  for (let i = 0; i < polygons.length; i++) {
    if (!castFlags[i]) continue;
    const verts = polygons[i]!.vertices;
    if (verts.length < 3) continue;
    for (let f = 1; f < verts.length - 1; f++) {
      const a = verts[0]!;
      const bv = verts[f]!;
      const cv = verts[f + 1]!;
      const auv = toLightUV(a as Vec3, rx, ry, rz, ux, uy, uz, lx, ly, lz, uMin, uMax, vMin, vMax);
      const buv = toLightUV(bv as Vec3, rx, ry, rz, ux, uy, uz, lx, ly, lz, uMin, uMax, vMin, vMax);
      const cuv = toLightUV(cv as Vec3, rx, ry, rz, ux, uy, uz, lx, ly, lz, uMin, uMax, vMin, vMax);
      scanFillShadowTriangle(buf, auv, buv, cuv);
    }
  }

  return { buf, right: [rx, ry, rz], up: [ux, uy, uz], dir: [lx, ly, lz], uMin, uMax, vMin, vMax };
}

function scanFillTriangle(
  ax: number, ay: number, az: number, aq: number, ia: number,
  bx: number, by: number, bz: number, bq: number, ib: number,
  cx: number, cy: number, cz: number, cq: number, ic: number,
  ramp: string[],
  rampMax: number,
  color: string | null,
  glyphBuf: string[],
  colorBuf: (string | null)[] | null,
  depthBuf: Float64Array,
  shadeBuf: Float32Array | null,
  cols: number,
  rows: number,
  sh: ScanFillShadowCtx | null,
  doubleSided: boolean,
  // World-space triangle verts + output buffer for per-cell world position
  // (used by reprojection TAA). `worldPosBuf` is null when not needed.
  wv0: Vec3, wv1: Vec3, wv2: Vec3,
  worldPosBuf: Float32Array | null,
  // Pre-transform (mesh-local) triangle verts + output buffer for per-cell
  // object position (`space: "object"` effects). Same interpolation as
  // wv0/wv1/wv2 → worldPosBuf, just against the mesh's own frame. Null when
  // not requested.
  ov0: Vec3, ov1: Vec3, ov2: Vec3,
  objectPosBuf: Float32Array | null,
  normalX: number, normalY: number, normalZ: number,
  normalBuf: Float32Array | null,
  // Object-space face normal (VOLUMETRIC-4.md "Phase 0") — face-constant per
  // triangle, same as `normalX/Y/Z` above but computed from `ov0/ov1/ov2`.
  // Written verbatim to every cell this triangle wins, exactly like the
  // world normal; `null` when no effect requested it.
  objectNormalX: number, objectNormalY: number, objectNormalZ: number,
  objectNormalBuf: Float32Array | null,
  surfaceUv: ScanFillSurfaceUvCtx | null,
  surfaceUvBuf: Float32Array | null,
  // Relative depth-test deadband (0 = exact). A new triangle replaces the
  // current cell only when nearer by more than this fraction; near-coplanar
  // surfaces keep a stable winner instead of z-fighting frame to frame.
  depthEpsilon: number,
  // Per-cell texture sampling for this triangle (null → flat `color`).
  tex: ScanFillTexCtx | null,
  polygonIndex: number,
  winnerPolygonBuf: Int32Array | null,
  albedoRgbBuf: Uint32Array | null,
  targetRgbBuf: Uint32Array | null,
  ambientIntensity: number,
  ambientRgb: [number, number, number],
  keyLightRgb: [number, number, number],
  flatBaseColor: string,
  // `solidWeightRamp` (opt-in, default off): per-ramp-step CSS `font-weight`,
  // same index convention as `ramp`/`rampMax` above. `null` when the option is
  // unset — `weightBuf` is never written and output stays byte-identical.
  weightRamp: Uint16Array | null = null,
  weightBuf: Uint16Array | null = null,
  // Winning MESH id for this polygon (see `RasterizeContext.polygonMeshIds`)
  // + the per-cell winner-mesh buffer it's written into. `-1`/`null` when the
  // scene didn't request `objectExit` — the exit sweep is the only reader.
  meshId = -1,
  winnerMeshBuf: Int32Array | null = null,
): void {
  // Signed 2× area. Sign tells us screen-space winding.
  const area2 = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
  if (area2 === 0) return;
  // Backface cull. Glyphcss's camera projects world-CCW polygons (the input
  // convention is "CCW from outside") to screen-CW under our row convention
  // (positive r[1] → larger row → visually below center), so front-facing
  // triangles produce `area2 < 0`. Drop back faces. The asciss-derived
  // rotateVec3 also swaps the X/Y input axes, which contributes to the
  // orientation flip.
  if (!doubleSided && area2 > 0) return;
  const invArea2 = 1 / area2;
  const ccw = area2 > 0;
  const perspectiveAttributes = aq !== 1 || bq !== 1 || cq !== 1;
  const interpolatePerspective = perspectiveAttributes
    && (worldPosBuf !== null || objectPosBuf !== null || surfaceUvBuf !== null || tex !== null || sh !== null);

  // Bounding box clamped to grid.
  let minX = ax < bx ? ax : bx; if (cx < minX) minX = cx;
  let maxX = ax > bx ? ax : bx; if (cx > maxX) maxX = cx;
  let minY = ay < by ? ay : by; if (cy < minY) minY = cy;
  let maxY = ay > by ? ay : by; if (cy > maxY) maxY = cy;
  const colLeft = Math.max(0, Math.ceil(minX));
  const colRight = Math.min(cols - 1, Math.floor(maxX));
  const rowTop = Math.max(0, Math.ceil(minY));
  const rowBot = Math.min(rows - 1, Math.floor(maxY));
  if (colLeft > colRight || rowTop > rowBot) return;

  for (let row = rowTop; row <= rowBot; row++) {
    const py = row;
    for (let col = colLeft; col <= colRight; col++) {
      const px = col;
      // Signed 2× areas of sub-triangles (P,B,C), (P,C,A), (P,A,B). Sum = area2.
      // wA = weight of vertex A, wB = weight of B, wC = weight of C.
      const wA = (bx - px) * (cy - py) - (by - py) * (cx - px);
      const wB = (cx - px) * (ay - py) - (cy - py) * (ax - px);
      const wC = (ax - px) * (by - py) - (ay - py) * (bx - px);
      // Inside test: all three weights share sign of area2 (≥ 0 inclusive).
      if (ccw ? (wA < 0 || wB < 0 || wC < 0) : (wA > 0 || wB > 0 || wC > 0)) continue;

      // Per-pixel depth via barycentric interpolation.
      const pixelDepth = (wA * az + wB * bz + wC * cz) * invArea2;
      const idx = row * cols + col;
      const prevDepth = depthBuf[idx]!;
      // Depth-test deadband, biased toward DRAW ORDER to mirror a CSS/DOM
      // renderer. A later triangle wins even when slightly BEHIND the current
      // one — within a relative epsilon — so near-coplanar surfaces (overlapping
      // brushes, decals, a translucent plane over its backing face) resolve by
      // paint order (last drawn on top), exactly as polycss does via DOM
      // stacking, instead of z-fighting per-cell as the camera moves. Only the
      // perspective zbuf (>0) gets the deadband; the empty cell (−Infinity) and
      // ortho (≤0) fall through to the plain `>` test.
      if (pixelDepth > (prevDepth > 0 ? prevDepth * (1 - depthEpsilon) : prevDepth)) {
        depthBuf[idx] = pixelDepth;
        if (winnerPolygonBuf !== null) winnerPolygonBuf[idx] = polygonIndex;
        if (winnerMeshBuf !== null) winnerMeshBuf[idx] = meshId;
        const invQ = interpolatePerspective
          ? 1 / (wA * aq + wB * bq + wC * cq)
          : invArea2;
        if (worldPosBuf !== null) {
          // Perspective-correct world position for reprojection TAA. Ortho
          // supplies q=1, reducing exactly to affine barycentrics.
          const o = idx * 3;
          if (perspectiveAttributes) {
            worldPosBuf[o] = (wA * aq * wv0[0]! + wB * bq * wv1[0]! + wC * cq * wv2[0]!) * invQ;
            worldPosBuf[o + 1] = (wA * aq * wv0[1]! + wB * bq * wv1[1]! + wC * cq * wv2[1]!) * invQ;
            worldPosBuf[o + 2] = (wA * aq * wv0[2]! + wB * bq * wv1[2]! + wC * cq * wv2[2]!) * invQ;
          } else {
            worldPosBuf[o] = (wA * wv0[0]! + wB * wv1[0]! + wC * wv2[0]!) * invArea2;
            worldPosBuf[o + 1] = (wA * wv0[1]! + wB * wv1[1]! + wC * wv2[1]!) * invArea2;
            worldPosBuf[o + 2] = (wA * wv0[2]! + wB * wv1[2]! + wC * wv2[2]!) * invArea2;
          }
        }
        if (objectPosBuf !== null) {
          const o = idx * 3;
          if (perspectiveAttributes) {
            objectPosBuf[o] = (wA * aq * ov0[0]! + wB * bq * ov1[0]! + wC * cq * ov2[0]!) * invQ;
            objectPosBuf[o + 1] = (wA * aq * ov0[1]! + wB * bq * ov1[1]! + wC * cq * ov2[1]!) * invQ;
            objectPosBuf[o + 2] = (wA * aq * ov0[2]! + wB * bq * ov1[2]! + wC * cq * ov2[2]!) * invQ;
          } else {
            objectPosBuf[o] = (wA * ov0[0]! + wB * ov1[0]! + wC * ov2[0]!) * invArea2;
            objectPosBuf[o + 1] = (wA * ov0[1]! + wB * ov1[1]! + wC * ov2[1]!) * invArea2;
            objectPosBuf[o + 2] = (wA * ov0[2]! + wB * ov1[2]! + wC * ov2[2]!) * invArea2;
          }
        }
        if (normalBuf !== null) {
          const o = idx * 3;
          normalBuf[o] = normalX;
          normalBuf[o + 1] = normalY;
          normalBuf[o + 2] = normalZ;
        }
        if (objectNormalBuf !== null) {
          const o = idx * 3;
          objectNormalBuf[o] = objectNormalX;
          objectNormalBuf[o + 1] = objectNormalY;
          objectNormalBuf[o + 2] = objectNormalZ;
        }
        if (surfaceUvBuf !== null) {
          const o = idx * 2;
          if (surfaceUv !== null) {
            if (perspectiveAttributes) {
              surfaceUvBuf[o] = (
                wA * aq * surfaceUv.ua + wB * bq * surfaceUv.ub + wC * cq * surfaceUv.uc
              ) * invQ;
              surfaceUvBuf[o + 1] = (
                wA * aq * surfaceUv.va + wB * bq * surfaceUv.vb + wC * cq * surfaceUv.vc
              ) * invQ;
            } else {
              surfaceUvBuf[o] = (
                wA * surfaceUv.ua + wB * surfaceUv.ub + wC * surfaceUv.uc
              ) * invArea2;
              surfaceUvBuf[o + 1] = (
                wA * surfaceUv.va + wB * surfaceUv.vb + wC * surfaceUv.vc
              ) * invArea2;
            }
          } else {
            surfaceUvBuf[o] = NaN;
            surfaceUvBuf[o + 1] = NaN;
          }
        }
        // Per-pixel intensity → per-pixel glyph. Two things happen here:
        //   1. Smooth shading: adjacent triangles' shared edge has the same
        //      interpolated intensity on both sides, so the glyph transition
        //      crosses the edge smoothly instead of stepping.
        //   2. Bayer ordered dithering: pick between two adjacent ramp glyphs
        //      based on a 4×4 threshold matrix. When the sub-ramp fraction
        //      exceeds the cell's threshold, step up to the brighter glyph —
        //      producing a stippled gradient that reads as continuous from a
        //      distance and breaks up the visible contour bands between ramp
        //      steps.
        const lightIntensity = (wA * ia + wB * ib + wC * ic) * invArea2;
        let intensity = lightIntensity;
        let cellColor = color;
        let sourceRgb = hexToRgb(flatBaseColor);

        // Per-cell texture: barycentric-interpolate UV, sample the texel. Its
        // color (× the triangle's light tint) becomes this cell's color, and its
        // luminance folds into the glyph intensity — so the *character* reflects
        // image brightness too: a flat textured quad reads as ASCII art, a lit
        // textured mesh shows texture detail modulated by shading.
        if (tex !== null) {
          const u = perspectiveAttributes
            ? (wA * aq * tex.ua + wB * bq * tex.ub + wC * cq * tex.uc) * invQ
            : (wA * tex.ua + wB * tex.ub + wC * tex.uc) * invArea2;
          const v = perspectiveAttributes
            ? (wA * aq * tex.va + wB * bq * tex.vb + wC * cq * tex.vc) * invQ
            : (wA * tex.va + wB * tex.vb + wC * tex.vc) * invArea2;
          const texel = sampleTexel(tex.sampler, u, v);
          if (texel !== null && texel.a > 8) {
            const base = hexToRgb(flatBaseColor);
            sourceRgb = [(texel.r * base[0] / 255) | 0, (texel.g * base[1] / 255) | 0, (texel.b * base[2] / 255) | 0];
            let r = (sourceRgb[0] * tex.tintR) | 0; if (r > 255) r = 255;
            let g = (sourceRgb[1] * tex.tintG) | 0; if (g > 255) g = 255;
            let b = (sourceRgb[2] * tex.tintB) | 0; if (b > 255) b = 255;
            cellColor = `#${toHex2(r)}${toHex2(g)}${toHex2(b)}`;
            intensity *= (0.299 * texel.r + 0.587 * texel.g + 0.114 * texel.b) / 255;
          }
        }
        if (albedoRgbBuf !== null) albedoRgbBuf[idx] = (sourceRgb[0] << 16) | (sourceRgb[1] << 8) | sourceRgb[2];

        // Per-cell intensity. Glyph choice happens after shadowing so shadows
        // can attenuate only the direct/key-light part of the signal.
        let clamped = intensity < 0 ? 0 : intensity > 1 ? 1 : intensity;
        let shadowOpacity = 0;

        // Shadow occlusion: barycentric-interpolate light-space (u,v,depth),
        // sample the shadow map, darken if occluded.
        if (sh !== null) {
          // Light-space (u,v,depth) are affine in world position, so they need
          // the SAME perspective-correct interpolation as world position/UV —
          // interpolating them affinely in screen space warps the shadow under a
          // perspective camera (and the warp shifts with the camera, worst up
          // close). Ortho supplies q=1, reducing exactly to affine barycentrics.
          const lu = perspectiveAttributes
            ? (wA * aq * sh.luA + wB * bq * sh.luB + wC * cq * sh.luC) * invQ
            : (wA * sh.luA + wB * sh.luB + wC * sh.luC) * invArea2;
          const lv = perspectiveAttributes
            ? (wA * aq * sh.lvA + wB * bq * sh.lvB + wC * cq * sh.lvC) * invQ
            : (wA * sh.lvA + wB * sh.lvB + wC * sh.lvC) * invArea2;
          const ld = perspectiveAttributes
            ? (wA * aq * sh.ldA + wB * bq * sh.ldB + wC * cq * sh.ldC) * invQ
            : (wA * sh.ldA + wB * sh.ldB + wC * sh.ldC) * invArea2;
          // Nearest-neighbor sample (integer texel coords).
          const tu = lu | 0;
          const tv = lv | 0;
          if (tu >= 0 && tu < SHADOW_MAP_SIZE && tv >= 0 && tv < SHADOW_MAP_SIZE) {
            const mapDepth = sh.map.buf[tv * SHADOW_MAP_SIZE + tu]!;
            // Surface is in shadow when the closest caster depth at this texel
            // is greater than the surface's projected lightDepth (+ bias lift).
            // The lift nudges the surface slightly toward the light to prevent
            // self-acne on flat lit surfaces.
            if (mapDepth > -Infinity && ld + sh.lift < mapDepth) {
              // Shadows attenuate only direct/key light. Ambient is independent
              // scene fill, so with key intensity 0 the shadow map must be a no-op.
              const ambientPart = Math.min(clamped, Math.max(0, sh.ambientIntensity));
              const directPart = Math.max(0, clamped - ambientPart);
              if (directPart > 0) {
                const effectiveOpacity = sh.opacity * (directPart / Math.max(clamped, 1e-6));
                clamped = ambientPart + directPart * (1 - sh.opacity);
                shadowOpacity = sh.opacity;
                if (cellColor !== null && effectiveOpacity > 0) {
                  // Color shadowing follows the same rule: only the direct
                  // contribution is blended toward the shadow color.
                  const shadowKey = `shadow:${cellColor}:${Math.round(effectiveOpacity * 255)}`;
                  let shadowedColor = sh.litCache.get(shadowKey);
                  if (shadowedColor === undefined) {
                    const orig = hexToRgb(cellColor);
                    const sc = sh.shadowColorRgb;
                    const r = Math.round(orig[0] * (1 - effectiveOpacity) + sc[0] * effectiveOpacity);
                    const g = Math.round(orig[1] * (1 - effectiveOpacity) + sc[1] * effectiveOpacity);
                    const b = Math.round(orig[2] * (1 - effectiveOpacity) + sc[2] * effectiveOpacity);
                    shadowedColor = `#${toHex2(r)}${toHex2(g)}${toHex2(b)}`;
                    sh.litCache.set(shadowKey, shadowedColor);
                  }
                  cellColor = shadowedColor;
                }
              }
            }
          }
        }

        if (shadeBuf) shadeBuf[idx] = clamped;
        const rampPos = clamped * rampMax;
        const lower = rampPos | 0;
        const frac = rampPos - lower;
        const threshold = BAYER_4X4[(row & 3) * 4 + (col & 3)]!;
        let glyphIdx = frac > threshold && lower < rampMax ? lower + 1 : lower;
        if (glyphIdx > rampMax) glyphIdx = rampMax;

        glyphBuf[idx] = ramp[glyphIdx]!;
        if (weightBuf !== null) weightBuf[idx] = weightRamp ? weightRamp[glyphIdx] ?? 0 : 0;
        if (targetRgbBuf !== null) {
          // Targets retain the exact per-cell Lambert/key calculation. The
          // presentation color intentionally uses a triangle-level tint to
          // coalesce DOM spans, so it is not a valid RGB-training authority.
          const direct = Math.max(0, lightIntensity - ambientIntensity);
          const shadowRgb = sh?.shadowColorRgb ?? [0, 0, 0];
          const r = Math.min(255, (sourceRgb[0] * ambientIntensity * ambientRgb[0] / 255 + sourceRgb[0] * direct * keyLightRgb[0] / 255 * (1 - shadowOpacity) + shadowRgb[0] * direct * shadowOpacity) | 0);
          const g = Math.min(255, (sourceRgb[1] * ambientIntensity * ambientRgb[1] / 255 + sourceRgb[1] * direct * keyLightRgb[1] / 255 * (1 - shadowOpacity) + shadowRgb[1] * direct * shadowOpacity) | 0);
          const b = Math.min(255, (sourceRgb[2] * ambientIntensity * ambientRgb[2] / 255 + sourceRgb[2] * direct * keyLightRgb[2] / 255 * (1 - shadowOpacity) + shadowRgb[2] * direct * shadowOpacity) | 0);
          targetRgbBuf[idx] = (r << 16) | (g << 8) | b;
        }
        if (colorBuf) colorBuf[idx] = cellColor;
      }
    }
  }
}

/**
 * Farthest-depth scan-fill for the `objectExit` second sweep. Unlike
 * `scanFillTriangle`, this ALWAYS fills both windings (no backface cull —
 * the far side of a closed mesh is by definition a back face from the
 * camera) and keeps the FARTHEST depth instead of the nearest, restricted
 * per cell to `meshId === winnerMeshBuf[idx]` (a farther, non-winning mesh's
 * geometry must never leak into another mesh's exit point). Interpolates
 * ONLY the pre-transform (object-space) position — no shading, color, or
 * UV — since this buffer feeds a volumetric effect's marcher, not a glyph.
 */
function exitScanFillTriangle(
  ax: number, ay: number, az: number, aq: number,
  bx: number, by: number, bz: number, bq: number,
  cx: number, cy: number, cz: number, cq: number,
  ov0: Vec3, ov1: Vec3, ov2: Vec3,
  exitPosBuf: Float32Array,
  exitDepthBuf: Float64Array,
  meshId: number,
  winnerMeshBuf: Int32Array,
  depthEpsilon: number,
  cols: number,
  rows: number,
): void {
  const area2 = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
  if (area2 === 0) return;
  const invArea2 = 1 / area2;
  const ccw = area2 > 0;
  const perspectiveAttributes = aq !== 1 || bq !== 1 || cq !== 1;

  let minX = ax < bx ? ax : bx; if (cx < minX) minX = cx;
  let maxX = ax > bx ? ax : bx; if (cx > maxX) maxX = cx;
  let minY = ay < by ? ay : by; if (cy < minY) minY = cy;
  let maxY = ay > by ? ay : by; if (cy > maxY) maxY = cy;
  const colLeft = Math.max(0, Math.ceil(minX));
  const colRight = Math.min(cols - 1, Math.floor(maxX));
  const rowTop = Math.max(0, Math.ceil(minY));
  const rowBot = Math.min(rows - 1, Math.floor(maxY));
  if (colLeft > colRight || rowTop > rowBot) return;

  for (let row = rowTop; row <= rowBot; row++) {
    const py = row;
    for (let col = colLeft; col <= colRight; col++) {
      const px = col;
      const wA = (bx - px) * (cy - py) - (by - py) * (cx - px);
      const wB = (cx - px) * (ay - py) - (cy - py) * (ax - px);
      const wC = (ax - px) * (by - py) - (ay - py) * (bx - px);
      // Inside test only (no winding cull): both windings share this same
      // "all three weights share the sign of area2" condition.
      if (ccw ? (wA < 0 || wB < 0 || wC < 0) : (wA > 0 || wB > 0 || wC > 0)) continue;

      const idx = row * cols + col;
      // Restrict to the mesh that actually won this cell in the entry pass.
      if (winnerMeshBuf[idx] !== meshId) continue;

      const pixelDepth = (wA * az + wB * bz + wC * cz) * invArea2;
      const prevDepth = exitDepthBuf[idx]!;
      // Mirror of the entry pass's draw-order deadband, sign-flipped: keep
      // the FARTHEST (smallest) depth, with the same relative slack so
      // near-coplanar back faces don't z-fight sweep to sweep.
      if (pixelDepth < (prevDepth < Infinity ? prevDepth * (1 + depthEpsilon) : prevDepth)) {
        exitDepthBuf[idx] = pixelDepth;
        const invQ = perspectiveAttributes ? 1 / (wA * aq + wB * bq + wC * cq) : invArea2;
        const o = idx * 3;
        if (perspectiveAttributes) {
          exitPosBuf[o] = (wA * aq * ov0[0]! + wB * bq * ov1[0]! + wC * cq * ov2[0]!) * invQ;
          exitPosBuf[o + 1] = (wA * aq * ov0[1]! + wB * bq * ov1[1]! + wC * cq * ov2[1]!) * invQ;
          exitPosBuf[o + 2] = (wA * aq * ov0[2]! + wB * bq * ov1[2]! + wC * cq * ov2[2]!) * invQ;
        } else {
          exitPosBuf[o] = (wA * ov0[0]! + wB * ov1[0]! + wC * ov2[0]!) * invArea2;
          exitPosBuf[o + 1] = (wA * ov0[1]! + wB * ov1[1]! + wC * ov2[1]!) * invArea2;
          exitPosBuf[o + 2] = (wA * ov0[2]! + wB * ov1[2]! + wC * ov2[2]!) * invArea2;
        }
      }
    }
  }
}

/**
 * `objectExit`'s second sweep (see VOLUMETRIC.md "Step 1"). Walks every
 * polygon of every solid mesh a second time — back faces included, no
 * culling — clipping any triangle that straddles the near plane instead of
 * skipping it (a perspective camera near or inside the mesh is the
 * marquee volumetric case; skipping would NaN the exit there). For each
 * covered cell, keeps the FARTHEST depth among triangles belonging to the
 * mesh that won that cell in the entry pass (`winnerMeshBuf`), barycentric-
 * interpolating `objectVertices` at that depth into `exitPosBuf`.
 *
 * Same per-mesh `biasScale`/`depthEpsilon` and perspective-z convention as
 * the entry pass, so entry and exit depths are directly comparable.
 */
function rasterizeObjectExit(
  polygons: Polygon[],
  polygonMeshIds: number[] | null,
  camera: GlyphCamera,
  cols: number,
  rows: number,
  cellAspect: number,
  metrics: GlyphProjectionMetrics,
  winnerMeshBuf: Int32Array,
  depthBiases: number[] | undefined,
  depthEpsilon: number,
  exitPosBuf: Float32Array,
  exitDepthBuf: Float64Array,
): void {
  const projScratch: [number, number, number, number?][] = [];
  for (let polyIdx = 0; polyIdx < polygons.length; polyIdx++) {
    const poly = polygons[polyIdx]!;
    const verts = poly.vertices;
    if (verts.length < 3 || poly.hidden) continue;
    const meshId = polygonMeshIds ? polygonMeshIds[polyIdx]! : NO_MESH_ID_SUPPLIED;
    const objVerts = poly.objectVertices ?? verts;
    const biasScale = 1 + (depthBiases?.[polyIdx] ?? 0);

    for (let k = 0; k < verts.length; k++) {
      projScratch[k] = camera.project(verts[k]! as Vec3, cols, rows, cellAspect, metrics);
    }

    for (let fanIdx = 1; fanIdx < verts.length - 1; fanIdx++) {
      const vi0 = 0, vi1 = fanIdx, vi2 = fanIdx + 1;
      const v0 = verts[vi0]! as Vec3;
      const v1 = verts[vi1]! as Vec3;
      const v2 = verts[vi2]! as Vec3;
      const ov0 = objVerts[vi0]! as Vec3;
      const ov1 = objVerts[vi1]! as Vec3;
      const ov2 = objVerts[vi2]! as Vec3;

      const pa = projScratch[vi0]!;
      const pb = projScratch[vi1]!;
      const pc = projScratch[vi2]!;
      const nanCount =
        (pa[0] !== pa[0] ? 1 : 0) + (pb[0] !== pb[0] ? 1 : 0) + (pc[0] !== pc[0] ? 1 : 0);
      if (nanCount === 3) continue;

      if (nanCount === 0) {
        exitScanFillTriangle(
          pa[0], pa[1], (pa[3] ?? pa[2]) * biasScale, pa[3] ?? 1,
          pb[0], pb[1], (pb[3] ?? pb[2]) * biasScale, pb[3] ?? 1,
          pc[0], pc[1], (pc[3] ?? pc[2]) * biasScale, pc[3] ?? 1,
          ov0, ov1, ov2,
          exitPosBuf, exitDepthBuf, meshId, winnerMeshBuf, depthEpsilon, cols, rows,
        );
      } else {
        // Straddles the near plane: clip to the visible half-space exactly
        // like the entry pass, but only carrying position (`cw`) and
        // object-space position (`cow`) — no intensity/UV interpolation.
        const cw: Vec3[] = [];
        const cow: Vec3[] = [];
        const tri: Vec3[] = [v0, v1, v2];
        const objTri: Vec3[] = [ov0, ov1, ov2];
        const d0 = camera.eyeDepth(v0);
        const d1 = camera.eyeDepth(v1);
        const d2 = camera.eyeDepth(v2);
        const triD = [d0, d1, d2];
        for (let e = 0; e < 3; e++) {
          const n = (e + 1) % 3;
          const de = triD[e]!;
          const dn = triD[n]!;
          if (de > 0) {
            cw.push(tri[e]!);
            cow.push(objTri[e]!);
          }
          if ((de > 0) !== (dn > 0)) {
            const t = de / (de - dn);
            const ve = tri[e]!, vn = tri[n]!;
            cw.push([
              ve[0] + t * (vn[0] - ve[0]),
              ve[1] + t * (vn[1] - ve[1]),
              ve[2] + t * (vn[2] - ve[2]),
            ] as Vec3);
            const oe = objTri[e]!, on = objTri[n]!;
            cow.push([
              oe[0] + t * (on[0] - oe[0]),
              oe[1] + t * (on[1] - oe[1]),
              oe[2] + t * (on[2] - oe[2]),
            ] as Vec3);
          }
        }
        if (cw.length >= 3) {
          const cp = cw.map((w) => camera.project(w, cols, rows, cellAspect, metrics));
          for (let f = 1; f < cw.length - 1; f++) {
            const qa = cp[0]!, qb = cp[f]!, qc = cp[f + 1]!;
            exitScanFillTriangle(
              qa[0], qa[1], (qa[3] ?? qa[2]) * biasScale, qa[3] ?? 1,
              qb[0], qb[1], (qb[3] ?? qb[2]) * biasScale, qb[3] ?? 1,
              qc[0], qc[1], (qc[3] ?? qc[2]) * biasScale, qc[3] ?? 1,
              cow[0]!, cow[f]!, cow[f + 1]!,
              exitPosBuf, exitDepthBuf, meshId, winnerMeshBuf, depthEpsilon, cols, rows,
            );
          }
        }
      }
    }
  }
}

/**
 * Compute per-polygon, per-vertex smoothed normals for Gouraud shading.
 *
 * Vertices are bucketed by their exact world-space position (string key).
 * Within each bucket, a polygon's vertex normal is the average of every
 * adjacent polygon's face normal whose angle to *this* polygon's face normal
 * is ≤ creaseAngle. This preserves sharp creases (cube corners, hard edges)
 * while smoothing across genuine curved surfaces (bread crust, sphere).
 *
 * Returned shape: `out[polyIdx][vertIdx]` → normalized Vec3.
 * O(N + E) where N = polygons, E = total polygon-vertex pairs sharing a position.
 */
function computeVertexNormals(polygons: Polygon[], creaseAngleDeg: number): Vec3[][] {
  const n = polygons.length;
  // 1. Compute one face normal per polygon (from its first three vertices).
  //    Non-planar polygons get an approximation; acceptable for shading.
  const faceNormals: Vec3[] = new Array(n);
  for (let i = 0; i < n; i++) {
    const v = polygons[i]!.vertices;
    if (v.length < 3) { faceNormals[i] = [0, 0, 0]; continue; }
    const a = v[0]!, b = v[1]!, c = v[2]!;
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz) || 1;
    faceNormals[i] = [nx / len, ny / len, nz / len];
  }

  // 2. Bucket polygons by shared vertex position.
  const positionMap = new Map<string, number[]>();
  for (let i = 0; i < n; i++) {
    const verts = polygons[i]!.vertices;
    for (let v = 0; v < verts.length; v++) {
      const p = verts[v]!;
      const key = `${p[0]},${p[1]},${p[2]}`;
      let arr = positionMap.get(key);
      if (!arr) { arr = []; positionMap.set(key, arr); }
      // Dedup self-add: a polygon with a repeated vertex shouldn't double-count.
      if (arr.length === 0 || arr[arr.length - 1] !== i) arr.push(i);
    }
  }

  // 3. For each polygon-vertex, average neighbors within the crease cone.
  const cosThresh = Math.cos((creaseAngleDeg * Math.PI) / 180);
  const out: Vec3[][] = new Array(n);
  for (let i = 0; i < n; i++) {
    const verts = polygons[i]!.vertices;
    const myN = faceNormals[i]!;
    const polyOut: Vec3[] = new Array(verts.length);
    for (let v = 0; v < verts.length; v++) {
      const p = verts[v]!;
      const sharers = positionMap.get(`${p[0]},${p[1]},${p[2]}`)!;
      let nx = 0, ny = 0, nz = 0;
      for (let s = 0; s < sharers.length; s++) {
        const otherI = sharers[s]!;
        const oN = faceNormals[otherI]!;
        const dot = myN[0] * oN[0] + myN[1] * oN[1] + myN[2] * oN[2];
        if (dot >= cosThresh) { nx += oN[0]; ny += oN[1]; nz += oN[2]; }
      }
      const len = Math.hypot(nx, ny, nz) || 1;
      polyOut[v] = [nx / len, ny / len, nz / len];
    }
    out[i] = polyOut;
  }
  return out;
}

/**
 * `safe` (named for the `assertGlyph`/`assertColor` validation `true` buys,
 * not for `colorTolerance`) picks one of two coalescers. `true` (a
 * `transformCells` hook ran) routes through {@link encodeGlyphBuffers}, which
 * re-validates every cell since a hook can hand back arbitrary glyphs/colors.
 * `false` (the default, hookless, hot path — wireframe/ink/braille/solid all
 * reach it) uses its own duplicated run-coalescer instead of
 * `encodeGlyphBuffers`, because routing it through that validated encoder
 * measurably regresses this path: ~90-100% more time per call at ~86k cells,
 * a faithful standalone port of both loop bodies timed head-to-head
 * (`assertGlyph`/`assertColor` on every cell — COLOR-TOLERANCE.md review
 * Finding 5, not assumed). Both branches now support
 * `colorTolerance` (default `0` = off, byte-identical) — the unsafe branch
 * via the shared {@link colorRunExtends} test `encodeGlyphBuffers` and
 * `encodeGlyphBuffersDual` also use, so its comparison rule can't drift out
 * of sync with either encoder's, without paying their per-cell validation
 * cost. `colorTolerance` is a public scene option (see
 * `RasterizeContextOptions.colorTolerance`) and ten call sites in this file
 * pass `scene.colorTolerance` through to one of these two branches.
 */
function solidBufToString(
  glyphBuf: string[],
  colorBuf: (string | null)[] | null,
  cols: number,
  rows: number,
  safe = false,
  colorTolerance = 0,
): string {
  if (safe) {
    return encodeGlyphBuffers(glyphBuf, colorBuf ?? new Array<string | null>(cols * rows).fill(null), cols, rows, colorBuf !== null, null, colorTolerance);
  }
  // Coalesce runs of same-color consecutive cells into one <span> per run.
  // For ~5k colored cells with average run length 5, this drops total <span>
  // count by ~5x — innerHTML parsing scales linearly with DOM-node count, so
  // fewer larger spans is materially faster than one span per glyph.
  const tolerance2 = colorTolerance > 0 ? colorTolerance * colorTolerance : 0;
  const colorPackCache = colorTolerance > 0 ? new Map<string, number>() : null;
  const parts: string[] = [];
  let runColor: string | null = null;
  let runText = "";
  const flushRun = () => {
    if (!runText) return;
    if (runColor !== null) {
      parts.push(`<span style="color:${runColor}">${runText}</span>`);
    } else {
      parts.push(runText);
    }
    runText = "";
  };
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const idx = y * cols + x;
      const g = glyphBuf[idx]!;
      const col = (colorBuf && g !== " ") ? (colorBuf[idx] ?? null) : null;
      if (!colorRunExtends(colorPackCache, tolerance2, runColor, col)) {
        flushRun();
        runColor = col;
      }
      runText += g;
    }
    flushRun();
    runColor = null;
    if (y < rows - 1) parts.push("\n");
  }
  return parts.join("");
}

/**
 * Bake N rotation frames into an array of HTML strings, ready to be stacked
 * into a single `<pre>` and animated via CSS `steps(N)`. Mutates `camera.rotY`
 * temporarily and restores it before returning.
 *
 * Each returned frame may contain `<span style="color:…">` elements; consumers
 * must set `innerHTML` (not `textContent`) to preserve colors.
 */
/**
 * Rasterize the scene and return the final {@link CellGrid} instead of a string.
 *
 * The SAME cell contract the post-rasterize `transformCells` hook receives and
 * the web effect layer / future C device evaluator (M5) consume. Implemented by
 * driving the normal {@link rasterize} path with a capturing hook, so the grid
 * is exactly what the string would have been built from (no duplicated raster
 * logic, always in sync). Does not affect the string path in any way.
 */
export function rasterizeToCells(scene: RasterizeContext): CellGrid {
  let captured: CellGrid | null = null;
  const capture = (g: CellGrid): void => {
    // Clone so the grid outlives the rasterizer's scratch buffers.
    captured = buildCellGrid(
      g.char,
      g.color,
      g.depth,
      g.cols,
      g.rows,
      g.surfaceUv ?? null,
      g.shade ?? null,
      g.worldPosition ?? null,
      g.normal ?? null,
      g.winnerPolygon ?? null,
      g.albedoRgb ?? null,
      g.targetRgb ?? null,
      g.weight ?? null,
      g.objectPosition ?? null,
      g.objectExit ?? null,
      g.winnerMesh ?? null,
      g.objectNormal ?? null,
    );
  };
  rasterize({
    ...scene,
    retainShade: scene.mode === "solid",
    retainWorldPosition: scene.mode === "solid",
    retainNormal: scene.mode === "solid",
    retainWinnerPolygon: scene.mode === "solid",
    retainAlbedoRgb: scene.mode === "solid",
    retainTargetRgb: scene.mode === "solid",
    transformCells: capture,
  });
  if (captured) return captured;
  // Nothing drawn / mode built no grid — return an empty grid at grid size.
  const { cols, rows } = scene.grid;
  return buildCellGrid(new Array(cols * rows).fill(" "), null, null, cols, rows);
}

export function bakeFrames(scene: RasterizeContext, frameCount: number, axis: "x" | "y" = "y"): string[] {
  const { camera } = scene;
  const original = axis === "y" ? camera.rotY : camera.rotX;
  const frames: string[] = new Array(frameCount);
  for (let i = 0; i < frameCount; i++) {
    // Positive direction: matches glyphcss's CSS autorotate (increasing rotY =
    // CW on screen, right side goes down). Drag-right decreases rotY (CCW)
    // which is the orbit-controls convention; the strip plays CW to match
    // glyphcss's default autorotate appearance.
    const angle = original + (i / frameCount) * Math.PI * 2;
    if (axis === "y") camera.rotY = angle;
    else camera.rotX = angle;
    frames[i] = rasterize(scene);
  }
  if (axis === "y") camera.rotY = original;
  else camera.rotX = original;
  return frames;
}

/** Bresenham line into a row-major Uint8Array, max-merging the weight.
 *  Also writes the edge color into colorBuf when weight increases. */
function drawLineToStamp(
  stamp: Uint8Array,
  colorBuf: (string | null)[] | null,
  x0: number, y0: number,
  x1: number, y1: number,
  val: number,
  color: string | null,
  cols: number,
  rows: number,
): void {
  const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  while (true) {
    if (x0 >= 0 && x0 < cols && y0 >= 0 && y0 < rows) {
      const idx = y0 * cols + x0;
      if (stamp[idx] < val) {
        stamp[idx] = val;
        if (colorBuf) colorBuf[idx] = color;
      }
    }
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; x0 += sx; }
    if (e2 <= dx) { err += dx; y0 += sy; }
  }
}

/**
 * Depth-tested sibling of `drawLineToStamp` for
 * `hiddenLines: "hide"`. Same Bresenham walk, but each sample
 * interpolates the edge's own camera-space depth linearly over the walk's
 * step count (a screen-space-parametric approximation — adequate at the
 * straight, moderate-depth-range edges this spike targets, and consistent
 * with the rest of the wireframe path already working in integer cell
 * coordinates with no other correction) and only stamps the cell when
 * `wireframeVisibleAtCell` says the stroke is not hidden behind the surface
 * prepass there.
 */
function drawLineToStampDepthTested(
  stamp: Uint8Array,
  colorBuf: (string | null)[] | null,
  x0: number, y0: number,
  x1: number, y1: number,
  z0: number, z1: number,
  val: number,
  color: string | null,
  cols: number,
  rows: number,
  surfaceDepth: Float64Array,
  bias: number,
  slopeScale: number,
): void {
  const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  const totalSteps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1);
  let step = 0;
  while (true) {
    if (x0 >= 0 && x0 < cols && y0 >= 0 && y0 < rows) {
      const t = step / totalSteps;
      const z = z0 + (z1 - z0) * t;
      if (wireframeVisibleAtCell(surfaceDepth, cols, rows, x0, y0, z, bias, slopeScale)) {
        const idx = y0 * cols + x0;
        if (stamp[idx] < val) {
          stamp[idx] = val;
          if (colorBuf) colorBuf[idx] = color;
        }
      }
    }
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; x0 += sx; }
    if (e2 <= dx) { err += dx; y0 += sy; }
    step++;
  }
}

/**
 * Braille-encoded wireframe (`charMode: "braille"`). Rasterizes each edge
 * ONCE, directly into a 2-wide × 4-tall subcell grid per output cell, to
 * build a dot-coverage bitmask; color is attributed from that SAME subcell
 * pass (same coordinates, same rounding) rather than from an independent
 * cell-resolution line pass, so a cell's color and its lit dots can never
 * disagree about which edge (or whether any edge) covers it. Each covered
 * output cell becomes `U+2800 + mask` (Unicode Braille Patterns block),
 * giving up to 8 independent sub-cell "pixels" per glyph — visibly smoother
 * diagonal/curved edges than the single ASCII rule glyph the default path
 * picks per cell. Runs entirely after camera projection and before
 * string-building; still exactly one string produced per call. Like the
 * ASCII wireframe path, the post-rasterize `transformCells` hook (when
 * supplied) runs on the folded per-cell char/color buffers before the final
 * string is built.
 */
function rasterizeWireframeBraille(
  scene: RasterizeContext,
  cols: number,
  rows: number,
  cellAspect: number,
  metrics: GlyphProjectionMetrics,
): string {
  const { camera, wireframe } = scene;
  const colorBuf: (string | null)[] | null = scene.useColors ? new Array(cols * rows).fill(null) : null;
  // Cell-resolution weight, updated from the same subcell coordinates that
  // light dots — the only tie-break input for overlapping edges' colors.
  const colorWeight: Uint8Array | null = colorBuf ? new Uint8Array(cols * rows) : null;

  const subCols = cols * 2;
  const subRows = rows * 4;
  const subStamp = new Uint8Array(subCols * subRows);

  // `hiddenLines: "hide"` for braille — see the ASCII path in `rasterize()`.
  // The surface prepass is built at CELL resolution, not braille's finer 2×4
  // subcell resolution: measured 777 vs 786 inked cells (1.2% difference)
  // for 25% more cost (0.916ms vs 0.733ms subcell-resolution depth) — braille
  // strokes are already ~1 subcell wide, so a whole glyph can share one
  // occlusion decision (`research/contour-first-text/decisions.md`, subpath 05).
  const hlr = scene.hiddenLines === "hide";
  const surfaceDepth = hlr
    ? buildSurfaceDepth(scene.polygons, camera, cols, rows, cellAspect, metrics)
    : null;

  for (const e of wireframe) {
    const a = camera.project(e.from, cols, rows, cellAspect, metrics);
    const b = camera.project(e.to, cols, rows, cellAspect, metrics);
    // Near-plane culled vertices come back as NaN — skip the line entirely.
    if (a[0] !== a[0] || b[0] !== b[0]) continue;
    if (surfaceDepth) {
      drawSubcellLineDepthTested(
        subStamp, colorWeight, colorBuf,
        Math.floor(a[0] * 2), Math.floor(a[1] * 4), Math.floor(b[0] * 2), Math.floor(b[1] * 4),
        a[2]!, b[2]!,
        subCols, subRows, cols,
        e.weight ?? 2, e.color ?? null,
        surfaceDepth, HLR_BIAS, HLR_SLOPE_SCALE,
      );
    } else {
      drawSubcellLine(
        subStamp, colorWeight, colorBuf,
        Math.floor(a[0] * 2), Math.floor(a[1] * 4), Math.floor(b[0] * 2), Math.floor(b[1] * 4),
        subCols, subRows, cols,
        e.weight ?? 2, e.color ?? null,
      );
    }
  }

  const { char: cChar, color: cColor } = foldBrailleSubStampToCells(subStamp, colorBuf, cols, rows, subCols);

  if (scene.transformCells) {
    const applied = applyCellHook(scene.transformCells, cChar, cColor, null, cols, rows);
    return solidBufToString(applied.char, applied.color, cols, rows, true, scene.colorTolerance);
  }

  return solidBufToString(cChar, cColor, cols, rows, false, scene.colorTolerance);
}

/**
 * 4-connected Bresenham coverage line into a subcell grid (a dot is either
 * lit or not — no weight tiers). When `colorBuf` is supplied, also
 * attributes the owning CELL's color from this same subcell walk
 * (max-merging by `val`, same semantics as `drawLineToStamp`), so color and
 * dot coverage are always derived from identical coordinates/rounding —
 * never a separate pass.
 *
 * Two properties matter for braille output specifically (a plain 8-connected
 * Bresenham, as used by the ASCII stamp path, has neither):
 *
 * - Endpoint-order independence: walking `from → to` and `to → from` must
 *   light the identical dot set. `featureEdges` fixes a `from`/`to` order per
 *   mesh edge from vertex authoring order, not from screen-space geometry —
 *   on a bilaterally symmetric mesh a left-side edge and its mirror-image
 *   right-side edge can walk in opposite relative screen directions. A plain
 *   Bresenham's tie-breaking is direction-dependent, so the two sides light
 *   different dot patterns for otherwise-mirrored geometry. Canonicalizing
 *   the walk direction before stepping (smallest-`y` endpoint first, `x`
 *   tie-break) makes the result depend only on the two endpoints, not which
 *   one was authored as `from`.
 * - 4-connectivity: a plain Bresenham is only 8-connected — consecutive dots
 *   on a steep diagonal can be corner-adjacent with no shared edge, which a
 *   sparse braille dot (a small glyph inside its cell, not a filled pixel)
 *   renders as a visible gap. Each diagonal step (both x and y advance in
 *   the same iteration) also lights the intermediate orthogonal dot, so the
 *   lit set forms an unbroken 4-connected path.
 *
 * The Y-first canonicalization (rather than X-first) is what keeps this
 * mirror-symmetric under horizontal reflection: mirroring negates only `x`,
 * so canonicalizing on `y` never changes which endpoint the walk starts
 * from, and the "move-y-first" intermediate-dot tie-break stays consistent
 * on both sides. Termination is unaffected — canonicalization only swaps
 * the two endpoints (dx/dy magnitudes, and thus the standard Bresenham
 * step/termination guarantee, are unchanged); this is NOT an aspect-weighted
 * variant.
 *
 * Exported (in addition to its use from `rasterizeWireframeBraille`) so the
 * order-independence / mirror-symmetry / 4-connectivity regression tests in
 * `rasterize.braille.test.ts` can exercise this exact walk directly at
 * integer subcell coordinates, instead of through camera projection's own
 * (unrelated) floor-rounding.
 */
export function drawSubcellLine(
  stamp: Uint8Array,
  colorWeight: Uint8Array | null,
  colorBuf: (string | null)[] | null,
  x0: number, y0: number,
  x1: number, y1: number,
  subCols: number,
  subRows: number,
  cellCols: number,
  val: number,
  color: string | null,
): void {
  if (y0 > y1 || (y0 === y1 && x0 > x1)) {
    const tx = x0; x0 = x1; x1 = tx;
    const ty = y0; y0 = y1; y1 = ty;
  }
  const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : (x0 > x1 ? -1 : 1);
  let err = dx + dy;
  let cx = x0, cy = y0;
  while (true) {
    if (cx >= 0 && cx < subCols && cy >= 0 && cy < subRows) {
      stamp[cy * subCols + cx] = 1;
      if (colorBuf) {
        const cellIdx = (cy >> 2) * cellCols + (cx >> 1);
        if (colorWeight![cellIdx] < val) {
          colorWeight![cellIdx] = val;
          colorBuf[cellIdx] = color;
        }
      }
    }
    if (cx === x1 && cy === y1) break;
    const e2 = 2 * err;
    let movedX = false;
    let nx = cx, ny = cy;
    if (e2 >= dy) { err += dy; nx = cx + sx; movedX = true; }
    if (e2 <= dx) { err += dx; ny = cy + 1; }
    if (movedX && ny !== cy) {
      // Diagonal step: light the "move-y-first" intermediate dot so the
      // path stays 4-connected instead of only touching at a corner.
      if (cx >= 0 && cx < subCols && ny >= 0 && ny < subRows) {
        stamp[ny * subCols + cx] = 1;
        if (colorBuf) {
          const cellIdx = (ny >> 2) * cellCols + (cx >> 1);
          if (colorWeight![cellIdx] < val) {
            colorWeight![cellIdx] = val;
            colorBuf[cellIdx] = color;
          }
        }
      }
    }
    cx = nx; cy = ny;
  }
}

/**
 * Depth-tested sibling of `drawSubcellLine` for
 * `hiddenLines: "hide"` in braille mode. Same canonicalized 4-connected
 * walk (endpoint depths `z0`/`z1` are swapped together with `x0,y0`/`x1,y1` so
 * the depth interpolation stays consistent with whichever endpoint the walk
 * now starts from), but each dot (including the 4-connectivity intermediate
 * dot) is depth-tested via `wireframeVisibleAtCell` before being lit.
 * `surfaceDepth` is always CELL resolution (index by the owning cell,
 * `cx>>1, cy>>2`) — see `rasterizeWireframeBraille`'s doc comment for why
 * subcell-resolution depth was measured and not shipped.
 */
function drawSubcellLineDepthTested(
  stamp: Uint8Array,
  colorWeight: Uint8Array | null,
  colorBuf: (string | null)[] | null,
  x0: number, y0: number,
  x1: number, y1: number,
  z0: number, z1: number,
  subCols: number,
  subRows: number,
  cellCols: number,
  val: number,
  color: string | null,
  surfaceDepth: Float64Array,
  bias: number,
  slopeScale: number,
): void {
  if (y0 > y1 || (y0 === y1 && x0 > x1)) {
    const tx = x0; x0 = x1; x1 = tx;
    const ty = y0; y0 = y1; y1 = ty;
    const tz = z0; z0 = z1; z1 = tz;
  }
  const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : (x0 > x1 ? -1 : 1);
  let err = dx + dy;
  let cx = x0, cy = y0;
  const totalSteps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1);
  let step = 0;
  const depthCols = cellCols;
  const depthRows = subRows >> 2;
  const visible = (px: number, py: number): boolean => {
    const dcx = px >> 1;
    const dcy = py >> 2;
    const t = step / totalSteps;
    const z = z0 + (z1 - z0) * t;
    return wireframeVisibleAtCell(surfaceDepth, depthCols, depthRows, dcx, dcy, z, bias, slopeScale);
  };
  while (true) {
    if (cx >= 0 && cx < subCols && cy >= 0 && cy < subRows && visible(cx, cy)) {
      stamp[cy * subCols + cx] = 1;
      if (colorBuf) {
        const cellIdx = (cy >> 2) * cellCols + (cx >> 1);
        if (colorWeight![cellIdx] < val) {
          colorWeight![cellIdx] = val;
          colorBuf[cellIdx] = color;
        }
      }
    }
    if (cx === x1 && cy === y1) break;
    const e2 = 2 * err;
    let movedX = false;
    let nx = cx, ny = cy;
    if (e2 >= dy) { err += dy; nx = cx + sx; movedX = true; }
    if (e2 <= dx) { err += dx; ny = cy + 1; }
    if (movedX && ny !== cy) {
      if (cx >= 0 && cx < subCols && ny >= 0 && ny < subRows && visible(cx, ny)) {
        stamp[ny * subCols + cx] = 1;
        if (colorBuf) {
          const cellIdx = (ny >> 2) * cellCols + (cx >> 1);
          if (colorWeight![cellIdx] < val) {
            colorWeight![cellIdx] = val;
            colorBuf[cellIdx] = color;
          }
        }
      }
    }
    cx = nx; cy = ny;
    step++;
  }
}

// Braille Patterns dot-bit layout (NOT raster order): col0 rows 0..3 →
// 0x01,0x02,0x04,0x40; col1 rows 0..3 → 0x08,0x10,0x20,0x80.
const BRAILLE_BITS_COL0 = [0x01, 0x02, 0x04, 0x40];
const BRAILLE_BITS_COL1 = [0x08, 0x10, 0x20, 0x80];

/**
 * Fold a 2×4 subcell coverage grid down to one braille glyph per output
 * cell. `colorBuf`, when supplied, is already cell-resolution — it was
 * populated by `drawSubcellLine` from the SAME subcell coordinates being
 * folded here, so it needs no re-derivation; this just clears any stray
 * entry on a cell that ends up uncovered. Returns plain arrays (not a
 * string) so the caller can run the `transformCells` hook on them before
 * stringifying, exactly like the ASCII wireframe path does with its stamp
 * buffer.
 */
function foldBrailleSubStampToCells(
  subStamp: Uint8Array,
  colorBuf: (string | null)[] | null,
  cols: number,
  rows: number,
  subCols: number,
): { char: string[]; color: (string | null)[] | null } {
  const n = cols * rows;
  const char: string[] = new Array(n);
  for (let y = 0; y < rows; y++) {
    const baseSubY = y * 4;
    for (let x = 0; x < cols; x++) {
      const baseSubX = x * 2;
      let mask = 0;
      for (let r = 0; r < 4; r++) {
        const rowBase = (baseSubY + r) * subCols;
        if (subStamp[rowBase + baseSubX]) mask |= BRAILLE_BITS_COL0[r]!;
        if (subStamp[rowBase + baseSubX + 1]) mask |= BRAILLE_BITS_COL1[r]!;
      }
      const idx = y * cols + x;
      if (mask === 0) {
        char[idx] = " ";
        if (colorBuf) colorBuf[idx] = null;
      } else {
        char[idx] = String.fromCharCode(0x2800 + mask);
      }
    }
  }
  return { char, color: colorBuf };
}

/**
 * `colorTolerance` (default `0` = off, byte-identical) via the shared
 * {@link colorRunExtends} test — this is the plain-`charMode: "ascii"`
 * wireframe/voxel no-hook path (`rasterize()`'s default branch), a
 * DUPLICATE run-coalescer alongside `solidBufToString`'s unsafe branch for
 * the same "avoid `encodeGlyphBuffers`'s per-cell validation cost on the hot
 * path" reason (COLOR-TOLERANCE.md review Finding 5 covered `solidBufToString`
 * explicitly but missed this sibling coalescer — closed here so `colorTolerance`
 * actually reaches the single most common render path instead of silently
 * no-op'ing there).
 */
function stampToGlyphs(
  stamp: Uint8Array,
  colorBuf: (string | null)[] | null,
  cols: number,
  rows: number,
  glyphs: { thin: string[]; normal: string[]; core: string[] },
  junctionMask: Uint8Array | null = null,
  colorTolerance = 0,
): string {
  // Coalesce same-color consecutive non-empty cells into one <span> per run.
  // When colors are disabled (colorBuf=null) we emit plain text — one text node.
  const tolerance2 = colorTolerance > 0 ? colorTolerance * colorTolerance : 0;
  const colorPackCache = colorTolerance > 0 ? new Map<string, number>() : null;
  const parts: string[] = [];
  let runColor: string | null = null;
  let runText = "";
  const flushRun = () => {
    if (!runText) return;
    if (runColor !== null) {
      parts.push(`<span style="color:${runColor}">${runText}</span>`);
    } else {
      parts.push(runText);
    }
    runText = "";
  };
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const idx = y * cols + x;
      const v = stamp[idx];
      let g: string;
      let col: string | null;
      if (v === 0) {
        g = " ";
        col = null;
      } else {
        g = wireframeGlyphForCell(v, junctionMask ? junctionMask[idx]! : 0, glyphs);
        col = colorBuf ? (colorBuf[idx] ?? null) : null;
      }
      if (!colorRunExtends(colorPackCache, tolerance2, runColor, col)) {
        flushRun();
        runColor = col;
      }
      runText += g;
    }
    flushRun();
    runColor = null;
    if (y < rows - 1) parts.push("\n");
  }
  return parts.join("");
}

// Memoized: meshes reuse a small set of base colors, so parsing the same hex
// strings thousands of times per frame is pure waste. Keyed by the raw string.
const rgbMemo = new Map<string, [number, number, number]>();
function hexToRgb(hex: string): [number, number, number] {
  const cached = rgbMemo.get(hex);
  if (cached !== undefined) return cached;
  const rgb = parseHexToRgb(hex);
  rgbMemo.set(hex, rgb);
  return rgb;
}

function parseHexToRgb(hex: string): [number, number, number] {
  // Accepts #rgb / #rrggbb. Anything else falls through to white.
  const h = hex.startsWith("#") ? hex.slice(1) : hex;
  if (h.length === 3) {
    const r = parseInt(h[0]! + h[0], 16);
    const g = parseInt(h[1]! + h[1], 16);
    const b = parseInt(h[2]! + h[2], 16);
    return [r || 0, g || 0, b || 0];
  }
  if (h.length === 6) {
    const r = parseInt(h.slice(0, 2), 16);
    const g = parseInt(h.slice(2, 4), 16);
    const b = parseInt(h.slice(4, 6), 16);
    return [r || 0, g || 0, b || 0];
  }
  return [255, 255, 255];
}

function toHex2(n: number): string {
  const v = Math.max(0, Math.min(255, n | 0)).toString(16);
  return v.length === 1 ? "0" + v : v;
}
