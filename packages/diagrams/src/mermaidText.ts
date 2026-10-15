import { glyphDiagramError } from "./validate";
import { decodeGlyphMermaidEntities, skipGlyphMermaidComment } from "@glyphcss/core/mermaid";
export { GLYPH_MERMAID_ENTITY } from "@glyphcss/core/mermaid";

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
  text = decodeGlyphMermaidEntities(text, quoted);
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
  return skipGlyphMermaidComment(source, index, message => glyphDiagramError("GLYPH_MERMAID_SYNTAX", message));
}
