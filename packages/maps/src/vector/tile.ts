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
import { glyphMapClipPolyline } from "./clip";
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

/** The wire-format record for one feature inside one baked tile layer — quantized, delta-encoded lines only; never floats. */
export interface GlyphMapVectorWireFeature {
  readonly id?: string;
  readonly properties?: Readonly<Record<string, unknown>>;
  readonly lines: readonly (readonly number[])[];
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
        for (const frag of glyphMapClipPolyline(ring, bounds, isClosedRing(ring))) {
          lines.push(glyphMapEncodeQuantizedLine(frag, bounds, extent));
        }
      }
      if (lines.length > 0) outFeatures.push({ id: feature.id, properties: feature.properties, lines });
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
      rings: f.lines.map((line) => glyphMapDecodeQuantizedLine(line, wire.bounds, wire.extent)),
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
