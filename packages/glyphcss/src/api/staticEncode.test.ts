import { describe, it, expect } from "vitest";
import { encodeStaticGlyphHtml, cropGlyphInner, cropGlyphFrames } from "./staticEncode";

// Two lines, two colors (one repeated), with leading + internal + trailing spaces.
const INNER = `  <span style="color:#ff0000">@@</span> <span style="color:#00ff00">##</span>  \n<span style="color:#ff0000">**</span>   `;

const glyphsOnly = (s: string) => s.replace(/<[^>]*>/g, "").replace(/\s/g, "");

describe("encodeStaticGlyphHtml", () => {
  it("inline mode trims trailing spaces, keeps content", () => {
    const { css, html } = encodeStaticGlyphHtml(INNER, "inline");
    expect(css).toBe("");
    expect(html).toContain('style="color:#ff0000"');
    expect(html).not.toMatch(/ +(<\/pre>|\n)/); // no trailing spaces before newline / close
    expect(glyphsOnly(html)).toBe("@@##**");
  });

  it("classes mode dedupes colors into rules + class spans (no inline color)", () => {
    const { css, html } = encodeStaticGlyphHtml(INNER, "classes");
    // #ff0000 appears twice in source but once in the CSS.
    expect((css.match(/#ff0000/g) ?? []).length).toBe(1);
    expect((css.match(/#00ff00/g) ?? []).length).toBe(1);
    expect(html).not.toContain("style="); // no inline styles
    expect(html).toContain('class="c0"');
    expect(html).toContain('class="c1"');
    expect(glyphsOnly(html)).toBe("@@##**");
    // leading/internal spaces preserved, trailing trimmed
    expect(html).toContain('  <span class="c0">@@</span>');
    expect(html).not.toMatch(/ +\n/);
  });

  it("grid mode emits placed runs with no literal spaces, content preserved", () => {
    const { css, html } = encodeStaticGlyphHtml(INNER, "grid");
    expect(html.startsWith("<div")).toBe(true);
    expect(html).toContain("grid-area:");
    expect(html).not.toMatch(/<\/s> +<s/); // no literal spaces between cells
    expect(css).toContain("display:inline-grid");
    expect(glyphsOnly(html)).toBe("@@##**");
    // first red run starts at column 3 (after 2 leading spaces)
    expect(html).toMatch(/grid-area:1\/3\/auto\/span 2/);
  });

  it("classes output is smaller than inline for repeated colors", () => {
    const repeated = Array.from({ length: 40 }, (_, i) =>
      `<span style="color:#abcdef">@@@</span> `).join("");
    const inline = encodeStaticGlyphHtml(repeated, "inline");
    const classes = encodeStaticGlyphHtml(repeated, "classes");
    expect((classes.html.length + classes.css.length)).toBeLessThan(inline.html.length);
  });
});


describe("supplementary atlas cells in static exports", () => {
  const braille = String.fromCodePoint(0xf0001);

  it("crops mixed BMP/PUA-A rows in cell coordinates", () => {
    expect(cropGlyphInner(`  @${braille}  \n   @  `)).toBe(`@${braille}\n @`);
    const encoded = encodeStaticGlyphHtml(`  @${braille}  \n   @  `, "inline", { crop: true });
    expect(encoded.html).toBe(`<pre class="glyph-output">@${braille}\n @</pre>`);
  });

  it("keeps turntable frames at one common cell width", () => {
    expect(cropGlyphFrames([`  ${braille}  `, "   @ "])).toEqual({ frames: [`${braille} `, " @"], rows: 1 });
  });

  it("uses one grid track per supplementary code point", () => {
    const result = encodeStaticGlyphHtml(`<span style="color:#ff0000">${braille}@</span> <span style="color:#0000ff">@</span>`, "grid");
    expect(result.css).toContain("grid-template-columns:repeat(4,1ch)");
    expect(result.html).toContain(`grid-area:1/1/auto/span 2">${braille}@`);
    expect(result.html).toContain("grid-area:1/4/auto/span 1");
  });
});
