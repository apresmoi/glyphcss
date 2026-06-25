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

  it("stacks frameCount equal-size frames in one <pre> (cropped to content)", () => {
    const r = buildGlyphFramesExport(cube, { frameCount: 6, cols: 24, rows: 14, autoCenter: true });
    const inner = r.html.replace(/^[\s\S]*?<pre[^>]*>/, "").replace(/<\/pre>[\s\S]*$/, "");
    const lineCount = inner.split("\n").length;
    expect(lineCount % 6).toBe(0);          // equal-size frames
    expect(lineCount).toBeLessThan(6 * 14); // cropped below the rendered grid
    expect(lineCount).toBeGreaterThan(0);
  });

  it("dedupes colors across all frames (one class map)", () => {
    const r = buildGlyphFramesExport(cube, { frameCount: 12, cols: 30, rows: 12, autoCenter: true });
    // class refs exist; inline per-run color styles do not
    expect(r.html).toContain('class="c');
    expect(r.html).not.toContain('style="color:');
  });

  it("frame height = cropped rows × line-height", () => {
    const r = buildGlyphFramesExport(cube, { frameCount: 4, cols: 20, rows: 14, lineHeightPx: 20, autoCenter: true });
    const inner = r.html.replace(/^[\s\S]*?<pre[^>]*>/, "").replace(/<\/pre>[\s\S]*$/, "");
    const rowsPerFrame = inner.split("\n").length / 4;
    const m = r.pen.css.match(/\.glyph-roll\{height:(\d+)px/);
    expect(m).not.toBeNull();
    expect(Number(m![1])).toBe(rowsPerFrame * 20);
  });
});
