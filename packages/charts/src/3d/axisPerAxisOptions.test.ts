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
import { glyphChart3dLabelAnchors, glyphChartObject } from "./object";
import { GLYPH_CHART_3D_DEFAULT_CAMERA } from "./camera";
import { renderGlyphChart3d } from "./render";

function flatGrid(rows: number, cols: number, value = 0): number[][] {
  return Array.from({ length: rows }, () => Array.from({ length: cols }, () => value));
}
/** See `object.test.ts`'s own doc on `CENTERED_TITLE` — this file's `render`/`renderWithGuides`-shaped helpers below use the identical hand-tuned fixed camera. */
const CENTERED_TITLE: { readonly titleAt: "center" } = { titleAt: "center" };
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
      axes: { x: { title: "x", ...CENTERED_TITLE }, y: { title: "y", ...CENTERED_TITLE }, z: { title: "z", ...CENTERED_TITLE }, ...axesOverride },
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
        axes: { x: { title: "x", ...CENTERED_TITLE }, y: { title: "y", ...CENTERED_TITLE }, z: { title: "z", ...CENTERED_TITLE }, ...axesOverride },
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

describe("axes.{x,y,z}.titleAt / titleOffset — P1-3 (user feedback: 'configure the position of the title of the axis')", () => {
  function titleAnchor(titleAt: "start" | "center" | "end" | undefined, titleOffset?: number): readonly [number, number, number] {
    const mark = glyphChartSurface({ z: [[0, 1], [2, 3]] }, undefined, {
      axes: { z: { title: "height", titleAt, titleOffset } },
    });
    const anchor = glyphChart3dLabelAnchors(mark).find((a) => a.text === "height");
    if (!anchor) throw new Error("title anchor not found");
    return anchor.point;
  }

  // C2 fix round 9 (USER FEEDBACK: "the label is too far from the axis...
  // they could be in the end"): the default flipped from 'center' to 'end',
  // and 'start'/'end' now extend PAST their own tip along the SAME axis
  // (`object.ts`'s `axisTitlePoint`) rather than sitting exactly at
  // `t = 0`/`t = 1`) — reverting either default (`axisTitlePoint`'s own
  // `axis.titleAt ?? "end"`, or `AXIS_TITLE_TIP_OFFSET`) turns these red.
  it("MUTATION: default titleAt is 'end' — byte-identical object-space anchor to an explicit 'end'", () => {
    const withDefault = titleAnchor(undefined);
    const withExplicitEnd = titleAnchor("end");
    expect(withDefault).toEqual(withExplicitEnd);
    // z's edge runs from object-space 0 to aspect[2] — the default now
    // pushes PAST the far end (aspect[2]), never sits at the midpoint.
    const mark = glyphChartSurface({ z: [[0, 1], [2, 3]] });
    expect(withDefault[2]).toBeGreaterThan(mark.aspect[2]);
    expect(withDefault[2]).not.toBeCloseTo(mark.aspect[2] / 2, 3);
  });

  it("MUTATION: titleAt 'start'/'center'/'end' each put the title at a measurably different anchor point", () => {
    const start = titleAnchor("start");
    const center = titleAnchor("center");
    const end = titleAnchor("end");
    expect(start).not.toEqual(center);
    expect(center).not.toEqual(end);
    expect(start).not.toEqual(end);
    // 'start' sits at the origin corner's own z coordinate (0, UNCHANGED
    // from before round 9 — see `axisTitlePoint`'s own doc for why 'start'
    // is not tightened/extended the way 'end' is); 'end' PAST the far end
    // (> aspect[2], round 9's own tip extension); 'center' at the exact
    // midpoint of the box's own z extent.
    const mark = glyphChartSurface({ z: [[0, 1], [2, 3]] });
    expect(start[2]).toBeCloseTo(0, 6);
    expect(end[2]).toBeGreaterThan(mark.aspect[2]);
    expect(center[2]).toBeCloseTo(mark.aspect[2] / 2, 6);
  });

  it("MUTATION: titleOffset moves the 'end' title ALONG its own axis, past the tip — never perpendicular", () => {
    const close = titleAnchor("end", 0.02);
    const far = titleAnchor("end", 0.5);
    const withDefault = titleAnchor("end");
    expect(close).not.toEqual(far);
    expect(close).not.toEqual(withDefault);
    // The z coordinate (position ALONG the edge, past the tip) is what
    // `titleOffset` moves for 'end' — the OTHER two axes (the fixed
    // perpendicular clearance, `AXIS_TITLE_PERP_MARGIN`) stay put.
    expect(close[2]).not.toBeCloseTo(far[2], 3);
    expect(close[0]).toBeCloseTo(far[0], 9);
    expect(close[1]).toBeCloseTo(far[1], 9);
  });

  it("titleOffset still moves 'center'/'start' the LEGACY (pre-round-9) way — perpendicular to their own axis, unchanged from before 'end' was tightened", () => {
    const close = titleAnchor("center", 0.1);
    const far = titleAnchor("center", 0.5);
    expect(close).not.toEqual(far);
    // The z coordinate (position ALONG the edge) is unaffected — only the
    // OTHER two axes (the perpendicular push) move, exactly as it always did.
    expect(close[2]).toBeCloseTo(far[2], 9);
    expect(close[0]).not.toBeCloseTo(far[0], 3);
  });

  it("every axis independently honours its own titleAt — x/y/z can each be positioned differently", () => {
    const mark = glyphChartSurface({ z: [[0, 1], [2, 3]] }, undefined, {
      axes: {
        x: { title: "x", titleAt: "start" },
        y: { title: "y", titleAt: "end" },
        z: { title: "z", titleAt: "center" },
      },
    });
    expect(mark.axes.x.titleAt).toBe("start");
    expect(mark.axes.y.titleAt).toBe("end");
    expect(mark.axes.z.titleAt).toBe("center");
    const anchors = glyphChart3dLabelAnchors(mark);
    const xPoint = anchors.find((a) => a.text === "x")!.point;
    const yPoint = anchors.find((a) => a.text === "y")!.point;
    // x's own edge coordinate (axis 0) sits at exactly 0 ('start', legacy
    // t=0 boundary); y's own edge coordinate (axis 1) sits PAST aspect[1]
    // ('end', round 9's own tip extension).
    expect(xPoint[0]).toBeCloseTo(0, 6);
    expect(yPoint[1]).toBeGreaterThan(mark.aspect[1]);
  });

  it("titleAt applies to the STAMPED overlay too, not only the fit's own anchor set — moving titleAt changes the rendered title's cell", () => {
    // Round 9: a FIXED, hand-tuned camera (the original form of this test)
    // is no longer a robust probe — "end" now pushes the title PAST its own
    // tip, so a camera tuned to the old, non-extended `t=1` boundary can
    // clip it regardless of zoom (measured: every zoom from 14 to 24 still
    // clipped "end" off this test's own 100x40 frame). `renderGlyphChart3d`'s
    // own auto-fit is what a real caller gets and is what this file's own
    // rotation sweep below already uses — reused here so the stamped-cell
    // check stays meaningful instead of chasing a manual camera's own
    // clipping.
    function stampedTitleCell(titleAt: "start" | "end"): { col: number; row: number } {
      const mark = glyphChartSurface({ z: bumpGrid() }, undefined, { axes: { z: { title: "height", titleAt } } });
      const result = renderGlyphChart3d(mark, { target: "web", color: "none", charset: "ascii", width: 100, height: 40, camera: { rotX: 60, rotY: 30 } });
      const idx = result.text.indexOf("height");
      expect(idx).toBeGreaterThanOrEqual(0);
      const lines = result.text.slice(0, idx).split("\n");
      return { row: lines.length - 1, col: lines[lines.length - 1]!.length };
    }

    const startCell = stampedTitleCell("start");
    const endCell = stampedTitleCell("end");
    expect(startCell).not.toEqual(endCell);
  });

  it("bad-axis-title-at: an unknown titleAt value rejects", () => {
    expect(() => glyphChartSurface({ z: [[0, 1], [2, 3]] }, undefined, { axes: { z: { titleAt: "top" as never } } }))
      .toThrowError(expect.objectContaining({ code: "bad-axis-title-at" }));
  });

  it("bad-options: a non-finite titleOffset rejects", () => {
    expect(() => glyphChartSurface({ z: [[0, 1], [2, 3]] }, undefined, { axes: { z: { titleOffset: Number.NaN } } }))
      .toThrowError(expect.objectContaining({ code: "bad-options" }));
  });

  // The camera fit's own closed-form anchor set (`fitStaticCamera`, reused
  // via `glyphChart3dLabelAnchors`) reads THIS mark's resolved titleAt, so
  // a title pushed to 'start'/'end' never clips off frame — mirrors
  // `render.test.ts`'s own rotation/size sweep, restricted to a couple of
  // representative rotations to keep this file's own runtime bounded.
  const ROTATIONS: readonly { readonly rotX: number; readonly rotY: number }[] = [
    { rotX: GLYPH_CHART_3D_DEFAULT_CAMERA.rotX, rotY: GLYPH_CHART_3D_DEFAULT_CAMERA.rotY },
    { rotX: 20, rotY: 10 },
    { rotX: 80, rotY: 160 },
  ];
  for (const titleAt of ["start", "center", "end"] as const) {
    for (const { rotX, rotY } of ROTATIONS) {
      it(`titleAt: "${titleAt}" at rotX:${rotX} rotY:${rotY} — at least 2 of 3 axis titles present`, () => {
        const mark = glyphChartSurface({ z: [[0, 1, 2], [3, 4, 5], [6, 7, 8]] }, undefined, {
          axes: {
            x: { title: "x (m)", titleAt }, y: { title: "y (m)", titleAt }, z: { title: "height", titleAt },
          },
          color: "none",
        });
        const result = renderGlyphChart3d(mark, { target: "web", color: "none", charset: "ascii", width: 96, height: 32, camera: { rotX, rotY } });
        // Mirrors `render.test.ts`'s own "at least 2 of 3" bound (its own
        // doc: a genuinely occluded/adversarial rotation can legitimately
        // drop ONE of three real, depth-tested titles — never a case where
        // it prints through the surface instead) — round 9's own tighter
        // `"end"` margin makes this MORE likely at an adversarial rotation
        // than the old `0.6`, not a new class of defect.
        const present = ["x (m)", "y (m)", "height"].filter((title) => result.text.includes(title)).length;
        expect(present).toBeGreaterThanOrEqual(2);
        // A label the fit could not seat at all is reported, never silently
        // truncated into a clipped fragment.
        expect(result.report.ledger.some((e) => e.code === "chart3d-label-unfittable")).toBe(false);
      });
    }
  }
});
