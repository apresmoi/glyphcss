import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import type { Polygon, Vec3 } from "@glyphcss/core";
import { createGlyphOrthographicCamera, createGlyphPerspectiveCamera, resolveGlyphProjectInto } from "./createGlyphCamera";

import { buildRasterizeContext } from "./rasterizeContext";
import { rasterize } from "../render/rasterize";

// Frozen before the allocation refactor: IEEE bytes preserve signed zero and
// exact doubles, unlike rounded numeric tolerances or JSON stringification.
it("preserves baseline projection bits across camera modes and mutations", () => {
  const hash = createHash("sha256");
  for (const mode of ["ortho", "css", "legacy", "eye"] as const) {
    const camera = mode === "ortho" ? createGlyphOrthographicCamera() : createGlyphPerspectiveCamera();
    camera.perspective = mode === "legacy" ? 0 : 700;
    camera.eyeMode = mode === "eye";
    for (let i = 0; i < 512; i++) {
      camera.rotX = (i % 179) - 89; camera.rotY = i * 17.3;
      camera.target = [Math.sin(i), -0, 0.001 * i];
      camera.zoom = 13.7 + i; camera.distance = (i % 19) - 9;
      camera.stretch = 1.13; camera.fovScale = 0.71;
      camera.center = [0.37, 0.64];
      camera.useMat = i % 2 === 0;
      camera.mat = [0.36, -0.48, 0.8, 0.8, 0.6, 0, -0.48, 0.64, 0.6];
      const v: Vec3 = i === 0 ? [-0, 0, -0] : [Math.sin(i * 1.1) * 10, Math.cos(i * 0.7) * 3, (i % 41) - 20];
      const result = camera.project(v, 53, 29, 1.9, i % 3 ? undefined : { cellWidth: 7.3, cellHeight: 15.1, centerCol: 9, centerRow: 12 });
      const out: [number, number, number, number?] = [1, 2, 3, 4];
      const into = resolveGlyphProjectInto(camera)!;
      expect(into(v, 53, 29, 1.9, i % 3 ? undefined : { cellWidth: 7.3, cellHeight: 15.1, centerCol: 9, centerRow: 12 }, out)).toBe(out);
      expect(out).toEqual(result);
      const bytes = Buffer.alloc(8 * (result.length + 1));
      bytes.writeDoubleLE(result.length, 0);
      result.forEach((n, k) => bytes.writeDoubleLE(n!, (k + 1) * 8));
      hash.update(bytes);
    }
  }
  expect(hash.digest("hex")).toMatchSnapshot();
});

it("keeps indexed and unindexed renders byte-identical to public project calls", () => {
  for (const perspective of [false, true]) {
    for (const colorEncoding of ["spans", "atlas"] as const) {
      const camera = perspective ? createGlyphPerspectiveCamera({ zoom: 700 }) : createGlyphOrthographicCamera({ zoom: 700 });
      const polygons: Polygon[] = [];
      for (let y = 0; y < 6; y++) for (let x = 0; x < 6; x++) {
        const at = (x: number, y: number): Vec3 => [x / 6 - 0.5, y / 6 - 0.5, Math.sin(x) * 0.02];
        polygons.push({ vertices: [at(x, y), at(x + 1, y), at(x + 1, y + 1), at(x, y + 1)], color: "#a357db" });
      }
      const fallback = { ...camera, project: camera.project.bind(camera) };
      const render = (c: typeof camera) => rasterize(buildRasterizeContext({
        camera: c, polygons, grid: { cols: 40, rows: 24, cellAspect: 2 },
        mode: "solid", useColors: true, doubleSided: true, colorEncoding,
        atlasPalette: ["#a357db", "#503070"],
      }));
      expect(resolveGlyphProjectInto(fallback)).toBeUndefined();
      for (let i = 0; i < 3; i++) {
        camera.rotY += 13;
        const expected = render(fallback);
        expect(expected.trim().length).toBeGreaterThan(50);
        expect(render(camera)).toBe(expected);
      }
      camera.project = () => [1, 2, 3];
      expect(resolveGlyphProjectInto(camera)).toBeUndefined();
    }
  }
});
