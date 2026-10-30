// Letter probes: render.js's `letters` overlay pass as data. Each probe is one DOM letter
// over the fluid; the sim side samples ink, wave height and accent under it, decides
// whether it has condensed (ink ≥ its threshold) and blanks the cells it covers, so the
// fluid frame and the letters drawn over it come out of the same step (worker or main).

/** Input stride: cx, cy (letter centre in cells, frame rows), i0, j0, i1, j1 (inclusive cell box), minInk. */
export const GLYPH_FLUID_PROBE_IN = 7;
/** Output stride: ink, wave height, accent, shown (0 | 1). */
export const GLYPH_FLUID_PROBE_OUT = 4;

interface ProbeSim {
  W: number;
  H: number;
  ink: Float32Array;
  h: Float32Array;
  acc: Float32Array;
}

// render.js samples with sim.sampleAt(arr, sx, sy), fx = ((sx + 1) / 2) · W − 0.5: the
// probe carries ((sx + 1) / 2) · W, so the same doubles go into the same arithmetic
function sampleAt(sim: ProbeSim, arr: Float32Array, cx: number, cy: number): number {
  const { W, H } = sim;
  let fx = cx - 0.5, fy = cy - 0.5;
  fx = Math.max(0, Math.min(W - 1.001, fx));
  fy = Math.max(0, Math.min(H - 1.001, fy));
  const x0 = fx | 0, y0 = fy | 0, ax = fx - x0, ay = fy - y0, k = y0 * W + x0;
  return (arr[k]! * (1 - ax) + arr[k + 1]! * ax) * (1 - ay) + (arr[k + W]! * (1 - ax) + arr[k + W + 1]! * ax) * ay;
}

/**
 * Sample every probe and mark the cells under shown ones in `skip` (cleared first).
 * Returns `out` (length `count × GLYPH_FLUID_PROBE_OUT`).
 */
export function sampleGlyphFluidProbes(sim: ProbeSim, probes: Float64Array, skip: Uint8Array, out: Float64Array): Float64Array {
  skip.fill(0);
  const { W, H } = sim, n = Math.floor(probes.length / GLYPH_FLUID_PROBE_IN);
  for (let p = 0; p < n; p++) {
    const q = p * GLYPH_FLUID_PROBE_IN, o = p * GLYPH_FLUID_PROBE_OUT;
    const cx = probes[q]!, cy = probes[q + 1]!;
    const ink = sampleAt(sim, sim.ink, cx, cy);
    out[o] = ink;
    out[o + 1] = sampleAt(sim, sim.h, cx, cy);
    out[o + 2] = sampleAt(sim, sim.acc, cx, cy);
    const shown = ink >= probes[q + 6]!;
    out[o + 3] = shown ? 1 : 0;
    if (!shown) continue;
    const i0 = Math.max(0, probes[q + 2]!), j0 = Math.max(0, probes[q + 3]!);
    const i1 = Math.min(W - 1, probes[q + 4]!), j1 = Math.min(H - 1, probes[q + 5]!);
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) skip[j * W + i] = 1;
  }
  return out;
}
