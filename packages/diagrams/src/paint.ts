import { createGlyphCanvas, GLYPH_CANVAS_TIERS, encodeGlyphCanvasText, encodeGlyphCanvasAnsi, encodeGlyphCanvasHtml, type GlyphCanvasDirection } from "glyphcss";
import { glyphDiagramLabelLayout, glyphDiagramRectsOverlap, type GlyphDiagramLabelCandidate } from "./labels";
import type { GlyphDiagramLayout, GlyphDiagramRect } from "./pipeline";
import type { GlyphDiagramRoutingResult } from "./route";
import type { GlyphDiagramPage, GlyphDiagramRenderOptions } from "./renderTypes";

/** Always paints into fresh storage: re-registering a route cannot erase its old canvas glyphs. */
export function paintGlyphDiagram(layout: GlyphDiagramLayout, routing: GlyphDiagramRoutingResult, options: GlyphDiagramRenderOptions & { width: number; height: number }): GlyphDiagramPage & { ledger: string[]; unsupportedGlyphs: string[] } {
  const charset = options.charset ?? "box", canvas = createGlyphCanvas({ cols: options.width, rows: options.height, tier: charset });
  const tier = GLYPH_CANVAS_TIERS[charset], colored = options.color !== "none";
  const color = colored ? "#94a3b8" : null, accent = colored ? "#38bdf8" : null;
  const ledger: string[] = [], obstacles: GlyphDiagramRect[] = [...layout.nodes];
  const count = new Map<string, number>();
  for (const route of routing.routes) for (const p of route.cells) { const k = `${p.x},${p.y}`; count.set(k, (count.get(k) ?? 0) + 1); obstacles.push({ x0: p.x, y0: p.y, x1: p.x, y1: p.y }); }
  for (const route of routing.routes) { canvas.edge(route.edge.id, route.edge); canvas.route(route.edge.id, route.cells); }
  canvas.resolveJunctions();
  // Style only exclusive straight cells, preserving the resolver's corner and crossing verdicts.
  for (const route of routing.routes) route.cells.forEach((p, i) => {
    const prev = route.cells[i - 1], next = route.cells[i + 1];
    if (count.get(`${p.x},${p.y}`) !== 1) return;
    const axis = prev && next ? prev.x === next.x ? "v" : prev.y === next.y ? "h" : undefined : undefined;
    let glyph = canvas.grid.char[p.y * canvas.cols + p.x]!;
    if (axis && route.edge.style === "dotted") glyph = i % 2 ? " " : tier.dot;
    if (axis && route.edge.style === "thick") glyph = tier.double[axis];
    canvas.text(p.x, p.y, [glyph], { color });
  });
  const candidates: GlyphDiagramLabelCandidate[] = [];
  for (const group of layout.groups) {
    const nodes = layout.nodes.filter((n) => group.members.includes(n.id));
    if (!nodes.length) continue;
    const rect = { x0: Math.max(0, Math.min(...nodes.map((n) => n.x0)) - 2), y0: Math.max(0, Math.min(...nodes.map((n) => n.y0)) - 2), x1: Math.min(canvas.cols - 1, Math.max(...nodes.map((n) => n.x1)) + 2), y1: Math.min(canvas.rows - 1, Math.max(...nodes.map((n) => n.y1)) + 2) };
    const unrelatedInside = layout.nodes.some((node) => !group.members.includes(node.id) && glyphDiagramRectsOverlap(node, rect));
    const partialOverlap = layout.groups.some((other) => other.id !== group.id && group.members.some((id) => other.members.includes(id)) && !group.members.every((id) => other.members.includes(id)) && !other.members.every((id) => group.members.includes(id)));
    if (unrelatedInside || partialOverlap) {
      candidates.push({ id: `group:${group.id}`, text: `${group.label ?? group.id}: ${nodes.map((node) => node.label).join(", ")}`, x: Math.floor(canvas.cols / 2), y: rect.y0, priority: 1 });
      ledger.push(`group "${group.id}": explicit member list replaces an enclosure that would include unrelated nodes.`);
      continue;
    }
    // Group boundaries are annotation, never opaque routing obstacles; gaps preserve any route crossing the enclosure.
    for (let y = rect.y0; y <= rect.y1; y++) for (let x = rect.x0; x <= rect.x1; x++) {
      if (x !== rect.x0 && x !== rect.x1 && y !== rect.y0 && y !== rect.y1) continue;
      const cell = { x0: x, y0: y, x1: x, y1: y };
      if (obstacles.some((o) => glyphDiagramRectsOverlap(o, cell))) continue;
      canvas.text(x, y, [tier.dot], { color });
    }
    if (group.label) candidates.push({ id: `group:${group.id}`, text: group.label, x: Math.floor((rect.x0 + rect.x1) / 2), y: rect.y0, priority: 1, maxWidth: rect.x1 - rect.x0 - 1 });
  }
  for (const node of layout.nodes) {
    const { x0, y0, x1, y1 } = node;
    canvas.fillRect(x0, y0, x1, y1, { fill: { shade: 0 }, bg: colored ? "#0f172a" : null });
    canvas.line({ x: x0 + 1, y: y0 }, { x: x1 - 1, y: y0 }, { color: accent });
    canvas.line({ x: x0 + 1, y: y1 }, { x: x1 - 1, y: y1 }, { color: accent });
    // A one-cell side has no line direction; use the vertical tier glyph explicitly.
    for (let y = y0 + 1; y < y1; y++) { canvas.text(x0, y, [tier.straight.v], { color: accent }); canvas.text(x1, y, [tier.straight.v], { color: accent }); }
    const shaped = node.shape === "diamond" ? ["/", "\\", "\\", "/"] : node.shape === "asymmetric" ? [">", "]", ">", "]"] : ["rounded", "circle", "stadium"].includes(node.shape ?? "") ? ["(", ")", "(", ")"] : [tier.junction[6]!, tier.junction[12]!, tier.junction[3]!, tier.junction[9]!];
    [[x0, y0], [x1, y0], [x0, y1], [x1, y1]].forEach(([x, y], i) => canvas.text(x!, y!, [shaped[i]!], { color: accent }));
    if (node.shape === "subroutine") for (let y = y0 + 1; y < y1; y++) { canvas.text(x0 + 1, y, [tier.straight.v], { color: accent }); canvas.text(x1 - 1, y, [tier.straight.v], { color: accent }); }
  }
  // Borders own the node footprint; tips replace their reserved target cell
  // after the border fill so they touch the target without entering its label.
  for (const route of routing.routes) {
    if (route.edge.style === "undirected") continue;
    const port = layout.ports.find((p) => p.edgeId === route.edge.id && p.end === "to")!;
    const opposite: Record<GlyphCanvasDirection, GlyphCanvasDirection> = { n: "s", s: "n", e: "w", w: "e" };
    canvas.arrowhead(port.anchor.x, port.anchor.y, opposite[port.side], { color: accent });
  }
  for (const route of routing.routes) if (route.edge.label) {
    const mid = route.cells[Math.floor(route.cells.length / 2)]!;
    candidates.push({ id: `edge:${route.edge.id}`, text: route.edge.label, x: mid.x, y: mid.y, route: route.cells, maxWidth: Math.min(24, canvas.cols), priority: route.edge.priority });
  }
  if (options.title) candidates.push({ id: "title", text: options.title, x: Math.floor(canvas.cols / 2), y: 0, priority: Infinity });
  const labels = glyphDiagramLabelLayout(candidates, { charset, viewport: { cols: canvas.cols, rows: canvas.rows }, obstacles });
  labels.placed.forEach((label) => canvas.text(label.x, label.y, [label.text], { color: accent }));
  ledger.push(...labels.ledger);
  // A node owns its interior label slot; external labels see the entire node as an obstacle.
  for (const node of layout.nodes) {
    const innerWidth = node.width - 2 - (node.shape === "subroutine" ? 2 : 0);
    const top = node.y0 + Math.floor((node.height - node.lines.length) / 2);
    node.lines.forEach((line, i) => {
      const result = glyphDiagramLabelLayout([{ id: node.id, text: line, x: Math.floor(innerWidth / 2), y: 0 }], { charset, viewport: { cols: innerWidth, rows: 1 }, obstacles: [] });
      for (const label of result.placed) canvas.text(node.x0 + 1 + (node.shape === "subroutine" ? 1 : 0) + label.x, top + i, [label.text], { color: accent });
      ledger.push(...result.ledger);
    });
  }
  ledger.push(...canvas.report.ledger, ...canvas.report.routeConflicts.map((c) => `route-conflict: ${c.kind} at ${c.col},${c.row} (${c.edgeIds.join(", ")}).`));
  const colorMode = options.color ?? "none";
  const text = colorMode === "none" || colorMode === "css" ? encodeGlyphCanvasText(canvas) : encodeGlyphCanvasAnsi(canvas, { colors: colorMode === "ansi16" ? "16" : colorMode === "ansi256" ? "256" : "truecolor", env: options.env });
  const html = colorMode === "css" ? encodeGlyphCanvasHtml(canvas) : undefined;
  return { text, ...(html === undefined ? {} : { html }), grid: canvas.grid, layout, routes: routing.routes, labels: labels.placed, ledger, unsupportedGlyphs: [...canvas.report.unsupportedGlyphs] };
}
