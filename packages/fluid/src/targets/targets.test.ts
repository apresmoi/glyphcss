import { afterEach, describe, expect, it } from "vitest";
import { createGlyphOrthographicCamera, type Polygon } from "glyphcss";
import { createGlyphFluidTargetFrame } from "./frame";
import { glyphFluidCoverageFromAlpha, glyphFluidImageCells, mergeGlyphFluidCells } from "./raster";
import { GlyphFluidMeshTarget } from "./mesh";
import { GlyphFluidImageTarget } from "./image";
import { measureGlyphFluidZone, writeGlyphFluidZones } from "./zones";
import type { GlyphFluidLayout } from "./types";

const LAYOUT: GlyphFluidLayout = { cw: 10, ch: 16, originX: 0, originY: 0 };

/** An element whose client rect is fixed (happy-dom does no layout). */
function box(x: number, y: number, width: number, height: number): HTMLElement {
  const el = document.createElement("div");
  el.getBoundingClientRect = () => ({ left: x, top: y, right: x + width, bottom: y + height, width, height, x, y, toJSON() {} }) as DOMRect;
  document.body.append(el);
  return el;
}

afterEach(() => document.body.replaceChildren());

describe("raster helpers", () => {
  it("averages alpha per cell and lifts it ×1.35, clamped", () => {
    // 2 × 1 cells of 2 × 2 px at scale 1; left cell half covered, right fully
    const px = new Uint8ClampedArray(4 * 2 * 4);
    for (const [x, y] of [[0, 0], [0, 1], [2, 0], [3, 0], [2, 1], [3, 1]]) px[(y! * 4 + x!) * 4 + 3] = 255;
    const cov = glyphFluidCoverageFromAlpha(px, 4, 2, 2, 1, 2, 2, 1);
    expect(cov[0]).toBeCloseTo(0.675);
    expect(cov[1]).toBe(1);
  });

  it("image cells un-premultiply colour and keep coverage separate", () => {
    const px = new Uint8ClampedArray([255, 0, 0, 255, 0, 0, 255, 0]);
    const c = glyphFluidImageCells(px, 2, 1, 1, 1);
    expect(c.cov[0]).toBeCloseTo(0.5);
    expect([c.r[0], c.g[0], c.b[0]]).toEqual([1, 0, 0]);
  });

  it("max-merges inside the frame, skipping the border and weaker cells", () => {
    const f = createGlyphFluidTargetFrame(6, 6);
    f.T[2 * 6 + 2] = 0.9;
    mergeGlyphFluidCells(f, { i0: 0, j0: 0, w: 4, h: 4 }, 0, 0, new Float32Array(16).fill(0.5), 0.1, 0.2, 0.3);
    expect(f.T[0]).toBe(0); // border cell
    expect(f.T[1 * 6 + 1]).toBe(0.5);
    expect(f.TR[1 * 6 + 1]).toBeCloseTo(0.1);
    expect(f.T[2 * 6 + 2]).toBeCloseTo(0.9); // stronger target kept
    // r0 shifts content rows into frame rows
    const g = createGlyphFluidTargetFrame(6, 6);
    mergeGlyphFluidCells(g, { i0: 2, j0: 10, w: 1, h: 1 }, 8, 0, [1], 1, 1, 1);
    expect(g.T[2 * 6 + 2]).toBe(1);
  });
});

describe("feature ownership", () => {
  it("a stronger featureless target clears a weaker target's feature flag, in either order", () => {
    const box = { i0: 1, j0: 1, w: 1, h: 1 };
    const a = createGlyphFluidTargetFrame(3, 3);
    mergeGlyphFluidCells(a, box, 0, 0, [0.1], 1, 1, 1, [1]);
    mergeGlyphFluidCells(a, box, 0, 0, [1], 1, 1, 1);
    expect([a.T[4], a.TF[4]]).toEqual([1, 0]);
    const b = createGlyphFluidTargetFrame(3, 3);
    mergeGlyphFluidCells(b, box, 0, 0, [1], 1, 1, 1);
    mergeGlyphFluidCells(b, box, 0, 0, [0.1], 1, 1, 1, [1]);
    expect([b.T[4], b.TF[4]]).toEqual([1, 0]);
  });
});

describe("mesh target", () => {
  const quad = (color: string, z = 0, s = 1): Polygon => ({
    vertices: [[-s, -s, z], [s, -s, z], [s, s, z], [-s, s, z]], color,
  });

  it("rasterises polygons through compileScene into ink and colour inside its ellipse", () => {
    const camera = createGlyphOrthographicCamera({ rotX: 0, rotY: 0 });
    // luminance is auto-exposed over the covered range, so give it a darker patch to span
    const shade: Polygon = { vertices: [[0.6, 0.3, 0.1], [0.9, 0.3, 0.1], [0.9, 0.6, 0.1], [0.6, 0.6, 0.1]], color: "#401020" };
    const t = new GlyphFluidMeshTarget(box(100, 160, 200, 160), { polygons: () => [quad("#d04080"), shade], camera, extent: 3, swell: false });
    t.measure(LAYOUT);
    expect(t.box()).toEqual({ i0: 10, j0: 10, w: 20, h: 10 });
    t.update();
    const f = createGlyphFluidTargetFrame(40, 30);
    t.write(f, 0, 1);
    const centre = 15 * 40 + 20;
    expect(f.T[centre]).toBeGreaterThan(0.3);
    // albedo colour carried (shaded, so compare hue order not values)
    expect(f.TR[centre]!).toBeGreaterThan(f.TG[centre]!);
    // outside the inscribed ellipse: nothing
    expect(f.T[10 * 40 + 10]).toBe(0);
  });

  it("marks dark covered cells as features and honours features: false", () => {
    const camera = createGlyphOrthographicCamera({ rotX: 0, rotY: 0 });
    const make = (features: boolean) => {
      const t = new GlyphFluidMeshTarget(box(100, 160, 200, 160), {
        polygons: () => [quad("#f0f0f0", 0, 1), quad("#050505", 0.1, 0.25)], camera, extent: 3, features, swell: false,
      });
      t.measure(LAYOUT);
      t.update();
      const f = createGlyphFluidTargetFrame(40, 30);
      t.write(f, 0, 1);
      return f.TF.reduce((a, b) => a + b, 0);
    };
    expect(make(true)).toBeGreaterThan(0);
    expect(make(false)).toBe(0);
  });

  it("owns camera.zoom only when extent is set", () => {
    const camera = createGlyphOrthographicCamera({ zoom: 7 });
    new GlyphFluidMeshTarget(box(0, 0, 100, 100), { polygons: () => [], camera }).measure(LAYOUT);
    expect(camera.zoom).toBe(7);
    new GlyphFluidMeshTarget(box(0, 0, 100, 100), { polygons: () => [], camera, extent: 2 }).measure(LAYOUT);
    expect(camera.zoom).not.toBe(7);
  });
});

describe("image target", () => {
  it("takes raw ImageData over a content rect", () => {
    const img = { data: new Uint8ClampedArray(4 * 4 * 4).fill(255), width: 4, height: 4 } as ImageData;
    const t = new GlyphFluidImageTarget(img, { x: 20, y: 32, width: 40, height: 32 });
    t.measure(LAYOUT);
    expect(t.box()).toEqual({ i0: 2, j0: 2, w: 4, h: 2 });
    const f = createGlyphFluidTargetFrame(10, 10);
    t.write(f, 0);
    expect(f.T[2 * 10 + 3]).toBeCloseTo(1);
  });
});

describe("zones", () => {
  it("quiet dims inside with a half-way rim; pool deepens an ellipse; BGM resets each frame", () => {
    const f = createGlyphFluidTargetFrame(20, 20);
    const quiet = measureGlyphFluidZone({ el: box(50, 80, 50, 80), kind: "quiet" }, LAYOUT);
    writeGlyphFluidZones(f, [quiet], 0);
    expect(f.BGM[7 * 20 + 7]).toBeCloseTo(0.12);
    expect(f.BGM[4 * 20 + 7]).toBeCloseTo((1 + 0.12) / 2);
    expect(f.BGM[15 * 20 + 15]).toBe(1);
    const pool = measureGlyphFluidZone({ el: box(50, 80, 100, 160), kind: "pool" }, LAYOUT);
    writeGlyphFluidZones(f, [pool], 0);
    expect(f.BGM[7 * 20 + 7]).toBeGreaterThan(1);
    expect(f.BGM[10 * 20 + 10]).toBeCloseTo(3.2);
  });
});
