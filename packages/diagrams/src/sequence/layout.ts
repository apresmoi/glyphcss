import type { GlyphCanvasTierName } from "glyphcss";
import { glyphDiagramText, glyphDiagramTruncateLabel } from "../labels";
import { ledgerLabelAbbreviated, type GlyphDiagramLedgerEntry } from "../ledger";
import type { GlyphSequence, GlyphSequenceMessage, GlyphSequenceParticipantShape } from "./types";

/**
 * There is no layout PROBLEM here (see the package's own sequence contract
 * doc): participant order is authored, time runs strictly downward, and
 * every geometric decision below is a direct, deterministic function of
 * label lengths and message endpoints — no dagre, no A*, no rank
 * assignment. `participants`/`messages`/`frames`/`notes` are walked in
 * their AUTHORED order throughout; nothing here ever sorts them.
 */

export interface GlyphSequenceColumn {
  readonly id: string;
  readonly label: string;
  readonly shape: GlyphSequenceParticipantShape;
  readonly x: number;
}

const SELF_LOOP_WIDTH = 3;
const MIN_GAP = 4;
/**
 * How far a participant gap may GROW to spend width the render was given.
 * USER FEEDBACK, verbatim: "this also is like super super constrained? can
 * we improve it?... give it a bit more air to the example" — the layout
 * placed columns at the MINIMUM gap and centred the result, so a two-
 * participant sequence stayed ~10 cells wide inside a 150-cell viewport
 * however much room it had. Capped rather than filling edge to edge: a
 * message label sits ON its own arrow, so an unbounded gap would strand the
 * label in the middle of a very long rule.
 */
const MAX_GAP_AIR = 14;

function halfWidth(label: string): number { return Math.max(1, Math.ceil(label.length / 2)); }

/**
 * Column x-positions from participant label widths and every message's own
 * label length — an adjacent message widens its own gap directly; a message
 * spanning several columns widens every gap it crosses by an even share of
 * whatever the natural gaps still leave short. `labelCap` bounds every
 * label BEFORE this sizing runs (the degrade lever — see `layoutGlyphSequence`).
 */
function columnPositions(sequence: GlyphSequence, labelCap: number, charset: GlyphCanvasTierName): { readonly xs: readonly number[]; readonly labels: readonly string[]; readonly width: number } {
  const { participants, messages } = sequence;
  const labels = participants.map((p) => glyphDiagramTruncateLabel(p.label, labelCap, charset));
  const halves = labels.map(halfWidth);
  const indexOf = new Map(participants.map((p, i) => [p.id, i]));
  const gaps = new Array(Math.max(0, participants.length - 1)).fill(0).map((_, i) => Math.max(MIN_GAP, halves[i]! + halves[i + 1]! + 2));
  const selfAt = new Set(messages.filter((m) => m.from === m.to).map((m) => indexOf.get(m.from)!));
  for (let i = 0; i < gaps.length; i++) if (selfAt.has(i)) gaps[i] = Math.max(gaps[i]!, SELF_LOOP_WIDTH + 2);
  for (const message of messages) {
    if (message.from === message.to || !message.label) continue;
    const lo = Math.min(indexOf.get(message.from)!, indexOf.get(message.to)!);
    const hi = Math.max(indexOf.get(message.from)!, indexOf.get(message.to)!);
    const required = glyphDiagramTruncateLabel(message.label, labelCap, charset).length + 4;
    const span = gaps.slice(lo, hi).reduce((a, b) => a + b, 0);
    if (required > span && hi > lo) {
      const deficit = Math.ceil((required - span) / (hi - lo));
      for (let i = lo; i < hi; i++) gaps[i] = gaps[i]! + deficit;
    }
  }
  const xs: number[] = [halves[0]! + 1];
  for (let i = 0; i < gaps.length; i++) xs.push(xs[i]! + gaps[i]!);
  const trailingSelf = participants.length ? selfAt.has(participants.length - 1) : false;
  const rightMargin = 2 + (trailingSelf ? SELF_LOOP_WIDTH + 2 : 0);
  const width = (xs[xs.length - 1] ?? 0) + halves[halves.length - 1]! + rightMargin;
  return { xs, labels, width };
}

/**
 * Spend leftover width on the gaps BETWEEN participants, evenly, capped at
 * `MAX_GAP_AIR` per gap. Never shrinks: a layout already at or over the
 * budget is returned untouched, so the degrade ladder above still owns the
 * too-wide case.
 */
function withAir(result: { readonly xs: readonly number[]; readonly labels: readonly string[]; readonly width: number }, maxWidth: number) {
  const gapCount = result.xs.length - 1;
  if (gapCount < 1 || result.width >= maxWidth) return result;
  const perGap = Math.min(MAX_GAP_AIR, Math.floor((maxWidth - result.width) / gapCount));
  if (perGap < 1) return result;
  const xs = [result.xs[0]!];
  for (let i = 1; i < result.xs.length; i++) xs.push(xs[i - 1]! + (result.xs[i]! - result.xs[i - 1]!) + perGap);
  return { xs, labels: result.labels, width: result.width + perGap * gapCount };
}

export interface GlyphSequenceColumnsResult { readonly columns: readonly GlyphSequenceColumn[]; readonly width: number; readonly ledger: GlyphDiagramLedgerEntry[] }

/**
 * Column layout with the degrade lever applied: `maxWidth` given and the
 * natural layout too wide, participant AND message labels are truncated
 * together under a shrinking cap until the layout fits or the cap bottoms
 * out at 3 cells (still fits nothing narrower without losing all meaning).
 * A message label that only informs GAP SIZING here is truncated again,
 * independently, against its own row's available width at paint time —
 * this pass only ever narrows the cap that feeds both.
 */
export function layoutGlyphSequenceColumns(sequence: GlyphSequence, opts: { readonly charset?: GlyphCanvasTierName; readonly maxWidth?: number } = {}): GlyphSequenceColumnsResult {
  const charset = opts.charset ?? "box";
  const naturalCap = Math.max(3, ...sequence.participants.map((p) => p.label.length), ...sequence.messages.map((m) => m.label?.length ?? 0));
  let cap = naturalCap;
  let result = columnPositions(sequence, cap, charset);
  if (opts.maxWidth !== undefined) {
    while (result.width > opts.maxWidth && cap > 3) { cap--; result = columnPositions(sequence, cap, charset); }
    result = withAir(result, opts.maxWidth);
  }
  const ledger: GlyphDiagramLedgerEntry[] = [];
  const columns: GlyphSequenceColumn[] = sequence.participants.map((p, i) => {
    const label = result.labels[i]!;
    if (label !== p.label) ledger.push(ledgerLabelAbbreviated({ role: "participant label", before: p.label, after: label }));
    return { id: p.id, label, shape: p.shape ?? "lane", x: result.xs[i]! };
  });
  return { columns, width: result.width, ledger };
}

export type GlyphSequenceRow =
  | { readonly type: "message"; readonly index: number; readonly message: GlyphSequenceMessage; readonly self: boolean; readonly fromX: number; readonly toX: number; readonly top: number; readonly height: number }
  /** `text` is the fully composed "kind  label" (or bare `kind` with no label) this marker displays — sized and centered as ONE string, never re-derived from `kind`/`label` separately downstream (that desynced the box width from the painted text — see the module's own history). */
  | { readonly type: "marker"; readonly kind: string; readonly label: string; readonly text: string; readonly x0: number; readonly x1: number; readonly centerX: number; readonly top: number; readonly height: number };

export interface GlyphSequenceRowsResult { readonly rows: readonly GlyphSequenceRow[]; readonly height: number }

/**
 * Box centered on the touched columns' own midpoint, widened only as far as
 * the label needs — the approved reference art's "floating condition bar",
 * never a UML box enclosing its spanned rows. `centerX` is carried through
 * (not re-derived from `x0`/`x1`) so the label painted at `centerX` always
 * lines up with the border this same call sized, regardless of width parity.
 * Clamped into `[0, canvasWidth - 1]`: a marker whose touched columns sit
 * near an edge (two adjacent participants at the canvas's left margin, a
 * long label) would otherwise center a wide box PAST the edge — `canvas.text`
 * silently drops any cell outside its bounds, which used to clip the box's
 * own leading corner and the start of its label off-screen instead of
 * shifting the box into view. `paint.ts`'s own truncation of the label
 * against the (now on-canvas) interior width is the only further narrowing
 * left to do, for the rare case where the box still can't fit at all.
 */
function markerBox(xs: readonly number[], label: string, canvasWidth: number): { x0: number; x1: number; centerX: number } {
  const lo = Math.min(...xs), hi = Math.max(...xs);
  const width = Math.min(canvasWidth, Math.max(hi - lo + 1, label.length + 4));
  const idealCenter = Math.round((lo + hi) / 2);
  const x0 = Math.min(Math.max(0, idealCenter - Math.floor(width / 2)), Math.max(0, canvasWidth - width));
  // Re-derived from the CLAMPED `x0`, never the pre-clamp `idealCenter` — a
  // clamp that only moved `x0` (the box's own left edge near canvas
  // column 0) would otherwise leave `centerX` pointing at a column outside
  // the box it is supposed to center text in, and `canvas.text`'s own
  // `align: "center"` formula (`x0 - floor(width/2)`, applied in reverse
  // here) silently walked the label off the left edge instead.
  return { x0, x1: x0 + width - 1, centerX: x0 + Math.floor(width / 2) };
}

/**
 * Lays out every message and marker in AUTHORED order starting at row
 * `startRow` — one continuous block list, whatever the caller does with the
 * result. `renderGlyphSequence`'s own pager (see `sequence/render.ts`) calls
 * this once over the whole sequence to find panel cut points, then again
 * per panel's own sliced sub-sequence; a single implementation with no
 * pagination awareness of its own keeps both calls byte-identical in shape.
 */
interface GlyphSequenceMarkerEvent { readonly at: number; readonly kind: string; readonly label: string; readonly xs: readonly number[] }

/** Frames (touched columns = every endpoint of their spanned messages) and notes (touched columns = `over` directly), combined and STABLE-sorted by anchor — frames keep their own authored order among themselves, and so do notes, so two markers anchored at the same message never swap places between calls. */
function markerEvents(sequence: GlyphSequence, xOf: ReadonlyMap<string, number>): GlyphSequenceMarkerEvent[] {
  const events: GlyphSequenceMarkerEvent[] = [];
  for (const frame of sequence.frames ?? []) {
    const xs: number[] = [];
    for (let i = frame.from; i <= frame.to; i++) { const m = sequence.messages[i]!; xs.push(xOf.get(m.from)!, xOf.get(m.to)!); }
    events.push({ at: frame.from, kind: frame.kind, label: frame.label ?? "", xs });
  }
  for (const note of sequence.notes ?? []) events.push({ at: note.at, kind: "note", label: note.text, xs: note.over.map((id) => xOf.get(id)!) });
  return events.map((e, i) => ({ e, i })).sort((a, b) => a.e.at - b.e.at || a.i - b.i).map(({ e }) => e);
}

export function layoutGlyphSequenceRows(sequence: GlyphSequence, columns: readonly GlyphSequenceColumn[], startRow: number, opts: { readonly charset?: GlyphCanvasTierName; readonly width?: number; readonly air?: number } = {}): GlyphSequenceRowsResult {
  const charset = opts.charset ?? "box";
  // Falls back to "unbounded" (no clamp) when the caller has no canvas width
  // yet — `renderGlyphSequence`'s own pre-pagination pass, which only needs
  // row COUNTS to find panel cut points, not on-canvas box positions.
  const canvasWidth = opts.width ?? Number.MAX_SAFE_INTEGER;
  const xOf = new Map(columns.map((c) => [c.id, c.x]));
  const rows: GlyphSequenceRow[] = [];
  let row = startRow;
  const events = markerEvents(sequence, xOf);
  let eventCursor = 0;
  const flushMarkersUpTo = (at: number) => {
    while (eventCursor < events.length && events[eventCursor]!.at === at) {
      const event = events[eventCursor]!;
      if (event.xs.length) {
        const text = glyphDiagramText(event.label ? `${event.kind}  ${event.label}` : event.kind, charset);
        const { x0, x1, centerX } = markerBox(event.xs, text, canvasWidth);
        rows.push({ type: "marker", kind: event.kind, label: event.label, text, x0, x1, centerX, top: row, height: 3 });
        row += 3;
      }
      eventCursor++;
    }
  };
  for (let i = 0; i < sequence.messages.length; i++) {
    flushMarkersUpTo(i);
    const message = sequence.messages[i]!;
    const self = message.from === message.to;
    const height = self ? 3 : 2;
    rows.push({ type: "message", index: i, message, self, fromX: xOf.get(message.from)!, toX: xOf.get(message.to)!, top: row, height });
    // `air` is a blank row BETWEEN consecutive messages — never after the
    // last one, which would push the trailing lifeline stub off centre. The
    // caller only asks for it when the height it was given can hold it.
    row += height + (opts.air ?? 0);
  }
  flushMarkersUpTo(sequence.messages.length);
  return { rows, height: row - startRow };
}
