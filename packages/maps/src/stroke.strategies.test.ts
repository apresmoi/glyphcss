import atlasManifest from "../../glyphcss/assets/glyph-atlas/atlas.json";
import { describe, expect, it } from "vitest";
import type { CellGrid } from "glyphcss";
import { createGlyphMapBoxStrokeGraph, finishGlyphMapBoxStrokeGraph, stampGlyphMapPolyline, type GlyphMapStrokeVertex, type GlyphMapStrokeGlyphStrategy } from "./stroke";
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

  it.each(strategies.filter(strategy => strategy !== "box"))("%s keeps exact coverage, colour, depth and onInk calls under occlusion", strategy => {
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

  it("box follows the cell path instead of closing a loop between nearby bends", () => {
    const g = grid();
    // A serpentine visits all four cells of a 2x2 block, but never closes it.
    stampGlyphMapPolyline(g, [
      { col: 2.2, row: 2.2, depth: 0 }, { col: 3.2, row: 2.2, depth: 0 },
      { col: 3.2, row: 3.2, depth: 0 }, { col: 2.2, row: 3.2, depth: 0 },
    ], { experimentalGlyphStrategy: "box" });
    expect([g.char[34], g.char[35], g.char[50], g.char[51]]).toEqual(["─", "┐", "─", "┘"]);
  });

  it("box collapses immediate backtracks before choosing corners", () => {
    const g = grid();
    stampGlyphMapPolyline(g, [
      { col: 2.2, row: 2.2, depth: 0 }, { col: 3.2, row: 2.2, depth: 0 },
      { col: 2.2, row: 2.2, depth: 0 }, { col: 2.2, row: 3.2, depth: 0 },
      { col: 3.2, row: 3.2, depth: 0 },
    ], { experimentalGlyphStrategy: "box" });
    expect(g.char[34]).toBe("│");
    expect(g.char[50]).toBe("└");
    expect(g.char[51]).toBe("─");
    // Coverage is retained, but an erased excursion has no joining arms.
    expect(g.char[35]).toBe("·");
  });

  it.each([[[1.2, 1.2], [12.2, 1.2]], [[1.2, 1.2], [8.2, 8.2]]])("box keeps a straight or diagonal stroke connected", (start, end) => {
    const g = grid();
    stampGlyphMapPolyline(g, [start, end].map(([col, row]) => ({ col, row, depth: 0 })), { experimentalGlyphStrategy: "box" });
    const inked = new Set(g.char.flatMap((c, i) => c === " " ? [] : [i]));
    const reached = new Set<number>();
    const todo = [Math.floor(start[1]) * g.cols + Math.floor(start[0])];
    while (todo.length) {
      const idx = todo.pop()!;
      if (reached.has(idx) || !inked.has(idx)) continue;
      reached.add(idx);
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const col = idx % g.cols + dx, row = Math.floor(idx / g.cols) + dy;
        if (col >= 0 && col < g.cols && row >= 0 && row < g.rows) todo.push(row * g.cols + col);
      }
    }
    expect(inked.size).toBeGreaterThan(5);
    expect(reached).toEqual(inked);
  });

  it("box joins two real crossing paths, without joining through a clipped break", () => {
    const g = grid();
    const separator = { col: NaN, row: NaN, depth: 0 };
    stampGlyphMapPolyline(g, [
      { col: 2.2, row: 2.2, depth: 0 }, { col: 6.2, row: 2.2, depth: 0 },
      separator,
      { col: 4.2, row: 1.2, depth: 0 }, { col: 4.2, row: 4.2, depth: 0 },
    ], { experimentalGlyphStrategy: "box" });
    expect(g.char[2 * 16 + 4]).toBe("┼");
    expect(g.char[2 * 16 + 3]).toBe("─");
    expect(g.char[3 * 16 + 4]).toBe("│");
    expect(g.char[3 * 16 + 5]).toBe(" ");
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

describe("layer-wide box graph", () => {
  const stamp = (g: CellGrid, points: number[][], graph = createGlyphMapBoxStrokeGraph()) => {
    stampGlyphMapPolyline(g, points.map(([col, row]) => ({ col: col! + 0.2, row: row! + 0.2, depth: 0 })), {
      experimentalGlyphStrategy: "box", color: "gold", depthCurvatureScale: 0, boxGraph: graph,
    });
    return graph;
  };

  it("joins separate arcs at a tee and a crossing, then closes a ring seam", () => {
    const g = grid();
    const graph = stamp(g, [[2, 2], [8, 2]]);
    stamp(g, [[5, 2], [5, 6]], graph);
    stamp(g, [[7, 1], [7, 4]], graph);
    finishGlyphMapBoxStrokeGraph(g, graph);
    expect(g.char[2 * 16 + 5]).toBe("┬");
    expect(g.char[2 * 16 + 7]).toBe("┼");
    const ring = grid();
    const loop = stamp(ring, [[2, 2], [6, 2], [6, 5], [2, 5], [2, 2]]);
    finishGlyphMapBoxStrokeGraph(ring, loop);
    expect(Array.from({ length: 4 }, (_, row) => ring.char.slice((row + 2) * 16 + 2, (row + 2) * 16 + 7).join(""))).toEqual([
      "┌───┐", "│   │", "│   │", "└───┘",
    ]);
  });

  it("makes a diagonal 4-connected with one corner per step and the line's colour/depth", () => {
    const g = grid();
    const graph = stamp(g, [[2, 2], [7, 7]]);
    finishGlyphMapBoxStrokeGraph(g, graph);
    const inked = new Set(g.char.flatMap((c, i) => c === " " ? [] : [i]));
    expect(inked.size).toBe(11);
    expect(g.char.join("")).not.toMatch(/[\/\\·]/);
    const reached = new Set<number>();
    const todo = [2 * 16 + 2];
    while (todo.length) {
      const idx = todo.pop()!;
      if (reached.has(idx) || !inked.has(idx)) continue;
      reached.add(idx);
      for (const next of [idx - 16, idx + 16, idx - 1, idx + 1]) todo.push(next);
    }
    expect(reached).toEqual(inked);
    for (const idx of inked) { expect(g.color[idx]).toBe("gold"); expect(g.depth[idx]).toBe(0); }
  });

  it("tries the other corner under depth/ownership occlusion and keeps a slash if both fail", () => {
    for (const mode of ["depth", "foreign", "surface"] as const) {
      const g = grid();
      if (mode === "surface") { g.depth.fill(0); g.depth[2 * 16 + 3] = -Infinity; }

      if (mode === "foreign") { g.occluded = new Uint8Array(160); g.occluded[2 * 16 + 3] = 1; }
      const graph = createGlyphMapBoxStrokeGraph();
      stampGlyphMapPolyline(g, [{ col: 2.2, row: 2.2, depth: 0 }, { col: 3.2, row: 3.2, depth: 0 }], {
        experimentalGlyphStrategy: "box", depthCurvatureScale: 0, requireSurface: mode === "surface", boxGraph: graph,
      });
      if (mode === "depth") g.depth[2 * 16 + 3] = 10;
      finishGlyphMapBoxStrokeGraph(g, graph);
      expect(g.char[2 * 16 + 3]).toBe(" ");
      expect(g.char[3 * 16 + 2]).toBe("└");
    }
    const blocked = grid();
    blocked.occluded = new Uint8Array(160);
    blocked.occluded[2 * 16 + 3] = blocked.occluded[3 * 16 + 2] = 1;
    const graph = stamp(blocked, [[2, 2], [3, 3]]);
    finishGlyphMapBoxStrokeGraph(blocked, graph);
    expect(blocked.char[2 * 16 + 2]).toBe("\\");
    expect(blocked.char[3 * 16 + 3]).toBe("\\");
    expect(blocked.char[2 * 16 + 3]).toBe(" ");
    expect(blocked.char[3 * 16 + 2]).toBe(" ");
  });

  it("does not inflate a sub-cell diagonal backtrack into a closed 2×2 loop", () => {
    const g = grid();
    const graph = stamp(g, [[2, 2], [3, 3], [2, 3], [2, 2], [2, 4]]);
    finishGlyphMapBoxStrokeGraph(g, graph);
    expect(g.char[2 * 16 + 3]).toBe(" ");
    expect(g.char[3 * 16 + 3]).toBe("·");
    expect(g.char[2 * 16 + 2]).toBe("│");
    expect(g.char[3 * 16 + 2]).toBe("│");
  });

  it("retains every baseline accepted cell, rejects foreign cells, and reports added ink", () => {
    const make = () => {
      const g = grid();
      g.char.fill("#"); g.color.fill("terrain");
      g.occluded = new Uint8Array(160);
      for (let row = 0; row < 10; row++) { g.depth[row * 16 + 7] = 10; g.occluded[row * 16 + 9] = 1; }
      return g;
    };
    const baseline = make(), box = make();
    const calls: number[] = [];
    stampGlyphMapPolyline(baseline, points, { color: "gold", depthCurvatureScale: 0 });
    stampGlyphMapPolyline(box, points, { color: "gold", experimentalGlyphStrategy: "box", depthCurvatureScale: 0, onInk: idx => calls.push(idx) });
    for (let i = 0; i < box.char.length; i++) {
      if (baseline.color[i] === "gold") { expect(box.color[i]).toBe("gold"); expect(box.depth[i]).toBe(baseline.depth[i]); }
      if (box.color[i] === "gold") expect(calls).toContain(i);
      else expect(box.char[i]).toBe("#");
      if (i % 16 === 7 || i % 16 === 9) expect(box.char[i]).toBe("#");
    }
    expect(box.color.filter(c => c === "gold").length).toBeGreaterThan(baseline.color.filter(c => c === "gold").length);
  });
});

it("box joins shared vertices even when repeated endpoint samples fail depth", () => {
  const g = grid(), graph = createGlyphMapBoxStrokeGraph();
  stampGlyphMapPolyline(g, [{ col: 2.2, row: 2.2, depth: 0 }, { col: 6.2, row: 2.2, depth: 4 }], { experimentalGlyphStrategy: "box", boxGraph: graph, depthCurvatureScale: 0 });
  stampGlyphMapPolyline(g, [{ col: 6.2, row: 2.2, depth: 4 }, { col: 6.2, row: 6.2, depth: 4 }], { experimentalGlyphStrategy: "box", boxGraph: graph, depthCurvatureScale: 0 });
  finishGlyphMapBoxStrokeGraph(g, graph);
  expect(g.char[2 * 16 + 6]).toBe("┐");
  expect(g.char[3 * 16 + 6]).toBe("│");
});

it.each([[8.2, 1.2], [8.2, 8.2]])("box keeps adjacent accepted cells connected across self-depth rejections (%s,%s)", (col, row) => {
  const g = grid(), graph = createGlyphMapBoxStrokeGraph();
  const baseline = grid();
  const line = [{ col: 1.2, row: 1.2, depth: 0 }, { col, row, depth: -1 }];
  const accepted: number[] = [];
  stampGlyphMapPolyline(baseline, line, { depthCurvatureScale: 0 });
  stampGlyphMapPolyline(g, line, { experimentalGlyphStrategy: "box", boxGraph: graph, depthCurvatureScale: 0,
    onInk: idx => { if (accepted.at(-1) !== idx) accepted.push(idx); },
  });
  expect(accepted.length).toBeGreaterThan(5);
  expect(graph.paths).toEqual([accepted]);
  // Connectivity must not change a sample's depth/coverage verdict.
  expect(g.depth).toEqual(baseline.depth);
  expect(g.char).toEqual(baseline.char);
  finishGlyphMapBoxStrokeGraph(g, graph);
  expect(accepted.map(idx => g.char[idx]).join("")).not.toContain("·");
});

it("box splits at genuinely missing cells without bridging an occluded gap", () => {
  const g = grid(), graph = createGlyphMapBoxStrokeGraph();
  g.depth[2 * 16 + 4] = 10;
  stampGlyphMapPolyline(g, [{ col: 2.2, row: 2.2, depth: 0 }, { col: 6.2, row: 2.2, depth: 0 }], {
    experimentalGlyphStrategy: "box", boxGraph: graph, depthCurvatureScale: 0,
  });
  expect(graph.paths).toEqual([[34, 35], [37, 38]]);
  finishGlyphMapBoxStrokeGraph(g, graph);
  expect(g.char.slice(34, 39).join("")).toBe("── ──");
});
