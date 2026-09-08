/**
 * No CRACK in the open sea: a blank cell whose own surface point is inside the
 * water polygon, with water on both sides of it.
 *
 * ## The report
 *
 * Two `/maps` links, both a globe with the OSM card's `omt-water` row the only
 * mounted layer — no terrain, no strokes — and both still drawing thin black
 * lines through open ocean after `aefc864`:
 *
 *  - `m=p3x6-…` → centre `-47.101607 / 12.901767`, span 206.85, tilt 4, bearing 359
 *  - `m=p3x7-…` → centre `-132.816352 / -2.489387`, span 92.71, tilt 4, bearing 359
 *
 * ## Why this file measures the cell metrics differently
 *
 * `stubMonospaceMetrics` (every other widget test, `widget.fillSliver.test.ts`
 * included) overrides `getBoundingClientRect` on the `<pre>` elements that
 * exist WHEN IT RUNS. glyphcss's own cell probe is a fresh 20-line `<pre>`
 * created per measurement inside its hidden sandbox, so it is never one of
 * them: it measures zero and falls back to `8 x 16`, while the widget's
 * `projectionGrid()` reads the stubbed `1120 x 768` output rect and computes
 * `7 x 12`. The widget then frames the camera for one cell size and the
 * rasterizer projects with another, so the picture is NOT the framing the link
 * asks for and `map.unproject()` disagrees with the render by tens of degrees
 * — which is exactly why the previous pass could only ASSERT that its residue
 * was coastline. This file stubs the prototype instead, deriving the probe's
 * rect from its own text, so `projectionGrid()` and the rasterizer agree and a
 * cell's lon/lat is the one it actually shows.
 *
 * ## Crack versus coastline, measured
 *
 * A hole is a blank cell with ink on both sides in one axis. It is a CRACK
 * when its own `map.unproject()` lon/lat is inside the source ocean polygon
 * (even-odd against the real ring set, holes included) and COASTLINE when it
 * is not. Only the crack count is asserted: the coastline residue is real
 * geography and the sea genuinely stops there.
 *
 * ## Mechanism
 *
 * Every crack cell is covered by exactly ONE face of the tessellation, and
 * that face is an `earcut` sliver whose plane is a great circle's rather than
 * the surface's. `aefc864` stopped reading that plane for the face's FACING
 * but still read it for "does this face look the right way THROUGH the
 * surface", and DROPPED the 1,112 of 22,009 faces that failed — those drops
 * are these cracks. The face's plane cannot answer that question either; the
 * projection's own local up can, so the face carries it as
 * `Polygon.shadingNormal` and is emitted.
 *
 * Not the tessellator: `earcut`'s triangle area matches the polygon's own to
 * 1.3e-15 with no unused vertex, and forcing 16x uniform subdivision on top of
 * the curvature refinement leaves the crack count where it was.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createGlyphMap } from "./widget";
import { glyphMapEquirectangular, glyphMapGlobe } from "./projection";
import { glyphMapVectorMesh } from "./layers";
import { glyphMapDecodeMVT } from "./vector/pmtiles";
import type { GlyphMapVectorFeature } from "./vector/types";

let COLS = 160, ROWS = 64;
const CELL_W = 7, CELL_H = 12;
/** @see the seam note in `renderOcean`. */
const ANTIMERIDIAN_SEAM_DEG = 0.5;

/**
 * Self-consistent cell metrics — see this file's header. The probe is the only
 * `<pre>` inside glyphcss's `aria-hidden` measurement sandbox, and it carries
 * one probe character per line, so its own text gives the cell size directly.
 */
function installConsistentMetrics(): () => void {
  const original = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "getBoundingClientRect");
  Object.defineProperty(HTMLElement.prototype, "getBoundingClientRect", {
    configurable: true,
    value: function (this: HTMLElement) {
      const rect = (w: number, h: number) => ({ width: w, height: h, top: 0, left: 0, right: w, bottom: h, x: 0, y: 0, toJSON: () => ({}) });
      if (this.tagName !== "PRE") return rect(0, 0);
      if (this.parentElement?.getAttribute("aria-hidden") !== "true") return rect(COLS * CELL_W, ROWS * CELL_H);
      const lines = (this.textContent ?? "").split("\n");
      return rect(Math.max(1, ...lines.map((l) => l.length)) * CELL_W, Math.max(1, lines.length) * CELL_H);
    },
  });
  return () => {
    if (original) Object.defineProperty(HTMLElement.prototype, "getBoundingClientRect", original);
    else delete (HTMLElement.prototype as unknown as Record<string, unknown>).getBoundingClientRect;
  };
}

/** The vendored z0 OpenFreeMap tile's own ocean polygon — real data, read fresh per test. */
function oceanFeatures(): readonly GlyphMapVectorFeature[] {
  const bytes = readFileSync(path.resolve(__dirname, "../fixtures/openfreemap/z0-0-0.mvt"));
  const layers = glyphMapDecodeMVT(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer, 0, 0, 0, ["water"]);
  const ocean = (layers.water ?? []).filter((feature) => feature.properties?.class === "ocean");
  expect(ocean).toHaveLength(1);
  return ocean;
}

function inRing(ring: readonly (readonly [number, number])[], lon: number, lat: number): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]!, [xj, yj] = ring[j]!;
    if ((yi > lat) !== (yj > lat) && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Even-odd against the real ring set: inside the outer ring and outside every hole. */
function isOpenWater(features: readonly GlyphMapVectorFeature[], lon: number, lat: number): boolean {
  for (const feature of features) {
    for (const group of feature.polygons ?? []) {
      const [outer, ...holes] = group;
      if (!outer || !inRing(outer, lon, lat)) continue;
      if (holes.some((hole) => inRing(hole, lon, lat))) continue;
      return true;
    }
  }
  return false;
}

function holeCells(text: string): [number, number][] {
  const lines = text.split("\n");
  const ink = (row: number, col: number): boolean => {
    const ch = lines[row]?.[col];
    return ch !== undefined && ch !== " ";
  };
  const out: [number, number][] = [];
  for (let row = 0; row < lines.length; row++) {
    for (let col = 0; col < (lines[row]?.length ?? 0); col++) {
      if (ink(row, col)) continue;
      if ((ink(row, col - 1) && ink(row, col + 1)) || (ink(row - 1, col) && ink(row + 1, col))) out.push([col, row]);
    }
  }
  return out;
}

interface Split { readonly crack: readonly string[]; readonly coastline: number; readonly ink: number }

function renderOcean(center: readonly [number, number], span: number, tilt: number, bearing: number, cols = 160, rows = 64): Split {
  COLS = cols; ROWS = rows;
  const features = oceanFeatures();
  const restore = installConsistentMetrics();
  const host = document.createElement("div");
  document.body.appendChild(host);
  try {
    const map = createGlyphMap(host, {
      view: { center: [center[0], center[1]], span, cols: COLS, rows: ROWS },
      projection: glyphMapGlobe(),
      tilt,
      bearing,
    });
    map.addLayer({ type: "fill", id: "ocean", source: { features }, color: "#1b3f66" });
    map.scene.rerender();
    const text = map.scene.output.textContent ?? "";
    const crack: string[] = [];
    let coastline = 0;
    for (const [col, row] of holeCells(text)) {
      const lonLat = map.unproject([col, row]);
      // The ANTIMERIDIAN SEAM is a separate, unfixed defect and is excluded
      // here rather than silently absorbed: the vendored z0 ring carries the
      // tile's own buffer out to +/-185.625 degrees, and a strip about a tenth
      // of a degree wide either side of +/-180 loses cells at fine grids
      // (measured at 320x128: 1 cell in the Pacific framing, 5 over the South
      // Pacific, all between -179.8 and -180, none anywhere else). It is one
      // cell wide, it does not chain, and it is nothing to do with the sliver
      // faces this file is about.
      if (lonLat && Math.abs(Math.abs(lonLat[0]) - 180) < ANTIMERIDIAN_SEAM_DEG) continue;
      if (lonLat && isOpenWater(features, lonLat[0], lonLat[1])) crack.push(`${col},${row}@${lonLat[0].toFixed(2)},${lonLat[1].toFixed(2)}`);
      else coastline++;
    }
    map.destroy();
    return { crack, coastline, ink: text.replace(/[\s\n]/g, "").length };
  } finally {
    host.remove();
    restore();
  }
}

describe("a vector fill on the globe has no crack in the open sea", () => {
  it("draws no crack at the first reported framing (span 206, whole globe)", () => {
    const { crack, coastline, ink } = renderOcean([-47.101607, 12.901767], 206.85126325595743, 4, 359);
    // The frame really is mostly sea — "no crack" must not pass on an empty picture.
    expect(ink).toBeGreaterThan(2000);
    expect(crack).toEqual([]);
    // The coastline residue is real geography, not a defect; pinned only so a
    // future change that starts eating the coast cannot pass silently.
    expect(coastline).toBeLessThanOrEqual(80);
  });

  it("draws no crack at the second reported framing (span 92, the Pacific)", () => {
    const { crack, ink } = renderOcean([-132.816352, -2.489387], 92.71219339445855, 4, 359);
    expect(ink).toBeGreaterThan(8000);
    expect(crack).toEqual([]);
    // Again at the grid a real 1440px page reaches with the reported link's own
    // 1.4x density on that row: a crack is a fixed fraction of a DEGREE wide,
    // so a finer grid resolves more of them, and at 160x64 this framing happens
    // to sample past every one.
    expect(renderOcean([-132.816352, -2.489387], 92.71219339445855, 4, 359, 320, 128).crack).toEqual([]);
  });

  it("draws no crack over the South Pacific or at the page's opening framing", () => {
    expect(renderOcean([-150, -20], 80, 0, 0).crack).toEqual([]);
    expect(renderOcean([0, 20], 140, 40, 0).crack).toEqual([]);
  });
});

describe("an ill-conditioned cap face carries the surface's own shading normal", () => {
  it("gives every sliver an outward shading normal instead of dropping it", () => {
    const mesh = glyphMapVectorMesh(oceanFeatures(), glyphMapGlobe());
    const slivers = mesh.polygons.filter((p) => p.shadingNormal !== undefined);
    expect(slivers.length).toBeGreaterThan(100);
    for (const sliver of slivers) {
      const n = sliver.shadingNormal!;
      // Unit, and outward: the globe is origin-centred, so the surface normal
      // at a vertex is that vertex's own direction.
      expect(Math.hypot(n[0], n[1], n[2])).toBeCloseTo(1, 9);
      for (const v of sliver.vertices) {
        const len = Math.hypot(v[0], v[1], v[2]) || 1;
        expect((n[0] * v[0] + n[1] * v[1] + n[2] * v[2]) / len).toBeGreaterThan(0);
      }
    }
  });

  it("sets no shading normal at all on an affine projection", () => {
    const flat = glyphMapVectorMesh(oceanFeatures(), glyphMapEquirectangular());
    expect(flat.polygons.filter((p) => p.shadingNormal !== undefined)).toEqual([]);
    expect(flat.walls).toEqual([]);
  });
});
