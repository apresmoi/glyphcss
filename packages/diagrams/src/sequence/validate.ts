import type { GlyphSequence, GlyphSequenceParticipantShape, GlyphSequenceMessageStyle } from "./types";
import { glyphDiagramError } from "../validate";

export const GLYPH_SEQUENCE_VALIDATION_RULES = [
  "bad-sequence", "empty-participants", "bad-participant", "duplicate-participant-id",
  "bad-message", "duplicate-message-id", "unknown-participant", "bad-frame", "bad-frame-range",
  "bad-note", "bad-note-range", "bad-options", "bad-size", "bad-color", "GLYPH_SEQUENCE_MERMAID_SYNTAX", "GLYPH_SEQUENCE_BAD_JSON",
] as const;
export type GlyphSequenceValidationRuleId = typeof GLYPH_SEQUENCE_VALIDATION_RULES[number];

/** Tagged the same way `parseGlyphDiagramJson` tags the graph pipeline's JSON boundary, with its own code so a sequence parse failure is never mistaken for a graph one. */
export function parseGlyphSequenceJson(json: string): unknown {
  try { return JSON.parse(json); }
  catch (e) { return glyphDiagramError("GLYPH_SEQUENCE_BAD_JSON", `Invalid JSON: ${e instanceof Error ? e.message : String(e)}`); }
}

export const GLYPH_SEQUENCE_PARTICIPANT_SHAPES: readonly GlyphSequenceParticipantShape[] = ["lane", "actor"];
export const GLYPH_SEQUENCE_MESSAGE_STYLES: readonly GlyphSequenceMessageStyle[] = ["solid", "dashed"];
export const GLYPH_SEQUENCE_KEYS = ["participants", "messages", "frames", "notes"];
export const GLYPH_SEQUENCE_PARTICIPANT_KEYS = ["id", "label", "kind", "shape"];
export const GLYPH_SEQUENCE_MESSAGE_KEYS = ["id", "from", "to", "label", "style"];
export const GLYPH_SEQUENCE_FRAME_KEYS = ["kind", "label", "from", "to"];
export const GLYPH_SEQUENCE_NOTE_KEYS = ["text", "over", "at"];

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function identifier(value: unknown): value is string { return typeof value === "string" && /\S/u.test(value); }
function keys(value: Record<string, unknown>, allowed: readonly string[]): boolean { return Object.keys(value).every((key) => allowed.includes(key)); }
function optional(value: Record<string, unknown>, key: string, predicate: (value: unknown) => boolean): boolean { return value[key] === undefined || predicate(value[key]); }
function string(value: unknown): value is string { return typeof value === "string"; }
function member(value: unknown, allowed: readonly string[]): boolean { return string(value) && allowed.includes(value); }
function nonNegativeInt(value: unknown): value is number { return typeof value === "number" && Number.isInteger(value) && value >= 0; }

interface GlyphSequenceIntegrityFailure { readonly code: GlyphSequenceValidationRuleId; readonly message: string }

/** These relational constraints require the schema's registered Ajv keyword — mirrors `glyphGraphIntegrityFailure`. */
export function glyphSequenceIntegrityFailure(sequence: GlyphSequence): GlyphSequenceIntegrityFailure | null {
  const participantIds = new Set<string>();
  for (const participant of sequence.participants) {
    if (participantIds.has(participant.id)) return { code: "duplicate-participant-id", message: `Participant id "${participant.id}" occurs more than once.` };
    participantIds.add(participant.id);
  }
  const messageIds = new Set<string>();
  for (const message of sequence.messages) {
    if (message.id !== undefined) {
      if (messageIds.has(message.id)) return { code: "duplicate-message-id", message: `Message id "${message.id}" occurs more than once.` };
      messageIds.add(message.id);
    }
    if (!participantIds.has(message.from) || !participantIds.has(message.to)) return { code: "unknown-participant", message: `Message "${message.id ?? `${message.from} -> ${message.to}`}" references an unknown participant.` };
  }
  const lastIndex = sequence.messages.length - 1;
  for (const [index, frame] of (sequence.frames ?? []).entries()) {
    if (frame.from > frame.to || frame.from < 0 || frame.to > lastIndex) return { code: "bad-frame-range", message: `frame[${index}] "from"/"to" must be a valid inclusive message index range (0..${Math.max(0, lastIndex)}).` };
  }
  for (const [index, note] of (sequence.notes ?? []).entries()) {
    if (note.over.some((id) => !participantIds.has(id))) return { code: "unknown-participant", message: `note[${index}] references an unknown participant.` };
    if (note.at < 0 || note.at > sequence.messages.length) return { code: "bad-note-range", message: `note[${index}] "at" must be between 0 and ${sequence.messages.length} (the message count).` };
  }
  return null;
}

export function validateGlyphSequence(input: unknown): GlyphSequence {
  if (!object(input) || !keys(input, GLYPH_SEQUENCE_KEYS) || !Array.isArray(input.messages)) glyphDiagramError("bad-sequence", "A sequence requires participants and messages arrays, and only participants/messages/frames/notes fields.");
  if (!Array.isArray(input.participants) || input.participants.length === 0) glyphDiagramError("empty-participants", "A sequence requires at least one participant.");
  for (const [index, participant] of input.participants.entries()) {
    if (!object(participant) || !keys(participant, GLYPH_SEQUENCE_PARTICIPANT_KEYS) || !identifier(participant.id) || !string(participant.label)
      || !optional(participant, "kind", string) || !optional(participant, "shape", (value) => member(value, GLYPH_SEQUENCE_PARTICIPANT_SHAPES))) {
      glyphDiagramError("bad-participant", `participant[${index}] requires a non-empty id, a string label, and supported optional fields.`);
    }
  }
  for (const [index, message] of input.messages.entries()) {
    if (!object(message) || !keys(message, GLYPH_SEQUENCE_MESSAGE_KEYS) || !identifier(message.from) || !identifier(message.to)
      || !optional(message, "id", identifier) || !optional(message, "label", string) || !optional(message, "style", (value) => member(value, GLYPH_SEQUENCE_MESSAGE_STYLES))) {
      glyphDiagramError("bad-message", `message[${index}] requires from/to ids and supported optional fields.`);
    }
  }
  if (input.frames !== undefined) {
    if (!Array.isArray(input.frames)) glyphDiagramError("bad-frame", "frames must be an array.");
    for (const [index, frame] of input.frames.entries()) {
      if (!object(frame) || !keys(frame, GLYPH_SEQUENCE_FRAME_KEYS) || !identifier(frame.kind) || !optional(frame, "label", string)
        || !nonNegativeInt(frame.from) || !nonNegativeInt(frame.to)) glyphDiagramError("bad-frame", `frame[${index}] requires a kind, integer from/to message indices, and an optional label.`);
    }
  }
  if (input.notes !== undefined) {
    if (!Array.isArray(input.notes)) glyphDiagramError("bad-note", "notes must be an array.");
    for (const [index, note] of input.notes.entries()) {
      if (!object(note) || !keys(note, GLYPH_SEQUENCE_NOTE_KEYS) || !string(note.text) || !Array.isArray(note.over) || note.over.length === 0
        || !note.over.every(identifier) || !nonNegativeInt(note.at)) glyphDiagramError("bad-note", `note[${index}] requires text, a non-empty "over" array of participant ids, and an integer "at".`);
    }
  }
  const sequence = input as unknown as GlyphSequence;
  const failure = glyphSequenceIntegrityFailure(sequence);
  if (failure) glyphDiagramError(failure.code, failure.message);
  return {
    participants: sequence.participants.map((p) => ({ ...p })),
    messages: sequence.messages.map((m) => ({ ...m })),
    ...(sequence.frames === undefined ? {} : { frames: sequence.frames.map((f) => ({ ...f })) }),
    ...(sequence.notes === undefined ? {} : { notes: sequence.notes.map((n) => ({ ...n, over: [...n.over] })) }),
  };
}

const REPAIR_HINTS: Readonly<Record<GlyphSequenceValidationRuleId, string>> = {
  "bad-sequence": "Pass { participants, messages, frames?, notes? }; remove unsupported top-level fields.",
  "empty-participants": "Add at least one participant with an id and label.",
  "bad-participant": `Use a non-empty id, a string label; kind is an optional informational string, shape is optional ${GLYPH_SEQUENCE_PARTICIPANT_SHAPES.join(" / ")}.`,
  "duplicate-participant-id": "Give every participant a unique id.",
  "bad-message": `Use from/to participant ids, an optional label/id, and style ${GLYPH_SEQUENCE_MESSAGE_STYLES.join(" / ")}.`,
  "duplicate-message-id": "Give explicit message ids unique values, or omit them.",
  "unknown-participant": "Reference only ids present in participants.",
  "bad-frame": "Use frames: [{ kind, label?, from, to }], with from/to as message indices.",
  "bad-frame-range": "Use an inclusive from <= to within the message array's index range.",
  "bad-note": "Use notes: [{ text, over: [participantId, ...], at }].",
  "bad-note-range": "Use an \"at\" between 0 and the message count, inclusive.",
  "bad-options": "Use the documented target, charset, color, and title options.",
  "bad-size": "Pass positive integer width and height, or omit them.",
  "bad-color": "participantColor must be a canonical lowercase #rrggbb string, or a function returning one.",
  "GLYPH_SEQUENCE_MERMAID_SYNTAX": "Use sequenceDiagram with participant/actor declarations and supported message/frame/note syntax.",
  "GLYPH_SEQUENCE_BAD_JSON": "Pass a syntactically valid JSON document encoding a sequence object.",
};

export function glyphSequenceRepairHint(id: string): string {
  return REPAIR_HINTS[id as GlyphSequenceValidationRuleId] ?? "Check the sequence and render options against the sequence diagram schema.";
}
