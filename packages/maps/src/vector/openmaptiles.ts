/**
 * The OpenMapTiles schema → this package's layer vocabulary.
 *
 * This is the SECOND schema mapping in the package, and deliberately not a
 * generalization of the first. `protomaps.ts` maps the Protomaps/planetiler-
 * basemap schema; OpenFreeMap (and every other OpenMapTiles-derived pyramid:
 * MapTiler, a self-hosted `openmaptiles/openmaptiles` build) speaks a
 * different one, and the differences are not cosmetic:
 *
 * | | Protomaps | OpenMapTiles |
 * |---|---|---|
 * | discriminator | `kind` (string) | `class` (string) |
 * | roads | `roads` | `transportation` (+ `transportation_name` for labels) |
 * | rivers vs lakes | both in `water` | `waterway` (lines) vs `water` (polygons) |
 * | admin boundaries | `boundaries`, `kind` | `boundary`, `admin_level` (NUMBER — no `class` at all) |
 * | landmass | `earth` polygon | none; `landcover`/`landuse` are the ground |
 * | building height | `height` | `render_height` |
 * | place ranking | `population` | `rank` |
 *
 * A single "OSM schema" adapter over both would have to branch on all seven
 * rows on every feature, so there are two tables instead.
 *
 * **Every name here was read out of the live service, not out of the schema
 * docs** — `fixtures/openfreemap/tilejson.json` (the real
 * `https://tiles.openfreemap.org/planet` manifest, `name:<lang>` fields
 * stripped) and two real tiles it served. `openmaptiles.test.ts` re-derives
 * them on every run, so a schema drift is a red test rather than an empty
 * layer.
 */
import type { GlyphMapVectorFeature, GlyphMapVectorSource } from "./types";
import type {
  GlyphMapCircleLayer,
  GlyphMapFeatureFilter,
  GlyphMapFillExtrusionLayer,
  GlyphMapFillLayer,
  GlyphMapLineLayer,
  GlyphMapSymbolLayer,
} from "../widget";

/**
 * The OpenMapTiles source-layer ids, exactly as the service's own
 * `vector_layers` manifest declares them.
 *
 * Presence in this list is not presence in a tile: each layer declares its
 * own `minzoom` (`transportation` 4, `poi` 11, `building` 13), so a world
 * view legitimately decodes five of these and nothing else.
 */
export const GLYPH_MAP_OPENMAPTILES_SOURCE_LAYERS = [
  "aerodrome_label",
  "aeroway",
  "boundary",
  "building",
  "housenumber",
  "landcover",
  "landuse",
  "mountain_peak",
  "park",
  "place",
  "poi",
  "transportation",
  "transportation_name",
  "water",
  "water_name",
  "waterway",
] as const;

export type GlyphMapOpenMapTilesSourceLayer = (typeof GLYPH_MAP_OPENMAPTILES_SOURCE_LAYERS)[number];

/** The schema's string discriminator. `undefined` where the layer has none — `boundary` and `building` genuinely carry no `class`. */
export function glyphMapOpenMapTilesClass(feature: GlyphMapVectorFeature): string | undefined {
  const value = feature.properties?.class;
  return typeof value === "string" ? value : undefined;
}

/**
 * A boundary's OSM admin level: 2 = country, 4 = state/province, higher =
 * more local. This is the ONLY thing separating an international border from
 * a county line in this schema — `boundary` features carry no `class` at all
 * — so it is a first-class reader rather than a property-name string a
 * caller has to know.
 */
export function glyphMapOpenMapTilesAdminLevel(feature: GlyphMapVectorFeature): number | undefined {
  const value = feature.properties?.admin_level;
  return typeof value === "number" ? value : undefined;
}

export interface GlyphMapOpenMapTilesFeatureFilterOptions {
  /** Keep only these `class` values. Omitted/empty = every class. */
  readonly classes?: readonly string[];
  /** Keep only this geometry — required to separate `water_name`'s point labels from its line labels, and `transportation`'s z14 polygon aprons from its lines. */
  readonly geometry?: "point" | "line" | "polygon";
  /** Keep only boundaries at or above this administrative importance (i.e. `admin_level >= min`). A feature with no `admin_level` is dropped, never silently kept. */
  readonly minAdminLevel?: number;
  /** Keep only boundaries at or below this administrative importance (`admin_level <= max`); `2` is "international borders only". */
  readonly maxAdminLevel?: number;
}

/** A {@link GlyphMapFeatureFilter} over the OpenMapTiles discriminators. Every axis omitted = keeps everything. */
export function glyphMapOpenMapTilesFeatureFilter(opts: GlyphMapOpenMapTilesFeatureFilterOptions): GlyphMapFeatureFilter {
  const classes = opts.classes && opts.classes.length > 0 ? new Set(opts.classes) : null;
  const { geometry, minAdminLevel, maxAdminLevel } = opts;
  const checksAdmin = minAdminLevel !== undefined || maxAdminLevel !== undefined;
  return (feature) => {
    if (geometry && feature.geometryType !== geometry) return false;
    if (classes) {
      const cls = glyphMapOpenMapTilesClass(feature);
      if (cls === undefined || !classes.has(cls)) return false;
    }
    if (checksAdmin) {
      const level = glyphMapOpenMapTilesAdminLevel(feature);
      if (level === undefined) return false;
      if (minAdminLevel !== undefined && level < minAdminLevel) return false;
      if (maxAdminLevel !== undefined && level > maxAdminLevel) return false;
    }
    return true;
  };
}

/** One row of the schema mapping: which glyph layer type renders which slice of which OpenMapTiles source layer. */
export interface GlyphMapOpenMapTilesLayerSpec {
  readonly id: string;
  /** Human label for a UI rail. */
  readonly label: string;
  readonly type: "line" | "fill" | "fill-extrusion" | "symbol" | "circle";
  readonly sourceLayer: GlyphMapOpenMapTilesSourceLayer;
  /** The geometry this row renders — the axis that separates `transportation`'s lines from its z14 pedestrian-apron polygons. */
  readonly geometry: "point" | "line" | "polygon";
  /** Default `class` narrowing. Omitted = every class in the source layer; a caller narrows further through {@link GlyphMapOpenMapTilesLayersOptions.classes}. */
  readonly classes?: readonly string[];
  readonly minAdminLevel?: number;
  readonly maxAdminLevel?: number;
  readonly color: string;
  /** `fill-extrusion` only. */
  readonly heightProperty?: string;
  /** `symbol` only. */
  readonly textProperty?: string;
  readonly priorityProperty?: string;
}

/**
 * The default mapping, ordered back-to-front the way a basemap draws:
 * ground, then water, then lines, then buildings, then labels.
 *
 * Choices worth stating:
 *  - **`landcover` before `landuse`.** OpenMapTiles has no landmass polygon
 *    (`earth` in the Protomaps schema); `landcover` (wood/grass/sand/ice/
 *    farmland, from z0) is the closest thing to natural ground and
 *    `landuse` (residential/industrial/school, from z4) sits on top of it.
 *  - **`water` and `waterway` are separate rows on separate source layers**,
 *    not one row split by geometry. That is this schema's own split; the
 *    geometry filter still rides along because `water_name` mixes point and
 *    line labels.
 *  - **`boundary` defaults to `maxAdminLevel: 2`** — international borders
 *    only. Undifferentiated, `boundary` inks every county line in Europe at
 *    z12 and reads as noise, exactly the failure `protomaps.ts` documents
 *    for undifferentiated `roads`.
 *  - **No `housenumber`, `aeroway`, `aerodrome_label` or `park` row.** The
 *    first three are z10+/z14 detail with no readable form on a character
 *    grid; `park`'s `class` is free text (real values in the fixture include
 *    `"Direttiva 92/43/CEE (Habitat)"`), so it has no vocabulary a filter UI
 *    could offer.
 */
export const GLYPH_MAP_OPENMAPTILES_LAYERS: readonly GlyphMapOpenMapTilesLayerSpec[] = [
  { id: "omt-landcover", label: "Land cover", type: "fill", sourceLayer: "landcover", geometry: "polygon", color: "#3b5c43" },
  { id: "omt-landuse", label: "Land use", type: "fill", sourceLayer: "landuse", geometry: "polygon", color: "#4a4f3a" },
  { id: "omt-water", label: "Water", type: "fill", sourceLayer: "water", geometry: "polygon", color: "#2c5c8f" },
  { id: "omt-waterways", label: "Waterways", type: "line", sourceLayer: "waterway", geometry: "line", color: "#5aa9e6" },
  { id: "omt-roads", label: "Roads", type: "line", sourceLayer: "transportation", geometry: "line", color: "#e8c988" },
  {
    id: "omt-buildings", label: "Buildings", type: "fill-extrusion", sourceLayer: "building",
    geometry: "polygon", color: "#94a3b8", heightProperty: "render_height",
  },
  {
    id: "omt-boundaries", label: "Boundaries", type: "line", sourceLayer: "boundary",
    geometry: "line", maxAdminLevel: 2, color: "#c084fc",
  },
  {
    id: "omt-places", label: "Places", type: "symbol", sourceLayer: "place",
    geometry: "point", color: "#ffffff", textProperty: "name", priorityProperty: "rank",
  },
  { id: "omt-peaks", label: "Peaks", type: "circle", sourceLayer: "mountain_peak", geometry: "point", color: "#fbbf24" },
  { id: "omt-pois", label: "POIs", type: "circle", sourceLayer: "poi", geometry: "point", color: "#f59e0b" },
];

export interface GlyphMapOpenMapTilesLayersOptions {
  /** Only build these spec ids, in this order. Omitted = every spec. */
  readonly include?: readonly string[];
  /** Extra `class` narrowing, keyed by SOURCE LAYER — intersected with the spec's own. */
  readonly classes?: Readonly<Record<string, readonly string[]>>;
  /** Colour override keyed by spec id. */
  readonly colors?: Readonly<Record<string, string>>;
  /** Per-layer glyph density, keyed by spec id (glyphcss's per-mesh detail resolution / stroke overlay density). */
  readonly densities?: Readonly<Record<string, number>>;
}

type GlyphMapOpenMapTilesBuiltLayer =
  | GlyphMapLineLayer
  | GlyphMapFillLayer
  | GlyphMapFillExtrusionLayer
  | GlyphMapSymbolLayer
  | GlyphMapCircleLayer;

/**
 * One ready-to-mount layer per spec, all sharing ONE `source`.
 *
 * Unlike `glyphMapProtomapsLayers`, which drops a spec whose source layer the
 * (already fully read) extract does not hold, every spec is built here: the
 * source is a planet-wide TILE PROVIDER, so "does this layer have data" is
 * not a property of the source at all — it is a property of the current view
 * (`building` has data at z13 and none at z12). Deciding at build time would
 * mean deciding for the wrong view.
 */
export function glyphMapOpenMapTilesLayers(
  source: GlyphMapVectorSource,
  opts: GlyphMapOpenMapTilesLayersOptions = {},
): readonly GlyphMapOpenMapTilesBuiltLayer[] {
  const specs = opts.include
    ? opts.include
        .map((id) => GLYPH_MAP_OPENMAPTILES_LAYERS.find((s) => s.id === id))
        .filter((s): s is GlyphMapOpenMapTilesLayerSpec => s !== undefined)
    : GLYPH_MAP_OPENMAPTILES_LAYERS;

  const out: GlyphMapOpenMapTilesBuiltLayer[] = [];
  for (const spec of specs) {
    const requested = opts.classes?.[spec.sourceLayer];
    const classes = spec.classes && requested
      ? spec.classes.filter((c) => requested.includes(c))
      : requested ?? spec.classes;
    const filter = glyphMapOpenMapTilesFeatureFilter({
      classes,
      geometry: spec.geometry,
      minAdminLevel: spec.minAdminLevel,
      maxAdminLevel: spec.maxAdminLevel,
    });
    const color = opts.colors?.[spec.id] ?? spec.color;
    const density = opts.densities?.[spec.id];
    const common = {
      id: spec.id,
      source,
      sourceLayer: spec.sourceLayer,
      filter,
      color,
      ...(density === undefined ? {} : { density }),
    } as const;
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
