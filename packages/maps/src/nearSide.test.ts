import { expect, it } from "vitest";
import { createGlyphOrthographicCamera } from "glyphcss";
import { glyphMapGlobe, glyphMapEquirectangular } from "./projection";
import { prepareGlyphMapNearSideProof } from "./nearSide";

it("proves city boxes and falls back at the limb, antipode, invalid radius and custom projections", () => {
  const p = glyphMapGlobe({ exaggeration: 24 });
  const cam = createGlyphOrthographicCamera({ rotX: 90, rotY: 0 });
  const depth = (v: [number, number, number]) => cam.project(v, 100, 50, 2)[2];
  const proof = prepareGlyphMapNearSideProof(p, depth)!;
  expect(proof({ west: -1, east: 1, south: -1, north: 1 }, 0, 100)).toBe(true);
  expect(proof({ west: 89.9, east: 90.1, south: -1, north: 1 })).toBe(false);
  expect(proof({ west: 179, east: 180, south: -1, north: 1 })).toBe(false);
  expect(proof({ west: -1, east: 1, south: -1, north: 1 }, -6_371_000, 0)).toBe(false);
  expect(proof({ west: NaN, east: 1, south: -1, north: 1 })).toBe(false);
  expect(prepareGlyphMapNearSideProof(glyphMapEquirectangular(), depth)).toBeUndefined();
  p.visible = () => false;
  expect(prepareGlyphMapNearSideProof(p, depth)).toBeUndefined();
});

it("every accepted box vertex agrees with the original visibility test across Euler/matrix cameras and elevations", () => {
  const p = glyphMapGlobe({ radius: 2, exaggeration: 24 });
  let proved = 0, fallback = 0;
  for (const matrix of [false, true]) for (const lon of [-179, -58, 0, 90, 179]) for (const lat of [-89, -34, 0, 70, 89]) {
    const cam = createGlyphOrthographicCamera({ ...p.cameraForCenter!(lon, lat) });
    cam.target = [0.2, -0.3, 0.1];
    if (matrix) { cam.useMat = true; cam.mat = [0, 1, 0, 0, 0, -1, -1, 0, 0]; }
    const depth = (v: [number, number, number]) => cam.project(v, 100, 50, 2)[2];
    const proof = prepareGlyphMapNearSideProof(p, depth)!;
    for (let x = -180; x < 180; x += 10) for (let y = -90; y < 90; y += 10) {
      const b = { west: x, east: x + 2, south: y, north: y + 2 };
      if (!proof(b, -100, 9000)) { fallback++; continue; }
      proved++;
      for (const xx of [x, x + 1, x + 2]) for (const yy of [y, y + 1, y + 2]) for (const e of [-100, 0, 9000]) {
        expect(p.visible!(p.project(xx, yy, e), depth)).toBe(true);
      }
    }
  }
  expect(proved).toBeGreaterThan(100); expect(fallback).toBeGreaterThan(100);
});

it("uses the local walk horizon with a millimetre margin, including exact far boundaries", () => {
  const p = glyphMapGlobe();
  const proof = prepareGlyphMapNearSideProof(p, () => { throw Error("walk must not use camera depth"); }, { lon: 0, lat: 0, far: 400 })!;
  expect(proof({ west: -0.0001, east: 0.0001, south: -0.0001, north: 0.0001 })).toBe(true);
  expect(prepareGlyphMapNearSideProof(p, () => 0, { lon: 0, lat: 0, far: 20_000_000 })).toBeUndefined();
  const boundary = 400 / 6_371_000 * 180 / Math.PI;
  expect(proof({ west: boundary, east: boundary, south: 0, north: 0 })).toBe(false);
  expect(proof({ west: 0, east: 0.01, south: 0, north: 0.01 })).toBe(false);
});
