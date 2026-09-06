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

export interface MapOsmLayerOptions {
  /** Which {@link MAP_OSM_SUBLAYERS} rows are on. Order and membership come straight from the card. */
  readonly enabled: readonly string[];
  /** The card's one density slider, applied to every enabled row (glyphcss's per-mesh detail resolution / stroke overlay density). */
  readonly density: number;
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
    densities: Object.fromEntries(opts.enabled.map((id) => [id, opts.density])),
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
