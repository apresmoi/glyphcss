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
}

function projectVertex(tile: GlyphMapGeoTile, projection: GlyphMapProjection, col: number, row: number): ProjectedVertex {
  const [lon, lat] = glyphMapGeoTileVertexLonLat(tile, col, row);
  const elev = tile.elevation[row * (tile.cols + 1) + col];
  return { xyz: projection.project(lon, lat, elev), elev };
}

function finite(v: Vec3): boolean {
  return Number.isFinite(v[0]) && Number.isFinite(v[1]) && Number.isFinite(v[2]);
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
 * Winding is `[nw, sw, se, ne]` (col0/row0, col0/row+1, col+1/row+1,
 * col+1/row0) for CCW-from-outside (`Polygon.vertices`'s contract) under
 * THIS package's chirality-correct globe frame ({@link glyphMapGlobe}'s doc
 * comment) — the mirror image of `website/scripts/bake-globe.mjs`'s own
 * `[a, b, c, d]` order, which is only outward-facing under ITS mirrored
 * `Y`-negated convention. Verified computationally (not asserted): the two
 * conventions' winding is each other's reverse for the same tile.
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
      const polygon: Polygon = { vertices: [nw.xyz, sw.xyz, se.xyz, ne.xyz] };
      if (color !== undefined) polygon.color = color;
      polygons.push(polygon);
    }
  }
  return polygons;
}
