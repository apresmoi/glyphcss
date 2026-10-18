import { GLYPH_MERMAID_BLOCK, type GlyphMermaidBlockGraph, type GlyphMermaidBlockGrid } from "./mermaidStructured";
import { measureGlyphGraph, validateGlyphDiagramLayoutOptions, glyphDiagramPortOffsets, glyphDiagramNodePortSide, glyphDiagramWords, type GlyphDiagramLayout, type GlyphDiagramPositionedNode, type GlyphDiagramPositionedPort, type GlyphDiagramRect, GLYPH_DIAGRAM_GROUP_PAD } from "./pipeline";
import { GLYPH_DIAGRAM_GROUP_BOUNDS } from "./layoutHints";
import { routeGlyphGraphEdges } from "./route";
import { paintGlyphDiagram } from "./paint";
import { glyphDiagramGraphLabels } from "./graphLabels";
import { glyphDiagramRouteQuality } from "./routeQuality";
import { ledgerMermaidDegraded, ledgerLayoutExpanded, dedupeGlyphDiagramLedger, type GlyphDiagramLedgerEntry } from "./ledger";
import type { GlyphDiagramRenderOptions, GlyphDiagramResult } from "./renderTypes";
import type { GlyphCanvasDirection } from "glyphcss";

interface GridBox { width: number; height: number; nodes: GlyphDiagramPositionedNode[]; frames: Map<string, GlyphDiagramRect>; wrapped: boolean }

/** Only placement is block-specific. Measurement, approved borders, labels and A* stay shared. */
export function glyphTryRenderMermaidBlock(graph: GlyphMermaidBlockGraph, notes: GlyphDiagramLedgerEntry[], options: GlyphDiagramRenderOptions & { width: number; height: number }): GlyphDiagramResult | undefined {
  const root = graph[GLYPH_MERMAID_BLOCK];
  if (!root) return;
  validateGlyphDiagramLayoutOptions(options);
  const note = (kind: string, message: string) => notes.push(ledgerMermaidDegraded({ kind, message }));
  if (!graph.nodes.length) {
    note("block-empty", "Empty or space-only blocks render an empty canvas; no placeholder block is drawn.");
    const layout: GlyphDiagramLayout = { nodes: [], edges: [], groups: [], ports: [], loops: [], direction: graph.direction, width: options.width, height: options.height, ledger: [] };
    const painted = paintGlyphDiagram(layout, { routes: [], unroutable: [], ledger: [] }, options);
    return { ...painted, pages: [painted], meta: { nodes: [], edges: [], groups: [], description: "Empty block grid; 1 panel." }, report: { ledger: dedupeGlyphDiagramLedger([...notes, ...painted.ledger]), unsupportedGlyphs: painted.unsupportedGlyphs, unroutable: [] } };
  }
  if (options.detail === "simplified" || graph.edges.some(e => e.from === e.to)) { note("block-layout", "Block grid yields to graph layout for simplified detail or self-loops."); return; }
  // Whole words set the lower bound; wrapping labels must precede reducing columns.
  const labelWidth = Math.max(options.labelWidth ?? 18, ...graph.nodes.flatMap(n => glyphDiagramWords(n.label, Infinity).map(w => w.length)));
  const initial = measureGlyphGraph(graph, options);
  const measured = labelWidth === (options.labelWidth ?? 18) ? initial : measureGlyphGraph(graph, { ...options, labelWidth });
  const byId = new Map(measured.nodes.map(node => [node.id, node]));
  const measures = new Map([[labelWidth, byId]]);
  const atWidth = (id: string, width: number) => {
    if (!measures.has(width)) measures.set(width, new Map(measureGlyphGraph(graph, { ...options, labelWidth: width }).nodes.map(node => [node.id, node])));
    return measures.get(width)!.get(id)!;
  };
  const gap = graph.edges.length ? 4 : 3, rowGap = graph.edges.length ? 4 : 1, pad = GLYPH_DIAGRAM_GROUP_PAD;
  const shiftRect = (rect: GlyphDiagramRect, x: number, y: number) => ({ x0: rect.x0 + x, x1: rect.x1 + x, y0: rect.y0 + y, y1: rect.y1 + y });
  const shift = (node: GlyphDiagramPositionedNode, x: number, y: number) => ({ ...node, ...shiftRect(node, x, y) });
  const cache = new Map<GlyphMermaidBlockGrid, Map<number, GridBox | undefined>>();
  const build = (grid: GlyphMermaidBlockGrid, budget: number): GridBox | undefined => {
    const cached = cache.get(grid);
    if (cached?.has(budget)) return cached.get(budget);
    const remember = (box: GridBox | undefined) => { if (!cache.has(grid)) cache.set(grid, new Map()); cache.get(grid)!.set(budget, box); return box; };
    if (!grid.cells.length) {
      const node = grid.id ? byId.get(grid.id) : undefined;
      return remember(node && node.width <= budget ? { width: node.width, height: node.height, nodes: [{ ...node, x0: 0, y0: 0, x1: node.width - 1, y1: node.height - 1 }], frames: new Map(), wrapped: false } : undefined);
    }
    const authored = grid.columns ?? grid.cells.reduce((sum, cell) => sum + cell.span, 0);
    // No arrays proportional to unbounded authored column/span counts.
    if (authored > 256 || grid.cells.some(cell => cell.span > 256 || cell.span < 1)) return remember(undefined);
    for (let columns = authored; columns >= 1; columns--) {
      const maxColumn = Math.floor((budget - gap * (columns - 1)) / columns);
      if (maxColumn < 5) continue;
      const parts: { box: GridBox; column: number; row: number; span: number; grid?: GlyphMermaidBlockGrid }[] = [];
      let col = 0, row = 0, wrapped = columns !== authored, fits = true;
      for (const cell of grid.cells) {
        const span = Math.min(cell.span, columns), available = span * maxColumn + gap * (span - 1);
        if (span !== cell.span) wrapped = true;
        if (col && col + span > columns) { col = 0; row++; }
        const child = cell.grid ? build(cell.grid, available - 2 * pad) : undefined;
        let node = cell.id ? byId.get(cell.id) : undefined;
        if (node && !cell.grid && node.width > available) {
          const width = available - 4 - (node.shape === "subroutine" ? 2 : 0);
          if (width < Math.max(1, ...glyphDiagramWords(node.label, Infinity).map(word => word.length))) { fits = false; break; }
          node = atWidth(node.id, width);
        }
        const degree = Math.max(measured.edges.filter(e => e.from === cell.id).length, measured.edges.filter(e => e.to === cell.id).length);
        const width = node ? Math.max(node.width, 2 * degree + 1) : 5;
        const height = node ? Math.max(node.height, 2 * degree + 1) : 3;
        const caption = measured.groups.find(group => group.id === cell.grid?.id)?.label ?? "";
        const box: GridBox = child ? { ...child, width: Math.max(child.width + 2 * pad, caption.length + 4), height: child.height + 2 * pad,
          nodes: child.nodes.map(n => shift(n, pad, pad)), frames: new Map([...child.frames].map(([id, rect]) => [id, shiftRect(rect, pad, pad)])) }
          : node ? { width, height, nodes: [{ ...node, width, height, x0: 0, y0: 0, x1: width - 1, y1: height - 1 }], frames: new Map(), wrapped: false }
          : { width: 5, height: 3, nodes: [], frames: new Map(), wrapped: false };
        if (cell.grid && !child || box.width > available) { fits = false; break; }
        parts.push({ box, column: col, row, span, grid: cell.grid });
        wrapped ||= box.wrapped; col += span;
        if (col === columns) { col = 0; row++; }
      }
      if (!fits) continue;
      // One shared unit makes every span N exactly N columns plus N-1 gaps,
      // regardless of label length or which row first establishes that span.
      const columnWidth = Math.max(5, ...parts.map(part => Math.ceil((part.box.width - gap * (part.span - 1)) / part.span)));
      const heights = Array<number>(Math.max(...parts.map(p => p.row)) + 1).fill(3);
      for (const part of parts) heights[part.row] = Math.max(heights[part.row]!, part.box.height);
      const width = columns * columnWidth + gap * (columns - 1);
      if (width > budget) continue;
      const frames = new Map<string, GlyphDiagramRect>();
      const placed = parts.flatMap(part => {
        const x = part.column * (columnWidth + gap);
        const y = heights.slice(0, part.row).reduce((sum, h) => sum + h + rowGap, 0);
        const cellWidth = part.span * columnWidth + gap * (part.span - 1);
        if (part.box.nodes.length === 1 && !part.grid) {
          const node = part.box.nodes[0]!;
          return [{ ...shift(node, x, y), width: cellWidth, height: heights[part.row]!, x1: x + cellWidth - 1, y1: y + heights[part.row]! - 1 }];
        }
        const dx = x + Math.floor((cellWidth - part.box.width) / 2);
        for (const [id, rect] of part.box.frames) frames.set(id, shiftRect(rect, dx, y));
        if (part.grid?.id && graph.groups?.some(group => group.id === part.grid!.id)) frames.set(part.grid.id, { x0: x, y0: y, x1: x + cellWidth - 1, y1: y + heights[part.row]! - 1 });
        return part.box.nodes.map(n => shift(n, dx, y));
      });
      return remember({ width, height: heights.reduce((sum, h) => sum + h, 0) + rowGap * (heights.length - 1), nodes: placed, frames, wrapped });
    }
    return remember(undefined);
  };
  const box = build(root, options.width - 2 * pad);
  if (!box || (box.height + 2 * pad > options.height && options.overflow !== "expand")) { note("block-layout", "Equal-column block grid cannot fit this viewport; the graph fitter wraps or pages its real nodes and edges."); return; }
  const height = Math.max(options.height, box.height + 2 * pad), viewport = { ...options, height };
  if (height > options.height) notes.push(ledgerLayoutExpanded({ requestedWidth: options.width, requestedHeight: options.height, canvasWidth: options.width, canvasHeight: height }));
  const dx = Math.floor((options.width - box.width) / 2), dy = Math.floor((height - box.height) / 2);
  const nodes = box.nodes.map(n => shift(n, dx, dy)), placed = new Map(nodes.map(n => [n.id, n]));
  const desired: { edgeId: string; nodeId: string; end: "from" | "to"; side: GlyphCanvasDirection }[] = [];
  for (const edge of measured.edges) {
    const from = placed.get(edge.from), to = placed.get(edge.to);
    if (!from || !to) { note("block-layout", "A composite edge needs graph placement; the grid yields to the shared fitter."); return; }
    let side: GlyphCanvasDirection, other: GlyphCanvasDirection;
    if (from.x1 < to.x0 && from.y0 <= to.y1 && to.y0 <= from.y1) { side = "e"; other = "w"; }
    else if (to.x1 < from.x0 && from.y0 <= to.y1 && to.y0 <= from.y1) { side = "w"; other = "e"; }
    else if (from.y1 < to.y0) { side = "s"; other = "n"; }
    else { side = "n"; other = "s"; }
    desired.push({ edgeId: edge.id, nodeId: from.id, end: "from", side: glyphDiagramNodePortSide(from, side) }, { edgeId: edge.id, nodeId: to.id, end: "to", side: glyphDiagramNodePortSide(to, other) });
  }
  const ports: GlyphDiagramPositionedPort[] = [];
  for (const node of nodes) for (const side of ["n", "e", "s", "w"] as const) {
    const family = desired.filter(p => p.nodeId === node.id && p.side === side);
    const length = side === "n" || side === "s" ? node.width : node.height;
    const offsets = glyphDiagramPortOffsets(node, side, family.map((_, i) => Math.floor((length - 1 - 2 * (family.length - 1)) / 2) + 2 * i));
    if (!offsets || offsets.some(offset => offset < 1 || offset > length - 2)) { note("block-layout", "Block ports need more side room; the shared graph fitter reserves it."); return; }
    family.forEach((port, i) => {
      const offset = offsets[i]!;
      const anchor = side === "n" || side === "s" ? { x: node.x0 + offset, y: side === "n" ? node.y0 : node.y1 } : { x: side === "w" ? node.x0 : node.x1, y: node.y0 + offset };
      ports.push({ ...port, offset, anchor, escape: { x: anchor.x + (side === "e" ? 1 : side === "w" ? -1 : 0), y: anchor.y + (side === "s" ? 1 : side === "n" ? -1 : 0) } });
    });
  }
  const layout: GlyphDiagramLayout = { ...measured, nodes, ports, width: options.width, height,
    [GLYPH_DIAGRAM_GROUP_BOUNDS]: new Map([...box.frames].map(([id, rect]) => [id, shiftRect(rect, dx, dy)])) };
  const routing = routeGlyphGraphEdges(layout, viewport);
  if (routing.unroutable.length) { note("block-layout", "Authored grid leaves no routable corridor; the shared graph fitter keeps the connections."); return; }
  const labels = glyphDiagramGraphLabels(layout, routing, viewport), quality = glyphDiagramRouteQuality(layout, routing.routes);
  if (quality.crossings || quality.fakeFrames || labels.ledger.some(n => ["label-dropped", "label-abbreviated"].includes(n.code))) { note("block-layout", "Authored grid lacks clear routes or captions; the shared graph fitter reserves room."); return; }
  const painted = paintGlyphDiagram(layout, routing, { ...viewport, labelLayout: labels });
  if (box.wrapped) note("block-row-wrap", "Block rows wrap to fewer columns for the viewport; spans are clamped to the wrapped row width.");
  return { ...painted, pages: [painted], meta: { nodes: graph.nodes, edges: graph.edges, groups: graph.groups ?? [], description: `${graph.nodes.length} nodes; authored block grid; 1 panel.` }, report: { ledger: dedupeGlyphDiagramLedger([...notes, ...measured.ledger, ...routing.ledger, ...painted.ledger]), unsupportedGlyphs: painted.unsupportedGlyphs, unroutable: [] } };
}
