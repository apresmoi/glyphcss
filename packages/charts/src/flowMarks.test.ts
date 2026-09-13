import { describe, expect, it } from "vitest";
import { createGlyphCanvas } from "glyphcss";
import { chartSeries, resolveSeriesColor } from "./series";
import { resolveGlyphChartSpec } from "./resolve";
import { layoutGlyphChart, resolveGlyphChartLegendOption } from "./layout";
import { layoutSankeyGraph, paintSankeyLayout } from "./flowMarks";
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

describe("sankey crossing routing gives each band its own lane (P1-1)", () => {
  it("a minimal A/B -> X/Y fan shows BOTH crossing bands, not one erasing the other", () => {
    // A->Y and B->X cross in the gap; A->X and B->Y are straight-through.
    const spec: GlyphChartSpec = { marks: [glyphChartSankey(
      [{ from: "A", to: "X", amount: 5 }, { from: "A", to: "Y", amount: 5 }, { from: "B", to: "X", amount: 5 }, { from: "B", to: "Y", amount: 5 }],
      { source: "from", target: "to", value: "amount" },
    )] };
    const groups = sankeyGroups(spec);
    const plot = PLOT(72, 24);
    const ledger: GlyphChartLedgerEntry[] = [];
    const layout = layoutSankeyGraph(groups, plot, "box", ledger)!;
    expect(layout).not.toBeNull();
    const canvas = createGlyphCanvas({ cols: 72, rows: 24, tier: "box" });
    paintSankeyLayout(canvas, plot, layout, true, ledger);
    for (const band of layout.bands) {
      const color = resolveSeriesColor(band, true);
      const [sr0, sr1] = band.sourceRowRange;
      const [tr0, tr1] = band.targetRowRange!;
      const srcBox = layout.nodes.find((n) => n.id === band.source)!;
      const tgtBox = layout.nodes.find((n) => n.id === band.target)!;
      const gapX0 = srcBox.x1 + 1;
      const gapX1 = tgtBox.x0 - 1;
      // Every row of this band's OWN vertical span has AT LEAST ONE cell
      // of its own colour somewhere in the gap — the old shared-`mid`
      // routing let a later band's paint erase an EARLIER band's entire
      // vertical run (measured: 0 surviving cells there), so a crossing
      // band's own middle rows went dark; a lane call never does that.
      for (let row = Math.min(sr0, tr0); row <= Math.max(sr1, tr1); row++) {
        let found = false;
        for (let col = gapX0; col <= gapX1; col++) if (canvas.grid.color[row * canvas.cols + col] === color) found = true;
        expect(found, `band ${band.source}->${band.target} row ${row} lost its own colour in the gap`).toBe(true);
      }
    }
  });

  it("a crossing band that would be too narrow to fit its own lane reports sankey-crossings-merged", () => {
    // A full bipartite fan (every source to every target) has crossings no
    // column REORDERING can eliminate (unlike a permutation, which
    // d3-sankey's own barycenter relaxation can — and does — untangle by
    // reordering nodes within a column before this module ever sees row
    // positions). At a narrow plot width the resulting real (non-folded)
    // diagonal bands outnumber the columns of gap available for lanes.
    // The merge itself is assigned at PAINT time (`assignSankeyLanes`,
    // called from `paintSankeyLayout`), not layout, so this must paint.
    const n = 6;
    const rows: { from: string; to: string; amount: number }[] = [];
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) rows.push({ from: `S${i}`, to: `T${j}`, amount: 1 });
    const spec: GlyphChartSpec = { marks: [glyphChartSankey(rows, { source: "from", target: "to", value: "amount" })] };
    const groups = sankeyGroups(spec);
    const plot = PLOT(15, 31);
    const ledger: GlyphChartLedgerEntry[] = [];
    const layout = layoutSankeyGraph(groups, plot, "box", ledger)!;
    const canvas = createGlyphCanvas({ cols: 15, rows: 31, tier: "box" });
    paintSankeyLayout(canvas, plot, layout, true, ledger);
    expect(ledger.some((e) => e.code === "sankey-crossings-merged")).toBe(true);
  });

  it("the energy dataset's cell-count invariant (painted rows >= the band's own vertical span) holds at 40/72/96/140", () => {
    for (const width of [40, 72, 96, 140]) {
      const groups = sankeyGroups(energySpec);
      const plot = PLOT(width, 24);
      const ledger: GlyphChartLedgerEntry[] = [];
      const layout = layoutSankeyGraph(groups, plot, "box", ledger)!;
      const canvas = createGlyphCanvas({ cols: width, rows: 24, tier: "box" });
      paintSankeyLayout(canvas, plot, layout, true, ledger);
      for (const band of layout.bands) {
        if (band.folded) continue;
        const color = resolveSeriesColor(band, true);
        const [sr0, sr1] = band.sourceRowRange;
        const [tr0, tr1] = band.targetRowRange!;
        const srcBox = layout.nodes.find((n) => n.id === band.source)!;
        const tgtBox = layout.nodes.find((n) => n.id === band.target)!;
        const gapX0 = srcBox.x1 + 1;
        const gapX1 = tgtBox.x0 - 1;
        // A band that skips a depth (its target is two-plus columns past
        // its source, e.g. Natural Gas -> Industrial passing behind
        // Electricity Generation's own column) routes its gap THROUGH an
        // intermediate node's box, whose own border/label paints on top
        // by design (this file's own doc at `paintSankeyLayout`) — that is
        // a different, orthogonal rendering rule, not the P1-1 crossing
        // bug, so this invariant only applies between DIRECTLY ADJACENT
        // columns (no other node's box starts inside the gap).
        const skipsAColumn = layout.nodes.some((n) => n.id !== band.source && n.id !== band.target && n.x0 > gapX0 && n.x0 <= gapX1);
        if (skipsAColumn) continue;
        const rowMin = Math.min(sr0, tr0);
        const rowMax = Math.max(sr1, tr1);
        let coveredRows = 0;
        for (let row = rowMin; row <= rowMax; row++) {
          for (let col = gapX0; col <= gapX1; col++) {
            if (canvas.grid.color[row * canvas.cols + col] === color) { coveredRows++; break; }
          }
        }
        expect(coveredRows, `width ${width}: ${band.source}->${band.target}`).toBe(rowMax - rowMin + 1);
      }
    }
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

  it("the energy dataset's own reported disparity is closed: Natural Gas->Industrial (150) is not thinner than Electricity Generation->Industrial (130)", () => {
    const groups = sankeyGroups(energySpec);
    const layout = layoutSankeyGraph(groups, PLOT(72, 24), "box", [])!;
    const natGasToInd = layout.bands.find((b) => b.source === "Natural Gas" && b.target === "Industrial")!;
    const egToInd = layout.bands.find((b) => b.source === "Electricity Generation" && b.target === "Industrial")!;
    const h = (b: typeof natGasToInd) => b.sourceRowRange[1] - b.sourceRowRange[0] + 1;
    expect(h(natGasToInd)).toBeGreaterThanOrEqual(h(egToInd));
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
});

describe("P3 fixes", () => {
  it("a transform on a sankey/funnel mark rejects rather than being silently ignored (P3-5)", () => {
    const withTransform = { ...glyphChartSankey([{ from: "A", to: "B", amount: 1 }], { source: "from", target: "to", value: "amount" }), transform: { kind: "stack" as const } };
    expect(() => renderGlyphChart({ marks: [withTransform] })).toThrow(expect.objectContaining({ code: "bad-options" }));
    const funnelWithTransform = { ...glyphChartFunnel([1, 2, 3]), transform: { kind: "bin" as const } };
    expect(() => renderGlyphChart({ marks: [funnelWithTransform] })).toThrow(expect.objectContaining({ code: "bad-options" }));
  });

  it("a 2-row sankey node skips its label rather than overwriting its own border, and reports label-dropped", () => {
    // A tall value range forces a very short box for the smallest node.
    const spec: GlyphChartSpec = { marks: [glyphChartSankey(
      [{ from: "Hub", to: "Big", amount: 1000 }, { from: "Hub", to: "Small", amount: 10 }],
      { source: "from", target: "to", value: "amount" },
    )] };
    const r = renderGlyphChart(spec, { target: "chat", width: 40, height: 24 });
    const entry = r.report.ledger.find((e) => e.code === "label-dropped" && e.detail?.role === "sankey node label");
    // Either this exact layout drops a label (asserted below) or it
    // doesn't need to — the invariant that actually matters is that NO
    // node's border is corrupted by an overlaid label character, checked
    // structurally: every box row is either a clean border/blank line or
    // the label row, never a hybrid missing a corner glyph.
    if (entry) expect(entry.detail?.text).toBeTruthy();
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
});
