import { describe, expect, it } from "vitest";
import {
  AmbientLight,
  compileScene,
  cubePolygons,
  DirectionalLight,
  Object3D,
  PerspectiveCamera,
  transformPolygonsToGlyph,
} from "./three";

describe("glyphcss/three", () => {
  it("converts Three directional lights to glyphcss source-vector lights", () => {
    const light = new DirectionalLight("#88ccff", 0.72);
    light.position.set(3, 5, 4);
    light.target.position.set(0, 0, 0);

    const glyphLight = light.toGlyphDirectionalLight();
    const len = Math.hypot(3, 5, 4);

    expect(glyphLight.direction[0]).toBeCloseTo(3 / len);
    expect(glyphLight.direction[1]).toBeCloseTo(-4 / len);
    expect(glyphLight.direction[2]).toBeCloseTo(5 / len);
    expect(glyphLight.color).toBe("#88ccff");
    expect(glyphLight.intensity).toBe(0.72);
  });

  it("preserves Three ambient light color and intensity", () => {
    expect(new AmbientLight("#2040ff", 0.35).toGlyphAmbientLight()).toEqual({
      color: "#2040ff",
      intensity: 0.35,
    });
  });

  it("renders a Three-shaped camera, light, and object through compileScene", () => {
    const cube = new Object3D();
    cube.position.set(0, 0.5, 0);
    cube.rotation.set(0, Math.PI / 4, 0);

    const camera = new PerspectiveCamera(45, (80 / 40) / 2, 0.1, 100);
    camera.position.set(4, 3, 6);
    camera.lookAt(0, 0.5, 0);

    const light = new DirectionalLight("#ffffff", 1);
    light.position.set(3, 5, 4);
    light.target.position.set(0, 0, 0);

    const frame = compileScene({
      polygons: transformPolygonsToGlyph(
        cubePolygons({ center: [0, 0, 0], size: 1, color: "#ffffff" }),
        cube,
      ),
      camera,
      cols: 80,
      rows: 40,
      cellAspect: 2,
      mode: "solid",
      useColors: false,
      directionalLight: light.toGlyphDirectionalLight(),
      ambientLight: { intensity: 0.4 },
    });

    const filled = frame.inner.replace(/\n/g, "").split("").filter((char) => char !== " ").length;
    expect(filled).toBeGreaterThan(10);
  });
});

/**
 * `Polygon.shadingNormal` is a DIRECTION in the polygon's own frame, so the
 * Three adapter owes it the same two things it owes a vertex: the object's
 * own rotation/scale, and the Y-up → Z-up axis map. Copied through verbatim
 * it stays in the authoring frame and lights the mesh as if neither had
 * happened — and because the axis map is a rotation about X, "verbatim" is
 * wrong even for an object at the identity transform.
 */
describe("transformPolygonsToGlyph and Polygon.shadingNormal", () => {
  const withNormal = (n: [number, number, number]) => [{
    vertices: [[0, 0, 0], [1, 0, 0], [1, 0, 1]] as [number, number, number][],
    color: "#ffffff",
    shadingNormal: n,
  }];

  it("axis-maps a normal even at the identity transform", () => {
    // Three's +Y (up) is glyphcss's +Z, exactly as `threeToGlyphDirection` says.
    const out = transformPolygonsToGlyph(withNormal([0, 1, 0]), new Object3D());
    expect(out[0]!.shadingNormal!.map((v) => Math.round(v * 1e6) / 1e6)).toEqual([0, -0, 1]);
  });

  it("rotates it with the object, and never translates it", () => {
    const object = new Object3D();
    object.position.set(10, -4, 7);
    object.rotation.set(0, 0, Math.PI / 2); // +X → +Y in Three
    const out = transformPolygonsToGlyph(withNormal([1, 0, 0]), object);
    const n = out[0]!.shadingNormal!;
    // Three (0, 1, 0) → glyph (0, -0, 1). The position must not appear in it.
    expect(n[0]).toBeCloseTo(0, 9);
    expect(n[1]).toBeCloseTo(0, 9);
    expect(n[2]).toBeCloseTo(1, 9);
    expect(Math.hypot(n[0], n[1], n[2])).toBeCloseTo(1, 9);
  });

  it("inverse-transposes a non-uniform scale", () => {
    const object = new Object3D();
    object.scale.set(1, 0.1, 1);
    const n = transformPolygonsToGlyph(withNormal([1, 1, 0]), object)[0]!.shadingNormal!;
    // Flattening Y makes the normal lean MORE toward Y (glyph Z), not less:
    // (1, 10, 0) normalized in Three, i.e. glyph (0.0995, 0, 0.995).
    expect(n[0]).toBeCloseTo(1 / Math.hypot(1, 10), 9);
    expect(n[2]).toBeCloseTo(10 / Math.hypot(1, 10), 9);
  });

  it("leaves a polygon without one alone", () => {
    const out = transformPolygonsToGlyph([{ vertices: [[0, 0, 0], [1, 0, 0], [1, 0, 1]], color: "#fff" }], new Object3D());
    expect("shadingNormal" in out[0]!).toBe(false);
  });
});
