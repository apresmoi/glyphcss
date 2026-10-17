import { describe, expect, it } from "vitest";
import { glyphChartRowSpacing } from "./rowSpacing";

describe("chart row spacing", () => {
  it.each([1, 2, 3])("keeps gaps equal and leaves remainder below content at scale %i", (scale) => {
    const space = glyphChartRowSpacing(4 * scale, 9 * scale, [scale, 2 * scale, 3 * scale], scale);
    expect([0, 1, 2, 3, 4].map((row) => space(row * scale))).toEqual([0, 2, 4, 6, 7].map((row) => row * scale));
    expect(9 * scale - space(4 * scale)).toBe(2 * scale);
  });

  it("caps each gap at two extra rows", () => {
    const space = glyphChartRowSpacing(4, 100, [1, 2, 3], 1);
    expect([0, 1, 2, 3, 4].map(space)).toEqual([0, 3, 6, 9, 10]);
  });

  it.each([undefined, 3, 4, 6])("preserves compact rows when height %s cannot add one row to every gap", (height) => {
    const space = glyphChartRowSpacing(4, height, [1, 2, 3], 1);
    expect([0, 1, 2, 3, 4].map(space)).toEqual([0, 1, 2, 3, 4]);
  });

  it("leaves rows unchanged without gap boundaries", () => {
    const space = glyphChartRowSpacing(4, 100, [], 1);
    expect([0, 1, 2, 3, 4].map(space)).toEqual([0, 1, 2, 3, 4]);
  });
});
