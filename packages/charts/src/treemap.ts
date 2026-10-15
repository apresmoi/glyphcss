import { GLYPH_CANVAS_TIERS, type GlyphCanvas } from "glyphcss";
import { accessorFor } from "./channels";
import { chartText } from "./labels";
import { ledgerTreemapOmitted, type GlyphChartLedgerEntry } from "./ledger";
import { formatLinearTick } from "./scales";
import type { GlyphChartMark, GlyphChartMarkRow, GlyphChartPlotRect } from "./types";

function invalid(message: string): never {
  throw Object.assign(new Error(`glyphcss: treemap-hierarchy: ${message}`), { code: "treemap-hierarchy" });
}
export function resolveTreemapRows(mark: GlyphChartMark): GlyphChartMarkRow[] {
  const id = accessorFor(mark.channels.id), parent = accessorFor(mark.channels.parent);
  const value = accessorFor(mark.channels.value), label = accessorFor(mark.channels.label);
  const rows = mark.data.map((datum, index) => {
    const identity = String(id?.(datum, index) ?? index);
    return { x: identity, y: Number(value?.(datum, index) ?? 0), parent: String(parent?.(datum, index) ?? ""), label: String(label?.(datum, index) ?? identity), index };
  });
  const byId = new Map(rows.map((r) => [r.x, r]));
  if (byId.size !== rows.length || byId.has("")) invalid("Node ids must be unique and nonempty.");
  for (const row of rows) {
    if (!Number.isFinite(row.y) || row.y < 0) invalid("Leaf values must be finite and nonnegative.");
    const seen = new Set([row.x]);
    let p = row.parent;
    while (p) {
      if (!byId.has(p)) invalid(`Unknown parent ${p}.`);
      if (seen.has(p)) invalid("Parents must form an acyclic hierarchy.");
      seen.add(p); p = byId.get(p)!.parent;
    }
  }
  return rows;
}
interface Node { row: GlyphChartMarkRow; value: number; children: Node[] }
interface Tile { node: Node; x: number; y: number; w: number; h: number }

/** Standard squarify: append while the worst aspect ratio improves, then consume the short side. */
export function squarify(nodes: readonly { value: number }[], width: number, height: number): { x: number; y: number; w: number; h: number; index: number }[] {
  const max = nodes.reduce((m, n) => Math.max(m, n.value), 0);
  const total = nodes.reduce((s, n) => s + n.value / max, 0);
  if (!(total > 0) || width <= 0 || height <= 0) return [];
  const pending = nodes.map((n, index) => ({ area: n.value / max / total * width * height, index })).filter((n) => n.area > 0).sort((a, b) => b.area - a.area);
  const out: { x: number; y: number; w: number; h: number; index: number }[] = [];
  let x = 0, y = 0, w = width, h = height;
  const worst = (row: typeof pending, side: number) => {
    if (!row.length || side <= 0) return Infinity;
    const sum = row.reduce((s, n) => s + n.area, 0), lo = row[row.length - 1]!.area, hi = row[0]!.area;
    return Math.max(side * side * hi / (sum * sum), sum * sum / (side * side * lo));
  };
  while (pending.length) {
    const row = [pending.shift()!], side = Math.min(w, h);
    while (pending.length && worst([...row, pending[0]!], side) <= worst(row, side)) row.push(pending.shift()!);
    const area = row.reduce((s, n) => s + n.area, 0);
    const vertical = w >= h, thickness = area / (vertical ? h : w);
    let offset = 0;
    for (const item of row) {
      const length = item.area / thickness;
      out.push({ index: item.index, x: x + (vertical ? 0 : offset), y: y + (vertical ? offset : 0), w: vertical ? thickness : length, h: vertical ? length : thickness });
      offset += length;
    }
    if (vertical) { x += thickness; w = Math.max(0, w - thickness); }
    else { y += thickness; h = Math.max(0, h - thickness); }
  }
  return out;
}

export function paintTreemap(canvas: GlyphCanvas, plot: GlyphChartPlotRect, rows: readonly GlyphChartMarkRow[], color: string | null, ledger: GlyphChartLedgerEntry[], scale: number): void {
  const nodes = new Map(rows.map((row) => [String(row.x), { row, value: Number(row.y), children: [] } as Node]));
  const roots: Node[] = [];
  for (const node of nodes.values()) (node.row.parent ? nodes.get(node.row.parent)!.children : roots).push(node);
  const maximum = rows.reduce((m, row) => Math.max(m, Number(row.y)), 1);
  const order: Node[] = [], pending = [...roots];
  while (pending.length) { const node = pending.pop()!; order.push(node); for (const child of node.children) pending.push(child); }
  for (const node of order.reverse()) node.value = node.children.length ? node.children.reduce((s, n) => s + n.value, 0) : node.value / maximum;
  const tier = GLYPH_CANVAS_TIERS[canvas.tier];
  // Inclusive partition endpoints let siblings share cells; OR masks preserve every T/cross junction.
  const borders = new Map<number, number>();
  const edge = (x: number, y: number, mask: number) => { const key = y * canvas.cols + x; borders.set(key, (borders.get(key) ?? 0) | mask); };
  const rect = (x: number, y: number, w: number, h: number) => {
    for (let c = x; c < x + w; c++) {
      const mask = (c > x ? 8 : 0) | (c < x + w - 1 ? 2 : 0);
      edge(c, y, mask | (c === x || c === x + w - 1 ? 4 : 0));
      edge(c, y + h - 1, mask | (c === x || c === x + w - 1 ? 1 : 0));
    }
    for (let r = y + 1; r < y + h - 1; r++) { edge(x, r, 5); edge(x + w - 1, r, 5); }
  };
  const paint = (children: Node[], x: number, y: number, w: number, h: number) => {
    if (w < 3 || h < 3) { for (const child of children) ledger.push(ledgerTreemapOmitted({ label: String(child.row.label), reason: "no room below the branch header" })); return; }
    for (const child of children) if (!child.value) ledger.push(ledgerTreemapOmitted({ label: String(child.row.label), reason: "zero or unrepresentable area" }));
    const aspect = canvas.cellAspect;
    const tiles: Tile[] = squarify(children, (w - 1) * aspect, h - 1).map((t) => ({ node: children[t.index]!, x: x + Math.round(t.x / aspect), y: y + Math.round(t.y), w: Math.round((t.x + t.w) / aspect) - Math.round(t.x / aspect) + 1, h: Math.round(t.y + t.h) - Math.round(t.y) + 1 }));
    for (const { node, x: xx, y: yy, w: ww, h: hh } of tiles) {
      if (ww < 3 || hh < 3) { ledger.push(ledgerTreemapOmitted({ label: String(node.row.label), reason: "less than one bordered cell" })); continue; }
      rect(xx, yy, ww, hh);
      const label = chartText(String(node.row.label), canvas.tier);
      const value = formatLinearTick(Number(node.row.y));
      const text = `${label}${node.children.length ? "" : ` ${value}`}`;
      const cols = Math.floor((ww - 2 - 2 * scale) / scale), rows = Math.floor((hh - 2) / scale);
      let lines = [text];
      if (text.length > cols && !node.children.length) {
        lines = [];
        for (const word of label.split(/\s+/)) {
          const last = lines[lines.length - 1];
          if (last && last.length + 1 + word.length <= cols) lines[lines.length - 1] = `${last} ${word}`;
          else lines.push(word);
        }
        lines.push(value);
      }
      if (lines.length <= rows && lines.every((line) => line.length <= cols)) canvas.text(xx + 1 + scale, yy + 1, lines, { color, scale });
      else ledger.push(ledgerTreemapOmitted({ label: String(node.row.label), reason: "label does not fit" }));
      if (node.children.length) paint(node.children, xx, yy + 1 + scale, ww, hh - 1 - scale);
    }
  };
  paint(roots, plot.x0, plot.y0, plot.x1 - plot.x0 + 1, plot.y1 - plot.y0 + 1);
  for (const [key, mask] of borders) canvas.text(key % canvas.cols, Math.floor(key / canvas.cols), [tier.junction[mask]!], { color });
}
