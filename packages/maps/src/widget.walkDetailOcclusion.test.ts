/**
 * The FOURTH "the roads are on top of everything", and its twin "the sky is
 * also on top of everything" — both reported from the same street-level link,
 * whose OSM stack carries nine rows at density `1` and `omt-buildings` alone
 * at `1.7`.
 *
 * `a3b7c56` fixed the ORBIT half of this (`CellGrid.occluded`, honoured by
 * `stroke.ts`). Walking, neither symptom moved, and measured on this file's
 * own fixture at the entry pose both were untouched by it: the road inked all
 * 140 of its base cells with the building separated against 109 with it in
 * the base grid, and the dome painted all 4,480 of its cells against 3,767.
 * Two defects in glyphcss, both invisible to an orthographic camera, each
 * enough on its own to produce a symptom:
 *
 *  1. `computeOcclusionIds` did not near-plane clip, and filled the shared
 *     id-map's depth with `project()[2]` while every pass's own `CellGrid.depth`
 *     holds `project()[3] ?? [2]`. Under an ORTHO camera those are the same
 *     number and nothing straddles the near plane, so the two agreed for as
 *     long as glyphcss had only orbit cameras. Under the walk camera they are
 *     different quantities (linear `cssZ` against screen-linear `1/denom`), so
 *     the sub-cell seam refinement compared incompatible units and refused
 *     every blank — the base grid was never occluded at all, which is the SKY.
 *  2. The retained-effect compositor rebuilt the grid handed to the legacy
 *     `transformCells` hook without carrying `occluded` across, so the fix
 *     `a3b7c56` put in `stroke.ts` was inert whenever any effect layer was
 *     mounted — and walk mode always mounts one, because the sky is coloured
 *     by a mesh-targeted appearance program. That is the ROAD.
 *
 * The discriminator here is the same for both and needs no absolute cell
 * count: **separating a mesh into its own `<pre>` must not change which cells
 * the base grid paints for anything else.** A building at density `1` is
 * occluded by the ordinary base-grid depth test (the case that always worked);
 * the same building at `1.7` must hide exactly the same sky and road cells.
 *
 * Fixture trap: happy-dom has no layout, so `getBoundingClientRect` is stubbed
 * — the walk lens solves `zoom` from `cols * cellWidth` and a zero-width host
 * gives it nothing to solve from.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { createGlyphMap } from "./widget";
import { GLYPH_MAP_EARTH_RADIUS_M, glyphMapGlobe } from "./projection";
import { GLYPH_MAP_SKY_BANDS, glyphMapSkyPalette } from "./sky";
import type { GlyphMapVectorFeature } from "./vector/types";

const COLS = 140, ROWS = 63, CELL_W = 8, CELL_H = 16;
const ZURICH: readonly [number, number] = [8.5445, 47.37418];
/** The reported link's own `omt-buildings` density — the only row of ten that is not `1`. */
const BUILDING_DENSITY = 1.7;

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

function mount(layers: Parameters<typeof createGlyphMap>[1]["layers"]) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  stubMonospaceMetrics(host);
  const map = createGlyphMap(host, {
    projection: glyphMapGlobe(),
    view: { center: [ZURICH[0], ZURICH[1]] as [number, number], span: 0.01, cols: COLS, rows: ROWS },
    ...(layers ? { layers } : {}),
  });
  map.setWalk({});
  map.setBearing(0);
  map.scene.rerender();
  return { map, host, done: () => { map.destroy(); host.remove(); } };
}

const degFor = (m: number) => (m / GLYPH_MAP_EARTH_RADIUS_M) * (180 / Math.PI);
/** A 60 m block, 60 m across, standing 200 m in front of the walker — inside the frame with sky above it and road under it. */
const AHEAD = degFor(200);
const HALF = degFor(30);
const building: GlyphMapVectorFeature = {
  id: "block",
  geometryType: "polygon",
  rings: [[
    [ZURICH[0] - HALF, ZURICH[1] + AHEAD - HALF],
    [ZURICH[0] + HALF, ZURICH[1] + AHEAD - HALF],
    [ZURICH[0] + HALF, ZURICH[1] + AHEAD + HALF],
    [ZURICH[0] - HALF, ZURICH[1] + AHEAD + HALF],
    [ZURICH[0] - HALF, ZURICH[1] + AHEAD - HALF],
  ]],
  properties: { render_height: 60 },
};
/** A west-east street through the building's own footprint, short enough that both ends are inside the walk horizon. */
const road: GlyphMapVectorFeature = {
  id: "street",
  geometryType: "line",
  rings: [[[ZURICH[0] - 0.002, ZURICH[1] + AHEAD], [ZURICH[0] + 0.002, ZURICH[1] + AHEAD]]],
};

const buildingLayer = (density: number) => ({
  type: "fill-extrusion" as const,
  id: "buildings",
  source: { features: [building] },
  color: "#94a3b8",
  heightProperty: "render_height",
  ...(density === 1 ? {} : { density }),
});
const roadLayer = { type: "line" as const, id: "roads", source: { features: [road] }, color: "#e8c988" };

/** Per-character `#rrggbb` of a rendered `<pre>`, row-major (`widget.sky.test.ts`'s own reader). */
function renderedColors(pre: HTMLElement): (string | null)[] {
  const out: (string | null)[] = [];
  for (const node of Array.from(pre.childNodes)) {
    const text = node.textContent ?? "";
    let color: string | null = null;
    if (node.nodeType === 1) {
      const m = /color:\s*(#[0-9a-fA-F]{6})/.exec((node as HTMLElement).getAttribute("style") ?? "");
      color = m ? m[1].toLowerCase() : null;
    }
    for (const ch of text) out.push(ch === "\n" ? null : color);
  }
  return out;
}

const hex = (r: number, g: number, b: number) =>
  `#${[r, g, b].map((c) => Math.round(c).toString(16).padStart(2, "0")).join("")}`;

/** Every colour the banded sky gradient can produce at this sun altitude — derived from the shipped palette and band count, never a copied list. */
function skyBandColors(altitudeDeg: number): Set<string> {
  const { horizon, zenith } = glyphMapSkyPalette(altitudeDeg);
  const out = new Set<string>();
  for (let band = 0; band < GLYPH_MAP_SKY_BANDS; band++) {
    const t = (band + 0.5) / GLYPH_MAP_SKY_BANDS;
    out.add(hex(
      horizon[0] + (zenith[0] - horizon[0]) * t,
      horizon[1] + (zenith[1] - horizon[1]) * t,
      horizon[2] + (zenith[2] - horizon[2]) * t,
    ));
  }
  return out;
}

/** The base `<pre>` cells painted in a sky colour, as an index set. */
function skyCells(density: number | null): Set<number> {
  const { map, done } = mount(density === null ? [] : [buildingLayer(density)]);
  const day = skyBandColors(90);
  const colors = renderedColors(map.scene.output);
  const out = new Set<number>();
  for (let i = 0; i < colors.length; i++) if (colors[i] && day.has(colors[i]!)) out.add(i);
  done();
  return out;
}

/** The base `<pre>` characters the ROAD layer itself changed, as an index set. */
function roadCells(density: number): Set<number> {
  const without = mount([buildingLayer(density)]);
  const before = (without.map.scene.output.textContent ?? "").split("");
  without.done();
  const withRoad = mount([buildingLayer(density), roadLayer]);
  const after = (withRoad.map.scene.output.textContent ?? "").split("");
  const detail = Array.from(withRoad.host.querySelectorAll("pre.glyph-output")).length;
  withRoad.done();
  const out = new Set<number>();
  for (let i = 0; i < Math.max(before.length, after.length); i++) {
    if (before[i] !== after[i]) out.add(i);
  }
  return Object.assign(out, { outputs: detail }) as Set<number> & { outputs: number };
}

describe("street-level walk — a building at its own density still occludes the base grid", () => {
  it("the SKY paints the same cells whether or not the building separated into its own <pre>", () => {
    const open = skyCells(null);
    const inBase = skyCells(1);
    const separated = skyCells(BUILDING_DENSITY);

    // Premises, so neither clause below can pass vacuously: the dome really
    // fills a street-level frame, and a building in the base grid really does
    // take cells from it.
    expect(open.size).toBeGreaterThan(1000);
    expect(open.size - inBase.size).toBeGreaterThan(100);
    for (const i of inBase) expect(open.has(i)).toBe(true);

    // The claim. Cell-exact both ways: a count would pass on a fix that
    // traded one region of the dome for another.
    expect([...separated].filter((i) => !inBase.has(i))).toEqual([]);
    expect([...inBase].filter((i) => !separated.has(i))).toEqual([]);
  });

  it("the ROAD inks the same cells whether or not the building separated into its own <pre>", () => {
    const inBase = roadCells(1);
    const separated = roadCells(BUILDING_DENSITY);

    // Premises: the road draws at all, the building in the base grid hides
    // part of it, and at 1.7 the building really did leave the base `<pre>`.
    expect(inBase.size).toBeGreaterThan(50);
    expect((separated as Set<number> & { outputs: number }).outputs).toBeGreaterThan(1);

    expect([...separated].filter((i) => !inBase.has(i))).toEqual([]);
    expect([...inBase].filter((i) => !separated.has(i))).toEqual([]);
  });

  it("the building really is hidden behind — the road at density 1 loses cells to it", () => {
    // The other half of the premise for the clause above: without this, a
    // road that the building never occluded in EITHER case would pass.
    const noBuilding = mount([roadLayer]);
    const openText = (noBuilding.map.scene.output.textContent ?? "").split("");
    const openBase = mount([]);
    const openBefore = (openBase.map.scene.output.textContent ?? "").split("");
    openBase.done();
    noBuilding.done();
    let openInk = 0;
    for (let i = 0; i < Math.max(openText.length, openBefore.length); i++) if (openText[i] !== openBefore[i]) openInk++;
    expect(openInk - roadCells(1).size).toBeGreaterThan(20);
  });
});
