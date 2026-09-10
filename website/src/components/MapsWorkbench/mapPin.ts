/**
 * The `/maps` `model` layer's geometry.
 *
 * `GlyphMapModelLayer` is the one layer type with no data source of its own —
 * it takes caller-authored `Polygon[]` in the map's WORLD frame and passes
 * them straight to glyphcss. So it gets no dataset picker: inventing a
 * "model dataset" would be inventing data. What it gets instead is a SHAPE
 * picker over `@glyphcss/core`'s own geometry registry, plus the one thing a
 * map genuinely wants in 3D and no other layer type can express — that shape
 * standing ON the terrain at a real place, in real metres.
 *
 * ## What this file owns, and what it does NOT
 *
 * The geometry itself is `resolveGeometry` (`@glyphcss/core`, re-exported by
 * `glyphcss`), never hand-built here: the registry already has ~50 solids and
 * a second pyramid would be a second source of truth. What the registry
 * cannot do is place one on a globe. This file owns exactly the three things
 * it doesn't:
 *
 *  1. **Grounding.** A primitive comes back centred on its own origin. A
 *     landmark has to STAND on the surface, so the mesh's own vertical
 *     extent is re-mapped to `0..heightM` before projection — the shape's
 *     lowest point lands exactly at elevation 0 and its highest at
 *     `heightM`, whatever the primitive's local origin happened to be.
 *  2. **Projection, per vertex.** Every vertex is projected individually
 *     through `projection.project(lon, lat, elev)` rather than through one
 *     linearized frame at the anchor, so a shape wide enough to matter
 *     follows the globe's own curvature and is lifted through the same
 *     `elev` axis (and the same exaggeration) as the terrain under it.
 *     "Crop, don't clamp" comes along for free: any vertex outside the
 *     projection's valid window discards the whole solid.
 *  3. **The handedness PROBE.** glyphcss backface-culls on the sign of a
 *     face's projected area, so a wrongly-wound solid is silently invisible
 *     — and "which way round does east-then-north go" is a property of the
 *     PROJECTION's frame, not a constant. The three projections `/maps`
 *     ships happen to agree (all three put `east x north` along their own
 *     up), so on those the probe never fires. It is here because
 *     `glyphMapFromD3Raw` lets a caller bring an ARBITRARY raw projection,
 *     and a mirrored one flips the sign — the same fact
 *     `packages/maps/src/mesh.ts`'s `localUpDirection` exists for, decided
 *     by asking THIS projection rather than by an `if (projection.id ===
 *     ...)`. `mapPin.test.ts` pins it against a deliberately mirrored
 *     projection, since no shipped one exercises it.
 *
 * ## Local axes
 *
 * The registry's own convention for anything with a distinguished axis
 * (`pyramid`, `cone`, `cylinder`, `prism`, and `torus`'s tube axis) is
 * **Y-up**, with X/Z the ground plane; the symmetric solids (`cube`,
 * `sphere`, `icosahedron`) are indifferent. So local Y is the height axis
 * here, and the ground plane maps `x -> east`, `z -> SOUTH`. The south is
 * not a typo: `X x Z = -Y`, so mapping `z -> north` would make the local
 * frame left-handed against `(east, north, up)` and reverse every face's
 * winding before the projection probe ever ran. Negating it keeps the local
 * frame right-handed, which is the convention the probe below then corrects
 * from.
 */
import type { GlyphMapProjection } from "@glyphcss/maps";
import { resolveGeometry, type GlyphGeometryName, type Polygon } from "glyphcss";

type Vec3 = [number, number, number];

function sub(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}
function cross(u: Vec3, v: Vec3): Vec3 {
  return [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
}
function dot(u: Vec3, v: Vec3): number {
  return u[0] * v[0] + u[1] * v[1] + u[2] * v[2];
}
function finite(v: Vec3): boolean {
  return Number.isFinite(v[0]) && Number.isFinite(v[1]) && Number.isFinite(v[2]);
}

/**
 * The shapes the Model card offers — a deliberately short list out of the
 * registry's ~50, chosen on what survives the medium rather than on
 * completeness. A landmark on this page occupies a few dozen glyph cells, so
 * a shape is only worth offering if its SILHOUETTE is still readable there,
 * and every extra entry past that is a longer dropdown showing the reader
 * indistinguishable blobs. These six are the distinct silhouettes: pointed
 * (pyramid, cone), boxy (cube), round (sphere), columnar (cylinder) and
 * faceted (icosahedron). The Archimedean and Catalan solids are all "round
 * and faceted" at this size — they read as the sphere and the icosahedron
 * already do.
 *
 * `torus` is deliberately NOT here, and not for legibility: measured through
 * the divergence theorem, `torusPolygons` is the one solid in
 * `@glyphcss/core`'s registry wound INWARD (signed volume -1.68 at size 1,
 * against +0.51..+6.12 for every other primitive checked). Mounted here it
 * would show its inner surface, and the fix belongs in `packages/core`, not
 * in a special case on this side that would quietly disagree with the
 * registry. `mapPin.test.ts`'s own winding assertion is what caught it and
 * is what will fail the moment it is added back before that fix lands.
 *
 * `pyramid` is first and is the default: it is what this layer has always
 * mounted, and a spike is the clearest "a landmark is HERE" of the six.
 */
export const MAP_MODEL_SHAPES = ["pyramid", "cone", "cube", "cylinder", "sphere", "icosahedron"] as const;
export type MapModelShape = (typeof MAP_MODEL_SHAPES)[number];

/** Compile-time proof every entry above is a real registry name — a typo would otherwise only surface as a thrown `Unknown geometry` at runtime. */
const _shapesAreGeometryNames: readonly GlyphGeometryName[] = MAP_MODEL_SHAPES;
void _shapesAreGeometryNames;

export const MAP_MODEL_SHAPE_LABELS: Record<MapModelShape, string> = {
  pyramid: "Pyramid",
  cone: "Cone",
  cube: "Cube",
  cylinder: "Cylinder",
  sphere: "Sphere",
  icosahedron: "Icosahedron",
};

export const MAP_MODEL_SHAPE_OPTIONS = MAP_MODEL_SHAPES.map((value) => ({ value, label: MAP_MODEL_SHAPE_LABELS[value] }));

export const MAP_MODEL_SHAPE_DEFAULT: MapModelShape = "pyramid";

export interface GlyphMapModelOptions {
  /** Which registry solid to stand at the anchor. Defaults to {@link MAP_MODEL_SHAPE_DEFAULT}. */
  readonly shape?: MapModelShape;
  /** Height from the ground to the shape's top, in METRES — lifted through the projection's own `elev` axis, so it exaggerates exactly as terrain does. */
  readonly heightM: number;
  /** Half-width of the shape's ground footprint, in degrees of lon/lat. */
  readonly halfWidthDeg: number;
  readonly color?: string;
}

/**
 * `shape` standing at `[lon, lat]`, its base exactly on the datum and its top
 * `heightM` above it.
 *
 * Returns `[]` when any vertex falls outside the projection's valid window
 * ("crop, don't clamp") rather than emitting a partly-projected solid.
 */
export function buildGlyphMapModelPolygons(
  projection: GlyphMapProjection,
  lon: number,
  lat: number,
  opts: GlyphMapModelOptions,
): Polygon[] {
  const local = resolveGeometry(opts.shape ?? MAP_MODEL_SHAPE_DEFAULT, { size: 1, color: opts.color });
  if (local.length === 0) return [];

  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const face of local) for (const [x, y, z] of face.vertices) {
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
    if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
  }
  const cx = (minX + maxX) / 2;
  const cz = (minZ + maxZ) / 2;
  // ONE horizontal scale for both ground axes, so the footprint keeps the
  // shape's own aspect instead of being stretched to a square.
  const halfSpan = Math.max((maxX - minX) / 2, (maxZ - minZ) / 2) || 1;
  const height = maxY - minY || 1;

  const project = (l: number, a: number, e: number): Vec3 => projection.project(l, a, e) as Vec3;
  // `x -> east`, `z -> SOUTH` (see the module doc: `X x Z = -Y`, so an
  // un-negated `z -> north` would silently reverse every winding), `y ->
  // elevation with the shape's own floor pinned to the datum.
  const place = ([x, y, z]: readonly number[]): Vec3 => project(
    lon + ((x - cx) / halfSpan) * opts.halfWidthDeg,
    lat - ((z - cz) / halfSpan) * opts.halfWidthDeg,
    ((y - minY) / height) * opts.heightM,
  );

  // Does THIS projection's own (east, north, up) come out right-handed? Probe
  // it at the anchor with the same offsets the shape itself uses, rather than
  // assuming — see the module doc.
  const centre = project(lon, lat, 0);
  const east = project(lon + opts.halfWidthDeg, lat, 0);
  const north = project(lon, lat + opts.halfWidthDeg, 0);
  const up = project(lon, lat, opts.heightM);
  if (!finite(centre) || !finite(east) || !finite(north) || !finite(up)) return [];
  const mirrored = dot(cross(sub(east, centre), sub(north, centre)), sub(up, centre)) < 0;

  const out: Polygon[] = [];
  for (const face of local) {
    const vertices = face.vertices.map(place);
    if (vertices.some((v) => !finite(v))) return [];
    const polygon: Polygon = { vertices: mirrored ? vertices.reverse() : vertices };
    if (opts.color) polygon.color = opts.color;
    out.push(polygon);
  }
  return out;
}
