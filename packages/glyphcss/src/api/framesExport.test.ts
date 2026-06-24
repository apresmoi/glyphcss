import { describe, it, expect } from "vitest";
import { buildGlyphFramesExport } from "./framesExport";
import { cubePolygons } from "@glyphcss/core";

describe("buildGlyphFramesExport", () => {
  const cube = cubePolygons({ center: [0, 0, 0], size: 1 });

  it("bakes N frames into a zero-JS, CSS-animated roll", () => {
    const r = buildGlyphFramesExport(cube, { frameCount: 8, cols: 30, rows: 12, autoCenter: true });
    expect(r.frameCount).toBe(8);
    expect(r.pen.js).toBe("");
    expect(r.html).toContain('class="glyph-roll"');
    expect(r.pen.css).toContain("animation:glyph-roll");
    expect(r.pen.css).toContain("steps(8)");
    // ships no glyphcss runtime / mesh
    expect(r.html).not.toMatch(/esm\.sh|createGlyphScene|vertices/);
  });

  it("stacks exactly frameCount × rows lines in one <pre>", () => {
    const rows = 10;
    const r = buildGlyphFramesExport(cube, { frameCount: 6, cols: 24, rows, autoCenter: true });
    const inner = r.html.replace(/^[\s\S]*?<pre[^>]*>/, "").replace(/<\/pre>[\s\S]*$/, "");
    const lineCount = inner.split("\n").length;
    expect(lineCount).toBe(6 * rows);
  });

  it("dedupes colors across all frames (one class map)", () => {
    const r = buildGlyphFramesExport(cube, { frameCount: 12, cols: 30, rows: 12, autoCenter: true });
    // class refs exist; inline per-run color styles do not
    expect(r.html).toContain('class="c');
    expect(r.html).not.toContain('style="color:');
  });

  it("frame height follows the supplied line-height", () => {
    const r = buildGlyphFramesExport(cube, { frameCount: 4, cols: 20, rows: 10, lineHeightPx: 20, autoCenter: true });
    expect(r.pen.css).toContain("height:200px"); // 10 rows × 20px
  });
});
