/**
 * Manifold edge check — finds gaps in a polygon mesh.
 *
 * For a closed surface, every edge must be shared by EXACTLY 2 polygons (the
 * two faces meeting at that edge). Anything else is a defect:
 *   - Edge covered by 1 polygon  → OPEN edge → visible gap
 *   - Edge covered by 3+         → non-manifold (T-intersection or overlap)
 *
 * Naive endpoint-equality matching breaks on T-junctions: a long polygon edge
 * adjacent to two shorter edges would have NO exact match. We instead group
 * edges by the infinite 3D LINE they lie on, then sweep along the line and
 * verify every parameter unit is double-covered. This handles partial overlaps
 * correctly.
 *
 * Inputs are integer-coord polygons (voxel grid). For axis-aligned edges this
 * is trivial; for sloped edges (ramp slopes, spike slants) we still get
 * integer endpoints because shape bboxes lie on the integer grid, and the
 * line-direction primitive form gives unique line IDs.
 */
import type { Polygon } from "./polygonModel";
import type { Vec3 } from "../types";

export interface GapReport {
  /** Direction primitive of the line, e.g. [1,0,0] for an x-axis line. */
  direction: Vec3;
  /** Two world-space points: the endpoints of the under/over-covered range. */
  segment: [Vec3, Vec3];
  /** How many polygon edges currently cover this range (1 = open edge, 3+ = non-manifold). */
  coverage: number;
  /** Voxel keys of the polygons whose edges contribute to this range. */
  contributors: string[];
}

interface EdgeRecord {
  tLo: number;
  tHi: number;
  polyIdx: number;
}

function gcd(a: number, b: number): number {
  a = Math.abs(a); b = Math.abs(b);
  // gcd(0, x) = x: needed so direction primitivization works for axis-aligned
  // edges (e.g. (0,0,4) → primitive (0,0,1), not (0,0,4)).
  if (a === 0) return b;
  if (b === 0) return a;
  while (b) { const t = a % b; a = b; b = t; }
  return a;
}

/** Canonical key for the infinite 3D line through edge [a, b]. */
function lineKey(a: Vec3, b: Vec3): { key: string; d: Vec3 } {
  let dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2];
  const g = gcd(gcd(dx, dy), dz);
  dx /= g; dy /= g; dz /= g;
  // Canonicalize direction sign: first nonzero component must be positive,
  // so (1,0,0) and (-1,0,0) hash to the same line.
  if (dx < 0 || (dx === 0 && dy < 0) || (dx === 0 && dy === 0 && dz < 0)) {
    dx = -dx; dy = -dy; dz = -dz;
  }
  // Cross product D × A is a line invariant: any other point P = A + t·D on
  // the same line gives D × P = D × A. Pair (D, D × A) uniquely identifies
  // the infinite line.
  const cx = dy * a[2] - dz * a[1];
  const cy = dz * a[0] - dx * a[2];
  const cz = dx * a[1] - dy * a[0];
  return {
    key: `${dx},${dy},${dz}|${cx},${cy},${cz}`,
    d: [dx, dy, dz],
  };
}

/** Project point onto direction d (returns parameter t such that point = origin + t·d). */
function project(p: Vec3, d: Vec3): number {
  return p[0] * d[0] + p[1] * d[1] + p[2] * d[2];
}

/** Recover a point from line parameter t (using a known reference point on the line). */
function pointAt(refOnLine: Vec3, d: Vec3, t: number): Vec3 {
  const refT = project(refOnLine, d);
  const dt = t - refT;
  return [refOnLine[0] + d[0] * dt, refOnLine[1] + d[1] * dt, refOnLine[2] + d[2] * dt];
}

export function findGaps(polygons: Polygon[]): GapReport[] {
  const byLine = new Map<string, {
    d: Vec3;
    refPoint: Vec3;
    edges: EdgeRecord[];
  }>();

  for (let pi = 0; pi < polygons.length; pi++) {
    const p = polygons[pi];
    const n = p.v.length;
    for (let i = 0; i < n; i++) {
      const a = p.v[i];
      const b = p.v[(i + 1) % n];
      const { key, d } = lineKey(a, b);
      let bucket = byLine.get(key);
      if (!bucket) {
        bucket = { d, refPoint: a, edges: [] };
        byLine.set(key, bucket);
      }
      const ta = project(a, d);
      const tb = project(b, d);
      bucket.edges.push({
        tLo: Math.min(ta, tb),
        tHi: Math.max(ta, tb),
        polyIdx: pi,
      });
    }
  }

  const gaps: GapReport[] = [];

  for (const bucket of byLine.values()) {
    // Build sweep events. At each t, deltas adjust the coverage count.
    const events: { t: number; delta: number; polyIdx: number }[] = [];
    for (const e of bucket.edges) {
      events.push({ t: e.tLo, delta: +1, polyIdx: e.polyIdx });
      events.push({ t: e.tHi, delta: -1, polyIdx: e.polyIdx });
    }
    // Sort: by t, then process all -1 (closes) before +1 (opens) at same t.
    // This avoids spurious "0 coverage" at boundary points where one edge
    // ends exactly where the next begins.
    events.sort((a, b) => a.t - b.t || a.delta - b.delta);

    let coverage = 0;
    let active = new Set<number>();
    let lastT = events.length ? events[0].t : 0;
    for (const ev of events) {
      if (ev.t > lastT && isDefect(coverage)) {
        gaps.push({
          direction: bucket.d,
          segment: [pointAt(bucket.refPoint, bucket.d, lastT), pointAt(bucket.refPoint, bucket.d, ev.t)],
          coverage,
          contributors: [...active].map((pi) => polygons[pi].voxelKey),
        });
      }
      coverage += ev.delta;
      if (ev.delta > 0) active.add(ev.polyIdx);
      else active.delete(ev.polyIdx);
      lastT = ev.t;
    }
  }

  return gaps;
}

/**
 * A surface defect is an ODD coverage count: 1 = open edge (gap), 3/5/... =
 * non-manifold (an unmatched polygon edge somewhere). Coverage 0 just means
 * "no polygons here" — common between disjoint edge clusters on the same
 * infinite line, not a real defect. Even coverage ≥ 2 is also fine: 2 = a
 * normal surface edge shared by exactly 2 polygons, 4/6/... = an interior
 * edge between adjacent solids where multiple hidden faces meet (interior
 * edges are invisible in the rendered output, so they don't matter visually).
 */
function isDefect(coverage: number): boolean {
  return coverage % 2 === 1;
}
