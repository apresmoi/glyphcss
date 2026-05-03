/**
 * Exterior surface extraction — strips interior (hidden) polygons by
 * cancelling coincident anti-normal face fragments.
 *
 * Why this matters: the polygon model emits ALL faces of every shape
 * (cube has 6, ramp has 5, etc.) including ones that voxcss never renders
 * because they're occluded by an adjacent shape. The manifold gap-check
 * naively run on all those polygons sees a topologically closed mesh
 * because every interior face is covered by its anti-normal partner —
 * even when adjacent shapes don't *physically* tile together (e.g. two
 * ramps where one's wall pokes 1 cell above the other's slope tip).
 *
 * Algorithm:
 *   1. Decompose every axis-aligned rectangular face into unit (1×1) quads.
 *      Each unit quad is at a single integer cell of an axis-aligned plane.
 *   2. Hash quads by (plane, cell). At each cell two quads can exist —
 *      one facing +axis, one facing -axis. If both exist, mark BOTH as
 *      interior (cancelled) and drop them.
 *   3. Sloped polygons (ramp slopes, spike slants) and triangular faces
 *      pass through unchanged — they have no anti-normal partner because
 *      voxcss shapes are convex.
 *
 * The output is the set of polygons that actually form the rendered surface.
 * Run findGaps on this set to detect real visible gaps, not false-positive
 * "interior pairs" that come from per-shape closed boundaries.
 */
import type { Polygon } from "./polygonModel";
import type { Vec3 } from "../types";

interface QuadInfo {
  axis: 0 | 1 | 2;
  offset: number;
  /** +1 if normal points in +axis direction, -1 otherwise. */
  normalSign: 1 | -1;
  /** Min/max of the two non-axis coordinates. */
  c1Min: number; c1Max: number;
  c2Min: number; c2Max: number;
}

function classifyAxisAlignedQuad(p: Polygon): QuadInfo | null {
  if (p.v.length !== 4) return null;
  const xs = p.v.map((v) => v[0]);
  const ys = p.v.map((v) => v[1]);
  const zs = p.v.map((v) => v[2]);
  const allXSame = xs.every((x) => x === xs[0]);
  const allYSame = ys.every((y) => y === ys[0]);
  const allZSame = zs.every((z) => z === zs[0]);
  let axis: 0 | 1 | 2;
  let offset: number;
  if (allXSame) { axis = 0; offset = xs[0]; }
  else if (allYSame) { axis = 1; offset = ys[0]; }
  else if (allZSame) { axis = 2; offset = zs[0]; }
  else return null;
  // Compute normal sign from first 3 vertices.
  const a = p.v[0], b = p.v[1], c = p.v[2];
  const nx = (b[1] - a[1]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[1] - a[1]);
  const ny = (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]);
  const nz = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  const ncomp = axis === 0 ? nx : axis === 1 ? ny : nz;
  const normalSign: 1 | -1 = ncomp > 0 ? 1 : -1;
  let c1Min: number, c1Max: number, c2Min: number, c2Max: number;
  if (axis === 0) {
    c1Min = Math.min(...ys); c1Max = Math.max(...ys);
    c2Min = Math.min(...zs); c2Max = Math.max(...zs);
  } else if (axis === 1) {
    c1Min = Math.min(...xs); c1Max = Math.max(...xs);
    c2Min = Math.min(...zs); c2Max = Math.max(...zs);
  } else {
    c1Min = Math.min(...xs); c1Max = Math.max(...xs);
    c2Min = Math.min(...ys); c2Max = Math.max(...ys);
  }
  return { axis, offset, normalSign, c1Min, c1Max, c2Min, c2Max };
}

/** Build a unit quad polygon at (plane axis = a, offset, c1, c2) facing the given normal sign. */
function buildUnitQuad(
  axis: 0 | 1 | 2, offset: number, c1: number, c2: number, normalSign: 1 | -1,
  voxelKey: string, face: string
): Polygon {
  // Build four vertices at the unit cell corners of the 2D plane,
  // in CCW order from the OUTSIDE (so first 3 vertices give the right normal).
  let v: Vec3[];
  if (axis === 0) {
    // x = offset; (y, z) are the in-plane coords.
    if (normalSign === 1) {
      v = [[offset, c1, c2], [offset, c1 + 1, c2], [offset, c1 + 1, c2 + 1], [offset, c1, c2 + 1]];
    } else {
      v = [[offset, c1 + 1, c2], [offset, c1, c2], [offset, c1, c2 + 1], [offset, c1 + 1, c2 + 1]];
    }
  } else if (axis === 1) {
    // y = offset; (x, z) are the in-plane coords.
    if (normalSign === 1) {
      v = [[c1 + 1, offset, c2], [c1, offset, c2], [c1, offset, c2 + 1], [c1 + 1, offset, c2 + 1]];
    } else {
      v = [[c1, offset, c2], [c1 + 1, offset, c2], [c1 + 1, offset, c2 + 1], [c1, offset, c2 + 1]];
    }
  } else {
    // z = offset; (x, y) are the in-plane coords.
    if (normalSign === 1) {
      v = [[c1, c2, offset], [c1 + 1, c2, offset], [c1 + 1, c2 + 1, offset], [c1, c2 + 1, offset]];
    } else {
      v = [[c1, c2 + 1, offset], [c1 + 1, c2 + 1, offset], [c1 + 1, c2, offset], [c1, c2, offset]];
    }
  }
  return { v, voxelKey, face };
}

export function extractExteriorSurface(polygons: Polygon[]): Polygon[] {
  // For each axis-aligned rectangular polygon, decompose into unit quads
  // tagged by (plane, cell). Keep sloped/non-rect polygons as-is.
  const slot = new Map<string, { plus?: { p: Polygon }; minus?: { p: Polygon } }>();
  const passthrough: Polygon[] = [];

  for (const p of polygons) {
    const info = classifyAxisAlignedQuad(p);
    if (!info) {
      passthrough.push(p);
      continue;
    }
    for (let c1 = info.c1Min; c1 < info.c1Max; c1++) {
      for (let c2 = info.c2Min; c2 < info.c2Max; c2++) {
        const cellKey = `${info.axis}|${info.offset}|${c1}|${c2}`;
        const unit = buildUnitQuad(info.axis, info.offset, c1, c2, info.normalSign, p.voxelKey, p.face);
        let cell = slot.get(cellKey);
        if (!cell) { cell = {}; slot.set(cellKey, cell); }
        if (info.normalSign === 1) {
          if (cell.plus) {
            // Same-direction overlap (two faces facing same way at same cell).
            // Shouldn't happen for a clean voxel set, but if it does, keep one.
            continue;
          }
          cell.plus = { p: unit };
        } else {
          if (cell.minus) continue;
          cell.minus = { p: unit };
        }
      }
    }
  }

  const exterior: Polygon[] = [...passthrough];
  for (const cell of slot.values()) {
    if (cell.plus && cell.minus) continue; // interior, both cancelled
    if (cell.plus) exterior.push(cell.plus.p);
    if (cell.minus) exterior.push(cell.minus.p);
  }
  return exterior;
}
