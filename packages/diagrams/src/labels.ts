import { GLYPH_DIAGRAM_BRANCH_LABEL, GLYPH_DIAGRAM_ROUTE_TOUCH } from "./layoutHints";
import { createGlyphCanvas, type GlyphCanvasTierName, type GlyphCanvasPoint } from "glyphcss";
import type { GlyphDiagramRect } from "./pipeline";
import { ledgerLabelAbbreviated, ledgerLabelDropped, ledgerLabelNearForeignGroup, type GlyphDiagramLedgerEntry } from "./ledger";

/** Ledger phrasing only — never placement/measurement. Mirrors `paint.ts`'s own id prefixes. */
function labelRole(id: string): string {
  if (id === "title") return "diagram title";
  if (id.startsWith("group:")) return "group label";
  if (id.startsWith("edge:") || id.startsWith("edge-row:")) return "edge label";
  return "node label";
}

export interface GlyphDiagramLabelCandidate {
  readonly id: string; readonly x: number; readonly y: number; readonly text: string;
  readonly priority?: number; readonly maxWidth?: number;
  /** An exact top-left cell: the label goes there or is dropped. It is not searched for, so it need not touch a route. */
  readonly place?: { readonly x: number; readonly y: number };
  /** Owned space held against other labels even when this row has no text. */
  readonly reserve?: GlyphDiagramRect;
  /** Edge labels stay beside their route, with one blank cell beside vertical stems. */
  readonly route?: readonly GlyphCanvasPoint[];
  readonly [GLYPH_DIAGRAM_BRANCH_LABEL]?: boolean;
  readonly [GLYPH_DIAGRAM_ROUTE_TOUCH]?: boolean;
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
  // The three one-glyph markers the state adapter writes (and any label holding them) fold to look-alikes, not "?".
  const input = charset === "ascii" ? value.normalize("NFD").replace(/−/g, "-").replace(/…/g, "...").replace(/[●◆]/g, "*").replace(/◉/g, "@") : value;
  if (/^[\x20-\x7e]*$/.test(input)) return input.trimEnd();
  const scratch = createGlyphCanvas({ cols: Math.max(1, input.length), rows: 1, tier: charset });
  scratch.text(0, 0, [input]);
  const folded = scratch.grid.char.join("").trimEnd();
  return charset === "ascii" ? folded.replace(/[^\x20-\x7e]/gu, "?") : folded;
}
export function glyphDiagramRectsOverlap(a: GlyphDiagramRect, b: GlyphDiagramRect): boolean {
  return a.x0 <= b.x1 && a.x1 >= b.x0 && a.y0 <= b.y1 && a.y1 >= b.y0;
}
/**
 * Fold+truncate one label to at most `maxWidth` cells, ellipsis included —
 * the same rule `glyphDiagramLabelLayout` already applies inline to a
 * dropped-for-space candidate, factored out so a form with no label-arbiter
 * pass of its own (the sequence form's participant/message labels, and every
 * later form sharing this scaffolding) can reuse it directly instead of
 * re-deriving the ellipsis-fit arithmetic.
 */
export function glyphDiagramTruncateLabel(text: string, maxWidth: number, charset: GlyphCanvasTierName = "box"): string {
  const value = glyphDiagramText(text, charset);
  if (value.length <= Math.max(0, maxWidth)) return value;
  const ellipsis = charset === "ascii" ? "..." : "…";
  return maxWidth > ellipsis.length ? value.slice(0, maxWidth - ellipsis.length) + ellipsis : value.slice(0, Math.max(0, maxWidth));
}
export function glyphDiagramLabelLayout(candidates: readonly GlyphDiagramLabelCandidate[], options: GlyphDiagramLabelLayoutOptions): GlyphDiagramLabelLayoutResult {
  const placed: GlyphDiagramPlacedLabel[] = [], dropped: string[] = [], ledger: GlyphDiagramLedgerEntry[] = [];
  const occupied = new Uint8Array(options.viewport.cols * options.viewport.rows);
  const occupy = (rect: GlyphDiagramRect) => {
    const left = Math.max(0, rect.x0), right = Math.min(options.viewport.cols - 1, rect.x1);
    if (left > right) return;
    for (let y = Math.max(0, rect.y0); y <= Math.min(options.viewport.rows - 1, rect.y1); y++)
      occupied.fill(1, y * options.viewport.cols + left, y * options.viewport.cols + right + 1);
  };
  for (const rect of options.obstacles) occupy(rect);
  const reservations = candidates.filter((label) => label.reserve !== undefined);
  const { cols, rows } = options.viewport;
  // Fixed rows go first, in reading order independent of their synthetic ids; reservations also hold blank cells.
  for (const label of [...candidates].sort((a, b) => Number(b.place !== undefined) - Number(a.place !== undefined) || (b.priority ?? 0) - (a.priority ?? 0) || (a[GLYPH_DIAGRAM_BRANCH_LABEL] && b[GLYPH_DIAGRAM_BRANCH_LABEL] ? b.text.length - a.text.length : 0) || (a.place && b.place ? a.place.y - b.place.y || a.place.x - b.place.x : 0) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))) {
    const role = labelRole(label.id);
    let text = glyphDiagramText(label.text.replace(/\s+/g, " "), options.charset);
    const maxWidth = Math.max(0, Math.min(cols, label.maxWidth ?? cols));
    // A candidate with nothing to show (an empty row of a multi-row label, a blank label) is not a label: nothing is placed and nothing is reported.
    if (!text.trim()) continue;
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
    const positions: { x: number; y: number; distance: number; nearForeignGroup: boolean; touchesRoute: boolean }[] = [];
    const cells = new Set<number>();
    const add = (x: number, y: number) => {
      if (x >= 0 && y >= 0 && y < rows && x + text.length <= cols) cells.add(y * cols + x);
    };
    if (label.place) add(label.place.x, label.place.y);
    else if (label.route) {
      const routeCells = new Set(label.route.map(p => `${p.x},${p.y}`));
      for (const p of label.route) {
        // A horizontal label belongs to the full branch segment, not a single bend at its far end.
        if (!label[GLYPH_DIAGRAM_BRANCH_LABEL]) for (let x = p.x - text.length + 1; x <= p.x; x++) {
          add(x, p.y - 1); add(x, p.y + 1);
        }
        else if (!routeCells.has(`${p.x - 1},${p.y}`)) {
          let right = p.x;
          while (routeCells.has(`${right + 1},${p.y}`)) right++;
          const inset = text.length > 2 ? 1 : 0, interior = Math.max(1, text.length - 2);
          for (let x = p.x - inset; x <= right - inset - interior + 1; x++) {
            add(x, p.y - 1); add(x, p.y + 1);
          }
        }
        if (!label[GLYPH_DIAGRAM_BRANCH_LABEL] || routeCells.has(`${p.x},${p.y - 1}`) || routeCells.has(`${p.x},${p.y + 1}`)) {
          add(p.x - text.length - 1, p.y); add(p.x + 2, p.y);
        }
      }
    }
    else for (let y = 0; y < rows; y++) for (let x = 0; x + text.length <= cols; x++) add(x, y);
    for (const cell of cells) {
      const x = cell % cols, y = Math.floor(cell / cols);
      const rect = { x0: x, y0: y, x1: x + text.length - 1, y1: y };
      if (occupied.subarray(y * cols + x, y * cols + x + text.length).some(cell => cell !== 0)
        || reservations.some(owner => owner !== label && glyphDiagramRectsOverlap(owner.reserve!, rect))) continue;
      positions.push({ x, y, distance: Math.abs(x + Math.floor(text.length / 2) - label.x) + 2 * Math.abs(y - label.y), nearForeignGroup: touchedGroups(rect).length > 0,
        touchesRoute: label[GLYPH_DIAGRAM_ROUTE_TOUCH] && label.route?.some(p => Math.max(rect.x0 - p.x, 0, p.x - rect.x1) + Math.abs(y - p.y) === 1) || false });
    }
    positions.sort((a, b) => (a.nearForeignGroup === b.nearForeignGroup ? 0 : a.nearForeignGroup ? 1 : -1) || Number(b.touchesRoute) - Number(a.touchesRoute) || a.distance - b.distance || a.y - b.y || a.x - b.x);
    const position = positions[0];
    if (!position) { dropped.push(label.id); ledger.push(ledgerLabelDropped({ role, text, reason: "there was no free space near its target" })); continue; }
    const { x, y } = position;
    const result = { id: label.id, x, y, text, abbreviated, x0: x, y0: y, x1: x + text.length - 1, y1: y };
    for (const groupId of touchedGroups(result)) ledger.push(ledgerLabelNearForeignGroup({ role, text, groupId }));
    placed.push(result); occupy(result);
  }
  return { placed, dropped, ledger };
}
