/**
 * `options.textScale` (AGENTS.md's "Charts" "Density" paragraph) — the
 * web-only affordance that keeps chart TEXT (title, axis titles, tick
 * labels, legend names + swatches) at a readable size under a dense
 * render: every label is laid out and painted as if each glyph occupied
 * `s x s` cells instead of one, via `glyphcss`'s `canvas.text({ scale })`.
 * Default `1`, byte-identical to the chart before this option existed.
 * Arc callout labels, a corner-placed legend, and sankey/funnel node/
 * stage labels are NOT threaded through this — a documented scope cut
 * (AGENTS.md's own "Density" paragraph), not a silent gap.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { createGlyphCanvas } from "glyphcss";
import { layoutGlyphChart } from "./layout";
import { paintGlyphChart } from "./paint";
import { renderGlyphChart } from "./render";
import { resolveGlyphChartSpec } from "./resolve";
import { resolveGlyphChartScales } from "./scales";
import { glyphChartBar, glyphChartLine, normalizeGlyphChartInput } from "./spec";
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
