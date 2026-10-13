import {
  createGlyphCanvas, GLYPH_CANVAS_TIERS, GLYPH_CANVAS_DIRECTION_BITS,
  encodeGlyphCanvasText, encodeGlyphCanvasAnsi, encodeGlyphCanvasHtml,
  type GlyphCanvasTierName,
} from "glyphcss";
import { glyphDiagramTruncateLabel } from "../labels";
import { glyphDiagramCenterOffset } from "../center";
import { glyphDiagramPaletteColor, resolveGlyphDiagramColor } from "../color";
import { diagramLedgerEntryFromCanvasMessage, ledgerRouteConflict, type GlyphDiagramLedgerEntry } from "../ledger";
import type { GlyphLaneRow } from "./layout";
import type { GlyphLaneNode } from "./types";
import type { GlyphLaneRenderOptions } from "./render";

const { n: N, e: E, s: S, w: W } = GLYPH_CANVAS_DIRECTION_BITS;

/** One glyph column plus one gap column between lanes — the gap is where a connector row's horizontal fill and corner glyphs live. */
export const GLYPH_LANE_COLUMN_WIDTH = 2;

/** Floor `render.ts`'s lane-cap degrade reserves for content (id/marks/label) beyond the lane area — mirrors the sequence form's floor-3 label cap, sized a little larger since this content is id+marks+label combined, not one label alone. */
export const GLYPH_LANE_MIN_CONTENT_WIDTH = 6;

export interface GlyphLanePaintResult {
  readonly text: string; readonly html?: string; readonly canvas: ReturnType<typeof createGlyphCanvas>;
  readonly ledger: GlyphDiagramLedgerEntry[]; readonly unsupportedGlyphs: string[];
  /** Nodes whose row text was cut to fit — reported once per render by the caller, which alone sees every page. */
  readonly abbreviatedNodeIds: string[];
}

function rowContent(node: GlyphLaneNode, ids: boolean): string {
  return [...(ids ? [node.id] : []), ...(node.marks?.length ? [`(${node.marks.join(", ")})`] : []), node.label].join("  ");
}

/** The two maps `laneColor` resolution reads: the node a lane is waiting for (set by a continuation row) and the last node to occupy it. */
export interface GlyphLaneColorState {
  readonly waiting: Map<number, string>;
  readonly owner: Map<number, GlyphLaneNode>;
}

/**
 * What a page needs to colour exactly as the unpaginated render would: the
 * state at its first row, plus the whole diagram's node index and first node
 * (a waiting id or fallback may name a node on another page).
 */
export interface GlyphLaneColorStart {
  readonly state: GlyphLaneColorState;
  readonly nodes: ReadonlyMap<string, GlyphLaneNode>;
  readonly first: GlyphLaneNode | undefined;
}

export function createColorState(): GlyphLaneColorState { return { waiting: new Map(), owner: new Map() }; }
export function copyColorState(state: GlyphLaneColorState): GlyphLaneColorState { return { waiting: new Map(state.waiting), owner: new Map(state.owner) }; }

/**
 * The ONE place a row changes lane-colour state, shared by the painter and
 * by `render.ts`'s single pre-pass over every row, so a page's starting state
 * cannot drift from what painting the rows in sequence would have produced.
 * Applied BEFORE the row's own colours resolve: a node's lane must see the
 * node landing in it, and a freshly branched lane its hub (the node row
 * directly above), until its own node row overwrites that.
 */
export function advanceColorState(state: GlyphLaneColorState, row: GlyphLaneRow): void {
  if (row.type === "node") {
    state.owner.set(row.lane, row.node);
    for (const [lane, id] of state.waiting) if (id === row.node.id) state.waiting.delete(lane);
  } else if (row.type === "continuation") {
    row.lanes.forEach((lane, k) => state.waiting.set(lane, row.waitingFor[k]!));
  } else {
    for (const lane of row.branchLanes) state.owner.set(lane, state.owner.get(row.hubLane)!);
  }
}

function laneX(lane: number): number { return lane * GLYPH_LANE_COLUMN_WIDTH; }

/**
 * Paints one panel: every row is hand-placed (no A* routing — like the
 * sequence painter, this form's geometry is fully determined by
 * `layoutGlyphLaneRows`, so a direct per-cell placement is simpler and more
 * precise than the graph pipeline's general crossing resolver). Always a
 * fresh canvas — the package's own standing rule (`AGENTS.md`'s Don't list).
 * Connector corners reuse the active tier's own square box-drawing junction
 * table (`┌┐└┘├┤`), the same vocabulary the sequence painter's marker boxes
 * already use, rather than introducing new arc glyphs into `glyphcss`'s
 * shared tier tables.
 */
/**
 * A lane connector's TURN gets a rounded corner, matching the precedent in
 * `@glyphcss/charts`' own sankey ribbons (`flowMarks.ts`'s
 * `sankeyBoxCornerGlyph`): `╭ ╮ ╰ ╯` wherever the charset owns them, `/ \\`
 * on `ascii`, which has only those two diagonals. USER FEEDBACK, verbatim:
 * "I would like for them to use curved segments". Only a pure CORNER (one
 * vertical bit + one horizontal bit) is rounded — a tee or a cross stays the
 * tier's own junction glyph, because a branch point is not a turn.
 */
function laneCornerGlyph(mask: number, charset: GlyphCanvasTierName): string | null {
  const vertical = mask & (N | S), horizontal = mask & (E | W);
  const isCorner = (vertical === N || vertical === S) && (horizontal === E || horizontal === W);
  if (!isCorner) return null;
  if (charset === "ascii") return (mask & N) ? "/" : "\\";
  if (mask === (N | E)) return "╰";
  if (mask === (N | W)) return "╯";
  if (mask === (S | E)) return "╭";
  return "╮";
}

export function paintGlyphLaneDag(
  rows: readonly GlyphLaneRow[],
  columns: number,
  bodyHeight: number,
  width: number,
  options: GlyphLaneRenderOptions & { readonly width: number; readonly height: number },
  /** Colour state carried in from the rows before this page — see `GlyphLaneColorStart`. */
  start?: GlyphLaneColorStart,
): GlyphLanePaintResult {
  const charset: GlyphCanvasTierName = options.charset ?? "box";
  const colored = options.color !== "none";
  const canvasRows = Math.max(bodyHeight, options.height);
  const canvas = createGlyphCanvas({ cols: width, rows: canvasRows, tier: charset });
  const tier = GLYPH_CANVAS_TIERS[charset];
  const ledger: GlyphDiagramLedgerEntry[] = [];
  const abbreviatedNodeIds: string[] = [];
  // The painter is public and always showed ids before the option existed;
  // `renderGlyphLaneDag` is what picks the per-input default.
  const ids = options.ids ?? true;
  // Tracks which node currently "owns" each lane index — feeds a
  // `laneColor` FUNCTION override only; the DEFAULT colour below is a pure
  // function of the lane (column) INDEX, never the node, so a merge reusing
  // a freed column reuses that column's colour too (the convention
  // `git log --graph`'s own colouring uses — a branch gets a genuinely NEW
  // colour because it lands in a different column, never because it copies
  // its parent's). A caller's function override still needs some node to
  // call with: this map feeds it the node whose own row most recently set
  // this lane directly, or — for a lane a connector row just branched into,
  // before that lane's own first node row is reached — the row's hub node
  // (the node CAUSING the branch). A branch connector always directly
  // follows its node row and a merge connector's hub is a lane already
  // running into it (`render.ts`'s pagination keeps each unit together), so
  // `laneOwner.get(row.hubLane)` is set by the time a connector row runs.
  // A lane running in from above (a window's cut, a page break) is coloured
  // by the node it leads to when that node is on this panel, else the last
  // node that occupied it, else — last resort — the panel's first node.
  const panelNodes = start?.nodes ?? new Map(rows.flatMap((row) => (row.type === "node" ? [[row.node.id, row.node] as const] : [])));
  const firstNode = start?.first ?? rows.find((row) => row.type === "node")?.node;
  const state = start ? copyColorState(start.state) : createColorState();
  const laneOwner = state.owner, laneWaiting = state.waiting;
  const laneColorFor = (lane: number): string | null =>
    colored ? resolveGlyphDiagramColor(options.laneColor, (panelNodes.get(laneWaiting.get(lane) ?? "") ?? laneOwner.get(lane) ?? firstNode)!, glyphDiagramPaletteColor(lane), "laneColor") : null;
  const contentX = laneX(columns);
  const maxContentWidth = Math.max(0, width - contentX);
  // Centre the content in the grid through the package's ONE shared
  // definition, the same one the graph pipeline's `centered()` and the
  // sequence painter use — a lane DAG used to anchor at 0,0, which read as a
  // different kind of diagram beside a graph on the same page (measured at
  // 120x30: graph top 13 / left 21, lanes top 0 / left 0).
  const labelWidth = Math.max(0, ...rows.map((row) => row.type === "node"
    ? glyphDiagramTruncateLabel(rowContent(row.node, ids), maxContentWidth, charset).length
    : 0));
  const { dx: padX, dy: padY } = glyphDiagramCenterOffset(
    { width: contentX + labelWidth, height: bodyHeight },
    { width, height: canvasRows },
  );
  /** Lane column x, offset by the centring pad. */
  const lx = (lane: number): number => laneX(lane) + padX;
  rows = rows.map((row) => ({ ...row, top: row.top + padY }));

  for (const row of rows) {
    if (row.type === "node") {
      // Owner set BEFORE resolving this row's own colour — a `laneColor`
      // function override for row.lane itself must see the node landing in
      // it now, not whatever occupied that column previously.
      advanceColorState(state, row);
      const rowColor = laneColorFor(row.lane);
      for (const lane of row.passthroughLanes) canvas.text(lx(lane), row.top, [tier.straight.v], { color: laneColorFor(lane) });
      canvas.text(lx(row.lane), row.top, ["*"], { color: rowColor });
      const full = rowContent(row.node, ids);
      const content = glyphDiagramTruncateLabel(full, maxContentWidth, charset);
      if (content !== full) abbreviatedNodeIds.push(row.node.id);
      if (content) canvas.text(contentX + padX, row.top, [content], { color: rowColor, align: "left" });
      continue;
    }
    if (row.type === "continuation") {
      advanceColorState(state, row);
      for (const lane of row.lanes) canvas.text(lx(lane), row.top, [tier.hop.v], { color: laneColorFor(lane) });
      continue;
    }
    // Lanes freshly branching out of the hub on THIS row have no owner yet
    // — seed them with the hub's own node (set on the node row directly
    // above, per this function's own doc above) before any colour below
    // resolves them; a lane's later node row overwrites this.
    advanceColorState(state, row);
    for (const lane of row.untouchedLanes) canvas.text(lx(lane), row.top, [tier.straight.v], { color: laneColorFor(lane) });
    for (const lane of row.passthroughLanes) canvas.text(lx(lane), row.top, [tier.junction[N | E | S | W]!], { color: laneColorFor(lane) });

    const touched = [row.hubLane, ...row.mergeLanes, ...row.branchLanes];
    const spanMin = Math.min(...touched), spanMax = Math.max(...touched);
    // The connecting bar between the hub and its farthest merge/branch is
    // ONE event, not several lanes' worth of colour — painted in the hub's
    // own colour throughout, same as every corner/tee glyph below.
    const hubColor = laneColorFor(row.hubLane);
    const occupied = new Set([...touched, ...row.passthroughLanes]);
    for (let x = lx(spanMin) + 1; x < lx(spanMax); x++) {
      // The lane-column test must run on the UNSHIFTED coordinate: once the
      // centring pad moves every x, `x % COLUMN_WIDTH` no longer identifies
      // a lane column and the fill skipped the wrong cells, leaving a gap in
      // every connector (`├ ╮` instead of `├─╮`).
      // A lane column with no lane in it is a plain gap in the run, not a cell to skip (`├─ ─╯`).
      if ((x - padX) % GLYPH_LANE_COLUMN_WIDTH === 0 && occupied.has((x - padX) / GLYPH_LANE_COLUMN_WIDTH)) continue; // painted below — never overwritten by the plain fill glyph
      canvas.text(x, row.top, [tier.straight.h], { color: hubColor });
    }
    // Bits per touched lane are UNIONED into one map, so the hub's own N/S
    // and its E/W toward each touched lane combine into one junction glyph.
    const bits = new Map<number, number>();
    const add = (lane: number, mask: number): void => { bits.set(lane, (bits.get(lane) ?? 0) | mask); };
    add(row.hubLane, N | (row.hubContinues ? S : 0));
    for (const lane of touched) if (lane !== row.hubLane) add(row.hubLane, lane > row.hubLane ? E : W);
    // A touched lane BETWEEN the hub and a further-out lane also carries the
    // horizontal run PASSING THROUGH its own cell, so it needs both E and W
    // (a `┴`/`┬` tee), not just the one bit pointing back at the hub. Without
    // the pass-through bit a three-lane merge painted `├─┘─┘` — two corners in
    // a row, each silently breaking the line that crosses it — instead of
    // `├─┴─┘`.
    const throughBit = (lane: number): number => {
      if (lane < row.hubLane) return touched.some((o) => o < lane) ? W : 0;
      return touched.some((o) => o > lane) ? E : 0;
    };
    for (const lane of row.mergeLanes) add(lane, N | (lane < row.hubLane ? E : W) | throughBit(lane));
    for (const lane of row.branchLanes) add(lane, S | (lane < row.hubLane ? E : W) | throughBit(lane));
    for (const [lane, mask] of bits) canvas.text(lx(lane), row.top, [laneCornerGlyph(mask, charset) ?? tier.junction[mask]!], { color: lane === row.hubLane ? hubColor : laneColorFor(lane) });
  }

  ledger.push(...canvas.report.ledger.map(diagramLedgerEntryFromCanvasMessage), ...canvas.report.routeConflicts.map((c) => ledgerRouteConflict(c)));
  const colorMode = options.color ?? "none";
  const text = colorMode === "none" || colorMode === "css" ? encodeGlyphCanvasText(canvas) : encodeGlyphCanvasAnsi(canvas, { colors: colorMode === "ansi16" ? "16" : colorMode === "ansi256" ? "256" : "truecolor", env: options.env });
  const html = colorMode === "css" ? encodeGlyphCanvasHtml(canvas) : undefined;
  return { text, ...(html === undefined ? {} : { html }), canvas, ledger, unsupportedGlyphs: [...canvas.report.unsupportedGlyphs], abbreviatedNodeIds };
}
