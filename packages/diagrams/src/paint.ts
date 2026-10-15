import { GLYPH_DIAGRAM_DIAMOND_MARKER, glyphDiagramDiamondGlyph } from "./presentation";
import { createGlyphCanvas, GLYPH_CANVAS_TIERS, encodeGlyphCanvasText, encodeGlyphCanvasAnsi, encodeGlyphCanvasHtml, type GlyphCanvasDirection, type GlyphCanvasTierName } from "glyphcss";
import { glyphDiagramGraphLabels } from "./graphLabels";
import { resolveGlyphDiagramColor, resolveGlyphDiagramColorOption } from "./color";
import { glyphDiagramLabelLayout, glyphDiagramRectsOverlap, type GlyphDiagramLabelLayoutResult } from "./labels";
import { diagramLedgerEntryFromCanvasMessage, ledgerGroupMemberList, ledgerRouteConflict, type GlyphDiagramLedgerEntry } from "./ledger";
import { glyphDiagramGroupRects, glyphDiagramPointCell, type GlyphDiagramLayout, type GlyphDiagramRect } from "./pipeline";
import type { GlyphDiagramRoutingResult } from "./route";
import type { GlyphDiagramPage, GlyphDiagramRenderOptions } from "./renderTypes";
import type { GlyphGraphNodeShape, GlyphGraphEdgeHead } from "./types";

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
export function paintGlyphDiagram(layout: GlyphDiagramLayout, routing: GlyphDiagramRoutingResult, options: GlyphDiagramRenderOptions & { width: number; height: number; labelLayout?: GlyphDiagramLabelLayoutResult }): GlyphDiagramPage & { ledger: GlyphDiagramLedgerEntry[]; unsupportedGlyphs: string[] } {
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
  const ledger: GlyphDiagramLedgerEntry[] = [], obstacles: GlyphDiagramRect[] = [...layout.nodes];
  const paintMarker = (head: GlyphGraphEdgeHead, at: { x: number; y: number }, side: GlyphCanvasDirection, color: string | null) => {
    const ascii = charset === "ascii";
    const glyph = head === "circle" ? ascii ? "o" : "●" : head === "cross" ? ascii ? "x" : "✕"
      : head === "triangle" ? ascii ? "^" : "△" : head === "filled-diamond" ? ascii ? "*" : "◆"
      : head === "open-diamond" ? ascii ? "o" : "◇"
      : head === "er-many" || head === "er-zero-many" ? ({ n: "v", s: "^", e: "<", w: ">" }[side])
      : ascii ? "+" : "┼";
    canvas.text(at.x, at.y, [glyph], { color });
    if (head.startsWith("er-")) {
      const delta = { n: [0, -1], s: [0, 1], e: [1, 0], w: [-1, 0] }[side]!;
      canvas.text(at.x + delta[0]!, at.y + delta[1]!, [head === "er-zero-one" || head === "er-zero-many" ? ascii ? "o" : "○" : ascii ? "+" : "┼"], { color });
    }
  };
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
  // The hop glyph is already dashed; blanking alternate cells breaks short elbows and stubs.
  for (const route of routing.routes) {
    const routeColor = routeColors.get(route.edge.id)!;
    const side = layout.ports.find((port) => port.edgeId === route.edge.id && port.end === "from")?.side;
    const singleAxis = side === "n" || side === "s" ? "v" : "h";

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
        : singleAxis;
      // Junction resolution has no neighbour from which to infer a one-cell segment.
      let glyph = route.cells.length === 1 ? tier.straight[singleAxis] : canvas.grid.char[p.y * canvas.cols + p.x]!;
      // A dotted EDGE uses the axis-oriented `hop` glyph (`╌`/`╎`), never the
      // isotropic `dot` a group boundary rings itself with — USER FEEDBACK,
      // verbatim: "some of the lines that are dotted are hard to understand
      // on what is the direction... because we have kind of blocks that are
      // dotted and also arrows that are dotted". `hop` already reads as "a
      // broken rule" (tiers.ts's own doc, reused here rather than invented)
      // and, unlike a round dot, tells a horizontal run from a vertical one
      // on sight — the direction cue the isotropic dot could never give.
      if (axis && route.edge.style === "dotted") { glyph = tier.hop[axis]; lastDotted = { x: p.x, y: p.y, axis }; }
      if (axis && route.edge.style === "thick") glyph = tier.double[axis];
      canvas.text(p.x, p.y, [glyph], { color: routeColor });
    });
    if (lastDotted) canvas.text(lastDotted.x, lastDotted.y, [tier.hop[lastDotted.axis]], { color: routeColor });
  }
  const groupRects = glyphDiagramGroupRects(layout, { cols: canvas.cols, rows: canvas.rows });
  for (const group of layout.groups) {
    const nodes = layout.nodes.filter((n) => group.members.includes(n.id));
    if (!nodes.length) continue;
    const rect = groupRects.get(group.id)!;
    const unrelatedInside = layout.nodes.some((node) => !group.members.includes(node.id) && glyphDiagramRectsOverlap(node, rect));
    const partialOverlap = layout.groups.some((other) => other.id !== group.id && group.members.some((id) => other.members.includes(id)) && !group.members.every((id) => other.members.includes(id)) && !other.members.every((id) => group.members.includes(id)));
    if (unrelatedInside || partialOverlap) {
      ledger.push(ledgerGroupMemberList({ groupId: group.id, reason: "unrelated-nodes" }));
      continue;
    }
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

  }
  // A point is only its glyph. Exits leave through a bar of junctions on the glyph's own row or column; several entries
  // meet in a bar one cell further out and reach the glyph through one arrowhead, so every edge's last cell is joined
  // to the glyph by cells that are drawn. Bits: 1 n, 2 e, 4 s, 8 w.
  const pointEntries = new Map<string, number>();
  for (const port of layout.ports) {
    const edge = layout.edges.find((e) => e.id === port.edgeId)!;
    if (edge.invisible) continue;
    if (port.end === "to" && edge.from !== edge.to && layout.nodes.find((n) => n.id === port.nodeId)?.shape === "point") pointEntries.set(port.nodeId, (pointEntries.get(port.nodeId) ?? 0) + 1);
  }
  const POINT_FLOW = {
    TB: { inward: { x: 0, y: 1 }, entry: 1, exit: 4, plus: 2, minus: 8, from: "s", to: "n" },
    BT: { inward: { x: 0, y: -1 }, entry: 4, exit: 1, plus: 2, minus: 8, from: "n", to: "s" },
    LR: { inward: { x: 1, y: 0 }, entry: 8, exit: 2, plus: 4, minus: 1, from: "e", to: "w" },
    RL: { inward: { x: -1, y: 0 }, entry: 2, exit: 8, plus: 4, minus: 1, from: "w", to: "e" },
  } as const;
  const paintPoint = (node: GlyphDiagramLayout["nodes"][number], nodeColor: string | null) => {
    const flow = POINT_FLOW[layout.direction], glyph = glyphDiagramPointCell(node, layout.direction), across = layout.direction === "TB" || layout.direction === "BT";
    const crossOf = (p: { x: number; y: number }) => across ? p.x : p.y;
    const at = (cross: number, along: { x: number; y: number }) => across ? { x: cross, y: along.y } : { x: along.x, y: cross };
    const anchors = (side: string) => layout.ports.filter((p) => p.nodeId === node.id && p.side === side && !layout.edges.find(e => e.id === p.edgeId)!.invisible && layout.edges.find((e) => e.id === p.edgeId)!.from !== layout.edges.find((e) => e.id === p.edgeId)!.to).map((p) => crossOf(p.anchor)).sort((a, b) => a - b);
    // A bar over `cross` coordinates, each of which has a line leaving it on the `side` bit; `stem` adds a line on one more cell.
    const bar = (crosses: readonly number[], along: { x: number; y: number }, side: number, stem?: { cross: number; bit: number }) => {
      for (let c = crosses[0]!; c <= crosses[crosses.length - 1]!; c++) {
        const mask = (c > crosses[0]! ? flow.minus : 0) | (c < crosses[crosses.length - 1]! ? flow.plus : 0) | (crosses.includes(c) ? side : 0) | (stem?.cross === c ? stem.bit : 0);
        const cell = at(c, along);
        canvas.text(cell.x, cell.y, [tier.junction[mask]!], { color: nodeColor });
      }
    };
    const exits = anchors(flow.from);
    if (exits.length > 1) bar(exits, glyph, flow.exit);
    const entries = anchors(flow.to);
    if (entries.length > 1) {
      const arrow = { x: glyph.x - flow.inward.x, y: glyph.y - flow.inward.y }, barAt = { x: arrow.x - flow.inward.x, y: arrow.y - flow.inward.y };
      bar(entries, barAt, flow.entry, { cross: crossOf(glyph), bit: flow.exit });
      const routed = layout.ports.filter((p) => p.nodeId === node.id && p.end === "to").map((p) => routing.routes.find((r) => r.edge.id === p.edgeId)).filter((r) => r !== undefined);
      const heads = routed.map((r) => r.edge.endHead ?? (r.edge.style === "undirected" ? "none" : "arrow"));
      const shared = heads.every((head) => head === heads[0]);
      // Only equal heads can share a tip. Mixed heads stay at their own entry ports.
      const head = shared ? heads[0] : "none";
      const color = routed.length ? edgeAccentColors.get(routed[0]!.edge.id)! : nodeColor;
      if (head === "arrow") canvas.arrowhead(arrow.x, arrow.y, flow.from, { color });
      else if (head && head !== "none") paintMarker(head, arrow, flow.from, color);
      else canvas.text(arrow.x, arrow.y, [tier.junction[flow.entry | flow.exit]!], { color });
    }
    // The glyph itself is the node's label, folded and charset-picked at measure time.
    if (node.lines[0]) canvas.text(glyph.x, glyph.y, [node.lines[0]], { color: nodeColor });
  };
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
    if (node.shape === "point") { paintPoint(node, nodeColor); continue; }
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
    const labelTop = y0 + Math.floor((node.height - node.lines.length) / 2);
    for (const row of node.separators ?? []) canvas.text(x0, labelTop + row, [tier.junction[7]! + tier.straight.h.repeat(node.width - 2) + tier.junction[13]!], { color: nodeColor });
    if (node.shape === "subroutine") for (let y = y0 + 1; y < y1; y++) { canvas.text(x0 + 1, y, [tier.straight.v], { color: nodeColor }); canvas.text(x1 - 1, y, [tier.straight.v], { color: nodeColor }); }
  }
  const exits = new Set<string>();
  for (const port of layout.ports) if (port.end === "from" && port.trunk && routing.routes.some(route => route.edge.id === port.edgeId)) {
    const key = `${port.anchor.x},${port.anchor.y}`;
    if (exits.has(key)) continue;
    exits.add(key);
    const mask = { n: 11, e: 7, s: 14, w: 13 }[port.side];
    canvas.text(port.anchor.x, port.anchor.y, [tier.junction[mask]!], { color: nodeColors.get(port.nodeId)! });
  }
  // Borders own the node footprint; tips replace their reserved target cell
  // after the border fill so they touch the target without entering its label.
  for (const route of routing.routes) for (const end of ["from", "to"] as const) {
    const head = end === "from" ? route.edge.startHead ?? "none" : route.edge.endHead ?? (route.edge.style === "undirected" ? "none" : "arrow");
    const port = layout.ports.find((p) => p.edgeId === route.edge.id && p.end === end);
    if (!port) continue;
    if (head === "none") {
      if (end === "to" && (pointEntries.get(port.nodeId) ?? 0) === 1) {
        const flow = POINT_FLOW[layout.direction];
        canvas.text(port.anchor.x, port.anchor.y, [tier.junction[flow.entry | flow.exit]!], { color: routeColors.get(route.edge.id)! });
      }
      continue;
    }
    if (end === "to" && (pointEntries.get(port.nodeId) ?? 0) > 1) {
      const heads = routing.routes.filter((r) => r.edge.to === port.nodeId).map((r) => r.edge.endHead ?? (r.edge.style === "undirected" ? "none" : "arrow"));
      if (heads.every((value) => value === heads[0])) continue;
    }
    const opposite: Record<GlyphCanvasDirection, GlyphCanvasDirection> = { n: "s", s: "n", e: "w", w: "e" };
    const color = edgeAccentColors.get(route.edge.id)!;
    if (head === "arrow") canvas.arrowhead(port.anchor.x, port.anchor.y, opposite[port.side], { color });
    else paintMarker(head, port.anchor, port.side, color);
  }
  const labels = options.labelLayout ?? glyphDiagramGraphLabels(layout, routing, options);
  labels.placed.forEach(label => {
    const edgeId = label.id.startsWith("edge:") ? label.id.slice(5)
      : label.id.startsWith("edge-row:") ? (JSON.parse(label.id.slice(9)) as [string, number])[0] : undefined;
    canvas.text(label.x, label.y, [label.text], { color: edgeId === undefined ? accent : edgeAccentColors.get(edgeId) ?? accent });
  });
  ledger.push(...labels.ledger);
  // A node owns its interior label slot; external labels see the entire node as an obstacle.
  for (const node of layout.nodes) {
    if (node.shape === "point") continue;
    const innerWidth = node.width - 2 - (node.shape === "subroutine" ? 2 : 0);
    const top = node.y0 + Math.floor((node.height - node.lines.length) / 2);
    const nodeColor = nodeColors.get(node.id)!;
    node.lines.forEach((line, i) => {
      if (node.separators?.includes(i)) return;
      if (node.shape === "compartment" && i > (node.separators?.[0] ?? Infinity)) {
        if (line) canvas.text(node.x0 + 2, top + i, [line], { color: nodeColor });
        return;
      }
      const result = glyphDiagramLabelLayout([{ id: node.id, text: line, x: Math.floor(innerWidth / 2), y: 0 }], { charset, viewport: { cols: innerWidth, rows: 1 }, obstacles: [] });
      // Measurement includes the marker in its wrapped rows; its identity is presentation state, never label text.
      const marker = node[GLYPH_DIAGRAM_DIAMOND_MARKER] && i === 0 ? glyphDiagramDiamondGlyph(charset) : "";
      for (const label of result.placed) {
        const x = node.x0 + 1 + (node.shape === "subroutine" ? 1 : 0) + label.x;
        if (marker) canvas.text(x, top + i, [marker], { color: nodeColor });
        const text = label.text.slice(marker.length);
        if (text) canvas.text(x + marker.length, top + i, [text], { color: nodeColor });
      }
      ledger.push(...result.ledger);
    });
  }
  ledger.push(...canvas.report.ledger.map(diagramLedgerEntryFromCanvasMessage), ...canvas.report.routeConflicts.map((c) => ledgerRouteConflict(c)));
  const colorMode = options.color ?? "none";
  const text = colorMode === "none" || colorMode === "css" ? encodeGlyphCanvasText(canvas) : encodeGlyphCanvasAnsi(canvas, { colors: colorMode === "ansi16" ? "16" : colorMode === "ansi256" ? "256" : "truecolor", env: options.env });
  const html = colorMode === "css" ? encodeGlyphCanvasHtml(canvas) : undefined;
  return { text, ...(html === undefined ? {} : { html }), canvas, layout, routes: routing.routes, labels: labels.placed, ledger, unsupportedGlyphs: [...canvas.report.unsupportedGlyphs] };
}
