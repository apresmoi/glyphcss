import { VectorTile } from "@mapbox/vector-tile";
import { PbfReader } from "pbf";
import { PMTiles, type Source } from "pmtiles";
import type { GlyphMapAttribution, GlyphMapBounds } from "../types";
import { GLYPH_MAP_PROTOMAPS_ATTRIBUTION } from "../attribution";
import type { GlyphMapProviderZoomLevel } from "../provider";
import type { GlyphMapVectorFeature, GlyphMapVectorProvider, GlyphMapVectorTile } from "./types";

export interface GlyphMapPMTilesOptions {
  readonly id?: string;
  readonly layers?: readonly string[];
  readonly attribution?: readonly GlyphMapAttribution[];
  /** Native vector extent represented as equivalent cells for widget LOD selection. Default 4096. */
  readonly tileResolution?: number;
}

/**
 * The slice of `PMTiles` this package actually uses. Declared structurally so
 * a test (or a caller with its own cache/transport) can inject a stand-in
 * without constructing a real archive.
 *
 * `getHeader` returns the PMTiles v3 header's own declared EXTENT alongside
 * the zoom range. A `.pmtiles` file is very often a regional extract rather
 * than a world pyramid — the vendored Zurich fixture covers ~4 km at one
 * zoom — and that box is the only honest answer to "where does this archive
 * have data", so it is read from the archive instead of being configured by
 * a caller who would have to keep it in sync by hand.
 */
export interface GlyphMapPMTilesReader {
  getHeader(): Promise<{
    minZoom: number;
    maxZoom: number;
    minLon?: number;
    minLat?: number;
    maxLon?: number;
    maxLat?: number;
  }>;
  getZxy(z: number, x: number, y: number): Promise<{ data: ArrayBuffer } | undefined>;
}

/**
 * A pmtiles `Source` over bytes ALREADY in memory — the shipped path for a
 * small vendored archive, and the one this package's tests use.
 *
 * `new PMTiles(url)` reads an archive by HTTP RANGE request, which is the
 * right transport for a large hosted pyramid and the wrong one for a 150 KB
 * extract that is smaller than the round-trips it would take to page in:
 * range requests also need the host to honour them, which a bundler dev
 * server or a `file://` page may not. Reading the whole archive once and
 * serving `getBytes` out of the buffer removes both concerns, and is exactly
 * what {@link glyphMapProtomapsExtract} does on the website.
 */
export function glyphMapPMTilesBufferSource(bytes: ArrayBuffer | Uint8Array, key = "pmtiles:buffer"): Source {
  const buffer = bytes instanceof Uint8Array
    ? bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
    : bytes;
  return {
    getKey: () => key,
    getBytes: async (offset: number, length: number) => ({ data: buffer.slice(offset, offset + length) }),
  };
}

function tileBounds(z: number, x: number, y: number) {
  const n = 2 ** z;
  const west = x / n * 360 - 180;
  const east = (x + 1) / n * 360 - 180;
  const north = Math.atan(Math.sinh(Math.PI * (1 - 2 * y / n))) * 180 / Math.PI;
  const south = Math.atan(Math.sinh(Math.PI * (1 - 2 * (y + 1) / n))) * 180 / Math.PI;
  return { west, east, south, north };
}

function coordsOfGeometry(geometry: GeoJSON.Geometry): { rings: [number, number][][]; polygons?: [number, number][][][] } {
  switch (geometry.type) {
    case "Point": return { rings: [[geometry.coordinates as [number, number]]] };
    case "MultiPoint": return { rings: (geometry.coordinates as [number, number][]).map((p) => [p]) };
    case "LineString": return { rings: [geometry.coordinates as [number, number][]] };
    case "MultiLineString": return { rings: geometry.coordinates as [number, number][][] };
    case "Polygon": {
      const polygon = geometry.coordinates as [number, number][][];
      return { rings: polygon, polygons: [polygon] };
    }
    case "MultiPolygon": {
      const polygons = geometry.coordinates as [number, number][][][];
      return { rings: polygons.flat(), polygons };
    }
    default: return { rings: [] };
  }
}

/** Decode one MVT payload through the maintained Mapbox decoder, retaining layer names, attributes, and polygon hole groups. */
export function glyphMapDecodeMVT(data: ArrayBuffer | Uint8Array, z: number, x: number, y: number, selectedLayers?: readonly string[]): Readonly<Record<string, readonly GlyphMapVectorFeature[]>> {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  const tile = new VectorTile(new PbfReader(bytes));
  const selected = selectedLayers ? new Set(selectedLayers) : null;
  const out: Record<string, GlyphMapVectorFeature[]> = {};
  for (const [name, layer] of Object.entries(tile.layers)) {
    if (selected && !selected.has(name)) continue;
    const features: GlyphMapVectorFeature[] = [];
    for (let i = 0; i < layer.length; i++) {
      const raw = layer.feature(i);
      let geo: GeoJSON.Feature;
      try {
        geo = raw.toGeoJSON(x, y, z);
      } catch {
        continue;
      }
      const converted = coordsOfGeometry(geo.geometry);
      features.push({
        id: raw.id === undefined ? undefined : String(raw.id),
        properties: raw.properties,
        geometryType: raw.type === 1 ? "point" : raw.type === 2 ? "line" : raw.type === 3 ? "polygon" : undefined,
        rings: converted.rings,
        polygons: converted.polygons,
      });
    }
    out[name] = features;
  }
  return out;
}

/**
 * A {@link GlyphMapVectorProvider} over one PMTiles archive, plus the
 * archive's own declared {@link GlyphMapPMTilesProvider.extent}.
 *
 * NOTE the addressing: `z/x/y` here is WEB MERCATOR, as PMTiles is — NOT the
 * equal-angle quadtree the rest of this package's pyramids (and therefore
 * `createGlyphMap`'s tile sweep) use. The two disagree in `y` at any
 * meaningful zoom. Read an archive through {@link
 * import("./protomaps").glyphMapProtomapsExtract} to mount it on a widget;
 * this provider is the raw archive reader beneath it.
 */
export interface GlyphMapPMTilesProvider extends GlyphMapVectorProvider {
  /** The header's own bbox — where this archive has data — or `null` if it declares none. */
  readonly extent: GlyphMapBounds | null;
}

/** Adapt a local/static PMTiles archive (URL, File-backed Source, or injected reader) to the existing vector-provider contract. */
export async function glyphMapPMTilesProvider(source: string | Source | GlyphMapPMTilesReader, opts: GlyphMapPMTilesOptions = {}): Promise<GlyphMapPMTilesProvider> {
  const archive: GlyphMapPMTilesReader = typeof source === "string" || "getBytes" in source ? new PMTiles(source as string | Source) : source;
  const header = await archive.getHeader();
  const tileResolution = opts.tileResolution ?? 4096;
  const zooms: GlyphMapProviderZoomLevel[] = [];
  for (let z = header.minZoom; z <= header.maxZoom; z++) {
    const n = 2 ** z;
    zooms.push({ z, cols: n, rows: n, tileLonSpan: 360 / n, tileLatSpan: 170.10225756 / n, tileCols: tileResolution, tileRows: tileResolution });
  }
  const attribution = opts.attribution ?? GLYPH_MAP_PROTOMAPS_ATTRIBUTION;
  const { minLon, minLat, maxLon, maxLat } = header;
  const extent = [minLon, minLat, maxLon, maxLat].every((v) => typeof v === "number" && Number.isFinite(v))
    && (minLon as number) < (maxLon as number) && (minLat as number) < (maxLat as number)
    ? { west: minLon as number, south: minLat as number, east: maxLon as number, north: maxLat as number }
    : null;
  return {
    id: opts.id ?? "protomaps-pmtiles",
    zooms,
    attribution,
    extent,
    bounds: tileBounds,
    async loadTile(z, x, y): Promise<GlyphMapVectorTile> {
      const response = await archive.getZxy(z, x, y);
      return {
        z, x, y, bounds: tileBounds(z, x, y), source: opts.id ?? "protomaps-pmtiles", simplify: "mvt-source",
        attribution,
        layers: response ? glyphMapDecodeMVT(response.data, z, x, y, opts.layers) : {},
      };
    },
  };
}
