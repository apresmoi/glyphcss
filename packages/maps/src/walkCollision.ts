/**
 * Street-level WALK mode — the COLLISION half.
 *
 * `walk.ts` steps the walker geodesically and asks nothing about what is in
 * the way; this file answers "may that step happen, and if not, what step
 * happens instead". It is pure, like the rest of `walk.ts`: no camera, no
 * scene, no provider types (the footprint source is restated structurally
 * below for the same reason `GlyphMapWalkBounds` is).
 *
 * ## Buildings block. Nothing else does.
 *
 * Only a `fill-extrusion`'s footprints are solid. A `fill` layer is a flat
 * overlay drawn on the datum — landuse, landcover, a lake — and walking
 * across a park or over the surface of water is exactly what a reader
 * expects to be able to do; making those solid would fence the walker into
 * the road network on the strength of a colour. The widget therefore feeds
 * this index from its `fill-extrusion` runtimes only.
 *
 * ## Test the STEP, not the position
 *
 * The whole feel of the feature is here. A position test — "am I inside a
 * building? then go back" — stops the walker dead the instant they touch
 * anything, and a street is a corridor of touchable surfaces: the reader
 * ends up glued to every wall they brush. So a blocked step is not
 * cancelled, it is PROJECTED onto the blocking wall's tangent, and the
 * walker slides along it. The normal component is what the wall takes away;
 * the tangential component is what a body walking down a corridor keeps.
 *
 * ## Metres, never degrees
 *
 * A footprint is in lon/lat, where a degree of longitude is
 * `cos(latitude)` of a degree of latitude — 0.68 at Zürich. Every distance
 * here is therefore taken in a LOCAL METRIC frame pinned at the walker's own
 * position: `x` east metres, `y` north metres. Over the few metres a body
 * radius spans, that frame is exact to well inside a millimetre, and it is
 * what makes a 0.3 m radius mean 0.3 m in both axes rather than 0.3 m north
 * and 0.44 m east.
 *
 * ## Never trap the walker
 *
 * Tiles stream in while walking, so a building can appear around a walker
 * already standing where it lands. A collision model that only ever says no
 * would seal them in, and a walker who cannot move is worse than one who
 * walks through walls. Two rules make that impossible:
 *
 *  1. If the step STARTS with the walker's own point inside a footprint,
 *     collision is off for that step — every direction is free until they
 *     are out.
 *  2. Otherwise a step is allowed whenever it REDUCES penetration, even if
 *     the destination is still inside the body-radius shell. That is what
 *     lets a walker who is standing 0.1 m from a wall that just appeared
 *     step away from it, which rule 1 alone does not cover (their point is
 *     outside the footprint, so rule 1 does not fire, and the destination is
 *     inside the shell, so a plain destination test would refuse every
 *     direction including the one leading out).
 *
 * ## Holes are holes
 *
 * A footprint is `[outer, ...holes]` — `glyphMapVectorMesh`'s own grouping,
 * carried on a feature's `polygons` when the source kept hole ownership. The
 * inside test is an even-odd crossing count over EVERY ring, so a courtyard
 * (inside the outer ring and inside a hole: two crossings) reads as outside
 * the solid, exactly as it renders.
 *
 * ## Known limitations, stated rather than discovered
 *
 *  - **A footprint is solid from the ground up**, whatever its
 *    `baseOffsetProperty` (OSM `min_height`) says. An overhang, an arcade or
 *    a bridge deck starting 4 m up therefore blocks a walker who could in
 *    reality walk under it. Fixing it needs the walker's own elevation
 *    tested against a per-feature base, which is a second axis this model
 *    does not carry.
 *  - **The terrain is still free-climb.** There is no slope limit; a walker
 *    may walk up anything, as they could before this file existed.
 *  - **A step longer than the body radius is SUBDIVIDED, not swept.** Sub
 *    steps of at most one radius make tunnelling through a building
 *    impossible at any frame rate this loop can produce, but the test at
 *    each sub-step is still a point-plus-radius one rather than a swept
 *    capsule.
 *  - **A footprint spanning the antimeridian is indexed by its raw
 *    lon/lat box** and so falls in the wrong buckets. No building spans it;
 *    a synthetic one would simply not collide.
 */

const DEG = Math.PI / 180;
const METRES_PER_DEGREE = 6_371_000 * DEG;

/**
 * The walker's body radius, metres.
 *
 * A walker is a point to every other part of this mode — the camera is at
 * `view.center`, the ground is sampled there, the tile sweep is centred
 * there — and a point stops with the EYE inside the wall's own face, which
 * reads as the render tearing rather than as an impact. 0.3 m puts the stop
 * a shoulder's half-width short of the surface, which is about where a body
 * stops, and it is comfortably clear of the 0.5 m near plane
 * (`GLYPH_MAP_WALK_NEAR_M`) so the wall the walker is stopped against is
 * still drawn rather than clipped away.
 *
 * It is deliberately SMALL relative to a doorway: the narrowest passage a
 * reader can be asked to walk is a gap of `2 * radius` plus a margin, i.e.
 * 0.6 m here, so every real alley and every real gap between two buildings
 * stays passable. A radius tuned to a human's own shoulder width (~0.55 m)
 * would fence off gaps that visibly look walkable.
 */
export const GLYPH_MAP_WALK_BODY_RADIUS_M = 0.3;

/**
 * The collision index's bucket size, metres.
 *
 * A city block is tens of metres, so 32 m puts a handful of footprints in a
 * bucket and a query — whose radius is one step plus a body, well under a
 * metre — touches one bucket or, at a boundary, four. The alternative that
 * this exists to avoid is testing every footprint in view per frame: at the
 * walker's own 600 m horizon that is thousands of buildings, which would
 * hand back the frame time the walk mode's render path was measured into.
 */
export const GLYPH_MAP_WALK_COLLISION_CELL_M = 32;

/**
 * How many buckets one footprint may be filed into before it is treated as
 * OVERSIZE and tested on every query instead.
 *
 * A stray planet-sized polygon (a mis-tagged feature, a badly clipped ring)
 * would otherwise be inserted into a bucket grid the size of its own box and
 * take the index build with it. 256 buckets is a 512 m square at the default
 * cell size — bigger than any real building, so nothing legitimate reaches
 * this path.
 */
const MAX_BUCKETS_PER_FOOTPRINT = 256;

/**
 * What this file needs of a vector feature — structurally a
 * `GlyphMapVectorFeature`, restated so this module keeps `walk.ts`'s freedom
 * from the provider types.
 */
export interface GlyphMapWalkFootprintSource {
  readonly geometryType?: "point" | "line" | "polygon";
  readonly rings: readonly (readonly (readonly [lon: number, lat: number])[])[];
  readonly polygons?: readonly (readonly (readonly (readonly [lon: number, lat: number])[])[])[];
}

/**
 * One solid piece of a building: its outer ring first, then its holes, plus
 * the lon/lat box the index files it by.
 *
 * A GROUP rather than a feature, matching `glyphMapVectorMesh`: a feature
 * with two disjoint parts extrudes as two structures and collides as two.
 */
export interface GlyphMapWalkFootprint {
  /** `[outer, ...holes]`, lon/lat. Closed or open — every ring is treated as closed. */
  readonly rings: readonly (readonly (readonly [lon: number, lat: number])[])[];
  readonly west: number;
  readonly east: number;
  readonly south: number;
  readonly north: number;
}

/** The neighbourhood query the step resolver runs — the whole reason this is an index and not an array. */
export interface GlyphMapWalkCollisionIndex {
  /** How many footprints are filed. `0` means every step is free and costs one branch. */
  readonly size: number;
  /** Every footprint whose box comes within `radiusM` of `(lon, lat)`. */
  near(lon: number, lat: number, radiusM: number): readonly GlyphMapWalkFootprint[];
}

/**
 * Turn mounted `fill-extrusion` features into footprints.
 *
 * `polygons` is preferred over `rings` for exactly the reason it exists:
 * flattening MVT rings loses hole ownership, and a footprint whose holes are
 * read as separate outer rings makes a courtyard solid and its building
 * hollow. Point and line features are dropped, matching the mesh builder's
 * own filter — an extrusion layer over a road source has nothing to extrude
 * and nothing to collide with.
 */
export function glyphMapWalkFootprints(features: Iterable<GlyphMapWalkFootprintSource>): GlyphMapWalkFootprint[] {
  const out: GlyphMapWalkFootprint[] = [];
  for (const feature of features) {
    if (feature.geometryType === "point" || feature.geometryType === "line") continue;
    const groups = feature.polygons ?? feature.rings.map((ring) => [ring]);
    for (const group of groups) {
      const rings = group.filter((ring) => ring.length >= 3);
      if (!rings.length) continue;
      let west = Infinity, east = -Infinity, south = Infinity, north = -Infinity;
      for (const [lon, lat] of rings[0]) {
        if (lon < west) west = lon;
        if (lon > east) east = lon;
        if (lat < south) south = lat;
        if (lat > north) north = lat;
      }
      if (!Number.isFinite(west) || !Number.isFinite(south)) continue;
      out.push({ rings, west, east, south, north });
    }
  }
  return out;
}

/**
 * File footprints into a uniform lon/lat bucket grid sized in METRES at the
 * set's own mean latitude.
 *
 * Rebuilt, never mutated: the widget throws the index away and builds a new
 * one when the mounted tile set changes, so a footprint can never outlive
 * the buildings it describes.
 */
export function createGlyphMapWalkCollisionIndex(
  footprints: readonly GlyphMapWalkFootprint[],
  cellM = GLYPH_MAP_WALK_COLLISION_CELL_M,
): GlyphMapWalkCollisionIndex {
  if (!footprints.length) return EMPTY_INDEX;
  let latSum = 0;
  for (const f of footprints) latSum += (f.south + f.north) / 2;
  const cosLat = Math.max(Math.cos((latSum / footprints.length) * DEG), 1e-3);
  const cellLat = cellM / METRES_PER_DEGREE;
  const cellLon = cellLat / cosLat;
  const buckets = new Map<number, GlyphMapWalkFootprint[]>();
  const oversize: GlyphMapWalkFootprint[] = [];
  const key = (ix: number, iy: number): number => ix * 73_856_093 + iy * 19_349_663;
  for (const f of footprints) {
    const ix0 = Math.floor(f.west / cellLon), ix1 = Math.floor(f.east / cellLon);
    const iy0 = Math.floor(f.south / cellLat), iy1 = Math.floor(f.north / cellLat);
    if ((ix1 - ix0 + 1) * (iy1 - iy0 + 1) > MAX_BUCKETS_PER_FOOTPRINT) { oversize.push(f); continue; }
    for (let iy = iy0; iy <= iy1; iy++) for (let ix = ix0; ix <= ix1; ix++) {
      const k = key(ix, iy);
      const bucket = buckets.get(k);
      if (bucket) bucket.push(f); else buckets.set(k, [f]);
    }
  }
  return {
    size: footprints.length,
    near(lon, lat, radiusM) {
      const padLat = radiusM / METRES_PER_DEGREE;
      const padLon = padLat / cosLat;
      const out: GlyphMapWalkFootprint[] = [...oversize];
      const ix0 = Math.floor((lon - padLon) / cellLon), ix1 = Math.floor((lon + padLon) / cellLon);
      const iy0 = Math.floor((lat - padLat) / cellLat), iy1 = Math.floor((lat + padLat) / cellLat);
      for (let iy = iy0; iy <= iy1; iy++) for (let ix = ix0; ix <= ix1; ix++) {
        const bucket = buckets.get(key(ix, iy));
        if (!bucket) continue;
        for (const f of bucket) {
          // A footprint straddling several buckets is filed in each of them,
          // so the box test is also the de-duplicator when a query window
          // spans more than one.
          if (lon + padLon < f.west || lon - padLon > f.east) continue;
          if (lat + padLat < f.south || lat - padLat > f.north) continue;
          if (!out.includes(f)) out.push(f);
        }
      }
      return out;
    },
  };
}

/** The index a map with no `fill-extrusion` layer holds: every step is free, and asking costs one property read. Not exported — `createGlyphMapWalkCollisionIndex([])` is how a caller gets one. */
const EMPTY_INDEX: GlyphMapWalkCollisionIndex = { size: 0, near: () => [] };

/** How deep into solid ground a point is, and where the nearest surface is — the whole geometric answer, in the caller's local metric frame. */
interface Penetration {
  /**
   * `radius - signedDistanceToTheFootprint`, so `<= 0` is free, `(0, radius]`
   * is inside the body-radius shell but outside the walls, and `> radius` is
   * the walker's own point inside the footprint.
   */
  readonly depth: number;
  /** Nearest point on the footprint's boundary, local metres. */
  readonly cx: number;
  readonly cy: number;
  readonly inside: boolean;
}

/** Distance (squared) from `(px, py)` to the segment `a`-`b`, and the closest point on it. */
function segment(px: number, py: number, ax: number, ay: number, bx: number, by: number): { d2: number; x: number; y: number } {
  const vx = bx - ax, vy = by - ay;
  const len2 = vx * vx + vy * vy;
  const t = len2 > 0 ? Math.max(0, Math.min(1, ((px - ax) * vx + (py - ay) * vy) / len2)) : 0;
  const x = ax + vx * t, y = ay + vy * t;
  const dx = px - x, dy = py - y;
  return { d2: dx * dx + dy * dy, x, y };
}

/**
 * The deepest penetration of `(px, py)` into any of `footprints`, in the
 * local metric frame `(lon0, lat0, kx, ky)` describes.
 *
 * Inside-ness is an even-odd crossing count over EVERY ring of a footprint —
 * outer and holes together — which is what makes a courtyard walkable.
 */
function penetration(
  footprints: readonly GlyphMapWalkFootprint[],
  px: number, py: number, radius: number,
  lon0: number, lat0: number, kx: number, ky: number,
): Penetration {
  let best: Penetration = { depth: -Infinity, cx: 0, cy: 0, inside: false };
  for (const footprint of footprints) {
    let minD2 = Infinity, cx = 0, cy = 0, inside = false;
    for (const ring of footprint.rings) {
      const n = ring.length;
      let ax = wrapLon(ring[n - 1][0] - lon0) * kx, ay = (ring[n - 1][1] - lat0) * ky;
      for (let i = 0; i < n; i++) {
        const bx = wrapLon(ring[i][0] - lon0) * kx, by = (ring[i][1] - lat0) * ky;
        const hit = segment(px, py, ax, ay, bx, by);
        if (hit.d2 < minD2) { minD2 = hit.d2; cx = hit.x; cy = hit.y; }
        if ((ay > py) !== (by > py) && px < ax + ((py - ay) / (by - ay)) * (bx - ax)) inside = !inside;
        ax = bx; ay = by;
      }
    }
    if (!Number.isFinite(minD2)) continue;
    const distance = Math.sqrt(minD2);
    const depth = inside ? radius + distance : radius - distance;
    if (depth > best.depth) best = { depth, cx, cy, inside };
  }
  return best;
}

function wrapLon(delta: number): number {
  return ((delta + 180) % 360 + 360) % 360 - 180;
}

/**
 * Resolve one frame's desired step against the buildings around it, and
 * report where the walker actually ends up.
 *
 * Returns `to` VERBATIM whenever nothing is in the way — the same object
 * identity a caller passed in — so a map with no buildings mounted, and a
 * walker in open ground, take a path that is bit-for-bit what it was before
 * collision existed.
 *
 * The step is subdivided into sub-steps of at most one body radius, so a
 * long frame (a tab coming back, a stall) cannot tunnel a walker through a
 * building; each sub-step is resolved independently, which is also what lets
 * a walker slide INTO a corner and then along the second wall in the same
 * frame.
 */
export function glyphMapWalkResolveStep(args: {
  readonly index: GlyphMapWalkCollisionIndex;
  readonly from: readonly [number, number];
  readonly to: readonly [number, number];
  readonly radiusM?: number;
}): readonly [number, number] {
  const { index, from, to } = args;
  const radius = args.radiusM ?? GLYPH_MAP_WALK_BODY_RADIUS_M;
  if (!index.size || !(radius > 0)) return to;
  const [lon0, lat0] = from;
  const cosLat = Math.max(Math.cos(lat0 * DEG), 1e-6);
  const kx = METRES_PER_DEGREE * cosLat, ky = METRES_PER_DEGREE;
  const dx = wrapLon(to[0] - lon0) * kx, dy = (to[1] - lat0) * ky;
  const length = Math.hypot(dx, dy);
  if (!(length > 0)) return to;
  const candidates = index.near(lon0, lat0, length + radius);
  if (!candidates.length) return to;

  const steps = Math.min(16, Math.max(1, Math.ceil(length / radius)));
  const ux = dx / steps, uy = dy / steps;
  let px = 0, py = 0, modified = false;
  for (let i = 0; i < steps; i++) {
    const start = penetration(candidates, px, py, radius, lon0, lat0, kx, ky);
    const nx = px + ux, ny = py + uy;
    // Rule 1: the walker's own point is inside a building — a tile that
    // streamed in around them, or a step that already got in. Movement is
    // unconditional until they are out.
    if (start.depth > radius) { px = nx; py = ny; continue; }
    const dest = penetration(candidates, nx, ny, radius, lon0, lat0, kx, ky);
    // Rule 2: free, or at least freer than where the sub-step started.
    if (dest.depth <= 0 || dest.depth < start.depth) { px = nx; py = ny; continue; }
    // Blocked. Slide: keep the component of the step ALONG the wall and drop
    // the component into it. The wall's outward normal is the direction from
    // its nearest surface point to the walker (or the reverse, if the walker
    // is the side that is inside).
    modified = true;
    const ox = dest.inside ? dest.cx - nx : nx - dest.cx;
    const oy = dest.inside ? dest.cy - ny : ny - dest.cy;
    const on = Math.hypot(ox, oy);
    if (!(on > 0)) break;
    const wx = ox / on, wy = oy / on;
    const into = ux * wx + uy * wy;
    const sx = px + ux - into * wx, sy = py + uy - into * wy;
    const slid = penetration(candidates, sx, sy, radius, lon0, lat0, kx, ky);
    if (slid.depth <= 0 || slid.depth < start.depth) { px = sx; py = sy; }
    // else: a corner. The walker stays put for this sub-step rather than
    // being pushed anywhere they did not ask to go.
  }
  if (!modified) return to;
  return [wrapLon(lon0 + px / kx), lat0 + py / ky];
}
