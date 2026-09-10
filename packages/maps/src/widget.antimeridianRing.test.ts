/**
 * Regression for the polar "concentric polygon" artifact reported live on
 * `/maps` with the Borders (`line`) layer on: rings of border ink circling
 * each pole, one `2^z`-sided polygon per affected latitude, with vertices
 * exactly on the tile-column boundaries of the resolved LOD (at z3, an
 * octagon whose corners sit at longitude multiples of 45).
 *
 * **Mechanism** (reproduced against the real baked pyramid before this test
 * was written; see `vector/clip.ts`'s `glyphMapSplitAtAntimeridian`): Natural
 * Earth writes a polygon that spans the ±180 seam as ONE ring carrying
 * vertices on both sides — the 50m source's Russia ring 17 steps
 * `[179.867, 69.012] -> [-180, 68.984]`, Fiji's ring 15 `[-180, -16.540] ->
 * [180, -16.540]`, Antarctica's ring 3 `[179.622, -84.268] -> [-180,
 * -84.352]`. Read as a PLANAR segment — which is what `glyphMapBuildVectorTile`
 * did — each of those is a 360°-wide bar at a near-fixed latitude sweeping
 * the whole world backwards, so the box clip deposited one full-tile-width
 * chord in EVERY tile at that latitude, including every tile the country
 * never touches. The baked tiles really did carry them (measured: Russia at
 * lat 65.05/68.99/70.99/71.53, Fiji at -16.50/-16.54, Antarctica at -84.3,
 * in all 8 columns of z3), which is why nothing in the render path could
 * detect them any more: by then each chord is an ordinary 45°-wide segment,
 * indistinguishable from real geometry.
 *
 * The fixture below is that exact shape at ~1/1000 the vertex count: one
 * feature whose real geometry lives only near the seam and whose ring
 * therefore carries one `+179 -> -180` jump, plus a control feature far from
 * the seam that must render byte-identically either way — the clause that
 * makes "suppress border ink near a tile boundary or a pole" fail this test
 * rather than pass it.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { createGlyphMap } from "./widget";
import { glyphMapGlobe } from "./projection";
import { glyphMapBuildVectorTile, glyphMapDecodeVectorTile, glyphMapVectorTileBounds } from "./vector/tile";
import type { GlyphMapVectorFeature, GlyphMapVectorProvider, GlyphMapVectorTile } from "./vector/types";

const COLS = 160;
const ROWS = 64;
const CELL_W = 8;
const CELL_H = 16;
const BASE_FONT_PX = 16;
const BAKE_Z = 3;
/** The latitude the fixture's seam-spanning ring sits at — a chord at this exact latitude is the artifact. */
const WRAP_LAT = 70;

const EMPTY_RECT = { width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0, x: 0, y: 0, toJSON: () => ({}) } as DOMRect;
function rect(width: number, height: number): DOMRect {
  return { width, height, top: 0, left: 0, right: width, bottom: height, x: 0, y: 0, toJSON: () => ({}) } as DOMRect;
}

/** happy-dom has no layout, so without this the measured cell and the camera's own fallback cell disagree (same reason as `widget.renderMode.test.ts`'s). */
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

afterEach(() => {
  document.body.innerHTML = "";
  stubbedHosts.clear();
  vi.restoreAllMocks();
});

/**
 * A closed ring whose real geometry hugs the antimeridian on both sides, in
 * the ±180-duplicating convention Natural Earth uses: the east lobe ends at
 * `[179, WRAP_LAT]` and the next vertex is `[-180, WRAP_LAT]` on the far
 * side of the seam. That one step is the 359°-wide phantom.
 */
function seamRing(): GlyphMapVectorFeature {
  const ring: [number, number][] = [
    [150, WRAP_LAT + 6], [165, WRAP_LAT + 3], [179, WRAP_LAT],
    [-180, WRAP_LAT], [-170, WRAP_LAT + 3], [-160, WRAP_LAT + 6],
    [-160, WRAP_LAT + 10], [150, WRAP_LAT + 10], [150, WRAP_LAT + 6],
  ];
  return { id: "seam", properties: { name: "Seamland" }, geometryType: "polygon", rings: [ring] };
}

/** A control border far from the seam and from every pole — a meridian run at lon 0. */
function controlFeature(): GlyphMapVectorFeature {
  const ring: [number, number][] = [];
  for (let lat = 58; lat <= 80; lat += 1) ring.push([0, lat]);
  return { id: "control", properties: { name: "Control" }, geometryType: "line", rings: [ring] };
}

function bakedProvider(features: readonly GlyphMapVectorFeature[]): GlyphMapVectorProvider {
  const n = 2 ** BAKE_Z;
  const tiles = new Map<string, GlyphMapVectorTile>();
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const wire = glyphMapBuildVectorTile({ admin0: features }, BAKE_Z, x, y, { source: "fixture", simplify: "none" });
      tiles.set(`${x}_${y}`, glyphMapDecodeVectorTile(wire));
    }
  }
  return {
    id: "seam-fixture",
    zooms: [BAKE_Z].map((z) => ({ z, cols: 2 ** z, rows: 2 ** z, tileLonSpan: 360 / 2 ** z, tileLatSpan: 180 / 2 ** z, tileCols: 180, tileRows: 90 })),
    bounds: (z, x, y) => glyphMapVectorTileBounds(z, x, y),
    loadTile: async (_z, x, y) => tiles.get(`${x}_${y}`)!,
  };
}

interface Render {
  readonly map: ReturnType<typeof createGlyphMap>;
  readonly host: HTMLElement;
  readonly lines: readonly string[];
  readonly ink: ReadonlySet<string>;
}

async function render(features: readonly GlyphMapVectorFeature[] | null): Promise<Render> {
  const host = document.createElement("div");
  document.body.appendChild(host);
  stubMonospaceMetrics(host);
  const map = createGlyphMap(host, {
    // A north-polar view, wide enough that the whole WRAP_LAT parallel is on
    // screen: span 70 over 160 columns is 0.44 deg/cell, which resolves to
    // the z3 LOD (native 0.25 deg/cell) — the level the live report saw.
    view: { center: [0, 88], span: 70, cols: COLS, rows: ROWS },
    projection: glyphMapGlobe(),
    tilt: 0,
  });
  map.scene.rerender();
  const blank = (map.scene.output.textContent ?? "").split("\n");
  if (features) {
    map.addLayer({ type: "line", id: "borders", source: bakedProvider(features), color: "#e8c988" });
    await new Promise((r) => setTimeout(r, 300));
    map.scene.rerender();
  }
  const lines = (map.scene.output.textContent ?? "").split("\n");
  const ink = new Set<string>();
  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) {
      if ((lines[row]?.[col] ?? " ") !== (blank[row]?.[col] ?? " ")) ink.add(`${col},${row}`);
    }
  }
  return { map, host, lines, ink };
}

describe("createGlyphMap — a seam-spanning source ring never rings a pole with tile-boundary chords", () => {
  it("inks nothing along the WRAP_LAT parallel at longitudes the feature never reaches, while the control border is byte-identical", async () => {
    const control = await render([controlFeature()]);
    const both = await render([seamRing(), controlFeature()]);

    // The control really drew something — otherwise every assertion below
    // passes for the wrong reason.
    expect(control.ink.size).toBeGreaterThan(8);

    // 1. GENUINE GEOMETRY UNCHANGED. Every cell the control border inked on
    //    its own carries the IDENTICAL glyph with the seam feature also
    //    mounted. A "fix" that suppressed stroking near a tile boundary or
    //    near a pole would fail here, not pass.
    for (const key of control.ink) {
      const [col, row] = key.split(",").map(Number);
      expect(`${key}:${both.lines[row]?.[col]}`).toBe(`${key}:${control.lines[row]?.[col]}`);
    }

    // 2. THE ARTIFACT. The feature's real geometry lives entirely at
    //    |lon| >= 150; the phantom chord runs along WRAP_LAT at EVERY
    //    longitude. Probe the parallel where the feature has nothing, on
    //    both sides of the map and across three z3 tile columns each.
    //    Walk the WHOLE parallel at 2-degree steps rather than a handful of
    //    probes, so this catches a chord anywhere on the ring, not only on
    //    the tile columns it happens to be sampled at. `|lon| < 12` is
    //    skipped: that is the control border's own cell neighbourhood.
    //    Measured with the split disabled: 14 of these probes were inked.
    const inked: string[] = [];
    for (let lon = -150; lon <= 150; lon += 2) {
      if (Math.abs(lon) < 12) continue;
      const p = both.map.project([lon, WRAP_LAT]);
      expect(p.visible).toBe(true);
      const col = Math.floor(p.col);
      const row = Math.floor(p.row);
      if (both.ink.has(`${col},${row}`)) inked.push(`${lon} -> (${col},${row}) '${both.lines[row]?.[col]}'`);
    }
    expect(inked).toEqual([]);

    // 3. THE FEATURE IS STILL DRAWN. Deleting the seam feature outright
    //    would satisfy (1) and (2) — its own east lobe must still ink.
    const real = both.map.project([165, WRAP_LAT + 3]);
    expect(real.visible).toBe(true);
    const near = [...both.ink].filter((key) => {
      const [col, row] = key.split(",").map(Number);
      return Math.hypot(col - real.col, row - real.row) <= 2;
    });
    expect(near.length).toBeGreaterThan(0);

    control.map.destroy();
    control.host.remove();
    both.map.destroy();
    both.host.remove();
  }, 30000);
});
