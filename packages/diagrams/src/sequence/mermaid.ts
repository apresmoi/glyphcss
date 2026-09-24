import type { GlyphSequence, GlyphSequenceFrame, GlyphSequenceMessage, GlyphSequenceNote, GlyphSequenceParticipant } from "./types";
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
const ARROW_RE = new RegExp(`^(${ID_RE})\\s*(-->>|->>|-->|->)\\s*(${ID_RE})\\s*:\\s*(.*)$`);
const BLOCK_START_RE = /^(alt|opt|loop)\s+(.*)$/;
const ELSE_RE = /^else\b\s*(.*)$/;
const NOTE_RE = new RegExp(`^note\\s+over\\s+(${ID_RE}(?:\\s*,\\s*${ID_RE})*)\\s*:\\s*(.*)$`, "i");

interface OpenBlock { kind: string; label: string; startIndex: number }

/** Strip a trailing `%%` comment (never inside the message text — Mermaid comments are their own line) and surrounding whitespace. */
function statementLines(source: string): string[] {
  return source.replace(/^﻿/, "").split(/\r\n|\r|\n/)
    .map((line) => (/^\s*%%/.test(line) ? "" : line.trim()))
    .filter((line) => line.length > 0);
}

export function glyphSequenceFromMermaid(source: string): GlyphSequence {
  if (typeof source !== "string") syntax("Mermaid source must be a string.");
  const lines = statementLines(source);
  const header = lines.shift();
  if (!header || !/^sequenceDiagram\b/.test(header)) syntax("Expected a sequenceDiagram declaration.");

  const participants = new Map<string, GlyphSequenceParticipant>();
  const messages: GlyphSequenceMessage[] = [];
  const frames: GlyphSequenceFrame[] = [];
  const notes: GlyphSequenceNote[] = [];
  const stack: OpenBlock[] = [];

  const ensureParticipant = (id: string): void => {
    if (!participants.has(id)) participants.set(id, { id, label: id });
  };
  const closeSegment = (block: OpenBlock): void => {
    if (block.startIndex <= messages.length - 1) frames.push({ kind: block.kind, ...(block.label ? { label: block.label } : {}), from: block.startIndex, to: messages.length - 1 });
  };

  for (const line of lines) {
    const declare = DECLARE_RE.exec(line);
    if (declare) {
      const [, kindWord, id, label] = declare;
      participants.set(id!, { id: id!, label: label?.trim() || id!, ...(kindWord === "actor" ? { shape: "actor" } : {}) });
      continue;
    }
    const blockStart = BLOCK_START_RE.exec(line);
    if (blockStart) { stack.push({ kind: blockStart[1]!, label: blockStart[2]!.trim(), startIndex: messages.length }); continue; }
    const elseMatch = ELSE_RE.exec(line);
    if (elseMatch) {
      const top = stack[stack.length - 1];
      if (!top) syntax(`"else" has no matching "alt".`);
      closeSegment(top);
      top.kind = "else"; top.label = elseMatch[1]!.trim(); top.startIndex = messages.length;
      continue;
    }
    if (line === "end") {
      const top = stack.pop();
      if (!top) syntax(`"end" has no matching "alt"/"loop"/"opt".`);
      closeSegment(top);
      continue;
    }
    const note = NOTE_RE.exec(line);
    if (note) {
      const over = note[1]!.split(",").map((id) => id.trim());
      over.forEach(ensureParticipant);
      notes.push({ text: note[2]!.trim(), over, at: messages.length });
      continue;
    }
    const arrow = ARROW_RE.exec(line);
    if (arrow) {
      const [, from, op, to, label] = arrow;
      ensureParticipant(from!); ensureParticipant(to!);
      messages.push({ from: from!, to: to!, ...(label ? { label: label.trim() } : {}), style: op === "-->>" || op === "-->" ? "dashed" : "solid" });
      continue;
    }
    syntax(`Unrecognized sequence diagram statement: "${line}".`);
  }
  if (stack.length) syntax(`Unclosed "${stack[stack.length - 1]!.kind}" block.`);

  return validateGlyphSequence({
    participants: [...participants.values()], messages,
    ...(frames.length ? { frames } : {}), ...(notes.length ? { notes } : {}),
  });
}
