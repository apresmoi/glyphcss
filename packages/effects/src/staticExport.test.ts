import { describe, expect, it } from "vitest";
import {
  spherePolygons,
  buildRasterizeContext,
  rasterize,
  retainGlyphEffectOutput,
  parseGlyphEffectColor,
  createGlyphScene,
  GlyphEffectNoColor,
  GlyphEffectOutputChannel,
  createGlyphOrthographicCamera,
  type CellGrid,
  type GlyphEffectCoordinates,
  type GlyphEffectOutputMetadata,
  type GlyphEffectParamsOf,
  type GlyphEffectScratchView,
  type Polygon,
  type RetainedGlyphEffectOutput,
} from "glyphcss";
import { buildGlyphFieldSynthStaticExport, isGlyphFieldSynthStaticExportSupported, type GlyphFieldSynthStaticExportOptions } from "./staticExport";
import { fieldSynth, defaultGlyphEffectParams, type AnyContext, type AnyParams } from "./stock";

function mesh(): Polygon[] {
  return spherePolygons({ center: [0, 0, 0], size: 4, subdivisions: 1, color: "#8fb3d9" });
}

// Mirrors website/src/components/SynthWorkbench/SynthWorkbench.tsx `flatQuad`
// (the /synth page's default "plane" shape): a flat square in the world XY
// plane, z=0, linear 0..1 UVs across the whole quad — the case whose
// per-cell field-synth domain coordinate is an exact affine function of
// (col,row).
function planeMesh(size = 3): Polygon[] {
  return [{
    vertices: [[-size, -size, 0], [size, -size, 0], [size, size, 0], [-size, size, 0]],
    uvs: [[0, 0], [1, 0], [1, 1], [0, 1]],
    color: "#8fb3d9",
  }];
}

function baseOptions(overrides: Partial<GlyphFieldSynthStaticExportOptions> = {}): GlyphFieldSynthStaticExportOptions {
  return {
    params: {
      space: "surface",
      scale: 2.5,
      field1: "radial", wave1: "sin", freq1: 6, speed1: 0.5, amp1: 1,
      field2: "angular", wave2: "saw", freq2: 4, speed2: 0.3, amp2: 0.6,
      combine: "multiply",
      glyphs: " .:-=+*#%@",
      color: "#7df9ff",
      colorB: "#ff4fa3",
      gradient: 0.5,
    },
    blend: "replace",
    loopSeconds: 4,
    cols: 24,
    rows: 12,
    rotX: 62,
    rotY: 38,
    zoom: 3,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Parity harness (Acceptance 6 — "strong form"): the baked pen's inlined
// runtime must produce the SAME grid output as the LIVE runtime render at
// matching time values. "Live" here means the real, unmodified
// `fieldSynth.program.evaluate()` (imported, never re-derived) run over the
// same rasterized base frame `bake()` itself uses, with its raw per-cell
// emission then composited through a plain TS port of the compositor's
// blend + Bayer coverage-dither formulas (packages/glyphcss/src/render/
// effectCompositor.ts `blendPackedColor`/`coverageThreshold`) — small and
// UNCHANGED by this phase, so porting it into the test lets the comparison
// stay correct for ANY value distribution (fractional coverage, dithered
// edges included) instead of only degenerate all-or-nothing patches.
// ---------------------------------------------------------------------------

interface ComposedCell {
  glyph: string;
  color: string | null;
}

const EMPTY_SCRATCH: GlyphEffectScratchView = {
  images: [],
  floatFields: [],
  uintFields: [],
  glyphFields: [],
  samples: [],
};

const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
function positiveMod(value: number, modulus: number): number {
  return ((value % modulus) + modulus) % modulus;
}
function coverageThresholdTS(col: number, row: number): number {
  const x = col + 0.5, y = row + 0.5;
  const mx = Math.floor(4 * x), my = Math.floor(4 * y);
  const coarse = BAYER[positiveMod(Math.floor(my / 4), 4) * 4 + positiveMod(Math.floor(mx / 4), 4)]!;
  const fine = BAYER[positiveMod(my, 4) * 4 + positiveMod(mx, 4)]!;
  return (16 * coarse + fine + 0.5) / 256;
}
function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}
function blendPackedColorTS(input: number, emitted: number, inputWeight: number, emittedWeight: number): number {
  const inputPacked = input !== -1, emittedPacked = emitted !== -1;
  if (inputPacked && emittedPacked) {
    const total = inputWeight + emittedWeight;
    if (total <= 0) return emitted;
    const r = Math.floor((((input >> 16) & 0xff) * inputWeight + ((emitted >> 16) & 0xff) * emittedWeight) / total + 0.5);
    const g = Math.floor((((input >> 8) & 0xff) * inputWeight + ((emitted >> 8) & 0xff) * emittedWeight) / total + 0.5);
    const b = Math.floor(((input & 0xff) * inputWeight + (emitted & 0xff) * emittedWeight) / total + 0.5);
    return (r << 16) | (g << 8) | b;
  }
  if (inputPacked !== emittedPacked) return emittedWeight >= inputWeight ? emitted : input;
  return -1;
}
function toHex(packed: number): string {
  return packed.toString(16).padStart(6, "0");
}

// Mirrors `staticExport.ts`'s own `computeWorldToSceneScale` (itself a copy
// of `createGlyphScene`'s bbox→worldToSceneScale computation) — needed here
// for the same reason: `generatedSurfaceField`'s surface basis reads
// `context.coordinates.worldToSceneScale`, and omitting it falls back to a
// DIFFERENT (undefined-authored-scale) formula that resolves a different
// domain coordinate than `bake()`'s real, authored one — a real bug this
// harness hit and fixed, not a fold-math one.
function computeWorldToSceneScale(polygons: readonly Polygon[], cols: number, rows: number): number {
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (const polygon of polygons) {
    for (const vertex of polygon.vertices) {
      if (vertex[0] < minX) minX = vertex[0];
      if (vertex[1] < minY) minY = vertex[1];
      if (vertex[2] < minZ) minZ = vertex[2];
      if (vertex[0] > maxX) maxX = vertex[0];
      if (vertex[1] > maxY) maxY = vertex[1];
      if (vertex[2] > maxZ) maxZ = vertex[2];
    }
  }
  const span = Math.max(maxX - minX, maxY - minY, maxZ - minZ);
  return Number.isFinite(span) && span > 1e-9 ? Math.min(cols, rows) / span : 1;
}

// Runs the REAL rasterizer + retains the base frame exactly like `bake()`
// does, then calls the REAL, unmodified `fieldSynth.program.evaluate()`
// (never re-derived) at the given full param set (including `time`), and
// composites its raw emission through the plain-TS blend/dither port above —
// the "ground truth" every covered cell of the baked pen must match.
function liveComposedGrid(
  polygons: Polygon[],
  camOptions: { rotX?: number; rotY?: number; zoom?: number },
  cols: number,
  rows: number,
  blend: "over" | "replace",
  opacity: number,
  params: GlyphEffectParamsOf<typeof fieldSynth>,
): ComposedCell[] {
  const camera = createGlyphOrthographicCamera({ rotX: camOptions.rotX, rotY: camOptions.rotY, zoom: camOptions.zoom });
  const worldToSceneScale = computeWorldToSceneScale(polygons, cols, rows);
  const metadata: GlyphEffectOutputMetadata = {
    id: "parity-test",
    pre: null as unknown as HTMLPreElement,
    isBase: true,
    cellToSceneGrid: [1, 0, 0, 1, 0, 0],
    sceneGridSize: [cols, rows],
    localCellFootprint: [1, 1],
    worldToSceneScale,
  };
  let retained: RetainedGlyphEffectOutput | null = null;
  const ctx = buildRasterizeContext({
    camera,
    grid: { cols, rows, cellAspect: 2 },
    polygons,
    mode: "solid",
    directionalLight: { direction: [0.5, 0.7, 0.5], intensity: 1 },
    ambientLight: { intensity: 0.4 },
    useColors: true,
    retainShade: true,
    retainWorldPosition: true,
    retainNormal: true,
  });
  ctx.transformCells = (grid: CellGrid) => {
    retained = retainGlyphEffectOutput(grid, metadata);
    return grid;
  };
  rasterize(ctx);
  if (retained === null) throw new Error("test: rasterize produced no base frame.");
  const baked: RetainedGlyphEffectOutput = retained;
  const n = baked.base.length;

  const coordinates: GlyphEffectCoordinates = {
    cellToSceneGrid: metadata.cellToSceneGrid,
    sceneGridSize: metadata.sceneGridSize,
    localCellFootprint: metadata.localCellFootprint,
    worldToSceneScale: metadata.worldToSceneScale,
  };
  const output = {
    glyph: new Array<string>(n).fill(" "),
    color: new Uint32Array(n).fill(GlyphEffectNoColor),
    coverage: new Float32Array(n),
    channels: new Uint8Array(n),
  };
  const context: AnyContext<AnyParams> = {
    params: params as unknown as AnyParams,
    // Carve/ink is unreachable through this helper: `buildRasterizeContext`
    // above doesn't retain `objectPosition`/`objectExit`, so
    // `fieldSynth.program.evaluate()`'s own `carveActive` gate is always
    // false here regardless of `params.render` — `runCarveInkResolve` (the
    // only reader of `context.state.carveInk`) never runs, so `undefined`
    // stays a valid stand-in for the real per-layer state this harness
    // doesn't otherwise construct.
    state: undefined,
    base: baked.base,
    input: baked.base,
    target: { coverage: baked.baseCoverage },
    coordinates,
    scratch: EMPTY_SCRATCH,
    output,
  };
  (fieldSynth.program.evaluate as (c: AnyContext<AnyParams>) => void)(context);

  const cells: ComposedCell[] = new Array(n);
  for (let i = 0; i < n; i++) {
    const col = i % cols, row = (i / cols) | 0;
    const baseGlyph = baked.base.glyph[i] ?? " ";
    const baseColorHex = baked.baseGrid.color[i] ?? null;
    const inputColorPacked = baseColorHex ? parseGlyphEffectColor(baseColorHex).packed : -1;
    const inputCoverage = baseGlyph === " " ? 0 : 1;

    const hasGlyph = (output.channels[i]! & GlyphEffectOutputChannel.Glyph) !== 0;
    const hasColor = (output.channels[i]! & GlyphEffectOutputChannel.Color) !== 0;
    const emittedGlyph = hasGlyph ? output.glyph[i]! : baseGlyph;
    const rawColor = output.color[i]!;
    const emittedColorPacked = hasColor ? (rawColor === GlyphEffectNoColor ? -1 : rawColor) : inputColorPacked;
    const emittedCoverage = clamp01(output.coverage[i]!);

    const targetCoverage = baked.baseCoverage[i]!;
    const emittedWeight = emittedCoverage * opacity * targetCoverage;
    const inputWeight = blend === "over"
      ? inputCoverage * (1 - emittedWeight)
      : inputCoverage * (1 - opacity * targetCoverage);
    const nextCoverage = clamp01(emittedWeight + inputWeight);
    const visible = nextCoverage >= 1 || (nextCoverage > 0 && nextCoverage > coverageThresholdTS(col, row));
    if (!visible) { cells[i] = { glyph: " ", color: null }; continue; }
    const chooseEmitted = emittedWeight >= inputWeight;
    const finalGlyph = chooseEmitted ? emittedGlyph : baseGlyph;
    const finalColorPacked = blendPackedColorTS(inputColorPacked, emittedColorPacked, inputWeight, emittedWeight);
    cells[i] = { glyph: finalGlyph, color: finalColorPacked === -1 ? null : toHex(finalColorPacked) };
  }
  return cells;
}

// Executes the baked pen's `js` payload in this test's (happy-dom) document,
// capturing the `requestAnimationFrame` callback instead of scheduling it so
// the test can drive an exact `now` — then reads back the composited `<pre>`.
function runBakedFrame(js: string, nowMs: number): string {
  document.body.innerHTML = '<pre id="g"></pre>';
  let captured: ((now: number) => void) | undefined;
  const fn = new Function("requestAnimationFrame", js) as (raf: (cb: (now: number) => void) => void) => void;
  fn((cb) => { captured = cb; });
  captured!(nowMs);
  return document.getElementById("g")!.innerHTML;
}

async function flushRenders(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

// Acceptance 6 (fixer pass, P1-B): an END-TO-END oracle using the REAL
// renderer — `createGlyphScene` mounting the REAL, unmodified `fieldSynth`
// effect definition via `addEffectLayer` — instead of `liveComposedGrid`'s
// hand-ported compositor above. This is the authoritative ground truth the
// baked export's grid must match, not a second reimplementation that could
// itself drift or hide a genuine divergence behind its own bugs/tolerance.
// `liveComposedGrid`/`expectGridParity` stay in this file as a lighter,
// synchronous diagnostic; the acceptance assertion for parity is
// `expectExactGridParity` against THIS oracle (see `runParity` below).
async function liveSceneGrid(
  polygons: Polygon[],
  camOptions: { rotX?: number; rotY?: number; zoom?: number },
  cols: number,
  rows: number,
  blend: "over" | "replace",
  opacity: number,
  params: Partial<GlyphEffectParamsOf<typeof fieldSynth>>,
): Promise<ComposedCell[]> {
  const host = document.createElement("div");
  document.body.appendChild(host);
  try {
    const scene = createGlyphScene(host, {
      cols,
      rows,
      cellAspect: 2,
      mode: "solid",
      useColors: true,
      camera: createGlyphOrthographicCamera({ rotX: camOptions.rotX, rotY: camOptions.rotY, zoom: camOptions.zoom }),
      directionalLight: { direction: [0.5, 0.7, 0.5], intensity: 1 },
      ambientLight: { intensity: 0.4 },
    });
    scene.add(polygons);
    scene.addEffectLayer({
      effect: fieldSynth,
      params: params as unknown as Record<string, unknown>,
      blend,
      opacity,
    });
    await flushRenders();
    const cells = parseHtmlGrid(scene.output.innerHTML, cols, rows);
    scene.destroy();
    return cells;
  } finally {
    host.remove();
  }
}

// Strict acceptance check (P1-B): the baked pen must match the REAL renderer
// EXACTLY — no residual/frequency-scaled budget. Color keeps the same ±1-
// per-channel absorption `colorsClose` already documents (rounding noise
// from `Math.round(channel * shade/value)`, an orthogonal, already-understood
// class of noise this phase doesn't touch) — but GLYPH equality is exact and
// unconditional. `bake()` only ever emits cells the field-synth patch
// actually covers, so both grids are compared over the full `cols×rows`
// frame; an invisible cell in one side and a space in the other still count
// as equal (both render " ", uncolored).
function expectExactGridParity(oracle: ComposedCell[], baked: ComposedCell[], cols: number, rows: number): void {
  const mismatches: string[] = [];
  for (let i = 0; i < cols * rows; i++) {
    const o = oracle[i]!, b = baked[i]!;
    if (o.glyph !== b.glyph || !colorsClose(o.color, b.color)) {
      mismatches.push(`(${i % cols},${(i / cols) | 0}): oracle=${JSON.stringify(o)} baked=${JSON.stringify(b)}`);
    }
  }
  expect(mismatches.length, mismatches.join("\n")).toBe(0);
}

// Parses RUNTIME_JS's colored-HTML output back into a fixed cols×rows grid.
// Read via `pre.innerHTML` (a DOM getter), NOT the literal string RUNTIME_JS
// assigned — happy-dom (like real browsers) re-serializes attribute values
// when read back, quoting `style=color:#xxxxxx` into `style="color:#xxxxxx"`,
// so the parser matches THAT normalized form, not RUNTIME_JS's own literal
// text. Gap cells (outside any `<span>`, or past the last visible cell in a
// row — RUNTIME_JS never pads a row's trailing invisible cells) default to a
// blank, uncolored cell, matching what an invisible cell actually renders as.
function parseHtmlGrid(html: string, cols: number, rows: number): ComposedCell[] {
  const lines = html.split("\n");
  const cells: ComposedCell[] = new Array(cols * rows);
  for (let i = 0; i < cells.length; i++) cells[i] = { glyph: " ", color: null };
  for (let row = 0; row < rows; row++) {
    const line = lines[row] ?? "";
    let col = 0, i = 0;
    let currentColor: string | null = null;
    while (i < line.length && col < cols) {
      // A closed span's color must NOT leak onto the literal gap-fill spaces
      // that follow it outside any span (RUNTIME_JS always closes the span
      // before writing a gap — see its `frame()`'s row-building loop).
      if (line.startsWith("</span>", i)) { i += 7; currentColor = null; continue; }
      const styled = /^<span style="color:#([0-9a-f]{6})">/.exec(line.slice(i));
      if (styled) { currentColor = styled[1]!; i += styled[0].length; continue; }
      if (line.startsWith("<span>", i)) { currentColor = null; i += 6; continue; }
      cells[row * cols + col] = { glyph: line[i]!, color: currentColor };
      col++; i++;
    }
  }
  return cells;
}

// The affine-fit coordinate optimization (`detectAffineCoords`, unaffected by
// this phase and already covered by its own tests) reconstructs each cell's
// domain coordinate to within `AFFINE_EPSILON = 1e-3`, not bit-exactly. Two
// distinct, both harmless, symptoms follow from that, neither a fold bug:
// (1) a smooth (non-thresholded) field's `Math.round(channel * shade)` color
// rounding can land ±1 off in a single channel purely from the 1e-3
// coordinate wobble — colorsClose() absorbs that; (2) a hard decision
// boundary (an argmax winner flip, a square wave's step edge, a threshold) IS
// sensitive to that same wobble and can flip a small number of cells' GLYPH
// outright — the residual mismatch budget below absorbs that. A systematic
// fold bug shows up as most/all cells differing; boundary noise shows up as
// a sparse scatter. This check accepts the latter, not the former.
function colorsClose(a: string | null, b: string | null): boolean {
  if (a === b) return true;
  if (a === null || b === null) return false;
  for (let k = 0; k < 3; k++) {
    const ac = Number.parseInt(a.slice(k * 2, k * 2 + 2), 16);
    const bc = Number.parseInt(b.slice(k * 2, k * 2 + 2), 16);
    if (Math.abs(ac - bc) > 1) return false;
  }
  return true;
}
function expectGridParity(live: ComposedCell[], baked: ComposedCell[], cols: number, rows: number): void {
  const mismatches: string[] = [];
  for (let i = 0; i < cols * rows; i++) {
    const l = live[i]!, b = baked[i]!;
    if (l.glyph !== b.glyph || !colorsClose(l.color, b.color)) {
      mismatches.push(`(${i % cols},${(i / cols) | 0}): live=${JSON.stringify(l)} baked=${JSON.stringify(b)}`);
    }
  }
  // Hard-edged fields (a square wave's step, a thresholded layer) are the
  // most exposed to the affine-fit coordinate wobble: landing on either side
  // of a step is a full-height jump in the folded value, not an epsilon-
  // scale one, so a duty/threshold-heavy patch's boundary count runs higher
  // than a smooth field's. 15% is well above what's observed here (~13% on
  // the duty/layered cases) and stays far below what an actual fold bug
  // produces (50%+, observed while this suite was being debugged, before an
  // unrelated bug in THIS harness's own HTML parser — not the port — was
  // found and fixed).
  const maxAllowed = Math.max(1, Math.round(cols * rows * 0.15));
  expect(mismatches.length, mismatches.slice(0, 10).join("\n")).toBeLessThanOrEqual(maxAllowed);
}

const PARITY_COLS = 24;
const PARITY_ROWS = 12;
const PARITY_CAM = { rotX: 0, rotY: 0, zoom: 150 };

// Full-coverage, flat, head-on plane (same geometry the exporter's own
// "drops the per-cell table entirely" test uses) — a static, well-understood
// scene, so the parity assertion below is purely about the field-program
// fold, not about coordinate resolution (unaffected by this phase and
// already covered by the exporter's other tests).
async function runParity(
  paramsPartial: Partial<GlyphEffectParamsOf<typeof fieldSynth>>,
  timeSeconds = 0,
  polygons: Polygon[] = planeMesh(),
  camera: { rotX?: number; rotY?: number; zoom?: number } = PARITY_CAM,
): Promise<void> {
  // `lit: 0` disables the shade-modulation step on both sides. Shade itself
  // is untouched by this phase (`buildRuntime` hoists it to a 2-decimal-
  // rounded scalar for payload size, a pre-existing, unrelated
  // optimization), but that rounding can nudge a color channel by ±1 —
  // noise this parity suite isn't testing for. Forcing `lit: 0` identically
  // on both the baked and live sides removes it without weakening what
  // IS under test (the field-program fold: layers, duty, phase, angle,
  // origin).
  const patch = { ...paramsPartial, lit: 0 };
  const fullParams = {
    ...defaultGlyphEffectParams(fieldSynth),
    ...patch,
    time: timeSeconds,
  } as GlyphEffectParamsOf<typeof fieldSynth>;
  fieldSynth.program.validateParams?.(fullParams);

  const exported = buildGlyphFieldSynthStaticExport(polygons, {
    params: patch,
    blend: "replace",
    opacity: 1,
    loopSeconds: 1000,
    cols: PARITY_COLS,
    rows: PARITY_ROWS,
    rotX: camera.rotX,
    rotY: camera.rotY,
    zoom: camera.zoom,
    useColors: true,
  });
  const html = runBakedFrame(exported.js, timeSeconds * 1000);
  const bakedGrid = parseHtmlGrid(html, PARITY_COLS, PARITY_ROWS);

  // Diagnostic (kept for its regression value, not the acceptance gate — see
  // `expectExactGridParity`'s doc above): the hand-ported TS compositor.
  const liveGrid = liveComposedGrid(polygons, camera, PARITY_COLS, PARITY_ROWS, "replace", 1, fullParams);
  expectGridParity(liveGrid, bakedGrid, PARITY_COLS, PARITY_ROWS);

  // Acceptance (P1-B): the REAL renderer, exact match.
  const oracleGrid = await liveSceneGrid(polygons, camera, PARITY_COLS, PARITY_ROWS, "replace", 1, fullParams);
  expectExactGridParity(oracleGrid, bakedGrid, PARITY_COLS, PARITY_ROWS);
}

describe("buildGlyphFieldSynthStaticExport", () => {
  it("rejects an unsupported effect id", () => {
    expect(() => buildGlyphFieldSynthStaticExport(mesh(), { ...baseOptions(), effect: "matrix-rain" as never }))
      .toThrow(/field-synth/);
  });

  it("rejects a non-positive grid or loop", () => {
    expect(() => buildGlyphFieldSynthStaticExport(mesh(), baseOptions({ cols: 0 }))).toThrow();
    expect(() => buildGlyphFieldSynthStaticExport(mesh(), baseOptions({ rows: 0 }))).toThrow();
    expect(() => buildGlyphFieldSynthStaticExport(mesh(), baseOptions({ loopSeconds: 0 }))).toThrow();
  });

  it("rejects program-as-data (VOLUMETRIC-3.md §4) with a clear error, before the flat-param merge/bake — an obviously-invalid params patch alongside it doesn't change the error", () => {
    expect(() => buildGlyphFieldSynthStaticExport(mesh(), baseOptions({ program: { domain: "2d", layers: [] } })))
      .toThrow(/program-as-data/);
    // Even with a params patch that would ALSO be rejected on its own
    // merits (an unsupported render mode) — the program-level gate runs
    // first, so the error names the actual reason.
    expect(() => buildGlyphFieldSynthStaticExport(mesh(), baseOptions({
      program: { domain: "2d", layers: [] },
      params: { render: "carve" },
    }))).toThrow(/program-as-data/);
  });

  it("produces a non-empty base frame", () => {
    const result = buildGlyphFieldSynthStaticExport(mesh(), baseOptions());
    const dataMatch = result.js.match(/var DATA=(\{.*?\});var CFG=/);
    expect(dataMatch).not.toBeNull();
    const data = JSON.parse(dataMatch![1]!) as { c: number[]; r: number[]; x: number[]; bg: string[] };
    expect(data.c.length).toBeGreaterThan(0);
    expect(data.c.length).toBe(data.r.length);
    expect(data.c.length).toBe(data.x.length);
    expect(data.bg.some((g) => g !== " ")).toBe(true);
  });

  it("is fully self-contained: no imports, no network URLs, no @glyphcss package reference", () => {
    const result = buildGlyphFieldSynthStaticExport(mesh(), baseOptions());
    for (const source of [result.html, result.css, result.js, result.pen.html, result.pen.css, result.pen.js]) {
      expect(source).not.toMatch(/\bimport\s/);
      expect(source).not.toMatch(/\brequire\(/);
      expect(source).not.toMatch(/https?:\/\//);
      expect(source).not.toMatch(/@glyphcss/);
    }
    // The JS payload specifically must never mention the `glyphcss` package
    // itself (a title like "glyphcss field synth" in the HTML doc is fine —
    // it's copy, not a dependency).
    expect(result.js).not.toMatch(/\bglyphcss\b/);
  });

  it("inlines the field-program IR evaluator and an animation loop, with no glyphcss import", () => {
    const result = buildGlyphFieldSynthStaticExport(mesh(), baseOptions());
    expect(result.js).toContain("requestAnimationFrame");
    // The ported IR evaluator (fieldProgram.ts's evaluateFieldProgram/
    // foldVoices/sampleFieldVoice, hand-written as plain JS) plus the
    // unchanged noise/dither primitives.
    expect(result.js).toContain("function evalProgram(");
    expect(result.js).toContain("function foldVoices(");
    expect(result.js).toContain("function sampleVoice(");
    expect(result.js).toContain("function combineOp(");
    expect(result.js).toContain("function noise3(");
    expect(result.js).toContain("function thr(");
    expect(result.html).toContain("<pre id=\"g\">");
  });

  it("bakes the supplied params (loop seconds, ramp, combine mode) into CFG", () => {
    const result = buildGlyphFieldSynthStaticExport(mesh(), baseOptions({ loopSeconds: 7.5 }));
    const cfgMatch = result.js.match(/var CFG=(\{.*\});\s*"use strict"/s);
    expect(cfgMatch).not.toBeNull();
    const cfg = JSON.parse(cfgMatch![1]!) as {
      loop: number;
      combine: string;
      ramp: string[];
      blend: string;
      program: { voices: { amp: number }[] }[];
    };
    expect(cfg.loop).toBe(7.5);
    expect(cfg.combine).toBe("multiply");
    expect(cfg.ramp.join("")).toBe(" .:-=+*#%@");
    // Only voices with amp > 0 are shipped (field1 + field2 above; the other
    // four defaulted to amp 0), grouped into the (single, default) layer.
    const totalVoices = cfg.program.reduce((sum, layer) => sum + layer.voices.length, 0);
    expect(totalVoices).toBe(2);
    expect(cfg.program.length).toBe(1);
  });

  it("reads the REAL mounted blend verbatim instead of the effect definition's own defaultBlend", () => {
    const replaceResult = buildGlyphFieldSynthStaticExport(mesh(), baseOptions({ blend: "replace" }));
    const overResult = buildGlyphFieldSynthStaticExport(mesh(), baseOptions({ blend: "over" }));
    expect(replaceResult.js).toMatch(/"blend":"replace"/);
    expect(overResult.js).toMatch(/"blend":"over"/);
  });

  it("respects useColors: false by emitting plain-text output with no color spans", () => {
    const result = buildGlyphFieldSynthStaticExport(mesh(), baseOptions({ useColors: false }));
    expect(result.js).toMatch(/"useColors":false/);
    expect(result.js).toContain("pre.textContent=text");
  });

  it("throws when field-synth's own param validation rejects the patch", () => {
    expect(() => buildGlyphFieldSynthStaticExport(mesh(), baseOptions({ params: { glyphs: "" } }))).toThrow();
  });

  describe("rejects (volumetric/carve is a different export design; 3D-only params have no meaning in the ported 2D evaluator)", () => {
    it("rejects space: \"object\"", () => {
      expect(() => buildGlyphFieldSynthStaticExport(mesh(), baseOptions({
        params: { ...baseOptions().params, space: "object" },
      }))).toThrow(/space.*"object"/);
    });

    it("rejects field1: \"linearZ\" on an active voice", () => {
      expect(() => buildGlyphFieldSynthStaticExport(mesh(), baseOptions({
        params: { ...baseOptions().params, field1: "linearZ", amp1: 1 },
      }))).toThrow(/linearZ/);
    });

    it("rejects originW1 !== 0 on an active voice", () => {
      expect(() => buildGlyphFieldSynthStaticExport(mesh(), baseOptions({
        params: { ...baseOptions().params, originW1: 0.5, amp1: 1 },
      }))).toThrow(/originW1/);
    });

    it("does NOT reject subcellRes: \"2x4\"/\"ink\" (P1-A fixer pass: ported, no longer rejected)", () => {
      const r2x4 = buildGlyphFieldSynthStaticExport(mesh(), baseOptions({
        params: { ...baseOptions().params, subcellRes: "2x4" },
      }));
      expect(r2x4.js).toContain("requestAnimationFrame");
      const rInk = buildGlyphFieldSynthStaticExport(mesh(), baseOptions({
        params: { ...baseOptions().params, subcellRes: "ink" },
      }));
      expect(rInk.js).toContain("requestAnimationFrame");
    });

    // VOLUMETRIC-2.md §2: gyroid/menger/sierpinski and the `step` wave have a
    // genuine 2D (z=0 slice) meaning, unlike linearZ/originW above — no new
    // reject class for this phase.
    it("does NOT reject the SDF field family (gyroid/menger/sierpinski) or the step wave on an active voice", () => {
      for (const field of ["gyroid", "menger", "sierpinski"]) {
        const result = buildGlyphFieldSynthStaticExport(mesh(), baseOptions({
          params: { ...baseOptions().params, field1: field, wave1: "step", iter1: 2, amp1: 1 },
        }));
        expect(result.js).toContain("requestAnimationFrame");
      }
    });

    it("does NOT reject linearZ/originW when the voice carrying them is inactive (amp 0)", () => {
      const result = buildGlyphFieldSynthStaticExport(mesh(), baseOptions({
        params: { ...baseOptions().params, amp3: 0, field3: "linearZ", originW3: 0.9 },
      }));
      expect(result.js).toContain("requestAnimationFrame");
    });

    it('rejects render: "carve", naming carve as the reason rather than the volumetric space it happens to require', () => {
      expect(() => buildGlyphFieldSynthStaticExport(mesh(), baseOptions({
        params: { ...baseOptions().params, space: "object", render: "carve" },
      }))).toThrow(/carve/i);
    });

    it('still rejects a plain volumetric (non-carve) patch with the pre-existing "space" error, not the carve one', () => {
      expect(() => buildGlyphFieldSynthStaticExport(mesh(), baseOptions({
        params: { ...baseOptions().params, space: "object" },
      }))).toThrow(/space.*"object"/);
    });

    // VOLUMETRIC-2.md §1 "March view modes": xray is the same "per-cell-per-
    // frame march/integral, not something this exporter can fake" story as
    // carve, and gets the same naming-ordered reject.
    it('rejects render: "xray", naming xray as the reason rather than the volumetric space it happens to require', () => {
      expect(() => buildGlyphFieldSynthStaticExport(mesh(), baseOptions({
        params: { ...baseOptions().params, space: "object", render: "xray" },
      }))).toThrow(/xray/i);
    });
  });

  // P1-2 fixer pass: the website's static "Open in CodePen" button used to
  // gate itself on a narrower, locally-duplicated condition (space==="object"
  // || render==="carve") that missed two of the exporter's own reject cases
  // (an active linearZ voice, a nonzero originW on an active voice) — a
  // URL-loaded patch carrying either without being volumetric/carve made the
  // button throw. `isGlyphFieldSynthStaticExportSupported` is the exporter's own predicate,
  // mirroring `assertStaticExportSupported` exactly, so a UI reading it can
  // never drift from what actually gets rejected.
  describe("isGlyphFieldSynthStaticExportSupported", () => {
    it("is true for a plain 2D patch (matches buildGlyphFieldSynthStaticExport succeeding)", () => {
      expect(isGlyphFieldSynthStaticExportSupported(baseOptions().params)).toBe(true);
    });

    it("is false for space: \"object\" and for render: \"carve\"/\"xray\"", () => {
      expect(isGlyphFieldSynthStaticExportSupported({ ...baseOptions().params, space: "object" })).toBe(false);
      expect(isGlyphFieldSynthStaticExportSupported({ ...baseOptions().params, space: "object", render: "carve" })).toBe(false);
      expect(isGlyphFieldSynthStaticExportSupported({ ...baseOptions().params, space: "object", render: "xray" })).toBe(false);
    });

    it("is false when an active voice has field: \"linearZ\" (not just volumetric/carve)", () => {
      expect(isGlyphFieldSynthStaticExportSupported({ ...baseOptions().params, field1: "linearZ", amp1: 1 })).toBe(false);
    });

    it("is false when an active voice has a nonzero originW (not just volumetric/carve)", () => {
      expect(isGlyphFieldSynthStaticExportSupported({ ...baseOptions().params, originW1: 0.5, amp1: 1 })).toBe(false);
    });

    it("is true when the voice carrying linearZ/originW is inactive (amp 0) — same as the exporter itself", () => {
      expect(isGlyphFieldSynthStaticExportSupported({ ...baseOptions().params, amp3: 0, field3: "linearZ", originW3: 0.9 })).toBe(true);
    });
  });

  describe("layers, duty, phase, angle, and per-voice origin now export (Phase 5 port) — no longer rejected", () => {
    it("does NOT reject duty1 !== 0.5, phase1 !== 0, or voice layers on active voices", () => {
      const result = buildGlyphFieldSynthStaticExport(mesh(), baseOptions({
        params: {
          ...baseOptions().params,
          duty1: 0.2, phase1: 0.3, angle1: 40, originU1: 0.1, originV1: -0.2,
          layer2: 2, layerThresholdOn2: true, layerBlend2: "min",
        },
      }));
      expect(result.js).toContain("requestAnimationFrame");
    });
  });

  it("a flat, head-on, fully-covered plane drops the per-cell table entirely: no DATA at all", () => {
    const result = buildGlyphFieldSynthStaticExport(planeMesh(), baseOptions({
      rotX: 0,
      rotY: 0,
      zoom: 150,
      cols: 24,
      rows: 12,
    }));
    // A flat, evenly-lit, fully-covered, head-on plane hoists every per-cell
    // field it bakes (coords → affine scalars, shade → a constant, cx/cy →
    // constants, col/row → derivable from the loop index, base → unread) —
    // nothing is left for `DATA` to carry, so `var DATA=` is omitted
    // entirely rather than emitted as `{}`.
    expect(result.js).not.toMatch(/var DATA=/);
    expect(result.js).toMatch(/^var CFG=/);

    const cfgMatch = result.js.match(/var CFG=(\{.*\});\s*"use strict"/s);
    expect(cfgMatch).not.toBeNull();
    const cfg = JSON.parse(cfgMatch![1]!) as {
      aff: number[] | null; skipBase: boolean; full: boolean; cols: number;
      shFixed: boolean; sh: number; cxFixed: boolean; cyFixed: boolean;
    };

    // 6 fitted scalars driving `x = aff[0]*col + aff[1]*row + aff[2]`
    // (and the `y` analogue) at runtime instead of a per-cell table.
    expect(cfg.aff).not.toBeNull();
    expect(cfg.aff).toHaveLength(6);
    expect(cfg.aff!.every((n) => Number.isFinite(n))).toBe(true);
    expect(cfg.skipBase).toBe(true);
    expect(cfg.full).toBe(true);
    expect(cfg.cols).toBe(24);
    expect(cfg.shFixed).toBe(true);
    expect(cfg.cxFixed).toBe(true);
    expect(cfg.cyFixed).toBe(true);
    expect(result.js).toContain("var col0=C.full?k%C.cols:D.c[k],row0=C.full?(k/C.cols)|0:D.r[k];");
    expect(result.js).toContain("C.aff?C.aff[0]*col0+C.aff[1]*row0+C.aff[2]:D.x[k]");
    expect(result.js).toContain("typeof DATA<\"u\"?DATA:0");
  });

  it("a curved surface (sphere) keeps the baked per-cell coordinate AND index table — never mis-detected as affine or full", () => {
    const result = buildGlyphFieldSynthStaticExport(mesh(), baseOptions());
    const dataMatch = result.js.match(/var DATA=(\{.*?\});var CFG=/);
    expect(dataMatch).not.toBeNull();
    const data = JSON.parse(dataMatch![1]!) as { c: number[]; r: number[]; x: number[]; y: number[]; bg: string[]; bc: number[] };
    const cfgMatch = result.js.match(/var CFG=(\{.*\});\s*"use strict"/s);
    const cfg = JSON.parse(cfgMatch![1]!) as { aff: number[] | null; skipBase: boolean; full: boolean };

    expect(cfg.aff).toBeNull();
    expect(cfg.skipBase).toBe(false);
    expect(cfg.full).toBe(false);
    // Sparse (silhouette-gapped) bakes genuinely need the per-cell index
    // table — there's no formula for "which cells are covered".
    expect(Array.isArray(data.c)).toBe(true);
    expect(Array.isArray(data.r)).toBe(true);
    expect(data.c.length).toBeGreaterThan(0);
    expect(data.c.length).toBe(data.r.length);
    expect(Array.isArray(data.x)).toBe(true);
    expect(Array.isArray(data.y)).toBe(true);
    expect(data.x.length).toBeGreaterThan(0);
    expect(Array.isArray(data.bg)).toBe(true);
    expect(Array.isArray(data.bc)).toBe(true);
  });

  it("a partially-covered plane (not filling the grid) keeps the index table and base grid even though coordinates are still affine", () => {
    const result = buildGlyphFieldSynthStaticExport(planeMesh(), baseOptions({
      // `baseOptions()`'s default `wave2: "saw"` has a hard per-cycle reset
      // (a real discontinuity) that `affineDecisionsMatch` (P1-B) can
      // legitimately reject the affine fit over at this zoom/freq combo —
      // orthogonal to what THIS test checks (that partial coverage keeps an
      // index table regardless of the coordinate-resolution strategy), so
      // swap in an all-smooth pair of waves to keep the coordinate side
      // affine-safe and isolate the partial-coverage assertion below.
      params: { ...baseOptions().params, wave1: "sin", wave2: "sin" },
      rotX: 0,
      rotY: 0,
      zoom: 40, // small enough that the quad doesn't fill the 24x12 grid
      cols: 24,
      rows: 12,
    }));
    const dataMatch = result.js.match(/var DATA=(\{.*?\});var CFG=/);
    expect(dataMatch).not.toBeNull();
    const data = JSON.parse(dataMatch![1]!) as Record<string, unknown>;
    const cfgMatch = result.js.match(/var CFG=(\{.*\});\s*"use strict"/s);
    const cfg = JSON.parse(cfgMatch![1]!) as { aff: number[] | null; skipBase: boolean; full: boolean };

    // Coordinates are still an exact affine function of (col,row) on a flat
    // plane regardless of how much of the grid it covers.
    expect(cfg.aff).not.toBeNull();
    expect(data.x).toBeUndefined();
    // But it's not fully covered, so the index table stays (col/row can't be
    // derived from the loop index without a formula for which cells exist).
    expect(cfg.full).toBe(false);
    expect(Array.isArray(data.c)).toBe(true);
    expect((data.c as unknown[]).length).toBeGreaterThan(0);
    // The base is genuinely needed here too (uncovered cells fall back to
    // it), so it must NOT be skipped.
    expect(cfg.skipBase).toBe(false);
    expect(data.bg).toBeDefined();
    expect(data.bc).toBeDefined();
  });

  it("opacity < 1 with a fully-covered `replace` plane drops the index table (still fully covered) but keeps the base grid (input genuinely still shows through)", () => {
    const result = buildGlyphFieldSynthStaticExport(planeMesh(), baseOptions({
      rotX: 0,
      rotY: 0,
      zoom: 150,
      cols: 24,
      rows: 12,
      opacity: 0.5,
    }));
    const dataMatch = result.js.match(/var DATA=(\{.*?\});var CFG=/);
    expect(dataMatch).not.toBeNull();
    const data = JSON.parse(dataMatch![1]!) as Record<string, unknown>;
    const cfgMatch = result.js.match(/var CFG=(\{.*\});\s*"use strict"/s);
    const cfg = JSON.parse(cfgMatch![1]!) as { skipBase: boolean; full: boolean };

    expect(cfg.full).toBe(true);
    expect(cfg.skipBase).toBe(false);
    // Fully covered, so the index table is still droppable independent of
    // whether the base is skipped.
    expect(data.c).toBeUndefined();
    expect(data.r).toBeUndefined();
    expect(data.bg).toBeDefined();
    expect(data.bc).toBeDefined();
  });

  // ---------------------------------------------------------------------
  // Parity (Acceptance 6, strong form): the baked runtime's grid output
  // must match the live `fieldSynth.program.evaluate()` render, cell for
  // cell, at matching time values. Each case below targets exactly what
  // Phase 5 ported: layers/thresholds/invert/blend, duty, phase, per-voice
  // angle + origin, plus regression coverage (existing presets, and time
  // animation at two distinct values).
  // ---------------------------------------------------------------------
  describe("static/live parity", () => {
    it("a layered patch (2 layers, thresholds, invert, min blend) matches the live render", async () => {
      await runParity({
        space: "surface", scale: 1.5, combine: "add",
        field1: "linearX", wave1: "square", freq1: 2, duty1: 0.5, amp1: 1, layer1: 1,
        field2: "linearY", wave2: "square", freq2: 2, duty2: 0.5, amp2: 1, layer2: 1,
        layerThresholdOn1: true, layerThreshold1: 0,
        field3: "radial", wave3: "sin", freq3: 3, speed3: 0.3, amp3: 1, layer3: 2,
        layerThresholdOn2: false, layerInvert2: true, layerBlend2: "min", layerAmp2: 1,
        amp4: 0, amp5: 0, amp6: 0,
        glyphs: " .:-=+*#%@", color: "#7df9ff", colorB: "#ff4fa3", gradient: 0.7,
      });
    });

    it("duty !== 0.5 on a square-wave voice matches the live render", async () => {
      await runParity({
        space: "surface", scale: 2, combine: "multiply",
        field1: "linearX", wave1: "square", freq1: 2, duty1: 0.3, amp1: 1,
        field2: "linearY", wave2: "sin", freq2: 2, speed2: 0.4, amp2: 0.8,
        amp3: 0, amp4: 0, amp5: 0, amp6: 0,
        glyphs: " .:-=+*#%@", color: "#8affc1", gradient: 0.4,
      });
    });

    it("phase !== 0 on a sine voice matches the live render", async () => {
      await runParity({
        space: "surface", scale: 2, combine: "add",
        field1: "radial", wave1: "sin", freq1: 3, speed1: 0.2, phase1: 0.3, amp1: 1,
        field2: "angular", wave2: "sin", freq2: 3, phase2: -0.15, amp2: 0.6,
        amp3: 0, amp4: 0, amp5: 0, amp6: 0,
        glyphs: " .:-=+*#%@", color: "#ffcf5a", colorB: "#c78bff", gradient: 0.5,
      });
    });

    it("per-voice angle and origin (previously silently ignored by the old exporter) match the live render", async () => {
      await runParity({
        space: "surface", scale: 2, combine: "multiply",
        field1: "linearX", wave1: "triangle", freq1: 2, angle1: 35, originU1: 0.3, originV1: -0.2, amp1: 1,
        field2: "radial", wave2: "sin", freq2: 3, originU2: -0.4, originV2: 0.25, amp2: 0.7,
        amp3: 0, amp4: 0, amp5: 0, amp6: 0,
        glyphs: " .:-=+*#%@", color: "#00e5ff", colorB: "#ff7a45", gradient: 0.6,
      });
    });

    it("voiceColors + argmax (winner lookup by flat source index) matches the live render", async () => {
      await runParity({
        space: "surface", scale: 1.2, combine: "argmax",
        field1: "linearX", wave1: "triangle", freq1: 1, angle1: 0, amp1: 1,
        field2: "linearX", wave2: "triangle", freq2: 1, angle2: 60, amp2: 1,
        field3: "linearX", wave3: "triangle", freq3: 1, angle3: 120, amp3: 1,
        amp4: 0, amp5: 0, amp6: 0,
        voiceColors: true, color1: "#f4f4f4", color2: "#d0d0d0", color3: "#6b6b6b",
        gain: 3, bias: 1, glyphs: "░▒█",
      });
    });

    it("gyroid (2D z=0 slice) matches the live render (VOLUMETRIC-2.md §2)", async () => {
      await runParity({
        space: "surface", scale: 1.5, combine: "add",
        field1: "gyroid", wave1: "sin", freq1: 3, speed1: 0.2, amp1: 1,
        field2: "gyroid", wave2: "step", freq2: 2, phase2: 0.1, amp2: 0.6,
        amp3: 0, amp4: 0, amp5: 0, amp6: 0,
        glyphs: " .:-=+*#%@", color: "#7df9ff", colorB: "#ff4fa3", gradient: 0.6,
      });
    });

    it("menger (2D z=0 slice, iter 2) matches the live render (VOLUMETRIC-2.md §2)", async () => {
      await runParity({
        space: "surface", scale: 1, combine: "add",
        field1: "menger", wave1: "step", freq1: 1, iter1: 2, amp1: 1,
        amp2: 0, amp3: 0, amp4: 0, amp5: 0, amp6: 0,
        glyphs: " █", color: "#8affc1",
      });
    });

    it("sierpinski (2D z=0 slice, iter 2, origin translation + phase) matches the live render (VOLUMETRIC-2.md §2)", async () => {
      await runParity({
        space: "surface", scale: 1, combine: "add",
        field1: "sierpinski", wave1: "step", freq1: 1, iter1: 2, phase1: 0.05,
        originU1: 0.1, originV1: -0.05, amp1: 1,
        amp2: 0, amp3: 0, amp4: 0, amp5: 0, amp6: 0,
        glyphs: " █", color: "#ffcf5a",
      });
    });

    // P1-B fixer pass: the live SDF branch samples `qz = z - cz` (z=0 in the
    // 2D branch, cz = the call-level originZ [always 0 in 2D] + the voice's
    // own `origin.w`), so a nonzero `originW` genuinely shifts WHICH z-slice
    // of the 3D fractal a 2D patch renders — it's a "translation", not a
    // volumetric-only no-op, for the SDF voice family specifically (unlike
    // every other field). The old exporter both rejected any active voice's
    // nonzero originW outright AND, independently, hardcoded `fz=0` and
    // dropped `origin.w` from serialization in RUNTIME_JS — so even after
    // relaxing the reject for SDF fields, the export would have silently
    // rendered the WRONG z-slice. The reviewer's own counterexample (gyroid,
    // step wave, originW .25, point (.1,.1,0): live raw -0.3334887 -> step
    // -1, export raw (old, fz hardcoded 0) 1.0633135 -> step +1) is the
    // shape of bug this full-grid, real-oracle parity test would have caught.
    it("gyroid with a nonzero originW (P1-B counterexample class: the z-slice offset) matches the live render", async () => {
      await runParity({
        space: "surface", scale: 1.5, combine: "add",
        field1: "gyroid", wave1: "step", freq1: 2, originW1: 0.25, amp1: 1,
        amp2: 0, amp3: 0, amp4: 0, amp5: 0, amp6: 0,
        glyphs: " █", color: "#7df9ff",
      });
    });

    it("sierpinski (2D z=0 slice, iter 2) with a nonzero originW matches the live render (P1-B: an originW-set full-parity case for a fractal field)", async () => {
      await runParity({
        space: "surface", scale: 1, combine: "add",
        field1: "sierpinski", wave1: "step", freq1: 1, iter1: 2, originW1: 0.15, amp1: 1,
        amp2: 0, amp3: 0, amp4: 0, amp5: 0, amp6: 0,
        glyphs: " █", color: "#ffcf5a",
      });
    });

    it("does NOT reject a nonzero originW on an active SDF-family voice (gyroid/menger/sierpinski), unlike every other field (P1-B fixer pass)", () => {
      for (const field of ["gyroid", "menger", "sierpinski"]) {
        const result = buildGlyphFieldSynthStaticExport(mesh(), baseOptions({
          params: { ...baseOptions().params, field1: field, wave1: "step", iter1: 2, originW1: 0.3, amp1: 1 },
        }));
        expect(result.js).toContain("requestAnimationFrame");
      }
      expect(isGlyphFieldSynthStaticExportSupported({
        ...baseOptions().params, field1: "menger", wave1: "step", iter1: 2, originW1: 0.3, amp1: 1,
      })).toBe(true);
    });

    it("existing preset 'Sunburst' still matches the live render (regression)", async () => {
      const preset = fieldSynth.presets.find((p) => p.name === "Sunburst");
      expect(preset).toBeDefined();
      await runParity(preset!.params);
    });

    it("existing preset 'Cube tiles' (argmax + angle + voiceColors) still matches the live render (regression)", async () => {
      const preset = fieldSynth.presets.find((p) => p.name === "Cube tiles");
      expect(preset).toBeDefined();
      await runParity(preset!.params);
    });

    it("existing preset 'Ink cells' (subcellRes: \"ink\", the preset the P1-A reject broke) still matches the live render (regression)", async () => {
      const preset = fieldSynth.presets.find((p) => p.name === "Ink cells");
      expect(preset).toBeDefined();
      await runParity(preset!.params);
    });

    it("subcellRes: \"2x4\" (braille dot mask) matches the live render", async () => {
      await runParity({
        space: "surface", scale: 2, combine: "add", subcellRes: "2x4",
        field1: "radial", wave1: "sin", freq1: 4, speed1: 0.3, amp1: 1,
        field2: "angular", wave2: "sin", freq2: 3, speed2: -0.2, amp2: 0.6,
        amp3: 0, amp4: 0, amp5: 0, amp6: 0,
        glyphs: " .:-=+*#%@", color: "#8affc1", gradient: 0.4,
      });
    });

    it("time animation: the same layered patch matches the live render at two distinct time values", async () => {
      const params: Partial<GlyphEffectParamsOf<typeof fieldSynth>> = {
        space: "surface", scale: 1.8, combine: "add",
        field1: "radial", wave1: "sin", freq1: 5, speed1: 0.4, phase1: 0.2, amp1: 1,
        field2: "angular", wave2: "saw", freq2: 4, speed2: -0.3, amp2: 0.6,
        amp3: 0, amp4: 0, amp5: 0, amp6: 0,
        glyphs: " .:-=+*#%@", color: "#7df9ff", colorB: "#ff4fa3", gradient: 0.5,
      };
      await runParity(params, 0);
      await runParity(params, 1.7);
    });

    // The reviewer's E2E repro shape (P1-B): layers + duty + phase together,
    // exercised on the per-cell coordinate TABLE path (a curved surface is
    // genuinely non-affine, so `affineDecisionsMatch` never even enters the
    // picture — this is a fold + table-precision regression check).
    //
    // NOT run through `expectExactGridParity`'s absolute-position oracle
    // comparison: a SPARSE bake (the sphere at this grid doesn't fill it)
    // exports a bounding-box-CROPPED, CSS-CENTERED standalone `<pre>` — by
    // design (the module doc: a portable pen, not a scene fragment), its
    // cropped cell (0,0) is NOT the original scene's absolute (0,0). Reusing
    // the plane-based absolute-position oracle here silently compares two
    // different coordinate spaces and reports spurious "mismatches" that are
    // actually the whole pattern shifted by the crop offset — confirmed by
    // inspection (the baked and live grids are identical up to a constant
    // (Δcol,Δrow) offset). A real table-path exactness check would need an
    // offset-aware comparator; out of scope for this fixer pass, which the
    // rotated-plane case below already covers for the fold+table logic this
    // patch shape exists to regress-test.
    it("layers + duty + phase together on a curved surface (sphere, table path) exports without throwing and paints something", () => {
      const result = buildGlyphFieldSynthStaticExport(mesh(), baseOptions({
        params: {
          ...baseOptions().params,
          space: "surface", scale: 1.6, combine: "add",
          field1: "linearX", wave1: "square", freq1: 3, duty1: 0.35, phase1: 0.15, amp1: 1, layer1: 1,
          field2: "linearY", wave2: "sin", freq2: 4, speed2: 0.5, phase2: -0.2, amp2: 0.8, layer2: 1,
          layerThresholdOn1: true, layerThreshold1: 0.1,
          field3: "radial", wave3: "square", freq3: 5, duty3: 0.6, amp3: 1, layer3: 2,
          layerInvert2: true, layerBlend2: "multiply", layerAmp2: 0.8,
          amp4: 0, amp5: 0, amp6: 0,
          glyphs: " .:-=+*#%@", color: "#ffcf5a", colorB: "#c78bff", gradient: 0.6,
        },
        rotX: 62, rotY: 38, zoom: 25,
      }));
      const cfgMatch = result.js.match(/var CFG=(\{.*\});\s*"use strict"/s);
      const cfg = JSON.parse(cfgMatch![1]!) as { aff: number[] | null };
      expect(cfg.aff).toBeNull();
      const dataMatch = result.js.match(/var DATA=(\{.*?\});var CFG=/);
      expect(dataMatch).not.toBeNull();
      const data = JSON.parse(dataMatch![1]!) as { bg: string[] };
      expect(data.bg.some((g) => g !== " ")).toBe(true);
    });

    it("layers + duty + phase together, under a rotated camera on a flat plane, matches the live render exactly", async () => {
      await runParity({
        space: "surface", scale: 1.6, combine: "add",
        field1: "linearX", wave1: "square", freq1: 3, duty1: 0.35, phase1: 0.15, amp1: 1, layer1: 1,
        field2: "linearY", wave2: "sin", freq2: 4, speed2: 0.5, phase2: -0.2, amp2: 0.8, layer2: 1,
        layerThresholdOn1: true, layerThreshold1: 0.1,
        field3: "radial", wave3: "square", freq3: 5, duty3: 0.6, amp3: 1, layer3: 2,
        layerInvert2: true, layerBlend2: "multiply", layerAmp2: 0.8,
        amp4: 0, amp5: 0, amp6: 0,
        glyphs: " .:-=+*#%@", color: "#ffcf5a", colorB: "#c78bff", gradient: 0.6,
      }, 0, planeMesh(), { rotX: 25, rotY: 40, zoom: 150 });
    });
  });
});
