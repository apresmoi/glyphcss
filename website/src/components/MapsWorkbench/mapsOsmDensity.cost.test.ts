// @vitest-environment happy-dom
/**
 * What per-row density on the OpenStreetMap card actually COSTS, through the
 * real widget and the real scene — because the two halves of the answer are
 * opposite and the card has to say so where the reader is choosing.
 *
 *  - **The mesh rows are free.** `fill` and `fill-extrusion` mount a mesh
 *    each, and `glyphMapMeshTransform` gives every one of them its own
 *    `GlyphMeshTransform.density` with NO `detailGroup` (only a `raster`
 *    layer's tiles are grouped, `widget.ts`). glyphcss separates a mesh
 *    carrying a density into its own `<pre>` per MESH, so water at 2x and
 *    buildings at 3x is exactly as many passes as both at 2x — the
 *    separation already happened the moment either left 1x.
 *  - **The stroke rows are not.** `line` layers own no mesh; they are
 *    stamped post-raster into a full-viewport overlay grid, and
 *    `syncViewportOverlayDensities` routes the set of DISTINCT stroke
 *    densities to `scene.setViewportOverlayDensities`. That set is what
 *    creates grids, so three stroke rows sharing one number cost ONE overlay
 *    and three holding different numbers cost THREE — each with its own
 *    geometry depth pass.
 *
 * Both are asserted against `pre[data-glyph-overlay-density]`, the scene's
 * own record of how many overlay grids it is rendering.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { createGlyphMap, glyphMapEquirectangular, type GlyphMapHandle } from "@glyphcss/maps";
import { createOsmSource, mapOsmDensityRecord, mapOsmLayers } from "./mapsOsm";

const COLS = 80;
const ROWS = 40;
/** The card's three `line` rows — the ones that pay. */
const STROKE_ROWS = ["omt-waterways", "omt-roads", "omt-boundaries"] as const;
/** Two mesh rows: a `fill` and a `fill-extrusion`. */
const MESH_ROWS = ["omt-water", "omt-buildings"] as const;

const hosts: HTMLElement[] = [];
const maps: GlyphMapHandle[] = [];

/** Nothing here fetches: an empty payload decodes to an empty tile, and the overlay set is a function of the MOUNTED LAYERS, not of their data. */
const emptyTiles = () => createOsmSource({ fetchTile: async () => new ArrayBuffer(0), onError: () => {} });

function mount(): GlyphMapHandle {
  const host = document.createElement("div");
  document.body.appendChild(host);
  hosts.push(host);
  const map = createGlyphMap(host, {
    view: { center: [0, 20], span: 140, cols: COLS, rows: ROWS },
    projection: glyphMapEquirectangular(),
    tilt: 0,
  });
  maps.push(map);
  return map;
}

function overlayDensities(map: GlyphMapHandle): number[] {
  map.scene.rerender();
  const host = map.scene.output.parentElement!;
  return Array.from(host.querySelectorAll("pre[data-glyph-overlay-density]"))
    .map((pre) => Number(pre.getAttribute("data-glyph-overlay-density")))
    .sort((a, b) => a - b);
}

function mountRows(map: GlyphMapHandle, enabled: readonly string[], densities: Record<string, number>): void {
  for (const layer of mapOsmLayers(emptyTiles(), { enabled: [...enabled], densities })) map.addLayer(layer);
}

afterEach(() => {
  for (const map of maps.splice(0)) map.destroy();
  for (const host of hosts.splice(0)) host.remove();
  vi.restoreAllMocks();
});

describe("stroke rows: one overlay grid per DISTINCT density", () => {
  it("three stroke rows at 1x cost no overlay at all", () => {
    const map = mount();
    mountRows(map, STROKE_ROWS, mapOsmDensityRecord(1));
    expect(overlayDensities(map)).toEqual([]);
  });

  it("three stroke rows sharing ONE density cost ONE overlay grid", () => {
    const map = mount();
    mountRows(map, STROKE_ROWS, mapOsmDensityRecord(2));
    expect(overlayDensities(map)).toEqual([2]);
  });

  it("three stroke rows holding THREE distinct densities cost THREE overlay grids", () => {
    const map = mount();
    mountRows(map, STROKE_ROWS, {
      ...mapOsmDensityRecord(1),
      "omt-waterways": 2,
      "omt-roads": 3,
      "omt-boundaries": 4,
    });
    expect(overlayDensities(map)).toEqual([2, 3, 4]);
  });

  it("two of three agreeing costs two, not three — it is the SET that is charged for", () => {
    const map = mount();
    mountRows(map, STROKE_ROWS, {
      ...mapOsmDensityRecord(1),
      "omt-waterways": 2,
      "omt-roads": 2,
      "omt-boundaries": 4,
    });
    expect(overlayDensities(map)).toEqual([2, 4]);
  });
});

describe("mesh rows: differing densities add no grid the shared one did not", () => {
  it("a fill and an extrusion at DIFFERENT densities create no viewport overlay, exactly as at the same one", () => {
    const same = mount();
    mountRows(same, MESH_ROWS, mapOsmDensityRecord(2));
    const different = mount();
    mountRows(different, MESH_ROWS, { ...mapOsmDensityRecord(1), "omt-water": 2, "omt-buildings": 3 });
    // A mesh row never asks for a viewport overlay — its resolution rides on
    // its own `<pre>`, which it already had the moment it left 1x.
    expect(overlayDensities(same)).toEqual([]);
    expect(overlayDensities(different)).toEqual([]);
  });
});
