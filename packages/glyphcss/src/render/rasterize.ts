import type { RasterizeContext } from "../api/rasterizeContext";
import type { Vec3 } from "@glyphcss/core";
import { SOLID_RAMP, getWireframeGlyphs } from "./ramps";

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
  const { camera, polygons, directionalLight, ambientLight } = scene;
  // Pick the solid ramp from the active palette so the glyph palette dropdown
  // affects solid mode too — not just wireframe.
  const ramp = getWireframeGlyphs(scene.glyphPalette).solid;

  // Glyph buffer: one char per cell (space = empty).
  const glyphBuf: string[] = new Array(cols * rows).fill(" ");
  const useColors = scene.useColors;
  const colorBuf: (string | null)[] | null = useColors ? new Array(cols * rows).fill(null) : null;
  // Depth buffer: -Infinity = nothing drawn yet. In our camera convention,
  // higher `r[2]` = closer to viewer (perspective: persp > 1 for z > 0; ortho:
  // higher z is "in front"; FPV: ahead-of-eye is z<0, with closest being the
  // largest = least-negative z). So newer triangles win when their depth is
  // GREATER than the existing buffer entry.
  const depthBuf = new Float64Array(cols * rows).fill(-Infinity);

  // Normalize the light direction once.
  const ld = directionalLight.direction;
  const ldLen = Math.hypot(ld[0], ld[1], ld[2]) || 1;
  const lx = ld[0] / ldLen, ly = ld[1] / ldLen, lz = ld[2] / ldLen;
  const keyIntensity = directionalLight.intensity ?? 1;
  const ambIntensity = ambientLight.intensity ?? 0.4;
  const keyRgb = hexToRgb(directionalLight.color ?? "#ffffff");
  const ambRgb = hexToRgb(ambientLight.color ?? "#ffffff");

  for (const poly of polygons) {
    const verts = poly.vertices;
    if (verts.length < 3) continue;
    // Fan-triangulate: (v[0], v[i], v[i+1]) for i in [1, N-2].
    // For N=3 this produces exactly one triangle.
    for (let fanIdx = 1; fanIdx < verts.length - 1; fanIdx++) {
      const v0 = verts[0]! as Vec3;
      const v1 = verts[fanIdx]! as Vec3;
      const v2 = verts[fanIdx + 1]! as Vec3;

      const pa = camera.project(v0, cols, rows, cellAspect);
      const pb = camera.project(v1, cols, rows, cellAspect);
      const pc = camera.project(v2, cols, rows, cellAspect);
      // NaN-cull: any vertex behind the near plane → skip triangle.
      if (pa[0] !== pa[0] || pb[0] !== pb[0] || pc[0] !== pc[0]) continue;

      // Compute face normal in world space (before projection) for Lambert.
      const ux = v1[0] - v0[0], uy = v1[1] - v0[1], uz = v1[2] - v0[2];
      const vvx = v2[0] - v0[0], vvy = v2[1] - v0[1], vvz = v2[2] - v0[2];
      const nx = uy * vvz - uz * vvy;
      const ny = uz * vvx - ux * vvz;
      const nz = ux * vvy - uy * vvx;
      const nLen = Math.hypot(nx, ny, nz) || 1;
      const dot = (nx * lx + ny * ly + nz * lz) / nLen;
      const keyFactor = Math.max(0, dot) * keyIntensity;
      const intensity = Math.min(1, Math.max(0, ambIntensity + keyFactor));
      const glyphIdx = Math.min(ramp.length - 1, (intensity * (ramp.length - 1)) | 0);
      const glyph = ramp[glyphIdx]!;

      // Per-channel light-mix only when colors are enabled. Otherwise pass null
      // so scanFillTriangle skips the color write and the emitter skips spans.
      let litColor: string | null = null;
      if (useColors) {
        const triRgb = poly.color ? hexToRgb(poly.color) : [255, 255, 255];
        const tintR = ambIntensity * ambRgb[0] / 255 + keyFactor * keyRgb[0] / 255;
        const tintG = ambIntensity * ambRgb[1] / 255 + keyFactor * keyRgb[1] / 255;
        const tintB = ambIntensity * ambRgb[2] / 255 + keyFactor * keyRgb[2] / 255;
        const litR = Math.min(255, triRgb[0] * tintR);
        const litG = Math.min(255, triRgb[1] * tintG);
        const litB = Math.min(255, triRgb[2] * tintB);
        litColor = `#${toHex2(litR)}${toHex2(litG)}${toHex2(litB)}`;
      }

      // Average depth for the triangle (camera-space Z, lower = closer).
      const depth = (pa[2] + pb[2] + pc[2]) / 3;

      // Scan-fill the projected triangle in grid coords.
      scanFillTriangle(
        pa[0], pa[1],
        pb[0], pb[1],
        pc[0], pc[1],
        depth, glyph, litColor,
        glyphBuf, colorBuf, depthBuf,
        cols, rows,
      );
    }
  }

  return solidBufToString(glyphBuf, colorBuf, cols, rows);
}

/**
 * Scan-fill a triangle in grid space. Uses a top-left fill convention with
 * per-scanline edge interpolation. Overwrites cells only when `depth` is
 * lower than the existing depth buffer entry.
 */
function scanFillTriangle(
  ax: number, ay: number,
  bx: number, by: number,
  cx: number, cy: number,
  depth: number,
  glyph: string,
  color: string | null,
  glyphBuf: string[],
  colorBuf: (string | null)[] | null,
  depthBuf: Float64Array,
  cols: number,
  rows: number,
): void {
  // Sort vertices by row (top → bottom).
  let x0 = ax, y0 = ay, x1 = bx, y1 = by, x2 = cx, y2 = cy;
  if (y1 < y0) { let t = x0; x0 = x1; x1 = t; t = y0; y0 = y1; y1 = t; }
  if (y2 < y0) { let t = x0; x0 = x2; x2 = t; t = y0; y0 = y2; y2 = t; }
  if (y2 < y1) { let t = x1; x1 = x2; x2 = t; t = y1; y1 = y2; y2 = t; }

  const rowTop = Math.max(0, Math.ceil(y0));
  const rowBot = Math.min(rows - 1, Math.floor(y2));
  if (rowTop > rowBot) return;

  for (let row = rowTop; row <= rowBot; row++) {
    // Compute left and right X for this scanline by interpolating along the two
    // relevant edges. The long edge spans the full triangle height; the short
    // edges span top→mid and mid→bottom.
    const t = (row - y0) / (y2 - y0 || 1);
    const xLong = x0 + (x2 - x0) * t;

    let xShort: number;
    if (row < y1) {
      const t2 = (row - y0) / (y1 - y0 || 1);
      xShort = x0 + (x1 - x0) * t2;
    } else {
      const t2 = (row - y1) / (y2 - y1 || 1);
      xShort = x1 + (x2 - x1) * t2;
    }

    const colL = Math.max(0, Math.ceil(Math.min(xLong, xShort)));
    const colR = Math.min(cols - 1, Math.floor(Math.max(xLong, xShort)));
    for (let col = colL; col <= colR; col++) {
      const idx = row * cols + col;
      if (depth > depthBuf[idx]!) {
        depthBuf[idx] = depth;
        glyphBuf[idx] = glyph;
        if (colorBuf) colorBuf[idx] = color;
      }
    }
  }
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
