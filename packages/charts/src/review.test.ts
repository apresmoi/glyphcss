import { describe, expect, it } from "vitest";
import { createGlyphCanvas } from "glyphcss";
import { renderGlyphChart } from "./render";
import { renderGlyphChartJson } from "./json";
import { glyphChartRepairHint } from "./validate";
import { glyphChartArc, glyphChartArea, glyphChartBar, glyphChartCell, glyphChartDot, glyphChartLine, glyphChartPlot, glyphChartRect, glyphChartText } from "./spec";
import { bandColRange, bandRowRange, layoutGlyphChart, scaleToCol, scaleToRow } from "./layout";
import { resolveGlyphChartSpec } from "./resolve";
import { resolveGlyphChartScales } from "./scales";
import { paintGlyphChart } from "./paint";
import { normalizeGlyphChartInput } from "./spec";
import type { GlyphChartInput, GlyphChartCharset, GlyphChartLedgerEntry, GlyphChartSpec } from "./types";
import { categoricalSeriesData, stackedArea, signedCells, longBands, hourlyLine, categoricalDots, markFactories } from "./reviewFixtures";

function picture(input: GlyphChartInput, width: number, height: number, colorEnabled = false, charset: GlyphChartCharset = "box") {
  const spec = normalizeGlyphChartInput(input), marks = resolveGlyphChartSpec(spec), scales = resolveGlyphChartScales(marks, spec.scales);
  const ledger: GlyphChartLedgerEntry[] = [];
  const layout = layoutGlyphChart(spec, marks, scales, width, height, "auto", ledger, charset);
  const canvas = createGlyphCanvas({ cols: width, rows: height, tier: charset });
  paintGlyphChart(canvas, spec, marks, scales, layout, { colorEnabled }, ledger);
  const at = (col: number, row: number) => canvas.grid.char[row * width + col];
  const atValue = (x: unknown, y: unknown) => at(scaleToCol(scales.x, layout.plot, x), scaleToRow(scales.y, layout.plot, y));
  return { canvas, layout, scales, ledger, at, atValue };
}

describe("exact Phase 1 review regressions", () => {
  it("1: all-zero bars at 20x8 have zero painted quantity cells", () => {
    // Mutation: retain inclusive coincident bar endpoints -> three nonzero bars.
    const r = renderGlyphChart(glyphChartBar([0, 0, 0]), { width: 20, height: 8 });
    expect(r.build.canvas.grid.char.filter((c) => c === "█")).toHaveLength(0);
  });
  it("1: all-zero pie at 20x6 is empty with EMPTY_TOTAL", () => {
    // Mutation: total || 1 plus last-slice fallback -> paints a full disc.
    const r = renderGlyphChart(glyphChartArc([0, 0, 0]), { width: 20, height: 6 });
    expect(r.build.canvas.grid.char.every((c) => c === " ")).toBe(true);
    expect(r.report.ledger).toContainEqual(expect.objectContaining({ code: "empty-total" }));
  });
  it("1: positive and negative bars exclude the zero baseline, which is now the axis line itself", () => {
    // Mutation: include baseline at either end -> a bar's own fill glyph
    // (not the axis tick glyph) shows up at the zero row -> red.
    // CHARTS-RESEARCH diagnosis B1/B6a: a mixed-sign domain's zero row IS
    // the x-axis line row (never a blank row floating between the bars and
    // the axis, the pre-fix behaviour this test used to pin) — so the
    // zero-row cells here read as the axis's own tick glyph, never a bar
    // fill glyph and never blank.
    const p = picture(glyphChartBar([-1, 1]), 20, 8);
    expect(p.atValue(0, 0)).toBe("┴");
    expect(p.atValue(1, 0)).toBe("┴");
    expect(p.atValue(0, -1)).toBe("█");
    expect(p.atValue(1, 1)).toBe("█");
  });
  it("2: log [1,10,100] at 24x8 paints three equally spaced dot rows", () => {
    // Mutation: force log to scaleLinear -> 1 and 10 occupy the same row.
    const r = renderGlyphChart({ marks: [glyphChartDot([1, 10, 100])], scales: { y: { type: "log" } } }, { target: "chat", width: 24, height: 8 });
    const rows = r.text.split("\n").flatMap((s, i) => s.includes("●") ? [i] : []);
    expect(rows).toHaveLength(3);
    expect(Math.abs((rows[1]! - rows[0]!) - (rows[2]! - rows[1]!))).toBeLessThanOrEqual(1);
  });
  it("2: sqrt [0,1,4] paints three equally spaced dot rows", () => {
    // Mutation: force sqrt to linear -> the middle dot sits at a quarter of the height.
    const r = renderGlyphChart({ marks: [glyphChartDot([0, 1, 4])], scales: { y: { type: "sqrt" } } }, { target: "chat", width: 24, height: 12 });
    const rows = r.text.split("\n").flatMap((s, i) => s.includes("●") ? [i] : []);
    expect(rows).toHaveLength(3);
    expect(Math.abs((rows[1]! - rows[0]!) - (rows[2]! - rows[1]!))).toBeLessThanOrEqual(1);
  });
  it.each([glyphChartBar, glyphChartRect])("2: explicit [5,10] rejects and inferred rect/bar includes zero (%#)", (factory) => {
    // Mutation: bypass explicit zero rule or omit rect from inference -> throws wrong/no rule or wrong cell-height ratio.
    expect(() => renderGlyphChart({ marks: [factory([5, 10])], scales: { y: { domain: [5, 10] } } }, { width: 24, height: 8 })).toThrow(expect.objectContaining({ code: "bar-domain-excludes-zero" }));
    const p = picture(factory([5, 10]), 24, 8);
    const heights = [0, 1].map((x) => Array.from({ length: 6 }, (_, y) => p.at(scaleToCol(p.scales.x, p.layout.plot, x), y)).filter((c) => c === "█").length);
    expect(heights[0]).toBeGreaterThan(1);
    expect(Math.abs(heights[0]! * 2 - heights[1]!)).toBeLessThanOrEqual(1);
  });
  it.each([[0, 100], [-1, 1]])("2: log domain %j throws log-domain", (a, b) => {
    // Mutation: feed zero/crossing domain to d3 -> empty geometry without a rule.
    expect(() => renderGlyphChart({ marks: [glyphChartDot([1, 10, 100])], scales: { y: { type: "log", domain: [a, b] } } })).toThrow(expect.objectContaining({ code: "log-domain" }));
  });
  it("2: ISO time domains parse once and paint their endpoints", () => {
    // Mutation: cast JSON strings to Date -> untagged getTime failure; ignore domain -> endpoint moves.
    const p = picture({ marks: [glyphChartDot([{ x: "2026-01-01", y: 1 }, { x: "2026-01-02", y: 2 }], { x: "x", y: "y" })], scales: { x: { type: "time", domain: ["2026-01-01", "2026-01-02"] } } }, 24, 8);
    expect(p.atValue("2026-01-01", 1)).toBe("●");
    expect(p.atValue("2026-01-02", 2)).toBe("●");
  });
  it.each(["fill", "stroke"] as const)("3: %s splits the exact line into A and B without a false diagonal", (channel) => {
    // Mutation: paint all channel rows as one line -> ink appears in the empty middle rows.
    const mark = glyphChartLine(categoricalSeriesData, { x: "x", y: "y", [channel]: "s" });
    const r = renderGlyphChart(mark, { width: 24, height: 10 });
    const p = picture(mark, 24, 10);
    for (const value of [4, 5, 6]) {
      const row = scaleToRow(p.scales.y, p.layout.plot, value);
      expect(r.text.split("\n")[row]!.slice(p.layout.plot.x0).trim()).toBe("");
    }
    expect(r.meta.series).toEqual(["A", "B"]);
    expect(r.text.split("\n").at(-1)).toMatch(/A.+B/);
    const coloured = picture(mark, 24, 10, true);
    // 2 series colours + the axis's own default muted colour
    // (`GLYPH_CHART_AXIS_DEFAULT_COLOR`, AGENTS.md's "Charts" "Colours") —
    // this chart has a cartesian axis, so all three are always on screen.
    expect(new Set(coloured.canvas.grid.color!.filter(Boolean)).size).toBe(3);
  });
  it("3: monochrome line styles cycle and dot series have distinct glyphs", () => {
    // Mutation: ignore styleIndex or dot-series identity -> all four pictures have one style.
    const rows = [1, 3, 5, 7].flatMap((y, i) => [0, 1].map((x) => ({ x, y, s: String(i) })));
    const r = renderGlyphChart(glyphChartLine(rows, { x: "x", y: "y", fill: "s" }), { target: "chat", width: 40, height: 14 });
    expect(r.text).toContain("──"); expect(r.text).toContain("── ──"); expect(r.text).toContain("·"); expect(r.text).toContain("══");
    const dots = picture(glyphChartDot(categoricalSeriesData, { x: "x", y: "y", stroke: "s" }), 24, 10);
    expect(dots.atValue(0, 1)).toBe("●"); expect(dots.atValue(0, 8)).toBe("×");
  });
  it("3: NO_COLOR selects monochrome series styles and FORCE_COLOR restores colours", () => {
    // Mutation: leave colorEnabled true when the encoder suppresses ANSI -> dots lose series identity.
    const mark = glyphChartDot(categoricalSeriesData, { x: "x", y: "y", fill: "s" });
    // The env-driven colour resolution itself is `renderGlyphChart`'s own
    // concern (unaffected by sub-cell dot rendering): NO_COLOR strips ANSI,
    // FORCE_COLOR restores it.
    const plain = renderGlyphChart(mark, { target: "terminal", env: { NO_COLOR: "0" } });
    expect(plain.text).not.toContain("\x1b");
    const forced = renderGlyphChart(mark, { target: "terminal", env: { NO_COLOR: "0", FORCE_COLOR: "0" } });
    expect(forced.text).toContain("\x1b[");

    // Dot visibility under braille (CHARTS-RESEARCH diagnosis B6b): a
    // single sub-cell dot measures ~1.9px in Glyph Mono and reads as a
    // stray fleck, not a data point, so every dot mark now paints a full
    // 2x2 cluster (popcount 4) regardless of series index or colour —
    // colour remains the identity channel for dot series; sub-cell
    // resolution only POSITIONS the mark, it no longer shrinks it to fit.
    // Scanned over the PLOT INTERIOR only (`layout.plot`, via `picture`) —
    // the whole grid also carries the axis lines' own braille dots,
    // unrelated to a data point's own visibility.
    const popcount = (c: string): number => {
      let mask = c.codePointAt(0)! - 0x2800;
      let count = 0;
      while (mask > 0) { count += mask & 1; mask >>>= 1; }
      return count;
    };
    const plotPopcounts = (p: ReturnType<typeof picture>): number[] => {
      const counts: number[] = [];
      for (let y = p.layout.plot.y0; y <= p.layout.plot.y1; y++) {
        for (let x = p.layout.plot.x0; x <= p.layout.plot.x1; x++) {
          const c = p.at(x, y)!;
          const cp = c.codePointAt(0)!;
          if (cp >= 0x2800 && cp <= 0x28ff) counts.push(popcount(c));
        }
      }
      return counts;
    };
    const mono = plotPopcounts(picture(mark, 24, 10, false, "braille"));
    expect(mono.length).toBeGreaterThan(0);
    expect(mono.every((n) => n === 4)).toBe(true);
    const coloured = plotPopcounts(picture(mark, 24, 10, true, "braille"));
    expect(coloured.length).toBeGreaterThan(0);
    expect(coloured.every((n) => n === 4)).toBe(true);
  });
  it("final-gate: a sub-cell dot clips by its actual DESTINATION cell, not a heuristic half-cell margin on the exact coordinate", () => {
    // Mutation: restore the half-cell-margin check on the continuous (col, r)
    // coordinate instead of the dot-lattice-rounded destination cell -> a
    // point at y=-0.5 (half a cell below the plot floor) rounds its dot into
    // row 7 (one past the plot's own last row, 6) and still gets admitted.
    const r = renderGlyphChart({ marks: [glyphChartDot([{ x: 0, y: -0.5 }], { x: "x", y: "y" })], scales: { x: { domain: [0, 1] }, y: { domain: [0, 5] } }, title: "clip" }, { target: "terminal", charset: "braille", width: 20, height: 9 });
    const rows = r.text.split("\n");
    const axisRow = rows.findIndex((row) => row.includes("─"));
    expect(axisRow).toBeGreaterThan(0);
    for (const row of rows.slice(axisRow)) {
      for (const c of row) { const cp = c.codePointAt(0)!; expect(cp > 0x2800 && cp <= 0x28ff).toBe(false); }
    }
  });

  it("final-gate: every dot mark (any series) paints a visible 2x2 cluster, exactly 4 dots, never a shrunk 1-2 dot fleck", () => {
    // Mutation: revert `paintSubcellDot` to light only the primary dot (or a
    // 1-2 dot companion pair) -> popcount drops to 1 or 2, CHARTS-RESEARCH
    // diagnosis B6b's "at least a whole cell of ink" regresses -> red.
    const data = [0, 1, 2, 3].map((i) => ({ x: i, y: i, s: String(i) }));
    const p = picture(glyphChartDot(data, { x: "x", y: "y", fill: "s" }), 24, 10, false, "braille");
    const popcount = (c: string): number => {
      let mask = c.codePointAt(0)! - 0x2800, count = 0;
      while (mask > 0) { count += mask & 1; mask >>>= 1; }
      return count;
    };
    let sawDot = false;
    for (let y = p.layout.plot.y0; y <= p.layout.plot.y1; y++) {
      for (let x = p.layout.plot.x0; x <= p.layout.plot.x1; x++) {
        const c = p.at(x, y)!;
        const cp = c.codePointAt(0)!;
        if (cp > 0x2800 && cp <= 0x28ff) { expect(popcount(c)).toBe(4); sawDot = true; }
      }
    }
    expect(sawDot).toBe(true);
  });

  it("final-gate: the dot legend swatch under braille/blocks paints a sub-cell pattern the plot itself can produce, not the whole-cell ● × + ◆ glyphs", () => {
    // Mutation: keep the legend's dot branch on `seriesDot(canvas.tier, i)`
    // unconditionally (never route braille/blocks through `paintSubcellDot`)
    // -> the legend row reads ● × + ◆ and carries no braille codepoint at all.
    const data = [0, 1, 2, 3].map((i) => ({ x: i, y: i, s: String(i) }));
    const p = picture(glyphChartDot(data, { x: "x", y: "y", fill: "s" }), 30, 12, false, "braille");
    expect(p.layout.legend).not.toBeNull();
    const row = p.layout.legend!.row!;
    const legendChars: string[] = [];
    for (let x = 0; x < 30; x++) legendChars.push(p.at(x, row) ?? " ");
    expect(legendChars.some((c) => "●×+◆".includes(c))).toBe(false);
    expect(legendChars.some((c) => { const cp = c.codePointAt(0)!; return cp > 0x2800 && cp <= 0x28ff; })).toBe(true);
  });

  it("3: area series boundaries retain their monochrome styles", () => {
    // Mutation: leave area styles unused -> both boundaries remain solid fill.
    const r = renderGlyphChart(glyphChartArea(categoricalSeriesData, { x: "x", y: "y", fill: "s" }), { target: "chat", width: 40, height: 14 });
    expect(r.meta.series).toEqual(["A", "B"]);
    expect(r.text).toContain("A"); expect(r.text).toContain("B");
    expect(r.text.split("\n").slice(0, -3).join("\n")).toMatch(/[-_‾▔]/);
  });
  it("3: an area boundary cycles the same line styles as the series legend", () => {
    // Mutation: ignore area styleIndex -> the dashed/dotted/double boundaries become solid.
    const data = [1, 3, 5, 7].flatMap((y, i) => [0, 1].map((x) => ({ x, y, s: String(i) })));
    const p = picture(glyphChartArea(data, { x: "x", y: "y", fill: "s" }), 40, 18);
    const rowAt = (v: number) => Array.from({ length: p.layout.plot.x1 - p.layout.plot.x0 + 1 }, (_, i) => p.at(p.layout.plot.x0 + i, scaleToRow(p.scales.y, p.layout.plot, v))).join("");
    // Series "3" (styleIndex 3, y=7..0) is the tallest and so is the last
    // fill drawn — it covers rows 3 and 5 too, which is now its own shade
    // glyph "╱" (CHARTS-RESEARCH B2/`DIAGNOSIS-pie-contrast.md`'s shape-
    // family ramp, `█ ░ ▚ ╱ ▌ ═ ▓ ▒`: a region series' fill glyph, not a
    // uniform "█") wherever a shorter series' own dashed/dotted boundary
    // doesn't interrupt it.
    expect(rowAt(3)).toContain("──╱──╱"); expect(rowAt(5)).toContain("·╱·╱·"); expect(rowAt(7)).toContain("══");
  });
  it("4: the exact stacked area fills the full five-unit stack, with no sloping gap", () => {
    // Mutation: read original y rather than y0/y1 -> top two units remain empty.
    const p = picture(stackedArea, 24, 8);
    const { x0, x1, y0, y1 } = p.layout.plot;
    for (let y = y0; y < y1; y++) for (let x = x0; x <= x1; x++) expect(p.at(x, y)).toBe("█");
  });
  it.each([glyphChartArea, glyphChartBar])("4: stacked bounds own disjoint colours (%#)", (factory) => {
    // Mutation: paint every segment from 0, or connect separate stack layers -> wrong colour in lower/upper band.
    const mark = { ...factory([{ x: 0, y: 2, s: "A" }, { x: 1, y: 2, s: "A" }, { x: 0, y: 3, s: "B" }, { x: 1, y: 3, s: "B" }], { x: "x", y: "y", fill: "s" }), transform: { kind: "stack" as const } };
    const p = picture(mark, 24, 14, true), col = scaleToCol(p.scales.x, p.layout.plot, 0);
    const colorAt = (y: number) => p.canvas.grid.color![scaleToRow(p.scales.y, p.layout.plot, y) * 24 + col];
    expect(colorAt(1)).toBe("#3b82f6"); expect(colorAt(4)).toBe("#f97316");
  });
  it("5: signed cells at 24x6 use a diverging shade ramp anchored at zero, not at the most negative value", () => {
    // Mutation: revert to the pre-fix mapping (blank at the domain minimum,
    // medium ink at zero) -> a/b swap back to [" ", "▒"] and this reddens.
    const p = picture(signedCells, 24, 6);
    expect(["a", "b", "c"].map((x) => p.atValue(x, "v"))).toEqual(["▙", " ", "█"]);
  });
  it("final-gate-2 (codex finding 3): [-10, 0, 10] — the loss and the gain differ in GLYPH and in COLOUR, and zero is blank", () => {
    // Mutation: paint both sides of a signed heatmap through the same
    // GLYPH_CHART_CELL_GAIN_RAMP (dropping the `negative` branch in
    // `paintCell`) -> "a" (-10) and "c" (10) both render "█" -> red.
    // Mutation: paint both sides in the same colour (dropping the
    // `negative` ternary on `cellColor`) -> both cells' spans get
    // `#3b82f6` -> red.
    const p = picture(signedCells, 24, 6, true); // colorEnabled: true
    const colAt = (x: string) => scaleToCol(p.scales.x, p.layout.plot, x);
    const rowAt = scaleToRow(p.scales.y, p.layout.plot, "v");
    const glyphAt = (x: string) => p.canvas.grid.char[rowAt * 24 + colAt(x)];
    const colorAt = (x: string) => p.canvas.grid.color![rowAt * 24 + colAt(x)];
    expect(glyphAt("a")).toBe("▙"); // -10: loss ramp, full ink.
    expect(glyphAt("c")).toBe("█"); // +10: gain ramp, full ink.
    expect(glyphAt("a")).not.toBe(glyphAt("c")); // never the same glyph family.
    expect(glyphAt("b")).toBe(" "); // 0: always blank.
    expect(colorAt("a")).toBe("#ef4444"); // loss: red.
    expect(colorAt("c")).toBe("#3b82f6"); // gain: blue.
    expect(colorAt("a")).not.toBe(colorAt("c")); // never the same colour.
  });
  it("final-gate: a diverging cell ramp's most-negative value is never blank, blank is reserved for exactly 0, and a value near zero on either side still gets visible (non-blank) ink", () => {
    // Mutation: revert `shadeFor`'s diverging branch to the pre-fix
    // `0.5*(v-lo)/-lo` / `0.5+0.5*v/hi` mapping -> -9 (the biggest loss)
    // renders blank while 0 (nothing happening) renders medium ink, and
    // this reddens on both the blank-position and the near-zero-ink checks.
    const p = picture(
      { marks: [glyphChartCell([{ k: "a", v: -9 }, { k: "b", v: -4 }, { k: "c", v: 0 }, { k: "d", v: 5 }, { k: "e", v: 9 }], { x: "k", y: () => "v", fill: "v" })] },
      40, 8,
    );
    expect(p.atValue("a", "v")).not.toBe(" "); // most negative: inked, not blank.
    expect(p.atValue("c", "v")).toBe(" "); // exactly zero: blank.
    expect(p.atValue("b", "v")).not.toBe(" "); // near zero (negative side): still inked.
    expect(p.atValue("d", "v")).not.toBe(" "); // near zero (positive side): still inked.
    expect(p.atValue("e", "v")).not.toBe(" "); // most positive: inked.
  });
  it.each([[-10, -5, 0], [0, 5, 10]])("5: same-sign values %j use a shared sequential ramp", (a, b, c) => {
    // Mutation: normalize each cell independently or take absolute values -> ordered shades differ.
    const mark = { ...signedCells, data: [a, b, c].map((v, i) => ({ x: String(i), y: "v", v })) };
    const p = picture(mark, 24, 6);
    expect([0, 1, 2].map((x) => p.atValue(String(x), "v"))).toEqual([" ", "▒", "█"]);
  });
  it("5: separate cell marks share one ramp", () => {
    // Mutation: compute shade domain per mark -> both positive values become maximum shade.
    const p = picture([ { ...signedCells, data: [{ x: "a", y: "v", v: 5 }] }, { ...signedCells, data: [{ x: "b", y: "v", v: 10 }] } ], 24, 6);
    expect(p.atValue("a", "v")).toBe("▒"); expect(p.atValue("b", "v")).toBe("█");
  });
  it.each(markFactories.flatMap((factory) => [[20, 6], [40, 10], [80, 24]].map(([width, height]) => ({ factory, width: width!, height: height!, name: factory([-1, 1]).type }))))("6: ASCII $name at $width x $height with negative data and labels", ({ factory, width, height }) => {
    // Mutations: Unicode minus/ellipsis, ● ASCII dots, or bypass canvas text fold -> byte gate fails.
    const mark = factory([-1, 1]);
    const r = renderGlyphChart({ marks: [mark], title: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcd café …" }, { charset: "ascii", width, height });
    expect(r.text).toMatch(/^[\x20-\x7e\n]*$/);
    expect(r.text.split("\n")).toHaveLength(height);
    expect(r.text.split("\n").every((row) => row.length === width)).toBe(true);
  });
  it("6: exact ASCII title and text mark fold to budgeted strings", () => {
    // Mutation: use a one-cell ellipsis budget or retain precomposed é -> exact content differs.
    const r = renderGlyphChart({ marks: [glyphChartText([{ x: 0, y: 1, label: "café" }], { x: "x", y: "y", label: "label" })], title: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcd" }, { charset: "ascii", width: 24, height: 8 });
    expect(r.text.split("\n")[0]).toBe("ABCDEFGHIJKLMNOPQRSTU...");
    expect(r.text).toContain("cafe");
    const dots = renderGlyphChart(glyphChartDot([-1, 1]), { charset: "ascii", width: 20, height: 6 });
    expect(dots.build.canvas.grid.char.filter((c) => c === "o")).toHaveLength(2);
  });
  it("7: exact long band labels at 20x6 are abbreviated in slots, never clipped", () => {
    // Mutation: pass raw labels directly to canvas -> clipped middles, no abbreviation ledger.
    // `axes.x.title: ""` suppresses the new default axis title (packet item
    // 6 — `longBands`' own explicit `x: "x"` channel is a string field, so
    // it would otherwise claim the bottom row this test reads as the tick
    // label row).
    const r = renderGlyphChart({ marks: [longBands], axes: { x: { title: "" } } }, { width: 20, height: 6 });
    expect(r.text.split("\n").at(-1)).toMatch(/abc.*….*sec.*…/);
    expect(r.report.ledger.filter((entry) => entry.code === "label-abbreviated")).toHaveLength(2);
  });
  it("final-gate: a 3-day/12-hour time axis at 30x10 shows two distinct dates and never repeats \"12 PM\"", () => {
    // Mutation: drop the date-boundary priority set, the forced-first-tick
    // date, or widen dedup back to "only the immediately previous kept
    // label" -> the first tick loses its date (bare "12 PM") and/or a later
    // tick repeats it verbatim.
    const points = Array.from({ length: 5 }, (_, i) => ({ x: new Date(Date.UTC(2026, 0, 1, 12 * i)).toISOString(), y: i }));
    // `axes.x.title: ""` suppresses the new default axis title (packet item
    // 6 — the explicit `x: "x"` string-field channel would otherwise claim
    // this bottom row instead of the tick labels this test reads).
    const r = renderGlyphChart({ marks: [glyphChartLine(points, { x: "x", y: "y" })], scales: { x: { type: "time" } }, axes: { x: { title: "" } } }, { width: 30, height: 10 });
    const axisRow = r.text.split("\n").at(-1)!;
    const labels = axisRow.trim().split(/\s{2,}/).filter(Boolean);
    expect(new Set(labels).size).toBe(labels.length); // no repeated label text.
    expect(labels.filter((l) => l === "12 PM").length).toBe(0); // no BARE (undated) "12 PM".
    expect(labels[0]).toMatch(/^[A-Z][a-z]{2} \d{2}, \d{2} [AP]M$/); // first tick carries a real date.
    expect(labels.length).toBeGreaterThanOrEqual(2);
  });

  it("final-gate: a 4-day/12-hour time axis shows a dated first tick and no duplicate label text anywhere on the axis", () => {
    const points = Array.from({ length: 7 }, (_, i) => ({ x: new Date(Date.UTC(2026, 0, 1, 12 * i)).toISOString(), y: i }));
    const r = renderGlyphChart({ marks: [glyphChartLine(points, { x: "x", y: "y" })], scales: { x: { type: "time" } }, axes: { x: { title: "" } } }, { width: 52, height: 10 });
    const axisRow = r.text.split("\n").at(-1)!;
    const labels = axisRow.trim().split(/\s{2,}/).filter(Boolean);
    expect(new Set(labels).size).toBe(labels.length);
    expect(labels[0]).toMatch(/^[A-Z][a-z]{2} \d{2}, \d{2} [AP]M$/);
    expect(labels.length).toBeGreaterThanOrEqual(3);
  });

  it("final-gate: duplicate-label suppression compares against ALL kept ticks, not just the immediately previous one", () => {
    // Mutation: shrink the dedup check back to `kept.at(-1)` -> a THIRD,
    // distinctly-labelled tick ("Fri 02") sits between the two "06 PM"
    // occurrences, so an only-immediately-previous check no longer sees the
    // first one and the second "06 PM" survives as a non-adjacent repeat.
    const points = Array.from({ length: 5 }, (_, i) => ({ x: new Date(Date.UTC(2026, 0, 1, 12 * i)).toISOString(), y: i }));
    // axes.x.title: "" — see the two tests above for why (packet item 6's new default title).
    const r = renderGlyphChart({ marks: [glyphChartLine(points, { x: "x", y: "y" })], scales: { x: { type: "time" } }, axes: { x: { title: "" } } }, { width: 70, height: 10 });
    const axisRow = r.text.split("\n").at(-1)!;
    const labels = axisRow.trim().split(/\s{2,}/).filter(Boolean);
    expect(new Set(labels).size).toBe(labels.length);
    expect(labels.filter((l) => l === "06 PM").length).toBeLessThanOrEqual(1);
  });

  it("7: two-hour time axis at 40x8 has distinct complete multi-scale labels", () => {
    // Mutation: fixed %b %d formatter -> repeated Jan 01 and clipped last label.
    // axes.x.title: "" — hourlyLine's explicit `x: "x"` string channel would
    // otherwise claim the row this test reads as the tick label row (packet
    // item 6's new default title).
    const spec: GlyphChartSpec = { marks: [hourlyLine], scales: { x: { type: "time" } }, axes: { x: { title: "" } } };
    const p = picture(spec, 40, 8);
    expect(new Set(p.layout.xTicks.map((t) => t.label)).size).toBe(p.layout.xTicks.length);
    expect(p.layout.xTicks.length).toBeGreaterThan(1);
    const row = renderGlyphChart(spec, { width: 40, height: 8 }).text.split("\n").at(-1)!;
    for (const t of p.layout.xTicks) expect(row.slice(t.labelStart, t.labelStart + t.label.length)).toBe(t.label);
  });
  it("7/11: designed numeric and band collisions force tick thinning", () => {
    // Mutation: skip collision/stride thinning -> count and pairwise spans fail, even if d3's normal tick sets happen to fit.
    for (const band of [false, true]) {
      const spec = { marks: [glyphChartLine([1, 2])] }, marks = resolveGlyphChartSpec(spec), scales = resolveGlyphChartScales(marks, undefined);
      const crowded = { ...scales.x, type: band ? "band" as const : "linear" as const, ticks: () => Array.from({ length: 20 }, (_, i) => ({ value: i, fraction: i / 19, label: `long-${i}` })) };
      const ledger: GlyphChartLedgerEntry[] = [];
      const layout = layoutGlyphChart(spec, marks, { ...scales, x: crowded }, 40, 10, "auto", ledger);
      expect(layout.xTicks.length).toBeGreaterThan(0); expect(layout.xTicks.length).toBeLessThan(20);
      for (let i = 1; i < layout.xTicks.length; i++) expect(layout.xTicks[i]!.labelStart).toBeGreaterThan(layout.xTicks[i - 1]!.labelStart + layout.xTicks[i - 1]!.label.length);
      expect(ledger).toContainEqual(expect.objectContaining({ code: "ticks-thinned" }));
    }
  });
  it("final-gate: an overshot linear tick ladder thins by a UNIFORM index stride, never an arbitrary greedy subset — kept ticks land evenly spaced in d3's own index order", () => {
    // Mutation: drop the `!band` overshoot-stride branch in `axisTicks` (back
    // to stride 1 for non-band axes) -> the collision loop alone thins
    // d3's 9-tick [0..8] ladder to an UNEVEN subset like [0,3,4,6,8] (gaps
    // 3,1,2,2) instead of the uniform-index [0,2,4,6,8] (gaps 2,2,2,2).
    const p = picture(glyphChartBar([3, 5, 2, 8]), 40, 12);
    const values = p.layout.yTicks.map((t) => t.value as number).sort((a, b) => a - b);
    expect(values).toEqual([0, 2, 4, 6, 8]);
    const gaps = values.slice(1).map((v, i) => v - values[i]!);
    expect(new Set(gaps).size).toBe(1); // every gap identical -> evenly spaced in index.
  });

  it.each([{ width: 20.5, height: 6 }, { width: 0.5, height: 6 }, { width: 20, height: 6.5 }])("8: fractional dimensions $width x $height reject before canvas", (options) => {
    // Mutation: accept positive non-integers -> alternating grid widths or untagged canvas failure.
    expect(() => renderGlyphChart(glyphChartLine([1, 2]), options)).toThrow(expect.objectContaining({ code: "bad-size" }));
  });
  it("10: categorical y dots paint low and high on their bands", () => {
    // Mutation: filter dot rows by numeric(y) -> zero dots survive.
    const p = picture(categoricalDots, 24, 8);
    expect(p.atValue(0, "low")).toBe("●"); expect(p.atValue(1, "high")).toBe("●");
  });
});

describe("post-commit review fixes (REVIEW-phase1-opus-postcommit.md, P1-0..6 + one-liner P2s)", () => {
  it("P1-0: axes stay whole-cell box-drawing under braille — only DATA marks rasterise sub-cell", () => {
    // Mutation: drop the `opts.subcell ?? tierTable.subcell` fallback in
    // glyphcss's canvas.ts `line()` (always consult the tier) -> red, the
    // y-axis column fills with braille dot codepoints instead of "│".
    // `tickMarks: false` isolates this test's own concern (sub-cell braille
    // dots vs whole-cell axis glyphs) from packet item 6's tick-mark glyphs,
    // which are covered by their own dedicated tests (`axes.test.ts`).
    const r = renderGlyphChart(
      { marks: [glyphChartLine([3, 5, 2, 8, 6, 9, 4, 7, 3, 5])], axes: { x: { tickMarks: false }, y: { tickMarks: false } } },
      { target: "chat", charset: "braille", width: 44, height: 12 },
    );
    const rows = r.text.split("\n");
    const axisLine = rows.find((row) => row.includes("─"))!;
    expect(axisLine).toBeDefined();
    // The y-axis GUTTER may legitimately carry a tick-value LABEL on this
    // exact row now (CHARTS-RESEARCH B1: a y domain not containing 0 puts
    // the axis line at the y-MINIMUM's own row, and `yTickMarks: false`
    // still prints that tick's numeric label, just not its "┤" glyph) —
    // strip that leading label token before checking the PLOT portion.
    // Every cell there is whole-cell "─" EXCEPT the one column where this
    // data set's own minimum (2, at index 2) legitimately touches the axis
    // line — that column may carry a genuine sub-cell braille dot from the
    // touching line, never a different whole-cell glyph. Folding braille
    // codepoints back to "─" before the match isolates exactly that one
    // tolerated intrusion.
    const plotPortion = axisLine.replace(/^\s*\S*\s*/, "");
    expect(plotPortion.replace(/[⠀-⣿]/g, "─")).toMatch(/^─+$/);
    const yAxisCol = rows.slice(0, -2).map((row) => row.indexOf("│")).find((i) => i >= 0)!;
    for (const row of rows.slice(0, -2)) {
      const ch = row[yAxisCol];
      if (ch !== undefined && ch !== " ") expect(ch).toBe("│");
    }
    // The plot interior still has genuine sub-cell braille dots (the DATA line).
    expect(rows.slice(0, -2).some((row) => [...row].some((c) => { const cp = c.codePointAt(0)!; return cp >= 0x2800 && cp <= 0x28ff; }))).toBe(true);
  });

  it("P1-1: unstacked multi-series bars dodge side by side within the band — nothing overwritten", () => {
    // Mutation: revert `paintBar` to paint every series across the FULL band
    // (drop the `dodgeColRange` call) -> Jan's South (2) bar overwrites/is
    // overwritten by North (9) in the same columns -> the two series' column
    // ranges below overlap and this reddens.
    const data = [
      { m: "Jan", v: 9, r: "North" }, { m: "Jan", v: 2, r: "South" },
      { m: "Feb", v: 3, r: "North" }, { m: "Feb", v: 8, r: "South" },
    ];
    const p = picture(glyphChartBar(data, { x: "m", y: "v", fill: "r" }), 34, 14);
    const janNorth = bandColRange(p.scales.x, p.layout.plot, "Jan")!;
    const countFilled = (col: number) => { let n = 0; for (let y = p.layout.plot.y0; y <= p.layout.plot.y1; y++) if (p.at(col, y) !== " ") n++; return n; };
    const janCols = Array.from({ length: janNorth[1] - janNorth[0] + 1 }, (_, i) => janNorth[0] + i);
    const janHeights = janCols.map(countFilled);
    // North (9, tall) occupies the first sub-band, South (2, short) the
    // second — the FIRST column of the band and the LAST must differ
    // sharply (an overwritten/undodged pair would instead show ONE height
    // — whichever series painted last — across the WHOLE band).
    expect(janHeights[0]).toBeGreaterThan(janHeights.at(-1)!);
    expect(janHeights.at(-1)!).toBeGreaterThan(0); // South (2) still paints something, not zero/overwritten.
    // Every column reads as belonging to exactly one of the two heights.
    const distinctHeights = new Set(janHeights);
    expect(distinctHeights.size).toBe(2);
    // Feb: North (3, short) then South (8, tall) — same shape, opposite order.
    const febRange = bandColRange(p.scales.x, p.layout.plot, "Feb")!;
    const febCols = Array.from({ length: febRange[1] - febRange[0] + 1 }, (_, i) => febRange[0] + i);
    const febHeights = febCols.map(countFilled);
    expect(febHeights.at(-1)!).toBeGreaterThan(febHeights[0]!);
  });

  it("P1-1: a band too narrow for every series degrades to the full band with a ledger entry, never a crash", () => {
    const data = Array.from({ length: 6 }, (_, i) => ({ m: "only", v: i + 1, r: String(i) }));
    const p = picture(glyphChartBar(data, { x: "m", y: "v", fill: "r" }), 8, 8);
    expect(p.ledger.some((entry) => entry.code === "series-dodge-degraded")).toBe(true);
  });

  it("final-gate: unstacked multi-series RECTS dodge side by side too, exactly like bars — never one series painted over another's base", () => {
    // Mutation: revert `paintRect` to a single undodged column per row (drop
    // its `dodgeColRange` call) -> Jan's North (9) and South (2) rects both
    // paint into the SAME column, so South's own value is merely a shorter
    // overwrite of North's column instead of a distinct sub-band -> the
    // column-range check below (identical shape to the bar test above) reddens.
    const data = [
      { m: "Jan", v: 9, r: "North" }, { m: "Jan", v: 2, r: "South" },
      { m: "Feb", v: 3, r: "North" }, { m: "Feb", v: 8, r: "South" },
    ];
    const p = picture(glyphChartRect(data, { x: "m", y: "v", fill: "r" }), 34, 14);
    const janRange = bandColRange(p.scales.x, p.layout.plot, "Jan")!;
    const countFilled = (col: number) => { let n = 0; for (let y = p.layout.plot.y0; y <= p.layout.plot.y1; y++) if (p.at(col, y) !== " ") n++; return n; };
    const janCols = Array.from({ length: janRange[1] - janRange[0] + 1 }, (_, i) => janRange[0] + i);
    const janHeights = janCols.map(countFilled);
    expect(janHeights[0]).toBeGreaterThan(janHeights.at(-1)!);
    expect(janHeights.at(-1)!).toBeGreaterThan(0);
    expect(new Set(janHeights).size).toBe(2);
  });

  it("P1-2: a line mark clips to the plot rect — an explicit narrower y-domain never paints over the title/axis", () => {
    // Mutation: remove `clipSegmentToPlot` from `paintLine` (draw the raw,
    // unclamped points) -> a value of 10 against domain [0,4] paints
    // slope glyphs into the title row -> red.
    const r = renderGlyphChart({ marks: [glyphChartLine([1, 10, 2, 9])], scales: { y: { domain: [0, 4] } }, title: "clip" }, { target: "chat", width: 30, height: 10 });
    const rows = r.text.split("\n");
    const titleRow = rows[0]!;
    expect(titleRow).not.toMatch(/[/\\_▔‾▏▕|─│]/);
    expect(titleRow).toContain("clip");
    // The existing paintDot clip must still hold too (finding 2's own mutation gate).
    const dotSpec = { marks: [glyphChartDot([1, 10, 2, 9])], scales: { y: { domain: [0, 4] as [number, number] } } };
    const dotRows = renderGlyphChart(dotSpec, { target: "chat", width: 30, height: 10 }).text.split("\n");
    expect(dotRows[0]).not.toContain("●");
  });

  it("P1-2: an explicit narrower x-domain never paints through the y-axis gutter", () => {
    const r = renderGlyphChart({ marks: [glyphChartLine([1, 10, 2, 9])], scales: { x: { domain: [1, 2] } } }, { target: "chat", width: 30, height: 10 });
    const rows = r.text.split("\n");
    const plotStart = rows[0]!.indexOf("│") + 1 || rows.find((r2) => r2.includes("│"))!.indexOf("│") + 1;
    for (const row of rows.slice(0, -2)) {
      const gutter = row.slice(0, plotStart - 1);
      expect(gutter).not.toMatch(/[/\\_▔‾▏▕]/);
    }
  });

  it("P1-3: marks disagreeing on x value type reject with mixed-x-scale, never an untagged canvas RangeError", () => {
    // Mutation: drop `detectMixedScaleTypes`'s call in `resolveGlyphChartScale`
    // -> a linear x scale is built from the numeric mark's values alone, the
    // band mark's string x resolves to NaN downstream, and fillRect throws
    // an untagged RangeError instead -> red.
    expect(() => renderGlyphChart({
      marks: [glyphChartLine([3, 5, 2, 8]), glyphChartBar([{ m: "a", v: 1 }, { m: "b", v: 3 }], { x: "m", y: "v" })],
    }, { width: 40, height: 12 })).toThrow(expect.objectContaining({ code: "mixed-x-scale" }));
  });

  it("final-gate: mixed-x-scale no longer rejects a numeric x sharing a band scale when every numeric value lands on its own honest category", () => {
    // Mutation: revert the guard to the unconditional
    // `detectMixedScaleTypes(values) -> mixedXScaleError()` (drop the
    // `numericValuesUnplaceableOnBand` narrowing) -> this now-valid spec
    // throws mixed-x-scale again instead of rendering two honest bands.
    const r = renderGlyphChart(glyphChartBar([{ m: "2023", v: 1 }, { m: 2024, v: 3 }], { x: "m", y: "v" }), { width: 30, height: 10 });
    expect(r.text).toContain("2023");
    expect(r.text).toContain("2024");
  });

  it("final-gate: a band bar plus a numeric-x text annotation renders instead of rejecting", () => {
    const r = renderGlyphChart({ marks: [
      glyphChartBar([{ m: "a", v: 1 }, { m: "b", v: 2 }], { x: "m", y: "v" }),
      glyphChartText([{ x: 0, label: "note" }], { x: "x", label: "label" }),
    ] }, { width: 30, height: 10 });
    expect(r.text).toContain("note");
  });

  it("final-gate: mixed-x-scale still rejects when the mixture resolves to a NON-band scale (a numeric-shorthand mark sorting first)", () => {
    // Mutation: drop the `numericValuesUnplaceableOnBand` narrowing entirely
    // (always skip the check) -> this reddens because the spec would then
    // silently build a linear x scale and feed "a"/"b" through Number(),
    // producing NaN cell coordinates instead of a tagged, actionable error.
    expect(() => renderGlyphChart({
      marks: [glyphChartDot([1, 2, 3]), glyphChartBar([{ m: "a", v: 1 }, { m: "b", v: 2 }], { x: "m", y: "v" })],
    }, { width: 30, height: 10 })).toThrow(expect.objectContaining({ code: "mixed-x-scale" }));
  });

  it("final-gate: both mixed-x-scale and GLYPH_CHART_INTERNAL_COORD carry a repair hint, and renderGlyphChartJson keeps its hint key for both", () => {
    // Mutation: remove either entry from RUNTIME_REPAIR_HINTS (or drop the
    // `?? RUNTIME_REPAIR_HINTS[id]` fallback) -> glyphChartRepairHint
    // returns undefined and JSON.stringify drops the "hint" key entirely.
    expect(glyphChartRepairHint("mixed-x-scale")).toBeTruthy();
    expect(glyphChartRepairHint("GLYPH_CHART_INTERNAL_COORD")).toBeTruthy();
    const mixedJson = JSON.parse(renderGlyphChartJson(JSON.stringify({
      marks: [{ type: "line", data: [3, 5, 2, 8], channels: {} }, { type: "bar", data: [{ m: "a", v: 1 }, { m: "b", v: 3 }], channels: { x: "m", y: "v" } }],
    })));
    expect(mixedJson.code).toBe("mixed-x-scale");
    expect(Object.keys(mixedJson)).toEqual(["error", "code", "hint"]);
    expect(mixedJson.hint).toBeTruthy();
    const coordJson = JSON.parse(renderGlyphChartJson(JSON.stringify({ type: "bar", data: [{ a: 1 }, { a: 2 }], channels: { x: "nope", y: "a" } })));
    expect(coordJson.code).toBe("GLYPH_CHART_INTERNAL_COORD");
    expect(Object.keys(coordJson)).toEqual(["error", "code", "hint"]);
    expect(coordJson.hint).toBeTruthy();
  });

  it("P1-3: an unresolvable channel reaching the canvas throws GLYPH_CHART_INTERNAL_COORD naming the mark type, never a bare canvas message", () => {
    // Mutation: remove `guardedCanvas`'s wrapping in `paintGlyphChart` (call
    // `canvas` directly) -> the thrown error is the canvas's own untagged
    // "glyphcss: fillRect() requires integer cell coordinates…" -> red.
    let err: unknown;
    try { renderGlyphChart(glyphChartBar([{ a: 1 }, { a: 2 }], { x: "nope", y: "a" }), {}); } catch (e) { err = e; }
    expect(err).toMatchObject({ code: "GLYPH_CHART_INTERNAL_COORD" });
    expect((err as Error).message).toContain('mark "bar"');
    expect((err as Error).message).not.toContain("fillRect() requires integer");

    let cellErr: unknown;
    try { renderGlyphChart(glyphChartCell([{ a: 1 }], { x: "nope", y: "a", fill: "a" }), {}); } catch (e) { cellErr = e; }
    expect(cellErr).toMatchObject({ code: "GLYPH_CHART_INTERNAL_COORD" });
    expect((cellErr as Error).message).toContain('mark "cell"');
  });

  it("P1-4: a numeric label that can't fit even after SI abbreviation is DROPPED, never truncated into a different number", () => {
    // Mutation: revert `abbreviateChartText`'s numeric branch to fall through
    // to the ellipsis-truncation path -> "1.5M" sliced to fit 3 cells reads
    // "1.5" -> "1" for a 1-cell slot, a different, wrong, plausible number -> red.
    const p = picture(glyphChartLine([1000000, 2000000]), 6, 4);
    // Every surviving y-tick label is either untouched or a legitimately
    // abbreviated form no shorter than the ellipsis-truncation would allow —
    // never a bare "1"/"2" standing in for "1M"/"2M"/"1.5M". (CHARTS-RESEARCH
    // B3's `yRowBudget` off-by-one fix changed exactly which nice ticks this
    // 4-row plot requests — 1M/2M here, not the old 1.5M midpoint — the
    // property under test is the DROP itself, not which value triggers it.)
    for (const t of p.layout.yTicks) expect(t.label).not.toMatch(/^\d$/);
    expect(p.ledger.some((entry) => entry.code === "label-dropped" && /\dM/.test(entry.message))).toBe(true);
    // Category labels are unaffected — still elided with an ellipsis.
    const bands = renderGlyphChart(longBands, { width: 20, height: 6 });
    expect(bands.report.ledger.some((entry) => entry.code === "label-abbreviated")).toBe(true);
  });

  it("P1-5: a bar/rect chart's zero baseline is always labelled when 0 is in the y-domain", () => {
    // Mutation: drop the `yPriority` set (or the synthesized 0 tick) from
    // `layoutGlyphChart` -> the greedy collision thinning can drop the 0
    // label in favour of an arbitrary neighbour -> red.
    const p = picture(glyphChartBar([3, 5, 2, 8]), 40, 12);
    expect(p.layout.yTicks.some((t) => t.value === 0)).toBe(true);
  });

  it("P1-5: a log axis always keeps its decade ticks labelled", () => {
    // Mutation: drop the `isDecadeTick` priority set for log axes -> the
    // dot at 100 can land on a row labelled with a non-decade neighbour
    // (e.g. 80) and no decade at all survives thinning -> red.
    const p = picture({ marks: [glyphChartDot([1, 10, 100])], scales: { y: { type: "log" } } }, 30, 10);
    const labelled = new Set(p.layout.yTicks.map((t) => t.value));
    expect(labelled.has(1)).toBe(true);
    expect(labelled.has(10)).toBe(true);
    expect(labelled.has(100)).toBe(true);
  });

  it("P1-5: a multi-day time axis shows distinct DATE-bearing labels, never a repeated ambiguous time", () => {
    // Mutation: revert the duplicate-label drop in `axisTicks` (or its
    // priority-free ascending processing) -> thinning can keep two ticks
    // both formatted "12 PM" while dropping the midnight ticks that carry
    // the actual dates -> red (the distinctness assertion below fails).
    const start = new Date("2026-01-01T00:00:00Z").getTime();
    const data = Array.from({ length: 5 }, (_, i) => ({ x: new Date(start + i * 12 * 3600 * 1000).toISOString(), y: i }));
    const spec: GlyphChartSpec = { marks: [glyphChartLine(data, { x: "x", y: "y" })], scales: { x: { type: "time" } } };
    const p = picture(spec, 30, 10);
    const labels = p.layout.xTicks.map((t) => t.label);
    expect(new Set(labels).size).toBe(labels.length);
    expect(labels.length).toBeGreaterThan(1);
    // At least one surviving label carries an actual date (a weekday/month
    // abbreviation), not merely a repeated intraday time.
    expect(labels.some((l) => /[A-Za-z]{3}\s?\d/.test(l))).toBe(true);
  });

  it("P1-6: a cell mark's minimum nonzero value paints the lightest INKED glyph, never blank (the shipped Heatmap preset's Mon/AM cell)", () => {
    // Mutation: revert `shadeFor`'s same-sign branch to the plain
    // `(v - lo) / (hi - lo)` with no `GLYPH_CHART_CELL_MIN_INK_SHADE` floor
    // -> a value of 1 in a 0..12 domain rounds to `box`'s blank ramp entry
    // (`Math.round(0.083 * 4) === 0`) -> red.
    const data: { x: string; y: string; v: number }[] = [];
    const days = ["Mon", "Tue", "Wed", "Thu"];
    const times = ["AM", "Midday", "PM"]; // 4x3, max = 4*3 = 12 — the shipped Heatmap preset's exact shape.
    days.forEach((d, x) => times.forEach((t, y) => data.push({ x: d, y: t, v: (x + 1) * (y + 1) })));
    const p = picture(glyphChartCell(data, { x: "x", y: "y", fill: "v" }), 40, 14);
    expect(p.atValue("Mon", "AM")).not.toBe(" "); // value 1 of max 12 — the reported hole.
    expect(p.atValue("Thu", "PM")).toBe("█"); // value 12 (the domain max) is still full ink.
    expect(p.atValue("Mon", "AM")).toBe("░"); // the lowest INKED ramp level, not a mid-shade either.
  });

  it("P1-6: an all-nonpositive cell domain keeps its existing (unchanged) direction — 0 stays full ink, the extreme negative stays blank", () => {
    // Companion to the P1-6 fix above: the same-sign formula is unchanged in
    // DIRECTION (only near-`lo` values get floored off blank), so this must
    // still match "5: same-sign values … use a shared sequential ramp"'s own
    // pinned expectation for the negative-only case.
    const mark = { ...signedCells, data: [-10, -5, 0].map((v, i) => ({ x: String(i), y: "v", v })) };
    const p = picture(mark, 24, 6);
    expect(p.atValue("0", "v")).toBe(" "); // the domain minimum (-10) is still blank.
    expect(p.atValue("2", "v")).toBe("█"); // 0 (the domain maximum here) is still full ink.
  });

  it("P2-11 (one-liner): dropped nonpositive arc slices are recorded in the ledger", () => {
    // Mutation: remove the `shownRows < resolvedRowCount` ledger push in
    // `paintArc` -> the ledger stays empty even though a slice was silently
    // dropped -> red.
    const r = renderGlyphChart(glyphChartArc([{ k: "a", v: 50 }, { k: "b", v: -25 }, { k: "c", v: 25 }], { y: "v", fill: "k" }), { width: 30, height: 10 });
    expect(r.report.ledger.some((entry) => entry.code === "slice-dropped")).toBe(true);
  });

  it("P2-12a (one-liner): bandRowRange excludes the shared boundary row — adjacent row bands neither gap nor overlap", () => {
    // Mutation: drop the `+ 1` from `bandRowRange` (back to
    // `[Math.min(a,b), Math.max(a,b)]`) -> adjacent bands share a boundary
    // row -> red.
    const spec = glyphChartPlot({ marks: [glyphChartCell([{ k: "r0", v: 1 }, { k: "r1", v: 1 }, { k: "r2", v: 1 }], { x: "v", y: "k", fill: "v" })] });
    const marks = resolveGlyphChartSpec(spec);
    const scales = resolveGlyphChartScales(marks, spec.scales);
    const ledger: GlyphChartLedgerEntry[] = [];
    const layout = layoutGlyphChart(spec, marks, scales, 16, 12, "auto", ledger);
    const ranges = ["r0", "r1", "r2"].map((k) => bandRowRange(scales.y, layout.plot, k)!);
    for (let i = 0; i < ranges.length; i++) for (let j = i + 1; j < ranges.length; j++) {
      const [a0, a1] = ranges[i]!, [b0, b1] = ranges[j]!;
      expect(a1 < b0 || b1 < a0).toBe(true); // disjoint — no shared row.
    }
  });

  it("final-gate: bandRowRange partitions the plot rows with no gaps, never empty, and disjoint once there are at least as many available rows as bands, for every band count 1..12 and every chart height 3..20; labels land at each band's own centre, and the x-axis LINE row is never claimed by any category", () => {
    // Mutation: any change that restores the continuous-fraction `[b+1, a]`
    // derivation, drops the matching y-tick fraction correction, or lets
    // `bandPartitionRowRange` hand back an empty range when bands outnumber
    // rows, reddens this — either the coverage/disjointness assertions
    // below, a band going empty, or a tick landing outside its band.
    //
    // Final-gate-2 review finding 1 (Opus): a band y-scale's `xAxisLineRow`
    // is always `plot.y1` (a band scale never admits a zero fraction), so a
    // partition that used to claim `plot.y1` for the bottommost category
    // handed that category's row to `paintCell` — which `paintAxes` (run
    // AFTER it) then unconditionally overwrote. `bandCategoryPlot` now
    // excludes that row from the partition entirely, exactly like a bar's
    // own fill stops one row short of the baseline; the expected coverage
    // below is therefore `plot.y0 .. plot.y1 - 1`, not the whole plot rect.
    for (let bands = 1; bands <= 12; bands++) {
      for (let height = 3; height <= 20; height++) {
        const categories = Array.from({ length: bands }, (_, i) => `r${i}`);
        const data = categories.map((k) => ({ k, v: 1 }));
        const spec = glyphChartPlot({ marks: [glyphChartCell(data, { x: "v", y: "k", fill: "v" })] });
        const marks = resolveGlyphChartSpec(spec);
        const scales = resolveGlyphChartScales(marks, spec.scales);
        const ledger: GlyphChartLedgerEntry[] = [];
        const layout = layoutGlyphChart(spec, marks, scales, 24, height, "auto", ledger);
        const ranges = categories.map((k) => bandRowRange(scales.y, layout.plot, k)!);
        // Available rows for CATEGORIES excludes the axis line row at
        // `plot.y1` (degrading to the full rect only when that would leave
        // nothing at all — the same one-row-plot edge case
        // `bandCategoryPlot` itself degrades on).
        const categoryTop = layout.plot.y0;
        const categoryBottom = layout.plot.y1 - 1 >= layout.plot.y0 ? layout.plot.y1 - 1 : layout.plot.y1;
        const availableRows: number[] = [];
        for (let row = categoryTop; row <= categoryBottom; row++) availableRows.push(row);
        // Every band is non-empty, unconditionally — the plot's own
        // category-row budget (never the outer chart height, which also
        // spends rows on axis chrome, and never the axis line row itself)
        // is what pigeonholes disjointness, never emptiness.
        for (const [a, b] of ranges) expect(a).toBeLessThanOrEqual(b);
        const covered = new Set<number>();
        for (const [a, b] of ranges) for (let row = a; row <= b; row++) covered.add(row);
        expect([...covered].sort((x, y) => x - y)).toEqual(availableRows); // union == available rows exactly
        // The axis LINE row is never inside any category's own range,
        // except in the one-row-plot degenerate case where there is
        // nowhere else for it to be.
        if (categoryBottom < layout.plot.y1) {
          for (const [a, b] of ranges) expect(layout.plot.y1 >= a && layout.plot.y1 <= b).toBe(false);
        }
        if (availableRows.length >= bands) {
          const seen = new Set<number>();
          for (const [a, b] of ranges) for (let row = a; row <= b; row++) {
            expect(seen.has(row)).toBe(false); // pairwise disjoint once rows suffice
            seen.add(row);
          }
        }
        for (const tick of layout.yTicks) {
          const idx = categories.indexOf(String(tick.value));
          if (idx < 0) continue;
          const [a, b] = ranges[idx]!;
          expect(tick.cell).toBeGreaterThanOrEqual(a);
          expect(tick.cell).toBeLessThanOrEqual(b);
        }
      }
    }
  });

  it("final-gate-2 (Opus finding 1): the heatmap's BOTTOM category is never painted into the x-axis row and erased — 6 bands at 20x8, per-band assertion on the actual shade glyph, never the axis dash/junction", () => {
    // Mutation: let `paintCell` (or `bandRowRange`) cover `xAxisLineRow` ->
    // the bottommost category's whole chunk becomes exactly that one row,
    // `paintAxes` (which runs after `paintCell`) overwrites it with a plain
    // axis glyph, and this test catches it directly by asserting the
    // SPECIFIC shade-ramp glyph rather than merely "not a space" — the
    // review's own diagnosis of why the prior gate at this shape passed
    // even with the defect present (an axis dash/junction is not a space
    // either).
    const categories = Array.from({ length: 6 }, (_, i) => `r${i}`);
    const data = categories.map((k, i) => ({ k, v: i + 1 }));
    const p = picture(glyphChartCell(data, { x: "v", y: "k", fill: "v" }), 20, 8);
    const shadeGlyphs = new Set(["░", "▒", "▓", "█"]);
    const axisGlyphs = new Set(["─", "│", "┤", "┴", "├", "└", "┼"]);
    for (const k of categories) {
      const [a, b] = bandRowRange(p.scales.y, p.layout.plot, k)!;
      expect(a).toBeLessThanOrEqual(b);
      // The category's own range must never include the axis line row.
      expect(p.layout.xAxisLineRow >= a && p.layout.xAxisLineRow <= b).toBe(false);
      let inked = false;
      for (let row = a; row <= b; row++) for (let col = p.layout.plot.x0; col <= p.layout.plot.x1; col++) {
        const ch = p.at(col, row);
        if (shadeGlyphs.has(ch)) inked = true;
        expect(axisGlyphs.has(ch)).toBe(false); // never the axis rule standing in for real ink
      }
      expect(inked).toBe(true);
    }
  });

  it("final-gate: the heatmap with 6 bands at 20x6 paints all six, none dropped to the shared boundary-row/zero-row bug", () => {
    const categories = Array.from({ length: 6 }, (_, i) => `r${i}`);
    const data = categories.map((k, i) => ({ k, v: i + 1 }));
    const p = picture(glyphChartCell(data, { x: "v", y: "k", fill: "v" }), 20, 6);
    for (const k of categories) {
      const [a, b] = bandRowRange(p.scales.y, p.layout.plot, k)!;
      expect(a).toBeLessThanOrEqual(b);
      let painted = false;
      for (let row = a; row <= b; row++) for (let col = p.layout.plot.x0; col <= p.layout.plot.x1; col++) if (p.at(col, row) !== " ") painted = true;
      expect(painted).toBe(true);
    }
  });

  it("P2-12b (one-liner mutation-test gap): bandColRange's own '-1' band-exactness is now covered by a failing mutation", () => {
    // Mutation: drop the `- 1` from `bandColRange` (`fractionToCol(plot, hi)`
    // with no adjustment) -> adjacent column bands touch/overlap at their
    // shared boundary cell -> red. (Previously untested per the review's M2.)
    const spec = glyphChartPlot({ marks: [glyphChartBar([{ k: "a", v: 1 }, { k: "b", v: 2 }, { k: "c", v: 3 }], { x: "k", y: "v" })] });
    const marks = resolveGlyphChartSpec(spec);
    const scales = resolveGlyphChartScales(marks, spec.scales);
    const ledger: GlyphChartLedgerEntry[] = [];
    const layout = layoutGlyphChart(spec, marks, scales, 40, 14, "auto", ledger);
    const a = bandColRange(scales.x, layout.plot, "a")!;
    const b = bandColRange(scales.x, layout.plot, "b")!;
    const c = bandColRange(scales.x, layout.plot, "c")!;
    // Strict disjointness (not merely `a[1] < b[0]`, which a same-cell
    // touch could still satisfy under a different off-by-one): every column
    // belongs to at most one band.
    const owner = new Map<number, string>();
    for (const [range, name] of [[a, "a"], [b, "b"], [c, "c"]] as const) {
      for (let col = range[0]; col <= range[1]; col++) {
        expect(owner.has(col)).toBe(false);
        owner.set(col, name);
      }
    }
  });
});
