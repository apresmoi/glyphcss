import type { GlyphMapBounds } from "./types";

/** Snapshot-local broad phase. Insertion order preserves first finite/first
 * coverage semantics, including overlapping target, fallback and floor tiles. */
export function createGlyphMapGroundIndex<T extends { readonly bounds: GlyphMapBounds }>(items: readonly T[]) {
  if (items.length < 2) return (_lon: number, _lat: number) => items;
  let west = Infinity, east = -Infinity, south = Infinity, north = -Infinity;
  for (const { bounds: b } of items) {
    if (![b.west, b.east, b.south, b.north].every(Number.isFinite) || b.west > b.east || b.south > b.north) {
      return (_lon: number, _lat: number) => items;
    }
    west = Math.min(west, b.west); east = Math.max(east, b.east);
    south = Math.min(south, b.south); north = Math.max(north, b.north);
  }
  if (!(east > west && north > south)) return (_lon: number, _lat: number) => items;
  const size = Math.min(32, Math.ceil(Math.sqrt(items.length)));
  const x = (lon: number) => Math.max(0, Math.min(size - 1, Math.floor((lon - west) / (east - west) * size)));
  const y = (lat: number) => Math.max(0, Math.min(size - 1, Math.floor((lat - south) / (north - south) * size)));
  const bins: T[][] = Array.from({ length: size * size }, () => []);
  for (const item of items) {
    const b = item.bounds;
    for (let row = y(b.south); row <= y(b.north); row++) {
      for (let col = x(b.west); col <= x(b.east); col++) bins[row * size + col]!.push(item);
    }
  }
  const empty: readonly T[] = [];
  return (lon: number, lat: number): readonly T[] => {
    // NaN previously visited every item; retain that behavior for custom data.
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) return items;
    if (lon < west || lon > east || lat < south || lat > north) return empty;
    return bins[y(lat) * size + x(lon)]!;
  };
}
