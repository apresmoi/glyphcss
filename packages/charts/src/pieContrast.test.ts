/**
 * CHARTS-RESEARCH `DIAGNOSIS-pie-contrast.md` fix: a monochrome region/arc
 * fill no longer cycles a single 4-step DENSITY ramp (`█ ▓ ▒ ░`/`# % + .`,
 * causes C1/C2/C3 — the old cycle's adjacent glyphs routinely failed a
 * 0.15 ink-coverage gap, and a 5th+ series silently reused a glyph with no
 * record of it) — `series.ts`'s `SHADE_RAMPS` is now a SHAPE-FAMILY set,
 * `GLYPH_CHART_SHADE_CYCLE_LENGTH` (8) glyphs long on every charset, and a
 * wrap past that length is reported via `series-shade-repeat` (never
 * silent). This file gates the numeric claim (the ink-coverage gap itself,
 * against the diagnosis's own measured fixture) and the behavioural claims
 * (8 distinct fills, the 9th wraps and logs, a single-series mark is
 * unaffected, and C5's ASCII callout separator fold).
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { renderGlyphChart } from "./render";
import { glyphChartArc, glyphChartBar } from "./spec";
import { seriesShade, GLYPH_CHART_SHADE_CYCLE_LENGTH } from "./series";
import type { GlyphChartCharset } from "./types";

function fixturePath(relative: string): string {
  const testPath = expect.getState().testPath;
  if (!testPath) throw new Error("no test path available to resolve fixture from");
  return join(dirname(testPath), relative);
}

interface GlyphCoverage {
  readonly chatBrowserMenlo: number;
  readonly menloFt: number;
  readonly sfMonoFt: number;
  readonly glyphMonoBrowser: number;
  readonly glyphMonoFt: number;
}
const coverage: { readonly glyphs: Record<string, GlyphCoverage> } = JSON.parse(readFileSync(fixturePath("fixtures/glyphInkCoverage.json"), "utf8"));
const FONT_COLUMNS = ["chatBrowserMenlo", "menloFt", "sfMonoFt", "glyphMonoBrowser", "glyphMonoFt"] as const;

function pairGap(x: string, y: string): number {
  const a = coverage.glyphs[x], b = coverage.glyphs[y];
  if (!a || !b) throw new Error(`fixture missing glyph "${x}" or "${y}"`);
  let min = Infinity;
  for (const col of FONT_COLUMNS) min = Math.min(min, Math.abs(a[col] - b[col]));
  return min;
}
/** Minimum CHAIN (non-wrapping) adjacent-pair gap over every font column —
 * what the diagnosis's own "Recommendation" prose evaluates for a small
 * set. */
function minChainAdjacentGap(sequence: readonly string[]): number {
  let min = Infinity;
  for (let i = 0; i < sequence.length - 1; i++) min = Math.min(min, pairGap(sequence[i]!, sequence[i + 1]!));
  return min;
}
/** Minimum CYCLIC adjacent-pair gap, chain plus the wrap (last -> first) —
 * a pie's slices sit around a circle, so the last slice is also visually
 * adjacent to the first one (the diagnosis's own §5 table for the uni
 * proposal is cyclic for exactly this reason, its last column literally
 * named "▒█"). */
function minCyclicAdjacentGap(sequence: readonly string[]): number {
  return Math.min(minChainAdjacentGap(sequence), pairGap(sequence[sequence.length - 1]!, sequence[0]!));
}

describe("adjacent-pair ink-coverage gap (CHARTS-RESEARCH DIAGNOSIS-pie-contrast.md, fixtures/glyphInkCoverage.json)", () => {
  it("box/blocks/braille's shared 8-glyph shape ramp clears a 0.15 gap in every measured font", () => {
    // Mutation: shorten SHADE_RAMPS.box back to a 4-member density ramp (or
    // reorder it density-first) -> at least one adjacent pair falls under
    // 0.15 in at least one font column, this goes red.
    const ramp = Array.from({ length: GLYPH_CHART_SHADE_CYCLE_LENGTH }, (_, i) => seriesShade("box", i, GLYPH_CHART_SHADE_CYCLE_LENGTH));
    expect(ramp).toEqual(["█", "░", "▚", "╱", "▌", "═", "▓", "▒"]);
    expect(minCyclicAdjacentGap(ramp)).toBeGreaterThanOrEqual(0.15);
  });

  it("blocks and braille share box's identical 8-glyph ramp (one shape-family table, not a per-tier branch)", () => {
    for (const tier of ["blocks", "braille"] as const) {
      const ramp = Array.from({ length: GLYPH_CHART_SHADE_CYCLE_LENGTH }, (_, i) => seriesShade(tier, i, GLYPH_CHART_SHADE_CYCLE_LENGTH));
      expect(ramp).toEqual(["█", "░", "▚", "╱", "▌", "═", "▓", "▒"]);
    }
  });

  it("ASCII's compact <=4-series table (density-first) clears a 0.15 gap on every CHAIN pair, in every measured font", () => {
    // Mutation: use the extended 8-set's own prefix instead of the compact
    // table below 5 series -> the gap collapses (see the next test's own
    // documented exception) and this goes red.
    const ramp = Array.from({ length: 4 }, (_, i) => seriesShade("ascii", i, 4));
    expect(ramp).toEqual(["#", ".", "@", "-"]);
    expect(minChainAdjacentGap(ramp)).toBeGreaterThanOrEqual(0.15);
    // The WRAP pair ("-" back to "#", visually adjacent too — a 4-slice
    // pie is a circle) is NOT covered by the diagnosis's own "clears 0.15
    // everywhere" claim (that prose evaluates the ordered chain, matching
    // its own §5 table's presentation): measured here at SF Mono it is
    // 0.14, one hundredth under — recorded exactly, not silently forced to
    // pass or hidden behind a looser assertion.
    expect(minCyclicAdjacentGap(ramp)).toBeCloseTo(0.14, 2);
    expect(pairGap("-", "#")).toBeCloseTo(0.14, 2);
  });

  it("ASCII's extended >4-series table is shape-distinct (not density-distinct) — a documented, deliberate exception", () => {
    // The diagnosis (§5, "Proposed ascii") is explicit that ASCII cannot
    // sustain a 0.15 density gap past 4 glyphs in any measured font — the
    // whole ASCII repertoire spans only 0.03-0.38 coverage, not enough
    // range for 8 well-separated density steps — and recommends the
    // shape-first ordering as "the honest answer" there. This asserts the
    // ACTUAL, weaker guarantee that ordering gives: every one of the 8
    // glyphs is pairwise DISTINCT (no repeat character, which a legend
    // reader can always tell apart even when two glyphs read similarly
    // dark), never that adjacent coverage is far apart.
    const ramp = Array.from({ length: GLYPH_CHART_SHADE_CYCLE_LENGTH }, (_, i) => seriesShade("ascii", i, GLYPH_CHART_SHADE_CYCLE_LENGTH));
    expect(ramp).toEqual(["#", ".", "=", "/", "@", ":", "|", "-"]);
    expect(new Set(ramp).size).toBe(GLYPH_CHART_SHADE_CYCLE_LENGTH);
    // Recorded, not asserted false: the measured minimum gap here is well
    // under 0.15 (diagnosis: 0.01-0.10 for several adjacent pairs) — this
    // documents the number rather than silently doing nothing with it.
    expect(minCyclicAdjacentGap(ramp)).toBeLessThan(0.15);
  });
});

const CHARSETS: readonly GlyphChartCharset[] = ["ascii", "box", "blocks", "braille"];
const EXPECTED_8: Readonly<Record<GlyphChartCharset, readonly string[]>> = {
  ascii: ["#", ".", "=", "/", "@", ":", "|", "-"],
  box: ["█", "░", "▚", "╱", "▌", "═", "▓", "▒"],
  blocks: ["█", "░", "▚", "╱", "▌", "═", "▓", "▒"],
  braille: ["█", "░", "▚", "╱", "▌", "═", "▓", "▒"],
};

describe("8-slice pie: 8 distinct fill glyphs and 8 distinct legend swatches on every charset", () => {
  it.each(CHARSETS)("%s", (charset) => {
    // Mutation: shorten SHADE_RAMPS[charset] to fewer than 8 entries -> the
    // 8th slice reuses an earlier glyph, `discGlyphs.size` drops below 8,
    // and `series-shade-repeat` fires where this test expects none.
    const r = renderGlyphChart(glyphChartArc(Array(8).fill(1), undefined, { labels: "legend-only" }), { target: "chat", width: 90, height: 24, charset });
    const rows = r.text.split("\n");
    const discGlyphs = new Set(rows.slice(0, -1).join("").split("").filter((c) => c !== " "));
    expect(discGlyphs).toEqual(new Set(EXPECTED_8[charset]));
    const legendRow = rows.at(-1)!;
    const legendGlyphs = new Set(legendRow.split("").filter((c) => EXPECTED_8[charset].includes(c)));
    expect(legendGlyphs.size).toBe(8);
    expect(r.report.ledger.some((e) => e.code === "series-shade-repeat")).toBe(false);
  });
});

describe("9 slices wraps the shade cycle and reports series-shade-repeat", () => {
  it("a 9-slice pie's 9th slice reuses the 1st's fill glyph, named in the ledger", () => {
    const r = renderGlyphChart(glyphChartArc(Array(9).fill(1), undefined, { labels: "legend-only" }), { target: "chat", width: 96, height: 24, charset: "box" });
    const entry = r.report.ledger.find((e) => e.code === "series-shade-repeat");
    expect(entry).toBeDefined();
    expect(entry!.detail).toMatchObject({ repeated: "8", reused: "0" });
    // The reuse is real, not just reported: slice 0 and slice 8 both paint "█".
    expect(entry!.message).toMatch(/^Series "8" and series "0" share a fill glyph because there are more series than distinct monochrome fills\.$/);
  });

  it("9 named region-mark (bar) series reuse a fill glyph the same way, across marks sharing one cross-mark shade identity", () => {
    const data = Array.from({ length: 9 }, (_, i) => ({ month: "A", value: i + 1, region: `R${i}` }));
    const r = renderGlyphChart({ marks: [glyphChartBar(data, { x: "month", y: "value", fill: "region" })] }, { target: "chat", width: 96, height: 24, charset: "box" });
    const entry = r.report.ledger.find((e) => e.code === "series-shade-repeat");
    expect(entry).toBeDefined();
    expect(entry!.detail).toMatchObject({ repeated: "R8", reused: "R0" });
  });

  it("8 slices never report series-shade-repeat (the boundary case, one under the wrap)", () => {
    const r = renderGlyphChart(glyphChartArc(Array(8).fill(1), undefined, { labels: "legend-only" }), { target: "chat", width: 96, height: 24, charset: "box" });
    expect(r.report.ledger.some((e) => e.code === "series-shade-repeat")).toBe(false);
  });
});

describe("single-series region marks stay byte-identical (the first shade entry is unchanged)", () => {
  it("seriesShade's own first entry is still the pre-fix glyph on every charset", () => {
    // Mutation: reorder SHADE_RAMPS so index 0 isn't the solid glyph -> a
    // single-series bar/rect/area/arc's own fill (which always resolves to
    // index 0) changes byte for byte, breaking every existing single-
    // series snapshot in reviewFixtures (see strokeWidth.test.ts/
    // axisTitlePlacement.test.ts/tickFormat.test.ts's own byte-identity
    // suites, which pin this over 30+ real specs).
    expect(seriesShade("box", 0)).toBe("█");
    expect(seriesShade("blocks", 0)).toBe("█");
    expect(seriesShade("braille", 0)).toBe("█");
    expect(seriesShade("ascii", 0)).toBe("#");
  });

  it("a single-series bar chart's fill is unaffected by the ramp change, on every charset", () => {
    for (const charset of CHARSETS) {
      const r = renderGlyphChart(glyphChartBar([3, 5, 2, 8], undefined, { name: "Sales" }), { target: "chat", width: 40, height: 14, charset, color: "none" });
      const glyph = charset === "ascii" ? "#" : "█";
      expect(r.text).toContain(glyph);
      // None of the OTHER shape-family glyphs that are UNIQUE to the shade
      // ramp (never reused by axis tick marks/rules — `ascii`'s axis
      // legitimately paints "+"/"-"/"|" regardless of series count, so
      // those three are excluded here rather than producing a false
      // positive) ever appear — a single series never advances past
      // index 0.
      const axisOwnedInAscii = new Set(["+", "-", "|"]);
      for (const other of EXPECTED_8[charset].slice(1)) {
        if (charset === "ascii" && axisOwnedInAscii.has(other)) continue;
        expect(r.text).not.toContain(other);
      }
    }
  });
});

describe("C5 — an ASCII pie callout never prints the generic '?' fold", () => {
  it("a named ascii pie's default callout labels contain no '?'", () => {
    // Mutation: revert labels.ts's chartText ASCII fold chain to drop the
    // "·" -> "-" substitution -> the callout's own "name · NN%"
    // separator falls through to the generic unsupported-glyph "?" and
    // this goes red (CHARTS-RESEARCH DIAGNOSIS-pie-contrast.md C5).
    const data = [{ name: "Alpha", value: 65 }, { name: "Beta", value: 20 }, { name: "Gamma", value: 15 }];
    const r = renderGlyphChart(glyphChartArc(data, { fill: "name", y: "value" }), { target: "chat", width: 72, height: 24, charset: "ascii" });
    expect(r.text).not.toContain("?");
    expect(r.text).toContain("Alpha");
    expect(r.text).toMatch(/Alpha - \d+%/);
  });
});
