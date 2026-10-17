import { describe, expect, it } from "vitest";
import { GLYPH_MERMAID_ENTITIES } from "./entities";
import { decodeGlyphMermaidEntities, glyphMermaidContent, skipGlyphMermaidComment, stripGlyphMermaidPreamble } from "./index";

const fail = (message: string): never => { throw new Error(message); };
describe("shared Mermaid source preprocessing", () => {
  it.each([
    ["&copy; #copy; #35; &#35; &#x1f600;", "© © # # 😀"],
    ["&nbsp;&AMP; &NotEqualTilde;", " & ≂̸"],
    ["&amp;copy;", "&copy;"],
    ["&#xD800; &#1114112; &unknown;", "&#xD800; &#1114112; &unknown;"],
    [String.raw`&#92;\"`, String.raw`\"`],
  ])("decodes %s once", (source, expected) => {
    expect(decodeGlyphMermaidEntities(source, true)).toBe(expected);
  });
  it("decodes the complete HTML named-reference table in both spellings", () => {
    for (const [name, value] of Object.entries(GLYPH_MERMAID_ENTITIES)) {
      const expected = value === "\u00a0" ? " " : value;
      expect(decodeGlyphMermaidEntities(`#${name};`), name).toBe(expected);
      expect(decodeGlyphMermaidEntities(`&${name};`), name).toBe(expected);
    }
  });
  it("keeps quoted escape policy separate from literal labels", () => {
    expect(decodeGlyphMermaidEntities(String.raw`\"`)).toBe(String.raw`\"`);
    expect(decodeGlyphMermaidEntities(String.raw`\"`, true)).toBe('"');
  });
  it("normalizes BOM and CRLF and retains inert frontmatter for the caller", () => {
    const source = "\uFEFF---\r\nconfig:\r\n theme: dark\r\n---\r\n%% comment\r\n%%{init: {\r\n}}%%\r\nflowchart LR\r\nA --> B";
    const parsed = stripGlyphMermaidPreamble(source);
    expect(parsed.frontmatter).toBe("config:\n theme: dark");
    expect(glyphMermaidContent(parsed.body, fail)).toBe("flowchart LR\nA --> B");
    expect(stripGlyphMermaidPreamble("flowchart LR\nA --> B")).toEqual({ body: "flowchart LR\nA --> B" });
  });
  it("never consumes body text after a directive and rejects an unclosed one by the caller's error", () => {
    expect(skipGlyphMermaidComment("%%{x}%%\nA", 0, fail)).toBe(6);
    expect(skipGlyphMermaidComment("%% last", 0, fail)).toBe(6);
    expect(() => glyphMermaidContent("%%{unclosed", fail)).toThrow("Unclosed Mermaid init directive.");
  });
});
