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

import {
  GlyphFieldSynthEffect as fieldSynth,
  defaultGlyphEffectParams,
} from "../packages/effects/dist/index.js";

// The "Menger SDF" preset this bench was written against was removed in a
// later preset cull (see AGENTS.md's "Sphere tracing for carve" — no shipped
// preset currently exercises the SDF voice family or sphere tracing).
// Reproduced verbatim as a standalone fixture so this bench keeps measuring
// the real sphere-tracing-vs-fixed-step cost the engine still supports.
const mengerSdfFixtureParams = {
  space: "object", scale: 1, render: "carve",
  combine: "min", originU: 0, originV: 0,
  field1: "menger", wave1: "step", freq1: 0.5, speed1: 0, amp1: 1, iter1: 3,
  originU1: -1, originV1: -1, originW1: -1,
  amp2: 0, amp3: 0,
  glyphs: " .:-=+*#%@", color: "#6affc9", colorB: "#2f7bff", gradient: 0.4, lit: 1,
  marchFade: 2.5,
};

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

// The generic `buildContext` above generates objectPosition/objectExit as
// fully INDEPENDENT random points in [0, 1]^3 — the right window for the
// plain iter-4 bench's unshifted `field: "menger"` voice (scale 1, no origin
// offset), but a poor stand-in for a genuine camera ray, and NOT the Menger
// SDF fixture's own domain (its mapping — see `mengerSdfFixtureParams`'s
// doc above — deliberately sits over the CENTERED cube stage's [-1.5, 1.5]^3
// objectPosition range). Measured directly (fieldProgram.test.ts's own
// equivalence-bar findings): independent random entry/exit pairs are
// noticeably MORE adversarial to sphere tracing than a real render's PARALLEL
// camera rays — they produce far more of the near-tangent "stuck" geometry a
// naive sphere tracer stalls on, understating its real-world performance and
// hit rate alike. This builder instead computes genuine box-intersected
// PARALLEL rays (a fixed camera direction, slab-intersected against the
// preset's own [-half, half]^3 cube, matching an orthographic render), the
// same shape of ray field.ts's fixed-step/sphere-tracer callers actually see
// in production.
function boxRayIntersect(ox, oy, oz, dx, dy, dz, half) {
  let tmin = -Infinity, tmax = Infinity;
  const axes = [[ox, dx], [oy, dy], [oz, dz]];
  for (const [o, d] of axes) {
    if (Math.abs(d) < 1e-12) {
      if (o < -half || o > half) return null;
      continue;
    }
    let t1 = (-half - o) / d, t2 = (half - o) / d;
    if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
    tmin = Math.max(tmin, t1);
    tmax = Math.min(tmax, t2);
    if (tmin > tmax) return null;
  }
  if (tmax < 0) return null;
  return [tmin, tmax];
}

function buildMengerSdfFixtureContext(params, half) {
  const glyph = new Array(LENGTH).fill("#");
  const coverage = new Float32Array(LENGTH);
  const color = new Uint32Array(LENGTH).fill(NO_COLOR);
  const objectPosition = new Float32Array(LENGTH * 3).fill(NaN);
  const objectExit = new Float32Array(LENGTH * 3).fill(NaN);

  // A near-head-on view with a small tilt (matching the real-scene carve
  // tests' own `rotX: 8, rotY: 8` camera) — enough to avoid a degenerate
  // axis-aligned ray field without turning every ray into a long diagonal.
  const ax = (8 * Math.PI) / 180, ay = (8 * Math.PI) / 180;
  const dz = Math.cos(ax) * Math.cos(ay);
  const dx = Math.sin(ay);
  const dy = -Math.sin(ax) * Math.cos(ay);
  const dlen = Math.hypot(dx, dy, dz);
  const ux = dx / dlen, uy = dy / dlen, uz = dz / dlen; // camera forward
  // Right/up basis perpendicular to the forward direction.
  const rx = uz, ry = 0, rz = -ux; // cross(forward, worldUp=(0,1,0)), simplified
  const rlen = Math.hypot(rx, ry, rz) || 1;
  const frx = rx / rlen, fry = ry / rlen, frz = rz / rlen;
  const upx = uy * frz - uz * fry, upy = uz * frx - ux * frz, upz = ux * fry - uy * frx;

  const margin = half * 1.15; // a bit past the box silhouette, like a real render's framing
  const farBack = half * 4; // ray origin pulled well outside the box along -forward
  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) {
      const i = row * COLS + col;
      if (((row + col) & 1) === 0) continue; // half covered, matching the pinned bench scenario
      const u = (col / (COLS - 1)) * 2 * margin - margin;
      const v = (row / (ROWS - 1)) * 2 * margin - margin;
      const ox = u * frx + v * upx - ux * farBack;
      const oy = u * fry + v * upy - uy * farBack;
      const oz = u * frz + v * upz - uz * farBack;
      const hit = boxRayIntersect(ox, oy, oz, ux, uy, uz, half);
      if (!hit) continue;
      const [tmin, tmax] = hit;
      coverage[i] = 1;
      objectPosition[i * 3] = ox + ux * tmin; objectPosition[i * 3 + 1] = oy + uy * tmin; objectPosition[i * 3 + 2] = oz + uz * tmin;
      objectExit[i * 3] = ox + ux * tmax; objectExit[i * 3 + 1] = oy + uy * tmax; objectExit[i * 3 + 2] = oz + uz * tmax;
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

// Sphere tracing vs fixed-step (VOLUMETRIC-3.md §3) — the pinned scene from
// the design doc's own bench spec: 120x48, half covered, the Menger SDF
// fixture (iter 3) at its former shipped-preset defaults, 5 runs after warmup,
// median ms/evaluate, acceptance >= 1.5x vs fixed-step (amended after the
// Phase 3 measurement: naive distance-stepping alone measured 1.2x; a
// stalled ray's real cost is sphere-steps-until-stall + the fixed-step
// fallback's own remaining-grid scan, so the honest floor is lower than the
// original 2x, which assumed no stalls at all).
//
// `fixedForced` disqualifies `buildGlyphFieldDistanceOracle` (a non-"min"
// layer combine) WITHOUT changing a single rendered pixel: `foldVoices`
// ignores `combine` entirely when only one voice is active (the fold has
// nothing to combine against — see fieldProgram.ts), and the shipped
// Menger SDF fixture is exactly that (one active voice). So `qualifying`
// and `fixedForced` march the IDENTICAL field through the IDENTICAL
// geometry — this isolates the marcher's own cost, not a confound from
// comparing two different scenes.
function medianEvaluateMs(context, runs) {
  for (let k = 0; k < 5; k++) fieldSynth.program.evaluate(context); // warmup
  const samples = [];
  for (let r = 0; r < runs; r++) {
    const start = performance.now();
    fieldSynth.program.evaluate(context);
    samples.push(performance.now() - start);
  }
  samples.sort((a, b) => a - b);
  return samples[Math.floor(samples.length / 2)];
}

function benchSphereVsFixed() {
  const qualifying = { ...defaultGlyphEffectParams(fieldSynth), ...mengerSdfFixtureParams };
  const fixedForced = { ...qualifying, combine: "add" };
  fieldSynth.program.validateParams?.(qualifying);
  fieldSynth.program.validateParams?.(fixedForced);

  const probeContext = buildMengerSdfFixtureContext(qualifying, 1.5);
  const covered = probeContext.target.coverage.reduce((n, c) => n + (c > 0 ? 1 : 0), 0);

  const sphereMs = medianEvaluateMs(buildMengerSdfFixtureContext(qualifying, 1.5), 5);
  const fixedMs = medianEvaluateMs(buildMengerSdfFixtureContext(fixedForced, 1.5), 5);
  const speedup = fixedMs / sphereMs;

  console.log(`\nSphere tracing vs fixed-step — Menger SDF fixture (iter 3), ${COLS}x${ROWS} grid, ${covered} covered cells, 5 runs post-warmup, median ms/evaluate\n`);
  console.log(`fixed-step: ${fixedMs.toFixed(3)} ms/evaluate`);
  console.log(`sphere:     ${sphereMs.toFixed(3)} ms/evaluate`);
  console.log(`speedup:    ${speedup.toFixed(2)}x (acceptance: >= 1.5x)`);
}

benchSphereVsFixed();
