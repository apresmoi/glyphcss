import { describe, it, expect } from "vitest";
import { createGlyphPerspectiveCamera } from "./createGlyphCamera";
import type { Vec3 } from "@glyphcss/core";

// Projection-conformance guarantee (requested by the cssQuake ↔ glyphcss parity
// review). glyphcss's perspective camera documents itself as reproducing exactly
// what the browser does for polycss/voxcss:
//
//   perspective: P   (CSS `P/(P − z)` divide)
//   transform: scale(zoom) rotateX(rotX) rotate(rotY) translate3d(-target)
//   world→CSS axis map: world[1]→CSS X, world[0]→CSS Y, world[2]→CSS Z
//
// This test re-derives that pipeline INDEPENDENTLY as canonical 4×4 homogeneous
// matrices (compose → multiply → perspective w-divide), structurally different
// from the camera's hand-inlined scalar project(), and asserts they agree to
// sub-cell precision across random ROTATED / off-axis poses. Any axis-swap,
// rotation-order, handedness, or foreshortening drift fails loudly here.

const BASE_TILE = 50; // must match createGlyphCamera.ts
const DEG = Math.PI / 180;

// --- minimal 4×4 (row-major) matrix algebra --------------------------------
type M4 = number[]; // length 16, row-major

function mul(a: M4, b: M4): M4 {
  const o = new Array(16).fill(0);
  for (let r = 0; r < 4; r++)
    for (let c = 0; c < 4; c++)
      for (let k = 0; k < 4; k++) o[r * 4 + c] += a[r * 4 + k] * b[k * 4 + c];
  return o;
}
function apply(m: M4, v: [number, number, number, number]): [number, number, number, number] {
  const o: [number, number, number, number] = [0, 0, 0, 0];
  for (let r = 0; r < 4; r++) o[r] = m[r * 4] * v[0] + m[r * 4 + 1] * v[1] + m[r * 4 + 2] * v[2] + m[r * 4 + 3] * v[3];
  return o;
}
const scaleM = (k: number): M4 => [k,0,0,0, 0,k,0,0, 0,0,k,0, 0,0,0,1];
const transZ = (t: number): M4 => [1,0,0,0, 0,1,0,0, 0,0,1,t, 0,0,0,1];
const rotZ = (deg: number): M4 => { const c = Math.cos(deg*DEG), s = Math.sin(deg*DEG); return [c,-s,0,0, s,c,0,0, 0,0,1,0, 0,0,0,1]; };
const rotX = (deg: number): M4 => { const c = Math.cos(deg*DEG), s = Math.sin(deg*DEG); return [1,0,0,0, 0,c,-s,0, 0,s,c,0, 0,0,0,1]; };

interface Params { rotX: number; rotY: number; zoom: number; perspective: number; distance: number; target: Vec3; stretch: number; fovScale: number; }

// Independent reference projection → [col, row] (or null if near/behind clip).
function refProject(p: Params, v: Vec3, cols: number, rows: number, cellAspect: number): [number, number] | null {
  // axis-swap baked into the input point: world[1]→x, world[0]→y, world[2]→z.
  const shifted: [number, number, number, number] = [v[1] - p.target[1], v[0] - p.target[0], v[2] - p.target[2], 1];
  // compose TransZ(-distance) · Scale(zoom·TILE) · RotX(rotX) · RotZ(rotY), applied to the swapped point.
  const M = mul(transZ(-p.distance), mul(scaleM(p.zoom * BASE_TILE), mul(rotX(p.rotX), rotZ(p.rotY))));
  const [X, Y, cssZ] = apply(M, shifted);
  const denom = p.perspective - cssZ;
  if (denom < p.perspective * 0.0101) return null; // matches PERSPECTIVE_NEAR clip
  const persp = p.perspective / denom;
  const cellPxW = BASE_TILE / cellAspect, cellPxH = BASE_TILE;
  const col = cols * 0.5 + ((X * persp) / cellPxW) * p.stretch * p.fovScale;
  const row = rows * 0.5 + ((Y * persp) / cellPxH) * p.fovScale;
  return [col, row];
}

// deterministic PRNG (no Math.random → reproducible in CI)
function lcg(seed: number) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 0x100000000; }; }

describe("perspective projection conformance (polycss / CSS parity)", () => {
  it("matches the canonical CSS 4×4 pipeline to sub-cell precision across random rotated poses", () => {
    const rnd = lcg(0xC0FFEE);
    const rr = (lo: number, hi: number) => lo + (hi - lo) * rnd();
    let maxDev = 0, samples = 0;
    const grids = [ { cols: 137, rows: 53, ca: 2 }, { cols: 200, rows: 60, ca: 1 }, { cols: 90, rows: 90, ca: 2.4 } ];

    for (let pose = 0; pose < 400; pose++) {
      const p: Params = {
        rotX: rr(0, 180), rotY: rr(0, 360),
        zoom: rr(0.3, 1.2), perspective: rr(400, 1500), distance: rr(0, 200),
        target: [rr(-2, 2), rr(-2, 2), rr(-2, 2)], stretch: rr(0.85, 1.15), fovScale: rr(0.5, 2),
      };
      const cam = createGlyphPerspectiveCamera({ rotX: p.rotX, rotY: p.rotY, zoom: p.zoom, perspective: p.perspective, distance: p.distance });
      cam.target = p.target; cam.stretch = p.stretch; cam.fovScale = p.fovScale;
      const g = grids[pose % grids.length];

      for (let i = 0; i < 6; i++) {
        const v: Vec3 = [rr(-3, 3), rr(-3, 3), rr(-3, 3)];
        const ref = refProject(p, v, g.cols, g.rows, g.ca);
        const got = cam.project(v, g.cols, g.rows, g.ca);
        if (ref === null) { expect(Number.isNaN(got[0])).toBe(true); continue; } // both clip
        expect(Number.isFinite(got[0]) && Number.isFinite(got[1])).toBe(true);
        maxDev = Math.max(maxDev, Math.abs(got[0] - ref[0]), Math.abs(got[1] - ref[1]));
        samples++;
      }
    }

    expect(samples).toBeGreaterThan(1500);
    // Contract from the parity review: ≤ 0.5 cell across all depths and rotations.
    expect(maxDev).toBeLessThanOrEqual(0.5);
    // Far tighter in practice (same math, different structure) — pin it so any real drift trips.
    expect(maxDev).toBeLessThan(1e-6);
  });

  it("axis-swap + rotation order: known iso-ish pose lands where CSS puts it", () => {
    // rotX=65, rotY=45 (the classic iso viewpoint) — a fixed sanity anchor.
    const p: Params = { rotX: 65, rotY: 45, zoom: 0.65, perspective: 800, distance: 0, target: [0, 0, 0], stretch: 1, fovScale: 1 };
    const cam = createGlyphPerspectiveCamera({ rotX: 65, rotY: 45, zoom: 0.65, perspective: 800, distance: 0 });
    for (const v of [[1,0,0],[0,1,0],[0,0,1],[1,1,1],[-2,1,0.5]] as Vec3[]) {
      const ref = refProject(p, v, 120, 48, 2)!;
      const got = cam.project(v, 120, 48, 2);
      expect(Math.abs(got[0] - ref[0])).toBeLessThan(1e-6);
      expect(Math.abs(got[1] - ref[1])).toBeLessThan(1e-6);
    }
  });
});
