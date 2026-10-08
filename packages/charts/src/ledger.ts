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

/**
 * `axes.y.titleAt: "bottom"` shares the x-axis title's own row when the y
 * title fits to its left; when it doesn't (both titles genuinely want the
 * bottom row and there isn't room to fit both on one), the y title claims a
 * second row of its own instead — this records that fallback, mirroring
 * `legend-placement-degraded`'s own "moved it, here's why" shape.
 */
export function ledgerAxisTitleStacked(opts: { readonly cols: number; readonly rows: number }): GlyphChartLedgerEntry {
  return entry("axis-title-stacked", `Gave the y-axis title its own row below the x-axis title — they don't fit side by side in ${opts.cols}×${opts.rows}.`, { ...opts });
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
 * whose stages are all zero) — both mean "nothing to draw" the same way, so
 * both go through this one code, but each keeps its OWN wording: generalising
 * the message to a mark-neutral "chart" silently changed what an existing
 * `arc` caller's CLI/log output printed (round 2 N9) — `subject` is a required
 * argument, not a shared default, so a future third mark can't reintroduce
 * that by omission.
 */
export function ledgerEmptyTotal(subject: "pie" | "funnel"): GlyphChartLedgerEntry {
  const consequence = subject === "pie" ? "no slices are drawn" : "nothing is drawn";
  return entry("empty-total", `Every value in this ${subject} is zero, so ${consequence}.`, { subject });
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

/**
 * `stubVisible` (default `true`) — the folded bucket itself can round to 0
 * rows when its own residual is negligible against the kept links' share
 * (`ensureFoldStubVisible`'s reclaim finds no spare row anywhere), so a
 * reader has every folded flow NAMED here but no cell on the chart to
 * point at (sankey round-3 review, finding l/R6: measured on 2,028 of
 * 6,400 swept fold configurations). `false` says so explicitly rather than
 * leaving the reader to notice the missing band on their own.
 */
export function ledgerSankeyFoldedFlows(opts: { readonly source: string; readonly flows: readonly string[]; readonly stubVisible?: boolean }): GlyphChartLedgerEntry {
  const invisible = opts.stubVisible === false;
  const suffix = invisible ? " — the combined band itself rounded to 0 rows and isn't drawn" : "";
  return entry("sankey-folded-flows", `Combined ${opts.flows.length} thin flow${opts.flows.length === 1 ? "" : "s"} out of "${opts.source}" into one "other" band: ${opts.flows.join(", ")}${suffix}.`, { ...opts });
}

export function ledgerSankeyImbalance(opts: { readonly node: string; readonly inflow: number; readonly outflow: number }): GlyphChartLedgerEntry {
  return entry("sankey-imbalance", `Node "${opts.node}" is unbalanced — ${opts.inflow} in vs ${opts.outflow} out.`, { ...opts });
}

/**
 * A band's own painted run was interrupted by another band's genuine
 * crossing — border cells and node conservation stay exact (never a
 * silent loss of the QUANTITY), but the reader-visible run itself can
 * split into two or more disconnected pieces (sankey round-3 review,
 * finding k). `cells` is the COUNT of the band's own DISTINCT cells lost
 * to another band's (or an earlier mark's) genuine claim — a `Set` of cell
 * indices per band, not a running counter (sankey round-4 review, N3): a
 * multi-row band's own several rows routinely cross the SAME foreign-owned
 * cell at a shared free-row detour, and counting each crossing as its own
 * unit over-reported by 5x on the energy dataset's own `Natural Gas ->
 * Industrial` (576 counted vs 111 distinct cells at 140x40).
 */
export function ledgerSankeyBandBroken(opts: { readonly source: string; readonly target: string; readonly cells: number }): GlyphChartLedgerEntry {
  const plural = opts.cells === 1 ? "" : "s";
  return entry("sankey-band-broken", `The "${opts.source} → ${opts.target}" band's own run is broken by a crossing band for ${opts.cells} cell${plural}.`, { ...opts });
}

/**
 * A skip-level band with NO route at all: some column it must cross is
 * filled top to bottom by node boxes, so every row of that column belongs to
 * a node that isn't the band's own endpoint. Drawing it through one of those
 * boxes would read as flow passing THROUGH that node — a false statement
 * about the data — so the band is drawn as two stubs instead, one leaving
 * its source and one arriving at its target, and named here. `blockingNodes`
 * are the nodes filling the column.
 */
export function ledgerSankeyBandUnroutable(opts: { readonly source: string; readonly target: string; readonly blockingNodes: readonly string[] }): GlyphChartLedgerEntry {
  const names = opts.blockingNodes.map((n) => `"${n}"`).join(", ");
  return entry("sankey-band-unroutable", `The "${opts.source} → ${opts.target}" band has no row clear of ${names} to cross by, so it is drawn as a stub leaving "${opts.source}" and a stub arriving at "${opts.target}".`, { ...opts });
}

export function ledgerFunnelNotMonotone(opts: { readonly stage: string; readonly value: number; readonly previousStage: string; readonly previousValue: number }): GlyphChartLedgerEntry {
  return entry("funnel-not-monotone", `Stage "${opts.stage}" (${opts.value}) is larger than "${opts.previousStage}" (${opts.previousValue}) above it.`, { ...opts });
}

export function ledgerFunnelThinStage(opts: { readonly stage: string; readonly value: number }): GlyphChartLedgerEntry {
  return entry("funnel-thin-stage", `Stage "${opts.stage}" is too small to draw proportionally — drew a one-cell stub instead.`, { ...opts });
}

/**
 * `crossing`/`lanes` are COLUMN counts (the packed ribbon width against
 * what actually fit), not a count of flows — a gap holding 4 bent bands
 * can legitimately reserve 15 columns (7+4+4) against 12 available, and
 * the earlier wording ("merged 15 crossing FLOWS") reported that width as
 * if it were the band count, understating how many columns a SINGLE wide
 * band needs and overstating how many bands were actually involved
 * (sankey round-3 review, finding l/R3). `bands` is the actual bent-band
 * count sharing this gap.
 */
export function ledgerSankeyCrossingsMerged(opts: { readonly gapX0: number; readonly gapX1: number; readonly crossing: number; readonly lanes: number; readonly bands: number }): GlyphChartLedgerEntry {
  const bandPlural = opts.bands === 1 ? "" : "s";
  const colPlural = opts.lanes === 1 ? "" : "s";
  return entry("sankey-crossings-merged", `Packed ${opts.bands} crossing band${bandPlural} into ${opts.crossing} columns, but only ${opts.lanes} column${colPlural} fit — the gap between columns is too narrow to give each its own.`, { ...opts });
}

export function ledgerSankeyColumnsFolded(opts: { readonly folded: number; readonly total: number; readonly droppedLinks?: readonly string[] }): GlyphChartLedgerEntry {
  const dropped = opts.droppedLinks ?? [];
  const suffix = dropped.length > 0
    ? ` ${dropped.length} link${dropped.length === 1 ? "" : "s"} now share a column and aren't drawn: ${dropped.join(", ")}.`
    : "";
  return entry("sankey-columns-folded", `Folded ${opts.folded} of ${opts.total} node columns to fit the chart width.${suffix}`, { ...opts, droppedLinks: dropped });
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

/**
 * A sankey's visual AIR — `GLYPH_CHART_SANKEY_NODE_PADDING_ROWS` between
 * stacked node boxes in one column, `GLYPH_CHART_SANKEY_LINK_GAP_ROWS`
 * between consecutive bands leaving/entering one node — is a LAYOUT
 * decision (`flowMarks.ts`'s `sankeyAirGap`), reserved from the available
 * rows BEFORE the cumulative-rounding split so a degraded gap is a planned
 * absence, never a lost cell. Reported once per column (`where: "node
 * padding"`) or once per node (`where: "link gap"`) only when the gap was
 * fully dropped (0 rows), never merely scaled down from its desired size.
 */
export function ledgerSankeyAirDropped(opts: { readonly where: "node padding" | "link gap"; readonly id: string; readonly requestedRows: number }): GlyphChartLedgerEntry {
  const subject = opts.where === "node padding"
    ? `the gap between "${opts.id}"'s own stacked node boxes`
    : `the gap between "${opts.id}"'s own bands`;
  return entry("sankey-air-dropped", `There isn't room for ${subject} — drawing them without it.`, { ...opts });
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

/**
 * An explicit `regionFill: "solid"` the render cannot honour without making
 * two series identical (`regionFill.ts`) — colour off, two series resolving
 * to one colour, or a sankey/funnel mark that still paints textures. The
 * render falls back to textures; `reason` is the resolver's own code.
 */
export function ledgerRegionFillSolidRefused(opts: { readonly reason: string; readonly explanation: string; readonly colliding?: readonly [string, string] }): GlyphChartLedgerEntry {
  return entry("region-fill-solid-refused", `Kept textured fills instead of solid ones. ${opts.explanation}`, { reason: opts.reason, ...(opts.colliding ? { colliding: opts.colliding } : {}) });
}

export function ledgerSeriesColorConflict(opts: { readonly name: string; readonly kept: string; readonly rejected: string }): GlyphChartLedgerEntry {
  return entry("series-color-conflict", `Series "${opts.name}" was given two different colors across marks — kept ${opts.kept} and dropped ${opts.rejected}.`, { ...opts });
}

/**
 * `series.ts`'s `seriesShade` cycles a fixed-length monochrome fill/shade
 * glyph set (`GLYPH_CHART_SHADE_CYCLE_LENGTH`, 8 on every charset) — past
 * that many series in one shade family the glyph is no longer injective, so
 * two categories read as the same fill with colour off. Reported once per
 * repeated pair (never per cell painted), naming both series by name so a
 * reader of `report.ledger` knows exactly which two collided.
 */
export function ledgerSeriesShadeRepeat(opts: { readonly repeated: string; readonly reused: string }): GlyphChartLedgerEntry {
  return entry("series-shade-repeat", `Series "${opts.repeated}" and series "${opts.reused}" share a fill glyph because there are more series than distinct monochrome fills.`, { ...opts });
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
