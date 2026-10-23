import earcut from "earcut";
import type { GlyphMapBounds } from "./types";
import type { GlyphMapVectorFeature } from "./vector/types";
import { glyphMapClipPolygonGroup } from "./vector/clip";

type Point = readonly [number, number];
type Ring = readonly Point[];
interface Triangle { ring: Ring; bounds: GlyphMapBounds }

/** Internal snapshot: bounds describe successful tile coverage, not a feature's bbox. */
export interface GlyphMapWaterCoverage {
  readonly bounds: GlyphMapBounds;
  readonly features: readonly GlyphMapVectorFeature[];
  candidates(bounds: GlyphMapBounds): readonly Triangle[];
  waterAt(lon: number, lat: number): boolean;
}

export function glyphMapWaterContains(bounds: GlyphMapBounds, lon: number, lat: number): boolean {
  return lon >= bounds.west && lon <= bounds.east && lat >= bounds.south && lat <= bounds.north;
}

function overlaps(a: GlyphMapBounds, b: GlyphMapBounds): boolean {
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
function cut(subject: Ring, clip: Ring, bounds?: GlyphMapBounds): { inside: Ring; outside: Ring[] } {
  if (bounds) {
    let west = Infinity, east = -Infinity, south = Infinity, north = -Infinity;
    for (const [lon, lat] of subject) {
      west = Math.min(west, lon); east = Math.max(east, lon);
      south = Math.min(south, lat); north = Math.max(north, lat);
    }
    if (!overlaps({ west, east, south, north }, bounds)) return { inside: [], outside: [subject] };
  }
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
  const features: GlyphMapVectorFeature[] = [];
  const triangles: Triangle[] = [];
  for (const feature of input) {
    if (feature.geometryType === "point" || feature.geometryType === "line") continue;
    const polygons = (feature.polygons ?? feature.rings.map(ring => [ring]))
      .flatMap(group => glyphMapClipPolygonGroup(group, bounds));
    if (!polygons.length) continue;
    features.push({ ...feature, polygons, rings: polygons.flat() });
    for (const group of polygons) {
      const points: Point[] = [], flat: number[] = [], holes: number[] = [];
      for (let i = 0; i < group.length; i++) {
        if (i) holes.push(points.length);
        for (const p of group[i]) { points.push(p); flat.push(...p); }
      }
      const indices = earcut(flat, holes, 2);
      for (let i = 0; i < indices.length; i += 3) {
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
  const x = (lon: number) => Math.min(size - 1, Math.max(0, Math.floor((lon - bounds.west) / (bounds.east - bounds.west) * size)));
  const y = (lat: number) => Math.min(size - 1, Math.max(0, Math.floor((lat - bounds.south) / (bounds.north - bounds.south) * size)));
  for (const triangle of triangles) {
    const b = triangle.bounds;
    for (let row = y(b.south); row <= y(b.north); row++) for (let col = x(b.west); col <= x(b.east); col++) bins[row * size + col].push(triangle);
  }
  return { bounds, features, waterAt(lon, lat) {
    const p: Point = [lon, lat];
    return bins[y(lat) * size + x(lon)].some(({ ring, bounds: b }) => glyphMapWaterContains(b, lon, lat)
      && cross(ring[0], ring[1], p) >= 0 && cross(ring[1], ring[2], p) >= 0 && cross(ring[2], ring[0], p) >= 0);
  }, candidates(b) {
    const found = new Set<Triangle>();
    for (let row = y(b.south); row <= y(b.north); row++) for (let col = x(b.west); col <= x(b.east); col++) {
      for (const tri of bins[row * size + col]) if (overlaps(tri.bounds, b)) found.add(tri);
    }
    return [...found];
  } };
}

/** null leaves a quad's original vertices, colours and winding byte-identical. */
export function partitionGlyphMapWaterTerrain(bounds: GlyphMapBounds, coverage: readonly GlyphMapWaterCoverage[]): { ring: Ring; land: boolean }[] | null {
  const relevant = coverage.filter(c => overlaps(bounds, c.bounds));
  if (!relevant.length) return null;
  const nw: Point = [bounds.west, bounds.north], sw: Point = [bounds.west, bounds.south];
  const se: Point = [bounds.east, bounds.south], ne: Point = [bounds.east, bounds.north];
  let remaining: Ring[] = [[nw, sw, se], [nw, se, ne]];
  const result: { ring: Ring; land: boolean }[] = [];
  for (const region of relevant) {
    const next: Ring[] = [];
    const triangles = region.candidates(bounds);
    for (const subject of remaining) {
      const { inside, outside } = cut(subject, boxRing(region.bounds));
      next.push(...outside);
      let dry: Ring[] = inside.length ? [inside] : [];
      for (const triangle of triangles) dry = dry.flatMap(piece => cut(piece, triangle.ring, triangle.bounds).outside);
      result.push(...dry.map(ring => ({ ring, land: true })));
    }
    remaining = next;
  }
  result.push(...remaining.map(ring => ({ ring, land: false })));
  return result;
}
