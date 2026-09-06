/**
 * No black seam along a raster layer's TILE BOUNDARIES at `density > 1`.
 *
 * The report: on `/maps` in globe mode, with borders off and only the terrain
 * raster layer mounted, raising the Terrain density draws a regular grid of
 * horizontal and vertical black lines between the tile blocks.
 *
 * `GlyphMapRasterLayer.density` passes straight through to glyphcss's per-mesh
 * `density`, and a raster layer mounts ONE MESH PER TILE — so at `density > 1`
 * every visible tile pops into its OWN silhouette-fitted `<pre>` and adjacent
 * tiles composite through the shared cross-layer occlusion id-map instead of
 * one depth buffer. That id-map is rasterized at the BASE grid's resolution,
 * so tile ownership is decided per BASE cell while coverage is decided per
 * DETAIL cell: the base cell straddling a shared edge goes to exactly one
 * tile, and its neighbour blanks every detail cell it owns inside that base
 * cell — including the ones the winner does not cover. Nothing paints those.
 * Measured here before the fix: a median 0.75-base-cell gap over ~1,500 runs
 * per frame, in both axes, at density 1.4 AND at 2 and 3 (it was never
 * specific to a fractional density). `OcclusionMap.depth`'s sub-cell
 * refinement in glyphcss is the fix; this pins the behaviour from the map's
 * own side, which is the side the report came from.
 *
 * Fixture notes:
 *  - happy-dom has no layout, so `stubMonospaceMetrics` gives the hidden cell
 *    probes a real advance; without it every detail layer measures a
 *    zero-width cell and never renders at all.
 *  - The provider ships exactly ONE zoom level, so there is no permanent
 *    floor tier and no coarse fallback tier. Every mounted mesh is a
 *    same-level sibling and the only boundaries in the frame are tile-vs-tile
 *    ones — which is what isolates this from a cross-LOD crack.
 *  - Assertions name the EXACT boundary points (projected through the
 *    widget's own `project`), never an ink count across a whole row: a
 *    row-wide count stays healthy while a one-cell-wide seam runs straight
 *    down it.
 *  - Coverage is composited at `SUBCELLS` subcells per base cell, not per
 *    base cell. The seam is NARROWER than one base cell (a measured median of
 *    0.75), so a base-cell-resolution union hides it completely: the losing
 *    tile's neighbouring detail cell spills into the same base cell and marks
 *    it painted. Verified — at base-cell resolution the mutation check below
 *    only reddened 1 of 3 densities by 1 cell; at subcell resolution it
 *    reddens all three by hundreds.
 *  - Only INTERIOR boundary points are asserted: a point whose surrounding
 *    base cells are ALL painted in the density-1 control. The globe's limb
 *    and the polar convergence are places where a finer grid legitimately
 *    resolves coverage differently from the base grid, and they are not what
 *    this test is about. The filter is on the CONTROL render alone, so it can
 *    never be tuned by what the density-N render happens to produce.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { createGlyphMap } from "./widget";
import { glyphMapGlobe } from "./projection";
import type { GlyphMapGeoTile } from "./tile";
import type { GlyphMapProvider, GlyphMapProviderZoomLevel } from "./provider";
import type { GlyphMapBounds } from "./types";

const VIEW_COLS = 120, VIEW_ROWS = 48, CELL_W = 8, CELL_H = 16, PROBE_FONT_PX = 16;
/** Subcells per base cell in the composited coverage union (see the fixture doc). */
const SUBCELLS = 8;
const SUB_COLS = VIEW_COLS * SUBCELLS, SUB_ROWS = VIEW_ROWS * SUBCELLS;

const rect = (w: number, h: number) =>
  ({ width: w, height: h, top: 0, left: 0, right: w, bottom: h, x: 0, y: 0, toJSON() {} }) as DOMRect;
const EMPTY_RECT = rect(0, 0);
const stubbedHosts = new Set<HTMLElement>();

function stubMonospaceMetrics(host: HTMLElement): void {
  stubbedHosts.add(host);
  if (vi.isMockFunction(Element.prototype.getBoundingClientRect)) return;
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
    const el = this as HTMLElement;
    if (stubbedHosts.has(el)) return rect(VIEW_COLS * CELL_W, VIEW_ROWS * CELL_H);
    if (el.tagName !== "PRE" || !/visibility:\s*hidden/.test(el.style.cssText)) return EMPTY_RECT;
    const fontPx = parseFloat(/font-size:\s*([\d.]+)px/.exec(el.style.cssText)?.[1] ?? String(PROBE_FONT_PX));
    const k = fontPx / PROBE_FONT_PX;
    const lines = (el.textContent ?? "").split("\n").length || 1;
    return rect(CELL_W * k, CELL_H * k * lines);
  });
}

afterEach(() => {
  document.body.innerHTML = "";
  stubbedHosts.clear();
  vi.restoreAllMocks();
});

const TILES_ACROSS = 4;
const VIEW_CENTER: [number, number] = [16, 64];


function levelOf(): GlyphMapProviderZoomLevel {
  return { z: 0, cols: TILES_ACROSS, rows: TILES_ACROSS, tileLonSpan: 360 / TILES_ACROSS, tileLatSpan: 180 / TILES_ACROSS, tileCols: 24, tileRows: 24 };
}
function tileBounds(level: GlyphMapProviderZoomLevel, x: number, y: number): GlyphMapBounds {
  const lonMin = -180 + x * level.tileLonSpan;
  const latMax = 90 - y * level.tileLatSpan;
  return { west: lonMin, east: lonMin + level.tileLonSpan, south: latMax - level.tileLatSpan, north: latMax };
}

/** A single-zoom pyramid: no floor tier, no fallback tier, only siblings. */
function singleLevelProvider(): GlyphMapProvider {
  const level = levelOf();
  return {
    id: "single-level",
    zooms: [level],
    bounds: (_z, x, y) => tileBounds(level, x, y),
    loadTile: (_z, x, y) => {
      const elevation = new Float32Array((level.tileCols + 1) * (level.tileRows + 1)).fill(0);
      return Promise.resolve({
        bounds: tileBounds(level, x, y), cols: level.tileCols, rows: level.tileRows,
        elevation, source: "synthetic", sampler: "nearest",
      } satisfies GlyphMapGeoTile);
    },
  };
}

interface BoundaryCell { readonly key: string; readonly lon: number; readonly lat: number; readonly col: number; readonly row: number; readonly axis: "meridian" | "parallel"; }

/** Fractional base-grid position of a projected lon/lat, plus its near-side flag. */
interface Projected { readonly col: number; readonly row: number; readonly visible: boolean; }

interface Rendered {
  /** Union of every output `<pre>`'s ink, at `SUBCELLS`x base-grid resolution. */
  readonly painted: Uint8Array;
  readonly detailCount: number;
  /** On-screen base cells lying on a tile boundary (see `sweepBoundary`). */
  readonly boundary: readonly BoundaryCell[];
}

/**
 * The on-screen base cells that every tile-boundary meridian and parallel
 * passes through. Sampled through the widget's own `project`, so the cells
 * named are the ones the seam would actually fall in, not a guess.
 */
function sweepBoundary(project: (lon: number, lat: number) => Projected): BoundaryCell[] {
  const level = levelOf();
  const out: BoundaryCell[] = [];
  const seen = new Set<string>();
  const push = (lon: number, lat: number, axis: "meridian" | "parallel") => {
    const p = project(lon, lat);
    // Keep the SUBCELL the boundary actually lands in, not the base cell.
    const col = Math.floor(p.col * SUBCELLS), row = Math.floor(p.row * SUBCELLS);
    if (!p.visible || col < 0 || col >= SUB_COLS || row < 0 || row >= SUB_ROWS) return;
    const key = `${col},${row}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ key, lon, lat, col, row, axis });
  };
  for (let x = 1; x < level.cols; x++) {
    const lon = -180 + x * level.tileLonSpan;
    for (let lat = -88; lat <= 88; lat += 1) push(lon, lat, "meridian");
  }
  for (let y = 1; y < level.rows; y++) {
    const lat = 90 - y * level.tileLatSpan;
    for (let lon = -180; lon <= 180; lon += 1) push(lon, lat, "parallel");
  }
  return out;
}

async function render(density: number): Promise<Rendered> {
  const host = document.createElement("div");
  document.body.appendChild(host);
  stubMonospaceMetrics(host);
  const map = createGlyphMap(host, {
    view: { center: VIEW_CENTER, span: 140, cols: VIEW_COLS, rows: VIEW_ROWS },
    projection: glyphMapGlobe({ exaggeration: 24 }),
    tilt: 0,
    maxSpan: 720,
  });
  map.addLayer({ type: "raster", id: "terrain", source: singleLevelProvider(), density });
  await vi.waitFor(() => expect(map.scene.output.textContent ?? "").not.toBe(""), { timeout: 5000 });
  await new Promise((r) => setTimeout(r, 120));
  map.scene.rerender();

  // The base cell size the scene actually painted with — recovered from the
  // base `<pre>`'s own font size against the stub's advance, so a detail
  // layer's CSS translate (authored in those same px) converts to base cells.
  const baseFontPx = parseFloat(/([\d.]+)px/.exec(map.scene.output.style.fontSize)?.[1] ?? String(PROBE_FONT_PX));
  const cwB = CELL_W * (baseFontPx / PROBE_FONT_PX), chB = CELL_H * (baseFontPx / PROBE_FONT_PX);

  const painted = new Uint8Array(SUB_COLS * SUB_ROWS);
  const stamp = (text: string, minC: number, minR: number, k: number) => {
    const lines = text.split("\n");
    for (let r = 0; r < lines.length; r++) {
      for (let c = 0; c < lines[r]!.length; c++) {
        if (lines[r]![c] === " ") continue;
        // Detail cell (c, r) covers the base interval [minC + c/k, minC +
        // (c+1)/k); mark every SUBCELL of that interval. Rounding (not floor/
        // ceil) keeps consecutive detail cells exactly abutting, so the
        // composite never invents a gap of its own between two cells of the
        // same grid.
        const c0 = Math.round((minC + c / k) * SUBCELLS), c1 = Math.round((minC + (c + 1) / k) * SUBCELLS);
        const r0 = Math.round((minR + r / k) * SUBCELLS), r1 = Math.round((minR + (r + 1) / k) * SUBCELLS);
        for (let sr = Math.max(0, r0); sr < Math.min(SUB_ROWS, r1); sr++) {
          for (let sc = Math.max(0, c0); sc < Math.min(SUB_COLS, c1); sc++) painted[sr * SUB_COLS + sc] = 1;
        }
      }
    }
  };
  stamp(map.scene.output.textContent ?? "", 0, 0, 1);
  const details = Array.from(host.querySelectorAll<HTMLPreElement>("pre.glyph-output--detail"));
  for (const d of details) {
    const m = /translate\(([-\d.]+)px,\s*([-\d.]+)px\)/.exec(d.style.transform);
    stamp(d.textContent ?? "", Number(m?.[1] ?? 0) / cwB, Number(m?.[2] ?? 0) / chB, density);
  }

  // Projected BEFORE teardown — `map.project` reads the live scene/camera, so
  // a closure called after `destroy()` answers nothing.
  const boundary = sweepBoundary((lon, lat) => {
    const p = map.project([lon, lat]);
    return { col: p.col, row: p.row, visible: p.visible };
  });
  const out: Rendered = { painted, detailCount: details.length, boundary };
  map.destroy();
  host.remove();
  return out;
}

/**
 * The boundary subcells the density-1 control paints AND that sit strictly
 * inside its painted region — every subcell within one whole BASE cell of them
 * is painted too. See the fixture doc: this drops the limb and the polar
 * convergence, where a finer grid may legitimately resolve coverage
 * differently, while keeping every interior tile-vs-tile boundary. Computed
 * from the CONTROL render only.
 */
function interiorBoundary(r: Rendered): readonly BoundaryCell[] {
  const solidAround = (col: number, row: number): boolean => {
    for (let dr = -SUBCELLS; dr <= SUBCELLS; dr += SUBCELLS) {
      for (let dc = -SUBCELLS; dc <= SUBCELLS; dc += SUBCELLS) {
        const rr = row + dr, cc = col + dc;
        if (rr < 0 || rr >= SUB_ROWS || cc < 0 || cc >= SUB_COLS) return false;
        if (r.painted[rr * SUB_COLS + cc] !== 1) return false;
      }
    }
    return true;
  };
  return r.boundary.filter((b) => r.painted[b.row * SUB_COLS + b.col] === 1 && solidAround(b.col, b.row));
}

describe("createGlyphMap — raster tile seams at density > 1", () => {
  // Integer densities as well as the reported 1.4: the defect reproduced
  // identically at 2 and 3, so a fix that only closed the fractional case
  // would be closing the wrong thing.
  for (const density of [1.4, 2, 3]) {
    it(`density ${density}: tile-boundary coverage the density-1 render paints is not blanked away`, async () => {
      const base = await render(1);
      // Density 1 is the control: all tiles share the base grid, so there are
      // no detail layers and no cross-layer compositing at all.
      expect(base.detailCount).toBe(0);

      const samples = interiorBoundary(base);
      // Guard the guard: if the sweep found no boundary cells the assertion
      // below would pass vacuously.
      expect(samples.length).toBeGreaterThan(60);

      // Both axes have to be represented, or a one-axis regression could hide
      // behind the other's samples.
      expect(samples.filter((s) => s.axis === "meridian").length).toBeGreaterThan(20);
      expect(samples.filter((s) => s.axis === "parallel").length).toBeGreaterThan(20);

      const hi = await render(density);
      // ONE detail output for the WHOLE layer, not one per tile: a raster
      // layer's tiles share a `detailGroup`, so there are no inter-tile
      // boundaries left inside the detail grid to seam at. This is the
      // structural half of the guarantee below — with one `<pre>` per tile it
      // was unreachable, since two abutting meshes point-sample coverage on
      // two differently-phased lattices and a sub-cell sliver at their shared
      // edge can fall inside neither.
      expect(hi.detailCount).toBe(1);

      const dropped = samples.filter((s) => hi.painted[s.row * SUB_COLS + s.col] !== 1);
      const byAxis = (axis: "meridian" | "parallel") => dropped.filter((s) => s.axis === axis).length;
      // EXACTLY zero, per axis. History: one `<pre>` per tile dropped 296 /
      // 291 / 322 of these 628 samples (densities 1.4 / 2 / 3); glyphcss's
      // sub-cell occlusion refinement took that to 105 / 75 / 77, of which
      // ~53 / 40 / 57 survived with cross-layer blanking disabled outright —
      // the second, non-occlusion mechanism. Grouping every tile of a layer
      // into ONE detail grid removes both mechanisms at once: there is no
      // second lattice and no second layer id.
      expect({ meridian: byAxis("meridian"), parallel: byAxis("parallel") }).toEqual({ meridian: 0, parallel: 0 });
    }, 30_000);
  }
});
