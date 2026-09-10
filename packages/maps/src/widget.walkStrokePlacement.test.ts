/**
 * The FIFTH "the roads are on top of the buildings", from the same
 * street-level link as `a3b7c56`/`80121f4` — the reported pairing being the
 * OSM card's own `omt-roads` at `1` and `omt-buildings` alone at `1.7`, in
 * walk mode.
 *
 * `80121f4` fixed the SKY half and measured the ROAD half correct on a
 * synthetic fixture. It was correct there and still wrong on the page,
 * because that fixture only ever read the BASE `<pre>` — and the ink the
 * reader was seeing had never been in it. The stroke was landing in the
 * BUILDINGS' own detail `<pre>`, which sits above the base one, at
 * `1/density` of its real height: `createGlyphScene`'s retained-effect
 * compositor called the legacy `transformCells` hook with the grid alone,
 * dropping the `GlyphTransformCellsLayer` second argument, so
 * `composedTransformCells` could not tell a detail grid from the base one
 * and stamped through the IDENTITY affine
 * (`createGlyphScene.effectLayerIdentity.test.ts` is that defect stated
 * without any maps knowledge). Walk mode always mounts an effect layer — the
 * sky is a mesh-targeted appearance program — so on `/maps` every road in a
 * street-level frame was redrawn across the buildings.
 *
 * The discriminator is the one `widget.walkDetailOcclusion.test.ts` already
 * uses, moved from the base `<pre>` to the picture the reader actually sees:
 * **separating a mesh into its own `<pre>` must not move the road.** Every
 * `<pre>` is composited back onto base cells by its own declared geometry, so
 * a stroke that lands in a detail grid at the wrong scale shows up as ink at
 * base cells the unseparated render does not have — which is exactly what
 * "on top of the buildings" is.
 *
 * Fixture traps: happy-dom has no layout, so `getBoundingClientRect` is
 * stubbed (the walk lens solves `zoom` from `cols * cellWidth` and a
 * zero-width host gives it nothing to solve from); and the OSM data is the
 * vendored `fixtures/openfreemap/z14-8579-5736.mvt` served through an
 * injected `fetchTile`, so nothing here touches the network.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createGlyphMap } from "./widget";
import { glyphMapGlobe } from "./projection";
import { glyphMapOpenFreeMapProvider } from "./vector/openfreemap";
import { glyphMapOpenMapTilesLayers } from "./vector/openmaptiles";
import type { GlyphMapLayer } from "./widget";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TILE = readFileSync(path.join(HERE, "../fixtures/openfreemap/z14-8579-5736.mvt"));

const COLS = 140, ROWS = 63, CELL_W = 8, CELL_H = 16;
/** The centre of the vendored tile's own coverage — z14/8579/5736, central Zürich. */
const CENTER: [number, number] = [8.5364, 47.3925];
/** The link's own span, and its own `omt-buildings` density — the only row of ten that is not `1`. */
const SPAN = 0.010791462140951094;
const BUILDING_DENSITY = 1.7;
/** The link's own enabled rows, in card order. */
const ROWS_ON = ["omt-landcover", "omt-landuse", "omt-roads", "omt-buildings"];
const WITHOUT_ROADS = ROWS_ON.filter((r) => r !== "omt-roads");

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
    const fontPx = parseFloat(/font-size:\s*([\d.]+)px/.exec(el.style.cssText)?.[1] ?? "16");
    const k = fontPx / 16;
    const lines = (el.textContent ?? "").split("\n").length || 1;
    return rect(CELL_W * k, CELL_H * k * lines);
  });
}

afterEach(() => {
  vi.restoreAllMocks();
  stubbedHosts.clear();
  document.body.innerHTML = "";
});

/** The vendored tile, for whatever address the sweep asks for — one address, at this span. */
function osmSource() {
  return glyphMapOpenFreeMapProvider({
    layers: ["landcover", "landuse", "transportation", "building"],
    fetchTile: async () => TILE.buffer.slice(TILE.byteOffset, TILE.byteOffset + TILE.byteLength),
  });
}

async function mount(rows: readonly string[], buildingDensity: number) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  stubMonospaceMetrics(host);
  const map = createGlyphMap(host, {
    projection: glyphMapGlobe(),
    view: { center: [...CENTER] as [number, number], span: SPAN, cols: COLS, rows: ROWS },
  });
  const source = osmSource();
  const densities = Object.fromEntries(rows.map((id) => [id, id === "omt-buildings" ? buildingDensity : 1]));
  for (const layer of glyphMapOpenMapTilesLayers(source, { include: [...rows], densities })) {
    map.addLayer(layer as GlyphMapLayer);
  }
  map.setWalk({});
  map.setBearing(0);
  await vi.waitFor(() => {
    expect((map.scene.output.textContent ?? "").replace(/\s/g, "").length).toBeGreaterThan(200);
  }, { timeout: 5000 });
  // The sweep resolves per layer; let every layer's own tile land before the
  // frame this test reads, so the two mounts it compares describe the same map.
  await new Promise((resolve) => setTimeout(resolve, 100));
  map.scene.rerender();
  return { map, host, done: () => { map.destroy(); host.remove(); } };
}

interface Sheet {
  readonly lines: readonly string[];
  /** This `<pre>`'s own cell size and origin, in BASE cells. */
  readonly cellW: number;
  readonly cellH: number;
  readonly tx: number;
  readonly ty: number;
}

/**
 * Every `<pre>` the map rendered, with the geometry the browser lays it out
 * by: a detail `<pre>` declares its own origin as a CSS `translate` and spans
 * the base viewport at its own density, so its cell size follows from its own
 * column count rather than from a font metric happy-dom does not have.
 */
function sheets(host: HTMLElement): Sheet[] {
  return Array.from(host.querySelectorAll("pre.glyph-output")).map((pre) => {
    const css = (pre as HTMLElement).style.cssText;
    const m = /translate\((-?[\d.]+)px,\s*(-?[\d.]+)px\)/.exec(css);
    const tx = m ? parseFloat(m[1]) : 0;
    const ty = m ? parseFloat(m[2]) : 0;
    const lines = (pre.textContent ?? "").split("\n");
    const cols = Math.max(...lines.map((l) => l.length));
    const cellW = cols > COLS ? (COLS * CELL_W - tx) / (cols - 1) : CELL_W;
    return { lines, cellW, cellH: cellW * (CELL_H / CELL_W), tx, ty };
  });
}

/** The BASE cells at which any `<pre>` shows a glyph the road layer put there. */
function roadCells(after: readonly Sheet[], before: readonly Sheet[]): Set<number> {
  const out = new Set<number>();
  for (let s = 0; s < after.length; s++) {
    const a = after[s]!, b = before[s];
    if (!b) continue;
    for (let r = 0; r < a.lines.length; r++) {
      const la = a.lines[r] ?? "", lb = b.lines[r] ?? "";
      for (let c = 0; c < Math.max(la.length, lb.length); c++) {
        if (la[c] === lb[c]) continue;
        const x0 = a.tx + c * a.cellW, y0 = a.ty + r * a.cellH;
        for (let br = Math.floor(y0 / CELL_H); br <= Math.floor((y0 + a.cellH - 1e-9) / CELL_H); br++) {
          for (let bc = Math.floor(x0 / CELL_W); bc <= Math.floor((x0 + a.cellW - 1e-9) / CELL_W); bc++) {
            if (bc < 0 || bc >= COLS || br < 0 || br >= ROWS) continue;
            out.add(br * COLS + bc);
          }
        }
      }
    }
  }
  return out;
}

/**
 * Where the road is visible, in base cells, at a given `omt-buildings`
 * density — or, with `buildings: false`, where it runs with nothing in front
 * of it at all.
 */
async function roadInk(
  buildingDensity: number,
  opts: { readonly buildings?: boolean } = {},
): Promise<Set<number> & { outputs: number }> {
  const keep = (rows: readonly string[]) => (opts.buildings === false ? rows.filter((r) => r !== "omt-buildings") : rows);
  const without = await mount(keep(WITHOUT_ROADS), buildingDensity);
  const before = sheets(without.host);
  without.done();
  const withRoads = await mount(keep(ROWS_ON), buildingDensity);
  const after = sheets(withRoads.host);
  const outputs = withRoads.host.querySelectorAll("pre.glyph-output").length;
  withRoads.done();
  return Object.assign(roadCells(after, before), { outputs });
}

describe("street-level walk — separating the buildings does not move the road", () => {
  it("inks only cells the road itself runs through, at the reported 1 / 1.7 pairing", async () => {
    // Ground truth for POSITION, measured through the real renderer with
    // nothing in front of the road: occlusion can only ever take cells out of
    // this footprint, so any ink outside it is ink the road does not own.
    // Independent of both renders below, and of the buildings entirely.
    const path = await roadInk(BUILDING_DENSITY, { buildings: false });
    const inBase = await roadInk(1);
    const separated = await roadInk(BUILDING_DENSITY);

    // Premises, so the clause below cannot pass vacuously: the road really
    // draws in a street-level frame, the buildings really hide part of it, at
    // `1.7` they really did leave the base `<pre>`, and the road still draws
    // once they have.
    expect(path.size).toBeGreaterThan(20);
    expect(path.size - inBase.size).toBeGreaterThan(20);
    expect(inBase.outputs).toBe(1);
    expect(separated.outputs).toBeGreaterThan(1);
    expect(separated.size).toBeGreaterThan(0);

    // The claim, stated as a PLACEMENT bound rather than a count — a count
    // would pass on a fix that traded one stretch of road for another, which
    // is exactly what drawing the road at `1/density` of its own height does.
    //
    // The one base cell of slack is the whole of what a change of RESOLUTION
    // can move a stroke: both renders draw the same continuous road, but one
    // rounds it to base cells and the other to cells `1.7` times finer that
    // are then composited back, so a fine cell can land in a base cell the
    // coarse render put its neighbour in — and no further. The defect moved
    // the road ten rows, onto the buildings.
    const near = new Set<number>();
    for (const i of path) {
      const c = i % COLS, r = Math.floor(i / COLS);
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          const nc = c + dc, nr = r + dr;
          if (nc >= 0 && nc < COLS && nr >= 0 && nr < ROWS) near.add(nr * COLS + nc);
        }
      }
    }
    expect([...separated].filter((i) => !near.has(i))).toEqual([]);
  }, 40000);
});
