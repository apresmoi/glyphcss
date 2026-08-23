// Measures `colorTolerance` (COLOR-TOLERANCE.md) against the six presets in
// its "Measured benefit" table, at matched mean colour error, across three
// merge policies:
//
//   - uniform: per-channel N-level bucketing (the removed `colorQuantize`'s
//     own mechanism, reimplemented here ONLY for comparison — it ships
//     nowhere in the library anymore).
//   - greedy RGB: the same run-extension algorithm the shipped
//     `colorTolerance` uses, but with a plain unweighted Euclidean RGB
//     distance instead of redmean.
//   - greedy perceptual: the REAL shipped mechanism — `colorRunExtends`
//     (redmean), called through the real `encodeGlyphBuffers`.
//
// All three read the exact same per-cell colour buffer, produced by the
// real, unmodified `fieldSynth.program.evaluate()` + `rasterizeToCells()`
// against each preset's real params — nothing here is a hand-rewritten
// stand-in for the render.
//
// Run: `pnpm build` (repo root) first, then `node bench/color-tolerance.mjs`.

import {
  encodeGlyphBuffers,
  GlyphEffectNoColor,
  buildRasterizeContext,
  createGlyphOrthographicCamera,
  rasterizeToCells,
} from "../packages/glyphcss/dist/index.js";
import {
  GlyphFieldSynthEffect as fieldSynth,
  GlyphBreathingGyroidPreset,
  GlyphCssGraphicsMengerPreset,
  defaultGlyphEffectParams,
} from "../packages/effects/dist/index.js";

const COLS = 140;
const ROWS = 50;
const N = COLS * ROWS;

function size3CubePolygons() {
  const s = 1.5;
  const faces = [
    [[-s, -s, s], [s, -s, s], [s, s, s], [-s, s, s]],
    [[-s, -s, -s], [-s, s, -s], [s, s, -s], [s, -s, -s]],
    [[-s, s, -s], [-s, s, s], [s, s, s], [s, s, -s]],
    [[-s, -s, s], [-s, -s, -s], [s, -s, -s], [s, -s, s]],
    [[s, -s, s], [s, -s, -s], [s, s, -s], [s, s, s]],
    [[-s, -s, -s], [-s, -s, s], [-s, s, s], [-s, s, -s]],
  ];
  return faces.map((vertices) => ({ vertices, color: "#8899cc" }));
}

// A single large quad facing the camera — the rig for every 2D ("auto"
// surface) preset (Cube tiles, Lava, Aurora, Nebula), which paint a pattern
// over the generated-surface fallback (no authored UV, no volumetric
// objectPosition), exactly like the `/synth` page's default flat stage.
function flatPlanePolygons() {
  const s = 6;
  return [{ vertices: [[-s, -s, 0], [s, -s, 0], [s, s, 0], [-s, s, 0]], color: "#8899cc" }];
}

function rasterizeVolumetric(polygons) {
  return rasterizeToCells(buildRasterizeContext({
    camera: createGlyphOrthographicCamera({ rotX: 32.5, rotY: 19, zoom: 380 }),
    grid: { cols: COLS, rows: ROWS, cellAspect: 2 },
    polygons,
    mode: "solid",
    useColors: false,
    doubleSided: true,
    retainObjectPosition: true,
    retainObjectExit: true,
    retainObjectNormal: true,
  }));
}

function rasterizeSurface(polygons) {
  return rasterizeToCells(buildRasterizeContext({
    camera: createGlyphOrthographicCamera({ rotX: 0, rotY: 0, zoom: 60 }),
    grid: { cols: COLS, rows: ROWS, cellAspect: 2 },
    polygons,
    mode: "solid",
    useColors: false,
    doubleSided: true,
    retainWorldPosition: true,
    retainNormal: true,
  }));
}

function runEvaluate(grid, params, time) {
  const glyphA = new Array(N).fill(" ");
  const coverage = new Float32Array(N);
  for (let i = 0; i < N; i++) coverage[i] = grid.depth[i] === -Infinity ? 0 : 1;
  const color = new Uint32Array(N).fill(GlyphEffectNoColor);
  const output = {
    glyph: new Array(N).fill(" "),
    color: new Uint32Array(N).fill(GlyphEffectNoColor),
    coverage: new Float32Array(N),
    channels: new Uint8Array(N),
  };
  fieldSynth.program.evaluate({
    params: { ...params, time },
    state: fieldSynth.program.createState ? fieldSynth.program.createState() : undefined,
    base: {
      cols: COLS, rows: ROWS, length: N, glyph: glyphA, coverage, color,
      objectPosition: grid.objectPosition, objectExit: grid.objectExit, objectNormal: grid.objectNormal,
      worldPosition: grid.worldPosition, normal: grid.normal,
    },
    input: { cols: COLS, rows: ROWS, length: N, glyph: glyphA, coverage, color },
    target: { coverage },
    coordinates: { cellToSceneGrid: [1, 0, 0, 1, 0, 0], sceneGridSize: [COLS, ROWS], localCellFootprint: [1, 1] },
    scratch: { images: [], floatFields: [], uintFields: [], glyphFields: [], samples: [] },
    output,
  });
  return output;
}

// One representative frame per preset (`time: 3`, matching color-quantize.mjs's
// precedent) — this bench is about the colour-merge policy holding the field's
// per-cell colour DISTRIBUTION fixed, not about animating it.
function coveredColors(grid, params) {
  const output = runEvaluate(grid, params, 3);
  const packed = [];
  for (let i = 0; i < N; i++) {
    if (output.coverage[i] > 0 && output.color[i] !== GlyphEffectNoColor) packed.push(output.color[i]);
    else packed.push(null);
  }
  return packed;
}

function unpack(p) {
  return [(p >> 16) & 0xff, (p >> 8) & 0xff, p & 0xff];
}

function redmean(a, b) {
  const [r1, g1, b1] = unpack(a);
  const [r2, g2, b2] = unpack(b);
  const rm = (r1 + r2) / 2;
  const dr = r1 - r2, dg = g1 - g2, db = b1 - b2;
  return Math.sqrt((2 + rm / 256) * dr * dr + 4 * dg * dg + (2 + (255 - rm) / 256) * db * db);
}

// -- Policy 1: uniform N-level per-channel bucketing (the removed
// `colorQuantize`'s own mechanism, standalone here for comparison only).
function uniformQuantize(colors, levels) {
  if (levels <= 0) return { quantized: colors, spans: countSpans(colors) };
  const step = 255 / levels;
  const q = colors.map((c) => {
    if (c === null) return null;
    const [r, g, b] = unpack(c);
    const qr = Math.round(Math.round(r / step) * step);
    const qg = Math.round(Math.round(g / step) * step);
    const qb = Math.round(Math.round(b / step) * step);
    return (qr << 16) | (qg << 8) | qb;
  });
  return { quantized: q, spans: countSpans(q) };
}

function countSpans(colors) {
  let spans = 0;
  for (let row = 0; row < ROWS; row++) {
    let prev = undefined;
    for (let col = 0; col < COLS; col++) {
      const c = colors[row * COLS + col];
      if (c === null) { prev = undefined; continue; }
      if (c !== prev) spans++;
      prev = c;
    }
  }
  return spans;
}

// -- Policy 2: greedy run-extension with plain (unweighted) Euclidean RGB
// distance — same algorithm shape as the shipped `colorRunExtends`, minus
// the redmean weighting.
function greedyRgb(colors, tolerance) {
  const tol2 = tolerance * tolerance;
  let spans = 0;
  const out = new Array(colors.length).fill(null);
  for (let row = 0; row < ROWS; row++) {
    let anchor = null;
    for (let col = 0; col < COLS; col++) {
      const idx = row * COLS + col;
      const c = colors[idx];
      if (c === null) { anchor = null; continue; }
      if (anchor === null) {
        spans++;
        anchor = c;
      } else if (c !== anchor) {
        const [r1, g1, b1] = unpack(anchor);
        const [r2, g2, b2] = unpack(c);
        const dr = r1 - r2, dg = g1 - g2, db = b1 - b2;
        const d2 = dr * dr + dg * dg + db * db;
        if (d2 > tol2) { spans++; anchor = c; }
      }
      out[idx] = anchor;
    }
  }
  return { runs: out, spans };
}

// -- Policy 3: greedy perceptual (redmean) — the SHIPPED mechanism, called
// through the real production encoder.
function greedyPerceptual(colors, tolerance) {
  const char = colors.map((c) => (c === null ? " " : "#"));
  const colorStrs = colors.map((c) => (c === null ? null : `#${c.toString(16).padStart(6, "0")}`));
  const html = encodeGlyphBuffers(char, colorStrs, COLS, ROWS, true, null, tolerance);
  const spans = (html.match(/<span/g) || []).length;
  // Reconstruct each run's anchor colour by replaying the same policy, so
  // mean error can be measured against the exact same runs the real encoder
  // produced (encodeGlyphBuffers itself doesn't expose per-cell output).
  const out = new Array(colors.length).fill(null);
  for (let row = 0; row < ROWS; row++) {
    let anchor = null;
    for (let col = 0; col < COLS; col++) {
      const idx = row * COLS + col;
      const c = colors[idx];
      if (c === null) { anchor = null; continue; }
      if (anchor === null || (c !== anchor && redmean(anchor, c) > tolerance)) anchor = c;
      out[idx] = anchor;
    }
  }
  return { runs: out, spans };
}

function meanError(trueColors, runColors) {
  let sum = 0, n = 0;
  for (let i = 0; i < trueColors.length; i++) {
    if (trueColors[i] === null) continue;
    sum += redmean(trueColors[i], runColors[i]);
    n++;
  }
  return n ? sum / n : 0;
}

// Sweep a policy's single knob until its mean error crosses the target,
// linear-interpolating between the two bracketing spans counts (span count
// is a step function of the knob, so "at matched error" means "at the
// coarsest knob setting whose error does not exceed target").
function sweepToError(evalAt, target, maxKnob) {
  let best = { knob: 0, spans: Infinity, err: 0 };
  for (let knob = 0; knob <= maxKnob; knob += Math.max(1, Math.round(maxKnob / 400))) {
    const { spans, err } = evalAt(knob);
    if (err <= target && spans < best.spans) best = { knob, spans, err };
  }
  return best;
}

function measurePreset(name, grid, params, targetError) {
  const trueColors = coveredColors(grid, params);
  const unquantizedSpans = countSpans(trueColors);

  const uniform = sweepToError((knob) => {
    const { quantized } = uniformQuantize(trueColors, knob);
    return { spans: countSpans(quantized), err: meanError(trueColors, quantized) };
  }, targetError, 64);

  const rgb = sweepToError((knob) => {
    const { runs, spans } = greedyRgb(trueColors, knob);
    return { spans, err: meanError(trueColors, runs) };
  }, targetError, 400);

  const perceptual = sweepToError((knob) => {
    const { runs, spans } = greedyPerceptual(trueColors, knob);
    return { spans, err: meanError(trueColors, runs) };
  }, targetError, 400);

  return { name, unquantizedSpans, uniform, rgb, perceptual };
}

const TARGET_ERROR = 8;

const cube = rasterizeVolumetric(size3CubePolygons());
const plane = rasterizeSurface(flatPlanePolygons());

const cssGraphicsMengerParams = { ...defaultGlyphEffectParams(fieldSynth), ...GlyphCssGraphicsMengerPreset.params };
const breathingGyroidParams = { ...defaultGlyphEffectParams(fieldSynth), ...GlyphBreathingGyroidPreset.params };

function presetParams(name) {
  const preset = fieldSynth.presets.find((p) => p.name === name);
  if (!preset) throw new Error(`no preset named ${name}`);
  return { ...defaultGlyphEffectParams(fieldSynth), ...preset.params };
}

const results = [
  measurePreset("Menger (cssGraphics)", cube, cssGraphicsMengerParams, TARGET_ERROR),
  measurePreset("Breathing gyroid", cube, breathingGyroidParams, TARGET_ERROR),
  measurePreset("Lava", plane, presetParams("Lava"), TARGET_ERROR),
  measurePreset("Aurora", plane, presetParams("Aurora"), TARGET_ERROR),
  measurePreset("Nebula", plane, presetParams("Nebula"), TARGET_ERROR),
  measurePreset("Cube tiles", plane, presetParams("Cube tiles"), TARGET_ERROR),
];

console.log(`Target mean colour error: ~${TARGET_ERROR} (redmean). Grid ${COLS}x${ROWS}.\n`);
console.log("preset | unquantized | uniform | greedy RGB | greedy perceptual");
console.log("---|---|---|---|---");
for (const r of results) {
  console.log(
    `${r.name} | ${r.unquantizedSpans} | ${r.uniform.spans} (N=${r.uniform.knob}, err ${r.uniform.err.toFixed(1)}) `
    + `| ${r.rgb.spans} (tol=${r.rgb.knob}, err ${r.rgb.err.toFixed(1)}) `
    + `| ${r.perceptual.spans} (tol=${r.perceptual.knob}, err ${r.perceptual.err.toFixed(1)})`,
  );
}
