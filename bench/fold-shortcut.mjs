// Perf finding: `foldVoices` (per-voice fold, fieldProgram.ts) and
// `evaluateFieldProgram` (cross-layer fold, same file) always evaluated
// every active voice/layer, even under a `min`/`max`-bounded fold where a
// later voice or layer provably cannot move the running value once it hits
// its bound. Every voice sample is within [-1, 1] (`sampleFieldVoice`'s own
// doc), and a `thresholdOn` layer's shaped output is always exactly +-1
// regardless of its own combine/amp/voices — once a `min`-blend chain hits
// -1 (or a `max`-blend chain hits +1), no remaining voice/layer can change
// it, so both can be skipped without evaluating them.
//
// This bench measures the win on the REAL shipped recipe `GlyphCssGraphics
// MengerPreset` compiles to: 3 scales, 3 axis voices each, `add` combine
// (unbounded — the per-voice `foldVoices` shortcut does NOT fire here),
// duty-1/3 square wave, threshold+invert (`thresholdOn: true` — the bound
// the cross-layer shortcut exploits), `min` blend across scales.
// `GlyphCssGraphicsMengerPreset` inlines this exact recipe unchanged
// (stock.ts) and only overrides camera/color params on top of it — the same
// recipe a standalone "Menger sponge" preset used to ship before a later
// preset cull removed it (see AGENTS.md's "Preset named exports") — so one
// hand-built program (verified structurally equal to the real compiled IR
// by fieldProgram.test.ts's own builder-equality test) stands in for it.
//
// "Before" numbers come from a faithful, UNMODIFIED reimplementation of the
// pre-shortcut fold (same technique fieldProgram.test.ts's own A/B test
// suite uses), built only from the exported `sampleFieldVoice`/
// `combineSynth` primitives. The real (shortcut-enabled)
// `evaluateGlyphFieldProgram` is never modified for this run — both "before"
// and "after" execute in the same process, back to back, on the same grid
// of points, so the ms/evaluate comparison needs no rebuild/git-stash dance.
//
// This script needs TWO temporary, bench-only source changes, both reverted
// before shipping (same as bench/menger-sdf-profile.mjs's own `__SDF_PROFILE`
// precedent):
//   1. `sampleFieldVoice` re-exported from packages/effects/src/index.ts
//      (it's normally internal — only `combineSynth`/`synthWave` are public)
//      so the "before" reference can call the REAL function, not a cheaper
//      stand-in — the only difference from "after" is then genuinely just
//      whether a voice/layer gets skipped, not a different function's cost.
//   2. A one-line, zero-cost-when-unset counter probe at the top of
//      `sampleFieldVoice` (`globalThis.__FIELD_VOICE_EVAL_COUNT`).
// Without them this script fails to import; re-add both (see this repo's
// commit history for the exact diff) to reproduce the numbers below.
//
// Run: `pnpm --filter @glyphcss/effects build` (repo root) first, then
// `node bench/fold-shortcut.mjs`.

import {
  buildGlyphFieldProgram,
  combineSynth,
  evaluateGlyphFieldProgram,
  sampleFieldVoice,
} from "../packages/effects/dist/index.js";
// `sampleFieldVoice` is temporarily re-exported from index.ts for this bench
// only (reverted before commit, same as the __FIELD_VOICE_EVAL_COUNT probe
// below) — using the REAL function (not a toy reimplementation) for the
// "before" reference too is what makes the ms/evaluate comparison fair: the
// only difference between "before" and "after" is then genuinely just
// whether a voice/layer gets skipped, not a cheaper stand-in function.

function mengerRecipeProgram() {
  function scaleLayer(freq) {
    const axisVoice = (field) => ({ field, wave: "square", freq, duty: 1 / 3, phase: -1 / 3 });
    return {
      voices: [axisVoice("linearX"), axisVoice("linearY"), axisVoice("linearZ")],
      combine: "add", thresholdOn: true, threshold: 0, invert: true, blend: "min",
    };
  }
  // freq 1/3/9 — exactly GlyphCssGraphicsMengerPreset's field1/field4/field7 freq.
  return buildGlyphFieldProgram({ domain: "3d", layers: [scaleLayer(1), scaleLayer(3), scaleLayer(9)] });
}

// ---- "before": a faithful, unmodified reimplementation of the
// pre-shortcut fold. Counts its own sampleFieldVoice calls directly (no
// probe needed on this side — the loop is right here in the bench). ------

function naiveFoldVoices(voices, combine, x, y, z, originX, originY, originZ, time, volumetric, counter) {
  let combined = 0, active = 0, best = -Infinity, winner = -1, winnerOrder = -1;
  const argmax = combine === "argmax";
  for (let k = 0; k < voices.length; k++) {
    const v = voices[k];
    if (!(v.amp > 0)) continue;
    const cx = originX + v.origin.u, cy = originY + v.origin.v, cz = originZ + v.origin.w;
    counter.count++;
    const o = sampleFieldVoice(v, x, y, z, cx, cy, cz, time, volumetric);
    if (argmax) {
      const contribution = v.amp * o;
      if (contribution > best) { best = contribution; winner = v.sourceIndex ?? k; winnerOrder = active; }
    } else if (active === 0) {
      combined = v.amp * o;
    } else {
      combined += v.amp * (combineSynth(combine, combined, o) - combined);
    }
    active++;
  }
  if (argmax) combined = active > 1 ? (2 * winnerOrder + 1) / active - 1 : 0;
  return { combined, winner, active };
}

function naiveEvaluateFieldProgram(program, x, y, z, time, originX, originY, originZ, counter) {
  const volumetric = program.domain === "3d";
  let stackValue = 0, appliedLayers = 0;
  for (const layer of program.layers) {
    const result = naiveFoldVoices(layer.voices, layer.combine, x, y, z, originX, originY, originZ, time, volumetric, counter);
    if (result.active === 0) continue;
    let v = result.combined;
    if (layer.thresholdOn) v = v > layer.threshold ? 1 : -1;
    if (layer.invert) v = -v;
    if (appliedLayers === 0) stackValue = layer.amp * v;
    else stackValue += layer.amp * (combineSynth(layer.blend, stackValue, v) - stackValue);
    appliedLayers++;
  }
  return stackValue;
}

const program = mengerRecipeProgram();
let totalActiveVoices = 0;
for (const layer of program.layers) for (const v of layer.voices) if (v.amp > 0) totalActiveVoices++;

// 400,000 sample points (matching the perf finding's own grid size) over the
// recipe's [0,1]^3 unit-cube convention (the same domain
// fieldProgram.test.ts's own Menger-membership acceptance test samples), via
// an irrational per-axis Kronecker sequence — good spatial spread, no
// periodic aliasing against the duty-1/3 lattice.
const N = 400000;
const points = new Array(N);
{
  const ax = 0.5545497465356925, ay = 0.308517558769232, az = 0.24099751242241782; // frac parts of sqrt(2)/... generators
  let sx = 0, sy = 0, sz = 0;
  for (let i = 0; i < N; i++) {
    sx = (sx + ax) % 1; sy = (sy + ay) % 1; sz = (sz + az) % 1;
    points[i] = [sx, sy, sz];
  }
}

function timeReal(iterations) {
  for (let i = 0; i < 2000; i++) evaluateGlyphFieldProgram(program, points[i % N][0], points[i % N][1], points[i % N][2], 0, 0, 0, 0);
  const start = process.hrtime.bigint();
  for (let i = 0; i < iterations; i++) {
    const p = points[i % N];
    evaluateGlyphFieldProgram(program, p[0], p[1], p[2], 0, 0, 0, 0);
  }
  const end = process.hrtime.bigint();
  return Number(end - start) / 1e6 / iterations;
}

function timeNaive(iterations) {
  const counter = { count: 0 };
  for (let i = 0; i < 2000; i++) naiveEvaluateFieldProgram(program, points[i % N][0], points[i % N][1], points[i % N][2], 0, 0, 0, 0, counter);
  const start = process.hrtime.bigint();
  for (let i = 0; i < iterations; i++) {
    const p = points[i % N];
    naiveEvaluateFieldProgram(program, p[0], p[1], p[2], 0, 0, 0, 0, counter);
  }
  const end = process.hrtime.bigint();
  return Number(end - start) / 1e6 / iterations;
}

console.log(`shipped Menger recipe (GlyphCssGraphicsMengerPreset): 3 layers x 3 voices = ${totalActiveVoices} active voices/evaluate`);
console.log(`grid: ${N} sample points\n`);

const beforeCounter = { count: 0 };
for (let i = 0; i < N; i++) {
  const p = points[i];
  naiveEvaluateFieldProgram(program, p[0], p[1], p[2], 0, 0, 0, 0, beforeCounter);
}
console.log(`voice evals (before, no shortcut): ${beforeCounter.count} (= ${N} x ${totalActiveVoices}, every voice always evaluated)`);

globalThis.__FIELD_VOICE_EVAL_COUNT = 0;
for (let i = 0; i < N; i++) {
  const p = points[i];
  evaluateGlyphFieldProgram(program, p[0], p[1], p[2], 0, 0, 0, 0);
}
const afterCount = globalThis.__FIELD_VOICE_EVAL_COUNT;
delete globalThis.__FIELD_VOICE_EVAL_COUNT;
if (afterCount === 0) {
  console.log("voice evals (after, shortcut):     [probe not present in this build -- see this file's header comment]");
} else {
  console.log(`voice evals (after, shortcut):     ${afterCount} (${(100 * (1 - afterCount / beforeCounter.count)).toFixed(1)}% saved)`);
}

console.log();
const ITER = 20000;
const msBefore = timeNaive(ITER);
const msAfter = timeReal(ITER);
console.log(`ms/evaluate (before, no shortcut): ${msBefore.toFixed(5)}`);
console.log(`ms/evaluate (after,  shortcut):    ${msAfter.toFixed(5)}`);
console.log(`speedup: ${(msBefore / msAfter).toFixed(3)}x`);
