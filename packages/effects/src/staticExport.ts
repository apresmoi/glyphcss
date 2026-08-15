/**
 * Static effect export — bakes an "effect only, static camera" scene into a
 * self-contained pen (one HTML document, no imports, no CDN, no
 * `glyphcss`/`@glyphcss/*` at runtime). Productionizes the strategy proven in
 * `bench/static-effect-export.md` (Strategy B: minimal inlined vanilla-JS):
 * bake the static base grid + each covered cell's resolved effect-domain
 * coordinate ONCE, then ship a tiny hand-written evaluator that recomputes the
 * pattern every `requestAnimationFrame` — smaller and smoother than a
 * prebaked-frame `steps()` export for anything past a handful of frames, and
 * unlike the live runtime, ships zero library code.
 *
 * The bake step reuses glyphcss's real, pure render + effect-input machinery
 * (`buildRasterizeContext`, `rasterize`, `retainGlyphEffectOutput`) and this
 * package's own field-synth coordinate resolution (`fieldSynthCoordinate` +
 * friends, exported from `./stock` for exactly this reuse) — so the baked
 * per-cell coordinates are byte-identical to what a mounted `<GlyphEffectLayer
 * effect={GlyphFieldSynthEffect}>` would read, not a hand-copied
 * approximation. Only the PER-FRAME oscillator math is duplicated as plain JS
 * text, because that is the entire point of the deliverable: a standalone
 * evaluator with no glyphcss import.
 *
 * The PER-FRAME oscillator/layer math (RUNTIME_JS) is a hand port of the
 * field-program IR evaluator (`evaluateFieldProgram`/`foldVoices`/
 * `sampleFieldVoice`'s 2D branch, packages/effects/src/fieldProgram.ts), not
 * of field-synth's flat schema — VOLUMETRIC.md's "The field program IR": "the
 * static exporter ports the IR evaluator, not the schema, so the frontend can
 * grow without touching the exporter again." `buildRuntime` compiles the
 * SAME program the live runtime evaluates (`compileFieldVoices`/
 * `resolveFieldSynthLayerShapes`/`compileFieldSynthProgram`, imported from
 * `./stock` for exactly this reuse) and bakes it as plain JSON; only the
 * evaluator that walks that program is duplicated as JS text, since that is
 * the one piece that has to run standalone with zero glyphcss import.
 *
 * Scope: field-synth only. Generalizing to another stock effect needs two more
 * things per effect id: (1) that effect's own coordinate resolver exported the
 * same way fieldSynthCoordinate is, and (2) a hand-written inlined JS port of
 * its per-cell math (there is no way to ship an arbitrary GlyphEffectProgram's
 * `evaluate()` without shipping a JS engine's worth of glyphcss around it).
 *
 * Two payload cuts beyond the bench's baseline (see `detectAffineCoords` /
 * `skipBase` in `buildRuntime`): a flat, head-on surface with a linear UV map
 * (e.g. the `/synth` page's default fullscreen plane) makes every cell's
 * domain coordinate an exact affine function of (col,row), so the per-cell
 * coordinate table — the bulk of the payload — is replaced with 6 fitted
 * scalars and a one-line formula; and when the effect covers every cell of
 * the grid with `blend:"replace"` at full opacity, the baked base glyph/color
 * grid is provably never read by the compositor and is skipped too. Curved or
 * projected surfaces (cube, sphere, a tilted plane, …) fail the affine
 * residual check and keep the table, unchanged from before.
 */
import {
  buildRasterizeContext,
  rasterize,
  retainGlyphEffectOutput,
  parseGlyphEffectColor,
  type CellGrid,
  type GlyphAmbientLight,
  type GlyphCamera,
  type GlyphDirectionalLight,
  type GlyphEffectBlend,
  type GlyphEffectCoordinates,
  type GlyphEffectOutputMetadata,
  type GlyphEffectParamsOf,
  type GlyphEffectScratchView,
  type Polygon,
  type RenderMode,
  type RetainedGlyphEffectOutput,
  createGlyphOrthographicCamera,
  createGlyphPerspectiveCamera,
  DEFAULT_PERSPECTIVE,
} from "glyphcss";
import {
  fieldSynth,
  findUvBounds,
  generatedSurfaceField,
  fieldSynthCoordinate,
  fieldSynthSubcellGradient,
  defaultGlyphEffectParams,
  buildFieldSynthVoices,
  compileFieldVoices,
  resolveFieldSynthLayerShapes,
  compileFieldSynthProgram,
  SYNTH_VOICES,
  BRAILLE_DOT_BITS,
  inkGlyphForField,
  type AnyContext,
  type AnyParams,
  type EffectSpace,
} from "./stock";
import { evaluateFieldProgram, type FieldLayer, type FieldProgram, type FieldVoice } from "./fieldProgram";

export type GlyphFieldSynthStaticExportEffect = "field-synth";

export interface GlyphFieldSynthStaticExportOptions {
  /** Which stock effect to export. Only `"field-synth"` is supported today (see module doc). */
  effect?: GlyphFieldSynthStaticExportEffect;
  /** field-synth params (a partial patch over its own defaults — same shape the live layer takes). `time` is ignored (the export always starts its own clock at 0). */
  params: Partial<GlyphEffectParamsOf<typeof fieldSynth>>;
  /** The blend the layer is ACTUALLY mounted with. Read verbatim — never defaulted from the effect definition's `defaultBlend` metadata, since `over` vs `replace` changes the composited look. */
  blend: GlyphEffectBlend;
  /** Effect layer opacity, matching `GlyphEffectLayerCommonOptions.opacity`. Default 1. */
  opacity?: number;
  /** Seconds before the client-side clock wraps (`time = (now/1000) % loopSeconds`). Longer = smoother-feeling for a slow patch, no payload cost either way (the baked table is time-independent). */
  loopSeconds: number;
  cols: number;
  rows: number;
  mode?: RenderMode;
  cellAspect?: number;
  useColors?: boolean;
  rotX?: number;
  rotY?: number;
  zoom?: number;
  projection?: "orthographic" | "perspective";
  perspectivePx?: number;
  fontSizePx?: number;
  lineHeightPx?: number;
  directionalLight?: GlyphDirectionalLight;
  ambientLight?: GlyphAmbientLight;
  title?: string;
}

export interface GlyphFieldSynthStaticExportResult {
  /** Self-contained `<!doctype html>…</html>` document. */
  html: string;
  css: string;
  js: string;
  /** Split for CodePen prefill (mirrors `GlyphInteractiveExportResult.pen`). */
  pen: { html: string; css: string; js: string };
}

const EMPTY_SCRATCH: GlyphEffectScratchView = {
  images: [],
  floatFields: [],
  uintFields: [],
  glyphFields: [],
  samples: [],
};

function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

// Mirrors createGlyphScene's identical bbox→worldToSceneScale computation
// (packages/glyphcss/src/api/createGlyphScene.ts) — plain bounding-box
// arithmetic, not effect math, so a local copy carries none of the
// silent-divergence risk the surface-basis functions would.
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

function buildCamera(options: GlyphFieldSynthStaticExportOptions): GlyphCamera {
  if (options.projection === "perspective") {
    return createGlyphPerspectiveCamera({
      rotX: options.rotX,
      rotY: options.rotY,
      zoom: options.zoom,
      perspective: options.perspectivePx ?? DEFAULT_PERSPECTIVE,
    });
  }
  return createGlyphOrthographicCamera({ rotX: options.rotX, rotY: options.rotY, zoom: options.zoom });
}

interface BakedCell {
  col: number;
  row: number;
  x: number;
  y: number;
  cx: number;
  cy: number;
  shade: number;
  glyph: string;
  /** Packed 24-bit RGB, or `-1` for "no color" (matches the runtime's sentinel). */  color: number;
  /**
   * Coordinate gradient (change in resolved (x, y) per full cell step,
   * right and down) — only populated for `subcellRes: "ink"`/`"2x4"`, the
   * same values `fieldSynthSubcellGradient` produces for the live path.
   * `undefined` for the plain (`"1x1"`) ramp path, which never reads it.
   */
  dxCol?: number;
  dyCol?: number;
  dxRow?: number;
  dyRow?: number;
}

interface Baked {
  cells: BakedCell[];
  cols: number;
  rows: number;
}

// Runs the REAL rasterizer + retains the base frame in the exact shape a
// mounted effect layer's evaluate() reads (GlyphEffectFrameView + coverage),
// then resolves each covered cell's field-synth domain coordinate with the
// package's own (real, tested) fieldSynthCoordinate — not a re-derivation.
function bake(
  polygons: Polygon[],
  options: GlyphFieldSynthStaticExportOptions,
  params: GlyphEffectParamsOf<typeof fieldSynth>,
): Baked {
  const mode: RenderMode = options.mode ?? "solid";
  // AGENTS.md: worldPosition/normal/shade retention is solid-mode-only.
  const retainOptional = mode === "solid";
  const camera = buildCamera(options);
  const worldToSceneScale = retainOptional
    ? computeWorldToSceneScale(polygons, options.cols, options.rows)
    : undefined;

  const metadata: GlyphEffectOutputMetadata = {
    id: "static-export",
    // Never dereferenced: retainGlyphEffectOutput / fieldSynthCoordinate only
    // read the geometry fields below; `.pre` only matters to a real DOM write,
    // which this pure builder never performs.
    pre: null as unknown as HTMLPreElement,
    isBase: true,
    cellToSceneGrid: [1, 0, 0, 1, 0, 0],
    sceneGridSize: [options.cols, options.rows],
    localCellFootprint: [1, 1],
    ...(worldToSceneScale !== undefined ? { worldToSceneScale } : {}),
  };

  let retained: RetainedGlyphEffectOutput | null = null;
  const ctx = buildRasterizeContext({
    camera,
    grid: { cols: options.cols, rows: options.rows, cellAspect: options.cellAspect ?? 2 },
    polygons,
    mode,
    directionalLight: options.directionalLight ?? { direction: [0.5, 0.7, 0.5], intensity: 1 },
    ambientLight: options.ambientLight ?? { intensity: 0.4 },
    useColors: options.useColors ?? true,
    retainShade: retainOptional,
    retainWorldPosition: retainOptional,
    retainNormal: retainOptional,
  });
  ctx.transformCells = (grid: CellGrid) => {
    retained = retainGlyphEffectOutput(grid, metadata);
    return grid;
  };
  rasterize(ctx);
  if (retained === null) throw new Error("glyphcss: static field-synth export — rasterize did not produce a base frame.");
  const baked: RetainedGlyphEffectOutput = retained;

  const coordinates: GlyphEffectCoordinates = {
    cellToSceneGrid: metadata.cellToSceneGrid,
    sceneGridSize: metadata.sceneGridSize,
    localCellFootprint: metadata.localCellFootprint,
    ...(metadata.worldToSceneScale !== undefined ? { worldToSceneScale: metadata.worldToSceneScale } : {}),
  };
  const context: AnyContext<AnyParams> = {
    params: params as unknown as AnyParams,
    state: undefined,
    base: baked.base,
    input: baked.base,
    target: { coverage: baked.baseCoverage },
    coordinates,
    scratch: EMPTY_SCRATCH,
    output: baked.emission,
  };

  const uvBounds = findUvBounds(context);
  const [sceneCols, sceneRows] = coordinates.sceneGridSize;
  const generatedSurface = params.space !== "scene" && !(params.space === "auto" && uvBounds)
    ? generatedSurfaceField(context)
    : undefined;
  const needsSubcellGradient = params.subcellRes === "ink" || params.subcellRes === "2x4";

  const cells: BakedCell[] = [];
  const n = baked.base.length;
  for (let i = 0; i < n; i++) {
    if (baked.baseCoverage[i]! <= 0) continue;
    const coord = fieldSynthCoordinate(
      context,
      i,
      params.space as EffectSpace,
      uvBounds,
      params.scale,
      params.originU,
      params.originV,
      sceneCols,
      sceneRows,
      generatedSurface,
    );
    if (!coord) continue;
    const [x, y, cx, cy] = coord;
    const shadeArr = baked.base.shade;
    const sh = shadeArr ? shadeArr[i]! : Number.NaN;
    const glyph = baked.baseGrid.char[i] ?? " ";
    const colorHex = baked.baseGrid.color[i] ?? null;
    let dxCol: number | undefined, dyCol: number | undefined, dxRow: number | undefined, dyRow: number | undefined;
    if (needsSubcellGradient) {
      // 2D-only (`fieldSynthSubcellGradient`, not the volumetric
      // `fieldSynthAnySubcellGradient` dispatcher) — `space: "object"` is
      // rejected before `bake()` ever runs, so the volumetric branch is
      // unreachable here. Same source, same edge-fallback semantics as the
      // live `subcellRes: "ink"`/`"2x4"` path (stock.ts), computed once per
      // cell here since the coordinate itself is time-independent.
      [dxCol, dyCol, dxRow, dyRow] = fieldSynthSubcellGradient(
        context, i, params.space as EffectSpace, uvBounds, params.scale,
        params.originU, params.originV, sceneCols, sceneRows, generatedSurface, x, y,
      );
    }
    cells.push({
      col: i % sceneCols,
      row: (i / sceneCols) | 0,
      x,
      y,
      cx,
      cy,
      shade: Number.isFinite(sh) ? sh : 1,
      glyph,
      color: colorHex ? parseGlyphEffectColor(colorHex).packed : -1,
      ...(needsSubcellGradient ? { dxCol, dyCol, dxRow, dyRow } : {}),
    });
  }
  return { cells, cols: options.cols, rows: options.rows };
}

interface AffineCoordFit {
  ax: number; bx: number; ecx: number;
  ay: number; by: number; ecy: number;
}

// A flat, head-on surface with a linear UV map (the /synth page's default
// fullscreen plane, and any other surface whose per-cell domain coordinate
// happens to come out affine) needs no per-cell coordinate table at all: the
// per-cell (x,y) is an exact affine function of grid (col,row), so the
// runtime can recompute it from 6 fitted scalars instead of shipping one
// float pair per cell — the ~86% of the payload the bench in
// bench/static-effect-export.md attributes to that table. Curved or
// perspective-projected surfaces (cube, sphere, a tilted/foreshortened
// plane, …) are NOT globally affine in cell space and must keep the baked
// table; the fit below detects that mechanically rather than assuming it
// from the shape name, so any surface that happens to be affine benefits and
// nothing else is misdetected.
//
// Least-squares fit of (col,row) → x and (col,row) → y shares one 3×3
// normal-equations solve (both regressions have the same design matrix).
// "Affine within epsilon" requires the max PER-CELL residual — not an
// average — to be under AFFINE_EPSILON: an average-error check would accept
// a surface that's affine almost everywhere but curves at the edges, which
// would silently corrupt exactly those cells once the table is dropped.
const AFFINE_EPSILON = 1e-3;

function detectAffineCoords(points: { col: number; row: number; x: number; y: number }[]): AffineCoordFit | null {
  const n = points.length;
  if (n < 3) return null;
  let Scc = 0, Scr = 0, Sc = 0, Srr = 0, Sr = 0;
  let Sxc = 0, Sxr = 0, Sx = 0, Syc = 0, Syr = 0, Sy = 0;
  for (const p of points) {
    Scc += p.col * p.col; Scr += p.col * p.row; Sc += p.col;
    Srr += p.row * p.row; Sr += p.row;
    Sxc += p.col * p.x; Sxr += p.row * p.x; Sx += p.x;
    Syc += p.col * p.y; Syr += p.row * p.y; Sy += p.y;
  }
  const m00 = Scc, m01 = Scr, m02 = Sc;
  const m10 = Scr, m11 = Srr, m12 = Sr;
  const m20 = Sc, m21 = Sr, m22 = n;
  const det =
    m00 * (m11 * m22 - m12 * m21)
    - m01 * (m10 * m22 - m12 * m20)
    + m02 * (m10 * m21 - m11 * m20);
  // Singular normal matrix — e.g. a 1-row/1-col grid, or too few points to
  // pin down 3 unknowns per axis. Keep the table; there's nothing to fit.
  if (Math.abs(det) < 1e-9) return null;
  const solve = (r0: number, r1: number, r2: number): [number, number, number] => {
    const dA =
      r0 * (m11 * m22 - m12 * m21)
      - m01 * (r1 * m22 - m12 * r2)
      + m02 * (r1 * m21 - m11 * r2);
    const dB =
      m00 * (r1 * m22 - m12 * r2)
      - r0 * (m10 * m22 - m12 * m20)
      + m02 * (m10 * r2 - r1 * m20);
    const dC =
      m00 * (m11 * r2 - r1 * m21)
      - m01 * (m10 * r2 - r1 * m20)
      + r0 * (m10 * m21 - m11 * m20);
    return [dA / det, dB / det, dC / det];
  };
  const [ax, bx, ecx] = solve(Sxc, Sxr, Sx);
  const [ay, by, ecy] = solve(Syc, Syr, Sy);
  for (const p of points) {
    const px = ax * p.col + bx * p.row + ecx;
    const py = ay * p.col + by * p.row + ecy;
    if (Math.abs(px - p.x) >= AFFINE_EPSILON || Math.abs(py - p.y) >= AFFINE_EPSILON) return null;
  }
  return { ax, bx, ecx, ay, by, ecy };
}

// P1-B fix: `detectAffineCoords`'s own residual bound is NOT a safe proxy for
// "the affine fit is behaviorally safe". Its least-squares solve leaves
// Cramer's-rule cancellation noise (measured ~1e-8 on an EXACTLY affine
// surface — the residual isn't modeling real curvature, it's numerical error
// in the fit itself) — tiny, but `Math.floor` (every duty/threshold
// discontinuity) has no continuity guarantee AT an exact boundary: a cell
// whose TRUE coordinate lands exactly on one (a symmetric setup naturally
// puts several there — freq 2 on a plane centered at the origin, the
// reviewer's repro) only needs an arbitrarily small perturbation to read the
// wrong side and flip its entire folded value's sign. No position-residual
// bound, however tight, can rule that out — a `residual * frequency` budget
// tight enough to catch it (< 1e-7 here) would reject nearly every affine
// fit, including ones with zero actual risk, discarding the payload win this
// exporter exists for. So this checks the FIELD'S OWN quantized decision
// instead of position error in isolation: substitute the affine
// reconstruction for the true coordinate at every baked cell, run BOTH
// through the real `evaluateFieldProgram` (never a re-derivation), and
// reject the fit only if a cell's RAMP INDEX or argmax WINNER actually
// disagrees. That is "how coordinates feed the field" made concrete — a
// residual that never crosses a decision boundary is genuinely harmless and
// keeps the affine win; one that does is caught exactly, not estimated.
// Time-independent by construction (the residual folds into the wave
// argument as a constant offset `Δraw * freq`, unaffected by `-t*speed`), so
// checking at `t = 0` — the same reference `bake()` already uses internally
// — covers every later playback time for the STATIC boundary case this
// fixes; an animated field could in principle sweep a marginal cell across a
// boundary at some other instant, which is the same irreducible risk
// `AFFINE_EPSILON` always carried, just recast temporally instead of newly
// introduced here.
// `subcellRes: "2x4"`/`"ink"` don't stop at the cell-center ramp index — they
// re-evaluate the program at 8 sub-cell offsets (2x4) or two neighbor offsets
// (ink), scaled by the coordinate GRADIENT. That gradient is a DERIVATIVE-
// level quantity, more exposed to a fit's tiny inaccuracy than the raw
// position itself (see `buildRuntime`'s `needsGrad` doc), so the affine fit
// needs its own, subcell-aware safety check — reusing the exact live dot-mask
// (`BRAILLE_DOT_BITS`) and stroke-bucket (`inkGlyphForField`) logic from
// stock.ts, not a re-derivation.
function compute2x4Mask(
  program: FieldProgram, x: number, y: number, cx: number, cy: number,
  dxCol: number, dyCol: number, dxRow: number, dyRow: number, bias: number, gain: number,
): number {
  let mask = 0;
  for (let dotCol = 0; dotCol < 2; dotCol++) {
    const fx = dotCol === 0 ? -0.25 : 0.25;
    for (let dotRow = 0; dotRow < 4; dotRow++) {
      const fy = (dotRow + 0.5) / 4 - 0.5;
      const subX = x + fx * dxCol + fy * dxRow;
      const subY = y + fx * dyCol + fy * dyRow;
      const subCombined = evaluateFieldProgram(program, subX, subY, 0, 0, cx, cy, 0).combined;
      const subValue = clamp01(bias + gain * subCombined * 0.5);
      if (subValue > 0.5) mask |= BRAILLE_DOT_BITS[dotCol]![dotRow]!;
    }
  }
  return mask;
}

function computeInkDecision(
  program: FieldProgram, x: number, y: number, cx: number, cy: number,
  dxCol: number, dyCol: number, dxRow: number, dyRow: number, bias: number, gain: number, inkLevels: number,
): { crosses: boolean; glyph: string } {
  const value = clamp01(bias + gain * evaluateFieldProgram(program, x, y, 0, 0, cx, cy, 0).combined * 0.5);
  const sample = (ox: number, oy: number): number =>
    clamp01(bias + gain * evaluateFieldProgram(program, x + ox, y + oy, 0, 0, cx, cy, 0).combined * 0.5);
  const right = sample(dxCol, dyCol);
  const down = sample(dxRow, dyRow);
  const levels = Math.max(1, Math.round(inkLevels));
  let crosses = false;
  for (let n = 1; n <= levels && !crosses; n++) {
    const level = n / (levels + 1);
    const side = value >= level;
    crosses = side !== (right >= level) || side !== (down >= level);
  }
  return { crosses, glyph: crosses ? inkGlyphForField(right - value, down - value) : "" };
}

function affineDecisionsMatch(
  cells: readonly BakedCell[],
  minCol: number,
  minRow: number,
  fit: AffineCoordFit,
  program: FieldProgram,
  bias: number,
  gain: number,
  rampMax: number,
  subcellRes: string,
  inkLevels: number,
): boolean {
  for (const c of cells) {
    const relCol = c.col - minCol, relRow = c.row - minRow;
    const rx = fit.ax * relCol + fit.bx * relRow + fit.ecx;
    const ry = fit.ay * relCol + fit.by * relRow + fit.ecy;
    const trueStack = evaluateFieldProgram(program, c.x, c.y, 0, 0, c.cx, c.cy, 0);
    const fitStack = evaluateFieldProgram(program, rx, ry, 0, 0, c.cx, c.cy, 0);
    if (trueStack.winner !== fitStack.winner) return false;
    const trueValue = clamp01(bias + gain * trueStack.combined * 0.5);
    const fitValue = clamp01(bias + gain * fitStack.combined * 0.5);
    const trueIdx = Math.min(rampMax, Math.max(0, Math.round(trueValue * rampMax)));
    const fitIdx = Math.min(rampMax, Math.max(0, Math.round(fitValue * rampMax)));
    if (trueIdx !== fitIdx) return false;

    if (subcellRes === "2x4") {
      const trueMask = compute2x4Mask(program, c.x, c.y, c.cx, c.cy, c.dxCol ?? 0, c.dyCol ?? 0, c.dxRow ?? 0, c.dyRow ?? 0, bias, gain);
      const fitMask = compute2x4Mask(program, rx, ry, c.cx, c.cy, fit.ax, fit.ay, fit.bx, fit.by, bias, gain);
      if (trueMask !== fitMask) return false;
    } else if (subcellRes === "ink") {
      const trueInk = computeInkDecision(program, c.x, c.y, c.cx, c.cy, c.dxCol ?? 0, c.dyCol ?? 0, c.dxRow ?? 0, c.dyRow ?? 0, bias, gain, inkLevels);
      const fitInk = computeInkDecision(program, rx, ry, c.cx, c.cy, fit.ax, fit.ay, fit.bx, fit.by, bias, gain, inkLevels);
      if (trueInk.crosses !== fitInk.crosses || trueInk.glyph !== fitInk.glyph) return false;
    }
  }
  return true;
}

function jsonForScript(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

// Shared vanilla-JS runtime, generalized from the bench's validated
// Strategy B evaluator. \`evalProgram\`/\`foldVoices\`/\`sampleVoice\` are a
// faithful hand port of \`evaluateFieldProgram\`/\`foldVoices\`/
// \`sampleFieldVoice\`'s 2D branch (packages/effects/src/fieldProgram.ts) —
// the IR evaluator, not field-synth's flat schema (VOLUMETRIC.md: "the
// static exporter ports the IR evaluator, not the schema"), consuming the
// COMPILED \`CFG.program\` (an array of layers, each an array of active
// voices) that \`buildRuntime\` bakes via the real \`compileFieldSynthProgram\`.
// Reproduces \`lerpPacked\`/\`scalePackedColor\` (packages/effects/src/stock.ts)
// and the compositor's blend + Bayer coverage dither
// (packages/glyphcss/src/render/effectCompositor.ts
// \`blendPackedColor\`/\`coverageThreshold\`) as plain JS — this text is the one
// piece that can't be "reused" instead of hand-written, since it has to run
// with zero glyphcss/effects code alongside it.
const RUNTIME_JS = `
"use strict";
var D=typeof DATA<"u"?DATA:0,C=CFG,N=C.full?C.cols*C.rows:D.c.length,ramp=C.ramp,rmax=ramp.length-1,P=C.program;
var FLAT=(function(){var out=[];for(var li=0;li<P.length;li++){var vs=P[li].voices;for(var vi=0;vi<vs.length;vi++)out.push(vs[vi])}
out.sort(function(a,b){return a.si-b.si});return out})();
var BAYER=[0,8,2,10,12,4,14,6,3,11,1,9,15,7,13,5];
function pmod(a,m){return((a%m)+m)%m}
function clamp01(v){return v<0?0:v>1?1:v}
function synthWave(k,t,duty){var p=t-Math.floor(t);if(k==="triangle")return 4*Math.abs(p-0.5)-1;if(k==="saw")return 2*p-1;if(k==="square")return p<duty?1:-1;return Math.sin(t*Math.PI*2)}
function h3(x,y,z){var h=Math.sin(x*127.1+y*311.7+z*74.7)*43758.5453;return h-Math.floor(h)}
function noise3(x,y,z){var xi=Math.floor(x),yi=Math.floor(y),zi=Math.floor(z),xf=x-xi,yf=y-yi,zf=z-zi;
var u=xf*xf*(3-2*xf),v=yf*yf*(3-2*yf),w=zf*zf*(3-2*zf);
var a000=h3(xi,yi,zi),a100=h3(xi+1,yi,zi),a010=h3(xi,yi+1,zi),a110=h3(xi+1,yi+1,zi),a001=h3(xi,yi,zi+1),a101=h3(xi+1,yi,zi+1),a011=h3(xi,yi+1,zi+1),a111=h3(xi+1,yi+1,zi+1);
var f0=(a000*(1-u)+a100*u)*(1-v)+(a010*(1-u)+a110*u)*v,f1=(a001*(1-u)+a101*u)*(1-v)+(a011*(1-u)+a111*u)*v;return f0*(1-w)+f1*w}
function sampleVoice(v,x,y,cx,cy,t){var sx=x,sy=y;
if(v.angle!==0){var a=(-v.angle*Math.PI)/180,dx=x-cx,dy=y-cy,ca=Math.cos(a),sa=Math.sin(a);sx=cx+dx*ca-dy*sa;sy=cy+dx*sa+dy*ca}
if(v.field==="noise")return 2*noise3(sx*v.freq,sy*v.freq,t*v.speed)-1;
var raw;
switch(v.field){case"linearX":raw=sx;break;case"linearY":raw=sy;break;case"diagonal":raw=(sx+sy)*0.70710678;break;
case"angular":raw=Math.atan2(sy-cy,sx-cx)/(Math.PI*2);break;case"spiral":raw=Math.hypot(sx-cx,sy-cy)+Math.atan2(sy-cy,sx-cx)/(Math.PI*2);break;default:raw=Math.hypot(sx-cx,sy-cy)}
return synthWave(v.wave,raw*v.freq-t*v.speed+v.phase,v.duty)}
function combineOp(mode,a,b){switch(mode){case"add":return a+b;case"max":return Math.max(a,b);case"min":return Math.min(a,b);case"difference":return Math.abs(a-b);case"argmax":return Math.max(a,b);default:return a*b}}
function foldVoices(voices,mode,x,y,ox,oy,t){var combined=0,active=0,best=-Infinity,winner=-1,winnerOrder=-1,argmax=mode==="argmax";
for(var k=0;k<voices.length;k++){var v=voices[k],cx=ox+v.origin.u,cy=oy+v.origin.v,o=sampleVoice(v,x,y,cx,cy,t);
if(argmax){var contribution=v.amp*o;if(contribution>best){best=contribution;winner=v.si;winnerOrder=active}}
else if(active===0){combined=v.amp*o}else{combined+=v.amp*(combineOp(mode,combined,o)-combined)}
active++}
if(argmax)combined=active>1?(2*winnerOrder+1)/active-1:0;
return{combined:combined,winner:winner,active:active}}
function evalProgram(prog,x,y,ox,oy,t){var stackValue=0,stackActive=0,populated=0,singleWinner=-1,applied=0;
for(var li=0;li<prog.length;li++){var layer=prog[li],r=foldVoices(layer.voices,layer.combine,x,y,ox,oy,t);
if(r.active===0)continue;
populated++;singleWinner=populated===1?r.winner:-1;stackActive+=r.active;
var v=r.combined;
if(layer.thresholdOn)v=v>layer.threshold?1:-1;
if(layer.invert)v=-v;
if(applied===0){stackValue=layer.amp*v}else{stackValue+=layer.amp*(combineOp(layer.blend,stackValue,v)-stackValue)}
applied++}
return{combined:stackValue,winner:populated===1?singleWinner:-1,active:stackActive}}
function lerp(a,b,t){var ar=(a>>16)&255,ag=(a>>8)&255,ab=a&255,br=(b>>16)&255,bg=(b>>8)&255,bb=b&255;
return(Math.round(ar+(br-ar)*t)<<16)|(Math.round(ag+(bg-ag)*t)<<8)|Math.round(ab+(bb-ab)*t)}
function shadeColor(p,s){var r=Math.round(((p>>16)&255)*s),g=Math.round(((p>>8)&255)*s),b=Math.round((p&255)*s);return(r<<16)|(g<<8)|b}
function blendColor(input,emitted,iw,ew){var ip=input!==-1,ep=emitted!==-1;
if(ip&&ep){var t=iw+ew;if(t<=0)return emitted;
var r=Math.floor((((input>>16)&255)*iw+((emitted>>16)&255)*ew)/t+0.5),g=Math.floor((((input>>8)&255)*iw+((emitted>>8)&255)*ew)/t+0.5),b=Math.floor(((input&255)*iw+(emitted&255)*ew)/t+0.5);
return(r<<16)|(g<<8)|b}
if(ip!==ep)return ew>=iw?emitted:input;return-1}
function thr(col,rw){var x=col+0.5,y=rw+0.5,mx=Math.floor(4*x),my=Math.floor(4*y);
var coarse=BAYER[pmod(Math.floor(my/4),4)*4+pmod(Math.floor(mx/4),4)],fine=BAYER[pmod(my,4)*4+pmod(mx,4)];return(16*coarse+fine+0.5)/256}
var BDB=[[1,2,4,64],[8,16,32,128]];
var INKS=["-","\\\\","|","/"];
function inkGlyph(gx,gy){var a=Math.atan2(gx,-gy);if(a<0)a+=Math.PI;var b=Math.round(a/(Math.PI/4))%4;return INKS[b]}
function gradAt(k){if(C.aff)return[C.aff[0],C.aff[3],C.aff[1],C.aff[4]];if(C.gFixed)return[C.gcx,C.gcy,C.grx,C.gry];return[D.gcx[k],D.gcy[k],D.grx[k],D.gry[k]]}
var pre=document.getElementById("g");
var rowBuf=new Array(C.rows);
function frame(now){var t=(now/1000)%C.loop;
for(var i=0;i<C.rows;i++)rowBuf[i]=[];
for(var k=0;k<N;k++){
var col0=C.full?k%C.cols:D.c[k],row0=C.full?(k/C.cols)|0:D.r[k];
var x=C.aff?C.aff[0]*col0+C.aff[1]*row0+C.aff[2]:D.x[k];
var y=C.aff?C.aff[3]*col0+C.aff[4]*row0+C.aff[5]:D.y[k];
var cx=C.cxFixed?C.cx:D.cx[k],cy=C.cyFixed?C.cy:D.cy[k];
var sh=C.shFixed?C.sh:D.sh[k];
var stack=evalProgram(P,x,y,cx,cy,t);
var cr=0,cg=0,cbv=0,cw=0,co=0,car=0,cag=0,cabv=0,caw=0,cao=0;
if(C.voiceColors){
if(stack.winner>=0){var wc=C.voiceColorsAll[stack.winner];
cr=(wc.p>>16)&255;cg=(wc.p>>8)&255;cbv=wc.p&255;co=wc.o;cw=1;car=cr;cag=cg;cabv=cbv;cao=co;caw=1
}else{
for(var j=0;j<FLAT.length;j++){var v=FLAT[j],ox=cx+v.origin.u,oy=cy+v.origin.v,o=sampleVoice(v,x,y,ox,oy,t);
var w=v.amp*Math.abs(o),c=C.voiceColorsAll[v.si],r=(c.p>>16)&255,g=(c.p>>8)&255,b=c.p&255;
cr+=r*w;cg+=g*w;cbv+=b*w;co+=c.o*w;cw+=w;car+=r*v.amp;cag+=g*v.amp;cabv+=b*v.amp;cao+=c.o*v.amp;caw+=v.amp}}}
var value=clamp01(C.bias+C.gain*stack.combined*0.5);
var isInk=C.sub==="ink",is2x4=C.sub==="2x4";
var emits=false,glyphOverride=null;
if(isInk){
var grad=gradAt(k),dxc=grad[0],dyc=grad[1],dxr=grad[2],dyr=grad[3];
var rightV=clamp01(C.bias+C.gain*evalProgram(P,x+dxc,y+dyc,cx,cy,t).combined*0.5);
var downV=clamp01(C.bias+C.gain*evalProgram(P,x+dxr,y+dyr,cx,cy,t).combined*0.5);
var levels=C.il,crosses=false;
for(var nlv=1;nlv<=levels&&!crosses;nlv++){var level=nlv/(levels+1),side=value>=level;crosses=side!==(rightV>=level)||side!==(downV>=level)}
if(crosses){emits=true;glyphOverride=inkGlyph(rightV-value,downV-value)}
}else if(is2x4){
if(value>0){
emits=true;
var grad2=gradAt(k),dxc2=grad2[0],dyc2=grad2[1],dxr2=grad2[2],dyr2=grad2[3];
var mask=0;
for(var dc=0;dc<2;dc++){var fx=dc===0?-0.25:0.25;
for(var dr=0;dr<4;dr++){var fy=(dr+0.5)/4-0.5;
var subX=x+fx*dxc2+fy*dxr2,subY=y+fx*dyc2+fy*dyr2;
var subVal=clamp01(C.bias+C.gain*evalProgram(P,subX,subY,cx,cy,t).combined*0.5);
if(subVal>0.5)mask|=BDB[dc][dr]}}
glyphOverride=String.fromCharCode(0x2800+mask)}
}else{
emits=value>0
}
var packed=-1,resolvedOpacity=0;
if(emits){
if(C.voiceColors&&cw>0){packed=(Math.round(cr/cw)<<16)|(Math.round(cg/cw)<<8)|Math.round(cbv/cw);resolvedOpacity=co/cw}
else if(C.voiceColors&&caw>0){packed=(Math.round(car/caw)<<16)|(Math.round(cag/caw)<<8)|Math.round(cabv/caw);resolvedOpacity=cao/caw}
else{packed=C.gradient>0?lerp(C.cA.p,C.cB.p,clamp01(value*C.gradient)):C.cA.p;resolvedOpacity=C.cA.o}
if(C.lit>0)packed=shadeColor(packed,1-C.lit*(1-clamp01(sh)))}
var emittedCoverage=emits?(isInk?resolvedOpacity:clamp01(value*resolvedOpacity)):0;
var inputCoverage=C.skipBase?1:D.bg[k]!==" "?1:0;
var emittedWeight=emittedCoverage*C.opacity;
var inputWeight=C.blend==="over"?inputCoverage*(1-emittedWeight):inputCoverage*(1-C.opacity);
var nextCoverage=clamp01(emittedWeight+inputWeight);
var col=col0,rw=row0;
var visible=nextCoverage>=1||(nextCoverage>0&&nextCoverage>thr(col,rw));
if(!visible)continue;
var chooseEmitted=emittedWeight>=inputWeight;
var g=chooseEmitted?(glyphOverride!==null?glyphOverride:ramp[Math.min(rmax,Math.max(0,Math.round(value*rmax)))]):(C.skipBase?" ":D.bg[k]);
var pk=blendColor(C.skipBase?-1:D.bc[k],packed,inputWeight,emittedWeight);
rowBuf[rw].push([col,g,g===" "?-1:pk])}
if(C.useColors){var html="";
for(var r2=0;r2<C.rows;r2++){var cells=rowBuf[r2];cells.sort(function(a,b){return a[0]-b[0]});
var line="",cur=-1,prevColor=-2,open=false;
for(var ci=0;ci<cells.length;ci++){var cell=cells[ci],cc=cell[0],gg=cell[1],pk2=cell[2];
while(cur<cc-1){if(open){line+="</span>";open=false;prevColor=-2}line+=" ";cur++}
if(pk2!==prevColor){if(open)line+="</span>";line+=pk2===-1?"<span>":"<span style=color:#"+pk2.toString(16).padStart(6,"0")+">";open=true;prevColor=pk2}
line+=gg;cur=cc}
if(open)line+="</span>";html+=line+"\\n"}
pre.innerHTML=html}else{var text="";
for(var r3=0;r3<C.rows;r3++){var cells3=rowBuf[r3];cells3.sort(function(a,b){return a[0]-b[0]});
var line3="",cur3=-1;
for(var ci3=0;ci3<cells3.length;ci3++){var cell3=cells3[ci3],cc3=cell3[0];
while(cur3<cc3-1){line3+=" ";cur3++}
line3+=cell3[1];cur3=cc3}
text+=line3+"\\n"}
pre.textContent=text}
requestAnimationFrame(frame)}
requestAnimationFrame(frame);
`;

function buildRuntime(baked: Baked, params: GlyphEffectParamsOf<typeof fieldSynth>, options: GlyphFieldSynthStaticExportOptions): { js: string; gridCols: number; gridRows: number } {
  let minCol = Infinity, maxCol = -Infinity, minRow = Infinity, maxRow = -Infinity;
  for (const c of baked.cells) {
    if (c.col < minCol) minCol = c.col;
    if (c.col > maxCol) maxCol = c.col;
    if (c.row < minRow) minRow = c.row;
    if (c.row > maxRow) maxRow = c.row;
  }
  if (!Number.isFinite(minCol)) { minCol = 0; maxCol = -1; minRow = 0; maxRow = -1; }
  const gridCols = Math.max(0, maxCol - minCol + 1);
  const gridRows = Math.max(0, maxRow - minRow + 1);

  // P1-B fix: every baked scalar/table that can feed a folded DECISION
  // (coordinates, coordinate gradients, and the `cx`/`cy` field-recentering
  // origins radial/angular/spiral fields read) is now baked at FULL
  // precision, not the earlier `Math.round(n * 1000) / 1000` trim — see
  // `affineDecisionsMatch`'s doc. A rounded-but-still-affine surface's
  // fitted position can legitimately differ from a cell's true coordinate by
  // a residual too small to matter almost everywhere and still cross an
  // EXACT discontinuity where it happens to matter; the table/gradient/`cx`/
  // `cy` fallback exists precisely to be the safe alternative when the
  // affine-fit check rejects the fit, so it must not reintroduce the same
  // class of risk via its OWN rounding — two real regressions this phase's
  // repro cases hit: a symmetric layered/threshold=0 patch legitimately
  // lands MANY cells exactly on a boundary (even 6-decimal/5e-7 coordinate
  // rounding flipped some of them), and a `subcellRes: "2x4"` patch's
  // borderline sub-sample (~2e-5 below its 0.5 threshold) flipped once a
  // 3-decimal-rounded `cx` (off by ~3e-4) fed through a recentered
  // radial/angular fold. Only `shade` keeps a cosmetic 2-decimal round
  // (below, `Math.round(c.shade * 100) / 100`) — it feeds a `±1`-per-channel
  // color scale, never a decision boundary.

  // Compile the SAME IR the live evaluator runs (VOLUMETRIC.md: "the static
  // exporter ports the IR evaluator, not the schema") — `compileFieldVoices`/
  // `resolveFieldSynthLayerShapes`/`compileFieldSynthProgram` are the exact
  // functions `fieldSynth.program.evaluate()` calls, imported from "./stock"
  // for exactly this reuse. `volumetric` is always `false` here:
  // `assertStaticExportSupported` rejects `space: "object"` before `bake()`
  // ever runs, so the compiled program's domain is always "2d" and its
  // `origin.w`/`linearZ` branch is dead — the serialized payload below drops
  // both accordingly. Computed here (before the affine decision, not just
  // before serialization) because `affineDecisionsMatch` needs the real
  // compiled program to verify the fit against.
  const anyParams = params as unknown as AnyParams;
  const synthVoices = buildFieldSynthVoices(anyParams);
  const compiledVoices = compileFieldVoices(synthVoices, params.scale);
  const layerShapes = resolveFieldSynthLayerShapes(anyParams);
  const program = compileFieldSynthProgram(compiledVoices, layerShapes, false);
  const rampMax = params.glyphs.length - 1;

  let affine = detectAffineCoords(
    baked.cells.map((c) => ({ col: c.col - minCol, row: c.row - minRow, x: c.x, y: c.y })),
  );
  // P1-B fix: a residual-only accept can be behaviorally unsafe (see
  // `affineDecisionsMatch`'s doc) — verify it before committing to the
  // affine formula, and fall back to the per-cell table when it isn't.
  if (affine && !affineDecisionsMatch(baked.cells, minCol, minRow, affine, program, params.bias, params.gain, rampMax, params.subcellRes, params.inkLevels)) {
    affine = null;
  }
  // Plane-fill: every raster cell in `cols×rows` got baked — no silhouette
  // gaps, the surface fills the whole viewport. `bake()` walks the grid in
  // increasing row-major index order (`i = 0..cols*rows-1`, `col=i%cols,
  // row=(i/cols)|0`) and only skips uncovered cells, so a full bake is
  // guaranteed to still be in that exact row-major order — every (col,row)
  // pair appears exactly once, in scan order. That means the per-cell `c`/`r`
  // index arrays carry zero information beyond the loop counter: the runtime
  // can derive them from `k` and `CFG.cols` instead of reading a table.
  // Sparse bakes (silhouette gaps — e.g. a cube or sphere) keep the table;
  // there's no formula for "which cells are covered".
  const full = baked.cells.length === options.cols * options.rows;
  // Plane-fill case, further restricted: the effect also fully overwrites
  // the pixel (`replace` at opacity 1 means the base contributes EXACTLY
  // zero weight to every composited cell: see `inputWeight` in RUNTIME_JS's
  // `frame()` — `inputCoverage*(1-C.opacity)` is 0 whenever opacity is 1).
  // The baked base glyph/color grid is then provably never read, so it's
  // dropped entirely and the runtime hardcodes "no base" instead. Partial
  // coverage, `over`, or opacity < 1 all mean the base genuinely still shows
  // through — keep baking it.
  const skipBase = full && options.blend === "replace" && clamp01(options.opacity ?? 1) === 1;

  const col: number[] = [], row: number[] = [], X: number[] = [], Y: number[] = [];
  const CXa: number[] = [], CYa: number[] = [], SH: number[] = [], BG: string[] = [], BC: number[] = [];
  // `cx,cy` are per-coplanar-group constants; in the common single-facet /
  // uv-space / scene-space cases they're a SINGLE constant across the whole
  // bake — detected and hoisted to a scalar so the (usually large) per-cell
  // arrays don't repeat it. Multi-facet meshes (several differently-oriented
  // coplanar groups) keep the per-cell arrays; deduping those too by group id
  // is a further, not-yet-implemented win (see module doc / AGENTS.md).
  //
  // Shade gets the same treatment: a single flat, evenly-lit facet (a
  // directional light has no position, so Lambert shade only depends on the
  // facet's normal) produces the exact same shade for every cell — hoist it
  // to a scalar too instead of repeating it once per cell.
  let cxFixed = true, cyFixed = true, shFixed = true;
  const cx0 = baked.cells[0]?.cx ?? 0, cy0 = baked.cells[0]?.cy ?? 0;
  const sh0 = Math.round((baked.cells[0]?.shade ?? 1) * 100) / 100;
  for (const c of baked.cells) {
    if (Math.abs(c.cx - cx0) > 1e-6) cxFixed = false;
    if (Math.abs(c.cy - cy0) > 1e-6) cyFixed = false;
    if (Math.round(c.shade * 100) / 100 !== sh0) shFixed = false;
  }

  // `subcellRes: "2x4"/"ink"` need the per-cell coordinate GRADIENT
  // (`fieldSynthSubcellGradient`'s neighbor finite-difference), not just the
  // coordinate itself. When `affine` holds, the gradient is exactly the
  // affine fit's own slope (`x = ax*col + bx*row + ecx` differentiates to a
  // CONSTANT (ax, bx) regardless of edge handling — the sign flip the live
  // edge-fallback applies at a grid boundary cancels out exactly for a truly
  // linear function), so it needs no data of its own: `RUNTIME_JS` reads it
  // straight off `C.aff`, staying self-consistent with the same approximate
  // position the runtime already committed to (deriving it from a separate,
  // more "precise" per-cell bake would disagree with the affine position by
  // exactly the residual this exporter already accepted). Only the
  // non-affine (table) case needs its own gradient data, hoisted to 4 fixed
  // scalars when uniform (the common "scene"-space / single-facet case)
  // exactly like `cx`/`cy` above, else a per-cell table.
  const needsGrad = params.subcellRes === "ink" || params.subcellRes === "2x4";
  let gFixed = true;
  // Full precision (unrounded) — same reasoning as the `X`/`Y` table above:
  // this feeds the same crossing-test/sub-sample decisions.
  const gcx0 = baked.cells[0]?.dxCol ?? 0, gcy0 = baked.cells[0]?.dyCol ?? 0;
  const grx0 = baked.cells[0]?.dxRow ?? 0, gry0 = baked.cells[0]?.dyRow ?? 0;
  if (needsGrad && !affine) {
    for (const c of baked.cells) {
      if (Math.abs((c.dxCol ?? 0) - gcx0) > 1e-9) gFixed = false;
      if (Math.abs((c.dyCol ?? 0) - gcy0) > 1e-9) gFixed = false;
      if (Math.abs((c.dxRow ?? 0) - grx0) > 1e-9) gFixed = false;
      if (Math.abs((c.dyRow ?? 0) - gry0) > 1e-9) gFixed = false;
    }
  }
  const bakeGradTable = needsGrad && !affine && !gFixed;
  const GCX: number[] = [], GCY: number[] = [], GRX: number[] = [], GRY: number[] = [];

  for (const c of baked.cells) {
    if (!full) { col.push(c.col - minCol); row.push(c.row - minRow); }
    // Full precision (unrounded) — see the doc above this function's start:
    // this table is the exact fallback for exactly the patches whose
    // discontinuities are sensitive enough that even a 6-decimal rounding
    // step can flip a decision.
    if (!affine) { X.push(c.x); Y.push(c.y); }
    // Full precision — `cx`/`cy` recenter radial/angular/spiral fields, so
    // they feed the same discontinuity-sensitive math `x`/`y` do (confirmed
    // by a real regression: a `subcellRes: "2x4"` patch's borderline
    // sub-sample, ~2e-5 below its 0.5 threshold, flipped once the OLD
    // 3-decimal-rounded `cx` — off by ~3e-4 from the true value — was fed
    // through the recentered radial/angular fold).
    if (!cxFixed) CXa.push(c.cx);
    if (!cyFixed) CYa.push(c.cy);
    if (!shFixed) SH.push(Math.round(c.shade * 100) / 100);
    if (!skipBase) { BG.push(c.glyph); BC.push(c.color); }
    if (bakeGradTable) {
      GCX.push(c.dxCol ?? 0); GCY.push(c.dyCol ?? 0);
      GRX.push(c.dxRow ?? 0); GRY.push(c.dyRow ?? 0);
    }
  }
  const data: Record<string, unknown> = {};
  if (!full) { data.c = col; data.r = row; }
  if (!affine) { data.x = X; data.y = Y; }
  if (!skipBase) { data.bg = BG; data.bc = BC; }
  if (!cxFixed) data.cx = CXa;
  if (!cyFixed) data.cy = CYa;
  if (!shFixed) data.sh = SH;
  if (bakeGradTable) { data.gcx = GCX; data.gcy = GCY; data.grx = GRX; data.gry = GRY; }
  const hasData = Object.keys(data).length > 0;

  // Serialize layers/voices, dropping what the evaluator would skip anyway
  // (payload optimization, not a behavior change): an inactive voice
  // (`amp <= 0`) never contributes to `foldVoices`, and a layer left with no
  // active voices after that filter is skipped wholesale by
  // `evaluateFieldProgram` — see fieldProgram.ts's `foldVoices`/
  // `evaluateFieldProgram`. Relative layer order is preserved (`.filter`
  // keeps array order), which is what the fold's "first populated layer
  // seeds the stack" rule depends on.
  const serializeVoice = (voice: FieldVoice) => {
    const parsedColor = parseGlyphEffectColor(voice.color);
    return {
      field: voice.field,
      wave: voice.wave,
      freq: voice.freq,
      speed: voice.speed,
      amp: voice.amp,
      duty: voice.duty,
      phase: voice.phase,
      angle: voice.angle,
      origin: { u: voice.origin.u, v: voice.origin.v },
      color: { p: parsedColor.packed, o: parsedColor.opacity },
      si: voice.sourceIndex,
    };
  };
  const serializedProgram = program.layers
    .map((layer: FieldLayer) => ({
      voices: layer.voices.filter((v) => v.amp > 0).map(serializeVoice),
      combine: layer.combine,
      thresholdOn: layer.thresholdOn,
      threshold: layer.threshold,
      invert: layer.invert,
      blend: layer.blend,
      amp: layer.amp,
    }))
    .filter((layer) => layer.voices.length > 0);

  // `stack.winner` (argmax mode) and the voiceColors fallback loop both index
  // by a voice's FLAT source position (0..SYNTH_VOICES-1, see
  // `FieldVoice.sourceIndex`'s doc in fieldProgram.ts) — so unlike the
  // per-layer voice records above, this table can't be filtered to active
  // voices only; it must stay indexable at any original voice number that
  // could ever appear as a winner or fallback contributor. Only baked when
  // `voiceColors` is on (the one thing that reads it).
  const voiceColorsAll = params.voiceColors
    ? Array.from({ length: SYNTH_VOICES }, (_, k) => {
        const parsedColor = parseGlyphEffectColor(anyParams[`color${k + 1}`] as string);
        return { p: parsedColor.packed, o: parsedColor.opacity };
      })
    : undefined;

  const cA = parseGlyphEffectColor(params.color);
  const cB = parseGlyphEffectColor(params.colorB);

  const cfg = {
    rows: gridRows,
    loop: options.loopSeconds,
    combine: params.combine,
    gradient: params.gradient,
    lit: params.lit,
    gain: params.gain,
    bias: params.bias,
    ramp: Array.from(params.glyphs),
    cA: { p: cA.packed, o: cA.opacity },
    cB: { p: cB.packed, o: cB.opacity },
    voiceColors: params.voiceColors,
    ...(voiceColorsAll ? { voiceColorsAll } : {}),
    program: serializedProgram,
    blend: options.blend,
    opacity: clamp01(options.opacity ?? 1),
    useColors: options.useColors ?? true,
    cxFixed,
    cyFixed,
    // Full precision — see the doc above the `CXa`/`CYa` push site.
    cx: cxFixed ? cx0 : 0,
    cy: cyFixed ? cy0 : 0,
    shFixed,
    sh: shFixed ? sh0 : 0,
    // Full precision here, NOT rounded: these 6 scalars are multiplied by
    // (col,row) — up to a few hundred — at runtime, so 3-decimal rounding
    // (fine for a per-cell coordinate, where the error stays put) would get
    // amplified by that multiplication into an error many times bigger than
    // AFFINE_EPSILON. Six extra full-precision numbers cost a few dozen
    // bytes; that's irrelevant next to the table this replaces.
    aff: affine ? [affine.ax, affine.bx, affine.ecx, affine.ay, affine.by, affine.ecy] : null,
    skipBase,
    full,
    // Only needed to derive (col,row) from the loop index `k` when `full`
    // drops the `c`/`r` tables — omitted otherwise so a sparse bake doesn't
    // pay for a field it never reads.
    ...(full ? { cols: gridCols } : {}),
    // `sub` is always shipped (the plain "1x1" ramp path is the default and
    // by far the common case) so RUNTIME_JS's mode branch never needs a
    // separate "is this field present" check. Gradient scalars/table are
    // omitted entirely for "1x1" (never read) and for the affine case (the
    // runtime derives them from `aff` instead — see the `needsGrad` doc
    // above `buildRuntime`).
    sub: params.subcellRes,
    ...(params.subcellRes === "ink" ? { il: Math.max(1, Math.round(params.inkLevels)) } : {}),
    ...(needsGrad && !affine ? {
      gFixed,
      gcx: gFixed ? gcx0 : 0, gcy: gFixed ? gcy0 : 0,
      grx: gFixed ? grx0 : 0, gry: gFixed ? gry0 : 0,
    } : {}),
  };

  // `hasData`: the affine + skipBase + fixed-cx/cy + fixed-shade + full-grid
  // combo (a flat, head-on, fully-covered plane) leaves nothing for `DATA` to
  // carry — every per-cell field has been hoisted to a `CFG` scalar or is
  // derivable from the loop index. `var DATA=...;` is then omitted entirely
  // rather than emitted as an empty object; RUNTIME_JS's `typeof DATA<"u"`
  // guard handles the identifier not existing (every subsequent `D.foo[k]`
  // read is itself gated by the same `CFG` flag that made `DATA` droppable,
  // so `D` is never dereferenced when it's `0`).
  const js = `${hasData ? `var DATA=${jsonForScript(data)};` : ""}var CFG=${jsonForScript(cfg)};${RUNTIME_JS}`;
  return { js, gridCols, gridRows };
}

// Phase 5 (VOLUMETRIC.md's "Static export") ports the field-program IR
// evaluator itself into RUNTIME_JS: layers, thresholds, invert, layer blend,
// duty, phase, per-voice angle, and per-voice 2D origin (`originU`/`originV`)
// all now export and match the live runtime bit-for-bit (see
// staticExport.test.ts's parity suite). A Phase 5 fixer pass additionally
// ports `subcellRes: "2x4"`/`"ink"` (previously rejected — the OLD,
// pre-Phase-5 exporter had silently IGNORED them, which is what motivated
// the reject in the first place; a shipped preset ("Ink cells") set
// `subcellRes: "ink"`, so rejecting broke it outright). Both read the SAME
// per-cell coordinate gradient the live path does (`fieldSynthSubcellGradient`,
// exported from stock.ts) — computed once at bake time, then hoisted to a
// fixed scalar or derived directly from the affine fit's own slope exactly
// like the coordinate itself, and only baked as a genuine per-cell table when
// neither hoist applies (see `buildRuntime`'s `needsGrad` doc). What's left
// rejected is genuinely out of this exporter's design, not "not ported yet":
//
// - `render: "carve"` and `space: "object"` (the volumetric branch) — a
//   different export design entirely (a per-cell-per-frame march), not
//   something this affine-fit/coordinate-table exporter can fake.
// - `linearZ` on an active voice and `originW` on an active voice — both are
//   3D-only semantics that can only ever matter under `space: "object"`,
//   which is already rejected; keeping an explicit, separately-worded reject
//   for them (rather than letting the generic `space` reject cover it
//   implicitly) means a 2D patch that mistakenly sets one of these — most
//   likely an author who meant to also flip `space` to `"object"` — gets a
//   precise error naming the actual mistake, not a report that garbles two
//   different questions ("why is my field invisible" vs "why doesn't this
//   export") into one.
function assertStaticExportSupported(params: GlyphEffectParamsOf<typeof fieldSynth>): void {
  // Checked before the `space: "object"` reject below so a carve patch names
  // carve as the reason, not the volumetric branch it happens to require —
  // carve is its own per-cell march over every animated frame, a
  // fundamentally different bake than the affine-fit/coordinate-table
  // exporter this module builds (VOLUMETRIC.md's "Static export": "Baking a
  // march per cell per frame is a different export design; do not fake it").
  if (params.render === "carve") {
    throw new Error(
      'glyphcss: buildGlyphFieldSynthStaticExport does not support render: "carve" — carve raymarches the field '
      + "per cell per frame, which is a different export design than this baked coordinate-table/affine-fit "
      + "exporter. Not planned.",
    );
  }
  if (params.space === "object") {
    throw new Error(
      "glyphcss: buildGlyphFieldSynthStaticExport does not support space: \"object\" (volumetric fields) yet — "
      + "the inlined runtime only ports the 2D generated-surface/scene/auto paths. A per-cell-per-frame volumetric "
      + "march is a different export design; not planned (see VOLUMETRIC.md's \"Static export\").",
    );
  }
  const p = params as unknown as AnyParams;
  for (let k = 1; k <= SYNTH_VOICES; k++) {
    if (!((p[`amp${k}`] as number) > 0)) continue;
    if (p[`field${k}`] === "linearZ") {
      throw new Error(
        `glyphcss: buildGlyphFieldSynthStaticExport does not support field${k}: "linearZ" (a volumetric-only `
        + `field) on an active voice (amp${k} > 0) — it has no meaning in the 2D branch this exporter ports `
        + "(VOLUMETRIC.md's \"Primitives in 3D\": linearZ falls back to radial in 2D, which would silently alias "
        + "a different field than intended). Not planned.",
      );
    }
    if ((p[`originW${k}`] as number) !== 0) {
      throw new Error(
        `glyphcss: buildGlyphFieldSynthStaticExport does not support originW${k} !== 0 on an active voice `
        + `(amp${k} > 0) — origin W is a volumetric-only (3D) semantic and is always ignored in the 2D branch `
        + "this exporter ports. Not planned.",
      );
    }
  }
}

/**
 * Bake the current field-synth patch over a static-camera mesh into a
 * self-contained pen: inlined per-cell coordinates + a tiny hand-written
 * vanilla-JS evaluator, animated with `requestAnimationFrame`. Zero imports,
 * zero CDN, zero `glyphcss`/`@glyphcss/*` at runtime.
 */
export function buildGlyphFieldSynthStaticExport(
  polygons: Polygon[],
  options: GlyphFieldSynthStaticExportOptions,
): GlyphFieldSynthStaticExportResult {
  if (options.effect !== undefined && options.effect !== "field-synth") {
    throw new Error(
      `glyphcss: buildGlyphFieldSynthStaticExport only supports the "field-synth" effect (got "${options.effect}"). `
      + "Generalizing to another stock effect needs that effect's own coordinate resolver exported from " + "@glyphcss/effects and a hand-written inlined JS port of its per-cell math — see the module doc.",
    );
  }
  if (!(options.cols > 0) || !(options.rows > 0)) {
    throw new RangeError("glyphcss: buildGlyphFieldSynthStaticExport requires cols/rows > 0.");
  }
  if (!(options.loopSeconds > 0)) {
    throw new RangeError("glyphcss: buildGlyphFieldSynthStaticExport requires loopSeconds > 0.");
  }

  const params = { ...defaultGlyphEffectParams(fieldSynth), ...options.params, time: 0 } as GlyphEffectParamsOf<typeof fieldSynth>;
  fieldSynth.program.validateParams?.(params);
  assertStaticExportSupported(params);

  const baked = bake(polygons, options, params);
  const { js, gridCols, gridRows } = buildRuntime(baked, params, options);

  const fontSizePx = options.fontSizePx ?? 12;
  const lineHeightPx = options.lineHeightPx ?? fontSizePx;
  const css = `html,body{margin:0;height:100%;background:#0b0d10;display:grid;place-items:center}
#g{margin:0;white-space:pre;font-family:ui-monospace,Menlo,monospace;font-size:${fontSizePx}px;line-height:${lineHeightPx}px;color:#ccc;width:${gridCols}ch;height:${gridRows * lineHeightPx}px}`;
  const title = options.title ?? "glyphcss field synth";
  const bodyHtml = `<pre id="g"></pre>`;
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title><style>${css}</style></head><body>${bodyHtml}<script>${js}</script></body></html>`;

  return {
    html,
    css,
    js,
    pen: { html: bodyHtml, css, js },
  };
}
