import type { RasterizeContext, TemporalHistory } from "../api/rasterizeContext";
import { createGlyphOrthographicCamera, createGlyphPerspectiveCamera, type GlyphProjectionMetrics } from "../api/createGlyphCamera";
import type { Polygon, Vec3, TextureSampler } from "@glyphcss/core";
import { sampleTexel, polygonTexture } from "@glyphcss/core";
import { getWireframeGlyphs } from "./ramps";
import { applyCellHook, buildCellGrid } from "./cells";
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

export function rasterize(scene: RasterizeContext): string {
  const { camera, grid, wireframe, mode } = scene;
  const { cols, rows, cellAspect } = grid;
  const metrics = projectionMetricsForGrid(cols, rows, cellAspect, grid);

  if (mode === "solid") {
    const ss = scene.supersample && scene.supersample > 1 ? Math.floor(scene.supersample) : 1;
    return rasterizeSolid(scene, cols, rows, cellAspect, ss, metrics);
  }

  // wireframe (and voxel falls through to wireframe for now)
  const glyphs = getWireframeGlyphs(scene.glyphPalette);
  const stamp = new Uint8Array(cols * rows);
  // Color buffer: one entry per cell. null means "no color" (use CSS fallback).
  // When colors are disabled, we don't even allocate the buffer (saves GC).
  const colorBuf: (string | null)[] | null = scene.useColors ? new Array(cols * rows).fill(null) : null;

  for (const e of wireframe) {
    const a = camera.project(e.from, cols, rows, cellAspect, metrics);
    const b = camera.project(e.to, cols, rows, cellAspect, metrics);
    // Near-plane culled vertices come back as NaN — skip the line entirely.
    if (a[0] !== a[0] || b[0] !== b[0]) continue;
    drawLineToStamp(stamp, colorBuf, a[0] | 0, a[1] | 0, b[0] | 0, b[1] | 0, e.weight ?? 2, e.color ?? null, cols, rows);
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
        cChar[i] = v === 1
          ? glyphs.thin[(Math.random() * glyphs.thin.length) | 0]!
          : v === 2
            ? glyphs.normal[(Math.random() * glyphs.normal.length) | 0]!
            : glyphs.core[(Math.random() * glyphs.core.length) | 0]!;
        if (cColor) cColor[i] = colorBuf ? (colorBuf[i] ?? null) : null;
      }
    }
    const applied = applyCellHook(scene.transformCells, cChar, cColor, null, cols, rows);
    return solidBufToString(applied.char, applied.color, cols, rows);
  }

  return stampToGlyphs(stamp, colorBuf, cols, rows, glyphs);
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
  const ramp = getWireframeGlyphs(scene.glyphPalette).solid;
  const rampMax = ramp.length - 1;

  // Per-cell scratch buffers (glyph + colour + depth + optional worldPos). These
  // are cols*rows (up to ~80k entries at a fine supersampled grid) and were
  // allocated fresh every render — the dominant per-frame garbage, which shows up
  // as periodic GC frame-hitches. Reuse them across renders, stashed on the
  // persistent camera (one camera per scene in practice); re-`fill` each frame
  // (cheap, cache-friendly) and only reallocate when the grid size changes.
  const n = cols * rows;
  const useColors = scene.useColors;
  const reproject = scene.temporalBlend > 0 && !!scene.temporalHistory;
  const camHost = rawCamera as unknown as {
    __glyphScratch?: { n: number; glyph: string[]; color: (string | null)[]; depth: Float64Array; world: Float32Array | null };
  };
  let scratch = camHost.__glyphScratch;
  if (!scratch || scratch.n !== n) {
    scratch = { n, glyph: new Array(n), color: new Array(n), depth: new Float64Array(n), world: null };
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
  // World-position buffer for reprojection TAA — only needed when temporal
  // blending is on. NaN marks "no surface here" (empty cell).
  let worldPosBuf: Float32Array | null = null;
  if (reproject) {
    if (!scratch.world || scratch.world.length !== n * 3) scratch.world = new Float32Array(n * 3);
    worldPosBuf = scratch.world;
    worldPosBuf.fill(NaN);
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
    // Consumer-driven cull (e.g. BSP PVS): a hidden polygon is skipped before any
    // projection/shading/scan-fill. `triT` must still advance by this polygon's
    // triangle count so the positional cross-frame shadeCache stays aligned when
    // the hidden set changes between frames.
    if (poly.hidden) { triT += verts.length - 2; continue; }
    // Texture for this polygon: sample per cell when a sampler + matching UVs
    // exist; otherwise fall back to the flat per-face color.
    const polyUvs = poly.uvs;
    let polySampler: TextureSampler | null = null;
    if (textureSamplers !== null && polyUvs && polyUvs.length >= verts.length) {
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
      let iA: number, iB: number, iC: number;
      let litColor: string | null = null;
      if (shadeCache !== null && shadeCache.iA[triT] !== undefined) {
        iA = shadeCache.iA[triT]!;
        iB = shadeCache.iB[triT]!;
        iC = shadeCache.iC[triT]!;
        litColor = shadeCache.lit[triT]!;
      } else {
        // Face normal in world space (for flat shading or as a fallback when
        // vertex normals aren't computed).
        const ux = v1[0] - v0[0], uy = v1[1] - v0[1], uz = v1[2] - v0[2];
        const vvx = v2[0] - v0[0], vvy = v2[1] - v0[1], vvz = v2[2] - v0[2];
        const fnx = uy * vvz - uz * vvy;
        const fny = uz * vvx - ux * vvz;
        const fnz = ux * vvy - uy * vvx;
        const fnLen = Math.hypot(fnx, fny, fnz) || 1;
        const fnxN = fnx / fnLen, fnyN = fny / fnLen, fnzN = fnz / fnLen;

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
          pa[0], pa[1], (pa[3] ?? pa[2]) * biasScale, iA,
          pb[0], pb[1], (pb[3] ?? pb[2]) * biasScale, iB,
          pc[0], pc[1], (pc[3] ?? pc[2]) * biasScale, iC,
          ramp, rampMax, litColor,
          glyphBuf, colorBuf, depthBuf,
          cols, rows,
          makeShadowCtx(v0, v1, v2, receiveShadow),
          doubleSided,
          v0, v1, v2, worldPosBuf,
          depthEpsilon,
          texCtx,
        );
      } else {
        // Straddles the near plane: clip the triangle to the visible half-space
        // (`eyeDepth > 0`) and scan-fill the resulting sub-triangles. The face
        // normal, colour and shading are unchanged by clipping; only positions
        // and per-vertex intensities are interpolated at the crossings.
        const cw: Vec3[] = [];
        const ci: number[] = [];
        const tri: Vec3[] = [v0, v1, v2];
        const triI = [iA, iB, iC];
        const d0 = camera.eyeDepth(v0);
        const d1 = camera.eyeDepth(v1);
        const d2 = camera.eyeDepth(v2);
        const triD = [d0, d1, d2];
        for (let e = 0; e < 3; e++) {
          const n = (e + 1) % 3;
          const de = triD[e]!;
          const dn = triD[n]!;
          if (de > 0) { cw.push(tri[e]!); ci.push(triI[e]!); }
          if ((de > 0) !== (dn > 0)) {
            const t = de / (de - dn);
            const ve = tri[e]!, vn = tri[n]!;
            cw.push([
              ve[0] + t * (vn[0] - ve[0]),
              ve[1] + t * (vn[1] - ve[1]),
              ve[2] + t * (vn[2] - ve[2]),
            ] as Vec3);
            ci.push(triI[e]! + t * (triI[n]! - triI[e]!));
          }
        }
        if (cw.length >= 3) {
          const cp = cw.map((w) => camera.project(w, cols, rows, cellAspect, scaledMetrics));
          for (let f = 1; f < cw.length - 1; f++) {
            const qa = cp[0]!, qb = cp[f]!, qc = cp[f + 1]!;
            const area2c = (qb[0] - qa[0]) * (qc[1] - qa[1]) - (qb[1] - qa[1]) * (qc[0] - qa[0]);
            if (!doubleSided && area2c > 0) continue;
            scanFillTriangle(
              qa[0], qa[1], (qa[3] ?? qa[2]) * biasScale, ci[0]!,
              qb[0], qb[1], (qb[3] ?? qb[2]) * biasScale, ci[f]!,
              qc[0], qc[1], (qc[3] ?? qc[2]) * biasScale, ci[f + 1]!,
              ramp, rampMax, litColor,
              glyphBuf, colorBuf, depthBuf,
              cols, rows,
              makeShadowCtx(cw[0]!, cw[f]!, cw[f + 1]!, receiveShadow),
              doubleSided,
              cw[0]!, cw[f]!, cw[f + 1]!, worldPosBuf,
              depthEpsilon,
              // Near-plane-clipped sub-triangles don't carry interpolated UVs;
              // fall back to flat color (rare: textured face straddling the eye).
              null,
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
          if (colorBuf) colorBuf[idx] = null;
        }
      }
    }
  }

  if (__detail) { (__detail.loop ??= []).push(performance.now() - __tLoop); }
  const __tStr = __detail ? performance.now() : 0;
  // Final output buffers at the OUTPUT resolution (downsampled if supersampling).
  let finalGlyph = glyphBuf;
  let finalColor = colorBuf;
  let finalWorldPos: Float32Array | null = worldPosBuf;
  if (supersample > 1) {
    const ds = downsampleSolid(glyphBuf, colorBuf, depthBuf, worldPosBuf, outCols, outRows, supersample, ramp);
    finalGlyph = ds.glyphBuf;
    finalColor = ds.colorBuf;
    finalWorldPos = ds.worldPos;
  }
  if (reproject) {
    applyReprojectionTAA(finalGlyph, finalColor, finalWorldPos!, outCols, outRows, cellAspect, metrics, ramp, scene.temporalBlend, scene.temporalHistory!, rawCamera);
  }
  // Post-rasterize cell hook (M4 composition effects). No-op + byte-identical
  // when scene.transformCells is absent (block skipped entirely). Output-res
  // depth is available only at supersample===1; else buildCellGrid derives a
  // coverage proxy. Runs BEFORE the single string is built (<pre>-write-once).
  if (scene.transformCells) {
    const applied = applyCellHook(
      scene.transformCells, finalGlyph, finalColor,
      supersample > 1 ? null : depthBuf, outCols, outRows,
    );
    finalGlyph = applied.char;
    finalColor = applied.color;
  }
  const out = solidBufToString(finalGlyph, finalColor, outCols, outRows);
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
  worldPosIn: Float32Array | null,
  outCols: number,
  outRows: number,
  S: number,
  ramp: string[],
): { glyphBuf: string[]; colorBuf: (string | null)[] | null; worldPos: Float32Array | null } {
  const rampIndex = new Map<string, number>();
  for (let i = 0; i < ramp.length; i++) rampIndex.set(ramp[i]!, i);
  const rampMax = ramp.length - 1;
  const inCols = outCols * S;
  const og: string[] = new Array(outCols * outRows).fill(" ");
  const oc: (string | null)[] | null = colorBuf ? new Array(outCols * outRows).fill(null) : null;
  const ow: Float32Array | null = worldPosIn ? new Float32Array(outCols * outRows * 3).fill(NaN) : null;
  const inv = 1 / (S * S);
  for (let oy = 0; oy < outRows; oy++) {
    for (let ox = 0; ox < outCols; ox++) {
      let idxSum = 0, cov = 0, r = 0, g = 0, b = 0, wx = 0, wy = 0, wz = 0;
      for (let sy = 0; sy < S; sy++) {
        const base = (oy * S + sy) * inCols + ox * S;
        for (let sx = 0; sx < S; sx++) {
          const si = base + sx;
          // Coverage comes from the depth buffer, not the glyph: `ramp[0]` is a
          // space, so a covered-but-dim subcell looks identical to an empty one
          // in `glyphBuf`. Using depth keeps dim surfaces (and their colour).
          if (depthBuf[si] === -Infinity) continue;
          idxSum += rampIndex.get(glyphBuf[si]!) ?? 0;
          cov++;
          if (oc) { const c = colorBuf![si]; if (c) { const rgb = hexToRgb(c); r += rgb[0]; g += rgb[1]; b += rgb[2]; } }
          if (ow) { wx += worldPosIn![si * 3]!; wy += worldPosIn![si * 3 + 1]!; wz += worldPosIn![si * 3 + 2]!; }
        }
      }
      const oi = oy * outCols + ox;
      if (cov === 0) continue; // stays space
      let gi = Math.round(idxSum * inv); // coverage-weighted intensity (empty subcells = 0)
      if (gi < 0) gi = 0; else if (gi > rampMax) gi = rampMax;
      og[oi] = ramp[gi]!;
      if (oc) oc[oi] = `#${toHex2(r / cov)}${toHex2(g / cov)}${toHex2(b / cov)}`;
      if (ow) { ow[oi * 3] = wx / cov; ow[oi * 3 + 1] = wy / cov; ow[oi * 3 + 2] = wz / cov; }
    }
  }
  return { glyphBuf: og, colorBuf: oc, worldPos: ow };
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
  ax: number, ay: number, az: number, ia: number,
  bx: number, by: number, bz: number, ib: number,
  cx: number, cy: number, cz: number, ic: number,
  ramp: string[],
  rampMax: number,
  color: string | null,
  glyphBuf: string[],
  colorBuf: (string | null)[] | null,
  depthBuf: Float64Array,
  cols: number,
  rows: number,
  sh: ScanFillShadowCtx | null,
  doubleSided: boolean,
  // World-space triangle verts + output buffer for per-cell world position
  // (used by reprojection TAA). `worldPosBuf` is null when not needed.
  wv0: Vec3, wv1: Vec3, wv2: Vec3,
  worldPosBuf: Float32Array | null,
  // Relative depth-test deadband (0 = exact). A new triangle replaces the
  // current cell only when nearer by more than this fraction; near-coplanar
  // surfaces keep a stable winner instead of z-fighting frame to frame.
  depthEpsilon: number,
  // Per-cell texture sampling for this triangle (null → flat `color`).
  tex: ScanFillTexCtx | null,
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
        if (worldPosBuf !== null) {
          // Per-cell world position (barycentric) for reprojection TAA.
          const o = idx * 3;
          worldPosBuf[o] = (wA * wv0[0]! + wB * wv1[0]! + wC * wv2[0]!) * invArea2;
          worldPosBuf[o + 1] = (wA * wv0[1]! + wB * wv1[1]! + wC * wv2[1]!) * invArea2;
          worldPosBuf[o + 2] = (wA * wv0[2]! + wB * wv1[2]! + wC * wv2[2]!) * invArea2;
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
        let intensity = (wA * ia + wB * ib + wC * ic) * invArea2;
        let cellColor = color;

        // Per-cell texture: barycentric-interpolate UV, sample the texel. Its
        // color (× the triangle's light tint) becomes this cell's color, and its
        // luminance folds into the glyph intensity — so the *character* reflects
        // image brightness too: a flat textured quad reads as ASCII art, a lit
        // textured mesh shows texture detail modulated by shading.
        if (tex !== null) {
          const u = (wA * tex.ua + wB * tex.ub + wC * tex.uc) * invArea2;
          const v = (wA * tex.va + wB * tex.vb + wC * tex.vc) * invArea2;
          const texel = sampleTexel(tex.sampler, u, v);
          if (texel !== null && texel.a > 8) {
            let r = (texel.r * tex.tintR) | 0; if (r > 255) r = 255;
            let g = (texel.g * tex.tintG) | 0; if (g > 255) g = 255;
            let b = (texel.b * tex.tintB) | 0; if (b > 255) b = 255;
            cellColor = `#${toHex2(r)}${toHex2(g)}${toHex2(b)}`;
            intensity *= (0.299 * texel.r + 0.587 * texel.g + 0.114 * texel.b) / 255;
          }
        }

        // Per-cell intensity. Glyph choice happens after shadowing so shadows
        // can attenuate only the direct/key-light part of the signal.
        let clamped = intensity < 0 ? 0 : intensity > 1 ? 1 : intensity;

        // Shadow occlusion: barycentric-interpolate light-space (u,v,depth),
        // sample the shadow map, darken if occluded.
        if (sh !== null) {
          const lu = (wA * sh.luA + wB * sh.luB + wC * sh.luC) * invArea2;
          const lv = (wA * sh.lvA + wB * sh.lvB + wC * sh.lvC) * invArea2;
          const ld = (wA * sh.ldA + wB * sh.ldB + wC * sh.ldC) * invArea2;
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

        const rampPos = clamped * rampMax;
        const lower = rampPos | 0;
        const frac = rampPos - lower;
        const threshold = BAYER_4X4[(row & 3) * 4 + (col & 3)]!;
        let glyphIdx = frac > threshold && lower < rampMax ? lower + 1 : lower;
        if (glyphIdx > rampMax) glyphIdx = rampMax;

        glyphBuf[idx] = ramp[glyphIdx]!;
        if (colorBuf) colorBuf[idx] = cellColor;
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

function solidBufToString(glyphBuf: string[], colorBuf: (string | null)[] | null, cols: number, rows: number): string {
  // Coalesce runs of same-color consecutive cells into one <span> per run.
  // For ~5k colored cells with average run length 5, this drops total <span>
  // count by ~5x — innerHTML parsing scales linearly with DOM-node count, so
  // fewer larger spans is materially faster than one span per glyph.
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
      if (col !== runColor) {
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
    captured = buildCellGrid(g.char, g.color, g.depth, g.cols, g.rows);
  };
  rasterize({ ...scene, transformCells: capture });
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

function stampToGlyphs(
  stamp: Uint8Array,
  colorBuf: (string | null)[] | null,
  cols: number,
  rows: number,
  glyphs: { thin: string[]; normal: string[]; core: string[] },
): string {
  // Coalesce same-color consecutive non-empty cells into one <span> per run.
  // When colors are disabled (colorBuf=null) we emit plain text — one text node.
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
        g = v === 1
          ? glyphs.thin[(Math.random() * glyphs.thin.length) | 0]!
          : v === 2
            ? glyphs.normal[(Math.random() * glyphs.normal.length) | 0]!
            : glyphs.core[(Math.random() * glyphs.core.length) | 0]!;
        col = colorBuf ? (colorBuf[idx] ?? null) : null;
      }
      if (col !== runColor) {
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
