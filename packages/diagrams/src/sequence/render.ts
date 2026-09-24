import type { GlyphCanvas, GlyphCanvasTierName } from "glyphcss";
import { glyphSequenceFromMermaid } from "./mermaid";
import { glyphDiagramError } from "../validate";
import { parseGlyphSequenceJson, glyphSequenceRepairHint, validateGlyphSequence } from "./validate";
import { layoutGlyphSequenceColumns, layoutGlyphSequenceRows, type GlyphSequenceRow } from "./layout";
import { paintGlyphSequence } from "./paint";
import { dedupeGlyphDiagramLedger, type GlyphDiagramLedgerEntry } from "../ledger";
import { ledgerSequenceLayoutOverflow, ledgerSequencePaged } from "./ledger";
import type { GlyphSequence, GlyphSequenceFrame, GlyphSequenceMessage, GlyphSequenceNote, GlyphSequenceParticipant } from "./types";

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
    || (options.title !== undefined && typeof options.title !== "string")) glyphDiagramError("bad-options", "Use supported target, charset, color, and title options.");
  return result;
}

interface GlyphSequenceUnit {
  readonly messageIndex: number | null;
  readonly height: number;
  readonly message?: GlyphSequenceMessage;
  readonly frames: readonly GlyphSequenceFrame[];
  readonly notes: readonly GlyphSequenceNote[];
}

/** One unit per message (its own anchored frames/notes plus its own row height) plus, when present, a trailing unit for notes anchored after the last message. A page break never lands INSIDE a unit. */
function buildUnits(sequence: GlyphSequence): GlyphSequenceUnit[] {
  const units: GlyphSequenceUnit[] = [];
  for (let i = 0; i < sequence.messages.length; i++) {
    const message = sequence.messages[i]!;
    const frames = (sequence.frames ?? []).filter((f) => f.from === i);
    const notes = (sequence.notes ?? []).filter((n) => n.at === i);
    const height = frames.length * 3 + notes.length * 3 + (message.from === message.to ? 3 : 2);
    units.push({ messageIndex: i, height, message, frames, notes });
  }
  const trailingNotes = (sequence.notes ?? []).filter((n) => n.at === sequence.messages.length);
  if (trailingNotes.length) units.push({ messageIndex: null, height: trailingNotes.length * 3, frames: [], notes: trailingNotes });
  return units;
}

/** Greedy pack: never splits a unit across panels, and a single unit wider than the budget still gets its own panel rather than being dropped. */
function packPanels(units: readonly GlyphSequenceUnit[], budget: number): GlyphSequenceUnit[][] {
  if (!units.length) return [[]];
  const panels: GlyphSequenceUnit[][] = [];
  let current: GlyphSequenceUnit[] = [], currentHeight = 0;
  for (const unit of units) {
    if (current.length && currentHeight + unit.height > budget) { panels.push(current); current = []; currentHeight = 0; }
    current.push(unit); currentHeight += unit.height;
  }
  if (current.length) panels.push(current);
  return panels;
}

function panelSequence(sequence: GlyphSequence, panel: readonly GlyphSequenceUnit[]): GlyphSequence {
  const realUnits = panel.filter((u) => u.messageIndex !== null);
  const offset = realUnits[0]?.messageIndex ?? sequence.messages.length;
  const lastMessageIndex = realUnits.length ? realUnits[realUnits.length - 1]!.messageIndex! : offset - 1;
  const messages = realUnits.map((u) => u.message!);
  const frames: GlyphSequenceFrame[] = [];
  const notes: GlyphSequenceNote[] = [];
  for (const unit of panel) {
    for (const frame of unit.frames) frames.push({ ...frame, from: frame.from - offset, to: Math.min(frame.to, lastMessageIndex) - offset });
    const at = unit.messageIndex === null ? realUnits.length : unit.messageIndex - offset;
    for (const note of unit.notes) notes.push({ ...note, at });
  }
  return { participants: sequence.participants, messages, ...(frames.length ? { frames } : {}), ...(notes.length ? { notes } : {}) };
}

/** Rows the painter reserves above the body: the participant header, an actor glyph row when any participant is one, and the gap row. */
function reservedHeaderRows(sequence: GlyphSequence): number {
  return (sequence.participants.some((p) => p.shape === "actor") ? 2 : 1) + 1;
}

export async function renderGlyphSequence(input: GlyphSequence | string, options: GlyphSequenceRenderOptions = {}): Promise<GlyphSequenceResult> {
  const opts = resolvedOptions(options);
  const sequence = validateGlyphSequence(typeof input === "string" ? glyphSequenceFromMermaid(input) : input);
  const ledger: GlyphDiagramLedgerEntry[] = [];

  const cols = layoutGlyphSequenceColumns(sequence, { charset: opts.charset, maxWidth: opts.width });
  ledger.push(...cols.ledger);

  const hasActor = cols.columns.some((c) => c.shape === "actor");
  const headerRows = hasActor ? 2 : 1;
  const natural = layoutGlyphSequenceRows(sequence, cols.columns, 0, { charset: opts.charset });
  // Spend leftover HEIGHT the same way the columns spend leftover width: one
  // blank row between messages, only when the whole sequence still fits. A
  // paged sequence takes none — the panels are already at the height limit.
  const airGaps = Math.max(0, sequence.messages.length - 1);
  const air = airGaps > 0 && natural.height + reservedHeaderRows(sequence) + airGaps <= opts.height ? 1 : 0;
  const fullRows = air === 0 ? natural : layoutGlyphSequenceRows(sequence, cols.columns, 0, { charset: opts.charset, air });
  const naturalHeight = headerRows + 1 + fullRows.height + 1;
  if (cols.width > opts.width) ledger.push(ledgerSequenceLayoutOverflow({ naturalWidth: cols.width, naturalHeight, requestedWidth: opts.width, requestedHeight: opts.height }));

  const units = buildUnits(sequence);
  const budget = Math.max(1, opts.height - headerRows - 2);
  const panels = naturalHeight <= opts.height ? [units] : packPanels(units, budget);
  if (panels.length > 1) ledger.push(ledgerSequencePaged({ panels: panels.length }));

  const paintedPages = panels.map((panel) => {
    const sub = panelSequence(sequence, panel);
    const rows: readonly GlyphSequenceRow[] = layoutGlyphSequenceRows(sub, cols.columns, 0, { charset: opts.charset, width: opts.width, air }).rows;
    // Unit heights are the MESSAGE rows only; the air rows the layout
    // inserted between them count too, or the lifelines stop short and the
    // last messages fall outside the painted body.
    const airRows = air * Math.max(0, panel.filter((u) => u.messageIndex !== null).length - 1);
    const bodyHeight = panel.reduce((acc, u) => acc + u.height, 0) + airRows;
    //  is the CONTENT width (the columns plus their own gutters);
    // `opts.width` is the requested grid. Passing the grid here made the pad
    // that centres the diagram compute to zero, which is why a narrow
    // sequence sat in the corner of a wide viewport.
    return paintGlyphSequence(sequence.participants, cols.columns, rows, bodyHeight, cols.width, opts);
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
      description: `${options.title ? `${options.title}. ` : ""}${sequence.participants.length} participants, ${sequence.messages.length} messages; ${panels.length} panel${panels.length === 1 ? "" : "s"}.`,
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
