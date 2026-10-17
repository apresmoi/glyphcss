import { glyphSequenceAuthoredOrder, orderGlyphSequenceItem } from "./authoredOrder";
import type { GlyphCanvas, GlyphCanvasTierName } from "glyphcss";
import { glyphSequenceFromMermaid } from "./mermaid";
import { glyphDiagramError } from "../validate";
import { parseGlyphSequenceJson, glyphSequenceRepairHint, validateGlyphSequence } from "./validate";
import { glyphSequenceFrameExtents, layoutGlyphSequenceColumns, layoutGlyphSequenceRows, type GlyphSequenceFrameExtent } from "./layout";
import { paintGlyphSequence } from "./paint";
import { dedupeGlyphDiagramLedger, type GlyphDiagramLedgerEntry } from "../ledger";
import { ledgerSequenceLayoutOverflow, ledgerSequencePaged } from "./ledger";
import type { GlyphSequence, GlyphSequenceFrame, GlyphSequenceNote, GlyphSequenceParticipant } from "./types";

export type GlyphSequenceTarget = "chat" | "terminal" | "web";
export type GlyphSequenceCharset = GlyphCanvasTierName;
export type GlyphSequenceColorMode = "none" | "ansi16" | "ansi256" | "truecolor" | "css";

export interface GlyphSequenceRenderOptions {
  readonly target?: GlyphSequenceTarget;
  readonly charset?: GlyphSequenceCharset;
  readonly color?: GlyphSequenceColorMode;
  readonly width?: number;
  readonly height?: number;
  readonly title?: string;
  /** Time-split panels at the requested height by default; expand keeps one panel and grows taller instead. */
  readonly overflow?: "paginate" | "expand";
  readonly env?: Readonly<Record<string, string | undefined>>;
  /**
   * Per-participant override — same `string | ((node) => string)` shape as
   * the root graph form's `nodeColor`. Default: the shared
   * `GLYPH_DIAGRAM_PALETTE`, cycled by the participant's position in
   * `participants`. Colours a participant's own lifeline, header label, and
   * every message row originating FROM it (arrow body, arrowhead, and the
   * message's own label) — never a message it only RECEIVES, and never the
   * frame/note marker bars, which span several participants and belong to
   * none of them alone. Never the only way to tell participants apart:
   * column position and the header label text already do that. Never
   * affects `color: "none"` output.
   */
  readonly participantColor?: string | ((participant: GlyphSequenceParticipant) => string);
}

export interface GlyphSequenceReport { readonly ledger: readonly GlyphDiagramLedgerEntry[]; readonly unsupportedGlyphs: readonly string[] }
export interface GlyphSequencePage { readonly text: string; readonly html?: string; readonly canvas: GlyphCanvas }
export interface GlyphSequenceMeta {
  readonly participants: GlyphSequence["participants"]; readonly messages: GlyphSequence["messages"];
  readonly frames: readonly GlyphSequenceFrame[]; readonly notes: readonly GlyphSequenceNote[]; readonly description: string;
}
export interface GlyphSequenceResult extends GlyphSequencePage {
  readonly meta: GlyphSequenceMeta; readonly report: GlyphSequenceReport;
  /** Every time-split panel, including the first — see `GlyphDiagramResult.pages`' own doc for the identical convention this mirrors. */
  readonly pages: readonly GlyphSequencePage[];
}

// Mirrors `GLYPH_DIAGRAM_TARGET_DEFAULTS` (root) and `GLYPH_CHART_TARGET_DEFAULTS` (`@glyphcss/charts`) exactly, for
// contract consistency across every form this package exposes: braille is the default wherever a sub-cell tier is
// safe, chat stays box (Slack/Discord fonts break braille/junctions sometimes). A sequence diagram paints only
// whole-cell box-drawing regardless of charset (no painter here ever hits `line()`'s sub-cell path — see
// `paint.ts`), so this is a naming/contract match only, not a rendering change.
export const GLYPH_SEQUENCE_TARGET_DEFAULTS: Readonly<Record<GlyphSequenceTarget, { width: number; height: number; charset: GlyphSequenceCharset; color: GlyphSequenceColorMode }>> = Object.freeze({
  chat: { width: 72, height: 24, charset: "box", color: "none" },
  terminal: { width: 80, height: 24, charset: "braille", color: "truecolor" },
  web: { width: 96, height: 32, charset: "braille", color: "css" },
});

function resolvedOptions(options: GlyphSequenceRenderOptions) {
  const target = options.target ?? "web";
  if (!["chat", "terminal", "web"].includes(target)) glyphDiagramError("bad-options", "target must be chat, terminal, or web.");
  const defaults = GLYPH_SEQUENCE_TARGET_DEFAULTS[target];
  const result = { ...options, target, width: options.width ?? defaults.width, height: options.height ?? defaults.height,
    charset: options.charset ?? defaults.charset, color: options.color ?? defaults.color };
  if (![result.width, result.height].every((v) => Number.isInteger(v) && v > 0)) glyphDiagramError("bad-size", "width and height must be positive integers.");
  if (!["ascii", "box", "blocks", "braille"].includes(result.charset) || !["none", "ansi16", "ansi256", "truecolor", "css"].includes(result.color)
    || (options.title !== undefined && typeof options.title !== "string")
    || (options.overflow !== undefined && !["paginate", "expand"].includes(options.overflow))) glyphDiagramError("bad-options", "Use supported target, charset, color, overflow, and title options.");
  return result;
}

/**
 * Messages `from..to` as a sequence of their own. A frame that started in an
 * earlier panel reopens at the top under the header of the segment it is in
 * (its last divider before `from`, else its own), so a continued `else`
 * still says which branch it is. Notes after the last message ride with the
 * last panel.
 */
interface GlyphSequencePanel { readonly sequence: GlyphSequence; readonly frameExtents: readonly GlyphSequenceFrameExtent[] }

function panelSequence(sequence: GlyphSequence, extents: readonly GlyphSequenceFrameExtent[], from: number, to: number): GlyphSequencePanel {
  const last = to === sequence.messages.length - 1;
  const frames: GlyphSequenceFrame[] = [];
  const frameExtents: GlyphSequenceFrameExtent[] = [];
  for (const [index, frame] of (sequence.frames ?? []).entries()) {
    if (frame.to < from || frame.from > to) continue;
    frameExtents.push(extents[index]!);
    const branches = frame.branches ?? [];
    const current = frame.from < from ? branches.filter((b) => b.at <= from).at(-1) : undefined;
    const head = current ?? frame;
    const end = Math.min(frame.to, to);
    // A continued frame's divider AT `from` became its header; one past `to`
    // belongs to the next panel unless the frame closes here.
    const kept = branches.filter((b) => (current ? b.at > from : true) && b.at <= (frame.to <= to ? frame.to + 1 : to))
      .map((b) => orderGlyphSequenceItem({ ...b, at: b.at - from }, glyphSequenceAuthoredOrder(b)));
    frames.push(orderGlyphSequenceItem({
      kind: head.kind, ...(head.label === undefined ? {} : { label: head.label }),
      from: Math.max(frame.from, from) - from, to: end - from, ...(kept.length ? { branches: kept } : {}),
    }, glyphSequenceAuthoredOrder(frame)));
  }
  const notes = (sequence.notes ?? []).filter((n) => n.at >= from && (n.at <= to || (last && n.at === to + 1))).map((n) => orderGlyphSequenceItem({ ...n, at: n.at - from }, glyphSequenceAuthoredOrder(n)));
  return {
    sequence: { participants: sequence.participants, messages: sequence.messages.slice(from, to + 1), ...(frames.length ? { frames } : {}), ...(notes.length ? { notes } : {}) },
    frameExtents,
  };
}

export async function renderGlyphSequence(input: GlyphSequence | string, options: GlyphSequenceRenderOptions = {}): Promise<GlyphSequenceResult> {
  const sequence = validateGlyphSequence(typeof input === "string" ? glyphSequenceFromMermaid(input) : input);
  const opts = resolvedOptions({ ...options, title: options.title === undefined ? sequence.title : options.title });
  const ledger: GlyphDiagramLedgerEntry[] = [];

  const cols = layoutGlyphSequenceColumns(sequence, { charset: opts.charset, maxWidth: opts.width });
  ledger.push(...cols.ledger);

  const hasActor = cols.columns.some((c) => c.shape === "actor");
  const headerRows = (hasActor ? 2 : 1) + (opts.title ? 2 : 0);
  const pageHeight = (body: number): number => headerRows + 1 + body + 1;
  const extents = glyphSequenceFrameExtents(sequence, cols.columns, { charset: opts.charset, labelCap: cols.labelCap });
  const layout = (panel: GlyphSequencePanel, air: number) => layoutGlyphSequenceRows(panel.sequence, cols.columns, 0, { charset: opts.charset, width: opts.width, air, labelCap: cols.labelCap, frameExtents: panel.frameExtents });
  const whole: GlyphSequencePanel = { sequence, frameExtents: extents };
  // Spend leftover HEIGHT the same way the columns spend leftover width: one
  // blank row between messages, only when the whole sequence still fits with
  // it. A paged sequence takes none — the panels are already at the limit.
  const natural = layout(whole, 0);
  const aired = sequence.messages.length > 1 ? layout(whole, 1) : natural;
  const air = aired !== natural && pageHeight(aired.height) <= opts.height ? 1 : 0;
  const full = air ? aired : natural;
  if (cols.width > opts.width) ledger.push(ledgerSequenceLayoutOverflow({ naturalWidth: cols.width, naturalHeight: pageHeight(full.height), requestedWidth: opts.width, requestedHeight: opts.height }));

  // Greedy by time: each panel takes messages while its own laid-out height
  // (reopened frames included) fits; one message too tall still gets a panel.
  const panels: GlyphSequencePanel[] = [];
  if (pageHeight(full.height) <= opts.height || sequence.messages.length === 0 || opts.overflow === "expand") panels.push(whole);
  else {
    for (let start = 0; start < sequence.messages.length;) {
      let end = start;
      while (end + 1 < sequence.messages.length && pageHeight(layout(panelSequence(sequence, extents, start, end + 1), 0).height) <= opts.height) end++;
      panels.push(panelSequence(sequence, extents, start, end));
      start = end + 1;
    }
  }
  if (panels.length > 1) ledger.push(ledgerSequencePaged({ panels: panels.length }));

  const paintedPages = panels.map((sub) => {
    const { rows, height } = layout(sub, air);
    // `cols.width` is the CONTENT width (the columns plus their own gutters);
    // `opts.width` is the requested grid. Passing the grid here made the pad
    // that centres the diagram compute to zero, which is why a narrow
    // sequence sat in the corner of a wide viewport.
    // Every panel centres on the WHOLE sequence's ink, so the lifelines stay
    // in the same columns from one panel to the next.
    return paintGlyphSequence(sequence.participants, cols.columns, rows, height, cols.width, { ...opts, inkRows: full.rows });
  });
  for (const page of paintedPages) ledger.push(...page.ledger);

  const first = paintedPages[0]!;
  return {
    text: paintedPages.map((p) => p.text).join("\n\n"),
    ...(first.html === undefined ? {} : { html: paintedPages.map((p) => p.html).join("\n\n") }),
    canvas: first.canvas,
    pages: paintedPages.map(({ text, html, canvas }) => ({ text, canvas, ...(html === undefined ? {} : { html }) })),
    meta: {
      participants: sequence.participants, messages: sequence.messages, frames: sequence.frames ?? [], notes: sequence.notes ?? [],
      description: `${opts.title ? `${opts.title}. ` : ""}${sequence.participants.length} participants, ${sequence.messages.length} messages; ${panels.length} panel${panels.length === 1 ? "" : "s"}.`,
    },
    report: { ledger: dedupeGlyphDiagramLedger(ledger), unsupportedGlyphs: paintedPages.flatMap((p) => p.unsupportedGlyphs) },
  };
}

export async function renderGlyphSequenceJson(json: string, options: GlyphSequenceRenderOptions = {}): Promise<string> {
  try {
    const result = await renderGlyphSequence(validateGlyphSequence(parseGlyphSequenceJson(json)), options);
    return JSON.stringify({ text: result.text, ...(result.html === undefined ? {} : { html: result.html }), meta: result.meta, report: result.report });
  } catch (e) {
    const error = e as Error & { code?: string };
    return JSON.stringify({ error: error.message, code: error.code ?? null, hint: error.code ? glyphSequenceRepairHint(error.code) : "Pass a JSON object with participants and messages arrays." });
  }
}
