/**
 * The /maps page's PLACE SEARCH slice: turning the two baked point pyramids
 * into one in-memory search index, ranking a typed query against it, and
 * deriving the flight that goes there.
 *
 * Pure and DOM-free on purpose — `MapSearchBox.tsx` is the front end, and
 * `MapsWorkbench.tsx` only wires the providers and the `flyTo`. Everything
 * that can be gotten wrong (which level is complete, what beats what, where
 * a result is framed, whether the tilt is levelled) is decided here, where a
 * test can reach it: `MapsWorkbench.tsx` itself cannot be mounted under this
 * vitest config (`CodePanel` pulls in `@glyphcss/core`, undeclared in
 * `website/package.json`), which is the same reason `mapsOsm.ts` exists.
 *
 * ## Which level is indexed, and why
 *
 * Both point pyramids THIN by zoom, each using its source's own prominence
 * column: `bake-place-tiles.mjs` drops places above a per-zoom `scalerank`
 * ceiling, `bake-country-tiles.mjs` drops countries above a per-zoom
 * `LABELRANK` ceiling. Only the DEEPEST level of each carries the ceiling
 * `Infinity` — i.e. every feature. A search box indexed at any shallower
 * level would silently be unable to find San Marino or Reykjavík, which is
 * the one failure a search box must not have, so the loader reads the
 * deepest level each provider DECLARES (`mapSearchDeepestZoom`) rather than a
 * hardcoded 4 that a re-bake could quietly invalidate. That is 147 place
 * tiles + 81 country tiles (~1 MB) — paid lazily, on the first focus or
 * keystroke, never at page load.
 *
 * Addresses the bake wrote no tile for are answered locally by the providers'
 * own manifest tile index, with no network round trip, so the sweep costs one
 * request per tile that actually exists.
 *
 * ## Where country bounds come from
 *
 * The country pyramid is Natural Earth's cartographer-placed LABEL POINTS —
 * it has no geometry, so a country in it has no extent of its own. The page
 * already loads a second pyramid that does: the world-atlas admin-0 POLYGONS
 * behind the Borders layer (`vectorTilesProvider.ts`). Its SHALLOWEST level
 * is one whole-world tile whose rings are unclipped, so a single extra tile
 * read yields a real bounding box per country, joined by folded name — 176 of
 * the 242 join (measured); the 66 that do not are exactly the microstates and
 * single-island nations world-atlas omits at this generalization, and those
 * are the ones a fixed point span frames correctly anyway.
 */
import type {
  GlyphMapBounds,
  GlyphMapFlyToTarget,
  GlyphMapHandle,
  GlyphMapVectorFeature,
  GlyphMapVectorProvider,
} from "@glyphcss/maps";

/** The `sourceLayer` each pyramid's features live under — the bakers' own names. */
const COUNTRY_SOURCE_LAYER = "countries";
const PLACE_SOURCE_LAYER = "places";
const POLYGON_SOURCE_LAYER = "admin0";

/**
 * The tilt a search flight levels to.
 *
 * Identical in value and in reason to {@link MAP_OSM_FLY_TILT} (`mapsOsm.ts`,
 * where the arithmetic is written out): on an ORBIT projection `tilt` adds an
 * ABSOLUTE pitch to `cameraForCenter` while the field of view shrinks with the
 * zoom, so a flight into place scale that kept the page's default 40 degrees
 * arrives with the destination thousands of rows off the grid. A search box
 * that flies somewhere the reader cannot see is worse than no search box, so
 * every flight from here levels — unconditionally, rather than on a
 * span-and-projection threshold whose right value differs per projection, per
 * grid shape and per centre.
 */
export const MAP_SEARCH_FLY_TILT = 0;

/**
 * The span a POINT result is framed at, in degrees of longitude.
 *
 * Six degrees is ~660 km at the equator. The choice is bounded from below by
 * the data, not by taste: the global terrain pyramid's deepest level is
 * `tileLonSpan 22.5 / tileCols 180` = 0.125 degrees per native sample
 * (`public/data/geo-tiles/manifest.json`), so on a ~140-column grid the map
 * stops gaining detail below a ~17-degree span and merely gains emptiness.
 * Six degrees still puts ~48 native samples across the viewport — enough for
 * the region's relief to read as terrain — while placing the searched point
 * unmistakably at the centre. A city-block span would arrive on interpolated
 * flat ground everywhere outside the curated Swiss levels.
 */
export const MAP_SEARCH_POINT_SPAN = 6;

/** Fraction of a country's own size added as margin when framing it, so its coasts are not flush with the viewport edge. Mirrors `MAP_OSM_FLY_PADDING`. */
export const MAP_SEARCH_BOUNDS_PADDING = 0.15;

/** How many results the list offers. */
export const MAP_SEARCH_LIMIT = 8;

export type MapSearchKind = "country" | "place";

export interface MapSearchResult {
  /** Stable React key — the feature's own baked id, namespaced by kind. */
  readonly id: string;
  readonly kind: MapSearchKind;
  readonly name: string;
  /** What disambiguates two same-named results: a city's country, a country's continent. */
  readonly context: string;
  readonly lngLat: readonly [number, number];
  /** A country's real extent, when the polygon pyramid could supply one. Absent for every place and for a country world-atlas omits. */
  readonly bounds?: GlyphMapBounds;
  /**
   * The prominence this result was ranked by, in its OWN dataset's units —
   * `label_priority` (3..8) for a country, `pop_max` (people) for a place.
   * Kept on the result so the list can print it and a test can assert the
   * ordering against the real column rather than against a derived score.
   */
  readonly prominence: number;
}

interface MapSearchEntry extends MapSearchResult {
  /** {@link mapSearchFold}ed name — what a query is matched against. */
  readonly key: string;
  /** Additional exact-match keys (a country's ISO alpha-3). */
  readonly aliases: readonly string[];
}

export interface MapSearchIndex {
  readonly entries: readonly MapSearchEntry[];
}

/**
 * Case-, accent- and whitespace-insensitive matching key.
 *
 * Natural Earth ships names as they are written — `São Tomé and Principe`,
 * `Curaçao`, `Åland`, `Zürich` — and nobody types the diacritics. NFD splits
 * a precomposed letter into base + combining mark, and the U+0300..U+036F
 * block is exactly those marks, so stripping it leaves the ASCII skeleton.
 */
export function mapSearchFold(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ");
}

/** Characters a name treats as a word start, so `york` finds `New York` but `exand` does not "find" `Alexandria` at the same grade. */
const WORD_BREAK = /[\s\-'(,./]/;

/**
 * How well a folded name answers a folded query. Higher is better; `0` is no
 * match at all.
 *
 * Four grades rather than a similarity score, because the grades are what a
 * reader can predict: an exact name beats a name that merely STARTS with the
 * query, which beats a query landing at a word start inside the name, which
 * beats a query landing mid-word. Fuzzy/edit-distance matching is deliberately
 * not here — on 1,493 names it mostly manufactures wrong answers for typos
 * that a type-ahead list lets the reader correct in one keystroke.
 */
export function mapSearchMatchScore(key: string, query: string): number {
  if (!query) return 0;
  const idx = key.indexOf(query);
  if (idx < 0) return 0;
  if (idx === 0) return key.length === query.length ? 4 : 3;
  return WORD_BREAK.test(key[idx - 1]) ? 2 : 1;
}

/**
 * Which kind wins a tie on match grade. A country outranks a place: it is the
 * containing entity, so `mexico` means the country and `mexico city` — which
 * the country's own name does not contain — still means the city. The two
 * prominence columns are NOT comparable (a `label_priority` of 8 and a
 * `pop_max` of 20,999,000 are different quantities in different units, and
 * even the two baked `pop_scale` columns use deliberately different windows),
 * so no arithmetic could order them against each other honestly; the kind
 * split is what makes the comparison well-defined at all.
 */
const KIND_RANK: Record<MapSearchKind, number> = { country: 1, place: 0 };

/**
 * Rank the index against a query.
 *
 * Order: match grade, then kind (country first), then the result's own
 * prominence within its dataset — `label_priority` for a country, `pop_max`
 * for a place — then name, so the ordering is total and a re-render can never
 * reshuffle the list.
 */
export function searchMapIndex(
  index: MapSearchIndex,
  query: string,
  limit: number = MAP_SEARCH_LIMIT,
): readonly MapSearchResult[] {
  const q = mapSearchFold(query);
  if (!q) return [];
  const scored: { entry: MapSearchEntry; score: number }[] = [];
  for (const entry of index.entries) {
    let score = mapSearchMatchScore(entry.key, q);
    // An alias is a CODE, not a name: it answers an exact query only, so
    // "in" cannot drag India above every city containing those letters.
    if (score < 4 && entry.aliases.includes(q)) score = 4;
    if (score > 0) scored.push({ entry, score });
  }
  scored.sort((a, b) =>
    b.score - a.score
    || KIND_RANK[b.entry.kind] - KIND_RANK[a.entry.kind]
    || b.entry.prominence - a.entry.prominence
    || a.entry.name.localeCompare(b.entry.name));
  return scored.slice(0, limit).map(({ entry }) => entry);
}

/**
 * A feature's bounding box, with the longitude window chosen as the SHORTER
 * of the two ways round the sphere.
 *
 * A ring crossing the antimeridian (Russia, Fiji, the United States with
 * Alaska) has points at both +179 and -179, so a naive min/max reports a box
 * spanning nearly the whole planet — framing it would fly to the middle of
 * the Pacific and zoom all the way out. Re-measuring with negative longitudes
 * unwrapped by +360 and keeping whichever window is narrower recovers the
 * real extent; the result may exceed 180 (Russia lands at 19..190), which
 * `flyTo({ bounds })` handles because its own framing works in spans, not in
 * absolute edges.
 */
export function mapSearchFeatureBounds(feature: GlyphMapVectorFeature): GlyphMapBounds | null {
  let west = Infinity, east = -Infinity, south = Infinity, north = -Infinity;
  let unwrappedWest = Infinity, unwrappedEast = -Infinity;
  let any = false;
  for (const ring of feature.rings ?? []) {
    for (const [lon, lat] of ring) {
      if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;
      any = true;
      west = Math.min(west, lon); east = Math.max(east, lon);
      south = Math.min(south, lat); north = Math.max(north, lat);
      const unwrapped = lon < 0 ? lon + 360 : lon;
      unwrappedWest = Math.min(unwrappedWest, unwrapped);
      unwrappedEast = Math.max(unwrappedEast, unwrapped);
    }
  }
  if (!any) return null;
  return east - west <= unwrappedEast - unwrappedWest
    ? { west, east, south, north }
    : { west: unwrappedWest, east: unwrappedEast, south, north };
}

/**
 * Where a selected result flies to.
 *
 * A country with a real extent is framed by that extent plus a proportional
 * margin; everything else — every place, and every country the polygon
 * pyramid omits — is centred at {@link MAP_SEARCH_POINT_SPAN}. A country
 * SMALLER than that span takes the point span too: Luxembourg's own box is
 * 0.8 degrees wide, and framing it would land below the terrain pyramid's
 * native resolution for the same reason a city-block span would.
 */
export function mapSearchFlyTarget(result: MapSearchResult): GlyphMapFlyToTarget {
  const bounds = result.bounds;
  if (bounds) {
    const lonSpan = bounds.east - bounds.west;
    const latSpan = bounds.north - bounds.south;
    if (Math.max(lonSpan, latSpan) >= MAP_SEARCH_POINT_SPAN) {
      const padLon = lonSpan * MAP_SEARCH_BOUNDS_PADDING;
      const padLat = latSpan * MAP_SEARCH_BOUNDS_PADDING;
      return {
        bounds: {
          west: bounds.west - padLon, east: bounds.east + padLon,
          south: bounds.south - padLat, north: bounds.north + padLat,
        },
      };
    }
    return { center: [(bounds.west + bounds.east) / 2, (bounds.south + bounds.north) / 2], span: MAP_SEARCH_POINT_SPAN };
  }
  return { center: [result.lngLat[0], result.lngLat[1]], span: MAP_SEARCH_POINT_SPAN };
}

/**
 * Everything a selected result does to the map, in one place: LEVEL the tilt,
 * then fly.
 *
 * The order matters and the pairing matters. `tilt` is page state as well as
 * widget state on /maps (the Dock's own slider shows it), so `onTilt` writes
 * the page's copy while `setTilt` writes the widget's — exactly what
 * `flyToOsm` does, and for the same reason. Both happen BEFORE the flight, so
 * no frame of the flight is rendered at a pitch that would carry the
 * destination off the grid.
 *
 * This is a function rather than three lines inside the component because
 * `MapsWorkbench.tsx` cannot be mounted under this vitest config, and the
 * levelling is the part of this feature with a history of going wrong
 * (`mapsOsm.ts`'s {@link MAP_SEARCH_FLY_TILT} note) — so it lives where a
 * test driving the REAL widget can call it and then ask `map.project()`
 * whether the destination is actually on screen.
 */
export function flyToMapSearchResult(
  map: Pick<GlyphMapHandle, "setTilt" | "flyTo">,
  result: MapSearchResult,
  opts: { readonly onTilt?: (tilt: number) => void; readonly durationMs?: number } = {},
): Promise<void> {
  opts.onTilt?.(MAP_SEARCH_FLY_TILT);
  map.setTilt(MAP_SEARCH_FLY_TILT);
  return map.flyTo(mapSearchFlyTarget(result), opts.durationMs === undefined ? {} : { durationMs: opts.durationMs });
}

// ── Index construction ──────────────────────────────────────────────────

function firstPoint(feature: GlyphMapVectorFeature): readonly [number, number] | null {
  const p = feature.rings?.[0]?.[0];
  return p && Number.isFinite(p[0]) && Number.isFinite(p[1]) ? [p[0], p[1]] : null;
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function num(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

export interface MapSearchFeatureSet {
  readonly countries: readonly GlyphMapVectorFeature[];
  readonly places: readonly GlyphMapVectorFeature[];
  /** Admin-0 POLYGONS, for the country bounds join. Empty is fine — every country then falls back to the point span. */
  readonly countryPolygons: readonly GlyphMapVectorFeature[];
}

/** Build the index from already-decoded features. Pure; the loader below is the only thing that touches a provider. */
export function buildMapSearchIndex(features: MapSearchFeatureSet): MapSearchIndex {
  const boundsByName = new Map<string, GlyphMapBounds>();
  for (const poly of features.countryPolygons) {
    const name = mapSearchFold(text(poly.properties?.name));
    if (!name || boundsByName.has(name)) continue;
    const b = mapSearchFeatureBounds(poly);
    if (b) boundsByName.set(name, b);
  }

  const entries: MapSearchEntry[] = [];
  // A point exactly on a tile edge is baked into both neighbours, so the
  // sweep can see the same feature twice. The dedupe key carries the POINT as
  // well as the id: same feature, two tiles, one entry — but two genuinely
  // different features that happen to share an id (or a source with no ids at
  // all) keep both, which is the failure direction a search box can survive.
  const seen = new Set<string>();

  for (const feature of features.countries) {
    const name = text(feature.properties?.name);
    const at = firstPoint(feature);
    if (!name || !at) continue;
    const id = `country:${feature.id ?? name}@${at[0]},${at[1]}`;
    if (seen.has(id)) continue;
    seen.add(id);
    const key = mapSearchFold(name);
    const iso = mapSearchFold(text(feature.properties?.iso_a3));
    entries.push({
      id, kind: "country", name,
      context: text(feature.properties?.continent),
      lngLat: at,
      bounds: boundsByName.get(key),
      prominence: num(feature.properties?.label_priority),
      key,
      aliases: iso ? [iso] : [],
    });
  }

  for (const feature of features.places) {
    const name = text(feature.properties?.name);
    const at = firstPoint(feature);
    if (!name || !at) continue;
    const id = `place:${feature.id ?? name}@${at[0]},${at[1]}`;
    if (seen.has(id)) continue;
    seen.add(id);
    entries.push({
      id, kind: "place", name,
      context: text(feature.properties?.adm0name),
      lngLat: at,
      prominence: num(feature.properties?.pop_max),
      key: mapSearchFold(name),
      aliases: [],
    });
  }

  return { entries };
}

/** The deepest level a provider declares — the only one whose per-zoom thinning ceiling is "everything". */
export function mapSearchDeepestZoom(provider: GlyphMapVectorProvider): number {
  return provider.zooms.reduce((deepest, level) => Math.max(deepest, level.z), 0);
}

/** Every feature under `sourceLayer` at one level of a pyramid. A tile that fails to load is skipped, never fatal — one missing address must not cost the whole index. */
async function sweepLevel(
  provider: GlyphMapVectorProvider,
  z: number,
  sourceLayer: string,
): Promise<readonly GlyphMapVectorFeature[]> {
  const n = 2 ** z;
  const addresses: [number, number][] = [];
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) addresses.push([x, y]);
  const tiles = await Promise.all(
    addresses.map(([x, y]) => provider.loadTile(z, x, y).catch(() => null)),
  );
  const out: GlyphMapVectorFeature[] = [];
  for (const tile of tiles) {
    for (const feature of tile?.layers?.[sourceLayer] ?? []) out.push(feature);
  }
  return out;
}

export interface MapSearchSources {
  readonly countries: GlyphMapVectorProvider;
  readonly places: GlyphMapVectorProvider;
  /** Admin-0 polygons for the bounds join. Optional: without it every country falls back to the point span. */
  readonly countryPolygons?: GlyphMapVectorProvider | null;
}

/**
 * Sweep the deepest level of both point pyramids (and the shallowest — whole
 * world, unclipped — level of the polygon pyramid) into one index. Call it
 * once, lazily; `MapSearchBox` memoizes the promise.
 */
export async function loadMapSearchIndex(sources: MapSearchSources): Promise<MapSearchIndex> {
  const polygons = sources.countryPolygons;
  const [countries, places, countryPolygons] = await Promise.all([
    sweepLevel(sources.countries, mapSearchDeepestZoom(sources.countries), COUNTRY_SOURCE_LAYER),
    sweepLevel(sources.places, mapSearchDeepestZoom(sources.places), PLACE_SOURCE_LAYER),
    polygons
      ? polygons.loadTile(0, 0, 0).then((t) => t.layers?.[POLYGON_SOURCE_LAYER] ?? []).catch(() => [])
      : Promise.resolve([] as readonly GlyphMapVectorFeature[]),
  ]);
  return buildMapSearchIndex({ countries, places, countryPolygons });
}
