import { describe, expect, it } from "vitest";
import { compileGlyphMap } from "./compile";
import { classifyGlyphMapField } from "./classify";
import { glyphMapBreaks } from "./classify";
import type { GlyphMapField } from "./types";

function fieldOf(values: number[], noData: number[] = []): GlyphMapField {
  const noDataBuf = new Uint8Array(values.length);
  for (const i of noData) noDataBuf[i] = 1;
  const valid = values.filter((_, i) => !noDataBuf[i]);
  return {
    bounds: { west: 0, east: values.length, south: 0, north: 1 },
    cols: values.length,
    rows: 1,
    values: Float32Array.from(values),
    noData: noDataBuf,
    kind: "continuous",
    min: Math.min(...valid),
    max: Math.max(...valid),
  };
}

describe("compileGlyphMap", () => {
  it("returns { html, css? } — not a bare string", () => {
    const field = fieldOf([0, 300, 900]);
    const bands = classifyGlyphMapField(field, glyphMapBreaks([250, 800]));
    const result = compileGlyphMap(bands, { ramp: ".:*", colors: ["#111111", "#222222", "#333333"] });
    expect(typeof result.html).toBe("string");
    expect(result.html.startsWith("<pre")).toBe(true);
    expect(typeof result.css).toBe("string");
  });

  it("plain (uncoloured) output when no colors are given", () => {
    const field = fieldOf([0, 300, 900]);
    const bands = classifyGlyphMapField(field, glyphMapBreaks([250, 800]));
    const { html } = compileGlyphMap(bands, { ramp: ".:*" });
    expect(html).not.toContain("<span");
    expect(html).toContain(".:*"[0]); // band 0 glyph present somewhere
  });

  it("water treatment overrides band 0's ramp glyph", () => {
    const field = fieldOf([-500, 300]);
    const bands = classifyGlyphMapField(field, glyphMapBreaks([0]));
    const { html: withWater } = compileGlyphMap(bands, { ramp: "X#", water: "~" });
    const { html: withoutWater } = compileGlyphMap(bands, { ramp: "X#" });
    expect(withWater).toContain("~");
    expect(withoutWater).not.toContain("~");
  });

  it("noData cells render blank by default", () => {
    const field = fieldOf([0, 300, 900], [1]);
    const bands = classifyGlyphMapField(field, glyphMapBreaks([250, 800]));
    const { html } = compileGlyphMap(bands, { ramp: ".:*" });
    // 3 cells, one blank in the middle: char at index 1 is a space.
    const stripped = html.replace(/<[^>]+>/g, "");
    expect(stripped[1]).toBe(" ");
  });

  it("hillshade darkens a shaded slope's color relative to a flat one", () => {
    // A field that's flat everywhere except a sharp step in the middle.
    const flat = fieldOf([500, 500, 500, 500, 500]);
    const slope = fieldOf([0, 100, 500, 900, 1000]);
    const bandsFlat = classifyGlyphMapField(flat, glyphMapBreaks([250]));
    const bandsSlope = classifyGlyphMapField(slope, glyphMapBreaks([250]));
    const presentation = {
      ramp: ".#",
      colors: ["#808080", "#808080"],
      hillshade: { azimuth: 315, altitude: 45, zFactor: 1 },
    };
    const flatOut = compileGlyphMap(bandsFlat, presentation);
    const slopeOut = compileGlyphMap(bandsSlope, presentation);
    // Flat terrain has zero local slope everywhere -> full shade (unchanged
    // color); the stepped field has non-zero slope on the interior cells,
    // so its colors must differ from the flat, unshaded reference.
    expect(slopeOut.html).not.toBe(flatOut.html);
  });
});
