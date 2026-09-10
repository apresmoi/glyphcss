/**
 * The /maps page's OpenStreetMap slice: the source it mounts, and the two
 * strings the rail card shows about it.
 *
 * ## The source is the planet, on demand
 *
 * This page used to fetch ONE vendored 150 KB Protomaps archive — a reviewed
 * ~4 km extract of Zürich at zoom 12 — read it whole, and then spend a whole
 * card explaining that its data covered four square kilometres of a page that
 * opens on the globe: an extent row, a live in/out-of-coverage row, and a
 * "fly there" button whose only job was to make the toggle produce a visible
 * result. All three existed because the DATA was wrong, not because the
 * presentation was.
 *
 * The data is now {@link glyphMapOpenFreeMapProvider}: OpenFreeMap's whole
 * planet, OpenMapTiles schema, z0–z14, served with no API key and no
 * registration (`packages/maps/src/vector/openfreemap.ts` documents the
 * endpoint and how each fact about it was verified). It is a
 * `GlyphMapVectorProvider`, so the widget's existing sweep — tile cache,
 * in-flight guard, 180 ms gesture-gated debounce, LOD by degrees-per-cell —
 * streams whatever the current view is looking at. Panning to Osaka now
 * shows Osaka, so the extent/coverage/fly apparatus is gone with the extract
 * that needed it.
 *
 * Nothing here points at anyone's private infrastructure: OpenFreeMap
 * explicitly offers this hosting publicly, which is why it is the default.
 * {@link MapOsmSourceOptions.tileUrl} is the opt-in for a planet you host
 * yourself (OpenFreeMap publish Btrfs/MBTiles images for exactly that), and
 * it takes the same `{z}/{x}/{y}` template every other OpenMapTiles endpoint
 * does.
 *
 * ## Why the loader is wrapped
 *
 * Every mounted layer runs its OWN tile sweep with its OWN cache
 * (`widget.ts`'s `createFeatureLayerRuntime`), and this card mounts one layer
 * per row on ONE provider. Their sweeps run in the same tick, so without
 * deduplication a world view costs one request per ENABLED ROW for the very
 * same `0/0/0`. {@link createOsmSource} therefore shares in-flight requests
 * by address. In-flight only, never a retained cache: each layer runtime
 * already retains what it fetched, so a second cache here would pin the
 * whole panned-over planet in memory to save a hit the browser's own HTTP
 * cache already absorbs.
 *
 * ## Failure
 *
 * A tile that 404s, times out or arrives undecodable resolves EMPTY — that
 * region has no data this frame, the rest of the frame is unaffected, and
 * the layer never blanks (the provider's own contract; `openfreemap.test.ts`
 * pins all three cases). {@link MapOsmSourceOptions.onError} is how the card
 * still gets to say so instead of the reader guessing.
 */
import {
  GLYPH_MAP_LABEL_ANCHORS,
  GLYPH_MAP_OPENMAPTILES_LAYERS,
  glyphMapOpenFreeMapProvider,
  glyphMapOpenMapTilesLayers,
  type GlyphMapLabelAnchor,
  type GlyphMapVectorProvider,
  type GlyphMapVectorTile,
} from "@glyphcss/maps";

/** The card's rows, in the order the OpenMapTiles schema mapping declares them (ground → water → lines → buildings → labels). */
export const MAP_OSM_SUBLAYERS = GLYPH_MAP_OPENMAPTILES_LAYERS.map((spec) => ({
  id: spec.id,
  label: spec.label,
  type: spec.type,
  sourceLayer: spec.sourceLayer,
}));

/**
 * The OpenMapTiles source layers this page can render — derived from the
 * rows above rather than listed, so a row and its data can never drift apart.
 *
 * Passing them narrows DECODING: a z14 city tile also carries every house
 * number and every street-name label, and nothing on this page has a row for
 * either.
 */
export const MAP_OSM_SOURCE_LAYERS: readonly string[] = [...new Set(MAP_OSM_SUBLAYERS.map((s) => s.sourceLayer))];

/**
 * Which rows start on.
 *
 * The test is what a row DRAWS at the scale the page opens at, not whether
 * it is interesting. `water`, `boundary`, `place` and `water_name` carry
 * data from z0 and `transportation` from z4, so these draw something on the
 * page's own opening view. `building` starts at z13 — a default-on buildings
 * row would be an empty layer at every scale the page opens at, which is the
 * exact "did I break it" reading this card spent its previous life
 * apologising for.
 *
 * `omt-water-labels` is the only one of the three rows appended with the
 * `park`/`aeroway`/`water_name` mapping that passes it: the opening globe
 * gets the four ocean names, and until it existed the world view labelled no
 * water at all. It names LAKES too once the reader zooms in — that took the
 * row accepting the layer's LINE labels as well as its points, which is a
 * `@glyphcss/maps` change (`glyphMapLabelAnchorPoint`), not one here. `omt-parks` (`park`, z4+) and `omt-aeroways` (`aeroway`,
 * z10+) draw nothing there and start off, beside `landcover`/`landuse`,
 * which have the same shape of reason.
 *
 * This list is the PAGE's opening selection and nothing else. What an omitted
 * `O` token decodes to is `MAPS_OSM_MASK_LINK_DEFAULT` (`mapsUrlState.ts`),
 * frozen at the four rows that were on before this one arrived — deriving the
 * codec's omission sentinel from this list instead meant a link that turns the
 * OSM card on and leaves its rows at the default (`/maps?m=p3L1b`) started
 * labelling every ocean the day the row was appended. A link carrying an
 * explicit `O` written before the row existed has that bit clear either way,
 * so it opens the card without the row; and because this list differs from the
 * frozen one, a share written from a fresh page carries an explicit `O` and
 * restores exactly what its author saw.
 */
export const MAP_OSM_DEFAULT_ON: readonly string[] = ["omt-water", "omt-waterways", "omt-roads", "omt-boundaries", "omt-water-labels"];

export interface MapOsmSourceOptions {
  /**
   * `{z}/{x}/{y}` tile template. Omitted = OpenFreeMap's public planet. Set
   * it to serve a planet you host yourself; that is opt-in and never a
   * default.
   */
  readonly tileUrl?: string;
  /** Transport seam — injected by tests, and where a self-hosted deployment would add a timeout or an auth header. */
  readonly fetchTile?: (url: string, z: number, x: number, y: number) => Promise<ArrayBuffer>;
  /** Called once per tile that failed to load or decode. The tile still resolves empty. */
  readonly onError?: (error: unknown, tile: { readonly z: number; readonly x: number; readonly y: number }) => void;
}

/** The page's OSM source: OpenFreeMap's planet, decoded to this page's rows, with one network request per tile per tick. */
export function createOsmSource(opts: MapOsmSourceOptions = {}): GlyphMapVectorProvider {
  const provider = glyphMapOpenFreeMapProvider({
    layers: MAP_OSM_SOURCE_LAYERS,
    ...(opts.tileUrl === undefined ? {} : { tileUrl: opts.tileUrl }),
    ...(opts.fetchTile === undefined ? {} : { fetchTile: opts.fetchTile }),
    ...(opts.onError === undefined ? {} : { onError: opts.onError }),
  });

  const inFlight = new Map<string, Promise<GlyphMapVectorTile>>();
  return {
    ...provider,
    loadTile(z, x, y) {
      const key = `${z}/${x}_${y}`;
      const held = inFlight.get(key);
      if (held) return held;
      const pending = provider.loadTile(z, x, y).finally(() => { inFlight.delete(key); });
      inFlight.set(key, pending);
      return pending;
    },
  };
}

/**
 * The density every row opens on, and the value a row absent from a density
 * record is read as. `1` is glyphcss's own "no separate pass" number on both
 * paths this card feeds — `isDetailMesh` ignores a per-mesh `density` of 1,
 * and `syncViewportOverlayDensities` drops a stroke density of 1 before it
 * reaches `setViewportOverlayDensities` — so an untouched card costs exactly
 * what it always did.
 */
export const MAP_OSM_DEFAULT_DENSITY = 1;

/** One density per {@link MAP_OSM_SUBLAYERS} row, keyed by row id. */
export type MapOsmDensities = Readonly<Record<string, number>>;

/**
 * A complete record with every row at `value`.
 *
 * The card itself no longer has a gesture that does this — per-row control
 * replaced the master slider, which is the whole point of per-row. What is
 * left are the two callers that legitimately speak for every row at once:
 * a legacy `Q`-only link's seed (`mapsUrlState.ts`), which is exactly the
 * map such a link described — one number applied to every enabled row — and
 * the bench hook `__glyphMapsBench.setOsmDensities`, which prices the card
 * as a whole before `setOsmDensityRow` prices one row.
 */
export function mapOsmDensityRecord(value: number): Record<string, number> {
  return Object.fromEntries(MAP_OSM_SUBLAYERS.map((s) => [s.id, value]));
}

/**
 * The one number that is still true about the whole card: the shared value
 * while every row agrees, and `null` — "mixed" — as soon as one differs.
 *
 * This was the card's master slider's reading. The card has no master any
 * more, but the LINK still does: `MapsUrlState.osmDensity` (token `Q`) is
 * kept written for links already shared, and a uniform card is exactly the
 * case where one float describes it honestly. A mixed card answers `null`,
 * which `MapsWorkbench` writes as the default — the codec omits a field at
 * its default, so saying nothing costs nothing and `M`/`J` carry the truth
 * either way. That is this function's only remaining caller, and it is why
 * removing the master control needed no codec change at all.
 *
 * A row the record does not carry counts as {@link MAP_OSM_DEFAULT_DENSITY},
 * never as absent: "nine rows at 3x and one unset" is a mixed card, and
 * skipping the hole would write 3x for a card that is not at 3x.
 */
export function mapOsmMasterDensity(densities: MapOsmDensities): number | null {
  let shared: number | null = null;
  for (const spec of MAP_OSM_SUBLAYERS) {
    const value = densities[spec.id] ?? MAP_OSM_DEFAULT_DENSITY;
    if (shared === null) shared = value;
    else if (shared !== value) return null;
  }
  return shared;
}

/**
 * How many full-viewport overlay grids the card's CURRENT stroke densities
 * ask the scene for — the one cost a reader of this card can actually spend
 * by accident.
 *
 * `line` rows own no mesh. They are stamped post-raster, and
 * `syncViewportOverlayDensities` (`widget.ts`) routes the SET of distinct,
 * non-1 stroke densities to `scene.setViewportOverlayDensities`, each of
 * which is another full-viewport grid with its own geometry depth pass. So
 * three stroke rows sharing one number cost ONE grid and three holding
 * different numbers cost THREE — measured at 140x63 over a relief mesh:
 * 6.6 ms/render with no overlay, 27.4 ms with one at 2x, and 63.4 ms with
 * three at 2/2.1/2.2 (three grids at the SAME resolution, so that 2.3x is
 * the grid COUNT and not the sharpness). Only rows that are ON are counted:
 * a switched-off layer is not mounted and asks for nothing.
 */
export function mapOsmStrokeOverlayCount(
  rows: readonly { readonly id: string; readonly type: string; readonly on: boolean; readonly density: number }[],
): number {
  const distinct = new Set<number>();
  for (const row of rows) {
    if (row.type !== "line" || !row.on) continue;
    if (row.density !== MAP_OSM_DEFAULT_DENSITY) distinct.add(row.density);
  }
  return distinct.size;
}

/**
 * The label placements the card offers, and their WIRE ORDER.
 *
 * `@glyphcss/maps`' own list, re-exported under this page's naming rather
 * than copied, for the reason {@link MAP_OSM_SUBLAYERS} is derived: the
 * vocabulary belongs to the package (it is MapLibre's `text-anchor`, and the
 * package's `glyphMapLabelAnchorFraction` is the one table both halves of a
 * placement read), and a second copy here could disagree with it.
 *
 * The order is a WIRE FORMAT: `mapsUrlState.ts` packs a row's placement as
 * this list's INDEX, so it is append-only exactly like
 * `MAPS_OSM_SUBLAYER_KEYS`, and `mapsUrlState.osmLabels.test.ts` pins it.
 */
export const MAP_OSM_LABEL_ANCHORS: readonly GlyphMapLabelAnchor[] = GLYPH_MAP_LABEL_ANCHORS;

/**
 * The placement every labelled row opens on, and the value a row absent from
 * an anchor record is read as.
 *
 * `"center"` is what a `symbol` layer has always drawn — `glyphMapLabelPlacement`
 * answers `null` for it, so nothing downstream touches the label element's
 * transform or the declutter arbiter's candidate, and an untouched card is
 * byte-identical rather than merely equivalent.
 */
export const MAP_OSM_DEFAULT_ANCHOR: GlyphMapLabelAnchor = "center";

/** One placement per {@link MAP_OSM_SUBLAYERS} row, keyed by row id. */
export type MapOsmAnchors = Readonly<Record<string, GlyphMapLabelAnchor>>;

/**
 * A complete record with every row at `anchor`.
 *
 * The card has no gesture that does this — placement is per row, which is
 * the whole point. It exists for the same two callers
 * {@link mapOsmDensityRecord} has: a seed over the full row list, and the
 * bench hook that prices the card as a whole.
 */
export function mapOsmAnchorRecord(anchor: GlyphMapLabelAnchor): Record<string, GlyphMapLabelAnchor> {
  return Object.fromEntries(MAP_OSM_SUBLAYERS.map((s) => [s.id, anchor]));
}

export interface MapOsmLayerOptions {
  /** Which {@link MAP_OSM_SUBLAYERS} rows are on. Order and membership come straight from the card. */
  readonly enabled: readonly string[];
  /**
   * Each row's own glyph density, keyed by row id (glyphcss's per-mesh
   * detail resolution for the mesh rows, stroke overlay density for the
   * `line` ones). A row absent from the record mounts at
   * {@link MAP_OSM_DEFAULT_DENSITY}.
   *
   * Per ROW, not one number for the card, because the two kinds of row cost
   * differently and a reader should be able to spend on the one they are
   * reading: `fill`/`fill-extrusion` rows are free to differ (each already
   * has its own `<pre>` the moment it leaves 1x, and they carry no
   * `detailGroup`), while each DISTINCT `line` density is another
   * full-viewport overlay grid with its own depth pass
   * (`syncViewportOverlayDensities`). `mapsOsmDensity.cost.test.ts` pins
   * both.
   */
  readonly densities: MapOsmDensities;
  /**
   * Each row's own label placement, keyed by row id. A row absent from the
   * record mounts at {@link MAP_OSM_DEFAULT_ANCHOR}, and only a `symbol` row
   * reads one at all — `glyphMapOpenMapTilesLayers` drops an entry naming
   * any other row rather than forwarding it.
   *
   * Per ROW, not one placement for the card, because it is a cartographic
   * decision about a CLASS of things: a city name reads best beside its
   * point (which is what a `circle` row's dot sits on) while a lake's name
   * reads best across the water it names. One card-wide anchor would be the
   * same mistake the master density slider was.
   */
  readonly anchors?: MapOsmAnchors;
}

/**
 * The layers the card's current state mounts, all sharing ONE source.
 *
 * Every layer built here carries the provider's own attribution, so
 * `map.getAttributions()` picks the ODbL credit up from the mounted layer
 * itself — the page writes no attribution string anywhere.
 */
export function mapOsmLayers(source: GlyphMapVectorProvider, opts: MapOsmLayerOptions) {
  return glyphMapOpenMapTilesLayers(source, {
    include: opts.enabled,
    densities: Object.fromEntries(
      opts.enabled.map((id) => [id, opts.densities[id] ?? MAP_OSM_DEFAULT_DENSITY]),
    ),
    // Handed over whole, exactly as the densities are. Which entries mean
    // anything is `glyphMapOpenMapTilesLayers`' call: it drops a row that
    // draws no labels and a row naming the centred default, so the rule that
    // keeps an untouched card's layer objects identical lives in ONE place
    // rather than being enforced here and re-checked there.
    textAnchors: Object.fromEntries(
      opts.enabled.map((id) => [id, opts.anchors?.[id] ?? MAP_OSM_DEFAULT_ANCHOR]),
    ),
  });
}

/** The card's one provenance row — every part of it read off the provider, so it cannot describe a source the page is not mounting. */
export function mapOsmSourceLabel(source: GlyphMapVectorProvider): string {
  const zooms = source.zooms.map((l) => l.z);
  const min = Math.min(...zooms);
  const max = Math.max(...zooms);
  return `OpenFreeMap · OpenMapTiles · z${min}–${max}`;
}

/**
 * What to say when tiles did not arrive — `null` when none failed, which is
 * the normal case and gets no row at all.
 *
 * Missing tiles are a THINNER frame, not a broken layer: the rest of the view
 * drew from the tiles that did arrive. The row says how many so the reader
 * can tell a patchy render from a bug in the page.
 */
export function mapOsmMissingTilesLabel(missing: number): string | null {
  if (missing <= 0) return null;
  return `${missing} tile${missing === 1 ? "" : "s"} unavailable`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Row tooltips
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The first zoom each OpenMapTiles source layer carries data at, read out of
 * the vendored `packages/maps/fixtures/openfreemap/tilejson.json` — the real
 * `https://tiles.openfreemap.org/planet` manifest — and never out of the
 * schema docs, which describe an idealized pyramid rather than the one this
 * page mounts. `mapsOsm.tooltips.test.ts` re-reads that fixture on every run,
 * so a drift is a red test rather than a tooltip promising a layer that is
 * not there.
 *
 * It is keyed by SOURCE LAYER, not by row id: the zoom is a property of the
 * service's pyramid, and two rows on one source layer would answer with one
 * number.
 */
export const MAP_OSM_SOURCE_MIN_ZOOM: Readonly<Record<string, number>> = {
  aerodrome_label: 8,
  aeroway: 10,
  boundary: 0,
  building: 13,
  housenumber: 14,
  landcover: 0,
  landuse: 4,
  mountain_peak: 7,
  park: 4,
  place: 0,
  poi: 11,
  transportation: 4,
  transportation_name: 6,
  water: 0,
  water_name: 0,
  waterway: 3,
};

/**
 * What a source layer's own `minzoom` reads as to somebody LOOKING at the
 * page, banded from the coarsest threshold down.
 *
 * A z-number is the wrong thing to print here, and not merely because it is
 * jargon: this page has no zoom number to compare it against. Its LOD picker
 * (`glyphMapTargetLOD`) matches the level's degrees per TILE PIXEL against
 * the view's degrees per CHARACTER CELL, and a character cell is roughly ten
 * tile pixels wide, so a layer arrives about 3.4 levels later than its
 * `minzoom` suggests on a slippy map. Solving `span/cols <= (360/2^z)/256`
 * at the page's own 140 columns gives the span each level is first requested
 * at — z3 at ~25° (a continent), z4 at ~12° (a country), z7 at ~1.5° (~170 km,
 * a range or a valley), z10 at ~0.19° (~21 km, a city), z13 at ~0.024°
 * (~2.7 km, a few blocks) — and those are the scales named below.
 *
 * A layer at `minzoom: 0` gets no note at all: it draws from the opening
 * globe, which is the case that needs no explaining.
 */
const MAP_OSM_SCALE_NOTES: readonly { readonly minZoom: number; readonly note: string }[] = [
  { minZoom: 13, note: "Draws only at street scale, a few blocks across." },
  { minZoom: 10, note: "Draws only once you are zoomed into a city." },
  { minZoom: 7, note: "Draws only once you are zoomed into a region — a range or a valley." },
  { minZoom: 4, note: "Draws only once the view is down to about one country." },
  { minZoom: 1, note: "Not on the opening globe; draws from a continental view down." },
];

/** How this page's scale reads for a source layer, or `null` when the layer draws from the globe. */
export function mapOsmScaleNote(sourceLayer: string): string | null {
  const minZoom = MAP_OSM_SOURCE_MIN_ZOOM[sourceLayer];
  if (minZoom === undefined) return null;
  for (const band of MAP_OSM_SCALE_NOTES) if (minZoom >= band.minZoom) return band.note;
  return null;
}

/**
 * Plain-English names for the three exclusion axes
 * {@link GLYPH_MAP_OPENMAPTILES_LAYERS} actually uses, so the sentence a row
 * shows is a rendering of the filter the row mounts rather than a second
 * description of it that can drift. An axis value with no entry falls back to
 * the raw schema token — wrong-sounding, but never silently absent.
 */
const MAP_OSM_BRUNNEL_DROPS: Readonly<Record<string, string>> = {
  tunnel: "tunnels and culverts (the bridge over one still draws)",
  bridge: "bridges",
};
const MAP_OSM_SERVICE_DROPS: Readonly<Record<string, string>> = {
  driveway: "driveways",
  parking_aisle: "parking aisles",
};
const MAP_OSM_FLAG_DROPS: Readonly<Record<string, string>> = {
  maritime: "maritime (EEZ) lines across open ocean",
  disputed: "disputed claims",
  indoor: "indoor paths",
  hide_3d: "outlines the data marks as mapped part-by-part (extruding one swallows the buildings inside it)",
};

/** `2` = country, `4` = state/province. Only the cuts the table actually takes need an entry. */
const MAP_OSM_ADMIN_LEVEL_NOTES: Readonly<Record<number, string>> = {
  2: "International borders only — no state, province or county lines.",
  4: "Down to state and province lines only — nothing more local.",
};

function mapOsmJoin(parts: readonly string[]): string {
  if (parts.length <= 1) return parts[0] ?? "";
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

/**
 * The sentences a row's own filter axes earn, derived from the spec in
 * {@link GLYPH_MAP_OPENMAPTILES_LAYERS} rather than written out beside it.
 *
 * This is the honest half of a tooltip and the half that prevents a bug
 * report: a reader who cannot find the tunnel they know is there, or the
 * county line, or the bench outside the station, is looking at a deliberate
 * drop. Deriving it means a row that stops dropping something stops claiming
 * to.
 */
function mapOsmFilterNotes(spec: (typeof GLYPH_MAP_OPENMAPTILES_LAYERS)[number]): string[] {
  const notes: string[] = [];
  if (spec.maxAdminLevel !== undefined) {
    notes.push(MAP_OSM_ADMIN_LEVEL_NOTES[spec.maxAdminLevel]
      ?? `Only boundaries at administrative level ${spec.maxAdminLevel} or above.`);
  }
  if (spec.maxRank !== undefined) {
    notes.push(`Thinned to the data's own top ${spec.maxRank} by importance rank.`);
  }
  if (spec.requireProperties?.includes("name")) {
    notes.push("Only named features are drawn.");
  }
  if (spec.excludeClasses && spec.excludeClasses.length > 0) {
    notes.push(`Dropped as clutter: ${mapOsmJoin(spec.excludeClasses.map((c) => c.replace(/_/g, " ")))}.`);
  }
  const hidden = [
    ...(spec.excludeBrunnel ?? []).map((v) => MAP_OSM_BRUNNEL_DROPS[v] ?? v),
    ...(spec.excludeService ?? []).map((v) => MAP_OSM_SERVICE_DROPS[v] ?? v),
    ...(spec.excludeFlags ?? []).map((v) => MAP_OSM_FLAG_DROPS[v] ?? v),
  ];
  if (hidden.length > 0) notes.push(`Deliberately hidden: ${mapOsmJoin(hidden)}.`);
  return notes;
}

/**
 * What each row IS, in one sentence — the only hand-written half of a
 * tooltip, and deliberately the half no table can derive.
 *
 * A row's `label` already says its name; this says the thing the name does
 * not, which is usually the GEOMETRY the source layer holds ("Water" is
 * areas and "Waterways" is lines — the single most asked question about this
 * card) or what the row is a proxy for. The scale and the filtering are
 * appended from the layer table by {@link mapOsmSublayerTooltip}, so nothing
 * here restates them.
 *
 * Keyed by row id and required to be TOTAL over
 * {@link MAP_OSM_SUBLAYERS} — `mapsOsm.tooltips.test.ts` fails on a row with
 * no entry, so a row appended to `@glyphcss/maps` cannot ship here with a
 * silent gap.
 */
export const MAP_OSM_ROW_SUMMARIES: Readonly<Record<string, string>> = {
  "omt-landcover":
    "Natural ground — woodland, grass, farmland, wetland, sand, bare rock and ice, each painted in its own tone.",
  "omt-landuse":
    "What the ground is USED for — housing, shops, industry, schools and hospitals, pitches and cemeteries. Sits on top of land cover.",
  "omt-water":
    "Water as AREAS — oceans, lakes, ponds and wide rivers, each kind in its own blue (a swimming pool is not the blue of the Pacific).",
  "omt-waterways":
    "Rivers, streams and canals as LINES — the narrow water that is too thin to have an area of its own.",
  "omt-roads":
    "The street and rail network as lines, from motorways down to footpaths.",
  "omt-buildings":
    "Building footprints extruded to their real height, standing on the terrain under them, with textured facades and a tone of their own.",
  "omt-boundaries":
    "Administrative borders, drawn as lines.",
  "omt-places":
    "Place names — countries, cities, towns and suburbs, printed at their own point, the more important one winning a collision.",
  "omt-peaks":
    "Summits, labelled with their height in metres (\"Matterhorn 4478\").",
  "omt-pois":
    "Points of interest as plain dots — shops, stations, hospitals, schools. The dot says where something is, not what it is.",
  "omt-parks":
    "Protected land — national parks, nature reserves, recreation areas. A label rather than a green wash, which would paint over the lake inside the park.",
  "omt-aeroways":
    "Airport ground as lines — runways, taxiways and aprons.",
  "omt-water-labels":
    "The names of water bodies — the four oceans at world scale, then lakes and reservoirs as you go in.",
};

/**
 * The row's whole tooltip: what it is, when it appears, and what it drops —
 * summary first, then the scale note and the filter notes derived from
 * {@link GLYPH_MAP_OPENMAPTILES_LAYERS} and {@link MAP_OSM_SOURCE_MIN_ZOOM}.
 *
 * `null` — never a placeholder — for a row with no summary, so a row appended
 * to the package renders no tooltip rather than an empty or invented one, and
 * the gap is what the test catches.
 */
export function mapOsmSublayerTooltip(id: string): string | null {
  const summary = MAP_OSM_ROW_SUMMARIES[id];
  if (summary === undefined || summary === "") return null;
  const spec = GLYPH_MAP_OPENMAPTILES_LAYERS.find((s) => s.id === id);
  if (spec === undefined) return summary;
  return [summary, mapOsmScaleNote(spec.sourceLayer), ...mapOsmFilterNotes(spec)]
    .filter((part): part is string => part !== null)
    .join(" ");
}
