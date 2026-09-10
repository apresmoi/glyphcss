/**
 * No black lines across the open sea in a vector `fill` on a curved
 * projection.
 *
 * The report: on `/maps` with terrain and borders off and only the OSM Water
 * row mounted, a globe framed on the mid-Atlantic draws thin black lines
 * through the middle of the ocean — one to two cells wide, tens of cells long,
 * curving with the surface, moving with the geometry rather than with the
 * grid.
 *
 * ## Mechanism
 *
 * `glyphMapVectorMesh` triangulates a polygon in lon/lat with earcut, whose
 * ears connect boundary vertices with no interior vertices to work with. An
 * ocean polygon's rings are a tile box plus its continents, so those ears are
 * FANS from the box's own corners: long, thin faces reaching right across the
 * open sea. Refinement leaves them alone, and correctly so — the curvature
 * test is a per-EDGE verdict and each of their edges is already inside it.
 *
 * A long thin triangle inscribed on a sphere has a circumcircle whose centre
 * is tens of degrees away, so its PLANE is the great circle's rather than the
 * surface's and its normal is up to 90 degrees off the local up. The face
 * guard used to read exactly that normal, for two jobs at once — which way the
 * face points, and whether it is trustworthy — and dropped every face more
 * than 26 degrees off. On the real OpenFreeMap `3/3/3` ocean polygon that cut
 * 122 of 1076 refined faces, the widest of them 13.7 degrees of arc and 0.500
 * degrees across: a two-cell gap 55 cells long over the Atlantic, which is the
 * reported line. The guard's premise — that a face degenerate enough to be
 * dropped is negligible — is false, because nothing bounds how far one reaches.
 *
 * The facing question is answered instead by the face's lon/lat WINDING (exact
 * for any shape) times the projection's own local handedness
 * (`localOrientation`), so the sliver is drawn rather than cut. What its own
 * plane still decides is whether it looks the right way THROUGH the surface,
 * and what it cannot decide at all is near-versus-far across the limb — so it
 * rides the per-frame near-side cull `GlyphMapVectorWall` already has
 * (`GlyphMapVectorWall.cap`).
 *
 * ## Fixture notes
 *
 *  - The source is the vendored real OpenFreeMap z0 tile's own `ocean`
 *    polygon (2 groups, 86 rings, 3,777 points) mounted as a static
 *    collection: no provider, no sweep, no timer, no network.
 *  - happy-dom has no layout, hence `stubMonospaceMetrics` — without it the
 *    hidden cell probe measures a zero-width cell and nothing renders.
 *  - The metric is INTERIOR HOLES: a blank cell with ink on both sides in the
 *    same axis, i.e. a hole in a filled region rather than its edge. A crack
 *    is a chain of them; a coastline is not, because the sea simply stops
 *    there. Both the count and the longest 8-connected CHAIN are asserted,
 *    because the report is about LINES. Measured on this fixture, before the
 *    fix against after: 184 holes / longest chain 18 against 1 / 1 at the
 *    reported framing, 65 / 7 against 14 / 2 over the South Pacific, and
 *    118 / 6 against 26 / 4 at the page's own opening view.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createGlyphMap } from "./widget";
import { glyphMapEquirectangular, glyphMapGlobe } from "./projection";
import { glyphMapVectorCullWalls, glyphMapVectorMesh } from "./layers";
import { glyphMapDecodeMVT } from "./vector/pmtiles";
import type { GlyphMapVectorFeature, GlyphMapVectorFeatureCollection } from "./vector/types";

const COLS = 160;
const ROWS = 64;

function stubMonospaceMetrics(host: HTMLElement): void {
  for (const pre of Array.from(host.querySelectorAll("pre"))) {
    Object.defineProperty(pre, "getBoundingClientRect", {
      configurable: true,
      value: () => ({ width: 1120, height: 768, top: 0, left: 0, right: 1120, bottom: 768, x: 0, y: 0, toJSON: () => ({}) }),
    });
  }
}

/** The vendored z0 OpenFreeMap tile's own ocean polygon — real data, read fresh per test. */
function oceanFeatures(): readonly GlyphMapVectorFeature[] {
  const bytes = readFileSync(path.resolve(__dirname, "../fixtures/openfreemap/z0-0-0.mvt"));
  const layers = glyphMapDecodeMVT(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer, 0, 0, 0, ["water"]);
  const ocean = (layers.water ?? []).filter((feature) => feature.properties?.class === "ocean");
  expect(ocean).toHaveLength(1);
  return ocean;
}

function oceanCollection(): GlyphMapVectorFeatureCollection {
  return { features: oceanFeatures() };
}

/** Blank cells with ink on BOTH sides in one axis — a hole inside the fill, never its edge. */
function interiorHoles(text: string): Set<string> {
  const lines = text.split("\n");
  const ink = (row: number, col: number): boolean => {
    const ch = lines[row]?.[col];
    return ch !== undefined && ch !== " ";
  };
  const holes = new Set<string>();
  for (let row = 0; row < lines.length; row++) {
    for (let col = 0; col < (lines[row]?.length ?? 0); col++) {
      if (ink(row, col)) continue;
      if ((ink(row, col - 1) && ink(row, col + 1)) || (ink(row - 1, col) && ink(row + 1, col))) holes.add(`${col},${row}`);
    }
  }
  return holes;
}

/** The longest 8-connected run of holes — the "line" the report is about, as opposed to a lone speckle. */
function longestChain(holes: ReadonlySet<string>): number {
  const seen = new Set<string>();
  let longest = 0;
  for (const start of holes) {
    if (seen.has(start)) continue;
    seen.add(start);
    const stack = [start];
    let size = 0;
    while (stack.length) {
      const [col, row] = stack.pop()!.split(",").map(Number);
      size++;
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          const key = `${col + dc},${row + dr}`;
          if (holes.has(key) && !seen.has(key)) { seen.add(key); stack.push(key); }
        }
      }
    }
    longest = Math.max(longest, size);
  }
  return longest;
}

function renderOcean(center: readonly [number, number], span: number, tilt: number, bearing = 0): { holes: Set<string>; text: string } {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const map = createGlyphMap(host, {
    view: { center: [center[0], center[1]], span, cols: COLS, rows: ROWS },
    projection: glyphMapGlobe(),
    tilt,
    bearing,
  });
  stubMonospaceMetrics(host);
  map.addLayer({ type: "fill", id: "ocean", source: oceanCollection(), color: "#1b3f66" });
  map.scene.rerender();
  const text = map.scene.output.textContent ?? "";
  map.destroy();
  host.remove();
  return { holes: interiorHoles(text), text };
}

describe("a vector fill on the globe has no holes in the open sea", () => {
  it("draws no line through the mid-Atlantic at the reported framing", () => {
    // The reported link's own view, decoded: globe, centre -28.96126/9.653595,
    // span 40.41, tilt 4, bearing 359, water the only mounted layer.
    const { holes, text } = renderOcean([-28.96126, 9.653595], 40.406877272619965, 4, 359);
    // The frame really is mostly sea at this framing — otherwise "no holes"
    // would pass on an empty picture.
    expect(text.replace(/[\s\n]/g, "").length).toBeGreaterThan(5000);
    expect(holes.size).toBeLessThanOrEqual(2);
    expect(longestChain(holes)).toBeLessThanOrEqual(1);
  });

  it("draws no line through the South Pacific either", () => {
    const { holes } = renderOcean([-150, -20], 80, 0);
    // Small islands genuinely put single blank cells inside this frame; a
    // CHAIN of them is the artefact, and there is none.
    expect(longestChain(holes)).toBeLessThanOrEqual(2);
  });

  it("draws no line at the page's own opening framing", () => {
    const { holes } = renderOcean([0, 20], 140, 40);
    expect(longestChain(holes)).toBeLessThanOrEqual(4);
  });
});

describe("the ill-conditioned cap faces are reported, not dropped", () => {
  it("reports the real ocean polygon's slivers on the globe and none on an affine projection", () => {
    const features = oceanFeatures();
    const globe = glyphMapVectorMesh(features, glyphMapGlobe());
    const slivers = globe.walls.filter((wall) => wall.cap);
    // They exist, they are a minority of the mesh, and every one of them is a
    // real emitted polygon rather than a hole.
    expect(slivers.length).toBeGreaterThan(100);
    expect(slivers.length).toBeLessThan(globe.polygons.length / 2);
    for (const sliver of slivers) {
      expect(sliver.cap).toHaveLength(3);
      expect(globe.polygons[sliver.polygon]).toBeDefined();
      expect(sliver.elevTop).toBe(sliver.elev);
    }

    // An affine projection refines nothing, so it produces no sliver whose
    // plane it cannot trust — and therefore no camera-dependent face at all.
    const flat = glyphMapVectorMesh(features, glyphMapEquirectangular());
    expect(flat.walls).toEqual([]);
  });

  it("culls a sliver unless EVERY corner is on the visible side", () => {
    const features = oceanFeatures();
    const mesh = glyphMapVectorMesh(features, glyphMapGlobe());
    const sliver = mesh.walls.find((wall) => wall.cap)!;
    const [first, ...rest] = sliver.cap!;

    const all = glyphMapVectorCullWalls(mesh, () => true);
    expect(all).toContain(mesh.polygons[sliver.polygon]);

    // One corner invisible is enough to drop it — stricter than a wall, which
    // survives on ANY corner.
    const oneCornerHidden = glyphMapVectorCullWalls(mesh, (lon, lat) => !(lon === first[0] && lat === first[1]));
    expect(oneCornerHidden).not.toContain(mesh.polygons[sliver.polygon]);
    expect(rest.length).toBe(2);
  });
});
