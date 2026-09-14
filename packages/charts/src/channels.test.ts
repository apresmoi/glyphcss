import { describe, expect, it } from "vitest";
import { materializeGlyphChartMarkRows } from "./channels";
import { glyphChartLine } from "./spec";

describe("materializeGlyphChartMarkRows", () => {
  // Gate: "shorthand snapshot" — a 1-D numeric array infers x=index, y=identity.
  // Mutation: swap the index/identity inference (e.g. x=identity, y=index) -> red.
  it("infers x=index, y=identity for a bare number array", () => {
    const rows = materializeGlyphChartMarkRows(glyphChartLine([3, 5, 2, 8]));
    expect(rows).toEqual([
      { x: 0, y: 3, fill: undefined, stroke: undefined, label: undefined, index: 0 },
      { x: 1, y: 5, fill: undefined, stroke: undefined, label: undefined, index: 1 },
      { x: 2, y: 2, fill: undefined, stroke: undefined, label: undefined, index: 2 },
      { x: 3, y: 8, fill: undefined, stroke: undefined, label: undefined, index: 3 },
    ]);
  });

  it("resolves field-name channels against record data", () => {
    const data = [{ t: 1, v: 10 }, { t: 2, v: 20 }];
    const rows = materializeGlyphChartMarkRows(glyphChartLine(data, { x: "t", y: "v" }));
    expect(rows.map((r) => [r.x, r.y])).toEqual([[1, 10], [2, 20]]);
  });

  it("resolves accessor-function channels", () => {
    const data = [{ t: 1, v: 10 }, { t: 2, v: 20 }];
    const rows = materializeGlyphChartMarkRows(glyphChartLine(data, { x: (d) => (d as { t: number }).t * 10, y: "v" }));
    expect(rows.map((r) => r.x)).toEqual([10, 20]);
  });

  it("resolves a literal parallel array channel", () => {
    const data = [{ v: 10 }, { v: 20 }];
    const rows = materializeGlyphChartMarkRows(glyphChartLine(data, { x: ["a", "b"], y: "v" }));
    expect(rows.map((r) => r.x)).toEqual(["a", "b"]);
  });

  it("keeps the missing numeric shorthand axis when only one channel is overridden", () => {
    const rows = materializeGlyphChartMarkRows(glyphChartLine([3, 5], { x: [10, 20] }));
    // Mutation: disable both shorthand defaults when only x is explicit -> y disappears.
    expect(rows.map((r) => [r.x, r.y])).toEqual([[10, 3], [20, 5]]);
  });
});
