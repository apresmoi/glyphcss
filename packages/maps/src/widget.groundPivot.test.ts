import { afterEach, describe, expect, it, vi } from "vitest";
import { createGlyphMap } from "./widget";
import { glyphMapEquirectangular, glyphMapGlobe } from "./projection";
import { glyphMapGeoTileElevationAt, type GlyphMapGeoTile } from "./tile";
import type { GlyphMapProvider } from "./provider";

const COLS = 140, ROWS = 63, CELL_W = 8, CELL_H = 16, BASE_FONT_PX = 16;

const rect = (w: number, h: number) =>
  ({ width: w, height: h, top: 0, left: 0, right: w, bottom: h, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
const EMPTY_RECT = rect(0, 0);
const stubbedHosts = new Set<HTMLElement>();

function stubMonospaceMetrics(host: HTMLElement): void {
  stubbedHosts.add(host);
  if (vi.isMockFunction(Element.prototype.getBoundingClientRect)) return;
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
    const el = this as HTMLElement;
    if (stubbedHosts.has(el)) return rect(COLS * CELL_W, ROWS * CELL_H);
    if (el.tagName !== "PRE" || !/visibility:\s*hidden/.test(el.style.cssText)) return EMPTY_RECT;
    const fontPx = parseFloat(/font-size:\s*([\d.]+)px/.exec(el.style.cssText)?.[1] ?? String(BASE_FONT_PX));
    const k = fontPx / BASE_FONT_PX;
    const lines = (el.textContent ?? "").split("\n").length || 1;
    return rect(CELL_W * k, CELL_H * k * lines);
  });
}

function mount(opts: Parameters<typeof createGlyphMap>[1]) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  stubMonospaceMetrics(host);
  const map = createGlyphMap(host, opts);
  return { map, host, done: () => { map.destroy(); host.remove(); } };
}


afterEach(() => {
  document.body.innerHTML = "";
  stubbedHosts.clear();
  vi.restoreAllMocks();
});

const CENTER = [-58.38, -34.6] as const;
const SPAN = 0.0018;
function terrain(): GlyphMapGeoTile {
  const cols = 32, rows = 32;
  const bounds = { west: CENTER[0] - 0.02, east: CENTER[0] + 0.02, south: CENTER[1] - 0.02, north: CENTER[1] + 0.02 };
  const elevation = new Float32Array((cols + 1) * (rows + 1));
  for (let y = 0; y <= rows; y++) for (let x = 0; x <= cols; x++) {
    elevation[y * (cols + 1) + x] = 500 + x * 0.4 + y * 0.6;
  }
  return { bounds, cols, rows, elevation, source: "synthetic-slope", sampler: "custom" };
}
function orient(host: HTMLElement, dx: number, dy: number, button = 0): void {
  const init = { pointerId: 1, bubbles: true, button, ctrlKey: button === 0 };
  host.dispatchEvent(new PointerEvent("pointerdown", { ...init, clientX: 100, clientY: 100 }));
  host.dispatchEvent(new PointerEvent("pointermove", { ...init, clientX: 100 + dx, clientY: 100 + dy }));
  host.dispatchEvent(new PointerEvent("pointerup", { ...init, clientX: 100 + dx, clientY: 100 + dy }));
}

describe("drawn-ground camera pivot", () => {
  it.each([false, true])("keeps exaggerated ground centred through Ctrl/right-drag, pan and inversions (snapPan=%s)", async (snapPan) => {
    const tile = terrain();
    const projection = glyphMapGlobe({ exaggeration: 24 });
    const { map, host, done } = mount({
      view: { center: CENTER, span: SPAN, cols: COLS, rows: ROWS }, projection, tilt: 59, snapPan,
      layers: [{ type: "raster", source: tile }],
    });
    try {
      await map.idle();
      const check = () => {
        const center = map.getView().center;
        const ground = glyphMapGeoTileElevationAt(tile, center[0], center[1]);
        const at = map.scene.camera.project(projection.project(center[0], center[1], ground), COLS, ROWS, CELL_H / CELL_W,
          { cellWidth: CELL_W, cellHeight: CELL_H });
        expect(Math.abs(at[0] - COLS / 2)).toBeLessThan(1);
        expect(Math.abs(at[1] - ROWS / 2)).toBeLessThan(1);
        const publicAt = map.project(center);
        expect(publicAt.col).toBeCloseTo(at[0], 6);
        expect(publicAt.row).toBeCloseTo(at[1], 6);
        for (const cell of [[COLS / 2, ROWS / 2], [COLS * 0.4, ROWS * 0.6]]) {
          const inverse = map.unproject(cell as [number, number]);
          expect(inverse).not.toBeNull();
          const back = map.project(inverse!);
          expect(back.col).toBeCloseTo(cell[0], 3);
          expect(back.row).toBeCloseTo(cell[1], 3);
        }
      };
      check();
      for (const [dx, dy, button] of [[80, 0, 0], [0, -20, 0], [-40, 15, 2]]) {
        orient(host, dx, dy, button);
        expect(map.getView().center).toEqual(CENTER);
        check();
      }
      expect(map.getBearing()).not.toBe(0);
      expect(map.getTilt()).not.toBe(59);
      // Cross the snap lattice, then retain a sub-cell exact geographic move.
      map.setView({ center: [CENTER[0] + SPAN / 10, CENTER[1] + SPAN / 10] });
      check();
      map.setView({ center: [CENTER[0] + SPAN / 10 + 1e-7, CENTER[1] + SPAN / 10] });
      check();
      host.dispatchEvent(new PointerEvent("pointerdown", { pointerId: 2, clientX: 100, clientY: 100, bubbles: true }));
      host.dispatchEvent(new PointerEvent("pointermove", { pointerId: 2, clientX: 110, clientY: 105, bubbles: true }));
      host.dispatchEvent(new PointerEvent("pointercancel", { pointerId: 2, bubbles: true }));
      check();
      map.setView({});
      check();
      await map.idle();
    } finally { done(); }
  });

  it("keeps sheet snap-pan targets on the ground and projection endpoints centred", async () => {
    const tile = terrain();
    const sheet = glyphMapEquirectangular({ exaggeration: 24 });
    const { map, done } = mount({ view: { center: CENTER, span: SPAN, cols: COLS, rows: ROWS }, projection: sheet,
      tilt: 50, bearing: 37, snapPan: true, layers: [{ type: "raster", source: tile }] });
    try {
      await map.idle();
      for (const delta of [0, 1e-7, SPAN / 10]) {
        map.setView({ center: [CENTER[0] + delta, CENTER[1] + delta] });
        const at = map.project(map.getView().center);
        expect(Math.abs(at.col - COLS / 2)).toBeLessThan(1);
        expect(Math.abs(at.row - ROWS / 2)).toBeLessThan(1);
        const inverse = map.unproject([COLS / 2, ROWS / 2]);
        expect(inverse).not.toBeNull();
        expect(map.project(inverse!).row).toBeCloseTo(ROWS / 2, 3);
      }
      map.setSnapPan(false);
      await map.setProjection(glyphMapGlobe({ exaggeration: 24 }), { durationMs: 0 });
      await map.idle();
      expect(map.project(map.getView().center).row).toBeCloseTo(ROWS / 2, 6);
      await map.setProjection(sheet, { durationMs: 0 });
      await map.idle();
      expect(map.project(map.getView().center).row).toBeCloseTo(ROWS / 2, 6);
    } finally { done(); }
  });

  it("uses windowed mesh triangles, not a bilinear or unclamped sample", async () => {
    const tile: GlyphMapGeoTile = { bounds: { west: -1, east: 1, south: -1, north: 1 }, cols: 1, rows: 1,
      elevation: new Float32Array([-100, 200, 300, 1000]), source: "saddle", sampler: "custom" };
    const window = { minElevation: 0, maxElevation: 400 };
    const projection = glyphMapGlobe({ exaggeration: 24 });
    const { map, done } = mount({ view: { center: [0, 0], span: 1, cols: COLS, rows: ROWS }, projection, tilt: 60,
      layers: [{ type: "raster", source: tile, ...window }] });
    try {
      await map.idle();
      expect(glyphMapGeoTileElevationAt(tile, 0, 0, window)).toBe(200);
      expect(map.scene.camera.target).toEqual(projection.project(0, 0, 200));
    } finally { done(); }
  });

  it("re-anchors before the first render of delayed ground and returns to datum on removal", async () => {
    const tile = terrain();
    let release!: (tile: GlyphMapGeoTile) => void;
    const promise = new Promise<GlyphMapGeoTile>(resolve => { release = resolve; });
    const source: GlyphMapProvider = { id: "delayed-ground", zooms: [{ z: 0, cols: 1, rows: 1,
      tileLonSpan: 360, tileLatSpan: 180, tileCols: 32, tileRows: 32 }], bounds: () => tile.bounds, loadTile: () => promise };
    const projection = glyphMapGlobe({ exaggeration: 24 });
    const { map, done } = mount({ view: { center: CENTER, span: SPAN, cols: COLS, rows: ROWS }, projection, tilt: 67, snapPan: true });
    try {
      const before = map.getView();
      const id = map.addLayer({ type: "raster", source });
      expect(map.scene.camera.target).toEqual(projection.project(...CENTER, 0));
      const target = projection.project(...CENTER, glyphMapGeoTileElevationAt(tile, ...CENTER));
      const renders: number[][] = [];
      const project = map.scene.camera.project.bind(map.scene.camera);
      vi.spyOn(map.scene.camera, "project").mockImplementation((...args) => {
        renders.push([...map.scene.camera.target]);
        return project(...args);
      });
      release(tile);
      await map.idle();
      expect(renders.length).toBeGreaterThan(0);
      expect(renders.every(pose => pose.every((v, i) => v === target[i]))).toBe(true);
      expect(map.getView()).toEqual(before);
      map.removeLayer(id);
      await map.idle();
      expect(map.scene.camera.target).toEqual(projection.project(...CENTER, 0));
    } finally { done(); }
  });

  it("restores near-ground braille content on an exaggerated slope at tilt 67", async () => {
    const projection = glyphMapGlobe({ exaggeration: 24 });
    const { map, done } = mount({ view: { center: CENTER, span: SPAN, cols: COLS, rows: ROWS }, projection, tilt: 67,
      layers: [{ type: "raster", source: terrain() }, { type: "line", experimentalGlyphStrategy: "braille", source: {
        features: Array.from({ length: 31 }, (_, i) => ({ geometryType: "line" as const, rings: [[
          [CENTER[0] - SPAN * 2, CENTER[1] + (i - 15) * SPAN / 10],
          [CENTER[0] + SPAN * 2, CENTER[1] + (i - 15) * SPAN / 10],
        ]] })),
      } }],
    });
    try {
      await map.idle();
      const count = () => [...(map.scene.output.textContent ?? "").split("\n").slice(Math.floor(ROWS * 2 / 3)).join("")]
        .filter(ch => ch >= "⠀" && ch <= "⣿").length;
      const ground = count();
      const target = map.scene.camera.target;
      // Same mesh, drape and depth test; change ONLY the pivot to the old datum.
      map.scene.camera.target = projection.project(...CENTER, 0);
      map.scene.rerender();
      const datum = count();
      map.scene.camera.target = target;
      map.scene.rerender();
      expect(ground).toBeGreaterThan(100);
      expect(datum).toBe(0);
    } finally { done(); }
  });

  it.each([glyphMapGlobe, glyphMapEquirectangular])("uses supplied ground on either family and preserves datum fallback", async (factory) => {
    const projection = factory({ exaggeration: 24 });
    for (const groundElevation of [undefined, () => null, () => 350]) {
      const { map, done } = mount({ view: { center: [0, 0], span: 1, cols: COLS, rows: ROWS }, projection,
        tilt: 50, groundElevation });
      try {
        await map.idle();
        expect(map.scene.camera.target).toEqual(projection.project(0, 0, groundElevation?.() ?? 0));
        orient(map.host, 50, -10);
        expect(map.scene.camera.target).toEqual(projection.project(0, 0, groundElevation?.() ?? 0));
        expect(map.project([0, 0]).row).toBeCloseTo(ROWS / 2, 6);
        const at = map.unproject([COLS / 2, ROWS / 2]);
        expect(at?.[0]).toBeCloseTo(0, 6);
        expect(at?.[1]).toBeCloseTo(0, 6);
      } finally { done(); }
    }
  });
});
