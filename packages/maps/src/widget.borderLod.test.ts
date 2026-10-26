/** Real ETOPO1 z0/z1 and Natural Earth borders, copied verbatim from the local
 * baked pyramid. No browser or generated website data is a test dependency.
 * Both tiers are mounted; checking the drape against z1 separates a ground
 * source mismatch from the raster/stroke sampling-coordinate mismatch.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { createGlyphMap } from "./widget";
import { glyphMapGlobe } from "./projection";
import { glyphMapDecodeGeoTileInt16, glyphMapGeoTileElevationAt, type GlyphMapGeoTile } from "./tile";
import type { GlyphMapProvider, GlyphMapProviderZoomLevel } from "./provider";
import * as strokes from "./stroke";
import { glyphMapDecodeVectorTile } from "./vector/tile";

const COLS = 139;
const ROWS = 77;
const CELL_W = 12;
const CELL_H = 14;
const BASE_FONT_PX = 16;
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

it("keeps top-down borders over real coarse/fine ETOPO1 tiles after panning back", async () => {
  const root = path.resolve(__dirname, "../fixtures/border-lod");
  const manifest = JSON.parse(readFileSync(path.join(root, "manifest.json"), "utf8"));
  const zooms = manifest.zooms as GlyphMapProviderZoomLevel[];
  const bounds = (z: number, x: number, y: number) => {
    const level = zooms[z]!;
    const west = -180 + x * level.tileLonSpan, north = 90 - y * level.tileLatSpan;
    return { west, east: west + level.tileLonSpan, north, south: north - level.tileLatSpan };
  };
  const loaded = new Set<string>();
  const fineTiles: GlyphMapGeoTile[] = [];
  const provider: GlyphMapProvider = { id: "world", zooms, bounds, async loadTile(z, x, y) {
    loaded.add(`${z}/${x}_${y}`);
    const b = readFileSync(path.join(root, `terrain/${z}/${x}_${y}.bin`));
    const tile = glyphMapDecodeGeoTileInt16(b, { bounds: bounds(z, x, y), cols: 180, rows: 90, source: "etopo1", sampler: "nearest" });
    if (z === 1) fineTiles.push(tile);
    return tile;
  }};
  const borders = {
    id: "world-borders", zooms: [zooms[1]!], bounds,
    async loadTile(_z: number, x: number, y: number) {
      return glyphMapDecodeVectorTile(JSON.parse(readFileSync(path.join(root, `borders/${x}_${y}.json`), "utf8")));
    },
  };
  const host = document.createElement("div");
  document.body.appendChild(host);
  hostsToRemove.push(host);
  stubMonospaceMetrics(host);
  const map = createGlyphMap(host, { view: { center: [-63.39, -8.66], span: 153.6, cols: COLS, rows: ROWS }, projection: glyphMapGlobe({ exaggeration: 24 }), tilt: 0,
    layers: [{ type: "raster", id: "terrain", source: provider }] });
  mounted.push(map);
  await map.idle();
  const inked = new Set<number>();
  const realStamp = strokes.stampGlyphMapPolyline;
  let checkGround = true;
  let checkedSamples = 0;
  vi.spyOn(strokes, "stampGlyphMapPolyline").mockImplementation((g, points, opts) => {
    if (checkGround) for (const p of points) {
      if (p.col < 0 || p.col >= g.cols || p.row < 0 || p.row >= g.rows) continue;
      const v = p as strokes.GlyphMapStrokeVertex & { lon: number; lat: number; elev: number };
      const raw = fineTiles.map(tile => glyphMapGeoTileElevationAt(tile, v.lon, v.lat)).find(Number.isFinite);
      if (raw === undefined) continue;
      expect(v.elev).toBeCloseTo(raw, 6);
      checkedSamples++;
    }
    realStamp(g, points, { ...opts, onInk: idx => inked.add(idx) });
  });
  const countInk = () => { inked.clear(); map.scene.rerender(); return inked.size; };
  map.addLayer({ type: "line", source: borders });
  await map.idle();
  const first = countInk();
  map.setView({ center: [10, 30] });
  await map.idle();
  map.setView({ center: [-63.39, -8.66] });
  await map.idle();
  const after = countInk();
  expect(checkedSamples).toBeGreaterThan(100);
  checkGround = false;
  map.removeLayer("terrain");
  await map.idle();
  countInk();
  // The permanent coarse world mesh and finer target tiles really loaded.
  expect(loaded.has("0/0_0")).toBe(true);
  expect([...loaded].some(key => key.startsWith("1/"))).toBe(true);
  // Original: 544/879, fixed: 828/879. Compare against the undepth-tested
  // border in this same view, not a brittle count of final terrain glyphs.
  expect(inked.size).toBeGreaterThan(800);
  expect(first / inked.size).toBeGreaterThan(0.9);
  expect(after).toBe(first);
});
