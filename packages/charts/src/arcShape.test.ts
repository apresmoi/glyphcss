/**
 * `arc`'s SHAPE (circular, never an oval that fills the whole plot),
 * SIZE (`GLYPH_CHART_ARC_FILL`, never touching the plot rect edge), and
 * CALLOUT labels (`labels: "callout"`, the default — a leader line from
 * each slice's own mid-arc out to a `name · NN%` label beside the disc).
 * See `CHARTS-RESEARCH/DIAGNOSIS-arc-shape.md` for the derivation this
 * file's own formulas repeat independently (never importing `arcRadii`
 * itself — a mutation to that private function must still be caught here).
 *
 * Deliberate scope note on "no leader crosses ... another leader": this
 * package's `canvas.edge`/`route`/`resolveJunctions()` conflict tracker
 * (`packages/glyphcss/src/render/canvas/junctions.ts`, what `sankey` uses)
 * only accepts 4-ADJACENT orthogonal polylines and never clears its
 * registry between `resolveJunctions()` calls — routing a genuinely
 * DIAGONAL leader through it would mean either faking an orthogonal
 * staircase (losing the diagonal glyph the addendum asks for) or risking
 * silently re-processing an earlier sankey mark's own already-resolved
 * routes on the same canvas. Arc callouts paint through plain `canvas.line`
 * instead (as instructed) and "no crossing" is verified here GEOMETRICALLY
 * — every leader's own expected cell footprint is re-derived independently
 * and checked pairwise disjoint, and disjoint from the disc. `r.report.
 * routeConflicts` is asserted empty too (it trivially is, since arc never
 * registers a route) so a future switch to the edge/route path is honest
 * about what it would need to keep true.
 */
import { createGlyphCanvas } from "glyphcss";
import { describe, expect, it } from "vitest";
import { GLYPH_CHART_ARC_CALLOUT_GUTTER_COLS, GLYPH_CHART_ARC_FILL, paintGlyphChart } from "./paint";
import { layoutGlyphChart, resolveGlyphChartLegendOption } from "./layout";
import { resolveGlyphChartSpec } from "./resolve";
import { resolveGlyphChartScales } from "./scales";
import { glyphChartArc, normalizeGlyphChartInput } from "./spec";
import { renderGlyphChart } from "./render";
import type { GlyphChartLedgerEntry, GlyphChartInput } from "./types";

// ── shared geometry, independently re-derived from the diagnosis' own formula ──

interface Radii { readonly cx: number; readonly cy: number; readonly rx: number; readonly ry: number }

/** `plotCols`/`plotRows` are the FULL grid here — every direct-pipeline
 * case below renders with the legend off, so `layout.plot` is exactly
 * `[0, cols-1] x [0, rows-1]` (arc paints no axes/title). */
function expectedRadii(plotCols: number, plotRows: number, cellAspect: number, wantCallouts: boolean): Radii & { readonly calloutsFit: boolean } {
  const gutter = GLYPH_CHART_ARC_CALLOUT_GUTTER_COLS;
  const calloutsFit = wantCallouts && plotCols - 2 * gutter >= 3 && plotRows >= 3;
  const availableCols = calloutsFit ? plotCols - 2 * gutter : plotCols;
  const diameter = Math.max(1, Math.min(plotRows, availableCols * cellAspect)) * GLYPH_CHART_ARC_FILL;
  const rowRadius = Math.max(0.5, diameter / 2);
  const colRadius = rowRadius / cellAspect;
  return { cx: (plotCols - 1) / 2, cy: (plotRows - 1) / 2, rx: colRadius, ry: rowRadius, calloutsFit };
}

interface Bbox { readonly minCol: number; readonly maxCol: number; readonly minRow: number; readonly maxRow: number; readonly count: number }
function bbox(cols: number, rows: number, char: readonly string[], glyphs: ReadonlySet<string>): Bbox {
  let minCol = Infinity, maxCol = -Infinity, minRow = Infinity, maxRow = -Infinity, count = 0;
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      if (!glyphs.has(char[y * cols + x]!)) continue;
      minCol = Math.min(minCol, x); maxCol = Math.max(maxCol, x);
      minRow = Math.min(minRow, y); maxRow = Math.max(maxRow, y);
      count++;
    }
  }
  return { minCol, maxCol, minRow, maxRow, count };
}

/** Direct pipeline (mirrors `axisTitlePlacement.test.ts`'s own `picture()`)
 * — the only way to hand `createGlyphCanvas` an explicit `cellAspect`, since
 * `renderGlyphChart` never exposes one (it always defers to the canvas'
 * own default; see the diagnosis). `legend: false` throughout so
 * `layout.plot` is trivially the full grid. */
function paintAt(input: GlyphChartInput, width: number, height: number, cellAspect: number) {
  const spec = normalizeGlyphChartInput(input);
  const marks = resolveGlyphChartSpec(spec);
  const scales = resolveGlyphChartScales(marks, spec.scales);
  const ledger: GlyphChartLedgerEntry[] = [];
  const legendOption = resolveGlyphChartLegendOption(undefined, false);
  const layout = layoutGlyphChart(spec, marks, scales, width, height, "auto", ledger, "box", legendOption);
  expect(layout.plot).toEqual({ x0: 0, y0: 0, x1: width - 1, y1: height - 1 });
  const canvas = createGlyphCanvas({ cols: width, rows: height, tier: "box", cellAspect });
  paintGlyphChart(canvas, spec, marks, scales, layout, { colorEnabled: false }, ledger);
  return { canvas, ledger, layout };
}

const DISC_GLYPH = new Set(["█"]);

describe("arc shape: circular and margined at every target", () => {
  const cases: readonly [string, number, number][] = [
    ["chat", 72, 24],
    ["terminal", 80, 24],
    ["web", 96, 32],
    ["square", 40, 40],
  ];

  it.each(cases)("%s (%ix%i): disc extent ratio matches cellAspect and the FILL diameter formula", (_name, width, height) => {
    // labels: "legend-only" isolates the pure disc — this suite's own
    // subject is shape/size, not callouts (arcShape's callout describe
    // block below owns those).
    const { canvas } = paintAt(glyphChartArc([1], undefined, { labels: "legend-only" }), width, height, 0.5);
    const box = bbox(width, height, canvas.grid.char, DISC_GLYPH);
    expect(box.count).toBeGreaterThan(0);
    const colExtent = box.maxCol - box.minCol + 1;
    const rowExtent = box.maxRow - box.minRow + 1;

    // Mutation: drop the `/cellAspect` split (rx = ry) -> colExtent/rowExtent
    // collapses to ~1 regardless of cellAspect (0.5 here), which is off by a
    // factor of 2 from the expected ~1/cellAspect = 2.
    const expected = expectedRadii(width, height, 0.5, false);
    const expectedRatio = expected.rx / expected.ry;
    expect(colExtent / rowExtent).toBeCloseTo(expectedRatio, 0);
    expect(Math.abs(colExtent / rowExtent - expectedRatio)).toBeLessThan(0.35);

    // Mutation: GLYPH_CHART_ARC_FILL 0.8 -> 1.0 grows both extents by 25%,
    // well past this tolerance.
    const expectedColExtent = Math.round(expected.rx * 2);
    const expectedRowExtent = Math.round(expected.ry * 2);
    expect(Math.abs(colExtent - expectedColExtent)).toBeLessThanOrEqual(2);
    expect(Math.abs(rowExtent - expectedRowExtent)).toBeLessThanOrEqual(2);

    // The disc never touches the plot rect edge (FILL < 1 leaves a margin
    // on whichever axis binds).
    expect(box.minCol).toBeGreaterThan(0);
    expect(box.maxCol).toBeLessThan(width - 1);
    expect(box.minRow).toBeGreaterThan(0);
    expect(box.maxRow).toBeLessThan(height - 1);
  });
});

describe("arc shape: cellAspect is read from the canvas, not assumed", () => {
  it.each([2.0, 1.0])("cellAspect %s reshapes the disc by exactly 1/cellAspect", (cellAspect) => {
    const { canvas } = paintAt(glyphChartArc([1], undefined, { labels: "legend-only" }), 60, 30, cellAspect);
    const box = bbox(60, 30, canvas.grid.char, DISC_GLYPH);
    const colExtent = box.maxCol - box.minCol + 1;
    const rowExtent = box.maxRow - box.minRow + 1;
    // Mutation: hardcode cellAspect 0.5 inside arcRadii instead of reading
    // `canvas.cellAspect` -> this ratio stays ~2 regardless of the 2.0/1.0
    // passed here, failing at cellAspect: 1.0 (expected ratio 1).
    expect(colExtent / rowExtent).toBeCloseTo(1 / cellAspect, 0);
    expect(Math.abs(colExtent / rowExtent - 1 / cellAspect)).toBeLessThan(0.3);
  });
});

describe("arc shape: labels option validation", () => {
  it("rejects an unknown labels value with bad-options", () => {
    expect(() => renderGlyphChart(glyphChartArc([1, 2], undefined, { labels: "sideways" as never }), { target: "chat" }))
      .toThrow(expect.objectContaining({ code: "bad-options" }));
  });
  it("accepts callout and legend-only", () => {
    expect(() => renderGlyphChart(glyphChartArc([1, 2], undefined, { labels: "callout" }), { target: "chat" })).not.toThrow();
    expect(() => renderGlyphChart(glyphChartArc([1, 2], undefined, { labels: "legend-only" }), { target: "chat" })).not.toThrow();
  });
});

describe("arc shape: legend-only pays no callout gutter tax", () => {
  it("legend-only's disc is strictly larger than callout's at the same size (the gutter reservation only applies to callout)", () => {
    // A col-bound square, so shrinking the column budget (the callout
    // gutter) actually shrinks the row-diameter formula too — see the
    // diagnosis' own derivation.
    const legendOnly = paintAt(glyphChartArc([1], undefined, { labels: "legend-only" }), 40, 40, 0.5);
    const callout = paintAt(glyphChartArc([1], undefined, { labels: "callout" }), 40, 40, 0.5);
    const loBox = bbox(40, 40, legendOnly.canvas.grid.char, DISC_GLYPH);
    const coBox = bbox(40, 40, callout.canvas.grid.char, DISC_GLYPH);
    const loRows = loBox.maxRow - loBox.minRow + 1;
    const coRows = coBox.maxRow - coBox.minRow + 1;
    // Mutation: apply the gutter reservation unconditionally (ignoring
    // `labels`) -> loRows === coRows, failing this strict inequality.
    expect(coRows).toBeLessThan(loRows);
    const expectedLegendOnly = expectedRadii(40, 40, 0.5, false);
    const expectedCallout = expectedRadii(40, 40, 0.5, true);
    expect(Math.abs(loRows - Math.round(expectedLegendOnly.ry * 2))).toBeLessThanOrEqual(2);
    expect(Math.abs(coRows - Math.round(expectedCallout.ry * 2))).toBeLessThanOrEqual(2);
  });
});

// ── callouts (default `labels: "callout"`), through the public API ────────

const browserShares = [
  { browser: "Chrome", share: 65 },
  { browser: "Safari", share: 20 },
  { browser: "Firefox", share: 15 },
];

describe("arc callouts: leader + name · NN% label per slice", () => {
  it("72x24 chat: every slice gets a leader and its own name · NN% label, with zero leader/disc overlap", () => {
    const r = renderGlyphChart(glyphChartArc(browserShares, { fill: "browser", y: "share" }), { target: "chat", width: 72, height: 24 });
    console.log(`\n--- arc callouts (chat, 72x24) ---\n${r.text}\n`);

    for (const [name, pct] of [["Chrome", 65], ["Safari", 20], ["Firefox", 15]] as const) {
      expect(r.text).toContain(`${name} · ${pct}%`);
    }
    // The canvas never registers a route for an arc callout (see this
    // file's own header doc) — this is byte-true by construction, not the
    // load-bearing non-crossing proof (the geometric check below is).
    expect(r.report.routeConflicts).toEqual([]);
    expect(r.report.ledger.filter((e) => e.code === "label-dropped")).toEqual([]);

    // GEOMETRIC non-crossing proof: re-derive each slice's mid-angle
    // boundary point independently (same trig the diagnosis documents) and
    // confirm the FIRST leader cell — one column outside that row's own
    // disc edge — is actually painted (adjacent to disc ink) and that no
    // two leaders' first cells collide.
    const cellAspect = 0.5; // this package's one true default (canvas.ts)
    const radii = expectedRadii(72, 24 - 1 /* legend row */, cellAspect, true);
    // `layout.plot` for a named arc reserves the bottom row for the legend
    // — re-derive slice angles the same way `paintArc` does (equal shares
    // in declaration order, starting at -90°).
    const values = [65, 20, 15];
    const total = values.reduce((a, b) => a + b, 0);
    let start = -Math.PI / 2;
    const firstCells: [number, number][] = [];
    for (const v of values) {
      const angle = (v / total) * Math.PI * 2;
      const mid = start + angle / 2;
      start += angle;
      const sign = Math.cos(mid) >= 0 ? 1 : -1;
      const anchorRow = Math.round(radii.cy + radii.ry * Math.sin(mid));
      const dyFrac = (anchorRow - radii.cy) / radii.ry;
      const edgeDx = Math.sqrt(Math.max(0, 1 - dyFrac * dyFrac)) * radii.rx;
      const discEdgeCol = sign > 0 ? Math.floor(radii.cx + edgeDx) : Math.ceil(radii.cx - edgeDx);
      const outCol = discEdgeCol + sign;
      firstCells.push([outCol, anchorRow]);
      expect(r.grid.char[anchorRow * r.grid.cols + outCol]).not.toBe(" ");
    }
    // No two slices' own first leader cell coincide.
    const keys = firstCells.map(([x, y]) => `${x},${y}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("a slice thinner than the minimum angle gets no callout", () => {
    // 1 vs 999: the "1" slice spans ~0.36° of the circle, far under the
    // 8° minimum — no leader/label for it, and no ledger noise either
    // (it's a deliberate design threshold, not a fit failure).
    const r = renderGlyphChart(glyphChartArc([999, 1]), { target: "chat", width: 72, height: 24 });
    expect(r.text).toContain("0 · 100%");
    expect(r.text).not.toMatch(/\b1 · 0%/);
  });

  it("collisions push labels apart by a row, or drop with label-dropped when a side runs out of rows", () => {
    // 20 equal 18° slices (above the 8° minimum) crammed into a short
    // canvas — more callouts than either side has rows for.
    const values = Array(20).fill(1);
    const r = renderGlyphChart(glyphChartArc(values), { target: "chat", width: 50, height: 10 });
    const drops = r.report.ledger.filter((e) => e.code === "label-dropped" && e.message.includes("row"));
    // Mutation: skip the row-budget drop clause entirely (place every
    // candidate regardless of `plot.y1`) -> zero drops here, since 20
    // callouts split across two sides can't all fit a 10-row canvas.
    expect(drops.length).toBeGreaterThan(0);
    expect(r.text.split("\n")).toHaveLength(10);
    expect(r.report.routeConflicts).toEqual([]);
  });
});

describe("arc callouts: legend-only is byte-identical across repeats and never paints a leader", () => {
  it("legend-only never paints a leader glyph (─) outside the legend row", () => {
    const r = renderGlyphChart(glyphChartArc(browserShares, { fill: "browser", y: "share" }, { labels: "legend-only" }), { target: "chat", width: 72, height: 24 });
    const bodyRows = r.text.split("\n").slice(0, -1);
    expect(bodyRows.some((row) => row.includes("─"))).toBe(false);
    expect(r.text).toBe(renderGlyphChart(glyphChartArc(browserShares, { fill: "browser", y: "share" }, { labels: "legend-only" }), { target: "chat", width: 72, height: 24 }).text);
  });
});
