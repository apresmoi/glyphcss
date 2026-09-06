/**
 * The /maps page's OpenStreetMap slice: loading the self-hosted Protomaps
 * extract, and the coverage arithmetic the rail card needs to be HONEST about
 * what that extract holds.
 *
 * ## Hosting
 *
 * The shipped archive is the reviewed extract vendored at
 * `packages/maps/fixtures/pmtiles/zurich-z12.pmtiles`, copied into
 * `public/data/osm/` by `scripts/copy-osm-fixture.mjs` at dev/build time (the
 * same one-source-of-truth copy `copy-skill.mjs` does). Protomaps ask people
 * to SELF-HOST rather than read from their buckets, and their public demo
 * bucket 404s, so no default here points at anyone else's infrastructure.
 * {@link createOsmExtract} accepts a caller-supplied URL for a self-hosted
 * archive of your own; that is opt-in and never a default.
 *
 * The archive is fetched WHOLE (150 KB) rather than by HTTP range request.
 * Ranges are the right transport for a large hosted pyramid and the wrong one
 * for an extract smaller than the round-trips it takes to page in — and they
 * additionally need the host to honour `Range`, which a static dev server or
 * a `file://` page may not.
 *
 * ## Coverage
 *
 * The extract is a ~4 km box at one zoom. The page opens on the whole world.
 * Three things together keep that from reading as "the layer is broken":
 *  1. enabling the card FLIES to the extract, levelling the tilt on the way
 *     ({@link mapOsmFlyToTarget}, {@link MAP_OSM_FLY_TILT}), so the toggle
 *     produces a visible result rather than nothing;
 *  2. the card states the extent permanently, as a fact about the data;
 *  3. a live in/out-of-coverage line says whether the CURRENT view is on the
 *     data ({@link mapOsmCoverage}), so panning away explains itself.
 */
import {
  glyphMapPMTilesBufferSource,
  glyphMapProtomapsExtract,
  GLYPH_MAP_PROTOMAPS_LAYERS,
  type GlyphMapBounds,
  type GlyphMapProtomapsExtract,
} from "@glyphcss/maps";

/** Where `scripts/copy-osm-fixture.mjs` puts the vendored extract. Self-hosted, from this repo — never a third-party bucket. */
export const MAP_OSM_ARCHIVE_URL = "/data/osm/zurich-z12.pmtiles";

/** Human name for the shipped extract, used wherever the card names its data. */
export const MAP_OSM_EXTRACT_LABEL = "Zürich";

/** Fraction of the extract's own size added as margin when flying to it, so its edges are not flush with the viewport edge. */
export const MAP_OSM_FLY_PADDING = 0.35;

/**
 * The tilt the OSM flight levels to.
 *
 * `tilt` ADDS to the projection's base orientation, so on an orbit
 * projection it rotates the CAMERA rather than the scene — and a rotation is
 * an absolute angle while the field of view shrinks with the zoom. At the
 * page's default 40 degrees the view centre is still on screen at span 360,
 * lands off the grid by span 40, and by the ~0.07 degrees this extract needs
 * it is more than twenty thousand rows off a 63-row grid. A flight into city
 * scale that kept the tilt would arrive with the destination nowhere near the
 * viewport, which is exactly the "the layer is broken" reading the flight
 * exists to prevent.
 */
export const MAP_OSM_FLY_TILT = 0;

/**
 * How much of the viewport the extract must span before it counts as "in
 * coverage". Being on screen is not the question a reader is asking: a
 * whole-world view does project Zürich onto a cell, and at span 360 over 160
 * columns the entire extract is a fiftieth of ONE CELL — present, and
 * invisible. A twentieth of the viewport is roughly the point at which the
 * data is a shape rather than a speck.
 */
export const MAP_OSM_MIN_VIEW_FRACTION = 0.05;

/** What {@link GlyphMapHandle.project} answers for one lon/lat — taken as a function so this stays pure and testable. */
export type MapOsmProject = (lngLat: readonly [number, number]) => { readonly col: number; readonly row: number; readonly visible: boolean };

/** Where the extract lands on the CURRENT frame: whether any of it is on the grid, and how much of the grid it spans. */
export interface MapOsmCoverage {
  readonly onScreen: boolean;
  /** The extract's projected extent as a fraction of the viewport, on its larger axis. `0` when nothing projects. */
  readonly screenFraction: number;
  readonly inCoverage: boolean;
}

/**
 * Ask the WIDGET where the extract is, rather than comparing geographic
 * boxes. `view.center` is not where an orbit projection is pointing once
 * `tilt` is nonzero (see {@link MAP_OSM_FLY_TILT}), so a box comparison would
 * cheerfully report "in view" for a frame that renders none of the data —
 * the one thing this row exists not to do. `project` already folds in the
 * projection, the camera, the tilt and the grid bounds.
 */
export function mapOsmCoverage(
  bounds: GlyphMapBounds,
  project: MapOsmProject,
  cols: number,
  rows: number,
): MapOsmCoverage {
  // A 3x3 lattice over the extract: corners catch a box straddling the edge
  // of the visible hemisphere, the centre catches a box smaller than the
  // sampling step.
  const lons = [bounds.west, (bounds.west + bounds.east) / 2, bounds.east];
  const lats = [bounds.south, (bounds.south + bounds.north) / 2, bounds.north];
  let onScreen = false;
  let minCol = Infinity, maxCol = -Infinity, minRow = Infinity, maxRow = -Infinity;
  for (const lon of lons) {
    for (const lat of lats) {
      const p = project([lon, lat]);
      if (!Number.isFinite(p.col) || !Number.isFinite(p.row)) continue;
      if (p.visible) onScreen = true;
      minCol = Math.min(minCol, p.col); maxCol = Math.max(maxCol, p.col);
      minRow = Math.min(minRow, p.row); maxRow = Math.max(maxRow, p.row);
    }
  }
  if (!Number.isFinite(minCol)) return { onScreen: false, screenFraction: 0, inCoverage: false };
  const screenFraction = Math.max((maxCol - minCol) / cols, (maxRow - minRow) / rows);
  return { onScreen, screenFraction, inCoverage: onScreen && screenFraction >= MAP_OSM_MIN_VIEW_FRACTION };
}

/** The `flyTo` target that frames an extract: its own box plus a proportional margin. */
export function mapOsmFlyToTarget(bounds: GlyphMapBounds): { readonly bounds: GlyphMapBounds } {
  const padLon = (bounds.east - bounds.west) * MAP_OSM_FLY_PADDING;
  const padLat = (bounds.north - bounds.south) * MAP_OSM_FLY_PADDING;
  return {
    bounds: {
      west: bounds.west - padLon,
      east: bounds.east + padLon,
      south: bounds.south - padLat,
      north: bounds.north + padLat,
    },
  };
}

/** Which mapped layers the card offers, and which are on by default — roads and water are what "OSM" means to a reader. */
export const MAP_OSM_DEFAULT_ON: readonly string[] = ["osm-roads", "osm-water", "osm-waterway", "osm-buildings"];

/** The card's sublayer rows, in the order the schema mapping declares them. */
export const MAP_OSM_SUBLAYERS = GLYPH_MAP_PROTOMAPS_LAYERS.map((spec) => ({
  id: spec.id,
  label: spec.label,
  type: spec.type,
}));

/**
 * Fetch and decode the self-hosted Protomaps extract.
 *
 * `url` defaults to {@link MAP_OSM_ARCHIVE_URL}, this repo's own copy. Passing
 * another URL is the documented opt-in for an archive you host yourself.
 */
export async function createOsmExtract(url: string = MAP_OSM_ARCHIVE_URL): Promise<GlyphMapProtomapsExtract> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(
      `glyphcss website: failed to load the OSM extract at ${url} (${res.status}). Run "node website/scripts/copy-osm-fixture.mjs" first.`,
    );
  }
  return glyphMapProtomapsExtract(glyphMapPMTilesBufferSource(await res.arrayBuffer(), url));
}

/** One-line provenance for the card: what the extract holds, in the reader's terms. */
export function mapOsmExtractSummary(extract: GlyphMapProtomapsExtract): string {
  const layers = Object.keys(extract.sources).length;
  const features = Object.values(extract.sources).reduce((n, s) => n + s.features.length, 0);
  return `${MAP_OSM_EXTRACT_LABEL} · z${extract.zoom} · ${layers} layers · ${features.toLocaleString("en-US")} features`;
}

/** The extent line the card shows permanently — outside this box the archive has no data at all. */
export function mapOsmExtentLabel(bounds: GlyphMapBounds): string {
  const f = (v: number) => v.toFixed(2);
  return `${f(bounds.west)},${f(bounds.south)} → ${f(bounds.east)},${f(bounds.north)}`;
}
