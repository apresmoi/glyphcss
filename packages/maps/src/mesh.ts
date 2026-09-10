import type { Polygon, Vec3 } from "glyphcss";
import type { GlyphMapProjection } from "./projection";
import type { GlyphMapGeoTile } from "./tile";
import { glyphMapGeoTileVertexLonLat } from "./tile";

export interface GlyphMapPolygonsOptions {
  /** Per-quad color from the quad's representative elevation (see {@link GlyphMapPolygonsOptions.colorSample}). Omit for uncolored polygons (glyphcss's default gray). `undefined` from this callback also leaves a quad uncolored. */
  readonly color?: (elev: number) => string | undefined;
  /**
   * Which elevation `color` is handed for a quad. Default
   * `"surface-median"`.
   *
   * - `"surface-median"` — the median of the terrain SURFACE the quad
   *   covers: the level that splits in half the area of the tile's own
   *   full-resolution bilinear surface over the block
   *   `[col..colNext] x [row..rowNext]`, whatever mesh `resolution` is in
   *   play. At the target tier a quad IS one source cell, so this is the
   *   band covering most of the surface the quad itself draws; on a
   *   coarsened tier it is the band covering most of the finer terrain the
   *   quad stands in for, so a tier's colour fidelity still does not degrade
   *   with its mesh resolution.
   * - `"corner-mean"` — the mean of the quad's own 4 drawn corners, i.e.
   *   the height of the drawn surface at the quad's centre.
   *
   * ## Why an area median, and not a statistic over the samples
   *
   * The two rules this replaced each fail on a real, measured case, and they
   * fail in opposite directions.
   *
   * A MEAN of the 4 corners crosses classifier boundaries the terrain never
   * does: a quad straddling a coastline averages deep ocean with high land
   * and lands BELOW sea level, so an elevation-band classifier paints it as
   * water even when almost all of it is land — measured on the real ETOPO1
   * pyramid, the floor tier's quad covering Bogota averaged -155 m across its
   * corners over terrain that is 379 of 441 samples above sea level, and
   * Quito's averaged -718 m.
   *
   * A MEDIAN OF THE COVERED SAMPLES fixes that case and was defended with a
   * guarantee that only holds for a large block: "if strictly more than half
   * a quad's covered samples are at or above sea level then so is the sample
   * at index `n >> 1`". True, and beside the point at the resolution a reader
   * actually looks at — `widget.ts`'s `reliefFractionForLevel` returns 1 for
   * every span the target tier is drawn at, so the block is the quad's own
   * four corners and the statistic degenerates into a 3-of-4 vote that cannot
   * see magnitude. Reported live over Buenos Aires: the z4 quad under
   * downtown reads (nw -1, ne -1, sw +12, se -1), three estuary samples
   * outvote the city, and the quad is painted bathymetric blue with a
   * straight quad edge visible through Retiro and Palermo — while 72.6% of
   * the surface drawn between those four corners is above sea level. 2,756
   * base cells that OpenStreetMap calls land were painted as water there.
   *
   * The area median is the same idea as the sample median with the evidence
   * corrected: it is a majority vote over the terrain the quad covers,
   * weighted by how much of that terrain each height occupies rather than by
   * how many baked samples happen to sit on it. Its guarantee is exact at
   * EVERY block size, n = 4 included, because it is a median's defining
   * property rather than a claim about counts: a band that less than half the
   * covered surface occupies cannot contain the level that halves it. The
   * cost is explicit and was accepted rather than discovered — the surface
   * between a lone high sample and its low neighbours really is mostly low,
   * so more quads come out water than the sample vote gave: on the real z4
   * tiles, 54 of 16,200 quads flip land -> water over Buenos Aires (14 the
   * other way) and 88 over Amsterdam (42 the other way), and 4 quads of the
   * Andes fixtures — real cliffs into the Peru-Chile trench, where the
   * terrain steps and the interpolated surface ramps — go with them.
   * Point-sampling the quad centre was measured as an alternative and is
   * WORSE than the mean (it drops into a river, lake or inlet: 268
   * majority-land quads misclassified across an Andes window at full
   * resolution, against the mean's 65).
   *
   * ## The surface is the BILINEAR patch, not the two triangles drawn
   *
   * glyphcss fan-triangulates a quad from its first vertex, so the surface it
   * literally rasterizes is two triangles sharing the nw-se diagonal. That
   * diagonal is an artefact of the fill order, and reading it would make the
   * statistic depend on it: for the Buenos Aires quad the nw-se split is
   * 42.6% above sea level and the sw-ne split is 85.2%, on the same four
   * numbers. The bilinear patch is the diagonal-independent interpolant those
   * two bracket (72.6%), and it is what a gridded height field means, so it
   * is what the statistic reads.
   *
   * `"corner-mean"` exists for a caller that needs the DRAWN surface's own
   * centre height rather than the terrain's: `widget.ts`'s `heatmap` layer
   * keys a `Map` on this exact value to recover the per-quad density behind
   * a combined terrain+relief elevation, which needs a statistic that mixes
   * all four corners and only them. An area median does neither: it collapses
   * onto one of the sampled heights wherever a cell is flat, and adjacent
   * quads share corners, so two quads carrying different densities collide on
   * one key.
   */
  readonly colorSample?: "surface-median" | "corner-mean";
  /**
   * Emit this many quads per axis instead of the tile's own `cols`/`rows`
   * — the relief mesh's resolution knob (see {@link glyphMapPolygons}'s
   * "Mesh resolution" section). Omitted (the default) means `tile.cols` x
   * `tile.rows`: the full baked grid, byte-identical to this option not
   * existing. Each field is rounded and clamped to `1 .. tile.cols` /
   * `1 .. tile.rows` — this only ever COARSENS; there is no interpolated
   * upsample, so asking for more quads than the tile has samples returns
   * the tile's own resolution rather than inventing vertices.
   */
  readonly resolution?: { readonly cols: number; readonly rows: number };
  /**
   * Metres added to every vertex's elevation for POSITION only — the quad's
   * colour still reads the terrain's own unbiased statistic (see
   * {@link GlyphMapPolygonsOptions.colorSample}), so a biased mesh is the
   * same map at a different radius, never a differently-classified one.
   * Default `0`: omitted, this is byte-identical to the option not existing.
   *
   * It goes through the projection's own `elev` axis, so it means the same
   * thing for every projection this package can be handed — `+Z` on a flat
   * sheet, radially outward on the globe, whatever a
   * {@link glyphMapFromD3Raw} caller's own third argument does — exactly
   * like {@link localUpDirection}'s probe and `addMarker`'s `elevation`.
   * It is also EXAGGERATION-INVARIANT in the way that matters: a projection
   * scales this offset by the same `exaggeration` it scales the relief it
   * has to clear, so one metre value holds at every relief scale.
   *
   * `widget.ts`'s relief tier ladder is the reason it exists — see
   * `GLYPH_MAP_RELIEF_BACKSTOP_SINK_M`.
   */
  readonly elevationBias?: number;
  /**
   * Elevation WINDOW in METRES — a floor and a ceiling, both optional, both
   * omitted by default (byte-identical to the option not existing). Terrain
   * outside it is HELD AT the window edge rather than dropped:
   * `minElevation: 0` renders the land and replaces the seabed with a smooth
   * plane at sea level, `maxElevation: 0` does the reverse.
   *
   * ## Why the surface is clamped and not cropped
   *
   * "Crop, don't clamp" ({@link glyphMapPolygons}) is a rule about the
   * PROJECTION's valid window, and it is a rule because a clamped pole
   * collapses a row of vertices onto one point — a zero-area sliver a
   * renderer still draws as a boundary edge. An elevation window is not that
   * shape of problem: clamping elevation slides a vertex along the
   * projection's own `elev` axis onto a plane, which is well conditioned,
   * area preserving, and leaves a closed surface. So the two are not in
   * tension, and the tension that does exist runs the other way — measured on
   * the real ETOPO1 pyramid through `createGlyphMap`:
   *
   * - Dropping the out-of-window quads is EXACT for one tier. Rendering the
   *   target LOD alone with a floor of 0 leaves precisely the cells the
   *   unwindowed render painted in a land band and removes precisely the
   *   ones it painted as water (150 of 1,752 sea cells over the
   *   Mediterranean at span 40 either way; 13 of 2,932 over the Peru-Chile
   *   trench at span 33).
   * - It is not exact for the tier LADDER, and cannot be made so. A raster
   *   layer mounts three tiers at once (`widget.ts`), each resolving the
   *   window against its OWN quad grid, so their coastlines disagree by up
   *   to a coarse quad — and a dropped quad is a HOLE, which the backstop
   *   underneath simply fills. Measured with all three tiers up, a cropped
   *   floor of 0 paints 641 of those 1,752 sea cells in a land band against
   *   the target tier's own 150, and 344 of 2,932 against 13: the "sea is
   *   basically GREEN" defect reintroduced, at the magnitude it was first
   *   reported at. {@link GlyphMapPolygonsOptions.elevationBias} cannot
   *   answer it — `GLYPH_MAP_RELIEF_BACKSTOP_SINK_M` ORDERS two surfaces
   *   where both exist and says nothing about what fills a gap in one.
   *   Cropping also eats coastline: 200 land cells went blank there, each a
   *   quad whose statistic fell below the floor taking its land half with it.
   * - Clamping has no hole, so none of that arises, and the agreement is
   *   exact rather than ordered: wherever every sample a tier covers is
   *   below the floor, EVERY tier's surface is the same constant plane, so
   *   no coarse chord can rise above a finer one. Measured, a clamped floor
   *   of 0 leaves the tier ladder's colour statistics untouched (165 and 17
   *   land-banded sea cells, exactly the unwindowed render's own, no land
   *   cell lost) while changing 8.2% of the glyphs at a world view and 14.3%
   *   under a 60-degree tilt — which is the whole point: what goes is the
   *   RELIEF, and at `exaggeration: 24` an ocean basin is a 261 km pit that
   *   renders as noise across every sea cell.
   *
   * ## POSITION only
   *
   * A quad's colour still reads the terrain's own unwindowed statistic
   * ({@link GlyphMapPolygonsOptions.colorSample}), exactly as
   * {@link GlyphMapPolygonsOptions.elevationBias} does — a windowed mesh is
   * the same map at a different shape, never a differently-classified one.
   * The sea stays sea-coloured; only its floor goes. Clamping the colour too
   * would hand an elevation-band classifier the floor value for every sea
   * quad on Earth, and `GlyphMapClassifiers.etopo1V1`'s first break is 0, so
   * a floor of 0 would paint every ocean in the lowest LAND colour — the
   * sea-painted-as-land defect `colorSample` exists to prevent, this time by
   * construction.
   *
   * ## Per VERTEX
   *
   * The clamp is applied to each vertex's own elevation, not to a quad
   * statistic, so `colorSample` never enters it — there is no quad-level
   * accept/reject decision for a statistic to make. That is also what makes
   * a partially-submerged quad right: its land corners keep their heights
   * while its sea corners sit on the plane, so the coast still slopes into
   * the water instead of stepping. Clamping a quad by its median would
   * instead move all four corners together and flatten real coastal relief
   * a whole quad at a time.
   *
   * A floor above the ceiling is not an error: every vertex lands on
   * `maxElevation` (`Math.max` then `Math.min`), i.e. one flat plane, and
   * the layer keeps rendering.
   */
  readonly minElevation?: number;
  readonly maxElevation?: number;
}

/**
 * The source vertex index each of `count + 1` output grid lines samples,
 * for a tile axis of `total` quads: `round(i * total / count)`.
 *
 * Three properties are load-bearing and each is asserted in `mesh.test.ts`:
 *
 * 1. `count === total` yields the identity `[0, 1, ..., total]` EXACTLY
 *    (integer arithmetic, no rounding slack), so the default path is
 *    byte-identical to the pre-resolution renderer.
 * 2. The first and last entries are exactly `0` and `total` for ANY
 *    `count`, so a coarsened tile's outer ring still lands precisely on
 *    the tile's own geographic boundary. A fixed integer STRIDE cannot
 *    promise that unless it divides `total` evenly (180 and 90 do not
 *    share a useful divisor ladder: `gcd` is 90, so a stride is confined
 *    to divisors of 90 and cannot express the ~1.5-1.75x coarsening the
 *    LOD's own 2x level steps actually leave on the table) — which is why
 *    this is a target COUNT rather than a stride.
 * 3. Entries are strictly increasing whenever `count <= total`, so no quad
 *    degenerates to zero width.
 *
 * Because the sequence depends only on `(total, count)`, two tiles at the
 * same pyramid level — same baked `cols`/`rows`, same requested `count` —
 * produce the IDENTICAL index list along their shared edge, hence the
 * identical vertex lon/lat and the identical elevation samples there. That
 * is the whole crack-freedom argument: it is exact vertex sharing, not an
 * approximation, and it is why the widget resolves a resolution per pyramid
 * LEVEL rather than per tile.
 */
function gridLineIndices(total: number, count: number): Int32Array {
  const out = new Int32Array(count + 1);
  for (let i = 0; i <= count; i++) out[i] = Math.round((i * total) / count);
  return out;
}

/**
 * The MINIMUM number of strips a block's surface is read at across the row
 * (`v`) direction, in {@link surfaceMedianElevation} — per source cell where
 * the block is one cell deep, divided among the cells where it is deeper.
 *
 * The statistic is EXACT along a row and discretized only across rows: for a
 * fixed `v` the bilinear surface is LINEAR in `u`, so that row's heights are
 * distributed uniformly between its two edge heights and its contribution to
 * the surface's value distribution is a closed form, not a sample. Only the
 * `v` direction is approximated, by a midpoint rule that converges as
 * `1/k^2`, so a handful of strips is already far more accurate than the same
 * work spent on a `k x k` lattice of point samples: measured against a
 * brute-force 64-strip reference over the real z4 tile under Buenos Aires
 * (16,200 quads), a 16-point lattice disagrees on the BAND of 27 quads and 8
 * strips on 5, of which 1 crosses sea level. On the vendored fixtures at
 * every mesh resolution the ladder can pick, 8 strips reproduces the area
 * majority exactly — zero quads misclassified against a 32x32 reference
 * lattice, which is what `mesh.seaLevelBand.test.ts` asserts with no
 * tolerance band; 4 strips leaves one, a quad 49.85% of whose surface is
 * above sea level.
 */
const SURFACE_MEDIAN_STRIPS = 8;

/**
 * The median of the terrain SURFACE over the vertex block a quad covers,
 * inclusive of both edges — see {@link GlyphMapPolygonsOptions.colorSample}
 * for why a quad's colour reads this rather than its 4 corners' mean or the
 * median of the SAMPLES it covers.
 *
 * Each source CELL of the block contributes one uniform interval per strip
 * (from that strip's west height to its east height, see
 * {@link SURFACE_MEDIAN_STRIPS}), so the block's value distribution is a
 * mixture of uniforms whose CDF is piecewise linear in the elevation, with a
 * breakpoint at every
 * interval end. The median is therefore solved EXACTLY rather than searched
 * for: sort the ends, binary-search the segment where the CDF crosses one
 * half, and invert the one linear piece it crosses on.
 *
 * `lo`/`hi`/`ends` are the caller's reusable buffers (one allocation per
 * `glyphMapPolygons` call, not one per quad). A cell with a non-finite corner
 * is left out rather than poisoning the block; the quad's own 4 corners are
 * already known finite by the time this runs (a non-finite corner skips the
 * quad entirely), so the empty-block fallback below is only reachable on a
 * coarsened tier whose every interior cell is broken.
 */
function surfaceMedianElevation(
  tile: GlyphMapGeoTile,
  lo: Float64Array,
  hi: Float64Array,
  ends: Float64Array,
  col: number,
  colNext: number,
  row: number,
  rowNext: number,
): number {
  const stride = tile.cols + 1;
  // Strips resolve the `v` direction WITHIN a cell, so a block that already
  // spans several cell rows needs fewer of them: what the accuracy depends on
  // is how many rows of the block's surface are read in total, and this keeps
  // that at `SURFACE_MEDIAN_STRIPS` or more however the block is shaped. It
  // matters because the statistic's work is proportional to the tile's own
  // cells rather than to the quad count, so without it a coarsened backstop
  // tier pays as much as the tier a reader is looking at: measured on the real
  // z4 tile, a 32-quad floor tier costs 3.3 ms/tile with this and 8.2 ms
  // without, at zero cost in accuracy (`mesh.seaLevelBand.test.ts`'s area
  // invariant holds identically either way, at every rung of the ladder).
  const strips = Math.max(1, Math.ceil(SURFACE_MEDIAN_STRIPS / (rowNext - row)));
  let m = 0;
  for (let r = row; r < rowNext; r++) {
    const top = r * stride;
    const bottom = (r + 1) * stride;
    for (let c = col; c < colNext; c++) {
      const nw = tile.elevation[top + c]!;
      const ne = tile.elevation[top + c + 1]!;
      const sw = tile.elevation[bottom + c]!;
      const se = tile.elevation[bottom + c + 1]!;
      if (!Number.isFinite(nw) || !Number.isFinite(ne) || !Number.isFinite(sw) || !Number.isFinite(se)) continue;
      for (let j = 0; j < strips; j++) {
        const v = (j + 0.5) / strips;
        const west = nw + (sw - nw) * v;
        const east = ne + (se - ne) * v;
        lo[m] = west < east ? west : east;
        hi[m] = west < east ? east : west;
        m++;
      }
    }
  }
  if (m === 0) {
    return (
      tile.elevation[row * stride + col]! +
      tile.elevation[row * stride + colNext]! +
      tile.elevation[rowNext * stride + col]! +
      tile.elevation[rowNext * stride + colNext]!
    ) / 4;
  }
  let n = 0;
  for (let i = 0; i < m; i++) {
    ends[n++] = lo[i]!;
    ends[n++] = hi[i]!;
  }
  const sorted = ends.subarray(0, n);
  sorted.sort();
  const half = m / 2;
  // How much of the block's surface sits at or below `h`, in units of
  // intervals. A FLAT strip (a cell whose east and west heights agree, so
  // `lo === hi`) is an atom and has to be counted the moment `h` reaches it —
  // a whole cell of terrain at exactly -1 m is the common case at a coast,
  // and treating it as "not yet counted" at h = -1 loses half the mass of
  // such a block and lands the median up on the one sloping corner.
  const cdf = (h: number): number => {
    let sum = 0;
    for (let i = 0; i < m; i++) {
      const l = lo[i]!;
      const u = hi[i]!;
      if (u <= l) {
        if (h >= l) sum += 1;
      } else if (h >= u) sum += 1;
      else if (h > l) sum += (h - l) / (u - l);
    }
    return sum;
  };
  // The smallest sorted end whose CDF has reached one half. `sorted[n - 1]`
  // is the block's maximum, where the CDF is `m`, so the search always lands.
  let loIdx = 0;
  let hiIdx = n - 1;
  while (loIdx < hiIdx) {
    const mid = (loIdx + hiIdx) >> 1;
    if (cdf(sorted[mid]!) >= half) hiIdx = mid;
    else loIdx = mid + 1;
  }
  const upper = sorted[loIdx]!;
  if (loIdx === 0) return upper;
  const lower = sorted[loIdx - 1]!;
  // No end lies strictly between two consecutive ends, so on this segment
  // every interval is fully below it, fully above it, or spanning it — and
  // only the spanning ones vary, each at a constant rate.
  let rate = 0;
  for (let i = 0; i < m; i++) {
    const l = lo[i]!;
    const u = hi[i]!;
    if (l <= lower && u >= upper && u > l) rate += 1 / (u - l);
  }
  if (rate <= 0) return upper;
  const at = lower + (half - cdf(lower)) / rate;
  return at < lower ? lower : at > upper ? upper : at;
}

interface ProjectedVertex {
  readonly xyz: Vec3;
  /** The tile's own elevation here — never `elevationBias`-shifted, because this is what `color` reads. */
  readonly elev: number;
  /** The elevation this vertex was actually PROJECTED at (`elev + elevationBias`). */
  readonly placedElev: number;
  readonly lon: number;
  readonly lat: number;
}

function projectVertex(tile: GlyphMapGeoTile, projection: GlyphMapProjection, col: number, row: number, bias: number, windowMin: number, windowMax: number): ProjectedVertex {
  const [lon, lat] = glyphMapGeoTileVertexLonLat(tile, col, row);
  const elev = tile.elevation[row * (tile.cols + 1) + col];
  // The window clamps, `bias` shifts, and `elev` (what `color` reads) is
  // untouched by either — see both options' docs.
  const placedElev = Math.min(windowMax, Math.max(windowMin, elev)) + bias;
  return { xyz: projection.project(lon, lat, placedElev), elev, placedElev, lon, lat };
}

function finite(v: Vec3): boolean {
  return Number.isFinite(v[0]) && Number.isFinite(v[1]) && Number.isFinite(v[2]);
}

function sub(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}
function cross(u: Vec3, v: Vec3): Vec3 {
  return [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
}
function dot(u: Vec3, v: Vec3): number {
  return u[0] * v[0] + u[1] * v[1] + u[2] * v[2];
}

/**
 * Meters. Any positive value works — only the SIGN of the resulting "which
 * way does elevation displace this point" probe is used (see
 * `localUpDirection` below), never its magnitude.
 */
const WINDING_PROBE_ELEV_DELTA = 1;

/**
 * A projection-agnostic "which way is up" probe at `(lon, lat, elev)`: the
 * displacement a small POSITIVE elevation nudge produces in WORLD space,
 * via the projection's own `project()` — nothing else. This is deliberately
 * generic rather than hardcoding "+Z" (right for the flat sheets) or
 * "radially outward" (right for the globe): {@link glyphMapFromD3Raw} lets a
 * caller bring an arbitrary projection, and every projection in this file
 * already agrees that increasing `elev` moves a point OUTWARD/UP by
 * construction (`reliefZ`, or the sphere's own radial displacement) — so
 * this probe is correct for any of them, including ones this package has
 * never seen, with no per-projection special-casing.
 *
 * Exported for `layers.ts`'s vector `fill`/`fill-extrusion` builder, which
 * faces the identical problem one ring at a time. Internal to the package —
 * not re-exported from `index.ts`.
 */
export function localUpDirection(projection: GlyphMapProjection, lon: number, lat: number, elev: number): Vec3 | null {
  const lifted = projection.project(lon, lat, elev + WINDING_PROBE_ELEV_DELTA);
  if (!finite(lifted)) return null;
  const base = projection.project(lon, lat, elev);
  if (!finite(base)) return null;
  return sub(lifted, base);
}

/**
 * Degrees. Small enough that the probe reads the projection's LOCAL
 * behaviour rather than its curvature, large enough to stay well clear of
 * double-precision cancellation in `project` (the globe's own `project` is
 * trigonometry on a unit sphere, so 1e-4 of a degree still moves a point by
 * ~1.7e-6 radii — eleven orders above the epsilon).
 */
const ORIENTATION_PROBE_DEG = 1e-4;

/**
 * The projection's local HANDEDNESS at `(lon, lat, elev)`: `+1` where a
 * counter-clockwise lon/lat triangle projects to an OUTWARD-facing world
 * triangle, `-1` where it projects to an inward-facing one, `null` where the
 * projection cannot place the probe.
 *
 * The companion to {@link localUpDirection}, and a probe for the same reason:
 * a flat sheet's frame and the globe's are two independently chosen axis
 * mappings with no shared handedness, and `glyphMapFromD3Raw` can bring a
 * third — so this asks `project` rather than assuming either.
 *
 * It exists because a face's OWN chord normal cannot answer "which way does
 * this face point" when the face is a thin tessellation sliver: three points
 * that are nearly collinear on the sphere have a circumcircle whose centre is
 * tens of degrees away, so their plane is the great circle's, not the
 * surface's, and its normal is up to 90 degrees off the local up (measured on
 * the real OpenFreeMap `3/3/3` ocean polygon: 122 of 1076 refined faces past
 * 26 degrees, the worst 87). The face's lon/lat WINDING plus this probe answer
 * it exactly and are well conditioned for any face shape, because neither
 * reads the face's thickness.
 *
 * Central differences, one-sided at the poles (`lat +/- delta` leaves the
 * domain there) — either way the two tangents are taken in increasing
 * `lon`/`lat` order, so the cross product's sign is the parametrisation's own.
 */
export function localOrientation(projection: GlyphMapProjection, lon: number, lat: number, elev: number): number | null {
  const up = localUpDirection(projection, lon, lat, elev);
  if (!up) return null;
  const d = ORIENTATION_PROBE_DEG;
  const at = (dLon: number, dLat: number): Vec3 => projection.project(lon + dLon, lat + dLat, elev);
  const east = at(d, 0), west = at(-d, 0);
  const lonTangent = finite(east) && finite(west) ? sub(east, west) : finite(east) ? sub(east, projection.project(lon, lat, elev)) : finite(west) ? sub(projection.project(lon, lat, elev), west) : null;
  const north = at(0, Math.min(90, lat + d) - lat), south = at(0, Math.max(-90, lat - d) - lat);
  const latTangent = finite(north) && finite(south) ? sub(north, south) : null;
  if (!lonTangent || !latTangent || !finite(lonTangent) || !finite(latTangent)) return null;
  const sign = dot(cross(lonTangent, latTangent), up);
  return sign > 0 ? 1 : sign < 0 ? -1 : null;
}

/**
 * The relief mesh (MAPS.md §14): one quad per {@link GlyphMapGeoTile} cell,
 * each corner projected through `projection` — glyphcss's flat/globe camera
 * renders the SAME geometry under two functions (§7). A quad with any corner
 * outside the projection's valid window (`project` returning `[NaN, NaN,
 * NaN]` — Mercator past `±maxLat`, orthographic on the far hemisphere) is
 * skipped entirely: "crop, don't clamp" (§7) — a clamped corner would
 * collapse into a zero-area sliver a renderer still draws as a boundary
 * edge, and NaN vertices would poison every buffer downstream.
 *
 * Winding starts `[nw, sw, se, ne]` (col0/row0, col0/row+1, col+1/row+1,
 * col+1/row0) for CCW-from-outside (`Polygon.vertices`'s contract) — verified
 * correct for THIS package's chirality-correct globe frame
 * ({@link glyphMapGlobe}'s doc comment) — the mirror image of
 * `website/scripts/bake-globe.mjs`'s own `[a, b, c, d]` order, which is only
 * outward-facing under ITS mirrored `Y`-negated convention (verified
 * computationally: the two conventions' winding is each other's reverse for
 * the same tile). It is NOT necessarily correct for every projection: the
 * globe's frame (`X/Y/Z` = a point's own radial direction) and a flat sheet's
 * frame (`X` = negated lat, `Y` = lon, `Z` = relief — {@link glyphMapEquirectangular}/
 * {@link glyphMapMercator}) are two independently-chosen axis mappings with
 * NO guaranteed shared handedness, and in fact don't share one: a flat
 * sheet's `[nw, sw, se, ne]` order is wound CW, not CCW, as seen from above
 * (a camera at `+Z` looking down `-Z`, the only sensible way to view a
 * relief sheet) — found live rendering `/maps` through `createGlyphMap`'s
 * default (non-orbit) camera, which backface-culled the ENTIRE mesh under
 * `glyphMapEquirectangular`/`glyphMapMercator` (blank render, no error) while
 * `glyphMapGlobe`/`glyphMapOrthographic` rendered fine — a sphere has no
 * "wrong side" to expose the bug (an external camera always faces SOME
 * outward point), and orthographic's near-hemisphere projection formula
 * happens to preserve handedness where the flat sheets' don't.
 *
 * Rather than hardcode a second winding for "the flat case" (fragile, and
 * silently wrong again for a THIRD frame — {@link glyphMapFromD3Raw} lets a
 * caller bring an arbitrary projection with its own, unknown handedness),
 * each quad self-corrects: {@link localUpDirection} probes which way a small
 * positive `elev` nudge displaces `nw` in world space (radially outward on
 * the globe, `+Z` on a flat sheet, whatever "up" means for a bespoke d3
 * projection — every projection here already agrees elevation displaces a
 * point outward/up, so this needs no per-projection knowledge), and the
 * quad's fan-triangle normal is compared against it: winding flips to
 * `[nw, ne, se, sw]` (same edges, reverse traversal) only when the default
 * order's normal points away from that probe. A probe that itself fails to
 * project (e.g. exactly astride a projection's valid-window edge) falls back
 * to the default order rather than guessing. This is a no-op for the globe
 * (its existing winding already agrees with the probe — unchanged, per
 * `mesh.test.ts`'s exact-order assertion) and fixes the flat sheets without
 * either needing to know it's "the flat case".
 *
 * ## Mesh resolution
 *
 * `opts.resolution` emits a COARSER quad grid than the tile's own — the
 * baked pyramid ships one fixed tile shape (180x90 quads at every zoom),
 * but how much of the output character grid a tile actually covers varies
 * by view, and geometry finer than one glyph cell is invisible. Output
 * grid line `i` samples source vertex {@link gridLineIndices}`[i]`; every
 * other behaviour here — the "crop, don't clamp" whole-quad skip on a
 * non-finite corner and the per-quad {@link localUpDirection} winding
 * probe — is recomputed from the COARSE quad's own corners, never inherited
 * from a finer one. The elevation driving `opts.color` is the exception, and
 * deliberately so: it reads the tile's own FULL-resolution vertices over the
 * block the coarse quad covers ({@link GlyphMapPolygonsOptions.colorSample}),
 * so a tier's colour fidelity does not degrade with its mesh resolution.
 *
 * Elevation is POINT-sampled at the retained vertices, not aggregated
 * (mean/max) over the skipped block. Aggregation would have to read the
 * same block from both sides of a tile boundary to keep a shared edge
 * exact, and a tile only holds its own samples — so a symmetric window is
 * unavailable exactly on the ring where crack-freedom is decided. What
 * point-sampling costs is peak fidelity: a lone summit between two
 * retained vertices is dropped rather than averaged in. That is
 * acceptable HERE because the widget only coarsens tiers that exist to be
 * glimpsed (see `widget.ts`'s `reliefFractionForLevel`), and because it
 * is the same thing a coarser pyramid level already is.
 */
export function glyphMapPolygons(tile: GlyphMapGeoTile, projection: GlyphMapProjection, opts: GlyphMapPolygonsOptions = {}): Polygon[] {
  const qCols = opts.resolution ? Math.min(tile.cols, Math.max(1, Math.round(opts.resolution.cols))) : tile.cols;
  const qRows = opts.resolution ? Math.min(tile.rows, Math.max(1, Math.round(opts.resolution.rows))) : tile.rows;
  const colAt = gridLineIndices(tile.cols, qCols);
  const rowAt = gridLineIndices(tile.rows, qRows);
  const cornerMean = opts.colorSample === "corner-mean";
  const bias = opts.elevationBias ?? 0;
  const windowMin = opts.minElevation ?? -Infinity;
  const windowMax = opts.maxElevation ?? Infinity;
  // One set of buffers for every quad's surface median, sized to the largest
  // block any quad can cover (a `gridLineIndices` step is at most
  // `ceil(total / count)` cells per axis) times its strips. Only the surface
  // path needs them, and only when a colour is actually being resolved.
  const intervals = opts.color && !cornerMean
    ? (Math.ceil(tile.cols / qCols) + 1) * (Math.ceil(tile.rows / qRows) + 1) * SURFACE_MEDIAN_STRIPS
    : 0;
  const stripLo = intervals > 0 ? new Float64Array(intervals) : null;
  const stripHi = intervals > 0 ? new Float64Array(intervals) : null;
  const stripEnds = intervals > 0 ? new Float64Array(intervals * 2) : null;
  const polygons: Polygon[] = [];
  for (let r = 0; r < qRows; r++) {
    const row = rowAt[r];
    const rowNext = rowAt[r + 1];
    for (let c = 0; c < qCols; c++) {
      const col = colAt[c];
      const colNext = colAt[c + 1];
      const nw = projectVertex(tile, projection, col, row, bias, windowMin, windowMax);
      const sw = projectVertex(tile, projection, col, rowNext, bias, windowMin, windowMax);
      const se = projectVertex(tile, projection, colNext, rowNext, bias, windowMin, windowMax);
      const ne = projectVertex(tile, projection, colNext, row, bias, windowMin, windowMax);
      if (!finite(nw.xyz) || !finite(sw.xyz) || !finite(se.xyz) || !finite(ne.xyz)) continue;
      const color = opts.color?.(
        stripLo === null || stripHi === null || stripEnds === null
          ? (nw.elev + sw.elev + se.elev + ne.elev) / 4
          : surfaceMedianElevation(tile, stripLo, stripHi, stripEnds, col, colNext, row, rowNext),
      );
      const up = localUpDirection(projection, nw.lon, nw.lat, nw.placedElev);
      const normal = cross(sub(sw.xyz, nw.xyz), sub(se.xyz, nw.xyz));
      const vertices: Vec3[] = up !== null && dot(normal, up) < 0
        ? [nw.xyz, ne.xyz, se.xyz, sw.xyz]
        : [nw.xyz, sw.xyz, se.xyz, ne.xyz];
      const polygon: Polygon = { vertices };
      if (color !== undefined) polygon.color = color;
      polygons.push(polygon);
    }
  }
  return polygons;
}
