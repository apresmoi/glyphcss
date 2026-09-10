/**
 * The reported gap: "we somehow should show the walls when the surface that
 * paints them disappears, because when we are in 3D space we have to account
 * that the surface is going to disappear before the tip."
 *
 * That is the ship's-mast-before-the-hull effect, and it is real geometry: a
 * point at height `h` over a sphere of radius `r` stays clear of the limb for
 * `acos(r / (r + h))` of extra arc past the 90° silhouette. At this file's
 * 1,200 km fixture height on a `radius: 1` globe that is 32.7° of longitude —
 * an extrusion whose whole BASE ring is 10-25° past the limb still has its TOP
 * ring, and therefore most of its wall band, genuinely in view.
 *
 * Two separate things had to be true for that to render, and neither was:
 *
 * 1. `glyphMapVectorCullWalls` was handed only ONE elevation per wall — the
 *    base (`GlyphMapVectorWall.elev`, written as `elev: base`) — so a wall
 *    whose top cleared the horizon was never asked about its top at all.
 * 2. `glyphMapGlobe.visible` was `depthOf(world) >= depthOf([0, 0, 0])`, a
 *    CENTRE-PLANE test. The camera's depth functional is linear and
 *    homogeneous in world (X, Y, Z), so scaling a point radially scales its
 *    depth and never changes that verdict's SIGN: base and top of the same
 *    wall are radially colinear, so asking about the top would have returned
 *    the base's answer, byte for byte. Fixing (1) alone changes nothing —
 *    which is exactly what `the top elevation alone is not enough` below
 *    pins, so a later "simplification" back to a centre-plane test can't pass.
 *
 * The rule now: a point behind the centre plane is still visible when its
 * distance from the camera's view axis exceeds the sphere's own radius (exact
 * under the orthographic camera `createGlyphMap` builds — the silhouette is a
 * cylinder of radius `r` about the view axis, not a cone), and a wall survives
 * when ANY of its four (endpoint x base/top) corners is visible.
 *
 * The CAP needs nothing here and must not get it: a cap's outward normal is
 * radial, so it turns away from the camera at exactly the 90° silhouette, and
 * the rasterizer's own backface cull removes it there. In the horizon band the
 * viewer is genuinely looking at the roof's UNDERSIDE — which the mesh
 * deliberately does not carry ("There is deliberately no floor cap") — so
 * walls-without-a-roof is the correct picture in that band, and the reverse (a
 * roof with no walls) is unreachable because the wall rule is now strictly
 * more permissive than the cap's. `cap and wall visibility agree at the limb`
 * pins both halves of that.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { createGlyphOrthographicCamera, type Vec3 } from "glyphcss";
import { glyphMapVectorCullWalls, glyphMapVectorMesh } from "./layers";
import { glyphMapGlobe } from "./projection";
import { createGlyphMap, type GlyphMapHandle } from "./widget";
import type { GlyphMapVectorFeature } from "./vector/types";

/** 1,200 km on a `radius: 1` globe — `acos(1/1.188)` = 32.7° of horizon extension. */
const WALL_HEIGHT_M = 1_200_000;
const COLS = 120;
const ROWS = 48;

function ring(west: number, east: number, south: number, north: number, step = 5): [number, number][] {
  const out: [number, number][] = [];
  for (let lon = west; lon <= east; lon += step) out.push([lon, south]);
  for (let lat = south + step; lat <= north; lat += step) out.push([east, lat]);
  for (let lon = east - step; lon >= west; lon -= step) out.push([lon, north]);
  for (let lat = north - step; lat >= south; lat -= step) out.push([west, lat]);
  out.push([west, south]);
  return out;
}

function box(west: number, east: number): GlyphMapVectorFeature {
  return {
    geometryType: "polygon",
    properties: { height: WALL_HEIGHT_M },
    rings: [ring(west, east, -10, 10)],
    polygons: [[ring(west, east, -10, 10)]],
  };
}

/**
 * Wholly past the 90° limb (base invisible everywhere) but wholly inside the
 * 122.7° horizon reach of a 1,200 km top ring.
 */
const OVER_HORIZON = box(100, 115);
/** Far enough round that not even the top ring clears the limb. */
const FAR_SIDE = box(150, 170);
/** Squarely on the near hemisphere — the control that must not change. */
const NEAR_SIDE = box(-20, 20);

const projection = glyphMapGlobe({ radius: 1, exaggeration: 1 });

/**
 * The widget's own `nearSidePredicate`, rebuilt here against `glyphcss`'s
 * real camera rather than a stand-in: `rotX: 90, rotY: 0` is
 * `glyphMapGlobe.cameraForCenter(0, 0)`, i.e. the camera `createGlyphMap`
 * itself installs for a view centred on `[0, 0]` at `tilt: 0`.
 */
function nearSideAt(lonCenter: number): (lon: number, lat: number, elev: number) => boolean {
  const camera = createGlyphOrthographicCamera({ rotX: 90, rotY: lonCenter, zoom: 1 });
  const depthOf = (world: Vec3) => camera.project(world, COLS, ROWS, 1)[2];
  return (lon, lat, elev) => {
    const world = projection.project(lon, lat, elev);
    return world.every((v) => Number.isFinite(v)) && projection.visible!(world, depthOf);
  };
}

function survivingWalls(feature: GlyphMapVectorFeature, visible: (lon: number, lat: number, elev: number) => boolean, groundM = 0): number {
  const mesh = glyphMapVectorMesh([feature], projection, {
    height: (f) => Number(f.properties?.height ?? 0),
    groundElevation: () => groundM,
  });
  expect(mesh.walls.length).toBeGreaterThan(0);
  const kept = glyphMapVectorCullWalls(mesh, visible);
  // `polygons` is caps + walls; the cull only ever removes walls, so the
  // survivor count is what came back minus the (untouched) cap faces.
  return kept.length - (mesh.polygons.length - mesh.walls.length);
}

describe("fill-extrusion walls survive their base going over the horizon", () => {
  const visible = nearSideAt(0);

  it("keeps a wall whose base is past the limb but whose top still clears it", () => {
    // Every base corner really is past the limb — otherwise the base-only
    // rule would pass this for the wrong reason.
    for (const [lon, lat] of OVER_HORIZON.rings[0]) expect(visible(lon, lat, 0)).toBe(false);
    expect(survivingWalls(OVER_HORIZON, visible)).toBeGreaterThan(0);
  });

  it("the top elevation alone is not enough — the near-side test itself has to model the horizon", () => {
    // Pins the second half of the fix. A centre-plane `visible` is radially
    // scale-invariant, so raising a point along its own radius can never flip
    // it; this asserts the shipped predicate is NOT that.
    const [lon, lat] = OVER_HORIZON.rings[0][0];
    expect(visible(lon, lat, 0)).toBe(false);
    expect(visible(lon, lat, WALL_HEIGHT_M)).toBe(true);
  });

  it("still drops a wall whose top is also past the horizon", () => {
    expect(survivingWalls(FAR_SIDE, visible)).toBe(0);
  });

  it("reaches further round the globe when it is standing on a mountain, and no further than that", () => {
    // Planting an extrusion on the terrain moves BOTH of a wall's elevations,
    // so the horizon reach it buys is the same `acos(r / (r + h))` the height
    // buys — the ground's metres and the structure's metres are the same
    // metres once they are on the projection's axis. At `exaggeration: 1` on a
    // `radius: 1` globe, 1,200 km of ground under a 1,200 km wall extends the
    // reach from 122.7° to 133.4°, and this box sits inside that gap.
    const ON_A_MOUNTAIN = box(126, 132);
    expect(survivingWalls(ON_A_MOUNTAIN, visible)).toBe(0);
    expect(survivingWalls(ON_A_MOUNTAIN, visible, WALL_HEIGHT_M)).toBeGreaterThan(0);
    // And not one wall further: a genuinely far-side extrusion is still
    // dropped whole, mountain or no mountain — planting is not a licence to
    // draw past the limb.
    expect(survivingWalls(FAR_SIDE, visible, WALL_HEIGHT_M)).toBe(0);
  });

  it("leaves a near-side extrusion's walls exactly as they were", () => {
    const mesh = glyphMapVectorMesh([NEAR_SIDE], projection, { height: () => WALL_HEIGHT_M });
    expect(glyphMapVectorCullWalls(mesh, visible).length).toBe(mesh.polygons.length);
  });

  it("cap and wall visibility agree at the limb: the wall rule is strictly the more permissive of the two", () => {
    // A cap face is removed by the rasterizer exactly when its own outward
    // (radial) normal turns away from the camera — the 90° silhouette. So for
    // every longitude, "the cap survives" must imply "the walls survive",
    // never the reverse: a roof with no walls is unreachable, and the
    // walls-with-no-roof band is the one where the viewer is under the roof.
    const camera = createGlyphOrthographicCamera({ rotX: 90, rotY: 0, zoom: 1 });
    const capFrontFacing = (lon: number, lat: number): boolean => {
      const top = projection.project(lon, lat, WALL_HEIGHT_M);
      // The cap's outward normal is the local radial direction; under an
      // orthographic camera a face is front-facing exactly when that normal's
      // own depth component is positive.
      const depth = camera.project(top, COLS, ROWS, 1)[2];
      return depth > 0;
    };
    let capOnly = 0;
    let wallOnly = 0;
    for (let lon = 60; lon <= 175; lon += 1) {
      const cap = capFrontFacing(lon, 0);
      const wall = visible(lon, 0, 0) || visible(lon, 0, WALL_HEIGHT_M);
      if (cap && !wall) capOnly++;
      if (wall && !cap) wallOnly++;
    }
    expect(capOnly).toBe(0);
    // The band really exists — otherwise "cap ⇒ wall" would hold vacuously
    // by the two rules simply agreeing everywhere.
    expect(wallOnly).toBeGreaterThan(20);
  });
});

// ── The same thing end to end, through the real widget. ──────────────────

/**
 * happy-dom has no layout, so the scene's own hidden cell probe would measure
 * zero and fall back to a constant advance while `map.project` derived its
 * cell size from the host rect — two different grids, and the column
 * assertion below compares one against the other. This gives both the SAME
 * 8x16 cell, exactly as `widget.tileSeam.test.ts` does and for the same
 * reason.
 */
const CELL_W = 8, CELL_H = 16, PROBE_FONT_PX = 16;
const rect = (w: number, h: number) => ({ width: w, height: h, top: 0, left: 0, right: w, bottom: h, x: 0, y: 0, toJSON() {} }) as DOMRect;
const EMPTY_RECT = rect(0, 0);
const stubbedHosts = new Set<HTMLElement>();

function stubMonospaceMetrics(host: HTMLElement): void {
  stubbedHosts.add(host);
  if (vi.isMockFunction(Element.prototype.getBoundingClientRect)) return;
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
    const el = this as HTMLElement;
    if (stubbedHosts.has(el)) return rect(COLS * CELL_W, ROWS * CELL_H);
    if (el.tagName !== "PRE" || !/visibility:\s*hidden/.test(el.style.cssText)) return EMPTY_RECT;
    const fontPx = parseFloat(/font-size:\s*([\d.]+)px/.exec(el.style.cssText)?.[1] ?? String(PROBE_FONT_PX));
    const k = fontPx / PROBE_FONT_PX;
    const lines = (el.textContent ?? "").split("\n").length || 1;
    return rect(CELL_W * k, CELL_H * k * lines);
  });
}

const live: { host: HTMLElement; map: GlyphMapHandle }[] = [];

afterEach(() => {
  for (const { map, host } of live.splice(0)) { map.destroy(); host.remove(); }
  document.body.innerHTML = "";
  stubbedHosts.clear();
  vi.restoreAllMocks();
});

function mount(feature: GlyphMapVectorFeature): { host: HTMLElement; map: GlyphMapHandle } {
  const host = document.createElement("div");
  document.body.appendChild(host);
  stubMonospaceMetrics(host);
  const map = createGlyphMap(host, {
    view: { center: [0, 0], span: 150, cols: COLS, rows: ROWS },
    projection: glyphMapGlobe({ radius: 1, exaggeration: 1 }),
    tilt: 0,
  });
  map.addLayer({ type: "fill-extrusion", id: "box", color: "#ff0000", source: { features: [feature] }, heightProperty: "height" });
  const entry = { host, map };
  live.push(entry);
  return entry;
}

/** Every inked cell of every output grid, as `(col, row)` in that grid's own space. */
function inkedCells(host: HTMLElement): { col: number; row: number }[] {
  const out: { col: number; row: number }[] = [];
  for (const pre of Array.from(host.querySelectorAll("pre"))) {
    (pre.textContent ?? "").split("\n").forEach((line, row) => {
      [...line].forEach((ch, col) => { if (ch !== " ") out.push({ col, row }); });
    });
  }
  return out;
}

const settle = () => new Promise<void>((r) => setTimeout(r, 40));

describe("fill-extrusion over the horizon — end to end through createGlyphMap", () => {
  it("draws the wall band beyond the globe's own silhouette", async () => {
    const { host, map } = mount(OVER_HORIZON);
    await settle();
    map.scene.rerender();

    const ink = inkedCells(host);
    expect(ink.length).toBeGreaterThan(0);

    // Self-calibrating limb radius, in this grid's own columns: `[0, 0]` is
    // the sub-observer point (screen centre) and `[90, 0]` sits exactly ON
    // the silhouette. Ink beyond that column could only have come from a
    // point raised clear of the limb — nothing at the datum can reach it.
    // Asserted on COLUMNS specifically: a far-side longitude shares its
    // near-side twin's column (`sin(180 - L) === sin(L)`), so a column past
    // the limb is unreachable by that aliasing too.
    const centre = map.project([0, 0]);
    const limb = map.project([90, 0]);
    const limbCols = Math.abs(limb.col - centre.col);
    expect(limbCols).toBeGreaterThan(1);
    const beyond = ink.filter((c) => Math.abs(c.col - centre.col) > limbCols + 0.5);
    expect(beyond.length).toBeGreaterThan(0);
  }, 20000);

  it("draws nothing at all for an extrusion whose top is also past the horizon", async () => {
    const { host, map } = mount(FAR_SIDE);
    await settle();
    map.scene.rerender();
    expect(inkedCells(host).length).toBe(0);
  }, 20000);
});
