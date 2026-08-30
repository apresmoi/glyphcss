import { describe, expect, it, vi } from "vitest";
import { createGlyphMap } from "./widget";
import { glyphMapEquirectangular } from "./projection";
import type { GlyphMapGeoTile } from "./tile";
import type { GlyphMapField } from "./types";
import type { GlyphMapVectorFeature, GlyphMapVectorFeatureCollection } from "./vector/types";
import type { GlyphMapProvider } from "./provider";

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
    // Straight top-down (tilt 0): relief (world Z) affects depth only,
    // never screen
    // X/Y — keeps the occlusion test's column/row expectations exact.
    tilt: 0,
    ...overrides,
  });
  return { host, map };
}

function rowText(map: ReturnType<typeof createGlyphMap>, row: number): string {
  const lines = (map.scene.output.textContent ?? "").split("\n");
  return lines[row] ?? "";
}

describe("createGlyphMap — line layer (end-to-end through the real rasterizer)", () => {
  it("gate 1, end-to-end: a border behind a raised ridge mesh is occluded mid-segment, visible on both flanks", async () => {
    const { host, map } = mount();
    const line: GlyphMapVectorFeature = {
      id: "equator",
      rings: [[[-18, 0], [18, 0]]],
    };
    const source: GlyphMapVectorFeatureCollection = { features: [line] };
    map.addLayer({ type: "line", id: "border", source, color: "#ff0000" });

    // A raised ridge covering the middle third of the line's own longitude span.
    const ridge = makeTile({ west: -6, east: 6, south: -20, north: 20 }, 4, 4, 2_000_000);
    map.addLayer({ type: "raster", id: "ridge", source: ridge });

    await vi.waitFor(() => expect(map.scene.output.textContent ?? "").not.toBe(""));
    // Let the debounced tile update / re-render settle.
    await new Promise((r) => setTimeout(r, 50));
    map.scene.rerender();

    const centerRow = 12; // view center row (rows=24)
    const text = rowText(map, centerRow);
    expect(text.length).toBeGreaterThan(0);

    // Column mapping: span 40 over cols 60 -> lon -20..20 maps to col 0..60.
    const colFor = (lon: number) => Math.round(((lon + 20) / 40) * 60);
    const westFlank = text.slice(colFor(-16), colFor(-8));
    const underRidge = text.slice(colFor(-3), colFor(3));
    const eastFlank = text.slice(colFor(8), colFor(16));

    // The line's own ink glyphs (a horizontal stroke) appear on both
    // flanks. Under the ridge, the terrain mesh's OWN solid glyphs win
    // the depth test instead — the cell is not blank (the mesh still
    // renders), but none of the LINE'S ink glyphs appear there.
    const inkGlyphs = new Set(["\u203e", "\u2594", "-", "_", "\u258f", "|", "\u2595"]);
    expect([...westFlank].some((c) => inkGlyphs.has(c))).toBe(true);
    expect([...underRidge].some((c) => inkGlyphs.has(c))).toBe(false);
    expect([...eastFlank].some((c) => inkGlyphs.has(c))).toBe(true);

    map.destroy();
    host.remove();
  });

  it("a line layer with no occluding geometry draws its full path", () => {
    const { host, map } = mount();
    const line: GlyphMapVectorFeature = { id: "meridian", rings: [[[0, -18], [0, 18]]] };
    map.addLayer({ type: "line", source: { features: [line] }, color: "#00ff00" });
    map.scene.rerender();
    const text = map.scene.output.textContent ?? "";
    expect([...text].some((c) => c !== " " && c !== "\n")).toBe(true);
    map.destroy();
    host.remove();
  });

  it("removing the only stroke layer restores byte-identical (no-hook) rendering", () => {
    const { host, map } = mount();
    const withoutLine = map.scene.output.textContent;
    const id = map.addLayer({ type: "line", source: { features: [{ rings: [[[0, -18], [0, 18]]] }] } });
    map.scene.rerender();
    const withLine = map.scene.output.textContent;
    expect(withLine).not.toBe(withoutLine);

    map.removeLayer(id);
    map.scene.rerender();
    expect(map.scene.output.textContent).toBe(withoutLine);
    map.destroy();
    host.remove();
  });
});

describe("createGlyphMap — contour layer (end-to-end)", () => {
  it("draws contour ink for a field with real variation", () => {
    const { host, map } = mount();
    const cols = 20;
    const rows = 20;
    const values = new Float32Array(cols * rows);
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const dx = col - cols / 2;
        const dy = row - rows / 2;
        values[row * cols + col] = 1000 * Math.exp(-(dx * dx + dy * dy) / (2 * 5 * 5));
      }
    }
    const field: GlyphMapField = {
      bounds: { west: -18, east: 18, south: -18, north: 18 },
      cols,
      rows,
      values,
      noData: new Uint8Array(cols * rows),
      kind: "continuous",
      min: 0,
      max: 1000,
    };
    // A background raster tile so the base grid has SOMETHING rendered
    // (contour only annotates already-covered cells).
    map.addLayer({ type: "raster", source: makeTile({ west: -18, east: 18, south: -18, north: 18 }, 4, 4, 0) });
    map.addLayer({ type: "contour", source: field, levels: [500], color: "#00aaff" });
    map.scene.rerender();
    const text = map.scene.output.textContent ?? "";
    expect([...text].some((c) => c !== " " && c !== "\n")).toBe(true);
    map.destroy();
    host.remove();
  });
});

describe("createGlyphMap — attribution (derived from mounted layers)", () => {
  it("getAttributions aggregates and deduplicates across raster + line layers", () => {
    const { host, map } = mount();
    const provider: GlyphMapProvider = {
      id: "test-raster",
      zooms: [{ z: 0, cols: 1, rows: 1, tileLonSpan: 360, tileLatSpan: 180, tileCols: 4, tileRows: 4 }],
      attribution: [{ name: "NOAA NCEI", url: "https://noaa.gov", license: "Public domain", date: "2009" }],
      bounds: () => ({ west: -180, east: 180, south: -90, north: 90 }),
      async loadTile() {
        return makeTile({ west: -180, east: 180, south: -90, north: 90 }, 2, 2, 0);
      },
    };
    map.addLayer({ type: "raster", source: provider });
    map.addLayer({
      type: "line",
      source: {
        features: [],
        attribution: [{ name: "Natural Earth", url: "https://naturalearthdata.com", license: "Public domain", date: "v5.1.1" }],
      },
    });
    // A second layer citing the SAME source should not duplicate it.
    map.addLayer({
      type: "line",
      source: {
        features: [],
        attribution: [{ name: "Natural Earth", url: "https://naturalearthdata.com", license: "Public domain", date: "v5.1.1" }],
      },
    });

    const attributions = map.getAttributions();
    expect(attributions).toHaveLength(2);
    expect(attributions.map((a) => a.name).sort()).toEqual(["NOAA NCEI", "Natural Earth"]);
    map.destroy();
    host.remove();
  });

  it("returns an empty list with no attributed layers mounted", () => {
    const { host, map } = mount();
    expect(map.getAttributions()).toEqual([]);
    map.destroy();
    host.remove();
  });
});

describe("createGlyphMap — layer density (uniform field, per-type behavior)", () => {
  it("raster layer density is passed through to its mesh transform (pops into its own detail <pre>)", () => {
    const { host, map } = mount();
    map.addLayer({
      type: "raster",
      source: makeTile({ west: -18, east: 18, south: -18, north: 18 }, 4, 4, 100),
      density: 2,
    });
    map.scene.rerender();
    // A density-carrying mesh pops out into its own silhouette-fitted <pre>
    // (AGENTS.md's "Per-mesh detail layers") — more than just the base <pre>.
    const pres = map.scene.output.parentElement?.querySelectorAll("pre") ?? map.scene.output.ownerDocument.querySelectorAll("pre");
    expect(pres.length).toBeGreaterThan(1);
    map.destroy();
    host.remove();
  });

  it("line layer density !== 1 throws — reserved, not implemented", () => {
    const { host, map } = mount();
    expect(() => map.addLayer({ type: "line", source: { features: [] }, density: 2 })).toThrow(RangeError);
    map.destroy();
    host.remove();
  });

  it("contour layer density !== 1 throws — reserved, not implemented", () => {
    const { host, map } = mount();
    const field: GlyphMapField = {
      bounds: { west: -1, east: 1, south: -1, north: 1 },
      cols: 2, rows: 2,
      values: new Float32Array(4),
      noData: new Uint8Array(4),
      kind: "continuous",
      min: 0, max: 1,
    };
    expect(() => map.addLayer({ type: "contour", source: field, levels: [0.5], density: 3 })).toThrow(RangeError);
    map.destroy();
    host.remove();
  });

  it("density undefined or 1 does not throw for line/contour", () => {
    const { host, map } = mount();
    expect(() => map.addLayer({ type: "line", id: "a", source: { features: [] }, density: 1 })).not.toThrow();
    expect(() => map.addLayer({ type: "line", id: "b", source: { features: [] } })).not.toThrow();
    map.destroy();
    host.remove();
  });
});
