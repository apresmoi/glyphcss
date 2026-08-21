// Perf finding: `evaluateFieldProgramInterpreted` (fieldProgram.ts) re-
// dispatches on every voice's `field`/`wave` string and every layer's
// `combine`/`blend` string on EVERY sample, even though the `FieldProgram`
// is fixed between params changes — stock.ts's own per-cell paint loop
// evaluates the SAME program object thousands of times per `evaluate()`
// call (see its "compile once per evaluate() call" comment). The public
// `evaluateGlyphFieldProgram` now compiles a program once (cached by object
// identity, see fieldProgram.ts's "compiled evaluation form") into a
// specialized closure tree and reuses it across every probe.
//
// This bench measures ms/evaluate on the FOUR shipped presets named in the
// perf packet: `GlyphMengerSpongePreset`, `GlyphCssGraphicsMengerPreset`,
// `GlyphGyroidXrayPreset`, `GlyphMengerSdfPreset` — each compiled through the
// SAME params -> IR path `fieldSynth.program.evaluate()` runs internally
// (`buildFieldSynthVoices` -> `compileFieldVoices` -> `resolveFieldSynth
// LayerShapes` -> `compileFieldSynthProgram`), not a hand-built stand-in.
//
// This script needs TWO temporary, bench-only re-exports from
// packages/effects/src/index.ts, both reverted before shipping (same
// precedent as bench/fold-shortcut.mjs):
//   1. `buildFieldSynthVoices`/`compileFieldVoices`/`resolveFieldSynthLayerShapes`/
//      `compileFieldSynthProgram` (normally internal to stock.ts) so this
//      script can compile a preset's REAL params into the REAL `FieldProgram`
//      shape, not a second, drift-prone hand-rolled program.
//   2. `evaluateFieldProgramInterpreted` (normally not re-exported past
//      fieldProgram.ts itself) so the "before" timing calls the untouched
//      reference evaluator directly, not a reimplementation.
// Without them this script fails to import; re-add both (see this repo's
// commit history for the exact diff) to reproduce the numbers below.
//
// Run: `pnpm --filter @glyphcss/effects build` (repo root) first, then
// `node bench/compiled-field-program.mjs`.

import {
  GlyphCssGraphicsMengerPreset,
  GlyphGyroidXrayPreset,
  GlyphMengerSdfPreset,
  GlyphMengerSpongePreset,
  buildFieldSynthVoices,
  compileFieldSynthProgram,
  compileFieldVoices,
  defaultGlyphEffectParams,
  evaluateFieldProgramInterpreted,
  evaluateGlyphFieldProgram,
  GlyphFieldSynthEffect,
  resolveFieldSynthLayerShapes,
} from "../packages/effects/dist/index.js";

function compileProgramFromPreset(preset) {
  const merged = { ...defaultGlyphEffectParams(GlyphFieldSynthEffect), ...preset.params };
  const voices = buildFieldSynthVoices(merged);
  const scale = merged.scale;
  const compiledVoices = compileFieldVoices(voices, scale);
  const layerShapes = resolveFieldSynthLayerShapes(merged);
  const volumetric = merged.space === "object";
  const program = compileFieldSynthProgram(compiledVoices, layerShapes, volumetric);
  return { program, volumetric };
}

// 400,000-point irrational Kronecker sequence over [0,1]^3 (matching
// bench/fold-shortcut.mjs's own grid convention) — good spatial spread, no
// periodic aliasing against a duty-1/3 or duty-1/2 lattice.
const N = 400000;
function makePoints3d() {
  const points = new Array(N);
  const ax = 0.5545497465356925, ay = 0.308517558769232, az = 0.24099751242241782;
  let sx = 0, sy = 0, sz = 0;
  for (let i = 0; i < N; i++) {
    sx = (sx + ax) % 1; sy = (sy + ay) % 1; sz = (sz + az) % 1;
    points[i] = [sx, sy, sz];
  }
  return points;
}
const points3d = makePoints3d();

function timeOnce(fn, program, iterations) {
  const start = process.hrtime.bigint();
  let sink = 0;
  for (let i = 0; i < iterations; i++) {
    const p = points3d[i % N];
    sink += fn(program, p[0], p[1], p[2], 0, 0, 0, 0).combined;
  }
  const end = process.hrtime.bigint();
  if (!Number.isFinite(sink)) throw new Error("unreachable: sink went non-finite");
  return Number(end - start) / 1e6 / iterations;
}

// Best-of-N, interleaved: a single timed pass at microsecond-per-call scale
// is dominated by GC pauses/scheduler noise, not the code under test — the
// standard fix is many short interleaved trials with the MINIMUM taken per
// side (the fastest trial is the one least disturbed by an external pause),
// alternating which path goes first each round so neither gets a
// systematic warm-cache/cold-cache advantage.
function timeEvaluateBestOf(fnA, fnB, program, iterations, rounds) {
  for (let i = 0; i < 20000; i++) {
    const p = points3d[i % N];
    fnA(program, p[0], p[1], p[2], 0, 0, 0, 0);
    fnB(program, p[0], p[1], p[2], 0, 0, 0, 0);
  }
  let bestA = Infinity, bestB = Infinity;
  for (let r = 0; r < rounds; r++) {
    if (r % 2 === 0) {
      bestA = Math.min(bestA, timeOnce(fnA, program, iterations));
      bestB = Math.min(bestB, timeOnce(fnB, program, iterations));
    } else {
      bestB = Math.min(bestB, timeOnce(fnB, program, iterations));
      bestA = Math.min(bestA, timeOnce(fnA, program, iterations));
    }
  }
  return { msA: bestA, msB: bestB };
}

function maxAbsDiff(program, samples) {
  let maxDiff = 0;
  for (let i = 0; i < samples; i++) {
    const p = points3d[i % N];
    const interp = evaluateFieldProgramInterpreted(program, p[0], p[1], p[2], 0, 0, 0, 0);
    const compiled = evaluateGlyphFieldProgram(program, p[0], p[1], p[2], 0, 0, 0, 0);
    const d = Math.abs(interp.combined - compiled.combined);
    if (d > maxDiff) maxDiff = d;
    if (interp.winner !== compiled.winner) throw new Error(`winner mismatch @ ${i}: ${interp.winner} vs ${compiled.winner}`);
    if (interp.active !== compiled.active) throw new Error(`active mismatch @ ${i}: ${interp.active} vs ${compiled.active}`);
  }
  return maxDiff;
}

const presets = [
  ["GlyphMengerSpongePreset", GlyphMengerSpongePreset],
  ["GlyphCssGraphicsMengerPreset", GlyphCssGraphicsMengerPreset],
  ["GlyphGyroidXrayPreset", GlyphGyroidXrayPreset],
  ["GlyphMengerSdfPreset", GlyphMengerSdfPreset],
];

const ITER = 50000;
const ROUNDS = 9;
const results = [];
for (const [name, preset] of presets) {
  const { program, volumetric } = compileProgramFromPreset(preset);
  let totalVoices = 0;
  for (const layer of program.layers) for (const v of layer.voices) if (v.amp > 0) totalVoices++;

  const diff = maxAbsDiff(program, 100000);

  const { msA: msInterpreted, msB: msCompiled } = timeEvaluateBestOf(
    evaluateFieldProgramInterpreted, evaluateGlyphFieldProgram, program, ITER, ROUNDS,
  );
  const speedup = msInterpreted / msCompiled;

  results.push({ name, volumetric, layers: program.layers.length, totalVoices, diff, msInterpreted, msCompiled, speedup });
}

console.log(`grid: ${N} sample points, ${ITER} timed iterations per path (2000-call warmup first)\n`);
for (const r of results) {
  console.log(`${r.name}`);
  console.log(`  layers=${r.layers} active-voices/evaluate=${r.totalVoices} volumetric=${r.volumetric}`);
  console.log(`  max |combined diff| over 100,000 samples: ${r.diff}`);
  console.log(`  ms/evaluate (interpreted): ${r.msInterpreted.toFixed(5)}`);
  console.log(`  ms/evaluate (compiled):    ${r.msCompiled.toFixed(5)}`);
  console.log(`  speedup: ${r.speedup.toFixed(3)}x  (${(1e3 / r.msInterpreted).toFixed(2)} -> ${(1e3 / r.msCompiled).toFixed(2)} M probes/s)`);
  console.log();
}
