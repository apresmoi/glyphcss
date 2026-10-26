import type { GlyphMapLonLat } from "./simplify";
import type { GlyphMapVectorFeature } from "./types";

export const shared: GlyphMapLonLat[] = Array.from({ length: 33 }, (_, i) =>
  [i === 0 || i === 32 ? 0 : i % 2 ? 0.12 : -0.12, -8 + i / 2]);
const left: GlyphMapLonLat[] = [...shared, [-8, 8], [-8, -8], shared[0]!];
const right: GlyphMapLonLat[] = [...shared.toReversed(), [8, -8], [8, 8], shared.at(-1)!];
// Move the second country's ring seam onto the shared border.
const offset = 16;
const rotated = [...right.slice(offset, -1), ...right.slice(0, offset + 1)];
export const countries: GlyphMapVectorFeature[] = [
  { geometryType: "polygon", rings: [left] },
  { geometryType: "polygon", rings: [rotated] },
];
