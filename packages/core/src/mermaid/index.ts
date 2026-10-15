import { GLYPH_MERMAID_ENTITIES } from "./entities";

/** The same entity token protects statement separators and decodes labels. */
export const GLYPH_MERMAID_ENTITY = /(?:&(?:#[xX][\da-fA-F]+|#\d+|[a-zA-Z][a-zA-Z\d]*)|#(?:\d+|[a-zA-Z][a-zA-Z\d]*));/;

/** Decode once: entity-produced backslashes must never become quote escapes. */
export function decodeGlyphMermaidEntities(text: string, quoted = false): string {
  // One left-to-right scan of the ORIGINAL (still-encoded) text: an HTML
  // entity always wins over quote-escape interpretation at that position, and
  // its decoded output is never re-scanned. Two sequential whole-string
  // passes (decode entities, then unescape "\\\"") would instead treat a
  // backslash PRODUCED by decoding "&#92;" as a second, spurious escape and
  // eat it -- corrupting a round-tripped "\\server\\share"-style label.
  // Quote-escapes are real Mermaid source syntax and only apply when this
  // text was actually quoted.
  const pattern = new RegExp(`${GLYPH_MERMAID_ENTITY.source}${quoted ? '|\\\\["\'\\\\]' : ""}`, "g");
  return text.replace(pattern, (match: string) => {
    if (match.length === 2 && match[0] === "\\") return match[1]!;
    const value = match.startsWith("#") && /^#\d/.test(match) ? match.slice(0, -1) : match.slice(1, -1);
    const key = Object.prototype.hasOwnProperty.call(GLYPH_MERMAID_ENTITIES, value) ? value : value.toLowerCase();
    const named = Object.prototype.hasOwnProperty.call(GLYPH_MERMAID_ENTITIES, key) ? GLYPH_MERMAID_ENTITIES[key] : undefined;
    if (named !== undefined) return named === "\u00a0" ? " " : named;
    const point = /^#x/i.test(value) ? Number.parseInt(value.slice(2), 16) : value.startsWith("#") ? Number.parseInt(value.slice(1), 10) : NaN;
    return point >= 0 && point <= 0x10ffff && !(point >= 0xd800 && point <= 0xdfff) ? String.fromCodePoint(point) : match;
  });
}

/** Grammar-neutral preamble; callers retain their own title/config policy. */
export function stripGlyphMermaidPreamble(source: string): { body: string; frontmatter?: string } {
  const normalized = source.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
  const match = /^\s*---\s*\n([\s\S]*?)\n---[ \t]*(?:\n|$)/.exec(normalized);
  return match ? { body: normalized.slice(match[0].length), frontmatter: match[1]! } : { body: normalized };
}

/** Scanners call only outside their grammar's literal text. Returns the last consumed index. */
export function skipGlyphMermaidComment(source: string, index: number, fail: (message: string) => never): number {
  if (source[index + 2] === "{") {
    const end = source.indexOf("}%%", index + 3);
    if (end < 0) fail("Unclosed Mermaid init directive.");
    return end + 2;
  }
  const end = source.indexOf("\n", index);
  return end < 0 ? source.length - 1 : end - 1;
}

/** Header detection ignores preamble comments without tokenizing a foreign body. */
export function glyphMermaidContent(source: string, fail: (message: string) => never): string {
  let index = 0;
  while (index < source.length) {
    if (/\s/.test(source[index]!)) index++;
    else if (source.startsWith("%%", index)) index = skipGlyphMermaidComment(source, index, fail) + 1;
    else break;
  }
  return source.slice(index);
}
