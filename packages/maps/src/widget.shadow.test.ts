// @vitest-environment happy-dom
/**
 * CAST SHADOWS — buildings and models onto the ground they stand on.
 *
 * glyphcss has had a shadow map since before this package existed; what was
 * missing was every map-specific decision it needs, and each one of those is
 * a test here rather than a comment:
 *
 *  1. WHO casts and WHO receives. The sets are disjoint by design
 *     (`GLYPH_MAP_SHADOW_CASTERS` / `..._RECEIVERS`), which is what lets the
 *     depth bias be zero; terrain is deliberately not a caster.
 *  2. The BIAS. glyphcss's own default `lift` of `0.05` is 5% of the globe's
 *     radius — 318 km — and erases every shadow a map could draw. The widget
 *     owns it (`GLYPH_MAP_SHADOW_LIFT`), and the test below goes red if that
 *     ownership is dropped.
 *  3. The DIRECTION. Shadows must fall along the same vector the SHADING
 *     uses, which on this widget is whatever `getKeyLightDirection()` reports
 *     — the sun, the headlight, or the consumer's own slider.
 *  4. OFF is the default and is byte-identical, per-mesh flags included.
 *
 * Fixture traps this file walks around: happy-dom has no layout (hence
 * `stubMonospaceMetrics`), and `sin(180 - L) === sin(L)` puts a far-side
 * point in its near-side twin's COLUMN — so the light here is tilted toward
 * local NORTH and every geometric assertion is keyed on ROWS and on EXACT
 * cells derived independently through `map.project`, never on an ink count
 * over a band (which the terrain alone satisfies).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { createGlyphMap, GLYPH_MAP_SHADOW_CASTERS, GLYPH_MAP_SHADOW_LIFT, GLYPH_MAP_SHADOW_RECEIVERS } from "./widget";
import type { GlyphMapSunOptions } from "./widget";
import { glyphMapGlobe, glyphMapTrueScaleElevation } from "./projection";
import type { GlyphMapProjection } from "./projection";
import type { GlyphMapProvider } from "./provider";
import type { GlyphMapGeoTile } from "./tile";
import type { GlyphMapVectorFeature } from "./vector/types";
import { createGlyphScene } from "glyphcss";
import type { GlyphMeshTransform, Polygon } from "glyphcss";

const COLS = 140;
const ROWS = 63;
const CELL_W = 8;
const CELL_H = 16;
const BASE_FONT_PX = 16;
/** Zurich, at a span where a city block is legible (~4.8 m per column, ~9.5 m per row). */
const CENTRE: readonly [number, number] = [8.54, 47.375];
const SPAN = 0.006;
/** Half-width of the building footprint, degrees (~89 m). */
const HALF = 0.0008;
/** Half-width of the ground quad — larger than the frame, so the shadow always lands on a receiver. */
const GROUND_HALF = 0.02;
/** A tower, in TRUE metres: 200 m casts ~21 rows of shadow at a 45-degree sun here. */
const BUILDING_M = 200;
const GROUND_COLOR = "#4b5563";
const BUILDING_COLOR = "#94a3b8";

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

// ── Vectors ───────────────────────────────────────────────────────────────

type V3 = [number, number, number];
const sub = (a: readonly number[], b: readonly number[]): V3 => [a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!];
const dot = (a: readonly number[], b: readonly number[]): number => a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]!;
const norm = (a: readonly number[]): V3 => {
  const l = Math.hypot(a[0]!, a[1]!, a[2]!);
  return [a[0]! / l, a[1]! / l, a[2]! / l];
};

/**
 * A unit light SOURCE vector (glyphcss's convention: from the surface toward
 * the light) `zenithDeg` away from straight up at the view centre, leaning
 * toward local NORTH — so the shadow it throws runs due SOUTH, which under
 * this plan view is straight DOWN the rows.
 */
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

/**
 * Where the shadow of a point `heightM` above `(lon, lat)` actually lands, in
 * lon/lat — the intersection of the ray from that point AWAY from the light
 * with the datum sphere, solved in closed form.
 *
 * Derived here from the projection and the light alone, never from the
 * render: this is the independent answer the render is checked against.
 */
function shadowLanding(proj: GlyphMapProjection, lon: number, lat: number, heightM: number, light: V3): [number, number] {
  const p = proj.project(lon, lat, glyphMapTrueScaleElevation(heightM, proj)) as unknown as V3;
  const pd = dot(p, light);
  const t = pd - Math.sqrt(pd * pd - (dot(p, p) - 1));
  return proj.unproject([p[0] - t * light[0], p[1] - t * light[1], p[2] - t * light[2]]);
}

// ── The map under test ────────────────────────────────────────────────────

function squareRing(lon: number, lat: number, half: number): [number, number][] {
  return [[lon - half, lat - half], [lon + half, lat - half], [lon + half, lat + half], [lon - half, lat + half], [lon - half, lat - half]];
}

const ground: GlyphMapVectorFeature = { id: "ground", geometryType: "polygon", rings: [squareRing(CENTRE[0], CENTRE[1], GROUND_HALF)] };
const tower: GlyphMapVectorFeature = {
  id: "tower",
  geometryType: "polygon",
  rings: [squareRing(CENTRE[0], CENTRE[1], HALF)],
  properties: { render_height: BUILDING_M },
};

const settle = () => new Promise((resolve) => setTimeout(resolve, 60));
const rows = (map: { scene: { output: { textContent: string | null } } }): string[] => (map.scene.output.textContent ?? "").split("\n");

function changedCells(before: readonly string[], after: readonly string[]): { row: number; col: number }[] {
  const out: { row: number; col: number }[] = [];
  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) {
      if ((before[row]?.[col] ?? " ") !== (after[row]?.[col] ?? " ")) out.push({ row, col });
    }
  }
  return out;
}

/**
 * One map: a flat ground `fill` (a RECEIVER) with a tower `fill-extrusion`
 * (a CASTER) standing on it, lit by `light`, seen straight down.
 *
 * Plan view is deliberate. An orthographic camera looking down the view axis
 * puts the tower's own image exactly over its footprint, so every cell the
 * shadow claims is a cell the building itself does not — the two can never be
 * confused for one another.
 */
async function mountScene(light: V3, opts: { exaggeration?: number; heightM?: number; sun?: GlyphMapSunOptions } = {}) {
  const projection = glyphMapGlobe({ exaggeration: opts.exaggeration ?? 1 });
  const host = document.createElement("div");
  document.body.appendChild(host);
  hostsToRemove.push(host);
  stubMonospaceMetrics(host);
  const map = createGlyphMap(host, {
    view: { center: [CENTRE[0], CENTRE[1]], span: SPAN, cols: COLS, rows: ROWS },
    projection,
    tilt: 0,
    ...(opts.sun ? { sun: opts.sun } : {}),
    scene: {
      directionalLight: { direction: light, intensity: 1 },
      ambientLight: { intensity: 0.15 },
    },
  });
  mounted.push(map);
  map.addLayer({ type: "fill", id: "ground", source: { features: [ground] }, color: GROUND_COLOR });
  const height = opts.heightM ?? BUILDING_M;
  map.addLayer({
    type: "fill-extrusion", id: "tower", color: BUILDING_COLOR, heightProperty: "render_height",
    source: { features: [{ ...tower, properties: { render_height: height } }] },
  });
  await settle();
  map.scene.rerender();
  return { map, projection, height };
}

/**
 * Several towers on one flat ground `fill`, in plan view — the fixture the
 * building-on-building tests need. `towers` are `[dLon, dLat, heightM]`
 * offsets from {@link CENTRE}.
 */
async function mountTowers(light: V3, towers: [number, number, number][]) {
  const projection = glyphMapGlobe({ exaggeration: 1 });
  const host = document.createElement("div");
  document.body.appendChild(host);
  hostsToRemove.push(host);
  stubMonospaceMetrics(host);
  const map = createGlyphMap(host, {
    view: { center: [CENTRE[0], CENTRE[1]], span: SPAN, cols: COLS, rows: ROWS },
    projection,
    tilt: 0,
    scene: { directionalLight: { direction: light, intensity: 1 }, ambientLight: { intensity: 0.15 } },
  });
  mounted.push(map);
  map.addLayer({ type: "fill", id: "ground", source: { features: [ground] }, color: GROUND_COLOR });
  map.addLayer({
    type: "fill-extrusion", id: "towers", color: BUILDING_COLOR, heightProperty: "render_height",
    source: {
      features: towers.map(([dLon, dLat, h], i) => ({
        id: `t${i}`,
        geometryType: "polygon" as const,
        rings: [squareRing(CENTRE[0] + dLon, CENTRE[1] + dLat, HALF)],
        properties: { render_height: h },
      })),
    },
  });
  await settle();
  map.scene.rerender();
  return { map, projection };
}

/**
 * The screen cells a footprint centred `dLon`/`dLat` from {@link CENTRE}
 * occupies. In plan view a tower's own image IS its footprint, so this is
 * exactly "on that building" — and it is derived through `map.project`, never
 * read off the render.
 */
function footprintCells(map: ReturnType<typeof createGlyphMap>, dLon: number, dLat: number): { row: number; col: number }[] {
  const n = map.project([CENTRE[0] + dLon, CENTRE[1] + dLat + HALF]).row;
  const s = map.project([CENTRE[0] + dLon, CENTRE[1] + dLat - HALF]).row;
  const w = map.project([CENTRE[0] + dLon - HALF, CENTRE[1] + dLat]).col;
  const e = map.project([CENTRE[0] + dLon + HALF, CENTRE[1] + dLat]).col;
  const out: { row: number; col: number }[] = [];
  for (let row = Math.ceil(Math.min(n, s)); row <= Math.floor(Math.max(n, s)); row++) {
    for (let col = Math.ceil(Math.min(w, e)); col <= Math.floor(Math.max(w, e)); col++) out.push({ row, col });
  }
  return out;
}

/** The cells the SHADOW alone claims: the same map rendered with it off and with it on. */
function shadowCells(map: ReturnType<typeof createGlyphMap>, opacity = 0.6): { row: number; col: number }[] {
  map.setShadow(null);
  const off = rows(map);
  map.setShadow({ opacity });
  const on = rows(map);
  return changedCells(off, on);
}

/** The footprint's own screen rows, so an assertion can say "south of the building" exactly. */
function footprintRows(map: ReturnType<typeof createGlyphMap>): { top: number; bottom: number } {
  const north = map.project([CENTRE[0], CENTRE[1] + HALF]);
  const south = map.project([CENTRE[0], CENTRE[1] - HALF]);
  return { top: Math.min(north.row, south.row), bottom: Math.max(north.row, south.row) };
}

describe("createGlyphMap — shadows are OFF unless asked for, and byte-identical there", () => {
  it("declares no scene shadow, and reports none", async () => {
    const { map } = await mountScene(lightFromNorth(glyphMapGlobe(), 45));
    expect(map.getShadow()).toBeNull();
    expect(map.scene.getOptions().shadow).toBeUndefined();
  });

  it("turning shadows on and back off restores the render EXACTLY — glyphs and colour spans", async () => {
    const { map } = await mountScene(lightFromNorth(glyphMapGlobe(), 45));
    const text = map.scene.output.textContent;
    const html = (map.scene.output as HTMLElement).innerHTML;
    map.setShadow({ opacity: 0.6 });
    expect(map.scene.output.textContent).not.toBe(text);
    map.setShadow(null);
    expect(map.scene.output.textContent).toBe(text);
    expect((map.scene.output as HTMLElement).innerHTML).toBe(html);
  });

  it("the per-mesh cast/receive flags are INERT with no scene shadow — the reason the toggle needs no remount", () => {
    // The widget sets `castShadow`/`receiveShadow` on every mounted mesh
    // whether or not shadows are on. That is only safe because glyphcss reads
    // them exclusively inside a pass that has `scene.shadow` set, and because
    // `isDetailMesh` does not consider them (a flagged mesh must not pop into
    // its own `<pre>`). Both halves are checked against the real renderer.
    const quad: Polygon[] = [{ vertices: [[-1, -1, 0], [1, -1, 0], [1, 1, 0], [-1, 1, 0]], color: "#8899aa" }];
    const box: Polygon[] = [{ vertices: [[-0.3, -0.3, 0.5], [0.3, -0.3, 0.5], [0.3, 0.3, 0.5], [-0.3, 0.3, 0.5]], color: "#ddeeff" }];
    const build = (flags: GlyphMeshTransform) => {
      const host = document.createElement("div");
      document.body.appendChild(host);
      hostsToRemove.push(host);
      const scene = createGlyphScene(host, { cols: 40, rows: 20, mode: "solid", useColors: true });
      scene.add(quad, { ...flags });
      // The CASTER now carries BOTH flags (a building receives its neighbour's
      // shadow), which is the configuration this whole slice changed. It has
      // to stay just as inert with no `scene.shadow` as the old cast-only one.
      scene.add(box, { ...flags });
      scene.rerender();
      const out = { text: scene.output.textContent, html: (scene.output as HTMLElement).innerHTML, pres: host.querySelectorAll("pre").length };
      scene.destroy();
      return out;
    };
    const plain = build({});
    const flagged = build({ castShadow: true, receiveShadow: true });
    expect(flagged.text).toBe(plain.text);
    expect(flagged.html).toBe(plain.html);
    expect(flagged.pres).toBe(plain.pres);
  });

  it("a map with CASTERS AND RECEIVERS mounted renders byte-identically with shadows off — the whole /maps layer stack", async () => {
    // The digest the widget's OFF claim rests on, over the real mount path
    // rather than two hand-built meshes: terrain (`raster`), a flat overlay
    // (`fill`) and a building (`fill-extrusion`, now flagged BOTH ways). Off
    // must be the render a map built before this feature existed, glyph for
    // glyph and span for span.
    const light = lightFromNorth(glyphMapGlobe(), 45);
    const { map } = await mountTowers(light, [[0, 0, BUILDING_M], [0, 0.0025, 60]]);
    expect(map.getShadow()).toBeNull();
    const text = map.scene.output.textContent;
    const html = (map.scene.output as HTMLElement).innerHTML;
    expect(text).not.toBeNull();
    expect(text!.length).toBeGreaterThan(COLS * ROWS - ROWS);
    // On, then off again: every buffer the shadow pass touches has to be
    // restored, not merely re-derived close enough.
    map.setShadow({ opacity: 0.6 });
    expect(map.scene.output.textContent).not.toBe(text);
    map.setShadow(null);
    expect(map.scene.output.textContent).toBe(text);
    expect((map.scene.output as HTMLElement).innerHTML).toBe(html);
  });
});

describe("createGlyphMap — a building casts onto the ground it stands on", () => {
  it("lands the shadow where the LIGHT puts it, cell for cell", async () => {
    const light = lightFromNorth(glyphMapGlobe(), 45);
    const { map, projection } = await mountScene(light);
    const cells = shadowCells(map);
    expect(cells.length).toBeGreaterThan(0);

    // Where the tower's SOUTH-edge midpoint throws its roof corner, worked
    // out from the projection and the light with no reference to the render.
    const [lon, lat] = shadowLanding(projection, CENTRE[0], CENTRE[1] - HALF, BUILDING_M, light);
    const tip = map.project([lon, lat]);
    const claimed = new Set(cells.map((c) => `${c.row}/${c.col}`));
    const { bottom } = footprintRows(map);
    // A 200 m tower at a 45-degree sun throws ~21 rows here, so the tip is
    // well clear of the footprint and this is a real prediction.
    expect(tip.row).toBeGreaterThan(bottom + 10);
    // EXACT cells, halfway down the shadow and just inside its tip — not a
    // count over a band, which the ground's own ink satisfies on its own.
    const midRow = Math.round((bottom + tip.row) / 2);
    expect(claimed.has(`${midRow}/${Math.round(tip.col)}`)).toBe(true);
    expect(claimed.has(`${Math.round(tip.row) - 2}/${Math.round(tip.col)}`)).toBe(true);
    // ...and nothing beyond the tip.
    for (const cell of cells) expect(cell.row).toBeLessThanOrEqual(Math.round(tip.row) + 1);
    // The light comes from the NORTH, so no cell north of the building can be
    // in its shadow. This is the clause a sign error goes red on.
    const { top } = footprintRows(map);
    for (const cell of cells) expect(cell.row).toBeGreaterThan(top - 1);
  });

  it("turning the light around turns the shadow around", async () => {
    const northLit = await mountScene(lightFromNorth(glyphMapGlobe(), 45, +1));
    const southLit = await mountScene(lightFromNorth(glyphMapGlobe(), 45, -1));
    const fromNorth = shadowCells(northLit.map);
    const fromSouth = shadowCells(southLit.map);
    const band = footprintRows(northLit.map);
    // Every cell of one is south of the building, every cell of the other is
    // north of it — disjoint half-planes, so no sign convention survives both.
    expect(Math.min(...fromNorth.map((c) => c.row))).toBeGreaterThan(band.top - 1);
    expect(Math.max(...fromNorth.map((c) => c.row))).toBeGreaterThan(band.bottom);
    expect(Math.max(...fromSouth.map((c) => c.row))).toBeLessThan(band.bottom + 1);
    expect(Math.min(...fromSouth.map((c) => c.row))).toBeLessThan(band.top);
  });

  it("a LOW sun stretches the shadow, exactly as far as the geometry says", async () => {
    // An 80 m block, not the 200 m tower: this frame is only ~600 m of
    // ground top to bottom, and a 200 m tower at a 65-degree sun throws its
    // shadow 429 m — clean off the grid, where the VIEWPORT would be what
    // the measurement below found rather than the geometry.
    const LOW_M = 80;
    const high = await mountScene(lightFromNorth(glyphMapGlobe(), 45), { heightM: LOW_M });
    const low = await mountScene(lightFromNorth(glyphMapGlobe(), 65), { heightM: LOW_M });
    const reach = (m: Awaited<ReturnType<typeof mountScene>>, zenith: number) => {
      const cells = shadowCells(m.map);
      const [lon, lat] = shadowLanding(m.projection, CENTRE[0], CENTRE[1] - HALF, LOW_M, lightFromNorth(m.projection, zenith));
      return { measured: Math.max(...cells.map((c) => c.row)), predicted: m.map.project([lon, lat]).row, count: cells.length };
    };
    const h = reach(high, 45);
    const l = reach(low, 65);
    // Each shadow ends where its own geometry says it ends, within a cell...
    expect(Math.abs(l.predicted - l.measured)).toBeLessThan(2);
    expect(Math.abs(h.predicted - h.measured)).toBeLessThan(2);
    // ...and tan(65)/tan(45) = 2.14, so the low sun reaches materially
    // further and covers materially more ground.
    expect(l.measured).toBeGreaterThan(h.measured + 7);
    expect(l.count).toBeGreaterThan(h.count * 1.6);
  });

  it("terrain RECEIVES — the real /maps path, not just a flat fill", async () => {
    const light = lightFromNorth(glyphMapGlobe({ exaggeration: 24 }), 45);
    const projection = glyphMapGlobe({ exaggeration: 24 });
    const host = document.createElement("div");
    document.body.appendChild(host);
    hostsToRemove.push(host);
    stubMonospaceMetrics(host);
    const map = createGlyphMap(host, {
      view: { center: [CENTRE[0], CENTRE[1]], span: SPAN, cols: COLS, rows: ROWS },
      projection,
      tilt: 0,
      scene: { directionalLight: { direction: light, intensity: 1 }, ambientLight: { intensity: 0.15 } },
    });
    mounted.push(map);
    map.addLayer({ type: "raster", id: "terrain", source: flatTerrain(400) });
    map.addLayer({ type: "fill-extrusion", id: "tower", source: { features: [tower] }, color: BUILDING_COLOR, heightProperty: "render_height" });
    await settle();
    map.scene.rerender();
    const cells = shadowCells(map);
    expect(cells.length).toBeGreaterThan(0);
    const { top, bottom } = footprintRows(map);
    expect(Math.max(...cells.map((c) => c.row))).toBeGreaterThan(bottom + 5);
    for (const cell of cells) expect(cell.row).toBeGreaterThan(top - 1);
  });
});

describe("createGlyphMap — shadows follow whoever owns the key light", () => {
  it("falls along `getKeyLightDirection()`, not along the direction the page set", async () => {
    // The SUN takes the light over on an orbit projection (AGENTS.md's
    // "Real-sun lighting"), so the vector that shades the terrain is no
    // longer the one this scene was constructed with. Shadows have to move
    // with it or they point somewhere nothing is lit from. June solstice,
    // 11:30 UTC — the sun is nearly due south of Zurich and 66 degrees up,
    // so its shadow runs NORTH and stays on the grid.
    const decoy = lightFromNorth(glyphMapGlobe(), 45);
    const { map, projection } = await mountScene(decoy, {
      sun: { mode: "manual", date: Date.UTC(2024, 5, 21, 11, 30) },
    });
    const owned = map.getKeyLightDirection();
    expect(owned).not.toBeNull();
    const light = [owned![0], owned![1], owned![2]] as V3;
    // The sun really did take the field over from the page's own vector.
    expect(Math.abs(dot(light, decoy))).toBeLessThan(0.99);

    const cells = shadowCells(map);
    expect(cells.length).toBeGreaterThan(0);
    const { top, bottom } = footprintRows(map);
    // NORTH of the building, which is the opposite half-plane from the decoy
    // light's own shadow — so a shadow still following the constructed
    // direction fails here.
    expect(Math.max(...cells.map((c) => c.row))).toBeLessThan(bottom + 1);
    expect(Math.min(...cells.map((c) => c.row))).toBeLessThan(top);
    // Cell-exact against the sun's own vector.
    const [lon, lat] = shadowLanding(projection, CENTRE[0], CENTRE[1] + HALF, BUILDING_M, light);
    const tip = map.project([lon, lat]);
    const claimed = new Set(cells.map((c) => `${c.row}/${c.col}`));
    expect(claimed.has(`${Math.round(tip.row) + 2}/${Math.round(tip.col)}`)).toBe(true);
    expect(claimed.has(`${Math.round((top + tip.row) / 2)}/${Math.round(tip.col)}`)).toBe(true);
  });
});

describe("createGlyphMap — the bias is the map's, not glyphcss's", () => {
  it("every CASTER also RECEIVES — the premise building-on-building shadows rest on", () => {
    // The two sets used to be disjoint, which made a building shadowing its
    // neighbour impossible by construction. They overlap now because the acne
    // that disjointness was avoiding is guarded inside glyphcss, in the shadow
    // map's OWN texels (`SHADOW_SLOPE_BIAS_TEXELS`) rather than by an absolute
    // world length no map scale can supply.
    for (const type of GLYPH_MAP_SHADOW_CASTERS) expect(GLYPH_MAP_SHADOW_RECEIVERS.has(type)).toBe(true);
    expect(GLYPH_MAP_SHADOW_RECEIVERS.has("fill-extrusion")).toBe(true);
    expect(GLYPH_MAP_SHADOW_RECEIVERS.has("model")).toBe(true);
    // Terrain is still a receiver and still never a caster: glyphcss fits the
    // shadow volume to ALL casters, and a raster layer keeps a global floor
    // tier mounted at every view, so terrain casting stretches 256 texels
    // across the Earth.
    expect(GLYPH_MAP_SHADOW_RECEIVERS.has("raster")).toBe(true);
    expect(GLYPH_MAP_SHADOW_CASTERS.has("raster")).toBe(false);
  });

  it("is zero, and glyphcss's own default would erase every shadow", async () => {
    expect(GLYPH_MAP_SHADOW_LIFT).toBe(0);
    const { map } = await mountScene(lightFromNorth(glyphMapGlobe(), 45));
    expect(shadowCells(map).length).toBeGreaterThan(0);
    // 0.05 world units is 5% of the globe's radius — 318 km. Handed through,
    // it takes the whole feature with it, which is why the widget owns the
    // field rather than letting glyphcss's room-scale default stand.
    map.setShadow(null);
    const off = rows(map);
    map.setShadow({ opacity: 0.6, lift: 0.05 });
    expect(changedCells(off, rows(map))).toHaveLength(0);
  });
});

describe("createGlyphMap — a building casts onto the building NEXT TO IT", () => {
  it("darkens the far tower's roof, cell for cell — the case that was impossible by construction", async () => {
    // 20 degrees of sun altitude, from the NORTH: a 200 m tower throws ~550 m
    // of shadow, and the 60 m tower 278 m south of it stands inside that.
    const light = lightFromNorth(glyphMapGlobe(), 70);
    const NEAR_LAT = 0.0025;
    const { map, projection } = await mountTowers(light, [[0, NEAR_LAT, BUILDING_M], [0, 0, 60]]);
    const cells = shadowCells(map);
    const claimed = new Set(cells.map((c) => `${c.row}/${c.col}`));

    // The far tower's own roof, worked out through `map.project` alone.
    const roof = footprintCells(map, 0, 0);
    expect(roof.length).toBeGreaterThan(100);
    // EVERY cell of it, counted exactly — not a fraction over a band, which
    // the ground around the tower satisfies on its own.
    const litRoof = roof.filter((c) => !claimed.has(`${c.row}/${c.col}`));
    expect(litRoof).toEqual([]);

    // ...and it really is the NEAR tower's shadow reaching it: the near
    // tower's south edge throws its roof corner past the far tower entirely,
    // predicted from the projection and the light with no reference to the
    // render.
    const [lon, lat] = shadowLanding(projection, CENTRE[0], CENTRE[1] + NEAR_LAT - HALF, BUILDING_M, light);
    expect(map.project([lon, lat]).row).toBeGreaterThan(Math.max(...roof.map((c) => c.row)));
  });

  it("does NOT shadow itself — the acne the slope-scaled guard exists to stop", async () => {
    // A lone convex box can legitimately shadow only its own faces turned
    // AWAY from the light, and those are lit by ambient alone, which the
    // shadow term never touches. So in plan view EVERY changed cell on the
    // tower's own roof is acne, at every sun angle — and there are none.
    // Remove `SHADOW_SLOPE_BIAS_TEXELS` and this prints 450 of 450 roof cells
    // claimed at every angle, because `tu = lu | 0` samples the texel
    // BELOW-LEFT of the reading point and so errs in one systematic
    // direction rather than speckling.
    for (const zenith of [30, 45, 60, 70, 80]) {
      const { map } = await mountTowers(lightFromNorth(glyphMapGlobe(), zenith), [[0, 0, BUILDING_M]]);
      const claimed = new Set(shadowCells(map).map((c) => `${c.row}/${c.col}`));
      const roof = footprintCells(map, 0, 0);
      const speckled = roof.filter((c) => claimed.has(`${c.row}/${c.col}`));
      expect({ zenith, speckled: speckled.length }).toEqual({ zenith, speckled: 0 });
    }
  });

  it("a flat `fill` under the building still darkens where the shadow lands", async () => {
    // The receiver half of the same fixture, kept separate so a regression in
    // ground-receiving cannot hide behind the building-on-building clause.
    const light = lightFromNorth(glyphMapGlobe(), 45);
    const { map, projection } = await mountTowers(light, [[0, 0, BUILDING_M]]);
    const claimed = new Set(shadowCells(map).map((c) => `${c.row}/${c.col}`));
    const [lon, lat] = shadowLanding(projection, CENTRE[0], CENTRE[1] - HALF, BUILDING_M, light);
    const tip = map.project([lon, lat]);
    const roofBottom = Math.max(...footprintCells(map, 0, 0).map((c) => c.row));
    expect(tip.row).toBeGreaterThan(roofBottom + 10);
    // Every row of ground between the footprint and the tip, on the shadow's
    // own centre column — the whole shaft, not a count.
    for (let row = roofBottom + 2; row <= Math.round(tip.row) - 2; row++) {
      expect({ row, shadowed: claimed.has(`${row}/${Math.round(tip.col)}`) }).toEqual({ row, shadowed: true });
    }
  });
});

describe("createGlyphMap — a HEADLIGHT key light hides every shadow behind its own caster", () => {
  it("is why the /maps page showed none: the shadow lands in the caster's own cells", async () => {
    // An orthographic camera's screen position is the component of a world
    // point PERPENDICULAR to its view axis, and `keyLight: "headlight"` aims
    // the key light down that same axis. A shadow is the caster displaced
    // along the light, so it is displaced along the view axis alone: same
    // column, same row, hidden behind the thing that cast it. No `lift` and
    // no receiver set can recover that — the page has to stop asking for a
    // headlight when it wants shadows (`mapKeyLightForSunMode`).
    const projection = glyphMapGlobe({ exaggeration: 1 });
    const light = lightFromNorth(projection, 45);
    const build = async (keyLight: "fixed" | "headlight") => {
      const host = document.createElement("div");
      document.body.appendChild(host);
      hostsToRemove.push(host);
      stubMonospaceMetrics(host);
      const map = createGlyphMap(host, {
        view: { center: [CENTRE[0], CENTRE[1]], span: SPAN, cols: COLS, rows: ROWS },
        projection, tilt: 0, keyLight,
        scene: { directionalLight: { direction: light, intensity: 1 }, ambientLight: { intensity: 0.15 } },
      });
      mounted.push(map);
      map.addLayer({ type: "fill", id: "ground", source: { features: [ground] }, color: GROUND_COLOR });
      map.addLayer({
        type: "fill-extrusion", id: "tower", color: BUILDING_COLOR, heightProperty: "render_height",
        source: { features: [tower] },
      });
      await settle();
      map.scene.rerender();
      return map;
    };
    const fixed = await build("fixed");
    const headlit = await build("headlight");
    const fixedCells = shadowCells(fixed);
    const headlitCells = shadowCells(headlit);
    // The fixed light draws a real shadow; the headlight leaves only a
    // sub-texel fringe at the silhouette, an order of magnitude smaller.
    expect(fixedCells.length).toBeGreaterThan(400);
    expect(headlitCells.length).toBeLessThan(fixedCells.length / 10);
    // And what little it leaves is AT the footprint, never a shaft running
    // away from it.
    const foot = footprintCells(headlit, 0, 0);
    const footRows = { top: Math.min(...foot.map((c) => c.row)), bottom: Math.max(...foot.map((c) => c.row)) };
    for (const cell of headlitCells) {
      expect(cell.row).toBeGreaterThanOrEqual(footRows.top - 2);
      expect(cell.row).toBeLessThanOrEqual(footRows.bottom + 2);
    }
  });
});

/** Uniform terrain at `elevM`, as a z0-z4 provider — the shape `bake-geo-tiles.mjs` produces. */
function flatTerrain(elevM: number): GlyphMapProvider {
  const zooms = [0, 1, 2, 3, 4].map((z) => ({
    z, cols: 2 ** z, rows: 2 ** z, tileLonSpan: 360 / 2 ** z, tileLatSpan: 180 / 2 ** z, tileCols: 32, tileRows: 32,
  }));
  const bounds = (z: number, x: number, y: number) => {
    const level = zooms[z]!;
    const west = -180 + x * level.tileLonSpan;
    const north = 90 - y * level.tileLatSpan;
    return { west, east: west + level.tileLonSpan, south: north - level.tileLatSpan, north };
  };
  return {
    id: "shadow-terrain",
    zooms,
    bounds,
    async loadTile(z, x, y): Promise<GlyphMapGeoTile> {
      return { bounds: bounds(z, x, y), cols: 32, rows: 32, elevation: new Float32Array(33 * 33).fill(elevM), source: "shadow-terrain", sampler: "nearest" };
    },
  };
}
