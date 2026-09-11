/**
 * Pre-projection cull runs in `computeOcclusionIds`.
 *
 * The id-map raster was the one polygon loop in `render/rasterize.ts` with
 * neither the `Polygon.hidden` skip (its own file:
 * `rasterize.occlusionHidden.test.ts`) nor `cullChunks` — and it walks the
 * WHOLE scene once per render the moment a single opaque detail layer exists.
 *
 * Unlike the `hidden` half, this one is a pure cost reduction and must be
 * byte-identical: a run whose world box provably projects entirely off THIS
 * raster's grid covers no cell of it, and a run every one of whose normals is
 * back-facing is a run every triangle of which `fillDepthTri` rejects on the
 * same `area2 > 0` sign. So the clauses here come in pairs — the claim set is
 * IDENTICAL, and the projection count FELL, because byte-identity alone is
 * also what a completely inert cull would produce.
 *
 * ## `doubleSided` is the blocker this had to clear
 *
 * `fillDepthTri` culls back faces only when the scene is single-sided. A
 * `doubleSided` scene's back faces claim cells like any other, so the
 * back-face run rejection must be OFF there or the id-map stops blanking
 * behind them. That is the last clause, and it is the one that goes red if
 * the `!doubleSided` gate is dropped.
 */
import { describe, expect, it } from "vitest";
import type { Polygon, Vec3 } from "@glyphcss/core";
import type { ProjectCamera } from "../api/types";
import { createGlyphOrthographicCamera, createGlyphPerspectiveCamera } from "../api/createGlyphCamera";
import { buildGlyphPolygonCullChunks } from "../api/rasterizeContext";
import { computeOcclusionIds } from "./rasterize";
import type { TextureSampler } from "@glyphcss/core";

const COLS = 48;
const ROWS = 22;
const ASPECT = 2;

/** Wraps a camera and counts `project` calls — the positive signal. */
function counting(camera: ProjectCamera): { camera: ProjectCamera; calls: () => number } {
  let n = 0;
  const wrapped: ProjectCamera = Object.create(camera) as ProjectCamera;
  wrapped.project = (...args: Parameters<ProjectCamera["project"]>) => { n++; return camera.project(...args); };
  return { camera: wrapped, calls: () => n };
}

/** A UV sphere shell — half of every pose's runs are back-facing. */
function shell(nLon: number, nLat: number, r: number, cx = 0, cy = 0, cz = 0): Polygon[] {
  const out: Polygon[] = [];
  const P = (i: number, j: number): Vec3 => {
    const th = (i / nLon) * Math.PI * 2, ph = (j / nLat) * Math.PI;
    return [cx + r * Math.sin(ph) * Math.cos(th), cy + r * Math.sin(ph) * Math.sin(th), cz + r * Math.cos(ph)];
  };
  for (let j = 0; j < nLat; j++) for (let i = 0; i < nLon; i++) {
    out.push({ vertices: [P(i, j), P(i + 1, j), P(i + 1, j + 1), P(i, j + 1)], color: "#557799" });
  }
  return out;
}

function plate(z: number, x0: number, x1: number, y0: number, y1: number, extra: Partial<Polygon> = {}): Polygon {
  return { vertices: [[x0, y0, z], [x1, y0, z], [x1, y1, z], [x0, y1, z]], color: "#cc7744", ...extra };
}

const chunksOf = (p: Polygon[]) => buildGlyphPolygonCullChunks(p) ?? undefined;

type Group = Parameters<typeof computeOcclusionIds>[0][number];

function run(groups: Group[], camera: ProjectCamera, doubleSided: boolean, ss = 1, samplers: ReadonlyMap<string, TextureSampler> | null = null): Int32Array {
  return computeOcclusionIds(groups, camera, COLS, ROWS, ASPECT, ss, undefined, samplers, null, doubleSided);
}

/** 8x8 RGBA with a transparent margin — the alpha-aware claim's input. */
function spriteSampler(): TextureSampler {
  const w = 8, h = 8, data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4, inside = x >= 2 && x <= 5 && y >= 2 && y <= 5;
    data[i] = 200; data[i + 1] = 120; data[i + 2] = 90; data[i + 3] = inside ? 255 : 0;
  }
  return { width: w, height: h, data, lowDetail: false };
}

const POSES: { id: string; cam: () => ProjectCamera; doubleSided: boolean }[] = [
  { id: "ortho-iso", cam: () => createGlyphOrthographicCamera({ rotX: 65, rotY: 45, zoom: 16 }), doubleSided: false },
  { id: "ortho-front", cam: () => createGlyphOrthographicCamera({ rotX: 0, rotY: 0, zoom: 30 }), doubleSided: false },
  { id: "ortho-zoomed", cam: () => createGlyphOrthographicCamera({ rotX: 30, rotY: 110, zoom: 240 }), doubleSided: false },
  { id: "persp-inside", cam: () => createGlyphPerspectiveCamera({ rotX: 84, rotY: 15, zoom: 28, position: [0, 0, 0.3] }), doubleSided: false },
  { id: "ortho-two-sided", cam: () => createGlyphOrthographicCamera({ rotX: 65, rotY: 45, zoom: 16 }), doubleSided: true },
];

describe("computeOcclusionIds cull runs", () => {
  it("claims exactly the same cells, and projects fewer vertices", () => {
    const base = shell(256, 24, 1);
    const detail = [plate(1.6, -0.4, 0.4, -0.3, 0.3)];
    let sawSaving = false;
    for (const pose of POSES) {
      const plain = counting(pose.cam());
      const culled = counting(pose.cam());
      const a = run([{ polygons: base, id: 0 }, { polygons: detail, id: 3 }], plain.camera, pose.doubleSided);
      const b = run([
        { polygons: base, id: 0, cullChunks: chunksOf(base) },
        { polygons: detail, id: 3, cullChunks: chunksOf(detail) },
      ], culled.camera, pose.doubleSided);
      expect(Array.from(b), `${pose.id}: the cull moved a claim`).toEqual(Array.from(a));
      // Not vacuous: something is claimed at every pose.
      expect(a.some((v) => v !== -1), `${pose.id}: nothing claimed — the pose proves nothing`).toBe(true);
      if (culled.calls() < plain.calls()) sawSaving = true;
    }
    // Not every pose CAN save. `persp-inside` stands inside the shell, so
    // every run straddles the near plane and is unconditionally accepted
    // (and a perspective camera's screen map is not affine, so the cone
    // rejection declines to arm at all) — there the eight corner probes per
    // run are pure overhead, which is the honest shape of the trade and why
    // this asserts a saving SOMEWHERE rather than everywhere.
    expect(sawSaving, "no pose projected fewer vertices — the cull is inert").toBe(true);
  });

  it("rejects a run that is wholly off the grid", () => {
    // One mesh on screen, one far off it. The off-screen mesh's runs project
    // eight corners each and then nothing else.
    const on = shell(24, 24, 1);
    const off = shell(24, 24, 1, 400, 0, 0);
    const all = [...on, ...off];
    const detail = [plate(1.6, -0.4, 0.4, -0.3, 0.3)];
    const cam = () => createGlyphOrthographicCamera({ rotX: 20, rotY: 20, zoom: 30 });
    const plain = counting(cam());
    const culled = counting(cam());
    const a = run([{ polygons: all, id: 0 }, { polygons: detail, id: 3 }], plain.camera, false);
    const b = run([
      { polygons: all, id: 0, cullChunks: chunksOf(all) },
      { polygons: detail, id: 3, cullChunks: chunksOf(detail) },
    ], culled.camera, false);
    expect(Array.from(b)).toEqual(Array.from(a));
    expect(culled.calls()).toBeLessThan(plain.calls() * 0.75);
  });

  it("rejects a run whose every normal faces away, and only when the scene is single-sided", () => {
    // A closed shell seen from outside: the far hemisphere's runs are wholly
    // back-facing. Single-sided, they are rejected; double-sided they must
    // NOT be, because `fillDepthTri` lets them claim.
    const base = shell(256, 24, 1);
    const cam = () => createGlyphOrthographicCamera({ rotX: 55, rotY: 35, zoom: 18 });
    const single = { plain: counting(cam()), culled: counting(cam()) };
    const single0 = run([{ polygons: base, id: 0 }], single.plain.camera, false);
    const single1 = run([{ polygons: base, id: 0, cullChunks: chunksOf(base) }], single.culled.camera, false);
    expect(Array.from(single1)).toEqual(Array.from(single0));
    expect(single.culled.calls()).toBeLessThan(single.plain.calls() * 0.8);

    const dbl = { plain: counting(cam()), culled: counting(cam()) };
    const dbl0 = run([{ polygons: base, id: 0 }], dbl.plain.camera, true);
    const dbl1 = run([{ polygons: base, id: 0, cullChunks: chunksOf(base) }], dbl.culled.camera, true);
    expect(Array.from(dbl1), "a double-sided scene's back faces still claim").toEqual(Array.from(dbl0));
    // The shell's own box is on-grid, so with the back-face rejection
    // correctly off, only the eight corner probes per run are added — never
    // a saving. A back-face rejection that leaked past the `doubleSided`
    // gate would show up here as a LOWER count AND a different claim set.
    expect(dbl.culled.calls()).toBeGreaterThanOrEqual(dbl.plain.calls());
  });

  it("keeps a double-sided scene's back-facing run, which is the only claimant of its cells", () => {
    // The clause above measures the back-face gate through a projection
    // count, and a count is not a claim. Here a lone BACK-FACING sheet is the
    // nearest thing in the scene, so under `doubleSided: true` it owns every
    // cell it covers and a plate behind it owns none. A cone rejection that
    // leaked past the `!doubleSided` gate hands those cells to the plate.
    const sheet: Polygon[] = [];
    const N = 20;  // >= GLYPH_CULL_CHUNK_MIN_POLYGONS, or nothing is chunked at all
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const x0 = -1.2 + (i * 2.4) / N, y0 = -1.2 + (j * 2.4) / N;
      // Reverse winding: away from the camera.
      const d = 2.4 / N;
      sheet.push({ vertices: [[x0, y0, 1], [x0, y0 + d, 1], [x0 + d, y0 + d, 1], [x0 + d, y0, 1]], color: "#88aa55" });
    }
    expect(chunksOf(sheet), "the sheet is too small to be chunked — the clause proves nothing").toBeDefined();
    const behind = [plate(-1, -1.2, 1.2, -1.2, 1.2)];
    const cam = () => createGlyphOrthographicCamera({ rotX: 0, rotY: 0, zoom: 18 });
    const a = run([{ polygons: sheet, id: 5 }, { polygons: behind, id: 6 }], cam(), true);
    const b = run([
      { polygons: sheet, id: 5, cullChunks: chunksOf(sheet) },
      { polygons: behind, id: 6, cullChunks: chunksOf(behind) },
    ], cam(), true);
    const owned = (ids: Int32Array, id: number) => ids.reduce((n, v) => n + (v === id ? 1 : 0), 0);
    expect(owned(a, 5), "the back-facing sheet claimed nothing even without the cull").toBeGreaterThan(0);
    expect(Array.from(b)).toEqual(Array.from(a));
  });

  it("is identical under supersample, priority classes and alpha claims", () => {
    const base = shell(32, 32, 1);
    const sprite = [plate(1.4, -0.6, 0.6, -0.5, 0.5, { uvs: [[0, 0], [1, 0], [1, 1], [0, 1]], texture: "sprite" })];
    const near = [plate(1.9, -0.3, 0.3, -0.2, 0.2)];
    const samplers = new Map<string, TextureSampler>([["sprite", spriteSampler()]]);
    const cam = () => createGlyphOrthographicCamera({ rotX: 62, rotY: 28, zoom: 20 });
    const mk = (withChunks: boolean): Group[] => [
      { polygons: base, id: 0, ...(withChunks ? { cullChunks: chunksOf(base) } : {}) },
      { polygons: sprite, id: 3, ...(withChunks ? { cullChunks: chunksOf(sprite) } : {}) },
      { polygons: near, id: 4, occlusionPriority: 2, ...(withChunks ? { cullChunks: chunksOf(near) } : {}) },
    ];
    for (const ss of [1, 2]) {
      const a = run(mk(false), cam(), false, ss, samplers);
      const b = run(mk(true), cam(), false, ss, samplers);
      expect(Array.from(b), `supersample ${ss}`).toEqual(Array.from(a));
    }
  });

  it("still rejects runs on the FINE raster occlusionContourPx takes", () => {
    // `occlusionContourPx` looks as though it should need an exemption: it
    // stamps a claimed FINE cell outward by up to 24 fine cells, so a run
    // just off the fine grid's edge would seem able to reach back in. It
    // cannot — the margin loop walks the fine map's own indices, so a run
    // with no claim inside the grid seeds no margin. This pins that, by
    // putting a large off-grid mesh AND a back-facing hemisphere into a
    // scene whose contour group is live: the claims are identical and the
    // cull still fires.
    const on = shell(256, 24, 1);
    const off = shell(256, 24, 1, 600, 0, 0);
    const all = [...on, ...off];
    // A contour group with enough polygons to be chunked, half of it off the
    // grid's right edge — so its own runs are culled too.
    const strip: Polygon[] = [];
    for (let i = 0; i < 400; i++) {
      const x = -1 + i * 0.06;
      strip.push(plate(1.5, x, x + 0.06, -0.4, 0.4, { uvs: [[0, 0], [1, 0], [1, 1], [0, 1]], texture: "sprite" }));
    }
    expect(chunksOf(strip), "the contour strip is too small to be chunked").toBeDefined();
    const samplers = new Map<string, TextureSampler>([["sprite", spriteSampler()]]);
    const cam = () => createGlyphOrthographicCamera({ rotX: 35, rotY: 25, zoom: 26 });
    const mk = (withChunks: boolean): Group[] => [
      { polygons: all, id: 0, ...(withChunks ? { cullChunks: chunksOf(all) } : {}) },
      { polygons: strip, id: 3, occlusionContourPx: 4, ...(withChunks ? { cullChunks: chunksOf(strip) } : {}) },
    ];
    const plain = counting(cam());
    const culled = counting(cam());
    const a = computeOcclusionIds(mk(false), plain.camera, COLS, ROWS, ASPECT, 1, undefined, samplers, null, false);
    const b = computeOcclusionIds(mk(true), culled.camera, COLS, ROWS, ASPECT, 1, undefined, samplers, null, false);
    expect(Array.from(b)).toEqual(Array.from(a));
    expect(a.some((v) => v === 3), "the contour group claimed nothing — the clause proves nothing").toBe(true);
    expect(culled.calls(), "the cull is inert on the contour path").toBeLessThan(plain.calls() * 0.9);
  });
});
