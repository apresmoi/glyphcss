/**
 * `sankey` and `funnel` — the two non-cartesian flow marks, plumbed exactly
 * like `arc` (see `AGENTS.md`'s "Charts" section): excluded from the x/y
 * scales (`scales.ts`), excluded from `layoutGlyphChart`'s cartesian gutter
 * (`layout.ts`), grouped into `ChartSeries` by `chartSeries` (`series.ts`,
 * one entry per sankey SOURCE node / funnel STAGE), and painted from
 * `paint.ts`'s own fills pass through `guardedCanvas` exactly like every
 * other mark. This module owns their own resolution, layout math, and
 * painting — `arc`'s own geometry lives in `paint.ts` because it needs no
 * extra state; these two need a graph/row layout pass first, so they get
 * their own file rather than growing `paint.ts` past its "dumb painters"
 * discipline (`docs/design/canvas.md`).
 */

import { sankey as d3Sankey } from "d3-sankey";
import { format as d3format } from "d3-format";
import { GLYPH_CANVAS_DIRECTION_BITS, GLYPH_CANVAS_TIERS, type GlyphCanvas, type GlyphCanvasTierName } from "glyphcss";
import { accessorFor, identity, index, isNumericArray } from "./channels";
import { abbreviateChartText, chartText } from "./labels";
import { ledgerFunnelNotMonotone, ledgerFunnelThinStage, ledgerSankeyFoldedFlows, ledgerSankeyImbalance, type GlyphChartLedgerEntry } from "./ledger";
import type { GlyphChartPlotRect } from "./layout";
import { SERIES_COLORS, seriesShade, type ChartSeries } from "./series";
import { chartError } from "./validate";
import type { GlyphChartMark, GlyphChartMarkRow } from "./types";

function numeric(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : NaN;
}

// ── resolution ───────────────────────────────────────────────────────────

/**
 * Materialises `{ source, target, value }` into `GlyphChartMarkRow`s
 * (`x` = source, `label` = target, `y` = value — the same three-field shape
 * every other mark's row already carries, so `chartSeries` needs no
 * sankey-specific row type). Enforces `sankey-bad-value` (every resolved
 * value finite and > 0 — the structural "channel present" half already ran
 * in `validate.ts`, on the raw mark, before resolution) and `sankey-cycle`
 * (a runtime-only tagged code, exactly like `mixed-x-scale` — see
 * `validate.ts`'s own doc: whether a graph has a cycle is a cross-row,
 * data-dependent property no declarative JSON Schema clause can express).
 * `sankey-cycle` is detected by d3-sankey itself (`computeNodeDepths`
 * throws "circular link" past `nodes.length` layers) rather than a second,
 * parallel graph walk — one cycle-detector, not two that could disagree.
 */
export function resolveSankeyRows(mark: GlyphChartMark): GlyphChartMarkRow[] {
  const sourceAcc = accessorFor(mark.channels.source);
  const targetAcc = accessorFor(mark.channels.target);
  const valueAcc = accessorFor(mark.channels.value);
  const rows: GlyphChartMarkRow[] = mark.data.map((datum, i) => ({
    x: sourceAcc ? String(sourceAcc(datum, i)) : undefined,
    y: valueAcc ? Number(valueAcc(datum, i)) : NaN,
    label: targetAcc ? String(targetAcc(datum, i)) : undefined,
    index: i,
  }));
  for (const row of rows) {
    if (!(typeof row.y === "number" && Number.isFinite(row.y) && row.y > 0)) {
      chartError("sankey-bad-value", `Sankey flow "${row.x} -> ${row.label}" must have a finite value greater than 0 (got ${row.y}).`);
    }
  }
  checkSankeyCycle(rows);
  return rows;
}

function checkSankeyCycle(rows: readonly GlyphChartMarkRow[]): void {
  const ids = new Set<string>();
  for (const r of rows) { ids.add(String(r.x)); ids.add(String(r.label)); }
  try {
    d3Sankey<{ readonly id: string }, Record<string, unknown>>()
      .nodeId((d) => d.id)
      .extent([[0, 0], [1, 1]])
      ({
        nodes: [...ids].map((id) => ({ id })),
        links: rows.map((r) => ({ source: String(r.x), target: String(r.label), value: numeric(r.y) })),
      });
  } catch (err) {
    if (err instanceof Error && err.message.includes("circular")) {
      throw Object.assign(
        new TypeError("glyphcss: sankey-cycle: the sankey graph has a cycle (its source -> target links loop back on themselves) and has no honest column order."),
        { code: "sankey-cycle" as const },
      );
    }
    throw err;
  }
}

/**
 * Materialises stage rows. `data` may be the bare `number[]` shorthand
 * (`stage` defaults to the row index, `value` to the element itself — the
 * same shorthand `channels.ts`'s own numeric-array rule uses) or records
 * addressed by `{ stage, value }` channels.
 */
export function resolveFunnelRows(mark: GlyphChartMark): GlyphChartMarkRow[] {
  const shorthand = isNumericArray(mark.data);
  const stageAcc = accessorFor(mark.channels.stage) ?? (shorthand ? index : undefined);
  const valueAcc = accessorFor(mark.channels.value) ?? (shorthand ? identity : undefined);
  return mark.data.map((datum, i) => ({
    x: stageAcc ? String(stageAcc(datum, i)) : String(i),
    y: valueAcc ? Number(valueAcc(datum, i)) : NaN,
    index: i,
  }));
}

// ── shared cumulative-rounding distribution ─────────────────────────────

/**
 * Divides an integer `capacity` among `weights` proportionally, via
 * cumulative rounding (`Math.round` on the running SUM, never on each
 * share independently) so the sizes always sum to EXACTLY `capacity` — the
 * same discipline `paint.ts`'s own `dodgeColRange` uses for series
 * dodging. This is what makes a node's own row height and the sum of its
 * outgoing (or incoming) band heights conserve exactly: rounding each
 * band's share on its own can drift the total off by a cell or more.
 */
function distributeCumulative(weights: readonly number[], capacity: number): number[] {
  const total = weights.reduce((a, b) => a + b, 0);
  if (capacity <= 0 || total <= 0) return weights.map(() => 0);
  let prevCum = 0;
  let acc = 0;
  const sizes: number[] = [];
  for (const w of weights) {
    acc += w;
    const cum = Math.round((acc / total) * capacity);
    sizes.push(cum - prevCum);
    prevCum = cum;
  }
  return sizes;
}

function fillGlyphRegion(canvas: GlyphCanvas, x0: number, y0: number, x1: number, y1: number, glyph: string, color: string | null): void {
  if (x0 > x1 || y0 > y1) return;
  const run = glyph.repeat(x1 - x0 + 1);
  for (let y = y0; y <= y1; y++) canvas.text(x0, y, [run], { color });
}

// ── sankey ───────────────────────────────────────────────────────────────

const GLYPH_CHART_SANKEY_NODE_WIDTH_CAP = 16;
const GLYPH_CHART_SANKEY_MIN_NODE_WIDTH = 3;
const GLYPH_CHART_SANKEY_MIN_GAP = 3;

interface SankeyNodeBox {
  readonly id: string;
  readonly x0: number;
  readonly x1: number;
  readonly y0: number;
  readonly y1: number;
  readonly height: number;
}

interface SankeyBand {
  readonly source: string;
  readonly target: string;
  readonly value: number;
  readonly styleIndex: number;
  readonly sourceRowRange: readonly [number, number];
  targetRowRange?: readonly [number, number];
  readonly folded: boolean;
}

export interface GlyphChartSankeyLayout {
  readonly nodes: readonly SankeyNodeBox[];
  readonly bands: readonly SankeyBand[];
  /** Cell columns between two adjacent node boxes — the paint routing needs it to size a fold stub. */
  readonly gap: number;
}

/**
 * Pure layout: `groups` -> node boxes (columns by depth, row heights ∝
 * throughput) + bands (row ranges at both ends). No canvas — this is what
 * `flowMarks.test.ts` inspects directly to assert exact conservation, and
 * what `paintSankeyLayout` paints from. `groups` is `chartSeries`' own
 * per-source-node split (`series.ts`), so every group's `.rows` is that
 * ONE source's outgoing flows in declared order and `.styleIndex` is its
 * shared, first-appearance-ordered colour slot — the same object `arc`'s
 * own painter reads for its slices. Returns `null` when there's nothing to
 * lay out (no links) or the plot rect has no area.
 */
export function layoutSankeyGraph(groups: readonly ChartSeries[], plot: GlyphChartPlotRect, tierName: GlyphCanvasTierName, ledger: GlyphChartLedgerEntry[]): GlyphChartSankeyLayout | null {
  const links: { readonly source: string; readonly target: string; readonly value: number; readonly styleIndex: number }[] = [];
  for (const g of groups) for (const r of g.rows) links.push({ source: g.name!, target: String(r.label), value: numeric(r.y), styleIndex: g.styleIndex });
  if (links.length === 0) return null;

  const nodeOrder: string[] = [];
  const seenNode = new Set<string>();
  for (const l of links) for (const id of [l.source, l.target]) if (!seenNode.has(id)) { seenNode.add(id); nodeOrder.push(id); }

  // Node columns BY DEPTH (d3-sankey's own `computeNodeDepths` — longest
  // path from a source) and within-column ORDER (its own relaxed `y0`,
  // used only as a sort key here) come from the layout generator itself;
  // this module owns none of that graph math, only the integer snap.
  const graph = d3Sankey<{ readonly id: string }, Record<string, unknown>>()
    .nodeId((d) => d.id)
    .nodeWidth(1)
    .nodePadding(1)
    .extent([[0, 0], [1, 1]])
    ({
      nodes: nodeOrder.map((id) => ({ id })),
      links: links.map((l) => ({ source: l.source, target: l.target, value: l.value })),
    });

  const nodeValueById = new Map(graph.nodes.map((n) => [n.id, n.value ?? 0]));
  const nodeDepthById = new Map(graph.nodes.map((n) => [n.id, n.depth ?? 0]));
  const nodeY0ById = new Map(graph.nodes.map((n) => [n.id, n.y0 ?? 0]));
  const maxDepth = Math.max(0, ...nodeOrder.map((id) => nodeDepthById.get(id) ?? 0));

  const plotWidth = plot.x1 - plot.x0 + 1;
  const plotHeight = plot.y1 - plot.y0 + 1;
  if (plotWidth <= 0 || plotHeight <= 0) return null;
  const numCols = maxDepth + 1;

  // Node box width = min(longest folded label + 2, a cap) — measured
  // through `chartText` (the SAME fold `abbreviateChartText` applies), not
  // the raw string length, so a tier's own ASCII fold is what sizes the box.
  const longestLabel = Math.max(1, ...nodeOrder.map((id) => chartText(id, tierName).length));
  let nodeWidth = Math.max(GLYPH_CHART_SANKEY_MIN_NODE_WIDTH, Math.min(longestLabel + 2, GLYPH_CHART_SANKEY_NODE_WIDTH_CAP));
  let gap = numCols > 1 ? Math.floor((plotWidth - numCols * nodeWidth) / (numCols - 1)) : 0;
  if (numCols > 1 && gap < GLYPH_CHART_SANKEY_MIN_GAP) {
    const maxWidthThatFits = Math.max(GLYPH_CHART_SANKEY_MIN_NODE_WIDTH, Math.floor((plotWidth - (numCols - 1) * GLYPH_CHART_SANKEY_MIN_GAP) / numCols));
    nodeWidth = Math.min(nodeWidth, maxWidthThatFits);
    gap = Math.max(1, Math.floor((plotWidth - numCols * nodeWidth) / (numCols - 1)));
  }
  const colX0 = (col: number): number => plot.x0 + col * (nodeWidth + gap);
  const colX1 = (col: number): number => Math.min(plot.x1, colX0(col) + nodeWidth - 1);

  // Row heights ∝ throughput (node.value), snapped via the SAME cumulative
  // rounding a band's own row split uses, so a column's node heights sum
  // exactly to the rows available to it.
  const nodeBoxes = new Map<string, SankeyNodeBox>();
  for (let col = 0; col <= maxDepth; col++) {
    const colNodes = nodeOrder.filter((id) => nodeDepthById.get(id) === col).sort((a, b) => (nodeY0ById.get(a) ?? 0) - (nodeY0ById.get(b) ?? 0));
    if (colNodes.length === 0) continue;
    const n = colNodes.length;
    const gapRows = n > 1 && plotHeight - (n - 1) >= n ? n - 1 : 0;
    const capacity = Math.max(0, plotHeight - gapRows);
    const heights = distributeCumulative(colNodes.map((id) => nodeValueById.get(id) ?? 0), capacity);
    let cursor = plot.y0;
    colNodes.forEach((id, i) => {
      const h = heights[i]!;
      const y0 = cursor;
      const y1 = cursor + h - 1;
      nodeBoxes.set(id, { id, x0: colX0(col), x1: colX1(col), y0, y1, height: h });
      cursor += h + (gapRows > 0 ? 1 : 0);
    });
  }

  // Outgoing bands per source, folding whatever the FIRST pass rounds to
  // zero rows into one "other" band (never re-run per candidate threshold —
  // the ACTUAL cumulative allocation decides, not an estimate of it).
  const bands: SankeyBand[] = [];
  for (const g of groups) {
    const nodeId = g.name!;
    const box = nodeBoxes.get(nodeId);
    if (!box) continue;
    const outLinks = g.rows.map((r) => ({ target: String(r.label), value: numeric(r.y) }));
    const pass1 = distributeCumulative(outLinks.map((l) => l.value), box.height);
    const zeroIdx = pass1.reduce<number[]>((acc, h, i) => (h === 0 && outLinks[i]!.value > 0 ? [...acc, i] : acc), []);
    let finalLinks: { readonly target: string; readonly value: number; readonly folded?: boolean }[];
    let heights: number[];
    if (zeroIdx.length > 0 && zeroIdx.length < outLinks.length) {
      const kept = outLinks.filter((_, i) => !zeroIdx.includes(i));
      const folded = zeroIdx.map((i) => outLinks[i]!);
      const otherValue = folded.reduce((a, b) => a + b.value, 0);
      finalLinks = [...kept, { target: "(other)", value: otherValue, folded: true }];
      heights = distributeCumulative(finalLinks.map((l) => l.value), box.height);
      ledger.push(ledgerSankeyFoldedFlows({ source: nodeId, flows: folded.map((f) => `${nodeId} → ${f.target}`) }));
    } else {
      finalLinks = outLinks;
      heights = pass1;
    }
    let cursor = box.y0;
    finalLinks.forEach((l, i) => {
      const h = heights[i]!;
      const range: readonly [number, number] = [cursor, cursor + h - 1];
      cursor += h;
      bands.push({ source: nodeId, target: l.target, value: l.value, styleIndex: g.styleIndex, sourceRowRange: range, folded: Boolean(l.folded) });
    });
  }

  // Incoming bands per target — same cumulative split, independent of the
  // source-side one, which is exactly what lets a band TAPER between ends
  // when a node's total-in and total-out genuinely differ.
  const byTarget = new Map<string, SankeyBand[]>();
  for (const b of bands) {
    if (b.folded) continue;
    const list = byTarget.get(b.target) ?? [];
    list.push(b);
    byTarget.set(b.target, list);
  }
  for (const [targetId, list] of byTarget) {
    const box = nodeBoxes.get(targetId);
    if (!box) continue;
    const heights = distributeCumulative(list.map((b) => b.value), box.height);
    let cursor = box.y0;
    list.forEach((b, i) => {
      const h = heights[i]!;
      b.targetRowRange = [cursor, cursor + h - 1];
      cursor += h;
    });
  }

  // A non-terminal node (both incoming and outgoing) whose sums disagree
  // gets one ledger entry naming the mismatch — real data (a transformation
  // or loss node) legitimately does this; it's reported, not corrected.
  const inflowById = new Map<string, number>();
  const outflowById = new Map<string, number>();
  for (const l of links) {
    inflowById.set(l.target, (inflowById.get(l.target) ?? 0) + l.value);
    outflowById.set(l.source, (outflowById.get(l.source) ?? 0) + l.value);
  }
  for (const id of nodeOrder) {
    const inflow = inflowById.get(id);
    const outflow = outflowById.get(id);
    if (inflow !== undefined && outflow !== undefined && Math.abs(inflow - outflow) > 1e-9) {
      ledger.push(ledgerSankeyImbalance({ node: id, inflow, outflow }));
    }
  }

  return { nodes: [...nodeBoxes.values()], bands, gap };
}

/**
 * Paints a `GlyphChartSankeyLayout` (bands first, so a node's own
 * border/label sits on top of a band that happens to touch its edge).
 */
export function paintSankeyLayout(canvas: GlyphCanvas, plot: GlyphChartPlotRect, layout: GlyphChartSankeyLayout, colorEnabled: boolean): void {
  const nodeBoxes = new Map(layout.nodes.map((n) => [n.id, n]));
  const { bands, gap } = layout;
  for (const band of bands) {
    const glyph = seriesShade(canvas.tier, band.styleIndex);
    const color = colorEnabled ? SERIES_COLORS[band.styleIndex % SERIES_COLORS.length]! : null;
    const srcBox = nodeBoxes.get(band.source)!;
    const [sr0, sr1] = band.sourceRowRange;
    if (sr0 > sr1) continue;
    if (band.folded) {
      // No real target: a short stub reads as "flow leaves, not itemized".
      const stubLen = Math.max(1, Math.min(3, gap - 1));
      const x0 = srcBox.x1 + 1;
      const x1 = Math.min(plot.x1, x0 + stubLen - 1);
      fillGlyphRegion(canvas, x0, sr0, x1, sr1, glyph, color);
      continue;
    }
    const tgtBox = nodeBoxes.get(band.target);
    if (!tgtBox || !band.targetRowRange) continue;
    const [tr0, tr1] = band.targetRowRange;
    if (tr0 > tr1) continue;
    const gapX0 = srcBox.x1 + 1;
    const gapX1 = tgtBox.x0 - 1;
    if (gapX1 < gapX0) continue;
    if (sr0 === tr0 && sr1 === tr1) {
      fillGlyphRegion(canvas, gapX0, sr0, gapX1, sr1, glyph, color);
      continue;
    }
    // Horizontal (source rows) -> vertical (mid-gap column, union of both
    // row ranges) -> horizontal (target rows).
    const mid = Math.floor((gapX0 + gapX1) / 2);
    if (gapX0 <= mid - 1) fillGlyphRegion(canvas, gapX0, sr0, mid - 1, sr1, glyph, color);
    fillGlyphRegion(canvas, mid, Math.min(sr0, tr0), mid, Math.max(sr1, tr1), glyph, color);
    if (mid + 1 <= gapX1) fillGlyphRegion(canvas, mid + 1, tr0, gapX1, tr1, glyph, color);
  }

  const tier = GLYPH_CANVAS_TIERS[canvas.tier];
  const { n: N, e: E, s: S, w: W } = GLYPH_CANVAS_DIRECTION_BITS;
  const hLine = tier.straight.h;
  const vLine = tier.straight.v;
  const cornerTL = tier.junction[S | E]!;
  const cornerTR = tier.junction[S | W]!;
  const cornerBL = tier.junction[N | E]!;
  const cornerBR = tier.junction[N | W]!;
  for (const box of nodeBoxes.values()) {
    if (box.height <= 0) continue;
    const width = box.x1 - box.x0 + 1;
    if (width < 2) continue;
    const inner = Math.max(1, width - 2);
    const { text } = abbreviateChartText(box.id, inner, canvas.tier);
    if (box.y0 === box.y1) {
      const line = width >= 3 ? `${cornerTL}${text.padEnd(inner)}${cornerTR}` : text.padEnd(width);
      canvas.text(box.x0, box.y0, [line.slice(0, width)]);
      continue;
    }
    canvas.text(box.x0, box.y0, [`${cornerTL}${hLine.repeat(inner)}${cornerTR}`]);
    for (let row = box.y0 + 1; row < box.y1; row++) canvas.text(box.x0, row, [`${vLine}${" ".repeat(inner)}${vLine}`]);
    canvas.text(box.x0, box.y1, [`${cornerBL}${hLine.repeat(inner)}${cornerBR}`]);
    const midRow = Math.floor((box.y0 + box.y1) / 2);
    const pad = Math.max(0, Math.floor((inner - text.length) / 2));
    canvas.text(box.x0 + 1 + pad, midRow, [text]);
  }
}

/** `paint.ts`'s own call site — lays out then paints in one step. */
export function paintSankeyMark(canvas: GlyphCanvas, plot: GlyphChartPlotRect, groups: readonly ChartSeries[], colorEnabled: boolean, ledger: GlyphChartLedgerEntry[]): void {
  const layout = layoutSankeyGraph(groups, plot, canvas.tier, ledger);
  if (layout) paintSankeyLayout(canvas, plot, layout, colorEnabled);
}

// ── funnel ───────────────────────────────────────────────────────────────

const FUNNEL_SI_FORMAT = d3format("~s");
const FUNNEL_PLAIN_FORMAT = d3format("~r");
function formatFunnelValue(v: number): string {
  const abs = Math.abs(v);
  if (abs !== 0 && (abs >= 1000 || abs < 0.01)) return FUNNEL_SI_FORMAT(v).replace(/−/g, "-").replace(/µ/g, "u");
  return FUNNEL_PLAIN_FORMAT(v).replace(/−/g, "-");
}

/**
 * `groups` is `chartSeries`' per-stage split, ONE row each, in the ORDER
 * given (never re-sorted — a funnel is read top-to-bottom in declaration
 * order, a "not monotone" stage renders in place and is reported, not
 * moved).
 */
export function paintFunnelMark(canvas: GlyphCanvas, plot: GlyphChartPlotRect, groups: readonly ChartSeries[], colorEnabled: boolean, ledger: GlyphChartLedgerEntry[]): void {
  const stages = groups.map((g) => ({ name: g.name ?? String(g.rows[0]?.index ?? 0), value: numeric(g.rows[0]?.y), styleIndex: g.styleIndex }));
  if (stages.length === 0) return;
  const plotWidth = plot.x1 - plot.x0 + 1;
  const plotHeight = plot.y1 - plot.y0 + 1;
  if (plotWidth <= 0 || plotHeight <= 0) return;
  const n = stages.length;

  for (let i = 1; i < n; i++) {
    if (stages[i]!.value > stages[i - 1]!.value) {
      ledger.push(ledgerFunnelNotMonotone({ stage: stages[i]!.name, value: stages[i]!.value, previousStage: stages[i - 1]!.name, previousValue: stages[i - 1]!.value }));
    }
  }

  // One EQUAL row band per stage (never proportional — only the bar WIDTH
  // is ∝ value), with a one-row gap between stages when there's room.
  const hasGap = n > 1 && plotHeight >= 2 * n - 1;
  const bandHeight = Math.max(1, Math.floor((plotHeight - (hasGap ? n - 1 : 0)) / n));
  const maxValue = Math.max(0, ...stages.map((s) => s.value));

  const labelGutter = Math.max(4, Math.min(14, Math.floor(plotWidth * 0.22)));
  const innerX0 = plot.x0 + labelGutter;
  const innerX1 = plot.x1 - labelGutter;
  const innerWidth = Math.max(1, innerX1 - innerX0 + 1);
  const centerCol = Math.floor((innerX0 + innerX1) / 2);

  let cursor = plot.y0;
  for (const stage of stages) {
    const rowStart = cursor;
    const rowEnd = Math.min(plot.y1, rowStart + bandHeight - 1);
    cursor = rowEnd + 1 + (hasGap ? 1 : 0);
    if (rowStart > plot.y1) break;
    const midRow = Math.floor((rowStart + rowEnd) / 2);

    const glyph = seriesShade(canvas.tier, stage.styleIndex);
    const color = colorEnabled ? SERIES_COLORS[stage.styleIndex % SERIES_COLORS.length]! : null;
    let barWidth = maxValue > 0 ? Math.round((stage.value / maxValue) * innerWidth) : 0;
    if (stage.value > 0 && barWidth < 1) {
      barWidth = 1;
      ledger.push(ledgerFunnelThinStage({ stage: stage.name, value: stage.value }));
    }
    if (barWidth > 0) {
      const half = Math.floor(barWidth / 2);
      const barX0 = Math.max(plot.x0, centerCol - half);
      const barX1 = Math.min(plot.x1, barX0 + barWidth - 1);
      fillGlyphRegion(canvas, barX0, rowStart, barX1, rowEnd, glyph, color);
    }

    // Stage label: left of the bars, right-aligned in the label column.
    const stageMax = Math.max(1, labelGutter - 1);
    const { text: stageText } = abbreviateChartText(stage.name, stageMax, canvas.tier);
    const stageX = Math.max(plot.x0, plot.x0 + labelGutter - 1 - stageText.length);
    canvas.text(stageX, midRow, [stageText]);

    // Value·percent label: right of the bars. Drop the percent, then the
    // value, when the row is too narrow — never truncate a number. Folded
    // through `chartText` (the SAME tier fold `abbreviateChartText` uses)
    // since it's built by hand rather than going through that function —
    // the ASCII tier has no middle dot, and an un-folded one would leak a
    // non-ASCII byte straight past the "chat is 7-bit" gate.
    const pct = stages[0]!.value > 0 ? (stage.value / stages[0]!.value) * 100 : 0;
    const dot = canvas.tier === "ascii" ? "x" : "·";
    const full = chartText(`${formatFunnelValue(stage.value)} ${dot} ${pct.toFixed(0)}%`, canvas.tier);
    const valueOnly = chartText(formatFunnelValue(stage.value), canvas.tier);
    const valueMax = Math.max(1, labelGutter - 1);
    const valueText = full.length <= valueMax ? full : valueOnly.length <= valueMax ? valueOnly : "";
    if (valueText) canvas.text(Math.min(plot.x1, plot.x1 - labelGutter + 2), midRow, [valueText]);
  }
}
