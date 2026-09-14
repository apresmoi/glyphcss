/**
 * `options.textScale` (AGENTS.md's "Charts" "Density" paragraph) — the
 * web-only affordance that keeps chart TEXT (title, axis titles, tick
 * labels, legend names + swatches, arc callout labels, a corner-placed
 * legend) at a readable size under a dense render: every label is laid out
 * and painted as if each glyph occupied `s x s` cells instead of one, via
 * `glyphcss`'s `canvas.text({ scale })`. Default `1`, byte-identical to the
 * chart before this option existed. Sankey/funnel node/stage labels are the
 * one remaining documented scope cut (`flowMarks.ts` owns those).
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { createGlyphCanvas } from "glyphcss";
import { layoutGlyphChart, resolveGlyphChartLegendOption } from "./layout";
import { abbreviateChartText } from "./labels";
import { GLYPH_CHART_ARC_CALLOUT_GUTTER_COLS, GLYPH_CHART_ARC_FILL, paintGlyphChart } from "./paint";
import { renderGlyphChart } from "./render";
import { resolveGlyphChartSpec } from "./resolve";
import { resolveGlyphChartScales } from "./scales";
import { glyphChartArc, glyphChartBar, glyphChartLine, normalizeGlyphChartInput } from "./spec";
import { goodSpecs } from "./reviewFixtures";
import type { GlyphChartCharset, GlyphChartInput, GlyphChartLedgerEntry } from "./types";

function fixturePath(relative: string): string {
  const testPath = expect.getState().testPath;
  if (!testPath) throw new Error("no test path available to resolve fixture from");
  return join(dirname(testPath), relative);
}

/** Mirrors `strokeWidth.test.ts`'s own internal layout/paint harness for exact grid inspection. */
function picture(input: GlyphChartInput, width: number, height: number, textScale = 1, colorEnabled = false, charset: GlyphChartCharset = "box") {
  const spec = normalizeGlyphChartInput(input);
  const marks = resolveGlyphChartSpec(spec);
  const scales = resolveGlyphChartScales(marks, spec.scales);
  const ledger: GlyphChartLedgerEntry[] = [];
  const layout = layoutGlyphChart(spec, marks, scales, width, height, "auto", ledger, charset, undefined, textScale);
  const canvas = createGlyphCanvas({ cols: width, rows: height, tier: charset });
  paintGlyphChart(canvas, spec, marks, scales, layout, { colorEnabled, textScale }, ledger);
  return { canvas, layout, ledger };
}

// ── (1) byte-identity at textScale: 1 / absent, against a real build of
// the parent commit (926ab7b0, before textScale existed) ─────────────────

const parentFixtures: Record<string, string> = JSON.parse(
  readFileSync(fixturePath("fixtures/textScaleParentFixtures.json"), "utf8"),
);

describe("textScale absent (and explicit 1): byte-identical to the parent build (926ab7b0, before textScale existed)", () => {
  it("every reviewFixtures goodSpecs entry, every charset, matches the pre-textScale build byte for byte, with no option set", () => {
    // Mutation: touch any textScale-absent default path in layout.ts/
    // paint.ts/labels.ts/canvas.ts (e.g. always run the >1 branch's extra
    // bookkeeping) -> at least one of these 140 renders stops matching the
    // real dist built from the commit before textScale existed.
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

  it("explicit textScale: 1 matches the same fixtures (the option is inert, not merely defaulted)", () => {
    const charsets: GlyphChartCharset[] = ["ascii", "box", "blocks", "braille"];
    for (let i = 0; i < goodSpecs.length; i++) {
      for (const charset of charsets) {
        const key = `${i}:${charset}`;
        const r = renderGlyphChart(goodSpecs[i]!, { width: 60, height: 24, charset, color: "none", textScale: 1 });
        expect(r.text, key).toBe(parentFixtures[key]);
      }
    }
  });
});

// ── (2) validation ─────────────────────────────────────────────────────

describe("textScale validation", () => {
  it("rejects a non-integer or sub-1 textScale with bad-text-scale", () => {
    expect(() => renderGlyphChart(glyphChartLine([1, 2]), { textScale: 1.5 })).toThrow(
      expect.objectContaining({ code: "bad-text-scale" }),
    );
    expect(() => renderGlyphChart(glyphChartLine([1, 2]), { textScale: 0 })).toThrow(
      expect.objectContaining({ code: "bad-text-scale" }),
    );
    expect(() => renderGlyphChart(glyphChartLine([1, 2]), { textScale: -1 })).toThrow(
      expect.objectContaining({ code: "bad-text-scale" }),
    );
  });

  it("accepts textScale: 2 and renders", () => {
    const r = renderGlyphChart(glyphChartLine([1, 2, 3]), { textScale: 2, target: "web" });
    expect(r.meta.values).toBeGreaterThan(0);
  });
});

// ── (3) at textScale: 2, title/tick/legend text cells reserve 2x2 boxes —
// no mark ink inside them, asserted on the canvas grid ────────────────────

describe("textScale 2: reserved boxes protect chart chrome from mark ink", () => {
  it("a bar's fill never paints into the title's own reserved 2x2 boxes (mutation: drop the textFiller guard -> red)", () => {
    const spec = { title: "Revenue", marks: [glyphChartBar([5, 8, 3, 9, 6])] };
    const { canvas, layout } = picture(spec, 40, 20, 2);
    expect(layout.titleRow).not.toBeNull();
    expect(layout.titleText).toBe("Revenue");
    // Every cell painted by canvas.text({scale:2}) for the title marks a
    // 2x2 box; the FILLER half of that box (three of every four cells) must
    // be untouched by any bar the paint pipeline drew afterward — verified
    // directly via the canvas's own textFiller flag rather than guessing
    // which columns the title occupies.
    let fillerCells = 0;
    for (let i = 0; i < canvas.textFiller.length; i++) {
      if (canvas.textFiller[i] === 1) {
        fillerCells++;
        // A filler cell is always blanked by canvas.text itself — nothing
        // painted afterward (bars run before labels in the fixed pipeline,
        // so this is the property under test) can have left ink there.
        expect(canvas.grid.char[i]).toBe(" ");
      }
    }
    expect(fillerCells).toBeGreaterThan(0);
  });

  it("at textScale: 1 no cell is ever marked filler (the guard is genuinely inert at the default)", () => {
    const spec = { title: "Revenue", marks: [glyphChartBar([5, 8, 3, 9, 6])] };
    const { canvas } = picture(spec, 40, 20, 1);
    expect([...canvas.textFiller].every((v) => v === 0)).toBe(true);
  });

  it("x/y tick labels and the legend also reserve 2x2 boxes with real origin glyphs (not just the title)", () => {
    const spec = { marks: [glyphChartLine([1, 5, 2, 8, 4], undefined, { name: "Revenue" })] };
    const { canvas, layout } = picture(spec, 50, 24, 2);
    expect(layout.xTicks.length).toBeGreaterThan(0);
    expect(layout.yTicks.length).toBeGreaterThan(0);
    expect(layout.legend).not.toBeNull();
    // Every x/y tick's own labelStart/cell origin must carry textScale===2
    // — i.e. it actually went through the scaled path, not a scale-1
    // fallback silently dropped somewhere in layout.ts's plumbing.
    for (const t of layout.xTicks) {
      // x ticks paint at (labelStart, xAxisLabelRow) — `t.cell` is the
      // tick's own COLUMN on the axis line, a different cell entirely.
      const idx = layout.xAxisLabelRow * canvas.cols + t.labelStart;
      expect(canvas.textScale[idx]).toBe(2);
    }
    for (const t of layout.yTicks) {
      // y ticks paint at (labelStart, cell) — here `cell` IS the row.
      const idx = t.cell * canvas.cols + t.labelStart;
      expect(canvas.textScale[idx]).toBe(2);
    }
  });
});

// ── (4) the HTML exit at textScale: 2 ──────────────────────────────────

describe("textScale 2: HTML exit carries .glyph-text spans, text exit stays plain", () => {
  it("the HTML output has glyph-text spans and no filler-cell blank glyphs; the text exit still prints each label once, in its origin cell", () => {
    const spec = { title: "Hello", marks: [glyphChartLine([1, 2, 3])] };
    const r = renderGlyphChart(spec, { target: "web", textScale: 2, color: "css", width: 40, height: 16 });
    expect(r.html).toContain("glyph-text");
    expect(r.html).toContain("font-size:2em");
    // The plain text exit ignores textScale entirely (AGENTS.md's own
    // contract: "they emit the glyph in its origin cell and blanks in the
    // covered cells") — each glyph lands on its scale-2 PITCH with one
    // blank filler column between consecutive letters ("H e l l o", not
    // "Hello"), and that gapped form appears on exactly ONE row, never
    // duplicated across the 2 rows the title's box reserves.
    const gapped = "Hello".split("").join(" ");
    const rows = r.text.split("\n");
    const titleRows = rows.filter((row) => row.includes(gapped));
    expect(titleRows).toHaveLength(1);
    // And the covered SECOND row of the title's own box has no leftover
    // "Hello" ink at all — real blanks, per the same contract.
    expect(rows.some((row) => row.includes("Hello"))).toBe(false);
  });
});

// ── (5) mounted-page-shaped check: density N -> textScale round(N),
// rendered at a half-size grid, spans at Nem — see chartsWorkbenchRender.ts
// for the actual page wiring; this pins the LIBRARY side of that contract. ──

describe("textScale composes with a denser render grid (the page's own density contract)", () => {
  it("rendering at density 2 (double cols/rows) with textScale: 2 still reserves readable-sized chrome, not 1-cell-tall chrome on a doubled grid", () => {
    const spec = { title: "Dense", marks: [glyphChartLine([1, 4, 2, 6, 3])] };
    const base = renderGlyphChart(spec, { target: "web", width: 96, height: 32, textScale: 1 });
    const dense = renderGlyphChart(spec, { target: "web", width: 192, height: 64, textScale: 2 });
    expect(dense.html).toContain("font-size:2em");
    expect(base.html).not.toContain("glyph-text");
  });
});

// ── (6) mutation: dropping the reservation lets a bar paint into a label
// box ──────────────────────────────────────────────────────────────────

describe("mutation check: the reservation is load-bearing", () => {
  it("without scale (i.e. painting the title at scale 1 on a scale-2 layout) a bar CAN reach into what should have been the title's reserved box — proving the guard, not the layout gap alone, is what protects it", () => {
    // This directly exercises `canvas.text`'s own filler mechanism in
    // isolation: a scale-2 title reserves a box, and a fillRect painted
    // AFTER it (out of the real pipeline's own fills-before-labels order)
    // is refused inside that box — if the `textFiller` guard were removed
    // from `fillRect`, this cell would flip to the fill's own glyph.
    const canvas = createGlyphCanvas({ cols: 10, rows: 4, tier: "box" });
    canvas.text(0, 0, ["A"], { scale: 2 });
    const beforeFillerChar = canvas.grid.char[1]; // (1,0), inside the box
    canvas.fillRect(0, 0, 9, 3, { fill: "solid" });
    expect(canvas.grid.char[1]).toBe(beforeFillerChar); // still blank — refused
    expect(canvas.grid.char[1]).toBe(" ");
  });
});

// ── (7) arc callouts at scale 2 — `paintArcCallouts`' own reservation ────

/** Mirrors `arcShape.test.ts`'s own `paintAt` — the only way to get a
 * `legend: false` layout AND direct canvas access (`renderGlyphChart`'s own
 * `grid` strips the `textScale`/`textFiller` buffers this file's other
 * sections already read via `picture()`). */
function pictureArcNoLegend(input: GlyphChartInput, width: number, height: number, textScale: number) {
  const spec = normalizeGlyphChartInput(input);
  const marks = resolveGlyphChartSpec(spec);
  const scales = resolveGlyphChartScales(marks, spec.scales);
  const ledger: GlyphChartLedgerEntry[] = [];
  const legendOption = resolveGlyphChartLegendOption(undefined, false);
  const layout = layoutGlyphChart(spec, marks, scales, width, height, "auto", ledger, "box", legendOption, textScale);
  const canvas = createGlyphCanvas({ cols: width, rows: height, tier: "box" });
  paintGlyphChart(canvas, spec, marks, scales, layout, { colorEnabled: false, textScale }, ledger);
  return { canvas, layout, ledger };
}

describe("textScale 2: arc callouts", () => {
  it("a 4-slice pie at 96x32: every callout label is a scaled span, its leader survives intact, and the label box never crosses onto the leader's own side (mutation: drop the left-side box-width offset in paintArcCallouts -> a leader cell goes blank, red)", () => {
    const shares = [
      { name: "A", value: 1 },
      { name: "B", value: 1 },
      { name: "C", value: 1 },
      { name: "D", value: 1 },
    ];
    const scale = 2;
    const width = 96, height = 32;
    const { canvas, ledger } = pictureArcNoLegend(glyphChartArc(shares, { fill: "name", y: "value" }), width, height, scale);

    // No callout dropped at this size — confirms the geometry re-derived
    // below (four well-separated quadrant slices) matches what actually
    // rendered, rather than silently testing a degraded fallback.
    expect(ledger.filter((e) => e.code === "label-dropped")).toEqual([]);

    // Independently re-derive the same geometry `arcRadii`/`paintArcCallouts`
    // compute internally — never importing either, so a mutation to them
    // must still be caught here (`arcShape.test.ts`'s own convention).
    const cellAspect = 0.5; // canvas.ts's own default, unset here
    const plotCols = width, plotRows = height; // legend: false, no title
    const gutter = scale * Math.min(GLYPH_CHART_ARC_CALLOUT_GUTTER_COLS, Math.floor(plotCols / 4));
    const availableCols = plotCols - 2 * gutter;
    const diameter = Math.max(1, Math.min(plotRows, availableCols * cellAspect)) * GLYPH_CHART_ARC_FILL;
    const ry = Math.max(0.5, diameter / 2);
    const rx = ry / cellAspect;
    const cx = (plotCols - 1) / 2, cy = (plotRows - 1) / 2;

    // The same leader-geometry constants `paintArcCallouts` uses internally
    // (private, not exported — mirrored here the way this test file's other
    // sections mirror `canvas.text`'s own scale-box formula).
    const DISC_GAP = 1, DIAG_COLS = 2, STUB_COLS = 2, TEXT_GAP = 1;

    let start = -Math.PI / 2;
    const total = shares.reduce((s, v) => s + v.value, 0);
    const candidates = shares.map((sl) => {
      const angle = (sl.value / total) * Math.PI * 2;
      const s = start;
      start += angle;
      const mid = (s + start) / 2;
      const side: "left" | "right" = Math.cos(mid) >= 0 ? "right" : "left";
      const anchorRow = Math.round(cy + ry * Math.sin(mid));
      return { name: sl.name, side, anchorRow, targetRow: Math.max(0, Math.min(plotRows - 1, anchorRow)) };
    });

    let checked = 0;
    for (const side of ["left", "right"] as const) {
      const group = candidates.filter((c) => c.side === side).sort((a, b) => a.targetRow - b.targetRow);
      const sign = side === "right" ? 1 : -1;
      let lastRow = -scale;
      for (const c of group) {
        const row = Math.max(c.targetRow, lastRow + scale);
        expect(row + scale - 1).toBeLessThanOrEqual(plotRows - 1);
        lastRow = row;

        const outRow = Math.max(0, Math.min(plotRows - 1, c.anchorRow));
        const dyFrac = (outRow - cy) / ry;
        const edgeDx = Math.sqrt(Math.max(0, 1 - dyFrac * dyFrac)) * rx;
        const discEdgeCol = side === "right" ? Math.floor(cx + edgeDx) : Math.ceil(cx - edgeDx);
        const outCol = discEdgeCol + sign * DISC_GAP;
        const elbowX = outCol + sign * DIAG_COLS;
        const stubEndX = elbowX + sign * STUB_COLS;
        // The leader's own last painted cell — `textCol` (the box's near
        // edge, on both sides) sits `TEXT_GAP * scale` past it, "one
        // SCALED cell short of the label box".
        const textCol = stubEndX + sign * TEXT_GAP * scale;

        // The leader's own last painted cell survives. A box that wrongly
        // overlapped it would have been painted AFTER the leader and
        // ERASED it via `canvas.text`'s own filler-blanking.
        expect(canvas.grid.char[row * canvas.cols + stubEndX]).not.toBe(" ");
        expect(canvas.grid.char[outRow * canvas.cols + outCol]).not.toBe(" ");

        // The label's own origin cell carries `textScale === 2` — it went
        // through the scaled path, not a silently-dropped-to-1 fallback.
        // `boxLeftCol` mirrors `paintArcCallouts`' own derivation: the
        // box's NEAR (leader-facing) edge sits exactly at `textCol` on
        // BOTH sides — never `textCol` as the box's own LEFT edge on the
        // left side too, which would grow the box back toward the leader.
        const text = `${c.name} · 25%`; // single ASCII letters — never abbreviated at this width
        const boxWidth = text.length * scale;
        const boxLeftCol = side === "right" ? textCol : textCol - boxWidth + 1;
        expect(canvas.textScale[row * canvas.cols + boxLeftCol]).toBe(scale);
        expect(canvas.grid.char[row * canvas.cols + boxLeftCol]).toBe(c.name);

        // The box never reaches back across the gap onto the leader's own
        // stub column — the mutation this whole test exists to catch.
        if (side === "right") expect(boxLeftCol).toBeGreaterThan(stubEndX);
        else expect(boxLeftCol + boxWidth - 1).toBeLessThan(stubEndX);
        checked++;
      }
    }
    expect(checked).toBe(4);
  });
});

// ── (8) corner legend at scale 2 ─────────────────────────────────────────

/** Resolves `spec.legend` (unlike `picture()` above, which always renders
 * the default bottom placement) so a corner placement actually reaches
 * `paintCornerLegend`. */
function pictureWithLegend(input: GlyphChartInput, width: number, height: number, textScale: number) {
  const spec = normalizeGlyphChartInput(input);
  const marks = resolveGlyphChartSpec(spec);
  const scales = resolveGlyphChartScales(marks, spec.scales);
  const ledger: GlyphChartLedgerEntry[] = [];
  const legendOption = resolveGlyphChartLegendOption(spec.legend, undefined);
  const layout = layoutGlyphChart(spec, marks, scales, width, height, "auto", ledger, "box", legendOption, textScale);
  const canvas = createGlyphCanvas({ cols: width, rows: height, tier: "box" });
  paintGlyphChart(canvas, spec, marks, scales, layout, { colorEnabled: false, textScale }, ledger);
  return { canvas, layout, ledger };
}

describe("textScale 2: corner legend", () => {
  it("entries reserve a textScale-row band each (2 rows apart), the swatch is scaled, and legend-overlaps-marks counts every row of the overlap, not just the entry's own origin row", () => {
    const scale = 2;
    const width = 30, height = 14;
    // Bar (not line) marks: their legend swatch is a GLYPH painted through
    // `canvas.text` (`seriesShade`'s "3-arg form" — AGENTS.md's "Charts"
    // "Series and shading"), so the swatch itself goes through the scaled
    // path too. A line's own swatch is a plain `canvas.line` run with "no
    // textScale analogue" (this file's existing bottom-legend doc), so it
    // wouldn't exercise the property under test here.
    const spec = {
      legend: { placement: "top-left" as const },
      marks: [
        glyphChartBar([8, 2, 9, 3, 8, 2, 9, 3, 8, 2], undefined, { name: "Aaa" }),
        glyphChartBar([1, 7, 2, 8, 1, 7, 2, 8, 1, 7], undefined, { name: "Bbb" }),
      ],
    };
    const withLegend = pictureWithLegend(spec, width, height, scale);
    const withoutLegend = pictureWithLegend({ ...spec, legend: false }, width, height, scale);
    const { layout, canvas, ledger } = withLegend;
    expect(layout.legend).not.toBeNull();
    const items = layout.legend!.items;
    expect(items).toHaveLength(2);
    const { plot } = layout;
    const plotWidth = plot.x1 - plot.x0 + 1;
    const swatchGutterCols = 3 * scale;
    const maxTextWidth = Math.max(1, Math.floor((plotWidth - 2) / scale));

    const rows: number[] = [];
    let expectedCovered = 0;
    let originRowOnlyCovered = 0;
    for (let i = 0; i < items.length; i++) {
      const row = plot.y0 + i * scale;
      rows.push(row);
      // The swatch origin carries textScale === 2.
      expect(canvas.textScale[row * canvas.cols + plot.x0]).toBe(scale);

      const { text } = abbreviateChartText(items[i]!.label, maxTextWidth, "box", false);
      const blockWidth = Math.min(plotWidth, text.length * scale + swatchGutterCols);
      for (let rr = row; rr < row + scale; rr++) {
        for (let c = plot.x0; c <= Math.min(plot.x1, plot.x0 + blockWidth - 1); c++) {
          if (withoutLegend.canvas.grid.char[rr * canvas.cols + c] !== " ") {
            expectedCovered++;
            if (rr === row) originRowOnlyCovered++;
          }
        }
      }
    }
    expect(rows[1]! - rows[0]!).toBe(scale);

    const overlapEntry = ledger.find((e) => e.code === "legend-overlaps-marks");
    if (expectedCovered > 0) {
      expect(overlapEntry).toBeDefined();
      expect((overlapEntry!.detail as { covered: number }).covered).toBe(expectedCovered);
    } else {
      expect(overlapEntry).toBeUndefined();
    }
    // Sanity: this scenario genuinely exercises the multi-row scan the fix
    // adds — some of the covered ink sits on a FILLER row (row+1), not the
    // entry's own origin row. Mutation: revert the scan to `row` only (the
    // pre-fix single-row loop) -> production would report
    // `originRowOnlyCovered`, strictly less than the `expectedCovered`
    // this test asserts against, and the assertion above goes red.
    expect(expectedCovered).toBeGreaterThan(originRowOnlyCovered);
  });
});
