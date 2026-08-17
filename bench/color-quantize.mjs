// Measures the `colorQuantize` field-synth option (VOLUMETRIC-4.md's frozen
// tail's next open slot) against the REAL user preset from the perf report:
// "Menger (cssGraphics)" (`GlyphCssGraphicsMengerPreset`), carve render,
// colour stack on, hue mode — the scene the live browser trace was captured
// on. Every number below calls the real, unmodified exported production
// `fieldSynth.program.evaluate()` and `encodeGlyphBuffers` — nothing here is
// a hand-rewritten stand-in.
//
// Insertion-point A/B (see `bench/color-quantize.md` for the full writeup):
// this file only exercises the SHIPPED insertion point, (a) quantize the
// final resolved packed RGB. The rejected alternative, (b) quantize only
// carve's own `exp(-marchFade * distance)` fade factor before it modulates
// colour, was measured by temporarily swapping `resolveFieldSynthColor`'s
// tail to the (b) form, rebuilding, and rerunning this file's Table 1 loop
// against that build — not reproducible as a second code path here without
// literally shipping it, so the (b) numbers are recorded as a fixed
// reference table in the .md doc instead of being live-recomputed by this
// script.
//
// Run: `pnpm build` (repo root) first, then `node bench/color-quantize.mjs`.

import { encodeGlyphBuffers, GlyphEffectNoColor, buildRasterizeContext, createGlyphOrthographicCamera, rasterizeToCells } from "../packages/glyphcss/dist/index.js";
import { GlyphFieldSynthEffect as fieldSynth, GlyphCssGraphicsMengerPreset as cssGraphicsMengerPreset, defaultGlyphEffectParams } from "../packages/effects/dist/index.js";

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

const grid = rasterizeToCells(buildRasterizeContext({
  camera: createGlyphOrthographicCamera({ rotX: 32.5, rotY: 19, zoom: 380 }),
  grid: { cols: COLS, rows: ROWS, cellAspect: 2 },
  polygons: size3CubePolygons(),
  mode: "solid",
  useColors: false,
  doubleSided: true,
  retainObjectPosition: true,
  retainObjectExit: true,
  retainObjectNormal: true,
}));

function runEvaluate(params) {
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
    params,
    state: fieldSynth.program.createState ? fieldSynth.program.createState() : undefined,
    base: {
      cols: COLS, rows: ROWS, length: N, glyph: glyphA, coverage, color,
      objectPosition: grid.objectPosition, objectExit: grid.objectExit, objectNormal: grid.objectNormal,
    },
    input: { cols: COLS, rows: ROWS, length: N, glyph: glyphA, coverage, color },
    target: { coverage },
    coordinates: { cellToSceneGrid: [1, 0, 0, 1, 0, 0], sceneGridSize: [COLS, ROWS], localCellFootprint: [1, 1] },
    scratch: { images: [], floatFields: [], uintFields: [], glyphFields: [], samples: [] },
    output,
  });
  return output;
}

function measure(output) {
  const char = new Array(N);
  const color = new Array(N);
  let covered = 0;
  for (let i = 0; i < N; i++) {
    const has = output.coverage[i] > 0 && output.color[i] !== GlyphEffectNoColor;
    char[i] = has ? "#" : " ";
    color[i] = has ? `#${output.color[i].toString(16).padStart(6, "0")}` : null;
    if (has) covered++;
  }
  const html = encodeGlyphBuffers(char, color, COLS, ROWS, true);
  const spans = (html.match(/<span/g) || []).length;
  return { covered, spans, htmlBytes: Buffer.byteLength(html, "utf8") };
}

function timeEvaluate(params, iterations) {
  for (let i = 0; i < 5; i++) runEvaluate({ ...params, time: i * 0.1 }); // warm up
  const start = process.hrtime.bigint();
  for (let i = 0; i < iterations; i++) runEvaluate({ ...params, time: i * 0.1 });
  const end = process.hrtime.bigint();
  return Number(end - start) / 1e6 / iterations; // ms per evaluate()
}

const baseParams = {
  ...defaultGlyphEffectParams(fieldSynth),
  ...cssGraphicsMengerPreset.params,
  time: 3,
};

console.log(`grid: ${COLS}x${ROWS} = ${N} cells\n`);

console.log("Requested table — colorQuantize 0/8/16/32:");
console.log("colorQuantize | covered | spans | HTML KB | ms/evaluate");
const ITER = 60;
for (const cq of [0, 8, 16, 32]) {
  const params = { ...baseParams, colorQuantize: cq };
  const { covered, spans, htmlBytes } = measure(runEvaluate(params));
  const ms = timeEvaluate(params, ITER);
  console.log(`${String(cq).padStart(13)} | ${String(covered).padStart(7)} | ${String(spans).padStart(5)} | ${(htmlBytes / 1024).toFixed(1).padStart(7)} | ${ms.toFixed(3)}`);
}

console.log("\nExtended sweep (span count is NOT monotonic in levels — bucket/colour-distribution aliasing, see the .md doc):");
console.log("colorQuantize | spans | HTML KB");
for (const cq of [0, 2, 3, 4, 6, 8, 12, 16, 24, 32, 48, 64]) {
  const { spans, htmlBytes } = measure(runEvaluate({ ...baseParams, colorQuantize: cq }));
  console.log(`${String(cq).padStart(13)} | ${String(spans).padStart(5)} | ${(htmlBytes / 1024).toFixed(1)}`);
}
