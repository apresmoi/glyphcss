import type { GlyphMapLonLat } from "./simplify";
import type { GlyphMapVectorFeature } from "./types";

type Line = readonly GlyphMapLonLat[];
type Arc = { readonly line: Line; readonly owners: ReadonlySet<GlyphMapVectorFeature> };

/** Exact source vertices define topology; no screen-space snapping or invented joins. */
export function glyphMapSharedLineArcs(features: readonly GlyphMapVectorFeature[]): readonly Line[] {
  return tracedArcs(features).map(arc => arc.line);
}

/**
 * The same arcs as features. An arc has no feature of its own, so it carries
 * the properties its contributing features agree on (a border between two
 * polygons of one `kind` keeps `kind`; one between two kinds keeps neither),
 * which is what `colorProperty` and `filterAtResolution` read.
 */
export function glyphMapSharedArcFeatures(features: readonly GlyphMapVectorFeature[]): readonly GlyphMapVectorFeature[] {
  return tracedArcs(features).map(({ line, owners }) => {
    const [first, ...rest] = owners;
    const properties: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(first?.properties ?? {})) {
      if (rest.every(owner => owner.properties && Object.is(owner.properties[key], value) && key in owner.properties)) properties[key] = value;
    }
    return Object.keys(properties).length ? { rings: [line], properties } : { rings: [line] };
  });
}

function tracedArcs(features: readonly GlyphMapVectorFeature[]): readonly Arc[] {
  const points = new Map<string, GlyphMapLonLat>();
  const neighbours = new Map<string, Set<string>>();
  const ends = new Set<string>();
  const lines: Arc[] = [];
  const edgeOwners = new Map<string, Set<GlyphMapVectorFeature>>();
  const key = (p: GlyphMapLonLat) => `${p[0]},${p[1]}`;
  const edgeKey = (a: string, b: string) => a < b ? `${a};${b}` : `${b};${a}`;
  const edges = new Set<string>();
  for (const feature of features) {
    for (const ring of feature.rings) {
      // Explicit routes retain their own paths. Untyped baked polygon cuts
      // can be open, so their endpoints must also become pinned junctions.
      if (feature.geometryType === "line" || feature.geometryType === "point" || ring.length < 2) {
        lines.push({ line: ring, owners: new Set([feature]) });
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
        const ek = edgeKey(ka, kb);
        edges.add(ek);
        if (!edgeOwners.has(ek)) edgeOwners.set(ek, new Set());
        edgeOwners.get(ek)!.add(feature);
      }
    }
  }
  const junction = (v: string) => ends.has(v) || neighbours.get(v)!.size !== 2;
  function trace(start: string, next: string): void {
    const arc: GlyphMapLonLat[] = [points.get(start)!];
    const owners = new Set<GlyphMapVectorFeature>();
    let a = start, b = next;
    while (edges.has(edgeKey(a, b))) {
      edges.delete(edgeKey(a, b));
      for (const owner of edgeOwners.get(edgeKey(a, b))!) owners.add(owner);
      arc.push(points.get(b)!);
      if (b === start || junction(b)) break;
      const following = [...neighbours.get(b)!].find(v => v !== a)!;
      a = b; b = following;
    }
    lines.push({ line: arc, owners });
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
export function createGlyphMapSharedArcCache(): (features: readonly GlyphMapVectorFeature[]) => readonly GlyphMapVectorFeature[] {
  const cache = new WeakMap<readonly GlyphMapVectorFeature[], readonly GlyphMapVectorFeature[]>();
  return features => {
    let arcs = cache.get(features);
    if (!arcs) { arcs = glyphMapSharedArcFeatures(features); cache.set(features, arcs); }
    return arcs;
  };
}
