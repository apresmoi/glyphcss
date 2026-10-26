import type { GlyphMapProjection } from "./projection";
import type { GlyphMapBounds } from "./types";
import type { Vec3 } from "glyphcss";
import { glyphMapWalkDistanceM } from "./walk";

// Internal capability: custom projections and replaced methods always fall
// back. No inference from a projection's name or a few sampled coordinates.
const spheres = new WeakMap<GlyphMapProjection, { radius: number; exaggeration: number;
  project: GlyphMapProjection["project"]; visible: GlyphMapProjection["visible"] }>();
export function registerGlyphMapNearSphere(p: GlyphMapProjection, radius: number) {
  spheres.set(p, { radius, exaggeration: p.exaggeration, project: p.project, visible: p.visible });
}
export function prepareGlyphMapNearSideProof(p: GlyphMapProjection, depth: (v: Vec3) => number,
  walker?: { lon: number; lat: number; far: number }) {
  const sphere = spheres.get(p);
  if (!sphere || sphere.project !== p.project || sphere.visible !== p.visible || !(sphere.radius > 0) || !Number.isFinite(sphere.radius)) return undefined;
  // The millimetre haversine margin is a local bound; near-antipodal
  // cancellation and nonstandard walker coordinates retain the point test.
  if (walker && (!(walker.far > 0 && walker.far <= 100_000)
    || !Number.isFinite(walker.lon) || !Number.isFinite(walker.lat)
    || Math.abs(walker.lon) > 180 || Math.abs(walker.lat) > 90)) return undefined;
  const origin = walker ? 0 : depth([0, 0, 0]);
  const norm = walker ? 0 : Math.hypot(depth([1, 0, 0]) - origin, depth([0, 1, 0]) - origin, depth([0, 0, 1]) - origin);
  return (b: GlyphMapBounds, minElevation = 0, maxElevation = 0): boolean => {
    if (![b.west, b.east, b.south, b.north, minElevation, maxElevation].every(Number.isFinite)
      || b.west > b.east || b.south > b.north || b.west < -180 || b.east > 180 || b.south < -90 || b.north > 90) return false;
    const lo = 1 + (minElevation / 6_371_000) * sphere.exaggeration;
    const hi = 1 + (maxElevation / 6_371_000) * sphere.exaggeration;
    if (!(Math.min(lo, hi) > 0) || !Number.isFinite(sphere.radius * lo) || !Number.isFinite(sphere.radius * hi)) return false;
    const lon = (b.west + b.east) / 2, lat = (b.south + b.north) / 2;
    // A meridian then parallel path bounds great-circle distance everywhere,
    // including the poles. One millimetre covers trig and haversine roundoff.
    const reach = ((b.east - b.west) / 2 + (b.north - b.south) / 2) * (Math.PI / 180);
    if (walker) return glyphMapWalkDistanceM(walker.lon, walker.lat, lon, lat) + reach * 6_371_000 < walker.far - 0.001;
    const centerDepth = depth(p.project(lon, lat, 0));
    // The depth functional is affine. Its norm times a spherical path length
    // bounds every point in the box; only a strictly positive interval proves
    // near-side visibility. 4096 ulps covers projection, basis subtraction,
    // interval arithmetic and target cancellation; huge targets fall back.
    const scale = sphere.radius * norm;
    if (!(scale > 0) || Math.abs(origin) > scale * 1e6) return false;
    const margin = Number.EPSILON * 4096 * (Math.abs(origin) + Math.abs(centerDepth) + scale) * Math.max(1, Math.abs(lo), Math.abs(hi));
    return (centerDepth - origin) * Math.min(lo, hi) - scale * reach * Math.max(lo, hi) > margin;
  };
}
