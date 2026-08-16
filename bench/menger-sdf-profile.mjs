// Perf investigation: "why is the menger SDF so slow?" (/synth's Menger SDF
// preset renders 7-15 FPS vs 60+ for wave-based patches). Profiles the
// SHIPPED "Menger SDF" preset (mengerSdfPreset, stock.ts) at the live
// page's approximate grid (135x52, half covered) BEFORE any optimization —
// see the accompanying report for the after-numbers and what changed.
//
// This file drives the same exported building blocks
// bench/sdf-carve-march.mjs uses (buildGlyphFieldDistanceOracle,
// marchGlyphFieldSphere, buildGlyphFieldProgram, evaluateFieldProgram) so
// every timing number below is the REAL production code path, not a
// hand-rewritten stand-in.
//
// Node-visit counting (item b: "SDF node visits per oracle call") needs
// visibility INSIDE the recursive box-union descent (fractalUnionSdf,
// fieldProgram.ts), which has no public surface. For this profiling run
// only, fieldProgram.ts carries one guarded, single-line counter probe
// (`globalThis.__SDF_PROFILE`) at the top of fractalUnionSdf — zero-cost
// (one falsy property check) when __SDF_PROFILE is unset, i.e. in every
// normal (non-profiling) run. Reverted after this investigation; not part
// of any shipped optimization.
//
// Run: `pnpm --filter @glyphcss/effects build && pnpm --filter glyphcss build && node bench/menger-sdf-profile.mjs`

import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const require = createRequire(path.join(repoRoot, "packages/effects/package.json"));

// ---- happy-dom, for the "effect vs render pipeline" split (item d) -------
const { Window } = require("happy-dom");
const window = new Window();
globalThis.document = window.document;
globalThis.window = window;
globalThis.HTMLElement = window.HTMLElement;
globalThis.customElements = window.customElements;
globalThis.getComputedStyle = window.getComputedStyle.bind(window);

const glyphcss = require(path.join(repoRoot, "packages/glyphcss/dist/index.cjs"));
const effects = require(path.join(repoRoot, "packages/effects/dist/index.cjs"));

const {
  GlyphFieldSynthEffect: fieldSynth,
  GlyphMengerSdfPreset: mengerSdfPreset,
  GlyphMengerSpongePreset: mengerSpongePreset,
  defaultGlyphEffectParams,
  buildGlyphFieldProgram,
  buildGlyphFieldDistanceOracle,
  marchGlyphFieldSphere,
  evaluateGlyphFieldProgram: evaluateFieldProgram,
} = effects;

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

// ---- shared grid geometry (135x52, half covered — the live /synth page's
// approximate cube-stage viewport) -----------------------------------------
const COLS = 135;
const ROWS = 52;
const LENGTH = COLS * ROWS;
const NO_COLOR = 0xffffffff;
const HALF = 1.5; // mengerSdfPreset's cube stage: [-1.5, 1.5]^3

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

// Camera basis matching the stage hint mengerSdfPreset ships with (rotX 15,
// rotY 40) is a much steeper angle than sdf-carve-march.mjs's rotX/rotY 8 —
// use the SAME derivation, just parameterized, so this bench's chords match
// what the live page's camera actually produces, not an arbitrary probe angle.
function buildCameraBasis(rotXDeg, rotYDeg) {
  const ax = (rotXDeg * Math.PI) / 180, ay = (rotYDeg * Math.PI) / 180;
  const dz = Math.cos(ax) * Math.cos(ay);
  const dx = Math.sin(ay);
  const dy = -Math.sin(ax) * Math.cos(ay);
  const dlen = Math.hypot(dx, dy, dz);
  const ux = dx / dlen, uy = dy / dlen, uz = dz / dlen;
  const rx = uz, ry = 0, rz = -ux;
  const rlen = Math.hypot(rx, ry, rz) || 1;
  const frx = rx / rlen, fry = ry / rlen, frz = rz / rlen;
  const upx = uy * frz - uz * fry, upy = uz * frx - ux * frz, upz = ux * fry - uy * frx;
  return { ux, uy, uz, frx, fry, frz, upx, upy, upz };
}

// Every covered cell's real (entry, exit) object-space chord through the
// preset's cube, half-covered checkerboard, at the given grid + camera angle.
function buildRays(cols, rows, half, rotXDeg, rotYDeg) {
  const { ux, uy, uz, frx, fry, frz, upx, upy, upz } = buildCameraBasis(rotXDeg, rotYDeg);
  const margin = half * 1.15;
  const farBack = half * 4;
  const rays = [];
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      if (((row + col) & 1) === 0) continue;
      const u = (col / (cols - 1)) * 2 * margin - margin;
      const v = (row / (rows - 1)) * 2 * margin - margin;
      const ox = u * frx + v * upx - ux * farBack;
      const oy = u * fry + v * upy - uy * farBack;
      const oz = u * frz + v * upz - uz * farBack;
      const hit = boxRayIntersect(ox, oy, oz, ux, uy, uz, half);
      if (!hit) continue;
      const [tmin, tmax] = hit;
      rays.push({
        entry: [ox + ux * tmin, oy + uy * tmin, oz + uz * tmin],
        exit: [ox + ux * tmax, oy + uy * tmax, oz + uz * tmax],
      });
    }
  }
  return rays;
}

function buildFullContext(params, rays, cols, rows) {
  const length = cols * rows;
  const glyph = new Array(length).fill("#");
  const coverage = new Float32Array(length);
  const color = new Uint32Array(length).fill(NO_COLOR);
  const objectPosition = new Float32Array(length * 3).fill(NaN);
  const objectExit = new Float32Array(length * 3).fill(NaN);
  let ri = 0;
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const i = row * cols + col;
      if (((row + col) & 1) === 0) continue;
      const ray = rays[ri++];
      if (!ray) continue;
      coverage[i] = 1;
      objectPosition[i * 3] = ray.entry[0]; objectPosition[i * 3 + 1] = ray.entry[1]; objectPosition[i * 3 + 2] = ray.entry[2];
      objectExit[i * 3] = ray.exit[0]; objectExit[i * 3 + 1] = ray.exit[1]; objectExit[i * 3 + 2] = ray.exit[2];
    }
  }
  const output = {
    glyph: new Array(length).fill(" "),
    color: new Uint32Array(length).fill(NO_COLOR),
    coverage: new Float32Array(length),
    channels: new Uint8Array(length),
  };
  return {
    params, state: undefined,
    base: { cols, rows, length, glyph, coverage, color, objectPosition, objectExit },
    input: { cols, rows, length, glyph, coverage, color },
    target: { coverage },
    coordinates: { cellToSceneGrid: [1, 0, 0, 1, 0, 0], sceneGridSize: [cols, rows], localCellFootprint: [1, 1] },
    scratch: { images: [], floatFields: [], uintFields: [], glyphFields: [], samples: [] },
    output,
  };
}

function median(arr) {
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}
function mean(arr) { return arr.reduce((a, b) => a + b, 0) / (arr.length || 1); }
function max(arr) { return arr.reduce((a, b) => Math.max(a, b), -Infinity); }

// ── Item (a)/(c): total ms/evaluate, real full pipeline ───────────────────
function benchEvaluate(name, params, rays, cols, rows, runs = 7) {
  const context = buildFullContext(params, rays, cols, rows);
  for (let k = 0; k < 5; k++) fieldSynth.program.evaluate(context); // warmup
  const samples = [];
  for (let k = 0; k < runs; k++) {
    const t0 = performance.now();
    fieldSynth.program.evaluate(context);
    samples.push(performance.now() - t0);
  }
  const m = median(samples);
  console.log(`  ${name.padEnd(38)} ${m.toFixed(2).padStart(8)} ms/evaluate   (${(1000 / m).toFixed(1)} fps ceiling, layer alone)`);
  return m;
}

console.log(`=== Menger SDF perf profile — ${COLS}x${ROWS} grid, half covered ===\n`);

const rotX = 15, rotY = 40; // mengerSdfPreset's shipped STAGE_HINTS angle
const rays = buildRays(COLS, ROWS, HALF, rotX, rotY);
console.log(`covered cells with a real box chord: ${rays.length} / ${LENGTH / 2} half-covered budget\n`);

console.log("-- (a)/(c) total ms/evaluate, real full pipeline --");
const mengerParams = { ...defaultGlyphEffectParams(fieldSynth), ...mengerSdfPreset.params };
const mengerFixedForced = { ...mengerParams, combine: "add" }; // disqualifies the oracle (see sdf-carve-march.mjs's own doc)
const spongeParams = { ...defaultGlyphEffectParams(fieldSynth), ...mengerSpongePreset.params };

const msSphere = benchEvaluate("Menger SDF (sphere-trace, shipped)", mengerParams, rays, COLS, ROWS);
const msFixed = benchEvaluate("Menger SDF (fixed-step, forced)", mengerFixedForced, rays, COLS, ROWS);
const msSponge = benchEvaluate("Menger sponge (wave recipe, control)", spongeParams, rays, COLS, ROWS);
console.log(`  sphere-trace speedup over fixed-step: ${(msFixed / msSphere).toFixed(2)}x`);
console.log(`  SDF-specific cost over the wave-recipe control: ${(msSphere / msSponge).toFixed(2)}x\n`);

// ── Item (b): march steps/cell, SDF node visits/oracle-call, fallback rate
console.log("-- (b) per-cell march cost (direct driver, same oracle/marcher/program) --");

const mengerProgram = buildGlyphFieldProgram({
  domain: "3d",
  layers: [{
    voices: [{ field: "menger", wave: "step", freq: 0.5, amp: 1, iter: 3, originU: -1, originV: -1, originW: -1 }],
    combine: "min",
  }],
});
const oracleParams = { bias: mengerParams.bias, gain: mengerParams.gain };
const realOracle = buildGlyphFieldDistanceOracle(mengerProgram, oracleParams, 0);
// `effectiveVoiceFinestFreq` isn't part of the public surface — mirror its
// documented menger formula directly (fieldProgram.ts: `freq * 3 **
// clampSdfIter(iter)`) rather than widen the package's exports for a bench.
const finestFreq = 0.5 * 3 ** 3;
const realDensitySample = (x, y, z, t) => clamp01(
  mengerParams.bias + mengerParams.gain * evaluateFieldProgram(mengerProgram, x, y, z, t, 0, 0, 0).combined * 0.5,
);

globalThis.__SDF_PROFILE = { nodeVisits: 0 };

const stepsPerCell = [];
const nodeVisitsPerOracleCall = [];
let fallbackCells = 0;
let hitCells = 0;
let missCells = 0;

for (const { entry, exit } of rays) {
  let oracleCalls = 0;
  let samplerCalls = 0;
  const countingOracle = (x, y, z, ox, oy, oz) => {
    oracleCalls++;
    const before = globalThis.__SDF_PROFILE.nodeVisits;
    const d = realOracle(x, y, z, ox, oy, oz);
    nodeVisitsPerOracleCall.push(globalThis.__SDF_PROFILE.nodeVisits - before);
    return d;
  };
  const countingSampler = (x, y, z, t) => { samplerCalls++; return realDensitySample(x, y, z, t); };
  const result = marchGlyphFieldSphere(entry, exit, countingOracle, countingSampler, {
    time: 0, originX: 0, originY: 0, originZ: 0, steps: mengerParams.marchSteps, maxSteps: 256, finestFreq,
  });
  stepsPerCell.push(oracleCalls);
  if (samplerCalls >= 2) fallbackCells++; // normal hit path samples the real field at most once (the confirm step)
  if (result.hit) hitCells++; else missCells++;
}

console.log(`  march steps/cell (oracle calls):  mean ${mean(stepsPerCell).toFixed(1)}   max ${max(stepsPerCell)}`);
if (globalThis.__SDF_PROFILE.nodeVisits > 0) {
  console.log(`  SDF node visits / oracle call:     mean ${mean(nodeVisitsPerOracleCall).toFixed(1)}   max ${max(nodeVisitsPerOracleCall)}`);
  console.log(`  total oracle calls across grid:    ${nodeVisitsPerOracleCall.length}`);
  console.log(`  total node visits across grid:     ${globalThis.__SDF_PROFILE.nodeVisits}`);
} else {
  // Node-visit counting needs a probe INSIDE fractalUnionSdf
  // (globalThis.__SDF_PROFILE.nodeVisits++ per recursive call) that isn't
  // part of the shipped code — it was added temporarily for the original
  // profiling pass (perf packet: "why is the Menger SDF preset slow") and
  // reverted once it had answered that question (mean 4.0, max 5 node
  // visits per oracle call, iter 3, this same grid/preset) rather than
  // carry a permanent instrumentation branch in a hot recursive function.
  console.log(`  SDF node visits / oracle call:     [probe reverted — see bench/sdf-carve-march.md's "before" table: mean 4.0, max 5 at iter 3]`);
  console.log(`  total oracle calls across grid:    ${stepsPerCell.reduce((a, b) => a + b, 0)}`);
}
console.log(`  fallback-to-fixed rate:            ${((100 * fallbackCells) / rays.length).toFixed(1)}% of cells (${fallbackCells}/${rays.length})`);
console.log(`  hit/miss:                          ${hitCells} hit, ${missCells} miss\n`);

// Done with the node-visit probe — clear it before any TIMED section below
// so the guarded check in fractalUnionSdf isn't part of what's measured.
delete globalThis.__SDF_PROFILE;

// ── Item (a): oracle vs sampler vs "everything else" (paint/shading in
// stock.ts's per-cell loop) — the direct driver above uses the SAME
// exported marchGlyphFieldSphere/oracle/sampler the real pipeline calls, so
// timing IT is a faithful proxy for "time spent marching" inside evaluate();
// the residual against the real evaluate() total (measured above) is
// everything else evaluate() does per cell (paint/shading/glyph pick/etc).
//
// The oracle-vs-sampler split itself is reported by CALL COUNT, not by
// separately timing each in isolation: a hand-rolled oracle-only sweep that
// skips the real stall/fallback logic doesn't terminate on the same cells
// the real marcher does (it burns extra steps chasing convergence the real
// code would have already abandoned to the fixed-step fallback), so its
// wall-clock isn't a trustworthy proxy — measured directly, it reported
// MORE time than the combined march, which is the tell. Call counts have no
// such confound: every oracle() and sampler() invocation below is the real
// closure, called from the real marchGlyphFieldSphere.
console.log("-- (a) time split: march (oracle+sampler) vs everything else --");
{
  let totalOracleCalls = 0, totalSamplerCalls = 0;
  const countedOracle = (x, y, z, ox, oy, oz) => { totalOracleCalls++; return realOracle(x, y, z, ox, oy, oz); };
  const countedSampler = (x, y, z, t) => { totalSamplerCalls++; return realDensitySample(x, y, z, t); };
  let marchMs = 0;
  for (let warm = 0; warm < 3; warm++) {
    for (const { entry, exit } of rays) {
      marchGlyphFieldSphere(entry, exit, realOracle, realDensitySample, {
        time: 0, originX: 0, originY: 0, originZ: 0, steps: mengerParams.marchSteps, maxSteps: 256, finestFreq,
      });
    }
  }
  const RUNS = 5;
  for (let run = 0; run < RUNS; run++) {
    const t0 = performance.now();
    for (const { entry, exit } of rays) {
      marchGlyphFieldSphere(entry, exit, realOracle, realDensitySample, {
        time: 0, originX: 0, originY: 0, originZ: 0, steps: mengerParams.marchSteps, maxSteps: 256, finestFreq,
      });
    }
    marchMs += performance.now() - t0;
  }
  marchMs /= RUNS;
  // One more pass, counted (not timed — the counters make this pass itself
  // slightly slower, which is why it's a separate untimed pass).
  for (const { entry, exit } of rays) {
    marchGlyphFieldSphere(entry, exit, countedOracle, countedSampler, {
      time: 0, originX: 0, originY: 0, originZ: 0, steps: mengerParams.marchSteps, maxSteps: 256, finestFreq,
    });
  }

  const sphereEvalMs = msSphere; // from the real full-pipeline bench above
  const everythingElseMs = Math.max(0, sphereEvalMs - marchMs);
  console.log(`  march (oracle+sampler+marcher loop), direct driver: ${marchMs.toFixed(2)} ms   (${((100 * marchMs) / sphereEvalMs).toFixed(0)}% of real evaluate())`);
  console.log(`    oracle() calls: ${totalOracleCalls}   sampler() calls: ${totalSamplerCalls}   (ratio ${(totalOracleCalls / totalSamplerCalls).toFixed(1)}:1 — oracle dominates call volume; sampler is 1-2 real-field evaluations per cell: the confirm resample and/or the fallback scan)`);
  console.log(`  everything else in evaluate() (paint/shading/glyph pick/color): ${everythingElseMs.toFixed(2)} ms   (${((100 * everythingElseMs) / sphereEvalMs).toFixed(0)}% of real evaluate())\n`);
}

// ── Item (d): effect vs rest of the render pipeline (rasterize/compositor/DOM write)
console.log("-- (d) effect share of a real render (happy-dom, real createGlyphScene) --");
{
  glyphcss.injectGlyphBaseStyles(document);
  const cube = glyphcss.resolveGeometry("cube", { size: 3 });

  // happy-dom has no real layout, so autoSize's font-metric measurement
  // can't run — cols/rows are pinned explicitly (135x52, matching the rest
  // of this file) and zoom is hand-tuned (not STAGE_CAMERA_ZOOM, which
  // assumes a real measured cell size) so the cube covers a similar
  // fraction of the grid as items (a)-(c)'s ~3380/7020 real chords —
  // verified by probe: zoom 610 -> ~3515 non-space cells.
  const FRAMED_ZOOM = 610;

  function buildScene(withEffect) {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const camera = glyphcss.createGlyphOrthographicCamera({ rotX, rotY, zoom: FRAMED_ZOOM });
    const scene = glyphcss.createGlyphScene(host, {
      camera, autoSize: false, cols: COLS, rows: ROWS, mode: "solid", useColors: true, glyphPalette: "default",
    });
    scene.add(cube);
    let layer = null;
    if (withEffect) layer = scene.addEffectLayer({ effect: fieldSynth, params: mengerParams, blend: "replace", target: "surfaces" });
    scene.rerender();
    return { scene, layer, host };
  }

  function timeRerenders(scene, runs = 15) {
    for (let k = 0; k < 5; k++) scene.rerender();
    const samples = [];
    for (let k = 0; k < runs; k++) {
      const t0 = performance.now();
      scene.rerender();
      samples.push(performance.now() - t0);
    }
    return median(samples);
  }

  const withEffect = buildScene(true);
  const effectMs = timeRerenders(withEffect.scene);

  const baseline = buildScene(false);
  const baselineMs = timeRerenders(baseline.scene);

  console.log(`  full scene.rerender() WITH Menger SDF effect:    ${effectMs.toFixed(2)} ms   (${(1000 / effectMs).toFixed(1)} fps ceiling)`);
  console.log(`  full scene.rerender() WITHOUT any effect layer:  ${baselineMs.toFixed(2)} ms   (${(1000 / baselineMs).toFixed(1)} fps ceiling)`);
  console.log(`  effect's share of the render:                    ${(effectMs - baselineMs).toFixed(2)} ms (${((100 * (effectMs - baselineMs)) / effectMs).toFixed(0)}% of the full frame)`);
}

delete globalThis.__SDF_PROFILE;
