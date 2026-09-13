/**
 * `options.strokeWidth` (AGENTS.md's "Charts"): `1 | 2 | 3` on `line`,
 * `area` (its boundary), `rule` — every mark whose own painter reaches
 * `paint.ts`'s `paintLine`/`paintRule`, both of which forward `width`
 * straight through to `glyphcss`'s `canvas.line()`. Default `1`,
 * byte-identical to the chart before this option existed.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import Ajv2020 from "ajv/dist/2020";
import { createGlyphCanvas, GLYPH_CANVAS_TIERS } from "glyphcss";
import { describe, expect, it } from "vitest";
import { layoutGlyphChart } from "./layout";
import { paintGlyphChart } from "./paint";
import { renderGlyphChart } from "./render";
import { resolveGlyphChartSpec } from "./resolve";
import { resolveGlyphChartScales } from "./scales";
import { glyphChartArea, glyphChartLine, glyphChartRule, normalizeGlyphChartInput } from "./spec";
import { goodSpecs } from "./reviewFixtures";
import { glyphChartJsonSchema } from "./schema";
import { GLYPH_CHART_VALIDATION_RULES, glyphChartRepairHint } from "./validate";
import type { GlyphChartCharset, GlyphChartInput, GlyphChartLedgerEntry, GlyphChartSpec } from "./types";

/** Mirrors `colors.test.ts`'s own `picture()` harness — the internal
 * layout/paint pipeline directly, for exact grid inspection. */
function picture(input: GlyphChartInput, width: number, height: number, colorEnabled = false, charset: GlyphChartCharset = "box") {
  const spec = normalizeGlyphChartInput(input);
  const marks = resolveGlyphChartSpec(spec);
  const scales = resolveGlyphChartScales(marks, spec.scales);
  const ledger: GlyphChartLedgerEntry[] = [];
  const layout = layoutGlyphChart(spec, marks, scales, width, height, "auto", ledger, charset);
  const canvas = createGlyphCanvas({ cols: width, rows: height, tier: charset });
  paintGlyphChart(canvas, spec, marks, scales, layout, { colorEnabled }, ledger);
  return { canvas, layout, ledger };
}

function popcount8(n: number): number {
  let c = 0;
  for (let i = 0; i < 8; i++) if (n & (1 << i)) c++;
  return c;
}

/** Total lit sub-cell dots across the whole canvas (`blocks`/`braille`
 * only — `canvas.sub` is allocated for every tier, but only these two ever
 * set a bit in it). */
function totalDots(canvas: ReturnType<typeof picture>["canvas"]): number {
  let n = 0;
  for (const b of canvas.sub) n += popcount8(b);
  return n;
}

function glyphCount(canvas: ReturnType<typeof picture>["canvas"], glyph: string): number {
  return canvas.grid.char.filter((c) => c === glyph).length;
}

// ── (1) byte-identity when absent ───────────────────────────────────────

function fixturePath(relative: string): string {
  const testPath = expect.getState().testPath;
  if (!testPath) throw new Error("no test path available to resolve fixture from");
  return join(dirname(testPath), relative);
}
// Dumped from a real build of the parent commit (dfebb944, before
// `strokeWidth` existed) in a throwaway worktree — every `reviewFixtures`
// `goodSpecs` entry, at every charset, `renderGlyphChart(spec, { width: 60,
// height: 24, charset, color: "none" })`. No `goodSpecs` entry in this PR
// sets `strokeWidth` (reviewFixtures.ts's own comment on why), so every one
// of these must still match byte for byte.
const parentFixtures: Record<string, string> = JSON.parse(
  readFileSync(fixturePath("fixtures/strokeWidthParentFixtures.json"), "utf8"),
);

describe("strokeWidth absent: byte-identical to the parent build (dfebb944, before strokeWidth existed)", () => {
  it("every reviewFixtures goodSpecs entry, every charset, matches the pre-strokeWidth build byte for byte", () => {
    // Mutation: change any width-absent default path in `canvas.ts`'s
    // `line()` or `paintSubcellLine` (e.g. always compute `fillGlyph`'s
    // effect) -> at least one of these 140 renders stops matching the real
    // dist built from the commit before `strokeWidth` existed.
    const charsets: GlyphChartCharset[] = ["ascii", "box", "blocks", "braille"];
    let compared = 0;
    for (let i = 0; i < goodSpecs.length; i++) {
      for (const charset of charsets) {
        const key = `${i}:${charset}`;
        expect(parentFixtures[key], key).toBeDefined();
        const r = renderGlyphChart(goodSpecs[i]!, { width: 60, height: 24, charset, color: "none" });
        expect(r.text, key).toBe(parentFixtures[key]);
        compared++;
      }
    }
    expect(compared).toBe(goodSpecs.length * charsets.length);
  });
});

// ── (2) ink grows with width, per tier (mutation: dropping the offset
// walk/glyph substitution keeps this flat) ────────────────────────────────

describe("stroke width increases ink along a known line", () => {
  const diagonalLine = (strokeWidth: 1 | 2 | 3) => glyphChartLine([0, 1, 2, 3, 4, 5, 6, 7], undefined, { strokeWidth });
  const straightLine = (strokeWidth: 1 | 2 | 3) => glyphChartLine([5, 5, 5, 5], undefined, { strokeWidth });

  it("ascii/box: width 2 paints the tier's own full-ink fill glyph on the line — absent at width 1", () => {
    for (const charset of ["ascii", "box"] as const) {
      const tier = GLYPH_CANVAS_TIERS[charset];
      const fillGlyph = tier.shadeRamp[tier.shadeRamp.length - 1]!;
      const p1 = picture(diagonalLine(1), 30, 14, false, charset);
      const p2 = picture(diagonalLine(2), 30, 14, false, charset);
      // MUTATION CAUGHT: dropping the `width >= 2` glyph substitution in
      // `canvas.ts`'s `line()` leaves both counts at 0.
      expect(glyphCount(p1.canvas, fillGlyph)).toBe(0);
      expect(glyphCount(p2.canvas, fillGlyph)).toBeGreaterThan(0);
    }
  });

  it("ascii/box: width 3 reuses the tier's own double glyph on a straight (axis-aligned) run", () => {
    for (const charset of ["ascii", "box"] as const) {
      const tier = GLYPH_CANVAS_TIERS[charset];
      const p1 = picture(straightLine(1), 30, 14, false, charset);
      const p3 = picture(straightLine(3), 30, 14, false, charset);
      expect(glyphCount(p1.canvas, tier.double.h)).toBe(0);
      // MUTATION CAUGHT: falling back to the plain fill glyph even when the
      // tier table HAS a dedicated `double` glyph for a straight run would
      // leave this at 0 (the fill glyph would be non-zero instead).
      expect(glyphCount(p3.canvas, tier.double.h)).toBeGreaterThan(0);
    }
  });

  it("blocks/braille: total dot ink strictly grows, width 1 < width 2 < width 3, along the same diagonal", () => {
    for (const charset of ["blocks", "braille"] as const) {
      const d1 = totalDots(picture(diagonalLine(1), 30, 14, false, charset).canvas);
      const d2 = totalDots(picture(diagonalLine(2), 30, 14, false, charset).canvas);
      const d3 = totalDots(picture(diagonalLine(3), 30, 14, false, charset).canvas);
      // MUTATION CAUGHT: dropping `paintSubcellLine`'s width offset walk
      // (`widthOffsetPos`/`widthOffsetNeg`) leaves d1 === d2 === d3.
      expect(d2).toBeGreaterThan(d1);
      expect(d3).toBeGreaterThan(d2);
    }
  });
});

// ── (3) never paints outside the plot rect ────────────────────────────────

/** Leftmost painted (non-space) column contributed by the MARK itself —
 * every row of `p.layout.plot` EXCEPT `xAxisLineRow` (which legitimately
 * carries the axis's own tick-mark glyphs at every column, e.g. a `┴` at
 * `plot.x0` for the origin — furniture, not the mark). Used below to prove
 * `strokeClipPlot`'s inset is genuinely engaged, not merely present in the
 * source. */
function leftmostPaintedCol(p: ReturnType<typeof picture>): number {
  const { plot, xAxisLineRow } = p.layout;
  let min = Infinity;
  for (let y = plot.y0; y <= plot.y1; y++) {
    if (y === xAxisLineRow) continue;
    for (let x = plot.x0; x <= plot.x1; x++) {
      if (p.canvas.grid.char[y * p.canvas.cols + x] !== " ") { min = Math.min(min, x); break; }
    }
  }
  return min;
}

describe("a width-3 line never paints outside the plot rect", () => {
  it("blocks/braille: a line running nearly the full height, one column off the plot's own left edge, is pulled a further cell inward at width 3", () => {
    // A near-VERTICAL segment (x drifts by exactly one plot column over the
    // full height, starting at the domain minimum so it reaches `plot.x0`)
    // is the width offset's own worst case on this side: `moreHorizontal`
    // is false for a near-vertical segment, so the perpendicular offset is
    // in X — straight toward the axis gutter immediately to the LEFT of
    // `plot.x0`. (A PERFECTLY vertical line at `plot.x0`, dx exactly 0, is
    // parallel to `strokeClipPlot`'s own inset edge and gets clipped away
    // entirely rather than merely shifted — a real, if blunter, way of
    // never spilling, but not what this test is measuring.)
    for (const charset of ["blocks", "braille"] as const) {
      const atWidth = (strokeWidth: 1 | 2 | 3): GlyphChartSpec => ({
        marks: [glyphChartLine([{ x: 1, y: 0 }, { x: 0, y: 9 }], { x: "x", y: "y" }, { strokeWidth })],
        scales: { x: { domain: [0, 9] }, y: { domain: [0, 9] } },
      });
      const p1 = picture(atWidth(1), 40, 20, false, charset);
      const p3 = picture(atWidth(3), 40, 20, false, charset);
      const { plot } = p1.layout;
      // MUTATION CAUGHT: `strokeClipPlot` returning `plot` unchanged for
      // width > 1 leaves `leftmostPaintedCol(p3) === leftmostPaintedCol(p1)`
      // (both `plot.x0`) — this line, and only this assertion, catches
      // that.
      expect(leftmostPaintedCol(p1)).toBe(plot.x0);
      expect(leftmostPaintedCol(p3)).toBeGreaterThan(leftmostPaintedCol(p1));
    }
  });

  it("ascii/box: width never changes the footprint at all (glyph substitution only), so nothing new can spill", () => {
    for (const charset of ["ascii", "box"] as const) {
      const painted = (strokeWidth: 1 | 2 | 3) => {
        const p = picture(glyphChartLine([{ x: 0, y: 0 }, { x: 9, y: 9 }], { x: "x", y: "y" }, { strokeWidth }), 40, 20, false, charset);
        return p.canvas.grid.char.map((c) => (c === " " ? 0 : 1));
      };
      expect(painted(3)).toEqual(painted(1));
    }
  });
});

// ── (4) area's boundary and rule both read strokeWidth too ────────────────

describe("area boundary and rule marks read options.strokeWidth", () => {
  it("area: the boundary line (named series, colour off) adds more of the tier's fill glyph at width 2 than width 1", () => {
    // The area's own REGION fill already paints the box tier's first-series
    // shade glyph, which for series 0 happens to BE the same full-ink "█"
    // the width>=2 substitution reaches for (`seriesShade`'s own `█ ▓ ▒ ░`
    // cycle) — so this compares COUNTS, width 2 strictly more than width 1
    // (the boundary's own added ink), rather than width 1 being exactly
    // zero, which the region fill alone already contradicts.
    const tier = GLYPH_CANVAS_TIERS.box;
    const fillGlyph = tier.shadeRamp[tier.shadeRamp.length - 1]!;
    const p1 = picture(glyphChartArea([0, 1, 2, 3, 4], undefined, { name: "Area", strokeWidth: 1 }), 30, 14, false, "box");
    const p2 = picture(glyphChartArea([0, 1, 2, 3, 4], undefined, { name: "Area", strokeWidth: 2 }), 30, 14, false, "box");
    // MUTATION CAUGHT: the area boundary call site in `paint.ts` dropping
    // `width` leaves these counts equal.
    expect(glyphCount(p2.canvas, fillGlyph)).toBeGreaterThan(glyphCount(p1.canvas, fillGlyph));
  });

  it("rule: a horizontal reference line substitutes the tier's fill glyph at width 2", () => {
    const tier = GLYPH_CANVAS_TIERS.box;
    const fillGlyph = tier.shadeRamp[tier.shadeRamp.length - 1]!;
    const p1 = picture(glyphChartRule([2], { axis: "y", strokeWidth: 1 }), 30, 14, false, "box");
    const p2 = picture(glyphChartRule([2], { axis: "y", strokeWidth: 2 }), 30, 14, false, "box");
    expect(glyphCount(p1.canvas, fillGlyph)).toBe(0);
    expect(glyphCount(p2.canvas, fillGlyph)).toBeGreaterThan(0);
  });
});

// ── (5) legend swatch reflects the width ──────────────────────────────────

describe("legend swatch reflects strokeWidth", () => {
  it("box tier: width 1 shows the plain rule, width 2 the fill glyph, width 3 the double glyph", () => {
    const tier = GLYPH_CANVAS_TIERS.box;
    const cases: readonly [1 | 2 | 3, string][] = [
      [1, tier.straight.h],
      [2, tier.shadeRamp[tier.shadeRamp.length - 1]!],
      [3, tier.double.h],
    ];
    for (const [strokeWidth, expectGlyph] of cases) {
      const mark = glyphChartLine([1, 2, 3], undefined, { name: "Series", strokeWidth });
      const p = picture(mark, 30, 12, false, "box");
      const row = p.layout.legend!.row!;
      let found = false;
      for (let x = 0; x < p.canvas.cols; x++) if (p.canvas.grid.char[row * p.canvas.cols + x] === expectGlyph) found = true;
      // MUTATION CAUGHT: the legend swatch's own `canvas.line()` call
      // dropping `width` (`paint.ts`'s two swatch call sites) leaves this
      // false for width 2/3.
      expect(found, `strokeWidth ${strokeWidth} legend row should contain ${JSON.stringify(expectGlyph)}`).toBe(true);
    }
  });
});

// ── (6) rejects any other value ───────────────────────────────────────────

describe("bad-stroke-width validation", () => {
  it("rejects at runtime and via the JSON Schema — a value outside 1/2/3", () => {
    const ajv = new Ajv2020({ strict: false, strictNumbers: true });
    const validate = ajv.compile(glyphChartJsonSchema());
    for (const strokeWidth of [0, 4, 1.5, "2"] as const) {
      const badMark: GlyphChartSpec = { marks: [glyphChartLine([1, 2], undefined, { strokeWidth: strokeWidth as never })] };
      expect(() => renderGlyphChart(badMark)).toThrow(expect.objectContaining({ code: "bad-stroke-width" }));
      expect(validate(badMark), JSON.stringify(strokeWidth)).toBe(false);
    }
    expect(GLYPH_CHART_VALIDATION_RULES).toContain("bad-stroke-width");
    expect(glyphChartRepairHint("bad-stroke-width")).toBeTruthy();
  });
});
