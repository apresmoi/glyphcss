import type { GlyphMapAttribution, GlyphMapBounds } from "../types";
import type { GlyphMapProviderZoomLevel, GlyphMapTileRangeStrategy } from "../provider";

export type { GlyphMapAttribution } from "../types";

/**
 * A resolved vector feature — the shape every rendering path (`line` layers,
 * the bake pipeline's tile output) consumes, deliberately independent of
 * TopoJSON/arc topology: topology exists to keep SHARED boundaries
 * identical under simplification (MAPS.md §6), but nothing downstream of
 * `resolveGlyphMapTopology` (`vector/topology.ts`) needs to know arcs were
 * ever involved — it just walks rings.
 *
 * `rings` intentionally carries no elevation: borders/rivers/routes are
 * drawn at ground level (`elev: 0`) by every consumer — see `widget.ts`'s
 * line-layer runtime.
 */
export interface GlyphMapVectorFeature {
  readonly id?: string;
  readonly properties?: Readonly<Record<string, unknown>>;
  /** Geometry kind when the source format carries it (MVT does). Older baked sources may omit it. */
  readonly geometryType?: "point" | "line" | "polygon";
  /** One or more rings/lines. A polygon boundary is a CLOSED ring (first point repeats as last, matching GeoJSON); a route/river is an open line. */
  readonly rings: readonly (readonly (readonly [lon: number, lat: number])[])[];
  /** Polygon groups, each `[outer, ...holes]`; retained because flattening MVT rings loses hole ownership. */
  readonly polygons?: readonly (readonly (readonly (readonly [lon: number, lat: number])[])[])[];
}

export interface GlyphMapVectorFeatureCollection {
  readonly features: readonly GlyphMapVectorFeature[];
  readonly attribution?: readonly GlyphMapAttribution[];
}

/**
 * One quadtree z/x/y vector tile (MAPS.md §13 slice 5, coordinator scope
 * addition: "reuse the addressing scheme that already exists" —
 * `bake-globe.mjs`'s flatmap pyramid / `provider.ts`'s geo-tile provider are
 * both already a z/x/y quadtree doubling `cols`/`rows` per level; this reuses
 * that same address, not a second scheme). `features` are ALREADY clipped to
 * `bounds` and simplified at this level's resolution — see
 * `vector/tile.ts`'s bake-time builder for the "simplify globally per level,
 * THEN clip" ordering this depends on for cross-tile seam correctness.
 *
 * A clipped ring/line may be split into multiple open polylines by the tile
 * boundary — `line`-layer rendering treats every polyline uniformly (no
 * start/end "cap" glyph), so a cut end reads identically to a real one; see
 * `stroke.ts`'s doc for why that is what keeps a line crossing a tile seam
 * visually continuous.
 */
export interface GlyphMapVectorTile {
  readonly z: number;
  readonly x: number;
  readonly y: number;
  readonly bounds: GlyphMapBounds;
  readonly layers: Readonly<Record<string, readonly GlyphMapVectorFeature[]>>;
  readonly source: string;
  /** Recorded id of the simplification level baked into this tile (MAPS.md §10) — e.g. `"vw-z2"`. */
  readonly simplify: string;
  readonly attribution?: readonly GlyphMapAttribution[];
}

/**
 * A vector tile pyramid — deliberately THE SAME zoom-level record shape as
 * {@link GlyphMapProviderZoomLevel} (raster), reusing `glyphMapDegreesPerCell`
 * /`glyphMapTargetLOD` (`provider.ts`) UNCHANGED for LOD selection (the
 * coordinator's "share an interface, don't grow a second LOD machinery").
 * `tileCols`/`tileRows` have no quad-grid meaning for vector data — by
 * convention here they encode the level's NATIVE SOURCE resolution as an
 * equivalent quad count (`tileLonSpan / nativeResolutionDeg`), which is
 * exactly what `glyphMapTargetLOD`'s `nativeDegPerCell = tileLonSpan /
 * tileCols` formula needs to keep working unmodified.
 */
export interface GlyphMapVectorProvider {
  readonly id: string;
  readonly zooms: readonly GlyphMapProviderZoomLevel[];
  readonly attribution?: readonly GlyphMapAttribution[];
  bounds(z: number, x: number, y: number): GlyphMapBounds;
  loadTile(z: number, x: number, y: number): Promise<GlyphMapVectorTile>;
  /**
   * OPTIONAL: how this pyramid is ADDRESSED — the view's geographic window
   * turned into a tile-index box. Absent = this package's own EQUAL-ANGLE
   * addressing (`glyphMapEqualAngleTileRange`), which every baked pyramid
   * here uses and which stays byte-identical for them.
   *
   * A hosted OSM pyramid (OpenFreeMap, any PMTiles archive, anything
   * Planetiler or Tippecanoe cut) is WEB MERCATOR and declares
   * `glyphMapMercatorTileRange` instead. The two indexers disagree in `y` by
   * hundreds of rows at any real zoom, so without this a sweep requests
   * tiles the service does not hold and never requests the ones it does —
   * see `vector/mercator.ts`'s header, and `vector/protomaps.test.ts` for
   * the measurement that pinned it.
   *
   * `createGlyphMap` keys on the PRESENCE of this capability, never on a
   * provider id, the same rule projections follow.
   */
  readonly tileRange?: GlyphMapTileRangeStrategy;
}

export type GlyphMapVectorSource = GlyphMapVectorFeatureCollection | GlyphMapVectorProvider;
