import { describe, expect, it } from "vitest";
import { createGlyphMapSharedArcCache, glyphMapSharedLineArcs } from "./sharedArcs";
import { createGlyphMapLineSimplifier, type GlyphMapLonLat } from "./simplify";

import { countries, shared } from "./sharedArcs.fixture";

describe("shared line arcs", () => {
  it("deduplicates reversed borders across different ring seams before coarse VW", () => {
    const arcs = glyphMapSharedLineArcs(countries);
    expect(arcs).toHaveLength(3);
    const border = arcs.filter(arc => arc.every(([lon]) => Math.abs(lon) < 1));
    expect(border).toHaveLength(1);
    expect(border[0]).toHaveLength(shared.length);
    const simplify = createGlyphMapLineSimplifier();
    const coarse = simplify(border[0]!, 4);
    expect(coarse).toEqual([shared[0], shared.at(-1)]);
    expect(simplify(border[0]!, 4.1)).toBe(coarse);
    // Every undirected source edge appears exactly once in the arc list.
    const keys = arcs.flatMap(arc => arc.slice(1).map((p, i) => [arc[i]!.join(","), p.join(",")].sort().join(";")));
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("pins diverging/touching ring junctions, not arbitrary ring seams", () => {
    const arcs = glyphMapSharedLineArcs(countries);
    const ends = arcs.flatMap(arc => [arc[0], arc.at(-1)]);
    expect(ends.filter(p => JSON.stringify(p) === JSON.stringify(shared[0]))).toHaveLength(3);
    expect(ends.filter(p => JSON.stringify(p) === JSON.stringify(shared.at(-1)))).toHaveLength(3);
    const simplify = createGlyphMapLineSimplifier();
    for (const arc of arcs) {
      const coarse = simplify(arc, 100);
      expect(coarse[0]).toEqual(arc[0]);
      expect(coarse.at(-1)).toEqual(arc.at(-1));
    }
    const ring: GlyphMapLonLat[] = [[0, 0], [2, 0], [2, 2], [0, 2], [0, 0]];
    expect(glyphMapSharedLineArcs([{ rings: [ring, ring.toReversed()] }])).toEqual([ring]);
  });

  it("caches topology by source/tile feature identity", () => {
    const cache = createGlyphMapSharedArcCache();
    const first = cache(countries);
    expect(cache(countries)).toBe(first);
    expect(cache([...countries])).not.toBe(first);
  });

  it("pins open tile-cut endpoints and leaves explicit routes alone", () => {
    const a: GlyphMapLonLat[] = [[0, 0], [1, 0], [2, 0]];
    const b: GlyphMapLonLat[] = [[1, 0], [2, 0], [3, 0]];
    expect(glyphMapSharedLineArcs([{ rings: [a, b] }])).toEqual([
      [[0, 0], [1, 0]], [[1, 0], [2, 0]], [[2, 0], [3, 0]],
    ]);
    expect(glyphMapSharedLineArcs([{ geometryType: "line", rings: [a, a.toReversed()] }])).toEqual([a, a.toReversed()]);
  });
});
