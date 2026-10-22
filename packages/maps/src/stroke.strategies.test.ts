import atlasManifest from "../../glyphcss/assets/glyph-atlas/atlas.json";
import { describe, expect, it } from "vitest";
import type { CellGrid } from "glyphcss";
import { stampGlyphMapPolyline, type GlyphMapStrokeVertex, type GlyphMapStrokeGlyphStrategy } from "./stroke";
import { createGlyphMap } from "./widget";
import { glyphMapEquirectangular } from "./projection";

function grid(): CellGrid {
  return {
    cols: 16, rows: 10,
    char: Array(160).fill(" "), color: Array(160).fill(null),
    depth: new Float64Array(160).fill(-Infinity),
    screenX: new Int32Array(160), screenY: new Int32Array(160),
  };
}
const points: GlyphMapStrokeVertex[] = [
  { col: 1.2, row: 1.1, depth: 0 }, { col: 11.8, row: 1.8, depth: 0 },
  { col: 11.8, row: 7.8, depth: 0 }, { col: 2.2, row: 4.3, depth: 0 },
];
const text = (g: CellGrid) => Array.from({ length: g.rows }, (_, r) => g.char.slice(r * g.cols, (r + 1) * g.cols).join("")).join("\n");
const strategies: GlyphMapStrokeGlyphStrategy[] = ["baseline", "ascii", "box", "dots", "bullets", "dashdot", "fine"];

describe("experimental map stroke glyphs", () => {
  it("pins the unmodified default's exact output", () => {
    const g = grid();
    stampGlyphMapPolyline(g, points, { color: "#e8c988" });
    expect(text(g)).toMatchInlineSnapshot(`
      "                
       ‾‾▔▔----__▕    
                 ▕    
                 ▕    
        ▔-       ▕    
          ▔-_    ▕    
             ▔-_ ▕    
                ‾_    
                      
                      "
    `);
  });

  it.each(strategies)("%s keeps exact coverage, colour, depth and onInk calls under occlusion", strategy => {
    const make = () => {
      const g = grid();
      g.char.fill("#");
      g.color.fill("#123456");
      for (let row = 0; row < g.rows; row++) g.depth[row * g.cols + 7] = 10;
      g.occluded = new Uint8Array(160);
      for (let row = 0; row < g.rows; row++) g.occluded[row * g.cols + 9] = 1;
      return g;
    };
    const original = make(), candidate = make();
    const before = [...candidate.depth];
    const originalCalls: unknown[] = [], candidateCalls: unknown[] = [];
    stampGlyphMapPolyline(original, points, { color: "#e8c988", onInk: (...args) => originalCalls.push(args) });
    stampGlyphMapPolyline(candidate, points, { color: "#e8c988", experimentalGlyphStrategy: strategy, onInk: (...args) => candidateCalls.push(args) });
    expect(candidate.color).toEqual(original.color);
    expect(candidate.depth).toEqual(original.depth);
    expect(candidateCalls).toEqual(originalCalls);
    expect(candidateCalls.length).toBeGreaterThan(10);
    expect(candidate.depth.some((d, i) => d !== before[i])).toBe(true);
    candidate.char.forEach((char, i) => {
      if (candidate.color[i] !== "#e8c988") expect(char).toBe("#");
    });
    if (strategy === "baseline") expect(candidate.char).toEqual(original.char);
    else expect(candidate.char).not.toEqual(original.char);
  });

  it.each(strategies)("%s never inks an absent required surface", strategy => {
    const g = grid();
    stampGlyphMapPolyline(g, points, { requireSurface: true, experimentalGlyphStrategy: strategy });
    expect(g.char.every(c => c === " ")).toBe(true);
    expect([...g.depth].every(d => d === -Infinity)).toBe(true);
  });

  it("box joins only accepted neighbours of this polyline, with no row wrapping or terrain joins", () => {
    const g = grid();
    g.char.fill("─");
    stampGlyphMapPolyline(g, [
      { col: 2.5, row: 2.5, depth: 0 }, { col: 6.5, row: 2.5, depth: 0 },
      { col: 6.5, row: 6.5, depth: 0 }, { col: 10.5, row: 6.5, depth: 0 },
    ], { experimentalGlyphStrategy: "box" });
    expect(g.char[2 * 16 + 6]).toBe("┐");
    expect(g.char[6 * 16 + 6]).toBe("└");
    expect(g.char[4 * 16 + 6]).toBe("│");
    expect(g.char[2 * 16 + 4]).toBe("─");
    const edge = grid();
    stampGlyphMapPolyline(edge, [{ col: 15.5, row: 1.5, depth: 0 }, { col: 0.5, row: 2.5, depth: 0 }], { experimentalGlyphStrategy: "box" });
    expect(["┌", "└", "├", "┼"]).not.toContain(edge.char[2 * 16]);
  });

  it("box ignores an occluded neighbouring cell", () => {
    const g = grid();
    g.depth[3 * 16 + 6] = 10;
    stampGlyphMapPolyline(g, [{ col: 2.5, row: 2.5, depth: 0 }, { col: 6.5, row: 2.5, depth: 0 }, { col: 6.5, row: 6.5, depth: 0 }], { experimentalGlyphStrategy: "box", depthCurvatureScale: 0 });
    expect(g.char[2 * 16 + 6]).toBe("─");
    expect(g.char[3 * 16 + 6]).toBe(" ");
  });

  it("every strategy's emitted glyphs fit the existing colour-font atlas", () => {
    const atlas = new Set(atlasManifest.glyphs);
    for (const strategy of strategies) {
      const g = grid();
      stampGlyphMapPolyline(g, points, { experimentalGlyphStrategy: strategy });
      for (const char of g.char) expect(char === " " || atlas.has(char)).toBe(true);
    }
  });

  it("the line layer passes the opt-in through to the real scene", async () => {
    const render = async (strategy?: GlyphMapStrokeGlyphStrategy) => {
      const host = document.createElement("div");
      document.body.appendChild(host);
      const map = createGlyphMap(host, {
        view: { center: [0, 0], span: 40, cols: 60, rows: 24 },
        projection: glyphMapEquirectangular(), tilt: 0,
        layers: [{ type: "line", source: { features: [{ rings: [[[-18, 0], [18, 0]]] }] }, experimentalGlyphStrategy: strategy }],
      });
      try { await map.idle(); return map.scene.output.textContent; }
      finally { map.destroy(); host.remove(); }
    };
    const baseline = await render();
    expect(await render("baseline")).toBe(baseline);
    const dots = await render("dots");
    expect(dots).not.toBe(baseline);
    expect(dots).toContain("····");
    expect(dots!.replaceAll("·", " ").trim()).toBe("");
  });
});
