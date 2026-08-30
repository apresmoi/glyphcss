import { describe, expect, it } from "vitest";
import { parseGlyphMapAsciiGrid } from "./asciiGrid";

const GRID = `ncols 3
nrows 2
xllcorner 10
yllcorner 20
cellsize 1
NODATA_value -9999
1 2 3
4 -9999 6
`;

describe("parseGlyphMapAsciiGrid", () => {
  it("parses header + row-major data, row 0 = north (the file's first data row)", () => {
    const src = parseGlyphMapAsciiGrid(GRID, { id: "test-grid" });
    expect(src.cols).toBe(3);
    expect(src.rows).toBe(2);
    expect(src.bounds).toEqual({ west: 10, south: 20, east: 13, north: 22 });
    expect(Array.from(src.values)).toEqual([1, 2, 3, 4, -9999, 6]);
    expect(src.noDataValue).toBe(-9999);
    expect(src.id).toBe("test-grid");
    expect(src.kind).toBe("continuous");
  });

  it("accepts xllcenter/yllcenter as an alternative to corner coordinates", () => {
    const centered = GRID.replace("xllcorner 10", "xllcenter 10.5").replace("yllcorner 20", "yllcenter 20.5");
    const src = parseGlyphMapAsciiGrid(centered, { id: "test-grid" });
    expect(src.bounds.west).toBeCloseTo(10, 10);
    expect(src.bounds.south).toBeCloseTo(20, 10);
  });

  it("respects explicit meta overrides", () => {
    const src = parseGlyphMapAsciiGrid(GRID, { id: "cat", kind: "categorical", units: "class", noDataValue: 4 });
    expect(src.kind).toBe("categorical");
    expect(src.units).toBe("class");
    expect(src.noDataValue).toBe(4);
  });

  it("throws on a malformed header", () => {
    expect(() => parseGlyphMapAsciiGrid("ncols 3\nnrows 2\n1 2 3\n4 5 6\n", { id: "bad" })).toThrow(TypeError);
  });

  it("throws when the data section doesn't match ncols*nrows", () => {
    const short = GRID.replace("4 -9999 6", "4 -9999");
    expect(() => parseGlyphMapAsciiGrid(short, { id: "short" })).toThrow(TypeError);
  });
});
