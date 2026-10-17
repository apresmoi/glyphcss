/**
 * Sankey flows as lines (`layoutSankeyGraph` does the layout). Each node is a
 * one-column bar whose height is its throughput. A flow leaves its share of
 * the source bar as one stub per row, a bracket gathers the stubs into one
 * line, the line carries the flow's value, and a mirrored bracket fans it out
 * over its share of the target bar. Shares stay proportional on the bars;
 * the lines stay single, traceable paths. Line weight is a second hint of
 * size, and a vertical crossing another flow's line passes over it.
 */
import type { GlyphCanvas, GlyphCanvasTierName } from "glyphcss";
import { abbreviateChartText, chartText } from "./labels";
import { ledgerLabelDropped, ledgerSankeyBandUnroutable, ledgerSankeyCrossingsMerged, type GlyphChartLedgerEntry } from "./ledger";
import type { GlyphChartPlotRect } from "./layout";
import { formatLinearTick } from "./scales";
import { resolveSeriesColor, type ChartSeries } from "./series";
import type { GlyphChartSankeyLayout } from "./flowMarks";

type SankeyBand = GlyphChartSankeyLayout["bands"][number];

interface LineGlyphs {
  readonly h: string;
  readonly v: string;
  /** Corners named by the two arms they join. */
  readonly leftDown: string;
  readonly leftUp: string;
  readonly upRight: string;
  readonly downRight: string;
}
const HEAVY: LineGlyphs = { h: "━", v: "┃", leftDown: "┓", leftUp: "┛", upRight: "┗", downRight: "┏" };
const LIGHT: LineGlyphs = { h: "─", v: "│", leftDown: "╮", leftUp: "╯", upRight: "╰", downRight: "╭" };
const DASHED: LineGlyphs = { h: "┄", v: "┆", leftDown: "╮", leftUp: "╯", upRight: "╰", downRight: "╭" };
const ASCII_HEAVY: LineGlyphs = { h: "=", v: "|", leftDown: "+", leftUp: "+", upRight: "+", downRight: "+" };
const ASCII_LIGHT: LineGlyphs = { h: "-", v: "|", leftDown: "+", leftUp: "+", upRight: "+", downRight: "+" };
const ASCII_DASHED: LineGlyphs = { h: ".", v: ":", leftDown: "+", leftUp: "+", upRight: "+", downRight: "+" };

/** A flow at least this share of the largest flow draws heavy; under the lower share, dashed. */
const HEAVY_SHARE = 0.55;
const DASHED_BELOW_SHARE = 0.25;
/** Columns a flow's own run needs between its merges: its value plus a bend. */
const GLYPH_CHART_SANKEY_MIN_RUN = 8;
/** A share's tree spans at most this fraction (1 / n) of its gap. */
const GLYPH_CHART_SANKEY_TREE_GAP_SHARE = 4;

function lineGlyphs(tier: GlyphCanvasTierName, value: number, max: number): LineGlyphs {
  const ascii = tier === "ascii";
  if (value >= max * HEAVY_SHARE) return ascii ? ASCII_HEAVY : HEAVY;
  if (value >= max * DASHED_BELOW_SHARE) return ascii ? ASCII_LIGHT : LIGHT;
  return ascii ? ASCII_DASHED : DASHED;
}

/**
 * The bracket glyph for `row` of a share spanning `[r0, r1]` whose line
 * leaves (source) or arrives (target) on row `mid`.
 */
function bracketGlyph(ascii: boolean, side: "source" | "target", row: number, r0: number, r1: number, mid: number): string {
  if (r0 === r1) return ascii ? "-" : "─";
  if (row === mid) {
    if (ascii) return "+";
    return row > r0 && row < r1 ? "┼" : row > r0 ? "┴" : "┬";
  }
  if (ascii) return row === r0 || row === r1 ? "+" : "|";
  if (row === r0) return side === "source" ? "╮" : "╭";
  if (row === r1) return side === "source" ? "╯" : "╰";
  return side === "source" ? "┤" : "├";
}

interface Run { readonly row: number; readonly x0: number; readonly x1: number }
interface Bend { readonly col: number; readonly fromRow: number; readonly toRow: number }
interface FlowPath {
  readonly band: SankeyBand;
  readonly glyphs: LineGlyphs;
  readonly color: string | null;
  readonly runs: Run[];
  readonly bends: Bend[];
}

/** One stretch of a flow between two bars: in on `rowIn` at `x0`, out on `rowOut` at `x1`. */
interface GapSegment { readonly path: FlowPath; readonly rowIn: number; readonly rowOut: number; readonly x0: number; readonly x1: number }

const overlaps = (a0: number, a1: number, b0: number, b1: number) => a0 <= b1 && b0 <= a1;

/**
 * Paints `layout` as lines. Node bars sit in one column per depth; the left
 * and right columns keep a gutter for their labels, and a middle column's
 * label goes under (else over) its bar.
 */
export function paintSankeyLines(canvas: GlyphCanvas, plot: GlyphChartPlotRect, layout: GlyphChartSankeyLayout, groups: readonly ChartSeries[], colorEnabled: boolean, ledger: GlyphChartLedgerEntry[]): void {
  const tier = canvas.tier;
  const ascii = tier === "ascii";
  const text = (x: number, y: number, s: string, color: string | null = null) => { if (y >= plot.y0 && y <= plot.y1) canvas.text(x, y, [s], { color }); };

  const columnsX0 = [...new Set(layout.nodes.map((n) => n.x0))].sort((a, b) => a - b);
  const columnOf = new Map(layout.nodes.map((n) => [n.id, columnsX0.indexOf(n.x0)]));
  const last = columnsX0.length - 1;

  const inflow = new Map<string, number>(), outflow = new Map<string, number>();
  for (const b of layout.bands) {
    outflow.set(b.source, (outflow.get(b.source) ?? 0) + b.value);
    if (!b.folded) inflow.set(b.target, (inflow.get(b.target) ?? 0) + b.value);
  }
  const nodeValue = (id: string) => Math.max(inflow.get(id) ?? 0, outflow.get(id) ?? 0);
  const nodeLabel = (id: string) => chartText(`${id} ${formatLinearTick(nodeValue(id))}`, tier, { ledger, role: "sankey node label" });

  // Gutters for the outer columns' labels, a quarter of the plot at most.
  const plotWidth = plot.x1 - plot.x0 + 1;
  const gutterCap = Math.max(1, Math.floor(plotWidth / 4));
  const gutter = (col: number) => Math.min(gutterCap, Math.max(0, ...layout.nodes.filter((n) => columnOf.get(n.id) === col).map((n) => nodeLabel(n.id).length)) + 1);
  const leftGutter = gutter(0), rightGutter = last > 0 ? gutter(last) : 0;
  const barLeft = plot.x0 + leftGutter, barRight = plot.x1 - rightGutter;
  const barX = (col: number) => last === 0 ? barLeft : Math.round(barLeft + ((barRight - barLeft) * col) / last);

  const colorOf = new Map<string, string | null>();
  for (const g of groups) if (g.name !== undefined) colorOf.set(g.name, resolveSeriesColor(g, colorEnabled));

  // Bars.
  for (const n of layout.nodes) {
    const x = barX(columnOf.get(n.id)!);
    for (let y = n.y0; y <= n.y1; y++) text(x, y, ascii ? "#" : "█", colorOf.get(n.id) ?? null);
  }

  // Rows each column's bars occupy, so a skip-level flow can pass between them.
  const barRows = (col: number) => layout.nodes.filter((n) => columnOf.get(n.id) === col).map((n) => [n.y0, n.y1] as const);
  const passRowsUsed = new Map<number, Set<number>>();
  const freePassRow = (col: number, near: number): number | undefined => {
    const used = passRowsUsed.get(col) ?? new Set<number>();
    const blocked = (row: number) => used.has(row) || barRows(col).some(([a, b]) => row >= a && row <= b);
    for (let d = 0; d <= plot.y1 - plot.y0; d++) {
      for (const row of [Math.round(near) - d, Math.round(near) + d]) if (row >= plot.y0 && row <= plot.y1 && !blocked(row)) return row;
    }
    return undefined;
  };

  const maxValue = Math.max(0, ...layout.bands.map((b) => b.value));
  const paths: FlowPath[] = [];
  const segmentsByGap = new Map<number, GapSegment[]>();
  const midRow = (r: readonly [number, number]) => Math.floor((r[0] + r[1]) / 2);

  // How a share gathers into its line, chosen per gap between two columns:
  // with room, a tree that folds the outer rows inward one stage at a time
  // (2 columns a stage, else 1), no wider than a quarter of the gap, so a
  // tall share folds several rows per stage; else a single bracket. Every
  // flow touching the gap must fit its trees plus a run for its value.
  const halfHeight = (r: readonly [number, number]) => Math.max(midRow(r) - r[0], r[1] - midRow(r));
  const stageWidth = new Map<number, { readonly w: number; readonly stages: number }>();
  const stagesFor = (merge: { readonly w: number; readonly stages: number }, d: number) => Math.min(d, merge.stages);
  const treeWidth = (merge: { readonly w: number; readonly stages: number }, d: number) => merge.w === 0 ? 2 : d === 0 ? 1 : 1 + merge.w * stagesFor(merge, d) + 1;
  for (let gap = 0; gap < last; gap++) {
    const width = barX(gap + 1) - barX(gap) - 1;
    const cap = Math.floor(width / GLYPH_CHART_SANKEY_TREE_GAP_SHARE);
    const fits = (merge: { readonly w: number; readonly stages: number }) => merge.stages >= 1 && layout.bands.every((b) => {
      const sc = columnOf.get(b.source), tc = b.targetRowRange && !b.folded ? columnOf.get(b.target) : undefined;
      const fromHere = sc === gap, intoNext = tc === gap + 1;
      if (!fromHere && !intoNext) return true;
      const need = (fromHere ? treeWidth(merge, halfHeight(b.sourceRowRange)) : 0) + (intoNext ? treeWidth(merge, halfHeight(b.targetRowRange!)) : 0) + GLYPH_CHART_SANKEY_MIN_RUN;
      return need <= width;
    });
    const options = [2, 1].map((w) => ({ w, stages: Math.floor((cap - 2) / w) }));
    stageWidth.set(gap, options.find(fits) ?? { w: 0, stages: 0 });
  }
  // Cells a share's tree or bracket owns, so no other flow's line runs through them.
  const mergeOwner = new Map<number, FlowPath>();
  const own = (x: number, y: number, path: FlowPath, glyph: string) => { mergeOwner.set(y * canvas.cols + x, path); text(x, y, glyph, path.color); };
  /**
   * Draws a share's merge off `bar` (`dir` +1 to the right of a source, -1
   * to the left of a target); returns the column its line leaves from. In a
   * tree, rows at distance `d` from the share's middle row fold at stage
   * `ceil(d * stages / dmax)`: each stage's rows drop into the next row in,
   * outermost stage first, until the middle row carries them all.
   */
  const drawMerge = (bar: number, r: readonly [number, number], dir: 1 | -1, merge: { readonly w: number; readonly stages: number }, path: FlowPath): number => {
    const [r0, r1] = r, m = midRow(r), side = dir > 0 ? "source" : "target";
    const stub = ascii ? "-" : "─";
    if (merge.w === 0) {
      for (let y = r0; y <= r1; y++) { own(bar + dir, y, path, stub); own(bar + 2 * dir, y, path, bracketGlyph(ascii, side, y, r0, r1, m)); }
      return bar + 2 * dir;
    }
    if (r0 === r1) { own(bar + dir, m, path, stub); return bar + dir; }
    const dmax = halfHeight(r), stages = stagesFor(merge, dmax);
    const stageOf = (d: number) => Math.ceil((d * stages) / dmax);
    const col = (stage: number) => bar + dir * (1 + merge.w * (stages - stage + 1));
    const exists = (y: number) => y >= r0 && y <= r1;
    for (let y = r0; y <= r1; y++) {
      const d = Math.abs(y - m), above = y < m, out = above ? -1 : 1;
      if (d === 0) {
        for (let x = bar + dir; x !== col(1); x += dir) own(x, y, path, stub);
        own(col(1), y, path, ascii ? "+" : exists(m - 1) && exists(m + 1) ? "┼" : exists(m - 1) ? "┴" : "┬");
        continue;
      }
      const stage = stageOf(d), end = col(stage);
      // The next row out joins this one here when it belongs to a later stage.
      const joinAt = exists(y + out) && stageOf(d + 1) > stage ? col(stageOf(d + 1)) : undefined;
      for (let x = bar + dir; x !== end; x += dir) own(x, y, path, x === joinAt ? (ascii ? "+" : above ? "┴" : "┬") : stub);
      // The outermost row of its stage turns in; the others carry its drop on to the next row in.
      const outermost = !exists(y + out) || stageOf(d + 1) !== stage;
      own(end, y, path, ascii ? (outermost ? "+" : "|") : outermost ? (above ? (dir > 0 ? "╮" : "╭") : (dir > 0 ? "╯" : "╰")) : dir > 0 ? "┤" : "├");
    }
    return col(1);
  };

  for (const band of layout.bands) {
    const [s0, s1] = band.sourceRowRange;
    if (s0 > s1) continue;
    const sourceCol = columnOf.get(band.source);
    if (sourceCol === undefined) continue;
    const xs = barX(sourceCol);
    const path: FlowPath = { band, glyphs: lineGlyphs(tier, band.value, maxValue), color: colorOf.get(band.source) ?? null, runs: [], bends: [] };
    const sm = midRow(band.sourceRowRange);
    const sourceJoint = drawMerge(xs, band.sourceRowRange, 1, stageWidth.get(sourceCol) ?? { w: 0, stages: 0 }, path);
    if (band.folded || !band.targetRowRange) {
      // Flows too small to draw end in one short line, named "(other)".
      const end = Math.min(plot.x1, sourceJoint + 3);
      path.runs.push({ row: sm, x0: sourceJoint + 1, x1: end });
      paths.push(path);
      text(end + 2, sm, chartText("(other)", tier), path.color);
      continue;
    }
    const targetCol = columnOf.get(band.target);
    if (targetCol === undefined || targetCol <= sourceCol) continue;

    const xt = barX(targetCol), tm = midRow(band.targetRowRange);
    const targetJoint = drawMerge(xt, band.targetRowRange, -1, stageWidth.get(targetCol - 1) ?? { w: 0, stages: 0 }, path);
    // Posts the line threads: the source bracket, each intermediate bar on a
    // free row, the target bracket.
    let row = sm, x = sourceJoint + 1;
    for (let col = sourceCol + 1; col <= targetCol; col++) {
      const isTarget = col === targetCol;
      const towards = isTarget ? tm : sm + ((tm - sm) * (col - sourceCol)) / (targetCol - sourceCol);
      let next = isTarget ? tm : freePassRow(col, towards);
      if (next === undefined) {
        ledger.push(ledgerSankeyBandUnroutable({ source: band.source, target: band.target, blockingNodes: layout.nodes.filter((n) => columnOf.get(n.id) === col).map((n) => n.id) }));
        next = Math.round(towards);
      }
      if (!isTarget) {
        const used = passRowsUsed.get(col) ?? new Set<number>();
        used.add(next);
        passRowsUsed.set(col, used);
      }
      const gapEnd = isTarget ? targetJoint - 1 : barX(col) - 1;
      const list = segmentsByGap.get(col - 1) ?? [];
      list.push({ path, rowIn: row, rowOut: next, x0: x, x1: gapEnd });
      segmentsByGap.set(col - 1, list);
      if (!isTarget) path.runs.push({ row: next, x0: barX(col), x1: barX(col) });
      row = next;
      x = barX(col) + 1;
    }
    paths.push(path);
  }

  // Bend columns, one gap at a time: a bend may not share a horizontal row
  // span or a vertical column span with another flow, so lines only ever
  // meet at right-angle crossings.
  const clearOfMerges = (x0: number, x1: number, y0: number, y1: number, path: FlowPath) => {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) { const owner = mergeOwner.get(y * canvas.cols + x); if (owner && owner !== path) return false; }
    return true;
  };
  // Bends prefer to sit near the target, one cell short of its merge so the
  // corner never touches it, which keeps the run leaving the source long
  // enough to carry the flow's value. Greedy placement depends on the order
  // flows are placed in, so a few orders are tried and the one leaving the
  // fewest flows without a clean column wins.
  type Placement = { readonly runs: readonly [FlowPath, Run][]; readonly bends: readonly [FlowPath, Bend][]; readonly merged: number };
  const place = (segments: readonly GapSegment[], order: (a: GapSegment, b: GapSegment) => number, nearTarget: boolean): Placement => {
    const horizontal = new Map<number, [number, number, FlowPath][]>();
    const vertical = new Map<number, [number, number][]>();
    const runs: [FlowPath, Run][] = [], bends: [FlowPath, Bend][] = [];
    const takeRun = (row: number, x0: number, x1: number, path: FlowPath) => {
      horizontal.set(row, [...(horizontal.get(row) ?? []), [x0, x1, path]]);
      if (x0 <= x1) runs.push([path, { row, x0, x1 }]);
    };
    const runFree = (row: number, x0: number, x1: number, path: FlowPath) => !(horizontal.get(row) ?? []).some(([a, b, p]) => p !== path && overlaps(a, b, x0, x1)) && clearOfMerges(Math.min(x0, x1), Math.max(x0, x1), row, row, path);
    for (const s of segments) if (s.rowIn === s.rowOut) takeRun(s.rowIn, s.x0, s.x1, s.path);
    let merged = 0;
    for (const s of segments.filter((x) => x.rowIn !== x.rowOut).sort(order)) {
      const top = Math.min(s.rowIn, s.rowOut), bottom = Math.max(s.rowIn, s.rowOut);
      const fits = (c: number) => runFree(s.rowIn, s.x0, c, s.path) && runFree(s.rowOut, c, s.x1, s.path) && !(vertical.get(c) ?? []).some(([a, b]) => overlaps(a, b, top, bottom)) && clearOfMerges(c, c, top, bottom, s.path);
      const inner = s.x1 - 1 > s.x0 ? Array.from({ length: s.x1 - 1 - s.x0 }, (_, i) => s.x1 - 1 - i) : [];
      const candidates = inner.length === 0 ? [Math.max(s.x0, s.x1)] : nearTarget ? [...inner, s.x1] : [...inner.reverse(), s.x1];
      let col = candidates.find(fits);
      if (col === undefined) { col = candidates[0]!; merged++; }
      takeRun(s.rowIn, s.x0, col - 1, s.path);
      takeRun(s.rowOut, col + 1, s.x1, s.path);
      vertical.set(col, [...(vertical.get(col) ?? []), [top, bottom]]);
      bends.push([s.path, { col, fromRow: s.rowIn, toRow: s.rowOut }]);
    }
    return { runs, bends, merged };
  };
  const span = (s: GapSegment) => Math.abs(s.rowOut - s.rowIn);
  const orders: readonly ((a: GapSegment, b: GapSegment) => number)[] = [(a, b) => span(a) - span(b), (a, b) => span(b) - span(a), (a, b) => a.rowIn - b.rowIn, (a, b) => b.rowIn - a.rowIn];
  for (const [gap, segments] of segmentsByGap) {
    let best: Placement | undefined;
    for (const nearTarget of [true, false]) for (const order of orders) {
      const candidate = place(segments, order, nearTarget);
      if (!best || candidate.merged < best.merged) best = candidate;
      if (best.merged === 0) break;
    }
    for (const [path, run] of best!.runs) path.runs.push(run);
    for (const [path, bend] of best!.bends) path.bends.push(bend);
    if (best!.merged > 0) {
      const lo = barX(gap) + 3, hi = barX(gap + 1) - 3;
      ledger.push(ledgerSankeyCrossingsMerged({ gapX0: lo, gapX1: hi, crossing: segments.filter((x) => x.rowIn !== x.rowOut).length, lanes: Math.max(0, hi - lo + 1), bands: best!.merged }));
    }
  }

  // Horizontal runs first, then bends: a vertical crossing another flow's
  // line passes over it.
  for (const p of paths) for (const r of p.runs) for (let x = r.x0; x <= r.x1; x++) text(x, r.row, p.glyphs.h, p.color);
  for (const p of paths) {
    for (const b of p.bends) {
      const down = b.toRow > b.fromRow;
      text(b.col, b.fromRow, down ? p.glyphs.leftDown : p.glyphs.leftUp, p.color);
      for (let y = Math.min(b.fromRow, b.toRow) + 1; y < Math.max(b.fromRow, b.toRow); y++) text(b.col, y, p.glyphs.v, p.color);
      text(b.col, b.toRow, down ? p.glyphs.upRight : p.glyphs.downRight, p.color);
    }
  }

  // Each flow's value, on its longest run where nothing crosses it.
  const cell = (x: number, y: number) => canvas.grid.char[y * canvas.cols + x];
  for (const p of paths) {
    const label = ` ${formatLinearTick(p.band.value)} `;
    const runs = [...p.runs].sort((a, b) => (b.x1 - b.x0) - (a.x1 - a.x0));
    let placed = false;
    for (const r of runs) {
      const length = r.x1 - r.x0 + 1;
      if (length < label.length + 2) continue;
      const centre = r.x0 + Math.floor((length - label.length) / 2);
      for (let d = 0; d <= length && !placed; d++) {
        for (const start of [centre - d, centre + d]) {
          if (start < r.x0 + 1 || start + label.length - 1 > r.x1 - 1) continue;
          let clear = true;
          for (let x = start; x < start + label.length; x++) if (cell(x, r.row) !== p.glyphs.h) { clear = false; break; }
          if (!clear) continue;
          text(start, r.row, label, p.color);
          placed = true;
          break;
        }
      }
      if (placed) break;
    }
    if (!placed) ledger.push(ledgerLabelDropped({ role: "sankey flow value", text: `${p.band.source} → ${p.band.target} ${label.trim()}`, reason: "no stretch of its line was long and clear enough" }));
  }

  // Node labels: outer columns in their gutters, middle columns under (else
  // over) their bar where nothing is drawn.
  const clearAt = (x: number, y: number, length: number) => {
    if (y < plot.y0 || y > plot.y1 || x < plot.x0 || x + length - 1 > plot.x1) return false;
    for (let i = x; i < x + length; i++) if (cell(i, y) !== " ") return false;
    return true;
  };
  for (const n of layout.nodes) {
    const col = columnOf.get(n.id)!;
    const x = barX(col), mid = Math.floor((n.y0 + n.y1) / 2);
    if (col === 0 || col === last) {
      const width = (col === 0 ? leftGutter : rightGutter) - 1;
      const label = abbreviateChartText(nodeLabel(n.id), width, tier).text;
      if (!label) { ledger.push(ledgerLabelDropped({ role: "sankey node label", text: n.id, reason: "its column's label gutter is too narrow" })); continue; }
      text(col === 0 ? x - 1 - label.length : x + 2, mid, label, colorOf.get(n.id) ?? null);
      continue;
    }
    // Centred under (else over, else a row further off) the bar, sliding sideways up to half the
    // distance to the next column when the centred spot is drawn on.
    const label = nodeLabel(n.id);
    const centred = x - Math.floor(label.length / 2);
    const reach = Math.max(0, Math.floor((barX(Math.min(last, col + 1)) - x) / 2));
    let spot: { x: number; y: number } | undefined;
    for (const y of [n.y1 + 1, n.y0 - 1, n.y1 + 2, n.y0 - 2]) {
      for (let d = 0; d <= reach && !spot; d++) for (const start of [centred - d, centred + d]) if (!spot && clearAt(start, y, label.length)) spot = { x: start, y };
      if (spot) break;
    }
    if (!spot) { ledger.push(ledgerLabelDropped({ role: "sankey node label", text: n.id, reason: "no clear row above or below its bar" })); continue; }
    text(spot.x, spot.y, label, colorOf.get(n.id) ?? null);
  }
}

