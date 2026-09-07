/**
 * The OpenMapTiles table's correctness filters, through the REAL renderer.
 *
 * `vector/openmaptiles.test.ts` proves the predicates against real decoded
 * features; this proves the consequence the reader actually sees — that the
 * cells a tunnel used to ink are gone from the grid, and that the bridges
 * beside it are not. A filter that never reached the rasterizer would pass
 * every count assertion in that file and still draw the subway.
 *
 * The source is the vendored Zurich Hardbrucke tile mounted as a STATIC
 * collection rather than through a provider, so the sweep, the cache and the
 * LOD ladder are all out of the picture and nothing touches the network: the
 * only variable between the two mounts below is the layer's own filter.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createGlyphMap } from "./widget";
import { glyphMapEquirectangular } from "./projection";
import { glyphMapDecodeMVT } from "./vector/pmtiles";
import {
  glyphMapOpenMapTilesBrunnel,
  glyphMapOpenMapTilesFeatureFilter,
  glyphMapOpenMapTilesLayers,
} from "./vector/openmaptiles";
import type { GlyphMapVectorFeature } from "./vector/types";
import type { GlyphMapLineLayer } from "./widget";

const COLS = 140, ROWS = 63, CELL_W = 8, CELL_H = 16;
const rect = (w: number, h: number) =>
  ({ width: w, height: h, top: 0, left: 0, right: w, bottom: h, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
const EMPTY_RECT = rect(0, 0);
const stubbedHosts = new Set<HTMLElement>();

/** happy-dom has no layout, so the cell probes need a monospace advance to measure. */
function stubMonospaceMetrics(host: HTMLElement): void {
  stubbedHosts.add(host);
  if (vi.isMockFunction(Element.prototype.getBoundingClientRect)) return;
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
    const el = this as HTMLElement;
    if (stubbedHosts.has(el)) return rect(COLS * CELL_W, ROWS * CELL_H);
    if (el.tagName !== "PRE" || !/visibility:\s*hidden/.test(el.style.cssText)) return EMPTY_RECT;
    const fontPx = parseFloat(/font-size:\s*([\d.]+)px/.exec(el.style.cssText)?.[1] ?? "16");
    const k = fontPx / 16;
    const lines = (el.textContent ?? "").split("\n").length || 1;
    return rect(CELL_W * k, CELL_H * k * lines);
  });
}

const FIXTURES = path.resolve(__dirname, "../fixtures/openfreemap");
const zurich = glyphMapDecodeMVT(readFileSync(path.join(FIXTURES, "z14-8579-5736.mvt")), 14, 8579, 5736);

/** Frames the whole vendored tile: 8.4961..8.5181 E, 47.3803..47.3949 N. */
const VIEW = { center: [8.5071, 47.3876] as [number, number], span: 0.024, cols: COLS, rows: ROWS };

/** The count of cells the stroke pass inked — the number a reader sees change. */
function inkedCells(features: readonly GlyphMapVectorFeature[], filter: GlyphMapLineLayer["filter"]): number {
  const host = document.createElement("div");
  document.body.appendChild(host);
  stubMonospaceMetrics(host);
  const map = createGlyphMap(host, { view: VIEW, projection: glyphMapEquirectangular(), tilt: 0 });
  const roads = glyphMapOpenMapTilesLayers({ features }, { include: ["omt-roads"] })[0] as GlyphMapLineLayer;
  map.addLayer({ ...roads, ...(filter === undefined ? {} : { filter }) });
  map.scene.rerender();
  const inked = (map.scene.output.textContent ?? "").replace(/[\s\n]/g, "").length;
  map.destroy();
  host.remove();
  return inked;
}

/** Lines only — the tile's `transportation` layer also carries z14 pedestrian-apron polygons, which the row's own geometry filter drops. */
const ROADS = zurich.transportation.filter((f) => f.geometryType === "line");
/** What the row drew before the correctness axes existed: geometry and nothing else. */
const EVERYTHING = glyphMapOpenMapTilesFeatureFilter({ geometry: "line" });

describe("the roads row draws fewer cells than it used to, and the cells it loses are the tunnels", () => {
  it("inks measurably less of the grid under the shipped table", () => {
    const before = inkedCells(ROADS, EVERYTHING);
    const after = inkedCells(ROADS, undefined);
    expect(before).toBeGreaterThan(200);
    // 605 line features become 497. The ink does not fall by the same
    // fraction — a tunnel is a long feature — but it must fall.
    expect(after).toBeLessThan(before);
    expect(before - after).toBeGreaterThan(50);
  });

  it("keeps the bridges: filtering to the tunnels ALONE inks the cells the shipped table dropped", () => {
    // The discriminator. If the row had simply drawn less of everything, the
    // tunnel-only mount would ink cells the "everything" mount also has and
    // prove nothing; what it must show is that the 47 tunnel features are
    // real geometry on this grid, i.e. that hiding them is a visible change.
    const tunnels = ROADS.filter((f) => glyphMapOpenMapTilesBrunnel(f) === "tunnel");
    expect(tunnels).toHaveLength(47);
    expect(inkedCells(tunnels, EVERYTHING)).toBeGreaterThan(50);

    // And bridges survive the shipped table: mounting only the 98 bridge
    // features under the row's own filter still inks the grid.
    const bridges = ROADS.filter((f) => glyphMapOpenMapTilesBrunnel(f) === "bridge");
    expect(bridges).toHaveLength(98);
    expect(inkedCells(bridges, undefined)).toBeGreaterThan(50);
  });

  it("draws nothing at all when every feature it is given is a tunnel", () => {
    // The clean end of it: the shipped filter is what removes them, not the
    // camera or the geometry.
    const tunnels = ROADS.filter((f) => glyphMapOpenMapTilesBrunnel(f) === "tunnel");
    expect(inkedCells(tunnels, undefined)).toBe(0);
  });
});
