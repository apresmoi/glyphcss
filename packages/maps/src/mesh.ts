import type { Polygon, Vec3 } from "glyphcss";
import type { GlyphMapProjection } from "./projection";
import type { GlyphMapGeoTile } from "./tile";
import { glyphMapGeoTileVertexLonLat } from "./tile";

export interface GlyphMapPolygonsOptions {
  /** Per-quad color from its 4 corners' average elevation. Omit for uncolored polygons (glyphcss's default gray). `undefined` from this callback also leaves a quad uncolored. */
  readonly color?: (elev: number) => string | undefined;
}

interface ProjectedVertex {
  readonly xyz: Vec3;
  readonly elev: number;
  readonly lon: number;
  readonly lat: number;
}

function projectVertex(tile: GlyphMapGeoTile, projection: GlyphMapProjection, col: number, row: number): ProjectedVertex {
  const [lon, lat] = glyphMapGeoTileVertexLonLat(tile, col, row);
  const elev = tile.elevation[row * (tile.cols + 1) + col];
  return { xyz: projection.project(lon, lat, elev), elev, lon, lat };
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
 */
function localUpDirection(projection: GlyphMapProjection, lon: number, lat: number, elev: number): Vec3 | null {
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
 */
export function glyphMapPolygons(tile: GlyphMapGeoTile, projection: GlyphMapProjection, opts: GlyphMapPolygonsOptions = {}): Polygon[] {
  const polygons: Polygon[] = [];
  for (let row = 0; row < tile.rows; row++) {
    for (let col = 0; col < tile.cols; col++) {
      const nw = projectVertex(tile, projection, col, row);
      const sw = projectVertex(tile, projection, col, row + 1);
      const se = projectVertex(tile, projection, col + 1, row + 1);
      const ne = projectVertex(tile, projection, col + 1, row);
      if (!finite(nw.xyz) || !finite(sw.xyz) || !finite(se.xyz) || !finite(ne.xyz)) continue;
      const elevCenter = (nw.elev + sw.elev + se.elev + ne.elev) / 4;
      const color = opts.color?.(elevCenter);
      const up = localUpDirection(projection, nw.lon, nw.lat, nw.elev);
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
