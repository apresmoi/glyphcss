import { createGlyphCanvas, GLYPH_CANVAS_TIERS, encodeGlyphCanvasText, encodeGlyphCanvasAnsi, encodeGlyphCanvasHtml, type GlyphCanvasDirection } from "glyphcss";
import { glyphDiagramLabelLayout, glyphDiagramRectsOverlap, type GlyphDiagramLabelCandidate } from "./labels";
import { diagramLedgerEntryFromCanvasMessage, ledgerGroupMemberList, ledgerRouteConflict, type GlyphDiagramLedgerEntry } from "./ledger";
import type { GlyphDiagramLayout, GlyphDiagramRect } from "./pipeline";
import type { GlyphDiagramRoutingResult } from "./route";
import type { GlyphDiagramPage, GlyphDiagramRenderOptions } from "./renderTypes";

/** Always paints into fresh storage: re-registering a route cannot erase its old canvas glyphs. */
export function paintGlyphDiagram(layout: GlyphDiagramLayout, routing: GlyphDiagramRoutingResult, options: GlyphDiagramRenderOptions & { width: number; height: number }): GlyphDiagramPage & { ledger: GlyphDiagramLedgerEntry[]; unsupportedGlyphs: string[] } {
  const charset = options.charset ?? "box", canvas = createGlyphCanvas({ cols: options.width, rows: options.height, tier: charset });
  const tier = GLYPH_CANVAS_TIERS[charset], colored = options.color !== "none";
  const color = colored ? "#94a3b8" : null, accent = colored ? "#38bdf8" : null;
  const ledger: GlyphDiagramLedgerEntry[] = [], obstacles: GlyphDiagramRect[] = [...layout.nodes];
  const count = new Map<string, number>();
  for (const route of routing.routes) for (const p of route.cells) { const k = `${p.x},${p.y}`; count.set(k, (count.get(k) ?? 0) + 1); obstacles.push({ x0: p.x, y0: p.y, x1: p.x, y1: p.y }); }
  for (const route of routing.routes) { canvas.edge(route.edge.id, route.edge); canvas.route(route.edge.id, route.cells); }
  canvas.resolveJunctions();
  // Style only exclusive straight cells, preserving the resolver's corner and crossing verdicts.
  // REVIEW-diagrams-fanout-opus.md P3-1: the dotted phase used to key off the
  // cell's raw index in `route.cells`, which also counts every CORNER cell
  // (undrawable — no straight `axis`) that the run happens to pass through.
  // A short, corner-heavy route could land its two eligible cells on
  // consecutive odd indices and paint zero dots (`cycle.mmd`'s "retry" edge:
  // both eligible cells fell on odd indices and painted two blanks, no dot,
  // over its whole six-cell run). `dotPhase` instead counts only the cells
  // this loop actually draws, so the alternation is dot-blank-dot-blank
  // along the run regardless of how many corners sit between them. The
  // route's two ENDPOINTS are drawable too — the escape cell touching the
  // node border, and the final cell touching the target arrowhead — each
  // has only one neighbour, so `axis` is now derived from whichever single
  // neighbour exists there instead of requiring both.
  for (const route of routing.routes) {
    let dotPhase = 0;
    route.cells.forEach((p, i) => {
      const prev = route.cells[i - 1], next = route.cells[i + 1];
      if (count.get(`${p.x},${p.y}`) !== 1) return;
      const axis = prev && next ? (prev.x === next.x ? "v" : prev.y === next.y ? "h" : undefined)
        : prev ? (prev.x === p.x ? "v" : "h")
        : next ? (next.x === p.x ? "v" : "h")
        : undefined;
      let glyph = canvas.grid.char[p.y * canvas.cols + p.x]!;
      if (axis && route.edge.style === "dotted") { glyph = dotPhase % 2 ? " " : tier.dot; dotPhase++; }
      if (axis && route.edge.style === "thick") glyph = tier.double[axis];
      canvas.text(p.x, p.y, [glyph], { color });
    });
  }
  const candidates: GlyphDiagramLabelCandidate[] = [];
  for (const group of layout.groups) {
    const nodes = layout.nodes.filter((n) => group.members.includes(n.id));
    if (!nodes.length) continue;
    const rect = { x0: Math.max(0, Math.min(...nodes.map((n) => n.x0)) - 2), y0: Math.max(0, Math.min(...nodes.map((n) => n.y0)) - 2), x1: Math.min(canvas.cols - 1, Math.max(...nodes.map((n) => n.x1)) + 2), y1: Math.min(canvas.rows - 1, Math.max(...nodes.map((n) => n.y1)) + 2) };
    const unrelatedInside = layout.nodes.some((node) => !group.members.includes(node.id) && glyphDiagramRectsOverlap(node, rect));
    const partialOverlap = layout.groups.some((other) => other.id !== group.id && group.members.some((id) => other.members.includes(id)) && !group.members.every((id) => other.members.includes(id)) && !other.members.every((id) => group.members.includes(id)));
    if (unrelatedInside || partialOverlap) {
      candidates.push({ id: `group:${group.id}`, text: `${group.label ?? group.id}: ${nodes.map((node) => node.label).join(", ")}`, x: Math.floor(canvas.cols / 2), y: rect.y0, priority: 1 });
      ledger.push(ledgerGroupMemberList({ groupId: group.id, reason: "unrelated-nodes" }));
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
    // Diagram boxes are always whole-cell box-drawing, never a sub-cell
    // (braille/blocks) stroke: `line()`'s tier-native `subcell` default
    // would otherwise paint a dotted/blocky top and bottom edge instead of
    // the flat rule every other side of the box uses.
    canvas.line({ x: x0 + 1, y: y0 }, { x: x1 - 1, y: y0 }, { color: accent, subcell: false });
    canvas.line({ x: x0 + 1, y: y1 }, { x: x1 - 1, y: y1 }, { color: accent, subcell: false });
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
  // REVIEW-diagrams-fanout-opus.md P3-1: `glyphDiagramLabelLayout` only
  // rejects literal overlap, so a label candidate immediately touching a
  // node's own border (distance 0, not overlap) was never excluded —
  // `cycle.mmd`'s short "retry" edge landed its label flush against the
  // Check box (`└───────┘retry`) while every longer route's own label
  // happened to land far enough from a node border by the geometry alone.
  // A label must still be free to sit exactly one cell from its OWN route
  // (that's the whole placement rule, `label.route`'s distance-1 check
  // above), so only NODE rects get the one-cell pad here, never the route
  // point-obstacles a label is required to touch.
  const labelObstacles: GlyphDiagramRect[] = [...layout.nodes.map((n) => ({ x0: n.x0 - 1, y0: n.y0 - 1, x1: n.x1 + 1, y1: n.y1 + 1 })),
    ...routing.routes.flatMap((route) => route.cells.map((p) => ({ x0: p.x, y0: p.y, x1: p.x, y1: p.y })))];
  const labels = glyphDiagramLabelLayout(candidates, { charset, viewport: { cols: canvas.cols, rows: canvas.rows }, obstacles: labelObstacles });
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
  ledger.push(...canvas.report.ledger.map(diagramLedgerEntryFromCanvasMessage), ...canvas.report.routeConflicts.map((c) => ledgerRouteConflict(c)));
  const colorMode = options.color ?? "none";
  const text = colorMode === "none" || colorMode === "css" ? encodeGlyphCanvasText(canvas) : encodeGlyphCanvasAnsi(canvas, { colors: colorMode === "ansi16" ? "16" : colorMode === "ansi256" ? "256" : "truecolor", env: options.env });
  const html = colorMode === "css" ? encodeGlyphCanvasHtml(canvas) : undefined;
  return { text, ...(html === undefined ? {} : { html }), grid: canvas.grid, layout, routes: routing.routes, labels: labels.placed, ledger, unsupportedGlyphs: [...canvas.report.unsupportedGlyphs] };
}
