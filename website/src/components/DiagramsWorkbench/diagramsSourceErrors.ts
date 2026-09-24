/**
 * Maps a pipeline failure (`GlyphDiagramsWorkbenchRender`'s own `{ error,
 * code }`) back onto a LINE of the source the reader is editing, plus the
 * library's own repair hint for that rule code — the two things
 * `DiagramsSourceEditor` shows beside the offending line instead of one
 * opaque banner.
 *
 * `@glyphcss/diagrams`' errors are tagged (`glyphDiagramError(code, …)`,
 * `GLYPH_DIAGRAM_VALIDATION_RULES` and the sequence/lanes twins) but carry
 * NO position of their own — every parser reports the offending statement
 * or id as a quoted fragment in its message (`Missing "]" in "a[foo"`,
 * `Node "x" references an unknown parent "y"`, `Expected "id|parents|…",
 * got: "…"`), and a JSON `SyntaxError` reports a character offset. This
 * module recovers a line from exactly those, and says so plainly (`line:
 * undefined`) when it can't — it never invents a position. Pure, so every
 * rule below has a test with no DOM in the loop.
 */
import { glyphDiagramRepairHint } from "@glyphcss/diagrams";
import { glyphSequenceRepairHint } from "@glyphcss/diagrams/sequence";
import { glyphLaneDagRepairHint } from "@glyphcss/diagrams/lanes";
import type { GlyphDiagramsFormId } from "./diagramsWorkbenchState";
import type { DiagramsSourceDialect } from "./diagramsSourceTokens";

export interface DiagramsSourceDiagnostic {
  readonly code: string | undefined;
  /** The library's own message, with the `code: glyphcss: code:` prefixes the render wrapper stacks on it stripped. */
  readonly message: string;
  readonly hint: string | undefined;
  /** 1-based line in the CURRENT source text; `undefined` when no rule below could place it. */
  readonly line: number | undefined;
}

const REPAIR_HINTS: Readonly<Record<GlyphDiagramsFormId, (code: string) => string>> = {
  graph: glyphDiagramRepairHint, sequence: glyphSequenceRepairHint, lanes: glyphLaneDagRepairHint,
};

function stripPrefixes(error: string, code: string | undefined): string {
  let message = error;
  const prefix = code ? `${code}: ` : undefined;
  // `diagramsWorkbenchRender.ts` prefixes `code: ` and the library's own
  // `glyphDiagramError` prefixes `glyphcss: code: ` — both peel off.
  if (prefix && message.startsWith(prefix)) message = message.slice(prefix.length);
  if (message.startsWith("glyphcss: ")) message = message.slice("glyphcss: ".length);
  if (prefix && message.startsWith(prefix)) message = message.slice(prefix.length);
  return message;
}

const IDENTIFIER_LIKE = /^[\p{L}\p{N}_.:-]+$/u;
function escapeRegExp(value: string): string { return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }

/**
 * 0-based indexes of the lines containing `fragment` — as a whole word when
 * it looks like an id, as a raw substring otherwise. A non-id fragment is
 * usually the REST of a statement (`Unsupported edge operator near "]"`),
 * so lines that end with it win over lines that merely contain it.
 */
function matchingLines(lines: readonly string[], fragment: string): number[] {
  if (fragment.length === 0) return [];
  if (IDENTIFIER_LIKE.test(fragment)) {
    const pattern = new RegExp(`(?:^|[^\\p{L}\\p{N}_])${escapeRegExp(fragment)}(?=$|[^\\p{L}\\p{N}_])`, "u");
    return lines.flatMap((line, index) => (pattern.test(line) ? [index] : []));
  }
  const tail = fragment.trim();
  const ending = lines.flatMap((line, index) => (line.trimEnd().endsWith(tail) ? [index] : []));
  return ending.length > 0 ? ending : lines.flatMap((line, index) => (line.includes(fragment) ? [index] : []));
}

/** Line/column from a native JSON `SyntaxError` — `at position N` (V8) or `line L column C` (newer V8, JavaScriptCore). */
function jsonSyntaxLine(message: string, source: string): number | undefined {
  const lineColumn = /line (\d+) column (\d+)/.exec(message);
  if (lineColumn) return Number(lineColumn[1]);
  const position = /at position (\d+)/.exec(message);
  if (position) {
    const offset = Math.min(Number(position[1]), source.length);
    return source.slice(0, offset).split("\n").length;
  }
  return undefined;
}

function firstStatementLine(lines: readonly string[]): number | undefined {
  const index = lines.findIndex((line) => line.trim().length > 0 && !line.trim().startsWith("%%"));
  return index < 0 ? undefined : index + 1;
}

/**
 * Codes whose failure is not a source position at all — a layout that ran
 * out of lanes has nothing to underline; the strip says so rather than
 * pointing at line 1.
 */
const POSITIONLESS_CODES = new Set(["GLYPH_DIAGRAM_UNROUTABLE", "GLYPH_DIAGRAM_ELK_NOT_INSTALLED", "bad-options", "bad-size"]);

/**
 * The Mermaid statement splitter reports an unclosed shape/quote or a stray
 * closer with NO fragment (`Unclosed quoted label, node shape, edge text,
 * or edge label.`, `Unmatched "]" in Mermaid source.`) — the first line
 * whose own brackets/quotes don't balance is where the reader has to look.
 * Mirrors the splitter's own rules (`packages/diagrams/src/mermaid.ts`'s
 * `statements`): `>` after an id opens the asymmetric shape only OUTSIDE a
 * shape (inside one, `<p>` in an HTML label is plain text), an arrow's own
 * `>` does not; a comment line counts for nothing.
 */
function mermaidUnbalancedLine(lines: readonly string[]): number | undefined {
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]!;
    if (line.trim().startsWith("%%")) continue;
    let depth = 0;
    let quote = "";
    let seen = "";
    for (const char of line) {
      if (quote) { if (char === quote) quote = ""; seen += char; continue; }
      if (char === '"') quote = char;
      else if ("[({".includes(char) || (char === ">" && depth === 0 && /[\p{L}\p{N}_.]\s*$/u.test(seen))) depth++;
      else if ("])}".includes(char)) { depth--; if (depth < 0) return index + 1; }
      seen += char;
    }
    if (depth !== 0 || quote) return index + 1;
  }
  return undefined;
}

function locateByFragments(lines: readonly string[], message: string, code: string | undefined, dialect: DiagramsSourceDialect): number | undefined {
  const fragments = Array.from(message.matchAll(/"([^"]*)"/g), (m) => m[1]!).filter((f) => f.trim().length > 0);
  if (fragments.length === 0) return undefined;
  const duplicate = code?.startsWith("duplicate-") ?? false;
  // A duplicate id in JSON: the SECOND `"id": "x"` line is the offender, not
  // the first declaration or an edge that merely references it.
  if (duplicate && dialect === "json") {
    for (const fragment of fragments) {
      const declaration = new RegExp(`"id"\\s*:\\s*"${escapeRegExp(fragment)}"`);
      const hits = lines.map((line, index) => (declaration.test(line) ? index : -1)).filter((index) => index >= 0);
      if (hits.length >= 2) return hits[1]! + 1;
    }
  }
  // The fragment with the FEWEST matching lines is the most specific one:
  // an unknown id occurs only where it is (wrongly) referenced, while the
  // ids around it in the same message occur wherever they are declared too.
  // Ties go to the longer fragment (a whole statement over a single
  // bracket).
  let best: { readonly hits: number[]; readonly fragment: string } | null = null;
  for (const fragment of fragments) {
    const hits = matchingLines(lines, fragment);
    if (hits.length === 0) continue;
    if (!best || hits.length < best.hits.length || (hits.length === best.hits.length && fragment.length > best.fragment.length)) best = { hits, fragment };
  }
  if (best) return (duplicate && best.hits.length >= 2 ? best.hits[1]! : best.hits[0]!) + 1;
  // No fragment matched verbatim (`Edge "a -> b" …` names an edge the
  // Mermaid source spells `a --> b`, or pretty-printed JSON puts on two
  // lines): first the line where every id-like word of a fragment
  // co-occurs, else the same fewest-matches rule over the words themselves
  // — an unknown id occurs only where it is referenced.
  const words = fragments.flatMap((fragment) => fragment.split(/[\s>-]+/)).filter((word) => word.length > 0 && IDENTIFIER_LIKE.test(word));
  for (const fragment of fragments) {
    const fragmentWords = fragment.split(/[\s>-]+/).filter((word) => word.length > 0 && IDENTIFIER_LIKE.test(word));
    if (fragmentWords.length < 2) continue;
    const index = lines.findIndex((line) => fragmentWords.every((word) => matchingLines([line], word).length > 0));
    if (index >= 0) return index + 1;
  }
  let bestWord: { readonly hits: number[]; readonly word: string } | null = null;
  for (const word of words) {
    const hits = matchingLines(lines, word);
    if (hits.length === 0) continue;
    if (!bestWord || hits.length < bestWord.hits.length || (hits.length === bestWord.hits.length && word.length > bestWord.word.length)) bestWord = { hits, word };
  }
  return bestWord ? bestWord.hits[0]! + 1 : undefined;
}

export function locateDiagramsSourceError(
  form: GlyphDiagramsFormId, dialect: DiagramsSourceDialect, source: string,
  failure: { readonly error: string; readonly code?: string },
): DiagramsSourceDiagnostic {
  const { code } = failure;
  const message = stripPrefixes(failure.error, code);
  const hint = code ? REPAIR_HINTS[form](code) : undefined;
  const lines = source.split("\n");
  let line: number | undefined;
  if (code && POSITIONLESS_CODES.has(code)) line = undefined;
  else if (code?.endsWith("_BAD_JSON")) line = jsonSyntaxLine(message, source);
  else if (code?.startsWith("GLYPH_MERMAID_UNSUPPORTED_") || /^(?:Expected a (?:flowchart|graph|sequenceDiagram)|Use flowchart\/graph|Mermaid source is empty)/.test(message)) line = firstStatementLine(lines);
  else if (code === "GLYPH_MERMAID_SYNTAX" && /^(?:Unclosed quoted label|Unmatched ")/.test(message)) line = mermaidUnbalancedLine(lines);
  else line = locateByFragments(lines, message, code, dialect);
  return { code, message, hint, line };
}
