import { describe, expect, it } from "vitest";
import type { Polygon } from "@glyphcss/core";
import { createGlyphOrthographicCamera } from "../api/createGlyphCamera";
import { buildRasterizeContext } from "../api/rasterizeContext";
import { rasterize } from "./rasterize";

function render(reverse: boolean, colorEncoding: "spans" | "atlas") {
  const polygons: Polygon[] = [];
  for (let i = 0; i < 12; i++) {
    const x = (i % 4) * 2 - 4, y = Math.floor(i / 4) * 2 - 3;
    // Neighbouring normals share a quantized bucket but not their exact tint.
    const z = 0.5 + (i % 2) * 0.002;
    polygons.push({
      vertices: [[x, y, 0], [x, y + 1.8, 0], [x + 1.8, y + 1.8, 0], [x + 1.8, y, 0]],
      shadingNormal: [Math.sqrt(1 - z * z), 0, z],
      color: ["#ffffff", "#ffffff", "#a357db", "#26b3c8"][i % 4],
    });
  }
  if (reverse) polygons.reverse();
  return rasterize(buildRasterizeContext({
    camera: createGlyphOrthographicCamera({ rotX: 0, rotY: 0, zoom: 70 }),
    grid: { cols: 32, rows: 16, cellAspect: 2 },
    polygons, mode: "solid", doubleSided: true, useColors: true, colorEncoding,
    atlasPalette: ["#102030", "#506070", "#8090a0", "#a357db", "#26b3c8"],
    ambientLight: { intensity: 0.23, color: "#73a4d5" },
    directionalLight: { direction: [0, 0, 1], intensity: 0.77, color: "#e1b587" },
  }));
}

describe("lit-cache byte identity", () => {
  for (const encoding of ["spans", "atlas"] as const) {
    it(`preserves first-triangle tints and complete ${encoding} bytes`, () => {
      expect(render(false, encoding)).toMatchSnapshot();
      expect(render(true, encoding)).toMatchSnapshot();
    });
  }
  it("exercises a quantization collision whose first triangle changes the colour", () => {
    expect(render(false, "spans")).not.toBe(render(true, "spans"));
  });
});
