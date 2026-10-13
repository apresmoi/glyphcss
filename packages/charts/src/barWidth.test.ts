/**
 * Bar width cap (`paint.ts`'s `barBandColRange`, reviewFixtures exception
 * 12): a bar series paints at most three cells, centred on its tick, however
 * wide its band or fallback slot is.
 */
import { describe, expect, it } from "vitest";
import { renderGlyphChart } from "./render";
import { glyphChartBar } from "./spec";
import type { GlyphChartMark, GlyphChartRenderOptions } from "./types";

function inkRuns(mark: GlyphChartMark, opts: Partial<GlyphChartRenderOptions> = {}) {
  const width = opts.width ?? 60, height = opts.height ?? 16;
  const r = renderGlyphChart({ marks: [mark] }, { width, height, charset: "box", color: "none", ...opts });
  const { plot } = r.build;
  const at = (x: number, y: number) => r.build.canvas.grid.char[y * width + x]!;
  const axisRow = plot.y1;
  // Bar runs on the row just above the axis line, where every positive bar paints.
  const runs: [number, number][] = [];
  for (let x = plot.x0; x <= plot.x1; x++) {
    if (at(x, axisRow - 1) === " ") continue;
    const last = runs.at(-1);
    if (last && last[1] === x - 1) last[1] = x;
    else runs.push([x, x]);
  }
  const ticks: number[] = [];
  for (let x = plot.x0; x <= plot.x1; x++) if (at(x, axisRow) === "┬") ticks.push(x);
  return { runs, ticks };
}

describe("bar width cap", () => {
  it("a band bar is three cells wide, centred on its tick", () => {
    // Mutation: return the band uncapped from `barBandColRange` -> red.
    const { runs, ticks } = inkRuns(glyphChartBar([{ k: "a", v: 3 }, { k: "b", v: 5 }, { k: "c", v: 4 }], { x: "k", y: "v" }));
    expect(runs.map(([a, b]) => b - a + 1)).toEqual([3, 3, 3]);
    expect(runs.map(([a]) => a + 1)).toEqual(ticks);
  });

  it("dodged series are three cells each, side by side", () => {
    const data = [{ k: "a", v: 3, s: "A" }, { k: "a", v: 5, s: "B" }, { k: "b", v: 4, s: "A" }, { k: "b", v: 2, s: "B" }];
    const { runs } = inkRuns(glyphChartBar(data, { x: "k", y: "v", fill: "s" }));
    expect(runs.map(([a, b]) => b - a + 1)).toEqual([6, 6]);
  });

  it("a bar on a continuous x scale is capped the same way", () => {
    // Mutation: drop the `Math.min` on the fallback width -> red.
    // The first and last x sit on the plot's own edges, which clip half a bar.
    const { runs } = inkRuns(glyphChartBar([3, 5, 4]));
    expect(runs.map(([a, b]) => b - a + 1)).toEqual([2, 3, 2]);
  });

  it("the cap is fixed cell geometry, so textScale multiplies it", () => {
    // Mutation: drop `textScale` from the cap -> red.
    const { runs } = inkRuns(glyphChartBar([{ k: "a", v: 3 }, { k: "b", v: 5 }], { x: "k", y: "v" }), { width: 120, height: 32, textScale: 2 });
    expect(runs.map(([a, b]) => b - a + 1)).toEqual([6, 6]);
  });

  it("a band already narrower than the cap keeps its width", () => {
    const data = Array.from({ length: 24 }, (_, i) => ({ k: `c${i}`, v: 1 + (i % 5) }));
    const { runs } = inkRuns(glyphChartBar(data, { x: "k", y: "v" }), { width: 40 });
    expect(runs.length).toBeGreaterThan(0);
    for (const [a, b] of runs) expect(b - a + 1).toBeLessThanOrEqual(2);
  });
});
