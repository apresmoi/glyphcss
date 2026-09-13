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
import {
  ledgerEmptyTotal, ledgerFunnelBadReference, ledgerFunnelFoldedStages, ledgerFunnelNotMonotone, ledgerFunnelThinStage,
  ledgerLabelDropped, ledgerSankeyColumnsFolded, ledgerSankeyCrossingsMerged, ledgerSankeyFoldedFlows, ledgerSankeyImbalance,
  ledgerSankeyNodesDropped,
  type GlyphChartLedgerEntry,
} from "./ledger";
import type { GlyphChartPlotRect } from "./layout";
import { resolveSeriesColor, seriesShade, type ChartSeries } from "./series";
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
  const rows: GlyphChartMarkRow[] = mark.data.map((datum, i) => {
    const rawSource = sourceAcc?.(datum, i);
    const rawTarget = targetAcc?.(datum, i);
    // `sankey-missing-channel`: a typo'd field name (`source: "nope"`) still
    // has a defined ACCESSOR (the string itself), so the structural
    // "channel present" check in `validate.ts` passes — the accessor just
    // resolves every row to `undefined`, which used to get stringified into
    // a literal node id `"undefined"` (a spurious node) and, when BOTH
    // endpoints did it, a spurious self-loop that misreported as
    // `sankey-cycle` instead of naming the real mistake (P2-8).
    if (rawSource === undefined || rawSource === null || rawTarget === undefined || rawTarget === null) {
      throw Object.assign(
        new TypeError(`glyphcss: sankey-missing-channel: row ${i}'s source/target channel resolved to no value — check the field name against the actual data keys.`),
        { code: "sankey-missing-channel" as const },
      );
    }
    return {
      x: String(rawSource),
      y: valueAcc ? Number(valueAcc(datum, i)) : NaN,
      label: String(rawTarget),
      index: i,
    };
  });
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
  const rows = mark.data.map((datum, i) => ({
    x: stageAcc ? String(stageAcc(datum, i)) : String(i),
    y: valueAcc ? Number(valueAcc(datum, i)) : NaN,
    index: i,
  }));
  // `funnel-bad-value` (P2-5): a NEGATIVE stage draws no bar and logged
  // nothing, the asymmetry `sankey-bad-value` doesn't have. Non-finite
  // (NaN/Infinity) values already reject earlier and generically as
  // `non-finite-data` (`resolve.ts`'s `validateFiniteData`, run right after
  // this) — mirroring `sankey-bad-value`'s own documented split (P3-1) — so
  // this only needs to catch the finite-but-negative case; zero is
  // legitimate (an all-zero funnel is `empty-total`, handled at paint time).
  for (const row of rows) {
    if (typeof row.y === "number" && Number.isFinite(row.y) && row.y < 0) {
      chartError("funnel-bad-value", `Funnel stage "${row.x}" must have a value >= 0 (got ${row.y}).`);
    }
  }
  return rows;
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

/**
 * Like `distributeCumulative`, but scaled by a caller-supplied GLOBAL
 * rows-per-unit RATE rather than normalised to fill `capacity` exactly —
 * the fix for P2-1 (band thickness comparable across columns): every
 * column converts through the SAME rate rather than each independently
 * stretching its own nodes to fill whatever rows it happens to have, so a
 * value of 150 in one column is never drawn thinner than a 130 in another.
 * Still cumulative rounding on the running SUM (never per-weight), so a
 * column's own total still lands wherever the rate puts it with no drift.
 */
function distributeByRate(weights: readonly number[], rowsPerUnit: number): number[] {
  let prevCum = 0;
  let acc = 0;
  const sizes: number[] = [];
  for (const w of weights) {
    acc += w;
    const cum = Math.round(acc * rowsPerUnit);
    sizes.push(cum - prevCum);
    prevCum = cum;
  }
  return sizes;
}

/**
 * A 0-row node must never vanish silently (P2-3): every zero-height entry
 * with a real (positive) weight is bumped to 1 row UNCONDITIONALLY first —
 * even a column sitting exactly at capacity (its tallest entry already
 * claiming every spare row, as a lone huge flow beside a lone tiny one
 * does) has a row to spare once the tallest entry gives ONE up, and that
 * reclaiming happens in a SEPARATE pass afterward, from the TALLEST
 * entries (least visible impact), never gated on whether the bump looked
 * affordable in advance — gating it that way was the bug: it left a
 * genuinely reclaimable tiny flow at 0 whenever the column was already
 * exactly full. Only when reclaiming from every entry taller than 1 still
 * isn't enough (a column with more real nodes than the plot has rows — N
 * nodes cannot all show in fewer than N rows) does anything stay at 0: the
 * SMALLEST bumped values are un-bumped last, so the biggest ones keep
 * their row. Returns the entries that end up at 0 so the caller can report
 * them rather than leave them silently absent.
 */
function ensureMinimumHeights(heights: readonly number[], values: readonly number[], capacity: number): { readonly heights: number[]; readonly stillZero: readonly number[] } {
  const result = [...heights];
  const zeroIdx = result.map((h, i) => i).filter((i) => result[i] === 0 && values[i]! > 0).sort((a, b) => values[b]! - values[a]!);
  for (const i of zeroIdx) result[i] = 1;
  let total = result.reduce((a, b) => a + b, 0);
  while (total > capacity) {
    let maxIdx = -1;
    for (let i = 0; i < result.length; i++) if (result[i]! > 1 && (maxIdx === -1 || result[i]! > result[maxIdx]!)) maxIdx = i;
    if (maxIdx === -1) break; // every entry already at its floor of 1 — nothing left to reclaim.
    result[maxIdx] = result[maxIdx]! - 1;
    total -= 1;
  }
  // The genuinely impossible remainder (reclaiming from every entry over 1
  // row still isn't enough): un-bump the SMALLEST bumped values first
  // (`zeroIdx` is sorted largest-first, so walk it from the end).
  const stillZero: number[] = [];
  for (let k = zeroIdx.length - 1; k >= 0 && total > capacity; k--) {
    const i = zeroIdx[k]!;
    if (result[i] === 1) { result[i] = 0; total -= 1; stillZero.push(i); }
  }
  return { heights: result, stillZero };
}

interface SankeyOutLink { readonly target: string; readonly value: number; readonly folded?: boolean }

/**
 * Folds a source's outgoing links to a FIXED POINT, not a single re-run
 * (P1-2). The first pass's re-split can itself hand a DIFFERENT survivor
 * zero rows — the "(other)" bucket now claims a bigger share, so a link
 * just above the earlier threshold can fall under it — so this keeps
 * folding newly-zero real links into the running "(other)" bucket and
 * re-splitting until a full pass leaves every remaining real link at >= 1
 * row (or only "(other)" itself remains, which is allowed to be 0 — it is
 * already the fold, and folding it again folds nothing new). Bounded by
 * `outLinks.length` iterations since each round that keeps going removes
 * at least one real link.
 */
/**
 * A converged "(other)" bucket can ITSELF still round to 0 rows — its
 * residual is genuinely negligible against the kept links' own share — and
 * an invisible fold stub defeats the one thing it exists to show ("a flow
 * left here, not itemized"; a folded flow is still named in the ledger,
 * but a reader has no cell to point at). Steal exactly 1 row from the
 * TALLEST kept link if one has more than its own floor of 1 to spare.
 */
function ensureFoldStubVisible(finalLinks: readonly SankeyOutLink[], heights: readonly number[]): number[] {
  const otherIdx = finalLinks.findIndex((l) => l.folded);
  if (otherIdx === -1 || heights[otherIdx] !== 0) return [...heights];
  const result = [...heights];
  let maxIdx = -1;
  for (let i = 0; i < result.length; i++) if (i !== otherIdx && result[i]! > 1 && (maxIdx === -1 || result[i]! > result[maxIdx]!)) maxIdx = i;
  if (maxIdx === -1) return result; // no spare row anywhere — leave it at 0.
  result[maxIdx] = result[maxIdx]! - 1;
  result[otherIdx] = 1;
  return result;
}

function foldSankeyOutLinks(outLinks: readonly SankeyOutLink[], boxHeight: number): { readonly finalLinks: readonly SankeyOutLink[]; readonly heights: readonly number[]; readonly foldedFlows: readonly string[] } {
  let keptReal = [...outLinks];
  let otherValue = 0;
  const foldedFlows: string[] = [];
  for (let iter = 0; iter <= outLinks.length; iter++) {
    const candidates: SankeyOutLink[] = otherValue > 0 ? [...keptReal, { target: "(other)", value: otherValue, folded: true }] : [...keptReal];
    const heights = distributeCumulative(candidates.map((l) => l.value), boxHeight);
    const zeroReal = keptReal.filter((l, i) => heights[i] === 0 && l.value > 0);
    if (zeroReal.length === 0) return { finalLinks: candidates, heights: ensureFoldStubVisible(candidates, heights), foldedFlows };
    keptReal = keptReal.filter((l, i) => !(heights[i] === 0 && l.value > 0));
    otherValue += zeroReal.reduce((a, b) => a + b.value, 0);
    foldedFlows.push(...zeroReal.map((l) => l.target));
  }
  // Unreachable (the loop above always returns within `outLinks.length + 1`
  // rounds — each round that doesn't return strictly shrinks `keptReal`),
  // kept only so the function is total under TypeScript's control-flow check.
  const candidates: SankeyOutLink[] = otherValue > 0 ? [...keptReal, { target: "(other)", value: otherValue, folded: true }] : keptReal;
  const heights = distributeCumulative(candidates.map((l) => l.value), boxHeight);
  return { finalLinks: candidates, heights: ensureFoldStubVisible(candidates, heights), foldedFlows };
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
  /** The source node's own `ChartSeries.color` — its mark's `options.color` override, per source node, or `null` for none. */
  readonly color: string | null;
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
  const numColsRaw = maxDepth + 1;

  // Node box width = min(longest folded label + 2, a cap) — measured
  // through `chartText` (the SAME fold `abbreviateChartText` applies), not
  // the raw string length, so a tier's own ASCII fold is what sizes the box.
  const longestLabel = Math.max(1, ...nodeOrder.map((id) => chartText(id, tierName).length));
  let nodeWidth = Math.max(GLYPH_CHART_SANKEY_MIN_NODE_WIDTH, Math.min(longestLabel + 2, GLYPH_CHART_SANKEY_NODE_WIDTH_CAP));
  let numCols = numColsRaw;
  let gap = numCols > 1 ? Math.floor((plotWidth - numCols * nodeWidth) / (numCols - 1)) : 0;
  if (numCols > 1 && gap < GLYPH_CHART_SANKEY_MIN_GAP) {
    const maxWidthThatFits = Math.max(GLYPH_CHART_SANKEY_MIN_NODE_WIDTH, Math.floor((plotWidth - (numCols - 1) * GLYPH_CHART_SANKEY_MIN_GAP) / numCols));
    nodeWidth = Math.min(nodeWidth, maxWidthThatFits);
    gap = Math.max(1, Math.floor((plotWidth - numCols * nodeWidth) / (numCols - 1)));
  }
  // P2-2: even at the floor node width, this many columns may still not
  // fit the plot — walking `colX0(col)` past `plot.x1` and, at extreme
  // widths, clipping the last box mid-glyph. Fold the deepest columns
  // (clamp their depth onto the last one that fits) rather than draw
  // outside the rect; a link between two now-merged depths becomes a
  // same-column band and is silently skipped by the painter's own
  // `gapX1 < gapX0` guard — a real, reported degradation, not a crash.
  if (numCols > 1 && numCols * GLYPH_CHART_SANKEY_MIN_NODE_WIDTH + (numCols - 1) * GLYPH_CHART_SANKEY_MIN_GAP > plotWidth) {
    const maxColsFit = Math.max(1, Math.floor((plotWidth + GLYPH_CHART_SANKEY_MIN_GAP) / (GLYPH_CHART_SANKEY_MIN_NODE_WIDTH + GLYPH_CHART_SANKEY_MIN_GAP)));
    if (maxColsFit < numCols) {
      ledger.push(ledgerSankeyColumnsFolded({ folded: numCols - maxColsFit, total: numCols }));
      numCols = maxColsFit;
      nodeWidth = GLYPH_CHART_SANKEY_MIN_NODE_WIDTH;
      gap = numCols > 1 ? Math.max(1, Math.floor((plotWidth - numCols * nodeWidth) / (numCols - 1))) : 0;
    }
  }
  // A defensive final check (rounding at the boundary, never observed to
  // actually fire given the derivation above) — never walk a box past the
  // plot rect: shed one column at a time until the total genuinely fits.
  while (numCols > 1 && numCols * nodeWidth + (numCols - 1) * gap > plotWidth) {
    numCols -= 1;
    gap = numCols > 1 ? Math.max(1, Math.floor((plotWidth - numCols * nodeWidth) / (numCols - 1))) : 0;
  }
  const depthOf = (id: string): number => Math.min(nodeDepthById.get(id) ?? 0, numCols - 1);
  const colX0 = (col: number): number => plot.x0 + col * (nodeWidth + gap);
  const colX1 = (col: number): number => Math.min(plot.x1, colX0(col) + nodeWidth - 1);

  // Row heights ∝ throughput (node.value) under ONE GLOBAL rows-per-unit
  // rate (P2-1) — sized to the TIGHTEST column (available capacity ÷ its
  // own total throughput) so every OTHER column has slack rather than any
  // column ever overflowing, and a value of 150 is therefore never drawn
  // thinner than a 130 elsewhere in the chart, whatever column each sits in.
  let rowsPerUnit = Infinity;
  for (let col = 0; col < numCols; col++) {
    const colNodes = nodeOrder.filter((id) => depthOf(id) === col);
    if (colNodes.length === 0) continue;
    const n = colNodes.length;
    const gapRows = n > 1 && plotHeight - (n - 1) >= n ? n - 1 : 0;
    const capacity = Math.max(0, plotHeight - gapRows);
    const totalValue = colNodes.reduce((a, id) => a + (nodeValueById.get(id) ?? 0), 0);
    if (totalValue > 0 && capacity > 0) rowsPerUnit = Math.min(rowsPerUnit, capacity / totalValue);
  }
  if (!Number.isFinite(rowsPerUnit)) rowsPerUnit = 0;

  const nodeBoxes = new Map<string, SankeyNodeBox>();
  for (let col = 0; col < numCols; col++) {
    const colNodes = nodeOrder.filter((id) => depthOf(id) === col).sort((a, b) => (nodeY0ById.get(a) ?? 0) - (nodeY0ById.get(b) ?? 0));
    if (colNodes.length === 0) continue;
    const n = colNodes.length;
    const gapRows = n > 1 && plotHeight - (n - 1) >= n ? n - 1 : 0;
    const capacity = Math.max(0, plotHeight - gapRows);
    const values = colNodes.map((id) => nodeValueById.get(id) ?? 0);
    const { heights, stillZero } = ensureMinimumHeights(distributeByRate(values, rowsPerUnit), values, capacity);
    if (stillZero.length > 0) ledger.push(ledgerSankeyNodesDropped({ nodes: stillZero.map((i) => colNodes[i]!) }));
    let cursor = plot.y0;
    colNodes.forEach((id, i) => {
      const h = heights[i]!;
      const y0 = cursor;
      const y1 = cursor + h - 1;
      nodeBoxes.set(id, { id, x0: colX0(col), x1: colX1(col), y0, y1, height: h });
      // No gap row after the LAST node — `capacity` only ever budgeted
      // `n - 1` of them, and a trailing one would let `cursor` walk one
      // row past what the column actually accounted for.
      cursor += h + (gapRows > 0 && i < colNodes.length - 1 ? 1 : 0);
    });
  }

  // Outgoing bands per source, folding to a FIXED POINT (P1-2) — see
  // `foldSankeyOutLinks`'s own doc for why a single re-run isn't enough.
  const bands: SankeyBand[] = [];
  for (const g of groups) {
    const nodeId = g.name!;
    const box = nodeBoxes.get(nodeId);
    if (!box) continue;
    const outLinks = g.rows.map((r) => ({ target: String(r.label), value: numeric(r.y) }));
    const { finalLinks, heights, foldedFlows } = foldSankeyOutLinks(outLinks, box.height);
    if (foldedFlows.length > 0) {
      ledger.push(ledgerSankeyFoldedFlows({ source: nodeId, flows: foldedFlows.map((t) => `${nodeId} → ${t}`) }));
    }
    let cursor = box.y0;
    finalLinks.forEach((l, i) => {
      const h = heights[i]!;
      const range: readonly [number, number] = [cursor, cursor + h - 1];
      cursor += h;
      bands.push({ source: nodeId, target: l.target, value: l.value, styleIndex: g.styleIndex, color: g.color, sourceRowRange: range, folded: Boolean(l.folded) });
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
 * Every DIAGONAL band (its source and target row ranges differ) sharing a
 * gap window gets its OWN lane column for the vertical run (P1-1) — the
 * fix for crossing bands overwriting each other. Before this, every band
 * between the same two node columns routed through the SAME `mid` column,
 * so two crossing flows' vertical runs landed on identical cells and the
 * later one in paint order simply erased the earlier one — a reader traced
 * straight, non-crossing ribbons that contradicted the data. Grouped by
 * `(gapX0, gapX1)` (bands between the same adjacent pair of node columns);
 * ordered by the vertical span's own midpoint so physically-stacked
 * crossings land on sequential lanes — a heuristic, not exact
 * crossing-minimization (ASCII has no curved splines to disambiguate a true
 * topological order), close enough that an actual crossing POINT between
 * two lanes' legs still reads as a hop rather than one run erasing another.
 * A gap too narrow for one lane per band MERGES the excess onto existing
 * lanes (reported via `sankey-crossings-merged`) rather than losing the
 * per-lane guarantee silently. A non-diagonal band (`sr0 === tr0 && sr1 ===
 * tr1`) needs no lane — it already fills the gap at one fixed row.
 */
function assignSankeyLanes(bands: readonly SankeyBand[], nodeBoxes: ReadonlyMap<string, SankeyNodeBox>, ledger: GlyphChartLedgerEntry[]): Map<SankeyBand, number> {
  interface Entry { readonly band: SankeyBand; readonly mid: number }
  const groups = new Map<string, { readonly gapX0: number; readonly gapX1: number; readonly entries: Entry[] }>();
  for (const band of bands) {
    if (band.folded || !band.targetRowRange) continue;
    const srcBox = nodeBoxes.get(band.source);
    const tgtBox = nodeBoxes.get(band.target);
    if (!srcBox || !tgtBox) continue;
    const [sr0, sr1] = band.sourceRowRange;
    const [tr0, tr1] = band.targetRowRange;
    if (sr0 === tr0 && sr1 === tr1) continue; // straight through — no lane needed.
    const gapX0 = srcBox.x1 + 1;
    const gapX1 = tgtBox.x0 - 1;
    if (gapX1 < gapX0) continue;
    const mid = (Math.min(sr0, tr0) + Math.max(sr1, tr1)) / 2;
    const key = `${gapX0}:${gapX1}`;
    if (!groups.has(key)) groups.set(key, { gapX0, gapX1, entries: [] });
    groups.get(key)!.entries.push({ band, mid });
  }
  const laneByBand = new Map<SankeyBand, number>();
  for (const { gapX0, gapX1, entries } of groups.values()) {
    const gapWidth = gapX1 - gapX0 + 1;
    const ordered = [...entries].sort((a, b) => a.mid - b.mid);
    const laneCount = Math.min(ordered.length, Math.max(1, gapWidth));
    if (laneCount < ordered.length) ledger.push(ledgerSankeyCrossingsMerged({ gapX0, gapX1, crossing: ordered.length, lanes: laneCount }));
    ordered.forEach((entry, i) => {
      const laneIndex = laneCount === 1 ? 0 : Math.round((i * (laneCount - 1)) / (ordered.length - 1));
      const column = laneCount === 1 ? gapX0 + Math.floor(gapWidth / 2) : gapX0 + Math.round((laneIndex * (gapWidth - 1)) / (laneCount - 1));
      laneByBand.set(entry.band, column);
    });
  }
  return laneByBand;
}

/**
 * Paints a `GlyphChartSankeyLayout` (bands first, so a node's own
 * border/label sits on top of a band that happens to touch its edge).
 */
export function paintSankeyLayout(canvas: GlyphCanvas, plot: GlyphChartPlotRect, layout: GlyphChartSankeyLayout, colorEnabled: boolean, ledger: GlyphChartLedgerEntry[]): void {
  const nodeBoxes = new Map(layout.nodes.map((n) => [n.id, n]));
  const { bands, gap } = layout;
  const laneByBand = assignSankeyLanes(bands, nodeBoxes, ledger);
  // TWO PASSES, never one: a band's own LEG necessarily spans from the
  // source's border most of the way across the gap (an L-shaped block, not
  // a thin diagonal line — the canvas has no sub-cell diagonal at this
  // thickness), so a leg travelling toward a FAR lane inevitably passes
  // OVER a nearer band's lane column for however many rows the two row
  // ranges overlap. Giving each band a distinct lane (P1-1) is therefore
  // not sufficient on its own — it only stops two lanes sharing the SAME
  // column; a leg crossing through a DIFFERENT band's lane is a second,
  // independent way to erase it. Painting every band's legs/straight-fill
  // FIRST and every band's own lane column SECOND (always on top) closes
  // that: a lane can still be crossed by a leg (that IS a real visual
  // crossing, the tier's own glyph at that one cell is fine), but it is
  // never WIPED OUT along its own length by one.
  for (const band of bands) {
    const glyph = seriesShade(canvas.tier, band.styleIndex);
    const color = resolveSeriesColor(band, colorEnabled);
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
    // Horizontal legs ONLY here (source rows -> ..., ... -> target rows);
    // the vertical lane column itself is pass 2, below.
    const lane = laneByBand.get(band) ?? Math.floor((gapX0 + gapX1) / 2);
    if (gapX0 <= lane - 1) fillGlyphRegion(canvas, gapX0, sr0, lane - 1, sr1, glyph, color);
    if (lane + 1 <= gapX1) fillGlyphRegion(canvas, lane + 1, tr0, gapX1, tr1, glyph, color);
  }
  for (const band of bands) {
    if (band.folded || !band.targetRowRange) continue;
    const [sr0, sr1] = band.sourceRowRange;
    const [tr0, tr1] = band.targetRowRange;
    if (sr0 > sr1 || tr0 > tr1 || (sr0 === tr0 && sr1 === tr1)) continue;
    const lane = laneByBand.get(band);
    if (lane === undefined) continue;
    const glyph = seriesShade(canvas.tier, band.styleIndex);
    const color = resolveSeriesColor(band, colorEnabled);
    fillGlyphRegion(canvas, lane, Math.min(sr0, tr0), lane, Math.max(sr1, tr1), glyph, color);
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
    // A 2-row box has no interior row: its only two rows ARE the top and
    // bottom border, and `midRow` (their floor-averaged row) lands on the
    // top one — painting the label there overwrote its own border (P3-4).
    // Skip the label rather than corrupt the border; the box still reads
    // as a node via its border and connected bands alone.
    if (box.y1 - box.y0 + 1 < 3) {
      ledger.push(ledgerLabelDropped({ role: "sankey node label", text: box.id, reason: "the node's box is too short to show a label without overwriting its own border" }));
      continue;
    }
    const midRow = Math.floor((box.y0 + box.y1) / 2);
    const pad = Math.max(0, Math.floor((inner - text.length) / 2));
    canvas.text(box.x0 + 1 + pad, midRow, [text]);
  }
}

/** `paint.ts`'s own call site — lays out then paints in one step. */
export function paintSankeyMark(canvas: GlyphCanvas, plot: GlyphChartPlotRect, groups: readonly ChartSeries[], colorEnabled: boolean, ledger: GlyphChartLedgerEntry[]): void {
  const layout = layoutSankeyGraph(groups, plot, canvas.tier, ledger);
  if (layout) paintSankeyLayout(canvas, plot, layout, colorEnabled, ledger);
}

// ── funnel ───────────────────────────────────────────────────────────────

const FUNNEL_SI_FORMAT = d3format(".3~s");
const FUNNEL_PLAIN_FORMAT = d3format(",");
/**
 * P2-6: try the PLAIN, exact, comma-grouped form first ("12,345") — for a
 * chart-scale integer it is almost always no longer than a 6-significant-
 * digit `~s` abbreviation and it is always exact — and fall back to a
 * 3-significant-digit SI abbreviation ("12.3k") only when the plain form
 * doesn't fit. The caller drops the label entirely (never truncates a
 * number) when NEITHER candidate fits. Returns one candidate when SI
 * abbreviation wouldn't change anything (small values).
 */
function formatFunnelValueCandidates(v: number): readonly string[] {
  const plain = FUNNEL_PLAIN_FORMAT(v).replace(/−/g, "-");
  if (Math.abs(v) < 1000) return [plain];
  const si = FUNNEL_SI_FORMAT(v).replace(/−/g, "-").replace(/µ/g, "u");
  return si === plain ? [plain] : [plain, si];
}

/**
 * `groups` is `chartSeries`' per-stage split, ONE row each, in the ORDER
 * given (never re-sorted — a funnel is read top-to-bottom in declaration
 * order, a "not monotone" stage renders in place and is reported, not
 * moved). Stage identity is by ROW, not name (`series.ts`'s `chartSeries`
 * keys a funnel by index) — two stages sharing a label are still two rows.
 */
export function paintFunnelMark(canvas: GlyphCanvas, plot: GlyphChartPlotRect, groups: readonly ChartSeries[], colorEnabled: boolean, ledger: GlyphChartLedgerEntry[]): void {
  const rawStages = groups.map((g) => ({ name: g.name ?? String(g.rows[0]?.index ?? 0), value: numeric(g.rows[0]?.y), styleIndex: g.styleIndex, color: g.color }));
  if (rawStages.length === 0) return;
  const plotWidth = plot.x1 - plot.x0 + 1;
  const plotHeight = plot.y1 - plot.y0 + 1;
  if (plotWidth <= 0 || plotHeight <= 0) return;

  // `funnel-bad-value`/`empty-total` split (P2-5): a negative value already
  // rejects at resolve time (`resolveFunnelRows`); an ALL-ZERO funnel is
  // legitimate data (nothing converted) and draws nothing at all, exactly
  // like `arc`'s own `empty-total` — never a fabricated bar or percentage.
  if (rawStages.every((s) => s.value === 0)) { ledger.push(ledgerEmptyTotal()); return; }

  for (let i = 1; i < rawStages.length; i++) {
    if (rawStages[i]!.value > rawStages[i - 1]!.value) {
      ledger.push(ledgerFunnelNotMonotone({ stage: rawStages[i]!.name, value: rawStages[i]!.value, previousStage: rawStages[i - 1]!.name, previousValue: rawStages[i - 1]!.value }));
    }
  }

  // P1-3: stages past the row budget used to fall off the bottom silently
  // (`if (rowStart > plot.y1) break`, no ledger entry). One stage needs at
  // least 1 row with no gap when tightly packed, so more stages than
  // `plotHeight` genuinely cannot all show — fold the tail into one
  // synthetic "other (k more)" stage instead, sized at the LARGEST folded
  // value (the first, since stages are conventionally non-increasing) so
  // the funnel's own monotone shape stays plausible through the fold.
  let stages = rawStages;
  if (rawStages.length > plotHeight && plotHeight >= 1) {
    const keepCount = Math.max(0, plotHeight - 1);
    const kept = rawStages.slice(0, keepCount);
    const folded = rawStages.slice(keepCount);
    if (folded.length > 0) {
      stages = [...kept, { name: `other (${folded.length} more)`, value: folded[0]!.value, styleIndex: folded[0]!.styleIndex, color: folded[0]!.color }];
      ledger.push(ledgerFunnelFoldedStages({ stages: folded.map((s) => s.name) }));
    }
  }
  const n = stages.length;

  // One EQUAL row band per stage (never proportional — only the bar WIDTH
  // is ∝ value), with a one-row gap between stages when there's room.
  const hasGap = n > 1 && plotHeight >= 2 * n - 1;
  const bandHeight = Math.max(1, Math.floor((plotHeight - (hasGap ? n - 1 : 0)) / n));
  const maxValue = Math.max(0, ...stages.map((s) => s.value));

  // P1-4: a nonpositive (or non-finite) reference stage used to make EVERY
  // percentage print as a fabricated "0%" — a stage worth 100 labelled
  // "0%". Omit the percent entirely when the denominator isn't usable
  // (label just the value) and report it once, not per stage.
  const referenceValue = rawStages[0]!.value;
  const hasValidReference = Number.isFinite(referenceValue) && referenceValue > 0;
  if (!hasValidReference) ledger.push(ledgerFunnelBadReference({ value: referenceValue }));

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
    const color = resolveSeriesColor(stage, colorEnabled);
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

    // Value·percent label: right of the bars. `dot` is built by hand (`x`
    // on `ascii`, since that tier has no middle dot) rather than going
    // through `chartText` for the WHOLE string up front — kept for
    // legibility (P3-3: the ASCII fold already turns a stray `·` into `?`
    // on its own, `labels.ts`'s `chartText`, so this isn't preventing a
    // raw byte leak; it is choosing a nicer glyph than the generic `?`
    // fallback would). P2-6: try each value-format candidate (plain, then
    // SI-abbreviated) WITH the percent suffix first, then without it, and
    // drop (never truncate a number) only when nothing fits.
    const pctSuffix = hasValidReference ? ` ${canvas.tier === "ascii" ? "x" : "·"} ${((stage.value / referenceValue) * 100).toFixed(0)}%` : "";
    const valueMax = Math.max(1, labelGutter - 1);
    const candidates = formatFunnelValueCandidates(stage.value).map((v) => chartText(v, canvas.tier));
    let valueText = "";
    for (const v of candidates) {
      const withPct = chartText(`${v}${pctSuffix}`, canvas.tier);
      if (withPct.length <= valueMax) { valueText = withPct; break; }
    }
    if (!valueText) for (const v of candidates) if (v.length <= valueMax) { valueText = v; break; }
    if (valueText) canvas.text(Math.min(plot.x1, plot.x1 - labelGutter + 2), midRow, [valueText]);
    else ledger.push(ledgerLabelDropped({ role: "funnel value label", text: candidates[0] ?? String(stage.value), reason: "it doesn't fit even after SI abbreviation" }));
  }
}
