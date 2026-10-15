import { glyphDiagramError } from "./validate";
import { GLYPH_MERMAID_ENTITIES } from "./mermaidEntities";

/** The same entity token protects statement separators and decodes labels. */
export const GLYPH_MERMAID_ENTITY = /(?:&(?:#[xX][\da-fA-F]+|#\d+|[a-zA-Z][a-zA-Z\d]*)|#(?:\d+|[a-zA-Z][a-zA-Z\d]*));/;

// Shared by the flowchart and state adapters so a label decodes identically in both.

export function labelText(input: string, literalQuotes = false): string {
  let text = input.trim();
  // `literalQuotes`: the text is a label after a colon, where a quote is just a character and nothing is unquoted or unescaped.
  const quoted = !literalQuotes && text.length >= 2 && ((text.startsWith('"') && text.endsWith('"')) || (text.startsWith("'") && text.endsWith("'")));
  if (quoted) text = text.slice(1, -1);
  if (!literalQuotes && quoted && text.startsWith("`") && text.endsWith("`")) {
    text = text.slice(1, -1).replace(/(\*\*|__)([\s\S]+?)\1/g, "$2").replace(/([*_])([^\n]+?)\1/g, "$2");
  }
  // LangGraph emits paragraph markup inside stadium nodes. Strip only literal
  // markup here; an entity-escaped angle bracket (e.g. "&lt;p&gt;") is plain
  // text and survives to the decode below. Styling, links, and Mermaid click
  // statements never become DOM or code.
  text = text.replace(/<br\s*\/?\s*>/gi, "\n").replace(/<\/?(?:p|b|strong|i|em|span)(?:\s[^>]*?)?\s*>/gi, "");
  // One left-to-right scan of the ORIGINAL (still-encoded) text: an HTML
  // entity always wins over quote-escape interpretation at that position, and
  // its decoded output is never re-scanned. Two sequential whole-string
  // passes (decode entities, then unescape "\\\"") would instead treat a
  // backslash PRODUCED by decoding "&#92;" as a second, spurious escape and
  // eat it -- corrupting a round-tripped "\\server\\share"-style label.
  // Quote-escapes are real Mermaid source syntax and only apply when this
  // text was actually quoted.
  const pattern = new RegExp(`${GLYPH_MERMAID_ENTITY.source}${quoted ? '|\\\\["\'\\\\]' : ""}`, "g");
  text = text.replace(pattern, (match: string) => {
    if (match.length === 2 && match[0] === "\\") return match[1]!;
    const value = match.startsWith("#") && /^#\d/.test(match) ? match.slice(0, -1) : match.slice(1, -1);
    const key = Object.prototype.hasOwnProperty.call(GLYPH_MERMAID_ENTITIES, value) ? value : value.toLowerCase();
    const named = Object.prototype.hasOwnProperty.call(GLYPH_MERMAID_ENTITIES, key) ? GLYPH_MERMAID_ENTITIES[key] : undefined;
    if (named !== undefined) return named === "\u00a0" ? " " : named;
    const point = /^#x/i.test(value) ? Number.parseInt(value.slice(2), 16) : value.startsWith("#") ? Number.parseInt(value.slice(1), 10) : NaN;
    return point >= 0 && point <= 0x10ffff && !(point >= 0xd800 && point <= 0xdfff) ? String.fromCodePoint(point) : match;
  });
  // "&nbsp;" decodes to a plain space; trim it (and any other edge
  // whitespace) at the label's ends.
  return text.trim();
}

/**
 * A "%%" comment (or a "%%{ ... }%%" init directive, which may span lines)
 * starting at `index`. Returns the index of its last character, so a scanner's
 * `index = ...` then continues after it. Shared so both adapters agree on what a comment is.
 */
export function skipMermaidComment(source: string, index: number): number {
  if (source[index + 2] === "{") {
    const end = source.indexOf("}%%", index + 3);
    if (end < 0) glyphDiagramError("GLYPH_MERMAID_SYNTAX", "Unclosed Mermaid init directive.");
    return end + 2;
  }
  while (index + 1 < source.length && source[index + 1] !== "\n") index++;
  return index;
}
