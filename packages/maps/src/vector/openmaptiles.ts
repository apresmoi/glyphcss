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
import type { GlyphMapLabelAnchor } from "../layers";

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

/**
 * The `poi` classes that are STREET FURNITURE — a thing on a pavement, not a
 * place anyone navigates to.
 *
 * They are 1,065 of the vendored Zurich z14 tile's 3,944 POIs (27.0%) and
 * 570 of Houston's 2,001 (28.5%), and the layer draws every one of them as
 * the same amber dot as a hospital. Read out of the tiles, not out of a
 * category list: these are the furniture classes that actually appear in the
 * real data at volume.
 */
export const GLYPH_MAP_OPENMAPTILES_POI_FURNITURE: readonly string[] = [
  "waste_basket", "bicycle_parking", "gate", "bollard", "bench", "lift_gate",
];

/**
 * The `poi` importance cut the POI row opens on — `rank <= 20`.
 *
 * `rank` is on 100% of the POIs in both vendored z14 tiles and counts 1 =
 * most important, so it is a real ordering rather than a quota: a z12 tile
 * whose 51 POIs are all stations ranked 1-7 keeps all 51, while a city tile
 * keeps its top slice. With the furniture exclusion above it takes Zurich's
 * 3,944 to 686 and Houston's 2,001 to 684 — and each of those was a
 * positioned DOM hotspot `<div>`, so this is a frame-time saving as much as
 * a legibility one.
 */
export const GLYPH_MAP_OPENMAPTILES_POI_MAX_RANK = 20;

/**
 * `landcover.class` → colour. Seven values, measured across the vendored
 * tiles (`grass`, `wood`, `farmland`, `sand`, `rock`, `wetland`, `ice`).
 *
 * `class` and not `subclass`: the latter is also on 100% of features but has
 * 21+ values with no natural colour ordering (`flowerbed` beside
 * `village_green` beside `scree`), while `class` is exactly the seven kinds
 * of ground a terrain palette has distinct colours for. Anything not named
 * here falls back to the row's own colour, so an unknown value is never a
 * hole.
 */
export const GLYPH_MAP_OPENMAPTILES_LANDCOVER_COLORS: Readonly<Record<string, string>> = {
  wood: "#2f4a35",
  grass: "#57804a",
  farmland: "#7a7a45",
  wetland: "#3f6b66",
  sand: "#c2b280",
  rock: "#8a8a86",
  ice: "#dbe9f2",
};

/**
 * `landuse.class` → colour, bucketed. The ~20 values the real tiles carry
 * collapse to five readable kinds of ground, because a character grid cannot
 * carry twenty tints and because `library` and `kindergarten` are the same
 * thing to a reader looking at a city block. Every key is witnessed in a
 * decoded tile, never taken from the schema docs.
 */
export const GLYPH_MAP_OPENMAPTILES_LANDUSE_COLORS: Readonly<Record<string, string>> = {
  // Where people live.
  residential: "#5a5348", suburb: "#5a5348", neighbourhood: "#5a5348",
  // Where they shop.
  commercial: "#6b5340", retail: "#6b5340",
  // Where the machinery is.
  industrial: "#4d4d55", railway: "#4d4d55", bus_station: "#4d4d55",
  // Institutions.
  school: "#46596b", university: "#46596b", college: "#46596b", kindergarten: "#46596b",
  library: "#46596b", hospital: "#46596b",
  // Open ground people use.
  pitch: "#3f5f42", playground: "#3f5f42", track: "#3f5f42", stadium: "#3f5f42",
  zoo: "#3f5f42", theme_park: "#3f5f42", cemetery: "#3f5f42",
};

/**
 * `water.class` → colour. Exactly the five values the vendored tiles carry,
 * and the reason this one is not a nicety: 26 of the 33 water polygons in
 * the vendored Houston z14 tile are `swimming_pool`, painted in the same
 * blue as the Pacific. No key here is a value the schema docs promise and
 * the tiles do not show — `openmaptiles.test.ts` re-derives the whole key
 * set from the fixtures on every run.
 */
export const GLYPH_MAP_OPENMAPTILES_WATER_COLORS: Readonly<Record<string, string>> = {
  ocean: "#1b3f66",
  lake: "#2c5c8f",
  river: "#3a72a8",
  pond: "#41739c",
  swimming_pool: "#4fb0d8",
};

/** The geometry kinds an MVT source layer mixes, and the axis a row narrows on. */
export type GlyphMapOpenMapTilesGeometry = "point" | "line" | "polygon";

export interface GlyphMapOpenMapTilesFeatureFilterOptions {
  /** Keep only these `class` values. Omitted/empty = every class. */
  readonly classes?: readonly string[];
  /** Drop these `class` values — the complement of {@link classes}, for a layer whose vocabulary is too long to enumerate but whose junk is not (see {@link GLYPH_MAP_OPENMAPTILES_POI_FURNITURE}). */
  readonly excludeClasses?: readonly string[];
  /** Keep only features at or above this importance, i.e. `rank <= max` — this schema's `rank` counts 1 = most important. A feature with no numeric `rank` is dropped, never silently kept, exactly as {@link minAdminLevel} treats a missing admin level. */
  readonly maxRank?: number;
  /** Keep only features carrying a non-empty value for every one of these properties. `["name"]` is what makes a label row a label row: a feature with nothing to print is not a symbol. */
  readonly requireProperties?: readonly string[];
  /**
   * Keep only this geometry, or any one of these — required to drop
   * `transportation`'s z14 pedestrian-apron POLYGONS while keeping its
   * lines, and to keep BOTH halves of `water_name`, whose names arrive as
   * points for compact bodies and as label PATHS for elongated ones.
   *
   * A list rather than a second axis because it is the same question: an
   * MVT source layer is a bag of mixed geometry and a row says which kinds
   * of it that row draws. Omitted = every kind.
   */
  readonly geometry?: GlyphMapOpenMapTilesGeometry | readonly GlyphMapOpenMapTilesGeometry[];
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
  const excludedClasses = set(opts.excludeClasses);
  const brunnels = set(opts.excludeBrunnel);
  const services = set(opts.excludeService);
  const flags = opts.excludeFlags && opts.excludeFlags.length > 0 ? opts.excludeFlags : null;
  const required = opts.requireProperties && opts.requireProperties.length > 0 ? opts.requireProperties : null;
  const { geometry, minAdminLevel, maxAdminLevel, maxRank } = opts;
  const geometries = geometry === undefined ? null
    : new Set<string>(typeof geometry === "string" ? [geometry] : geometry);
  const checksAdmin = minAdminLevel !== undefined || maxAdminLevel !== undefined;
  return (feature) => {
    if (geometries && (feature.geometryType === undefined || !geometries.has(feature.geometryType))) return false;
    if (classes) {
      const cls = glyphMapOpenMapTilesClass(feature);
      if (cls === undefined || !classes.has(cls)) return false;
    }
    if (excludedClasses) {
      const cls = glyphMapOpenMapTilesClass(feature);
      if (cls !== undefined && excludedClasses.has(cls)) return false;
    }
    if (maxRank !== undefined) {
      const rank = feature.properties?.rank;
      if (typeof rank !== "number" || rank > maxRank) return false;
    }
    if (required) {
      for (const name of required) {
        const value = feature.properties?.[name];
        if (value === undefined || value === null || value === "") return false;
      }
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
  /** The geometry kind(s) this row renders — the axis that separates `transportation`'s lines from its z14 pedestrian-apron polygons, and the one `omt-water-labels` needs BOTH values of. */
  readonly geometry: GlyphMapOpenMapTilesGeometry | readonly GlyphMapOpenMapTilesGeometry[];
  /** Default `class` narrowing. Omitted = every class in the source layer; a caller narrows further through {@link GlyphMapOpenMapTilesLayersOptions.classes}. */
  readonly classes?: readonly string[];
  /** Default `class` exclusions — see {@link GlyphMapOpenMapTilesFeatureFilterOptions.excludeClasses}. */
  readonly excludeClasses?: readonly string[];
  /** Default importance cut — see {@link GlyphMapOpenMapTilesFeatureFilterOptions.maxRank}. */
  readonly maxRank?: number;
  /** Properties a feature must carry to be drawn at all — see {@link GlyphMapOpenMapTilesFeatureFilterOptions.requireProperties}. */
  readonly requireProperties?: readonly string[];
  readonly minAdminLevel?: number;
  readonly maxAdminLevel?: number;
  /** Default `brunnel` exclusions — see {@link GlyphMapOpenMapTilesFeatureFilterOptions.excludeBrunnel}. */
  readonly excludeBrunnel?: readonly string[];
  /** Default `service` exclusions — see {@link GlyphMapOpenMapTilesFeatureFilterOptions.excludeService}. */
  readonly excludeService?: readonly string[];
  /** Default flag exclusions — see {@link GlyphMapOpenMapTilesFeatureFilterOptions.excludeFlags}. */
  readonly excludeFlags?: readonly string[];
  readonly color: string;
  /** `fill` only — the property whose value picks a colour out of {@link colors}, falling back to {@link color}. */
  readonly colorProperty?: string;
  /** `fill` only — the value → colour table {@link colorProperty} indexes. */
  readonly colors?: Readonly<Record<string, string>>;
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
  /**
   * `symbol` only — a label composed from SEVERAL of a feature's own
   * properties, joined by a space in this order, with each missing or empty
   * one simply left out.
   *
   * `mountain_peak` is what needs it: the tiles carry `name` on 100% of
   * alpine peaks and `ele` on 98.9%, and `Matterhorn 4478` is one label a
   * reader wants where `Matterhorn` alone throws away the only number the
   * feature has. Wins over {@link textProperty} when both are set.
   */
  readonly textProperties?: readonly string[];
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
 *  - **The three ground/water FILL rows colour by `class`.** `fill` already
 *    carries `colorProperty` + `colors`, and without them this mapping
 *    painted Antarctic ice, desert sand, bare rock and forest in one green
 *    (`landcover`, seven classes) and a hotel swimming pool in the blue of
 *    the Pacific (`water` — 26 of the 33 water polygons in the vendored
 *    Houston z14 tile are `swimming_pool`). An unnamed class falls back to
 *    the row's own colour, so the tables need not be exhaustive.
 *  - **The `poi` row is throttled by `rank`.** 3,944 POIs in the vendored
 *    Zurich z14 tile, every one of them a positioned DOM hotspot `<div>`,
 *    27.0% of them street furniture. See
 *    {@link GLYPH_MAP_OPENMAPTILES_POI_MAX_RANK}.
 *  - **`mountain_peak` is a labelled `symbol`, not a dot.** The layer is
 *    100% named and 98.9% elevation-carrying in an alpine tile, and a
 *    `circle` row discarded both. Priority is `ele`, not `rank`: this
 *    schema's `rank` counts 1 = most prominent while
 *    `glyphMapDeclutterLabels` keeps the LARGER number, so `rank` would keep
 *    the least prominent peak of any overlapping pair.
 *  - **Three rows for source layers this mapping never decoded at all** —
 *    `park`, `aeroway`, `water_name`. They are APPENDED rather than filed
 *    into the back-to-front draw order above, because `/maps`' URL state
 *    packs the OSM row set as a positional bitfield over this list
 *    (`MAPS_OSM_SUBLAYER_KEYS`) and an insertion silently reinterprets every
 *    link ever shared. Appending is safe for all three: two are labels
 *    (order-independent DOM hotspots) and `aeroway` is a stroke, stamped
 *    after the roads it crosses, which is the right order anyway. A `fill`
 *    row could NOT have been appended — fills sit coplanar on the datum, so
 *    draw order resolves the tie, and a protected-area polygon appended last
 *    would paint over the lake inside it. That is the reason `park` is a
 *    label row and not a green wash, on top of the free-text `class` below.
 *  - **`park` carries `name` and `rank` and a free-text `class`.** Real
 *    values in the vendored JFK tile are `"State Park"` and
 *    `"National Recreation Area"`; elsewhere `"Biosphärenreservat"` and
 *    `"Réserve de la biosphère, aire de coopération"`. So the row narrows on
 *    no class at all and keeps only NAMED points — 251 of 299 features in a
 *    z6 tile over the eastern United States are named points, which is a
 *    continent's national parks the map has never shown.
 *  - **`water_name` mixes point and line geometry** in one source layer and
 *    the row draws BOTH. The split is not arbitrary — a compact body's name
 *    is a point and an ELONGATED one's is the path a normal renderer runs
 *    the name along — so filtering to points kept the four oceans at z0 and
 *    dropped every lake on Earth: the vendored Zurich z12 tile's Zürichsee
 *    and Greifensee, and the reported `Lago Nahuel Huapi`, which is a line
 *    at every zoom that carries it. This renderer has no curved text, so a
 *    line is reduced to one anchor by `glyphMapLabelAnchorPoint` (the
 *    arc-length midpoint of the longest part), which is what makes the row
 *    able to accept the geometry at all.
 *  - **Still no `housenumber` or `aerodrome_label` row, on the data.**
 *    `housenumber` is 635 features against 1,991 building footprints in the
 *    vendored Zurich z14 tile, each of which would be a DOM hotspot, and it
 *    is illegible at every span where they fit. `aerodrome_label` is 0
 *    features in five of the six vendored tiles — including the JFK tile,
 *    the one tile in the set that IS an airport.
 */
export const GLYPH_MAP_OPENMAPTILES_LAYERS: readonly GlyphMapOpenMapTilesLayerSpec[] = [
  {
    id: "omt-landcover", label: "Land cover", type: "fill", sourceLayer: "landcover",
    geometry: "polygon", color: "#3b5c43",
    colorProperty: "class", colors: GLYPH_MAP_OPENMAPTILES_LANDCOVER_COLORS,
  },
  {
    id: "omt-landuse", label: "Land use", type: "fill", sourceLayer: "landuse",
    geometry: "polygon", color: "#4a4f3a",
    colorProperty: "class", colors: GLYPH_MAP_OPENMAPTILES_LANDUSE_COLORS,
  },
  {
    id: "omt-water", label: "Water", type: "fill", sourceLayer: "water",
    geometry: "polygon", color: "#2c5c8f",
    colorProperty: "class", colors: GLYPH_MAP_OPENMAPTILES_WATER_COLORS,
  },
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
  {
    id: "omt-peaks", label: "Peaks", type: "symbol", sourceLayer: "mountain_peak",
    geometry: "point", color: "#fbbf24",
    requireProperties: ["name"], textProperties: ["name", "ele"], priorityProperty: "ele",
  },
  {
    id: "omt-pois", label: "POIs", type: "circle", sourceLayer: "poi", geometry: "point",
    color: "#f59e0b",
    maxRank: GLYPH_MAP_OPENMAPTILES_POI_MAX_RANK,
    excludeClasses: GLYPH_MAP_OPENMAPTILES_POI_FURNITURE,
  },
  // ── Appended, never inserted. See the table's own doc: `/maps` packs this
  //    list's order as a positional URL bitfield.
  {
    id: "omt-parks", label: "Protected areas", type: "symbol", sourceLayer: "park",
    geometry: "point", color: "#86efac",
    requireProperties: ["name"], textProperty: "name",
  },
  {
    id: "omt-aeroways", label: "Airports", type: "line", sourceLayer: "aeroway",
    geometry: "line", color: "#94a3b8",
  },
  {
    id: "omt-water-labels", label: "Water labels", type: "symbol", sourceLayer: "water_name",
    geometry: ["point", "line"], color: "#93c5fd",
    requireProperties: ["name"], textProperty: "name",
  },
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
  /**
   * Per-layer label placement, keyed by spec id — `GlyphMapSymbolLayer.textAnchor`,
   * MapLibre's `text-anchor` vocabulary.
   *
   * Only a `symbol` spec reads it; an entry naming any other row is dropped
   * rather than forwarded, because a caller's record is legitimately keyed
   * over EVERY row (`/maps` packs one positionally in its URL) and no other
   * layer type has the option to receive.
   *
   * A row omitted here — or naming the `"center"` the layer already draws —
   * gets no `textAnchor` key at all, so the built layer object is identical
   * to the one this builder returned before the option existed.
   */
  readonly textAnchors?: Readonly<Record<string, GlyphMapLabelAnchor>>;
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
      excludeClasses: spec.excludeClasses,
      geometry: spec.geometry,
      minAdminLevel: spec.minAdminLevel,
      maxAdminLevel: spec.maxAdminLevel,
      maxRank: spec.maxRank,
      requireProperties: spec.requireProperties,
      excludeBrunnel: spec.excludeBrunnel,
      excludeService: spec.excludeService,
      excludeFlags: spec.excludeFlags,
    });
    const color = opts.colors?.[spec.id] ?? spec.color;
    const density = opts.densities?.[spec.id];
    // `"center"` is the layer's own default and `glyphMapLabelPlacement`
    // answers `null` for it, so declaring it would render the same — but
    // omitting the key is what keeps an untouched caller's layer object
    // byte-identical rather than merely equivalent.
    const requestedAnchor = opts.textAnchors?.[spec.id];
    const textAnchor = spec.type === "symbol" && requestedAnchor !== undefined && requestedAnchor !== "center"
      ? requestedAnchor
      : undefined;
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
        out.push({
          type: "fill", ...common,
          ...(spec.colorProperty === undefined ? {} : { colorProperty: spec.colorProperty }),
          ...(spec.colors === undefined ? {} : { colors: spec.colors }),
        });
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
      case "symbol": {
        // A COMPOSED label is a function of the feature, so it is built here
        // once per layer and handed to the widget rather than expressed as a
        // second property name the widget would have to know how to join.
        const parts = spec.textProperties;
        const text = parts
          ? (feature: GlyphMapVectorFeature) => parts
              .map((name) => feature.properties?.[name])
              .filter((value) => value !== undefined && value !== null && value !== "")
              .join(" ")
          : undefined;
        out.push({
          type: "symbol", ...common,
          textProperty: spec.textProperty,
          ...(text === undefined ? {} : { text }),
          ...(textAnchor === undefined ? {} : { textAnchor }),
          priorityProperty: spec.priorityProperty,
        });
        break;
      }
      case "circle":
        out.push({ type: "circle", ...common, radius: 1 });
        break;
    }
  }
  return out;
}
