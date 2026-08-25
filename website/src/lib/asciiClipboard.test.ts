// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { GLYPH_FONT_ATLAS, glyphAtlasCodePoint } from "glyphcss";
import { extractAsciiFromPre, trimTrailingWhitespacePerLine } from "./asciiClipboard";

describe("trimTrailingWhitespacePerLine", () => {
  it("trims trailing spaces on every line", () => {
    expect(trimTrailingWhitespacePerLine("abc   \ndef  \n")).toBe("abc\ndef\n");
  });

  it("preserves leading whitespace (the art's own left offset)", () => {
    expect(trimTrailingWhitespacePerLine("   abc   \n  def")).toBe("   abc\n  def");
  });

  it("leaves lines with no trailing whitespace untouched", () => {
    expect(trimTrailingWhitespacePerLine("abc\ndef")).toBe("abc\ndef");
  });

  it("trims trailing tabs as well as spaces", () => {
    expect(trimTrailingWhitespacePerLine("abc\t\t\ndef")).toBe("abc\ndef");
  });
});

describe("extractAsciiFromPre", () => {
  it("returns null for a null pre", () => {
    expect(extractAsciiFromPre(null)).toBeNull();
  });

  it("returns null for an empty/whitespace-only pre", () => {
    const pre = document.createElement("pre");
    pre.textContent = "   \n   \n";
    expect(extractAsciiFromPre(pre)).toBeNull();
  });

  it("reads textContent, not innerHTML — strips span markup, keeps text", () => {
    const pre = document.createElement("pre");
    pre.innerHTML = '<span style="color:red">##</span>  \n<span>..</span>  ';
    const out = extractAsciiFromPre(pre);
    expect(out).not.toBeNull();
    expect(out).not.toContain("<span");
    expect(out).not.toContain("</span>");
    expect(out).toBe("##\n..");
  });

  it("trims trailing whitespace per line from a grid-padded render", () => {
    const pre = document.createElement("pre");
    pre.textContent = "  /\\  \n /  \\ \n/____\\";
    expect(extractAsciiFromPre(pre)).toBe("  /\\\n /  \\\n/____\\");
  });

  it("decodes colorEncoding: \"atlas\" PUA output back to the original glyphs, so Copy ASCII stays readable", () => {
    const glyphA = GLYPH_FONT_ATLAS.glyphs[0]!;
    const glyphB = GLYPH_FONT_ATLAS.glyphs[1]!;
    const cpA = glyphAtlasCodePoint(glyphA, 0)!;
    const cpB = glyphAtlasCodePoint(glyphB, 1)!;
    const pre = document.createElement("pre");
    pre.textContent = `${String.fromCodePoint(cpA)} ${String.fromCodePoint(cpB)}`;
    expect(extractAsciiFromPre(pre)).toBe(`${glyphA} ${glyphB}`);
  });

  it("is a no-op reverse-map on ordinary colorEncoding: \"spans\" output (no PUA code points present)", () => {
    const pre = document.createElement("pre");
    pre.textContent = "  .:-=+*#%@  \n  hello  ";
    // Byte-identical to the pre-atlas behavior: nothing here is in the
    // atlas's PUA range, so decoding must not alter a single character.
    expect(extractAsciiFromPre(pre)).toBe("  .:-=+*#%@\n  hello");
  });
});
