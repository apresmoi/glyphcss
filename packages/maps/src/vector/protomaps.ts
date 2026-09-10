/**
 * The Protomaps basemap schema → this package's layer vocabulary.
 *
 * `pmtiles.ts` reads an archive; it does not know what is IN one. A Protomaps
 * basemap tile (planetiler build, OpenStreetMap data, ODbL) carries nine
 * source layers, and none of them is a map layer on its own: `roads` holds
 * motorways, footpaths and railways together, discriminated by a `kind`
 * property; `water` holds rivers as LINES and lakes as POLYGONS in the same
 * layer. Mounting "roads" undifferentiated draws a motorway and a garden path
 * with the same stroke, which is not a map. So the mapping here is
 * `(source layer, kind, geometry) → glyph layer type`, and the discriminators
 * are exposed rather than baked in.
 *
 * **Every name in this file was read out of an archive, not out of the
 * published schema docs** — `fixtures/pmtiles/zurich-z12.pmtiles`'s own
 * `vector_layers` metadata and its two decoded tiles. `protomaps.test.ts`
 * re-derives them from that fixture on every run, so a schema drift shows up
 * as a red test rather than as an empty layer.
 *
 * **Why an EXTRACT (feature collections) rather than a mounted tile
 * provider.** PMTiles is Web Mercator addressed. Every tile pyramid in this
 * package — and therefore `createGlyphMap`'s tile sweep, which runs through
 * `glyphMapTileRangeForLevel` — is equal-angle addressed (AGENTS.md,
 * "Tiles"). At z12 the Zurich extract lives at Mercator `y = 1434` and at
 * equal-angle `y = 1025`; a sweep would enumerate tiles the archive does not
 * hold and never request the two it does. That is asserted in
 * `protomaps.test.ts`. Retiling Mercator onto the equal-angle grid is real
 * machinery with no data to justify it here: an extract is a handful of tiles
 * at ONE zoom, so there is no LOD ladder to select across and nothing for a
 * provider to add. {@link glyphMapProtomapsExtract} therefore reads the
 * archive's tiles once, up front, into one {@link
 * GlyphMapVectorFeatureCollection} per source layer, and the layer's own
 * `filter` does the rest.
 */
import type { Source } from "pmtiles";
import type { GlyphMapAttribution, GlyphMapBounds } from "../types";
import { GLYPH_MAP_PROTOMAPS_ATTRIBUTION } from "../attribution";
import { glyphMapPMTilesProvider, type GlyphMapPMTilesReader } from "./pmtiles";
import type { GlyphMapVectorFeature, GlyphMapVectorFeatureCollection } from "./types";
import type {
  GlyphMapCircleLayer,
  GlyphMapFeatureFilter,
  GlyphMapFillExtrusionLayer,
  GlyphMapFillLayer,
  GlyphMapLineLayer,
  GlyphMapSymbolLayer,
} from "../widget";

/**
 * The Protomaps basemap's own source-layer ids, exactly as the archive's
 * `vector_layers` metadata declares them. `landcover` is in the schema but
 * caps at zoom 7, so a city extract legitimately has none — presence in this
 * list is not presence in an extract.
 */
export const GLYPH_MAP_PROTOMAPS_SOURCE_LAYERS = [
  "boundaries",
  "buildings",
  "earth",
  "landcover",
  "landuse",
  "places",
  "pois",
  "roads",
  "water",
] as const;

export type GlyphMapProtomapsSourceLayer = (typeof GLYPH_MAP_PROTOMAPS_SOURCE_LAYERS)[number];

/**
 * The discriminator, read defensively across schema generations: the current
 * (planetiler) basemap writes a plain `kind`; archives cut against the older
 * v2 schema write `pmap:kind`. Both spellings mean the same thing and a
 * caller should never have to know which archive it was handed.
 */
export function glyphMapProtomapsKind(feature: GlyphMapVectorFeature): string | undefined {
  const props = feature.properties;
  if (!props) return undefined;
  const kind = props.kind ?? props["pmap:kind"];
  return typeof kind === "string" ? kind : undefined;
}

export interface GlyphMapProtomapsFeatureFilterOptions {
  /** Keep only these `kind` values. Omitted/empty = every kind. */
  readonly kinds?: readonly string[];
  /** Keep only this geometry. Omitted = every geometry — required to split `water` into rivers and lakes. */
  readonly geometry?: "point" | "line" | "polygon";
}

/** A {@link GlyphMapFeatureFilter} over the two Protomaps discriminators. Both axes omitted = keeps everything. */
export function glyphMapProtomapsFeatureFilter(opts: GlyphMapProtomapsFeatureFilterOptions): GlyphMapFeatureFilter {
  const kinds = opts.kinds && opts.kinds.length > 0 ? new Set(opts.kinds) : null;
  const geometry = opts.geometry;
  return (feature) => {
    if (geometry && feature.geometryType !== geometry) return false;
    if (kinds) {
      const kind = glyphMapProtomapsKind(feature);
      if (kind === undefined || !kinds.has(kind)) return false;
    }
    return true;
  };
}

/** One row of the schema mapping: which glyph layer type renders which slice of which Protomaps source layer. */
export interface GlyphMapProtomapsLayerSpec {
  readonly id: string;
  /** Human label for a UI rail. */
  readonly label: string;
  readonly type: "line" | "fill" | "fill-extrusion" | "symbol" | "circle";
  readonly sourceLayer: GlyphMapProtomapsSourceLayer;
  /** The geometry this row renders — the axis that separates `water`'s rivers from its lakes. */
  readonly geometry: "point" | "line" | "polygon";
  /** Default `kind` narrowing. Omitted = every kind in the source layer; a caller narrows further through {@link GlyphMapProtomapsLayersOptions.kinds}. */
  readonly kinds?: readonly string[];
  readonly color: string;
  /** `fill-extrusion` only — the metres column, `height` where OSM has it tagged. */
  readonly heightProperty?: string;
  /** `symbol` only. */
  readonly textProperty?: string;
  readonly priorityProperty?: string;
}

/**
 * The default mapping. `earth` and `landuse` are the ground, `water` the
 * areas and `waterway` the rivers/canals cut from the same source layer,
 * `roads` every road class at once (narrow it with `kinds`), `buildings` an
 * extrusion because the source layer carries a real `height`, `places` the
 * labels and `pois` the points.
 *
 * `landcover` has no row: it stops at zoom 7 and carries only a coarse
 * `kind`, so at any zoom a vector basemap is used at, `landuse` is the layer
 * that has the data.
 */
export const GLYPH_MAP_PROTOMAPS_LAYERS: readonly GlyphMapProtomapsLayerSpec[] = [
  { id: "osm-earth", label: "Earth", type: "fill", sourceLayer: "earth", geometry: "polygon", color: "#2b3140" },
  { id: "osm-landuse", label: "Land use", type: "fill", sourceLayer: "landuse", geometry: "polygon", color: "#3b5c43" },
  { id: "osm-water", label: "Water", type: "fill", sourceLayer: "water", geometry: "polygon", color: "#2c5c8f" },
  { id: "osm-waterway", label: "Waterways", type: "line", sourceLayer: "water", geometry: "line", color: "#5aa9e6" },
  { id: "osm-roads", label: "Roads", type: "line", sourceLayer: "roads", geometry: "line", color: "#e8c988" },
  {
    id: "osm-buildings", label: "Buildings", type: "fill-extrusion", sourceLayer: "buildings",
    geometry: "polygon", color: "#94a3b8", heightProperty: "height",
  },
  { id: "osm-boundaries", label: "Boundaries", type: "line", sourceLayer: "boundaries", geometry: "line", color: "#c084fc" },
  {
    id: "osm-places", label: "Places", type: "symbol", sourceLayer: "places",
    geometry: "point", color: "#ffffff", textProperty: "name", priorityProperty: "population",
  },
  { id: "osm-pois", label: "POIs", type: "circle", sourceLayer: "pois", geometry: "point", color: "#f59e0b" },
];

export interface GlyphMapProtomapsExtractOptions {
  /** Restrict decoding to these source layers. Omitted = every layer the archive carries. */
  readonly layers?: readonly string[];
  /** Which zoom to read. Omitted = the archive's own `maxZoom`, i.e. its finest data. */
  readonly zoom?: number;
  /** Override the credit. Omitted = {@link GLYPH_MAP_PROTOMAPS_ATTRIBUTION} — the ODbL OSM/Protomaps credit, which is a legal requirement, not a default. */
  readonly attribution?: readonly GlyphMapAttribution[];
  /**
   * Refuse to read more than this many tiles (default 64). This loader is for
   * an EXTRACT — a handful of tiles at one zoom, read once up front. Pointed
   * at a world pyramid it would try to pull every tile at `maxZoom` into
   * memory, so the ceiling throws with the count instead.
   */
  readonly maxTiles?: number;
}

/** A whole PMTiles extract, decoded once: what it covers, and its features grouped by source layer. */
export interface GlyphMapProtomapsExtract {
  /** The archive header's own declared extent. OUTSIDE THIS BOX THERE IS NO DATA — the one fact a UI has to present honestly. */
  readonly bounds: GlyphMapBounds;
  /** The zoom actually read. */
  readonly zoom: number;
  /** How many tiles the archive served for that box (a miss contributes nothing and is not an error). */
  readonly tileCount: number;
  /** One collection per source layer PRESENT — each already carrying `attribution`, which is what reaches `GlyphMapHandle.getAttributions()`. */
  readonly sources: Readonly<Record<string, GlyphMapVectorFeatureCollection>>;
  /** The sorted `kind` vocabulary each present source layer actually holds — read from the data, so a filter UI can never offer a kind that renders nothing. */
  readonly kinds: Readonly<Record<string, readonly string[]>>;
  readonly attribution: readonly GlyphMapAttribution[];
}

/** Web Mercator tile index of a lon/lat at zoom `z` — PMTiles' own addressing, not this package's equal-angle grid. */
function mercatorTile(lon: number, lat: number, z: number): { readonly x: number; readonly y: number } {
  const n = 2 ** z;
  const clampedLat = Math.max(-85.05112878, Math.min(85.05112878, lat));
  const rad = (clampedLat * Math.PI) / 180;
  return {
    x: Math.min(n - 1, Math.max(0, Math.floor(((lon + 180) / 360) * n))),
    y: Math.min(n - 1, Math.max(0, Math.floor(((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * n))),
  };
}

/**
 * Read a whole PMTiles extract into per-source-layer feature collections.
 *
 * `source` is anything {@link glyphMapPMTilesProvider} accepts: a URL string
 * (HTTP range requests — opt-in, and never pointed at someone else's bucket
 * by default), a pmtiles `Source` such as {@link
 * import("./pmtiles").glyphMapPMTilesBufferSource}, or an injected reader.
 */
export async function glyphMapProtomapsExtract(
  source: string | Source | GlyphMapPMTilesReader,
  opts: GlyphMapProtomapsExtractOptions = {},
): Promise<GlyphMapProtomapsExtract> {
  const attribution = opts.attribution ?? GLYPH_MAP_PROTOMAPS_ATTRIBUTION;
  const provider = await glyphMapPMTilesProvider(source, { layers: opts.layers, attribution });
  const bounds = provider.extent;
  if (!bounds) {
    throw new RangeError(
      "glyphcss/maps: glyphMapProtomapsExtract needs the archive's own bbox — this PMTiles header declares none.",
    );
  }
  const zooms = provider.zooms.map((z) => z.z);
  const zoom = opts.zoom ?? Math.max(...zooms);
  if (!zooms.includes(zoom)) {
    throw new RangeError(`glyphcss/maps: this PMTiles archive has no zoom ${zoom} (it serves ${zooms.join(", ")}).`);
  }

  const nw = mercatorTile(bounds.west, bounds.north, zoom);
  const se = mercatorTile(bounds.east, bounds.south, zoom);
  const wanted = (se.x - nw.x + 1) * (se.y - nw.y + 1);
  const maxTiles = opts.maxTiles ?? 64;
  if (wanted > maxTiles) {
    throw new RangeError(
      `glyphcss/maps: glyphMapProtomapsExtract reads a whole extract up front, and this archive's own bbox covers ${wanted} tiles at zoom ${zoom} (limit ${maxTiles}). Pass a shallower "zoom", or a larger "maxTiles" if you really mean to hold it all in memory.`,
    );
  }

  const grouped = new Map<string, GlyphMapVectorFeature[]>();
  let tileCount = 0;
  for (let y = nw.y; y <= se.y; y++) {
    for (let x = nw.x; x <= se.x; x++) {
      const tile = await provider.loadTile(zoom, x, y);
      const entries = Object.entries(tile.layers);
      if (entries.length === 0) continue;
      tileCount++;
      for (const [name, features] of entries) {
        const list = grouped.get(name);
        if (list) list.push(...features);
        else grouped.set(name, [...features]);
      }
    }
  }

  const sources: Record<string, GlyphMapVectorFeatureCollection> = {};
  const kinds: Record<string, readonly string[]> = {};
  for (const [name, features] of grouped) {
    sources[name] = { features, attribution };
    kinds[name] = [...new Set(features.map(glyphMapProtomapsKind).filter((k): k is string => k !== undefined))].sort();
  }
  return { bounds, zoom, tileCount, sources, kinds, attribution };
}

export interface GlyphMapProtomapsLayersOptions {
  /** Only build these spec ids, in this order. Omitted = every spec whose source layer the extract holds. */
  readonly include?: readonly string[];
  /** Extra `kind` narrowing, keyed by SOURCE LAYER — intersected with the spec's own. */
  readonly kinds?: Readonly<Record<string, readonly string[]>>;
  /** Colour override keyed by spec id. */
  readonly colors?: Readonly<Record<string, string>>;
  /** Per-layer glyph density, keyed by spec id (glyphcss's per-mesh detail resolution / stroke overlay density). */
  readonly densities?: Readonly<Record<string, number>>;
}

type GlyphMapProtomapsBuiltLayer =
  | GlyphMapLineLayer
  | GlyphMapFillLayer
  | GlyphMapFillExtrusionLayer
  | GlyphMapSymbolLayer
  | GlyphMapCircleLayer;

/**
 * One ready-to-mount layer per spec whose source layer the extract holds.
 * A spec with no data produces NOTHING rather than an empty layer, so a rail
 * built from the result can never offer a toggle that draws nothing.
 */
export function glyphMapProtomapsLayers(
  extract: GlyphMapProtomapsExtract,
  opts: GlyphMapProtomapsLayersOptions = {},
): readonly GlyphMapProtomapsBuiltLayer[] {
  const specs = opts.include
    ? opts.include
        .map((id) => GLYPH_MAP_PROTOMAPS_LAYERS.find((s) => s.id === id))
        .filter((s): s is GlyphMapProtomapsLayerSpec => s !== undefined)
    : GLYPH_MAP_PROTOMAPS_LAYERS;

  const out: GlyphMapProtomapsBuiltLayer[] = [];
  for (const spec of specs) {
    const source = extract.sources[spec.sourceLayer];
    if (!source) continue;
    const requested = opts.kinds?.[spec.sourceLayer];
    const kinds = spec.kinds && requested
      ? spec.kinds.filter((k) => requested.includes(k))
      : requested ?? spec.kinds;
    const filter = glyphMapProtomapsFeatureFilter({ kinds, geometry: spec.geometry });
    const color = opts.colors?.[spec.id] ?? spec.color;
    const density = opts.densities?.[spec.id];
    const common = { id: spec.id, source, filter, color, ...(density === undefined ? {} : { density }) } as const;
    switch (spec.type) {
      case "line":
        out.push({ type: "line", ...common });
        break;
      case "fill":
        out.push({ type: "fill", ...common });
        break;
      case "fill-extrusion":
        out.push({ type: "fill-extrusion", ...common, heightProperty: spec.heightProperty });
        break;
      case "symbol":
        out.push({ type: "symbol", ...common, textProperty: spec.textProperty, priorityProperty: spec.priorityProperty });
        break;
      case "circle":
        out.push({ type: "circle", ...common, radius: 1 });
        break;
    }
  }
  return out;
}
