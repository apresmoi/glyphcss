import { describe, expect, it } from "vitest";
import { createGlyphCanvas } from "glyphcss";
import { chartSeries, resolveSeriesColor } from "./series";
import { resolveGlyphChartSpec } from "./resolve";
import { layoutGlyphChart, resolveGlyphChartLegendOption } from "./layout";
import { computeSankeyRoutedRows, layoutSankeyGraph, paintSankeyLayout, paintSankeyMarks, type GlyphChartSankeyLayout } from "./flowMarks";
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
    expect(r.grid.cols).toBe(w);
    expect(r.grid.rows).toBe(h);
    if (charset === "ascii") expect(r.text).toMatch(/^[\x20-\x7e\n]*$/);
  });

  it.each(sizes.flatMap(([w, h]) => charsets.map((charset) => ({ w, h, charset }))))("funnel renders at $w x $h on $charset", ({ w, h, charset }) => {
    const r = renderGlyphChart(funnelSpec, { target: "chat", width: w, height: h, charset });
    expect(r.text.length).toBeGreaterThan(0);
    expect(r.grid.cols).toBe(w);
    expect(r.grid.rows).toBe(h);
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
  it("every node's outgoing band rows sum to its own row height", () => {
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
        const outRows = outgoing.reduce((n, b) => n + (b.sourceRowRange[1] - b.sourceRowRange[0] + 1), 0);
        expect(outRows).toBe(node.height);
      }
    }
  });

  it("every node's incoming band rows sum to its own row height", () => {
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
        const inRows = incoming.reduce((n, b) => n + (b.targetRowRange![1] - b.targetRowRange![0] + 1), 0);
        expect(inRows).toBe(node.height);
      }
    }
  });

  it("a column's node heights sum EXACTLY to the rows available to it (the adversarial ratio)", () => {
    // Mutation: independent rounding on the NODE-height split -> a column's
    // own node heights stop summing to its available row capacity.
    const groups = sankeyGroups(adversarialSinkSpec);
    const layout = layoutSankeyGraph(groups, PLOT(40, 10), "box", []);
    expect(layout).not.toBeNull();
    const column0 = layout!.nodes.filter((n) => n.id !== "Sink");
    expect(column0).toHaveLength(3);
    const total = column0.reduce((n, box) => n + box.height, 0);
    // 3 nodes over 10 rows leaves room for a 1-row gap between each
    // (10 - 2 gap rows = 8 >= 3 nodes), so 8 rows are available to split.
    expect(total).toBe(8);
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
    const outRows = outgoing.reduce((n, b) => n + (b.sourceRowRange[1] - b.sourceRowRange[0] + 1), 0);
    expect(outRows).toBe(hub.height);
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
    const rowWidths = rows.map((row) => (row.match(/[█▓▒░]/g) ?? []).length);
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
  });

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
    // real (non-folded) diagonal bands' own ribbons outgrow the gap.
    const n = 6;
    const rows: { from: string; to: string; amount: number }[] = [];
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) rows.push({ from: `S${i}`, to: `T${j}`, amount: 1 });
    const spec: GlyphChartSpec = { marks: [glyphChartSankey(rows, { source: "from", target: "to", value: "amount" })] };
    const { ledger } = renderSankey(spec, 15, 31, "box");
    expect(ledger.some((e) => e.code === "sankey-crossings-merged")).toBe(true);
  });

  it("sankey-crossings-merged names the actual BENT-BAND count, not the packed column width, as 'bands' (sankey round-3 review, finding l/R3)", () => {
    const n = 6;
    const rows: { from: string; to: string; amount: number }[] = [];
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) rows.push({ from: `S${i}`, to: `T${j}`, amount: 1 });
    const spec: GlyphChartSpec = { marks: [glyphChartSankey(rows, { source: "from", target: "to", value: "amount" })] };
    const { ledger } = renderSankey(spec, 15, 31, "box");
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
    expect(r.report.routeConflicts.length).toBe(98);
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
    const outRows = outgoing.reduce((n, b) => n + (b.sourceRowRange[1] - b.sourceRowRange[0] + 1), 0);
    expect(outRows).toBe(hub.height);
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

  // Sankey round-3 review, finding i: AGENTS.md/charts.md claimed the N6
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
    expect(r.text).not.toMatch(/[█▓▒░]/);
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
    const rowWidths = rows.map((row) => (row.match(/[█▓▒░]/g) ?? []).length);
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
    console.log(`\n--- sankey (chat, ${r.grid.cols}x${r.grid.rows}) ---\n${r.text}\n`);
  });

  it("funnel: e-commerce conversion", () => {
    const r = renderGlyphChart(funnelSpec, { target: "chat" });
    expect(r.text.length).toBeGreaterThan(0);
    // eslint-disable-next-line no-console
    console.log(`\n--- funnel (chat, ${r.grid.cols}x${r.grid.rows}) ---\n${r.text}\n`);
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
    expect(r.text).toBe([
      "┌────────┐██████████┌────────┐▒▒▒▒▒▒▒▒▒▒┌────────┐",
      "│        │██████████│        │▒▒▒▒▒▒▒▒▒▒│        │",
      "│  Coal  │██████████│        │▒▒▒▒▒▒▒▒▒▒│        │",
      "│        │██████████│        │▒▒▒▒▒▒▒▒▒▒│        │",
      "│        │██████████│        │▒▒▒▒▒▒▒▒▒▒│ Homes  │",
      "└────────┘██████████│        │▒▒▒▒▒▒▒▒▒▒│        │",
      "          ▓▓▓▓▓▓▓▓▓▓│ Power  │▒▒▒▒▒▒▒▒▒▒│        │",
      "┌────────┐▓▓▓▓▓▓▓▓▓▓│        │▒▒▒▒▒▒▒▒▒▒│        │",
      "│        │▓▓▓▓▓▓▓▓▓▓│        │▒▒▒▒▒▒▒▒▒▒│        │",
      "│        │▓▓▓▓▓▓▓▓▓▓│        │▒▒▒▒▒▒▒▒▒▒└────────┘",
      "│  Gas   │▓▓▓▓▓▓▓▓▓▓│        │▒                   ",
      "│        │▓▓▓▓▓▓▓▓▓▓│        │▒▒▒▒▒▒▒▒▒▒┌────────┐",
      "│        │▓▓▓▓▓▓▓▓▓▓│        │▒▒▒▒▒▒▒▒▒▒│Industry│",
      "│        │▓▓▓▓▓▓▓▓▓▓└────────┘▒▒▒▒▒▒▒▒▒▒│        │",
      "└────────┘▓▓▓▓▓▓▓▓               ▒▒▒▒▒▒▒└────────┘",
      "   █  Coal          ▓  Gas         ▒  Power       ",
    ].join("\n"));
  });
});
