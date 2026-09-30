// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { GLYPH_FONT_ATLAS, GLYPH_FONT_ATLAS_ASCII, glyphAtlasCodePoint } from "glyphcss";
import { extractAsciiFromPre, glyphAtlasCellsFromPre, glyphAtlasPaletteForPre, trimTrailingWhitespacePerLine } from "./asciiClipboard";

/** An atlas-encoded `<pre>` plus the `@font-palette-values` block a real scene injects beside it. */
function atlasPre(cells: { glyph: string; slot: number }[][], palette: string[]): HTMLElement {
  const name = "--glyph-atlas-palette-test";
  const style = document.createElement("style");
  style.textContent = `@font-palette-values ${name}{font-family:"GlyphCssAtlas";override-colors:${palette.map((c, i) => `${i} ${c}`).join(", ")};}`;
  document.head.appendChild(style);
  const pre = document.createElement("pre");
  pre.style.setProperty("font-palette", name);
  pre.textContent = cells
    .map((row) => row.map((c) => String.fromCodePoint(glyphAtlasCodePoint(c.glyph, c.slot)!)).join(""))
    .join("\n");
  return pre;
}

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

describe("glyphAtlasPaletteForPre / glyphAtlasCellsFromPre — colour for the rich-HTML copy flavour", () => {
  const A = GLYPH_FONT_ATLAS.glyphs[0]!;
  const B = GLYPH_FONT_ATLAS.glyphs[1]!;
  const PALETTE = ["#112233", "#445566", "#778899"];

  it("reads the palette back out of the scene's own @font-palette-values block, in slot order", () => {
    const pre = atlasPre([[{ glyph: A, slot: 0 }]], PALETTE);
    expect(glyphAtlasPaletteForPre(pre)).toEqual(PALETTE);
  });

  it("recovers glyph AND colour per cell — the whole point, since atlas output has neither in the DOM", () => {
    const pre = atlasPre([[{ glyph: A, slot: 2 }, { glyph: B, slot: 0 }]], PALETTE);
    expect(glyphAtlasCellsFromPre(pre)).toEqual([[
      { ch: A, color: "#778899" },
      { ch: B, color: "#112233" },
    ]]);
  });

  it("splits rows on newlines, matching every other grid walk", () => {
    const pre = atlasPre([[{ glyph: A, slot: 1 }], [{ glyph: B, slot: 1 }]], PALETTE);
    const rows = glyphAtlasCellsFromPre(pre)!;
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual([{ ch: A, color: "#445566" }]);
  });

  it("is null for a spans render — the caller's existing span walk already has the colour", () => {
    const pre = document.createElement("pre");
    pre.innerHTML = '<span style="color:#112233">##</span>';
    expect(glyphAtlasPaletteForPre(pre)).toBeNull();
    expect(glyphAtlasCellsFromPre(pre)).toBeNull();
  });

  it("is null when a palette is declared but the text carries no atlas code point", () => {
    const pre = atlasPre([[]], PALETTE);
    pre.textContent = "plain";
    expect(glyphAtlasCellsFromPre(pre)).toBeNull();
  });
});

describe("atlas variant resolution — the shipped atlases share one PUA range", () => {
  /** An ASCII-atlas `<pre>`, pinned exactly the way `createGlyphScene` pins one. */
  function asciiAtlasPre(text: string, palette?: string[]): HTMLElement {
    const pre = document.createElement("pre");
    pre.style.fontFamily = `"${GLYPH_FONT_ATLAS_ASCII.family}", monospace`;
    if (palette) {
      const name = "--glyph-atlas-ascii-palette-test";
      const style = document.createElement("style");
      style.textContent = `@font-palette-values ${name}{font-family:"${GLYPH_FONT_ATLAS_ASCII.family}";override-colors:${palette
        .map((c, i) => `${i} ${c}`)
        .join(", ")};}`;
      document.head.appendChild(style);
      pre.style.setProperty("font-palette", name);
    }
    pre.textContent = [...text]
      .map((ch) => String.fromCodePoint(glyphAtlasCodePoint(ch, 1, GLYPH_FONT_ATLAS_ASCII)!))
      .join("");
    return pre;
  }

  it("round-trips an ASCII-atlas <pre> back to its original text", () => {
    const pre = asciiAtlasPre("HELLO");
    // Decoded against the universal atlas this is real but wrong glyphs, not tofu —
    // which is exactly why the resolver, not a range check, has to make the call.
    expect(pre.textContent).not.toBe("HELLO");
    expect(extractAsciiFromPre(pre)).toBe("HELLO");
  });

  it("stays per-<pre> correct when two scenes on different variants are copied", () => {
    const glyphA = GLYPH_FONT_ATLAS.glyphs[0]!;
    const universal = document.createElement("pre");
    universal.style.fontFamily = `"${GLYPH_FONT_ATLAS.family}", monospace`;
    universal.textContent = String.fromCodePoint(glyphAtlasCodePoint(glyphA, 0)!);

    expect(extractAsciiFromPre(universal)).toBe(glyphA);
    expect(extractAsciiFromPre(asciiAtlasPre("A"))).toBe("A");
  });

  it("recovers glyph AND colour from an ASCII-atlas <pre>", () => {
    const pre = asciiAtlasPre("Zq", ["#112233", "#445566"]);
    expect(glyphAtlasCellsFromPre(pre)).toEqual([[
      { ch: "Z", color: "#445566" },
      { ch: "q", color: "#445566" },
    ]]);
  });
});
