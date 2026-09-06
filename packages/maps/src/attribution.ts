/**
 * Attribution DERIVED from the layers actually mounted, never hardcoded on
 * a page (coordinator scope addition to MAPS.md §13 slice 5). A data
 * source declares its own provenance once, at the type level
 * (`GlyphMapProvider.attribution`, `GlyphMapGeoTile.attribution`,
 * `GlyphMapVectorProvider.attribution`, `GlyphMapVectorFeatureCollection.
 * attribution` — all `types.ts`/`vector/types.ts`), and `createGlyphMap`'s
 * `getAttributions()` (`widget.ts`) walks the CURRENTLY mounted layer list
 * and aggregates whatever they carry — so the result changes as layers
 * toggle and as curated tiles swap in, with no website-side lookup table
 * that can drift from the data.
 */
import type { GlyphMapAttribution } from "./types";

/** Required attribution carried by every Protomaps basemap provider. */
export const GLYPH_MAP_PROTOMAPS_ATTRIBUTION: readonly GlyphMapAttribution[] = [
  { name: "OpenStreetMap contributors", url: "https://www.openstreetmap.org/copyright", license: "ODbL" },
  { name: "Protomaps", url: "https://protomaps.com", license: "ODbL" },
];

/**
 * Required attribution for OpenFreeMap-served tiles.
 *
 * The service's own TileJSON asks for, verbatim:
 * `<a href='https://openfreemap.org'>OpenFreeMap</a> <a href='https://www.openmaptiles.org/'>&copy; OpenMapTiles</a> Data from <a href='https://www.openstreetmap.org/copyright'>OpenStreetMap</a>`
 * (vendored at `packages/maps/fixtures/openfreemap/tilejson.json`, asserted
 * in `vector/openmaptiles.test.ts`). OpenFreeMap calls its own line optional
 * but recommended; it is included, because "optional" is not a reason to
 * drop the credit of the people hosting the planet for free.
 *
 * The OpenStreetMap credit is NOT optional: the data is ODbL, and anything
 * derived from it must say so. It rides `GlyphMapVectorProvider.attribution`
 * into `createGlyphMap`'s `getAttributions()` like every other credit in this
 * package — derived from the layers actually mounted, never a string on a
 * page.
 */
export const GLYPH_MAP_OPENFREEMAP_ATTRIBUTION: readonly GlyphMapAttribution[] = [
  { name: "OpenStreetMap contributors", url: "https://www.openstreetmap.org/copyright", license: "ODbL" },
  { name: "OpenMapTiles", url: "https://www.openmaptiles.org/", license: "CC-BY 4.0" },
  { name: "OpenFreeMap", url: "https://openfreemap.org", license: "ODbL" },
];

/** Merge several attribution lists, de-duplicating by `(name, url)` — the first occurrence wins (mount/layer order). */
export function glyphMapDedupeAttributions(
  lists: readonly (readonly GlyphMapAttribution[] | undefined)[],
): GlyphMapAttribution[] {
  const seen = new Map<string, GlyphMapAttribution>();
  for (const list of lists) {
    if (!list) continue;
    for (const a of list) {
      const key = `${a.name}\0${a.url ?? ""}`;
      if (!seen.has(key)) seen.set(key, a);
    }
  }
  return [...seen.values()];
}
