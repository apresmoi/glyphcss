// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { GLYPH_FONT_ATLAS, glyphAtlasCodePoint } from "glyphcss";
import { extractAsciiFromPre } from "./asciiClipboard";
import { buildGlyphAnsi, glyphAnsiFromPre } from "./glyphAnsiExport";
import { glyphExportGridFromPre, type GlyphExportGrid } from "./glyphExportGrid";

const ESCAPE_RE = /\x1b\[[0-9;]*m/g;
const RESET = "\x1b[0m";

/** Every ANSI escape sequence found in the output, in order. */
function escapesIn(ansi: string): string[] {
  return ansi.match(ESCAPE_RE) ?? [];
}

/** Strip every ANSI escape sequence, leaving only the visible characters. */
function stripAnsi(ansi: string): string {
  return ansi.replace(ESCAPE_RE, "");
}

let atlasPaletteCounter = 0;

/** Mirrors `glyphSvgExport.test.ts`'s own `atlasPre` helper: an atlas-encoded
 *  `<pre>` plus the `@font-palette-values` block a real scene injects beside it. */
function atlasPre(cells: { glyph: string; slot: number }[][], palette: string[]): HTMLElement {
  const name = `--glyph-ansi-atlas-palette-test-${atlasPaletteCounter++}`;
  const style = document.createElement("style");
  style.textContent = `@font-palette-values ${name}{font-family:"GlyphCssAtlas";override-colors:${palette
    .map((c, i) => `${i} ${c}`)
    .join(", ")};}`;
  document.head.appendChild(style);
  const pre = document.createElement("pre");
  pre.style.setProperty("font-palette", name);
  pre.textContent = cells
    .map((row) => row.map((c) => String.fromCodePoint(glyphAtlasCodePoint(c.glyph, c.slot)!)).join(""))
    .join("\n");
  return pre;
}

describe("buildGlyphAnsi", () => {
  it("emits one SGR escape per colour-state change, not one per cell, and ends the line reset", () => {
    // "##" (cyan) + " " (uncolored) + "%%" (red) — 3 runs, every one differs
    // from the state before it (default -> cyan -> default -> red), so this
    // is 3 transition escapes plus the unconditional end-of-line reset = 4.
    const grid: GlyphExportGrid = [[
      { ch: "#", color: "#7df9ff", background: null },
      { ch: "#", color: "#7df9ff", background: null },
      { ch: " ", color: null, background: null },
      { ch: "%", color: "#ff0055", background: null },
      { ch: "%", color: "#ff0055", background: null },
    ]];
    const ansi = buildGlyphAnsi(grid);
    const escapes = escapesIn(ansi);
    expect(escapes).toEqual([
      "\x1b[38;2;125;249;255m",
      RESET,
      "\x1b[38;2;255;0;85m",
      RESET,
    ]);
    expect(stripAnsi(ansi)).toBe("## %%");
  });

  it("emits ONE escape for a long same-colour run (escape count scales with runs, not cells)", () => {
    const cells = Array.from({ length: 60 }, () => ({ ch: "#", color: "#112233", background: null }));
    const grid: GlyphExportGrid = [cells];
    const ansi = buildGlyphAnsi(grid);
    const escapes = escapesIn(ansi);
    // One SGR to open the run's colour, one reset at end of line — 2 escapes
    // total regardless of the 60-cell run length, vs. 60 escapes a
    // per-cell implementation would emit.
    expect(escapes).toHaveLength(2);
    expect(escapes[0]).toBe("\x1b[38;2;17;34;51m");
    expect(escapes[1]).toBe(RESET);
    expect(stripAnsi(ansi)).toBe("#".repeat(60));
  });

  it("every non-blank output line ends with a reset, even a line with no colour at all", () => {
    const grid: GlyphExportGrid = [
      [{ ch: "x", color: "#fff", background: null }, { ch: "y", color: "#fff", background: null }],
      [{ ch: "z", color: null, background: null }],
    ];
    const ansi = buildGlyphAnsi(grid);
    const lines = ansi.split("\n");
    expect(lines).toHaveLength(2);
    for (const line of lines) expect(line.endsWith(RESET)).toBe(true);
  });

  it("a fully blank line emits no escapes and no reset", () => {
    const grid: GlyphExportGrid = [[{ ch: " ", color: null, background: null }]];
    const ansi = buildGlyphAnsi(grid);
    expect(ansi).toBe("");
  });

  it("drops a trailing uncoloured whitespace cell but preserves a trailing coloured background cell", () => {
    const grid: GlyphExportGrid = [[
      { ch: "x", color: "#fff", background: null },
      { ch: " ", color: null, background: null },
      { ch: " ", color: null, background: null },
    ]];
    expect(stripAnsi(buildGlyphAnsi(grid))).toBe("x");

    const gridBg: GlyphExportGrid = [[
      { ch: "x", color: "#fff", background: null },
      { ch: "▀", color: "#eee", background: "#111111" },
    ]];
    const ansiBg = buildGlyphAnsi(gridBg);
    expect(stripAnsi(ansiBg)).toBe("x▀");
    expect(ansiBg).toContain("48;2;17;17;17m");
  });

  it("emits a combined fg+bg SGR for a halfblock/quadrant two-tone run, one escape for the run", () => {
    const grid: GlyphExportGrid = [[
      { ch: "▀", color: "#eeeeee", background: "#111111" },
      { ch: "▀", color: "#eeeeee", background: "#111111" },
    ]];
    const ansi = buildGlyphAnsi(grid);
    const escapes = escapesIn(ansi);
    // One combined SGR for the two-cell run + one end-of-line reset.
    expect(escapes).toHaveLength(2);
    expect(escapes[0]).toBe("\x1b[38;2;238;238;238;48;2;17;17;17m");
    expect(stripAnsi(ansi)).toBe("▀▀");
  });
});

describe("colorEncoding parity — spans vs atlas produce identical text and colours", () => {
  it("both encodings of the same pattern yield identical stripped text and escape colours", () => {
    const A = GLYPH_FONT_ATLAS.glyphs[0]!;
    const B = GLYPH_FONT_ATLAS.glyphs[1]!;
    const PALETTE = ["#7df9ff", "#ff0055"];

    const preSpans = document.createElement("pre");
    preSpans.innerHTML = `<span style="color:${PALETTE[0]}">${A}${A}</span>  <span style="color:${PALETTE[1]}">${B}</span>`;

    const preAtlas = atlasPre([[{ glyph: A, slot: 0 }]], PALETTE);
    preAtlas.textContent =
      String.fromCodePoint(glyphAtlasCodePoint(A, 0)!) +
      String.fromCodePoint(glyphAtlasCodePoint(A, 0)!) +
      "  " +
      String.fromCodePoint(glyphAtlasCodePoint(B, 1)!);

    // Atlas output carries no <span>s at all — the whole point of routing
    // both exporters through the shared `glyphExportGridFromPre` decode
    // instead of walking <span> elements directly.
    expect(preAtlas.querySelectorAll("span")).toHaveLength(0);

    const ansiSpans = glyphAnsiFromPre(preSpans)!;
    const ansiAtlas = glyphAnsiFromPre(preAtlas)!;

    expect(stripAnsi(ansiSpans)).toBe(stripAnsi(ansiAtlas));
    expect(stripAnsi(ansiSpans)).toBe(extractAsciiFromPre(preSpans));
    expect(stripAnsi(ansiAtlas)).toBe(extractAsciiFromPre(preAtlas));

    expect(escapesIn(ansiSpans)).toEqual(escapesIn(ansiAtlas));
    expect(escapesIn(ansiSpans)).toContain("\x1b[38;2;125;249;255m");
    expect(escapesIn(ansiSpans)).toContain("\x1b[38;2;255;0;85m");
  });
});

describe("glyphAnsiFromPre", () => {
  it("returns null for a null / empty pre, mirroring extractAsciiFromPre / glyphSvgFromPre", () => {
    expect(glyphAnsiFromPre(null)).toBeNull();
    const pre = document.createElement("pre");
    pre.textContent = "   ";
    expect(glyphAnsiFromPre(pre)).toBeNull();
  });

  it("round-trips a real rendered pre: stripped ANSI text equals extractAsciiFromPre for the same render", () => {
    const pre = document.createElement("pre");
    pre.innerHTML = '<span style="color:#7df9ff">##</span>  \n<span style="color:#ff0055">%%</span>..';
    const ansi = glyphAnsiFromPre(pre)!;
    expect(stripAnsi(ansi)).toBe(extractAsciiFromPre(pre));
  });

  it("reads through glyphExportGridFromPre (the same shared decode glyphSvgExport.ts uses)", () => {
    const pre = document.createElement("pre");
    pre.innerHTML = '<span style="color:#112233">A</span>';
    const grid = glyphExportGridFromPre(pre);
    expect(buildGlyphAnsi(grid!)).toBe(glyphAnsiFromPre(pre));
  });
});
