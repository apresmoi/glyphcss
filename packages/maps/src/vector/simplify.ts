/**
 * Visvalingam-Whyatt simplification over shared TopoJSON arcs (MAPS.md §6,
 * §13 slice 5's two non-negotiables). Two properties this file exists to
 * guarantee:
 *
 * - **Area-based, not distance-based.** VW removes the point whose removal
 *   changes the polyline's enclosed area LEAST (the triangle formed with its
 *   two current neighbors) — this keeps coastline SHAPE (bays, headlands)
 *   under simplification; Douglas-Peucker's perpendicular-distance metric
 *   collapses them.
 * - **Shared arcs, simplified once.** `glyphMapSimplifyArcs` operates on the
 *   TOPOLOGY's arc list — each arc appears exactly once regardless of how
 *   many polygons reference it (reversed or not), so two countries sharing a
 *   border simplify IDENTICALLY: there is only one arc to thin, not two
 *   independent copies that could diverge. Arc ENDPOINTS (index 0 and
 *   length-1) are never removed — they are topology junctions other arcs
 *   may also terminate at, and moving one would silently detach whatever
 *   else references that point.
 *
 * **Latitude-dependent tolerance** (§6's "three corrections"): the
 * per-point AREA THRESHOLD is `(epsilonEquatorDeg · cos(lat))²`, evaluated
 * at the CANDIDATE point's own latitude, not one global scalar. Why cos(lat)
 * and not a flat degree threshold: under Mercator, `dy/dlat = 1/cos(lat)`,
 * so a fixed on-screen (projected) perturbation `ε` corresponds to a raw
 * latitude perturbation of only `ε·cos(lat)` near the poles — i.e. the same
 * SCREEN-space error budget demands a SMALLER raw-degree tolerance at high
 * latitude. Using one equator-derived epsilon everywhere therefore
 * OVER-simplifies high-latitude coasts (Svalbard flattens while the equator
 * stays faithful) by up to `1/cos(85°) ≈ 11.5×` — matching §6's measured
 * figure exactly. Scaling the AREA threshold by `cos(lat)²` (area is a
 * squared-length quantity) is the equivalent correction applied at the
 * point-removal decision rather than as a separate global rescale.
 */

export type GlyphMapLonLat = readonly [lon: number, lat: number];

const DEG = Math.PI / 180;

function triangleArea(a: GlyphMapLonLat, b: GlyphMapLonLat, c: GlyphMapLonLat): number {
  return Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1])) / 2;
}

/** The per-point VW area threshold at `latDeg` for an equator-derived `epsilonEquatorDeg` — see this file's doc. */
export function glyphMapAreaThresholdDeg(epsilonEquatorDeg: number, latDeg: number): number {
  const e = epsilonEquatorDeg * Math.cos(latDeg * DEG);
  return e * e;
}

/**
 * The cell-derived epsilon bound (MAPS.md §6): half the geographic size of
 * one glyph cell at the given degrees-per-cell resolution — a vertex
 * displacement smaller than this is sub-cell and therefore invisible.
 * `degPerCell` is the SAME metric `glyphMapDegreesPerCell` (`provider.ts`)
 * computes for the raster LOD pyramid, reused here as a bake-time constant
 * per pyramid level rather than recomputed per live view (§13 slice 5: the
 * pyramid levels themselves ARE the discretized epsilon schedule).
 */
export function glyphMapCellEpsilonDeg(degPerCell: number): number {
  return degPerCell / 2;
}

/**
 * Simplify ONE arc in place order (returns a new array; never mutates the
 * input). Endpoints are always kept. `latDeg` for the threshold check is
 * each candidate POINT's own latitude — different points on a long arc can
 * have different thresholds.
 *
 * Heap-based (binary min-heap on triangle area), O(n log n): the point with
 * globally smallest effective area is always considered first, and removing
 * it can only affect its two immediate neighbors, whose areas are
 * recomputed and re-pushed. Because the threshold is NOT uniform (it varies
 * with each point's latitude), this does NOT stop at the first heap-min
 * that clears its own threshold — a later, larger-area point at a
 * higher-threshold latitude may still need removing — so every point is
 * popped and independently checked; only points actually removed cause a
 * re-push (an unremoved point is finalized unless a later neighbor removal
 * re-touches it).
 */
export function glyphMapSimplifyArc(
  arc: readonly GlyphMapLonLat[],
  epsilonEquatorDeg: number,
): GlyphMapLonLat[] {
  const n = arc.length;
  if (n <= 2 || epsilonEquatorDeg <= 0) return arc.map((p) => [p[0], p[1]] as GlyphMapLonLat);
  const pts: GlyphMapLonLat[] = arc.map((p) => [p[0], p[1]]);
  const prev = new Int32Array(n);
  const next = new Int32Array(n);
  for (let i = 0; i < n; i++) {
    prev[i] = i - 1;
    next[i] = i + 1;
  }
  prev[0] = -1;
  next[n - 1] = -1;
  const alive = new Uint8Array(n).fill(1);

  function area(i: number): number {
    const p = prev[i];
    const nx = next[i];
    if (p < 0 || nx < 0) return Infinity;
    return triangleArea(pts[p], pts[i], pts[nx]);
  }

  // Binary min-heap of point indices, keyed by a freshly-recomputed area at
  // pop time (never trusted stale — see this function's doc).
  const heap: number[] = [];
  function heapArea(i: number): number {
    return area(i);
  }
  function push(i: number): void {
    heap.push(i);
    let c = heap.length - 1;
    while (c > 0) {
      const p = (c - 1) >> 1;
      if (heapArea(heap[p]) <= heapArea(heap[c])) break;
      [heap[p], heap[c]] = [heap[c], heap[p]];
      c = p;
    }
  }
  function pop(): number | undefined {
    if (heap.length === 0) return undefined;
    const top = heap[0];
    const last = heap.pop()!;
    if (heap.length > 0) {
      heap[0] = last;
      let p = 0;
      for (;;) {
        const l = 2 * p + 1;
        const r = 2 * p + 2;
        let s = p;
        if (l < heap.length && heapArea(heap[l]) < heapArea(heap[s])) s = l;
        if (r < heap.length && heapArea(heap[r]) < heapArea(heap[s])) s = r;
        if (s === p) break;
        [heap[p], heap[s]] = [heap[s], heap[p]];
        p = s;
      }
    }
    return top;
  }

  for (let i = 1; i < n - 1; i++) push(i);

  for (;;) {
    const i = pop();
    if (i === undefined) break;
    if (!alive[i]) continue;
    const a = area(i);
    const threshold = glyphMapAreaThresholdDeg(epsilonEquatorDeg, pts[i][1]);
    if (a >= threshold) continue; // this point stays — but keep draining the heap (non-uniform threshold, see doc)
    alive[i] = 0;
    const p = prev[i];
    const nx = next[i];
    next[p] = nx;
    prev[nx] = p;
    if (p > 0 && alive[p]) push(p);
    if (nx < n - 1 && alive[nx]) push(nx);
  }

  const out: GlyphMapLonLat[] = [];
  for (let i = 0; i < n; i++) if (alive[i]) out.push(pts[i]);
  return out;
}

/** Simplify every arc in a shared-arc list — see this file's doc for why this must run on the ARC list, not on resolved per-feature rings. */
export function glyphMapSimplifyArcs(
  arcs: readonly (readonly GlyphMapLonLat[])[],
  epsilonEquatorDeg: number,
): GlyphMapLonLat[][] {
  return arcs.map((arc) => glyphMapSimplifyArc(arc, epsilonEquatorDeg));
}
