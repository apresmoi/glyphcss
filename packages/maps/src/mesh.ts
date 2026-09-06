import type { Polygon, Vec3 } from "glyphcss";
import type { GlyphMapProjection } from "./projection";
import type { GlyphMapGeoTile } from "./tile";
import { glyphMapGeoTileVertexLonLat } from "./tile";

export interface GlyphMapPolygonsOptions {
  /** Per-quad color from the quad's representative elevation (see {@link GlyphMapPolygonsOptions.colorSample}). Omit for uncolored polygons (glyphcss's default gray). `undefined` from this callback also leaves a quad uncolored. */
  readonly color?: (elev: number) => string | undefined;
  /**
   * Which elevation `color` is handed for a quad. Default `"median"`.
   *
   * - `"median"` — the median of the baked vertices the quad actually
   *   COVERS (the block `[col..colNext] x [row..rowNext]` of the tile's own
   *   full-resolution grid, whatever mesh `resolution` is in play).
   * - `"corner-mean"` — the mean of the quad's own 4 drawn corners, i.e.
   *   the height of the drawn surface at the quad's centre.
   *
   * `"median"` is the default because a mean crosses classifier boundaries
   * the terrain never does. A quad straddling a coastline averages deep
   * ocean with high land and lands BELOW sea level, so an elevation-band
   * classifier paints it as water even when almost all of it is land —
   * measured on the real ETOPO1 pyramid, the floor tier's quad covering
   * Bogota averaged -155 m across its corners over terrain that is 379 of
   * 441 samples above sea level (median +194 m), and Quito's averaged
   * -718 m. The deeper the adjacent ocean the further inland it reaches,
   * which is why the Peru-Chile trench beside the Andes is the worst case.
   *
   * The median cannot do that, and not merely usually: if strictly more
   * than half a quad's covered samples are at or above sea level then more
   * than half the sorted samples are, so the sample at index `n >> 1` is
   * too. A majority-land quad therefore can NEVER be classified below sea
   * level, at any mesh resolution — the property `mesh.seaLevelBand.test.ts`
   * pins. Point-sampling the quad centre was measured as an alternative and
   * is WORSE than the mean (it drops into a river, lake or inlet: 268
   * majority-land quads misclassified across an Andes window at full
   * resolution, against the mean's 65 and the median's 0).
   *
   * `"corner-mean"` exists for a caller that needs the DRAWN surface's own
   * centre height rather than the terrain's: `widget.ts`'s `heatmap` layer
   * keys a `Map` on this exact value to recover the per-quad density behind
   * a combined terrain+relief elevation, which needs a statistic that mixes
   * all four corners (a median IS one of the corner values, and adjacent
   * quads share corners, so it collides).
   */
  readonly colorSample?: "median" | "corner-mean";
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
 * The median of the tile's baked elevations over the vertex block a quad
 * covers, inclusive of both edges — see
 * {@link GlyphMapPolygonsOptions.colorSample} for why a quad's colour reads
 * this rather than its 4 corners' mean.
 *
 * `scratch` is the caller's reusable buffer (one allocation per
 * `glyphMapPolygons` call, not one per quad). Non-finite samples are left
 * out; the quad's own 4 corners are already known finite by the time this
 * runs (a non-finite corner skips the quad entirely), so the collected set
 * is never empty.
 */
function blockMedianElevation(
  tile: GlyphMapGeoTile,
  scratch: Float64Array,
  col: number,
  colNext: number,
  row: number,
  rowNext: number,
): number {
  const stride = tile.cols + 1;
  let n = 0;
  for (let r = row; r <= rowNext; r++) {
    const base = r * stride;
    for (let c = col; c <= colNext; c++) {
      const v = tile.elevation[base + c]!;
      if (Number.isFinite(v)) scratch[n++] = v;
    }
  }
  const values = scratch.subarray(0, n);
  values.sort();
  return values[n >> 1]!;
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

function projectVertex(tile: GlyphMapGeoTile, projection: GlyphMapProjection, col: number, row: number, bias: number): ProjectedVertex {
  const [lon, lat] = glyphMapGeoTileVertexLonLat(tile, col, row);
  const elev = tile.elevation[row * (tile.cols + 1) + col];
  const placedElev = elev + bias;
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
  // One buffer for every quad's median, sized to the largest block any quad
  // can cover (a `gridLineIndices` step is at most `ceil(total / count)`,
  // plus the shared vertex line on each axis). Only the median path needs
  // it, and only when a colour is actually being resolved.
  const scratch = opts.color && !cornerMean
    ? new Float64Array((Math.ceil(tile.cols / qCols) + 2) * (Math.ceil(tile.rows / qRows) + 2))
    : null;
  const polygons: Polygon[] = [];
  for (let r = 0; r < qRows; r++) {
    const row = rowAt[r];
    const rowNext = rowAt[r + 1];
    for (let c = 0; c < qCols; c++) {
      const col = colAt[c];
      const colNext = colAt[c + 1];
      const nw = projectVertex(tile, projection, col, row, bias);
      const sw = projectVertex(tile, projection, col, rowNext, bias);
      const se = projectVertex(tile, projection, colNext, rowNext, bias);
      const ne = projectVertex(tile, projection, colNext, row, bias);
      if (!finite(nw.xyz) || !finite(sw.xyz) || !finite(se.xyz) || !finite(ne.xyz)) continue;
      const color = opts.color?.(
        scratch === null
          ? (nw.elev + sw.elev + se.elev + ne.elev) / 4
          : blockMedianElevation(tile, scratch, col, colNext, row, rowNext),
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
