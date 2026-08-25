// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { GLYPH_FONT_ATLAS, glyphAtlasCodePoint } from "glyphcss";
import { extractAsciiFromPre } from "./asciiClipboard";
import {
  buildGlyphSvg,
  glyphSvgFromPre,
  glyphSvgGridFromPre,
  glyphSvgRuns,
  measureGlyphSvgMetrics,
  type GlyphSvgMetrics,
  type SvgGrid,
} from "./glyphSvgExport";

const METRICS: GlyphSvgMetrics = { cellWidthPx: 8, cellHeightPx: 16, fontSizePx: 13, fontFamily: "Menlo, monospace" };

let atlasPaletteCounter = 0;

/** An atlas-encoded `<pre>` plus the `@font-palette-values` block a real scene injects beside it.
 *  Each call gets its own palette NAME — `document.head` isn't reset between tests in this file,
 *  so a shared name would let an earlier test's palette block shadow a later test's own colours. */
function atlasPre(cells: { glyph: string; slot: number }[][], palette: string[]): HTMLElement {
  const name = `--glyph-svg-atlas-palette-test-${atlasPaletteCounter++}`;
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

/** Parse the generated SVG string and pull out every `<text>`/`<rect>`, row-grouped by `y`. */
function parseSvg(svg: string) {
  const doc = new DOMParser().parseFromString(svg, "image/svg+xml");
  expect(doc.querySelectorAll("parsererror")).toHaveLength(0);
  const texts = Array.from(doc.querySelectorAll("text")).map((t) => ({
    x: Number(t.getAttribute("x")),
    y: Number(t.getAttribute("y")),
    text: t.textContent ?? "",
    textLength: Number(t.getAttribute("textLength")),
    fill: t.getAttribute("fill") ?? "",
  }));
  const rects = Array.from(doc.querySelectorAll("rect")).map((r) => ({
    x: Number(r.getAttribute("x")),
    y: Number(r.getAttribute("y")),
    width: Number(r.getAttribute("width")),
    height: Number(r.getAttribute("height")),
    fill: r.getAttribute("fill") ?? "",
  }));
  return { texts, rects, root: doc.documentElement };
}

/** Reconstruct the plain-text lines an SVG (built with known `cellWidthPx`) encodes,
 *  filling any gap between runs (dropped blank-space runs) with literal spaces —
 *  the numeric equivalent of "read the picture back as text". */
function reconstructText(svg: string, metrics: GlyphSvgMetrics, rows: number): string {
  const { texts } = parseSvg(svg);
  const lines: string[] = Array.from({ length: rows }, () => "");
  for (const t of texts) {
    const row = Math.round(t.y / metrics.cellHeightPx);
    const col = Math.round(t.x / metrics.cellWidthPx);
    const line = lines[row] ?? "";
    lines[row] = line.padEnd(col, " ") + t.text;
  }
  return lines.join("\n");
}

describe("glyphSvgGridFromPre", () => {
  it("returns null for a null pre", () => {
    expect(glyphSvgGridFromPre(null)).toBeNull();
  });

  it("returns null for an empty/whitespace-only pre", () => {
    const pre = document.createElement("pre");
    pre.textContent = "   \n   ";
    expect(glyphSvgGridFromPre(pre)).toBeNull();
  });

  it("walks a spans-encoded pre: colored spans plus bare (uncolored) text", () => {
    const pre = document.createElement("pre");
    pre.innerHTML = '<span style="color:#7df9ff">##</span>  \n<span style="color:#ff0055">%%</span>..';
    const grid = glyphSvgGridFromPre(pre)!;
    expect(grid).toHaveLength(2);
    expect(grid[0]).toEqual([
      { ch: "#", color: "#7df9ff", background: null },
      { ch: "#", color: "#7df9ff", background: null },
      { ch: " ", color: null, background: null },
      { ch: " ", color: null, background: null },
    ]);
    expect(grid[1]).toEqual([
      { ch: "%", color: "#ff0055", background: null },
      { ch: "%", color: "#ff0055", background: null },
      { ch: ".", color: null, background: null },
      { ch: ".", color: null, background: null },
    ]);
  });

  it("captures both fg and bg from a dual-color span (halfblock/quadrant)", () => {
    const pre = document.createElement("pre");
    pre.innerHTML = '<span style="color:#112233;background-color:#445566">▀▀</span>';
    const grid = glyphSvgGridFromPre(pre)!;
    expect(grid[0]).toEqual([
      { ch: "▀", color: "#112233", background: "#445566" },
      { ch: "▀", color: "#112233", background: "#445566" },
    ]);
  });

  it("decodes atlas-encoded output through glyphAtlasCellsFromPre, no spans in the DOM", () => {
    const A = GLYPH_FONT_ATLAS.glyphs[0]!;
    const B = GLYPH_FONT_ATLAS.glyphs[1]!;
    const pre = atlasPre([[{ glyph: A, slot: 0 }, { glyph: B, slot: 1 }]], ["#112233", "#445566"]);
    const grid = glyphSvgGridFromPre(pre)!;
    expect(grid).toEqual([[
      { ch: A, color: "#112233", background: null },
      { ch: B, color: "#445566", background: null },
    ]]);
  });
});

describe("glyphSvgRuns", () => {
  it("merges adjacent same-color cells into one run", () => {
    const grid: SvgGrid = [[
      { ch: "#", color: "#fff", background: null },
      { ch: "#", color: "#fff", background: null },
      { ch: "#", color: "#fff", background: null },
    ]];
    const runs = glyphSvgRuns(grid);
    expect(runs[0]).toEqual([{ row: 0, col: 0, text: "###", charCount: 3, color: "#fff", background: null }]);
  });

  it("splits a run on a color change", () => {
    const grid: SvgGrid = [[
      { ch: "#", color: "#fff", background: null },
      { ch: "%", color: "#000", background: null },
    ]];
    const runs = glyphSvgRuns(grid);
    expect(runs[0]).toHaveLength(2);
    expect(runs[0]![0]).toMatchObject({ col: 0, text: "#", color: "#fff" });
    expect(runs[0]![1]).toMatchObject({ col: 1, text: "%", color: "#000" });
  });

  it("drops trailing whitespace but keeps leading whitespace as the first run's col offset", () => {
    const grid: SvgGrid = [[
      { ch: " ", color: null, background: null },
      { ch: " ", color: null, background: null },
      { ch: "#", color: "#fff", background: null },
      { ch: " ", color: null, background: null },
      { ch: " ", color: null, background: null },
    ]];
    const runs = glyphSvgRuns(grid);
    // Leading run: two spaces at col 0; second run: "#" at col 2. Trailing spaces gone.
    expect(runs[0]).toEqual([
      { row: 0, col: 0, text: "  ", charCount: 2, color: null, background: null },
      { row: 0, col: 2, text: "#", charCount: 1, color: "#fff", background: null },
    ]);
  });

  it("never merges across a row boundary", () => {
    const grid: SvgGrid = [
      [{ ch: "#", color: "#fff", background: null }],
      [{ ch: "#", color: "#fff", background: null }],
    ];
    const runs = glyphSvgRuns(grid);
    expect(runs).toHaveLength(2);
    expect(runs[0]![0]!.row).toBe(0);
    expect(runs[1]![0]!.row).toBe(1);
  });
});

describe("buildGlyphSvg", () => {
  it("emits one <text> per non-blank run, matching the run count (not one per cell)", () => {
    const grid: SvgGrid = [[
      { ch: "#", color: "#7df9ff", background: null },
      { ch: "#", color: "#7df9ff", background: null },
      { ch: " ", color: null, background: null },
      { ch: "%", color: "#ff0055", background: null },
      { ch: "%", color: "#ff0055", background: null },
    ]];
    const svg = buildGlyphSvg(grid, METRICS);
    const { texts } = parseSvg(svg);
    // Two colour runs ("##" and "%%"); the trailing edge isn't whitespace here
    // (it ends in "%"), and the lone interior space is its own null-color run
    // that carries no visible content, so it is dropped — 2 elements, not 5.
    expect(texts).toHaveLength(2);
    expect(texts.map((t) => t.text)).toEqual(["##", "%%"]);
  });

  it("drops an all-space run at end of line but keeps a real uncolored glyph run", () => {
    const grid: SvgGrid = [[
      { ch: "x", color: null, background: null },
      { ch: "y", color: null, background: null },
      { ch: " ", color: null, background: null },
      { ch: " ", color: null, background: null },
    ]];
    const svg = buildGlyphSvg(grid, METRICS);
    const { texts } = parseSvg(svg);
    expect(texts).toHaveLength(1);
    expect(texts[0]!.text).toBe("xy");
    expect(texts[0]!.fill).toBe("currentColor");
  });

  it("gives every <text> a textLength, and Σ textLength per line equals lineChars × cellWidth", () => {
    const grid: SvgGrid = [[
      { ch: "a", color: "#111111", background: null },
      { ch: "b", color: "#111111", background: null },
      { ch: "c", color: "#222222", background: null },
      { ch: "d", color: "#222222", background: null },
      { ch: "e", color: "#222222", background: null },
    ]];
    const svg = buildGlyphSvg(grid, METRICS);
    const { texts } = parseSvg(svg);
    expect(texts.every((t) => Number.isFinite(t.textLength) && t.textLength > 0)).toBe(true);
    const total = texts.reduce((sum, t) => sum + t.textLength, 0);
    expect(total).toBeCloseTo(5 * METRICS.cellWidthPx, 5);
  });

  it("geometry (x / textLength) is unchanged across different font-family metrics", () => {
    const grid: SvgGrid = [[
      { ch: "#", color: "#7df9ff", background: null },
      { ch: "#", color: "#7df9ff", background: null },
      { ch: "%", color: "#ff0055", background: null },
    ]];
    const svgA = buildGlyphSvg(grid, { ...METRICS, fontFamily: "Menlo, monospace" });
    const svgB = buildGlyphSvg(grid, { ...METRICS, fontFamily: "Courier New, Consolas, monospace" });
    const a = parseSvg(svgA).texts.map(({ x, textLength }) => ({ x, textLength }));
    const b = parseSvg(svgB).texts.map(({ x, textLength }) => ({ x, textLength }));
    expect(a).toEqual(b);
  });

  it("emits a <rect> beneath the <text> for a two-tone (halfblock/quadrant) run", () => {
    const grid: SvgGrid = [[
      { ch: "▀", color: "#eeeeee", background: "#111111" },
      { ch: "▀", color: "#eeeeee", background: "#111111" },
    ]];
    const svg = buildGlyphSvg(grid, METRICS);
    const { texts, rects } = parseSvg(svg);
    expect(texts).toHaveLength(1);
    expect(rects).toHaveLength(1);
    expect(rects[0]).toMatchObject({ x: 0, y: 0, width: 2 * METRICS.cellWidthPx, height: METRICS.cellHeightPx, fill: "#111111" });
  });

  it("emits a background rect matching the stage background when provided", () => {
    const grid: SvgGrid = [[{ ch: "#", color: "#fff", background: null }]];
    const svg = buildGlyphSvg(grid, { ...METRICS, background: "#07090d" });
    expect(svg).toContain('<rect x="0" y="0" width="8" height="16" fill="#07090d"/>');
  });
});

describe("colorEncoding parity — spans vs atlas produce the same text and the same colours", () => {
  it("both encodings of the same pattern yield identical reconstructed text and run colours", () => {
    const A = GLYPH_FONT_ATLAS.glyphs[0]!;
    const B = GLYPH_FONT_ATLAS.glyphs[1]!;
    const PALETTE = ["#7df9ff", "#ff0055"];

    const preSpans = document.createElement("pre");
    preSpans.innerHTML = `<span style="color:${PALETTE[0]}">${A}${A}</span>  <span style="color:${PALETTE[1]}">${B}</span>`;

    // `atlasPre` only exists to inject the `@font-palette-values` block this
    // encoding needs to decode; the actual content is built by hand right
    // after so both pres describe the exact same "AA  B" pattern.
    const preAtlas = atlasPre([[{ glyph: A, slot: 0 }]], PALETTE);
    preAtlas.textContent =
      String.fromCodePoint(glyphAtlasCodePoint(A, 0)!) +
      String.fromCodePoint(glyphAtlasCodePoint(A, 0)!) +
      "  " +
      String.fromCodePoint(glyphAtlasCodePoint(B, 1)!);

    const gridSpans = glyphSvgGridFromPre(preSpans)!;
    const gridAtlas = glyphSvgGridFromPre(preAtlas)!;

    const svgSpans = buildGlyphSvg(gridSpans, METRICS);
    const svgAtlas = buildGlyphSvg(gridAtlas, METRICS);

    const textSpans = reconstructText(svgSpans, METRICS, 1);
    const textAtlas = reconstructText(svgAtlas, METRICS, 1);
    expect(textSpans).toBe(textAtlas);
    expect(textSpans).toBe(extractAsciiFromPre(preSpans));
    expect(textAtlas).toBe(extractAsciiFromPre(preAtlas));

    const colorsSpans = parseSvg(svgSpans).texts.map((t) => t.fill);
    const colorsAtlas = parseSvg(svgAtlas).texts.map((t) => t.fill);
    expect(colorsSpans).toEqual(colorsAtlas);
    expect(colorsSpans).toEqual([PALETTE[0], PALETTE[1]]);
  });
});

describe("measureGlyphSvgMetrics / glyphSvgFromPre", () => {
  it("measures cellWidth/cellHeight from the rendered bounding box divided by cols/rows", () => {
    const pre = document.createElement("pre");
    pre.textContent = "abc\ndef";
    Object.defineProperty(pre, "getBoundingClientRect", {
      value: () => ({ width: 30, height: 20, x: 0, y: 0, top: 0, left: 0, right: 30, bottom: 20 }),
    });
    const grid = glyphSvgGridFromPre(pre)!;
    const metrics = measureGlyphSvgMetrics(pre, grid);
    expect(metrics.cellWidthPx).toBeCloseTo(10, 5); // 30 / 3 cols
    expect(metrics.cellHeightPx).toBeCloseTo(10, 5); // 20 / 2 rows
  });

  it("falls back to font-size/line-height metrics when the pre has no real layout box", () => {
    const pre = document.createElement("pre");
    pre.style.fontSize = "13px";
    pre.style.lineHeight = "15px";
    pre.textContent = "ab";
    document.body.appendChild(pre);
    const grid = glyphSvgGridFromPre(pre)!;
    const metrics = measureGlyphSvgMetrics(pre, grid);
    expect(metrics.fontSizePx).toBe(13);
    expect(metrics.cellHeightPx).toBe(15);
    pre.remove();
  });

  it("returns null for a null / empty pre, mirroring extractAsciiFromPre", () => {
    expect(glyphSvgFromPre(null)).toBeNull();
    const pre = document.createElement("pre");
    pre.textContent = "   ";
    expect(glyphSvgFromPre(pre)).toBeNull();
  });

  it("produces a non-null, well-formed svg for a real render", () => {
    const pre = document.createElement("pre");
    pre.innerHTML = '<span style="color:#7df9ff">##</span>';
    document.body.appendChild(pre);
    const svg = glyphSvgFromPre(pre)!;
    expect(svg).not.toBeNull();
    expect(svg.startsWith("<svg")).toBe(true);
    expect(parseSvg(svg).texts).toHaveLength(1);
    pre.remove();
  });
});
