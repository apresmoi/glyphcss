import type { RasterizeContext } from "../api/rasterizeContext";
import type { Polygon, Vec3 } from "@glyphcss/core";
import { getWireframeGlyphs } from "./ramps";

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
export function rasterize(scene: RasterizeContext): string {
  const { camera, grid, wireframe, mode } = scene;
  const { cols, rows, cellAspect } = grid;

  if (mode === "solid") {
    return rasterizeSolid(scene, cols, rows, cellAspect);
  }

  // wireframe (and voxel falls through to wireframe for now)
  const glyphs = getWireframeGlyphs(scene.glyphPalette);
  const stamp = new Uint8Array(cols * rows);
  // Color buffer: one entry per cell. null means "no color" (use CSS fallback).
  // When colors are disabled, we don't even allocate the buffer (saves GC).
  const colorBuf: (string | null)[] | null = scene.useColors ? new Array(cols * rows).fill(null) : null;

  for (const e of wireframe) {
    const a = camera.project(e.from, cols, rows, cellAspect);
    const b = camera.project(e.to, cols, rows, cellAspect);
    // Near-plane culled vertices come back as NaN — skip the line entirely.
    if (a[0] !== a[0] || b[0] !== b[0]) continue;
    drawLineToStamp(stamp, colorBuf, a[0] | 0, a[1] | 0, b[0] | 0, b[1] | 0, e.weight ?? 2, e.color ?? null, cols, rows);
  }

  return stampToGlyphs(stamp, colorBuf, cols, rows, glyphs);
}

/** Solid-mode: scan-fill polygons (fan-triangulated) with Lambert shading + depth buffer. */
function rasterizeSolid(
  scene: RasterizeContext,
  cols: number,
  rows: number,
  cellAspect: number,
): string {
  const { camera, polygons, directionalLight, ambientLight, smoothShading, creaseAngle, backfaceCull, dither } = scene;
  // Pick the solid ramp from the active palette so the glyph palette dropdown
  // affects solid mode too — not just wireframe.
  const ramp = getWireframeGlyphs(scene.glyphPalette).solid;
  const rampMax = ramp.length - 1;

  // Glyph buffer: one char per cell (space = empty).
  const glyphBuf: string[] = new Array(cols * rows).fill(" ");
  const useColors = scene.useColors;
  const colorBuf: (string | null)[] | null = useColors ? new Array(cols * rows).fill(null) : null;
  // Depth buffer: -Infinity = nothing drawn yet. Higher `r[2]` = closer to
  // viewer in our camera convention, so newer triangles win when their
  // depth is GREATER than the existing buffer entry.
  const depthBuf = new Float64Array(cols * rows).fill(-Infinity);

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

  for (let polyIdx = 0; polyIdx < polygons.length; polyIdx++) {
    const poly = polygons[polyIdx]!;
    const verts = poly.vertices;
    if (verts.length < 3) continue;
    // Fan-triangulate: (v[0], v[i], v[i+1]) for i in [1, N-2].
    // For N=3 this produces exactly one triangle.
    for (let fanIdx = 1; fanIdx < verts.length - 1; fanIdx++) {
      const vi0 = 0, vi1 = fanIdx, vi2 = fanIdx + 1;
      const v0 = verts[vi0]! as Vec3;
      const v1 = verts[vi1]! as Vec3;
      const v2 = verts[vi2]! as Vec3;

      const pa = camera.project(v0, cols, rows, cellAspect);
      const pb = camera.project(v1, cols, rows, cellAspect);
      const pc = camera.project(v2, cols, rows, cellAspect);
      // NaN-cull: any vertex behind the near plane → skip triangle.
      if (pa[0] !== pa[0] || pb[0] !== pb[0] || pc[0] !== pc[0]) continue;

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
      const dotA = nAx * lx + nAy * ly + nAz * lz;
      const dotB = nBx * lx + nBy * ly + nBz * lz;
      const dotC = nCx * lx + nCy * ly + nCz * lz;
      const iA = Math.min(1, ambIntensity + Math.max(0, dotA) * keyIntensity);
      const iB = Math.min(1, ambIntensity + Math.max(0, dotB) * keyIntensity);
      const iC = Math.min(1, ambIntensity + Math.max(0, dotC) * keyIntensity);

      // Triangle color: tint poly.color by the AVERAGE of the three vertex
      // intensities. Keeping a single color per triangle preserves run-
      // coalescing in `solidBufToString` — a per-cell color would force one
      // <span> per cell and hurt innerHTML parse time. The intensity gradient
      // already lives in the glyph selection per cell.
      let litColor: string | null = null;
      if (useColors) {
        const avgI = (iA + iB + iC) / 3;
        const avgKey = Math.max(0, avgI - ambIntensity);
        const triRgb = poly.color ? hexToRgb(poly.color) : [255, 255, 255];
        const tintR = ambIntensity * ambRgb[0] / 255 + avgKey * keyRgb[0] / 255;
        const tintG = ambIntensity * ambRgb[1] / 255 + avgKey * keyRgb[1] / 255;
        const tintB = ambIntensity * ambRgb[2] / 255 + avgKey * keyRgb[2] / 255;
        const litR = Math.min(255, triRgb[0] * tintR);
        const litG = Math.min(255, triRgb[1] * tintG);
        const litB = Math.min(255, triRgb[2] * tintB);
        litColor = `#${toHex2(litR)}${toHex2(litG)}${toHex2(litB)}`;
      }

      // Scan-fill the projected triangle. Depth and intensity are both
      // interpolated per cell via barycentric coordinates so adjacent
      // triangles on a curved surface never disagree at their shared edge.
      scanFillTriangle(
        pa[0], pa[1], pa[2], iA,
        pb[0], pb[1], pb[2], iB,
        pc[0], pc[1], pc[2], iC,
        ramp, rampMax, litColor,
        glyphBuf, colorBuf, depthBuf,
        cols, rows,
        backfaceCull,
        dither,
      );
    }
  }

  return solidBufToString(glyphBuf, colorBuf, cols, rows);
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
  backfaceCull: boolean,
  dither: boolean,
): void {
  // Signed 2× area. Sign tells us screen-space winding.
  const area2 = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
  if (area2 === 0) return;
  // Backface culling. Glyphcss's camera projects world-CCW polygons (the
  // input convention is "CCW from outside") to screen-CW under our row
  // convention (positive r[1] → larger row → visually below center), so
  // front-facing triangles produce `area2 < 0`. Skip back faces (`area2 > 0`)
  // when culling is on. The asciss-derived rotateVec3 also swaps the X/Y
  // input axes, which contributes to the orientation flip.
  if (backfaceCull && area2 > 0) return;
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
      if (pixelDepth > depthBuf[idx]!) {
        depthBuf[idx] = pixelDepth;
        // Per-pixel intensity → per-pixel glyph. This is what makes smooth
        // shading visible: adjacent triangles' shared edge has the same
        // interpolated intensity on both sides, so the glyph transition
        // crosses the edge smoothly instead of stepping.
        const intensity = (wA * ia + wB * ib + wC * ic) * invArea2;
        const clamped = intensity < 0 ? 0 : intensity > 1 ? 1 : intensity;
        let glyphIdx: number;
        if (dither) {
          // Pick between two adjacent ramp glyphs using a Bayer threshold.
          // When the sub-ramp fraction exceeds the cell's threshold, step up
          // to the brighter glyph — producing a stippled gradient that reads
          // as continuous from a distance and breaks up the visible contour
          // bands between ramp steps.
          const rampPos = clamped * rampMax;
          const lower = rampPos | 0;
          const frac = rampPos - lower;
          const threshold = BAYER_4X4[(row & 3) * 4 + (col & 3)]!;
          glyphIdx = frac > threshold && lower < rampMax ? lower + 1 : lower;
        } else {
          glyphIdx = (clamped * rampMax) | 0;
          if (glyphIdx > rampMax) glyphIdx = rampMax;
        }
        glyphBuf[idx] = ramp[glyphIdx]!;
        if (colorBuf) colorBuf[idx] = color;
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

function hexToRgb(hex: string): [number, number, number] {
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
