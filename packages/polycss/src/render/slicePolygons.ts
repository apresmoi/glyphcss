/**
 * `slicePolygons` — aggressive merge mode for axis-aligned polygon meshes.
 * Groups polygons by their plane (axis × sign × offset), rasterizes each
 * group's polygons (across colors) onto a single offscreen canvas, and
 * emits ONE textured polygon per plane spanning that plane's bbox.
 *
 * Trades per-polygon DOM inspection for compositor performance. A
 * 7,432-polygon voxel scene typically drops to ~30 textured polygons.
 *
 * ── Coordinate convention ───────────────────────────────────────────────
 * Polycss world: +X right, +Y forward, +Z up.
 *
 * For each face direction, we pick (u, v) in-plane axes such that:
 *   - When the face is viewed from its OUTWARD normal direction (i.e. from
 *     where the camera sees it), u increases to the right of the viewer
 *     and v increases UP.
 *   - Canvas pixel space: x right, y down. So world V → canvas y is
 *     FLIPPED (we draw vMin at canvas bottom, vMax at canvas top).
 *
 * Per direction the (u, v) mapping (derived from viewer-right = up × -view):
 *   +X (from +X looking -X, up=+Z): right = +Z × +X = +Y. → u=+Y, v=+Z
 *   -X (from -X looking +X, up=+Z): right = +Z × -X = -Y. → u=-Y, v=+Z
 *   +Y (from +Y looking -Y, up=+Z): right = +Z × +Y = -X. → u=-X, v=+Z
 *   -Y (from -Y looking +Y, up=+Z): right = +Z × -Y = +X. → u=+X, v=+Z
 *   +Z (from +Z looking -Z, up=+Y): right = +Y × +Z = +X. → u=+X, v=+Y
 *   -Z (from -Z looking +Z, up=+Y): right = +Y × -Z = -X. → u=-X, v=+Y
 *
 * These signs get tested below in slicePolygons.test.ts.
 */
import type { Polygon, Vec3 } from "@polycss/core";

const DEFAULT_PIXELS_PER_UNIT = 16;
const EPS = 1e-3;

type Dir = 0 | 1 | 2 | 3 | 4 | 5; // pX, nX, pY, nY, pZ, nZ
const DIR_NAMES = ["pX", "nX", "pY", "nY", "pZ", "nZ"] as const;

interface PlaneKey {
  dir: Dir;
  /** Constant coordinate along the plane's normal axis. */
  offset: number;
}

/** Detect axis-aligned plane + outward normal direction for a polygon. */
function detectPlane(p: Polygon): PlaneKey | null {
  if (p.vertices.length < 3) return null;
  const v0 = p.vertices[0];
  let axis = -1;
  for (let a = 0; a < 3; a++) {
    let ok = true;
    for (let i = 1; i < p.vertices.length; i++) {
      if (Math.abs(p.vertices[i][a] - v0[a]) > EPS) { ok = false; break; }
    }
    if (ok) { axis = a; break; }
  }
  if (axis < 0) return null;
  const e1: Vec3 = [
    p.vertices[1][0] - v0[0],
    p.vertices[1][1] - v0[1],
    p.vertices[1][2] - v0[2],
  ];
  const e2: Vec3 = [
    p.vertices[2][0] - v0[0],
    p.vertices[2][1] - v0[1],
    p.vertices[2][2] - v0[2],
  ];
  const n: Vec3 = [
    e1[1] * e2[2] - e1[2] * e2[1],
    e1[2] * e2[0] - e1[0] * e2[2],
    e1[0] * e2[1] - e1[1] * e2[0],
  ];
  // dir code: axis × 2 + (positive ? 0 : 1)
  const dir = (axis * 2 + (n[axis] >= 0 ? 0 : 1)) as Dir;
  return { dir, offset: v0[axis] };
}

/**
 * For a given face direction, return a function that maps a world Vec3 to
 * (u, v) in-plane coords. Choices match the convention in the file header.
 */
function makeWorldToUV(dir: Dir): (v: Vec3) => [number, number] {
  switch (dir) {
    case 0: return (v) => [v[1], v[2]];     // +X: u=+Y, v=+Z
    case 1: return (v) => [-v[1], v[2]];    // -X: u=-Y, v=+Z
    case 2: return (v) => [-v[0], v[2]];    // +Y: u=-X, v=+Z
    case 3: return (v) => [v[0], v[2]];     // -Y: u=+X, v=+Z
    case 4: return (v) => [v[0], v[1]];     // +Z: u=+X, v=+Y
    case 5: return (v) => [-v[0], v[1]];    // -Z: u=-X, v=+Y
  }
}

/**
 * Build the textured-polygon's 4 corner vertices in 3D, for a given plane,
 * spanning the (uMin, vMin)..(uMax, vMax) bbox of the rasterized region.
 * Returns vertices in CCW from outward normal — required by the renderer's
 * backface culling.
 *
 * Walks the bbox corners in this 2D order: (uMin,vMin)→(uMax,vMin)
 * →(uMax,vMax)→(uMin,vMax). For each vertex, recover the matching world
 * coords by inverting the worldToUV mapping above. The resulting vertex
 * order ends up CCW from the face's outward direction because the (u, v)
 * choices were specifically picked to make this true (u right, v up from
 * the viewer).
 */
function bboxToVertices(
  dir: Dir,
  offset: number,
  uMin: number,
  uMax: number,
  vMin: number,
  vMax: number,
): Vec3[] {
  const set = (uu: number, vv: number): Vec3 => {
    switch (dir) {
      case 0: return [offset,  uu, vv];   // +X: u=+Y, v=+Z
      case 1: return [offset, -uu, vv];   // -X: u=-Y, v=+Z
      case 2: return [-uu, offset, vv];   // +Y: u=-X, v=+Z
      case 3: return [ uu, offset, vv];   // -Y: u=+X, v=+Z
      case 4: return [ uu, vv, offset];   // +Z: u=+X, v=+Y
      case 5: return [-uu, vv, offset];   // -Z: u=-X, v=+Y
    }
  };
  // CCW from viewer: (low-u, low-v) → (high-u, low-v) → (high-u, high-v)
  // → (low-u, high-v). With v "up from viewer" and u "right from viewer",
  // this traces around the bbox counter-clockwise.
  return [set(uMin, vMin), set(uMax, vMin), set(uMax, vMax), set(uMin, vMax)];
}

export interface SlicePolygonsOptions {
  pixelsPerUnit?: number;
  doc?: Document;
}

export function slicePolygons(
  polygons: Polygon[],
  options: SlicePolygonsOptions = {},
): Polygon[] {
  const ppu = options.pixelsPerUnit ?? DEFAULT_PIXELS_PER_UNIT;
  const doc = options.doc ?? (globalThis as { document?: Document }).document;
  if (!doc) return polygons;

  type Group = { plane: PlaneKey; polys: Polygon[] };
  const groups = new Map<string, Group>();
  const passthrough: Polygon[] = [];

  for (const p of polygons) {
    const plane = detectPlane(p);
    if (!plane) {
      passthrough.push(p);
      continue;
    }
    const key = `${plane.dir}:${plane.offset.toFixed(6)}`;
    let g = groups.get(key);
    if (!g) {
      g = { plane, polys: [] };
      groups.set(key, g);
    }
    g.polys.push(p);
  }

  const out: Polygon[] = [];
  for (const { plane, polys } of groups.values()) {
    if (polys.length === 1) {
      // Single polygon — keep as-is. No DOM win from rasterizing one poly,
      // and we'd lose its vector color crispness for nothing.
      out.push(polys[0]);
      continue;
    }

    const toUV = makeWorldToUV(plane.dir);
    let uMin = Infinity, uMax = -Infinity, vMin = Infinity, vMax = -Infinity;
    for (const p of polys) {
      for (const vert of p.vertices) {
        const [uu, vv] = toUV(vert);
        if (uu < uMin) uMin = uu;
        if (uu > uMax) uMax = uu;
        if (vv < vMin) vMin = vv;
        if (vv > vMax) vMax = vv;
      }
    }
    if (!Number.isFinite(uMin) || uMax <= uMin || vMax <= vMin) continue;

    const widthPx = Math.max(1, Math.ceil((uMax - uMin) * ppu));
    const heightPx = Math.max(1, Math.ceil((vMax - vMin) * ppu));

    const canvas = doc.createElement("canvas");
    canvas.width = widthPx;
    canvas.height = heightPx;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      for (const p of polys) out.push(p);
      continue;
    }
    ctx.imageSmoothingEnabled = false;

    // Draw each polygon. Canvas Y points down; world V points "up from
    // viewer" by our convention, so we flip: pixel_y = h - (v - vMin) * ppu.
    for (const p of polys) {
      ctx.fillStyle = p.color || "#888888";
      ctx.beginPath();
      for (let i = 0; i < p.vertices.length; i++) {
        const [uu, vv] = toUV(p.vertices[i]);
        const px = (uu - uMin) * ppu;
        const py = heightPx - (vv - vMin) * ppu;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.fill();
    }
    const dataUrl = canvas.toDataURL("image/png");

    // Vertices in CCW from outward direction. UVs in matching order using
    // OpenGL convention (V=0 = BOTTOM of image) — the polyDOM renderer
    // does `V_internal = 1 - V_input` to flip into CSS image space. So:
    // viewer's bottom (low world V) = UV V=0 here, top = UV V=1.
    const vertices = bboxToVertices(plane.dir, plane.offset, uMin, uMax, vMin, vMax);
    const uvs: [number, number][] = [
      [0, 0], // (uMin, vMin) → viewer BL
      [1, 0], // (uMax, vMin) → viewer BR
      [1, 1], // (uMax, vMax) → viewer TR
      [0, 1], // (uMin, vMax) → viewer TL
    ];
    out.push({ vertices, texture: dataUrl, uvs });
  }

  for (const p of passthrough) out.push(p);
  return out;
}
