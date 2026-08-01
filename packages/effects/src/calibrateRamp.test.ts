import { createCanvas } from "@napi-rs/canvas";
import { describe, expect, it } from "vitest";
import { compileScene, spherePolygons, WIREFRAME_PALETTES, type Polygon } from "glyphcss";
import {
  calibrateGlyphRamp,
  calibrateWeightedGlyphRamp,
  measureGlyphInkCoverage,
  type GlyphCoverageCanvas2D,
  type GlyphCoverageCanvasFactory,
} from "./calibrateRamp";

// A real Canvas-2D surface off the DOM (no `document` in this vitest
// environment) — proves the measurement rasterizes an actual live font
// rather than faking coverage numbers.
const realCanvasFactory: GlyphCoverageCanvasFactory = (w, h) =>
  createCanvas(w, h) as unknown as { getContext(kind: "2d"): GlyphCoverageCanvas2D | null };

const REAL_FONT = { family: "monospace", size: 32 };

/**
 * Fully deterministic, environment-independent fake canvas: `fillText`
 * records the requested glyph, `getImageData` returns every pixel of the
 * requested `(w, h)` region at a uniform alpha that encodes an EXACT
 * coverage value from `coverageByGlyph` (alpha/255, so 1/255 granularity —
 * enough to place two glyphs on either side of any `minCoverageDelta`).
 * Isolates the sort/dedupe/resample logic from font or platform variance.
 */
function fakeCanvasFactory(coverageByGlyph: Record<string, number>): GlyphCoverageCanvasFactory {
  let alpha = 0;
  const ctx: GlyphCoverageCanvas2D = {
    font: "",
    textAlign: "center",
    textBaseline: "middle",
    fillStyle: "#fff",
    clearRect() {},
    fillText(text) {
      alpha = Math.round((coverageByGlyph[text] ?? 0) * 255);
    },
    getImageData(_x, _y, w, h) {
      const data = new Uint8ClampedArray(w * h * 4);
      for (let i = 3; i < data.length; i += 4) data[i] = alpha;
      return { data };
    },
  };
  return () => ({ getContext: () => ctx });
}

describe("measureGlyphInkCoverage", () => {
  it("throws without a working canvas 2D context and no injected canvasFactory (this test env's DOM has no real canvas)", () => {
    expect(() => measureGlyphInkCoverage("@", { font: REAL_FONT })).toThrow(/canvas 2d context/i);
  });

  it("measures a blank glyph as zero coverage and a dense glyph as denser, in a real rasterized font", () => {
    const space = measureGlyphInkCoverage(" ", { font: REAL_FONT, canvasFactory: realCanvasFactory });
    const dot = measureGlyphInkCoverage(".", { font: REAL_FONT, canvasFactory: realCanvasFactory });
    const at = measureGlyphInkCoverage("@", { font: REAL_FONT, canvasFactory: realCanvasFactory });
    expect(space).toBe(0);
    expect(dot).toBeGreaterThan(space);
    expect(at).toBeGreaterThan(dot);
  });
});

describe("calibrateGlyphRamp", () => {
  it("produces a strictly monotonic-coverage ramp for a real font", () => {
    const result = calibrateGlyphRamp({
      font: REAL_FONT,
      glyphs: " .:-=+*#%@",
      steps: 10,
      canvasFactory: realCanvasFactory,
    });

    expect(result.ramp.length).toBeGreaterThan(1);
    expect(result.steps).toHaveLength(result.ramp.length);
    for (let i = 1; i < result.steps.length; i++) {
      expect(result.steps[i]!.coverage).toBeGreaterThan(result.steps[i - 1]!.coverage);
    }
  });

  it("dedupes candidates whose measured coverage falls in the same bucket", () => {
    // "." and ":" render within 1/255 of each other (same bucket at the
    // default 1% minCoverageDelta); "=" and "@" are clearly denser steps.
    // Ungated dedupe would keep 4 candidates here — an unsorted or
    // duplicate-laden ramp generator would pass a length-agnostic test, so
    // assert the exact survivor list.
    const factory = fakeCanvasFactory({ ".": 0.05, ":": 0.05 + 1 / 255, "=": 0.3, "@": 0.9 });
    const result = calibrateGlyphRamp({
      font: REAL_FONT,
      glyphs: ".:=@",
      steps: 4,
      canvasFactory: factory,
    });

    expect(result.ramp).toBe(".=@");
    expect(result.steps.map((s) => s.glyph)).toEqual([".", "=", "@"]);
    for (let i = 1; i < result.steps.length; i++) {
      expect(result.steps[i]!.coverage - result.steps[i - 1]!.coverage).toBeGreaterThanOrEqual(0.01);
    }
  });

  it("never emits a duplicate glyph even when resampling collapses indices", () => {
    const factory = fakeCanvasFactory({ " ": 0, ".": 0.1, "@": 0.9 });
    const result = calibrateGlyphRamp({
      font: REAL_FONT,
      glyphs: " .@",
      steps: 8, // more steps than distinct candidates
      canvasFactory: factory,
    });

    expect(new Set(result.ramp.split("")).size).toBe(result.ramp.length);
    expect(result.ramp.length).toBeLessThanOrEqual(3);
  });

  it("rejects steps < 1", () => {
    expect(() => calibrateGlyphRamp({ font: REAL_FONT, steps: 0, canvasFactory: realCanvasFactory })).toThrow(
      /steps/,
    );
  });

  it("is unaffected by candidate glyph order", () => {
    const coverage = { "@": 0.9, ".": 0.1, " ": 0 };
    const a = calibrateGlyphRamp({ font: REAL_FONT, glyphs: " .@", steps: 3, canvasFactory: fakeCanvasFactory(coverage) });
    const b = calibrateGlyphRamp({ font: REAL_FONT, glyphs: "@. ", steps: 3, canvasFactory: fakeCanvasFactory(coverage) });
    expect(a.ramp).toBe(b.ramp);
  });
});

// B7 spike: font-weight is a second dimension of the same ink-coverage
// measurement `calibrateGlyphRamp` already does. Confirmed safe to compose
// (see cells.test.ts + the burnlist item's Node/Skia advance-width
// measurement across Menlo, Courier New, Monaco, Andale Mono, and the
// gallery's real stack: weight 400 vs 700 advance is bit-identical in every
// stack tested — a heavier glyph never desyncs the character grid).
describe("calibrateWeightedGlyphRamp", () => {
  const MONO_FONT = { family: "Menlo", size: 32 };

  it("produces a strictly monotonic-coverage ramp mixing weight 400 and 700 steps", () => {
    const result = calibrateWeightedGlyphRamp({
      font: MONO_FONT,
      glyphs: " .:-=+*#%@",
      weights: [400, 700],
      steps: 16,
      canvasFactory: realCanvasFactory,
    });

    expect(result.steps.length).toBeGreaterThan(1);
    for (let i = 1; i < result.steps.length; i++) {
      expect(result.steps[i]!.coverage).toBeGreaterThan(result.steps[i - 1]!.coverage);
    }
    // Proves weight actually contributed distinguishable steps, not just glyph shape.
    expect(result.steps.some((s) => s.weight === 700)).toBe(true);
  });

  it("renders a visibly deeper gradient than the glyph-only ramp for the same candidate pool and step budget", () => {
    const glyphs = " .:-=+*#%@";
    const glyphOnly = calibrateGlyphRamp({
      font: MONO_FONT,
      glyphs,
      steps: 40,
      canvasFactory: realCanvasFactory,
    });
    const weighted = calibrateWeightedGlyphRamp({
      font: MONO_FONT,
      glyphs,
      weights: [400, 700],
      steps: 40,
      canvasFactory: realCanvasFactory,
    });

    // Same candidate glyph pool, same requested step budget: crossing in a
    // weight dimension must not produce a SHALLOWER ramp than glyph shape
    // alone, and for this pool it strictly deepens it (more distinguishable
    // buckets survive dedupe before the step-budget resample).
    expect(weighted.steps.length).toBeGreaterThan(glyphOnly.steps.length);
  });
});

describe("calibrated ramp parity with compileScene", () => {
  it("registers as a WIREFRAME_PALETTES solid ramp and compiles unchanged, byte-identical across two runs", () => {
    const calibrated = calibrateGlyphRamp({
      font: REAL_FONT,
      glyphs: " .:-=+*#%@",
      steps: 10,
      canvasFactory: realCanvasFactory,
    });
    expect(calibrated.ramp.length).toBeGreaterThan(1);

    // The calibrated ramp is plain string data — dropping it into a named
    // palette needs no glyphcss import from calibrateRamp.ts itself, only
    // from this integration test, mirroring how any other GlyphRamps string
    // is consumed today.
    WIREFRAME_PALETTES.calibratedTest = {
      thin: [" "],
      normal: ["."],
      core: ["@"],
      solid: calibrated.ramp.split(""),
    };

    const polygons: Polygon[] = spherePolygons({ center: [0, 0, 0], size: 4, subdivisions: 1, color: "#8fb3d9" });
    const opts = {
      polygons,
      mode: "solid" as const,
      glyphPalette: "calibratedTest",
      cols: 40,
      rows: 20,
      useColors: false,
    };
    const first = compileScene(opts);
    const second = compileScene(opts);

    expect(first.inner).toBe(second.inner);
    expect(first.inner.length).toBeGreaterThan(0);
    // Every non-space glyph the renderer emitted must come from the
    // calibrated ramp — proves compileScene actually used it, unchanged.
    const usedGlyphs = new Set(first.inner.replace(/\n/g, "").split(""));
    usedGlyphs.delete(" ");
    for (const glyph of usedGlyphs) {
      expect(calibrated.ramp.includes(glyph)).toBe(true);
    }

    delete WIREFRAME_PALETTES.calibratedTest;
  });
});
