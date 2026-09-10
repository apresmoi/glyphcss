/**
 * Per-LAYER glyph palette (`GlyphMapRasterLayer.glyphPalette` and the other
 * mesh-backed layer types') — the CHARACTER ramp a layer shades with, which
 * is a different axis from a raster layer's elevation-band COLOUR ramp
 * (`colors`). The mechanism is glyphcss's own per-mesh
 * `GlyphMeshTransform.glyphPalette` (AGENTS.md's "Per-mesh detail layers"),
 * reached through `glyphMapMeshTransform`.
 *
 * The COST GATE comes first, and it is sharper here than for `renderMode`:
 * glyphcss's own `isDetailMesh` separates on ANY non-null `glyphPalette`
 * (`createGlyphScene.ts` — an unrecognized name resolves to the default ramp,
 * so glyphcss will not compare two names for equality in general), and a
 * separated OPAQUE layer costs a whole-scene `computeOcclusionIds` raster
 * (bench/maps-render measured +8.8 ms/frame for a one-quad overlay). The
 * escape is available HERE because `@glyphcss/maps` can compare the layer's
 * choice against the scene's own live `glyphPalette`: equal names always mean
 * one ramp, known or not, so `glyphMapMeshTransform` simply does not set the
 * per-mesh option in that case and the layer stays in the shared base grid.
 *
 * `stubMonospaceMetrics` is load-bearing, same reason as
 * `widget.renderMode.test.ts`'s: with no layout the cell probes report 8x16
 * while the camera falls back to `BASE_TILE / cellAspect`, over-zooming every
 * detail layer until its silhouette falls off its own grid and renders BLANK
 * — which would pass "the base grid has no block glyphs" for the wrong reason.
 */
import { describe, expect, it, vi, afterEach } from "vitest";
import { createGlyphMap } from "./widget";
import { glyphMapEquirectangular } from "./projection";
import type { GlyphMapGeoTile } from "./tile";

const BASE_FONT_PX = 16;
const CELL_W = 25;
const CELL_H = 50;
const VIEW_COLS = 60;
const VIEW_ROWS = 24;
/** Above the terrain fixture's own relief — see `modelPolygons`. */
const MODEL_Z = 2;
/**
 * `blocks`' solid ramp (`packages/glyphcss/src/render/ramps.ts`) minus its
 * blank step. Disjoint from `default`'s `" .:-=+*#%@"`, which is what lets a
 * grid be attributed to one ramp or the other by inspection.
 */
const BLOCKS_GLYPHS = /[░▒▓▌▐█▀▄■]/;

const EMPTY_RECT = { width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0, x: 0, y: 0, toJSON: () => ({}) } as DOMRect;

function rect(width: number, height: number): DOMRect {
  return { width, height, top: 0, left: 0, right: width, bottom: height, x: 0, y: 0, toJSON: () => ({}) } as DOMRect;
}

const stubbedHosts = new Set<HTMLElement>();

/** See `widget.renderMode.test.ts`'s own copy for what each branch answers and why. */
function stubMonospaceMetrics(host: HTMLElement): void {
  stubbedHosts.add(host);
  if (vi.isMockFunction(Element.prototype.getBoundingClientRect)) return;
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
    const el = this as HTMLElement;
    if (stubbedHosts.has(el)) return rect(VIEW_COLS * CELL_W, VIEW_ROWS * CELL_H);
    if (el.tagName !== "PRE" || !/visibility:\s*hidden/.test(el.style.cssText)) return EMPTY_RECT;
    const fontPx = parseFloat(/font-size:\s*([\d.]+)px/.exec(el.style.cssText)?.[1] ?? String(BASE_FONT_PX));
    const k = fontPx / BASE_FONT_PX;
    const lines = (el.textContent ?? "").split("\n").length || 1;
    return rect(CELL_W * k, CELL_H * k * lines);
  });
}

afterEach(() => {
  document.body.innerHTML = "";
  stubbedHosts.clear();
  vi.restoreAllMocks();
});

function makeTile(cols: number, rows: number, elev: number): GlyphMapGeoTile {
  const elevation = new Float32Array((cols + 1) * (rows + 1)).fill(elev);
  return { bounds: { west: -18, east: 18, south: -12, north: 12 }, cols, rows, elevation, source: "synthetic", sampler: "nearest" };
}

/** Front-facing toward a `tilt: 0` sheet camera, strictly above the terrain relief — `widget.renderMode.test.ts`'s own fixture, same reasoning. */
function modelPolygons(): { vertices: [number, number, number][]; color: string }[] {
  return [{ vertices: [[-4, -4, MODEL_Z], [4, -4, MODEL_Z], [4, 4, MODEL_Z], [-4, 4, MODEL_Z]], color: "#38bdf8" }];
}

function mount(sceneGlyphPalette?: string) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  stubMonospaceMetrics(host);
  const map = createGlyphMap(host, {
    view: { center: [0, 0], span: 40, cols: VIEW_COLS, rows: VIEW_ROWS },
    projection: glyphMapEquirectangular(),
    tilt: 0,
    ...(sceneGlyphPalette !== undefined ? { scene: { glyphPalette: sceneGlyphPalette } } : {}),
  });
  return { host, map };
}

function detailPres(host: HTMLElement): HTMLPreElement[] {
  return Array.from(host.querySelectorAll("pre.glyph-output--detail"));
}

function nonBlankRatio(text: string): number {
  const cells = text.replace(/\n/g, "");
  if (cells.length === 0) return 0;
  let filled = 0;
  for (const ch of cells) if (ch !== " ") filled++;
  return filled / cells.length;
}

async function settle(map: { scene: { output: HTMLElement; rerender: () => void } }): Promise<string> {
  await vi.waitFor(() => expect(map.scene.output.textContent ?? "").not.toBe(""));
  map.scene.rerender();
  return map.scene.output.textContent ?? "";
}

describe("per-layer glyphPalette — a layer that wants the scene's ramp costs nothing", () => {
  it("no glyphPalette and glyphPalette: \"default\" render the same bytes in the same single <pre>", async () => {
    const a = mount();
    a.map.addLayer({ type: "raster", id: "terrain", source: makeTile(6, 6, 3_000_000) });
    const omitted = await settle(a.map);

    const b = mount();
    // The widget's scene palette is glyphcss's own default, so this is the
    // layer declaring exactly the ramp it was already going to get.
    b.map.addLayer({ type: "raster", id: "terrain", source: makeTile(6, 6, 3_000_000), glyphPalette: "default" });
    const declared = await settle(b.map);

    expect(nonBlankRatio(omitted)).toBeGreaterThan(0.2);
    expect(declared).toBe(omitted);
    expect(detailPres(a.host).length).toBe(0);
    expect(detailPres(b.host).length).toBe(0);

    a.map.destroy();
    b.map.destroy();
  });

  it("compares against the SCENE's live palette, not a hardcoded \"default\"", async () => {
    // The scene itself is on `blocks`, so a layer asking for `blocks` is the
    // free case here and a layer asking for `default` is the paying one —
    // the exact inverse of the test above.
    const same = mount("blocks");
    same.map.addLayer({ type: "raster", id: "terrain", source: makeTile(6, 6, 3_000_000), glyphPalette: "blocks" });
    const sameText = await settle(same.map);
    expect(BLOCKS_GLYPHS.test(sameText)).toBe(true);
    expect(detailPres(same.host).length).toBe(0);

    const diff = mount("blocks");
    diff.map.addLayer({ type: "raster", id: "terrain", source: makeTile(6, 6, 3_000_000), glyphPalette: "default" });
    await settle(diff.map);
    expect(detailPres(diff.host).length).toBe(1);

    same.map.destroy();
    diff.map.destroy();
  });
});

describe("per-layer glyphPalette — a different ramp renders that layer under it", () => {
  it("a blocks-ramp model layer shades its own <pre> while terrain keeps the scene ramp in the base grid", async () => {
    const { host, map } = mount();
    map.addLayer({ type: "raster", id: "terrain", source: makeTile(6, 6, 3_000_000) });
    map.addLayer({ type: "model", id: "overlay", polygons: modelPolygons(), glyphPalette: "blocks" });
    await settle(map);

    const pres = detailPres(host);
    expect(pres.length).toBe(1);
    const detail = pres[0]!.textContent ?? "";
    expect(BLOCKS_GLYPHS.test(detail)).toBe(true);
    // Solid, not an outline — the ramp changed, the render mode did not.
    expect(nonBlankRatio(detail)).toBeGreaterThan(0.5);

    // The scene's own ramp never leaks the overlay's glyphs into the base grid.
    const base = map.scene.output.textContent ?? "";
    expect(nonBlankRatio(base)).toBeGreaterThan(0.2);
    expect(BLOCKS_GLYPHS.test(base)).toBe(false);

    map.destroy();
  });

  it("the SAME model layer joins the base pass when it declares no ramp — the palette is what separated it", async () => {
    const { host, map } = mount();
    map.addLayer({ type: "raster", id: "terrain", source: makeTile(6, 6, 3_000_000) });
    map.addLayer({ type: "model", id: "overlay", polygons: modelPolygons() });
    await settle(map);

    expect(detailPres(host).length).toBe(0);
    map.destroy();
  });
});
