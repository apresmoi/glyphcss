/**
 * Vector tile bake/decode — the quadtree z/x/y addressing (coordinator
 * scope addition: "reuse the addressing scheme that already exists...
 * `bake-geo-tiles.mjs`'s pyramid... a vector tile should be the same z/x/y
 * address, so one visible-set computation serves both providers"). This
 * uses the EXACT SAME formula `website/src/lib/geoTilesProvider.ts`'s
 * `tileBounds` and `bake-geo-tiles.mjs` already use for the raster pyramid
 * — an equal-angle lon/lat quadtree doubling `cols`/`rows` per level (NOT a
 * Web-Mercator-square scheme; that would be a SECOND addressing convention
 * this package's existing raster pyramid doesn't use) — so a vector
 * provider's `zooms`/`bounds(z,x,y)` are directly comparable to a raster
 * provider's, and `createGlyphMap`'s single culling/LOD codepath (`provider.
 * ts`'s `glyphMapTargetLOD`/`glyphMapDegreesPerCell`) works unmodified for
 * both (see `vector/types.ts`'s `GlyphMapVectorProvider` doc).
 *
 * **Bake ORDER is load-bearing** (the coordinator's explicit correctness
 * trap): `glyphMapBuildVectorTile` takes ALREADY-simplified features (run
 * `glyphMapSimplifyArcs` over the WHOLE level's topology first — see
 * `vector/simplify.ts` — then resolve rings, THEN call this per tile). If a
 * tile clipped its own unsimplified geometry and simplified AFTER cutting,
 * two tiles sharing an edge would simplify their shared boundary
 * differently (the same class of defect as simplifying two countries'
 * shared border independently, one level up) — this module has no
 * simplification code of its own specifically so that mistake can't be made
 * by accident here.
 */
import type { GlyphMapBounds } from "../types";
import { glyphMapClipPolygonGroup, glyphMapClipPolyline, glyphMapSplitAtAntimeridian } from "./clip";
import {
  GLYPH_MAP_VECTOR_TILE_EXTENT,
  glyphMapDecodeQuantizedLine,
  glyphMapEncodeQuantizedLine,
} from "./quantize";
import type { GlyphMapLonLat } from "./simplify";
import type { GlyphMapAttribution, GlyphMapVectorFeature, GlyphMapVectorTile } from "./types";

/** Same formula as `website/src/lib/geoTilesProvider.ts`'s `tileBounds` / `bake-geo-tiles.mjs` — see this file's doc. */
export function glyphMapVectorTileBounds(z: number, x: number, y: number): GlyphMapBounds {
  const n = 2 ** z;
  const tileLonSpan = 360 / n;
  const tileLatSpan = 180 / n;
  const lonMin = -180 + x * tileLonSpan;
  const latMax = 90 - y * tileLatSpan;
  return { west: lonMin, east: lonMin + tileLonSpan, south: latMax - tileLatSpan, north: latMax };
}

/** A ring is treated as CLOSED (a polygon boundary) when its first and last points coincide exactly — the standard GeoJSON/TopoJSON convention, and exact because `glyphMapSimplifyArc` never moves an arc endpoint (MAPS.md §6). Anything else (a river, a route) is an open line. */
function isClosedRing(ring: readonly GlyphMapLonLat[]): boolean {
  if (ring.length < 3) return false;
  const a = ring[0];
  const b = ring[ring.length - 1];
  return a[0] === b[0] && a[1] === b[1];
}

/**
 * A POINT is clipped by CONTAINMENT, never by {@link glyphMapClipPolyline}:
 * Liang-Barsky clips SEGMENTS, and a one-point ring has none, so
 * `glyphMapClipPolyline` correctly returns nothing for it. Without this
 * branch every point feature was silently dropped from every baked tile —
 * which is what left `symbol`/`circle`/`heatmap` (the three point-driven
 * layer types) with no tiled data source at all, however good the source
 * data was.
 *
 * The test is HALF-OPEN on east/south, the same convention `sample.ts`'s
 * cell footprint uses, so a place sitting exactly on a shared tile edge
 * belongs to exactly ONE tile rather than being mounted twice as two
 * overlapping hotspots. The world's own outer edges (`east >= 180`,
 * `south <= -90`) are closed instead, since there is no neighbouring tile
 * there to own the point.
 */
function pointInTile(point: GlyphMapLonLat, bounds: GlyphMapBounds): boolean {
  const [lon, lat] = point;
  const inLon = lon >= bounds.west && (lon < bounds.east || bounds.east >= 180);
  const inLat = lat <= bounds.north && (lat > bounds.south || bounds.south <= -90);
  return inLon && inLat;
}

/** The wire-format record for one feature inside one baked tile layer — quantized, delta-encoded lines only; never floats. */
export interface GlyphMapVectorWireFeature {
  readonly id?: string;
  readonly properties?: Readonly<Record<string, unknown>>;
  /**
   * Carried through the wire format so a decoded feature stays
   * self-describing — a POINT tile is otherwise only distinguishable from a
   * degenerate line by every one of its `lines` having a single vertex,
   * which is exactly the fallback `widget.ts`'s point runtime had to use.
   * Optional and omitted when the source feature declares none, so tiles
   * baked before this field existed decode identically.
   */
  readonly geometryType?: "point" | "line" | "polygon";
  readonly lines: readonly (readonly number[])[];
  /**
   * AREA geometry — polygon groups (`[outer, ...holes]`) clipped to this
   * tile as CLOSED rings, alongside (never instead of) `lines`.
   *
   * The two are genuinely different cuts of the same source ring and a fill
   * cannot read the line one: `lines` carries the OPEN fragments a `line`
   * layer needs, where a cut end must be indistinguishable from an interior
   * point, while a fill needs the ring re-closed along the tile's own
   * boundary (see `glyphMapClipPolygonGroup`). Handing the open fragments to
   * earcut fills "fragment plus straight chord" instead of "country
   * intersect tile", which is what left large multi-tile countries with big
   * unpainted holes.
   *
   * Absent for a feature with no polygon geometry (a river, a route, a
   * place point) and for a tile a polygon feature only grazes with a
   * degenerate sliver — so a line-only pyramid bakes exactly the bytes it
   * always did.
   */
  readonly polygons?: readonly (readonly (readonly number[])[])[];
}

export interface GlyphMapVectorWireTile {
  readonly z: number;
  readonly x: number;
  readonly y: number;
  readonly bounds: GlyphMapBounds;
  readonly extent: number;
  readonly source: string;
  readonly simplify: string;
  readonly attribution?: readonly GlyphMapAttribution[];
  readonly layers: Readonly<Record<string, readonly GlyphMapVectorWireFeature[]>>;
}

/**
 * Clip + quantize already-simplified `layers` (feature lists keyed by layer
 * name, e.g. `"admin0"`) into one tile's wire record. A feature with zero
 * surviving fragments after clipping (it doesn't touch this tile at all) is
 * dropped from the tile entirely — not emitted as an empty entry.
 *
 * A ring of exactly ONE point is a point geometry and takes
 * {@link pointInTile}'s containment test instead of the segment clipper —
 * see its doc.
 */
export function glyphMapBuildVectorTile(
  layers: Readonly<Record<string, readonly GlyphMapVectorFeature[]>>,
  z: number,
  x: number,
  y: number,
  opts: { readonly source: string; readonly simplify: string; readonly attribution?: readonly GlyphMapAttribution[]; readonly extent?: number },
): GlyphMapVectorWireTile {
  const bounds = glyphMapVectorTileBounds(z, x, y);
  const extent = opts.extent ?? GLYPH_MAP_VECTOR_TILE_EXTENT;
  const outLayers: Record<string, GlyphMapVectorWireFeature[]> = {};
  for (const [layerName, features] of Object.entries(layers)) {
    const outFeatures: GlyphMapVectorWireFeature[] = [];
    for (const feature of features) {
      const lines: number[][] = [];
      for (const ring of feature.rings) {
        if (ring.length === 1) {
          if (pointInTile(ring[0], bounds)) lines.push(glyphMapEncodeQuantizedLine(ring, bounds, extent));
          continue;
        }
        // Antimeridian FIRST, box second — see `glyphMapSplitAtAntimeridian`.
        // A ±180-spanning source ring read as a planar segment clips to one
        // full-width chord in EVERY tile at its latitude; once the seam
        // jump is cut out, each surviving run is ordinary planar geometry
        // and the box clip is unchanged. A ring with no wrap comes back by
        // identity (`part === ring`), so its `closed` handling and its
        // baked bytes are exactly what they were.
        const closed = isClosedRing(ring);
        for (const part of glyphMapSplitAtAntimeridian(ring, closed)) {
          for (const frag of glyphMapClipPolyline(part, bounds, closed && part === ring)) {
            lines.push(glyphMapEncodeQuantizedLine(frag, bounds, extent));
          }
        }
      }
      // AREA geometry takes its own clip — see `GlyphMapVectorWireFeature.
      // polygons`. A feature that declares no `polygons` groups (every line
      // source, and any polygon source that lost its hole grouping upstream)
      // bakes exactly as before.
      const polygons: number[][][] = [];
      for (const group of feature.polygons ?? []) {
        for (const clipped of glyphMapClipPolygonGroup(group, bounds)) {
          polygons.push(clipped.map((ring) => glyphMapEncodeQuantizedLine(ring, bounds, extent)));
        }
      }
      // A tile a polygon SWALLOWS carries no piece of its outline at all, so
      // `lines` is empty there and the feature used to be dropped — which is
      // precisely the interior of a large country going unpainted.
      if (lines.length > 0 || polygons.length > 0) {
        outFeatures.push({
          id: feature.id,
          properties: feature.properties,
          geometryType: feature.geometryType,
          lines,
          ...(polygons.length > 0 ? { polygons } : {}),
        });
      }
    }
    if (outFeatures.length > 0) outLayers[layerName] = outFeatures;
  }
  return { z, x, y, bounds, extent, source: opts.source, simplify: opts.simplify, attribution: opts.attribution, layers: outLayers };
}

/** Dequantize a wire tile back into the public runtime shape a `line` layer consumes. */
export function glyphMapDecodeVectorTile(wire: GlyphMapVectorWireTile): GlyphMapVectorTile {
  const layers: Record<string, GlyphMapVectorFeature[]> = {};
  for (const [layerName, features] of Object.entries(wire.layers)) {
    layers[layerName] = features.map((f) => ({
      id: f.id,
      properties: f.properties,
      geometryType: f.geometryType,
      rings: f.lines.map((line) => glyphMapDecodeQuantizedLine(line, wire.bounds, wire.extent)),
      polygons: f.polygons?.map((group) => group.map((ring) => glyphMapDecodeQuantizedLine(ring, wire.bounds, wire.extent))),
    }));
  }
  return {
    z: wire.z,
    x: wire.x,
    y: wire.y,
    bounds: wire.bounds,
    layers,
    source: wire.source,
    simplify: wire.simplify,
    attribution: wire.attribution,
  };
}
