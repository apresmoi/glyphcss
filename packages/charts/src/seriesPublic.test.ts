import { describe, expect, it } from "vitest";
import { glyphChartFunnel, glyphChartLine, glyphChartPlot, glyphChartRule } from "./spec";
import { renderGlyphChart } from "./render";
import { glyphChartSeriesPreview } from "./seriesPublic";
import { goodSpecs } from "./reviewFixtures";
import type { GlyphChartSpec } from "./types";

const SAMPLE = [3, 5, 2, 8, 6, 9, 4];

describe("glyphChartSeriesPreview", () => {
  it("matches the real render's colours on the line-rule preset (a cross-mark styleIndex case)", () => {
    const spec = glyphChartPlot({
      marks: [glyphChartLine(SAMPLE, undefined, { name: "Revenue" }), glyphChartRule([5], { name: "Target" })],
      title: "Line + rule",
    });
    const preview = glyphChartSeriesPreview(spec);
    expect(preview).toEqual([
      { name: "Revenue", markIndex: 0, styleIndex: 0, color: "#3b82f6" },
      { name: "Target", markIndex: 1, styleIndex: 1, color: "#f97316" },
    ]);
    // The gate: the swatch colour must be a colour the render actually paints.
    const result = renderGlyphChart(spec, { target: "web", width: 40, height: 12 });
    expect(result.html).toContain(preview[0]!.color);
    expect(result.html).toContain(preview[1]!.color);
  });

  it("a numeric fill channel is ONE series (never a per-row split), matching the library's own meta.series", () => {
    const spec = glyphChartPlot({
      marks: [{ type: "line", data: [{ x: 0, y: 1, fill: 10 }, { x: 1, y: 2, fill: 20 }], channels: { x: "x", y: "y", fill: "fill" } }],
    });
    const preview = glyphChartSeriesPreview(spec);
    expect(preview).toHaveLength(1);
    expect(preview[0]!.markIndex).toBe(0);
  });

  it("an unnamed single-series mark still gets exactly one entry, falling back to a Mark <n> label", () => {
    const preview = glyphChartSeriesPreview(glyphChartPlot({ marks: [glyphChartLine(SAMPLE)] }));
    expect(preview).toEqual([{ name: "Mark 1", markIndex: 0, styleIndex: 0, color: "#3b82f6" }]);
  });

  it("resolves a mark's own colour override, cycling a short array across its series", () => {
    const spec = glyphChartPlot({
      marks: [{
        type: "line",
        data: [{ month: 0, value: 3, region: "South" }, { month: 0, value: 1, region: "North" }, { month: 0, value: 2, region: "East" }],
        channels: { x: "month", y: "value", fill: "region" },
        options: { color: ["#ff0000", "#00ff00"] },
      }],
    });
    const preview = glyphChartSeriesPreview(spec);
    expect(preview.map((s) => s.color)).toEqual(["#ff0000", "#00ff00", "#ff0000"]); // cycled, matching resolveMarkColorAt
  });

  // NEW-8 (REVIEW-dock-colours-sliders-opus-round2.md): the preview takes
  // the SAME `color` subset a real render does, so `Color: none` returns a
  // `null` colour per series rather than one the render itself won't paint.
  describe("options.color (NEW-8)", () => {
    it("defaults to colour enabled — arity-1 callers (before this option existed) keep their real colours", () => {
      const spec = glyphChartPlot({ marks: [glyphChartLine(SAMPLE, undefined, { name: "Revenue" })] });
      expect(glyphChartSeriesPreview(spec)).toEqual([{ name: "Revenue", markIndex: 0, styleIndex: 0, color: "#3b82f6" }]);
    });
    it("color: \"none\" returns a null colour per series, matching a real render's own color: \"none\" (paints nothing)", () => {
      const spec = glyphChartPlot({ marks: [glyphChartLine(SAMPLE, undefined, { name: "Revenue" }), glyphChartRule([5], { name: "Target" })] });
      const preview = glyphChartSeriesPreview(spec, { color: "none" });
      expect(preview.map((s) => s.color)).toEqual([null, null]);
      // Mutation: `resolveSeriesColor(series, true)` unconditionally would
      // still return a real hex here — the gate is that BOTH the preview
      // and the render agree on nothing painting.
      const result = renderGlyphChart(spec, { target: "web", width: 40, height: 12, color: "none" });
      expect(result.html).toBeUndefined();
    });
  });

  // NEW-7 (REVIEW-dock-colours-sliders-opus-round2.md): a malformed shape
  // gets the SAME tagged, coded rejection every other validation failure
  // does — never a raw, uncoded `TypeError` naming a different entry point
  // (`renderGlyphChart()`, when this call is `glyphChartSeriesPreview`).
  describe("bad input (NEW-7)", () => {
    it.each([null, undefined, {}, 42, "x"])("rejects %p with a tagged bad-chart-input error, not a raw TypeError", (bad) => {
      let caught: (Error & { code?: string }) | undefined;
      try { glyphChartSeriesPreview(bad as never); } catch (e) { caught = e as Error & { code?: string }; }
      expect(caught).toBeInstanceOf(TypeError);
      expect(caught!.code).toBe("bad-chart-input");
      expect(caught!.message).not.toContain("renderGlyphChart()");
    });
    it("a spec-shaped-but-invalid input still throws the library's own tagged validation error", () => {
      expect(() => glyphChartSeriesPreview({ marks: [] })).toThrow(expect.objectContaining({ code: "empty-marks" }));
    });
  });

  // NEW-3 (REVIEW-dock-colours-sliders-opus-round2.md): `chartSeries` groups
  // a funnel by ROW, not name — so `glyphChartSeriesPreview` used to return
  // MORE entries than `meta.series` (which dedupes by name) whenever two
  // stages shared a label, landing on the page as a duplicate React key, an
  // inert swatch, and a swatch showing a colour the chart wasn't drawn in.
  // Disambiguating repeat names ("A", "A (2)", …) inside `chartSeries`
  // itself closes the count mismatch at its root, for every mark type.
  describe("parity with meta.series (NEW-3)", () => {
    it("every preset/fixture spec: within one mark, every series preview entry has a distinct name", () => {
      for (const spec of goodSpecs) {
        const byMark = new Map<number, string[]>();
        for (const entry of glyphChartSeriesPreview(spec)) {
          (byMark.get(entry.markIndex) ?? byMark.set(entry.markIndex, []).get(entry.markIndex)!).push(entry.name);
        }
        for (const [markIndex, names] of byMark) {
          expect(new Set(names).size, `spec ${JSON.stringify(spec)} mark ${markIndex}: ${JSON.stringify(names)}`).toBe(names.length);
        }
      }
    });

    it("a funnel with a repeated stage name ([A, B, A]) disambiguates in BOTH meta.series and the preview, in the same order", () => {
      const spec = glyphChartFunnel([{ stage: "A", count: 100 }, { stage: "B", count: 50 }, { stage: "A", count: 10 }], { stage: "stage", value: "count" });
      const preview = glyphChartSeriesPreview(spec);
      const result = renderGlyphChart(spec, { target: "chat", width: 40, height: 12 });
      expect(preview.map((s) => s.name)).toEqual(["A", "B", "A (2)"]);
      expect(result.meta.series).toEqual(["A", "B", "A (2)"]);
      // Every entry keeps its OWN resolved colour — the disambiguated name
      // stops the two "A" groups' colours from being pooled together by
      // `chartSeries`' cross-mark name-keyed resolution (the exact defect:
      // editing the second stage's swatch used to snap back to the first's).
      expect(new Set(preview.map((s) => s.color)).size).toBe(3);
    });

    it("two DIFFERENT marks legitimately sharing a series name ('B') keep BOTH entries — cross-mark sharing is not the NEW-3 defect", () => {
      const d1 = [{ x: 0, y: 1, s: "A" }, { x: 1, y: 2, s: "A" }, { x: 0, y: 5, s: "B" }, { x: 1, y: 6, s: "B" }];
      const d2 = [{ x: 0, y: 3, s: "B" }, { x: 1, y: 4, s: "B" }, { x: 0, y: 8, s: "C" }, { x: 1, y: 9, s: "C" }];
      const spec: GlyphChartSpec = {
        marks: [
          glyphChartLine(d1, { x: "x", y: "y", stroke: "s" }, { color: ["#111111", "#222222"] }),
          glyphChartLine(d2, { x: "x", y: "y", stroke: "s" }, { color: ["#aa1111", "#aa2222"] }),
        ],
      };
      const preview = glyphChartSeriesPreview(spec);
      const result = renderGlyphChart(spec, { target: "web", width: 40, height: 12 });
      // 4 series total (A, B from mark 0; B, C from mark 1) — never
      // collapsed to `meta.series`' 3 DISTINCT names, because a "B" swatch
      // on the SECOND mark is a real, separately-painted series (its own
      // `markIndex`), not a duplicate identity within one mark.
      expect(preview.map((s) => ({ name: s.name, markIndex: s.markIndex }))).toEqual([
        { name: "A", markIndex: 0 }, { name: "B", markIndex: 0 },
        { name: "B", markIndex: 1 }, { name: "C", markIndex: 1 },
      ]);
      expect(result.meta.series).toEqual(["A", "B", "C"]);
      // Within EACH mark, names are still distinct (the property the
      // funnel case above pins) — "B" appears twice only across marks.
      expect(preview.filter((s) => s.markIndex === 0).map((s) => s.name)).toEqual(["A", "B"]);
      expect(preview.filter((s) => s.markIndex === 1).map((s) => s.name)).toEqual(["B", "C"]);
      // The library's own "first wins" cross-mark pooling: both "B"
      // entries resolve to mark 0's colour.
      const bs = preview.filter((s) => s.name === "B");
      expect(bs[0]!.color).toBe(bs[1]!.color);
      expect(result.html).toContain(bs[0]!.color);
    });
  });
});
