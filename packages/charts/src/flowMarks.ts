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
 * discipline.
 */

import { sankey as d3Sankey } from "d3-sankey";
import { format as d3format } from "d3-format";
import type { GlyphCanvas, GlyphCanvasTierName } from "glyphcss";
import { accessorFor, identity, index, isNumericArray } from "./channels";
import { abbreviateChartText, chartText } from "./labels";
import {
  ledgerEmptyTotal, ledgerFunnelBadReference, ledgerFunnelFoldedStages, ledgerFunnelNotMonotone, ledgerFunnelThinStage,
  ledgerLabelDropped, ledgerSankeyAirDropped, ledgerSankeyColumnsFolded, ledgerSankeyFoldedFlows, ledgerSankeyImbalance,
  ledgerSankeyNodesDropped,
  type GlyphChartLedgerEntry,
} from "./ledger";
import type { GlyphChartPlotRect } from "./layout";
import { regionFillGlyph, resolveSeriesColor, type ChartSeries } from "./series";

/** A resolved region fill (`regionFill.ts`); kept local so this module never imports `paint.ts`, which imports it. */
type SankeyRegionFill = "solid" | "texture";
import { chartError } from "./validate";
import type { GlyphChartMark, GlyphChartMarkRow } from "./types";

function numeric(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : NaN;
}

// ── resolution ───────────────────────────────────────────────────────────

/**
 * A typo'd field name (`source: "nope"`) or a genuinely empty/non-scalar
 * endpoint value all resolve to the SAME "not a usable node id" verdict:
 * `undefined`/`null` (the accessor found nothing), `""` (a blank string is
 * not a node name a reader can act on), and a plain object/`{}` (there is
 * no reasonable `String()` of a record — round 2's `[object Object]` node,
 * N8). An array is left alone (`String([1, 2]) === "1,2"` is at least a
 * legible, if unusual, node id) and so are `0`/`false` (legitimate ids that
 * happen to be falsy).
 */
function isMissingSankeyEndpoint(v: unknown): boolean {
  return v === undefined || v === null || v === "" || (typeof v === "object" && !Array.isArray(v));
}

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
    // `sankey-missing-channel`: see `isMissingSankeyEndpoint` — this used to
    // stringify a missing/blank/object endpoint into a literal node id
    // (`"undefined"`, `"[object Object]"`, `""`), a spurious node, and when
    // BOTH endpoints did it, a spurious self-loop that misreported as
    // `sankey-cycle` instead of naming the real mistake (P2-8).
    if (isMissingSankeyEndpoint(rawSource) || isMissingSankeyEndpoint(rawTarget)) {
      throw Object.assign(
        new TypeError(`glyphcss: sankey-missing-channel: row ${i}'s source/target channel resolved to no usable value — check the field name against the actual data keys.`),
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
 * exactly full.
 *
 * The genuinely impossible case — more positive-value nodes in this column
 * than the plot has rows, so not even a floor of 1 row each can seat them
 * all — is decided BY VALUE, not by an artifact of `distributeByRate`'s own
 * cumulative-rounding order (round 2's bug, N3): the `capacity` BIGGEST
 * values are kept at exactly 1 row each (the only layout that fits — with
 * more destinations than rows, no proportionality survives anyway) and the
 * rest are dropped and reported. `distributeByRate`'s own per-column shares
 * are irrelevant once this branch is entered; a column with room for
 * everyone (the ordinary case) keeps the original reclaim-from-the-tallest
 * behaviour, which always succeeds without dropping anyone (every entry
 * bottoms out at 1, summing to at most `capacity`). Returns the entries
 * that end up at 0 so the caller can report them.
 */
function ensureMinimumHeights(heights: readonly number[], values: readonly number[], capacity: number): { readonly heights: number[]; readonly stillZero: readonly number[] } {
  const positiveIdx = heights.map((_, i) => i).filter((i) => values[i]! > 0);
  if (positiveIdx.length > capacity) {
    const byValueDesc = [...positiveIdx].sort((a, b) => values[b]! - values[a]! || a - b);
    const keep = new Set(byValueDesc.slice(0, Math.max(0, capacity)));
    const result = heights.map((_, i) => (keep.has(i) ? 1 : 0));
    return { heights: result, stillZero: byValueDesc.slice(Math.max(0, capacity)) };
  }
  const result = [...heights];
  for (const i of positiveIdx) if (result[i] === 0) result[i] = 1;
  let total = result.reduce((a, b) => a + b, 0);
  while (total > capacity) {
    let maxIdx = -1;
    for (let i = 0; i < result.length; i++) if (result[i]! > 1 && (maxIdx === -1 || result[i]! > result[maxIdx]!)) maxIdx = i;
    if (maxIdx === -1) break; // unreachable here (positiveIdx.length <= capacity guarantees this closes), kept as a guard.
    result[maxIdx] = result[maxIdx]! - 1;
    total -= 1;
  }
  return { heights: result, stillZero: [] };
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

/**
 * The synthetic fold bucket's node id must never collide with a REAL node
 * id anywhere in the graph (not just this source's own out-links) —
 * `nodeBoxes` (built from the actual `d3-sankey` graph, which never sees
 * the fold at all) is keyed by plain string id, so a genuine node
 * literally named `"(other)"` and the synthetic bucket sharing that exact
 * string used to route the fold band onto the REAL node's box, silently
 * merging two unrelated flows (sankey round-3 review, finding l/N10: `Hub
 * -> "(other)"` (a real node) plus a separately-folded `Hub -> Tiny` both
 * rendered as one `Hub`-coloured band, and `sankey-folded-flows` named
 * neither as the fold target). Suffixed exactly like `series.ts`'s funnel
 * stage disambiguation: `"(other)"`, then `"(other) (2)"`, etc., until the
 * candidate isn't any real node's id.
 */
function uniqueSankeyFoldName(realNodeIds: ReadonlySet<string>): string {
  if (!realNodeIds.has("(other)")) return "(other)";
  let n = 2;
  while (realNodeIds.has(`(other) (${n})`)) n++;
  return `(other) (${n})`;
}

/**
 * `gapRows` (`GLYPH_CHART_SANKEY_LINK_GAP_ROWS`, degraded by `sankeyAirGap`
 * — see its own doc) is reserved from `boxHeight` BEFORE the cumulative
 * split, recomputed every round against the CURRENT candidate count (it
 * only ever shrinks as folding removes candidates, so the fixed-point
 * proof below is unaffected — a round that doesn't return still strictly
 * shrinks `keptReal`). The returned `gap` is what the caller spaces the
 * final bands apart by; it is 0 whenever `candidates.length <= 1` (nothing
 * to put air between) or the row budget couldn't afford it at all.
 */
function foldSankeyOutLinks(outLinks: readonly SankeyOutLink[], boxHeight: number, realNodeIds: ReadonlySet<string>, textScale: number): { readonly finalLinks: readonly SankeyOutLink[]; readonly heights: readonly number[]; readonly foldedFlows: readonly string[]; readonly gap: number } {
  const foldName = uniqueSankeyFoldName(realNodeIds);
  const desiredGap = GLYPH_CHART_SANKEY_LINK_GAP_ROWS * textScale;
  let keptReal = [...outLinks];
  let otherValue = 0;
  const foldedFlows: string[] = [];
  for (let iter = 0; iter <= outLinks.length; iter++) {
    const candidates: SankeyOutLink[] = otherValue > 0 ? [...keptReal, { target: foldName, value: otherValue, folded: true }] : [...keptReal];
    const gap = sankeyAirGap(desiredGap, candidates.length, boxHeight);
    const capacity = Math.max(0, boxHeight - gap * (candidates.length - 1));
    const heights = distributeCumulative(candidates.map((l) => l.value), capacity);
    const zeroReal = keptReal.filter((l, i) => heights[i] === 0 && l.value > 0);
    if (zeroReal.length === 0) return { finalLinks: candidates, heights: ensureFoldStubVisible(candidates, heights), foldedFlows, gap };
    keptReal = keptReal.filter((l, i) => !(heights[i] === 0 && l.value > 0));
    otherValue += zeroReal.reduce((a, b) => a + b.value, 0);
    foldedFlows.push(...zeroReal.map((l) => l.target));
  }
  // Unreachable (the loop above always returns within `outLinks.length + 1`
  // rounds — each round that doesn't return strictly shrinks `keptReal`),
  // kept only so the function is total under TypeScript's control-flow check.
  const candidates: SankeyOutLink[] = otherValue > 0 ? [...keptReal, { target: foldName, value: otherValue, folded: true }] : keptReal;
  const gap = sankeyAirGap(desiredGap, candidates.length, boxHeight);
  const capacity = Math.max(0, boxHeight - gap * (candidates.length - 1));
  const heights = distributeCumulative(candidates.map((l) => l.value), capacity);
  return { finalLinks: candidates, heights: ensureFoldStubVisible(candidates, heights), foldedFlows, gap };
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
/**
 * The layout's own true FLOOR column gap (never the 3-cell PREFERRED
 * `GLYPH_CHART_SANKEY_MIN_GAP` spacing above, which a tight layout reflows
 * node width to reclaim toward) — see `layoutSankeyGraph`'s own "P2-2"
 * comment for why the fit check below must use this one. Hoisted to module
 * scope (it used to be a `layoutSankeyGraph`-local const) so it scales by
 * `textScale` alongside every other fixed-cell geometry constant here.
 */
const GLYPH_CHART_SANKEY_MIN_LAYOUT_GAP = 1;

/**
 * Visual AIR, reserved at the LAYOUT layer (AGENTS.md's "Charts" sankey
 * clause) — never in the painter, which has no way to tell a planned gap
 * from a genuinely lost cell (a painter-level gap was tried and reverted:
 * the zero-silent-overwrite gate read every skipped cell as a loss). `NODE_PADDING_ROWS`
 * separates stacked node boxes within one column; `LINK_GAP_ROWS` separates
 * consecutive bands leaving (or entering) one node. Both are DESIRED
 * values, degraded per column/node by `sankeyAirGap` when the rows can't
 * afford them — never below 0, and never at the cost of squeezing an item
 * under 1 row.
 */
export const GLYPH_CHART_SANKEY_NODE_PADDING_ROWS = 2;
export const GLYPH_CHART_SANKEY_LINK_GAP_ROWS = 1;

/**
 * The actual gap (rows) to place between `count` items sharing `capacity`
 * rows before any of them is split off it, given a DESIRED gap — the
 * largest `g` in `[0, desired]` such that reserving `g * (count - 1)` rows
 * for the gaps still leaves at least `count` rows for the items themselves
 * (`capacity - g * (count - 1) >= count`). This is what makes the applied
 * gap SCALE with the room available: it lands on `desired` when there's
 * slack, degrades toward 1 as the column/node gets tighter, and only drops
 * to 0 when even a single row of air would starve an item. `count <= 1`
 * needs no gap between anything and returns 0 unconditionally.
 */
function sankeyAirGap(desired: number, count: number, capacity: number): number {
  if (count <= 1) return 0;
  for (let g = desired; g > 0; g--) {
    if (capacity - g * (count - 1) >= count) return g;
  }
  return 0;
}

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
  /** Cell columns between two adjacent node columns. */
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
export function layoutSankeyGraph(groups: readonly ChartSeries[], plot: GlyphChartPlotRect, tierName: GlyphCanvasTierName, ledger: GlyphChartLedgerEntry[], textScale = 1): GlyphChartSankeyLayout | null {
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

  // Every fixed cell-count GEOMETRY constant from here on multiplies by
  // `textScale` (AGENTS.md's "Charts" "Density"), exactly like the arc
  // callout gutter already does — a chart at a higher web Density renders
  // into a proportionally BIGGER grid at a proportionally SMALLER font, so
  // a constant cell count (a node box's width, a column gap) would
  // otherwise shrink as a FRACTION of the plot the denser the render gets,
  // which is the reported "increase the density, breaks the column
  // widths" defect. A data-PROPORTIONAL quantity (row height ∝ throughput,
  // band thickness) is never scaled here — it already rides the
  // density-scaled plot. At `textScale === 1` every expression below is
  // its own bare, pre-scaling value, byte-identical to before this scaling
  // existed. Unscaled, a node column shrank to a third of its plot share at
  // density 3 while the column gap ballooned.
  const minNodeWidth = GLYPH_CHART_SANKEY_MIN_NODE_WIDTH * textScale;
  const nodeWidthCap = GLYPH_CHART_SANKEY_NODE_WIDTH_CAP * textScale;
  const minGap = GLYPH_CHART_SANKEY_MIN_GAP * textScale;
  const minLayoutGap = GLYPH_CHART_SANKEY_MIN_LAYOUT_GAP * textScale;

  // Node box width = min(longest folded label + 2, a cap) — measured
  // through `chartText` (the SAME fold `abbreviateChartText` applies), not
  // the raw string length, so a tier's own ASCII fold is what sizes the
  // box. The label's own CHARACTER count is scaled by `textScale` too: a
  // node label is painted through `canvas.text(..., { scale: textScale })`
  // (`paintSankeyNodeBoxes`), so each of its glyphs occupies `textScale`
  // columns — sizing the box off the raw (unscaled) character count would
  // force MORE aggressive abbreviation at higher density, the opposite of
  // what density is for.
  const longestLabel = Math.max(1, ...nodeOrder.map((id) => chartText(id, tierName).length));
  let nodeWidth = Math.max(minNodeWidth, Math.min(longestLabel * textScale + 2 * textScale, nodeWidthCap));
  let numCols = numColsRaw;
  let gap = numCols > 1 ? Math.floor((plotWidth - numCols * nodeWidth) / (numCols - 1)) : 0;
  if (numCols > 1 && gap < minGap) {
    const maxWidthThatFits = Math.max(minNodeWidth, Math.floor((plotWidth - (numCols - 1) * minGap) / numCols));
    nodeWidth = Math.min(nodeWidth, maxWidthThatFits);
    gap = Math.max(minLayoutGap, Math.floor((plotWidth - numCols * nodeWidth) / (numCols - 1)));
  }
  // P2-2: even at the floor node width, this many columns may still not
  // fit the plot — walking `colX0(col)` past `plot.x1` and, at extreme
  // widths, clipping the last box mid-glyph. Fold the deepest columns
  // (clamp their depth onto the last one that fits) rather than draw
  // outside the rect; a link between two now-merged depths becomes a
  // same-column band and is silently skipped by the painter's own
  // `gapX1 < gapX0` guard — a real, reported degradation, not a crash.
  //
  // The fit check and `maxColsFit` below MUST use the layout's own true
  // floor gap (1 cell, `GLYPH_CHART_SANKEY_MIN_LAYOUT_GAP` — what the
  // defensive `while` loop right below already accepts), never
  // `GLYPH_CHART_SANKEY_MIN_GAP` (3, the PREFERRED spacing `gap <
  // MIN_GAP` above reflows node width to reclaim). Using the preferred
  // gap here folded columns the layout could actually place at gap 1-2 —
  // measured harmful, not merely imprecise (sankey round-3 review,
  // finding h): HEAD silenced MORE links than no fold at all in 1,344 of
  // 1,992 swept `(columns, width)` configurations and fewer in 0, e.g. a
  // 19-column chain at the chat default 72 wide dropped 7 links where the
  // layout could have placed all but 1. `foldedColumns` is therefore only
  // ever nonzero when the columns genuinely cannot fit even at gap 1 — the
  // while loop below becomes the defensive check its own comment always
  // claimed it was, not a second, silently-firing fold pass.
  const originalNumCols = numCols;
  let foldedColumns = 0;
  if (numCols > 1 && numCols * minNodeWidth + (numCols - 1) * minLayoutGap > plotWidth) {
    const maxColsFit = Math.max(1, Math.floor((plotWidth + minLayoutGap) / (minNodeWidth + minLayoutGap)));
    if (maxColsFit < numCols) {
      foldedColumns = numCols - maxColsFit;
      numCols = maxColsFit;
      nodeWidth = minNodeWidth;
      gap = numCols > 1 ? Math.max(minLayoutGap, Math.floor((plotWidth - numCols * nodeWidth) / (numCols - 1))) : 0;
    }
  }
  // A defensive final check (rounding at the boundary, never observed to
  // actually fire given the derivation above) — never walk a box past the
  // plot rect: shed one column at a time until the total genuinely fits.
  while (numCols > 1 && numCols * nodeWidth + (numCols - 1) * gap > plotWidth) {
    numCols -= 1;
    foldedColumns = originalNumCols - numCols;
    gap = numCols > 1 ? Math.max(minLayoutGap, Math.floor((plotWidth - numCols * nodeWidth) / (numCols - 1))) : 0;
  }
  const depthOf = (id: string): number => Math.min(nodeDepthById.get(id) ?? 0, numCols - 1);
  const colX0 = (col: number): number => plot.x0 + col * (nodeWidth + gap);
  const colX1 = (col: number): number => Math.min(plot.x1, colX0(col) + nodeWidth - 1);
  // N11: name every LINK the fold actually silences (its two endpoints now
  // clamp onto the same column, so the painter's own `gapX1 < gapX0` guard
  // draws nothing for it), not just how many columns were merged — computed
  // against the FINAL `depthOf`, after both fold passes above.
  if (foldedColumns > 0) {
    const droppedLinks = links.filter((l) => depthOf(l.source) === depthOf(l.target)).map((l) => `${l.source} → ${l.target}`);
    ledger.push(ledgerSankeyColumnsFolded({ folded: foldedColumns, total: originalNumCols, droppedLinks }));
  }

  // Row heights ∝ throughput (node.value) under ONE GLOBAL rows-per-unit
  // rate (P2-1) — sized to the TIGHTEST column (available capacity ÷ its
  // own total throughput) so every OTHER column has slack rather than any
  // column ever overflowing, and a value of 150 is therefore never drawn
  // thinner than a 130 elsewhere in the chart, whatever column each sits in.
  const nodePaddingRows = GLYPH_CHART_SANKEY_NODE_PADDING_ROWS * textScale;
  let rowsPerUnit = Infinity;
  for (let col = 0; col < numCols; col++) {
    const colNodes = nodeOrder.filter((id) => depthOf(id) === col);
    if (colNodes.length === 0) continue;
    const n = colNodes.length;
    const padGap = n > 1 ? sankeyAirGap(nodePaddingRows, n, plotHeight) : 0;
    const capacity = Math.max(0, plotHeight - padGap * (n - 1));
    const totalValue = colNodes.reduce((a, id) => a + (nodeValueById.get(id) ?? 0), 0);
    if (totalValue > 0 && capacity > 0) rowsPerUnit = Math.min(rowsPerUnit, capacity / totalValue);
  }
  if (!Number.isFinite(rowsPerUnit)) rowsPerUnit = 0;

  const placementInput: SankeyPlacementInput = { groups, nodeOrder, links, depthOf, nodeY0ById, nodeValueById, numCols, colX0, colX1, plot, plotHeight, rowsPerUnit, nodePaddingRows, seenNode, textScale };
  const placement = placeSankeyGraph(placementInput, ledger);
  const { nodes: nodeBoxes, bands } = placement;

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

interface SankeyPlacementInput {
  readonly groups: readonly ChartSeries[];
  readonly nodeOrder: readonly string[];
  readonly links: readonly { readonly source: string; readonly target: string; readonly value: number }[];
  readonly depthOf: (id: string) => number;
  readonly nodeY0ById: ReadonlyMap<string, number>;
  readonly nodeValueById: ReadonlyMap<string, number>;
  readonly numCols: number;
  readonly colX0: (col: number) => number;
  readonly colX1: (col: number) => number;
  readonly plot: GlyphChartPlotRect;
  readonly plotHeight: number;
  readonly rowsPerUnit: number;
  readonly nodePaddingRows: number;
  readonly seenNode: ReadonlySet<string>;
  readonly textScale: number;
}

interface SankeyPlacement {
  readonly nodes: ReadonlyMap<string, SankeyNodeBox>;
  readonly bands: SankeyBand[];
}

/** Node boxes column by column, then every band's source and target rows: `layoutSankeyGraph`'s placement half. */
function placeSankeyGraph(input: SankeyPlacementInput, ledger: GlyphChartLedgerEntry[]): SankeyPlacement {
  const { groups, nodeOrder, depthOf, nodeY0ById, nodeValueById, numCols, colX0, colX1, plot, plotHeight, rowsPerUnit, nodePaddingRows, seenNode, textScale } = input;
  const nodeBoxes = new Map<string, SankeyNodeBox>();
  const boxesByCol: SankeyNodeBox[][] = [];
  for (let col = 0; col < numCols; col++) {
    const colNodes = nodeOrder.filter((id) => depthOf(id) === col).sort((a, b) => (nodeY0ById.get(a) ?? 0) - (nodeY0ById.get(b) ?? 0));
    boxesByCol[col] = [];
    if (colNodes.length === 0) continue;
    const n = colNodes.length;
    // `sankeyAirGap` picks the largest padding `<= NODE_PADDING_ROWS` this
    // column's own height can afford (0 when even one row of air would
    // starve a node) — a PLANNED absence: a padding row is never part of
    // any node's own box, so nothing downstream can mistake it for a lost
    // cell (replacing a superseded painter-level attempt; see
    // `sankeyAirGap`'s doc).
    const padGap = n > 1 ? sankeyAirGap(nodePaddingRows, n, plotHeight) : 0;
    if (n > 1 && padGap === 0) ledger.push(ledgerSankeyAirDropped({ where: "node padding", id: `column ${col}`, requestedRows: nodePaddingRows }));
    const capacity = Math.max(0, plotHeight - padGap * (n - 1));
    const values = colNodes.map((id) => nodeValueById.get(id) ?? 0);
    const { heights, stillZero } = ensureMinimumHeights(distributeByRate(values, rowsPerUnit), values, capacity);
    if (stillZero.length > 0) ledger.push(ledgerSankeyNodesDropped({ nodes: stillZero.map((i) => colNodes[i]!) }));
    let cursor = plot.y0;
    colNodes.forEach((id, i) => {
      const h = heights[i]!;
      const y0 = cursor;
      const y1 = cursor + h - 1;
      const box = { id, x0: colX0(col), x1: colX1(col), y0, y1, height: h };
      nodeBoxes.set(id, box);
      boxesByCol[col]!.push(box);
      // No gap row after the LAST node — `capacity` only ever budgeted
      // `n - 1` of them, and a trailing one would let `cursor` walk one
      // row past what the column actually accounted for.
      cursor += h + (i < colNodes.length - 1 ? padGap : 0);
    });
  }

  // Outgoing bands per source, folding to a FIXED POINT (P1-2) — see
  // `foldSankeyOutLinks`'s own doc for why a single re-run isn't enough.
  // Stub rows are allocated in TARGET-COLUMN ORDER (sorted by the target
  // node's own box row, `nodeBoxes` having already settled every column) —
  // never the raw declaration order — so a band leaving low and a band
  // leaving high land on the physically low/high rows that already point
  // roughly at where their targets sit. This is what gives non-crossing
  // bands DISJOINT cell sets by construction: two bands whose targets don't
  // interleave never need to cross to reach them.
  const bands: SankeyBand[] = [];
  for (const g of groups) {
    const nodeId = g.name!;
    const box = nodeBoxes.get(nodeId);
    if (!box) continue;
    const outLinks = [...g.rows]
      .sort((a, b) => (nodeBoxes.get(String(a.label))?.y0 ?? 0) - (nodeBoxes.get(String(b.label))?.y0 ?? 0))
      .map((r) => ({ target: String(r.label), value: numeric(r.y) }));
    const { finalLinks, heights, foldedFlows, gap } = foldSankeyOutLinks(outLinks, box.height, seenNode, textScale);
    if (foldedFlows.length > 0) {
      const stubIdx = finalLinks.findIndex((l) => l.folded);
      const stubVisible = stubIdx === -1 || heights[stubIdx]! > 0;
      ledger.push(ledgerSankeyFoldedFlows({ source: nodeId, flows: foldedFlows.map((t) => `${nodeId} → ${t}`), stubVisible }));
    }
    if (finalLinks.length > 1 && gap === 0) ledger.push(ledgerSankeyAirDropped({ where: "link gap", id: nodeId, requestedRows: GLYPH_CHART_SANKEY_LINK_GAP_ROWS * textScale }));
    let cursor = box.y0;
    finalLinks.forEach((l, i) => {
      const h = heights[i]!;
      const range: readonly [number, number] = [cursor, cursor + h - 1];
      cursor += h + (i < finalLinks.length - 1 ? gap : 0);
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
  for (const [targetId, unsorted] of byTarget) {
    const box = nodeBoxes.get(targetId);
    if (!box) continue;
    // Mirror the outgoing side: stub rows in SOURCE-column order, so bands
    // entering low/high land near where their sources already are.
    const list = [...unsorted].sort((a, b) => (nodeBoxes.get(a.source)?.y0 ?? 0) - (nodeBoxes.get(b.source)?.y0 ?? 0));
    const gap = sankeyAirGap(GLYPH_CHART_SANKEY_LINK_GAP_ROWS * textScale, list.length, box.height);
    if (list.length > 1 && gap === 0) ledger.push(ledgerSankeyAirDropped({ where: "link gap", id: targetId, requestedRows: GLYPH_CHART_SANKEY_LINK_GAP_ROWS * textScale }));
    const capacity = Math.max(0, box.height - gap * (list.length - 1));
    const heights = distributeCumulative(list.map((b) => b.value), capacity);
    let cursor = box.y0;
    list.forEach((b, i) => {
      const h = heights[i]!;
      b.targetRowRange = [cursor, cursor + h - 1];
      cursor += h + (i < list.length - 1 ? gap : 0);
    });
  }
  return { nodes: nodeBoxes, bands };
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
export function paintFunnelMark(canvas: GlyphCanvas, plot: GlyphChartPlotRect, groups: readonly ChartSeries[], colorEnabled: boolean, ledger: GlyphChartLedgerEntry[], textScale = 1, fill: SankeyRegionFill = "texture", shades?: readonly string[]): void {
  const rawStages = groups.map((g) => ({ name: g.name ?? String(g.rows[0]?.index ?? 0), value: numeric(g.rows[0]?.y), styleIndex: g.styleIndex, color: g.color }));
  if (rawStages.length === 0) return;
  const plotWidth = plot.x1 - plot.x0 + 1;
  const plotHeight = plot.y1 - plot.y0 + 1;
  if (plotWidth <= 0 || plotHeight <= 0) return;

  // `funnel-bad-value`/`empty-total` split (P2-5): a negative value already
  // rejects at resolve time (`resolveFunnelRows`); an ALL-ZERO funnel is
  // legitimate data (nothing converted) and draws nothing at all, exactly
  // like `arc`'s own `empty-total` — never a fabricated bar or percentage.
  if (rawStages.every((s) => s.value === 0)) { ledger.push(ledgerEmptyTotal("funnel")); return; }

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
      // AGENTS.md's Charts section promises the fold keeps "the LARGEST
      // folded value" so the funnel's monotone shape stays plausible — a
      // non-monotone input (already flagged above with
      // `funnel-not-monotone`) can otherwise put the largest folded value
      // anywhere in the tail, not just at its first element.
      const foldedMax = folded.reduce((m, s) => Math.max(m, s.value), -Infinity);
      const representative = folded.find((s) => s.value === foldedMax) ?? folded[0]!;
      stages = [...kept, { name: `other (${folded.length} more)`, value: foldedMax, styleIndex: representative.styleIndex, color: representative.color }];
      ledger.push(ledgerFunnelFoldedStages({ stages: folded.map((s) => s.name) }));
    }
  }
  const n = stages.length;

  // One EQUAL row band per stage (never proportional — only the bar WIDTH
  // is ∝ value), with a `textScale`-row gap between stages when there's
  // room — scaled the same way the sankey's own link/node gaps are
  // (AGENTS.md's "Charts" "Density"), so the funnel's row proportions hold
  // steady as the web Density slider grows the grid.
  const stageGapRows = textScale;
  const hasGap = n > 1 && plotHeight >= n + (n - 1) * stageGapRows;
  const bandHeight = Math.max(1, Math.floor((plotHeight - (hasGap ? (n - 1) * stageGapRows : 0)) / n));
  const maxValue = Math.max(0, ...stages.map((s) => s.value));

  // P1-4: a nonpositive (or non-finite) reference stage used to make EVERY
  // percentage print as a fabricated "0%" — a stage worth 100 labelled
  // "0%". Omit the percent entirely when the denominator isn't usable
  // (label just the value) and report it once, not per stage.
  const referenceValue = rawStages[0]!.value;
  const hasValidReference = Number.isFinite(referenceValue) && referenceValue > 0;
  if (!hasValidReference) ledger.push(ledgerFunnelBadReference({ value: referenceValue }));

  const labelGutter = Math.max(4 * textScale, Math.min(14 * textScale, Math.floor(plotWidth * 0.22)));
  const innerX0 = plot.x0 + labelGutter;
  const innerX1 = plot.x1 - labelGutter;
  const innerWidth = Math.max(1, innerX1 - innerX0 + 1);
  const centerCol = Math.floor((innerX0 + innerX1) / 2);

  let cursor = plot.y0;
  for (const stage of stages) {
    const rowStart = cursor;
    const rowEnd = Math.min(plot.y1, rowStart + bandHeight - 1);
    cursor = rowEnd + 1 + (hasGap ? stageGapRows : 0);
    if (rowStart > plot.y1) break;
    const midRow = Math.floor((rowStart + rowEnd) / 2);

    const glyph = regionFillGlyph(canvas.tier, stage.styleIndex, n, fill, shades);
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
    // `textScale` shrinks the CHARACTER budget (never the gutter) so the
    // label's own SCALED footprint (`stageText.length * textScale`) still
    // fits inside it — byte-identical to before `textScale` existed at its
    // default `1`.
    const stageMax = Math.max(1, Math.floor((labelGutter - 1) / textScale));
    const { text: stageText } = abbreviateChartText(stage.name, stageMax, canvas.tier);
    const stageX = Math.max(plot.x0, plot.x0 + labelGutter - 1 - stageText.length * textScale);
    canvas.text(stageX, midRow, [stageText], { scale: textScale });

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
    const valueMax = Math.max(1, Math.floor((labelGutter - 1) / textScale));
    const candidates = formatFunnelValueCandidates(stage.value).map((v) => chartText(v, canvas.tier));
    let valueText = "";
    for (const v of candidates) {
      const withPct = chartText(`${v}${pctSuffix}`, canvas.tier);
      if (withPct.length <= valueMax) { valueText = withPct; break; }
    }
    if (!valueText) for (const v of candidates) if (v.length <= valueMax) { valueText = v; break; }
    if (valueText) canvas.text(Math.min(plot.x1, plot.x1 - labelGutter + 2), midRow, [valueText], { scale: textScale });
    else ledger.push(ledgerLabelDropped({ role: "funnel value label", text: candidates[0] ?? String(stage.value), reason: "it doesn't fit even after SI abbreviation" }));
  }
}
