import type { GlyphCanvasDirection, GlyphCanvasPoint } from "glyphcss";
import type { GlyphGraph } from "./types";
import type { GlyphDiagramPositionedPort, GlyphDiagramRect } from "./pipeline";

/** A self-edge's footprint inputs: the node it hangs on and its label, already wrapped into rows. */
export interface GlyphDiagramLoop {
  readonly edgeId: string; readonly nodeId: string;
  /** The label's wrapped rows; empty when the edge has no label. */
  readonly lines: readonly string[];
  /** The widest row, in cells. */
  readonly labelWidth: number;
}
/** Where one loop's two ports sit along its node's loop side, as offsets from the node's first cell. */
export interface GlyphDiagramLoopSlot extends GlyphDiagramLoop { readonly exit: number; readonly entry: number }

/** The widest a loop label wraps by default; paint caps an edge label at the same width. */
export const GLYPH_DIAGRAM_LOOP_LABEL_MAX = 24;
/** Cells a loop reaches beyond its node's border: out, across, and back. */
export const GLYPH_DIAGRAM_LOOP_SPAN = 2;

/**
 * dagre reserves a self-edge's room AFTER its node in the node's layer: to
 * the right for top-down graphs, below for left-to-right ones. Hanging the
 * loop on that side lets the engine's own placement keep neighbours away, and
 * it is the side no main-flow edge uses (ports sit on n/s in TB, e/w in LR).
 */
export function glyphDiagramLoopSide(direction: GlyphGraph["direction"]): GlyphCanvasDirection {
  return direction === "TB" || direction === "BT" ? "e" : "s";
}

/**
 * Port offsets for one node's loops, in edge order. Beside a vertical side a
 * loop spans two adjacent rows and its label's rows run down from the first,
 * so the next loop starts after whichever is longer plus a blank row. Below a
 * node the label sits right of the loop, so the next loop starts after it.
 * `length` is the side length the slots need.
 */
export function glyphDiagramLoopSlots(loops: readonly GlyphDiagramLoop[], side: GlyphCanvasDirection): { readonly slots: GlyphDiagramLoopSlot[]; readonly length: number } {
  const slots: GlyphDiagramLoopSlot[] = [];
  let at = 1;
  for (const loop of loops) {
    slots.push({ ...loop, exit: at, entry: at + 1 });
    at += side === "e" ? Math.max(3, loop.lines.length + 1) : loop.labelWidth > 0 ? loop.labelWidth + 4 : 3;
  }
  return { slots, length: slots.length ? slots[slots.length - 1]!.entry + 2 : 0 };
}

/** The loop's route: out of the exit port, around, and back into the entry port, one step beyond the escape cells. */
export function glyphDiagramLoopCells(exit: { readonly side: GlyphCanvasDirection; readonly escape: GlyphCanvasPoint }, entry: { readonly escape: GlyphCanvasPoint }): GlyphCanvasPoint[] {
  const d = exit.side === "e" ? { x: 1, y: 0 } : { x: 0, y: 1 };
  return [exit.escape, { x: exit.escape.x + d.x, y: exit.escape.y + d.y }, { x: entry.escape.x + d.x, y: entry.escape.y + d.y }, entry.escape];
}

/**
 * Where the label's rows go: one blank cell past the loop's far wall (the one
 * place a label does not touch its route), starting level with the exit
 * beside a node and on the loop's outer row below one.
 */
export function glyphDiagramLoopLabelRect(exit: { readonly side: GlyphCanvasDirection; readonly escape: GlyphCanvasPoint }, entry: { readonly escape: GlyphCanvasPoint }, loop: Pick<GlyphDiagramLoop, "lines" | "labelWidth">): GlyphDiagramRect | undefined {
  if (loop.labelWidth < 1) return undefined;
  const x0 = exit.side === "e" ? entry.escape.x + 3 : entry.escape.x + 2, y0 = exit.side === "e" ? exit.escape.y : exit.escape.y + 1;
  return { x0, x1: x0 + loop.labelWidth - 1, y0, y1: y0 + loop.lines.length - 1 };
}

/** One loop as placed: its cells, its label's rect, and the box around both. */
export interface GlyphDiagramLoopGeometry { readonly loop: GlyphDiagramLoop; readonly cells: GlyphCanvasPoint[]; readonly label?: GlyphDiagramRect; readonly bounds: GlyphDiagramRect }
export function glyphDiagramLoopGeometry(layout: { readonly ports: readonly GlyphDiagramPositionedPort[]; readonly loops: readonly GlyphDiagramLoop[] }): GlyphDiagramLoopGeometry[] {
  return layout.loops.map((loop) => {
    const exit = layout.ports.find((p) => p.edgeId === loop.edgeId && p.end === "from")!, entry = layout.ports.find((p) => p.edgeId === loop.edgeId && p.end === "to")!;
    const cells = glyphDiagramLoopCells(exit, entry), label = glyphDiagramLoopLabelRect(exit, entry, loop);
    const xs = [...cells.map((p) => p.x), ...(label ? [label.x0, label.x1] : [])], ys = [...cells.map((p) => p.y), ...(label ? [label.y0, label.y1] : [])];
    return { loop, cells, ...(label ? { label } : {}), bounds: { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) } };
  });
}
