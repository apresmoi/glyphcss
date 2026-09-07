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
 * | building height | `height` | `render_height` (+ `render_min_height`) |
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

/**
 * Whether a way is carried over or under whatever it crosses — `"bridge"` or
 * `"tunnel"`, and `undefined` for the overwhelmingly common surface case (the
 * field is simply not written).
 *
 * It is a first-class reader for the same reason `class` is: nothing else in
 * this schema says a line is not visible from the street. Ignoring it drew
 * subway lines, road tunnels and culverted streams as ordinary surface
 * features — 14.8% of z14 road features across ten city tiles, and 29.5% of
 * the drawn road LENGTH in a Manhattan tile.
 */
export function glyphMapOpenMapTilesBrunnel(feature: GlyphMapVectorFeature): string | undefined {
  const value = feature.properties?.brunnel;
  return typeof value === "string" ? value : undefined;
}

/**
 * Whether one of the schema's boolean-ish flags is set on a feature.
 *
 * The schema writes them TWO ways, measured on real tiles rather than
 * assumed: `boundary.maritime` and `boundary.disputed` arrive as `0`/`1`
 * NUMBERS present on every feature, while `building.hide_3d` and
 * `transportation.indoor` arrive as a real `true`/`1` and are ABSENT
 * otherwise. So neither "the property exists" nor "the property is `true`"
 * is the test — falsiness is, and it covers both writings exactly.
 */
export function glyphMapOpenMapTilesFlag(feature: GlyphMapVectorFeature, name: string): boolean {
  return Boolean(feature.properties?.[name]);
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
  /** Drop features whose {@link glyphMapOpenMapTilesBrunnel} is one of these. `["tunnel"]` takes a subway line off the surface and leaves the bridge over it drawn. */
  readonly excludeBrunnel?: readonly string[];
  /** Drop features whose `service` is one of these — `driveway`/`parking_aisle` is car-park hatching rather than street network. */
  readonly excludeService?: readonly string[];
  /** Drop features carrying any of these flags set, read through {@link glyphMapOpenMapTilesFlag}: `maritime`, `disputed`, `indoor`, `hide_3d`. */
  readonly excludeFlags?: readonly string[];
}

/** A {@link GlyphMapFeatureFilter} over the OpenMapTiles discriminators. Every axis omitted = keeps everything. */
export function glyphMapOpenMapTilesFeatureFilter(opts: GlyphMapOpenMapTilesFeatureFilterOptions): GlyphMapFeatureFilter {
  const set = (values?: readonly string[]) => (values && values.length > 0 ? new Set(values) : null);
  const classes = set(opts.classes);
  const brunnels = set(opts.excludeBrunnel);
  const services = set(opts.excludeService);
  const flags = opts.excludeFlags && opts.excludeFlags.length > 0 ? opts.excludeFlags : null;
  const { geometry, minAdminLevel, maxAdminLevel } = opts;
  const checksAdmin = minAdminLevel !== undefined || maxAdminLevel !== undefined;
  return (feature) => {
    if (geometry && feature.geometryType !== geometry) return false;
    if (classes) {
      const cls = glyphMapOpenMapTilesClass(feature);
      if (cls === undefined || !classes.has(cls)) return false;
    }
    if (brunnels) {
      const brunnel = glyphMapOpenMapTilesBrunnel(feature);
      if (brunnel !== undefined && brunnels.has(brunnel)) return false;
    }
    if (services) {
      const service = feature.properties?.service;
      if (typeof service === "string" && services.has(service)) return false;
    }
    if (flags) {
      for (const flag of flags) if (glyphMapOpenMapTilesFlag(feature, flag)) return false;
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
  /** Default `brunnel` exclusions — see {@link GlyphMapOpenMapTilesFeatureFilterOptions.excludeBrunnel}. */
  readonly excludeBrunnel?: readonly string[];
  /** Default `service` exclusions — see {@link GlyphMapOpenMapTilesFeatureFilterOptions.excludeService}. */
  readonly excludeService?: readonly string[];
  /** Default flag exclusions — see {@link GlyphMapOpenMapTilesFeatureFilterOptions.excludeFlags}. */
  readonly excludeFlags?: readonly string[];
  readonly color: string;
  /** `fill-extrusion` only. */
  readonly heightProperty?: string;
  /** `fill-extrusion` only — the property carrying the part's own base, on the SAME datum as {@link heightProperty}. */
  readonly baseOffsetProperty?: string;
  /** `fill-extrusion` only — texture the walls with the built-in generated facade tile. */
  readonly facade?: boolean;
  /** `fill-extrusion` only — deterministic per-footprint tone around {@link color}. */
  readonly colorVariation?: number;
  /** `symbol` only. */
  readonly textProperty?: string;
  readonly priorityProperty?: string;
}

/**
 * How far a building's tone may wander from the buildings row's own
 * {@link GLYPH_MAP_OPENMAPTILES_LAYERS} colour, `0`..`1`.
 *
 * `0.5` is half of `glyphMapVaryColor`'s own maximum swing (±14% of the full
 * channel range). The job is that a building SEPARATES from the one beside
 * it, which on a character grid needs only enough spread for two adjacent
 * depth-winning cells to differ; the whole row still has to read as one
 * material, and a city painted across the full solid reads as confetti.
 */
export const GLYPH_MAP_OPENMAPTILES_BUILDING_COLOR_VARIATION = 0.5;

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
 *  - **Three rows drop features the schema itself flags as not-there.** A
 *    `brunnel: tunnel` way is not visible from the street, so the roads and
 *    waterways rows draw the bridge and hide the tunnel: 47 of the vendored
 *    z14 tile's 605 road lines, 13 of its 27 waterways, and 29.5% of the
 *    drawn road LENGTH in a Manhattan tile. A `maritime` boundary is an EEZ
 *    line across open ocean and a `disputed` one is a claim rather than a
 *    border, and together they are 46.3%/44.4% of the admin-level-2 lines a
 *    world view draws — half the world's border ink was an ocean line in the
 *    same weight as the France-Germany border. A `hide_3d` building outline
 *    is the schema saying "its parts are mapped separately", so extruding it
 *    swallows the shorter buildings inside it (15 outlines swallowing 71
 *    buildings across eight city tiles). None of these is a taste knob: each
 *    one is the mapping drawing a thing where the data says it is not.
 *  - **The roads row also drops `service: driveway`/`parking_aisle` and
 *    `indoor` ways.** These ARE drawn somewhere by someone — this is the one
 *    declutter judgement in the table rather than a correctness fix — but a
 *    car-park aisle is hatching and an indoor corridor is not a street, and
 *    they are 72 and 4 of the vendored z14 tile's 605 lines. A caller who
 *    wants them back rebuilds the row's filter through
 *    {@link glyphMapOpenMapTilesFeatureFilter}, which is exported for it.
 *  - **The `building` row opts into all three appearance options by
 *    default** (`baseOffsetProperty`, `facade`, `colorVariation`), because
 *    on THIS schema each of them is answering a defect rather than adding a
 *    style. `render_min_height` is a second column the schema already
 *    carries and dropping it draws every part of a stepped structure from
 *    the ground: measured on the live `14/8296/5636`, the Eiffel Tower is
 *    35 parts spanning `0 → 3 m` up to `300 → 330 m`, and ignoring the base
 *    collapses them into nested boxes standing on the pavement. A facade is
 *    what stops a block of flat-roofed boxes reading as two tones and a
 *    wedge at eye height, and the per-footprint tone is what stops a
 *    neighbourhood reading as one silhouette. None of the three is a taste
 *    knob a caller would be expected to find, and a caller who disagrees
 *    still owns the returned layer objects.
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
  {
    id: "omt-waterways", label: "Waterways", type: "line", sourceLayer: "waterway",
    geometry: "line", excludeBrunnel: ["tunnel"], color: "#5aa9e6",
  },
  {
    id: "omt-roads", label: "Roads", type: "line", sourceLayer: "transportation",
    geometry: "line",
    excludeBrunnel: ["tunnel"],
    excludeService: ["driveway", "parking_aisle"],
    excludeFlags: ["indoor"],
    color: "#e8c988",
  },
  {
    id: "omt-buildings", label: "Buildings", type: "fill-extrusion", sourceLayer: "building",
    geometry: "polygon", color: "#94a3b8",
    heightProperty: "render_height",
    baseOffsetProperty: "render_min_height",
    excludeFlags: ["hide_3d"],
    facade: true,
    colorVariation: GLYPH_MAP_OPENMAPTILES_BUILDING_COLOR_VARIATION,
  },
  {
    id: "omt-boundaries", label: "Boundaries", type: "line", sourceLayer: "boundary",
    geometry: "line", maxAdminLevel: 2, excludeFlags: ["maritime", "disputed"], color: "#c084fc",
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
      excludeBrunnel: spec.excludeBrunnel,
      excludeService: spec.excludeService,
      excludeFlags: spec.excludeFlags,
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
        out.push({
          type: "fill-extrusion", ...common,
          heightProperty: spec.heightProperty,
          ...(spec.baseOffsetProperty === undefined ? {} : { baseOffsetProperty: spec.baseOffsetProperty }),
          ...(spec.facade === undefined ? {} : { facade: spec.facade }),
          ...(spec.colorVariation === undefined ? {} : { colorVariation: spec.colorVariation }),
        });
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
