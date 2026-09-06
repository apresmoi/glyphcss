/**
 * Fractional `GlyphMapRasterLayer.density` — Task: `DensityRow` in
 * `website/src/components/MapsWorkbench/mapsKit.tsx` was stepped 1/2/3/4.
 * `density` is documented (AGENTS.md's "Per-mesh detail layers") as a plain
 * multiplier with no integer requirement, and glyphcss's own detail-layer
 * math (`createGlyphScene.ts`) treats it that way throughout: the
 * detail-mesh gate is `t.density != null && t.density !== 1` (any non-1
 * value, fractional included), the cell size is `baseFontPx() / density`
 * and `cwB / density` (plain division), the detail-cells-per-base-cell
 * ratio `kx`/`ky` is `cwB / cwD` (a plain ratio, not a count), and the
 * cross-layer occlusion id-map sampling (`colScale: oss / kx`) is the same
 * ratio again — nothing in that path assumes `density` is a whole number.
 * These tests verify that empirically end-to-end (cell size, silhouette
 * fit/grid sizing, and cross-layer occlusion id-map sampling) through the
 * real widget + rasterizer, the same way `widget.stroke.test.ts`'s own
 * density-3 occlusion test does — before wiring a granular step into the
 * UI.
 */
import { describe, expect, it, vi } from "vitest";
import { createGlyphMap } from "./widget";
import { glyphMapEquirectangular } from "./projection";
import type { GlyphMapGeoTile } from "./tile";
import type { GlyphMapVectorFeature, GlyphMapVectorFeatureCollection } from "./vector/types";

function makeTile(bounds: GlyphMapGeoTile["bounds"], cols: number, rows: number, elev: number): GlyphMapGeoTile {
  const elevation = new Float32Array((cols + 1) * (rows + 1)).fill(elev);
  return { bounds, cols, rows, elevation, source: "synthetic", sampler: "nearest" };
}

function mount(overrides: Partial<Parameters<typeof createGlyphMap>[1]> = {}) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const map = createGlyphMap(host, {
    view: { center: [0, 0], span: 40, cols: 60, rows: 24 },
    projection: glyphMapEquirectangular(),
    tilt: 0,
    ...overrides,
  });
  return { host, map };
}

const INK_GLYPHS = new Set(["‾", "▔", "-", "_", "▏", "|", "▕"]);

describe("createGlyphMap — fractional raster density", () => {
  it("a fractional density (0.5) pops the mesh into its own detail <pre>, exactly like an integer density does", async () => {
    const { host, map } = mount();
    map.addLayer({
      type: "raster", id: "terrain",
      source: makeTile({ west: -6, east: 6, south: -20, north: 20 }, 4, 4, 500_000),
      density: 0.5,
    });
    await vi.waitFor(() => expect(map.scene.output.textContent ?? "").not.toBe(""));
    const details = host.querySelectorAll("pre.glyph-output--detail");
    expect(details).toHaveLength(1);
    expect((details[0].textContent ?? "").length).toBeGreaterThan(0);
    map.destroy();
    host.remove();
  });

  it("density 1 stays base-grid-only (no detail <pre>) — the boundary a fractional step must not cross by accident", async () => {
    const { host, map } = mount();
    map.addLayer({
      type: "raster", id: "terrain",
      source: makeTile({ west: -6, east: 6, south: -20, north: 20 }, 4, 4, 500_000),
      density: 1,
    });
    await vi.waitFor(() => expect(map.scene.output.textContent ?? "").not.toBe(""));
    expect(host.querySelectorAll("pre.glyph-output--detail")).toHaveLength(0);
    map.destroy();
    host.remove();
  });

  it("a higher fractional density yields a finer (more columns) detail grid than a lower one, for the identical mesh/bbox", async () => {
    const tile = makeTile({ west: -6, east: 6, south: -20, north: 20 }, 4, 4, 500_000);
    const { host: hostLow, map: mapLow } = mount();
    mapLow.addLayer({ type: "raster", id: "terrain", source: tile, density: 0.5 });
    await vi.waitFor(() => expect(mapLow.scene.output.textContent ?? "").not.toBe(""));
    const detailLow = hostLow.querySelector("pre.glyph-output--detail");
    const colsLow = (detailLow?.textContent ?? "").split("\n")[0]?.length ?? 0;

    const { host: hostHigh, map: mapHigh } = mount();
    mapHigh.addLayer({ type: "raster", id: "terrain", source: tile, density: 2.5 });
    await vi.waitFor(() => expect(mapHigh.scene.output.textContent ?? "").not.toBe(""));
    const detailHigh = hostHigh.querySelector("pre.glyph-output--detail");
    const colsHigh = (detailHigh?.textContent ?? "").split("\n")[0]?.length ?? 0;

    expect(colsLow).toBeGreaterThan(0);
    expect(colsHigh).toBeGreaterThan(colsLow);

    mapLow.destroy(); hostLow.remove();
    mapHigh.destroy(); hostHigh.remove();
  });

  // Mirrors widget.stroke.test.ts's own density-3 occlusion regression
  // ("ink reaches the detail <pre> and is genuinely depth-tested there"),
  // at a NON-INTEGER density on both meshes — proving the affine
  // (`cellToSceneGrid`, `kx`/`ky`) and the occlusion id-map sampling stay
  // correct with a fractional `kx`/`ky`, not just an integer one.
  it("cross-layer occlusion between a stroke layer and a fractional-density detail mesh is still correct", async () => {
    const { host, map } = mount();
    const line: GlyphMapVectorFeature = { id: "equator", rings: [[[-18, 0], [18, 0]]] };
    const source: GlyphMapVectorFeatureCollection = { features: [line] };
    map.addLayer({ type: "line", id: "border", source, color: "#ff0000" });
    // Uniformly raised well above the line's own (zero) elevation — occludes
    // its whole own detail grid.
    map.addLayer({
      type: "raster", id: "ridge",
      source: makeTile({ west: -6, east: 6, south: -20, north: 20 }, 4, 4, 2_000_000),
      density: 2.5,
    });
    // Uniformly flush with the line's own elevation — occludes nothing.
    map.addLayer({
      type: "raster", id: "flat",
      source: makeTile({ west: 8, east: 18, south: -20, north: 20 }, 4, 4, 0),
      density: 0.5,
    });
    await vi.waitFor(() => expect(map.scene.output.textContent ?? "").not.toBe(""));
    await new Promise((r) => setTimeout(r, 50));
    map.scene.rerender();

    const details = Array.from(host.querySelectorAll("pre.glyph-output--detail"));
    expect(details).toHaveLength(2);

    const rowsWithInk = (text: string): number[] =>
      text.split("\n").map((line, row) => ([...line].some((c) => INK_GLYPHS.has(c)) ? row : -1)).filter((row) => row >= 0);
    const detailRows = details.map((p) => rowsWithInk(p.textContent ?? ""));
    // Exactly one of the two detail grids is fully occluded (the raised
    // "ridge", at density 2.5) and the other shows real ink (the flush
    // "flat" mesh, at density 0.5) — same shape the integer-density test
    // asserts, now with a fractional kx/ky on BOTH sides of the affine.
    expect(detailRows).toContainEqual([]);
    expect(detailRows.some((rows) => rows.length > 0)).toBe(true);

    map.destroy();
    host.remove();
  });
});
