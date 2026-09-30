/**
 * The slot model behind `DiagramsSourceEditor`'s GUIDED mode (the user's
 * own ask: "I would prefer the editors to be masked and allow you to add in
 * some places and some other dont"). A slot is a span of the raw text that
 * MEANS something on its own — a node id, a label, an edge endpoint, a
 * git-log subject, a JSON value — and is therefore editable; everything
 * between slots (arrows, brackets, keywords, JSON keys and punctuation, the
 * `|` field separators) is structure the editor protects.
 *
 * Two slot flavours: TEXT slots take typed characters, filtered per kind
 * (`diagramsSourceSlotSanitize` — an id never takes a space, a JSON string
 * never takes a raw `"`, a git-log field never takes a `|`), and CYCLE slots
 * (`options` set) hold one of a fixed vocabulary — an arrow kind, a node
 * shape, a flowchart direction, a frame kind, a JSON enum value — and
 * change by cycling, never by typing (`diagramsSourceSlotCycle`).
 *
 * Purely textual, built on the same line tokenizer the highlighter uses
 * (`diagramsSourceTokens.ts`), so a draft mid-edit always has a slot map;
 * whether the whole source PARSES is the editor's own gate for entering
 * guided mode, not this module's concern.
 */
import { DIAGRAMS_SHAPE_CATALOGUE } from "./diagramsSourceAid";
import {
  tokenizeDiagramsSourceLine,
  type DiagramsSourceDialect,
  type DiagramsSourceToken,
} from "./diagramsSourceTokens";
import type { GlyphDiagramsFormId } from "./diagramsWorkbenchState";

export type DiagramsSourceSlotKind = "id" | "label" | "text" | "number" | "list" | "cycle";
export interface DiagramsSourceSlot {
  readonly start: number;
  readonly end: number;
  readonly kind: DiagramsSourceSlotKind;
  /** What the reader is editing, for the status line — "node id", "edge label", "subject", `"from"` … */
  readonly role: string;
  /** Cycle slots only: the vocabulary, in cycling order. */
  readonly options?: readonly string[];
  /** A shape slot rewrites its closing bracket too — its span, cycled together with `[start, end)`. */
  readonly pair?: { readonly start: number; readonly end: number };
}

const MERMAID_DIRECTIONS = ["TB", "LR", "BT", "RL"];
const FLOW_ARROWS = ["-->", "-.->", "==>", "---"];
const SEQ_ARROWS = ["->>", "-->>", "->", "-->"];
const FRAME_KINDS = ["alt", "opt", "loop", "par"];
const PARTICIPANT_KINDS = ["participant", "actor"];
const MERMAID_SHAPES = DIAGRAMS_SHAPE_CATALOGUE.filter((s) => s.mermaid);
const JSON_ID_KEYS = new Set(["id", "from", "to", "parents", "members", "group", "over"]);
const JSON_ENUMS: Readonly<Record<GlyphDiagramsFormId, Readonly<Record<string, readonly string[]>>>> = {
  graph: {
    shape: DIAGRAMS_SHAPE_CATALOGUE.map((s) => s.shape),
    style: ["solid", "dotted", "thick", "undirected"],
    direction: MERMAID_DIRECTIONS,
  },
  sequence: { shape: ["lane", "actor"], style: ["solid", "dashed"], kind: FRAME_KINDS },
  lanes: {},
};

interface Positioned extends DiagramsSourceToken {
  readonly start: number;
  readonly end: number;
}
function positioned(dialect: DiagramsSourceDialect, line: string, lineStart: number): Positioned[] {
  let offset = lineStart;
  return tokenizeDiagramsSourceLine(dialect, line).map((token) => {
    const start = offset;
    offset += token.text.length;
    return { ...token, start, end: offset };
  });
}
/** A label token minus its surrounding whitespace — an all-blank token yields a zero-width slot at its end. */
function trimmed(token: Positioned): { start: number; end: number } {
  const lead = token.text.length - token.text.trimStart().length;
  const trail = token.text.length - token.text.trimEnd().length;
  return token.text.trim().length === 0
    ? { start: token.end, end: token.end }
    : { start: token.start + lead, end: token.end - trail };
}
const isSpace = (token: Positioned | undefined): boolean =>
  token !== undefined && token.kind === "text" && token.text.trim().length === 0;

function mermaidSlots(line: string, lineStart: number, form: GlyphDiagramsFormId): DiagramsSourceSlot[] {
  const tokens = positioned("mermaid", line, lineStart);
  const words = tokens.filter((t) => !isSpace(t));
  const slots: DiagramsSourceSlot[] = [];
  const sequence = form === "sequence";
  for (let i = 0; i < words.length; i++) {
    const token = words[i]!;
    const prev = words[i - 1];
    const next = words[i + 1];
    if (token.kind === "comment") {
      slots.push({ start: token.start + 2, end: token.end, kind: "text", role: "comment" });
      continue;
    }
    if (token.kind === "keyword") {
      if (MERMAID_DIRECTIONS.includes(token.text) || token.text === "TD")
        slots.push({
          start: token.start,
          end: token.end,
          kind: "cycle",
          role: "direction",
          options: MERMAID_DIRECTIONS,
        });
      else if (PARTICIPANT_KINDS.includes(token.text) && i === 0)
        slots.push({
          start: token.start,
          end: token.end,
          kind: "cycle",
          role: "participant kind",
          options: PARTICIPANT_KINDS,
        });
      else if (FRAME_KINDS.includes(token.text) && i === 0)
        slots.push({ start: token.start, end: token.end, kind: "cycle", role: "frame kind", options: FRAME_KINDS });
      continue;
    }
    if (token.kind === "arrow") {
      const options = sequence ? SEQ_ARROWS : FLOW_ARROWS;
      if (options.includes(token.text))
        slots.push({ start: token.start, end: token.end, kind: "cycle", role: "arrow", options });
      continue;
    }
    if (token.kind === "id") {
      // A declaration (`b{Beta?}`) reads as the node's id even when it also
      // sits at an edge's end — the shape beside it is what the reader sees.
      const role =
        prev?.kind === "keyword" && prev.text === "subgraph"
          ? "subgraph id"
          : prev?.kind === "keyword" && PARTICIPANT_KINDS.includes(prev.text)
            ? "participant id"
            : prev?.kind === "keyword" && prev.text === "over"
              ? "note participant"
              : !sequence && next?.kind === "punct" && "[({>".includes(next.text) && next.start === token.end
                ? "node id"
                : prev?.kind === "arrow" || next?.kind === "arrow"
                  ? sequence
                    ? "message participant"
                    : "edge endpoint"
                  : sequence
                    ? "participant"
                    : "node id";
      slots.push({ start: token.start, end: token.end, kind: "id", role });
      continue;
    }
    if (token.kind === "string") {
      const closed = token.text.length >= 2 && token.text.endsWith('"');
      slots.push({ start: token.start + 1, end: closed ? token.end - 1 : token.end, kind: "label", role: "label" });
      continue;
    }
    if (token.kind === "label") {
      const role =
        prev?.kind === "punct" && prev.text === "|"
          ? "edge label"
          : prev?.kind === "punct" && prev.text === ":"
            ? sequence
              ? "message text"
              : "text"
            : prev?.kind === "keyword" && prev.text === "as"
              ? "participant label"
              : prev?.kind === "keyword" && (FRAME_KINDS.includes(prev.text) || prev.text === "else")
                ? "frame label"
                : "label";
      slots.push({ ...trimmed(token), kind: "label", role });
      continue;
    }
    // A node shape: the opener bracket run right after an id, cycled together with its closer.
    if (token.kind === "punct" && prev?.kind === "id" && "[({>".includes(token.text) && !sequence) {
      let openEnd = i;
      while (words[openEnd + 1]?.kind === "punct" && "[({".includes(words[openEnd + 1]!.text)) openEnd++;
      const opener = words
        .slice(i, openEnd + 1)
        .map((t) => t.text)
        .join("");
      const shape = MERMAID_SHAPES.find((s) => s.open === opener);
      let closeStart = openEnd + 1;
      while (
        closeStart < words.length &&
        !(words[closeStart]!.kind === "punct" && "])}".includes(words[closeStart]!.text))
      )
        closeStart++;
      let closeEnd = closeStart;
      while (words[closeEnd + 1]?.kind === "punct" && "])}".includes(words[closeEnd + 1]!.text)) closeEnd++;
      if (shape && closeStart < words.length) {
        slots.push({
          start: token.start,
          end: words[openEnd]!.end,
          kind: "cycle",
          role: "shape",
          options: MERMAID_SHAPES.map((s) => s.open),
          pair: { start: words[closeStart]!.start, end: words[closeEnd]!.end },
        });
        // An empty pair of brackets still needs somewhere to type the label.
        if (closeStart === openEnd + 1)
          slots.push({ start: words[openEnd]!.end, end: words[openEnd]!.end, kind: "label", role: "label" });
        i = openEnd;
      }
      continue;
    }
    // `|` `|` with nothing between: an empty edge label the reader can fill.
    if (
      token.kind === "punct" &&
      token.text === "|" &&
      next?.kind === "punct" &&
      next.text === "|" &&
      next.start === token.end
    ) {
      slots.push({ start: token.end, end: token.end, kind: "label", role: "edge label" });
    }
    if (token.kind === "punct" && token.text === ":" && next === undefined && sequence) {
      slots.push({ start: token.end, end: token.end, kind: "label", role: "message text" });
    }
  }
  return slots;
}

function gitlogSlots(line: string, lineStart: number): DiagramsSourceSlot[] {
  if (line.trim().length === 0) return [];
  const slots: DiagramsSourceSlot[] = [];
  const fields = line.split("|");
  let offset = lineStart;
  fields.forEach((field, index) => {
    const start = offset;
    const end = offset + field.length;
    offset = end + 1;
    if (index === 0) {
      const lead = field.length - field.trimStart().length,
        trail = field.length - field.trimEnd().length;
      slots.push(
        field.trim().length
          ? { start: start + lead, end: end - trail, kind: "id", role: "commit id" }
          : { start: end, end, kind: "id", role: "commit id" },
      );
    } else if (index === 1) slots.push({ start, end, kind: "list", role: "parents" });
    else if (index === 2) slots.push({ start, end, kind: "text", role: "marks" });
    else if (index === 3) slots.push({ start, end: lineStart + line.length, kind: "text", role: "subject" });
  });
  return slots;
}

function jsonSlots(
  line: string,
  lineStart: number,
  form: GlyphDiagramsFormId,
  context: { key: string | undefined },
): DiagramsSourceSlot[] {
  const tokens = positioned("json", line, lineStart);
  const slots: DiagramsSourceSlot[] = [];
  const enums = JSON_ENUMS[form];
  for (const token of tokens) {
    if (token.kind === "key") {
      context.key = token.text.slice(1, -1);
      continue;
    }
    const role = context.key !== undefined ? `"${context.key}"` : "value";
    if (token.kind === "string") {
      const closed = token.text.length >= 2 && token.text.endsWith('"');
      const inner = token.text.slice(1, closed ? -1 : undefined);
      const options = context.key !== undefined ? enums[context.key] : undefined;
      if (options && options.includes(inner))
        slots.push({ start: token.start + 1, end: token.start + 1 + inner.length, kind: "cycle", role, options });
      else
        slots.push({
          start: token.start + 1,
          end: token.start + 1 + inner.length,
          kind: context.key !== undefined && JSON_ID_KEYS.has(context.key) ? "id" : "text",
          role,
        });
    } else if (token.kind === "number") slots.push({ start: token.start, end: token.end, kind: "number", role });
    else if (token.kind === "literal" && token.text !== "null")
      slots.push({ start: token.start, end: token.end, kind: "cycle", role, options: ["true", "false"] });
  }
  return slots;
}

/** Every editable span of `text`, sorted, non-overlapping. */
export function diagramsSourceSlots(
  form: GlyphDiagramsFormId,
  dialect: DiagramsSourceDialect,
  text: string,
): readonly DiagramsSourceSlot[] {
  const slots: DiagramsSourceSlot[] = [];
  const context = { key: undefined as string | undefined };
  let offset = 0;
  for (const line of text.split("\n")) {
    if (dialect === "mermaid") slots.push(...mermaidSlots(line, offset, form));
    else if (dialect === "gitlog") slots.push(...gitlogSlots(line, offset));
    else slots.push(...jsonSlots(line, offset, form, context));
    offset += line.length + 1;
  }
  return slots.sort((a, b) => a.start - b.start || a.end - b.end);
}

/**
 * REPAIR slots — the answer to "a source that does not parse has no
 * trustworthy slot map": the broken line (or, when the failure names no
 * line, every line) becomes ONE free slot spanning its whole content, in
 * place of its normal slots. Inside a repair slot any character goes, a
 * line break may be inserted and the line may be joined to a neighbouring
 * repair line, so a stray bracket, a missing comma or a pasted fragment can
 * always be fixed in place; once the source parses, the normal slots return.
 */
export function diagramsSourceRepairSlots(
  slots: readonly DiagramsSourceSlot[],
  text: string,
  lines: "all" | number,
): readonly DiagramsSourceSlot[] {
  const out: DiagramsSourceSlot[] = [];
  let offset = 0;
  const repairs: DiagramsSourceSlot[] = [];
  text.split("\n").forEach((line, index) => {
    if (lines === "all" || lines === index + 1)
      repairs.push({ start: offset, end: offset + line.length, kind: "text", role: "repair" });
    offset += line.length + 1;
  });
  for (const slot of slots) if (!repairs.some((r) => r.start <= slot.start && slot.end <= r.end)) out.push(slot);
  return [...out, ...repairs].sort((a, b) => a.start - b.start || a.end - b.end);
}
/** The slot holding the whole selection `[from, to]` (a caret is `from === to`), if any. */
export function diagramsSourceSlotAt(
  slots: readonly DiagramsSourceSlot[],
  from: number,
  to: number = from,
): DiagramsSourceSlot | undefined {
  return slots.find((slot) => slot.start <= from && to <= slot.end);
}
/** The slot whose nearest edge is closest to `offset` — where a stray caret is redirected. */
export function diagramsSourceNearestSlot(
  slots: readonly DiagramsSourceSlot[],
  offset: number,
): DiagramsSourceSlot | undefined {
  let best: DiagramsSourceSlot | undefined;
  let bestDistance = Infinity;
  for (const slot of slots) {
    const distance = offset < slot.start ? slot.start - offset : offset > slot.end ? offset - slot.end : 0;
    if (distance < bestDistance) {
      best = slot;
      bestDistance = distance;
    }
  }
  return best;
}
/**
 * The next (`+1`) or previous (`-1`) slot from a caret, wrapping around the
 * document. Two slots can touch (`a[`: the id ends where the shape opener
 * starts), so a caret on the seam belongs to the EARLIER one when stepping
 * forward and to the LATER one when stepping back — either way the step
 * lands on the neighbour, never back on the seam.
 */
export function diagramsSourceSlotStep(
  slots: readonly DiagramsSourceSlot[],
  offset: number,
  direction: 1 | -1,
): DiagramsSourceSlot | undefined {
  if (slots.length === 0) return undefined;
  const containing = slots
    .map((slot, index) => (slot.start <= offset && offset <= slot.end ? index : -1))
    .filter((index) => index >= 0);
  const current = containing.length === 0 ? -1 : direction === 1 ? containing[0]! : containing[containing.length - 1]!;
  if (direction === 1) {
    const after = current >= 0 ? current + 1 : slots.findIndex((slot) => slot.start > offset);
    return slots[after >= 0 ? after % slots.length : 0];
  }
  if (current > 0) return slots[current - 1];
  if (current === 0) return slots[slots.length - 1];
  const before = slots.filter((slot) => slot.end < offset);
  return before[before.length - 1] ?? slots[slots.length - 1];
}

const ID_CHAR = /[\p{L}\p{N}_.:-]/u;
/** Whether one typed character belongs in a slot of this kind. */
export function diagramsSourceSlotAccepts(
  slot: DiagramsSourceSlot,
  dialect: DiagramsSourceDialect,
  char: string,
): boolean {
  if (char === "\n" || char === "\r") return false;
  switch (slot.kind) {
    case "cycle":
      return false;
    case "id":
      return dialect === "mermaid"
        ? ID_CHAR.test(char)
        : dialect === "gitlog"
          ? !/[\s|]/.test(char)
          : char !== '"' && char !== "\\";
    case "list":
      return ID_CHAR.test(char) || char === " ";
    case "number":
      return /[0-9.eE+-]/.test(char);
    case "label":
      return (
        !'[]{}()|"'.includes(char) ||
        (slot.role === "message text" || slot.role === "frame label" || slot.role === "participant label"
          ? char !== "|" && char !== '"'
          : false)
      );
    case "text":
      return slot.role === "repair"
        ? true
        : dialect === "json"
          ? char !== '"' && char !== "\\"
          : dialect === "gitlog"
            ? char !== "|"
            : true;
  }
}
/** `text` reduced to the characters the slot takes — line breaks become spaces, the rest is dropped. */
export function diagramsSourceSlotSanitize(
  slot: DiagramsSourceSlot,
  dialect: DiagramsSourceDialect,
  text: string,
): string {
  if (slot.role === "repair") return text.replace(/\r\n?/g, "\n");
  return Array.from(text.replace(/\r?\n/g, " "))
    .filter((char) => diagramsSourceSlotAccepts(slot, dialect, char))
    .join("");
}
/** The replacement(s) that set a cycle slot to `option` — later spans first, so applying them in order keeps earlier offsets valid. `null` for a non-choice slot or an option it does not offer. */
export function diagramsSourceSlotChoose(
  slot: DiagramsSourceSlot,
  option: string,
): readonly { readonly start: number; readonly end: number; readonly replacement: string }[] | null {
  // An `id` field is constrained by the ids that EXIST, not by a fixed
  // vocabulary the slot carries, so it has no `options` of its own — picking
  // one is a plain replacement of its span. (USER FEEDBACK: "for the edges I
  // should get a dropdown for any from and to".)
  if (slot.kind === "id") return [{ start: slot.start, end: slot.end, replacement: option }];
  if (slot.kind !== "cycle" || !slot.options?.includes(option)) return null;
  if (slot.role === "shape" && slot.pair) {
    const shape = MERMAID_SHAPES.find((s) => s.open === option)!;
    return [
      { start: slot.pair.start, end: slot.pair.end, replacement: shape.close },
      { start: slot.start, end: slot.end, replacement: shape.open },
    ];
  }
  return [{ start: slot.start, end: slot.end, replacement: option }];
}
/** The option a cycle slot currently holds (`TD` reads as `TB`), or -1. */
export function diagramsSourceSlotOptionIndex(slot: DiagramsSourceSlot, text: string): number {
  const current = text.slice(slot.start, slot.end);
  return slot.options?.indexOf(current === "TD" ? "TB" : current) ?? -1;
}
/** The replacement(s) that move a cycle slot to its next/previous option. */
export function diagramsSourceSlotCycle(
  slot: DiagramsSourceSlot,
  text: string,
  direction: 1 | -1,
): readonly { readonly start: number; readonly end: number; readonly replacement: string }[] | null {
  if (slot.kind !== "cycle" || !slot.options) return null;
  const index = diagramsSourceSlotOptionIndex(slot, text);
  return diagramsSourceSlotChoose(
    slot,
    slot.options[((index < 0 ? 0 : index) + direction + slot.options.length) % slot.options.length]!,
  );
}
