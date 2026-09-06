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
/**
 * A lon/lat step wider than this is not geometry — it is the ±180 seam
 * written out as a planar jump. Half the world is the only threshold that
 * cannot misfire: no real edge of a simplified boundary spans more than
 * 180° of longitude, and every antimeridian wrap spans more than 180° by
 * construction (it runs the long way round from `+179.x` to `-180`).
 */
const ANTIMERIDIAN_STEP_DEG = 180;

/**
 * Split a lon/lat polyline wherever consecutive vertices jump the
 * antimeridian — the vector twin of {@link
 * import("../tile").splitGlyphMapGeoTileAtAntimeridian} ("a tile whose
 * bounds straddle the antimeridian is split BEFORE projecting; a single
 * mesh built across the seam would bridge the whole map as garbage
 * strips", AGENTS.md).
 *
 * Natural Earth (and every ±180-duplicating source) writes a polygon that
 * spans the seam as ONE ring carrying vertices on both sides: Russia's
 * ring 17 steps `[179.867, 69.012] -> [-180, 68.984]`, Fiji's ring 15
 * `[-180, -16.540] -> [180, -16.540]`, Antarctica's ring 2 `[-180,
 * -89.999] -> [178.592, -89.999]`. Read as a planar segment — which is
 * what both {@link glyphMapClipPolyline} and `stroke.ts`'s stamper do —
 * each of those is a 360°-wide bar at a fixed latitude sweeping the entire
 * world backwards. Clipping it per tile then deposits ONE full-tile-width
 * chord in every tile at that latitude, in tiles the country never touches;
 * projected onto a globe those chords read as a concentric `2^z`-sided
 * polygon ringing each pole.
 *
 * The wrap segment is DROPPED rather than interpolated to ±180: both of its
 * endpoints already sit on (or within a fraction of a degree of) the seam in
 * every source of this shape, so the cut is sub-cell wide, whereas
 * synthesizing seam vertices would invent a latitude the source never
 * states. A polyline with no wrap is returned BY IDENTITY (`[points]`), so
 * every non-wrapping ring bakes byte-identically to before.
 *
 * `closed` (the same repeated-first-point convention {@link
 * glyphMapClipPolyline} documents) rejoins the run that ends at the ring's
 * repeated start vertex with the run that begins there, so the only cuts
 * are at the antimeridian itself and never at the arbitrary point the
 * source chose to start the ring at.
 */
export function glyphMapSplitAtAntimeridian(
  points: readonly GlyphMapLonLat[],
  closed: boolean,
): readonly (readonly GlyphMapLonLat[])[] {
  const cuts: number[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    if (Math.abs(points[i + 1][0] - points[i][0]) > ANTIMERIDIAN_STEP_DEG) cuts.push(i);
  }
  if (cuts.length === 0) return [points];

  const parts: GlyphMapLonLat[][] = [];
  let start = 0;
  for (const cut of cuts) {
    parts.push(points.slice(start, cut + 1));
    start = cut + 1;
  }
  parts.push(points.slice(start));

  if (closed && parts.length > 1) {
    const first = parts[0];
    const last = parts[parts.length - 1];
    parts[0] = [...last.slice(0, -1), ...first];
    parts.pop();
  }
  return parts.filter((part) => part.length > 1);
}

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

// ── Polygon (AREA) clipping ────────────────────────────────────────────────
//
// A separate operation from {@link glyphMapClipPolyline}, not a mode of it.
// The polyline clip returns OPEN fragments, which is exactly right for a
// `line` layer — a cut end is deliberately indistinguishable from an
// interior point (see this file's header). A FILL cannot use those: a
// country crossing a tile boundary arrives as one open fragment per tile,
// and earcut closes an open ring with a straight CHORD between its first and
// last point, so the filled area becomes "fragment plus chord" instead of
// "country intersect tile". Measured on a 120x60-degree box spanning four z2
// tiles: 1,294 of 2,485 cells strictly inside its own outline came back
// blank, in a bow-tie hole through the middle. A ring that SWALLOWS a tile
// whole is worse still — it has no fragment there at all, so the feature was
// absent from that tile entirely.
//
// The fix is the textbook one for a CONVEX clip window: Sutherland-Hodgman,
// which walks the window's boundary to re-close the ring. It reuses the same
// `t = (bound - a) / (b - a)` intersection formula `clipSegmentToBox` uses,
// so a vertex landing on a tile edge is computed from the same numbers on
// both sides of that edge. (Unlike the polyline clip, that is not a
// BIT-identity guarantee: Sutherland-Hodgman applies its four half-planes in
// sequence, so a segment already cut by one plane feeds slightly different
// endpoints to the next. The residual is at float-epsilon scale in degrees,
// against a glyph cell that is tenths of a degree across.)

/** A ring's interior side of one axis-aligned half-plane. */
type Axis = 0 | 1;

function insideHalfPlane(point: GlyphMapLonLat, axis: Axis, bound: number, keepGreater: boolean): boolean {
  return keepGreater ? point[axis] >= bound : point[axis] <= bound;
}

function halfPlaneIntersection(a: GlyphMapLonLat, b: GlyphMapLonLat, axis: Axis, bound: number): GlyphMapLonLat {
  const d = b[axis] - a[axis];
  const t = d === 0 ? 0 : (bound - a[axis]) / d;
  return [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])];
}

/** One Sutherland-Hodgman pass over an OPEN ring (no repeated closing vertex). */
function clipRingToHalfPlane(ring: readonly GlyphMapLonLat[], axis: Axis, bound: number, keepGreater: boolean): GlyphMapLonLat[] {
  const out: GlyphMapLonLat[] = [];
  for (let i = 0, n = ring.length; i < n; i++) {
    const current = ring[i];
    const next = ring[(i + 1) % n];
    const currentIn = insideHalfPlane(current, axis, bound, keepGreater);
    const nextIn = insideHalfPlane(next, axis, bound, keepGreater);
    if (nextIn) {
      if (!currentIn) out.push(halfPlaneIntersection(current, next, axis, bound));
      out.push(next);
    } else if (currentIn) {
      out.push(halfPlaneIntersection(current, next, axis, bound));
    }
  }
  return out;
}

/**
 * Longitude-unwrap a ring so an antimeridian-spanning polygon is ONE
 * continuous planar ring in an extended longitude domain, using the same
 * {@link ANTIMERIDIAN_STEP_DEG} rule {@link glyphMapSplitAtAntimeridian}
 * applies. Unwrapping rather than cutting is what the area path needs: the
 * polyline path can drop the seam step because a sub-cell gap in a stroke is
 * invisible, but dropping it from a RING leaves the ring open, and closing
 * that with a chord paints a 359-degree-wide bar at a fixed latitude — the
 * exact polar-ring artifact `glyphMapSplitAtAntimeridian` exists to prevent.
 * Once unwrapped, Russia is a ring spanning roughly 19..180.4 and the box
 * clip is ordinary planar geometry again; the caller recovers the piece past
 * +-180 by clipping against the box shifted a whole world east or west.
 */
function unwrapRingLongitudes(ring: readonly GlyphMapLonLat[]): GlyphMapLonLat[] {
  const out: GlyphMapLonLat[] = [[ring[0][0], ring[0][1]]];
  let offset = 0;
  for (let i = 1; i < ring.length; i++) {
    const delta = ring[i][0] - ring[i - 1][0];
    if (delta > ANTIMERIDIAN_STEP_DEG) offset -= 360;
    else if (delta < -ANTIMERIDIAN_STEP_DEG) offset += 360;
    out.push([ring[i][0] + offset, ring[i][1]]);
  }
  return out;
}

/**
 * A ring that crosses the seam an ODD number of times does not close in
 * unwrapped space — it encircles a pole (Antarctica). Close it over the pole
 * it encircles, which is the one its own vertices sit nearest: without this
 * the ring's two ends are a whole world apart and the clip paints a band at
 * the ring's own latitude instead of a filled polar cap.
 */
function closeOverPole(ring: GlyphMapLonLat[]): GlyphMapLonLat[] {
  let minLat = Infinity;
  let maxLat = -Infinity;
  for (const [, lat] of ring) {
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
  }
  const poleLat = 90 - maxLat <= minLat + 90 ? 90 : -90;
  const first = ring[0];
  const last = ring[ring.length - 1];
  return [...ring, [last[0], poleLat], [first[0], poleLat]];
}

/**
 * A ring bounds no planar area at all — every vertex collinear (or
 * coincident), so it can be an OUTLINE of nothing. `1e-12 deg^2` is far
 * below anything a real bake can produce: the finest epsilon this pipeline
 * ships is the curated 0.002 deg level, and the smallest ring surviving it
 * anywhere in Natural Earth 50m is the Vatican's, at 8.4e-5 deg^2 — seven
 * orders of magnitude clear.
 */
const RING_AREA_EPSILON_DEG2 = 1e-12;

function ringEnclosesArea(ring: readonly GlyphMapLonLat[]): boolean {
  if (ring.length < 3) return false;
  let area2 = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    area2 += ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
  }
  return Math.abs(area2) / 2 > RING_AREA_EPSILON_DEG2;
}

/** Drop a ring's repeated closing vertex, if it has one, for the cyclic Sutherland-Hodgman walk. */
function openRingForClip(ring: readonly GlyphMapLonLat[]): readonly GlyphMapLonLat[] {
  const last = ring[ring.length - 1];
  return ring.length > 1 && ring[0][0] === last[0] && ring[0][1] === last[1] ? ring.slice(0, -1) : ring;
}

function clipUnwrappedRing(ring: readonly GlyphMapLonLat[], bounds: GlyphMapBounds, lonShift: number): GlyphMapLonLat[] {
  let current: readonly GlyphMapLonLat[] = ring;
  const planes: readonly (readonly [Axis, number, boolean])[] = [
    [0, bounds.west + lonShift, true],
    [0, bounds.east + lonShift, false],
    [1, bounds.south, true],
    [1, bounds.north, false],
  ];
  for (const [axis, bound, keepGreater] of planes) {
    if (current.length < 3) return [];
    current = clipRingToHalfPlane(current, axis, bound, keepGreater);
  }
  if (current.length < 3) return [];
  const out = current.map(([lon, lat]) => [lon - lonShift, lat] as GlyphMapLonLat);
  out.push([out[0][0], out[0][1]]);
  return out;
}

/**
 * Clip one polygon GROUP — `[outer, ...holes]`, closed rings in the
 * GeoJSON/TopoJSON sense — against a tile's box, returning zero or more
 * clipped groups in the same `[outer, ...holes]` shape. Every returned ring
 * is CLOSED (first point repeated as last) and lies inside `bounds`, so it
 * can go straight to the fill mesh's own earcut.
 *
 * A group is emitted once per whole-world longitude shift its unwrapped
 * outer ring actually reaches into the box (see {@link
 * unwrapRingLongitudes}) — one for ordinary geometry, two for a ring with
 * real land on both sides of the antimeridian. Holes are clipped at that
 * same shift, so a lake never migrates to the wrong side of the seam. A hole
 * that falls entirely outside the box is dropped; an outer ring that does
 * takes its whole group with it.
 *
 * **A ring that bounds no area is not an outline** and is dropped before the
 * outer/hole roles are assigned, promoting the group's first real ring to
 * outer. Natural Earth needs this in both directions: 50m Antarctica's
 * mainland group leads with the 257-vertex pole edge (every vertex at lat
 * -89.999 — exactly collinear, zero area) and its real coastline is the
 * SECOND ring, so reading the pole edge as the outline discarded the whole
 * continent from every tile; 110m North Korea carries a group of four
 * identical points, which can only ever cost bytes. The promoted coastline
 * is a pole-encircling ring like any other and takes {@link closeOverPole}'s
 * existing path, which is what turns it into a filled cap.
 */
export function glyphMapClipPolygonGroup(
  group: readonly (readonly GlyphMapLonLat[])[],
  bounds: GlyphMapBounds,
): GlyphMapLonLat[][][] {
  const rings = group.filter(ringEnclosesArea);
  if (!rings.length) return [];
  const unwrapped = rings.map((ring) => {
    const open = unwrapRingLongitudes(openRingForClip(ring));
    // The ring's own first vertex is its unwrapped closing vertex; a whole
    // world between them means it never closed (see `closeOverPole`).
    return Math.abs(open[open.length - 1][0] - open[0][0]) > ANTIMERIDIAN_STEP_DEG ? closeOverPole(open) : open;
  });
  let minLon = Infinity;
  let maxLon = -Infinity;
  for (const [lon] of unwrapped[0]) {
    if (lon < minLon) minLon = lon;
    if (lon > maxLon) maxLon = lon;
  }
  const out: GlyphMapLonLat[][][] = [];
  for (const lonShift of [-360, 0, 360]) {
    // Strictly, so a ring merely TOUCHING a shifted box's edge (a vertex at
    // exactly +-180) contributes a degenerate zero-width group instead of a
    // real one.
    if (!(maxLon > bounds.west + lonShift && minLon < bounds.east + lonShift)) continue;
    const outer = clipUnwrappedRing(unwrapped[0], bounds, lonShift);
    if (!outer.length) continue;
    const clipped: GlyphMapLonLat[][] = [outer];
    for (let r = 1; r < unwrapped.length; r++) {
      const hole = clipUnwrappedRing(unwrapped[r], bounds, lonShift);
      if (hole.length) clipped.push(hole);
    }
    out.push(clipped);
  }
  return out;
}
