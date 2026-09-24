/**
 * Line tokenizers behind `DiagramsSourceEditor`'s syntax highlighting — one
 * per dialect the /diagrams rail edits (Mermaid flowchart + sequenceDiagram,
 * the three forms' JSON, and the lane form's git-log lines). Deliberately
 * NOT a grammar: each tokenizer is a single left-to-right scan of one line
 * that never rejects input, because the text under the caret is a draft
 * mid-edit most of the time — the library's own parsers are the only
 * authority on validity (`diagramsSourceErrors.ts` maps THEIR failures back
 * onto a line). The one invariant every dialect keeps, pinned by
 * `diagramsSourceTokens.test.ts`: the tokens' texts concatenate back to the
 * exact input line, so the highlight layer stays byte-for-byte aligned
 * with the `<textarea>` it sits under.
 */
export type DiagramsSourceDialect = "mermaid" | "json" | "gitlog";
export type DiagramsSourceTokenKind = "keyword" | "id" | "arrow" | "punct" | "label" | "string" | "key" | "number" | "literal" | "comment" | "text";
export interface DiagramsSourceToken { readonly kind: DiagramsSourceTokenKind; readonly text: string }

const JSON_STRING = /^"(?:[^"\\]|\\.)*"?/;
const JSON_NUMBER = /^-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/;
const JSON_LITERAL = /^(?:true|false|null)\b/;
const JSON_OTHER = /^[^\s"{}[\],:0-9-]+|^./;

function tokenizeJsonLine(line: string): DiagramsSourceToken[] {
  const out: DiagramsSourceToken[] = [];
  let rest = line;
  while (rest.length > 0) {
    let match: RegExpExecArray | null;
    if ((match = /^\s+/.exec(rest))) out.push({ kind: "text", text: match[0] });
    else if ((match = JSON_STRING.exec(rest))) {
      // A string directly followed by `:` is an object key.
      out.push({ kind: /^\s*:/.test(rest.slice(match[0].length)) ? "key" : "string", text: match[0] });
    }
    else if ((match = JSON_NUMBER.exec(rest))) out.push({ kind: "number", text: match[0] });
    else if ((match = JSON_LITERAL.exec(rest))) out.push({ kind: "literal", text: match[0] });
    else if ((match = /^[{}[\],:]/.exec(rest))) out.push({ kind: "punct", text: match[0] });
    else { match = JSON_OTHER.exec(rest)!; out.push({ kind: "text", text: match[0] }); }
    rest = rest.slice(match[0].length);
  }
  return out;
}

const MERMAID_KEYWORDS = new Set([
  "flowchart", "graph", "subgraph", "end", "direction", "TB", "TD", "LR", "BT", "RL",
  "sequenceDiagram", "participant", "actor", "as", "alt", "else", "opt", "loop", "par", "and", "critical", "option", "break", "rect",
  "note", "over", "left", "right", "of", "activate", "deactivate", "autonumber", "classDef", "class", "style", "linkStyle", "click",
]);
/** Block keywords whose whole remaining line is a condition/title, not ids (`alt credentials valid`, `loop poll every 5s`). */
const MERMAID_LABEL_REST = new Set(["alt", "else", "opt", "loop", "par", "and", "critical", "option", "break", "rect", "as"]);
// Longest alternatives first — `-->>` must win over `-->` over `--`.
const MERMAID_ARROW = /^(?:<?-\.->|<?-->>|<?-->|<?->>|<?->|---|--x|--\)|--|-\.|\.->|<?==>|==|-x|-\))/;
// `-`/`.`/`:` continue an id only when another id character follows, so
// `Client->>Server` and `a-.->b` split at the arrow (the library's own id
// rule, `packages/diagrams/src/mermaid.ts`).
const MERMAID_ID = /^[\p{L}\p{N}_](?:[\p{L}\p{N}_]|[.:-](?=[\p{L}\p{N}_]))*/u;
const MERMAID_STRING = /^"(?:[^"\\]|\\.)*"?/;

function tokenizeMermaidLine(line: string): DiagramsSourceToken[] {
  const out: DiagramsSourceToken[] = [];
  let rest = line;
  let depth = 0; // shape-bracket nesting: text inside is a label
  let pipe = false; // inside an `|edge label|`
  let lastKind: DiagramsSourceTokenKind | null = null;
  const push = (kind: DiagramsSourceTokenKind, text: string) => { out.push({ kind, text }); rest = rest.slice(text.length); lastKind = kind; };
  while (rest.length > 0) {
    let match: RegExpExecArray | null;
    if ((match = /^\s+/.exec(rest))) { out.push({ kind: "text", text: match[0] }); rest = rest.slice(match[0].length); continue; }
    if (rest.startsWith("%%")) { push("comment", rest); continue; }
    if (pipe) {
      if (rest.startsWith("|")) { push("punct", "|"); pipe = false; continue; }
      push("label", /^[^|]+/.exec(rest)![0]);
      continue;
    }
    if (depth > 0) {
      if ((match = MERMAID_STRING.exec(rest))) { push("string", match[0]); continue; }
      if ((match = /^[\])}]/.exec(rest))) { depth--; push("punct", match[0]); continue; }
      if ((match = /^[[({]/.exec(rest))) { depth++; push("punct", match[0]); continue; }
      push("label", /^[^[\]({})"]+/.exec(rest)![0]);
      continue;
    }
    if ((match = MERMAID_STRING.exec(rest))) { push("string", match[0]); continue; }
    if ((match = MERMAID_ARROW.exec(rest))) { push("arrow", match[0]); continue; }
    if ((match = /^[[({]/.exec(rest))) { depth++; push("punct", match[0]); continue; }
    if (rest.startsWith(">") && lastKind === "id") { depth++; push("punct", ">"); continue; }
    if (rest.startsWith("|")) { pipe = true; push("punct", "|"); continue; }
    if (rest.startsWith(":::")) { push("punct", ":::"); continue; }
    if (rest.startsWith(":")) {
      // A sequence message / note text: everything after the colon is prose.
      push("punct", ":");
      if (rest.length > 0) push("label", rest);
      continue;
    }
    if ((match = MERMAID_ID.exec(rest))) {
      const word = match[0];
      if (MERMAID_KEYWORDS.has(word) && (lastKind === null || lastKind === "text" || lastKind === "keyword" || lastKind === "id")) {
        push("keyword", word);
        if (MERMAID_LABEL_REST.has(word) && rest.trim().length > 0) {
          const space = /^\s+/.exec(rest);
          if (space) { out.push({ kind: "text", text: space[0] }); rest = rest.slice(space[0].length); }
          push("label", rest);
        }
      } else push("id", word);
      continue;
    }
    push("punct", rest[0]!);
  }
  return out;
}

/** `id|parents|decoration|subject` — the fourth field runs to the end of the line, pipes included. */
function tokenizeGitLogLine(line: string): DiagramsSourceToken[] {
  const out: DiagramsSourceToken[] = [];
  const fields = line.split("|");
  fields.forEach((field, index) => {
    if (index > 0) out.push({ kind: "punct", text: "|" });
    if (index >= 3) { if (field.length) out.push({ kind: "label", text: field }); return; }
    if (index === 2) { if (field.length) out.push({ kind: "keyword", text: field }); return; }
    // id and parents: whitespace-separated ids.
    let rest = field;
    while (rest.length > 0) {
      const space = /^\s+/.exec(rest);
      if (space) { out.push({ kind: "text", text: space[0] }); rest = rest.slice(space[0].length); continue; }
      const word = /^\S+/.exec(rest)![0];
      out.push({ kind: "id", text: word });
      rest = rest.slice(word.length);
    }
  });
  return out;
}

export function tokenizeDiagramsSourceLine(dialect: DiagramsSourceDialect, line: string): DiagramsSourceToken[] {
  if (dialect === "json") return tokenizeJsonLine(line);
  if (dialect === "mermaid") return tokenizeMermaidLine(line);
  return tokenizeGitLogLine(line);
}

/** One token list per line, `text.split("\n")` order — an empty line is an empty list. */
export function tokenizeDiagramsSource(dialect: DiagramsSourceDialect, text: string): DiagramsSourceToken[][] {
  return text.split("\n").map((line) => tokenizeDiagramsSourceLine(dialect, line));
}
