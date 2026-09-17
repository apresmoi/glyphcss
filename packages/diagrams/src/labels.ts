import { createGlyphCanvas, type GlyphCanvasTierName, type GlyphCanvasPoint } from "glyphcss";
import type { GlyphDiagramRect } from "./pipeline";
import { ledgerLabelAbbreviated, ledgerLabelDropped, ledgerLabelNearForeignGroup, type GlyphDiagramLedgerEntry } from "./ledger";

/** Ledger phrasing only — never placement/measurement. Mirrors `paint.ts`'s own id prefixes. */
function labelRole(id: string): string {
  if (id === "title") return "diagram title";
  if (id.startsWith("group:")) return "group label";
  if (id.startsWith("edge:")) return "edge label";
  return "node label";
}

export interface GlyphDiagramLabelCandidate {
  readonly id: string; readonly x: number; readonly y: number; readonly text: string;
  readonly priority?: number; readonly maxWidth?: number;
  /** Edge labels must touch their own route's neighbourhood, or be dropped. */
  readonly route?: readonly GlyphCanvasPoint[];
  /**
   * Groups this label PREFERS not to touch — a candidate cell whose own
   * text span overlaps or is orthogonally adjacent to one of these rects
   * (checked as overlap against the rect grown by one cell on every side,
   * which covers both "inside" and "orthogonally adjacent" in one test) is
   * tried only after every candidate that avoids them entirely. USER
   * FEEDBACK, verbatim: "the label of retry shouldn't be near workers, it
   * should be from the other side of the workers box, otherwise its
   * confusing" — an edge label landing next to a group neither of its
   * endpoints belongs to reads as annotating that group. This is a
   * PREFERENCE, not a hard obstacle: with no candidate anywhere on the
   * label's own route clear of every `avoid` rect, the nearest
   * otherwise-valid position is still used (a `label-near-foreign-group`
   * ledger entry names which group) rather than dropping a label the
   * existing route-adjacency contract already guarantees room for.
   */
  readonly avoid?: readonly { readonly rect: GlyphDiagramRect; readonly groupId: string }[];
}
export interface GlyphDiagramLabelLayoutOptions {
  readonly charset?: GlyphCanvasTierName;
  readonly obstacles: readonly GlyphDiagramRect[];
  readonly viewport: { readonly cols: number; readonly rows: number };
}
export interface GlyphDiagramPlacedLabel extends GlyphDiagramRect {
  readonly id: string; readonly x: number; readonly y: number; readonly text: string; readonly abbreviated: boolean;
}
export interface GlyphDiagramLabelLayoutResult { readonly placed: readonly GlyphDiagramPlacedLabel[]; readonly dropped: readonly string[]; readonly ledger: readonly GlyphDiagramLedgerEntry[] }

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
  const placed: GlyphDiagramPlacedLabel[] = [], dropped: string[] = [], ledger: GlyphDiagramLedgerEntry[] = [];
  const occupied = [...options.obstacles];
  const { cols, rows } = options.viewport;
  for (const label of [...candidates].sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))) {
    const role = labelRole(label.id);
    let text = glyphDiagramText(label.text.replace(/\s+/g, " "), options.charset);
    const maxWidth = Math.max(0, Math.min(cols, label.maxWidth ?? cols));
    if (text.length > maxWidth) {
      const ellipsis = options.charset === "ascii" ? "..." : "…";
      text = maxWidth > ellipsis.length ? text.slice(0, maxWidth - ellipsis.length) + ellipsis : text.slice(0, maxWidth);
    }
    const abbreviated = text !== label.text;
    if (abbreviated) ledger.push(ledgerLabelAbbreviated({ role, before: label.text, after: text }));
    if (!text) { dropped.push(label.id); ledger.push(ledgerLabelDropped({ role, reason: "there was no room for any text" })); continue; }
    // Distance order keeps an edge label near its route instead of opportunistically jumping to an unrelated row.
    // `avoid` rects (a foreign group's own boundary, grown by one cell so
    // "inside" and "orthogonally adjacent" are the same overlap test) are a
    // PREFERENCE ranked ahead of distance: every candidate clear of them is
    // tried before any candidate that touches one, so the search only ever
    // lands on a foreign group's doorstep when nothing else on the route
    // is free.
    const avoid = (label.avoid ?? []).map(({ rect, groupId }) => ({ groupId, rect: { x0: rect.x0 - 1, y0: rect.y0 - 1, x1: rect.x1 + 1, y1: rect.y1 + 1 } }));
    const touchedGroups = (rect: GlyphDiagramRect) => avoid.filter((a) => glyphDiagramRectsOverlap(a.rect, rect)).map((a) => a.groupId);
    const positions: { x: number; y: number; distance: number; nearForeignGroup: boolean }[] = [];
    for (let y = 0; y < rows; y++) for (let x = 0; x + text.length <= cols; x++) {
      if (label.route && !label.route.some((p) => Math.max(x - p.x, 0, p.x - (x + text.length - 1)) + Math.abs(y - p.y) === 1)) continue;
      const rect = { x0: x, y0: y, x1: x + text.length - 1, y1: y };
      positions.push({ x, y, distance: Math.abs(x + Math.floor(text.length / 2) - label.x) + 2 * Math.abs(y - label.y), nearForeignGroup: touchedGroups(rect).length > 0 });
    }
    positions.sort((a, b) => (a.nearForeignGroup === b.nearForeignGroup ? 0 : a.nearForeignGroup ? 1 : -1) || a.distance - b.distance || a.y - b.y || a.x - b.x);
    const position = positions.find(({ x, y }) => !occupied.some((rect) => glyphDiagramRectsOverlap(rect, { x0: x, y0: y, x1: x + text.length - 1, y1: y })));
    if (!position) { dropped.push(label.id); ledger.push(ledgerLabelDropped({ role, text, reason: "there was no free space near its target" })); continue; }
    const { x, y } = position;
    const result = { id: label.id, x, y, text, abbreviated, x0: x, y0: y, x1: x + text.length - 1, y1: y };
    for (const groupId of touchedGroups(result)) ledger.push(ledgerLabelNearForeignGroup({ role, text, groupId }));
    placed.push(result); occupied.push(result);
  }
  return { placed, dropped, ledger };
}
