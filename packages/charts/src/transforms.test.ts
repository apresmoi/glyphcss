import { describe, expect, it } from "vitest";
import { applyGlyphChartTransform } from "./transforms";
import { materializeGlyphChartMarkRows } from "./channels";
import { glyphChartBar } from "./spec";
import type { GlyphChartMarkRow } from "./types";

function row(x: unknown, y: unknown, fill?: unknown): GlyphChartMarkRow {
  return { x, y, fill, index: 0 } as GlyphChartMarkRow;
}

describe("applyGlyphChartTransform", () => {
  it.each(["stack", "group"] as const)("round 2: %s matches distinct Date objects at the same instant", (kind) => {
    // Mutation: key on the raw object in applyStack/applyGroup -> y0 stays 0 / two buckets survive.
    const data = [
      { date: new Date("2026-01-01"), val: 10, group: "A" },
      { date: new Date("2026-01-01"), val: 20, group: "B" },
    ];
    expect(data[0]!.date).not.toBe(data[1]!.date);
    const rows = materializeGlyphChartMarkRows(glyphChartBar(data, { x: "date", y: "val", fill: "group" }));
    const out = applyGlyphChartTransform(rows, { kind });
    if (kind === "stack") expect(out.map((r) => [r.y0, r.y1])).toEqual([[0, 10], [10, 30]]);
    else {
      expect(out).toHaveLength(1);
      expect(out[0]).toMatchObject({ x: data[0]!.date, y: 30 });
      // Mutation: emit the timestamp key as x -> subsequent scale inference silently loses its Date type.
      expect(out[0]!.x).toBe(data[0]!.date);
    }
  });
  it("bin: equal-width histogram counts", () => {
    const rows = [0, 1, 2, 8, 9].map((v) => row(v, v));
    const out = applyGlyphChartTransform(rows, { kind: "bin", n: 2 });
    // Mutation: put every sample in bin 0 (total remains 5) -> distribution differs.
    expect(out.map((r) => [r.x, r.y])).toEqual([[2.25, 3], [6.75, 2]]);
    expect(out).toHaveLength(2);
    expect(out.reduce((n, r) => n + (r.y as number), 0)).toBe(5);
  });

  it("stack: cumulative y0/y1 per shared x, in input order", () => {
    const rows = [row("a", 3), row("a", 5), row("b", 1)];
    const out = applyGlyphChartTransform(rows, { kind: "stack" });
    const a = out.filter((r) => r.x === "a");
    expect(a[0]).toMatchObject({ y0: 0, y1: 3 });
    expect(a[1]).toMatchObject({ y0: 3, y1: 8 });
    const b = out.filter((r) => r.x === "b");
    expect(b[0]).toMatchObject({ y0: 0, y1: 1 });
  });

  it("group: sums y per distinct x by default", () => {
    const rows = [row("a", 3), row("a", 5), row("b", 1)];
    const out = applyGlyphChartTransform(rows, { kind: "group" });
    expect(out).toEqual(expect.arrayContaining([
      expect.objectContaining({ x: "a", y: 8 }),
      expect.objectContaining({ x: "b", y: 1 }),
    ]));
  });

  it("group: honours reduce=mean/min/max", () => {
    const rows = [row("a", 3), row("a", 5)];
    expect(applyGlyphChartTransform(rows, { kind: "group", reduce: "mean" })[0]!.y).toBe(4);
    expect(applyGlyphChartTransform(rows, { kind: "group", reduce: "min" })[0]!.y).toBe(3);
    expect(applyGlyphChartTransform(rows, { kind: "group", reduce: "max" })[0]!.y).toBe(5);
  });

  it("normalize: divides by the max |y| within the whole series by default", () => {
    const rows = [row(0, -4), row(1, 2), row(2, 8)];
    const out = applyGlyphChartTransform(rows, { kind: "normalize" });
    expect(out.map((r) => r.y)).toEqual([-0.5, 0.25, 1]);
  });

  it("normalize: an all-zero group divides by 1, not 0 (no NaN)", () => {
    const rows = [row(0, 0), row(1, 0)];
    const out = applyGlyphChartTransform(rows, { kind: "normalize" });
    expect(out.every((r) => r.y === 0)).toBe(true);
  });

  it("window: rolling mean over n consecutive rows", () => {
    const rows = [row(0, 0), row(1, 3), row(2, 6), row(3, 9)];
    const out = applyGlyphChartTransform(rows, { kind: "window", n: 3, reduce: "mean" });
    // window centred at i=1: [0,3,6] -> mean 3.
    // Mutation: return a constant or shift the window -> the full series differs.
    expect(out.map((r) => r.y)).toEqual([3, 3, 6, 7.5]);
  });
});
