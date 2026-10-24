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

  // A shore several rows tall once exaggerated: re-pivoting along local up across it shifted the
  // whole pitched picture by the height times sin(tilt), many rows at once.
  function shore(height: number): GlyphMapGeoTile {
    const cols = 256, rows = 8;
    const bounds = { west: CENTER[0] - 0.02, east: CENTER[0] + 0.02, south: CENTER[1] - 0.02, north: CENTER[1] + 0.02 };
    const elevation = new Float32Array((cols + 1) * (rows + 1));
    for (let y = 0; y <= rows; y++) for (let x = 0; x <= cols; x++) elevation[y * (cols + 1) + x] = x > cols / 2 ? height : 0;
    return { bounds, cols, rows, elevation, source: "synthetic-shore", sampler: "custom" };
  }

  it.each([
    ["globe", "ramp", false],
    ["globe", "ramp", true],
    ["globe", "wall", false],
    ["sheet", "ramp", false],
    ["sheet", "ramp", true],
    ["sheet", "wall", false],
  ] as const)("pans a %s across a %s without the picture hopping (snapPan=%s)", async (kind, step, snapPan) => {
    // The sheet's relief frame is degrees-scaled, so it needs a taller step for the same rows.
    const height = kind === "globe" ? 1 : 150;
    const tile = shore(height);
    const projection = kind === "globe" ? glyphMapGlobe({ exaggeration: 24 }) : glyphMapEquirectangular({ exaggeration: 24 });
    const start = [CENTER[0] - 0.0012, CENTER[1]] as const;
    // A water mask over terrain is a true discontinuity: the sight meets its
    // wall, where no centre's ground point lies on it.
    const groundElevation = step === "wall" ? (lon: number) => (lon > CENTER[0] ? height : 0) : undefined;
    const { map, host, done } = mount({
      view: { center: start, span: SPAN, cols: COLS, rows: ROWS }, projection, tilt: 59, bearing: 20, snapPan, groundElevation,
      layers: [{ type: "raster", source: tile }],
    });
    try {
      await map.idle();
      const fixed = projection.project(CENTER[0], CENTER[1] + 0.0003, 0);
      const at = () => map.scene.camera.project(fixed, COLS, ROWS, CELL_H / CELL_W, { cellWidth: CELL_W, cellHeight: CELL_H });
      const init = { pointerId: 3, bubbles: true, button: 0 };
      host.dispatchEvent(new PointerEvent("pointerdown", { ...init, clientX: 600, clientY: 300 }));
      let prev = at();
      const steps: [number, number][] = [];
      for (let i = 1; i <= 60; i++) {
        host.dispatchEvent(new PointerEvent("pointermove", { ...init, clientX: 600 - 25 * i, clientY: 300 }));
        const now = at();
        steps.push([now[0] - prev[0], now[1] - prev[1]]);
        prev = now;
        // A re-sync of the same view (a wheel notch, a resize) keeps the held
        // pivot, wherever on the shore the pan left it.
        map.setView({});
        const again = at();
        expect(Math.abs(again[0] - now[0])).toBeLessThan(snapPan ? 1.01 : 1e-3);
        expect(Math.abs(again[1] - now[1])).toBeLessThan(snapPan ? 1.01 : 1e-3);
      }
      host.dispatchEvent(new PointerEvent("pointerup", { ...init, clientX: 600 - 25 * 60, clientY: 300 }));
      // The pan crossed the shore, and the ground under the centre rose.
      expect(map.getView().center[0]).toBeGreaterThan(CENTER[0] + 0.0002);
      // A 25 px drag moves a fixed point ~3 columns; the shore must not add a
      // row-sized jump to any one step (snapping allows its own one cell).
      const slack = snapPan ? 1.01 : 0.05;
      const [col0, row0] = steps[0]!;
      for (const [dc, dr] of steps) {
        expect(Math.abs(dc - col0)).toBeLessThan(slack + 0.05);
        expect(Math.abs(dr - row0)).toBeLessThan(slack + 0.05);
      }
      // The pivot is still the ground at the screen centre.
      const center = map.getView().center;
      const ground = projection.project(center[0], center[1], groundElevation?.(center[0]) ?? glyphMapGeoTileElevationAt(tile, center[0], center[1]));
      const g = map.scene.camera.project(ground, COLS, ROWS, CELL_H / CELL_W, { cellWidth: CELL_W, cellHeight: CELL_H });
      expect(Math.abs(g[0] - COLS / 2)).toBeLessThan(1);
      expect(Math.abs(g[1] - ROWS / 2)).toBeLessThan(1);
      await map.idle();
    } finally { done(); }
  });

  // Exaggerated hills cross one line of sight several times: 300 m of relief
  // in ~0.9 km hills (under 50 degrees real), at 24x. The pivot must be
  // the crossing the screen centre SHOWS: a hidden one recentred the view on
  // ground you cannot see, and Ctrl-drag orbited it.
  function hills(): GlyphMapGeoTile {
    const cols = 128, rows = 128;
    const bounds = { west: CENTER[0] - 0.02, east: CENTER[0] + 0.02, south: CENTER[1] - 0.02, north: CENTER[1] + 0.02 };
    const elevation = new Float32Array((cols + 1) * (rows + 1));
    for (let y = 0; y <= rows; y++) for (let x = 0; x <= cols; x++) {
      elevation[y * (cols + 1) + x] = 150 + 150 * Math.sin(x * 0.25) * Math.cos(y * 0.2);
    }
    return { bounds, cols, rows, elevation, source: "synthetic-hills", sampler: "custom" };
  }

  it.each([false, true])("pivots pans and turns on the ground the centre shows, never a crossing hidden behind a hill (snapPan=%s)", async (snapPan) => {
    const tile = hills();
    const projection = glyphMapGlobe({ exaggeration: 24 });
    const { map, host, done } = mount({
      view: { center: CENTER, span: SPAN * 4, cols: COLS, rows: ROWS }, projection, tilt: 64, bearing: 31, snapPan,
      layers: [{ type: "raster", source: tile }],
    });
    try {
      await map.idle();
      const camera = map.scene.camera;
      const visible = () => {
        const t = camera.target;
        const o = camera.project(t, 0, 0, 1);
        const rows = [0, 1, 2].map(j => camera.project([t[0] + +(j === 0), t[1] + +(j === 1), t[2] + +(j === 2)], 0, 0, 1).map((v, i) => v - o[i]!));
        const col = [rows[0]![0]!, rows[1]![0]!, rows[2]![0]!], row = [rows[0]![1]!, rows[1]![1]!, rows[2]![1]!], depth = [rows[0]![2]!, rows[1]![2]!, rows[2]![2]!];
        let axis = [col[1]! * row[2]! - col[2]! * row[1]!, col[2]! * row[0]! - col[0]! * row[2]!, col[0]! * row[1]! - col[1]! * row[0]!];
        const n = Math.hypot(...axis) * Math.sign(axis[0]! * depth[0]! + axis[1]! * depth[1]! + axis[2]! * depth[2]!);
        axis = axis.map(v => v / n);
        // Longest run of sight samples (2 px apart) more than 30 m under the
        // ground. The widget draws its ground as mesh triangles, this reads
        // the tile bilinearly, and the two differ by metres; a
        // pivot hidden behind a hill sits hundreds of metres under it. The
        // pivot search marches in 4 px steps near the ground, so a ridge
        // thinner than one step may slip between them.
        let hidden = 0, run = 0;
        for (let k = 1; k <= 300; k++) {
          const s = (k * 2) / camera.zoom;
          const p = [t[0] + axis[0]! * s, t[1] + axis[1]! * s, t[2] + axis[2]! * s] as const;
          const [lon, lat] = projection.unproject(p as unknown as [number, number, number]);
          const g = projection.project(lon, lat, glyphMapGeoTileElevationAt(tile, lon, lat));
          const metre = Math.hypot(...projection.project(lon, lat, 1)) - Math.hypot(...projection.project(lon, lat, 0));
          run = (Math.hypot(...g) - Math.hypot(...p)) / metre > 30 ? run + 1 : 0;
          hidden = Math.max(hidden, run);
        }
        return hidden;
      };
      // At rest the pivot is the ground at `view.center`, hidden here behind a
      // hill; the first turn must move it onto the ground the centre shows.
      expect(visible()).toBeGreaterThan(2);
      orient(host, 6, 0);
      expect(visible()).toBeLessThanOrEqual(2);
      orient(host, 0, -4);
      expect(visible()).toBeLessThanOrEqual(2);
      const init = { pointerId: 4, bubbles: true, button: 0 };
      for (let pass = 0; pass < 3; pass++) {
        host.dispatchEvent(new PointerEvent("pointerdown", { ...init, clientX: 300, clientY: 700 }));
        for (let i = 1; i <= 20; i++) {
          host.dispatchEvent(new PointerEvent("pointermove", { ...init, clientX: 300 + 30 * i, clientY: 700 - 18 * i }));
          expect(visible()).toBeLessThanOrEqual(2);
        }
        host.dispatchEvent(new PointerEvent("pointerup", { ...init, clientX: 900, clientY: 340 }));
      }
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

describe("tilted globe pan", () => {
  function pan(host: HTMLElement, dx: number, dy: number): void {
    const init = { pointerId: 1, bubbles: true, button: 0 };
    host.dispatchEvent(new PointerEvent("pointerdown", { ...init, clientX: 300, clientY: 300 }));
    host.dispatchEvent(new PointerEvent("pointermove", { ...init, clientX: 300 + dx, clientY: 300 + dy }));
    host.dispatchEvent(new PointerEvent("pointerup", { ...init, clientX: 300 + dx, clientY: 300 + dy }));
  }
  it.each([[0, 64, 60], [64, 0, 60], [0, -64, 60], [0, 64, 0], [64, 0, 0], [0, 64, 60, 90], [48, 32, 45, 30]])("moves the grabbed centre ground by the dragged pixels (%i, %i) at tilt %i, bearing %s", async (dx, dy, TILT, BEARING = 0) => {
    const { map, host, done } = mount({
      view: { center: CENTER, span: SPAN, cols: COLS, rows: ROWS }, projection: glyphMapGlobe(), tilt: TILT,
    });
    try {
      map.setBearing(BEARING);
      await map.idle();
      const grabbed = map.getView().center;
      pan(host, dx, dy);
      const at = map.project(grabbed);
      expect(at.col - COLS / 2).toBeCloseTo(dx / CELL_W, 0);
      expect(at.row - ROWS / 2).toBeCloseTo(dy / CELL_H, 0);
    } finally { done(); }
  });
});
