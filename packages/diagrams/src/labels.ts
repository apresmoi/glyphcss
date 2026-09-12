import { createGlyphCanvas, type GlyphCanvasTierName, type GlyphCanvasPoint } from "glyphcss";
import type { GlyphDiagramRect } from "./pipeline";

export interface GlyphDiagramLabelCandidate {
  readonly id: string; readonly x: number; readonly y: number; readonly text: string;
  readonly priority?: number; readonly maxWidth?: number;
  /** Edge labels must touch their own route's neighbourhood, or be dropped. */
  readonly route?: readonly GlyphCanvasPoint[];
}
export interface GlyphDiagramLabelLayoutOptions {
  readonly charset?: GlyphCanvasTierName;
  readonly obstacles: readonly GlyphDiagramRect[];
  readonly viewport: { readonly cols: number; readonly rows: number };
}
export interface GlyphDiagramPlacedLabel extends GlyphDiagramRect {
  readonly id: string; readonly x: number; readonly y: number; readonly text: string; readonly abbreviated: boolean;
}
export interface GlyphDiagramLabelLayoutResult { readonly placed: readonly GlyphDiagramPlacedLabel[]; readonly dropped: readonly string[]; readonly ledger: readonly string[] }

/** Measure the canvas's own grapheme folding, then enforce the ASCII target's narrower repertoire. */
export function glyphDiagramText(value: string, charset: GlyphCanvasTierName = "box"): string {
  const input = charset === "ascii" ? value.normalize("NFD").replace(/−/g, "-").replace(/…/g, "...") : value;
  const scratch = createGlyphCanvas({ cols: Math.max(1, input.length), rows: 1, tier: charset });
  scratch.text(0, 0, [input]);
  const folded = scratch.grid.char.join("").trimEnd();
  return charset === "ascii" ? folded.replace(/[^\x20-\x7e]/gu, "?") : folded;
}
export function glyphDiagramRectsOverlap(a: GlyphDiagramRect, b: GlyphDiagramRect): boolean {
  return a.x0 <= b.x1 && a.x1 >= b.x0 && a.y0 <= b.y1 && a.y1 >= b.y0;
}
export function glyphDiagramLabelLayout(candidates: readonly GlyphDiagramLabelCandidate[], options: GlyphDiagramLabelLayoutOptions): GlyphDiagramLabelLayoutResult {
  const placed: GlyphDiagramPlacedLabel[] = [], dropped: string[] = [], ledger: string[] = [];
  const occupied = [...options.obstacles];
  const { cols, rows } = options.viewport;
  for (const label of [...candidates].sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))) {
    let text = glyphDiagramText(label.text.replace(/\s+/g, " "), options.charset);
    const maxWidth = Math.max(0, Math.min(cols, label.maxWidth ?? cols));
    if (text.length > maxWidth) {
      const ellipsis = options.charset === "ascii" ? "..." : "…";
      text = maxWidth > ellipsis.length ? text.slice(0, maxWidth - ellipsis.length) + ellipsis : text.slice(0, maxWidth);
    }
    const abbreviated = text !== label.text;
    if (abbreviated) ledger.push(`label "${label.id}": abbreviated "${label.text}" -> "${text}".`);
    if (!text) { dropped.push(label.id); ledger.push(`label "${label.id}": dropped — no text cells available.`); continue; }
    // Distance order keeps an edge label near its route instead of opportunistically jumping to an unrelated row.
    const positions: { x: number; y: number; distance: number }[] = [];
    for (let y = 0; y < rows; y++) for (let x = 0; x + text.length <= cols; x++) {
      if (label.route && !label.route.some((p) => Math.max(x - p.x, 0, p.x - (x + text.length - 1)) + Math.abs(y - p.y) === 1)) continue;
      positions.push({ x, y, distance: Math.abs(x + Math.floor(text.length / 2) - label.x) + 2 * Math.abs(y - label.y) });
    }
    positions.sort((a, b) => a.distance - b.distance || a.y - b.y || a.x - b.x);
    const position = positions.find(({ x, y }) => !occupied.some((rect) => glyphDiagramRectsOverlap(rect, { x0: x, y0: y, x1: x + text.length - 1, y1: y })));
    if (!position) { dropped.push(label.id); ledger.push(`label "${label.id}": dropped — no free rectangle for "${text}".`); continue; }
    const { x, y } = position;
    const result = { id: label.id, x, y, text, abbreviated, x0: x, y0: y, x1: x + text.length - 1, y1: y };
    placed.push(result); occupied.push(result);
  }
  return { placed, dropped, ledger };
}
