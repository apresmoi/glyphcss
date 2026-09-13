/**
 * Structured `report.ledger` entries for `@glyphcss/charts`. A ledger entry
 * is `{ code, message, detail? }` — `code` is a stable kebab id a caller
 * (the CLI, an agent, a test) can match on without parsing prose; `message`
 * is ONE plain-English sentence written for the person looking at the
 * chart, never an internal log line (`layout:`, `arc:`, `->`); `detail`
 * carries the exact numbers behind it. Every producer goes through a
 * constructor here so the sentence shape is enforced once (`ledger.test.ts`)
 * instead of trusted at each call site.
 */

export interface GlyphChartLedgerEntry {
  readonly code: string;
  readonly message: string;
  readonly detail?: Record<string, unknown>;
}

function entry(code: string, message: string, detail?: Record<string, unknown>): GlyphChartLedgerEntry {
  return detail === undefined ? { code, message } : { code, message, detail };
}

export function ledgerTicksThinned(opts: { readonly axis: "x" | "y"; readonly shown: number; readonly total: number; readonly stride: number; readonly band: boolean }): GlyphChartLedgerEntry {
  const { axis, shown, total, stride, band } = opts;
  return entry("ticks-thinned", `Showing ${shown} of ${total} ${axis}-axis ${band ? "categories" : "ticks"} so labels don't overlap.`, { axis, shown, total, stride });
}

export function ledgerTickDuplicateDropped(opts: { readonly axis: "x" | "y"; readonly label: string }): GlyphChartLedgerEntry {
  return entry("tick-duplicate-dropped", `Dropped a repeated "${opts.label}" label on the ${opts.axis} axis.`, { ...opts });
}

export function ledgerTitleDropped(opts: { readonly cols: number; readonly rows: number }): GlyphChartLedgerEntry {
  return entry("title-dropped", `Dropped the chart title to fit the chart in ${opts.cols}×${opts.rows}.`, { ...opts });
}

export function ledgerLegendDropped(opts: { readonly series: number; readonly cols: number; readonly rows: number }): GlyphChartLedgerEntry {
  return entry("legend-dropped", `Dropped the legend to fit the chart in ${opts.cols}×${opts.rows}.`, { ...opts });
}

export function ledgerLegendPlacementDegraded(opts: { readonly placement: string; readonly reason: string }): GlyphChartLedgerEntry {
  return entry("legend-placement-degraded", `Moved the legend to the bottom — ${opts.reason}.`, { ...opts });
}

export function ledgerLegendOverlapsMarks(opts: { readonly placement: string; readonly covered: number }): GlyphChartLedgerEntry {
  const plural = opts.covered === 1 ? "" : "s";
  return entry("legend-overlaps-marks", `The legend at the ${opts.placement} corner covers ${opts.covered} cell${plural} of chart data.`, { ...opts });
}

export function ledgerSeriesDodgeDegraded(opts: { readonly count: number; readonly width: number }): GlyphChartLedgerEntry {
  return entry("series-dodge-degraded", `There isn't room for ${opts.count} series side by side in a ${opts.width}-cell band, so they overlap.`, { ...opts });
}

/**
 * Shared by `arc` (a pie whose slices are all zero) and `funnel` (a funnel
 * whose stages are all zero) — both mean "nothing to draw" the same way,
 * so both go through this one code rather than a mark-specific pair.
 */
export function ledgerEmptyTotal(): GlyphChartLedgerEntry {
  return entry("empty-total", "Every value in this chart is zero, so nothing is drawn.");
}

export function ledgerSliceDropped(opts: { readonly dropped: number; readonly total: number }): GlyphChartLedgerEntry {
  const plural = opts.total === 1 ? "" : "s";
  return entry("slice-dropped", `Dropped ${opts.dropped} of ${opts.total} slice${plural} — negative values don't contribute to a pie.`, { ...opts });
}

export function ledgerDoubleDiagonalSolid(opts: { readonly col: number; readonly row: number }): GlyphChartLedgerEntry {
  return entry("double-diagonal-solid", `Drew a diagonal line near column ${opts.col}, row ${opts.row} solid — the double-line style has no diagonal form.`, { ...opts });
}

export function ledgerLabelAbbreviated(opts: { readonly role: string; readonly before: string; readonly after: string }): GlyphChartLedgerEntry {
  return entry("label-abbreviated", `Abbreviated the ${opts.role} from "${opts.before}" to "${opts.after}" to fit.`, { ...opts });
}

export function ledgerLabelDropped(opts: { readonly role: string; readonly text: string; readonly reason: string }): GlyphChartLedgerEntry {
  return entry("label-dropped", `Dropped the ${opts.role} "${opts.text}" — ${opts.reason}.`, { ...opts });
}

export function ledgerSankeyFoldedFlows(opts: { readonly source: string; readonly flows: readonly string[] }): GlyphChartLedgerEntry {
  return entry("sankey-folded-flows", `Combined ${opts.flows.length} thin flow${opts.flows.length === 1 ? "" : "s"} out of "${opts.source}" into one "other" band: ${opts.flows.join(", ")}.`, { ...opts });
}

export function ledgerSankeyImbalance(opts: { readonly node: string; readonly inflow: number; readonly outflow: number }): GlyphChartLedgerEntry {
  return entry("sankey-imbalance", `Node "${opts.node}" is unbalanced — ${opts.inflow} in vs ${opts.outflow} out.`, { ...opts });
}

export function ledgerFunnelNotMonotone(opts: { readonly stage: string; readonly value: number; readonly previousStage: string; readonly previousValue: number }): GlyphChartLedgerEntry {
  return entry("funnel-not-monotone", `Stage "${opts.stage}" (${opts.value}) is larger than "${opts.previousStage}" (${opts.previousValue}) above it.`, { ...opts });
}

export function ledgerFunnelThinStage(opts: { readonly stage: string; readonly value: number }): GlyphChartLedgerEntry {
  return entry("funnel-thin-stage", `Stage "${opts.stage}" is too small to draw proportionally — drew a one-cell stub instead.`, { ...opts });
}

export function ledgerSankeyCrossingsMerged(opts: { readonly gapX0: number; readonly gapX1: number; readonly crossing: number; readonly lanes: number }): GlyphChartLedgerEntry {
  const plural = opts.lanes === 1 ? "" : "s";
  return entry("sankey-crossings-merged", `Merged ${opts.crossing} crossing flows onto ${opts.lanes} lane${plural} — the gap between columns is too narrow to give each its own.`, { ...opts });
}

export function ledgerSankeyColumnsFolded(opts: { readonly folded: number; readonly total: number }): GlyphChartLedgerEntry {
  return entry("sankey-columns-folded", `Folded ${opts.folded} of ${opts.total} node columns to fit the chart width.`, { ...opts });
}

/**
 * The genuinely impossible case: more real (positive-value) nodes in one
 * column than the plot has rows, so not even the "bump every 0-row node to
 * 1" floor (P2-3) can seat them all. The biggest values keep their row;
 * these are the smallest ones that lost the tie-break.
 */
export function ledgerSankeyNodesDropped(opts: { readonly nodes: readonly string[] }): GlyphChartLedgerEntry {
  const plural = opts.nodes.length === 1 ? "" : "s";
  return entry("sankey-nodes-dropped", `${opts.nodes.length} node${plural} had no room left in their own column and aren't drawn — ${opts.nodes.join(", ")}.`, { ...opts });
}

export function ledgerFunnelFoldedStages(opts: { readonly stages: readonly string[] }): GlyphChartLedgerEntry {
  const plural = opts.stages.length === 1 ? "" : "s";
  return entry("funnel-folded-stages", `Folded ${opts.stages.length} stage${plural} into one "other" row to fit the chart height — ${opts.stages.join(", ")}.`, { ...opts });
}

export function ledgerFunnelBadReference(opts: { readonly value: number }): GlyphChartLedgerEntry {
  return entry("funnel-bad-reference", `The first stage's value (${opts.value}) isn't positive, so percentages are omitted.`, { ...opts });
}

export function ledgerMarkColorUnused(opts: { readonly markType: string; readonly provided: number; readonly used: number }): GlyphChartLedgerEntry {
  const plural = opts.used === 1 ? "is" : "are";
  return entry("mark-color-unused", `This ${opts.markType} mark's color option lists ${opts.provided} colors but only ${opts.used} ${plural} used.`, { ...opts });
}

export function ledgerSeriesColorConflict(opts: { readonly name: string; readonly kept: string; readonly rejected: string }): GlyphChartLedgerEntry {
  return entry("series-color-conflict", `Series "${opts.name}" was given two different colors across marks — kept ${opts.kept} and dropped ${opts.rejected}.`, { ...opts });
}

/**
 * The cell canvas (`glyphcss`) still reports its own "double style has no
 * diagonal analogue" note as a free-text string (`GlyphCanvasReport.ledger`
 * is shared with `@glyphcss/diagrams` too, and is out of this package's
 * scope) — this is the one and only shape it ever produces
 * (`packages/glyphcss/src/render/canvas/canvas.ts`), so it is parsed once
 * at the boundary rather than left as an unstructured passthrough entry.
 */
export function chartLedgerEntryFromCanvasMessage(raw: string): GlyphChartLedgerEntry {
  const match = /cell \((\d+), (\d+)\)/.exec(raw);
  return ledgerDoubleDiagonalSolid({ col: match ? Number(match[1]) : 0, row: match ? Number(match[2]) : 0 });
}
