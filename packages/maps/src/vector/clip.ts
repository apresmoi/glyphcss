/**
 * Clip a (possibly closed) polyline against an axis-aligned lon/lat box —
 * the tile-cutting half of the bake pipeline (MAPS.md §13 slice 5,
 * coordinator scope addition: "simplify globally per level FIRST, then clip
 * into tiles"). Liang-Barsky parametric segment clipping: every edge is
 * clipped independently against the box, and CONSECUTIVE clipped
 * sub-segments are stitched back into one polyline whenever the shared
 * vertex between them is itself inside the box (`t0`/`t1` tracked as
 * PARAMETRIC values, not compared by coordinate equality, so this is
 * robust to a vertex landing exactly on the box edge).
 *
 * **Why this produces no artifact at a tile seam** (the coordinator's
 * explicit gate): the exact SAME `clipSegmentToBox` formula, given the SAME
 * segment endpoints and the SAME shared boundary constant (two adjacent
 * tiles at a zoom level share an EXACT `west`/`east` or `south`/`north`
 * value, both derived from the same quadtree division), computes a
 * BIT-IDENTICAL intersection point on both sides — `clip.test.ts` pins this
 * directly. A cut endpoint is otherwise ORDINARY: this module never marks
 * one specially, never emits a single-point "cap" fragment, and always
 * keeps the true neighboring vertex on either side of a cut — so whatever
 * consumes the output (`stroke.ts`'s tangent-per-segment stamping) computes
 * the SAME local direction at a cut cell it would at any interior cell.
 */
import type { GlyphMapBounds } from "../types";
import type { GlyphMapLonLat } from "./simplify";

interface ClippedSegment {
  readonly a: GlyphMapLonLat;
  readonly b: GlyphMapLonLat;
  readonly t0: number;
  readonly t1: number;
}

function clipSegmentToBox(p0: GlyphMapLonLat, p1: GlyphMapLonLat, bounds: GlyphMapBounds): ClippedSegment | null {
  let t0 = 0;
  let t1 = 1;
  const dx = p1[0] - p0[0];
  const dy = p1[1] - p0[1];
  const checks: readonly (readonly [number, number])[] = [
    [-dx, p0[0] - bounds.west],
    [dx, bounds.east - p0[0]],
    [-dy, p0[1] - bounds.south],
    [dy, bounds.north - p0[1]],
  ];
  for (const [p, q] of checks) {
    if (p === 0) {
      if (q < 0) return null; // parallel to this edge and outside it
      continue;
    }
    const r = q / p;
    if (p < 0) {
      if (r > t1) return null;
      if (r > t0) t0 = r;
    } else {
      if (r < t0) return null;
      if (r < t1) t1 = r;
    }
  }
  if (t0 > t1) return null;
  return {
    a: [p0[0] + t0 * dx, p0[1] + t0 * dy],
    b: [p0[0] + t1 * dx, p0[1] + t1 * dy],
    t0,
    t1,
  };
}

const PARAM_EPS = 1e-9;

/**
 * Clip `points` against `bounds`. Returns zero or more OPEN polylines — a
 * ring that never leaves the box collapses to exactly one (self-closing)
 * output; a ring that crosses the boundary multiple times returns multiple
 * open fragments, each with real geometry endpoints (never a synthetic
 * single-point cap).
 *
 * **`closed` does NOT add an implicit wraparound edge.** A CLOSED ring, per
 * GeoJSON/TopoJSON convention (and what `topology.ts`'s `resolveRing`
 * actually produces — arc concatenation naturally walks back to its own
 * starting point), already repeats its first point as its own last point;
 * `points` for `closed: true` MUST already carry that duplicate. `closed`
 * only gates the post-pass below that merges the first and last OUTPUT
 * fragments when the ring happens to cross the boundary exactly at that
 * shared start/end vertex — without it, that crossing would read as an
 * artificial split distinct from crossing anywhere else on the ring.
 */
export function glyphMapClipPolyline(
  points: readonly GlyphMapLonLat[],
  bounds: GlyphMapBounds,
  closed: boolean,
): GlyphMapLonLat[][] {
  const n = points.length;
  if (n < 2) return [];
  const segCount = n - 1;
  const out: GlyphMapLonLat[][] = [];
  let current: GlyphMapLonLat[] = [];
  let chainOpen = false; // true iff the previous segment's clip ended exactly at its own p1 (t1 ~= 1)

  for (let i = 0; i < segCount; i++) {
    const p0 = points[i];
    const p1 = points[(i + 1) % n];
    const clip = clipSegmentToBox(p0, p1, bounds);
    if (!clip) {
      if (current.length > 1) out.push(current);
      current = [];
      chainOpen = false;
      continue;
    }
    const entersAtP0 = clip.t0 <= PARAM_EPS;
    if (chainOpen && entersAtP0 && current.length > 0) {
      current.push(clip.b);
    } else {
      if (current.length > 1) out.push(current);
      current = [clip.a, clip.b];
    }
    chainOpen = clip.t1 >= 1 - PARAM_EPS;
  }
  if (current.length > 1) out.push(current);

  // A closed ring's clip can wrap: the LAST emitted fragment's end may be
  // the same point as the FIRST fragment's start (the ring re-enters the
  // box right where segment index 0 started). Merge them so a boundary
  // that happens to be crossed at index 0 doesn't get an artificial split
  // distinct from crossing it anywhere else on the ring.
  if (closed && out.length > 1) {
    const first = out[0];
    const last = out[out.length - 1];
    const lastEnd = last[last.length - 1];
    const firstStart = first[0];
    if (lastEnd[0] === firstStart[0] && lastEnd[1] === firstStart[1]) {
      out[0] = [...last, ...first.slice(1)];
      out.pop();
    }
  }
  return out;
}
