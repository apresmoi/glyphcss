// @vitest-environment happy-dom
/**
 * CAST SHADOWS ACROSS DETAIL LAYERS — the blocker behind "OSM layers on,
 * Shadows on, no shadow anywhere".
 *
 * `/maps` gives the whole OpenStreetMap stack ONE density slider, and the
 * link that reported this bug carries `osmDensity: 2.9`
 * (`mapsUrlState.ts`'s token `Q`; the layer bitfield `L=8` mounts the OSM
 * card and nothing else). A `density !== 1` is exactly what glyphcss's
 * `isDetailMesh` separates on, so every layer that card mounts — the
 * buildings that CAST and the landuse/landcover that RECEIVE — left the base
 * grid together, and the shadow pass ran over a base grid holding neither a
 * caster nor a receiver. Measured on the fixture below: 535 changed cells at
 * `density: 1`, exactly 0 at `2.9`.
 *
 * The fix is not a widget rule ("don't separate a caster") — a density is a
 * legitimate, orthogonal appearance choice and the page offers it on every
 * mesh layer. It is that glyphcss's shadow map is now built from EVERY
 * caster in the scene, base and detail alike, and handed to every pass, so a
 * detail layer casts and receives like any other.
 *
 * The three halves are separate tests on purpose: a regression in casting
 * out of a detail layer must not be able to hide behind a regression in
 * receiving into one.
 *
 * Fixture traps, same as `widget.shadow.test.ts`: happy-dom has no layout
 * (hence `stubMonospaceMetrics`), and a detail layer paints into its OWN
 * `<pre>` at its own resolution — so a changed-cell count here is taken over
 * every `.glyph-output`, never over `scene.output` alone, and the one
 * geometric claim that spans grids is stated as a DISJOINTNESS between two
 * opposite lights rather than as a row arithmetic that would need each
 * grid's own affine.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { createGlyphMap } from "./widget";
import { glyphMapGlobe } from "./projection";
import type { GlyphMapProjection } from "./projection";
import type { GlyphMapVectorFeature } from "./vector/types";
import { glyphMapOpenMapTilesLayers } from "./vector/openmaptiles";

const COLS = 140;
const ROWS = 63;
const CELL_W = 8;
const CELL_H = 16;
const BASE_FONT_PX = 16;
const CENTRE: readonly [number, number] = [8.54, 47.375];
const SPAN = 0.006;
const HALF = 0.0008;
const GROUND_HALF = 0.02;
const BUILDING_M = 200;
/** The density the reported link actually carries (`mapsUrlState.ts` token `Q`). */
const OSM_DENSITY = 2.9;

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

// ── Vectors (identical to `widget.shadow.test.ts`'s, deliberately) ─────────

type V3 = [number, number, number];
const sub = (a: readonly number[], b: readonly number[]): V3 => [a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!];
const dot = (a: readonly number[], b: readonly number[]): number => a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]!;
const norm = (a: readonly number[]): V3 => {
  const l = Math.hypot(a[0]!, a[1]!, a[2]!);
  return [a[0]! / l, a[1]! / l, a[2]! / l];
};

/** A unit light SOURCE vector `zenithDeg` off local up, leaning toward local north (`sign = 1`) or south. */
function lightFromNorth(proj: GlyphMapProjection, zenithDeg: number, sign = 1): V3 {
  const p0 = proj.project(CENTRE[0], CENTRE[1], 0) as unknown as V3;
  const up = norm(p0);
  const raw = sub(proj.project(CENTRE[0], CENTRE[1] + 1e-4, 0) as unknown as V3, p0);
  const north = norm(sub(raw, [up[0] * dot(raw, up), up[1] * dot(raw, up), up[2] * dot(raw, up)]));
  const a = (zenithDeg * Math.PI) / 180;
  return norm([
    up[0] * Math.cos(a) + sign * north[0] * Math.sin(a),
    up[1] * Math.cos(a) + sign * north[1] * Math.sin(a),
    up[2] * Math.cos(a) + sign * north[2] * Math.sin(a),
  ]);
}

function squareRing(lon: number, lat: number, half: number): [number, number][] {
  return [[lon - half, lat - half], [lon + half, lat - half], [lon + half, lat + half], [lon - half, lat + half], [lon - half, lat - half]];
}

/**
 * The two OSM features this whole file rests on, shaped as the OpenMapTiles
 * schema really delivers them — a `landuse` polygon (which maps to `fill`, a
 * RECEIVER) and a `building` polygon carrying `render_height` (which maps to
 * `fill-extrusion`, a CASTER). Read through the real
 * `glyphMapOpenMapTilesLayers` table, never hand-assembled as widget layers.
 */
const landuseGround: GlyphMapVectorFeature = {
  id: "landuse",
  geometryType: "polygon",
  rings: [squareRing(CENTRE[0], CENTRE[1], GROUND_HALF)],
  properties: { class: "residential" },
};
const buildingTower: GlyphMapVectorFeature = {
  id: "building",
  geometryType: "polygon",
  rings: [squareRing(CENTRE[0], CENTRE[1], HALF)],
  properties: { render_height: BUILDING_M },
};

const settle = () => new Promise((resolve) => setTimeout(resolve, 60));

/** Every output grid this map paints — the base `<pre>` plus one per detail layer, in DOM order. */
function grids(host: HTMLElement): string[][] {
  return Array.from(host.querySelectorAll("pre.glyph-output")).map((pre) => (pre.textContent ?? "").split("\n"));
}

/**
 * Cells whose glyph differs between two renders, counted across EVERY output
 * grid. Detail layers paint at their own resolution into their own `<pre>`,
 * so a count taken over `scene.output` alone would report zero for a shadow
 * that is plainly there.
 */
function changedAcrossGrids(before: readonly string[][], after: readonly string[][]): { grid: number; row: number; col: number }[] {
  const out: { grid: number; row: number; col: number }[] = [];
  for (let g = 0; g < Math.max(before.length, after.length); g++) {
    const b = before[g] ?? [];
    const a = after[g] ?? [];
    for (let row = 0; row < Math.max(b.length, a.length); row++) {
      const br = b[row] ?? "";
      const ar = a[row] ?? "";
      for (let col = 0; col < Math.max(br.length, ar.length); col++) {
        if ((br[col] ?? " ") !== (ar[col] ?? " ")) out.push({ grid: g, row, col });
      }
    }
  }
  return out;
}

/** The cells the SHADOW alone claims, across every output grid: the same map with it off and with it on. */
function shadowCellsAcrossGrids(map: ReturnType<typeof createGlyphMap>, host: HTMLElement, opacity = 0.6) {
  map.setShadow(null);
  const off = grids(host);
  map.setShadow({ opacity });
  const on = grids(host);
  return changedAcrossGrids(off, on);
}

/**
 * The OSM stack the reported link mounts, at the densities it carries.
 * `landuseDensity`/`buildingDensity` are separate so the casting half and
 * the receiving half can each be isolated.
 */
async function mountOsm(opts: { light: V3; landuseDensity?: number; buildingDensity?: number }) {
  const projection = glyphMapGlobe({ exaggeration: 1 });
  const host = document.createElement("div");
  document.body.appendChild(host);
  hostsToRemove.push(host);
  stubMonospaceMetrics(host);
  const map = createGlyphMap(host, {
    view: { center: [CENTRE[0], CENTRE[1]], span: SPAN, cols: COLS, rows: ROWS },
    projection,
    tilt: 0,
    scene: { directionalLight: { direction: opts.light, intensity: 1 }, ambientLight: { intensity: 0.15 } },
  });
  mounted.push(map);
  // ONE SOURCE PER ROW, not one collection holding both features. A
  // `GlyphMapFeatureFilter` replaces `sourceLayer` for a static collection
  // (AGENTS.md, "GlyphMapFeatureFilter"), and neither of these two rows
  // narrows by `class` — so a single collection would hand the ground quad
  // to the buildings row and the footprint to the landuse row, and the
  // caster/receiver split this whole file measures would stop being real.
  const built = (id: "omt-landuse" | "omt-buildings", feature: GlyphMapVectorFeature, density?: number) =>
    glyphMapOpenMapTilesLayers(
      { features: [feature] },
      { include: [id], ...(density === undefined ? {} : { densities: { [id]: density } }) },
    );
  const layers = [
    ...built("omt-landuse", landuseGround, opts.landuseDensity),
    ...built("omt-buildings", buildingTower, opts.buildingDensity),
  ];
  // The real schema table really did give us one receiver and one caster.
  expect(layers.map((l) => l.type)).toEqual(["fill", "fill-extrusion"]);
  for (const layer of layers) map.addLayer(layer);
  await settle();
  map.scene.rerender();
  return { map, host, projection };
}

/** The building's own screen rows in the BASE grid — so "south of it" can be said exactly. */
function footprintRows(map: ReturnType<typeof createGlyphMap>): { top: number; bottom: number } {
  const north = map.project([CENTRE[0], CENTRE[1] + HALF]);
  const south = map.project([CENTRE[0], CENTRE[1] - HALF]);
  return { top: Math.min(north.row, south.row), bottom: Math.max(north.row, south.row) };
}

describe("createGlyphMap — a per-layer density must not silently switch shadows off", () => {
  it("the reported configuration: the whole OSM stack at density 2.9 still casts", async () => {
    // `?m=p3x6-yrbivy6-klok9s4-9v9t21dE1v21jn2j26xh223b218D1L18O21fQ1t`
    // decodes to `layerMask 8` (the OSM card alone), `osmMask 51`
    // (landcover, landuse, roads, buildings) and `osmDensity 2.9` — so
    // BOTH the caster and its receiver are separated. Before the shared
    // caster set this printed exactly 0.
    const light = lightFromNorth(glyphMapGlobe(), 45);
    const { map, host } = await mountOsm({ light, landuseDensity: OSM_DENSITY, buildingDensity: OSM_DENSITY });
    // Both layers really did separate — otherwise this passes for the wrong reason.
    expect(host.querySelectorAll("pre.glyph-output").length).toBe(3);
    const cells = shadowCellsAcrossGrids(map, host);
    // 4,469 cells at the time of writing. The bound is deliberately far
    // below that and far above zero: this is the number that was 0.
    expect(cells.length).toBeGreaterThan(1000);
    // ALL of them in the RECEIVER's grid, none in the caster's own — a lone
    // convex tower has nothing of its own to shadow, so a count here would
    // be acne rather than a shadow (the clause `widget.shadow.test.ts` makes
    // for the base grid, restated for a detail grid).
    const byGrid = new Map<number, number>();
    for (const c of cells) byGrid.set(c.grid, (byGrid.get(c.grid) ?? 0) + 1);
    // Nothing in the base grid (this configuration mounts nothing there),
    // and every changed cell in ONE detail grid — the receiver's.
    expect(byGrid.get(0) ?? 0).toBe(0);
    expect(byGrid.size).toBe(1);
  });

  it("turning the light around turns the shadow around — at density 2.9, across grids", async () => {
    // The claim that survives two different output grids without needing
    // either one's affine: the cells a north light claims and the cells a
    // south light claims are DISJOINT. A shadow stuck inside its own caster
    // (the headlight failure) claims the same cells under both and fails here.
    const north = await mountOsm({ light: lightFromNorth(glyphMapGlobe(), 45, +1), landuseDensity: OSM_DENSITY, buildingDensity: OSM_DENSITY });
    const south = await mountOsm({ light: lightFromNorth(glyphMapGlobe(), 45, -1), landuseDensity: OSM_DENSITY, buildingDensity: OSM_DENSITY });
    const key = (c: { grid: number; row: number; col: number }) => `${c.grid}/${c.row}/${c.col}`;
    const fromNorth = new Set(shadowCellsAcrossGrids(north.map, north.host).map(key));
    const fromSouth = new Set(shadowCellsAcrossGrids(south.map, south.host).map(key));
    expect(fromNorth.size).toBeGreaterThan(100);
    expect(fromSouth.size).toBeGreaterThan(100);
    const shared = [...fromNorth].filter((k) => fromSouth.has(k));
    // A handful of cells on the caster's own silhouette can legitimately
    // change under both; the two shafts cannot.
    expect(shared.length).toBeLessThan(Math.min(fromNorth.size, fromSouth.size) / 4);
  });

  it("a SEPARATED caster still darkens the BASE grid it stands on, cell for cell", async () => {
    // The casting half alone: the building is a detail layer, the ground is
    // not. Every assertion here is in the base grid's own rows, so it is the
    // same cell-exact prediction `widget.shadow.test.ts` makes.
    const light = lightFromNorth(glyphMapGlobe(), 45);
    const { map, host } = await mountOsm({ light, buildingDensity: OSM_DENSITY });
    expect(host.querySelectorAll("pre.glyph-output").length).toBe(2);
    map.setShadow(null);
    const off = (map.scene.output.textContent ?? "").split("\n");
    map.setShadow({ opacity: 0.6 });
    const on = (map.scene.output.textContent ?? "").split("\n");
    const cells: { row: number; col: number }[] = [];
    for (let row = 0; row < ROWS; row++) {
      for (let col = 0; col < COLS; col++) if ((off[row]?.[col] ?? " ") !== (on[row]?.[col] ?? " ")) cells.push({ row, col });
    }
    expect(cells.length).toBeGreaterThan(100);
    const { top, bottom } = footprintRows(map);
    // The light comes from the NORTH: the shaft runs south of the building
    // and no cell north of it can be in shadow.
    expect(Math.max(...cells.map((c) => c.row))).toBeGreaterThan(bottom + 5);
    for (const cell of cells) expect(cell.row).toBeGreaterThan(top - 1);
  });

  it("a SEPARATED receiver still darkens under a base-grid caster", async () => {
    // The receiving half alone: the ground is the detail layer this time, so
    // the only non-base `<pre>` in the host is the ground's own output and
    // every cell that changed in it is a shadow something else cast — the
    // caster has no geometry in that grid at all.
    const light = lightFromNorth(glyphMapGlobe(), 45);
    const { map, host } = await mountOsm({ light, landuseDensity: OSM_DENSITY });
    const outputs = Array.from(host.querySelectorAll("pre.glyph-output"));
    expect(outputs.length).toBe(2);
    const groundPre = outputs.find((pre) => pre !== map.scene.output)!;
    const read = () => (groundPre.textContent ?? "").split("\n");
    map.setShadow(null);
    const off = read();
    map.setShadow({ opacity: 0.6 });
    const on = read();
    let changed = 0;
    for (let row = 0; row < Math.max(off.length, on.length); row++) {
      const b = off[row] ?? "", a = on[row] ?? "";
      for (let col = 0; col < Math.max(b.length, a.length); col++) if ((b[col] ?? " ") !== (a[col] ?? " ")) changed++;
    }
    expect(changed).toBeGreaterThan(100);
  });
});

describe("createGlyphMap — shadows OFF stays byte-identical with detail layers mounted", () => {
  it("every output grid is restored exactly when the toggle goes back off", async () => {
    const light = lightFromNorth(glyphMapGlobe(), 45);
    const { map, host } = await mountOsm({ light, landuseDensity: OSM_DENSITY, buildingDensity: OSM_DENSITY });
    const outputs = Array.from(host.querySelectorAll("pre.glyph-output")) as HTMLElement[];
    const text = outputs.map((pre) => pre.textContent);
    const html = outputs.map((pre) => pre.innerHTML);
    map.setShadow({ opacity: 0.6 });
    expect(outputs.map((pre) => pre.textContent)).not.toEqual(text);
    map.setShadow(null);
    expect(outputs.map((pre) => pre.textContent)).toEqual(text);
    expect(outputs.map((pre) => pre.innerHTML)).toEqual(html);
  });
});
