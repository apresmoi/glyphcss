import { describe, expect, it } from "vitest";
import { createGlyphCanvas } from "glyphcss";
import { renderGlyphChart } from "./render";
import { glyphChartArc, glyphChartArea, glyphChartBar, glyphChartCell, glyphChartDot, glyphChartLine, glyphChartPlot, glyphChartRect, glyphChartText } from "./spec";
import { bandColRange, bandRowRange, layoutGlyphChart, scaleToCol, scaleToRow } from "./layout";
import { resolveGlyphChartSpec } from "./resolve";
import { resolveGlyphChartScales } from "./scales";
import { paintGlyphChart } from "./paint";
import { normalizeGlyphChartInput } from "./spec";
import type { GlyphChartInput, GlyphChartCharset, GlyphChartSpec } from "./types";
import { categoricalSeriesData, stackedArea, signedCells, longBands, hourlyLine, categoricalDots, markFactories } from "./reviewFixtures";

function picture(input: GlyphChartInput, width: number, height: number, colorEnabled = false, charset: GlyphChartCharset = "box") {
  const spec = normalizeGlyphChartInput(input), marks = resolveGlyphChartSpec(spec), scales = resolveGlyphChartScales(marks, spec.scales);
  const ledger: string[] = [];
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
    expect(r.grid.char.filter((c) => c === "█")).toHaveLength(0);
  });
  it("1: all-zero pie at 20x6 is empty with EMPTY_TOTAL", () => {
    // Mutation: total || 1 plus last-slice fallback -> paints a full disc.
    const r = renderGlyphChart(glyphChartArc([0, 0, 0]), { width: 20, height: 6 });
    expect(r.grid.char.every((c) => c === " ")).toBe(true);
    expect(r.report.ledger).toContainEqual(expect.stringContaining("GLYPH_CHART_EMPTY_TOTAL"));
  });
  it("1: positive and negative bars exclude the zero baseline", () => {
    // Mutation: include baseline at either end -> invents an extra cell.
    const p = picture(glyphChartBar([-1, 1]), 20, 8);
    expect(p.atValue(0, 0)).toBe(" ");
    expect(p.atValue(1, 0)).toBe(" ");
    expect(p.atValue(0, -1)).toBe("█");
    expect(p.atValue(1, 1)).toBe("█");
  });
  it("2: log [1,10,100] at 24x8 paints three equally spaced dot rows", () => {
    // Mutation: force log to scaleLinear -> 1 and 10 occupy the same row.
    const r = renderGlyphChart({ marks: [glyphChartDot([1, 10, 100])], scales: { y: { type: "log" } } }, { width: 24, height: 8 });
    const rows = r.text.split("\n").flatMap((s, i) => s.includes("●") ? [i] : []);
    expect(rows).toHaveLength(3);
    expect(Math.abs((rows[1]! - rows[0]!) - (rows[2]! - rows[1]!))).toBeLessThanOrEqual(1);
  });
  it("2: sqrt [0,1,4] paints three equally spaced dot rows", () => {
    // Mutation: force sqrt to linear -> the middle dot sits at a quarter of the height.
    const r = renderGlyphChart({ marks: [glyphChartDot([0, 1, 4])], scales: { y: { type: "sqrt" } } }, { width: 24, height: 12 });
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
    expect(new Set(coloured.canvas.grid.color!.filter(Boolean)).size).toBe(2);
  });
  it("3: monochrome line styles cycle and dot series have distinct glyphs", () => {
    // Mutation: ignore styleIndex or dot-series identity -> all four pictures have one style.
    const rows = [1, 3, 5, 7].flatMap((y, i) => [0, 1].map((x) => ({ x, y, s: String(i) })));
    const r = renderGlyphChart(glyphChartLine(rows, { x: "x", y: "y", fill: "s" }), { width: 40, height: 14 });
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

    // Series identity when colour is suppressed vs. restored: `target:
    // "terminal"` defaults to `braille`, where identity is a distinct
    // SUB-CELL dot SHAPE (`SUBCELL_DOT_SHAPES` in `paint.ts`) rather than a
    // distinct whole-cell glyph — a lone dot (popcount 1, styleIndex 0) vs.
    // a 2-dot companion pair (popcount 2, styleIndex 1) once colour no
    // longer carries it. Scanned over the PLOT INTERIOR only (`layout.plot`,
    // via `picture`) — the whole grid also carries the axis lines' OWN
    // braille dots (unrelated series identity), and the companion dot can
    // legitimately land in the neighbouring cell rather than always sharing
    // its primary's cell, so this checks for the SHAPE's presence rather
    // than pinning one exact cell.
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
    expect(mono).toContain(1); // series "A" (styleIndex 0): a lone dot.
    expect(mono).toContain(2); // series "B" (styleIndex 1): a 2-dot companion pair.
    const coloured = plotPopcounts(picture(mark, 24, 10, true, "braille"));
    // Colour carries identity here, so every dot collapses to styleIndex 0 —
    // a lone dot, never the 2-dot companion shape.
    expect(coloured.every((n) => n === 1)).toBe(true);
  });
  it("3: area series boundaries retain their monochrome styles", () => {
    // Mutation: leave area styles unused -> both boundaries remain solid fill.
    const r = renderGlyphChart(glyphChartArea(categoricalSeriesData, { x: "x", y: "y", fill: "s" }), { width: 40, height: 14 });
    expect(r.meta.series).toEqual(["A", "B"]);
    expect(r.text).toContain("A"); expect(r.text).toContain("B");
    expect(r.text.split("\n").slice(0, -3).join("\n")).toMatch(/[-_‾▔]/);
  });
  it("3: an area boundary cycles the same line styles as the series legend", () => {
    // Mutation: ignore area styleIndex -> the dashed/dotted/double boundaries become solid.
    const data = [1, 3, 5, 7].flatMap((y, i) => [0, 1].map((x) => ({ x, y, s: String(i) })));
    const p = picture(glyphChartArea(data, { x: "x", y: "y", fill: "s" }), 40, 18);
    const rowAt = (v: number) => Array.from({ length: p.layout.plot.x1 - p.layout.plot.x0 + 1 }, (_, i) => p.at(p.layout.plot.x0 + i, scaleToRow(p.scales.y, p.layout.plot, v))).join("");
    expect(rowAt(3)).toContain("█──█──"); expect(rowAt(5)).toContain("·█·"); expect(rowAt(7)).toContain("══");
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
  it("5: signed cells at 24x6 use an ordered diverging shade ramp", () => {
    // Mutation: Math.abs(value) -> negative and positive endpoints get the same glyph.
    const p = picture(signedCells, 24, 6);
    expect(["a", "b", "c"].map((x) => p.atValue(x, "v"))).toEqual([" ", "▒", "█"]);
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
    expect(dots.grid.char.filter((c) => c === "o")).toHaveLength(2);
  });
  it("7: exact long band labels at 20x6 are abbreviated in slots, never clipped", () => {
    // Mutation: pass raw labels directly to canvas -> clipped middles, no abbreviation ledger.
    const r = renderGlyphChart(longBands, { width: 20, height: 6 });
    expect(r.text.split("\n").at(-1)).toMatch(/abc.*….*sec.*…/);
    expect(r.report.ledger.filter((s) => s.includes("abbreviated"))).toHaveLength(2);
  });
  it("7: two-hour time axis at 40x8 has distinct complete multi-scale labels", () => {
    // Mutation: fixed %b %d formatter -> repeated Jan 01 and clipped last label.
    const spec: GlyphChartSpec = { marks: [hourlyLine], scales: { x: { type: "time" } } };
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
      const ledger: string[] = [];
      const layout = layoutGlyphChart(spec, marks, { ...scales, x: crowded }, 40, 10, "auto", ledger);
      expect(layout.xTicks.length).toBeGreaterThan(0); expect(layout.xTicks.length).toBeLessThan(20);
      for (let i = 1; i < layout.xTicks.length; i++) expect(layout.xTicks[i]!.labelStart).toBeGreaterThan(layout.xTicks[i - 1]!.labelStart + layout.xTicks[i - 1]!.label.length);
      expect(ledger).toContainEqual(expect.stringContaining("ticks thinned"));
    }
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
    const r = renderGlyphChart(glyphChartLine([3, 5, 2, 8, 6, 9, 4, 7, 3, 5]), { target: "chat", charset: "braille", width: 44, height: 12 });
    const rows = r.text.split("\n");
    const axisLine = rows.find((row) => row.includes("─"))!;
    expect(axisLine).toBeDefined();
    expect(axisLine.trimStart()).toMatch(/^─+$/);
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
    const countFilled = (col: number) => { let n = 0; for (let y = p.layout.plot.y0; y <= p.layout.plot.y1; y++) if (p.at(col, y) === "█") n++; return n; };
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
    expect(p.ledger.some((l) => l.includes("do not fit"))).toBe(true);
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
    // never a bare "1"/"2" standing in for "1M"/"2M"/"1.5M".
    for (const t of p.layout.yTicks) expect(t.label).not.toMatch(/^\d$/);
    expect(p.ledger.some((l) => l.includes("dropped") && l.includes("1.5M") && l.includes("cannot be abbreviated"))).toBe(true);
    // Category labels are unaffected — still elided with an ellipsis.
    const bands = renderGlyphChart(longBands, { width: 20, height: 6 });
    expect(bands.report.ledger.some((l) => l.includes("abbreviated"))).toBe(true);
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
    expect(r.report.ledger.some((l) => l.startsWith("arc:") && l.includes("dropped"))).toBe(true);
  });

  it("P2-12a (one-liner): bandRowRange excludes the shared boundary row — adjacent row bands neither gap nor overlap", () => {
    // Mutation: drop the `+ 1` from `bandRowRange` (back to
    // `[Math.min(a,b), Math.max(a,b)]`) -> adjacent bands share a boundary
    // row -> red.
    const spec = glyphChartPlot({ marks: [glyphChartCell([{ k: "r0", v: 1 }, { k: "r1", v: 1 }, { k: "r2", v: 1 }], { x: "v", y: "k", fill: "v" })] });
    const marks = resolveGlyphChartSpec(spec);
    const scales = resolveGlyphChartScales(marks, spec.scales);
    const ledger: string[] = [];
    const layout = layoutGlyphChart(spec, marks, scales, 16, 12, "auto", ledger);
    const ranges = ["r0", "r1", "r2"].map((k) => bandRowRange(scales.y, layout.plot, k)!);
    for (let i = 0; i < ranges.length; i++) for (let j = i + 1; j < ranges.length; j++) {
      const [a0, a1] = ranges[i]!, [b0, b1] = ranges[j]!;
      expect(a1 < b0 || b1 < a0).toBe(true); // disjoint — no shared row.
    }
  });

  it("P2-12b (one-liner mutation-test gap): bandColRange's own '-1' band-exactness is now covered by a failing mutation", () => {
    // Mutation: drop the `- 1` from `bandColRange` (`fractionToCol(plot, hi)`
    // with no adjustment) -> adjacent column bands touch/overlap at their
    // shared boundary cell -> red. (Previously untested per the review's M2.)
    const spec = glyphChartPlot({ marks: [glyphChartBar([{ k: "a", v: 1 }, { k: "b", v: 2 }, { k: "c", v: 3 }], { x: "k", y: "v" })] });
    const marks = resolveGlyphChartSpec(spec);
    const scales = resolveGlyphChartScales(marks, spec.scales);
    const ledger: string[] = [];
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
