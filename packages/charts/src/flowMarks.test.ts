import { describe, expect, it } from "vitest";
import { chartSeries } from "./series";
import { resolveGlyphChartSpec } from "./resolve";
import { layoutSankeyGraph } from "./flowMarks";
import { glyphChartFunnel, glyphChartSankey } from "./spec";
import { renderGlyphChart } from "./render";
import { ECOMMERCE_FUNNEL_DATA, ENERGY_FLOW_SANKEY_DATA } from "./flowMarksData";
import type { GlyphChartPlotRect } from "./layout";
import type { GlyphChartSpec } from "./types";

const PLOT = (cols: number, rows: number): GlyphChartPlotRect => ({ x0: 0, y0: 0, x1: cols - 1, y1: rows - 1 });

function sankeyGroups(spec: GlyphChartSpec) {
  return chartSeries(resolveGlyphChartSpec(spec));
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
