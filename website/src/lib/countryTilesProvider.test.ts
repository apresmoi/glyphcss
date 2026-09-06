// @vitest-environment happy-dom
/**
 * The COUNTRY LABEL POINT dataset, end to end: the real baked pyramid under
 * `website/public/data/country-tiles/` -> `createCountryTilesProvider` ->
 * a real `createGlyphMap` `symbol`/`circle` layer -> what the widget actually
 * mounts and paints.
 *
 * `fetch` is stubbed to read the checked-in bake off disk rather than a
 * hand-built in-memory collection, so a regression anywhere on the
 * bake/decode/provider path fails here rather than only on the site — the
 * same discipline `packages/maps/src/widget.points.test.ts` applies to the
 * places pyramid.
 *
 * Three fixture traps this file is written around:
 *   - happy-dom has no layout, so the cell probes need `stubMonospaceMetrics`
 *     and every position assertion goes through `map.project`, which reads
 *     the same camera the renderer does.
 *   - `sin(180 - L) === sin(L)`: on the globe a far-side point projects to
 *     its near-side twin's COLUMN. The near/far assertion here is keyed on
 *     ROWS (two countries at opposite LATITUDES), never on columns.
 *   - Natural Earth's `LABELRANK` runs the OPPOSITE way to the widget's
 *     priority convention (lower = more prominent vs. higher wins), which is
 *     precisely why the bake writes the inverted `label_priority` column and
 *     why the declutter assertion below is worth having.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createGlyphMap } from "@glyphcss/maps";
import { glyphMapEquirectangular, glyphMapGlobe } from "@glyphcss/maps";
import {
  COUNTRY_PRIORITY_PROPERTY,
  COUNTRY_TILE_LAYERS,
  createCountryTilesProvider,
} from "./countryTilesProvider";

const DATA = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../public/data/country-tiles");

const COLS = 120;
const ROWS = 48;
const CELL_W = 8;
const CELL_H = 16;
const BASE_FONT_PX = 13;

const EMPTY_RECT = { width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0, x: 0, y: 0, toJSON: () => ({}) } as DOMRect;

function rect(width: number, height: number): DOMRect {
  return { width, height, top: 0, left: 0, right: width, bottom: height, x: 0, y: 0, toJSON: () => ({}) } as DOMRect;
}

const stubbedHosts = new Set<HTMLElement>();

/** happy-dom has no layout — see `packages/maps/src/widget.glyphPalette.test.ts`'s own copy for what each branch answers and why. */
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

/** Serves the REAL checked-in bake off disk at the provider's own URLs. */
function stubDiskFetch(): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL) => {
      const url = String(input);
      const suffix = url.slice(url.indexOf("/data/country-tiles/") + "/data/country-tiles/".length);
      try {
        return new Response(await fs.readFile(path.join(DATA, suffix), "utf8"), { status: 200 });
      } catch {
        return new Response(null, { status: 404 });
      }
    }),
  );
}

afterEach(() => {
  document.body.innerHTML = "";
  stubbedHosts.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function mount(options: Partial<Parameters<typeof createGlyphMap>[1]> = {}) {
  stubDiskFetch();
  const provider = await createCountryTilesProvider();
  const host = document.createElement("div");
  document.body.appendChild(host);
  stubMonospaceMetrics(host);
  const map = createGlyphMap(host, {
    view: { center: [0, 0], span: 340, cols: COLS, rows: ROWS },
    projection: glyphMapEquirectangular(),
    tilt: 0,
    ...options,
  });
  return { host, map, provider, teardown: () => { map.destroy(); host.remove(); } };
}

function labels(host: HTMLElement): HTMLElement[] {
  return [...host.querySelectorAll<HTMLElement>(".glyph-map-symbol")];
}

/** `name -> label_priority`, read straight off every baked tile on disk. */
async function bakedPriorities(): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  for (const z of await fs.readdir(DATA)) {
    const dir = path.join(DATA, z);
    if (!(await fs.stat(dir)).isDirectory()) continue;
    for (const file of await fs.readdir(dir)) {
      const tile = JSON.parse(await fs.readFile(path.join(dir, file), "utf8"));
      for (const f of tile.layers?.countries ?? []) out.set(String(f.properties.name), Number(f.properties[COUNTRY_PRIORITY_PROPERTY]));
    }
  }
  return out;
}

function mean(values: readonly number[]): number {
  return values.reduce((a, b) => a + b, 0) / values.length;
}

describe("country label points — the baked pyramid", () => {
  it("bakes exactly one sourceLayer, and every level carries it", async () => {
    const manifest = JSON.parse(await fs.readFile(path.join(DATA, "manifest.json"), "utf8"));
    expect(Object.keys(manifest.layers)).toEqual([...COUNTRY_TILE_LAYERS]);
    expect(manifest.zooms.map((z: { z: number }) => z.z)).toEqual([0, 1, 2, 3, 4]);
    expect(manifest.attribution?.[0]?.name).toMatch(/Natural Earth/);
  });

  it("carries Natural Earth's own LABEL_X/LABEL_Y, inverted into the widget's HIGHER-wins priority", async () => {
    stubDiskFetch();
    const provider = await createCountryTilesProvider();
    const tile = await provider.loadTile(0, 0, 0);
    const features = tile.layers.countries ?? [];
    const byName = new Map(features.map((f) => [String(f.properties?.name), f]));

    // Natural Earth's own cartographer-placed LABEL_X/LABEL_Y verbatim — the
    // three classic countries whose centroid lands in the sea. Precision 1,
    // because `glyphMapBuildVectorTile` quantizes to a 4096 tile extent and
    // a z0 tile's lon step is 360/4096 = 0.088deg.
    const chile = byName.get("Chile")!;
    expect(chile.rings[0][0][0]).toBeCloseTo(-72.319, 1);
    expect(chile.rings[0][0][1]).toBeCloseTo(-38.152, 1);
    // Norway's label sits at 61.4N on the southern mainland, not at the
    // ~66N a centroid of its long northern tail would give.
    expect(byName.get("Norway")!.rings[0][0][1]).toBeCloseTo(61.357, 1);
    // Indonesia's label sits on Sumatra at 101.9E, not the ~118E open water
    // between its islands a centroid resolves to.
    expect(byName.get("Indonesia")!.rings[0][0][0]).toBeCloseTo(101.893, 1);

    // LABELRANK is inverted at bake time; raw LABELRANK would rank the
    // microstates above the giants.
    const priority = (name: string) => Number(byName.get(name)!.properties?.[COUNTRY_PRIORITY_PROPERTY]);
    expect(priority("Russia")).toBeGreaterThan(priority("Norway"));
    expect(priority("Brazil")).toBeGreaterThan(priority("Norway"));
  });
});

describe("symbol layer — country labels from the baked country pyramid", () => {
  it("mounts a label carrying the country's real name, visible, at its own row", async () => {
    const { host, map, provider, teardown } = await mount({
      view: { center: [-70, -35], span: 40, cols: COLS, rows: ROWS },
    });
    try {
      map.addLayer({
        type: "symbol", id: "symbol", source: provider, sourceLayer: "countries",
        textProperty: "name", priorityProperty: COUNTRY_PRIORITY_PROPERTY,
      });
      await vi.waitFor(() => expect(labels(host).length).toBeGreaterThan(0));
      const chile = labels(host).find((el) => el.textContent === "Chile");
      expect(chile).toBeDefined();
      expect(chile!.style.opacity).toBe("1");

      const at = map.project([-72.319, -38.152]);
      expect(at.visible).toBe(true);
      expect(at.row).toBeGreaterThan(0);
      expect(at.row).toBeLessThan(ROWS);
      // Chile's label point is SOUTH of the view centre, so it must land on a
      // LOWER row than the centre (rows increase southward).
      expect(at.row).toBeGreaterThan(map.project([-70, -35]).row);
    } finally { teardown(); }
  });

  it("at a world view the decluttered set favours the big countries over the microstates", async () => {
    const { host, map, provider, teardown } = await mount();
    try {
      map.addLayer({
        type: "symbol", id: "symbol", source: provider, sourceLayer: "countries",
        textProperty: "name", priorityProperty: COUNTRY_PRIORITY_PROPERTY,
      });
      await vi.waitFor(() => expect(labels(host).length).toBeGreaterThan(20));
      const priorities = await bakedPriorities();
      const all = labels(host).map((el) => String(el.textContent));
      const shown = new Set(labels(host).filter((el) => el.style.opacity === "1").map((el) => String(el.textContent)));
      const hidden = all.filter((n) => !shown.has(n));
      expect(shown.size).toBeGreaterThan(3);
      expect(hidden.length).toBeGreaterThan(3);

      // (a) The per-zoom LABELRANK thinning: at a world view the microstates
      //     are not even candidates, so they cannot win a cell from a giant.
      for (const tiny of ["Liechtenstein", "San Marino", "Monaco", "Andorra", "Vatican"]) expect(all).not.toContain(tiny);
      // (b) The priority column itself. The giants survive the declutter.
      for (const big of ["Russia", "China", "Brazil", "India", "Canada", "United States of America"]) expect(shown).toContain(big);
      // (c) The inversion guard: Natural Earth's LABELRANK runs LOWER = more
      //     prominent, so feeding it raw would rank the microstates above the
      //     giants and this comparison would flip.
      expect(mean([...shown].map((n) => priorities.get(n)!))).toBeGreaterThan(mean(hidden.map((n) => priorities.get(n)!)));
    } finally { teardown(); }
  });

  it("hides a far-side country label on the globe — keyed on ROWS, since a far-side point shares its twin's column", async () => {
    const { host, map, provider, teardown } = await mount({
      view: { center: [10, 50], span: 160, cols: COLS, rows: ROWS },
      projection: glyphMapGlobe({ radius: 1, exaggeration: 0 }),
    });
    try {
      map.addLayer({
        type: "symbol", id: "symbol", source: provider, sourceLayer: "countries",
        textProperty: "name", priorityProperty: COUNTRY_PRIORITY_PROPERTY,
      });
      await vi.waitFor(() => expect(labels(host).length).toBeGreaterThan(5));
      // Germany is centred; New Zealand is very nearly its antipode.
      const near = map.project([10.385, 51.109]);
      const far = map.project([172.9, -41.5]);
      expect(near.visible).toBe(true);
      expect(far.visible).toBe(false);
      expect(Math.round(near.row)).not.toBe(Math.round(far.row));
      await vi.waitFor(() => {
        const shown = labels(host).filter((el) => el.style.opacity === "1").map((el) => el.textContent);
        expect(shown).toContain("Germany");
        expect(shown).not.toContain("New Zealand");
      });
    } finally { teardown(); }
  });
});

describe("circle layer — countries sized by a real measured quantity", () => {
  it("sizes each dot from the baked pop_scale column, so a populous country reads bigger", async () => {
    const { host, map, provider, teardown } = await mount();
    try {
      map.addLayer({
        type: "circle", id: "circle", source: provider, sourceLayer: "countries",
        radiusProperty: "pop_scale", radiusScale: 9, radius: 2, color: "#f59e0b",
      });
      await vi.waitFor(() => expect(host.querySelectorAll(".glyph-map-circle").length).toBeGreaterThan(20));
      const widths = [...host.querySelectorAll<HTMLElement>(".glyph-map-circle")].map((el) => parseFloat(el.style.width));
      expect(widths.every((w) => Number.isFinite(w) && w > 0)).toBe(true);
      // A real magnitude, not one uniform dot per country.
      expect(new Set(widths).size).toBeGreaterThan(5);

      const tile = await provider.loadTile(0, 0, 0);
      const byName = new Map((tile.layers.countries ?? []).map((f) => [String(f.properties?.name), f]));
      const scale = (name: string) => Number(byName.get(name)!.properties?.pop_scale);
      expect(scale("China")).toBeGreaterThan(scale("Norway"));
      expect(scale("Norway")).toBeGreaterThan(scale("Iceland"));
    } finally { teardown(); }
  });

  it("hides a far-side country dot on the globe through the same projection.visible path the labels use", async () => {
    const { host, map, provider, teardown } = await mount({
      view: { center: [10, 50], span: 160, cols: COLS, rows: ROWS },
      projection: glyphMapGlobe({ radius: 1, exaggeration: 0 }),
    });
    try {
      map.addLayer({
        type: "circle", id: "circle", source: provider, sourceLayer: "countries",
        radiusProperty: "pop_scale", radiusScale: 9, radius: 2, color: "#f59e0b",
      });
      await vi.waitFor(() => expect(host.querySelectorAll(".glyph-map-circle").length).toBeGreaterThan(5));
      const dots = [...host.querySelectorAll<HTMLElement>(".glyph-map-circle")];
      // `setHotspotNearSide` writes `visibility: hidden` for a far-side dot;
      // on a globe half the world's countries sit behind the limb.
      await vi.waitFor(() => {
        const hidden = dots.filter((el) => el.style.visibility === "hidden");
        expect(hidden.length).toBeGreaterThan(0);
        expect(hidden.length).toBeLessThan(dots.length);
      });
    } finally { teardown(); }
  });

  /**
   * The discriminator for the test above: a SHEET projection exposes no
   * `visible` capability at all (every invisible point is already excluded by
   * `project()` returning NaN), so nothing is hemisphere-hidden there. If the
   * globe test's hidden dots came from anything other than
   * `projection.visible`, this would find them here too.
   */
  it("hides nothing on a sheet projection, which has no visible() capability", async () => {
    const { host, map, provider, teardown } = await mount();
    try {
      map.addLayer({
        type: "circle", id: "circle", source: provider, sourceLayer: "countries",
        radiusProperty: "pop_scale", radiusScale: 9, radius: 2, color: "#f59e0b",
      });
      await vi.waitFor(() => expect(host.querySelectorAll(".glyph-map-circle").length).toBeGreaterThan(20));
      const dots = [...host.querySelectorAll<HTMLElement>(".glyph-map-circle")];
      expect(dots.filter((el) => el.style.visibility === "hidden")).toHaveLength(0);
      void map;
    } finally { teardown(); }
  });
});

describe("attribution is derived from the mounted layer, never hardcoded", () => {
  it("credits Natural Earth admin-0 only while a country-dataset layer is mounted", async () => {
    const { map, provider, teardown } = await mount();
    try {
      expect(map.getAttributions()).toHaveLength(0);
      map.addLayer({
        type: "symbol", id: "symbol", source: provider, sourceLayer: "countries",
        textProperty: "name", priorityProperty: COUNTRY_PRIORITY_PROPERTY,
      });
      const names = map.getAttributions().map((a) => a.name);
      expect(names.some((n) => /admin 0 country label points/i.test(n))).toBe(true);
      map.removeLayer("symbol");
      expect(map.getAttributions()).toHaveLength(0);
    } finally { teardown(); }
  });
});
