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
 * (`widget.ts`'s `createFeatureLayerRuntime`), and this card mounts up to ten
 * layers on ONE provider. Their sweeps run in the same tick, so without
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
  GLYPH_MAP_OPENMAPTILES_LAYERS,
  glyphMapOpenFreeMapProvider,
  glyphMapOpenMapTilesLayers,
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
 * `water`, `boundary` and `place` carry data from z0 and `transportation`
 * from z4, so these draw something on the page's own opening view. `building`
 * starts at z13 — a default-on buildings row would be an empty layer at every
 * scale the page opens at, which is the exact "did I break it" reading this
 * card spent its previous life apologising for.
 */
export const MAP_OSM_DEFAULT_ON: readonly string[] = ["omt-water", "omt-waterways", "omt-roads", "omt-boundaries"];

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
 * This IS the master gesture: the card keeps one slider over all ten rows,
 * and moving it OVERWRITES each of them rather than scaling the spread they
 * currently hold. A ratio was considered and rejected — the master's whole
 * job is "all of it, this dense", and a ratio makes that unreachable from
 * any mixed state without first flattening it by hand. It is also what a
 * legacy `Q`-only link seeds (`mapsUrlState.ts`), which is exactly the map
 * such a link described: one number applied to every enabled row.
 */
export function mapOsmDensityRecord(value: number): Record<string, number> {
  return Object.fromEntries(MAP_OSM_SUBLAYERS.map((s) => [s.id, value]));
}

/**
 * What the master control READS: the shared value while every row agrees,
 * and `null` — "mixed" — as soon as one differs.
 *
 * A row the record does not carry counts as {@link MAP_OSM_DEFAULT_DENSITY},
 * never as absent: "nine rows at 3x and one unset" is a mixed card, and
 * skipping the hole would print 3x over a row that is not at 3x.
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
