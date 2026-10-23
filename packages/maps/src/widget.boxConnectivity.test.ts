/** Real Natural Earth arcs and ETOPO1 terrain exercise repeated sub-cell
 * depth rejections in the South America view; no browser/data server needed.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { createGlyphMap } from "./widget";
import { glyphMapGlobe } from "./projection";
import { glyphMapDecodeGeoTileInt16 } from "./tile";
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

it.each([false, true])("keeps the real US–Mexico arc joined across rejected samples (terrain=%s)", async terrain => {
  const root = path.resolve(__dirname, "../fixtures/border-lod");
  const manifest = JSON.parse(readFileSync(path.join(root, "manifest.json"), "utf8"));
  const zooms = manifest.zooms as GlyphMapProviderZoomLevel[];
  const bounds = (z: number, x: number, y: number) => {
    const level = zooms[z]!;
    const west = -180 + x * level.tileLonSpan, north = 90 - y * level.tileLatSpan;
    return { west, east: west + level.tileLonSpan, north, south: north - level.tileLatSpan };
  };
  const provider: GlyphMapProvider = { id: "world", zooms, bounds, async loadTile(z, x, y) {
    const b = readFileSync(path.join(root, `terrain/${z}/${x}_${y}.bin`));
    return glyphMapDecodeGeoTileInt16(b, { bounds: bounds(z, x, y), cols: 180, rows: 90, source: "etopo1", sampler: "nearest" });
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
    layers: terrain ? [{ type: "raster", id: "terrain", source: provider }] : [] });
  mounted.push(map);
  await map.idle();
  const realStamp = strokes.stampGlyphMapPolyline;
  const realFinish = strokes.finishGlyphMapBoxStrokeGraph;
  let accepted: number[] = [];
  let paths: number[][] = [];
  let glyphs: string[] = [];
  vi.spyOn(strokes, "stampGlyphMapPolyline").mockImplementation((g, points, opts) => {
    const first = points[0] as strokes.GlyphMapStrokeVertex & { lon: number };
    const last = points.at(-1) as strokes.GlyphMapStrokeVertex & { lon: number };
    // Exact decoded fixture endpoints distinguish this border from Mexico's coast.
    if (first.lon !== -97.1630859375 || last.lon !== -117.1142578125) {
      realStamp(g, points, opts);
      return;
    }
    const run: number[] = [];
    const graph = opts!.boxGraph!;
    const offset = graph.paths.length;
    realStamp(g, points, { ...opts, onInk: idx => {
      if (run.at(-1) !== idx) run.push(idx);
    } });
    accepted = [...run];
    paths = graph.paths.slice(offset);
  });
  vi.spyOn(strokes, "finishGlyphMapBoxStrokeGraph").mockImplementation((g, graph) => {
    realFinish(g, graph);
    glyphs = [...g.char];
  });
  map.addLayer({ type: "line", source: borders, sharedArcs: true, simplify: "vw", experimentalGlyphStrategy: "box" });
  await map.idle();
  // Assert outside the render hook: rendering may recover from hook exceptions.
  expect(accepted.length).toBeGreaterThanOrEqual(10);
  // The formerly dotted horizontal run is solid with and without terrain.
  expect(glyphs.slice(9 * COLS + 32, 9 * COLS + 35).join("")).toBe("┬──");
  expect(accepted.map(idx => glyphs[idx]).join("")).not.toMatch(/[ ·]/);
  expect(paths).toHaveLength(1);
  expect(paths[0]!.filter(idx => accepted.includes(idx))).toEqual(accepted);
});
