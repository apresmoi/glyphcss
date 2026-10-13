import { orderGlyphSequenceItem } from "./authoredOrder";
import type { GlyphSequence, GlyphSequenceFrame, GlyphSequenceFrameBranch, GlyphSequenceMessage, GlyphSequenceNote, GlyphSequenceParticipant } from "./types";
import { glyphDiagramError } from "../validate";
import { validateGlyphSequence } from "./validate";

function syntax(message: string): never { return glyphDiagramError("GLYPH_SEQUENCE_MERMAID_SYNTAX", message); }

// No "-" in an id: "A-->>B" must tokenize as id "A", operator "-->>", id "B" —
// an id charclass that allowed a trailing hyphen greedily ate the arrow's own
// leading "-" (`S-->>U` read as id "S-" + operator "->>"), corrupting both
// the participant set and the message endpoint. Mermaid ids in practice are
// alphanumeric/underscore/dot; this is the tradeoff for an unambiguous grammar.
const ID_RE = "[A-Za-z0-9_.]+";
const DECLARE_RE = new RegExp(`^(participant|actor)\\s+(${ID_RE})(?:\\s+as\\s+(.+))?$`);
const ARROW_RE = new RegExp(`^(${ID_RE})\\s*(-->>|->>|-->|->|--x|-x|--\\)|-\\))([+-]?)\\s*(${ID_RE})\\s*:\\s*(.*)$`);
const BLOCK_START_RE = /^(alt|opt|loop|par|critical|break|rect|box)(?:\s+(.*))?$/;
const BRANCH_RE = /^(else|and|option)\b\s*(.*)$/;
const NOTE_RE = new RegExp(`^note\\s+over\\s+(${ID_RE}(?:\\s*,\\s*${ID_RE})*)\\s*:\\s*(.*)$`, "i");
const SIDE_NOTE_RE = new RegExp(`^note\\s+(left|right)\\s+of\\s+(${ID_RE})\\s*:\\s*(.*)$`, "i");
const ACTIVATION_RE = new RegExp(`^(activate|deactivate)\\s+(${ID_RE})$`);

interface OpenBlock { readonly kind: string; readonly label: string; readonly startIndex: number; readonly order: number; readonly branches: GlyphSequenceFrameBranch[] }

/** Mermaid comments occupy their own line; message text remains literal. */
function statementLines(source: string): string[] {
  return source.replace(/^﻿/, "").split(/\r\n|\r|\n/)
    .map((line) => (/^\s*%%/.test(line) ? "" : line.trim()))
    .filter((line) => line.length > 0);
}

export function glyphSequenceFromMermaid(source: string): GlyphSequence {
  if (typeof source !== "string") syntax("Mermaid source must be a string.");
  const lines = statementLines(source);
  const header = lines.shift();
  if (header !== "sequenceDiagram") syntax("Expected a sequenceDiagram declaration.");

  const participants = new Map<string, GlyphSequenceParticipant>();
  const messages: GlyphSequenceMessage[] = [];
  const frames: GlyphSequenceFrame[] = [];
  const notes: GlyphSequenceNote[] = [];
  const stack: OpenBlock[] = [];
  let autonumber = false;
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
      const [, kindWord, id, label] = declare;
      participants.set(id!, { id: id!, label: label?.trim() || id!, ...(kindWord === "actor" ? { shape: "actor" } : {}) });
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
    if (line === "autonumber") { autonumber = true; continue; }
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
      const [, from, op, , to, label] = arrow;
      ensureParticipant(from!); ensureParticipant(to!);
      messages.push({ from: from!, to: to!, ...(label ? { label: label.trim() } : {}), style: op!.startsWith("--") ? "dashed" : "solid" });
      continue;
    }
    syntax(`Unrecognized sequence diagram statement: "${line}".`);
  }
  if (stack.length) syntax(`Unclosed "${stack[stack.length - 1]!.kind}" block.`);

  return validateGlyphSequence({
    participants: [...participants.values()],
    messages: autonumber ? messages.map((message, index) => ({ ...message, label: `${index + 1}. ${message.label ?? ""}`.trimEnd() })) : messages,
    ...(title === undefined ? {} : { title }),
    ...(frames.length ? { frames } : {}), ...(notes.length ? { notes } : {}),
  });
}
