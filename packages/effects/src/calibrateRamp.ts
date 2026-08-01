/**
 * calibrateRamp — measure real ink coverage per glyph in a live font and
 * generate a solid-mode ramp that is perceptually linear for THAT font,
 * instead of an authored guess (see `GlyphRamps` in `./stock`) that only
 * reads correctly in the family it was eyeballed against.
 *
 * `measureGlyphInkCoverage` paints one glyph onto a 2D canvas and reads back
 * its alpha-weighted ink coverage (0 = empty cell, 1 = fully inked cell).
 * `calibrateGlyphRamp` measures a candidate glyph pool, sorts it by coverage,
 * collapses glyphs that land in the same coverage bucket (two visually
 * identical ramp steps are a defect, not detail), and emits a ramp string.
 *
 * Browser-only by default: the real measurement needs a Canvas 2D context
 * (`document.createElement("canvas")`). For non-DOM environments — SSR, a
 * worker without OffscreenCanvas, or this module's own tests — pass
 * `canvasFactory` to supply any Canvas-2D-compatible surface (for example
 * `@napi-rs/canvas`'s `createCanvas`, which is how this file's tests exercise
 * real font rasterization without a browser).
 *
 * Output is a plain string — the same shape as `GlyphRamps` — so it drops
 * into any ramp slot unchanged: a `glyphcss` `WIREFRAME_PALETTES` entry's
 * `solid` array (`.split("")`), an effect's `glyphs` param, or anywhere else
 * a ramp is read as data today. That is deliberate: this module never
 * imports `glyphcss` (or any renderer internals), so `compileScene` and the
 * rest of static compile stay byte-identical to the runtime render — a
 * calibrated ramp is just data, not a new integration.
 */

/** The subset of `CanvasRenderingContext2D` this module needs to measure ink coverage. */
export interface GlyphCoverageCanvas2D {
  font: string;
  textAlign: string;
  textBaseline: string;
  fillStyle: string;
  clearRect(x: number, y: number, w: number, h: number): void;
  fillText(text: string, x: number, y: number): void;
  getImageData(x: number, y: number, w: number, h: number): { data: ArrayLike<number> };
}

/** Minimal canvas surface: anything that can hand back a 2D context for `(width, height)`. */
export type GlyphCoverageCanvasFactory = (
  width: number,
  height: number,
) => { getContext(kind: "2d"): GlyphCoverageCanvas2D | null };

function defaultCanvasFactory(width: number, height: number): { getContext(kind: "2d"): GlyphCoverageCanvas2D | null } {
  if (typeof document === "undefined") {
    throw new Error(
      "glyph ramp calibration needs a Canvas 2D context: no `document` in this environment. " +
        "Pass `canvasFactory` (e.g. `@napi-rs/canvas`'s `createCanvas`) to measure off the DOM.",
    );
  }
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas as unknown as { getContext(kind: "2d"): GlyphCoverageCanvas2D | null };
}

export interface GlyphCoverageFont {
  /** CSS font-family, e.g. `"Menlo, monospace"`. */
  family: string;
  /** Font size in px. Default 32. */
  size?: number;
  weight?: string | number;
}

function cssFont(font: GlyphCoverageFont): string {
  const size = font.size ?? 32;
  const weight = font.weight !== undefined ? `${font.weight} ` : "";
  return `${weight}${size}px ${font.family}`;
}

export interface GlyphMeasureGlyphCoverageOptions {
  font: GlyphCoverageFont;
  /** Measurement cell width in px. Default `font.size * 0.6` (typical monospace advance). */
  cellWidth?: number;
  /** Measurement cell height in px. Default `font.size * 1.2` (typical line height). */
  cellHeight?: number;
  /** Canvas surface to measure with. Default `document.createElement("canvas")` (browser-only). */
  canvasFactory?: GlyphCoverageCanvasFactory;
}

/**
 * Ink coverage of one glyph in a live font, 0 (empty cell) .. 1 (fully inked
 * cell). Renders the glyph in white on a cleared cell and sums the alpha
 * channel — alpha, not RGB, so antialiasing coverage is measured directly
 * regardless of fill color.
 */
export function measureGlyphInkCoverage(glyph: string, options: GlyphMeasureGlyphCoverageOptions): number {
  if (glyph.length === 0) return 0;
  const size = options.font.size ?? 32;
  const factory = options.canvasFactory ?? defaultCanvasFactory;
  const width = Math.max(1, Math.round(options.cellWidth ?? size * 0.6));
  const height = Math.max(1, Math.round(options.cellHeight ?? size * 1.2));
  const canvas = factory(width, height);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("glyph ramp calibration: canvas 2D context unavailable");

  ctx.clearRect(0, 0, width, height);
  ctx.font = cssFont(options.font);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#fff";
  ctx.fillText(glyph, width / 2, height / 2);

  const { data } = ctx.getImageData(0, 0, width, height);
  let inkSum = 0;
  for (let i = 3; i < data.length; i += 4) inkSum += data[i]!;
  return inkSum / (255 * width * height);
}

// Broad ASCII ink-density candidate pool (darkest → busiest is NOT assumed —
// `calibrateGlyphRamp` measures and sorts every one of these for the actual
// font). Not a ramp itself, just a wide net of shapes to rank.
const DEFAULT_CANDIDATE_GLYPHS = Array.from(
  new Set(
    " .'\"`^,:;Il!i<>~+_-?][}{)(|\\/1tfjrxnuvczXYUJCLQ0OZmwqpdbkhao*#MW&8%B@$0123456789".split(""),
  ),
).join("");

export interface GlyphRampCalibrationOptions {
  font: GlyphCoverageFont;
  /** Candidate glyphs to measure and rank. Default: a broad ASCII ink-density pool. */
  glyphs?: string;
  /**
   * Desired ramp length (darkest → densest). The result may be SHORTER than
   * this if the font doesn't have this many visually distinct ink-coverage
   * steps at `minCoverageDelta` — the ramp is never padded with a duplicate
   * step to hit this count.
   */
  steps: number;
  /**
   * Minimum ink-coverage delta (0..1) two kept ramp steps must differ by.
   * Candidates closer than this collapse into one bucket (dedupe). Default
   * 0.01 (1% of the cell).
   */
  minCoverageDelta?: number;
  cellWidth?: number;
  cellHeight?: number;
  canvasFactory?: GlyphCoverageCanvasFactory;
}

export interface GlyphRampCalibrationStep {
  glyph: string;
  /** Measured ink coverage 0..1, strictly increasing across `result.steps`. */
  coverage: number;
}

export interface GlyphRampCalibrationResult {
  /** The generated ramp, darkest → densest. A plain string — drop-in anywhere a ramp is used today. */
  ramp: string;
  /** Per-step measured coverage, same order and length as `ramp`, strictly increasing. */
  steps: GlyphRampCalibrationStep[];
}

/**
 * Measure a candidate glyph pool in `options.font`, sort by ink coverage,
 * drop same-bucket duplicates, and resample down to `options.steps` evenly
 * spaced steps. The result is always strictly monotonic in coverage and
 * never contains two visually-identical steps.
 */
export function calibrateGlyphRamp(options: GlyphRampCalibrationOptions): GlyphRampCalibrationResult {
  if (options.steps < 1) throw new Error("calibrateGlyphRamp: `steps` must be >= 1");
  const minDelta = options.minCoverageDelta ?? 0.01;
  const candidateGlyphs = Array.from(new Set((options.glyphs ?? DEFAULT_CANDIDATE_GLYPHS).split("")));

  const measured = candidateGlyphs
    .map((glyph) => ({
      glyph,
      coverage: measureGlyphInkCoverage(glyph, {
        font: options.font,
        cellWidth: options.cellWidth,
        cellHeight: options.cellHeight,
        canvasFactory: options.canvasFactory,
      }),
    }))
    .sort((a, b) => a.coverage - b.coverage);

  // Bucket-dedupe: keep a candidate only if it's at least `minDelta` denser
  // than the last KEPT step, so two glyphs that render nearly identically in
  // this font collapse into a single ramp step.
  const deduped: GlyphRampCalibrationStep[] = [];
  for (const candidate of measured) {
    const prev = deduped[deduped.length - 1];
    if (!prev || candidate.coverage - prev.coverage >= minDelta) deduped.push(candidate);
  }

  const stepCount = Math.min(options.steps, deduped.length);
  const picked: GlyphRampCalibrationStep[] =
    stepCount === deduped.length
      ? deduped
      : Array.from({ length: stepCount }, (_, i) => {
          const idx = stepCount === 1 ? 0 : Math.round((i * (deduped.length - 1)) / (stepCount - 1));
          return deduped[idx]!;
        });

  // Evenly-spaced index resampling can repeat an index when `stepCount` is
  // small relative to `deduped.length`; collapse any resulting run so the
  // final ramp never repeats a glyph.
  const finalSteps: GlyphRampCalibrationStep[] = [];
  for (const step of picked) {
    const prev = finalSteps[finalSteps.length - 1];
    if (!prev || prev.glyph !== step.glyph) finalSteps.push(step);
  }

  return { ramp: finalSteps.map((s) => s.glyph).join(""), steps: finalSteps };
}

export interface GlyphWeightedRampCalibrationOptions extends GlyphRampCalibrationOptions {
  /**
   * Candidate `font-weight` values to cross with `glyphs`, e.g. `[400, 700]`.
   * Default `[options.font.weight ?? 400, 700]`. Each (glyph, weight) pair is
   * measured independently — a heavier weight typically deepens a glyph's
   * ink coverage without changing its shape, letting the same character set
   * cover more ramp steps than glyph shape alone.
   *
   * B7 (see the burnlist item / `AGENTS.md`): this weight dimension is safe
   * to compose with `calibrateGlyphRamp`'s coverage measurement ONLY because
   * measured advance width was confirmed stable across weight 400 vs 700 in
   * every tested monospace stack (Menlo, Courier New, Monaco, Andale Mono,
   * and the gallery's `ui-monospace, "JetBrains Mono", "SF Mono", "Menlo",
   * monospace` stack, which resolves to Menlo when the named webfonts
   * aren't installed) — a heavier span glyph never desyncs the character
   * grid in those stacks.
   */
  weights?: (string | number)[];
}

export interface GlyphWeightedRampCalibrationStep extends GlyphRampCalibrationStep {
  /** CSS `font-weight` this step was measured at. */
  weight: string | number;
}

export interface GlyphWeightedRampCalibrationResult {
  /**
   * The generated ramp's glyphs only, darkest → densest — a plain string for
   * call sites that don't care about weight. Because two steps can share a
   * glyph at different weights, this may contain a repeated character; pair
   * it with `steps[i].weight` for the actual per-step `font-weight`.
   */
  ramp: string;
  /** Per-step measured (glyph, weight) pair and coverage, strictly increasing coverage. */
  steps: GlyphWeightedRampCalibrationStep[];
}

/**
 * `calibrateGlyphRamp`, extended with a `font-weight` dimension: measures
 * every (glyph, weight) pair in the candidate pool, sorts by ink coverage,
 * dedupes same-bucket steps, and resamples to `options.steps`. Two glyphs at
 * different weights are different candidates even if their shape is
 * identical, so a heavier weight can slot a new step into a coverage gap a
 * glyph-only ramp couldn't fill.
 */
export function calibrateWeightedGlyphRamp(
  options: GlyphWeightedRampCalibrationOptions,
): GlyphWeightedRampCalibrationResult {
  if (options.steps < 1) throw new Error("calibrateWeightedGlyphRamp: `steps` must be >= 1");
  const minDelta = options.minCoverageDelta ?? 0.01;
  const candidateGlyphs = Array.from(new Set((options.glyphs ?? DEFAULT_CANDIDATE_GLYPHS).split("")));
  const candidateWeights = options.weights ?? [options.font.weight ?? 400, 700];

  const measured: GlyphWeightedRampCalibrationStep[] = [];
  for (const glyph of candidateGlyphs) {
    for (const weight of candidateWeights) {
      measured.push({
        glyph,
        weight,
        coverage: measureGlyphInkCoverage(glyph, {
          font: { ...options.font, weight },
          cellWidth: options.cellWidth,
          cellHeight: options.cellHeight,
          canvasFactory: options.canvasFactory,
        }),
      });
    }
  }
  measured.sort((a, b) => a.coverage - b.coverage);

  const deduped: GlyphWeightedRampCalibrationStep[] = [];
  for (const candidate of measured) {
    const prev = deduped[deduped.length - 1];
    if (!prev || candidate.coverage - prev.coverage >= minDelta) deduped.push(candidate);
  }

  const stepCount = Math.min(options.steps, deduped.length);
  const picked: GlyphWeightedRampCalibrationStep[] =
    stepCount === deduped.length
      ? deduped
      : Array.from({ length: stepCount }, (_, i) => {
          const idx = stepCount === 1 ? 0 : Math.round((i * (deduped.length - 1)) / (stepCount - 1));
          return deduped[idx]!;
        });

  const finalSteps: GlyphWeightedRampCalibrationStep[] = [];
  for (const step of picked) {
    const prev = finalSteps[finalSteps.length - 1];
    if (!prev || prev.glyph !== step.glyph || prev.weight !== step.weight) finalSteps.push(step);
  }

  return { ramp: finalSteps.map((s) => s.glyph).join(""), steps: finalSteps };
}
