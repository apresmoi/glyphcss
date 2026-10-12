import type { GlyphCanvasTierName } from "glyphcss";
import { glyphDiagramText, glyphDiagramTruncateLabel } from "../labels";
import { ledgerLabelAbbreviated, type GlyphDiagramLedgerEntry } from "../ledger";
import type { GlyphSequence, GlyphSequenceFrame, GlyphSequenceMessage, GlyphSequenceParticipantShape } from "./types";

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

function markerText(kind: string, label: string | undefined, separator: string, charset: GlyphCanvasTierName): string {
  return glyphDiagramText(label ? `${kind}${separator}${label}` : kind, charset);
}

/**
 * Nesting depth from the inside out: a frame enclosing no other frame is 1.
 * Its sides sit `1 + depth` cells outside the lifelines it spans, so a frame
 * nested inside another keeps its sides inside the outer frame's. Two frames
 * over the same range nest in authored order, the later one outside — the
 * Mermaid adapter closes the inner block first.
 */
function frameDepths(frames: readonly GlyphSequenceFrame[]): number[] {
  const inside = (a: number, b: number): boolean => {
    const f = frames[a]!, g = frames[b]!;
    return f.from >= g.from && f.to <= g.to && (f.from > g.from || f.to < g.to || a < b);
  };
  const depth: number[] = [];
  const order = frames.map((_, i) => i).sort((a, b) => (frames[a]!.to - frames[a]!.from) - (frames[b]!.to - frames[b]!.from) || a - b);
  for (const i of order) depth[i] = 1 + Math.max(0, ...order.filter((j) => j !== i && depth[j] !== undefined && inside(j, i)).map((j) => depth[j]!));
  return depth;
}

/** The rightmost cell a self-message paints: its loop, or its label to the loop's right. */
function selfInkRight(x: number, label: string): number { return x + Math.max(2, 1 + label.length); }

/** A frame's box columns. */
export interface GlyphSequenceFrameExtent { readonly x0: number; readonly x1: number }

/** Each frame's box over the whole sequence — `renderGlyphSequence` hands these to a paged panel so a frame cut by a page break keeps its box. */
export function glyphSequenceFrameExtents(sequence: GlyphSequence, columns: readonly GlyphSequenceColumn[], opts: { readonly charset?: GlyphCanvasTierName; readonly labelCap?: number } = {}): GlyphSequenceFrameExtent[] {
  const xOf = new Map(columns.map((c) => [c.id, c.x]));
  return frameBoxes(sequence, sequence.participants.map((p) => xOf.get(p.id)!), opts.labelCap ?? Number.MAX_SAFE_INTEGER, opts.charset ?? "box").map(({ x0, x1 }) => ({ x0, x1 }));
}

interface GlyphSequenceFrameBox { readonly lo: number; readonly hi: number; readonly x0: number; readonly x1: number; readonly text: string; readonly short: number }

/**
 * Each frame's box over column positions `xs` (participant order): its sides
 * clear the lifelines its messages and notes touch and any self-message ink,
 * and it widens to the right when its label is longer — `short` is by how
 * much, so the column layout can widen the gaps inside it instead.
 */
function frameBoxes(sequence: GlyphSequence, xs: readonly number[], labelCap: number, charset: GlyphCanvasTierName, extents?: readonly GlyphSequenceFrameExtent[]): GlyphSequenceFrameBox[] {
  const frames = sequence.frames ?? [];
  const depths = frameDepths(frames);
  const indexOf = new Map(sequence.participants.map((p, i) => [p.id, i]));
  // Innermost first, so an outer frame can wrap the boxes already inside it.
  const boxes: GlyphSequenceFrameBox[] = [];
  const order = frames.map((_, i) => i).sort((a, b) => depths[a]! - depths[b]! || a - b);
  for (const f of order) boxes[f] = box(f);
  return boxes;

  function box(f: number): GlyphSequenceFrameBox {
    const frame = frames[f]!;
    const touched: number[] = [];
    let ink = -Infinity;
    for (let i = frame.from; i <= frame.to; i++) {
      const m = sequence.messages[i]!;
      touched.push(indexOf.get(m.from)!, indexOf.get(m.to)!);
      if (m.from === m.to) ink = Math.max(ink, selfInkRight(xs[indexOf.get(m.from)!]!, glyphDiagramTruncateLabel(m.label ?? "", labelCap, charset)));
    }
    for (const note of sequence.notes ?? []) if (note.at >= frame.from && note.at <= frame.to) touched.push(...note.over.map((id) => indexOf.get(id)!));
    const lo = Math.min(...touched), hi = Math.max(...touched);
    const offset = 1 + depths[f]!;
    const text = markerText(frame.kind, frame.label === undefined ? undefined : glyphDiagramTruncateLabel(frame.label, labelCap, charset), " ", charset);
    const inner = order.filter((g) => depths[g]! < depths[f]! && boxes[g] && frames[g]!.from >= frame.from && frames[g]!.to <= frame.to).map((g) => boxes[g]!);
    const extent = extents?.[f];
    const x0 = Math.min(xs[lo]! - offset, ...inner.map((b) => b.x0 - 1), extent?.x0 ?? Infinity);
    const base = Math.max(Math.max(xs[hi]!, ink) + offset, ...inner.map((b) => b.x1 + 1), extent?.x1 ?? -Infinity);
    const fit = x0 + text.length + 5;
    return { lo, hi, x0, x1: Math.max(base, fit), text, short: Math.max(0, fit - base) };
  }
}

/**
 * Column x-positions from participant label widths and every message's own
 * label length — an adjacent message widens its own gap directly; a message
 * spanning several columns widens every gap it crosses by an even share of
 * whatever the natural gaps still leave short. A self-message's label needs
 * room to the right of its loop, and a frame needs room for its sides and
 * label: a frame whose label outgrows its lifelines widens the gaps inside
 * it, and one whose side would touch a neighbouring lifeline pushes that
 * neighbour away. `labelCap` bounds every label BEFORE this sizing runs (the
 * degrade lever — see `layoutGlyphSequenceColumns`).
 */
function columnPositions(sequence: GlyphSequence, labelCap: number, charset: GlyphCanvasTierName): { readonly xs: readonly number[]; readonly labels: readonly string[]; readonly width: number } {
  const { participants, messages } = sequence;
  const labels = participants.map((p) => glyphDiagramTruncateLabel(p.label, labelCap, charset));
  const halves = labels.map(halfWidth);
  const indexOf = new Map(participants.map((p, i) => [p.id, i]));
  const gaps = new Array(Math.max(0, participants.length - 1)).fill(0).map((_, i) => Math.max(MIN_GAP, halves[i]! + halves[i + 1]! + 2));
  const selfAt = new Set(messages.filter((m) => m.from === m.to).map((m) => indexOf.get(m.from)!));
  for (let i = 0; i < gaps.length; i++) if (selfAt.has(i)) gaps[i] = Math.max(gaps[i]!, SELF_LOOP_WIDTH + 2);
  let inkRight = -Infinity;
  for (const message of messages) {
    if (!message.label) continue;
    const label = glyphDiagramTruncateLabel(message.label, labelCap, charset);
    const lo = Math.min(indexOf.get(message.from)!, indexOf.get(message.to)!);
    const hi = Math.max(indexOf.get(message.from)!, indexOf.get(message.to)!);
    if (lo === hi) {
      if (lo < gaps.length) gaps[lo] = Math.max(gaps[lo]!, selfInkRight(0, label) + 2);
      continue;
    }
    const required = label.length + 4;
    const span = gaps.slice(lo, hi).reduce((a, b) => a + b, 0);
    if (required > span) {
      const deficit = Math.ceil((required - span) / (hi - lo));
      for (let i = lo; i < hi; i++) gaps[i] = gaps[i]! + deficit;
    }
  }
  let lead = halves[0]! + 1;
  const positions = (): number[] => {
    const xs = [lead];
    for (let i = 0; i < gaps.length; i++) xs.push(xs[i]! + gaps[i]!);
    return xs;
  };
  let xs = positions();
  // Each pass only widens, so this settles; the cap bounds a pathological nest.
  for (let pass = 0; pass < 2 * (sequence.frames?.length ?? 0); pass++) {
    let changed = false;
    for (const box of frameBoxes(sequence, xs, labelCap, charset)) {
      if (box.short > 0 && box.hi > box.lo) {
        const share = Math.ceil(box.short / (box.hi - box.lo));
        for (let i = box.lo; i < box.hi; i++) gaps[i] = gaps[i]! + share;
        changed = true;
      } else if (box.hi < gaps.length && box.x1 > xs[box.hi + 1]! - 2) {
        gaps[box.hi] = gaps[box.hi]! + box.x1 - (xs[box.hi + 1]! - 2);
        changed = true;
      }
      if (box.lo > 0 && box.x0 < xs[box.lo - 1]! + 2) { gaps[box.lo - 1] = gaps[box.lo - 1]! + xs[box.lo - 1]! + 2 - box.x0; changed = true; }
      if (box.x0 < 0) { lead -= box.x0; changed = true; }
    }
    xs = positions();
    if (!changed) break;
  }
  for (const message of messages) if (message.from === message.to) inkRight = Math.max(inkRight, selfInkRight(xs[indexOf.get(message.from)!]!, glyphDiagramTruncateLabel(message.label ?? "", labelCap, charset)));
  for (const box of frameBoxes(sequence, xs, labelCap, charset)) inkRight = Math.max(inkRight, box.x1);
  const trailingSelf = participants.length ? selfAt.has(participants.length - 1) : false;
  const rightMargin = 2 + (trailingSelf ? SELF_LOOP_WIDTH + 2 : 0);
  const width = Math.max((xs[xs.length - 1] ?? 0) + halves[halves.length - 1]! + rightMargin, inkRight + 2);
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

export interface GlyphSequenceColumnsResult {
  readonly columns: readonly GlyphSequenceColumn[]; readonly width: number; readonly ledger: GlyphDiagramLedgerEntry[];
  /** The label cap the columns were sized with; pass it to `layoutGlyphSequenceRows` so frames size the same way. */
  readonly labelCap: number;
}

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
  const naturalCap = Math.max(3, ...sequence.participants.map((p) => p.label.length), ...sequence.messages.map((m) => m.label?.length ?? 0), ...(sequence.frames ?? []).map((f) => f.label?.length ?? 0));
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
  return { columns, width: result.width, ledger, labelCap: cap };
}

export interface GlyphSequenceFrameDivider { readonly row: number; readonly text: string }

export type GlyphSequenceRow =
  | { readonly type: "message"; readonly index: number; readonly message: GlyphSequenceMessage; readonly self: boolean; readonly fromX: number; readonly toX: number; readonly top: number; readonly height: number }
  /** A note's floating bar. `text` is the fully composed "kind  label" (or bare `kind` with no label) this marker displays — sized and centered as ONE string, never re-derived from `kind`/`label` separately downstream (that desynced the box width from the painted text — see the module's own history). */
  | { readonly type: "marker"; readonly kind: string; readonly label: string; readonly text: string; readonly x0: number; readonly x1: number; readonly centerX: number; readonly top: number; readonly height: number }
  /** A frame's box: `text` sits in the top border at `top`, each divider is one row, the bottom border is at `bottom`. */
  | { readonly type: "frame"; readonly kind: string; readonly label: string; readonly text: string; readonly x0: number; readonly x1: number; readonly top: number; readonly bottom: number; readonly dividers: readonly GlyphSequenceFrameDivider[] };

export interface GlyphSequenceRowsResult { readonly rows: readonly GlyphSequenceRow[]; readonly height: number }

/**
 * Box centered on the touched columns' own midpoint, widened only as far as
 * the label needs — a note's "floating bar", never a box enclosing rows.
 * `centerX` is carried through
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
 * Lays out every message, note and frame in AUTHORED order starting at row
 * `startRow` — one continuous block list, whatever the caller does with the
 * result. `renderGlyphSequence`'s own pager lays out each candidate panel's
 * sliced sub-sequence with this same call, so a panel's height is always
 * the height it paints at.
 *
 * Between two messages the order is fixed: frames ending there close (inner
 * first, each after its own trailing dividers), then the `air` row, then
 * dividers of frames still open, then frames starting there open (outer
 * first, each followed by any divider at its very start), then notes — so a
 * border sits flush against the messages it encloses.
 */
export function layoutGlyphSequenceRows(sequence: GlyphSequence, columns: readonly GlyphSequenceColumn[], startRow: number, opts: { readonly charset?: GlyphCanvasTierName; readonly width?: number; readonly air?: number; readonly labelCap?: number; readonly frameExtents?: readonly GlyphSequenceFrameExtent[] } = {}): GlyphSequenceRowsResult {
  const charset = opts.charset ?? "box";
  // Falls back to "unbounded" (no clamp) when the caller has no canvas width.
  const canvasWidth = opts.width ?? Number.MAX_SAFE_INTEGER;
  const xOf = new Map(columns.map((c) => [c.id, c.x]));
  const { messages } = sequence;
  const frames = sequence.frames ?? [];
  const notes = sequence.notes ?? [];
  const depths = frameDepths(frames);
  const rows: GlyphSequenceRow[] = [];
  let row = startRow;

  const boxes = frameBoxes(sequence, sequence.participants.map((p) => xOf.get(p.id)!), opts.labelCap ?? Number.MAX_SAFE_INTEGER, charset, opts.frameExtents);
  const frameBox = (index: number): { x0: number; x1: number; text: string } => {
    const { x0, x1, text } = boxes[index]!;
    return { x0: Math.max(0, x0), x1: Math.min(canvasWidth - 1, x1), text };
  };

  const open = new Map<number, { top: number; dividers: GlyphSequenceFrameDivider[] }>();
  const divide = (index: number, at: number): void => {
    for (const branch of frames[index]!.branches ?? []) {
      if (branch.at !== at) continue;
      open.get(index)!.dividers.push({ row, text: markerText(branch.kind, branch.label, " ", charset) });
      row++;
    }
  };
  const byDepth = (direction: 1 | -1) => (a: number, b: number) => direction * (depths[a]! - depths[b]!) || a - b;
  const frameIds = frames.map((_, i) => i);

  for (let i = 0; i <= messages.length; i++) {
    for (const index of frameIds.filter((f) => open.has(f) && frames[f]!.to === i - 1).sort(byDepth(1))) {
      const frame = frames[index]!;
      divide(index, i);
      const { x0, x1, text } = frameBox(index);
      const state = open.get(index)!;
      rows.push({ type: "frame", kind: frame.kind, label: frame.label ?? "", text, x0, x1, top: state.top, bottom: row, dividers: state.dividers });
      open.delete(index);
      row++;
    }
    if (i > 0 && i < messages.length) row += opts.air ?? 0;
    for (const index of frameIds.filter((f) => open.has(f)).sort(byDepth(-1))) divide(index, i);
    for (const index of frameIds.filter((f) => frames[f]!.from === i).sort(byDepth(-1))) {
      open.set(index, { top: row, dividers: [] });
      row++;
      divide(index, i);
    }
    for (const note of notes) {
      if (note.at !== i || !note.over.length) continue;
      const text = markerText("note", note.text, "  ", charset);
      const { x0, x1, centerX } = markerBox(note.over.map((id) => xOf.get(id)!), text, canvasWidth);
      rows.push({ type: "marker", kind: "note", label: note.text, text, x0, x1, centerX, top: row, height: 3 });
      row += 3;
    }
    if (i === messages.length) break;
    const message = messages[i]!;
    const self = message.from === message.to;
    const height = self ? 3 : 2;
    rows.push({ type: "message", index: i, message, self, fromX: xOf.get(message.from)!, toX: xOf.get(message.to)!, top: row, height });
    row += height;
  }
  return { rows, height: row - startRow };
}
