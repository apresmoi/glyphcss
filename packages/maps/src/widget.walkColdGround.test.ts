/**
 * A COLD-LOAD walk: entering walk mode BEFORE the terrain has landed.
 *
 * Every standing-height clause in `widget.walk.test.ts` awaits `map.on("load")`
 * and only then calls `setWalk({})`, so all of them enter onto terrain that is
 * already mounted. That ordering is exactly what hides this: the ground was
 * re-read on entry and after every stride — both events the WALKER causes —
 * and never when the TILE SET changed, which is the one event a stationary
 * reader on a cold load actually gets. The widget already owns a registry for
 * precisely that (`groundChangeSyncs`, which a `fill-extrusion`'s base and a
 * label's anchor both ride); the walker was not on it.
 *
 * Measured on a 500 m plateau entered before its tiles: `groundElevation`
 * reported 0 after the load settled and 500 the instant walk mode was left and
 * re-entered. The picture is the real claim, and it is not subtle — the point
 * 100 m ahead AT EYE LEVEL projected to row -73.8 of a 63-row grid, i.e. the
 * plateau stood 500 m over the walker's head and off the top of the frame.
 *
 * The eye's position is stated as a PICTURE rather than read back off the
 * thing under test, the same discriminator `widget.walk.test.ts`'s own
 * standing-height clause uses: at bearing 0 and pitch 0 the walker looks due
 * north along the local horizontal, so a point 100 m north at eye level is ON
 * the view axis and must land on the grid's centre row.
 *
 * happy-dom has no layout, hence `stubMonospaceMetrics` — the walk lens solves
 * `zoom` from `cols * cellWidth`.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { createGlyphMap } from "./widget";
import { GLYPH_MAP_WALK_EYE_HEIGHT_M } from "./walk";
import { GLYPH_MAP_EARTH_RADIUS_M, glyphMapGlobe } from "./projection";
import type { GlyphMapGeoTile } from "./tile";
import type { GlyphMapProvider } from "./provider";
import type { GlyphMapClassifier } from "./types";

const COLS = 140, ROWS = 63, CELL_W = 8, CELL_H = 16, BASE_FONT_PX = 16;
const ZURICH: readonly [number, number] = [8.5445, 47.37418];
const ELEVATION = 500;

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

function flatProvider(elevationM: number, deepZ = 8): GlyphMapProvider {
  const N = 4;
  const deepCols = 2 ** deepZ * 2;
  const zooms = [
    { z: 0, cols: 1, rows: 1, tileCols: N, tileRows: N, tileLonSpan: 360, tileLatSpan: 180 },
    { z: deepZ, cols: deepCols, rows: deepCols / 2, tileCols: N, tileRows: N, tileLonSpan: 360 / deepCols, tileLatSpan: 360 / deepCols },
  ];
  return {
    id: "walk-cold-ground",
    zooms,
    bounds(z, x, y) {
      const lvl = zooms.find((l) => l.z === z)!;
      const west = -180 + x * lvl.tileLonSpan;
      const north = 90 - y * lvl.tileLatSpan;
      return { west, east: west + lvl.tileLonSpan, south: north - lvl.tileLatSpan, north };
    },
    async loadTile(z, x, y): Promise<GlyphMapGeoTile> {
      const b = this.bounds(z, x, y);
      return {
        cols: N, rows: N, bounds: b, source: "walk-cold", sampler: "nearest",
        elevation: new Float32Array((N + 1) * (N + 1)).fill(elevationM),
      };
    },
  };
}

const ELEVATION_CLASSIFIER: GlyphMapClassifier = {
  id: "walk-cold",
  orderStatistic: false,
  classifyValue: () => 0,
  classify: (field) => new Uint8Array(field.cols * field.rows),
};

afterEach(() => {
  vi.restoreAllMocks();
  stubbedHosts.clear();
  document.body.innerHTML = "";
});

describe("walk mode — a stationary walker rises when the terrain lands", () => {
  it("stands on the plateau after entering walk BEFORE its tiles arrived", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    stubMonospaceMetrics(host);
    const projection = glyphMapGlobe();
    const map = createGlyphMap(host, {
      projection,
      view: { center: ZURICH as [number, number], span: 0.01, cols: COLS, rows: ROWS },
      layers: [{ type: "raster", source: flatProvider(ELEVATION), classifier: ELEVATION_CLASSIFIER }],
    });
    // ENTER FIRST — before any tile has landed, and without a keypress after.
    map.setWalk({});
    // Premise: entering really did happen ahead of the data, so the clause
    // below cannot pass by the ground having been right all along.
    expect(map.getWalk()!.groundElevation).toBe(0);

    await new Promise<void>((resolve) => { map.on("load", () => resolve()); });
    for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 20));

    expect(map.getWalk()!.groundElevation).toBeCloseTo(ELEVATION, 6);

    // The claim as a PICTURE: a point 100 m due north at eye level is on the
    // view axis, so it lands on the centre row. Left at the datum it read
    // row -73.8 of 63 — the plateau over the walker's head.
    const camera = map.scene.camera;
    const aheadLat = ZURICH[1] + (100 / GLYPH_MAP_EARTH_RADIUS_M) * (180 / Math.PI);
    const eyeLevel = projection.project(ZURICH[0], aheadLat, ELEVATION + GLYPH_MAP_WALK_EYE_HEIGHT_M);
    const groundAhead = projection.project(ZURICH[0], aheadLat, ELEVATION);
    expect(camera.project(eyeLevel, COLS, ROWS, 2)[1]).toBeCloseTo(ROWS / 2, 1);
    expect(camera.project(groundAhead, COLS, ROWS, 2)[1]).toBeGreaterThan(ROWS / 2);

    map.destroy();
    host.remove();
  }, 40000);

  it("stops listening once walk mode is left", async () => {
    // The registration is per-walk, not per-map: a widget that stayed
    // subscribed would re-pose an ORTHOGRAPHIC camera off a walker's ground
    // every time a tile landed.
    const host = document.createElement("div");
    document.body.appendChild(host);
    stubMonospaceMetrics(host);
    const map = createGlyphMap(host, {
      projection: glyphMapGlobe(),
      view: { center: ZURICH as [number, number], span: 0.01, cols: COLS, rows: ROWS },
      layers: [{ type: "raster", source: flatProvider(ELEVATION), classifier: ELEVATION_CLASSIFIER }],
    });
    map.setWalk({});
    await new Promise<void>((resolve) => { map.on("load", () => resolve()); });
    for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 20));
    expect(map.getWalk()!.groundElevation).toBeCloseTo(ELEVATION, 6);

    const before = map.scene.output.textContent ?? "";
    map.setWalk(null);
    const orbit = map.scene.output.textContent ?? "";
    expect(map.getWalk()).toBeNull();
    // A tile update after leaving must not re-pose anything: the orbit frame
    // it restored is the frame that stays.
    map.setView(map.getView());
    for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 20));
    expect(map.scene.output.textContent ?? "").toBe(orbit);
    expect(orbit).not.toBe(before);

    map.destroy();
    host.remove();
  }, 40000);
});
