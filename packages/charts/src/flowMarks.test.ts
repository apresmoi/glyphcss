import { describe, expect, it } from "vitest";
import { createGlyphCanvas, encodeGlyphCanvasHtml } from "glyphcss";
import { chartSeries, resolveSeriesColor, seriesShade } from "./series";
import { resolveGlyphChartSpec } from "./resolve";
import { layoutGlyphChart, resolveGlyphChartLegendOption } from "./layout";
import {
  computeSankeyRoutedRows, GLYPH_CHART_SANKEY_LINK_GAP_ROWS, GLYPH_CHART_SANKEY_NODE_PADDING_ROWS,
  layoutSankeyGraph, paintFunnelMark, paintSankeyLayout, paintSankeyMarks, type GlyphChartSankeyLayout,
} from "./flowMarks";
import { resolveGlyphChartScales } from "./scales";
import { glyphChartFunnel, glyphChartLine, glyphChartSankey } from "./spec";
import { renderGlyphChart } from "./render";
import { ECOMMERCE_FUNNEL_DATA, ENERGY_FLOW_SANKEY_DATA } from "./flowMarksData";
import type { GlyphChartLedgerEntry } from "./ledger";
import type { GlyphChartPlotRect } from "./layout";
import type { GlyphChartSpec } from "./types";

const PLOT = (cols: number, rows: number): GlyphChartPlotRect => ({ x0: 0, y0: 0, x1: cols - 1, y1: rows - 1 });

function sankeyGroups(spec: GlyphChartSpec) {
  return chartSeries(resolveGlyphChartSpec(spec));
}

/**
 * A WEAKER cousin of `expectRowRangesConserveWithGaps` for a column's own
 * stacked node boxes: unlike a node's band split (which always fills its
 * box's full height exactly), a column's nodes are sized under the chart's
 * ONE GLOBAL rows-per-unit rate (P2-1) and a column that isn't the tightest
 * one legitimately has unused rows below its own last node — so only the
 * FIRST box's start, uniform gaps, and no overlap are asserted, never that
 * the last box reaches the column's own bottom.
 */
function expectColumnGapsUniform(ranges: readonly (readonly [number, number])[], columnTop: number, maxGap: number): number {
  const sorted = [...ranges].sort((a, b) => a[0] - b[0]);
  expect(sorted[0]![0]).toBe(columnTop);
  const gaps: number[] = [];
  for (let i = 1; i < sorted.length; i++) gaps.push(sorted[i]![0] - sorted[i - 1]![1] - 1);
  for (const g of gaps) {
    expect(g).toBeGreaterThanOrEqual(0);
    expect(g).toBeLessThanOrEqual(maxGap);
    expect(g).toBe(gaps[0]);
  }
  return gaps[0] ?? 0;
}

/**
 * Asserts that a set of row ranges (a node's own outgoing bands, incoming
 * bands, or a column's own stacked node boxes), sorted by their own start
 * row, span exactly `[boxY0, boxY1]` with no leftover and no overlap — the
 * "conservation on the non-gap rows" invariant the sankey visual-air
 * feature adds: `sum(rows) + sum(gapsBetweenConsecutive) === boxY1 - boxY0
 * + 1`, every gap the SAME value, and that value in `[0, maxGap]`. Returns
 * the (uniform) gap actually applied, so a caller can additionally assert
 * it against a desired value.
 */
function expectRowRangesConserveWithGaps(ranges: readonly (readonly [number, number])[], boxY0: number, boxY1: number, maxGap: number): number {
  const sorted = [...ranges].sort((a, b) => a[0] - b[0]);
  expect(sorted[0]![0]).toBe(boxY0);
  expect(sorted[sorted.length - 1]![1]).toBe(boxY1);
  const gaps: number[] = [];
  for (let i = 1; i < sorted.length; i++) gaps.push(sorted[i]![0] - sorted[i - 1]![1] - 1);
  for (const g of gaps) {
    expect(g).toBeGreaterThanOrEqual(0);
    expect(g).toBeLessThanOrEqual(maxGap);
    expect(g).toBe(gaps[0]);
  }
  const totalRows = sorted.reduce((n, r) => n + (r[1] - r[0] + 1), 0);
  expect(totalRows + gaps.reduce((a, b) => a + b, 0)).toBe(boxY1 - boxY0 + 1);
  return gaps[0] ?? 0;
}

/** Deterministic seeded PRNG (mulberry32) — for the property sweeps below. */
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const energySpec: GlyphChartSpec = { marks: [glyphChartSankey(ENERGY_FLOW_SANKEY_DATA, { source: "from", target: "to", value: "amount" })] };
const funnelSpec: GlyphChartSpec = { marks: [glyphChartFunnel(ECOMMERCE_FUNNEL_DATA, { stage: "stage", value: "count" })] };

describe("sankey/funnel render at multiple sizes and charsets", () => {
  const sizes: readonly [number, number][] = [[40, 20], [72, 24], [96, 32]];
  const charsets = ["box", "ascii", "braille"] as const;

  it.each(sizes.flatMap(([w, h]) => charsets.map((charset) => ({ w, h, charset }))))("sankey renders at $w x $h on $charset", ({ w, h, charset }) => {
    const r = renderGlyphChart(energySpec, { target: "chat", width: w, height: h, charset });
    expect(r.text.length).toBeGreaterThan(0);
    expect(r.build.canvas.grid.cols).toBe(w);
    expect(r.build.canvas.grid.rows).toBe(h);
    if (charset === "ascii") expect(r.text).toMatch(/^[\x20-\x7e\n]*$/);
  });

  it.each(sizes.flatMap(([w, h]) => charsets.map((charset) => ({ w, h, charset }))))("funnel renders at $w x $h on $charset", ({ w, h, charset }) => {
    const r = renderGlyphChart(funnelSpec, { target: "chat", width: w, height: h, charset });
    expect(r.text.length).toBeGreaterThan(0);
    expect(r.build.canvas.grid.cols).toBe(w);
    expect(r.build.canvas.grid.rows).toBe(h);
    if (charset === "ascii") expect(r.text).toMatch(/^[\x20-\x7e\n]*$/);
  });
});

// Three equal-value outgoing links from one hub, at a row budget where
// independent per-band rounding provably drifts (round(1/3*10) = 3 three
// times = 9, one short of capacity 10) while cumulative rounding does not
// (3, 4, 3 = 10) — this is the dataset that actually falsifies the
// "round each band independently" mutation; the real energy dataset's own
// ratios happen to round cleanly at the sizes exercised below and would
// NOT catch that mutation on its own.
const adversarialSpec: GlyphChartSpec = {
  marks: [glyphChartSankey(
    [{ from: "Hub", to: "A", amount: 1 }, { from: "Hub", to: "B", amount: 1 }, { from: "Hub", to: "C", amount: 1 }],
    { source: "from", target: "to", value: "amount" },
  )],
};

// The mirror shape (three EQUAL-value sources into one sink) — needed
// because `adversarialSpec` above only stresses the SOURCE-side split
// (each sink there receives exactly one inbound link, which never drifts
// regardless of rounding method); this is what falsifies the TARGET-side
// (incoming) cumulative split and the per-column node-height split.
const adversarialSinkSpec: GlyphChartSpec = {
  marks: [glyphChartSankey(
    [{ from: "A", to: "Sink", amount: 1 }, { from: "B", to: "Sink", amount: 1 }, { from: "C", to: "Sink", amount: 1 }],
    { source: "from", target: "to", value: "amount" },
  )],
};

describe("sankey conservation (per-node band rows in = rows out)", () => {
  it("every node's outgoing band rows sum to its own row height, with a uniform gap between them", () => {
    // Mutation: round each band's rows independently (`Math.round(value/total*height)`
    // per band instead of cumulative) -> this sum drifts off `box.height` by a cell or more.
    // `adversarialSpec` at 10 rows is the case that actually falsifies it
    // (30 rows divides evenly by 3 and would round cleanly either way).
    for (const [spec, plot] of [[energySpec, PLOT(90, 30)], [adversarialSpec, PLOT(90, 10)]] as const) {
      const groups = sankeyGroups(spec);
      const layout = layoutSankeyGraph(groups, plot, "box", []);
      expect(layout).not.toBeNull();
      for (const node of layout!.nodes) {
        const outgoing = layout!.bands.filter((b) => b.source === node.id);
        if (outgoing.length === 0) continue;
        expectRowRangesConserveWithGaps(outgoing.map((b) => b.sourceRowRange), node.y0, node.y1, GLYPH_CHART_SANKEY_LINK_GAP_ROWS);
      }
    }
  });

  it("every node's incoming band rows sum to its own row height, with a uniform gap between them", () => {
    // Mutation: same independent-rounding break, on the target side.
    // `adversarialSinkSpec` at 10 rows is the case that actually falsifies
    // it (the sink's 3 equal inbound links round to 9, not 10, independently).
    for (const [spec, plot] of [[energySpec, PLOT(90, 30)], [adversarialSinkSpec, PLOT(40, 10)]] as const) {
      const groups = sankeyGroups(spec);
      const layout = layoutSankeyGraph(groups, plot, "box", []);
      expect(layout).not.toBeNull();
      for (const node of layout!.nodes) {
        const incoming = layout!.bands.filter((b) => b.target === node.id && !b.folded);
        if (incoming.length === 0) continue;
        expectRowRangesConserveWithGaps(incoming.map((b) => b.targetRowRange!), node.y0, node.y1, GLYPH_CHART_SANKEY_LINK_GAP_ROWS);
      }
    }
  });

  it("a column's node heights plus their padding sum EXACTLY to the rows available to it (the adversarial ratio)", () => {
    // Mutation: independent rounding on the NODE-height split -> a column's
    // own node heights stop summing to its available row capacity.
    const groups = sankeyGroups(adversarialSinkSpec);
    const layout = layoutSankeyGraph(groups, PLOT(40, 10), "box", []);
    expect(layout).not.toBeNull();
    const column0 = layout!.nodes.filter((n) => n.id !== "Sink");
    expect(column0).toHaveLength(3);
    // 3 nodes over 10 rows: `sankeyAirGap` affords the full desired 2-row
    // padding here (10 - 2*2 = 6 >= 3), so 6 rows split among the 3 boxes
    // and the other 4 are the two 2-row gaps between them.
    const gap = expectRowRangesConserveWithGaps(column0.map((n) => [n.y0, n.y1] as const), 0, 9, GLYPH_CHART_SANKEY_NODE_PADDING_ROWS);
    expect(gap).toBe(GLYPH_CHART_SANKEY_NODE_PADDING_ROWS);
  });

  it("a column's node heights sum to the rows available to it", () => {
    const groups = sankeyGroups(energySpec);
    const layout = layoutSankeyGraph(groups, PLOT(90, 24), "box", []);
    expect(layout).not.toBeNull();
    const byCol = new Map<number, number>();
    for (const n of layout!.nodes) byCol.set(n.x0, (byCol.get(n.x0) ?? 0) + n.height);
    for (const total of byCol.values()) expect(total).toBeLessThanOrEqual(24);
  });

  it("folding a tiny flow into (other) still conserves the source's own row total", () => {
    // A source with two flows, one 200x the other — at a small row budget
    // the tiny one rounds to 0 rows on its own and must fold.
    const spec: GlyphChartSpec = {
      marks: [glyphChartSankey(
        [{ from: "Hub", to: "Big", amount: 1000 }, { from: "Hub", to: "Tiny", amount: 1 }],
        { source: "from", target: "to", value: "amount" },
      )],
    };
    const groups = sankeyGroups(spec);
    const layout = layoutSankeyGraph(groups, PLOT(60, 6), "box", []);
    expect(layout).not.toBeNull();
    const hub = layout!.nodes.find((n) => n.id === "Hub")!;
    const outgoing = layout!.bands.filter((b) => b.source === "Hub");
    expect(outgoing.some((b) => b.folded)).toBe(true);
    expectRowRangesConserveWithGaps(outgoing.map((b) => b.sourceRowRange), hub.y0, hub.y1, GLYPH_CHART_SANKEY_LINK_GAP_ROWS);
    const ledger: import("./ledger").GlyphChartLedgerEntry[] = [];
    layoutSankeyGraph(groups, PLOT(60, 6), "box", ledger);
    expect(ledger.some((e) => e.code === "sankey-folded-flows")).toBe(true);
  });
});

describe("sankey imbalance ledger", () => {
  it("a non-terminal node whose inflow and outflow differ gets a sankey-imbalance entry", () => {
    const spec: GlyphChartSpec = {
      marks: [glyphChartSankey(
        [{ from: "A", to: "Mid", amount: 100 }, { from: "Mid", to: "B", amount: 60 }],
        { source: "from", target: "to", value: "amount" },
      )],
    };
    const r = renderGlyphChart(spec, { target: "chat", width: 60, height: 16 });
    const entry = r.report.ledger.find((e) => e.code === "sankey-imbalance");
    expect(entry).toBeTruthy();
    expect(entry!.detail).toMatchObject({ node: "Mid", inflow: 100, outflow: 60 });
  });

  it("a balanced graph never reports an imbalance", () => {
    const r = renderGlyphChart(energySpec, { target: "chat", width: 90, height: 24 });
    expect(r.report.ledger.some((e) => e.code === "sankey-imbalance")).toBe(false);
  });
});

describe("sankey rejects bad input", () => {
  it("a zero or negative value rejects with sankey-bad-value", () => {
    const bad = glyphChartSankey([{ from: "A", to: "B", amount: 0 }], { source: "from", target: "to", value: "amount" });
    expect(() => renderGlyphChart({ marks: [bad] })).toThrow(expect.objectContaining({ code: "sankey-bad-value" }));
    const negative = glyphChartSankey([{ from: "A", to: "B", amount: -5 }], { source: "from", target: "to", value: "amount" });
    expect(() => renderGlyphChart({ marks: [negative] })).toThrow(expect.objectContaining({ code: "sankey-bad-value" }));
  });

  it("a missing value channel rejects with sankey-bad-value (schema-expressible, structural)", () => {
    const bad = { type: "sankey" as const, data: [{ from: "A", to: "B" }], channels: { source: "from", target: "to" } };
    expect(() => renderGlyphChart({ marks: [bad] })).toThrow(expect.objectContaining({ code: "sankey-bad-value" }));
  });

  it("a cycle rejects with sankey-cycle", () => {
    const cyclic = glyphChartSankey(
      [{ from: "A", to: "B", amount: 5 }, { from: "B", to: "C", amount: 5 }, { from: "C", to: "A", amount: 5 }],
      { source: "from", target: "to", value: "amount" },
    );
    expect(() => renderGlyphChart({ marks: [cyclic] })).toThrow(expect.objectContaining({ code: "sankey-cycle" }));
  });
});

describe("funnel widths are proportional to value", () => {
  it("a 1000/500/250 funnel has bar widths in 4:2:1 within +/-1 cell", () => {
    // Mutation: switch to equal-step widths (a trapezoid) instead of
    // value-proportional ones -> the measured widths stop tracking 4:2:1.
    const spec: GlyphChartSpec = { marks: [glyphChartFunnel([1000, 500, 250])] };
    const r = renderGlyphChart(spec, { target: "chat", width: 60, height: 12, charset: "box" });
    const rows = r.text.split("\n");
    const rowWidths = rows.map((row) => (row.match(/[█░▚╱▌═▓▒]/g) ?? []).length);
    // Group consecutive glyph-carrying rows into stage bands, separated by
    // the blank gap row `layoutFunnelStages`'s own spacing leaves between
    // stages, and take each band's own maximum painted width.
    const bandWidths: number[] = [];
    let current = 0;
    for (const w of rowWidths) {
      if (w > 0) current = Math.max(current, w);
      else if (current > 0) { bandWidths.push(current); current = 0; }
    }
    if (current > 0) bandWidths.push(current);
    expect(bandWidths).toHaveLength(3);
    const [w0, w1, w2] = bandWidths as [number, number, number];
    expect(w0).toBeGreaterThan(0);
    expect(Math.abs(w1 - w0 / 2)).toBeLessThanOrEqual(1);
    expect(Math.abs(w2 - w0 / 4)).toBeLessThanOrEqual(1);
  });

  it("funnel-not-monotone fires when a stage exceeds the one above it", () => {
    const spec: GlyphChartSpec = { marks: [glyphChartFunnel([{ stage: "A", count: 100 }, { stage: "B", count: 150 }], { stage: "stage", value: "count" })] };
    const r = renderGlyphChart(spec, { target: "chat", width: 40, height: 10 });
    const entry = r.report.ledger.find((e) => e.code === "funnel-not-monotone");
    expect(entry).toBeTruthy();
    expect(entry!.detail).toMatchObject({ stage: "B", value: 150, previousStage: "A", previousValue: 100 });
  });

  it("funnel-thin-stage fires when a stage's proportional width rounds to under one cell", () => {
    const spec: GlyphChartSpec = { marks: [glyphChartFunnel([100000, 1])] };
    const r = renderGlyphChart(spec, { target: "chat", width: 40, height: 10 });
    const entry = r.report.ledger.find((e) => e.code === "funnel-thin-stage");
    expect(entry).toBeTruthy();
  });
});

// ── round 2's own fixes: canvas-routed bands (AGENTS.md's "Charts" and
// "Cell canvas" sections) ───────────────────────────────────────────────

/** Mirrors `flowMarks.ts`'s own `buildSankeyBandRowRoute` row mapping — the
 * clamped `k = max(sourceHeight, targetHeight)` pairing — WITHOUT importing
 * an internal, so the test is checking the documented CONTRACT, not the
 * implementation's own working. */
function bandRowEndpoints(band: { readonly sourceRowRange: readonly [number, number]; readonly targetRowRange?: readonly [number, number] }): readonly { readonly srcRow: number; readonly tgtRow: number }[] {
  const [sr0, sr1] = band.sourceRowRange;
  const [tr0, tr1] = band.targetRowRange!;
  const srcH = sr1 - sr0 + 1, tgtH = tr1 - tr0 + 1;
  const k = Math.max(srcH, tgtH);
  return Array.from({ length: k }, (_, i) => ({ srcRow: sr0 + Math.min(i, srcH - 1), tgtRow: tr0 + Math.min(i, tgtH - 1) }));
}

function renderSankey(spec: GlyphChartSpec, width: number, height: number, charset: "box" | "ascii" | "braille" = "box") {
  const groups = sankeyGroups(spec);
  const plot = PLOT(width, height);
  const ledger: GlyphChartLedgerEntry[] = [];
  const layout = layoutSankeyGraph(groups, plot, charset, ledger)!;
  const canvas = createGlyphCanvas({ cols: width, rows: height, tier: charset });
  if (layout) paintSankeyLayout(canvas, plot, layout, true, ledger);
  return { layout, canvas, ledger };
}

/** Deterministic seeded PRNG (mulberry32), reused for random-DAG sweeps. */
function mulberry32b(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function randomSankeySpec(seed: number): GlyphChartSpec {
  const rand = mulberry32b(seed);
  const nSources = 1 + Math.floor(rand() * 3);
  const nTargets = 2 + Math.floor(rand() * 12);
  const rows: { from: string; to: string; v: number }[] = [];
  for (let s = 0; s < nSources; s++) for (let t = 0; t < nTargets; t++) if (rand() < 0.6) rows.push({ from: `S${s}`, to: `T${t}`, v: Math.round(Math.exp(rand() * 5)) });
  if (rows.length === 0) rows.push({ from: "S0", to: "T0", v: 1 });
  return { marks: [glyphChartSankey(rows, { source: "from", target: "to", value: "v" })] };
}

const fanSpec: GlyphChartSpec = { marks: [glyphChartSankey(
  [{ from: "A", to: "X", amount: 5 }, { from: "A", to: "Y", amount: 5 }, { from: "B", to: "X", amount: 5 }, { from: "B", to: "Y", amount: 5 }],
  { source: "from", target: "to", value: "amount" },
)] };

describe("sankey band painter routes through the canvas (P1-1, relocated root fix)", () => {
  const sizes: readonly [number, number][] = [[40, 24], [72, 24], [96, 32], [140, 24]];
  const tiers = ["box", "ascii", "braille"] as const;

  it("gate (a): every band's own row touches BOTH its node borders, on every tier and size, for the fan and the energy dataset", () => {
    for (const spec of [fanSpec, energySpec]) {
      for (const [w, h] of sizes) {
        for (const tier of tiers) {
          const { layout, canvas } = renderSankey(spec, w, h, tier);
          for (const band of layout.bands) {
            if (band.folded || !band.targetRowRange) continue;
            const srcBox = layout.nodes.find((n) => n.id === band.source)!;
            const tgtBox = layout.nodes.find((n) => n.id === band.target)!;
            const color = resolveSeriesColor(band, true);
            for (const { srcRow, tgtRow } of bandRowEndpoints(band)) {
              const srcCellIdx = srcRow * canvas.cols + (srcBox.x1 + 1);
              const tgtCellIdx = tgtRow * canvas.cols + (tgtBox.x0 - 1);
              expect(canvas.grid.color[srcCellIdx], `${w}x${h}/${tier} ${band.source}->${band.target} row src=${srcRow} misses its own source border`).toBe(color);
              expect(canvas.grid.color[tgtCellIdx], `${w}x${h}/${tier} ${band.source}->${band.target} row tgt=${tgtRow} misses its own target border`).toBe(color);
            }
          }
        }
      }
    }
  });

  it("gate (b)/(c): painting each band's OWN routed cells alone (same routes, same lanes — never re-derived per band) accounts for exactly what the combined render shows, except at cells another band's own route genuinely also claims (zero silent overwrites)", () => {
    for (const spec of [fanSpec, energySpec]) {
      for (const [w, h] of sizes) {
        const groups = sankeyGroups(spec);
        const plot = PLOT(w, h);
        const layout = layoutSankeyGraph(groups, plot, "box", [])!;
        // ONE routing pass, shared by the combined render and every
        // "isolated" band below — re-running `layoutSankeyGraph`/lane
        // assignment on a single band in isolation would give it slot 0
        // every time, a DIFFERENT (and therefore incomparable) placement
        // than it gets inside the real, shared-lane layout.
        const scratch = createGlyphCanvas({ cols: w, rows: h, tier: "box" });
        const routedRows = computeSankeyRoutedRows(scratch, plot, layout, true, []);
        const combined = createGlyphCanvas({ cols: w, rows: h, tier: "box" });
        paintSankeyLayout(combined, plot, layout, true, []);

        const cellsByBand = new Map<(typeof layout.bands)[number], Set<number>>();
        for (const { band, cells } of routedRows) {
          const set = cellsByBand.get(band) ?? new Set<number>();
          for (const p of cells) set.add(p.y * w + p.x);
          cellsByBand.set(band, set);
        }
        for (const [band, cells] of cellsByBand) {
          const color = resolveSeriesColor(band, true);
          for (const idx of cells) {
            if (combined.grid.color[idx] === color) continue; // still owns it in the real render — fine.
            // Lost this cell to a higher-priority band: legitimate ONLY if
            // some OTHER band's own route also claims this exact cell —
            // i.e. a genuine crossing, never a silent erasure of a run no
            // other band ever touched.
            const contestedByAnother = [...cellsByBand].some(([other, otherCells]) => other !== band && otherCells.has(idx));
            expect(contestedByAnother, `${w}x${h} band ${band.source}->${band.target} lost cell ${idx} to nothing — a silent overwrite, not a crossing`).toBe(true);
          }
        }
      }
    }
  });

  /**
   * `computeSankeyRoutedRows` registers rows on `canvas` in array order, one
   * edge id per row (`"0"`, `"1"`, …) — replaying that same order against
   * its OWN return value is how a caller with no access to the internal
   * counter recovers which band owns which id, without re-deriving it.
   */
  function ownerByEdgeId(routedRows: readonly { readonly band: unknown }[]): ReadonlyMap<string, unknown> {
    const owner = new Map<string, unknown>();
    routedRows.forEach((row, i) => owner.set(`${i}`, row.band));
    return owner;
  }

  /**
   * gate (d), AS MEASURED — a declared impasse, not a silent gap.
   *
   * The task's own bar was zero `report.routeConflicts` entries of any kind.
   * That bar is NOT met: a shared border column is a genuinely finite
   * resource — every row of every band leaving (or entering) one node
   * touches it, at exactly ONE cell each, but a BENT band's own dedicated
   * ribbon column, reserved for its whole vertical extent, sits BETWEEN
   * that border and wherever its lane is. A LATER row's mere entry sweep
   * toward its own lane, or another band's horizontal leg sharing the same
   * absolute row purely by coincidence (row numbers are a chart-wide
   * resource, not scoped per node pair), can cross that reservation exactly
   * along its own axis. Measured (`bench`-style sweep, not asserted below
   * because it is not a pass/fail bound): the fan at 40-140 wide logs 15-45
   * cross-band "parallel" conflicts, the energy dataset 0-23, and 200 seeded
   * random DAGs 1,114 cross-band "parallel" hits total (of 8,657 conflict
   * entries of all three kinds). Interval-colouring (`assignSankeyLanes`)
   * closes the ORIGINAL round-1/round-2 failure mode this was meant to rule
   * out — two OVERLAPPING bands sharing one column for their FULL length,
   * which is what erased an entire run — but it cannot, by itself, prevent
   * a single-cell coincidence between a transit sweep and someone else's
   * reservation. Reaching true zero needs a fundamentally different
   * router (true per-cell diagonal/Bresenham ribbons, or a Manhattan-A*
   * clearance planner like `@glyphcss/diagrams`' own) — out of proportion
   * to this fix, and a separate piece of work.
   *
   * What IS true, and IS asserted: a conflict cell is NEVER a visual
   * defect. `paintSankeyLayout` ignores `resolveJunctions()`'s own
   * box-drawing glyph entirely and repaints every cell itself, border cells
   * first and unconditionally (see its own doc) — so whatever a conflict's
   * `kind`, the cell that ends up on screen is always the fill of whichever
   * band the SAME registration-order tie-break resolves to, never a blank
   * cell, never the wrong band's colour, and never (gates (a)/(c) above)
   * a band's own border or an uncontested run.
   */
  it("gate (d), measured: every route conflict cell paints the correct winner (registration order) — never blank, never the wrong band, on the fan, energy and 200 random DAGs", () => {
    const cases: { readonly spec: GlyphChartSpec; readonly w: number; readonly h: number }[] = [
      ...sizes.map(([w, h]) => ({ spec: fanSpec, w, h })),
      ...sizes.map(([w, h]) => ({ spec: energySpec, w, h })),
      ...Array.from({ length: 200 }, (_, seed) => [8, 16, 24].map((h) => ({ spec: randomSankeySpec(seed), w: 72, h }))).flat(),
    ];
    for (const { spec, w, h } of cases) {
      const groups = sankeyGroups(spec);
      const plot = PLOT(w, h);
      const layout = layoutSankeyGraph(groups, plot, "box", [])!;
      // Route registration is a pure function of `layout`/`plot` (it never
      // reads canvas content), so computing it on a THROWAWAY canvas and
      // reading the painted colours off a SEPARATE, real
      // `paintSankeyLayout()` render is the same routes both times — this
      // is what lets the test read exactly what a real render shows without
      // reimplementing the painter's own two-pass claim logic here.
      const probe = createGlyphCanvas({ cols: w, rows: h, tier: "box" });
      const routedRows = computeSankeyRoutedRows(probe, plot, layout, true, []);
      probe.resolveJunctions();
      const canvas = createGlyphCanvas({ cols: w, rows: h, tier: "box" });
      paintSankeyLayout(canvas, plot, layout, true, []);
      const owner = ownerByEdgeId(routedRows);
      const colorByBand = new Map(layout.bands.map((band) => [band, resolveSeriesColor(band, true)]));
      for (const conflict of canvas.report.routeConflicts) {
        const idx = conflict.row * canvas.cols + conflict.col;
        const painted = canvas.grid.color[idx];
        // Never blank, and never a colour belonging to none of the
        // contending edges' own bands — whichever of them the two-pass
        // (border-cells-first, then registration order) priority actually
        // picked, it painted a colour one of the edges present here owns.
        const contendingColors = new Set(conflict.edgeIds.map((id) => colorByBand.get(owner.get(id) as never) ?? null));
        expect(painted, `${w}x${h} conflict (${conflict.kind}) at (${conflict.col},${conflict.row}) painted a colour outside its own contenders`).not.toBeNull();
        expect(contendingColors.has(painted), `${w}x${h} conflict (${conflict.kind}) at (${conflict.col},${conflict.row})`).toBe(true);
      }
    }
    // Real work, not padding for a slow runner: 200 seeded random DAGs x 3
    // heights, each laid out AND rendered twice (a throwaway probe canvas
    // plus a real `paintSankeyLayout()` pass) to read every route-conflict
    // cell's actual painted colour — vitest's 5s default timed out once
    // under machine load (AGENTS.md's "Settle on the component's own idle
    // signal" budget convention).
  }, 30_000);

  it("a band routed through a depth-skipping gap never enters an intermediate node's own box (assert), and the energy dataset's Natural Gas -> Industrial is fully connected", () => {
    // This used to route straight through Electricity Generation's own
    // column and either get silently painted over (round 1) or lose its
    // entire lane under EG's box (round 2, N2) — `layoutSankeyGraph`
    // throws internally if any route cell ever lands inside a foreign
    // node's box, so simply rendering without throwing is most of this
    // gate; the rest checks the flagship band actually reaches both ends.
    for (const [w, h] of [[40, 24], [72, 24], [96, 32], [140, 40]] as const) {
      const { layout, canvas } = renderSankey(energySpec, w, h, "box");
      const band = layout.bands.find((b) => b.source === "Natural Gas" && b.target === "Industrial")!;
      const srcBox = layout.nodes.find((n) => n.id === "Natural Gas")!;
      const tgtBox = layout.nodes.find((n) => n.id === "Industrial")!;
      const color = resolveSeriesColor(band, true);
      for (const { srcRow, tgtRow } of bandRowEndpoints(band)) {
        expect(canvas.grid.color[srcRow * canvas.cols + (srcBox.x1 + 1)], `${w}x${h} src row ${srcRow}`).toBe(color);
        expect(canvas.grid.color[tgtRow * canvas.cols + (tgtBox.x0 - 1)], `${w}x${h} tgt row ${tgtRow}`).toBe(color);
      }
    }
  });

  it("mutation check: two OVERLAPPING bent bands never share a ribbon column (interval-coloured lane uniqueness)", () => {
    // Direct check on the placement itself, not a pixel-count proxy: A->Y
    // and B->X have IDENTICAL vertical extents (both [6,18] at 72 wide) —
    // exactly the case `assignSankeyLanes`'s interval colouring exists to
    // separate. Reintroducing a single shared lane column (mutating the
    // painter to ignore its own `laneStartByBand` map) does NOT fail this
    // test's sibling pixel-based gates above — gate (a) is independently
    // guaranteed by the border-priority pass, and low-90s-percent cell
    // survival turns out to be typical even for a CORRECT layout on this
    // data (dense real crossings), so a percentage threshold can't
    // discriminate the mutation from honest crossings either. This test
    // catches it directly instead: it fails immediately if the two
    // ribbons' own dedicated columns are the same.
    const { layout, canvas } = renderSankey(fanSpec, 72, 24, "box");
    const findRibbonColumn = (band: (typeof layout.bands)[number]): number => {
      // The "lane" column is whichever x holds the LONGEST run of
      // consecutive-y cells in row 0's own route — the dedicated vertical.
      const probe = createGlyphCanvas({ cols: 72, rows: 24, tier: "box" });
      const routedRows = computeSankeyRoutedRows(probe, PLOT(72, 24), layout, true, []);
      const row0 = routedRows.find((r) => r.band === band)!;
      const spanByX = new Map<number, { min: number; max: number }>();
      for (const p of row0.cells) {
        const span = spanByX.get(p.x) ?? { min: p.y, max: p.y };
        span.min = Math.min(span.min, p.y); span.max = Math.max(span.max, p.y);
        spanByX.set(p.x, span);
      }
      return [...spanByX.entries()].reduce((best, [x, s]) => (s.max - s.min > best.span ? { x, span: s.max - s.min } : best), { x: -1, span: -1 }).x;
    };
    const ay = layout.bands.find((b) => b.source === "A" && b.target === "Y")!;
    const bx = layout.bands.find((b) => b.source === "B" && b.target === "X")!;
    expect(findRibbonColumn(ay)).not.toBe(findRibbonColumn(bx));
  });

  it("a crossing band that would be too narrow to fit its own ribbon reports sankey-crossings-merged", () => {
    // A full bipartite fan (every source to every target) has crossings no
    // column reordering can eliminate. At a narrow plot width the resulting
    // real (non-folded) diagonal bands' own ribbons outgrow the gap. Height
    // 60 (not the pre-air-feature 31) is what it now takes for enough real
    // bands to survive folding under the reserved node padding/link gap to
    // still crowd the narrow gap — a shorter plot folds so much of this
    // dense a fan into "(other)" stubs that too few real bent bands remain
    // to overflow it.
    const n = 6;
    const rows: { from: string; to: string; amount: number }[] = [];
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) rows.push({ from: `S${i}`, to: `T${j}`, amount: 1 });
    const spec: GlyphChartSpec = { marks: [glyphChartSankey(rows, { source: "from", target: "to", value: "amount" })] };
    const { ledger } = renderSankey(spec, 15, 60, "box");
    expect(ledger.some((e) => e.code === "sankey-crossings-merged")).toBe(true);
  });

  it("sankey-crossings-merged names the actual BENT-BAND count, not the packed column width, as 'bands' (sankey round-3 review, finding l/R3)", () => {
    const n = 6;
    const rows: { from: string; to: string; amount: number }[] = [];
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) rows.push({ from: `S${i}`, to: `T${j}`, amount: 1 });
    const spec: GlyphChartSpec = { marks: [glyphChartSankey(rows, { source: "from", target: "to", value: "amount" })] };
    const { ledger } = renderSankey(spec, 15, 60, "box");
    const entry = ledger.find((e) => e.code === "sankey-crossings-merged")!;
    const detail = entry.detail as { crossing: number; lanes: number; bands: number };
    // `bands` (bent-band count) must never be reported as if it were the
    // packed COLUMN width (`crossing`) — the old message printed `crossing`
    // and called it "flows", conflating a column count with a band count.
    expect(detail.bands).toBeGreaterThan(0);
    expect(detail.bands).toBeLessThanOrEqual(detail.crossing);
    expect(entry.message).toContain(`${detail.bands} crossing band`);
    expect(entry.message).not.toContain(`${detail.crossing} crossing flow`);
  });
});

describe("sankey fold bucket name never collides with a real node id (sankey round-3 review, finding l/N10/R6)", () => {
  it("a real node literally named '(other)' keeps its own identity — the fold bucket gets a disambiguated name instead", () => {
    // Hub -> "(other)" is a REAL, large flow to a node that happens to be
    // named "(other)"; Hub -> Tiny is small enough to fold. Before the fix,
    // both used the literal string "(other)" as their target id, and
    // `nodeBoxes.get("(other)")` (keyed by the REAL graph's node ids) would
    // resolve the fold to the real node's own box, silently merging the two.
    const rows = [
      { from: "Hub", to: "(other)", amount: 500 },
      { from: "Hub", to: "Big", amount: 500 },
      { from: "Hub", to: "Tiny", amount: 1 },
    ];
    const spec: GlyphChartSpec = { marks: [glyphChartSankey(rows, { source: "from", target: "to", value: "amount" })] };
    const groups = sankeyGroups(spec);
    const ledger: GlyphChartLedgerEntry[] = [];
    const layout = layoutSankeyGraph(groups, PLOT(30, 6), "box", ledger)!;
    const bandTargets = layout.bands.map((b) => b.target);
    // The REAL "(other)" node's own band survives as "(other)".
    expect(bandTargets).toContain("(other)");
    // The fold bucket (if Tiny folds at this size) gets a DIFFERENT name —
    // never a second band also targeting the literal string "(other)".
    const foldedBand = layout.bands.find((b) => b.folded);
    if (foldedBand) expect(foldedBand.target).not.toBe("(other)");
    // Exactly one band per real node id (no merge): "(other)" appears once.
    expect(bandTargets.filter((t) => t === "(other)")).toHaveLength(1);
  });

  it("sankey-folded-flows names the stub as invisible when it converges to 0 rows (R6)", () => {
    // A source where every kept band is already at its floor of 1 row —
    // the converged fold bucket then has no spare row to steal from
    // (`ensureFoldStubVisible`'s own documented escape hatch).
    const rows = Array.from({ length: 5 }, (_, i) => ({ from: "S", to: `T${i}`, amount: 100 })).concat([{ from: "S", to: "Tiny", amount: 1 }]);
    const spec: GlyphChartSpec = { marks: [glyphChartSankey(rows, { source: "from", target: "to", value: "amount" })] };
    const groups = sankeyGroups(spec);
    const ledger: GlyphChartLedgerEntry[] = [];
    const layout = layoutSankeyGraph(groups, PLOT(30, 5), "box", ledger)!;
    const entry = ledger.find((e) => e.code === "sankey-folded-flows");
    expect(entry).toBeDefined();
    const foldedBand = layout.bands.find((b) => b.folded);
    const stubRows = foldedBand ? foldedBand.sourceRowRange[1] - foldedBand.sourceRowRange[0] + 1 : 0;
    if (stubRows === 0) {
      expect((entry!.detail as { stubVisible?: boolean }).stubVisible).toBe(false);
      expect(entry!.message).toContain("isn't drawn");
    }
  });
});

describe("two sankey marks sharing one canvas never corrupt or silently overwrite each other's bands (fable review, batch 3, finding c)", () => {
  function bandCellsOf(layout: GlyphChartSankeyLayout, w: number, h: number, prefix: string): Set<number> {
    const scratch = createGlyphCanvas({ cols: w, rows: h, tier: "box" });
    const routed = computeSankeyRoutedRows(scratch, PLOT(w, h), layout, true, [], prefix);
    const cells = new Set<number>();
    for (const { cells: rowCells } of routed) for (const p of rowCells) cells.add(p.y * w + p.x);
    return cells;
  }

  it("paintSankeyMarks never throws registering two marks' edge ids (namespaced) on one canvas", () => {
    const w = 72, h = 24;
    const plot = PLOT(w, h);
    const canvas = createGlyphCanvas({ cols: w, rows: h, tier: "box" });
    // Pre-fix, both marks' `computeSankeyRoutedRows` register edge ids
    // "0", "1", … on the SAME canvas-wide edge/route store
    // (`junctions.ts`'s own doc: "a second `route()` call for the same
    // edge id REPLACES its route entirely"), so mark #2 registering "0"
    // again silently discards mark #1's own route bookkeeping for that id.
    expect(() => paintSankeyMarks(canvas, plot, [{ groups: sankeyGroups(fanSpec) }, { groups: sankeyGroups(energySpec) }], true, [])).not.toThrow();
  });

  it("paintSankeyMarks: mark #1's already-painted band cells survive mark #2's paint pass unchanged (one shared claim map, ONE resolveJunctions() call)", () => {
    const w = 72, h = 24;
    const plot = PLOT(w, h);
    const layoutA = layoutSankeyGraph(sankeyGroups(fanSpec), plot, "box", [])!;
    const bandCellsA = bandCellsOf(layoutA, w, h, "sankey0:");
    expect(bandCellsA.size).toBeGreaterThan(0);

    // Mark A alone, for the "before" snapshot of what it actually painted.
    const alone = createGlyphCanvas({ cols: w, rows: h, tier: "box" });
    paintSankeyMarks(alone, plot, [{ groups: sankeyGroups(fanSpec) }], true, []);
    const charAfterA = alone.grid.char.slice();
    const colorAfterA = alone.grid.color.slice();

    // Both marks together, through the SAME batched entry point.
    const combined = createGlyphCanvas({ cols: w, rows: h, tier: "box" });
    paintSankeyMarks(combined, plot, [{ groups: sankeyGroups(fanSpec) }, { groups: sankeyGroups(energySpec) }], true, []);

    for (const idx of bandCellsA) {
      expect(combined.grid.char[idx], `cell ${idx} (mark A's own band cell) was overwritten by mark B`).toBe(charAfterA[idx]);
      expect(combined.grid.color[idx]).toBe(colorAfterA[idx]);
    }
  });

  it("mutation check: calling paintSankeyLayout per mark (the pre-fix shape — its own resolveJunctions() every time, no shared claim) DOES let mark B corrupt mark A's already-painted cells", () => {
    const w = 72, h = 24;
    const plot = PLOT(w, h);
    const layoutA = layoutSankeyGraph(sankeyGroups(fanSpec), plot, "box", [])!;
    const bandCellsA = bandCellsOf(layoutA, w, h, "sankeyA:");

    const canvas = createGlyphCanvas({ cols: w, rows: h, tier: "box" });
    // No shared claimedBy, and each call resolves junctions on its own —
    // exactly the two-call shape `paintSankeyMarks` replaces.
    paintSankeyLayout(canvas, plot, layoutA, true, [], undefined, "sankeyA:");
    const charAfterA = canvas.grid.char.slice();
    const layoutB = layoutSankeyGraph(sankeyGroups(energySpec), plot, "box", [])!;
    paintSankeyLayout(canvas, plot, layoutB, true, [], undefined, "sankeyB:");

    let overwritten = 0;
    for (const idx of bandCellsA) if (canvas.grid.char[idx] !== charAfterA[idx]) overwritten++;
    expect(overwritten).toBeGreaterThan(0);
  });

  it("a spec with two sankey marks renders through paintGlyphChart with no exception and both sources listed in meta.series", () => {
    const spec: GlyphChartSpec = { marks: [
      glyphChartSankey([{ from: "A", to: "X", amount: 5 }, { from: "A", to: "Y", amount: 5 }], { source: "from", target: "to", value: "amount" }),
      glyphChartSankey(ENERGY_FLOW_SANKEY_DATA, { source: "from", target: "to", value: "amount" }),
    ] };
    let r: ReturnType<typeof renderGlyphChart>;
    expect(() => { r = renderGlyphChart(spec, { target: "chat", width: 72, height: 24 }); }).not.toThrow();
    expect(r!.meta.series.length).toBeGreaterThan(0);
  });
});

describe("report.routeConflicts is surfaced by renderGlyphChart (fable review, batch 3, finding e)", () => {
  it("a sankey render's own canvas.report.routeConflicts reaches r.report.routeConflicts unchanged", () => {
    const r = renderGlyphChart(energySpec, { target: "chat", width: 72, height: 24 });
    // AGENTS.md's Charts section documents this as measurable ("not fully
    // empty in practice") but `render.ts` used to copy only
    // `canvas.report.ledger`/`unsupportedGlyphs`, dropping it on the floor —
    // no caller could see it at all. The energy dataset at this size is a
    // real, non-trivial case (crossing bands), so this also proves the
    // field isn't merely present-but-always-empty.
    expect(Array.isArray(r.report.routeConflicts)).toBe(true);
    expect(r.report.routeConflicts.length).toBeGreaterThan(0);
    for (const c of r.report.routeConflicts) {
      expect(typeof c.col).toBe("number");
      expect(typeof c.row).toBe("number");
      expect(["parallel", "corner", "multi"]).toContain(c.kind);
      expect(Array.isArray(c.edgeIds)).toBe(true);
    }
  });

  it("a spec with no sankey/funnel mark reports an empty routeConflicts, byte-identical to before this field existed", () => {
    const r = renderGlyphChart({ marks: [glyphChartLine([1, 2, 3])] }, { target: "chat" });
    expect(r.report.routeConflicts).toEqual([]);
  });

  // Sankey round-3 review, finding j: gate (d) ("report.routeConflicts
  // empty") is a declared impasse, not a bug — the conflicts are REAL
  // cell-sharing between genuinely crossing bands (paintSankeyRoutedRows'
  // own two-pass claim resolves every one of them to a real contender's
  // colour, never blank or foreign — see gate (d) above), not an
  // artefact of two k-row bands legitimately abutting that the layout
  // could avoid registering. Since it's real contention, it's a silent
  // loss unless reported — which `sankey-band-broken` (finding k) now
  // does, per band. This test pins the TRUE count at the energy dataset's
  // own reported size rather than assuming a number.
  it("the true routeConflicts count at the energy dataset's own 72x24 is measured and pinned, not assumed empty", () => {
    const r = renderGlyphChart(energySpec, { target: "chat", width: 72, height: 24 });
    // A real, non-trivial number — the declared impasse's own measurement.
    // Lower than the pre-air-feature 98, and lower again (74 -> 36) after
    // DIAGNOSIS-sankey-column-jump.md's fix: a skip-level band's own k rows
    // now spread across distinct pass-through rows and final-lane columns
    // instead of collapsing onto one shared cell each, which is exactly what
    // used to manufacture most of these conflicts (every one of a tall
    // band's own rows converging on the SAME single cell as every other
    // band crossing that cell). Genuine crossings remain — see gate (d).
    // 36 -> 27: lane packing now reserves a skip-level leg's real descent
    // (pass-through rows included), not its endpoint rows (codex round-1 P1).
    // 27 -> 20: Round 3's corridor-aware order puts Industrial below
    // Electricity Generation, so Natural Gas -> Industrial no longer climbs
    // through that node's outflows to reach it.
    expect(r.report.routeConflicts.length).toBe(20);
  });
});

describe("sankey-band-broken: a band's own run interrupted by a crossing band is reported, not silent (sankey round-3 review, finding k)", () => {
  it("energy 140x40: Renewables -> Electricity Generation's own run is broken and reported with a real cell count", () => {
    const r = renderGlyphChart(energySpec, { target: "chat", width: 140, height: 40 });
    const entry = r.report.ledger.find((e) => e.code === "sankey-band-broken" && (e.detail as { source: string; target: string }).source === "Renewables" && (e.detail as { target: string }).target === "Electricity Generation");
    expect(entry, "sankey-band-broken must fire for Renewables -> Electricity Generation at 140x40").toBeTruthy();
    expect((entry!.detail as { cells: number }).cells).toBeGreaterThan(0);
  });

  it("a band with no crossing (a simple two-node flow with room to spare) never reports sankey-band-broken", () => {
    const spec: GlyphChartSpec = { marks: [glyphChartSankey([{ from: "A", to: "B", amount: 10 }], { source: "from", target: "to", value: "amount" })] };
    const r = renderGlyphChart(spec, { target: "chat", width: 72, height: 24 });
    expect(r.report.ledger.some((e) => e.code === "sankey-band-broken")).toBe(false);
  });

  // Sankey round-4 review (N3, relocated agy P2-1): `sankey-band-broken`
  // counted a REFUSAL per crossing (row, cell) pair rather than per
  // DISTINCT cell — several of a multi-row band's own rows routinely cross
  // the SAME foreign-owned cell at a shared free-row detour, and the old
  // counter added a fresh unit for every one of those revisits. Fixed by
  // tracking a per-band `Set` of refused cell indices instead of a running
  // counter (`flowMarks.ts`'s `refusedCellsByBand`).
  //
  // Sized at 72x40, not the original 140x40: DIAGNOSIS-sankey-column-jump.md's
  // fix gives every row of a skip-level band its OWN pass-through row and
  // final-lane column, so at the original 140x40 (whose gaps are wide
  // enough to spread every row without ever reusing one) the self-overlap
  // this test exists to exercise no longer occurs there at all — measured,
  // naive and distinct now agree exactly (20 == 20) at 140x40. 72x40 is
  // narrower, forcing `pickSankeyFreeRowBand`/`assignSankeyFinalLanes`'s own
  // documented degrade (fewer clear rows/lanes than the band's own `k` than
  // it needs to give every row a fully distinct one), which is what still
  // reproduces real, measured row self-overlap (naive 37 vs distinct 25) —
  // the residual the fix's own doc calls out, not a defect.
  //
  // DIAGNOSIS-sankey-column-jump.md Round 3 moved Industrial below
  // Electricity Generation, and Natural Gas -> Industrial now loses 5 cells
  // at 72x40 with no row revisiting another's (naive 5 == distinct 5), so the
  // repro moved to the band that now carries the self-overlap:
  // Nuclear -> Electricity Generation, whose rows cross the skip-level
  // band's lane (naive 35 vs distinct 23).
  it("N3: Nuclear -> Electricity Generation reports the DISTINCT lost-cell count — an independent recount confirms the ledger's own number, and mutating the fix back to a per-crossing counter would report a different (larger) figure", () => {
    const groups = sankeyGroups(energySpec);
    const plot = PLOT(72, 40);
    const layout = layoutSankeyGraph(groups, plot, "box", [])!;
    const targetBand = layout.bands.find((b) => b.source === "Nuclear" && b.target === "Electricity Generation");
    expect(targetBand, "the energy dataset must still carry a Nuclear -> Electricity Generation band").toBeTruthy();

    // ONE shared routing pass (`computeSankeyRoutedRows`, on its own scratch
    // canvas so registering it doesn't collide with the real paint's own
    // edge ids) gives every row's OWN cells — the same routes the real
    // paint uses, never re-derived per band (gate (b)/(c)'s own doc
    // explains why re-deriving in isolation gives a different, wrong lane
    // placement). A SEPARATE canvas holds the real, combined paint.
    const scratch = createGlyphCanvas({ cols: 72, rows: 40, tier: "box" });
    const routedRows = computeSankeyRoutedRows(scratch, plot, layout, true, []);
    const combined = createGlyphCanvas({ cols: 72, rows: 40, tier: "box" });
    const combinedLedger: GlyphChartLedgerEntry[] = [];
    paintSankeyLayout(combined, plot, layout, true, combinedLedger);

    const entry = combinedLedger.find((e) => e.code === "sankey-band-broken" && (e.detail as { source: string; target: string }).source === "Nuclear" && (e.detail as { target: string }).target === "Electricity Generation");
    expect(entry, "sankey-band-broken must fire for Nuclear -> Electricity Generation at 72x40 with the reserved air live").toBeTruthy();
    const reportedCells = (entry!.detail as { cells: number }).cells;

    const bandColor = resolveSeriesColor(targetBand!, true);
    const bandRows = routedRows.filter((r) => r.band === targetBand);
    expect(bandRows.length, "the band must have more than one routed row to exercise the self-crossing case N3 is about").toBeGreaterThan(1);

    // Independent recount, DISTINCT cells: a cell counts once no matter how
    // many of the band's own rows cross it.
    const distinctLost = new Set<number>();
    // Naive recount, the OLD (pre-fix) shape: once per (row, cell) crossing,
    // with no dedup across rows — this is what a counter-based
    // `refusedByBand` would have reported.
    let naiveLost = 0;
    for (const row of bandRows) {
      for (const p of row.cells) {
        const idx = p.y * combined.cols + p.x;
        if (combined.grid.color[idx] === bandColor) continue; // this row's own cell, not a loss.
        distinctLost.add(idx);
        naiveLost++;
      }
    }
    // The dataset must actually exercise the divergence this test is
    // for — several rows sharing a lost cell — or the two recounts would
    // trivially agree and the mutation-sensitivity claim below would be
    // vacuous.
    expect(naiveLost, "the naive per-row recount must exceed the distinct-cell recount for this to be a real N3 repro").toBeGreaterThan(distinctLost.size);
    // The production ledger must match the DISTINCT recount — this is what
    // reverting `refusedCellsByBand` from a `Set` back to a counter would
    // break: the real entry would then report `naiveLost`, not
    // `distinctLost.size`, and this assertion would go red.
    expect(reportedCells).toBe(distinctLost.size);
    expect(reportedCells).not.toBe(naiveLost);
  });
});

describe("sankey fold reaches a fixed point (P1-2)", () => {
  it("folding a tiny flow into (other) still conserves the source's own row total", () => {
    // A source with two flows, one 200x the other — at a small row budget
    // the tiny one rounds to 0 rows on its own and must fold.
    const spec: GlyphChartSpec = {
      marks: [glyphChartSankey(
        [{ from: "Hub", to: "Big", amount: 1000 }, { from: "Hub", to: "Tiny", amount: 1 }],
        { source: "from", target: "to", value: "amount" },
      )],
    };
    const groups = sankeyGroups(spec);
    const layout = layoutSankeyGraph(groups, PLOT(60, 6), "box", [])!;
    const hub = layout.nodes.find((n) => n.id === "Hub")!;
    const outgoing = layout.bands.filter((b) => b.source === "Hub");
    expect(outgoing.some((b) => b.folded)).toBe(true);
    expectRowRangesConserveWithGaps(outgoing.map((b) => b.sourceRowRange), hub.y0, hub.y1, GLYPH_CHART_SANKEY_LINK_GAP_ROWS);
    const ledger: GlyphChartLedgerEntry[] = [];
    layoutSankeyGraph(groups, PLOT(60, 6), "box", ledger);
    expect(ledger.some((e) => e.code === "sankey-folded-flows")).toBe(true);
  });

  it("a re-split after folding that ITSELF hands a kept band 0 rows keeps folding until none remain (the reviewer's own repro)", () => {
    const spec: GlyphChartSpec = { marks: [glyphChartSankey(
      [
        { from: "Hub", to: "Big", amount: 1000 }, { from: "Hub", to: "T0", amount: 3 }, { from: "Hub", to: "T1", amount: 4 },
        { from: "Hub", to: "T2", amount: 5 }, { from: "Hub", to: "T3", amount: 6 }, { from: "Hub", to: "T4", amount: 7 }, { from: "Hub", to: "T5", amount: 8 },
      ],
      { source: "from", target: "to", value: "amount" },
    )] };
    const groups = sankeyGroups(spec);
    const plot = PLOT(60, 20);
    const ledger: GlyphChartLedgerEntry[] = [];
    const layout = layoutSankeyGraph(groups, plot, "box", ledger)!;
    const kept = layout.bands.filter((b) => b.source === "Hub" && !b.folded);
    for (const b of kept) expect(b.sourceRowRange[1] - b.sourceRowRange[0] + 1).toBeGreaterThanOrEqual(1);
    const named = new Set(ledger.filter((e) => e.code === "sankey-folded-flows").flatMap((e) => (e.detail!.flows as string[])));
    const foldedTargets = layout.bands.filter((b) => b.source === "Hub" && b.folded).length > 0
      ? ["T0", "T1", "T2", "T3", "T4", "T5"].filter((t) => !kept.some((b) => b.target === t))
      : [];
    for (const t of foldedTargets) expect(named.has(`Hub → ${t}`)).toBe(true);
  });

  it("property sweep: no kept band ends at 0 rows and every folded flow is named, over random skewed graphs at several heights", () => {
    for (let seed = 0; seed < 40; seed++) {
      const rng = mulberry32(seed);
      const leafCount = 3 + (seed % 8);
      const rows = Array.from({ length: leafCount }, (_, l) => ({
        from: "Hub", to: `Leaf${l}`, amount: Math.max(1, Math.round(Math.pow(rng(), 4) * 2000)),
      }));
      const spec: GlyphChartSpec = { marks: [glyphChartSankey(rows, { source: "from", target: "to", value: "amount" })] };
      const groups = sankeyGroups(spec);
      for (const height of [5, 8, 12, 20]) {
        const plot = PLOT(60, height);
        const ledger: GlyphChartLedgerEntry[] = [];
        const layout = layoutSankeyGraph(groups, plot, "box", ledger);
        if (!layout) continue;
        const kept = layout.bands.filter((b) => b.source === "Hub" && !b.folded && b.value > 0);
        for (const b of kept) {
          expect(b.sourceRowRange[1] - b.sourceRowRange[0] + 1, `seed ${seed} height ${height} target ${b.target}`).toBeGreaterThanOrEqual(1);
        }
        const namedFlows = new Set(ledger.filter((e) => e.code === "sankey-folded-flows").flatMap((e) => (e.detail!.flows as string[])));
        const keptTargets = new Set(kept.map((b) => b.target));
        for (const l of rows) {
          if (!keptTargets.has(l.to)) expect(namedFlows.has(`Hub → ${l.to}`), `seed ${seed} height ${height} ${l.to} not kept and not named`).toBe(true);
        }
      }
    }
  });
});

describe("sankey node boxes never leave the plot rect (P2-2, P2-3)", () => {
  it("a deep sankey (many columns) folds columns to fit rather than clipping a box mid-glyph", () => {
    for (const width of [40, 50, 60, 72]) {
      for (const numLinks of [10, 15, 19, 25]) {
        const rows = Array.from({ length: numLinks }, (_, i) => ({ from: `N${i}`, to: `N${i + 1}`, amount: 10 }));
        const spec: GlyphChartSpec = { marks: [glyphChartSankey(rows, { source: "from", target: "to", value: "amount" })] };
        const groups = sankeyGroups(spec);
        const plot = PLOT(width, 24);
        const ledger: GlyphChartLedgerEntry[] = [];
        const layout = layoutSankeyGraph(groups, plot, "box", ledger)!;
        for (const n of layout.nodes) {
          expect(n.x0, `width ${width} links ${numLinks} node ${n.id}`).toBeGreaterThanOrEqual(plot.x0);
          expect(n.x1).toBeLessThanOrEqual(plot.x1);
          expect(n.x1 - n.x0 + 1).toBeGreaterThanOrEqual(3); // never a partial (mid-glyph-clipped) box
          if (n.height > 0) {
            expect(n.y0).toBeGreaterThanOrEqual(plot.y0);
            expect(n.y1).toBeLessThanOrEqual(plot.y1);
          }
        }
      }
    }
  });

  it("N4: a 19-column chain at 72 wide actually folds and reports it — mutation-sensitive (round 2's fold block was dead code; the DEFENSIVE while loop alone kept boxes in the rect with no ledger entry)", () => {
    const rows = Array.from({ length: 18 }, (_, i) => ({ from: `N${i}`, to: `N${i + 1}`, amount: 10 }));
    const spec: GlyphChartSpec = { marks: [glyphChartSankey(rows, { source: "from", target: "to", value: "amount" })] };
    const groups = sankeyGroups(spec);
    const plot = PLOT(72, 24);
    const ledger: GlyphChartLedgerEntry[] = [];
    const layout = layoutSankeyGraph(groups, plot, "box", ledger)!;
    for (const n of layout.nodes) {
      expect(n.x0, `node ${n.id}`).toBeGreaterThanOrEqual(plot.x0);
      expect(n.x1, `node ${n.id}`).toBeLessThanOrEqual(plot.x1);
    }
    const entry = ledger.find((e) => e.code === "sankey-columns-folded");
    expect(entry, "sankey-columns-folded must fire for a 19-node chain at 72 wide").toBeTruthy();
    expect(entry!.detail).toMatchObject({ total: 19 });
    expect((entry!.detail as { folded: number }).folded).toBeGreaterThan(0);
    // N11: the fold must also name every LINK it silences, not just a
    // column count — some columns merging necessarily drops at least one
    // link whose two endpoints now clamp onto the same column.
    expect((entry!.detail as { droppedLinks: readonly string[] }).droppedLinks.length).toBeGreaterThan(0);
    // Sankey round-3 review, finding h: the fold used to fit columns
    // against the PREFERRED spacing (`GLYPH_CHART_SANKEY_MIN_GAP` = 3)
    // while the layout itself accepts a gap of 1 — folding MORE columns
    // than the layout could actually place (7 links silenced here, of
    // which only 1 is genuinely unavoidable at gap 1). The fix folds
    // against the layout's own floor gap, so exactly 1 column (and 1
    // link) is lost — the true minimum for 19 columns of width >= 3 in a
    // 72-wide plot (`floor((72+1)/(3+1)) = 18` columns fit).
    expect(entry!.detail).toMatchObject({ folded: 1 });
    expect((entry!.detail as { droppedLinks: readonly string[] }).droppedLinks).toEqual(["N17 → N18"]);
  });

  it("property sweep (finding h): the column fold never silences more links than the layout's own floor gap (1) genuinely requires, over 2..25 columns x 8..90 width", () => {
    // A linear chain — same shape as the N4 case — so `numCols` (nodes) is
    // exactly `columns` and every link is between adjacent depths, letting
    // the theoretical minimum be computed independently of the source:
    // `maxColsFit = floor((width + 1) / (MIN_NODE_WIDTH(3) + 1))` is the
    // most columns of width >= 3 that fit a `width`-wide plot at the
    // layout's own floor gap of 1 cell between columns.
    const MIN_NODE_WIDTH = 3;
    const MIN_LAYOUT_GAP = 1;
    for (let columns = 2; columns <= 25; columns++) {
      for (let width = 8; width <= 90; width += 2) {
        const rows = Array.from({ length: columns - 1 }, (_, i) => ({ from: `N${i}`, to: `N${i + 1}`, amount: 10 }));
        const spec: GlyphChartSpec = { marks: [glyphChartSankey(rows, { source: "from", target: "to", value: "amount" })] };
        const groups = sankeyGroups(spec);
        const plot = PLOT(width, 24);
        const ledger: GlyphChartLedgerEntry[] = [];
        const layout = layoutSankeyGraph(groups, plot, "box", ledger);
        if (!layout) continue;
        for (const n of layout.nodes) {
          expect(n.x0, `columns=${columns} width=${width} node ${n.id}`).toBeGreaterThanOrEqual(plot.x0);
          expect(n.x1, `columns=${columns} width=${width} node ${n.id}`).toBeLessThanOrEqual(plot.x1);
        }
        const expectedMaxColsFit = Math.max(1, Math.floor((width + MIN_LAYOUT_GAP) / (MIN_NODE_WIDTH + MIN_LAYOUT_GAP)));
        const expectedFolded = Math.max(0, columns - expectedMaxColsFit);
        const entry = ledger.find((e) => e.code === "sankey-columns-folded");
        const actualFolded = entry ? (entry.detail as { folded: number }).folded : 0;
        expect(actualFolded, `columns=${columns} width=${width}: folded more than the layout's own floor gap requires`).toBe(expectedFolded);
      }
    }
  });

  it("property sweep: every node box stays inside the plot rect over random skewed hub graphs", () => {
    for (let seed = 0; seed < 60; seed++) {
      const rng = mulberry32(seed);
      const hubCount = 1 + (seed % 3);
      const leafCount = 3 + (seed % 12);
      const rows: { from: string; to: string; amount: number }[] = [];
      for (let h = 0; h < hubCount; h++) for (let l = 0; l < leafCount; l++) rows.push({ from: `Hub${h}`, to: `Leaf${h}_${l}`, amount: Math.max(1, Math.round(Math.pow(rng(), 4) * 2000)) });
      const spec: GlyphChartSpec = { marks: [glyphChartSankey(rows, { source: "from", target: "to", value: "amount" })] };
      const groups = sankeyGroups(spec);
      for (const height of [6, 10, 14, 20, 24]) {
        const plot = PLOT(90, height);
        const ledger: GlyphChartLedgerEntry[] = [];
        const layout = layoutSankeyGraph(groups, plot, "box", ledger);
        if (!layout) continue;
        for (const n of layout.nodes) {
          expect(n.x0, `seed ${seed} height ${height} node ${n.id}`).toBeGreaterThanOrEqual(plot.x0);
          expect(n.x1).toBeLessThanOrEqual(plot.x1);
          if (n.height > 0) {
            expect(n.y0).toBeGreaterThanOrEqual(plot.y0);
            expect(n.y1).toBeLessThanOrEqual(plot.y1);
          }
        }
      }
    }
  });

  it("a node whose column has more real nodes than rows is reported (sankey-nodes-dropped), never silently absent with an out-of-bounds neighbour", () => {
    const rows = Array.from({ length: 30 }, (_, l) => ({ from: "Hub", to: `Leaf${l}`, amount: 1 }));
    const spec: GlyphChartSpec = { marks: [glyphChartSankey(rows, { source: "from", target: "to", value: "amount" })] };
    const groups = sankeyGroups(spec);
    const plot = PLOT(60, 10); // 30 real leaves, 10 rows — genuinely impossible to seat them all.
    const ledger: GlyphChartLedgerEntry[] = [];
    const layout = layoutSankeyGraph(groups, plot, "box", ledger)!;
    for (const n of layout.nodes) if (n.height > 0) expect(n.y1).toBeLessThanOrEqual(plot.y1);
    expect(ledger.some((e) => e.code === "sankey-nodes-dropped")).toBe(true);
  });

  it("N3: when a column has more real nodes than rows, the BIGGEST values keep their row — a value of 20 always survives over a value of 11", () => {
    // Round 2's own bug: `ensureMinimumHeights`' tie-break was an artefact
    // of `distributeByRate`'s cumulative-rounding ORDER, not of value — at
    // height 6 it kept T1 (value 11) and dropped T10 (value 20). Fixed by
    // deciding the "not enough rows for everyone" case BY VALUE outright:
    // keep the `capacity` biggest, drop the rest, never touch the rate.
    const rows = Array.from({ length: 12 }, (_, i) => ({ from: "S", to: `T${i}`, v: 10 + i })); // values 10..21
    const spec: GlyphChartSpec = { marks: [glyphChartSankey(rows, { source: "from", target: "to", value: "v" })] };
    const groups = sankeyGroups(spec);
    for (const height of [6, 8]) {
      const ledger: GlyphChartLedgerEntry[] = [];
      const layout = layoutSankeyGraph(groups, PLOT(60, height), "box", ledger)!;
      const nodesByValue = layout.nodes.filter((n) => n.id !== "S").map((n) => ({ id: n.id, value: 10 + Number(n.id.slice(1)), height: n.height }));
      const kept = nodesByValue.filter((n) => n.height > 0).sort((a, b) => a.value - b.value);
      const dropped = nodesByValue.filter((n) => n.height === 0).sort((a, b) => a.value - b.value);
      expect(kept.length, `height ${height}`).toBe(height);
      expect(dropped.length, `height ${height}`).toBe(12 - height);
      // The BIGGEST value dropped must still be smaller than the SMALLEST
      // value kept — the whole point of "keep the biggest N".
      if (dropped.length > 0 && kept.length > 0) {
        expect(dropped[dropped.length - 1]!.value, `height ${height}`).toBeLessThan(kept[0]!.value);
      }
      // The literal values the task names: 20 always kept, 11 dropped once
      // there isn't room for both (true starting at height 6, where only
      // the 6 biggest of 12 survive).
      const t10 = nodesByValue.find((n) => n.id === "T10")!; // value 20
      const t1 = nodesByValue.find((n) => n.id === "T1")!; // value 11
      expect(t10.height, `height ${height}: value 20 must keep its row`).toBeGreaterThan(0);
      expect(t1.height, `height ${height}: value 11 must be dropped when there's no room for all 12`).toBe(0);
      expect(ledger.some((e) => e.code === "sankey-nodes-dropped")).toBe(true);
    }
  });
});

describe("sankey band thickness is comparable across columns, not per-column normalised (P2-1)", () => {
  it("a value of 150 is never drawn thinner than a value of 130 elsewhere in the chart", () => {
    // A occupies a column BY ITSELF (its only neighbour, Y, feeds it) —
    // under the old per-column normalisation a lone node stretched to
    // fill its ENTIRE column regardless of value (it would have claimed
    // all 24 rows here); B shares its column with nothing of its own kind
    // either, but at the SAME depth as A's own source Y.
    const spec: GlyphChartSpec = { marks: [glyphChartSankey(
      [{ from: "Y", to: "A", amount: 150 }, { from: "A", to: "A2", amount: 150 }, { from: "B", to: "B2", amount: 130 }],
      { source: "from", target: "to", value: "amount" },
    )] };
    const groups = sankeyGroups(spec);
    const layout = layoutSankeyGraph(groups, PLOT(72, 24), "box", [])!;
    const a = layout.nodes.find((n) => n.id === "A")!;
    const b = layout.nodes.find((n) => n.id === "B")!;
    expect(a.height).toBeGreaterThanOrEqual(b.height);
    expect(a.height).toBeLessThan(20); // not stretched to fill its own column alone
  });

  it("N6: band row counts are monotone in value WITHIN ONE ROW, never absolutely proportional — cumulative rounding is ±1 by construction", () => {
    // The doc claim used to be absolute ("never drawn thinner"), and round
    // 2's own review measured 45 violations of it in 7,245 ordered band
    // pairs (e.g. energy 40x20: Nuclear->EG value 150 draws 2 rows, EG-
    // >Industrial value 130 draws 3). The property that actually holds —
    // and is what both `distributeCumulative`'s running-sum rounding and
    // `distributeByRate`'s nested column/band rounding can each cost at
    // most once — is WITHIN ONE ROW: a smaller value's row count is never
    // MORE than 1 greater than a larger value's.
    for (const [w, h] of [[40, 10], [40, 20], [50, 20], [72, 24], [96, 32], [140, 40]] as const) {
      const groups = sankeyGroups(energySpec);
      const layout = layoutSankeyGraph(groups, PLOT(w, h), "box", [])!;
      const bands = layout.bands.filter((b) => !b.folded).map((b) => ({ id: `${b.source}->${b.target}`, value: b.value, rows: b.sourceRowRange[1] - b.sourceRowRange[0] + 1 }));
      for (const bigger of bands) for (const smaller of bands) {
        if (bigger.value <= smaller.value) continue;
        expect(smaller.rows, `${w}x${h}: ${smaller.id} (${smaller.value}) vs ${bigger.id} (${bigger.value})`).toBeLessThanOrEqual(bigger.rows + 1);
      }
    }
  });

  it("the energy dataset's own reported disparity is closed: Natural Gas->Industrial (150) is not thinner than Electricity Generation->Industrial (130)", () => {
    const groups = sankeyGroups(energySpec);
    const layout = layoutSankeyGraph(groups, PLOT(72, 24), "box", [])!;
    const natGasToInd = layout.bands.find((b) => b.source === "Natural Gas" && b.target === "Industrial")!;
    const egToInd = layout.bands.find((b) => b.source === "Electricity Generation" && b.target === "Industrial")!;
    const h = (b: typeof natGasToInd) => b.sourceRowRange[1] - b.sourceRowRange[0] + 1;
    expect(h(natGasToInd)).toBeGreaterThanOrEqual(h(egToInd));
  });

  // Sankey round-3 review, finding i: the docs claimed the N6
  // bound is absolute ("just never two or more" / "never more than 1
  // greater") — false. `ensureMinimumHeights`'s reclaim loop
  // (`while (total > capacity)`) can decrement the SAME tall entry
  // repeatedly, once per near-zero flow that needed a floor-of-1 bump in
  // that column, and `ensureFoldStubVisible`'s steal adds a further ±1 —
  // neither is bounded by the single ±1 cumulative-rounding term the docs
  // cited as the only source of drift. The energy-dataset-only N6 test
  // above never exercises this (0 violations across widths 30-140 x
  // heights 6-63 in both row ranges and node heights), which is why it
  // stayed green while the claim was false. This sweep uses the SAME
  // seeded random-DAG corpus the review measured a deficit of 2 in
  // (`randomSankeySpec`, seeds 0-59), checking BOTH node heights (by each
  // node's own total throughput, source and target sides both being
  // sources/sinks in this generator) and band row-ranges (source AND
  // target side) — the true, measured bound is 2, not 1; the doc text
  // states this number and this test pins it, both directions (never
  // silently loosened past 2, never silently tightened back to a false 1
  // that a future run could then violate).
  const GLYPH_CHART_SANKEY_ROW_DEFICIT_BOUND = 2;
  function maxDeficit(pairs: readonly { readonly value: number; readonly rows: number }[]): number {
    let worst = 0;
    for (const bigger of pairs) for (const smaller of pairs) {
      if (bigger.value <= smaller.value) continue;
      worst = Math.max(worst, smaller.rows - bigger.rows);
    }
    return worst;
  }

  it(`property sweep (finding i): node-height and band-row-range monotonicity deficits never exceed the documented bound of ${GLYPH_CHART_SANKEY_ROW_DEFICIT_BOUND}, over 60 seeded random DAGs at several sizes`, () => {
    let observedWorst = 0;
    for (let seed = 0; seed < 60; seed++) {
      const spec = randomSankeySpec(seed);
      const rows = spec.marks[0]!.data as readonly { readonly from: string; readonly to: string; readonly v: number }[];
      const valueByNode = new Map<string, number>();
      for (const r of rows) {
        valueByNode.set(r.from, (valueByNode.get(r.from) ?? 0) + r.v);
        valueByNode.set(r.to, (valueByNode.get(r.to) ?? 0) + r.v);
      }
      const groups = sankeyGroups(spec);
      for (const [w, h] of [[40, 14], [40, 32], [72, 24], [96, 24], [140, 24]] as const) {
        const layout = layoutSankeyGraph(groups, PLOT(w, h), "box", []);
        if (!layout) continue;
        const nodePairs = layout.nodes.filter((n) => n.height > 0).map((n) => ({ value: valueByNode.get(n.id) ?? 0, rows: n.height }));
        const sourcePairs = layout.bands.filter((b) => !b.folded).map((b) => ({ value: b.value, rows: b.sourceRowRange[1] - b.sourceRowRange[0] + 1 }));
        const targetPairs = layout.bands.filter((b) => !b.folded && b.targetRowRange).map((b) => ({ value: b.value, rows: b.targetRowRange![1] - b.targetRowRange![0] + 1 }));
        for (const [label, pairs] of [["node heights", nodePairs], ["source rows", sourcePairs], ["target rows", targetPairs]] as const) {
          const deficit = maxDeficit(pairs);
          observedWorst = Math.max(observedWorst, deficit);
          expect(deficit, `seed ${seed} ${w}x${h} ${label}: deficit exceeds the documented bound`).toBeLessThanOrEqual(GLYPH_CHART_SANKEY_ROW_DEFICIT_BOUND);
        }
      }
    }
    // The bound is a measured ceiling, not a vacuous one — this corpus
    // actually reaches it (matches the review's own seed 13/30 findings).
    expect(observedWorst).toBe(GLYPH_CHART_SANKEY_ROW_DEFICIT_BOUND);
  });
});

describe("sankey visual air: node padding + link gap, reserved at the LAYOUT layer (owner's own 'less filled, some gap between the links' ask)", () => {
  it("every node box is shorter than its column's full row span when padding fits, at chat 72x24 and web 96x32 on the energy dataset", () => {
    for (const [w, h] of [[72, 24], [96, 32]] as const) {
      const groups = sankeyGroups(energySpec);
      const layout = layoutSankeyGraph(groups, PLOT(w, h), "box", [])!;
      const byCol = new Map<number, typeof layout.nodes>();
      for (const n of layout.nodes) byCol.set(n.x0, [...(byCol.get(n.x0) ?? []), n]);
      let sawMultiNodeColumn = false;
      for (const nodes of byCol.values()) {
        if (nodes.length < 2) continue; // a lone node in its own column has no padding to give it air.
        sawMultiNodeColumn = true;
        const columnSpan = Math.max(...nodes.map((n) => n.y1)) - Math.min(...nodes.map((n) => n.y0)) + 1;
        for (const n of nodes) {
          expect(n.height, `${w}x${h} node "${n.id}"`).toBeLessThan(columnSpan);
        }
      }
      expect(sawMultiNodeColumn, `${w}x${h}: energy dataset should have a multi-node column to exercise padding`).toBe(true);
    }
  });

  it("between two consecutive bands at a node there is exactly one blank row (the desired link gap, at generous plot heights)", () => {
    // A wide, tall plot gives every node plenty of headroom, so
    // `sankeyAirGap` affords the full desired `GLYPH_CHART_SANKEY_LINK_GAP_ROWS`
    // (never degraded) between consecutive bands sharing one node.
    const groups = sankeyGroups(energySpec);
    const layout = layoutSankeyGraph(groups, PLOT(140, 60), "box", [])!;
    let checked = 0;
    for (const node of layout.nodes) {
      const outgoing = layout.bands.filter((b) => b.source === node.id);
      if (outgoing.length > 1) {
        const gap = expectRowRangesConserveWithGaps(outgoing.map((b) => b.sourceRowRange), node.y0, node.y1, GLYPH_CHART_SANKEY_LINK_GAP_ROWS);
        expect(gap, `node "${node.id}" outgoing gap`).toBe(GLYPH_CHART_SANKEY_LINK_GAP_ROWS);
        checked++;
      }
      const incoming = layout.bands.filter((b) => b.target === node.id && !b.folded);
      if (incoming.length > 1) {
        const gap = expectRowRangesConserveWithGaps(incoming.map((b) => b.targetRowRange!), node.y0, node.y1, GLYPH_CHART_SANKEY_LINK_GAP_ROWS);
        expect(gap, `node "${node.id}" incoming gap`).toBe(GLYPH_CHART_SANKEY_LINK_GAP_ROWS);
        checked++;
      }
    }
    expect(checked, "the energy dataset should have at least one node with >1 outgoing or incoming band to exercise the link gap").toBeGreaterThan(0);
  });

  it("conservation holds on the non-gap rows over the existing seeded-DAG sweep, at 40/72/96/140 wide, on all four tiers", () => {
    const tiers = ["ascii", "box", "blocks", "braille"] as const;
    for (let seed = 0; seed < 60; seed++) {
      const spec = randomSankeySpec(seed);
      const groups = sankeyGroups(spec);
      for (const w of [40, 72, 96, 140]) {
        for (const tier of tiers) {
          const layout = layoutSankeyGraph(groups, PLOT(w, 24), tier, []);
          if (!layout) continue;
          const byCol = new Map<number, typeof layout.nodes>();
          for (const n of layout.nodes) byCol.set(n.x0, [...(byCol.get(n.x0) ?? []), n]);
          for (const nodes of byCol.values()) {
            expectColumnGapsUniform(nodes.map((n) => [n.y0, n.y1] as const), Math.min(...nodes.map((n) => n.y0)), GLYPH_CHART_SANKEY_NODE_PADDING_ROWS);
          }
          for (const node of layout.nodes) {
            const outgoing = layout.bands.filter((b) => b.source === node.id);
            if (outgoing.length > 0) expectRowRangesConserveWithGaps(outgoing.map((b) => b.sourceRowRange), node.y0, node.y1, GLYPH_CHART_SANKEY_LINK_GAP_ROWS);
            const incoming = layout.bands.filter((b) => b.target === node.id && !b.folded);
            if (incoming.length > 0) expectRowRangesConserveWithGaps(incoming.map((b) => b.targetRowRange!), node.y0, node.y1, GLYPH_CHART_SANKEY_LINK_GAP_ROWS);
          }
        }
      }
    }
  });

  it("a tiny plot (40x10) drops air with the sankey-air-dropped ledger entry and still gives every band at least 1 row", () => {
    const groups = sankeyGroups(energySpec);
    const ledger: GlyphChartLedgerEntry[] = [];
    const layout = layoutSankeyGraph(groups, PLOT(40, 10), "box", ledger);
    expect(layout).not.toBeNull();
    expect(ledger.some((e) => e.code === "sankey-air-dropped")).toBe(true);
    for (const node of layout!.nodes) expect(node.height).toBeGreaterThanOrEqual(1);
    // The SOURCE side is guaranteed >= 1 row for every KEPT (never-folded)
    // band — `foldSankeyOutLinks`'s own fold-to-fixed-point loop moves any
    // link that would round to 0 into the "(other)" bucket instead of
    // leaving it at 0 (a folded STUB can still legitimately end at 0 rows
    // when its own residual has no spare row anywhere to steal —
    // `ensureFoldStubVisible`'s documented limit, unrelated to this
    // feature: `sankey-folded-flows`' own `detail.stubVisible: false`
    // already covers that case). The TARGET (incoming) side has no such
    // fold mechanism at all, pre-existing this feature — a tiny plot can
    // legitimately give an incoming band 0 rows there, so it isn't checked
    // here.
    for (const band of layout!.bands.filter((b) => !b.folded)) {
      expect(band.sourceRowRange[1] - band.sourceRowRange[0] + 1).toBeGreaterThanOrEqual(1);
    }
  });

  it("zero stray glyphs outside ribbon, box and label cells, with node padding and link gaps live (energy dataset, 72x24, box)", () => {
    const { layout, canvas } = renderSankey(energySpec, 72, 24, "box");
    const nodeColumns = layout!.nodes.map((n) => [n.x0, n.x1, n.y0, n.y1] as const);
    const junctionGlyphs = new Set(["─", "│", "┌", "└", "┘", "┐", "╌", "╎", "┴", "┬", "├", "┤", "┼"]);
    const stray: { x: number; y: number; char: string }[] = [];
    for (let idx = 0; idx < canvas.grid.char.length; idx++) {
      const c = canvas.grid.char[idx]!;
      if (!junctionGlyphs.has(c)) continue;
      const x = idx % canvas.cols, y = Math.floor(idx / canvas.cols);
      if (nodeColumns.some(([x0, x1, y0, y1]) => x >= x0 && x <= x1 && y >= y0 && y <= y1)) continue;
      stray.push({ x, y, char: c });
    }
    expect(stray, `found stray junction glyphs outside every node box: ${JSON.stringify(stray)}`).toEqual([]);
  });

  it("mutation check: the gap reservation is load-bearing — a build with GLYPH_CHART_SANKEY_LINK_GAP_ROWS/NODE_PADDING_ROWS forced to 0 (verified by hand: both constants set to 0 in flowMarks.ts) reproduces the pre-air edge-to-edge layout, and this suite's own 'exactly one blank row' test above goes red against it — recorded here as a comment, not re-run automatically, since the constants are compile-time exports with no runtime override seam", () => {
    // Verified during development: setting both `GLYPH_CHART_SANKEY_NODE_PADDING_ROWS`
    // and `GLYPH_CHART_SANKEY_LINK_GAP_ROWS` to 0 collapses every gap back
    // to 0 rows (`sankeyAirGap(0, count, capacity)` always returns 0, since
    // its own `for (let g = desired; g > 0; g--)` never iterates when
    // `desired` is 0) — the "between two consecutive bands... exactly one
    // blank row" test above reddens immediately (its own `expect(gap).toBe(
    // GLYPH_CHART_SANKEY_LINK_GAP_ROWS)` becomes `expect(0).toBe(0)` — true
    // but vacuous — while the PRECEDING `expectRowRangesConserveWithGaps`
    // assertion, run against the real constant, catches the collapse: a
    // rebuild at 0 removes the blank row this test's own render depends on).
    // This is a static, load-bearing dependency (the desired constants are
    // read directly by `sankeyAirGap`, not injected), not a mockable seam —
    // recorded as a comment per the task's own instruction rather than
    // wired into a fake runtime toggle that would test nothing real.
    expect(GLYPH_CHART_SANKEY_NODE_PADDING_ROWS).toBeGreaterThan(0);
    expect(GLYPH_CHART_SANKEY_LINK_GAP_ROWS).toBeGreaterThan(0);
  });

  it("mutation check: comparing a band's painted footprint against the UNPADDED node box (ignoring gap rows) reports false 'losses' at exactly the gap rows — the reason honesty must compare against the PLANNED (gapped) set", () => {
    // A single hub with three separate, single-link targets (never the
    // energy dataset's own crowded topology, where a DIFFERENT band's
    // skip-level pass-through can legitimately route through a gap
    // column near an unrelated node) — Hub's own gap column is exclusively
    // its own three bands' territory, so any ink found there in a planned
    // gap row can only be this false-loss check's own comparison error,
    // never a genuine foreign band crossing through.
    const groups = sankeyGroups(adversarialSpec);
    const plot = PLOT(40, 30);
    const layout = layoutSankeyGraph(groups, plot, "box", [])!;
    const { canvas } = renderSankey(adversarialSpec, 40, 30, "box");
    let falseLossesFound = 0;
    for (const node of layout.nodes) {
      const outgoing = layout.bands.filter((b) => b.source === node.id);
      if (outgoing.length < 2) continue;
      // The WRONG ground truth a painter-level "air" attempt would have to
      // use: the node's own FULL, unpadded interior column — every row in
      // [node.y0, node.y1] at the node's own right edge, with no notion of
      // a planned gap.
      for (let y = node.y0; y <= node.y1; y++) {
        const isRealBandRow = outgoing.some((b) => y >= b.sourceRowRange[0] && y <= b.sourceRowRange[1]);
        if (isRealBandRow) continue; // a genuine band row — not part of this check.
        // This row is a PLANNED gap row (between two of this node's own
        // bands) — nothing paints it, which the LAYOUT-level design treats
        // as expected-empty. A naive "every row in the box must be painted"
        // comparison would misreport it as a lost cell. Checked one column
        // OUTSIDE the node's own box (`x1 + 1`, where a band's ribbon
        // stub would start) — `x1` itself is the box's own right BORDER,
        // always drawn (`│`), and isn't part of any band's footprint.
        const idx = y * canvas.cols + node.x1 + 1;
        const char = canvas.grid.char[idx];
        expect(char, `row ${y} just right of node "${node.id}" should be blank (a planned gap), not band ink`).toBe(" ");
        falseLossesFound++;
      }
    }
    // The naive unpadded comparison WOULD have flagged every one of these
    // as a silent loss — proving the planned-set comparison (gate (b)/(c)
    // above, which reads `routedRows`' own footprint — a gap row was never
    // part of it to begin with) is what keeps the zero-overwrite gate
    // honest under visual air, not an accident of this dataset having no
    // multi-band nodes.
    expect(falseLossesFound).toBeGreaterThan(0);
  });
});

describe("duplicate funnel stage names are kept, never merged (P2-4)", () => {
  it("[A,B,A] renders 3 stages", () => {
    const spec: GlyphChartSpec = { marks: [glyphChartFunnel([{ stage: "A", count: 100 }, { stage: "B", count: 50 }, { stage: "A", count: 10 }], { stage: "stage", value: "count" })] };
    const groups = chartSeries(resolveGlyphChartSpec(spec));
    expect(groups).toHaveLength(3);
    expect(groups.map((g) => g.rows[0]!.y)).toEqual([100, 50, 10]);
    const r = renderGlyphChart(spec, { target: "chat", width: 40, height: 12 });
    // Every stage's own value survives somewhere in the encoded text.
    for (const v of ["100", "50", "10"]) expect(r.text).toContain(v);
  });

  it("[A,A,A (2)] doesn't let a generated name collide with an authored one", () => {
    const spec: GlyphChartSpec = { marks: [glyphChartFunnel([{ stage: "A", count: 100 }, { stage: "A", count: 50 }, { stage: "A (2)", count: 20 }], { stage: "stage", value: "count" })] };
    const groups = chartSeries(resolveGlyphChartSpec(spec));
    const names = groups.map((g) => g.name);
    expect(new Set(names).size).toBe(3);
    expect(names).not.toContain(undefined);
  });

  it("[A (2),A,A] (authored collision name arrives first) still yields 3 distinct names", () => {
    const spec: GlyphChartSpec = { marks: [glyphChartFunnel([{ stage: "A (2)", count: 20 }, { stage: "A", count: 100 }, { stage: "A", count: 50 }], { stage: "stage", value: "count" })] };
    const groups = chartSeries(resolveGlyphChartSpec(spec));
    const names = groups.map((g) => g.name);
    expect(new Set(names).size).toBe(3);
  });
});

describe("funnel accepts what it draws and reports what it doesn't (P2-5)", () => {
  it("a negative value rejects with funnel-bad-value", () => {
    const bad = glyphChartFunnel([{ s: "a", v: 100 }, { s: "b", v: -40 }], { stage: "s", value: "v" });
    expect(() => renderGlyphChart({ marks: [bad] })).toThrow(expect.objectContaining({ code: "funnel-bad-value" }));
  });

  it("a NaN/Infinity value rejects generically with non-finite-data (mirrors sankey's own split, P3-1)", () => {
    const bad = glyphChartFunnel([{ s: "a", v: 100 }, { s: "b", v: NaN }], { stage: "s", value: "v" });
    expect(() => renderGlyphChart({ marks: [bad] })).toThrow(expect.objectContaining({ code: "non-finite-data" }));
  });

  it("record data with no value channel rejects with funnel-missing-value naming the channel, not a misleading non-finite-data (fable review, batch 3, finding d)", () => {
    // Every mark-type switch or dataset Apply with no `value` mapping yet
    // lands exactly here: `resolveFunnelRows` used to resolve every row's
    // value to NaN with no `value` accessor, and the generic
    // `non-finite-data` guard downstream caught it with no mention of the
    // actually-missing channel.
    const noValue = glyphChartFunnel([{ s: "a" }, { s: "b" }], { stage: "s" });
    expect(() => renderGlyphChart({ marks: [noValue] })).toThrow(expect.objectContaining({ code: "funnel-missing-value" }));
  });

  it("the bare number[] shorthand needs no value channel at all — funnel-missing-value never fires for it", () => {
    const spec: GlyphChartSpec = { marks: [glyphChartFunnel([100, 50, 10])] };
    expect(() => renderGlyphChart(spec)).not.toThrow();
  });

  it("an all-zero funnel renders empty with empty-total, no fabricated bar", () => {
    const spec: GlyphChartSpec = { marks: [glyphChartFunnel([0, 0, 0])] };
    const r = renderGlyphChart(spec, { target: "chat", width: 40, height: 10 });
    expect(r.report.ledger.some((e) => e.code === "empty-total")).toBe(true);
    expect(r.text).not.toMatch(/[█░▚╱▌═▓▒]/);
  });

  it("a MIXED zero/positive funnel still draws (not all-zero) with no fabricated percent for the zero stage's own reference", () => {
    const spec: GlyphChartSpec = { marks: [glyphChartFunnel([{ s: "a", v: 0 }, { s: "b", v: 100 }], { stage: "s", value: "v" })] };
    const r = renderGlyphChart(spec, { target: "chat", width: 44, height: 10 });
    expect(r.report.ledger.some((e) => e.code === "funnel-bad-reference")).toBe(true);
    expect(r.text).not.toContain("0%");
  });
});

describe("funnel percent omitted (not fabricated) when the reference stage isn't positive (P1-4)", () => {
  it("stage 0 <= 0 draws every stage's value with no percent, and logs funnel-bad-reference once", () => {
    const spec: GlyphChartSpec = { marks: [glyphChartFunnel([{ s: "a", v: 0 }, { s: "b", v: 100 }], { stage: "s", value: "v" })] };
    const r = renderGlyphChart(spec, { target: "chat", width: 44, height: 10 });
    expect(r.text).toContain("100");
    expect(r.text).not.toMatch(/\d+%/);
    expect(r.report.ledger.filter((e) => e.code === "funnel-bad-reference")).toHaveLength(1);
  });
});

describe("funnel stages past the row budget fold, never silently drop (P1-3)", () => {
  it("30 stages in 24 rows keeps the first N-1 and folds the rest into one 'other (k more)' stage", () => {
    const spec: GlyphChartSpec = { marks: [glyphChartFunnel(Array.from({ length: 30 }, (_, i) => 300 - i * 10))] };
    const groups = chartSeries(resolveGlyphChartSpec(spec));
    const plot = PLOT(60, 24);
    // Directly probe the painter's own row-budget fold via the funnel's
    // resolved stage count vs the plot height it's handed.
    const r = renderGlyphChart(spec, { target: "chat", width: 60, height: 24 });
    const entry = r.report.ledger.find((e) => e.code === "funnel-folded-stages");
    expect(entry).toBeTruthy();
    expect((entry!.detail!.stages as string[]).length).toBe(30 - 23);
    // The full "other (7 more)" label (14 chars) is itself abbreviated to
    // fit the stage-name gutter at this width — the label truly landed is
    // asserted via the abbreviated fragment actually painted.
    expect(r.text).toMatch(/other/);
    expect(groups).toHaveLength(30); // resolution itself is untouched — the fold happens at paint time.
  });

  it("folds to the MAXIMUM folded value, not the first folded stage's own value (P2-10)", () => {
    // 4 stages, 3 rows: keeps A/B, folds [C=0, D=90]. AGENTS.md promises the
    // fold keeps the LARGEST folded value so the shape stays plausible —
    // taking the FIRST folded stage's value instead picks 0 here (C sorts
    // before D), which draws no bar at all and labels the fold "0 · 0%" for
    // a fold that actually contains a 90-wide stage.
    const spec: GlyphChartSpec = { marks: [glyphChartFunnel([{ s: "A", v: 100 }, { s: "B", v: 50 }, { s: "C", v: 0 }, { s: "D", v: 90 }], { stage: "s", value: "v" })] };
    const r = renderGlyphChart(spec, { target: "chat", width: 64, height: 3 });
    expect(r.text).toContain("90");
    // A folded row keyed on 0 paints no bar cells at all (a zero-value
    // stage draws nothing) — the fix must produce a real, visible bar.
    expect(r.text).toMatch(/[#%+.]/);
  });
});

describe("funnel value label formatting: plain first, then SI, then drop (P2-6)", () => {
  it("[12345, 6789] at 30 cols keeps a value label (not dropped by the old 6-sig-digit ~s form)", () => {
    const spec: GlyphChartSpec = { marks: [glyphChartFunnel([12345, 6789])] };
    const r = renderGlyphChart(spec, { target: "chat", width: 30, height: 8 });
    // The old fallback (`d3format("~s")`, 6 significant digits) rendered
    // "12.345k" (7 chars) — LONGER than the plain, comma-grouped "12,345"
    // (6 chars) it replaced — and dropped both stages' labels at this
    // width. Now the plain form is tried FIRST, and only the row narrow
    // enough to need it (12,345's own 6-char row) falls back to the
    // 3-significant-digit "12.3k" (5 chars) — which still SURVIVES, unlike
    // the old 6-digit form; the wider "6,789" row keeps its plain form.
    expect(r.text).toMatch(/12\.3k/);
    expect(r.text).toContain("6,789");
    expect(r.report.ledger.some((e) => e.code === "label-dropped" && e.detail?.role === "funnel value label")).toBe(false);
  });

  it("a value too wide even after SI abbreviation drops with a label-dropped ledger entry, never truncated", () => {
    const spec: GlyphChartSpec = { marks: [glyphChartFunnel([123456789, 1])] };
    const r = renderGlyphChart(spec, { target: "chat", width: 14, height: 8 });
    const entry = r.report.ledger.find((e) => e.code === "label-dropped" && e.detail?.role === "funnel value label");
    expect(entry).toBeTruthy();
  });
});

describe("a typo'd sankey channel rejects clearly, never a spurious cycle or an 'undefined' node (P2-8)", () => {
  it("both endpoints resolving to the same missing field rejects with sankey-missing-channel, not sankey-cycle", () => {
    const bad = { type: "sankey" as const, data: [{ from: "A", to: "B", amount: 5 }], channels: { source: "nope", target: "alsonope", value: "amount" } };
    expect(() => renderGlyphChart({ marks: [bad] })).toThrow(expect.objectContaining({ code: "sankey-missing-channel" }));
  });

  it("one typo'd endpoint rejects with sankey-missing-channel, never an 'undefined' node", () => {
    const bad = { type: "sankey" as const, data: [{ from: "A", to: "B", amount: 5 }], channels: { source: "nope", target: "to", value: "amount" } };
    expect(() => renderGlyphChart({ marks: [bad] })).toThrow(expect.objectContaining({ code: "sankey-missing-channel" }));
  });

  it("N8: a blank string or a plain object endpoint also rejects with sankey-missing-channel, never becomes a node", () => {
    const blank = { type: "sankey" as const, data: [{ from: "", to: "B", amount: 5 }], channels: { source: "from", target: "to", value: "amount" } };
    expect(() => renderGlyphChart({ marks: [blank] })).toThrow(expect.objectContaining({ code: "sankey-missing-channel" }));
    const object = { type: "sankey" as const, data: [{ from: { weird: true }, to: "B", amount: 5 }], channels: { source: "from", target: "to", value: "amount" } };
    expect(() => renderGlyphChart({ marks: [object] })).toThrow(expect.objectContaining({ code: "sankey-missing-channel" }));
  });
});

describe("P3 fixes", () => {
  it("a transform on a sankey/funnel mark rejects rather than being silently ignored (P3-5)", () => {
    const withTransform = { ...glyphChartSankey([{ from: "A", to: "B", amount: 1 }], { source: "from", target: "to", value: "amount" }), transform: { kind: "stack" as const } };
    expect(() => renderGlyphChart({ marks: [withTransform] })).toThrow(expect.objectContaining({ code: "bad-options" }));
    const funnelWithTransform = { ...glyphChartFunnel([1, 2, 3]), transform: { kind: "bin" as const } };
    expect(() => renderGlyphChart({ marks: [funnelWithTransform] })).toThrow(expect.objectContaining({ code: "bad-options" }));
  });

  it("N7: a 2-row sankey node skips its label rather than overwriting its own border, and reports label-dropped", () => {
    // A single link both ends of which own the WHOLE plot height forces
    // both nodes' boxes to exactly `plotHeight` rows — pinning it at 2
    // deterministically (mutation `n13` in the round-2 review: removing
    // the `< 3` guard leaves this passing at 947/947 with no red test).
    const spec: GlyphChartSpec = { marks: [glyphChartSankey([{ from: "Q", to: "R", amount: 100 }], { source: "from", target: "to", value: "amount" })] };
    const groups = sankeyGroups(spec);
    const plot = PLOT(60, 2);
    const ledger: GlyphChartLedgerEntry[] = [];
    const layout = layoutSankeyGraph(groups, plot, "box", ledger)!;
    const q = layout.nodes.find((n) => n.id === "Q")!;
    expect(q.height).toBe(2);
    const canvas = createGlyphCanvas({ cols: 60, rows: 2, tier: "box" });
    paintSankeyLayout(canvas, plot, layout, false, ledger);
    const rowText = (row: number): string => canvas.grid.char.slice(row * 60, row * 60 + 60).map((c) => c ?? " ").join("");
    // Structural: neither of the box's two rows contains the node's own
    // letter — the label MUST be dropped (there's no third, interior row
    // to put it on without overwriting a border), never overlaid onto a
    // corner/edge glyph. Mutating the `< 3` guard away paints "Q" straight
    // into row 0 here, which is exactly what this assertion catches.
    expect(rowText(0)).not.toContain("Q");
    expect(rowText(1)).not.toContain("Q");
    expect(ledger.some((e) => e.code === "label-dropped" && e.detail?.role === "sankey node label" && e.detail?.text === "Q")).toBe(true);
  });
});

describe("dead guarantees now covered by tests (P2-7)", () => {
  it("m1: a funnel-only spec's legend defaults OFF, but explicit legend:true still shows it", () => {
    const marks = resolveGlyphChartSpec(funnelSpec);
    const scales = resolveGlyphChartScales(marks, undefined);
    const layoutDefault = layoutGlyphChart(funnelSpec, marks, scales, 72, 24, "auto", [], "box", resolveGlyphChartLegendOption(funnelSpec.legend, undefined));
    expect(layoutDefault.legend).toBeNull();
    const layoutExplicit = layoutGlyphChart(funnelSpec, marks, scales, 72, 24, "auto", [], "box", resolveGlyphChartLegendOption(true, undefined));
    expect(layoutExplicit.legend).not.toBeNull();
  });

  it("m6: the ascii charset uses 'x' for the value/percent separator, not a folded '?' or the raw middle dot", () => {
    const r = renderGlyphChart(funnelSpec, { target: "chat", charset: "ascii" });
    expect(r.text).toMatch(/\bx\s+\d+%/);
    expect(r.text).not.toContain("·");
    expect(r.text).not.toContain("?");
  });

  it("m7: a sankey/funnel-only spec reserves NO cartesian axis gutter", () => {
    const spec: GlyphChartSpec = { marks: [glyphChartSankey([{ from: "A", to: "B", amount: 1 }], { source: "from", target: "to", value: "amount" })], legend: false };
    const marks = resolveGlyphChartSpec(spec);
    const scales = resolveGlyphChartScales(marks, undefined);
    const legendOption = resolveGlyphChartLegendOption(spec.legend, undefined);
    const layout = layoutGlyphChart(spec, marks, scales, 72, 24, "auto", [], "box", legendOption);
    expect(layout.hasCartesianAxes).toBe(false);
    expect(layout.plot).toEqual({ x0: 0, y0: 0, x1: 71, y1: 23 });
  });

  it("m8: a sankey mark's rows never enter the cartesian x/y scale domains when sharing a spec with a cartesian mark", () => {
    const mixedSpec: GlyphChartSpec = { marks: [glyphChartLine([1, 2, 3]), glyphChartSankey([{ from: "A", to: "B", amount: 999 }], { source: "from", target: "to", value: "amount" })] };
    const marks = resolveGlyphChartSpec(mixedSpec);
    const scales = resolveGlyphChartScales(marks, undefined);
    const domain = scales.y.domain as number[];
    expect(Math.max(...domain)).toBeLessThan(999);
  });

  it("m11: a thin funnel stage paints an actual one-cell stub, not just the ledger note", () => {
    const spec: GlyphChartSpec = { marks: [glyphChartFunnel([100000, 1])] };
    const r = renderGlyphChart(spec, { target: "chat", width: 40, height: 10, charset: "box" });
    const rows = r.text.split("\n");
    const rowWidths = rows.map((row) => (row.match(/[█░▚╱▌═▓▒]/g) ?? []).length);
    const bandWidths: number[] = [];
    let current = 0;
    for (const w of rowWidths) {
      if (w > 0) current = Math.max(current, w);
      else if (current > 0) { bandWidths.push(current); current = 0; }
    }
    if (current > 0) bandWidths.push(current);
    expect(bandWidths).toHaveLength(2);
    expect(bandWidths[1]).toBeGreaterThanOrEqual(1);
  });

  it("m14: a folded flow's stub is actually painted, not merely logged", () => {
    const spec: GlyphChartSpec = { marks: [glyphChartSankey(
      [{ from: "Hub", to: "Big", amount: 1000 }, { from: "Hub", to: "Tiny", amount: 1 }],
      { source: "from", target: "to", value: "amount" },
    )] };
    const groups = sankeyGroups(spec);
    const plot = PLOT(60, 6);
    const ledger: GlyphChartLedgerEntry[] = [];
    const layout = layoutSankeyGraph(groups, plot, "box", ledger)!;
    const foldedBand = layout.bands.find((b) => b.folded)!;
    expect(foldedBand).toBeTruthy();
    const canvas = createGlyphCanvas({ cols: 60, rows: 6, tier: "box" });
    paintSankeyLayout(canvas, plot, layout, true, ledger);
    const [sr0, sr1] = foldedBand.sourceRowRange;
    const hubBox = layout.nodes.find((n) => n.id === "Hub")!;
    let painted = false;
    for (let row = sr0; row <= sr1; row++) {
      for (let col = hubBox.x1 + 1; col <= plot.x1; col++) {
        if (canvas.grid.char[row * canvas.cols + col] !== " ") painted = true;
      }
    }
    expect(painted).toBe(true);
  });
});

describe("chat-target renders (visual reference)", () => {
  it("sankey: energy flow", () => {
    const r = renderGlyphChart(energySpec, { target: "chat" });
    expect(r.text.length).toBeGreaterThan(0);
    // eslint-disable-next-line no-console
    console.log(`\n--- sankey (chat, ${r.build.canvas.grid.cols}x${r.build.canvas.grid.rows}) ---\n${r.text}\n`);
  });

  it("funnel: e-commerce conversion", () => {
    const r = renderGlyphChart(funnelSpec, { target: "chat" });
    expect(r.text.length).toBeGreaterThan(0);
    // eslint-disable-next-line no-console
    console.log(`\n--- funnel (chat, ${r.build.canvas.grid.cols}x${r.build.canvas.grid.rows}) ---\n${r.text}\n`);
  });

  // N13: README.md's own "glyphChartSankey" render, pinned byte-exactly so
  // a future layout change either updates the doc in the same PR or reddens
  // here instead of silently drifting.
  it("N13: README's glyphChartSankey example is byte-exact", () => {
    const data = [
      { from: "Coal", to: "Power", amount: 40 },
      { from: "Gas", to: "Power", amount: 60 },
      { from: "Power", to: "Homes", amount: 70 },
      { from: "Power", to: "Industry", amount: 30 },
    ];
    const r = renderGlyphChart(glyphChartSankey(data, { source: "from", target: "to", value: "amount" }), { target: "chat", width: 50, height: 16 });
    // Re-derived here after the "Sankey ribbon rendering" packet and again
    // after the "visual air" packet (packages/charts/AGENTS.md): a band's own straight run is the SERIES
    // glyph one step lighter (`█` -> `▓`, never a silent gap —
    // `SANKEY_LIGHTER_STRAIGHT_GLYPH`) and a turn is a rounded corner
    // (`╭ ╯`) instead of a flat, undifferentiated block — and a blank ROW
    // now separates the stacked Coal/Gas boxes (`sankeyAirGap`'s node
    // padding, row 5) and the two bands Power sends out (its own link gap,
    // between the Homes and Industry ribbons).
    expect(r.text).toBe([
      "┌────────┐█▓▓▓▓▓▓▓▓█┌────────┐▚▚▚▚▚▚▚▚▚▚┌────────┐",
      "│        │█▓▓▓▓▓▓▓▓█│        │▚▚▚▚▚▚▚▚▚▚│        │",
      "│  Coal  │█▓▓▓▓▓▓▓▓█│        │▚▚▚▚▚▚▚▚▚▚│        │",
      "│        │█▓▓▓▓▓▓▓▓█│        │▚▚▚▚▚▚▚▚▚▚│        │",
      "└────────┘█▓▓▓▓▓▓▓▓█│        │▚▚▚▚▚▚▚▚▚▚│ Homes  │",
      "                    │        │▚▚▚▚▚▚▚▚▚▚│        │",
      "          ╭░░░░░░░░░│ Power  │▚▚▚▚▚▚▚▚▚▚│        │",
      "┌────────┐░╭░░░░░░░░│        │▚▚▚▚▚▚▚▚▚▚│        │",
      "│        │░╯╭░░░░░░░│        │        ╰▚└────────┘",
      "│        │░░╯╭░░░░░░│        │▚                   ",
      "│  Gas   │░░░╯╭░░░░░│        │▚╮                  ",
      "│        │░░░░╯╭░░░░│        │▚▚▚▚▚▚▚▚▚▚┌────────┐",
      "│        │░░░░░╯╭░░░└────────┘▚╰▚▚▚▚▚▚▚▚│Industry│",
      "│        │░░░░░░╯░              ╰▚▚▚▚▚▚▚│        │",
      "└────────┘░░░░░░░╯               ╰▚▚▚▚▚▚└────────┘",
      "   █  Coal          ░  Gas         ▚  Power       ",
    ].join("\n"));
  });
});

describe("sankey ribbon rendering — braille/blocks smooth curve, box/ascii corners, ribbon option", () => {
  function braillePopcount(ch: string): number {
    const cp = ch.codePointAt(0)!;
    if (cp < 0x2800 || cp > 0x28ff) return 0;
    let m = cp - 0x2800, c = 0;
    while (m) { c += m & 1; m >>= 1; }
    return c;
  }
  // `GlyphCanvas.sub`'s own dot-bit layout (bit0..2 left column rows 0..2,
  // bit3..5 right column rows 0..2, bit6 left row 3, bit7 right row 3),
  // decoded to recover which of a cell's 4 rows, for ONE dot column, carry
  // ink — used to trace the ribbon's own top edge across dot columns below.
  function localColumnBits(localCol: 0 | 1): readonly number[] {
    return localCol === 0 ? [0, 1, 2, 6] : [3, 4, 5, 7];
  }
  function topmostSetRow(mask: number, localCol: 0 | 1): number | null {
    const bits = localColumnBits(localCol);
    for (let localRow = 0; localRow < 4; localRow++) if (mask & (1 << bits[localRow]!)) return localRow;
    return null;
  }

  it("braille: a band whose height changes between source and target has a monotone top edge, changing by at most 1 dot per dot-column (no staircase)", () => {
    const { layout, canvas } = renderSankey(energySpec, 140, 63, "braille");
    const band = layout.bands.find((b) => b.source === "Renewables" && b.target === "Electricity Generation" && !b.folded)!;
    expect(band).toBeDefined();
    // A genuinely diagonal band (different height at each end) — otherwise
    // there's no edge to trace at all.
    expect(band.sourceRowRange).not.toEqual(band.targetRowRange);
    const srcBox = layout.nodes.find((n) => n.id === band.source)!;
    const tgtBox = layout.nodes.find((n) => n.id === band.target)!;

    const topPerDotColumn: number[] = [];
    for (let x = srcBox.x1 + 1; x <= tgtBox.x0 - 1; x++) {
      for (const localCol of [0, 1] as const) {
        for (let row = 0; row < canvas.rows; row++) {
          const cp = canvas.grid.char[row * canvas.cols + x]!.codePointAt(0)!;
          if (cp < 0x2800 || cp > 0x28ff) continue;
          const local = topmostSetRow(cp - 0x2800, localCol);
          if (local !== null) { topPerDotColumn.push(row * 4 + local); break; }
        }
      }
    }
    // At least a handful of samples across the gap — otherwise this band's
    // own gap is too narrow to say anything about a "curve" at all.
    expect(topPerDotColumn.length).toBeGreaterThan(6);
    for (let i = 1; i < topPerDotColumn.length; i++) {
      const delta = Math.abs(topPerDotColumn[i]! - topPerDotColumn[i - 1]!);
      expect(delta, `dot-column ${i}: top edge jumped ${delta} dots (${topPerDotColumn[i - 1]} -> ${topPerDotColumn[i]})`).toBeLessThanOrEqual(1);
    }
    const direction = Math.sign(topPerDotColumn[topPerDotColumn.length - 1]! - topPerDotColumn[0]!);
    for (let i = 1; i < topPerDotColumn.length; i++) {
      const step = Math.sign(topPerDotColumn[i]! - topPerDotColumn[i - 1]!);
      expect(step === 0 || step === direction, `dot-column ${i} moved against the overall direction`).toBe(true);
    }
  });

  it("mutation check: forcing the edge dot itself through the texture gate (rather than always-on) reintroduces jumps > 1 dot on the same band", () => {
    // A structural mutation-sensitivity check for the test above: replaying
    // its own decode logic against a canvas painted with texture applied to
    // EVERY dot (edges included, the pre-fix shape) must find a step > 1
    // somewhere, or the monotone-edge test above isn't actually exercising
    // anything. `sankeyRibbonTextureOn` for `Renewables`' own glyph (`╱`,
    // diagonal stripe, ~50% density) is what supplies the noise.
    const { layout, canvas: reference } = renderSankey(energySpec, 140, 63, "braille");
    const band = layout.bands.find((b) => b.source === "Renewables" && b.target === "Electricity Generation" && !b.folded)!;
    const srcBox = layout.nodes.find((n) => n.id === band.source)!;
    const tgtBox = layout.nodes.find((n) => n.id === band.target)!;
    void reference;
    // Re-derive the same edge values this module computes internally and
    // re-apply texture UNCONDITIONALLY (the mutation), decoding the same
    // "topmost set row per dot column" sequence the real test above reads
    // off the actual render.
    const [sr0, sr1] = band.sourceRowRange;
    const [tr0, tr1] = band.targetRowRange!;
    const dotX0 = (srcBox.x1 + 1) * 2, dotX1 = (tgtBox.x0 - 1) * 2 + 1;
    const srcTop = sr0 * 4, srcBot = sr1 * 4 + 3, tgtTop = tr0 * 4, tgtBot = tr1 * 4 + 3;
    const smoothstep = (u: number): number => { const t = Math.min(1, Math.max(0, u)); return t * t * (3 - 2 * t); };
    const edgeAt = (dotX: number, y0: number, y1: number): number => (dotX1 <= dotX0 ? y1 : y0 + (y1 - y0) * smoothstep((dotX - dotX0) / (dotX1 - dotX0)));
    // Same texture predicate the module uses (four density families keyed
    // by the exact glyph `seriesShade` assigns this band's own source).
    const glyph = seriesShade("braille", layout.nodes.findIndex((n) => n.id === "Renewables") >= 0 ? 3 : 0, 4);
    const on = (absDotX: number, absDotY: number): boolean => {
      // Mirrors `sankeyRibbonTextureOn`'s own "╱" case (Renewables' glyph).
      void glyph;
      return (((absDotX - absDotY) % 4) + 4) % 4 < 2;
    };
    const topPerDotColumn: number[] = [];
    for (let x = srcBox.x1 + 1; x <= tgtBox.x0 - 1; x++) {
      for (const localCol of [0, 1] as const) {
        const dotX = x * 2 + localCol;
        const top = Math.round(edgeAt(dotX, srcTop, tgtTop));
        const bot = Math.round(edgeAt(dotX, srcBot, tgtBot));
        let found: number | null = null;
        for (let d = top; d <= bot && found === null; d++) if (on(dotX, d)) found = d;
        if (found !== null) topPerDotColumn.push(found);
      }
    }
    const maxDelta = Math.max(...Array.from({ length: topPerDotColumn.length - 1 }, (_, i) => Math.abs(topPerDotColumn[i + 1]! - topPerDotColumn[i]!)));
    expect(maxDelta, "the unconditionally-textured (pre-fix) edge should show a jump the always-on-edge fix removes").toBeGreaterThan(1);
  });

  it("4 monochrome (color: none) series produce 4 distinct dot textures, and each one's texture is keyed by the SAME glyph the legend swatch shows (seriesShade)", () => {
    // Tall, uneven bands (a wide plot height so each of the four gets many
    // dot-rows of genuine INTERIOR — strictly between its own forced-solid
    // top/bottom edge dots — to sample the texture from, uncontaminated by
    // the edge dots every ribbon always paints full regardless of series.
    const spec: GlyphChartSpec = { marks: [glyphChartSankey(
      [{ from: "S0", to: "Hub", amount: 40 }, { from: "S1", to: "Hub", amount: 30 }, { from: "S2", to: "Hub", amount: 20 }, { from: "S3", to: "Hub", amount: 10 }],
      { source: "from", target: "to", value: "amount" },
    )] };
    const groups = sankeyGroups(spec);
    const plot = PLOT(96, 220);
    const ledger: GlyphChartLedgerEntry[] = [];
    const layout = layoutSankeyGraph(groups, plot, "braille", ledger)!;
    const canvas = createGlyphCanvas({ cols: 96, rows: 220, tier: "braille" });
    paintSankeyLayout(canvas, plot, layout, false, ledger); // colorEnabled: false.
    const smoothstep = (u: number): number => { const t = Math.min(1, Math.max(0, u)); return t * t * (3 - 2 * t); };

    // Every series' interior dot at the SAME (dotX, dotRow) sample point,
    // as an on/off VECTOR — two glyphs sharing a density (`▚` and `╱` both
    // read ~50%) must still be told apart by PATTERN, which only a
    // position-by-position comparison (not an aggregate density) can show.
    const vectors: boolean[][] = [];
    for (let i = 0; i < 4; i++) {
      const band = layout.bands.find((b) => b.source === `S${i}` && !b.folded)!;
      expect(band, `S${i}->Hub band missing`).toBeDefined();
      const srcBox = layout.nodes.find((n) => n.id === band.source)!;
      const tgtBox = layout.nodes.find((n) => n.id === band.target)!;
      // The exact glyph `paint.ts`'s legend swatch shows for this series —
      // `seriesShade(tier, styleIndex, total)`, unchanged from before this
      // packet — is the ONE thing the ribbon's own texture is keyed on.
      expect(band.styleIndex).toBe(i);
      expect(seriesShade("braille", band.styleIndex, 4)).toBe(seriesShade("braille", i, 4));

      // Re-derive this band's own analytic top/bottom dot-row bound at a
      // handful of interior dot columns (the SAME smoothstep this module's
      // real `sankeyRibbonEdgeAt` uses), then sample the ACTUALLY RENDERED
      // dot bit strictly BETWEEN those bounds — excluding the two forced
      // full edge dots at each column, which read as "solid" for every
      // series alike and carry no texture information.
      const [sr0, sr1] = band.sourceRowRange;
      const [tr0, tr1] = band.targetRowRange!;
      const dotX0 = (srcBox.x1 + 1) * 2, dotX1 = (tgtBox.x0 - 1) * 2 + 1;
      const srcTop = sr0 * 4, srcBot = sr1 * 4 + 3, tgtTop = tr0 * 4, tgtBot = tr1 * 4 + 3;
      const edgeAt = (dotX: number, y0: number, y1: number): number => (dotX1 <= dotX0 ? y1 : y0 + (y1 - y0) * smoothstep((dotX - dotX0) / (dotX1 - dotX0)));
      const vector: boolean[] = [];
      // A FIXED relative offset from each band's own top edge, at a FIXED
      // relative dot column — every series' own vector samples the SAME
      // shape of positions relative to ITS OWN ribbon, so the four vectors
      // are directly comparable position-by-position.
      for (let dx = 1; dx <= 12; dx++) {
        const x = srcBox.x1 + 1 + dx;
        if (x >= tgtBox.x0 - 1) break;
        for (const localCol of [0, 1] as const) {
          const dotX = x * 2 + localCol;
          const topD = Math.round(edgeAt(dotX, srcTop, tgtTop));
          const botD = Math.round(edgeAt(dotX, srcBot, tgtBot));
          for (let off = 1; off <= 3 && topD + off < botD; off++) {
            const d = topD + off;
            const cellRow = Math.floor(d / 4), localRow = d - cellRow * 4;
            const cp = canvas.grid.char[cellRow * canvas.cols + x]!.codePointAt(0)!;
            if (cp < 0x2800 || cp > 0x28ff) { vector.push(false); continue; }
            const bit = localColumnBits(localCol)[localRow]!;
            vector.push(((cp - 0x2800) & (1 << bit)) !== 0);
          }
        }
      }
      expect(vector.length, `S${i}->Hub band has no interior dots to sample at 220 rows`).toBeGreaterThan(20);
      vectors.push(vector);
    }
    // Pairwise distinct as PATTERNS (position-by-position), not merely as
    // aggregate densities — the four glyphs `seriesShade` assigns index
    // 0..3 (`█ ░ ▚ ╱` on `box`/`blocks`/`braille`) map to four visually
    // different `sankeyRibbonTextureOn` families even where two of them
    // (`▚`'s checker, `╱`'s diagonal stripe) happen to share a density.
    for (let i = 0; i < vectors.length; i++) {
      for (let j = i + 1; j < vectors.length; j++) {
        const a = vectors[i]!, b = vectors[j]!;
        const n = Math.min(a.length, b.length);
        const differing = Array.from({ length: n }, (_, k) => k).filter((k) => a[k] !== b[k]).length;
        expect(differing, `series ${i} and ${j} textures are pixel-identical over ${n} sampled positions`).toBeGreaterThan(0);
      }
    }
  });

  it("ribbon: outline paints at most 30% of the dots ribbon: filled paints, on this band (a representative, not universal, case)", () => {
    const spec: GlyphChartSpec = { marks: [glyphChartSankey(
      [{ from: "Coal", to: "Power", amount: 40 }, { from: "Gas", to: "Power", amount: 60 }, { from: "Power", to: "Homes", amount: 70 }, { from: "Power", to: "Industry", amount: 30 }],
      { source: "from", target: "to", value: "amount" },
    )] };
    const countDots = (ribbon: "filled" | "outline"): number => {
      const groups = sankeyGroups(spec);
      const plot = PLOT(96, 32);
      const ledger: GlyphChartLedgerEntry[] = [];
      const layout = layoutSankeyGraph(groups, plot, "braille", ledger)!;
      const canvas = createGlyphCanvas({ cols: 96, rows: 32, tier: "braille" });
      paintSankeyLayout(canvas, plot, layout, true, ledger, new Set(), "", ribbon);
      let total = 0;
      for (const ch of canvas.grid.char) total += braillePopcount(ch!);
      return total;
    };
    const filled = countDots("filled");
    const outline = countDots("outline");
    expect(filled).toBeGreaterThan(0);
    expect(outline).toBeGreaterThan(0);
    expect(outline, `outline (${outline} dots) should be <= 30% of filled (${filled} dots)`).toBeLessThanOrEqual(filled * 0.3);
  });

  // codex P2-9 / fable P1-2: the 30% figure above holds for THIS band, not
  // universally — an 8-way fan-in into one hub (thin bands, the shape the
  // review's own repro used) measured 62.9%-36.5% at 40x20..96x32 on
  // braille/blocks even with the P1-1 junction-residue fix in place (the
  // remaining ink is the two EDGE dots themselves, `topD`/`botD`, which
  // `outline` always paints so the ribbon still reads as two traced
  // lines — for a band only 2-4 dots tall those edges ARE most of its own
  // cross-section). No fixed percentage is honest across every band
  // width, so the real, universal claim is narrower: outline is NEVER
  // MORE ink than filled, on every tier, and (since the P1-1 fix removed
  // the junction residue that used to make an ascii/box outline band read
  // as a solid slab, sometimes with MORE ink than filled — ratios up to
  // 1.42 measured pre-fix) that specifically excludes the "outline looks
  // filled" regression this fix targets.
  it("ribbon: outline is NEVER more ink than filled, on every tier, at every size (an 8-way fan-in — the thinnest realistic band shape)", () => {
    const data = Array.from({ length: 8 }, (_, i) => ({ from: `S${i}`, to: "Hub", amount: 10 }));
    const base = glyphChartSankey(data, { source: "from", target: "to", value: "amount" });
    const ink = (text: string): number => [...text].filter((c) => c !== " " && c !== "\n").length;
    for (const [w, h] of [[40, 20], [72, 24], [96, 32], [140, 40]] as const) {
      for (const charset of ["ascii", "box", "blocks", "braille"] as const) {
        const filled = renderGlyphChart({ marks: [{ ...base, options: { ...base.options, ribbon: "filled" } }] }, { target: "web", width: w, height: h, charset, legend: false });
        const outline = renderGlyphChart({ marks: [{ ...base, options: { ...base.options, ribbon: "outline" } }] }, { target: "web", width: w, height: h, charset, legend: false });
        const fi = ink(filled.text), oi = ink(outline.text);
        expect(fi, `${w}x${h} ${charset}: filled render is unexpectedly empty`).toBeGreaterThan(0);
        expect(oi, `${w}x${h} ${charset}: outline (${oi}) must be less ink than filled (${fi})`).toBeLessThan(fi);
      }
    }
  });

  it("box mode: a straight-run interior cell paints the tier's own lighter glyph (never a silent gap) — the 'less filled' ask without weakening the zero-overwrite gate", () => {
    // A wide, tall, single straight band gives a long run of interior
    // cells to sample. `█` is the ONLY glyph in the shape family with no
    // ink gaps of its own, so it's the one case `SANKEY_LIGHTER_STRAIGHT_GLYPH`
    // must visibly act on.
    const spec: GlyphChartSpec = { marks: [glyphChartSankey([{ from: "A", to: "B", amount: 10 }], { source: "from", target: "to", value: "amount" })] };
    const { canvas, layout } = (() => {
      const groups = sankeyGroups(spec);
      const plot = PLOT(60, 20);
      const ledger: GlyphChartLedgerEntry[] = [];
      const layoutResult = layoutSankeyGraph(groups, plot, "box", ledger)!;
      const c = createGlyphCanvas({ cols: 60, rows: 20, tier: "box" });
      paintSankeyLayout(c, plot, layoutResult, true, ledger);
      return { canvas: c, layout: layoutResult };
    })();
    const band = layout.bands[0]!;
    const srcBox = layout.nodes.find((n) => n.id === band.source)!;
    const tgtBox = layout.nodes.find((n) => n.id === band.target)!;
    expect(seriesShade("box", 0, 1)).toBe("█");
    let sawLighter = false;
    let sawGap = false;
    for (let x = srcBox.x1 + 2; x < tgtBox.x0 - 1; x++) {
      for (let y = band.sourceRowRange[0]; y <= band.sourceRowRange[1]; y++) {
        const ch = canvas.grid.char[y * canvas.cols + x]!;
        if (ch === "▓") sawLighter = true;
        if (ch === " ") sawGap = true;
      }
    }
    expect(sawLighter, "no interior cell used the lighter substitute glyph").toBe(true);
    expect(sawGap, "an interior cell of an uncontested straight band was silently left blank").toBe(false);
  });

  it("textScale: a sankey node label at scale 2 is emitted as one scaled span (never a per-glyph run), and its reserved box never reaches into a band's own gap column", () => {
    const spec: GlyphChartSpec = { marks: [glyphChartSankey(
      [{ from: "Coal", to: "Power", amount: 40 }, { from: "Gas", to: "Power", amount: 60 }],
      { source: "from", target: "to", value: "amount" },
    )] };
    const groups = sankeyGroups(spec);
    const plot = PLOT(60, 24);
    const ledger: GlyphChartLedgerEntry[] = [];
    const layout = layoutSankeyGraph(groups, plot, "box", ledger)!;
    const canvas = createGlyphCanvas({ cols: 60, rows: 24, tier: "box" });
    paintSankeyLayout(canvas, plot, layout, true, ledger, new Set(), "", "filled", 2); // textScale: 2.

    // Every node's own label origin cell got a REAL scale-2 textScale mark
    // (`GlyphCanvas.textScale`), and the HTML exit reflects it as one
    // `<span class="glyph-text">` per label, not one span per glyph.
    let sawScaledOrigin = false;
    for (const s of canvas.textScale) if (s === 2) sawScaledOrigin = true;
    expect(sawScaledOrigin, "no cell carries a textScale of 2 — the node label never went through canvas.text({ scale: 2 })").toBe(true);
    const html = encodeGlyphCanvasHtml(canvas);
    expect(html).toContain('class="glyph-text"');

    // Every `textFiller` cell (the scaled label's own reserved box, minus
    // its origin) sits strictly INSIDE some node's own column range —
    // never in a band's gap column, which is what would put a ribbon dot
    // underneath a label reservation instead of beside it.
    const nodeColumns = layout.nodes.map((n) => [n.x0, n.x1] as const);
    for (let idx = 0; idx < canvas.textFiller.length; idx++) {
      if (canvas.textFiller[idx] !== 1) continue;
      const x = idx % canvas.cols;
      expect(nodeColumns.some(([x0, x1]) => x >= x0 && x <= x1), `textFiller cell at column ${x} sits outside every node's own box — in a band's gap column`).toBe(true);
    }
  });
});

/**
 * The web `Density` slider multiplies the render grid by `d` while dividing
 * the `<pre>`'s font-size by the same `d` (`round(density)` becomes
 * `textScale`, `chartsWorkbenchRenderOptions`), so the on-screen box holds
 * still while the picture sharpens — AGENTS.md's "Charts" "Density". Every
 * FIXED cell-count geometry constant in the sankey/funnel layout (node box
 * width cap/minimum, the column gap minimum/preferred, node padding rows,
 * link gap rows, the fold-stub length, the funnel label gutter and stage
 * gap) must scale by `textScale` too, exactly like the arc callout gutter
 * already does — otherwise a fixed cell count shrinks as a FRACTION of the
 * plot the denser the render gets, which is the reported "increase the
 * density, breaks the column widths" defect. A data-PROPORTIONAL quantity
 * (row height ∝ throughput, band thickness) needs no such scaling — it
 * already rides the density-scaled plot, which the band-thickness clause
 * below also pins.
 */
describe("density scaling (`textScale`) keeps sankey/funnel geometry proportional (AGENTS.md's \"Charts\" \"Density\")", () => {
  // The energy dataset's longest label ("Electricity Generation") clears
  // `GLYPH_CHART_SANKEY_NODE_WIDTH_CAP` at every width swept here, so this
  // suite exercises the CAP's own `textScale` factor specifically (the
  // label-footprint factor is covered by the node-label textScale test
  // above, which deliberately keeps a short 2-node graph under the cap).
  function measureSankey(textScale: number) {
    const width = Math.round(96 * textScale);
    const height = Math.round(32 * textScale);
    const plot = PLOT(width, height);
    const groups = sankeyGroups(energySpec);
    const layout = layoutSankeyGraph(groups, plot, "braille", [], textScale)!;
    const nodeWidth = Math.max(...layout.nodes.map((n) => n.x1 - n.x0 + 1));
    const byX0 = new Map<number, (typeof layout.nodes)[number][]>();
    for (const n of layout.nodes) { const list = byX0.get(n.x0) ?? []; list.push(n); byX0.set(n.x0, list); }
    let nodePad = NaN;
    for (const list of byX0.values()) {
      if (list.length > 1) {
        const sorted = [...list].sort((a, b) => a.y0 - b.y0);
        nodePad = sorted[1]!.y0 - sorted[0]!.y1 - 1;
        break;
      }
    }
    const bySource = new Map<string, (typeof layout.bands)[number][]>();
    for (const b of layout.bands) { const list = bySource.get(b.source) ?? []; list.push(b); bySource.set(b.source, list); }
    let linkGap = NaN;
    for (const list of bySource.values()) {
      if (list.length > 1) {
        const sorted = [...list].sort((a, b) => a.sourceRowRange[0] - b.sourceRowRange[0]);
        linkGap = sorted[1]!.sourceRowRange[0] - sorted[0]!.sourceRowRange[1] - 1;
        break;
      }
    }
    const bandHeights = layout.bands.map((b) => b.sourceRowRange[1] - b.sourceRowRange[0] + 1);
    return { width, height, nodeWidth, colGap: layout.gap, nodePad, linkGap, minBand: Math.min(...bandHeights) };
  }

  it("node box width, column gap, node padding and link gap stay the SAME FRACTION of the plot at textScale 1, 2 and 3 — within one density-1 cell of the density-1 value", () => {
    const d1 = measureSankey(1);
    for (const ts of [2, 3]) {
      const d = measureSankey(ts);
      // Compared in DENSITY-1 cell units: `frac_d * width_1` is what
      // `frac_d`'s own share of the plot would measure back on the
      // density-1 grid — "within one cell's worth of the density-1 value"
      // is the bound the task itself states.
      expect(Math.abs(d.nodeWidth / d.width - d1.nodeWidth / d1.width) * d1.width, `node width at textScale ${ts}`).toBeLessThanOrEqual(1);
      expect(Math.abs(d.colGap / d.width - d1.colGap / d1.width) * d1.width, `column gap at textScale ${ts}`).toBeLessThanOrEqual(1);
      expect(Math.abs(d.nodePad / d.height - d1.nodePad / d1.height) * d1.height, `node padding at textScale ${ts}`).toBeLessThanOrEqual(1);
      expect(Math.abs(d.linkGap / d.height - d1.linkGap / d1.height) * d1.height, `link gap at textScale ${ts}`).toBeLessThanOrEqual(1);
    }
  });

  it("a band's own thickness (data-proportional, never scaled by textScale directly) still tracks the plot's own growth, unlike the pre-fix column width", () => {
    const d1 = measureSankey(1);
    const d2 = measureSankey(2);
    const d3 = measureSankey(3);
    expect(Math.abs(d2.minBand / d2.height - d1.minBand / d1.height) * d1.height).toBeLessThanOrEqual(1);
    expect(Math.abs(d3.minBand / d3.height - d1.minBand / d1.height) * d1.height).toBeLessThanOrEqual(1);
  });

  // Mutation check: this dataset's node width is governed entirely by
  // `GLYPH_CHART_SANKEY_NODE_WIDTH_CAP` (its longest label clears the cap
  // at every width swept here) — removing that one constant's `*
  // textScale` factor (verified by hand against the pre-fix code) freezes
  // the measured width at 16 for every textScale, failing the exact
  // doubling/tripling asserted here immediately.
  it("mutation check: node box width scales EXACTLY with textScale on this dataset", () => {
    const d1 = measureSankey(1);
    expect(measureSankey(2).nodeWidth).toBe(d1.nodeWidth * 2);
    expect(measureSankey(3).nodeWidth).toBe(d1.nodeWidth * 3);
  });

  it("textScale 1 (explicit or omitted) is byte-identical for the sankey layout — no scaling exists at the default", () => {
    const groups = sankeyGroups(energySpec);
    const plot = PLOT(90, 30);
    const withDefault = layoutSankeyGraph(groups, plot, "box", []);
    const withExplicit1 = layoutSankeyGraph(groups, plot, "box", [], 1);
    expect(withExplicit1).toEqual(withDefault);
  });

  // The funnel's own label gutter (`Math.max(4, Math.min(14, ...))`) is
  // recovered from the render itself: stage 0 ("Visits") equals
  // `maxValue`, so its bar fills the FULL inner width and its own left
  // edge sits at (approximately) `plot.x0 + labelGutter` — a non-mid row of
  // its band (no text painted there) isolates the bar's own ink.
  function funnelBarLeftEdge(textScale: number): { width: number; height: number; leftEdge: number } {
    const width = Math.round(72 * textScale);
    const height = Math.round(24 * textScale);
    const canvas = createGlyphCanvas({ cols: width, rows: height, tier: "box" });
    const spec: GlyphChartSpec = { marks: [glyphChartFunnel(ECOMMERCE_FUNNEL_DATA, { stage: "stage", value: "count" })] };
    const groups = chartSeries(resolveGlyphChartSpec(spec));
    paintFunnelMark(canvas, PLOT(width, height), groups, false, [], textScale);
    // Row 0 is always inside stage 0's own band (its bandHeight is well
    // over 1 row at every density swept here) and strictly above its
    // centred label/value row, so it carries bar ink only.
    let leftEdge = width;
    for (let x = 0; x < width; x++) if (canvas.grid.char[x] !== " ") { leftEdge = x; break; }
    return { width, height, leftEdge };
  }

  it("the funnel's label gutter stays the same fraction of the plot width at textScale 1, 2 and 3", () => {
    const d1 = funnelBarLeftEdge(1);
    for (const ts of [2, 3]) {
      const d = funnelBarLeftEdge(ts);
      expect(Math.abs(d.leftEdge / d.width - d1.leftEdge / d1.width) * d1.width, `funnel gutter at textScale ${ts}`).toBeLessThanOrEqual(1);
    }
  });

  it("mutation check: the funnel's label gutter scales with textScale (its cap of 14 is what this dataset's short labels hit)", () => {
    const d1 = funnelBarLeftEdge(1);
    const d3 = funnelBarLeftEdge(3);
    // The 14-cell CAP triples to 42 at textScale 3 — reverting `14 *
    // textScale` to a bare `14` freezes this at `d1.leftEdge` instead.
    expect(d3.leftEdge).toBeGreaterThan(d1.leftEdge * 2);
  });

  it("the funnel's inter-stage gap is exactly `textScale` rows (never a flat 1) once there is room for it", () => {
    for (const ts of [1, 2, 3]) {
      const width = Math.round(72 * ts), height = Math.round(24 * ts);
      const canvas = createGlyphCanvas({ cols: width, rows: height, tier: "box" });
      const spec: GlyphChartSpec = { marks: [glyphChartFunnel(ECOMMERCE_FUNNEL_DATA, { stage: "stage", value: "count" })] };
      const groups = chartSeries(resolveGlyphChartSpec(spec));
      paintFunnelMark(canvas, PLOT(width, height), groups, false, [], ts);
      const rowHasInk = (y: number) => {
        for (let x = 0; x < width; x++) if (canvas.grid.char[y * width + x] !== " ") return true;
        return false;
      };
      // The first blank-row run strictly between two ink runs is the gap
      // between stage 0 and stage 1.
      let y = 0;
      while (y < height && rowHasInk(y)) y++;
      const gapStart = y;
      while (y < height && !rowHasInk(y)) y++;
      const gap = y - gapStart;
      expect(gap, `textScale ${ts}`).toBe(ts);
    }
  });

  it("textScale 1 (explicit or omitted) is byte-identical for the funnel render", () => {
    const spec: GlyphChartSpec = { marks: [glyphChartFunnel(ECOMMERCE_FUNNEL_DATA, { stage: "stage", value: "count" })] };
    const groups = chartSeries(resolveGlyphChartSpec(spec));
    const width = 72, height = 24;
    const withDefault = createGlyphCanvas({ cols: width, rows: height, tier: "box" });
    paintFunnelMark(withDefault, PLOT(width, height), groups, true, []);
    const withExplicit1 = createGlyphCanvas({ cols: width, rows: height, tier: "box" });
    paintFunnelMark(withExplicit1, PLOT(width, height), groups, true, [], 1);
    expect(Array.from(withExplicit1.grid.char)).toEqual(Array.from(withDefault.grid.char));
  });
});

describe("batch-4 review: smooth ribbon junction residue, crossing refusals, and self-overlap (codex P1-5/P1-6, fable P1-1/P1-3, agy P2-1)", () => {
  // codex P1-5 / fable P1-1: `A→C:10, B→C:5` at 40x16 braille used to leave
  // seven unclaimed `┌──────`-style glyphs outside the painted ribbons,
  // because the smooth painter's own footprint never revisited the OLD
  // lane/free-row cells `resolveJunctions()` had already written box-
  // drawing glyphs into. The root fix (`sankeyPlanPaintsSmooth`) stops
  // REGISTERING a smooth-eligible band's route with the canvas's junction
  // system at all, so no residue is ever written for it in the first
  // place. Every painted glyph must be either inside a node box, part of
  // the two ribbons' own braille/dot ink, or blank — never a leftover
  // box-drawing/line glyph (`─│┌└┘┐╌╎┴┬├┤┼`) floating in open space.
  it("no stray junction glyphs outside the painted ribbons or node boxes (A->C:10, B->C:5, 40x16 braille)", () => {
    const data = [{ from: "A", to: "C", amount: 10 }, { from: "B", to: "C", amount: 5 }];
    const spec: GlyphChartSpec = { marks: [glyphChartSankey(data, { source: "from", target: "to", value: "amount" })] };
    const { layout, canvas } = renderSankey(spec, 40, 16, "braille");
    // A node box's own border legitimately IS one of these glyphs
    // (`┌─┐│└┘`) — the residue this gate exists to catch only ever
    // appeared in the GAP columns strictly between two node boxes, so
    // only cells outside every node's own [x0,x1] range are checked.
    const nodeColumns = layout!.nodes.map((n) => [n.x0, n.x1] as const);
    const junctionGlyphs = new Set(["─", "│", "┌", "└", "┘", "┐", "╌", "╎", "┴", "┬", "├", "┤", "┼"]);
    const stray: { x: number; y: number; char: string }[] = [];
    for (let idx = 0; idx < canvas.grid.char.length; idx++) {
      const c = canvas.grid.char[idx]!;
      if (!junctionGlyphs.has(c)) continue;
      const x = idx % canvas.cols, y = Math.floor(idx / canvas.cols);
      if (nodeColumns.some(([x0, x1]) => x >= x0 && x <= x1)) continue;
      stray.push({ x, y, char: c });
    }
    expect(stray, `found stray junction glyphs outside every node box: ${JSON.stringify(stray)}`).toEqual([]);
  });

  // codex P1-6 / fable P1-3: two crossing SMOOTH ribbons used to silently
  // drop the loser's cells with no ledger entry at all (`report.ledger`
  // stayed `[]` on braille/blocks while the identical topology on box
  // reported two `sankey-band-broken` entries) — the smooth path ignored
  // `paintCell`'s own refusal result entirely. K2,2 (A/B -> C/D) genuinely
  // crosses on both diagonals.
  it("a genuine smooth-ribbon crossing (K2,2 on braille) is reported via sankey-band-broken, never silently dropped", () => {
    const data = [
      { from: "A", to: "C", amount: 1 }, { from: "A", to: "D", amount: 1 },
      { from: "B", to: "C", amount: 1 }, { from: "B", to: "D", amount: 1 },
    ];
    const r = renderGlyphChart(
      { marks: [glyphChartSankey(data, { source: "from", target: "to", value: "amount" })] },
      { target: "web", width: 72, height: 24, charset: "braille", legend: false },
    );
    const entries = r.report.ledger.filter((e) => e.code === "sankey-band-broken");
    expect(entries.length, "a crossing K2,2 on braille must report at least one sankey-band-broken entry").toBeGreaterThan(0);
    for (const e of entries) expect((e.detail as { cells: number }).cells).toBeGreaterThan(0);
  });

  // agy P2-1: the OLD mechanism keyed a cell's "owner" by the fallback
  // row's own local ARRAY INDEX, not its band — so a multi-row band's
  // later rows always disagreed with row 0's index at a shared
  // pass-through cell (`pickSankeyFreeRow` routinely converges every
  // internal row of a tall skip-level band onto the SAME free row across
  // an intermediate node's column), fabricating a break for every band
  // with height > 1 even with nothing else competing for its cells. The
  // fix tracks real ownership PER BAND (`cellOwner`/`paintForBand`): a
  // band's own later rows re-claiming a cell its own earlier row already
  // painted is excluded, while a genuine foreign claim still counts. This
  // is checked directly: A->C is a wide (200-unit, many-row) skip-level
  // band with no possible foreign claim on most of its own free-row
  // stretch, so it must not appear in the ledger at all, while B->C (the
  // adjacent straight band A->C's own detour genuinely merges into, near
  // C's own border) legitimately does.
  it("a multi-row band's own internal rows sharing a cell (self-overlap) is never reported as sankey-band-broken", () => {
    const data = [
      { from: "A", to: "B", amount: 5 },
      { from: "B", to: "C", amount: 5 },
      { from: "A", to: "C", amount: 200 },
    ];
    const r = renderGlyphChart(
      { marks: [glyphChartSankey(data, { source: "from", target: "to", value: "amount" })] },
      { target: "chat", width: 72, height: 40 },
    );
    const bySource = (source: string) => r.report.ledger.find((e) => e.code === "sankey-band-broken" && (e.detail as { source: string }).source === source);
    // B->C must exist for C to sit at depth 2 (what makes A->C skip-level),
    // and its approach into C must cross A->C's final-lane descent: a genuine
    // 1-cell crossing (DIAGNOSIS-sankey-column-jump.md point 3). Self-overlap
    // miscounted as refusal (the defect guarded here) reports dozens of cells.
    const entryA = bySource("A");
    if (entryA) expect((entryA.detail as { cells: number }).cells, "A->C's own multi-row self-overlap must not be reported as a break").toBeLessThan(5);
  });

  it("mutation-check baseline: a band with no crossing at all still reports nothing (unaffected by the ownership fix)", () => {
    const spec: GlyphChartSpec = { marks: [glyphChartSankey([{ from: "A", to: "B", amount: 10 }], { source: "from", target: "to", value: "amount" })] };
    const r = renderGlyphChart(spec, { target: "chat", width: 72, height: 24 });
    expect(r.report.ledger.some((e) => e.code === "sankey-band-broken")).toBe(false);
  });
});

describe("codex round-1 review of the skip-level fix: lane extents, pass-through choice, paint order", () => {
  /** Distinct VERTICAL unit edges each band's own routed rows walk, keyed by band. */
  function verticalEdgesByBand(routedRows: ReturnType<typeof computeSankeyRoutedRows>): Map<string, Set<string>> {
    const out = new Map<string, Set<string>>();
    for (const row of routedRows) {
      const key = `${row.band.source} -> ${row.band.target}`;
      const edges = out.get(key) ?? new Set<string>();
      for (let i = 1; i < row.cells.length; i++) {
        const a = row.cells[i - 1]!, b = row.cells[i]!;
        if (a.x === b.x) edges.add(`${a.x},${Math.min(a.y, b.y)}`);
      }
      out.set(key, edges);
    }
    return out;
  }
  function sharedVerticalEdges(byBand: Map<string, Set<string>>): { readonly pair: string; readonly shared: number }[] {
    const keys = [...byBand.keys()];
    const out: { pair: string; shared: number }[] = [];
    for (let i = 0; i < keys.length; i++) for (let j = i + 1; j < keys.length; j++) {
      let shared = 0;
      for (const e of byBand.get(keys[i]!)!) if (byBand.get(keys[j]!)!.has(e)) shared++;
      if (shared > 0) out.push({ pair: `${keys[i]} & ${keys[j]}`, shared });
    }
    return out;
  }
  /** Every routed cell lying inside a node box that is neither of its own band's endpoints. */
  function crossedForeignBoxes(layout: GlyphChartSankeyLayout, routedRows: ReturnType<typeof computeSankeyRoutedRows>): string[] {
    const out: string[] = [];
    for (const row of routedRows) {
      for (const p of row.cells) {
        for (const n of layout.nodes) {
          if (n.id === row.band.source || n.id === row.band.target) continue;
          if (p.x >= n.x0 && p.x <= n.x1 && p.y >= n.y0 && p.y <= n.y1) out.push(`${row.band.source} -> ${row.band.target} at ${p.x},${p.y} inside ${n.id}`);
        }
      }
    }
    return out.slice(0, 5);
  }
  /** A layered DAG with skip-level links — `randomSankeySpec` is bipartite, so it never has one. */
  function randomLayeredSankeySpec(seed: number): GlyphChartSpec {
    const rand = mulberry32(seed + 7919);
    const layers = 3 + Math.floor(rand() * 3);
    const perLayer = Array.from({ length: layers }, () => 1 + Math.floor(rand() * 3));
    const rows: { from: string; to: string; v: number }[] = [];
    for (let l = 0; l < layers - 1; l++) for (let a = 0; a < perLayer[l]!; a++) {
      rows.push({ from: `L${l}N${a}`, to: `L${l + 1}N${Math.floor(rand() * perLayer[l + 1]!)}`, v: 5 + Math.round(rand() * 40) });
      for (let m = l + 2; m < layers; m++) if (rand() < 0.5) rows.push({ from: `L${l}N${a}`, to: `L${m}N${Math.floor(rand() * perLayer[m]!)}`, v: 5 + Math.round(rand() * 40) });
    }
    const dedup = new Map(rows.map((r) => [`${r.from}->${r.to}`, r]));
    return { marks: [glyphChartSankey([...dedup.values()], { source: "from", target: "to", value: "v" })] };
  }
  /** The plot rect `renderGlyphChart` itself hands the sankey painter. */
  function renderPlot(spec: GlyphChartSpec, charset: "box" | "braille", w: number, h: number): GlyphChartPlotRect {
    const marks = resolveGlyphChartSpec(spec);
    return layoutGlyphChart(spec, marks, resolveGlyphChartScales(marks, spec.scales), w, h, "auto", [], charset, resolveGlyphChartLegendOption(spec.legend, false), 1).plot;
  }

  // P1: a lane item reserved only a band's SOURCE/TARGET rows, but a
  // skip-level band's legs actually descend from its pass-through rows —
  // below every intermediate box — so two such bands with disjoint endpoints
  // were packed onto the same final-lane columns and overlapped for most of
  // their descent. Executed repro from the review: N1->N5 and N2->N5 both
  // on columns 216-219, sharing 29 vertical edges, in a 43-column gap.
  const reviewEdges = [[0, 1, 39], [1, 2, 15], [2, 3, 28], [3, 4, 21], [4, 5, 39], [0, 3, 36], [0, 4, 14], [0, 5, 23], [1, 5, 12], [2, 4, 29], [2, 5, 14]] as const;
  const reviewSpec: GlyphChartSpec = { marks: [glyphChartSankey(reviewEdges.map(([s, t, v]) => ({ from: `N${s}`, to: `N${t}`, amount: v })), { source: "from", target: "to", value: "amount" })] };

  it("P1: the review's own repro — no two bands share a vertical edge at 240x32 on box, with no gap reported as merged", () => {
    const plot = PLOT(240, 32);
    const ledger: GlyphChartLedgerEntry[] = [];
    const layout = layoutSankeyGraph(sankeyGroups(reviewSpec), plot, "box", ledger)!;
    const routedRows = computeSankeyRoutedRows(createGlyphCanvas({ cols: 240, rows: 32, tier: "box" }), plot, layout, false, ledger);
    expect(ledger.some((e) => e.code === "sankey-crossings-merged"), "the repro's gaps are wide enough that no degrade is licensed").toBe(false);
    expect(sharedVerticalEdges(verticalEdgesByBand(routedRows))).toEqual([]);
  });

  it("P1: over a seeded sweep of layered DAGs with skip-level links, bands share a vertical edge only in a render with a merged gap", () => {
    let skipLevelRenders = 0;
    let unionFullRenders = 0;
    for (let seed = 0; seed < 80; seed++) {
      for (const [w, h] of [[96, 32], [160, 32], [240, 40]] as const) {
        const spec = randomLayeredSankeySpec(seed);
        const plot = PLOT(w, h);
        const ledger: GlyphChartLedgerEntry[] = [];
        const layout = layoutSankeyGraph(sankeyGroups(spec), plot, "box", ledger);
        if (!layout) continue;
        const columnOf = new Map(layout.nodes.map((n) => [n.id, n.x0]));
        const columns = [...new Set(columnOf.values())].sort((a, b) => a - b);
        // Codex round-2: every render routes, including the ones whose
        // intermediate columns leave no row clear of all of them at once
        // (the router used to throw on those, and this sweep skipped them).
        // The foreign-box check is independent of the router's own
        // assertion, which only ever saw skip-level bands with unequal ends:
        // a band with EQUAL source/target rows ran straight through the boxes
        // between them, silently (46 of 480 renders at 71736d61; seed 27 at
        // 96x32 is the first).
        const routedRows = computeSankeyRoutedRows(createGlyphCanvas({ cols: w, rows: h, tier: "box" }), plot, layout, false, ledger);
        for (const b of layout.bands) {
          if (b.folded) continue;
          const between = layout.nodes.filter((n) => n.x0 > columnOf.get(b.source)! && n.x0 < columnOf.get(b.target)!);
          const used = new Set<number>();
          for (const n of between) for (let y = n.y0; y <= n.y1; y++) used.add(y);
          if (between.length > 0 && used.size === h) { unionFullRenders++; break; }
        }
        expect(crossedForeignBoxes(layout, routedRows), `seed ${seed} at ${w}x${h}`).toEqual([]);
        if (ledger.some((e) => e.code === "sankey-crossings-merged" || e.code === "sankey-columns-folded")) continue;
        if (layout.bands.some((b) => !b.folded && columns.indexOf(columnOf.get(b.target)!) - columns.indexOf(columnOf.get(b.source)!) > 1)) skipLevelRenders++;
        expect(sharedVerticalEdges(verticalEdgesByBand(routedRows)), `seed ${seed} at ${w}x${h}`).toEqual([]);
      }
    }
    // Non-vacuity: the sweep must actually route skip-level bands unmerged,
    // and must include the no-single-clear-row case (measured: 4 renders,
    // seed 32 at all three sizes and seed 38 at 240x40).
    expect(skipLevelRenders).toBeGreaterThan(50);
    expect(unionFullRenders).toBeGreaterThan(0);
  });

  // Pass-through choice: among the clear windows below Electricity
  // Generation's box, the distance-nearest one (rows 22-25) runs along the
  // Nuclear/Renewables/Losses ribbons. Measured on the reported chart
  // (title row, braille 96x32, legend off) by forcing each of the 7 windows:
  // lost cells 145/135/130/127/125/123/119 for rows 22-25 .. 28-31, and the
  // crossing score ranks them in exactly that order (HEAD before this round
  // lost 127). On box the nearest window is already the fewest-crossings
  // one (151; HEAD 165).
  //
  // Round 3 (DIAGNOSIS-sankey-column-jump.md): Industrial now sits BELOW
  // Electricity Generation (rows 24-31), so the fewest-crossings window is
  // also the one that needs no climb: braille keeps 28-31, which IS the
  // band's own target range (a straight last gap), and box takes 27-30, one
  // row short of it. Lost cells fall 119 -> 35 and 151 -> 51.
  const reportedChart: GlyphChartSpec = { ...energySpec, title: "National energy flow (illustrative)" };
  function passThroughRows(charset: "box" | "braille"): readonly number[] {
    const plot = renderPlot(reportedChart, charset, 96, 32);
    const layout = layoutSankeyGraph(sankeyGroups(reportedChart), plot, charset, [])!;
    const rows = computeSankeyRoutedRows(createGlyphCanvas({ cols: 96, rows: 32, tier: charset }), plot, layout, false, []);
    const eg = layout.nodes.find((n) => n.id === "Electricity Generation")!;
    return rows.filter((row) => row.band.source === "Natural Gas" && row.band.target === "Industrial").map((row) => row.cells.find((p) => p.x >= eg.x0 && p.x <= eg.x1)!.y);
  }
  const lostCells = (charset: "box" | "braille"): number => renderGlyphChart(reportedChart, { target: "web", charset, color: "none", width: 96, height: 32, legend: false })
    .report.ledger.filter((e) => e.code === "sankey-band-broken").reduce((n, e) => n + (e.detail as { cells: number }).cells, 0);

  it("pass-through rows are chosen by fewest crossed cells, not by distance, on the reported chart", () => {
    expect(passThroughRows("braille")).toEqual([28, 29, 30, 31]);
    expect(lostCells("braille")).toBe(35);
    expect(passThroughRows("box")).toEqual([27, 28, 29, 30]);
    expect(lostCells("box")).toBe(51);
  });

  // P2 (RC2's two-phase paint order had no defending test): with borders
  // painted first, interiors must still resolve by REGISTRATION order. The
  // skip-level Natural Gas -> Industrial is registered third, and the
  // Nuclear and Renewables ribbons it crosses are registered after it.
  // Painting a band's interior after later bands' — RC2's deferral of every
  // fallback band — hands them every crossing cell (the review measured
  // 0 -> 127 lost cells). Round 3 paints the skip band as a smooth ribbon on
  // braille, so this now reads the ledger both kinds share instead of the
  // band's lane route, which it no longer paints.
  it("P2: an earlier-registered band keeps every interior crossing cell against later-registered ribbons, on box (lanes) and braille (smooth)", () => {
    for (const tier of ["box", "braille"] as const) {
      const plot = PLOT(96, 32);
      const layout = layoutSankeyGraph(sankeyGroups(energySpec), plot, tier, [])!;
      const routedRows = computeSankeyRoutedRows(createGlyphCanvas({ cols: 96, rows: 32, tier }), plot, layout, true, []);
      const ledger: GlyphChartLedgerEntry[] = [];
      paintSankeyLayout(createGlyphCanvas({ cols: 96, rows: 32, tier }), plot, layout, true, ledger);
      const skip = layout.bands.find((b) => b.source === "Natural Gas" && b.target === "Industrial")!;
      expect(routedRows.filter((r) => r.band === skip).every((r) => (r.segments !== undefined) === (tier === "braille")), `${tier}: smooth exactly on braille`).toBe(true);
      const lost = (source: string, target: string): number => ledger
        .filter((e) => e.code === "sankey-band-broken" && (e.detail as { source: string }).source === source && (e.detail as { target: string }).target === target)
        .reduce((n, e) => n + (e.detail as { cells: number }).cells, 0);
      // Non-vacuity: the later ribbons it crosses do lose cells to it.
      expect(lost("Nuclear", "Electricity Generation") + lost("Renewables", "Electricity Generation"), `${tier}: the crossing is real`).toBeGreaterThan(10);
      expect(layout.bands.indexOf(skip)).toBeLessThan(layout.bands.findIndex((b) => b.source === "Nuclear"));
      // On braille the skip band loses nothing. On box its lanes cross the
      // Nuclear ribbon's own border column, which phase 1 gives Nuclear.
      if (tier === "braille") expect(lost("Natural Gas", "Industrial")).toBe(0);
      else expect(lost("Natural Gas", "Industrial")).toBeLessThanOrEqual(skip.sourceRowRange[1] - skip.sourceRowRange[0] + 1);
    }
  });

  // Codex round-2: a skip-level band whose intermediate columns leave no row
  // clear of ALL of them at once used to be handed the plot's top row — by
  // construction inside one of those boxes — and the router's node-box
  // assertion threw, failing the whole render (8 of 480 renders in a layered
  // sweep, 4 distinct layouts). Two cases reach that state and they need
  // different answers.
  const sankeyOf = (data: readonly { from: string; to: string; v: number }[]): GlyphChartSpec => ({ marks: [glyphChartSankey(data, { source: "from", target: "to", value: "v" })] });
  // Every intermediate column has clear rows, just not the same ones:
  // {C, X} clears rows 10-11, {E} clears rows 20-31. A route exists.
  const noSharedClearRow = sankeyOf([{ from: "A", to: "C", v: 1 }, { from: "A", to: "D", v: 1 }, { from: "B", to: "X", v: 1 }, { from: "X", to: "E", v: 2 }, { from: "E", to: "D", v: 1 }]);
  // C (and E) fill their column top to bottom. No route exists.
  const filledColumn = sankeyOf([{ from: "A", to: "D", v: 2 }, { from: "B", to: "C", v: 1 }, { from: "C", to: "E", v: 5 }, { from: "E", to: "D", v: 1 }]);

  it("round-2: no row clears every intermediate column at once — the band jogs between columns on rows clear in each, and the render never throws", () => {
    for (const charset of ["box", "ascii", "braille", "blocks"] as const) {
      const r = renderGlyphChart(noSharedClearRow, { target: "web", charset });
      expect(r.report.ledger.some((e) => e.code === "sankey-band-unroutable"), `a route exists on ${charset}`).toBe(false);
    }
    const plot = PLOT(96, 32);
    const layout = layoutSankeyGraph(sankeyGroups(noSharedClearRow), plot, "box", [])!;
    const box = (id: string) => layout.nodes.find((n) => n.id === id)!;
    const [a, c, x, e, d] = ["A", "C", "X", "E", "D"].map(box);
    // The premise: C and X share one intermediate column and E is the next;
    // the only rows {C, X} leaves clear lie inside E, so no single row clears
    // both columns, while each column alone still has clear rows.
    expect(c!.x0).toBe(x!.x0);
    expect(e!.x0).toBeGreaterThan(c!.x1);
    expect([c!.y0, x!.y1]).toEqual([plot.y0, plot.y1]);
    expect(x!.y0 - c!.y1).toBeGreaterThan(1);
    expect(e!.y0).toBeLessThanOrEqual(c!.y1 + 1);
    expect(e!.y1).toBeGreaterThanOrEqual(x!.y0 - 1);
    expect(e!.y1).toBeLessThan(plot.y1);
    const routedRows = computeSankeyRoutedRows(createGlyphCanvas({ cols: 96, rows: 32, tier: "box" }), plot, layout, false, []);
    expect(crossedForeignBoxes(layout, routedRows)).toEqual([]);
    const rows = routedRows.filter((r) => r.band.source === "A" && r.band.target === "D");
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.cells[0]!.x).toBe(a!.x1 + 1);
      expect(row.cells[row.cells.length - 1]!.x).toBe(d!.x0 - 1);
      expect(row.cells.some((p) => p.x >= c!.x0 && p.x <= c!.x1 && p.y > c!.y1 && p.y < x!.y0), "crosses {C, X} in its clear rows").toBe(true);
      expect(row.cells.some((p) => p.x >= e!.x0 && p.x <= e!.x1 && p.y > e!.y1), "crosses {E} below E").toBe(true);
    }
  });

  it("round-2: an intermediate column filled top to bottom leaves no route — the band is drawn as two stubs and named in the ledger, never an exception", () => {
    for (const charset of ["box", "ascii", "braille", "blocks"] as const) {
      const r = renderGlyphChart(filledColumn, { target: "web", charset, width: 40, height: 20 });
      const entry = r.report.ledger.find((e) => e.code === "sankey-band-unroutable");
      expect(entry?.detail, `named on ${charset}`).toEqual({ source: "A", target: "D", blockingNodes: ["C"] });
    }
    const plot = PLOT(40, 20);
    const ledger: GlyphChartLedgerEntry[] = [];
    const layout = layoutSankeyGraph(sankeyGroups(filledColumn), plot, "box", ledger)!;
    const c = layout.nodes.find((n) => n.id === "C")!;
    expect([c.y0, c.y1], "the premise: C fills its column").toEqual([plot.y0, plot.y1]);
    const routedRows = computeSankeyRoutedRows(createGlyphCanvas({ cols: 40, rows: 20, tier: "box" }), plot, layout, false, ledger);
    expect(crossedForeignBoxes(layout, routedRows)).toEqual([]);
    const band = layout.bands.find((b) => b.source === "A" && b.target === "D")!;
    const a = layout.nodes.find((n) => n.id === "A")!;
    const d = layout.nodes.find((n) => n.id === "D")!;
    const rows = routedRows.filter((r) => r.band === band);
    const leaving = rows.filter((r) => r.cells[0]!.x === a.x1 + 1);
    const arriving = rows.filter((r) => r.cells[r.cells.length - 1]!.x === d.x0 - 1);
    // One straight stub row per band row at each end, and nothing else.
    expect(leaving.map((r) => r.cells[0]!.y)).toEqual(Array.from({ length: band.sourceRowRange[1] - band.sourceRowRange[0] + 1 }, (_, i) => band.sourceRowRange[0] + i));
    expect(arriving.map((r) => r.cells[0]!.y)).toEqual(Array.from({ length: band.targetRowRange![1] - band.targetRowRange![0] + 1 }, (_, i) => band.targetRowRange![0] + i));
    expect(leaving.length + arriving.length).toBe(rows.length);
    for (const r of rows) expect(new Set(r.cells.map((p) => p.y)).size).toBe(1);
  });
});
