/**
 * A `contour` must survive the relief it annotates, for exactly the reason a
 * draped `line` must (`widget.strokeRelief.test.ts`).
 *
 * SINCE `3924f61` A CONTOUR IS GEOMETRY. It is marched in the field's own
 * lon/lat domain and every vertex is projected at the level's own elevation,
 * then handed to `stampGlyphMapPolyline` — the same stamper, the same
 * one-sided depth test against the terrain's depth buffer. That is exactly
 * the comparison the `line` layer needed a ground-support allowance for: the
 * contour reads the tile's FULL-RESOLUTION vertex grid while the terrain
 * rasterizes from quads coarsened per pyramid level, so the two representations
 * of the SAME surface disagree, and a one-sided test against that disagreement
 * deletes about half of every line crossing rough ground.
 *
 * The record for `line` says the contour "was never exposed to this while it
 * sampled per cell" — true, and no longer true since it stopped sampling per
 * cell. Measured on this fixture before the fix, `{ interval: 200 }` at
 * `tilt: 0`: 722 cells with no terrain mounted, 418 with it — 42% lost.
 *
 * WHY `tilt: 0` IS THE WHOLE POINT. An orthographic camera looking straight
 * down at a height field cannot self-occlude: there is no ridge in front of
 * anything, so EVERY cell the depth test removes at this pitch is a false
 * positive, and the picture with the terrain mounted should be the picture
 * without it.
 *
 * WHAT THE FIX LEAVES, STATED. Giving the contour the `line` layer's own
 * ground-support slack takes those three losses to 100 / 15 / 42, against a
 * structural floor of under 20 (measured with the depth test removed
 * entirely). The remainder is not the support radius — widening it in cells
 * saturates — but the same coarse-quad-versus-fine-field disagreement
 * AGENTS.md already records for a `line`: at these spans one relief quad is
 * several output cells wide, and a chord across it can stand above the field
 * it was cut from by more than the ground within a quad of the line ever
 * rises. The ceilings below therefore sit BETWEEN the defect and the fix,
 * with wide margin either way, rather than claiming a loss of zero.
 *
 * The fixture is `widget.strokeRelief.test.ts`'s — real ETOPO1 at the z4
 * pyramid's own 0.125-degree vertex spacing — for the same reason: it is the
 * relief the report was about, at the resolution the map renders it.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createGlyphMap } from "./widget";
import { glyphMapGlobe } from "./projection";
import type { GlyphMapGeoTile } from "./tile";
import type { GlyphMapProvider } from "./provider";

const COLS = 140;
const ROWS = 63;
const CELL_W = 8;
const CELL_H = 16;
const BASE_FONT_PX = 16;
const CENTRE: readonly [number, number] = [26.677342, 25.465411];
const EXAGGERATION = 24;
const CONTOUR = "#00aaff";

const fixture = JSON.parse(
  readFileSync(path.resolve(__dirname, "../fixtures/sahara-border.json"), "utf8"),
) as { bounds: GlyphMapGeoTile["bounds"]; cols: number; rows: number; elevation: number[]; source: string; sampler: string };

/**
 * The fixture's real ETOPO1 block, served through a real pyramid so the
 * `raster` layer and the `contour` layer read the IDENTICAL vertex grids — the
 * relief mesh is built from a tile's `(cols+1) x (rows+1)` elevation array and
 * the contour is marched over the same one, which is the arrangement on
 * `/maps` and the only one in which "the two representations of the same
 * surface" means anything. Tiles are baked at the real z4 pyramid's own
 * 0.125-degree vertex spacing; the 8-degree fixture block is repeated to fill
 * a tile, so the ROUGHNESS is real wherever the view lands.
 */
function terrainProvider(): GlyphMapProvider {
  const zooms = [0, 1, 2, 3, 4].map((z) => ({
    z, cols: 2 ** z, rows: 2 ** z,
    tileLonSpan: 360 / 2 ** z, tileLatSpan: 180 / 2 ** z,
    tileCols: Math.round(360 / 2 ** z / 0.125), tileRows: Math.round(180 / 2 ** z / 0.125),
  }));
  const bounds = (z: number, x: number, y: number) => {
    const level = zooms[z];
    const west = -180 + x * level.tileLonSpan;
    const north = 90 - y * level.tileLatSpan;
    return { west, east: west + level.tileLonSpan, south: north - level.tileLatSpan, north };
  };
  const wrap = (v: number, lo: number, span: number): number => {
    const t = (v - lo) % span;
    return t < 0 ? t + span : t;
  };
  const sample = (lon: number, lat: number): number => {
    const fx = Math.min(fixture.cols, Math.round((wrap(lon, fixture.bounds.west, 8) / 8) * fixture.cols));
    const fy = Math.min(fixture.rows, Math.round((wrap(fixture.bounds.north - lat, 0, 8) / 8) * fixture.rows));
    return fixture.elevation[fy * (fixture.cols + 1) + fx] ?? 0;
  };
  return {
    id: "contour-relief",
    zooms,
    bounds,
    async loadTile(z, x, y): Promise<GlyphMapGeoTile> {
      const b = bounds(z, x, y);
      const level = zooms[z];
      const elevation = new Float32Array((level.tileCols + 1) * (level.tileRows + 1));
      for (let row = 0; row <= level.tileRows; row++) {
        const lat = b.north - (row / level.tileRows) * level.tileLatSpan;
        for (let col = 0; col <= level.tileCols; col++) {
          elevation[row * (level.tileCols + 1) + col] = sample(b.west + (col / level.tileCols) * level.tileLonSpan, lat);
        }
      }
      return { bounds: b, cols: level.tileCols, rows: level.tileRows, elevation, source: "contour-relief", sampler: "nearest" };
    },
  };
}

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

const settle = async () => { for (let i = 0; i < 40; i++) await new Promise((resolve) => setTimeout(resolve, 10)); };

/** The cells painted in the contour's own colour, read off the base `<pre>`'s spans — blue-dominant, whatever Lambert did to the terrain around it. */
function contourCells(map: { scene: { output: HTMLElement } }): Set<number> {
  const out = new Set<number>();
  let row = 0;
  let col = 0;
  const walk = (node: Node, color: string | null): void => {
    if (node.nodeType === 3) {
      for (const ch of node.textContent ?? "") {
        if (ch === "\n") { row++; col = 0; continue; }
        if (ch !== " " && color) {
          const n = Number.parseInt(color.slice(1), 16);
          if ((n & 255) > ((n >> 8) & 255)) out.add(row * COLS + col);
        }
        col++;
      }
      return;
    }
    const el = node as HTMLElement;
    const own = el.style?.color || color;
    for (const child of Array.from(el.childNodes)) walk(child, own);
  };
  for (const child of Array.from(map.scene.output.childNodes)) walk(child, null);
  return out;
}

async function render(span: number, exaggeration: number, withTerrain: boolean) {
  const source = terrainProvider();
  const host = document.createElement("div");
  document.body.appendChild(host);
  hostsToRemove.push(host);
  stubMonospaceMetrics(host);
  const map = createGlyphMap(host, {
    view: { center: [CENTRE[0], CENTRE[1]], span, cols: COLS, rows: ROWS },
    projection: glyphMapGlobe({ exaggeration }),
    tilt: 0,
    layers: [
      ...(withTerrain ? [{ type: "raster" as const, id: "terrain", source }] : []),
      { type: "contour" as const, id: "iso", source, levels: { interval: 200 }, color: CONTOUR },
    ],
    scene: { mode: "solid", useColors: true },
  });
  mounted.push(map);
  await settle();
  map.scene.rerender();
  return contourCells(map);
}

describe("createGlyphMap — a `contour` survives the relief it annotates", () => {
  /**
   * The SAME contour, with and without the terrain under it, at a pitch where
   * nothing can occlude anything. Cells, not total ink: a count could be met
   * by the line moving somewhere else.
   */
  /**
   * The SAME contour, with and without the terrain under it, at a pitch where
   * nothing can occlude anything. Cells, not total ink: a count could be met
   * by the line moving somewhere else.
   *
   * `ceiling` is a MEASURED floor-and-ceiling in this file's own house style
   * (`widget.strokeRelief.test.ts`'s): the loss before the fix, the loss
   * after it, and a bound between the two with wide margin either way.
   */
  const contourIsNotEatenByItsOwnSurface = async (span: number, exaggeration: number, ceiling: number) => {
    const alone = await render(span, exaggeration, false);
    // The premise: the layer draws a real amount of line, so a loss below is
    // a loss and not an empty comparison.
    expect(alone.size).toBeGreaterThan(300);
    const overTerrain = await render(span, exaggeration, true);
    const lost = [...alone].filter((idx) => !overTerrain.has(idx));
    expect(lost.length).toBeLessThan(ceiling);
  };

  // 1,166 of 3,375 cells lost before the fix, 100 after; fewer than 20 with
  // the depth test removed entirely, which is the honest structural loss.
  it("at the reported Sahara view", async () => {
    await contourIsNotEatenByItsOwnSurface(16.810437949565824, EXAGGERATION, 400);
  }, 30000);

  // 520 of 1,371 lost before, 15 after.
  it("at a country span", async () => {
    await contourIsNotEatenByItsOwnSurface(6, EXAGGERATION, 150);
  }, 30000);

  // 296 of 609 lost before, 42 after — the worst of the three, and the
  // reason the fix cannot be an exaggeration story.
  it("at true scale, where the record says the loss was WORSE and so cannot be an exaggeration artefact", async () => {
    await contourIsNotEatenByItsOwnSurface(3, 1, 120);
  }, 30000);
});
