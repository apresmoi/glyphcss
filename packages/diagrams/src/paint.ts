import { createGlyphCanvas, GLYPH_CANVAS_TIERS, encodeGlyphCanvasText, encodeGlyphCanvasAnsi, encodeGlyphCanvasHtml, type GlyphCanvasDirection, type GlyphCanvasTierName } from "glyphcss";
import { resolveGlyphDiagramColor, resolveGlyphDiagramColorOption } from "./color";
import { glyphDiagramLabelLayout, glyphDiagramRectsOverlap, type GlyphDiagramLabelCandidate } from "./labels";
import { diagramLedgerEntryFromCanvasMessage, ledgerGroupMemberList, ledgerRouteConflict, type GlyphDiagramLedgerEntry } from "./ledger";
import { glyphDiagramGroupRect, type GlyphDiagramLayout, type GlyphDiagramRect } from "./pipeline";
import type { GlyphDiagramRoutingResult } from "./route";
import type { GlyphDiagramPage, GlyphDiagramRenderOptions } from "./renderTypes";
import type { GlyphGraphNodeShape } from "./types";

/**
 * Node-SHAPE outline glyphs — a diagram-local vocabulary (mirrors
 * `@glyphcss/charts`' own local turn-glyph table in `flowMarks.ts`'s
 * sankey painter), not `glyphcss`'s shared `GLYPH_CANVAS_TIERS`: these are
 * specific to how THIS package draws a flowchart node's outline, not a
 * general canvas primitive every consumer needs. Keyed by charset (a data
 * lookup, never a branch on the charset's name) and then by SHAPE NAME
 * directly — not a shared corner "family" — because two shapes can share
 * every `box`/`blocks`/`braille` glyph while needing genuinely different
 * `ascii` fallbacks (`cylinder`'s ascii stays the plain `+` corner every
 * unlisted shape falls back to, while its box/blocks/braille corners move
 * onto the same round-cap glyphs as `stadium`/`circle`); folding both into
 * one shared family entry would have forced them to agree on ascii too.
 * A shape absent from a charset's row (`rect`, `subroutine`, `cylinder` on
 * `ascii`) falls back to the plain default below: `tier.junction`'s
 * quadrant corners, `tier.straight.h` rules, `tier.straight.v` sides —
 * exactly what every shape drew before this table existed. Every glyph
 * here is confirmed present in the website's own Glyph Mono subset
 * (`website/src/components/TargetPreview/glyphMonoCmap.json`).
 *
 * Approved against a rendered catalogue of candidate node shapes (user
 * review, ~90 candidates). Four families, by weight/outline: SHARP
 * (`rect`/`subroutine`, `tier.junction`'s own `┌┐└┘`, untouched) < ROUNDED
 * (`rounded`, real box-drawing round corners `╭╮╰╯`) < ARC-CAPPED
 * (`stadium`/`cylinder`/`circle`, quarter-arc corners `◜◝◟◞` — `circle`
 * additionally swaps its top/bottom RULE for `◠`/`◡` so the whole outline
 * reads as an ellipse, not just its corners) < PINCHED (`diamond`, round
 * corners `╭╮╰╯` plus `◀`/`▶` SIDE glyphs on every interior row, so the
 * box's own left/right edge reads as the diamond's pointed vertices
 * instead of a plain rule cutting across them) and CHEVRON (`asymmetric`,
 * sharp corners on the LEFT, `╲`/`╱` diagonal corners on the right plus a
 * `▶` right side, so the whole right edge reads as one flag point).
 */
interface GlyphDiagramShapeGlyphs {
  /** [top-left, top-right, bottom-left, bottom-right]. */
  readonly corners: readonly [string, string, string, string];
  readonly topRule?: string;
  readonly bottomRule?: string;
  readonly sideLeft?: string;
  readonly sideRight?: string;
}
const NODE_SHAPE_GLYPHS_BOX_LIKE: Readonly<Partial<Record<GlyphGraphNodeShape, GlyphDiagramShapeGlyphs>>> = {
  rounded: { corners: ["╭", "╮", "╰", "╯"] },
  stadium: { corners: ["◜", "◝", "◟", "◞"] },
  cylinder: { corners: ["◜", "◝", "◟", "◞"] },
  circle: { corners: ["◜", "◝", "◟", "◞"], topRule: "◠", bottomRule: "◡" },
  // USER FEEDBACK, verbatim: "those arrow heads in nodes should only appear
  // when there are arrows, otherwise they shouldn't". A side glyph is painted
  // on EVERY interior row, so `◀`/`▶` sprouted arrowheads down both sides of
  // any node taller than one row - and where an edge did attach, the router
  // draws its own arrowhead at the border, so the two doubled up. A node
  // border must never paint a glyph that reads as a connector.
  //
  // `diamond` keeps its rounded corners and a `◆` marker on the label instead
  // (the "marker only - filled" entry the user approved), which distinguishes
  // it from `rounded` with no connector-shaped glyph anywhere.
  diamond: { corners: ["╭", "╮", "╰", "╯"] },
  asymmetric: { corners: ["┌", "╲", "└", "╱"] },
};
const NODE_SHAPE_GLYPHS: Readonly<Record<GlyphCanvasTierName, Readonly<Partial<Record<GlyphGraphNodeShape, GlyphDiagramShapeGlyphs>>>>> = {
  ascii: {
    rounded: { corners: ["(", ")", "(", ")"] },
    stadium: { corners: ["(", ")", "(", ")"] },
    circle: { corners: ["(", ")", "(", ")"] },
    diamond: { corners: ["/", "\\", "\\", "/"] },
    asymmetric: { corners: [">", "]", ">", "]"] },
  },
  box: NODE_SHAPE_GLYPHS_BOX_LIKE,
  blocks: NODE_SHAPE_GLYPHS_BOX_LIKE,
  braille: NODE_SHAPE_GLYPHS_BOX_LIKE,
};

/**
 * Prior default colours, unchanged — `color`/`accent` below still paint
 * every non-node/non-edge glyph (group boundary rings, group/title labels)
 * exactly as before `nodeColor`/`edgeColor` existed.
 */
const DEFAULT_GRAPH_NODE_COLOR = "#38bdf8";
const DEFAULT_GRAPH_EDGE_COLOR = "#94a3b8";

/** Always paints into fresh storage: re-registering a route cannot erase its old canvas glyphs. */
export function paintGlyphDiagram(layout: GlyphDiagramLayout, routing: GlyphDiagramRoutingResult, options: GlyphDiagramRenderOptions & { width: number; height: number }): GlyphDiagramPage & { ledger: GlyphDiagramLedgerEntry[]; unsupportedGlyphs: string[] } {
  const charset = options.charset ?? "box", canvas = createGlyphCanvas({ cols: options.width, rows: options.height, tier: charset });
  const tier = GLYPH_CANVAS_TIERS[charset], colored = options.color !== "none";
  const color = colored ? DEFAULT_GRAPH_EDGE_COLOR : null, accent = colored ? DEFAULT_GRAPH_NODE_COLOR : null;
  // Per-node colour, resolved and validated ONCE per node (never per cell,
  // so a caller's `nodeColor` function is called exactly once each).
  const nodeColors = new Map(layout.nodes.map((node) => [node.id, colored ? resolveGlyphDiagramColor(options.nodeColor, node, DEFAULT_GRAPH_NODE_COLOR, "nodeColor") : null]));
  // `edgeColor`'s raw override, resolved ONCE per edge (`undefined` when
  // unset). Route cells and the target arrowhead/edge label share this ONE
  // override once given, but fall back to DIFFERENT prior defaults when it
  // isn't — the route body kept its old grey, the arrowhead/label kept
  // their old node-blue — so adding this option changes nothing for a
  // caller who never sets it (color:"none" or default colored render alike).
  const edgeOverrides = new Map(routing.routes.map((route) => [route.edge.id, colored ? resolveGlyphDiagramColorOption(options.edgeColor, route.edge, "edgeColor") : undefined]));
  const routeColors = new Map(routing.routes.map((route) => [route.edge.id, colored ? (edgeOverrides.get(route.edge.id) ?? DEFAULT_GRAPH_EDGE_COLOR) : null]));
  const edgeAccentColors = new Map(routing.routes.map((route) => [route.edge.id, colored ? (edgeOverrides.get(route.edge.id) ?? DEFAULT_GRAPH_NODE_COLOR) : null]));
  // Group boundary rings/labels and the title stay on the plain `color`/
  // `accent` defaults above — they belong to no single node or edge, so
  // `nodeColor`/`edgeColor` (a per-node/per-edge function) has nothing to
  // resolve them against; scope stays exactly the two options this form
  // documents.
  const labelColors = new Map<string, string | null>();
  const ledger: GlyphDiagramLedgerEntry[] = [], obstacles: GlyphDiagramRect[] = [...layout.nodes];
  const count = new Map<string, number>(), routeCells = new Set<string>();
  for (const route of routing.routes) for (const p of route.cells) { const k = `${p.x},${p.y}`; count.set(k, (count.get(k) ?? 0) + 1); routeCells.add(k); obstacles.push({ x0: p.x, y0: p.y, x1: p.x, y1: p.y }); }
  // Every route cell's own local travel axis, independent of edge style —
  // `route.ts`'s `ringParallelCost` makes a route hugging a group's ring
  // expensive, not impossible (a genuinely cramped fixture can have no
  // alternative corridor at all), so the boundary loop below still needs to
  // recognise a COLLINEAR route cell it is adjacent to, whatever the
  // touching edge's style, and yield to it — never just the dotted-glyph
  // loop's own per-style `axis` above, which a plain solid edge never runs.
  const routeCellAxis = new Map<string, "h" | "v">();
  for (const route of routing.routes) route.cells.forEach((p, i) => {
    const prev = route.cells[i - 1], next = route.cells[i + 1];
    const axis = prev && next ? (prev.x === next.x ? "v" : prev.y === next.y ? "h" : undefined)
      : prev ? (prev.x === p.x ? "v" : "h")
      : next ? (next.x === p.x ? "v" : "h")
      : undefined;
    if (axis) routeCellAxis.set(`${p.x},${p.y}`, axis);
  });
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
    const routeColor = routeColors.get(route.edge.id)!;
    let dotPhase = 0;
    // The route's own LAST drawable cell sits flush against the arrowhead
    // `canvas.arrowhead` paints at the port's anchor, one cell further in —
    // whatever phase the alternation happens to land on there is invisible
    // to the arrowhead placement below, so it could leave that stub blank.
    // USER FEEDBACK, verbatim: "a dotted edge arriving at a node renders
    // with a gap before the arrowhead". The stub must always touch the
    // head, so this one cell is forced to ink after the alternating pass —
    // never left to whichever parity the run's own length happens to give it.
    let lastDotted: { x: number; y: number; axis: "h" | "v" } | undefined;
    route.cells.forEach((p, i) => {
      const prev = route.cells[i - 1], next = route.cells[i + 1];
      if (count.get(`${p.x},${p.y}`) !== 1) return;
      const axis = prev && next ? (prev.x === next.x ? "v" : prev.y === next.y ? "h" : undefined)
        : prev ? (prev.x === p.x ? "v" : "h")
        : next ? (next.x === p.x ? "v" : "h")
        : undefined;
      let glyph = canvas.grid.char[p.y * canvas.cols + p.x]!;
      // A dotted EDGE uses the axis-oriented `hop` glyph (`╌`/`╎`), never the
      // isotropic `dot` a group boundary rings itself with — USER FEEDBACK,
      // verbatim: "some of the lines that are dotted are hard to understand
      // on what is the direction... because we have kind of blocks that are
      // dotted and also arrows that are dotted". `hop` already reads as "a
      // broken rule" (tiers.ts's own doc, reused here rather than invented)
      // and, unlike a round dot, tells a horizontal run from a vertical one
      // on sight — the direction cue the isotropic dot could never give.
      if (axis && route.edge.style === "dotted") { glyph = dotPhase % 2 ? " " : tier.hop[axis]; dotPhase++; lastDotted = { x: p.x, y: p.y, axis }; }
      if (axis && route.edge.style === "thick") glyph = tier.double[axis];
      canvas.text(p.x, p.y, [glyph], { color: routeColor });
    });
    if (lastDotted) canvas.text(lastDotted.x, lastDotted.y, [tier.hop[lastDotted.axis]], { color: routeColor });
  }
  const candidates: GlyphDiagramLabelCandidate[] = [];
  // Populated only for a group that actually gets a drawn dotted ring below
  // (never a group that degraded to a plain member-list caption) — an edge
  // label has nothing to stay clear of where there is no boundary painted.
  const drawnGroupRects = new Map<string, GlyphDiagramRect>();
  for (const group of layout.groups) {
    const nodes = layout.nodes.filter((n) => group.members.includes(n.id));
    if (!nodes.length) continue;
    const rect = glyphDiagramGroupRect(nodes, { cols: canvas.cols, rows: canvas.rows })!;
    const unrelatedInside = layout.nodes.some((node) => !group.members.includes(node.id) && glyphDiagramRectsOverlap(node, rect));
    const partialOverlap = layout.groups.some((other) => other.id !== group.id && group.members.some((id) => other.members.includes(id)) && !group.members.every((id) => other.members.includes(id)) && !other.members.every((id) => group.members.includes(id)));
    if (unrelatedInside || partialOverlap) {
      candidates.push({ id: `group:${group.id}`, text: `${group.label ?? group.id}: ${nodes.map((node) => node.label).join(", ")}`, x: Math.floor(canvas.cols / 2), y: rect.y0, priority: 1 });
      labelColors.set(`group:${group.id}`, accent);
      ledger.push(ledgerGroupMemberList({ groupId: group.id, reason: "unrelated-nodes" }));
      continue;
    }
    drawnGroupRects.set(group.id, rect);
    // Group boundaries are annotation, never opaque routing obstacles; gaps preserve any route crossing the enclosure.
    // USER FEEDBACK, verbatim: "some of the lines that are dotted are hard
    // to understand on what is the direction — I think that because we
    // have kind of blocks that are dotted and also arrows that are dotted
    // — probably if we have a block that is dotted we need some padding
    // around them to show it properly, with some spacing around" — and
    // later, once a route could still take that padding as its own free
    // lane: "we need something else... or have explicit ways to not
    // overlap them EVER". `route.ts`'s `ringParallelBlockAxis` now charges a
    // route running COLLINEAR with this ring so heavily that no reachable
    // detour ever costs more — but a genuinely cramped fixture (no other
    // corridor exists at all) can still be forced to pay it, so this loop
    // cannot assume the router alone closed the gap; it still has to yield
    // wherever painting the dot would visually merge with the route. Two
    // DISTINCT adjacencies both yield, for different reasons:
    //  - a route cell directly OUTWARD of this exact point — a genuine
    //    PERPENDICULAR crossing, which wants a clean one-cell notch, not
    //    the multi-cell gap the previous "any of 4 neighbours" rule opened
    //    along a route that ran the ring's own length reading as one
    //    continuous line with the dotted edge riding right alongside;
    //  - ANY neighbour (any of the 4, not just outward) whose own route
    //    segment runs STRAIGHT THROUGH in the axis this boundary point's
    //    edge itself runs in — a genuine collinear run, whatever style
    //    painted it. A neighbour that only BENDS through (no single axis —
    //    `routeCellAxis` only records a straight cell) is a brief touch,
    //    not a run, and is left alone: it reads as a route corner brushing
    //    the ring, never as the ring's own line continuing.
    // `tier.dot` (an isotropic round dot) is EVERY group's own ring glyph,
    // at every nesting depth — never `tier.hop` (the axis-oriented dash a
    // DOTTED EDGE uses, see the route-cell loop above). A wide back-edge
    // route (agent-guardrail's own "retry", `guard -.-> supervisor`) can
    // sweep in a near-rectangle around most of the diagram and read, at a
    // glance, like a second/outer group ring; keeping the two glyph
    // families disjoint at every level is what still lets a reader tell
    // "this rectangle is a group" from "this rectangle is one dotted
    // edge's own route" on sight. Verified against a genuinely nested
    // `subgraph`-in-`subgraph` fixture: both levels paint this exact glyph.
    for (let y = rect.y0; y <= rect.y1; y++) for (let x = rect.x0; x <= rect.x1; x++) {
      if (x !== rect.x0 && x !== rect.x1 && y !== rect.y0 && y !== rect.y1) continue;
      const cell = { x0: x, y0: y, x1: x, y1: y };
      if (obstacles.some((o) => glyphDiagramRectsOverlap(o, cell))) continue;
      // A straight edge cell has exactly one outward direction; a corner
      // has two (the two edges that meet there) — never the tangential
      // neighbours along the ring itself, which is what turned a single
      // crossing into a multi-cell gap.
      const isCorner = (x === rect.x0 || x === rect.x1) && (y === rect.y0 || y === rect.y1);
      const outward: readonly (readonly [number, number])[] =
        x === rect.x0 && y === rect.y0 ? [[x - 1, y], [x, y - 1]] :
        x === rect.x1 && y === rect.y0 ? [[x + 1, y], [x, y - 1]] :
        x === rect.x0 && y === rect.y1 ? [[x - 1, y], [x, y + 1]] :
        x === rect.x1 && y === rect.y1 ? [[x + 1, y], [x, y + 1]] :
        x === rect.x0 ? [[x - 1, y]] :
        x === rect.x1 ? [[x + 1, y]] :
        y === rect.y0 ? [[x, y - 1]] :
        [[x, y + 1]];
      if (outward.some(([nx, ny]) => routeCells.has(`${nx},${ny}`))) continue;
      const tangent: readonly ("h" | "v")[] = isCorner ? ["h", "v"] : x === rect.x0 || x === rect.x1 ? ["v"] : ["h"];
      const collinear = ([[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]] as const)
        .some(([nx, ny]) => { const a = routeCellAxis.get(`${nx},${ny}`); return a !== undefined && tangent.includes(a); });
      if (collinear) continue;
      canvas.text(x, y, [tier.dot], { color });
    }
    if (group.label) { candidates.push({ id: `group:${group.id}`, text: group.label, x: Math.floor((rect.x0 + rect.x1) / 2), y: rect.y0, priority: 1, maxWidth: rect.x1 - rect.x0 - 1 }); labelColors.set(`group:${group.id}`, accent); }
  }
  for (const node of layout.nodes) {
    const { x0, y0, x1, y1 } = node;
    const nodeColor = nodeColors.get(node.id)!;
    // No background rectangle — USER FEEDBACK, verbatim: "I want to be
    // faithful to glyphcss rendering". A per-node `bg` painted a real filled
    // panel behind every box (14 `background-color` spans on the supervisor
    // fixture alone), which reads as a UI card rather than as glyph output;
    // the border glyphs carry the box on their own. `shade: 0` still CLAIMS
    // the footprint, which is what keeps routes out of a node's interior.
    canvas.fillRect(x0, y0, x1, y1, { fill: { shade: 0 }, bg: null });
    // Every edge and corner is painted cell-by-cell through `canvas.text`
    // rather than `canvas.line()` — a per-shape RULE glyph (`circle`'s
    // `◠`/`◡`) has no `canvas.line()` equivalent, and going per-cell
    // uniformly means the same code path handles every shape's default
    // (plain `─`/`│`) and override alike, with no separate "one-cell side
    // has no line direction" special case left to maintain.
    const shape: GlyphGraphNodeShape = node.shape ?? "rect";
    const glyphs = NODE_SHAPE_GLYPHS[charset][shape];
    const corners = glyphs?.corners ?? [tier.junction[6]!, tier.junction[12]!, tier.junction[3]!, tier.junction[9]!];
    const topRule = glyphs?.topRule ?? tier.straight.h, bottomRule = glyphs?.bottomRule ?? tier.straight.h;
    const sideLeft = glyphs?.sideLeft ?? tier.straight.v, sideRight = glyphs?.sideRight ?? tier.straight.v;
    for (let x = x0 + 1; x < x1; x++) { canvas.text(x, y0, [topRule], { color: nodeColor }); canvas.text(x, y1, [bottomRule], { color: nodeColor }); }
    for (let y = y0 + 1; y < y1; y++) { canvas.text(x0, y, [sideLeft], { color: nodeColor }); canvas.text(x1, y, [sideRight], { color: nodeColor }); }
    ([[x0, y0], [x1, y0], [x0, y1], [x1, y1]] as const).forEach(([x, y], i) => canvas.text(x, y, [corners[i]!], { color: nodeColor }));
    if (node.shape === "subroutine") for (let y = y0 + 1; y < y1; y++) { canvas.text(x0 + 1, y, [tier.straight.v], { color: nodeColor }); canvas.text(x1 - 1, y, [tier.straight.v], { color: nodeColor }); }
  }
  // Borders own the node footprint; tips replace their reserved target cell
  // after the border fill so they touch the target without entering its label.
  for (const route of routing.routes) {
    if (route.edge.style === "undirected") continue;
    const port = layout.ports.find((p) => p.edgeId === route.edge.id && p.end === "to")!;
    const opposite: Record<GlyphCanvasDirection, GlyphCanvasDirection> = { n: "s", s: "n", e: "w", w: "e" };
    canvas.arrowhead(port.anchor.x, port.anchor.y, opposite[port.side], { color: edgeAccentColors.get(route.edge.id)! });
  }
  for (const route of routing.routes) if (route.edge.label) {
    const mid = route.cells[Math.floor(route.cells.length / 2)]!;
    // USER FEEDBACK, verbatim: "the label of retry shouldn't be near
    // workers, it should be from the other side of the workers box,
    // otherwise its confusing" — an edge label landing next to a group
    // NEITHER of its own endpoints belongs to reads as annotating that
    // group. Only a group this edge doesn't touch at all counts as
    // foreign; a group the edge enters or leaves is legitimately close to
    // its own label.
    const avoid = layout.groups
      .filter((group) => drawnGroupRects.has(group.id) && !group.members.includes(route.edge.from) && !group.members.includes(route.edge.to))
      .map((group) => ({ groupId: group.id, rect: drawnGroupRects.get(group.id)! }));
    candidates.push({ id: `edge:${route.edge.id}`, text: route.edge.label, x: mid.x, y: mid.y, route: route.cells, maxWidth: Math.min(24, canvas.cols), priority: route.edge.priority, avoid });
    labelColors.set(`edge:${route.edge.id}`, edgeAccentColors.get(route.edge.id)!);
  }
  if (options.title) { candidates.push({ id: "title", text: options.title, x: Math.floor(canvas.cols / 2), y: 0, priority: Infinity }); labelColors.set("title", accent); }
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
  labels.placed.forEach((label) => canvas.text(label.x, label.y, [label.text], { color: labelColors.get(label.id) ?? accent }));
  ledger.push(...labels.ledger);
  // A node owns its interior label slot; external labels see the entire node as an obstacle.
  for (const node of layout.nodes) {
    const innerWidth = node.width - 2 - (node.shape === "subroutine" ? 2 : 0);
    const top = node.y0 + Math.floor((node.height - node.lines.length) / 2);
    const nodeColor = nodeColors.get(node.id)!;
    node.lines.forEach((line, i) => {
      const result = glyphDiagramLabelLayout([{ id: node.id, text: line, x: Math.floor(innerWidth / 2), y: 0 }], { charset, viewport: { cols: innerWidth, rows: 1 }, obstacles: [] });
      for (const label of result.placed) canvas.text(node.x0 + 1 + (node.shape === "subroutine" ? 1 : 0) + label.x, top + i, [label.text], { color: nodeColor });
      ledger.push(...result.ledger);
    });
  }
  ledger.push(...canvas.report.ledger.map(diagramLedgerEntryFromCanvasMessage), ...canvas.report.routeConflicts.map((c) => ledgerRouteConflict(c)));
  const colorMode = options.color ?? "none";
  const text = colorMode === "none" || colorMode === "css" ? encodeGlyphCanvasText(canvas) : encodeGlyphCanvasAnsi(canvas, { colors: colorMode === "ansi16" ? "16" : colorMode === "ansi256" ? "256" : "truecolor", env: options.env });
  const html = colorMode === "css" ? encodeGlyphCanvasHtml(canvas) : undefined;
  return { text, ...(html === undefined ? {} : { html }), canvas, layout, routes: routing.routes, labels: labels.placed, ledger, unsupportedGlyphs: [...canvas.report.unsupportedGlyphs] };
}
