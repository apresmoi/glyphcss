import { VectorTile } from "@mapbox/vector-tile";
import { PbfReader } from "pbf";
import { PMTiles, type Source } from "pmtiles";
import type { GlyphMapAttribution } from "../types";
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

interface PMTilesReader {
  getHeader(): Promise<{ minZoom: number; maxZoom: number }>;
  getZxy(z: number, x: number, y: number): Promise<{ data: ArrayBuffer } | undefined>;
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
      const geo = raw.toGeoJSON(x, y, z);
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

/** Adapt a local/static PMTiles archive (URL, File-backed Source, or injected reader) to the existing vector-provider contract. */
export async function glyphMapPMTilesProvider(source: string | Source | PMTilesReader, opts: GlyphMapPMTilesOptions = {}): Promise<GlyphMapVectorProvider> {
  const archive: PMTilesReader = typeof source === "string" || "getBytes" in source ? new PMTiles(source as string | Source) : source;
  const header = await archive.getHeader();
  const tileResolution = opts.tileResolution ?? 4096;
  const zooms: GlyphMapProviderZoomLevel[] = [];
  for (let z = header.minZoom; z <= header.maxZoom; z++) {
    const n = 2 ** z;
    zooms.push({ z, cols: n, rows: n, tileLonSpan: 360 / n, tileLatSpan: 170.10225756 / n, tileCols: tileResolution, tileRows: tileResolution });
  }
  const attribution = opts.attribution ?? GLYPH_MAP_PROTOMAPS_ATTRIBUTION;
  return {
    id: opts.id ?? "protomaps-pmtiles",
    zooms,
    attribution,
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
