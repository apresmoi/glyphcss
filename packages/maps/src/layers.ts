import earcut from "earcut";
import type { Polygon, Vec3 } from "glyphcss";
import type { GlyphMapBounds, GlyphMapField } from "./types";
import type { GlyphMapProjection } from "./projection";
import { localUpDirection } from "./mesh";
import type { GlyphMapVectorFeature } from "./vector/types";

export interface GlyphMapLabelCandidate { readonly id: string; readonly col: number; readonly row: number; readonly label: string; readonly priority: number }

/**
 * Greedy, stable label declutter: priority descending, then input order.
 *
 * `padX`/`padY` grow each label's exclusion box beyond its own glyphs
 * WITHOUT changing where it is drawn. Both default to `0`, so the symbol
 * layer's behaviour is untouched. A contour layer uses them for a second job
 * the box then does for free: `padX` is also the REPETITION spacing along one
 * contour, since two labels on the same line can never sit closer than their
 * padded boxes allow — the cartographic "repeat the number along the line,
 * spaced out" rule expressed as a collision constraint rather than as a
 * separate periodic rule.
 */
export function glyphMapDeclutterLabels(candidates: readonly GlyphMapLabelCandidate[], charWidth = 1, height = 1, padX = 0, padY = 0): readonly GlyphMapLabelCandidate[] {
  const placed: { x: number; y: number; w: number; h: number }[] = [];
  const out: GlyphMapLabelCandidate[] = [];
  for (const candidate of candidates.map((value, index) => ({ value, index })).sort((a, b) => b.value.priority - a.value.priority || a.index - b.index)) {
    const c = candidate.value;
    const w = Math.max(charWidth, c.label.length * charWidth) + padX * 2;
    const h = height + padY * 2;
    const box = { x: c.col - w / 2, y: c.row - h / 2, w, h };
    if (placed.some((p) => !(box.x + box.w <= p.x || box.x >= p.x + p.w || box.y + box.h <= p.y || box.y >= p.y + p.h))) continue;
    placed.push(box);
    out.push(c);
  }
  return out;
}

export function glyphMapPointHeatmap(features: readonly GlyphMapVectorFeature[], bounds: GlyphMapBounds, cols: number, rows: number, radius = 2, weightProperty?: string): GlyphMapField {
  if (!(cols > 0 && rows > 0 && radius >= 0)) throw new RangeError("glyphcss/maps: invalid heatmap dimensions or radius.");
  const values = new Float32Array(cols * rows);
  const sigma2 = Math.max(0.25, radius * radius / 2);
  for (const feature of features) for (const ring of feature.rings) for (const [lon, lat] of ring) {
    const cx = (lon - bounds.west) / (bounds.east - bounds.west) * cols;
    const cy = (bounds.north - lat) / (bounds.north - bounds.south) * rows;
    const weight = weightProperty ? Number(feature.properties?.[weightProperty] ?? 0) : 1;
    if (!Number.isFinite(weight)) continue;
    const reach = Math.ceil(radius * 2);
    for (let y = Math.max(0, Math.floor(cy - reach)); y < Math.min(rows, Math.ceil(cy + reach)); y++) for (let x = Math.max(0, Math.floor(cx - reach)); x < Math.min(cols, Math.ceil(cx + reach)); x++) {
      const dx = x + 0.5 - cx, dy = y + 0.5 - cy;
      values[y * cols + x] += weight * Math.exp(-(dx * dx + dy * dy) / (2 * sigma2));
    }
  }
  let max = 0;
  for (const value of values) max = Math.max(max, value);
  return { bounds, cols, rows, values, noData: new Uint8Array(values.length), kind: "continuous", min: 0, max };
}

function finite(v: Vec3): boolean { return v.every(Number.isFinite); }

type LonLat = readonly [lon: number, lat: number];

function dot(u: Vec3, v: Vec3): number { return u[0] * v[0] + u[1] * v[1] + u[2] * v[2]; }

/** Twice the signed area of a lon/lat ring; positive is counter-clockwise. */
function signedArea2(ring: readonly LonLat[]): number {
  let a = 0;
  for (let i = 0, n = ring.length; i < n; i++) {
    const p = ring[i], q = ring[(i + 1) % n];
    a += p[0] * q[1] - q[0] * p[1];
  }
  return a;
}

/**
 * Newell's normal of a projected ring. Newell rather than a single
 * cross-product of the first three vertices: a real coastline ring routinely
 * opens with three near-collinear points (or a reflex corner), whose cross
 * product is either numerical noise or points the wrong way — Newell sums the
 * whole ring, so it is the best-fit plane's normal and is stable for any
 * non-convex ring.
 */
function ringNormal(points: readonly Vec3[]): Vec3 {
  let nx = 0, ny = 0, nz = 0;
  for (let i = 0, n = points.length; i < n; i++) {
    const a = points[i], b = points[(i + 1) % n];
    nx += (a[1] - b[1]) * (a[2] + b[2]);
    ny += (a[2] - b[2]) * (a[0] + b[0]);
    nz += (a[0] - b[0]) * (a[1] + b[1]);
  }
  return [nx, ny, nz];
}

/** Drop a ring's repeated closing vertex (GeoJSON/TopoJSON write one; MVT may not). */
function openRing(ring: readonly LonLat[]): readonly LonLat[] {
  const last = ring[ring.length - 1];
  return ring.length > 3 && ring[0][0] === last[0] && ring[0][1] === last[1] ? ring.slice(0, -1) : ring;
}

/**
 * An edge is split when its PROJECTED midpoint misses the chord's own
 * midpoint by more than this fraction of the chord length — see
 * {@link edgeNeedsSplit}. On a sphere that ratio is `tan(arc / 4) / 2`, so
 * `0.03` refines every edge down to roughly 13 degrees of arc, whose chord
 * sags `1 - cos(6.5deg)` = 0.6% of a radius below the surface and whose
 * plane normal is within ~6.5 degrees of the true surface normal. Both
 * margins are what make the rasterizer's backface cull a correct
 * near/far-hemisphere test for cap faces.
 */
const GLYPH_MAP_FILL_CURVATURE_TOLERANCE = 0.03;

/**
 * Recursion floor, in DEGREES of lon/lat edge length. This is deliberately a
 * pure function of the edge's OWN two endpoints rather than a recursion
 * depth: two faces sharing an edge then always reach the same verdict for
 * it, so refinement can never leave a T-junction crack between them.
 */
const GLYPH_MAP_FILL_MIN_EDGE_DEG = 0.5;

/**
 * Safety valve only, and the one rule here that is NOT a pure function of an
 * edge (so it is the one that could leave a T-junction). The curvature test
 * converges in three or four levels for any edge a real projection produces —
 * a 180-degree edge reaches 11 degrees in four halvings — and
 * {@link GLYPH_MAP_FILL_MIN_EDGE_DEG} is the real terminator behind that, so
 * this bound is never the reason refinement stops on a shipped projection.
 * It exists so a pathological bespoke {@link glyphMapFromD3Raw} projection
 * that reports curvature at EVERY scale cannot subdivide unboundedly: a
 * hairline crack is a better failure than a hang.
 */
const GLYPH_MAP_FILL_MAX_REFINE_DEPTH = 8;

/**
 * Minimum `cos` between a cap face's own normal and the projection's local
 * "up" there, below which the face is DROPPED rather than emitted.
 *
 * Once every edge is refined to roughly 13 degrees of arc, a face that is
 * genuinely a piece of the surface has a normal within about half that of the
 * local up — so a normal 26 degrees or more off is not surface at all, it is a
 * near-degenerate SLIVER, which triangulating a curved region in flat lon/lat
 * produces in quantity (earcut emits long thin ears along a coastline with no
 * interior vertices to work with). Short edges do not rule a sliver out: three
 * NEARLY COLLINEAR points have an arbitrarily large circumradius however close
 * together they are, and its plane is correspondingly ill-conditioned — the
 * normal degenerates into numerical noise perpendicular to the surface, so the
 * face's FACING becomes a coin flip and roughly half of them survive the
 * rasterizer's backface cull on the wrong hemisphere.
 *
 * Measured (far-hemisphere patch, 81x41 grid, refinement already on),
 * leaked cells vs. this threshold at four distances behind the limb:
 *
 *   threshold   6.4deg  14deg  18deg  22deg   near-side ink, real z0 admin0
 *   0.5 (60deg)     16     12      2      0   388
 *   0.8 (37deg)      4      4      2      0   388
 *   0.9 (26deg)      0      0      0      0   385
 *   0.98 (11deg)     0      0      0      0   382
 *
 * `0.9` is the first value that leaks nothing at any distance, and it costs
 * 3 of 388 cells (0.8%) of genuine near-side coverage on the real baked z0
 * admin_0 tile — the same degeneracy that makes a sliver's normal meaningless
 * also makes its area negligible.
 *
 * A flat projection's cap normals are exactly `+/-Z` = exactly its up, so this
 * never fires there and the flat path is untouched.
 */
const GLYPH_MAP_FILL_MIN_FACE_UP_ALIGNMENT = 0.9;

type Project = (lon: number, lat: number, elev: number) => Vec3;

function midLonLat(a: LonLat, b: LonLat): LonLat {
  return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
}

/**
 * Whether the projection bends enough across this lon/lat edge that one flat
 * face cannot stand in for it — asked of the PROJECTION, never of a
 * projection id: `project` the edge's lon/lat midpoint and compare it against
 * the midpoint of the two projected endpoints. An AFFINE projection
 * ({@link glyphMapEquirectangular}) answers "no" for every edge with an exact
 * zero deviation, so the flat path emits precisely the faces it always did.
 *
 * A non-finite probe answers "no" as well: a group that straddles a
 * projection's valid window is already dropped whole by the caller's "crop,
 * don't clamp" check, and refining toward an edge the projection rejects
 * would only manufacture more of the same NaN.
 */
function edgeNeedsSplit(project: Project, a: LonLat, b: LonLat, elev: number): boolean {
  if (Math.hypot(b[0] - a[0], b[1] - a[1]) <= GLYPH_MAP_FILL_MIN_EDGE_DEG) return false;
  const pa = project(a[0], a[1], elev);
  const pb = project(b[0], b[1], elev);
  const m = midLonLat(a, b);
  const pm = project(m[0], m[1], elev);
  if (!finite(pa) || !finite(pb) || !finite(pm)) return false;
  const chord = Math.hypot(pb[0] - pa[0], pb[1] - pa[1], pb[2] - pa[2]);
  if (!(chord > 0)) return false;
  const deviation = Math.hypot(
    pm[0] - (pa[0] + pb[0]) / 2,
    pm[1] - (pa[1] + pb[1]) / 2,
    pm[2] - (pa[2] + pb[2]) / 2,
  );
  return deviation > GLYPH_MAP_FILL_CURVATURE_TOLERANCE * chord;
}

type Tri = readonly [LonLat, LonLat, LonLat];

/**
 * Red-green refinement of ONE lon/lat triangle: split whichever of its three
 * edges {@link edgeNeedsSplit} rejects, and recurse. Splitting per EDGE (not
 * "split all three or none") is what keeps the mesh conforming — a neighbour
 * sharing that edge runs the same pure predicate on the same two endpoints
 * and splits it at the same midpoint.
 */
function refineTriangle(out: Tri[], tri: Tri, project: Project, elev: number, depth: number): void {
  const [a, b, c] = tri;
  const ab = edgeNeedsSplit(project, a, b, elev);
  const bc = edgeNeedsSplit(project, b, c, elev);
  const ca = edgeNeedsSplit(project, c, a, elev);
  const splits = (ab ? 1 : 0) + (bc ? 1 : 0) + (ca ? 1 : 0);
  if (splits === 0 || depth >= GLYPH_MAP_FILL_MAX_REFINE_DEPTH) { out.push(tri); return; }
  const next = depth + 1;
  const push = (t: Tri) => refineTriangle(out, t, project, elev, next);
  if (splits === 3) {
    const mAb = midLonLat(a, b), mBc = midLonLat(b, c), mCa = midLonLat(c, a);
    push([a, mAb, mCa]); push([mAb, b, mBc]); push([mCa, mBc, c]); push([mAb, mBc, mCa]);
    return;
  }
  if (splits === 1) {
    // Rotate so the split edge is always `(p0, p1)`, opposite `p2`.
    const [p0, p1, p2] = ab ? [a, b, c] : bc ? [b, c, a] : [c, a, b];
    const m = midLonLat(p0, p1);
    push([p0, m, p2]); push([m, p1, p2]);
    return;
  }
  // Two edges: rotate so the UNSPLIT edge is `(p2, p0)`.
  const [p0, p1, p2] = !ca ? [a, b, c] : !ab ? [b, c, a] : [c, a, b];
  const m01 = midLonLat(p0, p1), m12 = midLonLat(p1, p2);
  push([p0, m01, p2]); push([m01, p1, m12]); push([m01, m12, p2]);
}

/**
 * The same per-edge verdict applied to ONE ring edge, yielding the lon/lat
 * points a wall is built between. Evaluated at the cap's own elevation so a
 * wall's top edge is split exactly where the cap's boundary edge is —
 * {@link refineTriangle} reaches the identical midpoints by the identical
 * pure predicate, so cap and wall stay welded.
 */
function refineEdge(out: LonLat[], a: LonLat, b: LonLat, project: Project, elev: number, depth: number): void {
  if (depth >= GLYPH_MAP_FILL_MAX_REFINE_DEPTH || !edgeNeedsSplit(project, a, b, elev)) { out.push(b); return; }
  const m = midLonLat(a, b);
  refineEdge(out, a, m, project, elev, depth + 1);
  refineEdge(out, m, b, project, elev, depth + 1);
}

/**
 * Convert grouped vector polygons to ordinary glyphcss faces; optional height
 * adds a roof and wall faces.
 *
 * ## Winding
 *
 * `Polygon.vertices` is "CCW from outside", and glyphcss backface-culls in
 * `scanFillTriangle` (`packages/glyphcss/src/render/rasterize.ts`) on the sign
 * of the projected 2x area — `area2 > 0` is dropped. Source rings arrive in
 * EITHER winding (GeoJSON says CCW-outer/CW-hole, MVT says the opposite, and
 * plenty of real data says neither), so a wrongly wound ring is silently
 * invisible, and a wrongly wound EXTRUSION is inside-out: its walls face into
 * the solid.
 *
 * Orientation is therefore decided from the real geometry, never from an
 * assumed input convention, in two independent steps:
 *
 * 1. **Topology, in lon/lat.** The outer ring is normalized to CCW and every
 *    hole to CW by 2D signed area. That is the ring-to-ring RELATIONSHIP
 *    (a hole runs against its outer), which is projection-independent, and it
 *    is what makes one wall formula correct for outer and hole alike: walking
 *    a hole the other way puts its wall's front face into the hole — i.e.
 *    away from the solid — which is exactly right.
 * 2. **Facing, in world space.** {@link localUpDirection} probes which way a
 *    small positive elevation nudge displaces a point through
 *    `projection.project` itself (`+Z` on a flat sheet, radially outward on
 *    the globe, whatever a bespoke `glyphMapFromD3Raw` projection means by
 *    it), and a face's Newell normal is compared against that probe. This
 *    mirrors {@link glyphMapPolygons}'s own per-quad probe, and for the same
 *    reason: a flat sheet's frame and the globe's are two independently
 *    chosen axis mappings with no shared handedness, and
 *    `glyphMapFromD3Raw` can bring a third with neither's.
 *
 *    Cap faces are probed INDIVIDUALLY, at each face's own lon/lat centroid,
 *    rather than once for the group: "up" turns with position on a curved
 *    projection, so one verdict taken at the ring's mean cannot be right for
 *    a group spanning tens of degrees. Walls keep the GROUP's verdict — a
 *    wall's normal is tangential, never aligned with "up", so the probe says
 *    nothing about it; what makes a wall outward-facing is step 1's ring
 *    topology, which is a property of the whole group.
 *
 * A probe that itself fails to project falls back to step 1's order alone,
 * rather than guessing.
 *
 * ## Curvature
 *
 * earcut triangulates in lon/lat and will happily join two boundary vertices
 * tens of degrees apart, but the face emitted for that triangle is FLAT — a
 * chord, not the surface. On the globe such a face
 *
 *   1. dives below the surface (measured on the real baked
 *      `website/public/data/vector-tiles` pyramid: a z1 tile emitted a face
 *      with a 1.922-radius edge — 96% of the sphere's own diameter — whose
 *      centroid sat 0.575 of a radius inside the globe, which renders as a
 *      straight line drawn through the world), and
 *   2. carries a normal that is no longer the surface's own, so the
 *      rasterizer's backface cull stops being a near/far-hemisphere test
 *      (the same z0 tile emitted faces whose plane was tangent at the
 *      ANTIPODE — a normal aimed straight back at the camera from the far
 *      side).
 *
 * Both are fixed at the root by refining every face until the projection is
 * locally affine across it: {@link edgeNeedsSplit} asks the PROJECTION
 * whether an edge's projected midpoint still coincides with its chord's
 * midpoint, and {@link refineTriangle}/{@link refineEdge} split until it
 * does. An affine projection ({@link glyphMapEquirectangular}) answers "no
 * split" everywhere with an exact zero deviation, so the flat path is
 * untouched, face for face.
 *
 * ## Far hemisphere
 *
 * Refined cap faces carry the surface's own outward normal, so the
 * rasterizer's backface cull removes far-hemisphere caps for free, with no
 * view-dependent state. Walls cannot work that way — a wall is a vertical
 * curtain whose normal is TANGENTIAL, so roughly half of a far-side ring's
 * walls genuinely face the camera through the globe (measured: 14 of 29 on
 * one far-side box) and no winding makes them back-facing. Only a near-side
 * predicate can answer that, and it is CAMERA-DEPENDENT — which is why this
 * function does not take one. It emits every wall and reports each one on
 * {@link GlyphMapVectorMesh.walls}; {@link glyphMapVectorCullWalls} applies
 * the predicate, cheaply enough to re-run per rendered frame (measured on the
 * real baked z0 admin_0 tile, 177 countries: 13.7ms to rebuild the mesh
 * against 0.5ms to re-cull it, 26x). Baking the verdict INTO the mesh instead
 * is what made walls disappear for the whole of a gesture: geometry is rebuilt
 * on a 180ms debounce that every moving frame re-arms, so a mesh culled for
 * the camera the view has already left kept its far-side verdict for the
 * entire drag plus glide (measured 681ms, 0 of 41 walls, on the fixture in
 * `widget.farSideFill.test.ts`).
 *
 * A wall is dropped when NONE of its four corners — its two ring endpoints at
 * its base elevation, and the same two at its top — is on the visible side.
 * Dropping on "none" rather than "not all" over-draws by at most one refined
 * wall segment past the limb instead of eroding a visible bite out of the
 * silhouette, and including the TOP corners is what keeps a tall extrusion
 * standing once its base ring has gone over a globe's horizon (see
 * {@link GlyphMapVectorWall}). Every flat projection declares no `visible`
 * capability at all — `project()` returning NaN is already their exclusion —
 * so the widget hands no predicate there and nothing is culled.
 *
 * ## Holes
 *
 * `group` is `[outer, ...holes]`. The cap is triangulated with earcut — the
 * same tessellator `@glyphcss/fonts`'s `extrudeContours` already uses for the
 * identical outer-ring-plus-holes shape (a glyph counter is a lake) — and
 * every ring, holes included, grows its own wall. Emitting the outer ring as
 * one n-gon instead would not only fill its lakes; glyphcss fan-triangulates
 * an n-gon from vertex 0, which is only correct for a CONVEX polygon, and a
 * coastline is anything but.
 *
 * There is deliberately no floor cap: an extrusion sits on opaque terrain, so
 * its underside is never the depth winner.
 */
export function glyphMapVectorPolygons(features: readonly GlyphMapVectorFeature[], projection: GlyphMapProjection, options: GlyphMapVectorMeshOptions = {}): Polygon[] {
  return glyphMapVectorMesh(features, projection, options).polygons as Polygon[];
}

export interface GlyphMapVectorMeshOptions {
  readonly color?: (feature: GlyphMapVectorFeature) => string | undefined;
  readonly height?: (feature: GlyphMapVectorFeature) => number;
  readonly base?: (feature: GlyphMapVectorFeature) => number;
}

/**
 * One extrusion wall face, addressed back into {@link GlyphMapVectorMesh}'s
 * own polygon list. `a`/`b` are the wall's two ring endpoints in lon/lat; the
 * face spans elevations `elev` (its base) to `elevTop` (its top, i.e. the
 * feature's own `base + height`, which varies per feature) — everything
 * {@link glyphMapVectorCullWalls} needs to re-run a near-side test on the
 * whole face without re-triangulating anything.
 *
 * BOTH elevations are carried because a wall is a tall object and its two
 * ends do not share a verdict: on a globe a point at height `h` clears the
 * horizon from `acos(r / (r + h))` of extra arc, so a wall's base can be past
 * the limb while its top is squarely in view.
 */
export interface GlyphMapVectorWall {
  /** Index into {@link GlyphMapVectorMesh.polygons}. */
  readonly polygon: number;
  readonly a: readonly [lon: number, lat: number];
  readonly b: readonly [lon: number, lat: number];
  /** The wall's BASE elevation — the feature's own `base`. */
  readonly elev: number;
  /** The wall's TOP elevation — the feature's own `base + height`. */
  readonly elevTop: number;
}

/**
 * The camera-INDEPENDENT half of {@link glyphMapVectorPolygons}: every cap and
 * every wall, plus the lon/lat addresses a caller needs to cull the walls
 * per frame. See the "Far hemisphere" section of
 * {@link glyphMapVectorPolygons} for why the two halves are separate.
 */
export interface GlyphMapVectorMesh {
  readonly polygons: readonly Polygon[];
  /** Empty for a `fill` (height 0) mesh, which has no camera-dependent face. */
  readonly walls: readonly GlyphMapVectorWall[];
}

/**
 * Drop every wall NO corner of which is on the visible side, keeping caps and
 * surviving walls in their original order. Returns a fresh array — `mesh`
 * itself is immutable and re-cullable against any number of cameras.
 *
 * A wall is a quad, not a segment: its four corners are its two ring
 * endpoints at its BASE elevation and the same two at its TOP, and a wall is
 * visible if ANY part of it is. Testing the base pair alone (which is all
 * this did while {@link GlyphMapVectorWall} carried one elevation) makes an
 * extrusion vanish whole the instant its footprint crosses a globe's limb,
 * even though a tall one keeps most of its wall band in view for
 * `acos(r / (r + h))` of arc past that point — the reported
 * "show the walls when the surface that paints them disappears".
 *
 * Testing the base FIRST is not cosmetic: for every wall on the near
 * hemisphere — the overwhelming majority on any real tile — the first call
 * short-circuits the other three, so the common case still costs one
 * predicate call per wall, as it did before.
 *
 * `visible` is the caller's near-side predicate: the widget builds it from
 * `projection.visible` plus its own camera-depth function, which is why it is
 * supplied rather than derived here — this module has no camera.
 */
export function glyphMapVectorCullWalls(mesh: GlyphMapVectorMesh, visible: (lon: number, lat: number, elev: number) => boolean): Polygon[] {
  if (!mesh.walls.length) return [...mesh.polygons];
  const keep = new Uint8Array(mesh.polygons.length).fill(1);
  for (const wall of mesh.walls) {
    const anyCorner = visible(wall.a[0], wall.a[1], wall.elev)
      || visible(wall.b[0], wall.b[1], wall.elev)
      || visible(wall.a[0], wall.a[1], wall.elevTop)
      || visible(wall.b[0], wall.b[1], wall.elevTop);
    if (!anyCorner) keep[wall.polygon] = 0;
  }
  const out: Polygon[] = [];
  for (let i = 0; i < mesh.polygons.length; i++) if (keep[i]) out.push(mesh.polygons[i]);
  return out;
}

/** @see GlyphMapVectorMesh */
export function glyphMapVectorMesh(features: readonly GlyphMapVectorFeature[], projection: GlyphMapProjection, options: GlyphMapVectorMeshOptions = {}): GlyphMapVectorMesh {
  const out: Polygon[] = [];
  const walls: GlyphMapVectorWall[] = [];
  const project: Project = (lon, lat, elev) => projection.project(lon, lat, elev);
  for (const feature of features) {
    const groups = feature.polygons ?? feature.rings.map((ring) => [ring]);
    const base = options.base?.(feature) ?? 0;
    const height = options.height?.(feature) ?? 0;
    const color = options.color?.(feature);
    for (const group of groups) {
      const rings: LonLat[][] = [];
      for (let r = 0; r < group.length; r++) {
        const ring = openRing(group[r]);
        if (ring.length < 3) continue;
        // Outer CCW, holes CW — see "Winding" step 1 above.
        const wantCcw = rings.length === 0;
        rings.push(signedArea2(ring) >= 0 === wantCcw ? [...ring] : [...ring].reverse());
      }
      if (!rings.length) continue;

      const bottom = rings.map((ring) => ring.map(([lon, lat]) => projection.project(lon, lat, base)));
      // `height === 0` reuses the bottom verbatim rather than reprojecting it;
      // a non-finite `height` (a feature whose height attribute isn't a number)
      // falls through to the projection and is cropped below like any other
      // out-of-window vertex.
      const top = height === 0 ? bottom : rings.map((ring) => ring.map(([lon, lat]) => projection.project(lon, lat, base + height)));
      // "Crop, don't clamp": one non-finite vertex anywhere in the group
      // discards the whole group — a partial cap would not match its walls.
      if (bottom.some((ring) => ring.some((v) => !finite(v))) || top.some((ring) => ring.some((v) => !finite(v)))) continue;

      const capElev = base + height;
      const up = groupUp(projection, rings[0], capElev);
      const flip = up !== null && dot(ringNormal(top[0]), up) < 0;

      // earcut indexes the rings concatenated in this same order, so `capLonLat`
      // is its index space and needs no per-ring arithmetic to read back.
      const flat: number[] = [];
      const holeIndices: number[] = [];
      const capLonLat: LonLat[] = [];
      for (let r = 0; r < rings.length; r++) {
        if (r > 0) holeIndices.push(flat.length / 2);
        for (const point of rings[r]) { flat.push(point[0], point[1]); capLonLat.push(point); }
      }
      const tris = earcut(flat, holeIndices, 2);
      const refined: Tri[] = [];
      for (let t = 0; t < tris.length; t += 3) {
        refineTriangle(refined, [capLonLat[tris[t]], capLonLat[tris[t + 1]], capLonLat[tris[t + 2]]], project, capElev, 0);
      }
      for (const tri of refined) {
        const vertices = tri.map(([lon, lat]) => projection.project(lon, lat, capElev));
        // A refined vertex is interior to a group whose corners all projected,
        // so this only fires for a projection whose valid window has a hole in
        // it — dropped face by face rather than poisoning the buffer with NaN.
        if (vertices.some((v) => !finite(v))) continue;
        const faceUp = localUpDirection(projection, (tri[0][0] + tri[1][0] + tri[2][0]) / 3, (tri[0][1] + tri[1][1] + tri[2][1]) / 3, capElev);
        const normal = ringNormal(vertices);
        let faceFlip = flip;
        if (faceUp !== null) {
          const scale = Math.hypot(normal[0], normal[1], normal[2]) * Math.hypot(faceUp[0], faceUp[1], faceUp[2]);
          if (!(scale > 0) || Math.abs(dot(normal, faceUp)) < GLYPH_MAP_FILL_MIN_FACE_UP_ALIGNMENT * scale) continue;
          faceFlip = dot(normal, faceUp) < 0;
        }
        const cap: Polygon = { vertices: faceFlip ? [vertices[2], vertices[1], vertices[0]] : vertices };
        if (color) cap.color = color;
        out.push(cap);
      }

      if (height > 0) for (const ring of rings) {
        for (let i = 0, n = ring.length; i < n; i++) {
          const from = ring[i];
          const steps: LonLat[] = [];
          refineEdge(steps, from, ring[(i + 1) % n], project, capElev, 0);
          let a = from;
          for (const b of steps) {
            const previous = a;
            a = b;
            const bi = projection.project(previous[0], previous[1], base);
            const bj = projection.project(b[0], b[1], base);
            const ti = projection.project(previous[0], previous[1], capElev);
            const tj = projection.project(b[0], b[1], capElev);
            if (!finite(bi) || !finite(bj) || !finite(ti) || !finite(tj)) continue;
            const wall: Polygon = { vertices: flip ? [bj, bi, ti, tj] : [bi, bj, tj, ti] };
            if (color) wall.color = color;
            walls.push({ polygon: out.length, a: previous, b, elev: base, elevTop: capElev });
            out.push(wall);
          }
        }
      }
    }
  }
  return { polygons: out, walls };
}

/**
 * The projection's own "up" at a ring's mean lon/lat. The MEAN rather than
 * vertex 0 because a fill ring can be a whole country: on the globe "up" turns
 * with position, and vertex 0 sits on the boundary while the cap's Newell
 * normal describes the interior. Vertex 0 is the fallback for a mean point the
 * projection rejects (a ring straddling a valid-window edge).
 */
function groupUp(projection: GlyphMapProjection, ring: readonly LonLat[], elev: number): Vec3 | null {
  let lon = 0, lat = 0;
  for (const [x, y] of ring) { lon += x; lat += y; }
  return localUpDirection(projection, lon / ring.length, lat / ring.length, elev)
    ?? localUpDirection(projection, ring[0][0], ring[0][1], elev);
}
