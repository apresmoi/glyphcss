import { describe, expect, it, vi } from "vitest";
import { createGlyphMap, glyphMapContourIntervalLevels } from "./widget";
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

const INK_GLYPHS = new Set(["‾", "▔", "-", "_", "▏", "|", "▕"]);

describe("createGlyphMap — a stroke layer crossing a raster layer's own per-mesh detail grid (density > 1)", () => {
  // Regression for a real defect: a `raster` layer mounted with `density >
  // 1` pops its mesh into its OWN silhouette-fitted `<pre>` (AGENTS.md's
  // per-mesh detail layers) and gets blanked out of the shared base grid by
  // cross-layer occlusion. Before this fix, `composedTransformCells` early-
  // returned on any detail grid ("strokes are base-grid-only"), so a
  // `line`/`contour` layer's ink never reached that `<pre>` at all — a
  // border/contour crossing a raster layer at density > 1 silently
  // vanished across that layer's ENTIRE footprint, with no error.
  //
  // Two SEPARATE uniform-elevation raster layers (rather than one mesh with
  // internal elevation variance) is a deliberate choice: `glyphMapPolygons`
  // bakes elevation into vertex Z linearly per quad, so a single mesh
  // straddling a hard elevation step renders a genuinely SMOOTH ramp across
  // the transition quad's own screen footprint — real geometry, not a
  // stroke-routing artifact, but it makes the exact col/row where the ramp
  // crosses this test's occlusion bias impossible to predict without
  // duplicating glyphcss's own rasterizer math. Two uniform meshes sidestep
  // that entirely: each one's own detail grid has NO internal elevation
  // variance, so its occlusion behavior is unambiguous — "ridge" uniformly
  // occludes its whole grid, "flat" uniformly does not.
  it("ink reaches the detail <pre> and is genuinely depth-tested there — occluded under a nearer mesh, visible over a flush one", async () => {
    const { host, map } = mount();
    const line: GlyphMapVectorFeature = { id: "equator", rings: [[[-18, 0], [18, 0]]] };
    const source: GlyphMapVectorFeatureCollection = { features: [line] };
    map.addLayer({ type: "line", id: "border", source, color: "#ff0000" });
    // Uniformly raised well above the line's own (zero) elevation — occludes
    // its whole own detail grid.
    map.addLayer({
      type: "raster", id: "ridge",
      source: makeTile({ west: -6, east: 6, south: -20, north: 20 }, 4, 4, 2_000_000),
      density: 3,
    });
    // Uniformly flush with the line's own elevation — occludes nothing.
    map.addLayer({
      type: "raster", id: "flat",
      source: makeTile({ west: 8, east: 18, south: -20, north: 20 }, 4, 4, 0),
      density: 3,
    });
    await vi.waitFor(() => expect(map.scene.output.textContent ?? "").not.toBe(""));
    await new Promise((r) => setTimeout(r, 50));
    map.scene.rerender();

    const details = Array.from(host.querySelectorAll("pre.glyph-output--detail"));
    expect(details).toHaveLength(2);

    // Before this fix, BOTH would read 0 (the early return never stamped
    // anything into any detail grid) — the "flat" grid showing real ink is
    // what proves the fix actually routes into detail grids, not merely
    // that occlusion still works somewhere. Assert over the SET rather than
    // picking a detail <pre> by mesh id — raster layers don't carry a
    // `GlyphMeshTransform.id` (`mountTile` never sets one), so there is no
    // `data-glyph-mesh-id` to key off; the point is that exactly one of the
    // two detail grids has zero ink (occluded by "ridge") and the other has
    // real ink (flush with "flat"), regardless of which DOM order they
    // mounted in.
    const rowsWithInk = (text: string): number[] =>
      text.split("\n").map((line, row) => ([...line].some((c) => INK_GLYPHS.has(c)) ? row : -1)).filter((row) => row >= 0);
    const detailRows = details.map((p) => rowsWithInk(p.textContent ?? ""));
    expect(detailRows).toContainEqual([]);

    // The affine's translation (`e`/`f`) is what a broken fix could drop
    // without an existence-only check ever noticing: the line's own swept
    // path is far wider than either detail grid, so SOME of it lands
    // in-bounds under almost any offset, and both meshes here are uniform
    // in elevation (deliberately, to sidestep a real, unrelated rasterizer
    // property — see this describe block's own doc), so occlusion doesn't
    // discriminate position either. A single flat 1-cell-wide line at a
    // fixed latitude DOES pin an exact row, though: with the affine correct
    // it lands at exactly ONE row in the "flat" grid, and — as measured
    // against the real renderer — that row is always 39 (this line crosses
    // the mesh at its own mid-height; a translation bug that drops `f`
    // measurably shifts this to row 36 instead).
    const visible = detailRows.find((rows) => rows.length > 0);
    expect(visible).toEqual([39]);

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

  it("levels: { interval } picks fixed absolute elevations, not a window-relative count", () => {
    expect(glyphMapContourIntervalLevels(500, 0, 1900)).toEqual([500, 1000, 1500]);
    // Panning to a DIFFERENT window over the SAME field keeps the shared
    // levels at the SAME absolute elevations — the whole point of an
    // interval over a count (MAPS.md's "stays stable as you pan").
    expect(glyphMapContourIntervalLevels(500, 300, 1100)).toEqual([500, 1000]);
    expect(() => glyphMapContourIntervalLevels(0, 0, 1000)).toThrow(RangeError);
  });

  it("getContourFieldRange reflects the currently resolved field, null before/without one", () => {
    const { host, map } = mount();
    expect(map.getContourFieldRange("missing")).toBeNull();
    const field: GlyphMapField = {
      bounds: { west: -18, east: 18, south: -18, north: 18 },
      cols: 4, rows: 4,
      values: new Float32Array(16),
      noData: new Uint8Array(16),
      kind: "continuous",
      min: 100, max: 900,
    };
    map.addLayer({ type: "contour", id: "c", source: field, levels: { interval: 500 } });
    expect(map.getContourFieldRange("c")).toEqual({ min: 100, max: 900 });
    map.destroy();
    host.remove();
  });
});

describe("createGlyphMap — contour layer backed by a GlyphMapProvider (re-derives on view change)", () => {
  function makeContourProvider(): GlyphMapProvider & { loadTile: ReturnType<typeof vi.fn> } {
    const loadTile = vi.fn(async (z: number, x: number, y: number) => {
      const west = -180 + x * 90;
      const north = 90 - y * 90;
      const cols = 8, rows = 8;
      const elevation = new Float32Array((cols + 1) * (rows + 1));
      // Per-tile OFFSET *and* per-tile GRADIENT. An offset alone is not
      // enough: every tile would then carry the same affine ramp, and `levels:
      // 4` resolves against the mosaic's own range, so two tiles would produce
      // the identical set of evenly spaced parallel contours and the "the
      // output changed" assertion below would have no content of its own to
      // test (it passed only on quantization noise from a since-removed
      // cell-centered field derivation). Varying the gradient DIRECTION per
      // tile makes the two contour patterns genuinely different shapes.
      const base = (x + 1) * 1000 + (y + 1) * 137;
      for (let row = 0; row <= rows; row++) {
        for (let col = 0; col <= cols; col++) {
          elevation[row * (cols + 1) + col] = base + col * 80 * (x + 1) + row * 53 * (y + 1);
        }
      }
      return { bounds: { west, east: west + 90, south: north - 90, north }, cols, rows, elevation, source: "test-provider", sampler: "nearest" };
    });
    return {
      id: "contour-test-provider",
      zooms: [{ z: 0, cols: 4, rows: 2, tileLonSpan: 90, tileLatSpan: 90, tileCols: 8, tileRows: 8 }],
      bounds(z, x, y) {
        const west = -180 + x * 90;
        const north = 90 - y * 90;
        return { west, east: west + 90, south: north - 90, north };
      },
      loadTile,
    };
  }

  it("re-derives its field (and the stamped output) after a setView that changes the visible tile", async () => {
    const { host, map } = mount({ view: { center: [-135, 45], span: 20, cols: 60, rows: 24 } });
    const provider = makeContourProvider();
    // A background raster tile covering the whole domain so `requireSurface`
    // never blanks the contour purely for lack of an opaque base.
    map.addLayer({ type: "raster", source: makeTile({ west: -180, east: 180, south: -90, north: 90 }, 4, 4, 0) });
    map.addLayer({ type: "contour", source: provider, levels: 4, color: "#00aaff" });
    await vi.waitFor(() => expect(provider.loadTile).toHaveBeenCalledTimes(1));
    map.scene.rerender();
    const before = map.scene.output.textContent;

    // Pan far enough that the view center now resolves to a DIFFERENT tile
    // (x: 0 -> 3, y: 0 -> 1 at z=0, tileLonSpan/tileLatSpan 90).
    map.setView({ center: [135, -45] });
    await vi.waitFor(() => expect(provider.loadTile).toHaveBeenCalledTimes(2), { timeout: 1000 });
    expect(provider.loadTile).toHaveBeenLastCalledWith(0, 3, 1);
    map.scene.rerender();
    const after = map.scene.output.textContent;

    expect(after).not.toBe(before);
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

  it("a density-3 contour gets a viewport overlay three times finer than density-1 terrain, while a co-routed stroke stays occluded behind a ridge", async () => {
    const { host, map } = mount();
    const terrain = makeTile({ west: -18, east: 18, south: -18, north: 18 }, 8, 8, 0);
    const ridge = makeTile({ west: -5, east: 5, south: -18, north: 18 }, 4, 4, 2_000_000);
    map.addLayer({ type: "raster", id: "terrain", source: terrain, density: 1 });
    map.addLayer({ type: "raster", id: "ridge", source: ridge, density: 1 });

    const field: GlyphMapField = {
      bounds: { west: -18, east: 18, south: -18, north: 18 },
      cols: 36, rows: 36,
      values: Float32Array.from({ length: 36 * 36 }, (_, index) => index % 36),
      noData: new Uint8Array(36 * 36),
      kind: "continuous",
      min: 0, max: 35,
    };
    // Level 24 crosses at lon 6 (`values[col] = col`, field bounds -18..18
    // over 36 cols, so col == lon + 18): just east of the ridge's own east
    // edge (lon 5) and short of the east-flank assertion's own window
    // (lon 8..15) below. `stampGlyphMapContour` is intentionally NOT
    // depth-tested against a nearer occluding mesh (`stroke.ts`'s own doc:
    // "this needs no depth test of its own... not an independent 3D object
    // that could be nearer or farther than the terrain" — pinned by
    // `stroke.test.ts`'s "skips cells with no rendered surface" suite), so a
    // level whose crossing landed UNDER the ridge would draw right through
    // it regardless of occlusion — a false failure of the LINE layer's own
    // occlusion assertion below, not a defect in either layer. Level 24
    // keeps the contour's own ink out of all three checked windows so this
    // test isolates what its own name describes: the CO-ROUTED LINE's
    // occlusion, on an overlay the contour merely shares.
    map.addLayer({ type: "contour", id: "contours", source: field, levels: [24], density: 3, color: "#00aaff" });
    map.addLayer({
      type: "line",
      id: "equator",
      source: { features: [{ rings: [[[-16, 0], [16, 0]]] }] },
      density: 3,
      color: "#ff0000",
    });

    await vi.waitFor(() => expect(host.querySelector("pre[data-glyph-overlay-density='3']")).not.toBeNull());
    map.scene.rerender();

    const overlay = host.querySelector("pre[data-glyph-overlay-density='3']") as HTMLPreElement;
    const overlayRows = (overlay.textContent ?? "").split("\n");
    expect(overlayRows).toHaveLength(24 * 3);
    expect(overlayRows[0]).toHaveLength(60 * 3);

    const equator = overlayRows[12 * 3] ?? "";
    const colFor = (lon: number) => Math.round(((lon + 20) / 40) * 60 * 3);
    expect([...equator.slice(colFor(-15), colFor(-8))].some((char) => INK_GLYPHS.has(char))).toBe(true);
    expect([...equator.slice(colFor(-3), colFor(3))].some((char) => INK_GLYPHS.has(char))).toBe(false);
    expect([...equator.slice(colFor(8), colFor(15))].some((char) => INK_GLYPHS.has(char))).toBe(true);

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
