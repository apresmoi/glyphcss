import { describe, expect, it } from "vitest";
import {
  compileScene,
  cubePolygons,
  DirectionalLight,
  Object3D,
  PerspectiveCamera,
  transformPolygonsToGlyph,
} from "./three";

describe("glyphcss/three", () => {
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
