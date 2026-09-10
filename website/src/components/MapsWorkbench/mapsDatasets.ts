/**
 * The /maps page's DATASETS card: four static, world-wide reference datasets
 * that are not a basemap and not terrain — where the compute is, where the
 * water is held back, where the internet physically runs, and what the
 * world's named physical geography is called.
 *
 * ## Where the data comes from, and why it lives under `website/`
 *
 * All four are snapshots taken from
 * [God's Eye View](https://github.com/bilawalsidhu/gods-eye-view), reshaped
 * by `website/scripts/prepare-static-datasets.mjs` and served from
 * `website/public/data/`. They are three different licences and one of them
 * is load-bearing:
 *
 * | Row | Source | Licence | Attribution |
 * |---|---|---|---|
 * | Datacenters | OpenStreetMap (`telecom=data_center`) | ODbL 1.0 | required |
 * | Dams | Open Infrastructure Map / OpenStreetMap | ODbL 1.0 | required |
 * | Submarine cables | TeleGeography Submarine Cable Map | **CC BY-NC-SA 3.0** | required |
 * | Land regions / Marine areas | Natural Earth 10m physical | Public domain | courtesy |
 *
 * **The cables are non-commercial and share-alike.** Every package in this
 * monorepo is MIT and published to npm, so that file can never enter
 * `packages/` — it would attach a restriction the package cannot grant. It
 * lives under `website/public/data/submarine-cables/` with its own `LICENSE`
 * and `README.md`, so the repo-root MIT cannot be read as covering it. Note
 * what makes that containment cheap: **`@glyphcss/maps` needed no change at
 * all.** Every row mounts through the widget's existing STATIC source path
 * (`GlyphMapVectorFeatureCollection`) as a `circle`, `symbol`, `line` or
 * `fill` layer, so there is no package-side machinery for a licence to leak
 * into and nothing to remove if TeleGeography's terms ever became a problem
 * — deleting one directory and one row spec is the whole of it.
 *
 * ## Attribution is a CODE constant, and rides the mounted layer
 *
 * {@link MAP_DATASET_ROWS} carries each row's credit, {@link loadMapDataset}
 * attaches it to the decoded collection as
 * `GlyphMapVectorFeatureCollection.attribution`, and `createGlyphMap`'s
 * `getAttributions()` aggregates whatever the CURRENTLY mounted layers carry
 * (`@glyphcss/maps`' `attribution.ts`). So the credit appears when a row is
 * switched on and withdraws when it is switched off, with no string anywhere
 * on the page and no lookup table that can drift from the mounted set.
 *
 * The credit is deliberately NOT read out of the data file. A data file is
 * regenerable and editable; a licence obligation is not something that should
 * be lost by re-running a script. The file's `meta.license` is provenance the
 * card DISPLAYS, and `mapsDatasets.mount.test.ts` cross-checks the two so
 * they cannot silently disagree.
 *
 * ## The wire format
 *
 * The files are not GeoJSON: they are the positional form
 * `prepare-static-datasets.mjs` documents (`columns` naming the properties
 * once for the whole file, each feature `[values, geometry]`), which halves
 * the payload against writing `GlyphMapVectorFeatureCollection` out literally
 * — measured 3.0 MiB across the five files against 5.9 MiB, and 1.06 MiB as
 * the browser actually receives them (gzip). {@link decodeMapDataset} turns
 * one back into the ordinary collection the widget consumes, so nothing below
 * this file knows the format exists.
 *
 * ## Fetched only when a row is switched on
 *
 * Every row defaults OFF and its file is requested by {@link loadMapDataset}
 * the first time it is enabled, then held. A default page load pays zero
 * bytes for all five — the same discipline the OpenStreetMap card has, and
 * the reason a 673 KiB (gzipped) land-regions file is a fetch a reader opts
 * into rather than a cost every visitor carries.
 */
import type {
  GlyphMapAttribution,
  GlyphMapLabelAnchor,
  GlyphMapVectorFeature,
  GlyphMapVectorFeatureCollection,
} from "@glyphcss/maps";

/** Attribution OpenStreetMap-derived data must carry — the same credit the OSM card already shows, so mounting both names it once. */
const OSM_CREDIT: GlyphMapAttribution = {
  name: "OpenStreetMap contributors",
  url: "https://www.openstreetmap.org/copyright",
  license: "ODbL",
};

/**
 * TeleGeography's credit, and the one on this card that is a genuine legal
 * obligation rather than courtesy.
 *
 * The `license` string is what `mapsCredits.ts` matches against to decide
 * whether a source may be compressed behind the `+N` affordance: anything
 * that is not recognisably public-domain is treated as an obligation and
 * gets a name on the always-visible line. `"CC BY-NC-SA 3.0"` is not in
 * `NO_ATTRIBUTION_REQUIRED`, so this is named — which is the correct
 * behaviour and is pinned by `mapsDatasets.mount.test.ts` rather than left
 * to the default.
 */
const TELEGEOGRAPHY_CREDIT: GlyphMapAttribution = {
  name: "TeleGeography",
  url: "https://www.submarinecablemap.com",
  license: "CC BY-NC-SA 3.0",
};

const NATURAL_EARTH_CREDIT: GlyphMapAttribution = {
  name: "Natural Earth",
  url: "https://www.naturalearthdata.com",
  license: "Public domain",
};

/** Open Infrastructure Map process and publish the dam extract; the underlying survey is still OSM's, so both are named. */
const OPENINFRAMAP_CREDIT: GlyphMapAttribution = {
  name: "Open Infrastructure Map",
  url: "https://openinframap.org",
  license: "ODbL",
};

/** The layer types this card mounts — the same four the OSM card already proves the widget renders from a static source. */
export type MapDatasetLayerType = "circle" | "symbol" | "line" | "fill";

export interface MapDatasetRow {
  readonly id: string;
  readonly label: string;
  readonly type: MapDatasetLayerType;
  /** Where the prepared file is served from, relative to the site root. */
  readonly url: string;
  /** This row's credit(s) — attached to the decoded collection, never printed by the page. */
  readonly credit: readonly GlyphMapAttribution[];
  /** The row's paint colour. No per-row colour CONTROL, for the reason the OSM card has none: five swatches on one card is a palette, not a map. */
  readonly color: string;
  /** `symbol` rows only — which decoded property is printed. */
  readonly textProperty?: string;
  /** `circle` rows only — flat marker radius in CSS pixels; these datasets carry no magnitude to size by. */
  readonly radius?: number;
}

/**
 * The card's rows, in the order they are drawn — areas first, then lines,
 * then markers, so a dot is never buried under a region switched on after it.
 *
 * **APPEND-ONLY.** The URL bitfield (`mapsUrlState.ts`'s
 * `MAPS_DATASET_ROW_KEYS`) is positional over its own frozen copy of these
 * ids, and the per-row density tuple is positional over the same list;
 * `mapsUrlState.datasets.test.ts` cross-checks that the two still agree.
 *
 * Natural Earth contributes TWO rows for ONE dataset: `regions.json` (1,046
 * land features — islands, ranges, deserts, plateaus) and `marine.json` (292
 * seas, gulfs, bays and straits) are two separate Natural Earth source files
 * answering two different questions, and a reader who wants the seas named
 * does not necessarily want every mountain range shaded. Their 1,338
 * combined features are the "Natural Earth regions" set as published.
 */
export const MAP_DATASET_ROWS: readonly MapDatasetRow[] = [
  {
    id: "ds-regions",
    label: "Land regions",
    type: "fill",
    url: "/data/natural-earth/regions.json",
    credit: [NATURAL_EARTH_CREDIT],
    color: "#7c6a46",
  },
  {
    id: "ds-marine",
    label: "Marine areas",
    type: "fill",
    url: "/data/natural-earth/marine.json",
    credit: [NATURAL_EARTH_CREDIT],
    color: "#1f4b6e",
  },
  {
    id: "ds-cables",
    label: "Submarine cables",
    type: "line",
    url: "/data/submarine-cables/cables.json",
    credit: [TELEGEOGRAPHY_CREDIT],
    color: "#e8a33d",
  },
  {
    id: "ds-datacenters",
    label: "Datacenters",
    type: "circle",
    url: "/data/datacenters/datacenters.json",
    credit: [OSM_CREDIT],
    color: "#5ad1c4",
    radius: 2,
  },
  {
    id: "ds-dams",
    label: "Dams",
    type: "symbol",
    url: "/data/dams/dams.json",
    credit: [OPENINFRAMAP_CREDIT, OSM_CREDIT],
    color: "#c9d1d9",
    textProperty: "name",
  },
];

/**
 * Which rows the page opens on with no link at all: NONE.
 *
 * This is the page's own opening selection and nothing else — what an
 * OMITTED URL token decodes to is the separate, FROZEN
 * `MAPS_DATASET_MASK_LINK_DEFAULT` (`mapsUrlState.ts`). The two are two
 * constants for the reason the OSM card's own doc gives at length: deriving
 * the codec's omission sentinel from the page's opening set made a shared
 * link start rendering a row that was appended after it was written.
 *
 * They happen to agree today, and the constants stay separate anyway — the
 * point is that this one is free to move and that one is not.
 */
export const MAP_DATASET_DEFAULT_ON: readonly string[] = [];

export const MAP_DATASET_DEFAULT_DENSITY = 1;
export const MAP_DATASET_DEFAULT_ANCHOR: GlyphMapLabelAnchor = "center";

/** The positional wire form `prepare-static-datasets.mjs` writes. */
export interface MapDatasetWire {
  readonly meta?: {
    readonly source?: string;
    readonly url?: string;
    readonly license?: string;
    readonly note?: string;
  };
  readonly geometry: "point" | "line" | "polygon";
  readonly columns: readonly string[];
  /**
   * `[values, geometry]` per feature, `values` positional over `columns`.
   * A POINT file's geometry is a bare `[lon, lat]`; a line or polygon file's
   * is a list of rings.
   */
  readonly features: readonly [readonly unknown[], unknown][];
}

export interface MapDataset {
  readonly row: MapDatasetRow;
  readonly collection: GlyphMapVectorFeatureCollection;
  /** `meta.source` — what the card's provenance row prints. */
  readonly source: string;
  /** `meta.license` — the file's own claim, cross-checked against {@link MapDatasetRow.credit} by a test. */
  readonly license: string;
}

function isLonLat(value: unknown): value is [number, number] {
  return Array.isArray(value) && value.length === 2 && typeof value[0] === "number" && typeof value[1] === "number";
}

/**
 * The wire form back into the collection the widget consumes.
 *
 * An UNSOUND feature is skipped rather than thrown on. These files are
 * static assets that a deployment can truncate, a proxy can mangle and a
 * regenerated bake can change the shape of; one bad feature should cost that
 * feature, not the whole layer and not the frame it was mounted in. A file
 * that is unreadable in its entirety still throws — that is a 404 by another
 * name, and {@link loadMapDataset}'s caller has to be able to tell.
 */
export function decodeMapDataset(wire: MapDatasetWire): GlyphMapVectorFeature[] {
  const columns = wire.columns ?? [];
  const out: GlyphMapVectorFeature[] = [];
  for (const entry of wire.features ?? []) {
    if (!Array.isArray(entry) || entry.length < 2) continue;
    const [values, geometry] = entry;
    const properties: Record<string, unknown> = {};
    for (let i = 0; i < columns.length; i++) {
      const v = (values as readonly unknown[])?.[i];
      if (v !== undefined && v !== "") properties[columns[i]] = v;
    }
    if (wire.geometry === "point") {
      if (!isLonLat(geometry)) continue;
      out.push({ properties, geometryType: "point", rings: [[geometry]] });
      continue;
    }
    if (!Array.isArray(geometry)) continue;
    const rings = (geometry as unknown[]).filter(
      (ring): ring is [number, number][] => Array.isArray(ring) && ring.length >= 2 && ring.every(isLonLat),
    );
    if (rings.length === 0) continue;
    if (wire.geometry === "polygon") {
      // `polygons` is deliberately NOT written: the source is outer-rings-
      // only, so the consumer's own `polygons ?? rings.map((r) => [r])`
      // fallback produces exactly the same grouping — and writing it would
      // have carried every coordinate twice, which measured as 3,945 KiB
      // against 1,947 KiB for the land regions alone.
      out.push({ properties, geometryType: "polygon", rings });
      continue;
    }
    out.push({ properties, geometryType: "line", rings });
  }
  return out;
}

/**
 * Fetch and decode one row's file.
 *
 * `fetchImpl` is the transport seam every test injects, for the reason
 * `mapsOsm.ts`'s `createOsmSource` has one: these are real network assets and
 * a test suite must never depend on the site being served.
 */
export async function loadMapDataset(
  row: MapDatasetRow,
  fetchImpl: typeof fetch = fetch,
): Promise<MapDataset> {
  const res = await fetchImpl(row.url);
  if (!res.ok) throw new Error(`glyphcss website: failed to load ${row.label} dataset at ${row.url} (${res.status}).`);
  const wire = (await res.json()) as MapDatasetWire;
  return {
    row,
    collection: { features: decodeMapDataset(wire), attribution: row.credit },
    source: wire.meta?.source ?? row.label,
    license: wire.meta?.license ?? "",
  };
}

export interface MapDatasetLayerOptions {
  /** Row ids that are switched on. */
  readonly enabled: readonly string[];
  /** Per-row density; a row not named here, or naming {@link MAP_DATASET_DEFAULT_DENSITY}, mounts with no `density` at all and stays in the base grid. */
  readonly densities?: Readonly<Record<string, number>>;
  /** Per-row label placement; read only by a `symbol` row. */
  readonly anchors?: Readonly<Record<string, GlyphMapLabelAnchor>>;
}

/**
 * Ready-to-mount layers for the enabled rows whose data has ARRIVED.
 *
 * A row that is switched on but whose fetch has not landed simply produces
 * no layer this render — it appears when the data does, which is the same
 * shape `MapsWorkbench.tsx`'s point layers already have while a tile
 * pyramid's manifest resolves.
 *
 * `density` is omitted at {@link MAP_DATASET_DEFAULT_DENSITY} rather than
 * passed as `1`. The two are not equivalent for a `line` row: a genuine
 * value routes the stroke into its own full-viewport overlay grid with its
 * own depth pass, where an omitted one stamps into the grids the scene
 * already produces (`GlyphMapLineLayer.density`). Passing `1` explicitly
 * happens to take the same branch today, and omitting it is the statement
 * that this row has no resolution preference — which is what a row at the
 * default means.
 */
export function mapDatasetLayers(
  loaded: Readonly<Record<string, MapDataset | undefined>>,
  { enabled, densities = {}, anchors = {} }: MapDatasetLayerOptions,
) {
  const on = new Set(enabled);
  const layers = [];
  for (const row of MAP_DATASET_ROWS) {
    if (!on.has(row.id)) continue;
    const data = loaded[row.id];
    if (!data) continue;
    const density = densities[row.id] ?? MAP_DATASET_DEFAULT_DENSITY;
    const withDensity = density === MAP_DATASET_DEFAULT_DENSITY ? {} : { density };
    const base = { id: row.id, source: data.collection, color: row.color };
    if (row.type === "circle") {
      layers.push({ ...base, type: "circle" as const, radius: row.radius ?? 2 });
    } else if (row.type === "symbol") {
      layers.push({
        ...base,
        type: "symbol" as const,
        textProperty: row.textProperty ?? "name",
        textAnchor: anchors[row.id] ?? MAP_DATASET_DEFAULT_ANCHOR,
      });
    } else if (row.type === "line") {
      layers.push({ ...base, type: "line" as const, ...withDensity });
    } else {
      layers.push({ ...base, type: "fill" as const, ...withDensity });
    }
  }
  return layers;
}

/**
 * What each row IS, and when it draws something — the tooltip on the row's
 * own name.
 *
 * Every one of these says the SCALE the row is legible at, because that is
 * the question these five raise and the OSM card learned to answer: a row
 * that draws nothing at the span the reader is on reads as broken, and
 * "4,351 dots, world-wide, visible at every span" is the sentence that stops
 * it doing so.
 */
export const MAP_DATASET_ROW_SUMMARIES: Readonly<Record<string, string>> = {
  "ds-regions": "Natural Earth's 1,046 named LAND regions — islands and island groups, mountain ranges, plateaus, deserts, plains, capes and continents — as filled areas draped on the terrain. Physical geography, not political: nothing here is a country. Global; every feature is at least ~20 km², so the row draws at every span. Public domain.",
  "ds-marine": "Natural Earth's 292 named MARINE areas — oceans, seas, gulfs, bays, straits, sounds, channels, lagoons and fjords — as filled areas. The counterpart to Land regions, from a second Natural Earth file, so the two are two rows: naming the seas and shading every mountain range are different requests. Public domain.",
  "ds-cables": "The 712 submarine fibre-optic cables of TeleGeography's Submarine Cable Map, as their real routes. The one dataset here whose SHAPE is the point of it, and it reads best at ocean scale — a cable is thousands of kilometres long and crosses the antimeridian, which is why the prepared file is split at the seam. Licensed CC BY-NC-SA 3.0: non-commercial, share-alike, and credited on the map whenever this row is on.",
  "ds-datacenters": "4,351 OpenStreetMap data centres (`telecom=data_center`) as markers. OSM records most of them as BUILDING FOOTPRINTS, which are four orders of magnitude below one character at a world view, so each is drawn at the centroid of its own largest ring instead. The clusters are the story — Northern Virginia, Amsterdam, Singapore. ODbL; credited whenever this row is on.",
  "ds-dams": "704 dams and hydroelectric plants from Open Infrastructure Map's OpenStreetMap extract, LABELLED with their names rather than dotted — 704 is few enough that the declutter arbiter can show the names, and a dam's name is the thing worth reading. Like the data centres, each footprint is reduced to a representative point. ODbL; credited whenever this row is on.",
};

export function mapDatasetRowTooltip(id: string): string | null {
  return MAP_DATASET_ROW_SUMMARIES[id] ?? null;
}

/** The card's provenance row: how many rows are loaded, and the total the reader has actually fetched. */
export function mapDatasetSourceLabel(loaded: Readonly<Record<string, MapDataset | undefined>>): string {
  const ready = MAP_DATASET_ROWS.filter((r) => loaded[r.id]).length;
  if (ready === 0) return "nothing fetched yet";
  return `${ready} of ${MAP_DATASET_ROWS.length} loaded`;
}
