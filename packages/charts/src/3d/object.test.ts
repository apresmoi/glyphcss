import { describe, expect, it } from "vitest";
import { createGlyphOrthographicCamera, createGlyphScene, surfaceMedianOfBlock, createSurfaceMedianScratch } from "glyphcss";
import type { Polygon } from "glyphcss";
import { glyphChartObject } from "./object";
import { glyphChartSurface } from "./surface";
import { glyphChart3dBandColor, glyphChart3dBandIndex, resolveGlyphChart3dColorscaleAnchors } from "./colorscale";

function flatGrid(rows: number, cols: number, value = 0): number[][] {
  return Array.from({ length: rows }, () => Array.from({ length: cols }, () => value));
}

function surfaceMesh(mark: ReturnType<typeof glyphChartSurface>): Polygon[] {
  return glyphChartObject(mark).meshes[0]!.polygons;
}

describe("glyphChartObject — mesh shape", () => {
  it("returns a GlyphSceneObject with one 'surface' mesh, box+axis overlays, and object-space bounds", () => {
    const mark = glyphChartSurface({ z: [[0, 1], [2, 3]] });
    const object = glyphChartObject(mark);
    expect(object.id).toBe("surface");
    expect(object.meshes).toHaveLength(1);
    expect(object.meshes[0]!.name).toBe("surface");
    expect(object.overlays).toHaveLength(4); // box + 3 axes
    expect(object.bounds).toEqual({ min: [0, 0, 0], max: [1, 1, 0.6] });
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

    const [zLo, zHi] = mark.zDomain;
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
    const [zLo, zHi] = mark.zDomain;
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
    const mark = glyphChartSurface({ z }, undefined, { axes: { x: { title: "x" }, y: { title: "y" }, z: { title: "z" } } });
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
});
