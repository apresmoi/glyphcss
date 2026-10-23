import earcut from "earcut";
import type { GlyphMapBounds } from "./types";
import type { GlyphMapVectorFeature } from "./vector/types";
import { glyphMapClipPolygonGroup } from "./vector/clip";

type Point = readonly [number, number];
type Ring = readonly Point[];
interface Triangle { ring: Ring; bounds: GlyphMapBounds }
interface Boundary { a: Point; b: Point; bounds: GlyphMapBounds }

/** Internal snapshot: bounds describe successful tile coverage, not a feature's bbox. */
export interface GlyphMapWaterCoverage {
  readonly bounds: GlyphMapBounds;
  readonly features: readonly GlyphMapVectorFeature[];
  boundaries(bounds: GlyphMapBounds): readonly Boundary[];
  waterAt(lon: number, lat: number): boolean;
}

export function glyphMapWaterContains(bounds: GlyphMapBounds, lon: number, lat: number): boolean {
  return lon >= bounds.west && lon <= bounds.east && lat >= bounds.south && lat <= bounds.north;
}

export function glyphMapWaterOverlaps(a: GlyphMapBounds, b: GlyphMapBounds): boolean {
  return a.west < b.east && a.east > b.west && a.south < b.north && a.north > b.south;
}

function cross(a: Point, b: Point, p: Point): number {
  return (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
}

function halfPlane(ring: Ring, a: Point, b: Point, inside: boolean): Point[] {
  const out: Point[] = [];
  for (let i = 0; i < ring.length; i++) {
    const p = ring[i], q = ring[(i + 1) % ring.length];
    const dp = cross(a, b, p), dq = cross(a, b, q);
    const pin = inside ? dp >= 0 : dp <= 0;
    const qin = inside ? dq >= 0 : dq <= 0;
    if (pin) out.push(p);
    if (pin !== qin) {
      const t = dp / (dp - dq);
      out.push([p[0] + t * (q[0] - p[0]), p[1] + t * (q[1] - p[1])]);
    }
  }
  return out;
}

function hasArea(ring: Ring): boolean {
  if (ring.length < 3) return false;
  let area = 0;
  for (let i = 1; i + 1 < ring.length; i++) area += cross(ring[0], ring[i], ring[i + 1]);
  return Math.abs(area) > 0;
}

/** Convex subtraction retains disjoint convex fragments; holes need no special case. */
function cut(subject: Ring, clip: Ring): { inside: Ring; outside: Ring[] } {
  for (let i = 0; i < clip.length; i++) {
    const a = clip[i], b = clip[(i + 1) % clip.length];
    if (subject.every(p => cross(a, b, p) <= 0)) return { inside: [], outside: [subject] };
  }
  let inside = subject;
  const outside: Ring[] = [];
  for (let i = 0; i < clip.length && hasArea(inside); i++) {
    const a = clip[i], b = clip[(i + 1) % clip.length];
    const piece = halfPlane(inside, a, b, false);
    if (hasArea(piece)) outside.push(piece);
    inside = halfPlane(inside, a, b, true);
  }
  // Half-planes can split a subject which misses the triangle itself.
  // Retaining those artificial splits makes successive ears explode.
  return hasArea(inside) ? { inside, outside } : { inside: [], outside: [subject] };
}

function boxRing(b: GlyphMapBounds): Ring {
  return [[b.west, b.south], [b.east, b.south], [b.east, b.north], [b.west, b.north]];
}

export function createGlyphMapWaterCoverage(bounds: GlyphMapBounds, input: readonly GlyphMapVectorFeature[]): GlyphMapWaterCoverage {
  const steps = prepareGlyphMapWaterCoverage(bounds, input);
  let next = steps.next();
  while (!next.done) next = steps.next();
  return next.value;
}

export function* prepareGlyphMapWaterCoverage(bounds: GlyphMapBounds, input: readonly GlyphMapVectorFeature[]): Generator<void, GlyphMapWaterCoverage> {
  const features: GlyphMapVectorFeature[] = [];
  const triangles: Triangle[] = [];
  const boundaries: Boundary[] = [];
  for (const feature of input) {
    if (feature.geometryType === "point" || feature.geometryType === "line") continue;
    const polygons: (readonly Ring[])[] = [];
    for (const group of feature.polygons ?? feature.rings.map(ring => [ring])) {
      yield;
      polygons.push(...glyphMapClipPolygonGroup(group, bounds));
    }
    if (!polygons.length) continue;
    features.push({ ...feature, polygons, rings: polygons.flat() });
    for (const group of polygons) {
      yield;
      for (const ring of group) for (let i = 1; i < ring.length; i++) {
        const a = ring[i - 1], b = ring[i];
        if (a[0] === b[0] && a[1] === b[1]) continue;
        boundaries.push({ a, b, bounds: { west: Math.min(a[0], b[0]), east: Math.max(a[0], b[0]), south: Math.min(a[1], b[1]), north: Math.max(a[1], b[1]) } });
      }
      const points: Point[] = [], flat: number[] = [], holes: number[] = [];
      for (let i = 0; i < group.length; i++) {
        if (i) holes.push(points.length);
        for (const p of group[i]) { points.push(p); flat.push(...p); }
      }
      const indices = earcut(flat, holes, 2);
      for (let i = 0; i < indices.length; i += 3) {
        if ((i & 127) === 0) yield;
        const ring = indices.slice(i, i + 3).map(index => points[index]);
        const area = cross(ring[0], ring[1], ring[2]);
        if (area === 0) continue;
        if (area < 0) ring.reverse();
        triangles.push({ ring, bounds: {
          west: Math.min(...ring.map(p => p[0])), east: Math.max(...ring.map(p => p[0])),
          south: Math.min(...ring.map(p => p[1])), north: Math.max(...ring.map(p => p[1])),
        } });
      }
    }
  }
  // Coastlines have many ears, but each terrain face only meets a few. The
  // index also bounds work for the permanent global terrain backstop.
  const size = Math.min(32, Math.max(1, Math.ceil(Math.sqrt(triangles.length / 8))));
  const bins: Triangle[][] = Array.from({ length: size * size }, () => []);
  const edgeBins: Boundary[][] = Array.from({ length: size * size }, () => []);
  const x = (lon: number) => Math.min(size - 1, Math.max(0, Math.floor((lon - bounds.west) / (bounds.east - bounds.west) * size)));
  const y = (lat: number) => Math.min(size - 1, Math.max(0, Math.floor((lat - bounds.south) / (bounds.north - bounds.south) * size)));
  for (const triangle of triangles) {
    yield;
    const b = triangle.bounds;
    for (let row = y(b.south); row <= y(b.north); row++) for (let col = x(b.west); col <= x(b.east); col++) bins[row * size + col].push(triangle);
  }
  for (const edge of boundaries) {
    yield;
    const b = edge.bounds;
    for (let row = y(b.south); row <= y(b.north); row++) for (let col = x(b.west); col <= x(b.east); col++) edgeBins[row * size + col].push(edge);
  }
  return { bounds, features, waterAt(lon, lat) {
    const p: Point = [lon, lat];
    return bins[y(lat) * size + x(lon)].some(({ ring, bounds: b }) => glyphMapWaterContains(b, lon, lat)
      && cross(ring[0], ring[1], p) >= 0 && cross(ring[1], ring[2], p) >= 0 && cross(ring[2], ring[0], p) >= 0);
  }, boundaries(b) {
    const found = new Set<Boundary>();
    for (let row = y(b.south); row <= y(b.north); row++) for (let col = x(b.west); col <= x(b.east); col++) {
      for (const edge of edgeBins[row * size + col]) if (edge.bounds.west <= b.east && edge.bounds.east >= b.west && edge.bounds.south <= b.north && edge.bounds.north >= b.south) found.add(edge);
    }
    return [...found];
  } };
}

/** Adjacent convex pieces share one plane, so their union needs no extra face. */
function* mergeConvexPieces(input: Ring[]): Generator<void, Ring[]> {
  const pieces = new Set(input);
  const edges = new Map<string, Ring>();
  const key = (a: Point, b: Point) => `${a[0]},${a[1]}/${b[0]},${b[1]}`;
  const register = (ring: Ring) => { for (let i = 0; i < ring.length; i++) edges.set(key(ring[i], ring[(i + 1) % ring.length]), ring); };
  const remove = (ring: Ring) => { for (let i = 0; i < ring.length; i++) edges.delete(key(ring[i], ring[(i + 1) % ring.length])); pieces.delete(ring); };
  for (const ring of input) { register(ring); yield; }
  for (let ring of pieces) {
    let merged = true;
    while (merged) {
      merged = false;
      for (let i = 0; i < ring.length; i++) {
        yield;
        const a = ring[i], b = ring[(i + 1) % ring.length];
        const neighbour = edges.get(key(b, a));
        if (!neighbour || neighbour === ring) continue;
        const j = neighbour.findIndex(p => p[0] === b[0] && p[1] === b[1]);
        const union: Point[] = [];
        for (let k = 1; k < ring.length; k++) union.push(ring[(i + 1 + k) % ring.length]);
        for (let k = 1; k < neighbour.length; k++) union.push(neighbour[(j + 1 + k) % neighbour.length]);
        if (union.some((p, k) => cross(p, union[(k + 1) % union.length], union[(k + 2) % union.length]) < 0)) continue;
        remove(ring); remove(neighbour);
        ring = union;
        pieces.add(ring); register(ring);
        merged = true;
        break;
      }
    }
  }
  return [...pieces];
}

/** Vertical decomposition uses shoreline segments, never triangulation ears. */
function* partitionShore(subject: Ring, edges: readonly Boundary[], region: GlyphMapWaterCoverage): Generator<void, Ring[]> {
  let crossesSubject = false;
  for (let edge = 0; edge < edges.length; edge++) {
    if ((edge & 127) === 0) yield;
    const { a, b } = edges[edge];
    // Clip the segment to the convex subject, ignoring boundary-only contact.
    let lo = 0, hi = 1;
    for (let i = 0; i < subject.length; i++) {
      const p = subject[i], q = subject[(i + 1) % subject.length];
      const da = cross(p, q, a), db = cross(p, q, b);
      if (da <= 0 && db <= 0) { hi = lo; break; }
      if (da <= 0) lo = Math.max(lo, da / (da - db));
      if (db <= 0) hi = Math.min(hi, da / (da - db));
    }
    if (lo < hi) { crossesSubject = true; break; }
  }
  if (!crossesSubject) {
    const lon = subject.reduce((sum, p) => sum + p[0], 0) / subject.length;
    const lat = subject.reduce((sum, p) => sum + p[1], 0) / subject.length;
    return region.waterAt(lon, lat) ? [] : [subject];
  }
  const outline: Boundary[] = subject.map((a, i) => ({ a, b: subject[(i + 1) % subject.length], bounds: region.bounds }));
  const lines = [...outline, ...edges];
  const west = Math.min(...subject.map(p => p[0])), east = Math.max(...subject.map(p => p[0]));
  const xs = new Set([west, east]);
  for (const { a, b } of edges) { if (a[0] > west && a[0] < east) xs.add(a[0]); if (b[0] > west && b[0] < east) xs.add(b[0]); }
  // Ordering can change only at a segment endpoint or a true intersection.
  for (let i = 0; i < lines.length; i++) for (let j = i + 1; j < lines.length; j++) {
    if ((j & 127) === 0) yield;
    const { a, b } = lines[i], { a: c, b: d } = lines[j];
    if (Math.max(a[0], b[0]) <= Math.min(c[0], d[0]) || Math.max(c[0], d[0]) <= Math.min(a[0], b[0])
      || Math.max(a[1], b[1]) < Math.min(c[1], d[1]) || Math.max(c[1], d[1]) < Math.min(a[1], b[1])) continue;
    const dx = b[0] - a[0], dy = b[1] - a[1], ex = d[0] - c[0], ey = d[1] - c[1];
    const den = dx * ey - dy * ex;
    if (den === 0) continue;
    const t = ((c[0] - a[0]) * ey - (c[1] - a[1]) * ex) / den;
    const u = ((c[0] - a[0]) * dy - (c[1] - a[1]) * dx) / den;
    const x = a[0] + t * dx;
    if (t > 0 && t < 1 && u > 0 && u < 1 && x > west && x < east) xs.add(x);
  }
  const stations = [...xs].sort((a, b) => a - b), result: Ring[] = [];
  const at = (edge: Boundary, x: number) => edge.a[1] + (x - edge.a[0]) * (edge.b[1] - edge.a[1]) / (edge.b[0] - edge.a[0]);
  // An endpoint elsewhere in the subject must not split an unchanged dry
  // interval. The same two bounding segments define one convex trapezoid.
  let previous = new Map<Boundary, Map<Boundary, Point[]>>();
  for (let i = 1; i < stations.length; i++) {
    yield;
    const left = stations[i - 1], right = stations[i], x = (left + right) / 2;
    if (x === left || x === right) continue;
    const crossing = (edge: Boundary) => x > Math.min(edge.a[0], edge.b[0]) && x < Math.max(edge.a[0], edge.b[0]);
    const limits = outline.filter(crossing).sort((a, b) => at(a, x) - at(b, x));
    if (limits.length < 2) continue;
    const low = limits[0], high = limits[limits.length - 1], lo = at(low, x), hi = at(high, x);
    const hits = [low, ...edges.filter(e => crossing(e) && at(e, x) > lo && at(e, x) < hi), high].sort((a, b) => at(a, x) - at(b, x));
    const current = new Map<Boundary, Map<Boundary, Point[]>>();
    for (let j = 1; j < hits.length; j++) {
      const a = hits[j - 1], b = hits[j], bottom = at(a, x), top = at(b, x);
      if (top <= bottom || region.waterAt(x, (bottom + top) / 2)) continue;
      const adjacent = previous.get(a)?.get(b);
      const ring: Point[] = adjacent ?? [[left, at(a, left)], [right, at(a, right)], [right, at(b, right)], [left, at(b, left)]];
      if (adjacent) { ring[1] = [right, at(a, right)]; ring[2] = [right, at(b, right)]; }
      else if (hasArea(ring)) result.push(ring);
      let upper = current.get(a);
      if (!upper) current.set(a, upper = new Map());
      upper.set(b, ring);
    }
    previous = current;
  }
  return yield* mergeConvexPieces(result);
}

/** null leaves a quad's original vertices, colours and winding byte-identical. */
export function partitionGlyphMapWaterTerrain(bounds: GlyphMapBounds, coverage: readonly GlyphMapWaterCoverage[]): WaterPiece[] | null {
  const steps = partitionGlyphMapWaterTerrainSteps(bounds, coverage);
  let next = steps.next();
  while (!next.done) next = steps.next();
  return next.value;
}

type WaterPiece = { ring: Ring; land: boolean };
export function* partitionGlyphMapWaterTerrainSteps(bounds: GlyphMapBounds, coverage: readonly GlyphMapWaterCoverage[]): Generator<void, WaterPiece[] | null> {
  const relevant = coverage.filter(c => glyphMapWaterOverlaps(bounds, c.bounds));
  if (!relevant.length) return null;
  const nw: Point = [bounds.west, bounds.north], sw: Point = [bounds.west, bounds.south];
  const se: Point = [bounds.east, bounds.south], ne: Point = [bounds.east, bounds.north];
  let remaining: Ring[] = [[nw, sw, se], [nw, se, ne]];
  const result: { ring: Ring; land: boolean }[] = [];
  for (const region of relevant) {
    const next: Ring[] = [];
    const edges = region.boundaries(bounds);
    for (const subject of remaining) {
      const { inside, outside } = cut(subject, boxRing(region.bounds));
      next.push(...outside);
      const dry: Ring[] = inside.length ? [inside] : [];
      for (const ring of dry) result.push(...(yield* partitionShore(ring, edges, region)).map(ring => ({ ring, land: true })));
    }
    remaining = next;
  }
  result.push(...remaining.map(ring => ({ ring, land: false })));
  return result;
}

/** Cooperative preparation; cancellation is checked before every bounded step. */
export async function runGlyphMapWaterWork<T>(work: Generator<void, T>, valid: () => boolean): Promise<T | undefined> {
  let deadline = performance.now();
  while (valid()) {
    if (performance.now() >= deadline) {
      await new Promise<void>(resolve => setTimeout(resolve, 0));
      if (!valid()) return undefined;
      deadline = performance.now() + 2;
    }
    const next = work.next();
    if (next.done) return next.value;
  }
  return undefined;
}
