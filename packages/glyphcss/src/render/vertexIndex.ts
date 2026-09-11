import type { Polygon, Vec3 } from "@glyphcss/core";

/**
 * Indexed vertex projection: one projection per DISTINCT world position per
 * pass, instead of one per vertex OCCURRENCE.
 *
 * `rasterizeSolid` already shares a projection across the fan triangles WITHIN
 * a polygon, but not BETWEEN adjacent polygons — and an adjacency-heavy mesh is
 * mostly shared edges. Measured on the committed ETOPO1 z2 pyramid at the
 * relief tier `@glyphcss/maps` mounts (101,248 quads): **404,992 vertex
 * occurrences, 101,761 distinct positions**, i.e. `project()` ran 4.0x more
 * often than the geometry has corners.
 *
 * ## Exact, never welded
 *
 * Positions are keyed on their **IEEE-754 bit pattern**, not on a tolerance and
 * not on `===`. Two occurrences share a slot only when all three coordinates
 * are bit-identical, so `+0` and `-0` land in DIFFERENT slots (they compare
 * equal under `===` but are distinguishable doubles) and two NaNs share one
 * only when their payloads agree. `project()` is a deterministic function of
 * its inputs, so bit-identical inputs give bit-identical outputs: a hit returns
 * exactly what a recompute would, and no arithmetic anywhere changes. There is
 * no welding, no quantisation, and no distance threshold.
 *
 * ## Lifetime
 *
 * The per-slot projected tuples are refilled lazily and stamped with a pass
 * GENERATION that is bumped at the start of every rasterizer pass. Nothing is
 * ever reused across passes, so a detail grid — which has its own camera
 * centre, metrics, cell size and grid shape — can never read coordinates the
 * base grid produced. The generation is the whole lifetime rule; there is no
 * camera-state comparison to get wrong.
 *
 * ## Invalidation
 *
 * The index is keyed on the POLYGON ARRAY's identity, the same invariant
 * `createGlyphScene`'s `cullChunkCache` (world AABBs per run) and
 * `worldBoxCache` (world AABB per mesh) already run on: a mesh whose
 * transformed polygon array comes back by identity has not moved, so its
 * vertex coordinates are the ones the previous render saw. Consumers that
 * change geometry hand over a new array (`setPolygons`, or a fresh
 * `applyTransform` result), which misses.
 *
 * ## Why the index is not built on first sight
 *
 * Building it is O(occurrences) hash work, which is the same order as the
 * projections one frame saves — so on a polygon array that only ever renders
 * ONCE (a static compile, or a consumer handing over a fresh array every
 * frame) it is a pure loss. It is therefore built on the SECOND render of the
 * same array and never for the first, which makes the whole mechanism free for
 * exactly the callers it cannot help.
 *
 * A mesh with no shared vertices at all (a cube authored with per-face corners)
 * would also pay the per-occurrence indirection for nothing, so an index whose
 * distinct count is not meaningfully below its occurrence count is discarded
 * and never rebuilt for that array.
 */
export interface GlyphVertexIndex {
  /** `polygons.length` the index was built from — a length change is a miss. */
  readonly polygonCount: number;
  /** `offsets[p] .. offsets[p + 1]` is polygon `p`'s slice of {@link slots}. */
  readonly offsets: Int32Array;
  /** `slots[offsets[p] + k]` is the distinct-position slot of polygon `p` vertex `k`. */
  readonly slots: Int32Array;
  /** First occurrence of each distinct position, by slot. Projected directly. */
  readonly positions: Vec3[];
  /**
   * Per-slot projected tuple — the camera's OWN return value, stored by
   * reference and re-served for every later occurrence in the same pass.
   * Holes until a pass fills them.
   */
  readonly proj: ([number, number, number, number?] | undefined)[];
  /** Pass generation each slot's tuple was filled in. */
  readonly stamp: Int32Array;
  /** Current pass generation; bumped by {@link beginGlyphVertexPass}. */
  gen: number;
}

/**
 * An index is kept only when the distinct positions are at most this fraction
 * of the vertex occurrences. Above it the mesh barely shares anything and the
 * per-occurrence indirection would be overhead with no projection saved.
 */
const MAX_DISTINCT_FRACTION = 0.9;

interface IndexEntry {
  /** How many renders this array has been resolved for. */
  seen: number;
  /** `null` while unbuilt or after the sharing test rejected the array. */
  index: GlyphVertexIndex | null;
  /** Set once the sharing test rejects the array, so it is never rebuilt. */
  rejected: boolean;
}

const indexCache = new WeakMap<readonly Polygon[], IndexEntry>();

/** Scratch for reading a vertex's three doubles as six 32-bit words. */
const keyBits = new Float64Array(3);
const keyWords = new Int32Array(keyBits.buffer);

function buildVertexIndex(polygons: readonly Polygon[]): GlyphVertexIndex | null {
  const n = polygons.length;
  const offsets = new Int32Array(n + 1);
  let total = 0;
  for (let p = 0; p < n; p++) {
    total += polygons[p]!.vertices.length;
    offsets[p + 1] = total;
  }
  if (total === 0) return null;

  const slots = new Int32Array(total);
  // Worst case (no sharing at all) is one distinct position per occurrence, so
  // these are sized once and never grown.
  const words = new Int32Array(total * 6);
  const next = new Int32Array(total);
  const head = new Map<number, number>();
  const positions: Vec3[] = [];
  let distinct = 0;

  for (let p = 0; p < n; p++) {
    const verts = polygons[p]!.vertices;
    const base = offsets[p]!;
    for (let k = 0; k < verts.length; k++) {
      const v = verts[k]! as Vec3;
      keyBits[0] = v[0]; keyBits[1] = v[1]; keyBits[2] = v[2];
      const w0 = keyWords[0]!, w1 = keyWords[1]!, w2 = keyWords[2]!;
      const w3 = keyWords[3]!, w4 = keyWords[4]!, w5 = keyWords[5]!;
      let h = Math.imul(w0, 0x9e3779b1) ^ w1;
      h = Math.imul(h, 0x85ebca6b) ^ w2;
      h = Math.imul(h, 0xc2b2ae35) ^ w3;
      h = Math.imul(h, 0x27d4eb2f) ^ w4;
      h = (Math.imul(h, 0x165667b1) ^ w5) | 0;
      let s = head.get(h);
      let found = -1;
      while (s !== undefined && s >= 0) {
        const o = s * 6;
        if (words[o] === w0 && words[o + 1] === w1 && words[o + 2] === w2
          && words[o + 3] === w3 && words[o + 4] === w4 && words[o + 5] === w5) { found = s; break; }
        s = next[s]!;
      }
      if (found < 0) {
        found = distinct++;
        const o = found * 6;
        words[o] = w0; words[o + 1] = w1; words[o + 2] = w2;
        words[o + 3] = w3; words[o + 4] = w4; words[o + 5] = w5;
        const prev = head.get(h);
        next[found] = prev === undefined ? -1 : prev;
        head.set(h, found);
        positions.push(v);
      }
      slots[base + k] = found;
    }
  }

  if (distinct > total * MAX_DISTINCT_FRACTION) return null;

  const proj: ([number, number, number, number?] | undefined)[] = new Array(distinct);
  return { polygonCount: n, offsets, slots, positions, proj, stamp: new Int32Array(distinct), gen: 0 };
}

/**
 * The index for `polygons`, or `null` when there is none to use this render —
 * the caller then projects per occurrence exactly as it always did.
 *
 * Call once per pass, before the polygon loop.
 */
export function resolveGlyphVertexIndex(polygons: readonly Polygon[]): GlyphVertexIndex | null {
  let entry = indexCache.get(polygons);
  if (entry === undefined) {
    entry = { seen: 1, index: null, rejected: false };
    indexCache.set(polygons, entry);
    return null;
  }
  entry.seen++;
  if (entry.rejected) return null;
  // An array mutated in place to a different LENGTH is not the array this index
  // was built from, so it is rebuilt rather than trusted; the per-polygon
  // vertex-count check at the call site covers the same class one polygon at a
  // time. Neither is a supported pattern — every consumer in this repo hands
  // over a NEW array when geometry changes — they are cheap belt and braces.
  if (entry.index !== null && entry.index.polygonCount !== polygons.length) entry.index = null;
  if (entry.index === null) {
    entry.index = buildVertexIndex(polygons);
    if (entry.index === null) { entry.rejected = true; return null; }
  }
  return entry.index;
}

/**
 * Opens a pass on `index` and returns its generation. Every slot is stale until
 * re-projected, so nothing a previous pass computed — under a different camera,
 * grid shape or projection metrics — can be read.
 */
export function beginGlyphVertexPass(index: GlyphVertexIndex): number {
  // Int32Array stamps: reset rather than wrap, so a stale stamp can never
  // collide with a live generation.
  if (index.gen >= 0x7ffffffe) { index.stamp.fill(0); index.gen = 0; }
  return ++index.gen;
}
