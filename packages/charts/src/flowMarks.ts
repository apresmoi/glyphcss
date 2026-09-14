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
import { GLYPH_CANVAS_DIRECTION_BITS, GLYPH_CANVAS_TIERS, type GlyphCanvas, type GlyphCanvasPoint, type GlyphCanvasTierName } from "glyphcss";
import { accessorFor, identity, index, isNumericArray } from "./channels";
import { abbreviateChartText, chartText } from "./labels";
import {
  ledgerEmptyTotal, ledgerFunnelBadReference, ledgerFunnelFoldedStages, ledgerFunnelNotMonotone, ledgerFunnelThinStage,
  ledgerLabelDropped, ledgerSankeyAirDropped, ledgerSankeyBandBroken, ledgerSankeyColumnsFolded, ledgerSankeyCrossingsMerged, ledgerSankeyFoldedFlows, ledgerSankeyImbalance,
  ledgerSankeyBandUnroutable, ledgerSankeyNodesDropped,
  type GlyphChartLedgerEntry,
} from "./ledger";
import type { GlyphChartPlotRect } from "./layout";
import { regionFillGlyph, resolveSeriesColor, seriesShade, type ChartSeries } from "./series";

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
/** The sankey fold-stub's own max cell length (AGENTS.md's "Charts" — a
 * short stub reading "flow leaves, not itemized"), scaled the same way. */
const GLYPH_CHART_SANKEY_FOLD_STUB_MAX = 3;

/**
 * Visual AIR, reserved at the LAYOUT layer (AGENTS.md's "Charts" sankey
 * clause) — never in the painter, which has no way to tell a planned gap
 * from a genuinely lost cell (`docs/design/charts.md`'s "Sankey ribbon
 * rendering", the superseded painter-level attempt). `NODE_PADDING_ROWS`
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
  /** Cell columns between two adjacent node boxes — the paint routing needs it to size a fold stub. */
  readonly gap: number;
  /**
   * Whether a skip-level band may paint as a smooth ribbon on `braille`/
   * `blocks` (`sankeyPlanPaintsSmooth`). `layoutSankeyGraph` sets it false
   * when the smooth ribbons would lose more cells than the staircase routes.
   */
  readonly smoothSkip: boolean;
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
  // existed (`docs/design/charts.md`'s "Density" — geometry constants).
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

  // Two candidate placements: d3's own within-column order, and the same
  // order with every skip-level target re-placed where its band can actually
  // arrive (`sankeyCorridorAwareOrder`). Both are judged by the cells their
  // bands would really LOSE (`sankeyLostCells`: the routes and the painter's
  // own claim order, run without a canvas), on both tier families, since the
  // node order must not depend on the charset. The re-placed order is kept
  // only when it loses no more cells on either family and fewer on one. A
  // weighted crossing count stood in for this and was wrong in both
  // directions: over the seeded layered sweep it kept 10 of 48 re-placements
  // that lost more cells on box (docs/design/charts.md, Round 27). A graph
  // with no skip-level link never builds the second candidate and runs no
  // simulation, so its layout is byte-identical.
  //
  // The same count decides whether skip-level bands paint smooth on
  // `braille`/`blocks`: a smooth ribbon crosses other bands diagonally, over
  // a longer run than a staircase crosses them at a right angle, and is
  // kept only when it loses no more cells than the staircase would.
  const placementInput: SankeyPlacementInput = { groups, nodeOrder, links, depthOf, nodeY0ById, nodeValueById, numCols, colX0, colX1, plot, plotHeight, rowsPerUnit, nodePaddingRows, seenNode, textScale };
  const baseLedger: GlyphChartLedgerEntry[] = [];
  let placement = placeSankeyGraph(placementInput, false, baseLedger);
  let placementLedger = baseLedger;
  let smoothSkip = true;
  if (links.some((l) => depthOf(l.target) - depthOf(l.source) > 1)) {
    const ribbon = groups[0]?.mark.options?.ribbon ?? "filled";
    const lost = (p: SankeyPlacement, subcell: boolean, smooth: boolean): number =>
      sankeyLostCells({ nodes: [...p.nodes.values()], bands: p.bands, gap, smoothSkip: smooth }, plot, subcell, ribbon, textScale);
    const altLedger: GlyphChartLedgerEntry[] = [];
    const alt = placeSankeyGraph(placementInput, true, altLedger);
    const subcell = GLYPH_CANVAS_TIERS[tierName].subcell;
    let smoothLost = 0, stairLost = 0;
    if (alt.reordered) {
      const base = { box: lost(placement, false, true), smooth: lost(placement, true, true), stair: lost(placement, true, false) };
      const next = { box: lost(alt, false, true), smooth: lost(alt, true, true), stair: lost(alt, true, false) };
      const baseSub = Math.min(base.smooth, base.stair), nextSub = Math.min(next.smooth, next.stair);
      const keep = next.box <= base.box && nextSub <= baseSub && (next.box < base.box || nextSub < baseSub);
      if (keep) {
        placement = alt;
        placementLedger = altLedger;
      }
      ({ smooth: smoothLost, stair: stairLost } = keep ? next : base);
    } else if (subcell) {
      smoothLost = lost(placement, true, true);
      stairLost = lost(placement, true, false);
    }
    smoothSkip = smoothLost <= stairLost;
  }
  ledger.push(...placementLedger);
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

  return { nodes: [...nodeBoxes.values()], bands, gap, smoothSkip };
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
  readonly boxesByCol: readonly (readonly SankeyNodeBox[])[];
  readonly bands: SankeyBand[];
  /** Whether any column's order differs from d3's. */
  readonly reordered: boolean;
}

/**
 * Node boxes column by column, then every band's source and target rows:
 * `layoutSankeyGraph`'s placement half, run once per candidate order.
 * `reorder` re-places skip-level targets (`sankeyCorridorAwareOrder`).
 */
function placeSankeyGraph(input: SankeyPlacementInput, reorder: boolean, ledger: GlyphChartLedgerEntry[]): SankeyPlacement {
  const { groups, nodeOrder, links, depthOf, nodeY0ById, nodeValueById, numCols, colX0, colX1, plot, plotHeight, rowsPerUnit, nodePaddingRows, seenNode, textScale } = input;
  const nodeBoxes = new Map<string, SankeyNodeBox>();
  const boxesByCol: SankeyNodeBox[][] = [];
  let reordered = false;
  for (let col = 0; col < numCols; col++) {
    const d3Order = nodeOrder.filter((id) => depthOf(id) === col).sort((a, b) => (nodeY0ById.get(a) ?? 0) - (nodeY0ById.get(b) ?? 0));
    const colNodes = reorder ? sankeyCorridorAwareOrder(d3Order, col, links, depthOf, nodeBoxes, boxesByCol, plot, rowsPerUnit) : d3Order;
    if (colNodes !== d3Order) reordered = true;
    boxesByCol[col] = [];
    if (colNodes.length === 0) continue;
    const n = colNodes.length;
    // `sankeyAirGap` picks the largest padding `<= NODE_PADDING_ROWS` this
    // column's own height can afford (0 when even one row of air would
    // starve a node) — a PLANNED absence: a padding row is never part of
    // any node's own box, so nothing downstream can mistake it for a lost
    // cell (AGENTS.md's "Charts" sankey clause, replacing the superseded
    // painter-level attempt in `docs/design/charts.md`'s "Sankey ribbon
    // rendering").
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
  return { nodes: nodeBoxes, boxesByCol, bands, reordered };
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
/**
 * Every group of node boxes sharing an x0, so a route can be tested against
 * "every column between two others" without re-deriving column boundaries
 * from `depthOf` (paint time has no access to it — only the settled boxes).
 */
function sankeyColumnsByX0(nodeBoxes: ReadonlyMap<string, SankeyNodeBox>): { readonly sortedX0: readonly number[]; readonly boxesAtX0: ReadonlyMap<number, readonly SankeyNodeBox[]> } {
  const boxesAtX0 = new Map<number, SankeyNodeBox[]>();
  for (const box of nodeBoxes.values()) {
    const list = boxesAtX0.get(box.x0);
    if (list) list.push(box); else boxesAtX0.set(box.x0, [box]);
  }
  return { sortedX0: [...boxesAtX0.keys()].sort((a, b) => a - b), boxesAtX0 };
}

/** Every node box in a column strictly between `srcBox`'s and `tgtBox`'s own columns — empty for adjacent columns. */
function sankeyMidColumnBoxes(cols: ReturnType<typeof sankeyColumnsByX0>, srcBox: SankeyNodeBox, tgtBox: SankeyNodeBox): readonly SankeyNodeBox[] {
  const srcIdx = cols.sortedX0.indexOf(srcBox.x0);
  const tgtIdx = cols.sortedX0.indexOf(tgtBox.x0);
  const mids: SankeyNodeBox[] = [];
  for (let i = srcIdx + 1; i < tgtIdx; i++) mids.push(...(cols.boxesAtX0.get(cols.sortedX0[i]!) ?? []));
  return mids;
}

/**
 * Whether a band can be drawn as one straight horizontal run: its source and
 * target rows agree AND no intermediate box sits on those rows. The row test
 * alone let a skip-level band with matching ends run straight through every
 * node between them, silently — it never reached the router's node-box check,
 * because a straight band is given no intermediate boxes to check against
 * (found by codex round-2's un-skipped layered sweep, seed 27 at 96x32).
 */
function sankeyBandIsStraight(band: SankeyBand, mids: readonly SankeyNodeBox[]): boolean {
  const [sr0, sr1] = band.sourceRowRange;
  const [tr0, tr1] = band.targetRowRange!;
  return sr0 === tr0 && sr1 === tr1 && !mids.some((box) => box.y0 <= sr1 && box.y1 >= sr0);
}

/** `sankeyMidColumnBoxes`, kept grouped by column, left to right. */
function sankeyMidColumnGroups(cols: ReturnType<typeof sankeyColumnsByX0>, srcBox: SankeyNodeBox, tgtBox: SankeyNodeBox): readonly (readonly SankeyNodeBox[])[] {
  const srcIdx = cols.sortedX0.indexOf(srcBox.x0);
  const tgtIdx = cols.sortedX0.indexOf(tgtBox.x0);
  const groups: (readonly SankeyNodeBox[])[] = [];
  for (let i = srcIdx + 1; i < tgtIdx; i++) groups.push(cols.boxesAtX0.get(cols.sortedX0[i]!) ?? []);
  return groups;
}

/**
 * Whether a routed (non-stub) band is painted as a per-dot-column smooth
 * ribbon (`paintSankeyRibbonSmooth`) rather than through the lane/free-row
 * fallback (`paintSankeyRoutedRowsFallback`). Decided ONCE, in
 * `computeSankeyRoutedRows`, and carried to the painter on the routed row
 * itself (`SankeyRoutedRow.segments`): the two disagreeing is the root of
 * codex P1-5 — a band registered with the canvas's junction system but
 * painted smooth leaves `resolveJunctions()`'s box-drawing glyphs in a
 * footprint the smooth sweep never revisits (stray `┌──────`).
 *
 * Only `braille`/`blocks` have the sub-cell resolution a curve needs. A
 * SKIP-LEVEL band is smooth too (DIAGNOSIS-sankey-column-jump.md, Round 3):
 * an S-curve in each gap and a flat run through each intermediate column on
 * its pass-through rows (`sankeyPlanSegments`). The staircase it replaced was
 * the one band on those tiers drawn in right angles, and each of its `k`
 * rows rounded its own corners, so the inner rows' cut quadrants were holes
 * inside the ribbon. It needs every pass-through candidate to be a
 * contiguous window of `k` clear rows; the degraded non-contiguous candidate
 * (fewer clear rows than the band is tall) keeps the staircase.
 */
function sankeyPlanPaintsSmooth(subcell: boolean, skipLevel: boolean, k: number, candidates: readonly SankeyPassRows[] | null): boolean {
  if (!subcell) return false;
  if (!skipLevel) return true;
  const isWindow = (rows: readonly number[]): boolean => rows.length === k && rows.every((y, i) => i === 0 || y === rows[i - 1]! + 1);
  return candidates !== null && candidates.every((pass) => pass.every(isWindow));
}

/**
 * Every candidate set of `k` DISTINCT rows that each clear every node box in
 * `midColumns` — the rows a skip-level band's own `k` pass-through legs can
 * safely cross those columns at, one row per leg, without entering a box
 * that isn't its own endpoint (DIAGNOSIS-sankey-column-jump.md RC1: the
 * single-row predecessor handed every one of a band's `k` rows the SAME
 * row, which collapsed a 4-row band's pass-through to one cell thick for the
 * entire width of the gap it crossed). The candidates are every CONTIGUOUS
 * window of `k` clear rows — contiguous so the band still reads as one solid
 * ribbon rather than `k` disconnected threads — ordered by distance from
 * `preferredCenter` (the band's own row-range midpoint), ties topmost first.
 * With no contiguous window of that width the single candidate is the `k`
 * clear rows nearest that centre, in row order; with fewer than `k` clear
 * rows it reuses them cyclically (a residual, documented collapse — never a
 * throw). With NO clear row there is no candidate at all, and the result is
 * EMPTY: the caller decides what that means, since the answer differs
 * between "no row clears every intermediate column at once" (a route still
 * exists, one row per column) and "one column is filled top to bottom" (no
 * route exists). It used to return the plot's top row here, which by
 * construction lies inside one of `midColumns`' own boxes, so the router's
 * node-box assertion threw and the whole render failed (codex round-2).
 * `midColumns` empty never reaches this (an adjacent band's own free row is
 * just `tgtRow`).
 */
function sankeyFreeRowCandidates(midColumns: readonly SankeyNodeBox[], plot: GlyphChartPlotRect, k: number, preferredCenter: number): readonly (readonly number[])[] {
  const occupied = new Set<number>();
  for (const box of midColumns) for (let y = box.y0; y <= box.y1; y++) occupied.add(y);
  const clear: number[] = [];
  for (let y = plot.y0; y <= plot.y1; y++) if (!occupied.has(y)) clear.push(y);
  if (clear.length === 0) return [];
  if (clear.length < k) return [Array.from({ length: k }, (_, i) => clear[i % clear.length]!)];
  const windows: { readonly rows: readonly number[]; readonly dist: number }[] = [];
  for (let start = 0; start + k <= clear.length; start++) {
    let contiguous = true;
    for (let j = 1; j < k; j++) if (clear[start + j]! !== clear[start]! + j) { contiguous = false; break; }
    if (!contiguous) continue;
    windows.push({ rows: clear.slice(start, start + k), dist: Math.abs((clear[start]! + clear[start + k - 1]!) / 2 - preferredCenter) });
  }
  // `sort` is stable, so equal distances keep the topmost window first — the
  // same tie-break the distance-only chooser always had.
  if (windows.length > 0) return windows.sort((a, b) => a.dist - b.dist).map((w) => w.rows);
  return [[...clear].sort((a, b) => Math.abs(a - preferredCenter) - Math.abs(b - preferredCenter)).slice(0, k).sort((a, b) => a - b)];
}

/**
 * Where a skip-level band starting at row `start` can actually cross each
 * intermediate column (`mids`, left to right): the centre of the clear
 * `k`-row window nearest it, one window clear of every intermediate column
 * when there is one, else chained column by column exactly as the router's
 * own jog fallback does. `null` when some intermediate column is filled top
 * to bottom (the router then degrades the band to two stubs).
 */
function sankeyCorridorCentres(start: number, mids: readonly (readonly SankeyNodeBox[])[], plot: GlyphChartPlotRect, k: number): number[] | null {
  const mid = (rows: readonly number[]): number => (rows[0]! + rows[rows.length - 1]!) / 2;
  const shared = sankeyFreeRowCandidates(mids.flat(), plot, k, start)[0];
  if (shared) return mids.map(() => mid(shared));
  const centres: number[] = [];
  let centre = start;
  for (const group of mids) {
    const rows = sankeyFreeRowCandidates(group, plot, k, centre)[0];
    if (!rows) return null;
    centre = mid(rows);
    centres.push(centre);
  }
  return centres;
}

/**
 * The within-column ORDER of column `col`, given the settled boxes of every
 * column left of it (DIAGNOSIS-sankey-column-jump.md, Round 3).
 *
 * d3-sankey's relaxation (`order`, its `y0`) keys a skip-level link on its
 * SOURCE node's row, but this module never draws one through an
 * intermediate node's box: the band can only reach `col` through a corridor
 * of rows clear of every column it crosses. On the energy dataset that
 * corridor is below Electricity Generation, while d3 left `Industrial` at
 * the TOP of the last column, so `Natural Gas -> Industrial` had to climb
 * the whole plot height through every Electricity Generation ribbon.
 *
 * A node receiving a skip-level link is therefore re-placed by the
 * value-weighted barycentre of where its incoming links really arrive: an
 * adjacent link at its source box's centre row, a skip-level link at its
 * corridor's centre in the last column it crosses (`sankeyCorridorCentres`).
 * It goes after exactly the nodes of the column whose own barycentre (same
 * rule) is smaller, ties in d3's order. Every other node keeps d3's relative
 * order, and a column receiving no skip-level link is returned as the same
 * array. This is a candidate only: `layoutSankeyGraph` keeps it when the
 * whole layout crosses less.
 */
function sankeyCorridorAwareOrder(
  order: readonly string[],
  col: number,
  links: readonly { readonly source: string; readonly target: string; readonly value: number }[],
  depthOf: (id: string) => number,
  nodeBoxes: ReadonlyMap<string, SankeyNodeBox>,
  boxesByCol: readonly (readonly SankeyNodeBox[])[],
  plot: GlyphChartPlotRect,
  rowsPerUnit: number,
): readonly string[] {
  if (col === 0 || order.length < 2) return order;
  const keyOf = new Map<string, number>();
  const skipTargets: string[] = [];
  for (const id of order) {
    let sum = 0;
    let weight = 0;
    let skip = false;
    for (const l of links) {
      if (l.target !== id) continue;
      const srcCol = depthOf(l.source);
      const srcBox = nodeBoxes.get(l.source);
      if (!srcBox || srcCol >= col) continue;
      let arrival = (srcBox.y0 + srcBox.y1) / 2;
      if (srcCol < col - 1) {
        const k = Math.max(1, Math.round(l.value * rowsPerUnit));
        const corridor = sankeyCorridorCentres(arrival, boxesByCol.slice(srcCol + 1, col), plot, k);
        if (corridor === null) continue;
        arrival = corridor[corridor.length - 1]!;
        skip = true;
      }
      sum += l.value * arrival;
      weight += l.value;
    }
    if (weight > 0) keyOf.set(id, sum / weight);
    if (skip) skipTargets.push(id);
  }
  if (skipTargets.length === 0) return order;
  const indexOf = new Map(order.map((id, i) => [id, i]));
  const before = (a: string, b: string): boolean => {
    const ka = keyOf.get(a), kb = keyOf.get(b);
    if (ka !== undefined && kb !== undefined && ka !== kb) return ka < kb;
    return indexOf.get(a)! < indexOf.get(b)!;
  };
  const moving = new Set(skipTargets);
  const others = order.filter((id) => !moving.has(id));
  const placed = [...skipTargets].sort((a, b) => (before(a, b) ? -1 : 1));
  const rankOf = new Map(placed.map((t) => [t, others.filter((o) => before(o, t)).length]));
  const out: string[] = [];
  for (let i = 0; i <= others.length; i++) {
    for (const t of placed) if (rankOf.get(t) === i) out.push(t);
    if (i < others.length) out.push(others[i]!);
  }
  return out.every((id, i) => id === order[i]) ? order : out;
}

/**
 * The pass-through rows a skip-level band actually takes: among
 * `sankeyFreeRowCandidates`, the one whose route CROSSES the fewest cells
 * already occupied by some other band (`crossedCells`), distance from the
 * band's own centre only as the tie-break. Minimising distance alone was
 * measured to pick a window that runs straight along another ribbon when a
 * clear one sat a few rows further off (the energy dataset at braille 96x32,
 * DIAGNOSIS-sankey-column-jump.md's reported chart). No intermediate node
 * box term is needed: every candidate row already clears every such box by
 * construction, and the lane/final-lane legs sit in gaps.
 */
function pickSankeyFreeRowBand<T>(candidates: readonly T[], crossedCells: (candidate: T) => number): T {
  let best = candidates[0]!;
  if (candidates.length === 1) return best;
  let bestScore = crossedCells(best);
  for (let c = 1; c < candidates.length && bestScore > 0; c++) {
    const score = crossedCells(candidates[c]!);
    if (score < bestScore) { bestScore = score; best = candidates[c]!; }
  }
  return best;
}

function pushSankeyHorizontal(points: GlyphCanvasPoint[], y: number, fromX: number, toX: number): void {
  const step = toX > fromX ? 1 : -1;
  for (let x = fromX + step; step > 0 ? x <= toX : x >= toX; x += step) points.push({ x, y });
}
function pushSankeyVertical(points: GlyphCanvasPoint[], x: number, fromY: number, toY: number): void {
  const step = toY > fromY ? 1 : -1;
  for (let y = fromY + step; step > 0 ? y <= toY : y >= toY; y += step) points.push({ x, y });
}

/**
 * ONE row's own cell polyline: source-stub -> lane column -> final-lane
 * column -> target-stub (AGENTS.md's "Charts" contract). `lane` sits in the
 * FIRST gap (between the source's column and the next one, whether that
 * next column is the target's own or an intermediate one); `freeRow` is
 * where the vertical run lands before travelling straight across to
 * `finalLane`, a column in the LAST gap (between the intermediate column(s)
 * and the target's own, or the same gap as `lane` when there are none) that
 * then descends to `tgtRow` before a short final leg reaches the target's
 * own immediate border column (`tgtBox.x0 - 1`). For an adjacent-column
 * band `freeRow === tgtRow` and `finalLane === lane`, so the two middle legs
 * are zero-length and this degenerates to the classic
 * horizontal/vertical/horizontal path; for a skip-level band the long
 * horizontal at `freeRow` is what crosses the intermediate column(s)
 * without entering any of their boxes, and `finalLane` — distinct PER ROW
 * of a multi-row band, from `assignSankeyFinalLanes` — is what keeps the
 * band's own final descent from collapsing every row onto the single column
 * `tgtBox.x0 - 1` (DIAGNOSIS-sankey-column-jump.md RC1's aggravator: that
 * column is exactly the one `paintSankeyRibbonSmooth` forces to a full
 * border block for every OTHER band sharing the same target). Every
 * consecutive pair is 4-adjacent, satisfying `canvas.route()`'s own
 * contract directly — no diagonal step is ever produced.
 *
 * `passRows` is normally ONE row. When no single row clears every
 * intermediate column at once, it holds one row PER intermediate column, and
 * `jogs[c]` is the column in the gap between intermediate columns `c` and
 * `c + 1` where the route steps from `passRows[c]` to `passRows[c + 1]`.
 */
function buildSankeyBandRowRoute(srcBox: SankeyNodeBox, tgtBox: SankeyNodeBox, srcRow: number, tgtRow: number, lane: number, passRows: readonly number[], jogs: readonly number[], finalLane: number): readonly GlyphCanvasPoint[] {
  const startX = srcBox.x1 + 1;
  const endX = tgtBox.x0 - 1;
  const points: GlyphCanvasPoint[] = [{ x: startX, y: srcRow }];
  pushSankeyHorizontal(points, srcRow, startX, lane);
  pushSankeyVertical(points, lane, srcRow, passRows[0]!);
  let x = lane;
  for (let c = 0; c + 1 < passRows.length; c++) {
    pushSankeyHorizontal(points, passRows[c]!, x, jogs[c]!);
    pushSankeyVertical(points, jogs[c]!, passRows[c]!, passRows[c + 1]!);
    x = jogs[c]!;
  }
  const lastPass = passRows[passRows.length - 1]!;
  pushSankeyHorizontal(points, lastPass, x, finalLane);
  pushSankeyVertical(points, finalLane, lastPass, tgtRow);
  pushSankeyHorizontal(points, tgtRow, finalLane, endX);
  return points;
}

/**
 * A RIBBON'S start column for every BENT band (source and target rows
 * disagree — a straight band needs no vertical run at all and is excluded)
 * sharing a first gap: each band reserves `k = max(sourceHeight,
 * targetHeight)` CONSECUTIVE columns, one per row, rather than one shared
 * column for the whole band — the first cut of this shared exactly one
 * vertical column across every row of a multi-row band, and a band's own
 * k rows overlap EACH OTHER there just as often as two different bands'
 * lanes used to (measured: the A/B->X/Y fan alone logged 190+ same-band
 * `"parallel"`/`"multi"` route conflicts, because row i's vertical run
 * [srcRow_i, freeRow_i] and row i+1's [srcRow_i+1, freeRow_i+1] genuinely
 * share cells on one column). Giving each row its OWN column removes that
 * self-overlap entirely — a band's k rows now sit side by side, reading as
 * a genuine diagonal ribbon instead of a single pinched thread.
 *
 * Ribbon PLACEMENT is INTERVAL-GRAPH COLOURING generalised to a WIDTH per
 * item (a "meeting rooms" packing): sort bands by their own vertical extent
 * `[min(sr0,tr0), max(sr1,tr1)]`, assign the lowest SLOT whose occupant's
 * extent has already ended, and size each slot to the widest ribbon ever
 * placed in it. Two bands share a slot only when their extents never
 * overlap (so their same-width-or-not ribbons can never actually touch);
 * two OVERLAPPING bands always land in different slots, at different
 * columns — what keeps `resolveJunctions()`'s `routeConflicts` empty for
 * the routine case. A gap too narrow for the full packed width degrades by
 * wrapping ribbon starts modulo the available width (a graceful compression
 * that CAN reintroduce overlap — reported once as `sankey-crossings-merged`
 * naming the packed width against what actually fit, same code as round 2).
 */
interface SankeyLaneItem { readonly band: SankeyBand; readonly kind: "lane" | "finalLane" | "jog"; readonly jog?: number; readonly start: number; readonly end: number; readonly width: number; readonly gapX0: number; readonly gapX1: number }

/**
 * The packing core: INTERVAL-GRAPH COLOURING generalised to a WIDTH per item
 * (a "meeting rooms" packing) — sort items sharing one physical gap by their
 * own vertical extent `[min(sr0,tr0), max(sr1,tr1)]`, assign the lowest SLOT
 * whose occupant's extent has already ended, and size each slot to the
 * widest ribbon ever placed in it. Two items share a slot only when their
 * extents never overlap (so their same-width-or-not ribbons can never
 * actually touch); two OVERLAPPING items always land in different slots, at
 * different columns. A gap too narrow for the full packed width degrades by
 * wrapping ribbon starts modulo the available width (a graceful compression
 * that CAN reintroduce overlap — reported once as `sankey-crossings-merged`
 * naming the packed width against what actually fit). Returns a column PER
 * ITEM (not per band): `assignSankeyGapLanes` calls this once over BOTH a
 * band's own first-gap "lane" demand and a skip-level band's last-gap
 * "finalLane" demand pooled together, so one band can legitimately own two
 * entries here (one per kind), each in its own physical gap.
 */
function packSankeyLaneItems(items: readonly SankeyLaneItem[], ledger: GlyphChartLedgerEntry[]): Map<SankeyLaneItem, number> {
  const groups = new Map<string, SankeyLaneItem[]>();
  for (const item of items) {
    const key = `${item.gapX0}:${item.gapX1}`;
    const list = groups.get(key);
    if (list) list.push(item); else groups.set(key, [item]);
  }
  const columnByItem = new Map<SankeyLaneItem, number>();
  for (const group of groups.values()) {
    const { gapX0, gapX1 } = group[0]!;
    const gapWidth = Math.max(1, gapX1 - gapX0 + 1);
    const sorted = [...group].sort((a, b) => a.start - b.start || a.end - b.end);
    const slotEnd = new Map<number, number>(); // slot index -> its current occupant's end row.
    const slotWidth = new Map<number, number>(); // slot index -> widest ribbon ever placed there.
    const slotOf = new Map<SankeyLaneItem, number>();
    let slotCount = 0;
    for (const item of sorted) {
      let slot = 0;
      while ((slotEnd.get(slot) ?? -Infinity) >= item.start) slot++;
      slotEnd.set(slot, item.end);
      slotWidth.set(slot, Math.max(slotWidth.get(slot) ?? 0, item.width));
      slotOf.set(item, slot);
      slotCount = Math.max(slotCount, slot + 1);
    }
    const slotStart: number[] = [];
    let packedWidth = 0;
    for (let s = 0; s < slotCount; s++) { slotStart.push(packedWidth); packedWidth += slotWidth.get(s) ?? 1; }
    if (packedWidth > gapWidth) ledger.push(ledgerSankeyCrossingsMerged({ gapX0, gapX1, crossing: packedWidth, lanes: gapWidth, bands: group.length }));
    for (const item of sorted) {
      const start = slotStart[slotOf.get(item)!]!;
      const column = packedWidth > gapWidth ? gapX0 + (start % gapWidth) : gapX0 + start;
      columnByItem.set(item, column);
    }
  }
  return columnByItem;
}

/**
 * A ribbon's start column for every BENT band (source and target rows
 * disagree — a straight band needs no vertical run at all and is excluded),
 * for BOTH legs that ever need one: the FIRST gap after a band's source
 * (`kind: "lane"`, every bent band) and, for a SKIP-LEVEL band only (one or
 * more intermediate node columns between its source and target), its own
 * LAST gap immediately before its target (`kind: "finalLane"`). An adjacent
 * bent band has exactly one gap and needs only the first kind; its caller
 * reuses that same value verbatim as `finalLane` too (see
 * `computeSankeyRoutedRows`).
 *
 * Both kinds are packed in ONE SHARED PASS (`packSankeyLaneItems`), pooling
 * every item that lands in the same PHYSICAL gap regardless of which band or
 * which kind of demand put it there — this is the fix for
 * DIAGNOSIS-sankey-column-jump.md's self-overlap regression test: a 3-column
 * graph's LAST gap before the final node is the exact same physical gap as
 * an adjacent second-column band's own (only) gap into that node, so a
 * skip-level band's final-lane demand and an adjacent band's lane demand
 * genuinely compete for the SAME columns — packing them in two independent,
 * mutually blind passes (the original cut of this fix) let a skip-level
 * band's wide final-lane reservation walk straight through an adjacent
 * band's own lane column with neither packer ever seeing the other's claim.
 * Pooling them here is what lets the shared interval-colouring separate two
 * genuinely overlapping demands into different slots, or gracefully degrade
 * together (one `sankey-crossings-merged` per gap) when the gap truly can't
 * fit both.
 *
 * Each item reserves the vertical extent its leg ACTUALLY descends through,
 * not the band's endpoint rows: an adjacent band's one vertical run spans
 * `[min(sr0,tr0), max(sr1,tr1)]`, but a skip-level band's first-gap run goes
 * from its source rows to its own pass-through rows (`passRowsByBand`) and
 * its final-gap run from those pass-through rows to its target rows. The
 * endpoint-only extent let two skip-level bands whose source and target rows
 * never overlap share final-lane columns while their real descents (both
 * starting from pass-through rows below every intermediate box) overlapped
 * along 29 vertical edges — codex round-1 P1, `N1->N5`/`N2->N5` at 240x32.
 */
function assignSankeyGapLanes(bands: readonly SankeyBand[], nodeBoxes: ReadonlyMap<string, SankeyNodeBox>, cols: ReturnType<typeof sankeyColumnsByX0>, passRowsByBand: ReadonlyMap<SankeyBand, SankeyPassRows>, unroutable: ReadonlySet<SankeyBand>, ledger: GlyphChartLedgerEntry[]): SankeyGapLanes {
  const items: SankeyLaneItem[] = [];
  for (const band of bands) {
    if (band.folded || !band.targetRowRange || unroutable.has(band)) continue;
    const srcBox = nodeBoxes.get(band.source);
    const tgtBox = nodeBoxes.get(band.target);
    if (!srcBox || !tgtBox) continue;
    const [sr0, sr1] = band.sourceRowRange;
    const [tr0, tr1] = band.targetRowRange;
    const mids = sankeyMidColumnBoxes(cols, srcBox, tgtBox);
    if (sankeyBandIsStraight(band, mids)) continue; // straight through — no lane needed.
    const width = Math.max(1, sr1 - sr0 + 1, tr1 - tr0 + 1); // this band's own k.
    const pass = mids.length > 0 ? passRowsByBand.get(band) : undefined;
    const firstPass = pass?.[0];
    const lastPass = pass?.[pass.length - 1];
    const nextColX0 = mids.length > 0 ? mids[0]!.x0 : tgtBox.x0;
    const firstGapX0 = srcBox.x1 + 1;
    const firstGapX1 = nextColX0 - 1;
    if (firstGapX1 >= firstGapX0) {
      const start = firstPass ? Math.min(sr0, ...firstPass) : Math.min(sr0, tr0);
      const end = firstPass ? Math.max(sr1, ...firstPass) : Math.max(sr1, tr1);
      items.push({ band, kind: "lane", start, end, width, gapX0: firstGapX0, gapX1: firstGapX1 });
    }
    if (mids.length > 0) {
      const lastMid = mids[mids.length - 1]!;
      const finalGapX0 = lastMid.x1 + 1;
      const finalGapX1 = tgtBox.x0 - 1;
      const start = lastPass ? Math.min(tr0, ...lastPass) : Math.min(sr0, tr0);
      const end = lastPass ? Math.max(tr1, ...lastPass) : Math.max(sr1, tr1);
      if (finalGapX1 >= finalGapX0) items.push({ band, kind: "finalLane", start, end, width, gapX0: finalGapX0, gapX1: finalGapX1 });
    }
    // A jog between two intermediate columns exists only where the band's
    // pass rows actually change column to column (one shared row array for
    // every column is the ordinary, jog-free case).
    if (pass) {
      const groups = sankeyMidColumnGroups(cols, srcBox, tgtBox);
      for (let c = 0; c + 1 < pass.length; c++) {
        if (pass[c] === pass[c + 1]) continue;
        const gapX0 = Math.max(...groups[c]!.map((b) => b.x1)) + 1;
        const gapX1 = Math.min(...groups[c + 1]!.map((b) => b.x0)) - 1;
        if (gapX1 < gapX0) continue;
        items.push({ band, kind: "jog", jog: c, start: Math.min(...pass[c]!, ...pass[c + 1]!), end: Math.max(...pass[c]!, ...pass[c + 1]!), width, gapX0, gapX1 });
      }
    }
  }
  const columnByItem = packSankeyLaneItems(items, ledger);
  const laneStartByBand = new Map<SankeyBand, number>();
  const finalLaneStartByBand = new Map<SankeyBand, number>();
  const jogStartsByBand = new Map<SankeyBand, number[]>();
  for (const item of items) {
    const column = columnByItem.get(item);
    if (column === undefined) continue;
    if (item.kind === "jog") {
      const jogs = jogStartsByBand.get(item.band) ?? [];
      jogs[item.jog!] = column;
      jogStartsByBand.set(item.band, jogs);
    } else (item.kind === "lane" ? laneStartByBand : finalLaneStartByBand).set(item.band, column);
  }
  return { laneStartByBand, finalLaneStartByBand, jogStartsByBand };
}

/** A skip-level band's pass-through rows, one `k`-row array PER intermediate column. */
type SankeyPassRows = readonly (readonly number[])[];

interface SankeyGapLanes {
  readonly laneStartByBand: ReadonlyMap<SankeyBand, number>;
  readonly finalLaneStartByBand: ReadonlyMap<SankeyBand, number>;
  readonly jogStartsByBand: ReadonlyMap<SankeyBand, readonly number[]>;
}

/** What routing needs from a canvas: its size, its tier, and edge registration for `resolveJunctions()`. */
export type SankeyRouteCanvas = Pick<GlyphCanvas, "cols" | "rows" | "tier" | "edge" | "route">;

/**
 * One routed row of a band. `segments` is present exactly when the band is
 * painted smooth (`sankeyPlanPaintsSmooth`); `cells` is then its lane route,
 * used only for its glyph/colour and never registered or painted.
 */
export interface SankeyRoutedRow { readonly band: SankeyBand; readonly cells: readonly GlyphCanvasPoint[]; readonly glyph: string; readonly color: string | null; readonly segments?: readonly SankeyRibbonSegment[] }

/**
 * One smoothstep piece of a smooth ribbon, between cell columns `x0` and
 * `x1` inclusive: `from` rows at `x0`, `to` rows at `x1`, both exact. A
 * `border` end is the band's own node border, painted in the global border
 * phase and fully inked under every texture.
 */
interface SankeyRibbonSegment {
  readonly x0: number;
  readonly x1: number;
  readonly from: readonly [number, number];
  readonly to: readonly [number, number];
  readonly borderX0: boolean;
  readonly borderX1: boolean;
}

/**
 * Paints a `GlyphChartSankeyLayout` through the cell canvas's own edge/route
 * routing contract (AGENTS.md's "Charts" and "Cell canvas" sections) instead
 * of hand-painted rectangles. A band of k rows is k PARALLEL routes, one per
 * row (`k = max(sourceHeight, targetHeight)`, the shorter end's own last row
 * absorbing the extra ones when the two ends disagree — a taper, which
 * cumulative rounding makes the common case, not an edge case: measured
 * across the flagship datasets, most bands' two ends differ by exactly one
 * row). Every row is registered as its own edge (`canvas.edge`/`route`) with
 * the band's real source/target node ids, so `resolveJunctions()` can tell a
 * genuine crossing between two DIFFERENT bands from two rows of the SAME
 * band converging on a shared stub. The junction pass itself is used only
 * for its `report.routeConflicts` diagnostic (a non-empty one names a real
 * layout bug — two overlapping same-axis routes sharing a lane, which the
 * interval-coloured lane assignment above is what rules out); the actual
 * fill is repainted afterward in REGISTRATION ORDER — the same tie-break
 * `resolveGlyphCanvasJunctions` itself uses (no explicit priority is set),
 * so a cell already claimed by an earlier-registered band is left alone and
 * a later one draws nothing there, exactly mirroring "the winner keeps its
 * own glyph; every other group draws nothing" — except the "glyph" here is
 * the band's own shade colour, not the resolver's box-drawing junction
 * glyph, which would turn a filled ribbon into a thin wire.
 */
/**
 * The routing half of `paintSankeyLayout`, split out so a test can inspect
 * exactly what each band's own row-lines are — including their SHARED lane
 * placements — without re-deriving them (re-running lane assignment on a
 * single isolated band gives it slot 0 every time, a DIFFERENT placement
 * than it gets inside the real layout; comparing against that would not be
 * comparing the same route at all). Registers every row on `canvas` (edge +
 * route) as a side effect, exactly as `paintSankeyLayout` needs before
 * calling `resolveJunctions()`; the caller decides how to paint from the
 * returned list.
 *
 * `edgeIdPrefix` (default `""`, byte-identical for a single sankey mark)
 * namespaces the edge ids this call registers on `canvas` — the canvas's
 * own edge/route store is keyed by plain id STRING and is SHARED across
 * every `canvas.edge()`/`route()` caller in one render (`junctions.ts`'s own
 * doc: "a second `route()` call for the same edge id REPLACES its route
 * entirely"), so two sankey marks both starting their own `order` at `0`
 * silently clobbered each other's routes rather than merely overlapping
 * visually (fable review, batch 3, finding c). `paintGlyphChart` passes
 * each sankey mark's own index.
 */
export function computeSankeyRoutedRows(canvas: SankeyRouteCanvas, plot: GlyphChartPlotRect, layout: GlyphChartSankeyLayout, colorEnabled: boolean, ledger: GlyphChartLedgerEntry[], edgeIdPrefix = "", textScale = 1): readonly SankeyRoutedRow[] {
  const nodeBoxes = new Map(layout.nodes.map((n) => [n.id, n]));
  const { bands, gap } = layout;
  const cols = sankeyColumnsByX0(nodeBoxes);
  const tierTable = GLYPH_CANVAS_TIERS[canvas.tier];

  // Every routable band's own geometry, in registration order — computed
  // once, ahead of lane packing, because a skip-level band's pass-through
  // rows now feed BOTH the packing (the real vertical extent of its legs)
  // and the crossing score that picks those rows.
  const plans: SankeyRoutePlan[] = [];
  const stubsByBand = new Map<SankeyBand, readonly SankeyStub[]>();
  const unroutable = new Set<SankeyBand>();
  for (const band of bands) {
    const srcBox = nodeBoxes.get(band.source);
    if (!srcBox) continue;
    const [sr0, sr1] = band.sourceRowRange;
    if (sr0 > sr1) continue;
    if (band.folded) {
      // No real target: a short stub reads as "flow leaves, not itemized".
      // Still routed (a synthetic `(fold)` node id per source, unique from
      // any real node) so it takes part in the same no-overwrite contract.
      const stubLen = Math.max(1, Math.min(GLYPH_CHART_SANKEY_FOLD_STUB_MAX * textScale, gap - 1));
      const x0 = srcBox.x1 + 1;
      stubsByBand.set(band, [sankeyStub(band.source, `${band.source}::(fold)`, sr0, sr1, x0, Math.min(plot.x1, x0 + stubLen - 1))]);
      continue;
    }
    const tgtBox = nodeBoxes.get(band.target);
    if (!tgtBox || !band.targetRowRange) continue;
    const [tr0, tr1] = band.targetRowRange;
    if (tr0 > tr1) continue;
    if (tgtBox.x0 - 1 < srcBox.x1 + 1) continue; // same/earlier column after a fold-column clamp — nothing to route.
    const allMids = sankeyMidColumnBoxes(cols, srcBox, tgtBox);
    const straight = sankeyBandIsStraight(band, allMids);
    const mids = straight ? [] : allMids;
    const midGroups = straight ? [] : sankeyMidColumnGroups(cols, srcBox, tgtBox);
    const k = Math.max(sr1 - sr0 + 1, tr1 - tr0 + 1);
    const skipLevel = !straight && mids.length > 0;
    let candidates: readonly SankeyPassRows[] | null = null;
    if (skipLevel) {
      const preferredCenter = (Math.min(sr0, tr0) + Math.max(sr1, tr1)) / 2;
      // One row clear of EVERY intermediate column is preferred — the band
      // then crosses them all as one straight ribbon, and every column shares
      // the SAME row array (no jog).
      candidates = sankeyFreeRowCandidates(mids, plot, k, preferredCenter).map((rows) => midGroups.map(() => rows));
      if (candidates.length === 0) {
        // No such row, so the band's pass rows change column to column,
        // jogging in the gaps between intermediate columns; each column's rows
        // are the clear ones nearest where the previous column's landed. Only
        // a column filled top to bottom leaves no route at all.
        const perColumn: (readonly number[])[] = [];
        let blocking: readonly SankeyNodeBox[] | null = null;
        let center = preferredCenter;
        for (const group of midGroups) {
          const rows = sankeyFreeRowCandidates(group, plot, k, center)[0];
          if (!rows) { blocking = group; break; }
          perColumn.push(rows);
          center = (Math.min(...rows) + Math.max(...rows)) / 2;
        }
        if (blocking) {
          // Degrade VISIBLY rather than lie: a route through a blocking box
          // would read as flow passing through that node, and dropping the
          // band would leave both nodes' rows for it unexplained. Two stubs
          // keep the flow visible at both of its own nodes, the same "flow
          // leaves, not itemized" shape a folded band already uses.
          unroutable.add(band);
          ledger.push(ledgerSankeyBandUnroutable({ source: band.source, target: band.target, blockingNodes: blocking.map((b) => b.id) }));
          const node = `${band.source}->${band.target}::(unroutable)`;
          const firstGapX0 = srcBox.x1 + 1;
          const firstLen = Math.max(1, Math.min(GLYPH_CHART_SANKEY_FOLD_STUB_MAX * textScale, mids[0]!.x0 - firstGapX0 - 1));
          const finalGapX0 = mids[mids.length - 1]!.x1 + 1;
          const endX = tgtBox.x0 - 1;
          const finalLen = Math.max(1, Math.min(GLYPH_CHART_SANKEY_FOLD_STUB_MAX * textScale, endX - finalGapX0));
          stubsByBand.set(band, [
            sankeyStub(band.source, node, sr0, sr1, firstGapX0, firstGapX0 + firstLen - 1),
            sankeyStub(node, band.target, tr0, tr1, endX - finalLen + 1, endX),
          ]);
          continue;
        }
        candidates = [perColumn];
      }
    }
    plans.push({
      band, srcBox, tgtBox, straight, mids, midGroups, k, skipLevel,
      smooth: (!skipLevel || layout.smoothSkip) && sankeyPlanPaintsSmooth(tierTable.subcell, skipLevel, k, candidates),
      candidates,
    });
  }

  const passRowsByBand = new Map<SankeyBand, SankeyPassRows>();
  for (const plan of plans) if (plan.candidates) passRowsByBand.set(plan.band, plan.candidates[0]!);

  // Crossing-aware pass-through choice (codex round-1 improvement): score
  // every candidate window against the footprints every OTHER band already
  // claims — lanes from a provisional packing with the distance-best rows,
  // since the real packing depends on the rows being chosen — then re-pack
  // with the chosen rows below. Greedy, in registration order; a band's own
  // footprint is lifted out of the occupancy before its candidates are
  // scored and put back with the winner. Only runs when some skip-level
  // band actually has a choice, so every chart without one packs once, as
  // before.
  if (plans.some((p) => p.candidates && p.candidates.length > 1)) {
    const provisional = assignSankeyGapLanes(bands, nodeBoxes, cols, passRowsByBand, unroutable, []);
    const occupancy = new Map<number, number>();
    const addCells = (cells: ReadonlySet<number>, delta: number): void => {
      for (const idx of cells) occupancy.set(idx, (occupancy.get(idx) ?? 0) + delta);
    };
    for (const stubs of stubsByBand.values()) {
      const cells = new Set<number>();
      for (const stub of stubs) for (const row of stub.rows) for (const p of row) cells.add(p.y * canvas.cols + p.x);
      addCells(cells, 1);
    }
    const footprintOf = (plan: SankeyRoutePlan, pass: SankeyPassRows | undefined): ReadonlySet<number> =>
      sankeyPlanFootprint(plan, provisional, pass, canvas.cols, canvas.rows);
    const current = new Map<SankeyRoutePlan, ReadonlySet<number>>();
    for (const plan of plans) {
      const cells = footprintOf(plan, passRowsByBand.get(plan.band));
      current.set(plan, cells);
      addCells(cells, 1);
    }
    for (const plan of plans) {
      if (!plan.candidates || plan.candidates.length < 2) continue;
      addCells(current.get(plan)!, -1);
      const scored = new Map<SankeyPassRows, ReadonlySet<number>>();
      const chosen = pickSankeyFreeRowBand(plan.candidates, (pass) => {
        const cells = footprintOf(plan, pass);
        scored.set(pass, cells);
        let crossed = 0;
        for (const idx of cells) if ((occupancy.get(idx) ?? 0) > 0) crossed++;
        return crossed;
      });
      passRowsByBand.set(plan.band, chosen);
      addCells(scored.get(chosen)!, 1);
    }
  }
  const lanes = assignSankeyGapLanes(bands, nodeBoxes, cols, passRowsByBand, unroutable, ledger);

  // A sankey's shade identity is per SOURCE node (AGENTS.md's "Charts" —
  // "a sankey groups by SOURCE node") — `band.styleIndex` is the cross-mark
  // `chartSeries` index, so the count of distinct values here is this
  // mark's own source count, matching `seriesShade`'s own ASCII
  // compact-vs-extended threshold.
  const sourceCount = new Set(bands.map((b) => b.styleIndex)).size;
  const planByBand = new Map(plans.map((p) => [p.band, p]));
  const routedRows: SankeyRoutedRow[] = [];
  let order = 0;
  for (const band of bands) {
    const glyph = seriesShade(canvas.tier, band.styleIndex, sourceCount);
    const color = resolveSeriesColor(band, colorEnabled);
    const stubs = stubsByBand.get(band);
    if (stubs) {
      for (const stub of stubs) {
        for (const cells of stub.rows) {
          const edgeId = `${edgeIdPrefix}${order}`;
          canvas.edge(edgeId, { from: stub.from, to: stub.to });
          canvas.route(edgeId, cells);
          routedRows.push({ band, cells, glyph, color });
          order++;
        }
      }
      continue;
    }
    const plan = planByBand.get(band);
    if (!plan) continue;
    const pass = passRowsByBand.get(band);
    // `paintSankeyRoutedRows` paints a `plan.smooth` band through
    // `paintSankeyRibbonSmooth` instead of these rows' own lane/free-row
    // cells — and for such a band the rows are never registered with the
    // canvas's junction system below (codex P1-5 / fable P1-1): registering
    // them anyway let `canvas.resolveJunctions()` paint box-drawing glyphs
    // into a footprint the smooth painter's own per-dot-column sweep then
    // never revisits, leaving stray residue (`┌──────`) outside the painted
    // ribbon. The rows are still computed and pushed to `routedRows` — the
    // caller reads `rows[0]!.glyph`/`.color` off them to hand the smooth
    // painter its own shade — only the canvas registration is skipped.
    const segments = plan.smooth ? sankeyPlanSegments(plan, pass) : undefined;
    for (let i = 0; i < plan.k; i++) {
      const cells = sankeyPlanRowCells(plan, i, lanes, pass);
      // Nothing may route through a node box that isn't its own endpoint:
      // the lane, jog and pre-target columns always sit in a GAP (never a
      // node column, by construction), and every pass row is clear in the
      // column it crosses (`sankeyFreeRowCandidates` returns no row inside a
      // box, and a band with no clear row in some column was turned into
      // stubs above) — so this is an invariant check, never an expected path.
      for (const p of cells) {
        for (const box of plan.mids) {
          if (p.x >= box.x0 && p.x <= box.x1 && p.y >= box.y0 && p.y <= box.y1) {
            throw new Error(`glyphcss: sankey band "${band.source} -> ${band.target}" routed through node "${box.id}"'s own box at (${p.x}, ${p.y}) — no free row cleared it.`);
          }
        }
      }
      if (!plan.smooth) {
        const edgeId = `${edgeIdPrefix}${order}`;
        canvas.edge(edgeId, { from: band.source, to: band.target });
        canvas.route(edgeId, cells);
      }
      routedRows.push({ band, cells, glyph, color, ...(segments ? { segments } : {}) });
      order++;
    }
  }
  return routedRows;
}

interface SankeyRoutePlan {
  readonly band: SankeyBand;
  readonly srcBox: SankeyNodeBox;
  readonly tgtBox: SankeyNodeBox;
  readonly straight: boolean;
  readonly mids: readonly SankeyNodeBox[];
  readonly midGroups: readonly (readonly SankeyNodeBox[])[];
  readonly k: number;
  readonly skipLevel: boolean;
  readonly smooth: boolean;
  readonly candidates: readonly SankeyPassRows[] | null;
}

/** A straight stub route, one row of cells per band row, between two graph node ids (one synthetic). */
interface SankeyStub { readonly from: string; readonly to: string; readonly rows: readonly (readonly GlyphCanvasPoint[])[] }

function sankeyStub(from: string, to: string, y0: number, y1: number, x0: number, x1: number): SankeyStub {
  const rows: GlyphCanvasPoint[][] = [];
  for (let y = y0; y <= y1; y++) {
    const cells: GlyphCanvasPoint[] = [];
    for (let x = x0; x <= x1; x++) cells.push({ x, y });
    rows.push(cells);
  }
  return { from, to, rows };
}

/**
 * Row `i`'s own cell polyline for a routed (non-folded) band. A skip-level
 * band (one or more intermediate columns) gets its OWN final-gap lane, `k`
 * DISTINCT pass-through rows and a dedicated final column per row; an
 * adjacent bent band reuses `lane` itself as `finalLane` and `tgtRow` as its
 * own free row — see `buildSankeyBandRowRoute`'s own doc for why those two
 * degenerate cases collapse the extra legs to zero length.
 */
function sankeyPlanRowCells(plan: SankeyRoutePlan, i: number, lanes: SankeyGapLanes, pass: SankeyPassRows | undefined): readonly GlyphCanvasPoint[] {
  const { band, srcBox, tgtBox, straight, mids, midGroups, skipLevel } = plan;
  const [sr0, sr1] = band.sourceRowRange;
  const [tr0, tr1] = band.targetRowRange!;
  const srcRow = sr0 + Math.min(i, sr1 - sr0);
  const tgtRow = tr0 + Math.min(i, tr1 - tr0);
  const gapX0 = srcBox.x1 + 1;
  const firstGapX1 = (mids.length > 0 ? mids[0]!.x0 : tgtBox.x0) - 1;
  const laneStart = straight ? tgtBox.x0 - 1 : (lanes.laneStartByBand.get(band) ?? gapX0);
  // This row's OWN column within the band's ribbon — clamped to the gap's
  // own right edge so an over-packed (compressed) ribbon still produces a
  // valid, in-range route rather than walking past the next column's box.
  const lane = straight ? laneStart : Math.min(firstGapX1, laneStart + i);
  let passRows: readonly number[];
  const jogs: number[] = [];
  if (!skipLevel) passRows = [straight ? srcRow : tgtRow];
  else if (pass!.every((rows) => rows === pass![0])) passRows = [pass![0]![i]!];
  else {
    passRows = pass!.map((rows) => rows[i]!);
    const jogStarts = lanes.jogStartsByBand.get(band);
    for (let c = 0; c + 1 < midGroups.length; c++) {
      // Spread across `k` rows in its gap exactly like `lane`, and clamped to
      // that gap's own right edge for the same reason.
      const jogGapX0 = Math.max(...midGroups[c]!.map((b) => b.x1)) + 1;
      const jogGapX1 = Math.min(...midGroups[c + 1]!.map((b) => b.x0)) - 1;
      jogs.push(Math.min(jogGapX1, (jogStarts?.[c] ?? jogGapX0) + i));
    }
  }
  // The band's own final-leg column — spread across `k` rows in its final
  // gap exactly like `lane` spreads across its first, clamped to that gap's
  // own right edge (the target's immediate border column) for the same
  // reason `lane` is.
  const finalLane = skipLevel
    ? Math.min(tgtBox.x0 - 1, (lanes.finalLaneStartByBand.get(band) ?? mids[mids.length - 1]!.x1 + 1) + i)
    : lane;
  return buildSankeyBandRowRoute(srcBox, tgtBox, srcRow, tgtRow, lane, passRows, jogs, finalLane);
}

/**
 * A smooth plan's ribbon pieces, left to right. An adjacent band is one
 * S-curve between its two node borders. A skip-level band is an S-curve in
 * every gap and a flat run across every intermediate column on that
 * column's pass-through window (`pass`), so it never enters a box: the
 * window is clear of every box in the column by construction, and a gap
 * holds no box. Consecutive pieces share their end rows exactly.
 */
function sankeyPlanSegments(plan: SankeyRoutePlan, pass: SankeyPassRows | undefined): readonly SankeyRibbonSegment[] {
  const { band, srcBox, tgtBox, skipLevel, midGroups } = plan;
  const source = band.sourceRowRange;
  const target = band.targetRowRange!;
  const x0 = srcBox.x1 + 1;
  const x1 = tgtBox.x0 - 1;
  if (!skipLevel || !pass) return [{ x0, x1, from: source, to: target, borderX0: true, borderX1: true }];
  const segments: SankeyRibbonSegment[] = [];
  let x = x0;
  let from = source;
  midGroups.forEach((group, c) => {
    const rows = pass[c]!;
    const through: readonly [number, number] = [rows[0]!, rows[rows.length - 1]!];
    const colX0 = Math.min(...group.map((b) => b.x0));
    const colX1 = Math.max(...group.map((b) => b.x1));
    segments.push({ x0: x, x1: colX0 - 1, from, to: through, borderX0: c === 0, borderX1: false });
    segments.push({ x0: colX0, x1: colX1, from: through, to: through, borderX0: false, borderX1: false });
    x = colX1 + 1;
    from = through;
  });
  segments.push({ x0: x, x1, from, to: target, borderX0: false, borderX1: true });
  return segments;
}

/**
 * The cells a band will occupy, as canvas cell indices — its routed rows'
 * union, or for a smooth-painted band the per-column row envelope
 * `paintSankeyRibbonSmooth` sweeps. Used only to SCORE pass-through
 * candidates, so an envelope row the smooth painter's texture leaves blank
 * still counts: a leg through it would still cross the ribbon visually.
 */
function sankeyPlanFootprint(plan: SankeyRoutePlan, lanes: SankeyGapLanes, pass: SankeyPassRows | undefined, canvasCols: number, canvasRows: number): ReadonlySet<number> {
  const cells = new Set<number>();
  if (plan.smooth) {
    for (const seg of sankeyPlanSegments(plan, pass)) {
      for (let x = seg.x0; x <= seg.x1; x++) {
        const [rowMin, rowMax] = sankeyRibbonColumnRows(seg, x, canvasRows);
        for (let y = rowMin; y <= rowMax; y++) cells.add(y * canvasCols + x);
      }
    }
    return cells;
  }
  for (let i = 0; i < plan.k; i++) for (const p of sankeyPlanRowCells(plan, i, lanes, pass)) cells.add(p.y * canvasCols + p.x);
  return cells;
}


// ── ribbon rendering (visual shape of a painted band) ───────────────────────
//
// `computeSankeyRoutedRows` above is UNCHANGED by everything below: the
// lane/free-row/conservation/fold/conflict math it and `layoutSankeyGraph`
// own is exactly what every existing conservation/border-touch/zero-overwrite
// gate exercises, and none of it needs to move for the ribbon to look
// better — only HOW a routed cell (or, for `braille`/`blocks`, a smooth
// per-dot span) gets PAINTED changes here.

/** `options.ribbon` on a sankey mark (AGENTS.md's "Charts" sankey clause):
 * `"filled"` (default) paints the whole band region; `"outline"` paints only
 * its two edges plus a thin centre stroke. */
export type GlyphChartSankeyRibbon = "filled" | "outline";

type SankeyDir = "n" | "e" | "s" | "w";

function sankeyDirOf(a: GlyphCanvasPoint, b: GlyphCanvasPoint): SankeyDir | null {
  if (b.x > a.x) return "e";
  if (b.x < a.x) return "w";
  if (b.y > a.y) return "s";
  if (b.y < a.y) return "n";
  return null;
}

// Smoothstep — the same horizontal-tangent-at-both-ends S-curve
// `d3-sankey`'s own `sankeyLinkHorizontal` draws. Monotonic in `u`, which is
// what keeps a column-by-column sweep from ever doubling back (the property
// the monotone-edge gate below checks).
function sankeySmoothstep(u: number): number {
  const t = u < 0 ? 0 : u > 1 ? 1 : u;
  return t * t * (3 - 2 * t);
}

/**
 * A band's own top/bottom DOT-ROW bound at absolute dot-column `dotX`,
 * continuous. Evaluated exactly at the two border dot-columns (`dotX ===
 * dotX0`/`dotX1`) it returns the EXACT source/target dot rows — `u` clamps
 * to 0/1 there — which is what keeps row-quantity conservation exact at
 * both borders even though the shape in between is now a curve, not a
 * staircase.
 */
function sankeyRibbonEdgeAt(dotX: number, dotX0: number, dotX1: number, y0: number, y1: number): number {
  if (dotX1 <= dotX0) return y1;
  return y0 + (y1 - y0) * sankeySmoothstep((dotX - dotX0) / (dotX1 - dotX0));
}

/**
 * A smooth ribbon's own continuous `[top, bottom]` dot rows at each of cell
 * column `x`'s two dot columns. A border CELL's own two dot columns must show
 * the EXACT SAME pair — one of them (`dotX === dotX0` at the source, or
 * `dotX1` at the target) is already exact by construction, but the OTHER
 * sits one dot short of it, which `sankeyRibbonEdgeAt` interpolates at `u`
 * fractionally short of 0/1. Left un-forced, that near-but-not-exact half can
 * round OUTSIDE this band's own [sr0,sr1]/[tr0,tr1] and cross into a
 * NEIGHBOURING band's own (contiguous, no-gap) row range at the very column
 * every band's border-touch conservation is measured at — forcing both halves
 * to the SAME exact pair closes that off entirely rather than narrowing it.
 */
function sankeyRibbonColumnEdges(seg: SankeyRibbonSegment, x: number): [number, number][] {
  const [sr0, sr1] = seg.from;
  const [tr0, tr1] = seg.to;
  const xSrcCell = seg.x0, xTgtCell = seg.x1;
  const srcTopDot = sr0 * 4, srcBotDot = sr1 * 4 + 3;
  const tgtTopDot = tr0 * 4, tgtBotDot = tr1 * 4 + 3;
  if (x === xSrcCell) return [[srcTopDot, srcBotDot], [srcTopDot, srcBotDot]];
  if (x === xTgtCell) return [[tgtTopDot, tgtBotDot], [tgtTopDot, tgtBotDot]];
  const dotX0 = xSrcCell * 2;
  const dotX1 = xTgtCell * 2 + 1;
  return [0, 1].map((localCol) => {
    const dotX = x * 2 + localCol;
    return [sankeyRibbonEdgeAt(dotX, dotX0, dotX1, srcTopDot, tgtTopDot), sankeyRibbonEdgeAt(dotX, dotX0, dotX1, srcBotDot, tgtBotDot)];
  }) as [number, number][];
}

/** The cell rows `paintSankeyRibbonSmooth` sweeps at cell column `x` of `seg`. */
function sankeyRibbonColumnRows(seg: SankeyRibbonSegment, x: number, rows: number): [number, number] {
  const edges = sankeyRibbonColumnEdges(seg, x);
  const topMin = Math.min(edges[0]![0], edges[1]![0]);
  const botMax = Math.max(edges[0]![1], edges[1]![1]);
  return [Math.max(0, Math.floor(topMin / 4)), Math.min(rows - 1, Math.floor(botMax / 4))];
}

// Sub-cell dot-bit groups for each visual quadrant — see `GlyphCanvas.sub`'s
// own doc for the bit layout (bit0..2 left column rows 0..2, bit3..5 right
// column rows 0..2, bit6 left row 3, bit7 right row 3): TL, TR, BL, BR.
const SANKEY_QUADRANT_DOT_BITS: readonly (readonly number[])[] = [[0, 1], [3, 4], [2, 6], [5, 7]];
const SANKEY_FULL_SUB_MASK = 0xff;

function sankeySubMaskExcludingQuadrant(missing: number): number {
  let mask = 0;
  for (let q = 0; q < 4; q++) if (q !== missing) for (const bit of SANKEY_QUADRANT_DOT_BITS[q]!) mask |= 1 << bit;
  return mask;
}

/** `GlyphCanvas.sub`'s own dot-bit position for a LOCAL (within-cell) dot —
 * `localCol` in `{0,1}`, `localRow` in `{0,1,2,3}` — matching its doc
 * exactly (mirrors `glyphcss`'s own private `subcellDotBit`, reimplemented
 * here since it isn't exported and the bit layout itself is public). */
function sankeyDotBit(localCol: number, localRow: number): number {
  if (localCol === 0) return localRow < 3 ? localRow : 6;
  return localRow < 3 ? 3 + localRow : 7;
}

/**
 * A `braille`/`blocks` corner cell's rounded dot mask, for the routedRows
 * fallback path (a folded/skip-level band — see `paintSankeyRoutedRows`'s
 * own doc for why those still repaint the ORIGINAL lane/free-row cells
 * rather than a continuous curve). The missing quadrant is the one OUTSIDE
 * the turn's own arc, derived from the incoming/outgoing travel direction —
 * routing here only ever moves east and/or vertically (`pushSankeyHorizontal`
 * inside a gap only ever steps positive; `computeSankeyRoutedRows`'s own
 * construction is x-monotonic), so only 4 of the table's 8 entries are ever
 * actually reached; the rest are kept for totality rather than assumed.
 */
const SANKEY_CORNER_MISSING_QUADRANT: Readonly<Record<string, number>> = {
  "e>s": 1, "e>n": 3, "s>e": 2, "n>e": 0,
  "w>s": 0, "w>n": 2, "s>w": 3, "n>w": 1,
};
function sankeyCornerMissingQuadrant(prevDir: SankeyDir, nextDir: SankeyDir): number | null {
  return SANKEY_CORNER_MISSING_QUADRANT[`${prevDir}>${nextDir}`] ?? null;
}

/** `ascii`/`box`'s own rounded corner glyph for a turn, by incoming/outgoing
 * direction — `╭ ╮ ╰ ╯` on `box`, `/ \` (the only two diagonal glyphs
 * either charset owns) on `ascii`. `null` for a direction pair that cannot
 * occur (this routing never travels west) or a straight run. */
function sankeyBoxCornerGlyph(prevDir: SankeyDir, nextDir: SankeyDir, ascii: boolean): string | null {
  const key = `${prevDir}>${nextDir}`;
  if (ascii) {
    if (key === "e>s" || key === "s>e") return "\\";
    if (key === "e>n" || key === "n>e") return "/";
    return null;
  }
  const table: Readonly<Record<string, string>> = { "e>s": "╮", "e>n": "╯", "s>e": "╰", "n>e": "╭" };
  return table[key] ?? null;
}

/**
 * Deterministic per-dot texture for a `braille`/`blocks` ribbon, keyed by
 * the LITERAL glyph `seriesShade(tier, styleIndex, total)` already picked
 * for this band (`SankeyRoutedRow.glyph`) — never a separate style index —
 * so a ribbon's own sub-cell density/orientation always agrees with the
 * shape family the legend swatch shows for that series (the coordinator's
 * own "must agree with the 3-arg shade table" note): `█`'s own glyph reads
 * as the densest texture, `░`'s as the sparsest, and the four
 * orientation glyphs (`▚ ╱ ▌ ═`) each pick the sub-cell pattern that most
 * resembles their own shape (checker / diagonal / vertical / horizontal
 * stripe). Anchored on GLOBAL dot coordinates (`absDotX`/`absDotY`, not
 * cell-local), so the pattern reads as one continuous texture across a
 * multi-cell run instead of restarting inside every cell. An unrecognised
 * glyph (a future `SHADE_RAMPS` addition `series.ts` alone controls) falls
 * back to a plain 62.5% checkerboard rather than a crash.
 */
function sankeyRibbonTextureOn(glyph: string, absDotX: number, absDotY: number): boolean {
  switch (glyph) {
    case "█": return (absDotX + absDotY) % 6 !== 0; // dense, ~83%
    case "▓": return (absDotX + absDotY) % 4 !== 3; // dense-medium, 75%
    case "▒": return (absDotX + absDotY) % 2 === 1; // medium, 50%
    case "░": return (absDotX + absDotY) % 3 === 0; // sparse, ~33%
    case "▚": return (absDotX + absDotY) % 2 === 0; // checker, 50%
    case "╱": return (((absDotX - absDotY) % 4) + 4) % 4 < 2; // diagonal stripe, 50%
    case "▌": return absDotX % 2 === 0; // vertical stripe (left half), 50%
    case "═": return absDotY % 2 === 0; // horizontal stripe, 50%
    default: return (absDotX + absDotY) % 8 < 5; // unrecognised glyph — plain 62.5%.
  }
}

/**
 * Paints a`braille`/`blocks` ADJACENT (non-skip-level, non-folded) band as a
 * genuine per-dot-column smooth ribbon — real sub-cell resolution instead of
 * a staircase of whole-cell blocks (the owner's own "fill these with braille
 * and create better shapes" ask). Bypasses `routedRows`'s own lane/free-row
 * cells entirely: that routing's job — steering a band's vertical run around
 * an intermediate node's own box — has no analogue here, because there IS no
 * intermediate column for an adjacent band. A skip-level band keeps routing
 * around the mid column instead (see `paintSankeyRoutedRowsFallback`), which
 * this function is never called for (its caller checks `mids.length` first).
 *
 * `paintCell` is the SAME per-cell ownership closure `paintSankeyRoutedRows`
 * builds — every write here goes through `canvas.text` exactly like the
 * fallback path's border/corner/box cells, so occlusion, `textFiller`
 * (a scaled node label's own reserved box) and the shared `claimedBy` set
 * all apply uniformly with no separate guard to keep in sync.
 *
 * `phase` (default `"both"`, byte-identical to before this parameter
 * existed) restricts the sweep to this ribbon's own two BORDER columns
 * (`xSrcCell`/`xTgtCell`) or to everything strictly between them — the same
 * global border-first discipline `paintSankeyRoutedRows` now applies across
 * every band, smooth or fallback (DIAGNOSIS-sankey-column-jump.md's own
 * gate (a): a band always reaches both its own node borders, regardless of
 * registration order against another band's own interior cells).
 */
function paintSankeyRibbonSmooth(
  paintCell: (band: SankeyBand, x: number, y: number, glyph: string, color: string | null | undefined) => void,
  rows: number,
  tierName: GlyphCanvasTierName,
  band: SankeyBand,
  glyph: string,
  color: string | null,
  segments: readonly SankeyRibbonSegment[],
  ribbon: GlyphChartSankeyRibbon,
  phase: "border" | "interior" | "both" = "both",
  fill: SankeyRegionFill = "texture",
): void {
  // SOLID (`regionFill.ts`): every dot between the two edges is ink and the
  // tier's FILL glyph (the quadrant table, `█` inside) paints it, so the
  // ribbon reads as one colour block with half-cell edges. Only the glyph
  // changes: a cell is written exactly when its mask is non-zero, and the
  // two edge dots are ink under every texture too, so the cells claimed
  // (and every border/break/zero-overwrite count built on them) are the
  // texture paint's own.
  const tier = GLYPH_CANVAS_TIERS[tierName];
  const solid = fill === "solid";
  const subGlyph = solid ? (tier.fillSubGlyph ?? tier.subGlyph)! : tier.subGlyph!;
  const maxDotRow = rows * 4 - 1;

  for (const seg of segments) for (let x = seg.x0; x <= seg.x1; x++) {
    const isBorderCol = (x === seg.x0 && seg.borderX0) || (x === seg.x1 && seg.borderX1);
    if (phase === "border" && !isBorderCol) continue;
    if (phase === "interior" && isBorderCol) continue;
    const edgesByLocalCol = sankeyRibbonColumnEdges(seg, x);
    const [rowMin, rowMax] = sankeyRibbonColumnRows(seg, x, rows);
    for (let r = rowMin; r <= rowMax; r++) {
      let mask = 0;
      let spanMask = 0;
      for (let localCol = 0; localCol < 2; localCol++) {
        const [top, bot] = edgesByLocalCol[localCol]!;
        const topD = Math.max(0, Math.min(maxDotRow, Math.round(top)));
        const botD = Math.max(0, Math.min(maxDotRow, Math.round(bot)));
        for (let localRow = 0; localRow < 4; localRow++) {
          const dotRow = r * 4 + localRow;
          // `outline` paints ONLY the two edge dots — no centre stroke
          // (fable P1-2 / codex P2-9): a midpoint dot ate too much of a
          // THIN band (up to 62.9% of a filled band's own ink on an 8-way
          // fan-in at 40x20) and, combined with the P1-1 junction-residue
          // fix above, is no longer needed to keep a "blank" interior cell
          // from reading as ambiguous — a genuinely unpainted interior cell
          // is now genuinely blank, never a leftover routing glyph.
          const inSpan = ribbon === "outline" ? (dotRow === topD || dotRow === botD) : (dotRow >= topD && dotRow <= botD);
          if (!inSpan) continue;
          spanMask |= 1 << sankeyDotBit(localCol, localRow);
          // The EDGE dots themselves (`topD`/`botD`) always paint — texture
          // only thins the FILL strictly between them — which is what keeps
          // the top/bottom edge a clean, traceable line (the monotone-edge
          // property) rather than noise wherever that column's own texture
          // phase happens to land near the boundary.
          const on = isBorderCol || ribbon === "outline" || dotRow === topD || dotRow === botD || sankeyRibbonTextureOn(glyph, x * 2 + localCol, dotRow);
          if (on) mask |= 1 << sankeyDotBit(localCol, localRow);
        }
      }
      // A cell is claimed exactly when the TEXTURE paint claims it, under
      // either fill: `report` (border touches, `sankey-band-broken`) comes
      // from the texture paint and must describe the solid picture too. The
      // two differ only where one dot column's sliver meets a texture with
      // no ink in that column (`▌`'s right half), which both leave empty.
      if (mask === 0) continue;
      if (solid) mask = spanMask;
      // A crossing smooth ribbon's own claim can refuse this cell (two
      // adjacent bands' curves genuinely overlap, or an earlier mark/band
      // already painted it) — the smooth path used to ignore that refusal
      // entirely (fable P1-3), so a crossing loss was never reported at all
      // on braille/blocks. `paintCell` (the caller's `paintForBand`) counts
      // it, per band and excluding this band's own self-revisits, into a
      // `sankey-band-broken` ledger entry.
      paintCell(band, x, r, subGlyph(mask), color);
    }
  }
}

/** A band's claim on one cell, in the painter's own order: `paintSankeyRoutedRows`' `paintForBand`, or `sankeyLostCells`' count. */
type SankeyClaim = (band: SankeyBand, x: number, y: number, glyph: string, color: string | null | undefined) => void;

/**
 * Every routed band's cells, claimed through `claim` in the one order the
 * painter uses. Shared by the real paint and by `sankeyLostCells`, so the
 * layout's own gate counts exactly the cells a render loses.
 */
function sankeyClaimBands(routedRows: readonly SankeyRoutedRow[], tierName: GlyphCanvasTierName, canvasRows: number, ribbon: GlyphChartSankeyRibbon, fill: SankeyRegionFill, claim: SankeyClaim): void {
  // Group by band (preserving registration order) so a smooth `braille`/
  // `blocks` band (its routed rows carry `segments`) can be painted ONCE, as
  // a ribbon, while a FOLDED stub or a staircase band replays its own
  // already-computed lane/free-row cells.
  const rowsByBand = new Map<SankeyBand, SankeyRoutedRow[]>();
  const bandOrder: SankeyBand[] = [];
  for (const row of routedRows) {
    let list = rowsByBand.get(row.band);
    if (!list) { list = []; rowsByBand.set(row.band, list); bandOrder.push(row.band); }
    list.push(row);
  }
  // TWO GLOBAL PHASES, both walking `bandOrder` — every band's own BORDER
  // cells first, THEN every band's own INTERIOR cells — rather than one
  // pass per band. This is what lets RC2 (below) hold at the same time as
  // gate (a) ("every band's own row touches both its node borders"):
  // a row's first cell (touching its source) and last cell (touching its
  // target) are structurally unique to that row, and painting EVERY band's
  // own pair before ANY band's own interior run is what stops a band's
  // interior transit — a skip-level band's own lane column, in particular,
  // which can legitimately coincide with an unrelated node's own arrival
  // border (`assignSankeyLanes`'s shared gap includes that exact column) —
  // from stealing a border that belongs to a DIFFERENT band, regardless of
  // which of the two was registered first. Splitting a smooth ribbon's own
  // two border COLUMNS from its interior ones needs no extra pass of its
  // own — `paintSankeyRibbonSmooth`'s `phase` parameter filters the same
  // per-column sweep it always did.
  //
  // RC2 (DIAGNOSIS-sankey-column-jump.md): a fallback band used to be
  // painted only in `paintSankeyRoutedRowsFallback`'s own SECOND (interior)
  // pass, called ONCE after every smooth band's own single pass — so a wide
  // skip-level band registered early (band #2 of 9 on the energy dataset)
  // lost most of its own cells to ribbons registered much later, contra­
  // dicting this function's own "repaint in the SAME registration order"
  // doc. Now every band's own INTERIOR phase runs at its own registration
  // slot in `bandOrder`, smooth or fallback alike — a genuine interior-vs-
  // interior crossing is still resolved by registration order (unchanged),
  // but no band's interior can ever reach a border before phase 1 has
  // already secured every one of them.
  for (const phase of ["border", "interior"] as const) {
    for (const band of bandOrder) {
      const rows = rowsByBand.get(band)!;
      const { glyph, color, segments } = rows[0]!;
      if (segments) paintSankeyRibbonSmooth(claim, canvasRows, tierName, band, glyph, color, segments, ribbon, phase, fill);
      else paintSankeyRoutedRowsFallback(tierName, rows, claim, ribbon, phase, fill);
    }
  }
}

/**
 * The cells `layout`'s bands would lose to each other when painted alone on
 * a `subcell` (`braille`/`blocks`) or whole-cell (`ascii`/`box`) tier: the
 * sum of `sankey-band-broken`'s own per-band counts, computed from the real
 * routes and the painter's own claim order with no canvas writes. The
 * routing is 0.2 ms on the energy sankey; drawing the candidates instead
 * cost 6.7x the render (Round 26). A tier family shares one count: the
 * whole-cell tiers claim every routed cell whatever its glyph, and
 * `braille`/`blocks` share one texture set. `rows`/`cols` are the plot's,
 * which every route and ribbon edge stays inside.
 */
export function sankeyLostCells(layout: GlyphChartSankeyLayout, plot: GlyphChartPlotRect, subcell: boolean, ribbon: GlyphChartSankeyRibbon, textScale = 1): number {
  const tierName: GlyphCanvasTierName = subcell ? "braille" : "box";
  const cols = plot.x1 + 1, rows = plot.y1 + 1;
  const routedRows = computeSankeyRoutedRows({ cols, rows, tier: tierName, edge: () => {}, route: () => {} }, plot, layout, false, [], "", textScale);
  const owner = new Map<number, SankeyBand>();
  const refused = new Map<SankeyBand, Set<number>>();
  sankeyClaimBands(routedRows, tierName, rows, ribbon, "texture", (band, x, y) => {
    const idx = y * cols + x;
    const current = owner.get(idx);
    if (current === undefined) { owner.set(idx, band); return; }
    if (current === band) return;
    const cells = refused.get(band) ?? new Set<number>();
    cells.add(idx);
    refused.set(band, cells);
  });
  let lost = 0;
  for (const cells of refused.values()) lost += cells.size;
  return lost;
}

/**
 * Paints a `GlyphChartSankeyLayout` through the cell canvas's own edge/route
 * routing contract — see `computeSankeyRoutedRows` for the routing itself.
 *
 * `claimedBy` (default a fresh, per-call set — byte-identical for a single
 * sankey mark) is the SAME cell-ownership set every sankey mark painted
 * onto this canvas shares when `paintGlyphChart` passes one down — sharing
 * it is what makes "no cell is silently overwritten" a property of the
 * RENDER rather than of one mark's own call: a second sankey's band OR
 * node box reaching a cell the first sankey already claimed (bands, box
 * borders, and box labels alike) loses that cell exactly like a later band
 * within ONE sankey does, instead of blindly painting over it (fable
 * review, batch 3, finding c). `edgeIdPrefix` is `computeSankeyRoutedRows`'
 * own namespace (see its doc).
 */
export function paintSankeyLayout(canvas: GlyphCanvas, plot: GlyphChartPlotRect, layout: GlyphChartSankeyLayout, colorEnabled: boolean, ledger: GlyphChartLedgerEntry[], claimedBy: Set<number> = new Set(), edgeIdPrefix = "", ribbon: GlyphChartSankeyRibbon = "filled", textScale = 1, fill: SankeyRegionFill = "texture"): void {
  const routedRows = computeSankeyRoutedRows(canvas, plot, layout, colorEnabled, ledger, edgeIdPrefix, textScale);
  canvas.resolveJunctions();
  paintSankeyRoutedRows(canvas, layout, routedRows, ledger, claimedBy, ribbon, textScale, fill);
}

/**
 * The claim-respecting repaint half of `paintSankeyLayout`, split out so a
 * MULTI-sankey render (`paint.ts`'s own `paintSankeyMarks`) can call
 * `canvas.resolveJunctions()` exactly ONCE, after every sankey mark has
 * registered its routes, rather than once per mark. `resolveJunctions()`
 * writes `grid.char` directly from the canvas's SHARED, cross-mark
 * `cellEdges` bookkeeping (`junctions.ts`'s own doc) — calling it again
 * for mark #2 re-derives a junction glyph for every cell with ANY
 * registered edge, INCLUDING mark #1's, and nothing repaints those cells
 * back afterward unless they're also part of mark #2's own `routedRows`.
 * That is a distinct corruption from the edge-id collision `edgeIdPrefix`
 * fixes: it survives even with namespaced ids, because it needs no id
 * collision at all — two DIFFERENT ids at the same cell are still a
 * "crossing" to `resolveGlyphCanvasJunctions`. Splitting this function out
 * is the fix: register every mark's routes, resolve junctions once, THEN
 * repaint every mark from its own already-computed `routedRows`.
 */
export function paintSankeyRoutedRows(canvas: GlyphCanvas, layout: GlyphChartSankeyLayout, routedRows: readonly SankeyRoutedRow[], ledger: GlyphChartLedgerEntry[], claimedBy: Set<number> = new Set(), ribbon: GlyphChartSankeyRibbon = "filled", textScale = 1, fill: SankeyRegionFill = "texture"): void {
  const nodeBoxes = new Map(layout.nodes.map((n) => [n.id, n]));
  const tierTable = GLYPH_CANVAS_TIERS[canvas.tier];
  const cols = sankeyColumnsByX0(nodeBoxes);

  // Repaint in the SAME registration order `resolveJunctions()` itself
  // broke ties by: the first band/row to reach a cell keeps it, every later
  // one draws nothing there — a real crossing costs the loser exactly the
  // cells the two routes actually share, never its whole run. A cell
  // already claimed by an EARLIER SANKEY MARK (this render's shared
  // `claimedBy`) is refused the same way, before this mark's own
  // within-mark priority rules ever see it. `canvas.text` is the ONE write
  // path every cell in this function goes through (bands, node boxes,
  // labels alike) — it is what makes occlusion and a scaled node label's
  // own `textFiller` reservation apply uniformly with no separate guard.
  const paintCell = (x: number, y: number, glyph: string, color: string | null | undefined): boolean => {
    const idx = y * canvas.cols + x;
    if (claimedBy.has(idx)) return false;
    claimedBy.add(idx);
    canvas.text(x, y, [glyph], { color: color ?? null });
    return true;
  };

  // `paintForBand` wraps `paintCell` with per-band OWNERSHIP (`cellOwner`,
  // scoped to this one call — a fresh, per-render map, never the
  // cross-mark `claimedBy`) so a refusal can be told apart from a harmless
  // SELF-revisit: a multi-row band's own later rows can still converge onto
  // the SAME pass-through or final-lane cell (`pickSankeyFreeRowBand`/
  // `assignSankeyFinalLanes` degrade to reused rows/columns when a gap has
  // fewer clear rows, or less width, than the band's own `k` — a documented
  // residual, not the routine case it was before this module gave every leg
  // its own spread), and `claimedBy` alone can't distinguish "my own
  // earlier row already painted this" from "a genuinely different band took
  // it" — counting the former as a break reported a fabricated 670-cell
  // "break" for a single uncrossed band
  // (`Natural Gas -> Industrial` at 140x40) where the true figure, once
  // self-claims are excluded, is a real but far smaller crossing loss.
  // This REPLACES a synthetic per-fallback-row ownership map that used to
  // key a cell's "owner" by its local array INDEX rather than its band
  // (agy P2-1: a multi-row band's own later rows always disagreed with row
  // 0's index at a cell all of them legitimately share, logging a false
  // break on every band with height > 1) and that never saw a smooth
  // ribbon's own cells at all (fable P1-3: two crossing smooth ribbons
  // silently drop one's cells with no ledger entry). Counting `paintCell`'s
  // own real refusals, per band, minus self-overlap, is ground truth for
  // both paths at once.
  //
  // The refusal SET (not a running counter — sankey round-4 review, N3,
  // relocated agy P2-1): several ROWS of one multi-row band can cross the
  // SAME foreign-owned cell (the identical shared free-row detour that
  // makes self-revisits routine above), and a counter added a fresh unit
  // for every one of those revisits — measured on the energy dataset's own
  // `Natural Gas -> Industrial` at 140x40, a counter reported 576 while the
  // band's own DISTINCT lost cells numbered 111. A `Set` of cell indices
  // per band is the fix: revisiting an already-refused cell (whether by
  // the SAME row again or a DIFFERENT row of the same band) adds nothing.
  // A gap row from the visual-air feature never reaches this at all — it
  // was never assigned to any band's row range, so `paintForBand` is never
  // CALLED for it, planned or not; this Set only ever sees cells that are
  // genuinely part of some band's own routed/ribbon footprint.
  const cellOwner = new Map<number, SankeyBand>();
  const refusedCellsByBand = new Map<SankeyBand, Set<number>>();
  const paintForBand = (band: SankeyBand, x: number, y: number, glyph: string, color: string | null | undefined): void => {
    const idx = y * canvas.cols + x;
    if (paintCell(x, y, glyph, color)) { cellOwner.set(idx, band); return; }
    if (cellOwner.get(idx) !== band) {
      const cells = refusedCellsByBand.get(band) ?? new Set<number>();
      cells.add(idx);
      refusedCellsByBand.set(band, cells);
    }
  };

  sankeyClaimBands(routedRows, canvas.tier, canvas.rows, ribbon, fill, paintForBand);
  for (const [band, cells] of refusedCellsByBand) {
    if (cells.size > 0) ledger.push(ledgerSankeyBandBroken({ source: band.source, target: band.target, cells: cells.size }));
  }

  paintSankeyNodeBoxes(canvas, layout, ledger, paintCell, claimedBy, textScale);
}

/**
 * The ORIGINAL lane/free-row cell path, unchanged in its OWNERSHIP order
 * (border cells across every fallback band first, then every full run —
 * EVERY cell in a band's own route is still painted exactly once in
 * `"filled"` mode, never silently skipped, which is what keeps this path's
 * existing zero-overwrite/border-touch/conflict gates exactly as they were)
 * — only the GLYPH each cell paints changed, from one flat
 * `seriesShade`-family glyph everywhere to a shape-aware one: `ascii`/`box`
 * draw a rounded corner glyph at a turn, and — on a STRAIGHT run — the
 * series' own glyph UNLESS it's the fully-solid one (`█`/`#`, the one shape
 * in the family with no ink gaps of its own), which steps to the tier's own
 * next-lighter `shadeRamp` neighbour instead (`▓`/`+`) so "less filled"
 * never depends on a cell going unpainted; every other shape glyph (`░ ▚ ╱
 * ▌ ═ ▓ ▒` / `. = / @ : | -`) is already non-solid ink and needs no
 * substitute. A `braille`/`blocks` SKIP-LEVEL/folded band gets the sub-cell
 * analogue (a rounded quadrant mask at a turn, a texture at a straight run)
 * instead of a flat `subGlyph(0xff)` block.
 *
 * `ribbon: "outline"` thins every straight-run cell in EITHER charset
 * family down to a single BLANK — never `null`/skipped (codex P2-9 / fable
 * P1-2): `canvas.resolveJunctions()` already wrote a box-drawing glyph into
 * every registered cell of a fallback band's route BEFORE this function
 * ever runs, so "don't call `paintCell` here" left that residue standing —
 * an outline band read as a solid slab of `───` rules with MORE ink than a
 * filled one, on every tier. Actually PAINTING the blank (claiming the
 * cell) is what erases it — only border and corner cells still show ink,
 * which is what keeps an outline band reading as two edges rather than a
 * filled slab. A literal blank ROW GAP between two merely-ADJACENT (never
 * overlapping) bands was tried and reverted: it left a band's own
 * uncontested cell unpainted with no OTHER band's route claiming it, which
 * is indistinguishable, to this module's own zero-silent-overwrite gate,
 * from a genuine loss — see `docs/design/charts.md`'s "Sankey ribbon
 * rendering" for the measurement.
 */
const SANKEY_LIGHTER_STRAIGHT_GLYPH: Readonly<Record<string, string>> = { "█": "▓", "#": "+" };
function paintSankeyRoutedRowsFallback(
  tierName: GlyphCanvasTierName,
  fallbackRows: readonly SankeyRoutedRow[],
  paintCell: SankeyClaim,
  ribbon: GlyphChartSankeyRibbon,
  phase: "border" | "interior" | "both" = "both",
  fill: SankeyRegionFill = "texture",
): void {
  const tierTable = GLYPH_CANVAS_TIERS[tierName];
  const ascii = tierName === "ascii";
  const blank = tierTable.subcell ? tierTable.subGlyph!(0) : " ";
  // SOLID (`regionFill.ts`): the band's own colour carries its identity, so
  // a filled cell is the tier's solid glyph — no lighter straight-run step,
  // no texture mask, and on `ascii`/`box` no one-stroke corner glyph (a thin
  // arc inside a solid run reads as a hole). Nor, on `braille`/`blocks`, a
  // rounded corner: its cut quadrant is page background, and in a `k`-row
  // staircase every inner row's turn cuts it facing the band's own next row,
  // or another band abutting the turn (DIAGNOSIS-sankey-column-jump.md,
  // Round 3: the black notches in the solid skip-level band). A texture's
  // own dots leave gaps anyway, so its rounded corner stays. The same cells
  // are painted either way.
  const solid = fill === "solid";
  const solidGlyph = regionFillGlyph(tierName, 0, 1, "solid");
  const cellSubGlyph = solid ? (tierTable.fillSubGlyph ?? tierTable.subGlyph) : tierTable.subGlyph;
  // A row's SECOND visit to its own already-painted border cell (loop 2
  // below walks only the INTERIOR cells, `ci` in `[1, length - 2]`) never
  // reaches `paintCell` at all, so a border a row claims in loop 1 can
  // never be miscounted as a foreign refusal against that same row's own
  // band; the caller's `paintForBand` separately excludes any OTHER
  // self-revisit (a different row of the SAME band sharing a cell).
  const paintTracked = (row: SankeyRoutedRow, x: number, y: number, glyph: string): void => {
    paintCell(row.band, x, y, glyph, row.color);
  };

  // BORDER cells go FIRST, across every band, and unconditionally — see the
  // original implementation's own doc (kept here in spirit): a row's first
  // cell (touching its source) and last cell (touching its target) are
  // structurally unique to that row, and claiming them ahead of every
  // band's full run is what stops a later band's transit from stealing an
  // earlier band's own border before that border is ever reached in path
  // order.
  const rowGlyphAt = (row: SankeyRoutedRow, ci: number): string | null => {
    const { cells, glyph } = row;
    const isBorder = ci === 0 || ci === cells.length - 1;
    const prev = ci > 0 ? sankeyDirOf(cells[ci - 1]!, cells[ci]!) : null;
    const next = ci < cells.length - 1 ? sankeyDirOf(cells[ci]!, cells[ci + 1]!) : null;
    const isCorner = prev !== null && next !== null && prev !== next;
    if (tierTable.subcell) {
      const subGlyph = cellSubGlyph!;
      if (isBorder) return subGlyph(SANKEY_FULL_SUB_MASK);
      if (isCorner) {
        const q = solid ? null : sankeyCornerMissingQuadrant(prev!, next!);
        return subGlyph(q === null ? SANKEY_FULL_SUB_MASK : sankeySubMaskExcludingQuadrant(q));
      }
      if (ribbon === "outline") return blank;
      if (solid) return subGlyph(SANKEY_FULL_SUB_MASK);
      let mask = 0;
      for (let lc = 0; lc < 2; lc++) for (let lr = 0; lr < 4; lr++) {
        if (sankeyRibbonTextureOn(glyph, cells[ci]!.x * 2 + lc, cells[ci]!.y * 4 + lr)) mask |= 1 << sankeyDotBit(lc, lr);
      }
      return subGlyph(mask);
    }
    if (isBorder) return solid ? solidGlyph : glyph;
    if (isCorner && !(solid && ribbon === "filled")) {
      const g = sankeyBoxCornerGlyph(prev!, next!, ascii);
      if (g) return g;
    }
    if (ribbon === "outline") return blank;
    if (solid) return solidGlyph;
    return SANKEY_LIGHTER_STRAIGHT_GLYPH[glyph] ?? glyph;
  };

  if (phase !== "interior") {
    for (const row of fallbackRows) {
      const g0 = rowGlyphAt(row, 0);
      if (g0) paintTracked(row, row.cells[0]!.x, row.cells[0]!.y, g0);
      const lastIdx = row.cells.length - 1;
      const gLast = rowGlyphAt(row, lastIdx);
      if (gLast) paintTracked(row, row.cells[lastIdx]!.x, row.cells[lastIdx]!.y, gLast);
    }
  }
  if (phase === "border") return;
  for (const row of fallbackRows) {
    for (let ci = 1; ci < row.cells.length - 1; ci++) {
      const p = row.cells[ci]!;
      const g = rowGlyphAt(row, ci);
      if (g) paintTracked(row, p.x, p.y, g);
    }
  }
}

/**
 * Node boxes and their labels — unchanged in shape (border, interior blank,
 * centred label) from the original implementation, except the label now
 * honours `textScale` (the coordinator's own "sankey node labels... must
 * honour textScale" note): at `textScale > 1` the label is abbreviated to
 * fit its SCALED footprint (`inner / textScale` glyphs, never `inner`) and
 * painted through `canvas.text(..., { scale: textScale })` directly, so its
 * own `s`x`s` boxes reserve `textFiller` exactly like an axis label's do —
 * every band-painting path above already refuses a `textFiller` cell via
 * the SAME `canvas.text` call every cell in this module goes through, so a
 * scaled label reserved BEFORE a band reaches that column is automatically
 * respected with no extra check. Labels are painted last (after every
 * band), matching the original order, but a node's own box occupies ONLY
 * its own node column — a band's ribbon never reaches into it — so a
 * scaled label can never lose ground it already reserved to a band painted
 * earlier, or gain ground into a cell a NEIGHBOURING mark's box already
 * claims (still checked via `claimedBy` before the reservation is made).
 */
function paintSankeyNodeBoxes(
  canvas: GlyphCanvas,
  layout: GlyphChartSankeyLayout,
  ledger: GlyphChartLedgerEntry[],
  paintCell: (x: number, y: number, glyph: string, color: string | null | undefined) => boolean,
  claimedBy: Set<number>,
  textScale: number,
): void {
  const tier = GLYPH_CANVAS_TIERS[canvas.tier];
  const { n: N, e: E, s: S, w: W } = GLYPH_CANVAS_DIRECTION_BITS;
  const hLine = tier.straight.h;
  const vLine = tier.straight.v;
  const cornerTL = tier.junction[S | E]!;
  const cornerTR = tier.junction[S | W]!;
  const cornerBL = tier.junction[N | E]!;
  const cornerBR = tier.junction[N | W]!;
  // `paintRun` claims every cell it touches (real content: corners, border
  // lines, the label); `fillRun` is the interior BLANK padding alone — it
  // refuses to overwrite a cell another mark already claimed (so a foreign
  // box/band shows through a box's own empty interior) but does NOT itself
  // claim a cell, because the label text painted moments later, in the SAME
  // mark's own call, lands on exactly those interior cells and must not
  // find them already "claimed" by its own box's blank filler.
  const paintRun = (x0: number, y: number, run: string): void => {
    for (let i = 0; i < run.length; i++) paintCell(x0 + i, y, run[i]!, null);
  };
  const fillRun = (x0: number, y: number, run: string): void => {
    for (let i = 0; i < run.length; i++) {
      const x = x0 + i;
      if (claimedBy.has(y * canvas.cols + x)) continue;
      canvas.text(x, y, [run[i]!], { color: null });
    }
  };
  for (const box of layout.nodes) {
    if (box.height <= 0) continue;
    const width = box.x1 - box.x0 + 1;
    if (width < 2) continue;
    const inner = Math.max(1, width - 2);
    const { text } = abbreviateChartText(box.id, Math.max(1, Math.floor(inner / textScale)), canvas.tier);
    if (box.y0 === box.y1) {
      const line = width >= 3 ? `${cornerTL}${text.padEnd(inner)}${cornerTR}` : text.padEnd(width);
      paintRun(box.x0, box.y0, line.slice(0, width));
      continue;
    }
    paintRun(box.x0, box.y0, `${cornerTL}${hLine.repeat(inner)}${cornerTR}`);
    for (let row = box.y0 + 1; row < box.y1; row++) {
      paintCell(box.x0, row, vLine, null);
      fillRun(box.x0 + 1, row, " ".repeat(inner));
      paintCell(box.x0 + 1 + inner, row, vLine, null);
    }
    paintRun(box.x0, box.y1, `${cornerBL}${hLine.repeat(inner)}${cornerBR}`);
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
    if (textScale <= 1) {
      const pad = Math.max(0, Math.floor((inner - text.length) / 2));
      paintRun(box.x0 + 1 + pad, midRow, text);
      continue;
    }
    // A scaled label's footprint is `text.length * textScale` columns —
    // reject (fall back to the label-dropped ledger entry, never a
    // silently truncated/overflowing box) rather than paint outside the
    // box or into a cell `claimedBy` already owns.
    const footprint = text.length * textScale;
    const padScaled = Math.max(0, Math.floor((inner - footprint) / 2));
    const labelX = box.x0 + 1 + padScaled;
    let fits = footprint <= inner;
    const cellsNeeded: number[] = [];
    if (fits) {
      for (let gx = 0; gx < text.length; gx++) {
        for (let dy = 0; dy < textScale; dy++) for (let dx = 0; dx < textScale; dx++) {
          const cx = labelX + gx * textScale + dx;
          const cy = midRow + dy;
          if (cx > box.x1 - 1 || cy > box.y1 - 1) { fits = false; break; }
          cellsNeeded.push(cy * canvas.cols + cx);
        }
        if (!fits) break;
      }
    }
    if (fits && !cellsNeeded.some((idx) => claimedBy.has(idx))) {
      for (const idx of cellsNeeded) claimedBy.add(idx);
      canvas.text(labelX, midRow, [text], { color: null, scale: textScale });
    } else {
      ledger.push(ledgerLabelDropped({ role: "sankey node label", text: box.id, reason: "the node's box is too small for the label at the current textScale" }));
    }
  }
}

/** `paint.ts`'s own call site for a SINGLE sankey mark — lays out then paints
 * in one step, `resolveJunctions()` included. For more than one sankey mark
 * in a render, use `paintSankeyMarks` instead (see its own doc for why). */
export function paintSankeyMark(canvas: GlyphCanvas, plot: GlyphChartPlotRect, groups: readonly ChartSeries[], colorEnabled: boolean, ledger: GlyphChartLedgerEntry[], claimedBy: Set<number> = new Set(), edgeIdPrefix = "", ribbon: GlyphChartSankeyRibbon = "filled", textScale = 1, fill: SankeyRegionFill = "texture"): void {
  const layout = layoutSankeyGraph(groups, plot, canvas.tier, ledger, textScale);
  if (layout) paintSankeyLayout(canvas, plot, layout, colorEnabled, ledger, claimedBy, edgeIdPrefix, ribbon, textScale, fill);
}

/**
 * `paint.ts`'s own call site for EVERY sankey mark in one render, called
 * once regardless of how many there are. Registers every mark's routes
 * first (namespaced edge ids, `computeSankeyRoutedRows`), calls
 * `canvas.resolveJunctions()` exactly ONCE (see `paintSankeyRoutedRows`'s
 * own doc for why calling it per mark corrupts an earlier mark's cells),
 * then repaints each mark from its own already-computed `routedRows`
 * through the ONE shared `claimedBy` — so a later sankey's band or node box
 * can never silently overwrite an earlier one's already-claimed cell, and
 * two marks' routes can never collide on a shared edge id. A spec with
 * zero or one sankey mark takes this same path and is byte-identical to
 * calling `paintSankeyMark` directly (one iteration, one registration
 * batch, one `resolveJunctions()` call — indistinguishable from today's).
 */
export function paintSankeyMarks(canvas: GlyphCanvas, plot: GlyphChartPlotRect, entries: readonly { readonly groups: readonly ChartSeries[]; readonly ribbon?: GlyphChartSankeyRibbon }[], colorEnabled: boolean, ledger: GlyphChartLedgerEntry[], textScale = 1, fill: SankeyRegionFill = "texture"): void {
  const registered: { readonly layout: GlyphChartSankeyLayout; readonly routedRows: readonly SankeyRoutedRow[]; readonly ribbon: GlyphChartSankeyRibbon }[] = [];
  for (let i = 0; i < entries.length; i++) {
    const layout = layoutSankeyGraph(entries[i]!.groups, plot, canvas.tier, ledger, textScale);
    if (!layout) continue;
    const routedRows = computeSankeyRoutedRows(canvas, plot, layout, colorEnabled, ledger, `sankey${i}:`, textScale);
    registered.push({ layout, routedRows, ribbon: entries[i]!.ribbon ?? "filled" });
  }
  if (registered.length === 0) return;
  canvas.resolveJunctions();
  const claimedBy = new Set<number>();
  for (const { layout, routedRows, ribbon } of registered) paintSankeyRoutedRows(canvas, layout, routedRows, ledger, claimedBy, ribbon, textScale, fill);
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
export function paintFunnelMark(canvas: GlyphCanvas, plot: GlyphChartPlotRect, groups: readonly ChartSeries[], colorEnabled: boolean, ledger: GlyphChartLedgerEntry[], textScale = 1, fill: SankeyRegionFill = "texture"): void {
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

    const glyph = regionFillGlyph(canvas.tier, stage.styleIndex, n, fill);
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
