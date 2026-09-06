/**
 * Per-LAYER render mode (`GlyphMapRasterLayer.renderMode` and the other
 * mesh-backed layer types') — a map is not one picture in one mode: terrain
 * reads as `solid` while an overlay reads as `ink`. The mechanism is
 * glyphcss's own per-mesh `GlyphMeshTransform.mode` (AGENTS.md's "Per-mesh
 * detail layers"), reached through `glyphMapMeshTransform`.
 *
 * The COST GATE comes first: `base-raster` is ~99% of a full-screen `/maps`
 * frame (bench/maps-render), so a layer that declares no mode — or declares
 * the mode the scene is already in — must stay in the shared base grid, one
 * pass, byte identical.
 *
 * `stubMonospaceMetrics` is load-bearing, same reason as
 * `packages/glyphcss/src/api/createGlyphScene.meshRenderMode.test.ts`'s: with
 * no layout, the cell probes report 8x16 while the camera falls back to
 * `BASE_TILE / cellAspect`, over-zooming every detail layer until an
 * outline-mode silhouette falls off its own grid and renders BLANK — which
 * would pass every "the layer is not solid" assertion for the wrong reason.
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
/** Ink's own oriented-glyph set, plus wireframe's rule glyphs. */
const STROKE_GLYPHS = /[_/\\|\-‾▔▏▕]/;

const EMPTY_RECT = { width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0, x: 0, y: 0, toJSON: () => ({}) } as DOMRect;

function rect(width: number, height: number): DOMRect {
  return { width, height, top: 0, left: 0, right: width, bottom: height, x: 0, y: 0, toJSON: () => ({}) } as DOMRect;
}

/**
 * Two elements matter here, and only two.
 *
 * `measureCellOf`'s hidden probe (identified by the style that function
 * appends to every probe it builds) holds N lines of ONE character, so one
 * advance per line is the faithful answer — that is what glyphcss turns into
 * a cell size for the base grid and each detail layer.
 *
 * The HOST's own box is what `createGlyphMap`'s `projectionGrid()` divides by
 * cols/rows to recover the cell it frames the camera against. Everything else
 * — the output `<pre>`s included — reports zero, exactly as happy-dom already
 * does, so `projectionGrid()` takes its documented host-rect path.
 */
const stubbedHosts = new Set<HTMLElement>();

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

/**
 * A small quad in the map's own world frame (X north/south, Y east/west, Z
 * elevation), wound FRONT-FACING toward a `tilt: 0` sheet camera. The
 * opposite winding renders solid identically but leaves `ink` completely
 * blank, and a blank layer would pass every "this is not solid" assertion for
 * the wrong reason. `MODEL_Z` puts it strictly ABOVE the terrain relief
 * (`reliefZ` = elev / earth radius x exaggeration, so 3,000,000 m is z ~ 0.47),
 * which is what makes the transparency assertion below meaningful: a quad
 * below the terrain would lose the id-map depth test and claim nothing whether
 * it is transparent or not.
 */
function modelPolygons(): { vertices: [number, number, number][]; color: string }[] {
  return [{ vertices: [[-4, -4, MODEL_Z], [4, -4, MODEL_Z], [4, 4, MODEL_Z], [-4, 4, MODEL_Z]], color: "#38bdf8" }];
}

function mount() {
  const host = document.createElement("div");
  document.body.appendChild(host);
  stubMonospaceMetrics(host);
  const map = createGlyphMap(host, {
    view: { center: [0, 0], span: 40, cols: VIEW_COLS, rows: VIEW_ROWS },
    projection: glyphMapEquirectangular(),
    tilt: 0,
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

describe("per-layer renderMode — a layer that wants the scene's mode costs nothing", () => {
  it("no renderMode and renderMode: \"solid\" render the same bytes in the same single <pre>", async () => {

    const a = mount();
    a.map.addLayer({ type: "raster", id: "terrain", source: makeTile(6, 6, 3_000_000) });
    await vi.waitFor(() => expect(a.map.scene.output.textContent ?? "").not.toBe(""));
    a.map.scene.rerender();
    const omitted = a.map.scene.output.textContent ?? "";

    const b = mount();
    // The widget's own scene mode is "solid" (widget.ts), so this is the
    // layer declaring exactly what it was already going to get.
    b.map.addLayer({ type: "raster", id: "terrain", source: makeTile(6, 6, 3_000_000), renderMode: "solid" });
    await vi.waitFor(() => expect(b.map.scene.output.textContent ?? "").not.toBe(""));
    b.map.scene.rerender();
    const declared = b.map.scene.output.textContent ?? "";

    expect(nonBlankRatio(omitted)).toBeGreaterThan(0.2);
    expect(declared).toBe(omitted);
    expect(detailPres(a.host).length).toBe(0);
    expect(detailPres(b.host).length).toBe(0);

    a.map.destroy();
    b.map.destroy();
  });
});

describe("per-layer renderMode — a different mode renders that layer under it", () => {
  it("an ink model layer strokes its own <pre> while terrain stays solid in the base grid", async () => {
    const { host, map } = mount();
    map.addLayer({ type: "raster", id: "terrain", source: makeTile(6, 6, 3_000_000) });
    map.addLayer({ type: "model", id: "overlay", polygons: modelPolygons(), renderMode: "ink" });
    await vi.waitFor(() => expect(map.scene.output.textContent ?? "").not.toBe(""));
    map.scene.rerender();

    const pres = detailPres(host);
    expect(pres.length).toBe(1);
    const detail = pres[0]!.textContent ?? "";
    expect(STROKE_GLYPHS.test(detail)).toBe(true);
    // Outline, not fill — an ink layer leaves its interior empty.
    expect(nonBlankRatio(detail)).toBeGreaterThan(0.05);
    expect(nonBlankRatio(detail)).toBeLessThan(0.6);

    // Terrain still fills the base grid: the ink layer is mounted transparent,
    // so it claims nothing in the shared occlusion id-map.
    expect(nonBlankRatio(map.scene.output.textContent ?? "")).toBeGreaterThan(0.2);

    map.destroy();
  });

  it("the SAME model layer fills solid when it declares no mode — the mode is what changed the glyphs", async () => {
    const { host, map } = mount();
    map.addLayer({ type: "raster", id: "terrain", source: makeTile(6, 6, 3_000_000) });
    map.addLayer({ type: "model", id: "overlay", polygons: modelPolygons() });
    await vi.waitFor(() => expect(map.scene.output.textContent ?? "").not.toBe(""));
    map.scene.rerender();

    // No mode of its own -> no detail layer at all, it just joins the base pass.
    expect(detailPres(host).length).toBe(0);
    map.destroy();
  });

  it("an outline mode mounts transparent, so the layer beneath is not blanked under its footprint", async () => {

    const ink = mount();
    ink.map.addLayer({ type: "raster", id: "terrain", source: makeTile(6, 6, 3_000_000) });
    ink.map.addLayer({ type: "model", id: "overlay", polygons: modelPolygons(), renderMode: "ink" });
    await vi.waitFor(() => expect(ink.map.scene.output.textContent ?? "").not.toBe(""));
    ink.map.scene.rerender();

    const bare = mount();
    bare.map.addLayer({ type: "raster", id: "terrain", source: makeTile(6, 6, 3_000_000) });
    await vi.waitFor(() => expect(bare.map.scene.output.textContent ?? "").not.toBe(""));
    bare.map.scene.rerender();

    // The base grid is untouched by the ink overlay — the whole point of
    // GLYPH_MAP_EDGE_RENDER_MODES: an opaque claim would punch the terrain out
    // under an outline that paints only edges.
    expect(ink.map.scene.output.textContent).toBe(bare.map.scene.output.textContent);

    ink.map.destroy();
    bare.map.destroy();
  });
});
