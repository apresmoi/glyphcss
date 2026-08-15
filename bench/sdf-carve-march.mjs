// Before/after cost check for the P1-A SDF distance-fidelity fix (slice-2
// Phase 2 fixer pass): mengerFractalSdf/sierpinskiFractalSdf moved from the
// old (cheap but wrong) CSG-max construction to a recursive box-union
// descent with bounding-volume pruning. Same scenario/shape as
// bench/carve-march.mjs (120x48 grid, half covered, genuine
// objectPosition -> objectExit chords through the unit domain), but mounts
// a single `field: "menger"`/`"sierpinski"` SDF voice directly (not the
// linear-field recipe) at iter 4 (the schema cap) — the case this fix
// changes the cost of.
//
// Run: `pnpm --filter @glyphcss/effects build && node bench/sdf-carve-march.mjs`.

import { GlyphFieldSynthEffect as fieldSynth, defaultGlyphEffectParams } from "../packages/effects/dist/index.js";

const COLS = 120;
const ROWS = 48;
const LENGTH = COLS * ROWS;
const NO_COLOR = 0xffffffff;

function buildContext(params) {
  const glyph = new Array(LENGTH).fill("#");
  const coverage = new Float32Array(LENGTH);
  const color = new Uint32Array(LENGTH).fill(NO_COLOR);
  const objectPosition = new Float32Array(LENGTH * 3).fill(NaN);
  const objectExit = new Float32Array(LENGTH * 3).fill(NaN);

  let seed = 1;
  function rand() {
    seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; seed |= 0;
    return ((seed >>> 0) / 0xffffffff);
  }
  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) {
      const i = row * COLS + col;
      if (((row + col) & 1) === 0) continue; // half covered
      coverage[i] = 1;
      const ex = rand(), ey = rand(), ez = rand();
      const xx = rand(), xy = rand(), xz = rand();
      objectPosition[i * 3] = ex; objectPosition[i * 3 + 1] = ey; objectPosition[i * 3 + 2] = ez;
      objectExit[i * 3] = xx; objectExit[i * 3 + 1] = xy; objectExit[i * 3 + 2] = xz;
    }
  }

  const output = {
    glyph: new Array(LENGTH).fill(" "),
    color: new Uint32Array(LENGTH).fill(NO_COLOR),
    coverage: new Float32Array(LENGTH),
    channels: new Uint8Array(LENGTH),
  };

  return {
    params,
    state: undefined,
    base: { cols: COLS, rows: ROWS, length: LENGTH, glyph, coverage, color, objectPosition, objectExit },
    input: { cols: COLS, rows: ROWS, length: LENGTH, glyph, coverage, color },
    target: { coverage },
    coordinates: { cellToSceneGrid: [1, 0, 0, 1, 0, 0], sceneGridSize: [COLS, ROWS], localCellFootprint: [1, 1] },
    scratch: { images: [], floatFields: [], uintFields: [], glyphFields: [], samples: [] },
    output,
  };
}

function sdfParams(field, iter) {
  return {
    space: "object", scale: 1, render: "carve",
    field1: field, wave1: "step", freq1: 1, iter1: iter, amp1: 1,
  };
}

function bench(field, iter, repeats) {
  const params = { ...defaultGlyphEffectParams(fieldSynth), ...sdfParams(field, iter), marchSteps: 48 };
  fieldSynth.program.validateParams?.(params);
  const context = buildContext(params);
  for (let k = 0; k < 5; k++) fieldSynth.program.evaluate(context);
  const start = performance.now();
  for (let k = 0; k < repeats; k++) fieldSynth.program.evaluate(context);
  const elapsed = performance.now() - start;
  return elapsed / repeats;
}

const REPEATS = 20;
console.log(`SDF carve evaluate() bench — ${COLS}x${ROWS} grid, ${LENGTH / 2} covered cells, iter 4, ${REPEATS} repeats per field\n`);
for (const field of ["menger", "sierpinski"]) {
  const meanMs = bench(field, 4, REPEATS);
  console.log(`${field} iter4: ${meanMs.toFixed(2)} ms/frame (${(1000 / meanMs).toFixed(1)} fps ceiling for this layer alone)`);
}
