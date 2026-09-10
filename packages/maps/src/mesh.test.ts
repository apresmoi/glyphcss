import { describe, expect, it } from "vitest";
import type { Vec3 } from "glyphcss";
import { glyphMapPolygons } from "./mesh";
import { glyphMapEquirectangular, glyphMapGlobe, glyphMapMercator } from "./projection";
import type { GlyphMapGeoTile } from "./tile";

function makeTile(bounds: GlyphMapGeoTile["bounds"], cols: number, rows: number, elevationFn: (lon: number, lat: number) => number): GlyphMapGeoTile {
  const vcols = cols + 1;
  const vrows = rows + 1;
  const elevation = new Float32Array(vcols * vrows);
  for (let row = 0; row < vrows; row++) {
    const lat = bounds.north - ((bounds.north - bounds.south) * row) / rows;
    for (let col = 0; col < vcols; col++) {
      const lon = bounds.west + ((bounds.east - bounds.west) * col) / cols;
      elevation[row * vcols + col] = elevationFn(lon, lat);
    }
  }
  return { bounds, cols, rows, elevation, source: "synthetic", sampler: "nearest" };
}

function cross(u: Vec3, v: Vec3): Vec3 {
  return [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
}
function sub(u: Vec3, v: Vec3): Vec3 {
  return [u[0] - v[0], u[1] - v[1], u[2] - v[2]];
}
function dot(u: Vec3, v: Vec3): number {
  return u[0] * v[0] + u[1] * v[1] + u[2] * v[2];
}

describe("glyphMapPolygons", () => {
  it("emits one quad per tile cell", () => {
    const tile = makeTile({ west: 0, east: 10, south: 0, north: 10 }, 4, 3, () => 0);
    const polygons = glyphMapPolygons(tile, glyphMapGlobe());
    expect(polygons.length).toBe(4 * 3);
    for (const p of polygons) expect(p.vertices.length).toBe(4);
  });

  it("vertex order is exactly [nw, sw, se, ne]", () => {
    const globe = glyphMapGlobe();
    const tile = makeTile({ west: 10, east: 12, south: 10, north: 12 }, 2, 2, () => 0);
    const polygons = glyphMapPolygons(tile, globe);
    // Cell (col=0, row=0) of a 2x2-quad, 1-degree-per-quad tile spans
    // lon [10, 11], lat [11, 12] (row 0 is the NORTHERNMOST row).
    const [nw, sw, se, ne] = polygons[0].vertices;
    expect(nw).toEqual(globe.project(10, 12, 0));
    expect(sw).toEqual(globe.project(10, 11, 0));
    expect(se).toEqual(globe.project(11, 11, 0));
    expect(ne).toEqual(globe.project(11, 12, 0));
  });

  it("winds CCW-from-outside on the globe (outward-facing normal, checked over BOTH fan triangles)", () => {
    const tile = makeTile({ west: 10, east: 12, south: 10, north: 12 }, 2, 2, () => 0);
    const polygons = glyphMapPolygons(tile, glyphMapGlobe());
    for (const polygon of polygons) {
      const [v0, v1, v2, v3] = polygon.vertices;
      const center: Vec3 = [
        polygon.vertices.reduce((s, v) => s + v[0], 0) / 4,
        polygon.vertices.reduce((s, v) => s + v[1], 0) / 4,
        polygon.vertices.reduce((s, v) => s + v[2], 0) / 4,
      ];
      // For a convex outward-bulging quad on a sphere centered at the
      // origin, an outward-facing fan triangle's normal points the same
      // general direction as the quad's own centroid (both point "away from
      // the sphere's center"). Both triangles of the CCW fan must agree.
      expect(dot(cross(sub(v1, v0), sub(v2, v0)), center)).toBeGreaterThan(0);
      expect(dot(cross(sub(v2, v0), sub(v3, v0)), center)).toBeGreaterThan(0);
    }
  });

  it("winds toward the camera on a flat sheet too (equirectangular/Mercator) — found live on /maps: the naive [nw,sw,se,ne] order is CW, not CCW, as seen from above (+Z looking down -Z), backface-culling the ENTIRE mesh under a non-orbit camera", () => {
    // Independent ground truth, not the fix's own probe: every flat
    // projection in this file returns relief along +Z (`reliefZ`), so the
    // correct outward normal for ANY quad, anywhere, is dot(normal, +Z) > 0
    // — a fact about the projections' shared convention, not about how
    // `glyphMapPolygons` happens to compute it internally.
    const up: Vec3 = [0, 0, 1];
    for (const projection of [glyphMapEquirectangular(), glyphMapMercator()]) {
      const tile = makeTile({ west: 10, east: 12, south: 10, north: 12 }, 2, 2, () => 0);
      const polygons = glyphMapPolygons(tile, projection);
      expect(polygons.length).toBeGreaterThan(0);
      for (const polygon of polygons) {
        const [v0, v1, v2, v3] = polygon.vertices;
        expect(dot(cross(sub(v1, v0), sub(v2, v0)), up)).toBeGreaterThan(0);
        expect(dot(cross(sub(v2, v0), sub(v3, v0)), up)).toBeGreaterThan(0);
      }
    }
  });

  it("colors each quad from a representative elevation of the terrain it covers", () => {
    const tile = makeTile({ west: 0, east: 2, south: 0, north: 2 }, 2, 2, (lon) => (lon < 1 ? -100 : 100));
    const polygons = glyphMapPolygons(tile, glyphMapGlobe(), {
      color: (elev) => (elev < 0 ? "#0000ff" : "#00ff00"),
    });
    expect(polygons.every((p) => p.color === "#0000ff" || p.color === "#00ff00")).toBe(true);
  });

  it("colorSample: \"corner-mean\" really does hand `color` the 4-corner mean — the exact float `widget.ts`'s heatmap keys its density map on", () => {
    // A quad whose corners are 0/0/0/400: the 4-corner mean is 100 and the
    // default `"surface-median"` is the level that halves the drawn surface's
    // area, ~74.7 m (closed form: 400t where t(1 - ln t) = 1/2). The two
    // statistics must be distinguishable here, or this test would pass
    // against either implementation.
    const tile: GlyphMapGeoTile = {
      bounds: { west: 0, east: 1, south: 0, north: 1 },
      cols: 1,
      rows: 1,
      elevation: Float32Array.from([0, 0, 0, 400]),
      source: "synthetic",
      sampler: "nearest",
    };
    const seen: number[] = [];
    glyphMapPolygons(tile, glyphMapGlobe(), { colorSample: "corner-mean", color: (e) => { seen.push(e); return undefined; } });
    expect(seen).toEqual([100]);

    const surface: number[] = [];
    glyphMapPolygons(tile, glyphMapGlobe(), { color: (e) => { surface.push(e); return undefined; } });
    expect(surface).toHaveLength(1);
    // Within 2% of the closed form above, and nowhere near the corner mean —
    // which is all the heatmap's `Map` key needs (`widget.ts`).
    expect(surface[0]!).toBeGreaterThan(73);
    expect(surface[0]!).toBeLessThan(76);
  });

  it("leaves polygons uncolored when no color callback is given", () => {
    const tile = makeTile({ west: 0, east: 1, south: 0, north: 1 }, 1, 1, () => 0);
    const polygons = glyphMapPolygons(tile, glyphMapGlobe());
    expect(polygons[0].color).toBeUndefined();
  });

  it("resolution matching the tile's own grid is byte-identical to omitting it — the guarantee that the coarsening path never touches the default render", () => {
    // Real-shaped tile (the baked pyramid's 180x90) with genuinely varying
    // relief, so an off-by-one in the index mapping cannot hide behind a
    // flat field, plus a color callback and a projection with a real crop
    // window in play.
    const tile = makeTile({ west: -30, east: 40, south: 20, north: 60 }, 180, 90, (lon, lat) => Math.sin(lon / 7) * 900 + Math.cos(lat / 5) * 1300);
    const opts = { color: (e: number) => (e > 0 ? "#00ff00" : "#0000ff") };
    for (const projection of [glyphMapGlobe({ exaggeration: 20 }), glyphMapEquirectangular(), glyphMapMercator()]) {
      const base = glyphMapPolygons(tile, projection, opts);
      const explicit = glyphMapPolygons(tile, projection, { ...opts, resolution: { cols: tile.cols, rows: tile.rows } });
      expect(explicit).toEqual(base);
      // Also: asking for MORE than the tile has never upsamples. Length
      // first so a regression fails on a cheap scalar rather than on a
      // deep-equality diff of tens of thousands of polygons.
      const oversized = glyphMapPolygons(tile, projection, { ...opts, resolution: { cols: 360, rows: 180 } });
      expect(oversized.length).toBe(base.length);
      expect(oversized).toEqual(base);
    }
  });

  it("a coarse resolution emits that many quads and still spans the tile's full bounds — no shrunken outer ring, no hole at the tile boundary", () => {
    const bounds = { west: -30, east: 40, south: 20, north: 60 };
    const tile = makeTile(bounds, 180, 90, (lon, lat) => Math.sin(lon / 7) * 900 + Math.cos(lat / 5) * 1300);
    const projection = glyphMapEquirectangular();
    const coarse = glyphMapPolygons(tile, projection, { resolution: { cols: 30, rows: 15 } });
    expect(coarse.length).toBe(30 * 15);
    expect(coarse.length).toBeLessThan(glyphMapPolygons(tile, projection).length);
    // The outer ring lands exactly on the tile's own corners: the NW corner
    // of quad (0,0) and the SE corner of the last quad are the tile's own
    // extreme vertices, so the coarse mesh covers precisely the same ground
    // as the full-resolution one (a stride that failed to divide the grid
    // would fall short of the east/south edge and leave a crack there).
    const cornerNw = coarse[0].vertices;
    const cornerSe = coarse[coarse.length - 1].vertices;
    const all = [...cornerNw, ...cornerSe];
    expect(all).toContainEqual(projection.project(bounds.west, bounds.north, tile.elevation[0]));
    expect(all).toContainEqual(projection.project(bounds.east, bounds.south, tile.elevation[tile.elevation.length - 1]));
  });

  it("two horizontally adjacent tiles at the SAME resolution produce bit-identical vertices along their shared edge (the no-cracks guarantee)", () => {
    // Same baked grid shape, adjacent bounds, and — as the baker
    // guarantees — the same elevation value at the shared vertices.
    const elev = (lon: number, lat: number): number => Math.sin(lon / 3) * 1500 + lat * 11;
    const west = makeTile({ west: 0, east: 20, south: 0, north: 20 }, 180, 90, elev);
    const east = makeTile({ west: 20, east: 40, south: 0, north: 20 }, 180, 90, elev);
    const projection = glyphMapGlobe({ exaggeration: 20 });
    for (const resolution of [undefined, { cols: 45, rows: 23 }, { cols: 30, rows: 15 }, { cols: 7, rows: 4 }]) {
      const w = glyphMapPolygons(west, projection, resolution ? { resolution } : {});
      const e = glyphMapPolygons(east, projection, resolution ? { resolution } : {});
      const qCols = resolution ? resolution.cols : west.cols;
      const qRows = resolution ? resolution.rows : west.rows;
      // West tile's LAST column: each quad's [ne, se] corners lie on the seam.
      // East tile's FIRST column: each quad's [nw, sw] corners do.
      for (let r = 0; r < qRows; r++) {
        const wq = w[r * qCols + (qCols - 1)].vertices;
        const eq = e[r * qCols].vertices;
        // Winding may be either [nw, sw, se, ne] or its reverse; compare the
        // seam corners as a set of positions rather than by fixed index.
        const wSorted = [...wq].map((v) => v.join(",")).sort();
        const eSorted = [...eq].map((v) => v.join(",")).sort();
        const shared = wSorted.filter((v) => eSorted.includes(v));
        expect(shared.length).toBe(2);
      }
    }
  });

  it("MISMATCHED resolutions across a shared edge do NOT share vertices — which is why the widget resolves resolution per pyramid LEVEL, not per tile", () => {
    const elev = (lon: number, lat: number): number => Math.sin(lon / 3) * 1500 + lat * 11;
    const west = makeTile({ west: 0, east: 20, south: 0, north: 20 }, 180, 90, elev);
    const east = makeTile({ west: 20, east: 40, south: 0, north: 20 }, 180, 90, elev);
    const projection = glyphMapGlobe({ exaggeration: 20 });
    const w = glyphMapPolygons(west, projection, { resolution: { cols: 30, rows: 15 } });
    const e = glyphMapPolygons(east, projection, { resolution: { cols: 20, rows: 10 } });
    const wSeam = new Set(w.flatMap((p) => p.vertices.map((v) => v.join(","))));
    const eSeam = e.flatMap((p) => p.vertices.map((v) => v.join(",")));
    // The coarser tile's seam vertices are NOT all present in the finer
    // tile's — the T-junction gap a per-tile policy would open.
    expect(eSeam.some((v) => !wSeam.has(v))).toBe(true);
  });

  it("recomputes winding from the COARSE quad's own corners, not inherited from a fine one", () => {
    const up: Vec3 = [0, 0, 1];
    const tile = makeTile({ west: 10, east: 30, south: 10, north: 30 }, 180, 90, (lon, lat) => lon * 40 + lat * 25);
    for (const projection of [glyphMapEquirectangular(), glyphMapMercator()]) {
      for (const polygon of glyphMapPolygons(tile, projection, { resolution: { cols: 9, rows: 5 } })) {
        const [v0, v1, v2, v3] = polygon.vertices;
        expect(dot(cross(sub(v1, v0), sub(v2, v0)), up)).toBeGreaterThan(0);
        expect(dot(cross(sub(v2, v0), sub(v3, v0)), up)).toBeGreaterThan(0);
      }
    }
  });

  it("still crops (never clamps) a coarse quad whose own corner leaves the projection's valid window", () => {
    const tile = makeTile({ west: 0, east: 10, south: 80, north: 90 }, 180, 90, () => 0);
    const coarse = glyphMapPolygons(tile, glyphMapMercator(), { resolution: { cols: 10, rows: 5 } });
    expect(coarse.length).toBeGreaterThan(0);
    expect(coarse.length).toBeLessThan(10 * 5);
    for (const p of coarse) for (const v of p.vertices) expect(v.every((c) => Number.isFinite(c))).toBe(true);
  });

  it("crops (skips) a quad with any corner outside the projection's valid window, never clamping", () => {
    // A tile straddling Mercator's ±85.0511° cutoff: the northern row of
    // quads has at least one corner beyond the limit.
    const tile = makeTile({ west: 0, east: 10, south: 80, north: 90 }, 2, 2, () => 0);
    const mercator = glyphMapMercator();
    const polygons = glyphMapPolygons(tile, mercator);
    // Only the southernmost row (2 quads) stays fully inside [80, 85.0511...].
    expect(polygons.length).toBeLessThan(2 * 2);
    for (const p of polygons) {
      for (const v of p.vertices) {
        expect(v.every((c) => Number.isFinite(c))).toBe(true);
      }
    }
  });
});
