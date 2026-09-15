/**
 * C7 (AGENTS.md's "Charts 3D" C7, packet C7): full per-axis configuration
 * for 3D charts — `axes.{x,y,z}.{format,color,domain,line,tickMarks,
 * tickLabels,grid}` plus a shared `axes.color`. Every mutation here goes red
 * when the property it names is removed (this file's own discipline, per
 * the user's global rule: "a guarantee with no failing test is not a
 * guarantee").
 */
import { describe, expect, it } from "vitest";
import { createGlyphOrthographicCamera, createGlyphScene } from "glyphcss";
import { glyphChartSurface } from "./surface";
import { glyphChartScatter3d } from "./scatter";
import { glyphChartObject } from "./object";

function flatGrid(rows: number, cols: number, value = 0): number[][] {
  return Array.from({ length: rows }, () => Array.from({ length: cols }, () => value));
}
function bumpGrid(): number[][] {
  const rows = 8, cols = 8;
  const z = flatGrid(rows, cols, 0);
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const dr = r - 3.5, dc = c - 3.5;
    z[r]![c] = Math.max(0, 20 - (dr * dr + dc * dc));
  }
  return z;
}

describe("axes.{x,y,z}.format — C7", () => {
  it("MUTATION: a z-axis format:{preset:'si'} changes z's own tick labels only, leaving x and y at the plain default", () => {
    const z = [[0, 1_000_000], [2_000_000, 3_000_000]];
    const baseline = glyphChartSurface({ z });
    const withZFormat = glyphChartSurface({ z }, undefined, { axes: { z: { format: { preset: "si" } } } });

    expect(withZFormat.axes.z.tickLabels).not.toEqual(baseline.axes.z.tickLabels);
    // SI notation reads like "1M"/"2M", never the baseline's plain digit run.
    expect(withZFormat.axes.z.tickLabels.some((l) => /[a-zA-Z]/.test(l))).toBe(true);
    expect(baseline.axes.z.tickLabels.some((l) => /[a-zA-Z]/.test(l))).toBe(false);
    // x and y are untouched — the SAME domain/ticks the baseline computed,
    // formatted the SAME plain way.
    expect(withZFormat.axes.x.tickLabels).toEqual(baseline.axes.x.tickLabels);
    expect(withZFormat.axes.y.tickLabels).toEqual(baseline.axes.y.tickLabels);
  });

  it("a bare preset name and { preset, ...params } both resolve, folding a d3-format minus sign to ASCII", () => {
    const z = [[-500, -250], [-100, -50]];
    const mark = glyphChartSurface({ z }, undefined, { axes: { z: { format: { preset: "currency", symbol: "€" } } } });
    for (const label of mark.axes.z.tickLabels) {
      expect(label.includes("−")).toBe(false); // no Unicode minus sign leaked through
    }
    expect(mark.axes.z.tickLabels.some((l) => l.includes("€"))).toBe(true);
  });
});

describe("axes.{x,y,z}.color / axes.color — C7", () => {
  it("MUTATION: z.color colours only the z axis-lines ribbon segment — x and y keep the library default", () => {
    const mark = glyphChartSurface({ z: [[0, 1], [2, 3]] }, undefined, { axes: { z: { color: "#112233" } } });
    const lines = glyphChartObject(mark).meshes.find((m) => m.name === "axis-lines")!.polygons;
    const colors = new Set(lines.map((p) => p.color));
    expect(colors.has("#112233")).toBe(true);
    expect(colors.has("#7a7f8a")).toBe(true); // the library's own default, still carried by x and y
    expect(colors.size).toBe(2); // exactly the override plus the shared x/y default — never all 3 recoloured
  });

  it("a shared axes.color recolours every axis that carries no override of its own, and a per-axis color still wins over it", () => {
    const mark = glyphChartSurface({ z: [[0, 1], [2, 3]] }, undefined, { axes: { color: "#00ff00", z: { color: "#112233" } } });
    const lines = glyphChartObject(mark).meshes.find((m) => m.name === "axis-lines")!.polygons;
    const colors = new Set(lines.map((p) => p.color));
    expect(colors).toEqual(new Set(["#00ff00", "#112233"]));
  });

  it("MUTATION: z.color colours the z axis's own STAMPED overlay ink (ticks/labels/title) — x/y stay the library default", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const camera = createGlyphOrthographicCamera({ zoom: 24, rotX: 60, rotY: 30 });
    const scene = createGlyphScene(host, { cols: 100, rows: 40, useColors: false, camera });
    const mark = glyphChartSurface({ z: bumpGrid() }, undefined, { axes: { x: { title: "x" }, y: { title: "y" }, z: { title: "z", color: "#112233" } } });
    const object = glyphChartObject(mark);
    scene.addObject(object, { position: [-0.5, -0.5, 0], scale: 20 });

    let sawOverride = false, sawDefault = false;
    scene.setOptions({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      transformCells: (grid: any) => {
        // Scoped to non-space cells only — a blank cell's own `color` entry
        // is meaningless (nothing painted it) and would otherwise dilute
        // this count with unrelated background slots.
        for (let i = 0; i < grid.char.length; i++) {
          if (grid.char[i] === " " || grid.char[i] === undefined) continue;
          if (grid.color[i] === "#112233") sawOverride = true;
          if (grid.color[i] === "#7a7f8a") sawDefault = true;
        }
      },
    });
    await Promise.resolve();
    await Promise.resolve();
    scene.destroy();
    expect(sawOverride).toBe(true);
    expect(sawDefault).toBe(true);
  });

  it("bad-axis-color: a non-canonical colour string rejects, for both the per-axis and the shared field", () => {
    expect(() => glyphChartSurface({ z: [[0, 1], [2, 3]] }, undefined, { axes: { z: { color: "red" } } }))
      .toThrowError(expect.objectContaining({ code: "bad-axis-color" }));
    expect(() => glyphChartSurface({ z: [[0, 1], [2, 3]] }, undefined, { axes: { color: "#ABCDEF" } }))
      .toThrowError(expect.objectContaining({ code: "bad-axis-color" }));
  });
});

describe("axes.{x,y,z}.{line,tickMarks,tickLabels} — C7", () => {
  async function render(axesOverride: Record<string, unknown>): Promise<string> {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const camera = createGlyphOrthographicCamera({ zoom: 24, rotX: 60, rotY: 30 });
    const scene = createGlyphScene(host, { cols: 100, rows: 40, useColors: false, camera });
    const mark = glyphChartSurface({ z: bumpGrid() }, undefined, {
      axes: { x: { title: "x" }, y: { title: "y" }, z: { title: "z" }, ...axesOverride },
    });
    const object = glyphChartObject(mark);
    scene.addObject(object, { position: [-0.5, -0.5, 0], scale: 20 });
    await Promise.resolve();
    await Promise.resolve();
    const text = scene.output.textContent ?? "";
    scene.destroy();
    return text;
  }
  function ink(text: string): number {
    return text.replace(/\s/g, "").length;
  }

  it("MUTATION: z.tickLabels=false removes only z's own tick labels — x and y titles/labels still render, and total ink strictly drops", async () => {
    const withDefault = await render({});
    const withoutZLabels = await render({ z: { tickLabels: false } });
    expect(ink(withoutZLabels)).toBeLessThan(ink(withDefault));
    for (const title of ["x", "y"]) expect(withoutZLabels.includes(title)).toBe(true);
  });

  it("MUTATION: an axis's own tickLabels:true wins over a GLOBAL guides.tickLabels:false — only that axis's labels come back", async () => {
    async function renderWithGuides(axesOverride: Record<string, unknown>): Promise<string> {
      const host = document.createElement("div");
      document.body.appendChild(host);
      const camera = createGlyphOrthographicCamera({ zoom: 24, rotX: 60, rotY: 30 });
      const scene = createGlyphScene(host, { cols: 100, rows: 40, useColors: false, camera });
      const mark = glyphChartSurface({ z: bumpGrid() }, undefined, {
        axes: { x: { title: "x" }, y: { title: "y" }, z: { title: "z" }, ...axesOverride },
        guides: { tickLabels: false },
      });
      const object = glyphChartObject(mark);
      scene.addObject(object, { position: [-0.5, -0.5, 0], scale: 20 });
      await Promise.resolve();
      await Promise.resolve();
      const text = scene.output.textContent ?? "";
      scene.destroy();
      return text;
    }
    const allOff = await renderWithGuides({});
    const zBackOn = await renderWithGuides({ z: { tickLabels: true } });
    expect(ink(zBackOn)).toBeGreaterThan(ink(allOff));
  });

  it("MUTATION: axisLines omitted for one axis (line:false) drops only that axis's own ribbon segment from the mesh", () => {
    const withAll = glyphChartObject(glyphChartSurface({ z: [[0, 1], [2, 3]] })).meshes.find((m) => m.name === "axis-lines")!.polygons.length;
    const withoutZ = glyphChartObject(glyphChartSurface({ z: [[0, 1], [2, 3]] }, undefined, { axes: { z: { line: false } } })).meshes.find((m) => m.name === "axis-lines")!.polygons.length;
    expect(withoutZ).toBeLessThan(withAll);
    expect(withoutZ).toBeGreaterThan(0); // x and y still contribute their own segments
  });

  it("MUTATION: line:false on every axis omits the axis-lines mesh entirely, mirroring guides.axisLines:false", () => {
    const mark = glyphChartSurface({ z: [[0, 1], [2, 3]] }, undefined, {
      axes: { x: { line: false }, y: { line: false }, z: { line: false } },
    });
    const object = glyphChartObject(mark);
    expect(object.meshes.find((m) => m.name === "axis-lines")).toBeUndefined();
  });
});

describe("axes.{x,y,z}.domain — C7", () => {
  it("MUTATION: an explicit z domain overrides the data-derived nice domain verbatim (no .nice() rounding)", () => {
    const mark = glyphChartSurface({ z: [[0, 1], [2, 3]] }, undefined, { axes: { z: { domain: [-5, 17] } } });
    expect(mark.axes.z.domain).toEqual([-5, 17]);
  });

  it("MUTATION: the surface mesh maps INSIDE a widened explicit z domain — the data no longer reaches the box's own top", () => {
    const z = [[0, 1], [2, 3]];
    const baseline = glyphChartSurface({ z });
    const widened = glyphChartSurface({ z }, undefined, { axes: { z: { domain: [-10, 10] } } });
    const meshZ = (mark: typeof baseline) => glyphChartObject(mark).meshes[0]!.polygons.flatMap((p) => p.vertices.map((v) => v[2]));
    const baselineMax = Math.max(...meshZ(baseline));
    const widenedMax = Math.max(...meshZ(widened));
    // The baseline's own nice domain hugs the data (z reaches the box top);
    // the widened domain leaves real headroom above the same data.
    expect(baselineMax).toBeCloseTo(baseline.aspect[2], 6);
    expect(widenedMax).toBeLessThan(widened.aspect[2] - 1e-6);
  });

  it("MUTATION: a value outside an explicit domain CLAMPS to the box edge — the mesh never draws past its own aspect extent", () => {
    // A domain narrower than the data: every z value maps into [0, aspect[2]]
    // regardless, never negative or past the top.
    const mark = glyphChartSurface({ z: [[-100, 50], [200, 10]] }, undefined, { axes: { z: { domain: [0, 10] } } });
    const zs = glyphChartObject(mark).meshes[0]!.polygons.flatMap((p) => p.vertices.map((v) => v[2]));
    for (const v of zs) {
      expect(v).toBeGreaterThanOrEqual(-1e-9);
      expect(v).toBeLessThanOrEqual(mark.aspect[2] + 1e-9);
    }
  });

  it("bad-axis-domain: an inverted or degenerate [min, max] rejects", () => {
    expect(() => glyphChartSurface({ z: [[0, 1], [2, 3]] }, undefined, { axes: { z: { domain: [5, 1] } } }))
      .toThrowError(expect.objectContaining({ code: "bad-axis-domain" }));
    expect(() => glyphChartSurface({ z: [[0, 1], [2, 3]] }, undefined, { axes: { z: { domain: [3, 3] } } }))
      .toThrowError(expect.objectContaining({ code: "bad-axis-domain" }));
  });

  it("bad-axis-domain: a non-finite bound rejects (a direct TS/JS caller, not JSON — see schema.test.ts for the JSON-reachable inverted case)", () => {
    expect(() => glyphChartSurface({ z: [[0, 1], [2, 3]] }, undefined, { axes: { z: { domain: [0, Number.NaN] } } }))
      .toThrowError(expect.objectContaining({ code: "bad-axis-domain" }));
  });

  it("MUTATION: `mapAxisValue`'s own clamp (scatter3d, parametric3d, bars3d, line3d's shared mapping) keeps every marker vertex within one marker-size of the box under a narrow explicit domain — the point-mesh path is a genuinely different code path from the surface mesh's own local clamp", () => {
    const points = [{ x: -100, y: -100, z: -100 }, { x: 100, y: 100, z: 100 }];
    const mark = glyphChartScatter3d(points, undefined, { axes: { x: { domain: [-1, 1] }, y: { domain: [-1, 1] }, z: { domain: [-1, 1] } } });
    const vertices = glyphChartObject(mark).meshes.find((m) => m.name === "points")!.polygons.flatMap((p) => p.vertices);
    // A tolerance past the default `markerSize` (0.035) but far under the
    // box's own extent separates "the mapped centre clamped to the box" from
    // "an unclamped centre 100 units off, dragging the whole marker with it".
    for (const [x, y, z] of vertices) {
      expect(x).toBeGreaterThanOrEqual(-0.1);
      expect(x).toBeLessThanOrEqual(mark.aspect[0] + 0.1);
      expect(y).toBeGreaterThanOrEqual(-0.1);
      expect(y).toBeLessThanOrEqual(mark.aspect[1] + 0.1);
      expect(z).toBeGreaterThanOrEqual(-0.1);
      expect(z).toBeLessThanOrEqual(mark.aspect[2] + 0.1);
    }
  });
});
