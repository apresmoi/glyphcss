/**
 * A globe view centred EXACTLY on a pole must still unproject.
 *
 * Found while reproducing the contour tile-boundary defect, and separate from
 * it: `unprojectSphere` seeds its Newton iteration with the sub-observer point
 * (`projection.centerForCamera(camera.rotX, camera.rotY)`). At a pole that
 * point is a coordinate singularity — every longitude is the same place, so
 * the (lon, lat) Jacobian's longitude column is zero — the first iteration
 * reports a degenerate determinant, and EVERY cell returns `null`.
 *
 * The blast radius is everything that unprojects: `map.unproject`,
 * click-to-lonlat, and a `contour` layer's per-cell elevation lookup, which
 * then paints nothing at all. Measured before the fix at `center: [0, 90]`,
 * `span: 170`: 0 of 1,128 sampled cells unprojected, and the contour layer's
 * output was empty despite 40 tiles loaded and a resolved field range. One
 * tenth of a degree away (`center: [0, 89.9]`) 357 of the same 1,128 cells
 * unprojected normally — the failure is exactly AT the pole, which is why an
 * ordinary drag never hit it and a `setView`/`flyTo` straight to the pole
 * does.
 *
 * The fix keeps the iteration's start (and every step it takes) `POLE_SAFE_LAT`
 * off the pole. That is a property of the coordinate system, not of the view:
 * latitude is degenerate there whatever the camera is doing.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { createGlyphMap } from "./widget";
import { glyphMapGlobe } from "./projection";

const VIEW_COLS = 80, VIEW_ROWS = 40, CELL_W = 8, CELL_H = 16, PROBE_FONT_PX = 16;

const rect = (w: number, h: number) =>
  ({ width: w, height: h, top: 0, left: 0, right: w, bottom: h, x: 0, y: 0, toJSON() {} }) as DOMRect;
const EMPTY_RECT = rect(0, 0);
const stubbedHosts = new Set<HTMLElement>();

function stubMonospaceMetrics(host: HTMLElement): void {
  stubbedHosts.add(host);
  if (vi.isMockFunction(Element.prototype.getBoundingClientRect)) return;
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
    const el = this as HTMLElement;
    if (stubbedHosts.has(el)) return rect(VIEW_COLS * CELL_W, VIEW_ROWS * CELL_H);
    if (el.tagName !== "PRE" || !/visibility:\s*hidden/.test(el.style.cssText)) return EMPTY_RECT;
    const fontPx = parseFloat(/font-size:\s*([\d.]+)px/.exec(el.style.cssText)?.[1] ?? String(PROBE_FONT_PX));
    const k = fontPx / PROBE_FONT_PX;
    const lines = (el.textContent ?? "").split("\n").length || 1;
    return rect(CELL_W * k, CELL_H * k * lines);
  });
}

afterEach(() => {
  document.body.innerHTML = "";
  stubbedHosts.clear();
  vi.restoreAllMocks();
});

function mapAt(centerLat: number) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  stubMonospaceMetrics(host);
  return createGlyphMap(host, {
    view: { center: [0, centerLat], span: 170, cols: VIEW_COLS, rows: VIEW_ROWS },
    projection: glyphMapGlobe({ exaggeration: 1 }),
    tilt: 0,
    maxSpan: 720,
  });
}

/** Cells that unproject, and — for those that do — how well they reproject back. */
function unprojectable(map: ReturnType<typeof mapAt>): { ok: number; total: number; worstReprojectCells: number } {
  let ok = 0, total = 0, worst = 0;
  for (let row = 0; row < VIEW_ROWS; row += 2) {
    for (let col = 0; col < VIEW_COLS; col += 2) {
      total++;
      const ll = map.unproject([col + 0.5, row + 0.5]);
      if (!ll) continue;
      ok++;
      const back = map.project(ll);
      worst = Math.max(worst, Math.hypot(back.col - (col + 0.5), back.row - (row + 0.5)));
    }
  }
  return { ok, total, worstReprojectCells: worst };
}

describe("createGlyphMap — globe unproject at an exactly-polar view", () => {
  for (const [name, centerLat] of [["north", 90], ["south", -90]] as const) {
    it(`${name} pole: a view centred exactly on it still unprojects`, () => {
      const atPole = mapAt(centerLat);
      const pole = unprojectable(atPole);
      // A reference view a tenth of a degree away — the same map, off the
      // singularity. The polar view must answer for a comparable share of its
      // cells, not for none.
      const nearPole = mapAt(centerLat > 0 ? 89.9 : -89.9);
      const near = unprojectable(nearPole);

      expect(near.ok).toBeGreaterThan(near.total * 0.2); // guard the reference
      expect(pole.ok).toBeGreaterThan(near.ok * 0.9);

      // Answering is not enough — the answers have to be right. Every cell
      // that unprojects must reproject back to within a cell of itself.
      expect(pole.worstReprojectCells).toBeLessThan(1);

      // The pole itself is directly under the camera, so it lands at the
      // view's own centre.
      const centre = atPole.unproject([VIEW_COLS / 2, VIEW_ROWS / 2]);
      expect(centre).not.toBeNull();
      expect(centre![1]).toBeCloseTo(centerLat, 2);

      atPole.destroy();
      nearPole.destroy();
    });
  }
});
