/**
 * A `raster` layer's elevation window moves the ground things are PLANTED
 * on, not only the terrain mesh.
 *
 * `groundElevationSampler` is the one ground source for the whole draped
 * family — a `line`'s vertices, a `fill`, a `fill-extrusion`'s base, a
 * marker. It reads the mounted raster layer's own tiles, so left alone it
 * would keep answering the SEABED under a `minElevation: 0` terrain whose
 * seabed is no longer drawn anywhere. At `/maps`' own `exaggeration: 24` a
 * -4,000 m sample is ~96 km of world below the plane the sea is now drawn
 * at, so a maritime border or a draped route would vanish under the very
 * surface it is meant to lie on — the same parting-company-with-the-ground
 * the stroke drape exists to prevent, caused by the window instead of by the
 * datum. So the sampler takes the same window the mesh does.
 *
 * The screen row a given elevation reaches is derived from PUBLIC API only
 * (`map.project` at the point and at its antipode gives the projection axis;
 * the globe's radial scale does the rest), never read back off the thing
 * under test — the same technique `widget.markerDrape.test.ts` uses.
 *
 * happy-dom has no layout, hence `stubMonospaceMetrics`; it must answer
 * glyphcss's own hidden-`<pre>` cell probe too, or the camera and the
 * rasterizer disagree about cell size and every predicted row is off.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { createGlyphMap } from "./widget";
import { GLYPH_MAP_EARTH_RADIUS_M, glyphMapGlobe } from "./projection";
import type { GlyphMapGeoTile } from "./tile";
import type { GlyphMapProvider } from "./provider";
import type { GlyphMapVectorFeature } from "./vector/types";

const COLS = 140;
const ROWS = 63;
const CELL_W = 8;
const CELL_H = 16;
const BASE_FONT_PX = 16;
const EXAGGERATION = 24;
const SPAN = 2.16;
const AT: readonly [number, number] = [7.6586, 45.9763];
/** A seabed deep enough that the datum, the seabed and the floor are rows apart on screen. */
const SEABED_M = -4000;

const EMPTY_RECT = { width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0, x: 0, y: 0, toJSON: () => ({}) } as DOMRect;
const rect = (width: number, height: number): DOMRect =>
  ({ width, height, top: 0, left: 0, right: width, bottom: height, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
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

const mounted: { destroy(): void }[] = [];
const hostsToRemove: HTMLElement[] = [];
afterEach(() => {
  for (const m of mounted.splice(0)) m.destroy();
  for (const h of hostsToRemove.splice(0)) h.remove();
  vi.restoreAllMocks();
  stubbedHosts.clear();
});

/** Uniform terrain at `elevM`, as a z0-z4 provider — the shape `bake-geo-tiles.mjs` produces. */
function terrainProvider(elevM: number): GlyphMapProvider {
  const zooms = [0, 1, 2, 3, 4].map((z) => ({
    z, cols: 2 ** z, rows: 2 ** z, tileLonSpan: 360 / 2 ** z, tileLatSpan: 180 / 2 ** z, tileCols: 32, tileRows: 32,
  }));
  const bounds = (z: number, x: number, y: number) => {
    const level = zooms[z]!;
    const west = -180 + x * level.tileLonSpan;
    const north = 90 - y * level.tileLatSpan;
    return { west, east: west + level.tileLonSpan, south: north - level.tileLatSpan, north };
  };
  return {
    id: `relief-window-ground-${elevM}`,
    zooms,
    bounds,
    loadTile: (z, x, y): Promise<GlyphMapGeoTile> => Promise.resolve({
      bounds: bounds(z, x, y), cols: 32, rows: 32, elevation: new Float32Array(33 * 33).fill(elevM), source: "synthetic", sampler: "nearest",
    }),
  };
}

/** A straight west-east line through the point, draped by the shipped stroke drape. */
const route: GlyphMapVectorFeature = {
  id: "route",
  geometryType: "line",
  rings: [[[AT[0] - 0.6, AT[1]], [AT[0] + 0.6, AT[1]]]],
};

function mount(window: Record<string, number>) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  hostsToRemove.push(host);
  stubMonospaceMetrics(host);
  const map = createGlyphMap(host, {
    view: { center: [AT[0], AT[1]], span: SPAN, cols: COLS, rows: ROWS },
    projection: glyphMapGlobe({ exaggeration: EXAGGERATION }),
    tilt: 55,
    layers: [
      { type: "raster", id: "terrain", source: terrainProvider(SEABED_M), ...window },
      { type: "line", id: "route", source: { features: [route] }, color: "#ff0000" },
    ],
  });
  mounted.push(map);
  return { map, host };
}

/** The row `(lon, lat)` reaches at elevation `elevM`, from public API only. */
function groundRowFor(map: ReturnType<typeof createGlyphMap>, lon: number, lat: number, elevM: number): number {
  const near = map.project([lon, lat]);
  const far = map.project([lon + 180, -lat]);
  const originRow = (near.row + far.row) / 2;
  const k = 1 + (elevM / GLYPH_MAP_EARTH_RADIUS_M) * EXAGGERATION;
  return originRow + k * (near.row - originRow);
}

async function settleFrames(map: { scene: { rerender(): void; output: { textContent: string | null } } }): Promise<void> {
  let previous = "";
  let stable = 0;
  for (let i = 0; i < 80 && stable < 3; i++) {
    await new Promise((resolve) => setTimeout(resolve, 50));
    map.scene.rerender();
    const frame = map.scene.output.textContent ?? "";
    stable = frame === previous ? stable + 1 : 0;
    previous = frame;
  }
}

/** The rows the red stroke actually inked. */
function strokeRows(map: { scene: { output: HTMLElement } }): number[] {
  const rows = new Set<number>();
  let row = 0;
  const walk = (node: Node, color: string | null): void => {
    if (node.nodeType === 3) {
      for (const ch of node.textContent ?? "") {
        if (ch === "\n") { row++; continue; }
        if (ch !== " " && color && /rgb\(255,\s*0,\s*0\)|#ff0000/i.test(color)) rows.add(row);
      }
      return;
    }
    const el = node as HTMLElement;
    const own = el.style?.color || color;
    for (const child of Array.from(el.childNodes)) walk(child, own);
  };
  for (const child of Array.from(map.scene.output.childNodes)) walk(child, null);
  return [...rows].sort((a, b) => a - b);
}

describe("createGlyphMap — a windowed terrain moves the ground things stand on", () => {
  it("drapes a line on the seabed with no window", async () => {
    const { map } = mount({});
    await settleFrames(map);
    const rows = strokeRows(map);
    expect(rows.length).toBeGreaterThan(0);
    const want = groundRowFor(map, AT[0], AT[1], SEABED_M);
    // Within a cell of the predicted seabed row, and nowhere near the datum.
    expect(Math.min(...rows.map((r) => Math.abs(r - want)))).toBeLessThan(1.5);
    expect(Math.abs(want - groundRowFor(map, AT[0], AT[1], 0))).toBeGreaterThan(5);
  }, 40000);

  it("drapes it on the floor once the terrain is floored there", async () => {
    const { map } = mount({ minElevation: 0 });
    await settleFrames(map);
    const rows = strokeRows(map);
    expect(rows.length).toBeGreaterThan(0);
    const wantFloor = groundRowFor(map, AT[0], AT[1], 0);
    const wantSeabed = groundRowFor(map, AT[0], AT[1], SEABED_M);
    const nearest = Math.min(...rows.map((r) => Math.abs(r - wantFloor)));
    // On the drawn surface, not ~96 km of world under it.
    expect(nearest).toBeLessThan(1.5);
    expect(Math.min(...rows.map((r) => Math.abs(r - wantSeabed)))).toBeGreaterThan(5);
  }, 40000);
});
