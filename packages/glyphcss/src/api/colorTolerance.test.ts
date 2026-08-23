import { describe, it, expect } from "vitest";
import { buildRasterizeContext } from "./rasterizeContext";
import { createGlyphScene } from "./createGlyphScene";
import { createGlyphOrthographicCamera } from "./createGlyphCamera";

/**
 * COLOR-TOLERANCE.md Phase 3 — public-layer validation.
 *
 * "Validate here, not in the hot encoder": `NaN` and negative values degrade
 * to `0` (off), `+Infinity` is honored as-is (merges every same-glyph run in
 * a row). This is deliberately tested at BOTH layers that store a
 * `colorTolerance` before a render:
 *   - `buildRasterizeContext` (the single funnel both `createGlyphScene` and
 *     `compileScene` pass through)
 *   - `createGlyphScene`'s own `options` (read directly by the
 *     retained-effect-layer `encodeCellGrid` path, which never calls
 *     `buildRasterizeContext`)
 * so a mutation that normalizes at only one of them is still caught.
 */
describe("buildRasterizeContext — colorTolerance validation", () => {
  const baseOpts = {
    camera: createGlyphOrthographicCamera(),
    grid: { cols: 4, rows: 4, cellAspect: 2.0 },
    mode: "wireframe" as const,
  };

  it("defaults to 0 when omitted", () => {
    expect(buildRasterizeContext(baseOpts).colorTolerance).toBe(0);
  });

  it("passes a positive finite value through unchanged", () => {
    expect(buildRasterizeContext({ ...baseOpts, colorTolerance: 42 }).colorTolerance).toBe(42);
  });

  it("degrades NaN to 0", () => {
    expect(buildRasterizeContext({ ...baseOpts, colorTolerance: NaN }).colorTolerance).toBe(0);
  });

  it("degrades a negative value to 0", () => {
    expect(buildRasterizeContext({ ...baseOpts, colorTolerance: -100 }).colorTolerance).toBe(0);
  });

  it("degrades -Infinity to 0", () => {
    expect(buildRasterizeContext({ ...baseOpts, colorTolerance: -Infinity }).colorTolerance).toBe(0);
  });

  it("honors +Infinity as-is (documented maximal-merge behavior, not an error)", () => {
    expect(buildRasterizeContext({ ...baseOpts, colorTolerance: Infinity }).colorTolerance).toBe(Infinity);
  });

  it("treats 0 explicitly the same as omitted", () => {
    expect(buildRasterizeContext({ ...baseOpts, colorTolerance: 0 }).colorTolerance).toBe(0);
  });
});

describe("createGlyphScene — colorTolerance validation and setOptions", () => {
  function makeDiv(): HTMLElement {
    const div = document.createElement("div");
    document.body.appendChild(div);
    return div;
  }

  it("defaults to 0 when omitted at construction", () => {
    const host = makeDiv();
    const scene = createGlyphScene(host, { camera: createGlyphOrthographicCamera() });
    expect(scene.getOptions().colorTolerance).toBe(0);
    scene.destroy();
  });

  it("normalizes a NaN/negative construction-time value to 0", () => {
    const hostA = makeDiv();
    const sceneA = createGlyphScene(hostA, { camera: createGlyphOrthographicCamera(), colorTolerance: NaN });
    expect(sceneA.getOptions().colorTolerance).toBe(0);
    sceneA.destroy();

    const hostB = makeDiv();
    const sceneB = createGlyphScene(hostB, { camera: createGlyphOrthographicCamera(), colorTolerance: -50 });
    expect(sceneB.getOptions().colorTolerance).toBe(0);
    sceneB.destroy();
  });

  it("honors +Infinity at construction", () => {
    const host = makeDiv();
    const scene = createGlyphScene(host, { camera: createGlyphOrthographicCamera(), colorTolerance: Infinity });
    expect(scene.getOptions().colorTolerance).toBe(Infinity);
    scene.destroy();
  });

  it("setOptions updates and re-normalizes colorTolerance", () => {
    const host = makeDiv();
    const scene = createGlyphScene(host, { camera: createGlyphOrthographicCamera(), colorTolerance: 30 });
    expect(scene.getOptions().colorTolerance).toBe(30);
    scene.setOptions({ colorTolerance: NaN });
    expect(scene.getOptions().colorTolerance).toBe(0);
    scene.setOptions({ colorTolerance: 75 });
    expect(scene.getOptions().colorTolerance).toBe(75);
    scene.destroy();
  });

  it("setOptions with colorTolerance omitted leaves the previous value untouched", () => {
    const host = makeDiv();
    const scene = createGlyphScene(host, { camera: createGlyphOrthographicCamera(), colorTolerance: 12 });
    scene.setOptions({ mode: "wireframe" });
    expect(scene.getOptions().colorTolerance).toBe(12);
    scene.destroy();
  });
});
