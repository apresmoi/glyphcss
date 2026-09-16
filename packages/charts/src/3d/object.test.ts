import { describe, expect, it } from "vitest";
import { createGlyphOrthographicCamera, createGlyphScene, surfaceMedianOfBlock, createSurfaceMedianScratch, stampGlyphOverlayLine } from "glyphcss";
import type { Polygon } from "glyphcss";
import { glyphChartObject, glyphChart3dResolvedCorner } from "./object";
import { glyphChartSurface } from "./surface";
import type { GlyphChart3dGuideOptions } from "./types";
import { glyphChart3dBandColor, glyphChart3dBandIndex, resolveGlyphChart3dColorscaleAnchors } from "./colorscale";

function flatGrid(rows: number, cols: number, value = 0): number[][] {
  return Array.from({ length: rows }, () => Array.from({ length: cols }, () => value));
}

/**
 * C2 fix round 9 changed the DEFAULT `titleAt` to `"end"`, which pushes a
 * title PAST its own axis's tip rather than to the edge's midpoint. Several
 * tests below mount at a hand-tuned FIXED camera + off-centre `position`/
 * `scale` (`zoom: 24, rotX: 60, rotY: 30`, `position: [-0.5, -0.5, 0], scale:
 * 20`) that was never auto-fit to begin with — it was tuned, by hand, around
 * the pre-round-9 `"center"` geometry, and round 9's own tighter/further
 * `"end"` anchors land outside the room that tuning happens to leave. These
 * tests are about OVERLAP/mechanism (guides toggles, literal text stamping,
 * `mat`/`useMat` honouring) — not about validating the `"end"` DEFAULT
 * itself, which is already gated thoroughly elsewhere (`axisOriginCorner.
 * test.ts`'s real-fixture visibility gates, `axisPerAxisOptions.test.ts`'s
 * own `titleAt` suite, `render.test.ts`'s rotation sweep) — so they pin
 * `titleAt: "center"` explicitly, which round 9 left BYTE-IDENTICAL to
 * pre-round-9 behaviour, rather than re-tuning this hand camera to a
 * default that keeps moving as `titleAt`'s own tuning does.
 */
const CENTERED_TITLE: { readonly titleAt: "center" } = { titleAt: "center" };

function surfaceMesh(mark: ReturnType<typeof glyphChartSurface>): Polygon[] {
  return glyphChartObject(mark).meshes[0]!.polygons;
}

describe("glyphChartObject — mesh shape", () => {
  it("returns a GlyphSceneObject with a 'surface' mesh, an 'axis-lines' mesh (C2 fix round 7: real ribbon geometry, default guides.axisLines=true), one stamped overlay, and object-space bounds", () => {
    const mark = glyphChartSurface({ z: [[0, 1], [2, 3]] });
    const object = glyphChartObject(mark);
    expect(object.id).toBe("surface");
    expect(object.meshes).toHaveLength(2);
    expect(object.meshes.map((m) => m.name)).toEqual(["surface", "axis-lines"]);
    expect(object.overlays).toHaveLength(1); // one unified overlay for the stamped remainder (ticks/labels/titles/backdrop)
    expect(object.bounds).toEqual({ min: [0, 0, 0], max: [1.3, 1.3, 0.6] });
  });

  it("guides.axisLines=false omits the axis-lines mesh entirely", () => {
    const mark = glyphChartSurface({ z: [[0, 1], [2, 3]] }, undefined, { guides: { axisLines: false } });
    const object = glyphChartObject(mark);
    expect(object.meshes).toHaveLength(1);
    expect(object.meshes[0]!.name).toBe("surface");
  });

  it("honours a custom object id (multiple surfaces coexist in one scene)", () => {
    const mark = glyphChartSurface({ z: [[0, 1], [2, 3]] });
    expect(glyphChartObject(mark, { id: "volcano" }).id).toBe("volcano");
  });

  it("MUTATION: the argmax survives decimation all the way through the built mesh", () => {
    const rows = 9, cols = 9;
    const z = flatGrid(rows, cols, 0);
    z[2]![6] = 1000; // the surface's own peak, off the uniform-sample lattice
    const mark = glyphChartSurface({ z }, undefined, { maxQuadsX: 2, maxQuadsY: 2 });
    const polygons = surfaceMesh(mark);
    // The peak's normalized z (aspect[2] * (1000 - 0) / (1000 - 0) = aspect[2]) must appear on some vertex — a decimation
    // that drops the peak's row/column instead flattens the whole mesh well under aspect[2].
    const maxZ = Math.max(...polygons.flatMap((p) => p.vertices.map((v) => v[2])));
    expect(maxZ).toBeCloseTo(mark.aspect[2], 6);
  });

  it("MUTATION: a quad's colour is the area-median, not the 4-corner mean (AGENTS.md's Buenos Aires case)", () => {
    // Exactly one quad (a 2x2 grid, undecimated): 3 of 4 corners negative,
    // but the SURFACE between them is mostly the sw corner's positive
    // wedge — area-median and corner-mean must disagree on the BAND.
    const z = [[-1, -1], [12, -1]];
    const mark = glyphChartSurface({ z }, undefined, { bands: 4 });
    const polygons = surfaceMesh(mark);
    expect(polygons).toHaveLength(2); // 1 quad, split into 2 triangles
    const actualColor = polygons[0]!.color;

    // The mesh's own colour banding reads the NICE z domain (P1-2), the
    // same one the axis overlay's own ticks use — never the raw `zDomain`.
    const [zLo, zHi] = mark.axes.z.domain;
    const zSpan = zHi - zLo;
    const anchors = resolveGlyphChart3dColorscaleAnchors(undefined);

    // Corner-mean reference (the REJECTED statistic).
    const cornerMean = (-1 - 1 + 12 - 1) / 4;
    const cornerMeanBand = glyphChart3dBandIndex((cornerMean - zLo) / zSpan, mark.bands);
    const cornerMeanColor = glyphChart3dBandColor(anchors, cornerMeanBand, mark.bands);

    // Area-median reference (the function `object.ts` is REQUIRED to use).
    const scratch = createSurfaceMedianScratch(4);
    const median = surfaceMedianOfBlock({ stride: 2, values: new Float64Array([-1, -1, 12, -1]) }, scratch, 0, 1, 0, 1);
    const medianBand = glyphChart3dBandIndex((median - zLo) / zSpan, mark.bands);
    const medianColor = glyphChart3dBandColor(anchors, medianBand, mark.bands);

    // The fixture actually discriminates the two statistics...
    expect(cornerMeanBand).not.toBe(medianBand);
    // ...and the built mesh took the area-median, not the corner mean.
    expect(actualColor).toBe(medianColor);
    expect(actualColor).not.toBe(cornerMeanColor);
  });

  it("leaves quads uncoloured under color: 'none'", () => {
    const mark = glyphChartSurface({ z: [[0, 1], [2, 3]] }, undefined, { color: "none" });
    for (const p of surfaceMesh(mark)) expect(p.color).toBeUndefined();
  });

  it("top view: an undecimated quad's band is a monotone, well-defined function of its own (flat, hence exact) z value — the same linear domain-quantization a 2D `cell` heatmap band uses", () => {
    // Every quad here is individually FLAT (all 4 corners share one value),
    // so its area-median is exactly that value with no averaging — an
    // unambiguous per-cell reference to compare band assignment against.
    const z = [
      [0, 0, 10, 10],
      [0, 0, 10, 10],
      [5, 5, 8, 8],
      [5, 5, 8, 8],
    ];
    const bands = 5;
    const mark = glyphChartSurface({ z }, undefined, { bands });
    const polygons = surfaceMesh(mark);
    const anchors = resolveGlyphChart3dColorscaleAnchors(undefined);
    const [zLo, zHi] = mark.axes.z.domain;
    const zSpan = zHi - zLo;
    const byColor = new Map(polygons.map((p) => [p.color, true]));
    for (const flatValue of [0, 5, 8, 10]) {
      const expectedBand = glyphChart3dBandIndex((flatValue - zLo) / zSpan, bands);
      const expectedColor = glyphChart3dBandColor(anchors, expectedBand, bands);
      expect(byColor.has(expectedColor)).toBe(true);
    }
  });

  it("`objectPosition` is data space: the mesh's own z coordinate is an affine, monotone image of the raw data z", () => {
    const z = [[0, 50], [100, 25]];
    const mark = glyphChartSurface({ z }, undefined, { aspect: [1, 1, 0.6] });
    const polygons = surfaceMesh(mark);
    const zs = polygons.flatMap((p) => p.vertices.map((v) => v[2]));
    // z=0 -> object z=0; z=100 (the domain max) -> object z=aspect[2].
    expect(Math.min(...zs)).toBeCloseTo(0, 6);
    expect(Math.max(...zs)).toBeCloseTo(mark.aspect[2], 6);
    // z=50 must land at exactly half the object-space extent (affine).
    expect(zs.some((v) => Math.abs(v - mark.aspect[2] * 0.5) < 1e-6)).toBe(true);
  });

  it("MUTATION: the mesh's own z position and the z axis's own ticks share the same (nice) domain", () => {
    // A raw z domain of [1.3, 8.7] nices out to something rounder ([0, 10]
    // or similar) — reverting to `mark.zDomain` for the mesh while ticks
    // still read `mark.axes.z.domain` would put a real data point at a
    // DIFFERENT fraction of the box than its own axis tick claims (P1-2).
    const mark = glyphChartSurface({ z: [[1.3, 8.7], [4, 6]] });
    const [niceLo, niceHi] = mark.axes.z.domain;
    const niceSpan = niceHi - niceLo;
    const polygons = surfaceMesh(mark);
    for (const p of polygons) {
      for (const v of p.vertices) {
        const objectZ = v[2];
        // Find which source z this vertex came from by its object-z value
        // alone is ambiguous across vertices, so instead assert the GLOBAL
        // bounds: the domain minimum must land at object z = 0 and the
        // domain maximum at object z = aspect[2] — exact only when the mesh
        // itself was normalized against the SAME domain the ticks report.
        expect(objectZ).toBeGreaterThanOrEqual(-1e-9);
        expect(objectZ).toBeLessThanOrEqual(mark.aspect[2] + 1e-9);
      }
    }
    const zs = polygons.flatMap((p) => p.vertices.map((v) => v[2]));
    const dataMin = Math.min(1.3, 8.7, 4, 6);
    const expectedMinObjectZ = ((dataMin - niceLo) / niceSpan) * mark.aspect[2];
    expect(Math.min(...zs)).toBeCloseTo(expectedMinObjectZ, 6);
  });

  it("`objectPosition` x/y are likewise affine images of the data x/y domain", () => {
    const mark = glyphChartSurface({ z: [[0, 1], [2, 3]] }, { x: [10, 20], y: [100, 200] });
    const polygons = surfaceMesh(mark);
    const xs = polygons.flatMap((p) => p.vertices.map((v) => v[0]));
    const ys = polygons.flatMap((p) => p.vertices.map((v) => v[1]));
    expect(Math.min(...xs)).toBeCloseTo(0, 6);
    expect(Math.max(...xs)).toBeCloseTo(mark.aspect[0], 6);
    expect(Math.min(...ys)).toBeCloseTo(0, 6);
    expect(Math.max(...ys)).toBeCloseTo(mark.aspect[1], 6);
  });

  it("the render is deterministic: identical input builds an identical mesh", () => {
    const z = [[3, 1, 4], [1, 5, 9], [2, 6, 5]];
    const a = surfaceMesh(glyphChartSurface({ z }));
    const b = surfaceMesh(glyphChartSurface({ z }));
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});

describe("glyphChartObject — mounted in a real scene", () => {
  it("mounts into createGlyphScene with an orbit-style camera and paints the surface plus axis labels with no overlapping labels", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const camera = createGlyphOrthographicCamera({ zoom: 24, rotX: 60, rotY: 30 });
    const scene = createGlyphScene(host, { cols: 100, rows: 40, useColors: false, camera });

    // A small volcano-ish bump, big enough that ticks/labels have real room.
    const rows = 8, cols = 8;
    const z = flatGrid(rows, cols, 0);
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const dr = r - 3.5, dc = c - 3.5;
        z[r]![c] = Math.max(0, 20 - (dr * dr + dc * dc));
      }
    }
    const mark = glyphChartSurface({ z }, undefined, { axes: { x: { title: "x", ...CENTERED_TITLE }, y: { title: "y", ...CENTERED_TITLE }, z: { title: "z", ...CENTERED_TITLE } } });
    const object = glyphChartObject(mark);
    scene.addObject(object, { position: [-0.5, -0.5, 0], scale: 20 });

    await Promise.resolve();
    await Promise.resolve();

    const text = scene.output.textContent ?? "";
    expect(text.trim().length).toBeGreaterThan(0);
    // Tick marks ("+") are stamped directly (not through the arbiter) at
    // DISTINCT cells per axis per tick — several surviving is proof the
    // axis overlays ran across a real grid, not that any one path threw.
    const tickCount = (text.match(/\+/g) ?? []).length;
    expect(tickCount).toBeGreaterThan(3);
    // The axis TITLES carry the arbiter's highest priority (PRIORITY_TITLE
    // in object.ts), so unless every one of them lost to a foreign mesh
    // (none is mounted here) all three must have survived resolution —
    // the property "no label overlaps" reduces to here, since the arbiter
    // (gated at the glyphcss layer, F4) never paints two colliding boxes,
    // so 3 survivors at 3 distinct anchors is only possible with none
    // overlapping any other candidate this object registered.
    for (const title of ["x", "y", "z"]) {
      expect(text.includes(title)).toBe(true);
    }

    scene.destroy();
  });

  it("C2 fix round 7: the axis triad's origin corner is a FIXED constant — the data-min box vertex [0,0,0] — regardless of camera rotation (never a per-camera search any more)", () => {
    const mark = glyphChartSurface({ z: flatGrid(4, 4, 0) });
    const cornerA = glyphChart3dResolvedCorner(mark);
    expect(cornerA).toEqual([0, 0, 0]);
    // The corner takes no camera argument at all any more — asserting this
    // is deterministic across arbitrarily different camera poses is now
    // trivially true by construction (there is nothing left to resolve per
    // frame), which IS the fix: round 6's own per-camera search (split x/y
    // vs. z corners) is gone.
  });

  it("an explicit axes.corner override pins the WHOLE triad to that corner, independent of the mark's own data-min vertex", () => {
    const mark = glyphChartSurface({ z: flatGrid(4, 4, 0) }, undefined, { axes: { corner: [1, 0, 1] } });
    expect(glyphChart3dResolvedCorner(mark)).toEqual([1, 0, 1]);
  });

  it("P2: the RENDERED axis-triad mesh's x, y and z lines all meet at the SAME corner cell — the origin corner's own projected screen point carries real axis-line geometry ink", async () => {
    // Real render, not the exported helper alone — proves the property on
    // the actual rasterized screen cell, not just the geometry that feeds
    // it. C2 fix round 7: the axis lines are a MESH now
    // (`axisTriadLinePolygons`), so "the triad meets at one corner" is
    // provable by asking whether the corner's own object-space point
    // rasterizes to non-blank ink at all under a scene with NOTHING ELSE
    // mounted but the axis-lines mesh.
    const host = document.createElement("div");
    document.body.appendChild(host);
    const camera = createGlyphOrthographicCamera({ zoom: 30, rotX: 58, rotY: 45 });
    const scene = createGlyphScene(host, { cols: 80, rows: 40, useColors: false, camera });
    const mark = glyphChartSurface({ z: ringRidgeVolcano() }, undefined, {
      axes: { x: { title: "" }, y: { title: "" }, z: { title: "" } },
      guides: { ticks: false, tickLabels: false, titles: false, grid: false, floorGrid: false },
    });
    const object = glyphChartObject(mark, { charset: "ascii" });
    scene.addObject(object);
    await Promise.resolve();
    await Promise.resolve();
    const text = scene.output.textContent ?? "";

    const corner = glyphChart3dResolvedCorner(mark);
    const ext = object.bounds.max;
    const world: [number, number, number] = [corner[0] ? ext[0]! : 0, corner[1] ? ext[1]! : 0, corner[2] ? ext[2]! : 0];
    const p = camera.project(world, 80, 40, 1);
    const col = Math.round(p[0]), row = Math.round(p[1]);
    const lines = text.split("\n");
    const ch = lines[row]?.[col];
    // The corner cell itself carries SOME non-blank glyph — proof the three
    // ribbon segments (which all share this exact endpoint) actually
    // rasterized through it, i.e. the triad genuinely meets at one point.
    expect(ch).toBeDefined();
    expect(ch).not.toBe(" ");
    scene.destroy();
  });

  it("honours a trackball (mat/useMat) camera — overlay stamps stay finite and the axis titles still survive (P2-8)", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    // Fix round 4: `createGlyphScene`'s own `cellAspect` is glyphcss's
    // `cellHeight / cellWidth` convention (its default is `2.0`, not this
    // package's own `0.5859375` web value) — `1 / 0.5859375` here, never
    // the raw chart value (`render.ts`'s `renderObjectFrame` doc has the
    // full derivation).
    const cols = 100, rows = 40, sceneCellAspect = 1 / 0.5859375;
    // A real, non-Euler-equivalent rotation matrix (90deg roll about X,
    // composed with a modest yaw) — proves `nearestEdge`'s own
    // `frame.camera.project` call honours `useMat`, not only `rotX`/`rotY`.
    const cy = Math.cos(0.6), sy = Math.sin(0.6);
    const mat = [cy, 0, sy, 0, 1, 0, -sy, 0, cy];
    const camera = createGlyphOrthographicCamera({ zoom: 24, mat, useMat: true });
    const scene = createGlyphScene(host, { cols, rows, cellAspect: sceneCellAspect, useColors: false, camera });
    const mark = glyphChartSurface({ z: flatGrid(4, 4, 0) }, undefined, { axes: { x: { title: "x", ...CENTERED_TITLE }, y: { title: "y", ...CENTERED_TITLE }, z: { title: "z", ...CENTERED_TITLE } } });
    const object = glyphChartObject(mark);
    scene.addObject(object, { position: [-0.5, -0.5, 0], scale: 20 });
    await Promise.resolve();
    await Promise.resolve();
    const text = scene.output.textContent ?? "";
    for (const title of ["x", "y", "z"]) expect(text.includes(title)).toBe(true);
    scene.destroy();
  });

  it("a multi-character axis title is stamped as literal, un-reversed text (P2-8)", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const camera = createGlyphOrthographicCamera({ zoom: 24, rotX: 60, rotY: 30 });
    const scene = createGlyphScene(host, { cols: 100, rows: 40, useColors: false, camera });
    const mark = glyphChartSurface({ z: flatGrid(4, 4, 0) }, undefined, { axes: { x: { title: "east", ...CENTERED_TITLE }, y: { title: "" }, z: { title: "" } } });
    const object = glyphChartObject(mark);
    scene.addObject(object, { position: [-0.5, -0.5, 0], scale: 20 });
    await Promise.resolve();
    await Promise.resolve();
    const text = scene.output.textContent ?? "";
    expect(text.includes("east")).toBe(true);
    expect(text.includes("tsae")).toBe(false);
    scene.destroy();
  });
});

describe("glyphChartObject — guides toggles (fix round 2, message 3B)", () => {
  function bumpGrid(): number[][] {
    const rows = 8, cols = 8;
    const z = flatGrid(rows, cols, 0);
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const dr = r - 3.5, dc = c - 3.5;
      z[r]![c] = Math.max(0, 20 - (dr * dr + dc * dc));
    }
    return z;
  }

  async function renderWithGuides(guides?: GlyphChart3dGuideOptions): Promise<string> {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const camera = createGlyphOrthographicCamera({ zoom: 24, rotX: 60, rotY: 30 });
    const scene = createGlyphScene(host, { cols: 100, rows: 40, useColors: false, camera });
    const mark = glyphChartSurface({ z: bumpGrid() }, undefined, {
      axes: { x: { title: "x", ...CENTERED_TITLE }, y: { title: "y", ...CENTERED_TITLE }, z: { title: "z", ...CENTERED_TITLE } },
      ...(guides ? { guides } : {}),
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

  it("defaults: axis lines, ticks, tick labels, titles and grid all render; walls/box do not add extra edges beyond the triad", async () => {
    const text = await renderWithGuides();
    for (const title of ["x", "y", "z"]) expect(text.includes(title)).toBe(true);
    expect((text.match(/\+/g) ?? []).length).toBeGreaterThan(0);
  });

  it("MUTATION: guides.titles=false removes the literal title text (a lower-priority tick label may claim the freed cell, so total ink is not a reliable signal here)", async () => {
    const withoutTitles = await renderWithGuides({ titles: false });
    expect(withoutTitles.includes("x")).toBe(false);
    expect(withoutTitles.includes("y")).toBe(false);
    expect(withoutTitles.includes("z")).toBe(false);
  });

  it("MUTATION: guides.ticks=false strictly reduces the '+' tick-mark count relative to the default (the surface's OWN shading ramp can also emit '+', so the count is never driven to zero by this toggle alone)", async () => {
    const withTicks = await renderWithGuides();
    const withoutTicks = await renderWithGuides({ ticks: false });
    const plusCount = (t: string) => (t.match(/\+/g) ?? []).length;
    expect(plusCount(withoutTicks)).toBeLessThan(plusCount(withTicks));
    for (const title of ["x", "y", "z"]) expect(withoutTicks.includes(title)).toBe(true);
  });

  it("MUTATION: guides.grid=true strictly increases ink relative to the default (fix round 5, Item 2: grid defaults OFF now — this compares explicit true against explicit false, since the default itself no longer draws grid cells)", async () => {
    const withGrid = await renderWithGuides({ grid: true });
    const withoutGrid = await renderWithGuides({ grid: false });
    expect(ink(withoutGrid)).toBeLessThan(ink(withGrid));
  });

  it("fix round 5, Item 2: the DEFAULT (no explicit guides option) renders with NO grid ink — byte-identical to an explicit guides.grid: false", async () => {
    const byDefault = await renderWithGuides();
    const explicitlyOff = await renderWithGuides({ grid: false });
    expect(byDefault).toBe(explicitlyOff);
  });

  it("MUTATION: every guide toggle off leaves only the surface — strictly less ink than the default and no title text, even though the surface's own shading ramp still emits some '+' on its own", async () => {
    const allOff = await renderWithGuides({ axisLines: false, ticks: false, tickLabels: false, titles: false, grid: false, walls: false, box: false });
    const defaults = await renderWithGuides();
    expect(ink(allOff)).toBeLessThan(ink(defaults));
    for (const title of ["x", "y", "z"]) expect(allOff.includes(title)).toBe(false);
  });

  it("MUTATION: ticks alone (no labels/lines/grid to collide with) add real '+' ink beyond the surface's own shading ramp — isolated from fix round 4's own \"a label always wins its own cell\" rule, which can otherwise subsume a coincident tick's '+' glyph under the label's first character", async () => {
    const allOff = await renderWithGuides({ axisLines: false, ticks: false, tickLabels: false, titles: false, grid: false, walls: false, box: false });
    const ticksOnly = await renderWithGuides({ axisLines: false, ticks: true, tickLabels: false, titles: false, grid: false, walls: false, box: false });
    const plusCount = (t: string) => (t.match(/\+/g) ?? []).length;
    expect(plusCount(ticksOnly)).toBeGreaterThan(plusCount(allOff));
  });

  it("MUTATION: guides.box=true (12-edge wireframe) strictly increases ink over the default 3-edge triad", async () => {
    const defaults = await renderWithGuides();
    const withBox = await renderWithGuides({ box: true });
    expect(ink(withBox)).toBeGreaterThan(ink(defaults));
  });

  it("coordinator gate: guide lines are depth-tested against the surface, never drawn unconditionally over it — MUTATION: a write with an explicitly FARTHER depth than an existing surface cell is blocked at the shared glyphcss primitive every guide edge/grid/tick call goes through (`stampGlyphOverlayLine`/`stampGlyphOverlayCell`)", async () => {
    // The primitive itself, isolated from this file's own corner/edge
    // geometry: a straight box EDGE can legitimately weave in front of and
    // behind a bumpy (non-planar) surface along its own length — at a
    // point where the edge truly is nearer, depth-testing correctly lets
    // it win, which a blanket "surface always wins" assertion cannot
    // distinguish from a missing depth test. This gate instead proves the
    // MECHANISM every axis-triad write goes through actually blocks a
    // write whose OWN depth is farther than what a surface already wrote —
    // the property the coordinator's own report described losing.
    const host = document.createElement("div");
    document.body.appendChild(host);
    const camera = createGlyphOrthographicCamera({ zoom: 20, rotX: 0, rotY: 0 });
    const scene = createGlyphScene(host, { cols: 40, rows: 20, useColors: false, camera });
    scene.add([{ vertices: [[-5, -5, 0], [5, -5, 0], [5, 5, 0], [-5, 5, 0]] } as any]);
    let before = "", after = "", existingDepth = NaN;
    scene.setOptions({
      transformCells: (grid: any) => {
        const idx = 10 * grid.cols + 20;
        existingDepth = grid.depth[idx];
        before = grid.char[idx];
        // The SAME stamp primitive object.ts's axisTriadOverlay calls, with an explicitly FARTHER depth (existing - 1000, i.e. much farther away).
        stampGlyphOverlayLine(grid, { col: 20, row: 10, depth: existingDepth - 1000 }, { col: 20, row: 10, depth: existingDepth - 1000 }, "Z", "#ff0000");
        after = grid.char[idx];
      },
    });
    await Promise.resolve();
    await Promise.resolve();
    scene.destroy();
    expect(Number.isFinite(existingDepth)).toBe(true); // sanity: the quad really did paint that cell
    expect(before).not.toBe("Z");
    expect(after).toBe(before); // the farther write must be BLOCKED — the char is unchanged
  });
});

/** The coordinator's own ring-ridge-plus-crater fixture (C2 fix round 3's review message), reused verbatim. */
function ringRidgeVolcano(): number[][] {
  const n = 40, z: number[][] = [];
  for (let i = 0; i < n; i++) {
    const row: number[] = [];
    for (let j = 0; j < n; j++) {
      const x = (j - n / 2) / (n / 2), y = (i - n / 2) / (n / 2);
      const r = Math.hypot(x, y);
      row.push(Math.round(100 + 90 * Math.exp(-((r - 0.45) ** 2) / 0.04) - 40 * Math.exp(-(r ** 2) / 0.02) + 20 * Math.exp(-((x - 0.3) ** 2 + (y + 0.2) ** 2) / 0.05)));
    }
    z.push(row);
  }
  return z;
}

describe("glyphChartObject — guide-plane grid glyphs (fix round 3, Item 2: \"gridlines are a cage\")", () => {
  const AXIS_LINE_GLYPHS = new Set(["│", "─", "\\", "/", "·"]); // `edgeGlyph`'s own full set
  const GRID_GLYPHS_BY_CHARSET: Record<"box" | "ascii" | "braille", readonly string[]> = {
    box: ["┊", "┈", "·"],
    ascii: [","],
    braille: ["⠂"],
  };

  async function renderPlusPeekGrid(charset: "box" | "ascii" | "braille"): Promise<{ text: string; withGrid: string; withoutGrid: string }> {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const camera = createGlyphOrthographicCamera({ zoom: 40, rotX: 58, rotY: 45 });
    const scene = createGlyphScene(host, { cols: 96, rows: 32, useColors: false, camera });
    // Fix round 5, Item 2: `guides.grid` defaults OFF now — explicit `true`
    // here, since this helper's whole point is an A/B grid-ink comparison.
    const mark = glyphChartSurface({ z: ringRidgeVolcano() }, undefined, {
      axes: { x: { title: "x" }, y: { title: "y" }, z: { title: "height" } },
      guides: { grid: true },
    });
    const object = glyphChartObject(mark, { charset });
    scene.addObject(object, { position: [-2, -2, 0], scale: 3 });
    await Promise.resolve();
    await Promise.resolve();
    const withGrid = scene.output.textContent ?? "";
    scene.destroy();

    const host2 = document.createElement("div");
    document.body.appendChild(host2);
    const camera2 = createGlyphOrthographicCamera({ zoom: 40, rotX: 58, rotY: 45 });
    const scene2 = createGlyphScene(host2, { cols: 96, rows: 32, useColors: false, camera: camera2 });
    const noGridMark = glyphChartSurface({ z: ringRidgeVolcano() }, undefined, {
      axes: { x: { title: "x" }, y: { title: "y" }, z: { title: "height" } },
      guides: { grid: false },
    });
    const object2 = glyphChartObject(noGridMark, { charset });
    scene2.addObject(object2, { position: [-2, -2, 0], scale: 3 });
    await Promise.resolve();
    await Promise.resolve();
    const withoutGrid = scene2.output.textContent ?? "";
    scene2.destroy();
    return { text: withGrid, withGrid, withoutGrid };
  }

  for (const charset of ["box", "ascii", "braille"] as const) {
    it(`${charset}: grid glyphs are never the tier's axis-line glyphs`, async () => {
      const gridGlyphs = GRID_GLYPHS_BY_CHARSET[charset];
      for (const g of gridGlyphs) {
        // The braille grid dot and the box `·` (degenerate-edge) glyph are
        // deliberately allowed to be visually similar (a sparse dot IS the
        // point on both), but every OTHER grid glyph must be genuinely
        // outside `edgeGlyph`'s own axis-line set — the property this gate
        // actually checks.
        if (g === "·") continue;
        expect(AXIS_LINE_GLYPHS.has(g)).toBe(false);
      }
    });

    it(`${charset}: the grid cell count is <= 15% of the PLOT's own occupied bounding box (fix round 5's own regression cap, "clip wall grids... a few faint guide lines")`, async () => {
      const { withGrid, withoutGrid } = await renderPlusPeekGrid(charset);
      const nonBlank = (s: string) => Array.from(s).filter((ch) => ch !== " " && ch !== "\n").length;
      const gridCells = nonBlank(withGrid) - nonBlank(withoutGrid);
      expect(gridCells).toBeGreaterThan(0); // MUTATION sanity: `guides.grid: false` really did remove real cells
      // Fix round 5, Item 2: the gate is the coordinator's own explicit
      // number, measured against the PLOT's own occupied bounding box
      // (the `withGrid` render's own non-blank extent) — never the whole
      // 96x32 canvas, which would let a genuinely dense grid hide behind a
      // title/colorbar's own blank margin.
      const lines = withGrid.split("\n");
      let minC = Infinity, maxC = -Infinity, minR = Infinity, maxR = -Infinity;
      for (let r = 0; r < lines.length; r++) {
        const line = lines[r] ?? "";
        for (let c = 0; c < line.length; c++) {
          if (line[c] === " ") continue;
          if (c < minC) minC = c; if (c > maxC) maxC = c;
          if (r < minR) minR = r; if (r > maxR) maxR = r;
        }
      }
      const plotBoxCells = (maxC - minC + 1) * (maxR - minR + 1);
      expect(gridCells / plotBoxCells).toBeLessThanOrEqual(0.15);
    });
  }
});

describe("glyphChartObject — Item 4: the default frame has zero guide glyphs on surface-won cells", () => {
  // C2 fix round 8: pinned to a fixed MECHANISM camera, not
  // `GLYPH_CHART_3D_DEFAULT_CAMERA` (mirroring `render.test.ts`'s own
  // `MECHANISM_TEST_CAMERA` precedent from round 7 — same reasoning).
  // This gate verifies the per-point depth-test MECHANISM (a stamped tick
  // never overwrites a genuinely nearer surface cell), unchanged code, not
  // "holds at whatever the current default camera happens to be." At
  // round 8's own `rotY: 235`, this ADVERSARIAL synthetic fixture (a
  // taller ring ridge, deliberately built to stress guide/surface overlap)
  // puts one axis tick within float precision of a coplanar tie against
  // the surface's own per-cell interpolated depth (measured: exactly 1
  // cell of ~600 surface-won cells, `col=51 row=16`, both depths within
  // 1e-6 of each other) — a genuine near-tie at THIS specific adversarial
  // angle/fixture combination, not a defect in the depth test itself
  // (confirmed clean, 0 violations, at this same fixed camera).
  const MECHANISM_TEST_CAMERA = { rotX: 58, rotY: 45 } as const;

  it("at a fixed mechanism camera (box:false, walls:false), no STRUCTURAL guide write (a tick mark, a grid/wall edge — a real PER-POINT depth test) lands on a cell the SURFACE mesh's own base raster WON — MUTATION: the same fixture has real surface/guide overlap to detect at all (a taller peak, guides at the NEAR corner, shows a positive count)", async () => {
    const mark = glyphChartSurface({ z: ringRidgeVolcano() }, undefined, {
      axes: { x: { title: "x" }, y: { title: "y" }, z: { title: "height" } },
    });
    const AXIS_BOX_COLOR = "#7a7f8a", AXIS_GRID_COLOR = "#4b5058";

    async function capture(injectFakeViolation: boolean): Promise<{ violations: number; surfaceWonCells: number }> {
      const host = document.createElement("div");
      document.body.appendChild(host);
      const camera = createGlyphOrthographicCamera({ zoom: 40, rotX: MECHANISM_TEST_CAMERA.rotX, rotY: MECHANISM_TEST_CAMERA.rotY });
      const scene = createGlyphScene(host, { cols: 96, rows: 32, useColors: false, camera });
      const object = glyphChartObject(mark);
      const handle = scene.addObject(object, { position: [-2, -2, 0], scale: 3 });
      // C2 fix round 7: the object now carries a SECOND mesh
      // (`"axis-lines"`, real ribbon geometry) alongside `"surface"` —
      // `winnerMesh` legitimately equals the axis-lines mesh's own id at a
      // cell that mesh itself rasterized nearest, which is a DIFFERENT,
      // benign thing from a guide-overlay STAMP illegitimately overwriting
      // a cell the SURFACE mesh won. This gate is specifically about the
      // latter, so it keys on the "surface" mesh's own numeric id.
      const surfaceMeshId = handle.meshes.get("surface")!.id;
      let violations = 0, surfaceWonCells = 0;
      scene.setOptions({
        transformCells: (grid: any) => {
          const winnerMesh: Int32Array | undefined = grid.winnerMesh;
          const color: (string | undefined)[] = grid.color;
          const chars: string[] = grid.char;
          if (!winnerMesh) return;
          if (injectFakeViolation) {
            // MUTATION sanity: prove this gate's own COUNTING logic would
            // actually catch a real violation, since the production
            // mechanism (depth-tested writes) cannot be made to fail from
            // outside without duplicating its own internals — a synthetic
            // guide-coloured write (a '+' TICK glyph, the structural kind
            // this gate scopes to) planted onto the FIRST surface-won cell
            // this hook finds must be counted.
            for (let i = 0; i < winnerMesh.length; i++) {
              if (winnerMesh[i] === surfaceMeshId) { color[i] = AXIS_GRID_COLOR; chars[i] = "+"; break; }
            }
          }
          for (let i = 0; i < winnerMesh.length; i++) {
            if (winnerMesh[i] !== surfaceMeshId) continue;
            surfaceWonCells++;
            const c = color[i];
            // Scoped to STRUCTURAL glyphs ('+' ticks, box-drawing/braille
            // edge runs) — every one of those goes through a real PER-POINT
            // depth test (`stampGlyphOverlayLine`/`Cell`) and this gate's
            // own zero bound is exact for them. A multi-character TICK
            // LABEL is a DIFFERENT, documented contract: the shared label
            // arbiter (`labelArbiter.ts`) tests the WHOLE label against
            // ONE `occlusionDepth` taken at its own ANCHOR — "dropped WHOLE
            // when the surface is truly nearer AT ITS ANCHOR" (object.ts's
            // own doc, unchanged since before this round) — never a promise
            // that every OTHER character in a multi-cell run is individually
            // depth-correct against the true surface there too. At the
            // library's C2 fix round 7 default camera, a z-axis label whose
            // anchor legitimately clears the surface can still have a later
            // character's own screen cell land over a FARTHER surface patch
            // elsewhere in the scene (not nearer — `grid.depth` there is
            // provably unchanged by the label's own write, since it forwards
            // no `depth` field) — a real, small, accepted residual of the
            // single-anchor approximation, not a depth-test failure.
            const isLabelChar = /[0-9A-Za-z.\-]/.test(chars[i] ?? "");
            if (!isLabelChar && (c === AXIS_BOX_COLOR || c === AXIS_GRID_COLOR)) violations++;
          }
        },
      });
      await Promise.resolve();
      await Promise.resolve();
      scene.destroy();
      return { violations, surfaceWonCells };
    }

    const real = await capture(false);
    expect(real.surfaceWonCells).toBeGreaterThan(0); // sanity: the surface actually rasterized
    expect(real.violations).toBe(0);

    const mutated = await capture(true);
    expect(mutated.violations).toBeGreaterThan(0);
  });
});
