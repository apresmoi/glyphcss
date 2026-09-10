/**
 * A `raster` layer's elevation window has to move the ground in the SAME
 * ORDER the mesh does, and `widget.reliefWindowGround.test.ts` structurally
 * cannot see whether it did: its provider is `new Float32Array(...).fill(elevM)`
 * — UNIFORM terrain, where clamping every vertex and clamping the interpolated
 * value are the same number at every point of every quad, windowed or not.
 *
 * They are different functions wherever a quad STRADDLES a bound.
 * `glyphMapPolygons` clamps each retained VERTEX and draws the interpolation
 * of the clamped values; the ground sampler interpolated the RAW field and
 * clamped afterwards. `max(x, m)` is convex, so the first is never below the
 * second and is strictly above it across the straddle.
 *
 * The fixture is that straddle and nothing else: a two-quad static tile whose
 * west vertex column sits at -4,000 m and whose other two sit at +4,000 m,
 * under `minElevation: 0`. At the middle of the west quad the drawn surface is
 * the mean of the CLAMPED corners, +2,000 m, while the raw field reads exactly
 * 0. At `/maps`' own `exaggeration: 24` that is 48 km of world, and the
 * rendered consequence is not a shifted road but NO ROAD: measured, the draped
 * route inked rows 29-33 unwindowed and not one cell windowed, because a
 * stroke 48 km under its own terrain fails the depth test everywhere. With the
 * clamp moved to where the mesh does it, it inks rows 17-20 around the
 * independently predicted +2,000 m row of 19.13.
 *
 * The predicted row comes from PUBLIC API only (`map.project` at the point and
 * at its antipode gives the projection axis; the globe's radial scale does the
 * rest), never read back off the thing under test — the technique
 * `widget.markerDrape.test.ts` and `widget.reliefWindowGround.test.ts` share.
 *
 * happy-dom has no layout, hence `stubMonospaceMetrics`; it must answer
 * glyphcss's own hidden-`<pre>` cell probe too, or the camera and the
 * rasterizer disagree about cell size and every predicted row is off.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { createGlyphMap } from "./widget";
import { GLYPH_MAP_EARTH_RADIUS_M, glyphMapGlobe } from "./projection";
import type { GlyphMapGeoTile } from "./tile";
import type { GlyphMapVectorFeature } from "./vector/types";

const COLS = 140, ROWS = 63, CELL_W = 8, CELL_H = 16, BASE_FONT_PX = 16;
const EXAGGERATION = 24;
const SPAN = 2.0;
const AT: readonly [number, number] = [7.6586, 45.9763];
const CLIFF_M = 4000;

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

/** cols=2 static tile: the west vertex column at -CLIFF, the two east ones at +CLIFF. */
function cliffTile(): GlyphMapGeoTile {
  const cols = 2, rows = 2;
  const elevation = new Float32Array((cols + 1) * (rows + 1));
  for (let r = 0; r <= rows; r++) {
    for (let c = 0; c <= cols; c++) elevation[r * (cols + 1) + c] = c === 0 ? -CLIFF_M : CLIFF_M;
  }
  return {
    bounds: { west: AT[0] - 1, east: AT[0] + 1, south: AT[1] - 1, north: AT[1] + 1 },
    cols, rows, elevation, source: "synthetic", sampler: "nearest",
  };
}

/** The sample point: the middle of the WEST quad, where the raw field reads 0 and the clamped mesh reads +CLIFF/2. */
const PROBE_LON = AT[0] - 0.5;

const route: GlyphMapVectorFeature = {
  id: "route",
  geometryType: "line",
  rings: [[[PROBE_LON - 0.05, AT[1]], [PROBE_LON + 0.05, AT[1]]]],
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
      { type: "raster", id: "terrain", source: cliffTile(), ...window },
      { type: "line", id: "route", source: { features: [route] }, color: "#ff0000" },
    ],
  });
  mounted.push(map);
  return { map, host };
}

function groundRowFor(map: ReturnType<typeof createGlyphMap>, lon: number, lat: number, elevM: number): number {
  const near = map.project([lon, lat]);
  const far = map.project([lon + 180, -lat]);
  const originRow = (near.row + far.row) / 2;
  const k = 1 + (elevM / GLYPH_MAP_EARTH_RADIUS_M) * EXAGGERATION;
  return originRow + k * (near.row - originRow);
}

async function settleFrames(map: { scene: { rerender(): void; output: { textContent: string | null } } }): Promise<void> {
  let previous = "", stable = 0;
  for (let i = 0; i < 40 && stable < 3; i++) {
    await new Promise((resolve) => setTimeout(resolve, 20));
    map.scene.rerender();
    const frame = map.scene.output.textContent ?? "";
    stable = frame === previous ? stable + 1 : 0;
    previous = frame;
  }
}

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

describe("createGlyphMap — a windowed terrain's ground is clamped per vertex, like the mesh", () => {
  it("drapes a line on the raw field where no window clamps it", async () => {
    const { map } = mount({});
    await settleFrames(map);
    const rows = strokeRows(map);
    // Premise for the windowed clause: the fixture drapes at all, and the raw
    // field really does read 0 at the probe point (the ramp's own crossing).
    expect(rows.length).toBeGreaterThan(0);
    const want = groundRowFor(map, PROBE_LON, AT[1], 0);
    expect(Math.min(...rows.map((r) => Math.abs(r - want)))).toBeLessThan(1.5);
  }, 40000);

  it("drapes it on the CLAMPED-VERTEX surface, not on the clamped raw value", async () => {
    const { map } = mount({ minElevation: 0 });
    await settleFrames(map);
    const rows = strokeRows(map);
    // It draws at all — the whole rendered symptom was that it did not.
    expect(rows.length).toBeGreaterThan(0);
    const wantMesh = groundRowFor(map, PROBE_LON, AT[1], CLIFF_M / 2);
    const wantBlendThenClamp = groundRowFor(map, PROBE_LON, AT[1], 0);
    // The two predictions are 12 rows apart, so neither clause can pass by
    // landing near both.
    expect(Math.abs(wantMesh - wantBlendThenClamp)).toBeGreaterThan(5);
    expect(Math.min(...rows.map((r) => Math.abs(r - wantMesh)))).toBeLessThan(1.5);
    expect(Math.min(...rows.map((r) => Math.abs(r - wantBlendThenClamp)))).toBeGreaterThan(5);
  }, 40000);
});
