import { stripGlyphMermaidPreamble, skipGlyphMermaidComment } from "@glyphcss/core/mermaid";
import { ledgerMermaidDegraded, type GlyphDiagramLedgerEntry } from "../ledger";
import { orderGlyphSequenceItem } from "./authoredOrder";
import type { GlyphSequence, GlyphSequenceFrame, GlyphSequenceFrameBranch, GlyphSequenceMessage, GlyphSequenceNote, GlyphSequenceParticipant } from "./types";
import { glyphDiagramError } from "../validate";
import { validateGlyphSequence } from "./validate";

function syntax(message: string): never { return glyphDiagramError("GLYPH_SEQUENCE_MERMAID_SYNTAX", message); }

// Hyphens inside ids are allowed; a trailing hyphen belongs to the arrow.
const ID_RE = "[A-Za-z0-9_.]+(?:-[A-Za-z0-9_.]+)*";
const DECLARE_RE = new RegExp(String.raw`^(create\s+)?(participant|actor)\s+(${ID_RE})(?:\s*@\{([\s\S]*?)\})?(?:\s+as\s+(.+))?$`);
const HALF_ARROWS = ["-|\\", "--|\\", "-|/", "--|/", "/|-", "/|--", "\\\\-", "\\\\--", "-\\\\", "--\\\\", "-//", "--//", "//-", "//--"];
const OPERATORS = [...HALF_ARROWS, "-->>", "->>", "-->", "->", "--x", "-x", "--)", "-)"].sort((a, b) => b.length - a.length);
const ARROW_RE = new RegExp(String.raw`^(${ID_RE})\s*(\(\))?\s*(${OPERATORS.map(op => op.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})([+-]?)\s*(\(\))?\s*(${ID_RE})\s*:\s*(.*)$`);
const BLOCK_START_RE = /^(alt|opt|loop|par|critical|break|rect|box)(?:\s+(.*))?$/;
const BRANCH_RE = /^(else|and|option)\b\s*(.*)$/;
const NOTE_RE = new RegExp(`^note\\s+over\\s+(${ID_RE}(?:\\s*,\\s*${ID_RE})*)\\s*:\\s*(.*)$`, "i");
const SIDE_NOTE_RE = new RegExp(`^note\\s+(left|right)\\s+of\\s+(${ID_RE})\\s*:\\s*(.*)$`, "i");
const ACTIVATION_RE = new RegExp(`^(activate|deactivate)\\s+(${ID_RE})$`);

interface OpenBlock { readonly kind: string; readonly label: string; readonly startIndex: number; readonly order: number; readonly branches: GlyphSequenceFrameBranch[] }

/** Mermaid comments occupy their own line; message text remains literal. */
function statementLines(source: string): string[] {
  const lines: string[] = [];
  let current = "", metadata = false, quote = "";
  for (let index = 0; index < source.length; index++) {
    const char = source[index]!;
    if (!current.trim() && source.startsWith("%%", index)) {
      index = skipGlyphMermaidComment(source, index, syntax);
      continue;
    }
    if (metadata) {
      current += char;
      if (quote) {
        if (char === "\\" && quote === '"') current += source[++index] ?? "";
        else if (char === quote) quote = "";
      } else if (char === '"' || char === "'") quote = char;
      else if (char === "}") metadata = false;
      continue;
    }
    if (char === "{" && current.endsWith("@") && /^(?:create\s+)?(?:participant|actor)\s/.test(current.trim())) metadata = true;
    if (char === "\n") {
      if (current.trim()) lines.push(current.trim());
      current = "";
    } else current += char;
  }
  if (metadata) syntax("Unclosed participant metadata.");
  if (current.trim()) lines.push(current.trim());
  return lines;
}

/** Only scalar type/alias fields affect the IR; arbitrary YAML config stays inert. */
function participantMetadata(source: string): Record<string, string> {
  const fields: Record<string, string> = Object.create(null);
  const field = /(?:^|[,\n])\s*(?:"(type|alias)"|'(type|alias)'|(type|alias))\s*:\s*("(?:\\.|[^"\\])*"|'(?:''|[^'])*'|[^,\n]*)/g;
  for (const match of source.matchAll(field)) {
    const raw = match[4]!.trim();
    let value = raw;
    if (raw.startsWith('"')) {
      try { value = JSON.parse(raw) as string; }
      catch { value = raw.slice(1, -1); }
    } else if (raw.startsWith("'")) value = raw.slice(1, -1).replace(/''/g, "'");
    fields[match[1] ?? match[2] ?? match[3]!] = value;
  }
  return fields;
}

// Adapter notes stay outside the JSON IR, like authored statement order.
const sourceNotes = new WeakMap<GlyphSequence, readonly GlyphDiagramLedgerEntry[]>();
export function glyphSequenceMermaidNotes(sequence: GlyphSequence): readonly GlyphDiagramLedgerEntry[] { return sourceNotes.get(sequence) ?? []; }

export function glyphSequenceFromMermaid(source: string): GlyphSequence {
  if (typeof source !== "string") syntax("Mermaid source must be a string.");
  const preamble = stripGlyphMermaidPreamble(source);
  const notesLedger: GlyphDiagramLedgerEntry[] = [];
  const noteDegraded = (kind: string, message: string) => {
    if (!notesLedger.some(entry => entry.detail?.kind === kind)) notesLedger.push(ledgerMermaidDegraded({ kind, message }));
  };
  if (preamble.frontmatter !== undefined) noteDegraded("frontmatter", "Mermaid frontmatter is inert; render options control the sequence.");
  if (/%%\{/.test(preamble.body)) noteDegraded("configuration", "Mermaid configuration is inert; render options control the sequence.");
  const lines = statementLines(preamble.body);
  const header = lines.shift();
  if (header !== "sequenceDiagram") syntax("Expected a sequenceDiagram declaration.");

  const participants = new Map<string, GlyphSequenceParticipant>();
  const messages: GlyphSequenceMessage[] = [];
  const frames: GlyphSequenceFrame[] = [];
  const notes: GlyphSequenceNote[] = [];
  const stack: OpenBlock[] = [];
  let autonumber: { start: number; step: number } | undefined;
  let title: string | undefined;

  const ensureParticipant = (id: string): void => {
    if (!participants.has(id)) participants.set(id, { id, label: id });
  };
  // An `else` is a divider inside its `alt`, not a frame of its own — the
  // whole block closes as ONE frame at `end`. A block with no messages draws
  // nothing.
  const close = (block: OpenBlock): void => {
    if (block.kind === "rect" || block.kind === "box") return;
    if (block.startIndex <= messages.length - 1) frames.push(orderGlyphSequenceItem({
      kind: block.kind, ...(block.label ? { label: block.label } : {}), from: block.startIndex, to: messages.length - 1,
      ...(block.branches.length ? { branches: block.branches } : {}),
    }, block.order));
  };

  for (const [order, line] of lines.entries()) {
    const declare = DECLARE_RE.exec(line);
    if (declare) {
      const [, create, kindWord, id, metadata, label] = declare;
      let config: Record<string, string> = {};
      if (metadata !== undefined) {
        config = participantMetadata(metadata);
        noteDegraded("participant-type", "Participant types use existing lane headers; type and alias metadata are retained without new symbols.");
      }
      const type = typeof config.type === "string" ? config.type : undefined;
      const alias = typeof config.alias === "string" ? config.alias : undefined;
      participants.set(id!, { id: id!, label: label?.trim() || alias || id!, ...(type ? { kind: type } : {}), ...(!type && kindWord === "actor" ? { shape: "actor" } : {}) });
      if (create) noteDegraded("participant-lifetime", "Creation and destruction keep full lifelines instead of changing their start or end.");
      continue;
    }
    if (line === "end") {
      const top = stack.pop();
      if (!top) syntax('"end" has no matching sequence block.');
      close(top);
      continue;
    }
    if (stack.at(-1)?.kind === "box") syntax(`"box" supports participant/actor declarations only; found "${line}".`);
    const blockStart = BLOCK_START_RE.exec(line);
    if (blockStart) { stack.push({ kind: blockStart[1]!, label: blockStart[2]?.trim() ?? "", startIndex: messages.length, order, branches: [] }); continue; }
    const branch = BRANCH_RE.exec(line);
    if (branch) {
      const top = stack[stack.length - 1];
      const kind = branch[1]!;
      const owner = kind === "else" ? "alt" : kind === "and" ? "par" : "critical";
      if (top?.kind !== owner) syntax(`"${kind}" has no matching "${owner}".`);
      const label = branch[2]!.trim();
      top.branches.push(orderGlyphSequenceItem({ kind, ...(label ? { label } : {}), at: messages.length }, order));
      continue;
    }
    const numbering = /^autonumber(?:\s+(\d+)(?:\s+(\d+))?)?$/.exec(line);
    if (numbering) { autonumber = { start: Number(numbering[1] ?? 1), step: Number(numbering[2] ?? 1) }; continue; }
    const destroy = new RegExp(`^destroy\\s+(${ID_RE})$`).exec(line);
    if (destroy) {
      ensureParticipant(destroy[1]!);
      noteDegraded("participant-lifetime", "Creation and destruction keep full lifelines instead of changing their start or end.");
      continue;
    }
    if (/^links?\s+[^:]+:/.test(line)) {
      noteDegraded("actor-menus", "Actor menus and URLs are inert; no links are opened or fetched.");
      continue;
    }
    const titleMatch = /^title(?:\s+|:\s*)(.+)$/.exec(line);
    if (titleMatch) {
      if (title !== undefined) syntax('Duplicate "title" statement.');
      title = titleMatch[1]!.trim();
      continue;
    }
    const activation = ACTIVATION_RE.exec(line);
    if (activation) { ensureParticipant(activation[2]!); continue; }
    const sideNote = SIDE_NOTE_RE.exec(line);
    if (sideNote) {
      ensureParticipant(sideNote[2]!);
      notes.push(orderGlyphSequenceItem({ text: sideNote[3]!.trim(), over: [sideNote[2]!], at: messages.length, placement: sideNote[1]!.toLowerCase() as "left" | "right" }, order));
      continue;
    }
    const note = NOTE_RE.exec(line);
    if (note) {
      const over = note[1]!.split(",").map((id) => id.trim());
      over.forEach(ensureParticipant);
      notes.push(orderGlyphSequenceItem({ text: note[2]!.trim(), over, at: messages.length }, order));
      continue;
    }
    const arrow = ARROW_RE.exec(line);
    if (arrow) {
      const [, left, centralFrom, op, , centralTo, right, label] = arrow;
      const reverse = /^(?:\/\|?|\\)/.test(op!);
      const from = reverse ? right : left, to = reverse ? left : right;
      if (HALF_ARROWS.includes(op!)) noteDegraded("half-arrows", "Half arrowheads use existing directed solid or dashed arrows, preserving their direction.");
      if (centralFrom || centralTo) noteDegraded("central-connections", "Central connections attach to the existing lifelines.");
      ensureParticipant(left!); ensureParticipant(right!);
      messages.push({ from: from!, to: to!, ...(label ? { label: label.trim() } : {}), style: op!.includes("--") ? "dashed" : "solid" });
      continue;
    }
    syntax(`Unrecognized sequence diagram statement: "${line}".`);
  }
  if (stack.length) syntax(`Unclosed "${stack[stack.length - 1]!.kind}" block.`);

  const sequence = validateGlyphSequence({
    participants: [...participants.values()],
    messages: autonumber ? messages.map((message, index) => ({ ...message, label: `${autonumber!.start + index * autonumber!.step}. ${message.label ?? ""}`.trimEnd() })) : messages,
    ...(title === undefined ? {} : { title }),
    ...(frames.length ? { frames } : {}), ...(notes.length ? { notes } : {}),
  });
  sourceNotes.set(sequence, notesLedger);
  return sequence;
}
