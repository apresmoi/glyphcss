// Frame-budget measurement for carve mode's default `marchSteps` (VOLUMETRIC.md's
// Carve section: "the implementation PR must include a measurement justifying
// the default marchSteps and documenting a recommended grid budget").
//
// Scenario: a 120x48 grid (5760 cells), half covered (2880 cells — a
// representative silhouette fraction), each covered cell a genuine
// objectPosition -> objectExit chord through the depth-2 Menger recipe's unit
// domain (the same voice/layer shape `mengerParams(2)` in
// packages/effects/src/stock.test.ts uses, reused here against the BUILT
// package so this script has no ts-node/tsx dependency). Runs
// `fieldSynth.program.evaluate()` (the real per-frame effect path) N times per
// marchSteps setting and reports mean per-evaluate() wall time.
//
// Run: `node packages/effects && pnpm build` first (this imports the built
// dist), then `node bench/carve-march.mjs`.

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

  // Half covered: every other cell (checkerboard-ish, but contiguous rows
  // alternate so it isn't a degenerate every-other-column pattern) gets a
  // genuine chord through the unit domain.
  let seed = 1;
  function rand() {
    // xorshift32 — deterministic, no external dependency.
    seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; seed |= 0;
    return ((seed >>> 0) / 0xffffffff);
  }
  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) {
      const i = row * COLS + col;
      if (((row + col) & 1) === 0) continue; // half covered
      coverage[i] = 1;
      // Entry on one face of the unit cube, exit on a plausibly-opposite
      // point — not physically exact ray-box geometry, but representative
      // chord lengths (~0.6-1.7 domain units) through the Menger patch's own
      // unit domain, which is what evaluate()'s cost actually depends on.
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

// The depth-2 Menger recipe (verbatim voice/layer shape from
// packages/effects/src/stock.test.ts's `mengerParams`): two layers of three
// axis voices each, duty-1/3 square waves selecting the base-3 "middle
// third", min-blended layers for the AND-of-scales membership rule.
function mengerAxisVoice(prefix, field, freq, layer) {
  return {
    [`field${prefix}`]: field, [`wave${prefix}`]: "square", [`freq${prefix}`]: freq, [`speed${prefix}`]: 0,
    [`amp${prefix}`]: 1, [`duty${prefix}`]: 1 / 3, [`phase${prefix}`]: -1 / 3, [`layer${prefix}`]: layer,
  };
}
function mengerLayerShape(layer) {
  return {
    [`layerCombine${layer}`]: "add",
    [`layerThresholdOn${layer}`]: true,
    [`layerThreshold${layer}`]: 0,
    [`layerInvert${layer}`]: true,
    [`layerBlend${layer}`]: "min",
    [`layerAmp${layer}`]: 1,
  };
}
function mengerParams() {
  return {
    space: "object", scale: 1, render: "carve",
    ...mengerAxisVoice(1, "linearX", 1, 1),
    ...mengerAxisVoice(2, "linearY", 1, 1),
    ...mengerAxisVoice(3, "linearZ", 1, 1),
    ...mengerLayerShape(1),
    ...mengerAxisVoice(4, "linearX", 3, 2),
    ...mengerAxisVoice(5, "linearY", 3, 2),
    ...mengerAxisVoice(6, "linearZ", 3, 2),
    ...mengerLayerShape(2),
  };
}

function bench(marchSteps, repeats) {
  const params = { ...defaultGlyphEffectParams(fieldSynth), ...mengerParams(), marchSteps };
  fieldSynth.program.validateParams?.(params);
  const context = buildContext(params);
  // Warm up (JIT).
  for (let k = 0; k < 5; k++) fieldSynth.program.evaluate(context);
  const start = performance.now();
  for (let k = 0; k < repeats; k++) fieldSynth.program.evaluate(context);
  const elapsed = performance.now() - start;
  return elapsed / repeats;
}

const REPEATS = 30;
console.log(`carve evaluate() bench — ${COLS}x${ROWS} grid, ${LENGTH / 2} covered cells, depth-2 Menger, ${REPEATS} repeats per setting\n`);
for (const marchSteps of [32, 48, 96]) {
  const meanMs = bench(marchSteps, REPEATS);
  console.log(`marchSteps=${marchSteps}: ${meanMs.toFixed(2)} ms/frame (${(1000 / meanMs).toFixed(1)} fps ceiling for this layer alone)`);
}
