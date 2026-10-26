import type { GlyphMapLonLat } from "./simplify";
import type { GlyphMapVectorFeature } from "./types";

type Line = readonly GlyphMapLonLat[];

/** Exact source vertices define topology; no screen-space snapping or invented joins. */
export function glyphMapSharedLineArcs(features: readonly GlyphMapVectorFeature[]): readonly Line[] {
  const points = new Map<string, GlyphMapLonLat>();
  const neighbours = new Map<string, Set<string>>();
  const ends = new Set<string>();
  const lines: Line[] = [];
  const key = (p: GlyphMapLonLat) => `${p[0]},${p[1]}`;
  const edgeKey = (a: string, b: string) => a < b ? `${a};${b}` : `${b};${a}`;
  const edges = new Set<string>();
  for (const feature of features) {
    for (const ring of feature.rings) {
      // Explicit routes retain their own paths. Untyped baked polygon cuts
      // can be open, so their endpoints must also become pinned junctions.
      if (feature.geometryType === "line" || feature.geometryType === "point" || ring.length < 2) {
        lines.push(ring);
        continue;
      }
      if (key(ring[0]!) !== key(ring[ring.length - 1]!)) {
        ends.add(key(ring[0]!));
        ends.add(key(ring[ring.length - 1]!));
      }
      for (let i = 1; i < ring.length; i++) {
        const a = ring[i - 1]!, b = ring[i]!;
        const ka = key(a), kb = key(b);
        if (ka === kb) continue;
        points.set(ka, a); points.set(kb, b);
        if (!neighbours.has(ka)) neighbours.set(ka, new Set());
        if (!neighbours.has(kb)) neighbours.set(kb, new Set());
        neighbours.get(ka)!.add(kb); neighbours.get(kb)!.add(ka);
        edges.add(edgeKey(ka, kb));
      }
    }
  }
  const junction = (v: string) => ends.has(v) || neighbours.get(v)!.size !== 2;
  function trace(start: string, next: string): void {
    const arc: GlyphMapLonLat[] = [points.get(start)!];
    let a = start, b = next;
    while (edges.delete(edgeKey(a, b))) {
      arc.push(points.get(b)!);
      if (b === start || junction(b)) break;
      const following = [...neighbours.get(b)!].find(v => v !== a)!;
      a = b; b = following;
    }
    lines.push(arc);
  }
  // Start at real junctions before consuming junction-free island cycles.
  for (const [v, adjacent] of neighbours) if (junction(v)) {
    for (const w of adjacent) if (edges.has(edgeKey(v, w))) trace(v, w);
  }
  for (const [v, adjacent] of neighbours) {
    for (const w of adjacent) if (edges.has(edgeKey(v, w))) trace(v, w);
  }
  return lines;
}

/** Source/tile feature arrays outlive frames; replacing one gets fresh topology. */
export function createGlyphMapSharedArcCache(): (features: readonly GlyphMapVectorFeature[]) => readonly Line[] {
  const cache = new WeakMap<readonly GlyphMapVectorFeature[], readonly Line[]>();
  return features => {
    let arcs = cache.get(features);
    if (!arcs) { arcs = glyphMapSharedLineArcs(features); cache.set(features, arcs); }
    return arcs;
  };
}
