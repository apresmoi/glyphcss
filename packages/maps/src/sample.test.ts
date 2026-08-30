import { describe, expect, it } from "vitest";
import { sampleGlyphMapField, glyphMapSamplerId } from "./sample";
import { glyphMapBounds } from "./view";
import type { GlyphMapSource } from "./types";

function ridgeSource(): GlyphMapSource {
  return {
    id: "ridge",
    kind: "continuous",
    bounds: { west: 0, east: 12, south: 0, north: 1 },
    cols: 12,
    rows: 1,
    values: Float32Array.from([10, 10, 10, 100, 10, 10, 10, 10, 10, 10, 10, 10]),
  };
}

describe("sampleGlyphMapField — sampler comparison (acceptance gate 2)", () => {
  it("mean/max/min/nearest demonstrably produce different output on a synthetic ridge", async () => {
    const source = ridgeSource();
    const view = { center: [6, 0.5] as const, span: 12, cols: 4, rows: 1 };

    const mean = await sampleGlyphMapField(source, view, { sampler: "mean" });
    const max = await sampleGlyphMapField(source, view, { sampler: "max" });
    const nearest = await sampleGlyphMapField(source, view, { sampler: "nearest" });

    // Cell 1 covers source pixels [10, 100, 10] — the ridge's peak.
    expect(mean.values[1]).toBeCloseTo(40, 5);
    expect(max.values[1]).toBe(100);
    expect(nearest.values[1]).toBe(10); // nearest-to-cell-center pixel is NOT the peak

    // All three genuinely differ — not just "not identical by luck".
    const distinct = new Set([mean.values[1], max.values[1], nearest.values[1]]);
    expect(distinct.size).toBe(3);
  });

  it("nearest aliases under a one-cell pan while mean does not", async () => {
    // 30 baseline-zero source pixels with one 1000-valued spike at pixel 12
    // (center 12.5). A 6-cell view over a 20-unit span gives a non-integer
    // cell width (20/6), so a whole-output-cell pan changes the phase
    // between source pixels and output cell boundaries — the classic
    // resampling aliasing setup.
    const values = new Float32Array(30).fill(0);
    values[12] = 1000;
    const source: GlyphMapSource = {
      id: "spike",
      kind: "continuous",
      bounds: { west: 0, east: 30, south: 0, north: 1 },
      cols: 30,
      rows: 1,
      values,
    };
    const cellWidth = 20 / 6;
    const west0 = 7;
    const west1 = west0 + cellWidth; // pan by exactly one output cell width

    const viewAt = (west: number) => ({ center: [west + 10, 0.5] as const, span: 20, cols: 6, rows: 1 });

    const meanA = await sampleGlyphMapField(source, viewAt(west0), { sampler: "mean" });
    const meanB = await sampleGlyphMapField(source, viewAt(west1), { sampler: "mean" });
    const nearA = await sampleGlyphMapField(source, viewAt(west0), { sampler: "nearest" });
    const nearB = await sampleGlyphMapField(source, viewAt(west1), { sampler: "nearest" });

    const cellA = meanA.values.findIndex((v) => v > 1);
    const cellB = meanB.values.findIndex((v) => v > 1);
    expect(cellA).toBeGreaterThanOrEqual(0);
    expect(cellB).toBeGreaterThanOrEqual(0);

    // Mean reports the SAME blended value for the spike's cell across the
    // pan — no aliasing, the feature's contribution is stable.
    expect(meanA.values[cellA]).toBeCloseTo(meanB.values[cellB], 5);

    // Nearest pops the feature fully in or out depending on exact phase —
    // the aliasing the design doc calls out.
    expect(nearA.values[cellA]).toBe(0);
    expect(nearB.values[cellB]).toBe(1000);
    expect(nearA.values[cellA]).not.toBe(nearB.values[cellB]);
  });
});

describe("sampleGlyphMapField — noData rules", () => {
  const source: GlyphMapSource = {
    id: "nodata-src",
    kind: "continuous",
    bounds: { west: 0, east: 4, south: 0, north: 1 },
    cols: 4,
    rows: 1,
    noDataValue: -9999,
    values: Float32Array.from([-9999, 5, -9999, -9999]),
  };

  it("default rule: a cell is noData only when ALL its samples are invalid", async () => {
    // 1 output cell covering 2 source pixels: [-9999, 5] -> some valid.
    const view = { center: [1, 0.5] as const, span: 2, cols: 1, rows: 1 };
    const field = await sampleGlyphMapField(source, view, { sampler: "mean" });
    expect(field.noData[0]).toBe(0);
    expect(field.values[0]).toBe(5);
  });

  it('"strict" rule: a cell is noData if ANY sample is invalid', async () => {
    const view = { center: [1, 0.5] as const, span: 2, cols: 1, rows: 1 };
    const field = await sampleGlyphMapField(source, view, { sampler: "mean", noData: "strict" });
    expect(field.noData[0]).toBe(1);
    expect(Number.isNaN(field.values[0])).toBe(true);
  });

  it("a cell whose samples are ALL invalid is noData under both rules", async () => {
    const view = { center: [2.5, 0.5] as const, span: 1, cols: 1, rows: 1 };
    const field = await sampleGlyphMapField(source, view, { sampler: "mean" });
    expect(field.noData[0]).toBe(1);
  });
});

describe("sampleGlyphMapField — upsample (magnification)", () => {
  const source: GlyphMapSource = {
    id: "coarse",
    kind: "continuous",
    bounds: { west: 0, east: 2, south: 0, north: 1 },
    cols: 2,
    rows: 1,
    values: Float32Array.from([0, 10]),
  };

  it("bilinear interpolates when a cell contains zero source pixels", async () => {
    // 8 output cells across the same 2-unit span outresolves the 2-pixel source.
    const view = { center: [1, 0.5] as const, span: 2, cols: 8, rows: 1 };
    const field = await sampleGlyphMapField(source, view, { sampler: "mean", upsample: "bilinear" });
    // Monotonically increasing across the interpolated span, not a flat step.
    for (let i = 1; i < field.values.length; i++) {
      expect(field.values[i]).toBeGreaterThanOrEqual(field.values[i - 1]);
    }
    expect(field.values[0]).not.toBe(field.values[field.values.length - 1]);
  });

  it("nearest upsample takes the closest source pixel with a hard step", async () => {
    const view = { center: [1, 0.5] as const, span: 2, cols: 8, rows: 1 };
    const field = await sampleGlyphMapField(source, view, { sampler: "mean", upsample: "nearest" });
    const values = new Set(Array.from(field.values));
    expect(values.size).toBeLessThanOrEqual(2); // only the two source pixel values appear
  });

  it("rejects bilinear upsample for a categorical field", async () => {
    const catSource: GlyphMapSource = { ...source, kind: "categorical" };
    const view = { center: [1, 0.5] as const, span: 2, cols: 8, rows: 1 };
    await expect(sampleGlyphMapField(catSource, view, { upsample: "bilinear" })).rejects.toThrow(TypeError);
  });
});

describe("sampleGlyphMapField — categorical default + majority", () => {
  it("defaults to majority for a categorical field", async () => {
    const source: GlyphMapSource = {
      id: "landcover",
      kind: "categorical",
      bounds: { west: 0, east: 3, south: 0, north: 1 },
      cols: 3,
      rows: 1,
      values: Float32Array.from([1, 1, 2]),
    };
    const view = { center: [1.5, 0.5] as const, span: 3, cols: 1, rows: 1 };
    const field = await sampleGlyphMapField(source, view);
    expect(field.values[0]).toBe(1);
  });
});

describe("sampleGlyphMapField — custom callback sampler", () => {
  it("hands the callback valid samples + cell context and records no id", async () => {
    const source = ridgeSource();
    const view = { center: [6, 0.5] as const, span: 12, cols: 4, rows: 1 };
    let sawContext: { count: number } | null = null;
    const field = await sampleGlyphMapField(source, view, {
      sampler: (samples, ctx) => {
        sawContext = ctx;
        return Math.max(...samples) - Math.min(...samples);
      },
    });
    expect(field.values[1]).toBe(90); // 100 - 10
    expect(sawContext).not.toBeNull();
    expect(sawContext!.count).toBe(3);
    expect(glyphMapSamplerId(undefined, "continuous")).toBe("mean");
    expect(glyphMapSamplerId(undefined, "categorical")).toBe("majority");
    expect(glyphMapSamplerId("max", "continuous")).toBe("max");
    expect(glyphMapSamplerId(() => 0, "continuous")).toBe("custom");
  });
});

describe("sampleGlyphMapField — glyphMapBounds view carries the exact box", () => {
  it("does not aspect-lock the box to cols/rows", async () => {
    const source: GlyphMapSource = {
      id: "box",
      kind: "continuous",
      bounds: { west: 0, east: 2, south: 0, north: 2 },
      cols: 2,
      rows: 2,
      values: Float32Array.from([1, 2, 3, 4]),
    };
    const view = glyphMapBounds({ west: 0, east: 2, south: 0, north: 1.2, cols: 140, rows: 48 });
    expect(view.bounds).toEqual({ west: 0, east: 2, south: 0, north: 1.2 });
    const field = await sampleGlyphMapField(source, view);
    expect(field.bounds).toEqual({ west: 0, east: 2, south: 0, north: 1.2 });
  });
});
