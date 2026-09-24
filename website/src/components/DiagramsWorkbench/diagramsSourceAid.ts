/**
 * The authoring aid behind `DiagramsSourceEditor` — one mechanism,
 * parameterised by form and dialect (the user's own complaint: "there isn't
 * a good way to add a new node or edit a node and understand what you are
 * doing"). Three pure pieces, each with its own test:
 *
 * - **Snippets** (`diagramsSourceSnippets`): well-formed syntax the toolbar
 *   inserts at the caret with its first placeholder SELECTED, so the next
 *   keystroke replaces it. The graph form's node snippets are one per
 *   shape the renderer really supports (`DIAGRAMS_SHAPE_CATALOGUE`, read
 *   off the library's own `GlyphGraphNodeShape`), so the shape menu is also
 *   the shape legend — the page renders each one live through the real
 *   library, so the aid can never drift from what actually draws.
 * - **Completion** (`diagramsSourceCompletionContext` +
 *   `diagramsSourceCompletions`): the id-shaped word under the caret, in a
 *   position where an EXISTING id is expected (an edge endpoint, a message
 *   participant, a git-log parent, a JSON `from`/`to`/`parents` value),
 *   matched against the ids the live parse already knows.
 * - **Id → line** (`diagramsSourceLineOfId`): where an id is declared in the
 *   current text, for the render's click-to-line jump.
 */
import type { GlyphGraphNodeShape } from "@glyphcss/diagrams";
import type { GlyphDiagramsFormId } from "./diagramsWorkbenchState";
import { tokenizeDiagramsSourceLine, type DiagramsSourceDialect } from "./diagramsSourceTokens";

export interface DiagramsSourceSnippet {
  readonly id: string;
  readonly label: string;
  /** Tooltip / legend line — the syntax itself, e.g. `id([Label])`. */
  readonly title: string;
  /** Inserted verbatim (line breaks included); every line after the first is indented to the caret line's own indent. */
  readonly body: string;
  /** Selection AFTER insertion, as offsets into `body` — the first placeholder. */
  readonly select: readonly [number, number];
  /** Snippets sharing a group collapse into one menu button (the graph form's shape legend). */
  readonly group?: string;
  /** For a grouped snippet: the `GlyphGraphNodeShape` the page renders a live preview of. */
  readonly shape?: GlyphGraphNodeShape;
}

/**
 * Every shape the renderer supports (`GlyphGraphNodeShape`), with its
 * Mermaid delimiters. `cylinder` has no Mermaid token the adapter parses
 * (`packages/diagrams/AGENTS.md`: a JSON-only shape today), so it is
 * offered on the JSON tab only — the Mermaid legend must never show syntax
 * the library would reject.
 */
export const DIAGRAMS_SHAPE_CATALOGUE: readonly { readonly shape: GlyphGraphNodeShape; readonly label: string; readonly open: string; readonly close: string; readonly mermaid: boolean }[] = [
  { shape: "rect", label: "Rectangle", open: "[", close: "]", mermaid: true },
  { shape: "rounded", label: "Rounded", open: "(", close: ")", mermaid: true },
  { shape: "diamond", label: "Decision", open: "{", close: "}", mermaid: true },
  { shape: "circle", label: "Circle", open: "((", close: "))", mermaid: true },
  { shape: "stadium", label: "Stadium", open: "([", close: "])", mermaid: true },
  { shape: "subroutine", label: "Subroutine", open: "[[", close: "]]", mermaid: true },
  { shape: "asymmetric", label: "Asymmetric", open: ">", close: "]", mermaid: true },
  { shape: "cylinder", label: "Cylinder", open: "[(", close: ")]", mermaid: false },
];

const selectWord = (body: string, word: string): readonly [number, number] => { const at = body.indexOf(word); return [at, at + word.length]; };
function snippet(id: string, label: string, body: string, placeholder: string, extra: Partial<DiagramsSourceSnippet> = {}): DiagramsSourceSnippet {
  return { id, label, title: body.split("\n")[0]!, body, select: selectWord(body, placeholder), ...extra };
}

export function diagramsSourceSnippets(form: GlyphDiagramsFormId, dialect: DiagramsSourceDialect): readonly DiagramsSourceSnippet[] {
  if (form === "graph" && dialect === "mermaid") {
    return [
      ...DIAGRAMS_SHAPE_CATALOGUE.filter((s) => s.mermaid).map((s) => snippet(`node-${s.shape}`, s.label, `id${s.open}Label${s.close}`, "id", { group: "Node", shape: s.shape })),
      snippet("edge", "Edge", "from --> to", "from"),
      snippet("edge-label", "Labelled edge", "from -->|label| to", "from"),
      snippet("edge-dotted", "Dotted edge", "from -.-> to", "from"),
      snippet("subgraph", "Subgraph", "subgraph group[Group]\n  member\nend", "group"),
    ];
  }
  if (form === "graph") {
    return [
      ...DIAGRAMS_SHAPE_CATALOGUE.map((s) => snippet(`node-${s.shape}`, s.label, `{ "id": "id", "label": "Label", "shape": "${s.shape}" }`, "id", { group: "Node", shape: s.shape })),
      snippet("edge", "Edge", '{ "from": "from", "to": "to" }', "from"),
      snippet("edge-label", "Labelled edge", '{ "from": "from", "to": "to", "label": "label" }', "from"),
      snippet("group", "Group", '{ "id": "group", "label": "Group", "members": ["member"] }', "group"),
    ];
  }
  if (form === "sequence" && dialect === "mermaid") {
    return [
      snippet("participant", "Participant", "participant id as Label", "id"),
      snippet("actor", "Actor", "actor id as Label", "id"),
      snippet("message", "Message", "from->>to: text", "from"),
      snippet("reply", "Reply", "from-->>to: text", "from"),
      snippet("alt", "Alt / else", "alt condition\n  from->>to: text\nelse otherwise\n  to-->>from: text\nend", "condition"),
      snippet("loop", "Loop", "loop condition\n  from->>to: text\nend", "condition"),
      snippet("note", "Note", "note over id: text", "id"),
    ];
  }
  if (form === "sequence") {
    return [
      snippet("participant", "Participant", '{ "id": "id", "label": "Label" }', "id"),
      snippet("message", "Message", '{ "from": "from", "to": "to", "label": "text" }', "from"),
      snippet("frame", "Frame", '{ "kind": "alt", "label": "condition", "from": 0, "to": 0 }', "condition"),
      snippet("note", "Note", '{ "text": "text", "over": ["id"], "at": 0 }', "text"),
    ];
  }
  if (dialect === "gitlog") {
    return [
      snippet("commit", "Commit", "id|parent||Subject", "id"),
      snippet("merge", "Merge", "id|parent other||Merge subject", "id"),
      snippet("tagged", "Tagged commit", "id|parent|(tag: v1.0.0)|Subject", "id"),
    ];
  }
  return [
    snippet("node", "Node", '{ "id": "id", "label": "Label", "parents": ["parent"] }', "id"),
    snippet("root", "Root node", '{ "id": "id", "label": "Label", "parents": [] }', "id"),
    snippet("marked", "Marked node", '{ "id": "id", "label": "Label", "parents": ["parent"], "marks": ["mark"] }', "id"),
  ];
}

/** Where a snippet lands: replaces `[start, end)` of `text` with `insert`, then selects `select` (absolute offsets). */
export interface DiagramsSourceInsertion { readonly start: number; readonly end: number; readonly insert: string; readonly select: readonly [number, number] }

/**
 * A snippet goes on its OWN line: if the caret line already has text (a
 * statement the caret sits in, or a just-inserted snippet whose placeholder
 * is still selected), the snippet starts on a new line AFTER that line at
 * its indent; a blank line takes it in place. Every body line after the
 * first carries the same indent.
 */
export function diagramsSourceInsertion(text: string, caret: number, snip: DiagramsSourceSnippet, dialect: DiagramsSourceDialect = "mermaid"): DiagramsSourceInsertion {
  const lineStart = text.lastIndexOf("\n", caret - 1) + 1;
  const lineBreak = text.indexOf("\n", caret);
  const lineEnd = lineBreak < 0 ? text.length : lineBreak;
  const line = text.slice(lineStart, lineEnd);
  const indent = /^[ \t]*/.exec(line)![0];
  const trimmed = line.trimEnd();
  const occupied = trimmed.trim().length > 0;
  // JSON: the new element needs its comma. After a line that closes a
  // value (`}`, `]`, a string, a number) the comma goes on that line; after
  // a line that already ends with `,` the new element carries its own, so
  // the element that follows keeps the one it had.
  const closesValue = dialect === "json" && occupied && /[}\]"\d]$/.test(trimmed);
  const continues = dialect === "json" && occupied && trimmed.endsWith(",");
  const body = `${snip.body}${continues ? "," : ""}`.split("\n").join(`\n${indent}`);
  const at = occupied ? lineStart + trimmed.length : caret;
  const prefix = occupied ? `${closesValue ? "," : ""}\n${indent}` : "";
  const insert = `${prefix}${body}`;
  // The first placeholder sits on the first body line, so indent shifts
  // only apply to selections past a line break.
  const shift = (offset: number) => {
    const breaks = snip.body.slice(0, offset).split("\n").length - 1;
    return at + prefix.length + offset + breaks * indent.length;
  };
  return { start: at, end: occupied ? lineEnd : at, insert, select: [shift(snip.select[0]), shift(snip.select[1])] };
}

const ID_VALUE_KEYS = new Set(["from", "to", "members", "group", "parents", "over"]);
const MERMAID_KEYWORD_LIKE = /^(?:flowchart|graph|subgraph|end|sequenceDiagram|participant|actor|alt|else|opt|loop|par|and|note|over|as)$/;

/** The id-shaped prefix under the caret, when the caret sits where an EXISTING id is expected; `null` otherwise. */
export function diagramsSourceCompletionContext(dialect: DiagramsSourceDialect, text: string, caret: number): { readonly start: number; readonly prefix: string } | null {
  const lineStart = text.lastIndexOf("\n", caret - 1) + 1;
  const before = text.slice(lineStart, caret);
  if (dialect === "gitlog") {
    // `id|parents|…` — only the parents field references existing ids.
    if (before.split("|").length - 1 !== 1) return null;
    const word = /[^\s|]*$/.exec(before)![0];
    return word.length > 0 ? { start: caret - word.length, prefix: word } : null;
  }
  const tokens = tokenizeDiagramsSourceLine(dialect, before);
  const last = tokens[tokens.length - 1];
  if (!last) return null;
  if (dialect === "json") {
    // An unterminated string value (`"fr` with the caret right after) under an id-valued key.
    if (last.kind !== "string" || last.text.length < 2 || last.text.endsWith('"')) return null;
    const keyMatch = /"([^"]+)"\s*:[^:]*$/.exec(before);
    if (keyMatch && !ID_VALUE_KEYS.has(keyMatch[1]!)) return null;
    const prefix = last.text.slice(1);
    return { start: caret - prefix.length, prefix };
  }
  if (last.kind !== "id" || MERMAID_KEYWORD_LIKE.test(last.text)) return null;
  // A lone first word on a flowchart line declares a node rather than
  // referencing one — still worth completing (the reader may be re-typing
  // an existing id to add an edge from it), so no position gate here.
  return { start: caret - last.text.length, prefix: last.text };
}

export interface DiagramsSourceCompletion { readonly id: string; readonly label?: string }

/** Ids starting with `prefix` (case-insensitive), the exact match excluded when it is the only one. */
export function diagramsSourceCompletions(ids: readonly DiagramsSourceCompletion[], prefix: string, limit = 8): readonly DiagramsSourceCompletion[] {
  const lower = prefix.toLowerCase();
  const seen = new Set<string>();
  const matches = ids.filter((item) => {
    if (seen.has(item.id) || !item.id.toLowerCase().startsWith(lower)) return false;
    seen.add(item.id);
    return true;
  });
  if (matches.length === 1 && matches[0]!.id === prefix) return [];
  return matches.slice(0, limit);
}

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** 1-based line where `id` is declared in `text` — its JSON `"id"` entry, its git-log line, or its first whole-word Mermaid mention. */
export function diagramsSourceLineOfId(dialect: DiagramsSourceDialect, text: string, id: string): number | undefined {
  const lines = text.split("\n");
  const escaped = escapeRegExp(id);
  const declaration = dialect === "json" ? new RegExp(`"id"\\s*:\\s*"${escaped}"`)
    : dialect === "gitlog" ? new RegExp(`^\\s*${escaped}\\s*\\|`)
    : new RegExp(`(?:^|[^\\p{L}\\p{N}_])${escaped}(?=$|[^\\p{L}\\p{N}_])`, "u");
  const index = lines.findIndex((line) => declaration.test(line));
  if (index >= 0) return index + 1;
  const mention = new RegExp(`(?:^|[^\\p{L}\\p{N}_])${escaped}(?=$|[^\\p{L}\\p{N}_])`, "u");
  const fallback = lines.findIndex((line) => mention.test(line));
  return fallback >= 0 ? fallback + 1 : undefined;
}
