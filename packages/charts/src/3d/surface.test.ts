import { describe, expect, it } from "vitest";
import { glyphChartSurface } from "./surface";

function flatGrid(rows: number, cols: number, value = 0): number[][] {
  return Array.from({ length: rows }, () => Array.from({ length: cols }, () => value));
}

describe("glyphChartSurface — grid-shape input", () => {
  it("resolves a row-major z grid with default uniform x/y", () => {
    const mark = glyphChartSurface({ z: [[0, 1], [2, 3]] });
    expect(mark.type).toBe("surface");
    expect(mark.grid.z).toEqual([[0, 1], [2, 3]]);
    expect(mark.grid.x).toEqual([0, 1]);
    expect(mark.grid.y).toEqual([0, 1]);
    expect(mark.zDomain).toEqual([0, 3]);
  });

  it("accepts explicit x/y position vectors via channels", () => {
    const mark = glyphChartSurface({ z: [[0, 1], [2, 3]] }, { x: [10, 20], y: [-5, 5] });
    expect(mark.grid.x).toEqual([10, 20]);
    expect(mark.grid.y).toEqual([-5, 5]);
  });

  it("defaults aspect to [1, 1, 0.6]", () => {
    const mark = glyphChartSurface({ z: [[0, 1], [2, 3]] });
    expect(mark.aspect).toEqual([1, 1, 0.6]);
  });

  it("rejects a ragged grid", () => {
    expect(() => glyphChartSurface({ z: [[0, 1], [2]] })).toThrow(/surface-ragged/);
  });

  it("rejects a grid smaller than 2x2", () => {
    expect(() => glyphChartSurface({ z: [[0]] })).toThrow(/surface-too-small/);
  });

  it("rejects non-finite z", () => {
    expect(() => glyphChartSurface({ z: [[0, NaN], [1, 2]] })).toThrow(/non-finite-data/);
  });

  it("rejects a mismatched x/y vector length", () => {
    expect(() => glyphChartSurface({ z: [[0, 1], [2, 3]] }, { x: [1, 2, 3] })).toThrow(/bad-options/);
  });

  it("rejects bad aspect/bands/colorscale/shading/color options", () => {
    const z = { z: [[0, 1], [2, 3]] };
    expect(() => glyphChartSurface(z, undefined, { aspect: [1, 1] as unknown as [number, number, number] })).toThrow(/bad-options/);
    expect(() => glyphChartSurface(z, undefined, { bands: 0 })).toThrow(/bad-options/);
    expect(() => glyphChartSurface(z, undefined, { colorscale: "not-a-scale" as never })).toThrow(/bad-options/);
    expect(() => glyphChartSurface(z, undefined, { shading: "bogus" as never })).toThrow(/bad-options/);
    expect(() => glyphChartSurface(z, undefined, { color: "bogus" as never })).toThrow(/bad-options/);
  });

  it("resolves the default viridis anchors, and null anchors under color: none", () => {
    const withColor = glyphChartSurface({ z: [[0, 1], [2, 3]] });
    expect(withColor.colorAnchors).not.toBeNull();
    expect(withColor.colorAnchors!.length).toBeGreaterThan(1);
    const noColor = glyphChartSurface({ z: [[0, 1], [2, 3]] }, undefined, { color: "none" });
    expect(noColor.colorAnchors).toBeNull();
  });

  it("resolves 3 axes with nice domains and finite ticks", () => {
    const mark = glyphChartSurface({ z: [[0, 1], [2, 3]] }, { x: [0, 100], y: [0, 10] });
    for (const axis of [mark.axes.x, mark.axes.y, mark.axes.z]) {
      expect(axis.domain[0]).toBeLessThanOrEqual(axis.domain[1]);
      expect(axis.ticks.length).toBeGreaterThan(0);
      expect(axis.tickLabels.length).toBe(axis.ticks.length);
      for (const t of axis.ticks) expect(Number.isFinite(t)).toBe(true);
    }
  });

  it("honours an explicit axis title, including an empty string to suppress it", () => {
    const mark = glyphChartSurface({ z: [[0, 1], [2, 3]] }, undefined, { axes: { z: { title: "elevation" }, x: { title: "" } } });
    expect(mark.axes.z.title).toBe("elevation");
    expect(mark.axes.x.title).toBe("");
  });

  it("MUTATION: reports surface-decimated in the ledger only when maxQuads actually caps the grid", () => {
    const bigZ = { z: flatGrid(10, 10) };
    const undecimated = glyphChartSurface(bigZ);
    expect(undecimated.report.ledger.some((e) => e.code === "surface-decimated")).toBe(false);
    const decimated = glyphChartSurface(bigZ, undefined, { maxQuadsX: 3, maxQuadsY: 3 });
    expect(decimated.report.ledger.some((e) => e.code === "surface-decimated")).toBe(true);
  });
});

describe("glyphChartSurface — long-row input", () => {
  const rows = [
    { x: 0, y: 0, z: 1 },
    { x: 1, y: 0, z: 2 },
    { x: 0, y: 1, z: 3 },
    { x: 1, y: 1, z: 4 },
  ];

  it("assembles a complete grid from long rows, sorted ascending", () => {
    const mark = glyphChartSurface(rows);
    expect(mark.grid.x).toEqual([0, 1]);
    expect(mark.grid.y).toEqual([0, 1]);
    expect(mark.grid.z).toEqual([[1, 2], [3, 4]]);
  });

  it("defaults axis titles to the field names", () => {
    const mark = glyphChartSurface(rows);
    expect(mark.axes.x.title).toBe("x");
    expect(mark.axes.y.title).toBe("y");
  });

  it("accepts custom field names via channels", () => {
    const custom = rows.map((r) => ({ lon: r.x, lat: r.y, elevation: r.z }));
    const mark = glyphChartSurface(custom, { x: "lon", y: "lat", z: "elevation" });
    expect(mark.grid.z).toEqual([[1, 2], [3, 4]]);
    expect(mark.axes.x.title).toBe("lon");
  });

  it("accepts accessor functions", () => {
    const mark = glyphChartSurface(rows, { x: (r) => (r.x as number) * 10, y: "y", z: "z" });
    expect(mark.grid.x).toEqual([0, 10]);
  });

  it("rejects a data set that doesn't form a 2x2+ grid (surface-not-gridded)", () => {
    expect(() => glyphChartSurface([{ x: 0, y: 0, z: 1 }])).toThrow(/surface-not-gridded/);
  });

  it("rejects a grid missing a cell (surface-ragged)", () => {
    const missing = rows.slice(0, 3);
    expect(() => glyphChartSurface(missing)).toThrow(/surface-ragged/);
  });

  it("rejects a duplicate (x, y) cell (surface-ragged)", () => {
    const dup = [...rows, { x: 0, y: 0, z: 99 }];
    expect(() => glyphChartSurface(dup)).toThrow(/surface-ragged/);
  });
});
