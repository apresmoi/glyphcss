import { describe, expect, it } from "vitest";
import { buildGlyphMapArtifact } from "./artifact";
import { classifyGlyphMapField, glyphMapBreaks } from "./classify";
import type { GlyphMapField } from "./types";

describe("buildGlyphMapArtifact", () => {
  it("records bounds, grid, bands, and source/classifier/sampler ids (MAPS.md §10)", () => {
    const field: GlyphMapField = {
      bounds: { west: 1, east: 3, south: 4, north: 6 },
      cols: 2,
      rows: 1,
      values: Float32Array.from([10, 900]),
      noData: Uint8Array.from([0, 0]),
      kind: "continuous",
      units: "m",
      min: 10,
      max: 900,
    };
    const bands = classifyGlyphMapField(field, glyphMapBreaks([250]));
    const artifact = buildGlyphMapArtifact(bands, { source: "etopo1-2009", sampler: "max" });

    expect(artifact.version).toBe(1);
    expect(artifact.bounds).toEqual({ west: 1, east: 3, south: 4, north: 6 });
    expect(artifact.cols).toBe(2);
    expect(artifact.rows).toBe(1);
    expect(artifact.bands).toEqual([0, 1]);
    expect(artifact.noData).toEqual([0, 0]);
    expect(artifact.units).toBe("m");
    expect(artifact.source).toBe("etopo1-2009");
    expect(artifact.classifier).toBe(bands.classifier);
    expect(artifact.sampler).toBe("max");
  });
});
