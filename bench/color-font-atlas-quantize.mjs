// Quality gate for the colour-font atlas's palette quantizer.
//
// Question: does encoding a render through a ≤31-slot quantized palette carry
// MORE visual error than the span render it replaces? The span render at
// `colorTolerance: 0` is exact by definition, so the honest comparison is
// against `colorTolerance: 32` — the merge policy `/synth` actually ships,
// which also substitutes colours, in the same redmean units.
//
// Inputs are REAL per-cell buffers captured from the live site's spans render
// (see `capture-frames.mjs` alongside this file's own harness notes below),
// not synthesized ramps: three scenes chosen for three different colour
// mechanisms — a Lambert-shaded 3D mesh (`/examples/parthenon`), a photo on a
// textured quad (`/examples/image`), and an animating field-synth patch
// (`/synth`).
//
// Everything measured here runs the SHIPPED code:
// `createGlyphAtlasPaletteQuantizer` (fed frame by frame, exactly as a live
// scene feeds it) and `nearestPaletteIndex` (the encoder's own slot
// assignment). Only `colorTolerance`'s row-wise anchor merge is reimplemented,
// because the shipped encoder returns a string rather than the per-cell
// colours it emitted; the rule is a direct transcription of
// `cells.ts`'s `encodeGlyphBuffers` (anchor, not previous cell; blanks break
// the run) and is verified against the shipped span COUNT below.
//
// Run: node bench/color-font-atlas-quantize.mjs <frames.json>

import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  createGlyphAtlasPaletteQuantizer,
  quantizeGlyphAtlasPalette,
  nearestPaletteIndex,
  redmeanDistanceSq,
  packHexColor,
  encodeGlyphBuffers,
  GLYPH_FONT_ATLAS,
} = require("../packages/glyphcss/dist/index.cjs");

const FRAMES = process.argv[2];
if (!FRAMES) {
  console.error("usage: node bench/color-font-atlas-quantize.mjs <frames.json>");
  process.exit(1);
}

const TOLERANCE = 32;
const N_SLOTS = GLYPH_FONT_ATLAS.maxPaletteSize;

function stats(errors) {
  if (errors.length === 0) return { mean: 0, p95: 0, over: 0, n: 0 };
  const sorted = [...errors].sort((a, b) => a - b);
  const mean = sorted.reduce((a, b) => a + b, 0) / sorted.length;
  const p95 = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))];
  const over = sorted.filter((e) => e > TOLERANCE).length / sorted.length;
  return { mean, p95, over, n: sorted.length };
}

/** Row-wise anchor merge — the shipped `colorTolerance` rule, per-cell output. */
function toleranceEmitted(frame, tolerance) {
  const t2 = tolerance * tolerance;
  const out = new Array(frame.colors.length).fill(null);
  for (let row = 0; row < frame.rows; row++) {
    let anchor = null;
    for (let col = 0; col < frame.cols; col++) {
      const i = row * frame.cols + col;
      const c = frame.colors[i];
      if (c === null) { anchor = null; continue; }
      if (anchor !== null && (c === anchor || redmeanDistanceSq(packHexColor(anchor), packHexColor(c)) <= t2)) {
        out[i] = anchor;
      } else {
        anchor = c;
        out[i] = c;
      }
    }
  }
  return out;
}

function errorsAgainst(frame, emitted) {
  const errors = [];
  for (let i = 0; i < frame.colors.length; i++) {
    const truth = frame.colors[i];
    if (truth === null) continue;
    const got = emitted[i];
    errors.push(got === null ? 0 : Math.sqrt(redmeanDistanceSq(packHexColor(truth), packHexColor(got))));
  }
  return errors;
}

function assignToPalette(frame, palette) {
  const packed = palette.map(packHexColor);
  const memo = new Map();
  const out = new Array(frame.colors.length).fill(null);
  for (let i = 0; i < frame.colors.length; i++) {
    const c = frame.colors[i];
    if (c === null) continue;
    let hit = memo.get(c);
    if (hit === undefined) {
      hit = palette[nearestPaletteIndex(packed, packHexColor(c))];
      memo.set(c, hit);
    }
    out[i] = hit;
  }
  return out;
}

function countSpans(frame, tolerance) {
  const chars = [...frame.chars];
  const html = encodeGlyphBuffers(chars, frame.colors, frame.cols, frame.rows, true, null, tolerance);
  return (html.match(/<span/g) ?? []).length;
}

const captured = JSON.parse(readFileSync(FRAMES, "utf8"));
const rows = [];

for (const [scene, frames] of Object.entries(captured)) {
  if (!frames.length) continue;

  // Pooled quantizer, fed frame by frame on a live-like clock so its own
  // refresh gates fire exactly as they would in a scene.
  let clock = 0;
  const quantizer = createGlyphAtlasPaletteQuantizer({ now: () => clock });
  // Frozen single-frame palette — the control the spike flagged as the wrong
  // way to derive one.
  const frozen = quantizeGlyphAtlasPalette([...frames[0].chars], frames[0].colors, frames[0].colors.length, N_SLOTS);

  const pooledErr = [];
  const frozenErr = [];
  const tolErr = [];
  let spans0 = 0;
  let spansTol = 0;
  let distinct = 0;
  let repools = 0;

  for (const frame of frames) {
    clock += 150; // the capture cadence
    const palette = quantizer.resolveGlyphAtlasPalette([...frame.chars], frame.colors, frame.colors.length);
    pooledErr.push(...errorsAgainst(frame, assignToPalette(frame, palette)));
    frozenErr.push(...errorsAgainst(frame, assignToPalette(frame, frozen)));
    tolErr.push(...errorsAgainst(frame, toleranceEmitted(frame, TOLERANCE)));
    distinct = Math.max(distinct, new Set(frame.colors.filter(Boolean)).size);
  }
  repools = quantizer.generation;
  spans0 = countSpans(frames[0], 0);
  spansTol = countSpans(frames[0], TOLERANCE);

  rows.push({
    scene,
    grid: `${frames[0].cols}x${frames[0].rows}`,
    distinct,
    spans0,
    spansTol,
    repools,
    slots: quantizer.palette.length,
    tol: stats(tolErr),
    pooled: stats(pooledErr),
    frozen: stats(frozenErr),
  });
}

const f = (n) => n.toFixed(1);
const pct = (n) => `${(n * 100).toFixed(1)}%`;

console.log(`\nAtlas palette quantization vs. the span render — ${frames_len(captured)} frames per scene, N=${N_SLOTS} slots\n`);
console.log("| scene | grid | distinct colours | spans (tol 0 / 32) | slots used | repools | colorTolerance 32 (mean/p95/%>32) | POOLED QUANTIZED (mean/p95/%>32) | single-frame palette (mean) |");
console.log("|---|---|---|---|---|---|---|---|---|");
for (const r of rows) {
  console.log(
    `| ${r.scene} | ${r.grid} | ${r.distinct} | ${r.spans0} / ${r.spansTol} | ${r.slots} | ${r.repools} `
    + `| ${f(r.tol.mean)} / ${f(r.tol.p95)} / ${pct(r.tol.over)} `
    + `| **${f(r.pooled.mean)} / ${f(r.pooled.p95)} / ${pct(r.pooled.over)}** `
    + `| ${f(r.frozen.mean)} |`,
  );
}
console.log("\nError unit: redmean, 0..765 — the same scale the `colorTolerance` slider uses.");
console.log("`colorTolerance 0` (the default span render) is exact: error 0 by definition.\n");

function frames_len(c) {
  return Object.values(c)[0].length;
}
