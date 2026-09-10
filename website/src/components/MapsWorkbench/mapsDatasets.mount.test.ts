// @vitest-environment happy-dom
/**
 * The Datasets card's five rows through the REAL widget and the REAL
 * rasterizer: the prepared file on disk → {@link decodeMapDataset} →
 * {@link mapDatasetLayers} → `createGlyphMap`.
 *
 * Three things are load-bearing and none can be checked by reading wiring:
 *
 *  1. **The row INKS.** A layer that mounts and paints nothing is the failure
 *     these datasets are most exposed to — a polygon reduced to a point, a
 *     line dropped by the antimeridian split, a fill whose rings never
 *     closed. So every case counts CELLS the row put on the grid at a view
 *     the row is supposed to cover, against the same map with the row off.
 *  2. **Attribution appears and withdraws with the row.** Three of the four
 *     licences require it and one of those (TeleGeography, CC BY-NC-SA 3.0)
 *     also forbids commercial use, so the credit is not a nicety. It must
 *     ride the mounted LAYER, so mounting adds it and removal takes it away.
 *  3. **The credit is the CODE's, not the file's.** A data file is
 *     regenerable; a licence obligation is not. The file's own `meta.license`
 *     is cross-checked against the row's constant so the two cannot drift,
 *     but it is the constant that reaches the map.
 *
 * The files are read from `website/public/data/` off disk rather than
 * fetched, so this runs offline and against exactly the bytes the site
 * serves.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { createGlyphMap, glyphMapEquirectangular, type GlyphMapHandle } from "@glyphcss/maps";

import {
  MAP_DATASET_ROWS,
  decodeMapDataset,
  loadMapDataset,
  mapDatasetLayers,
  type MapDataset,
  type MapDatasetWire,
} from "./mapsDatasets";

const PUBLIC = path.resolve(__dirname, "../../../public");
const COLS = 140;
const ROWS = 63;

const wireFor = (url: string) => JSON.parse(readFileSync(path.join(PUBLIC, url), "utf8")) as MapDatasetWire;

/**
 * Every row, through the page's OWN loader with the transport pointed at
 * `website/public/data/` instead of at the network.
 *
 * Through {@link loadMapDataset} rather than rebuilding a collection here,
 * and the difference is not cosmetic: the credit is attached BY that
 * function, so a version of this file that assembled its own
 * `{ features, attribution }` would keep every attribution assertion below
 * green while the real page mounted layers with no credit at all. Checked by
 * deleting that attachment: with the loader in the path, six cases go red.
 */
const DATASETS: Record<string, MapDataset> = {};

beforeAll(async () => {
  for (const row of MAP_DATASET_ROWS) {
    const fetchImpl = (async () => ({ ok: true, json: async () => wireFor(row.url) })) as unknown as typeof fetch;
    DATASETS[row.id] = await loadMapDataset(row, fetchImpl);
  }
});

const hosts: HTMLElement[] = [];
const maps: GlyphMapHandle[] = [];

function mount(center: [number, number], span: number): GlyphMapHandle {
  const host = document.createElement("div");
  document.body.appendChild(host);
  hosts.push(host);
  const map = createGlyphMap(host, {
    view: { center, span, cols: COLS, rows: ROWS },
    projection: glyphMapEquirectangular(),
    tilt: 0,
  });
  maps.push(map);
  return map;
}

/** Painted cells — whitespace stripped, so this counts glyphs the row actually put down. */
const inked = (map: GlyphMapHandle): number =>
  (map.scene.output.textContent ?? "").replace(/[\s\n]/g, "").length;

/**
 * A `symbol`/`circle` row is positioned DOM rather than grid cells, so it is
 * counted where it actually lands.
 *
 * Only the VISIBLE ones. The widget emits one hotspot element per feature
 * whatever the view is, and hides the ones the camera did not place on the
 * grid with `display: none` (`createGlyphScene.ts`'s hotspot commit, off
 * `projectHotspots`' own `col/row` bounds test). Counting elements would
 * therefore return the whole world's 4,351 data centres at a view of a
 * single county and prove nothing about where the row drew.
 */
const hotspots = (host: HTMLElement): number =>
  [...host.querySelectorAll<HTMLElement>(".glyph-hotspot")].filter((el) => el.style.display !== "none").length;

afterEach(() => {
  for (const map of maps.splice(0)) map.destroy();
  for (const host of hosts.splice(0)) host.remove();
});

/** Mount one row at one view and settle the widget the way `AGENTS.md` requires — on `idle()`, never a sleep. */
async function show(id: string, center: [number, number], span: number) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  hosts.push(host);
  const map = createGlyphMap(host, {
    view: { center, span, cols: COLS, rows: ROWS },
    projection: glyphMapEquirectangular(),
    tilt: 0,
  });
  maps.push(map);
  const before = inked(map);
  for (const layer of mapDatasetLayers(DATASETS, { enabled: [id] })) map.addLayer(layer);
  await map.idle();
  map.scene.rerender();
  return { map, host, before, after: inked(map) };
}

describe("every row puts something on the map", () => {
  /*
    Thresholds are set against MEASURED counts on a 140x63 grid, at roughly
    half the measurement, so a real regression (a dropped ring, a fill that
    became an outline, a stroke lost to the antimeridian) goes red while
    ordinary rasterizer noise does not. The measurements are quoted per case.
  */

  it("Land regions fills the terrain at a continental view", async () => {
    // Over the Sahara / Arabian peninsula, where Natural Earth's land regions
    // are large named areas rather than islands. Measured: 5,214 of 8,820.
    const { before, after } = await show("ds-regions", [20, 20], 90);
    expect(before).toBe(0);
    expect(after).toBeGreaterThan(3_000);
  });

  it("Marine areas fills over an ocean", async () => {
    // The North Atlantic: `ocean`, `sea`, `gulf` and `bay` features all in
    // frame, and no land region to confuse the count. Measured: 5,929.
    const { before, after } = await show("ds-marine", [-30, 40], 90);
    expect(before).toBe(0);
    expect(after).toBeGreaterThan(3_000);
  });

  it("Submarine cables stroke across an ocean", async () => {
    // Mid-Atlantic, where the transatlantic trunks converge. Measured: 3,284.
    // A stroke is thin, so this is far below a fill's count by construction.
    const { before, after } = await show("ds-cables", [-40, 35], 60);
    expect(before).toBe(0);
    expect(after).toBeGreaterThan(800);
  });

  it("Datacenters place markers over Northern Virginia", async () => {
    const { host, after } = await show("ds-datacenters", [-77.45, 39.03], 1.5);
    // A `circle` row is positioned DOM, not grid glyphs — so the grid stays
    // empty and the markers are what has to be there. Measured: 316 visible.
    expect(after).toBe(0);
    expect(hotspots(host)).toBeGreaterThan(150);
    // ...and they are THIS view's, not the world's: the row holds 4,351
    // features and the widget emits an element for every one of them.
    expect(hotspots(host)).toBeLessThan(1_000);
  });

  it("Dams label themselves over the Alps", async () => {
    const { host } = await show("ds-dams", [9.5, 46.5], 6);
    // Measured: 15 visible of 704.
    expect(hotspots(host)).toBeGreaterThan(5);
    expect(hotspots(host)).toBeLessThan(200);
    const labels = [...host.querySelectorAll<HTMLElement>(".glyph-hotspot")]
      .filter((el) => el.style.display !== "none")
      .map((el) => el.textContent ?? "");
    // A `symbol` row prints its `textProperty`; an empty label would mean the
    // decode dropped the column, which no cell count could see.
    expect(labels.some((t) => t.trim().length > 0)).toBe(true);
  });
});

describe("attribution rides the mounted layer, never the page", () => {
  it.each(MAP_DATASET_ROWS.map((r) => [r.id, r.label, r.credit.map((c) => c.name)] as const))(
    "%s adds and withdraws its credit",
    async (id, _label, names) => {
      const map = mount([0, 0], 360);
      expect(map.getAttributions()).toEqual([]);

      const layers = mapDatasetLayers(DATASETS, { enabled: [id] });
      expect(layers).toHaveLength(1);
      for (const layer of layers) map.addLayer(layer);
      const credited = map.getAttributions().map((a) => a.name);
      for (const name of names) expect(credited).toContain(name);

      for (const layer of layers) map.removeLayer(layer.id);
      const after = map.getAttributions().map((a) => a.name);
      for (const name of names) expect(after).not.toContain(name);
    },
  );

  it("names TeleGeography with its non-commercial licence, not a bare credit", () => {
    const map = mount([0, 0], 360);
    for (const layer of mapDatasetLayers(DATASETS, { enabled: ["ds-cables"] })) map.addLayer(layer);
    const cables = map.getAttributions().find((a) => a.name === "TeleGeography");
    expect(cables?.license).toBe("CC BY-NC-SA 3.0");
    expect(cables?.url).toBe("https://www.submarinecablemap.com");
  });

  it("credits OpenStreetMap exactly once with both ODbL rows on", () => {
    const map = mount([0, 0], 360);
    for (const layer of mapDatasetLayers(DATASETS, { enabled: ["ds-datacenters", "ds-dams"] })) map.addLayer(layer);
    expect(map.getAttributions().filter((a) => a.name === "OpenStreetMap contributors")).toHaveLength(1);
  });
});

describe("the file's provenance and the code's obligation agree", () => {
  it.each(MAP_DATASET_ROWS.map((r) => [r.id, r] as const))("%s", (id, row) => {
    const licenses = new Set(row.credit.map((c) => c.license));
    // The file says what it is; the row says what we owe. A regenerated bake
    // that changed one without the other is exactly what this catches.
    expect(licenses.has(DATASETS[id].license.replace(/ 1\.0$/, ""))).toBe(true);
  });

  it("the cables file states the non-commercial licence in its own metadata", () => {
    expect(DATASETS["ds-cables"].license).toBe("CC BY-NC-SA 3.0");
  });
});

describe("the wire decoder", () => {
  it("decodes every feature of every file", () => {
    const counts = Object.fromEntries(
      MAP_DATASET_ROWS.map((r) => [r.id, DATASETS[r.id].collection.features.length]),
    );
    expect(counts).toEqual({
      "ds-regions": 1046,
      "ds-marine": 292,
      "ds-cables": 712,
      "ds-datacenters": 4351,
      "ds-dams": 704,
    });
    // The published Natural Earth "regions" set is both files together.
    expect(counts["ds-regions"] + counts["ds-marine"]).toBe(1338);
  });

  it("skips an unsound feature rather than throwing the layer away", () => {
    const features = decodeMapDataset({
      geometry: "point",
      columns: ["name"],
      features: [
        [["good"], [1, 2]],
        [["bad"], "not a coordinate"],
        [["also good"], [3, 4]],
      ] as unknown as MapDatasetWire["features"],
    });
    expect(features.map((f) => f.properties?.name)).toEqual(["good", "also good"]);
  });

  it("drops an empty property rather than writing an empty string", () => {
    const [feature] = decodeMapDataset({
      geometry: "point", columns: ["name", "operator"],
      features: [[["Kolo", ""], [1, 2]]] as unknown as MapDatasetWire["features"],
    });
    expect(feature.properties).toEqual({ name: "Kolo" });
  });
});

describe("loading", () => {
  it("attaches the row's own credit to what it fetched", async () => {
    const row = MAP_DATASET_ROWS.find((r) => r.id === "ds-cables")!;
    const fetchImpl = (async () => ({ ok: true, json: async () => wireFor(row.url) })) as unknown as typeof fetch;
    const loaded = await loadMapDataset(row, fetchImpl);
    expect(loaded.collection.attribution).toEqual(row.credit);
    expect(loaded.source).toContain("TeleGeography");
  });

  it("throws with the row named when the file is missing", async () => {
    const row = MAP_DATASET_ROWS[0];
    const fetchImpl = (async () => ({ ok: false, status: 404 })) as unknown as typeof fetch;
    await expect(loadMapDataset(row, fetchImpl)).rejects.toThrow(/Land regions/);
  });
});

describe("per-row density", () => {
  it("omits `density` at the default and passes a real one through", () => {
    const [flat] = mapDatasetLayers(DATASETS, { enabled: ["ds-cables"] });
    expect("density" in flat).toBe(false);
    const [sharp] = mapDatasetLayers(DATASETS, { enabled: ["ds-cables"], densities: { "ds-cables": 2 } });
    expect((sharp as { density?: number }).density).toBe(2);
  });

  it("gives a symbol row its anchor and never a density", () => {
    const [dams] = mapDatasetLayers(DATASETS, {
      enabled: ["ds-dams"], densities: { "ds-dams": 3 }, anchors: { "ds-dams": "left" },
    });
    expect((dams as { textAnchor?: string }).textAnchor).toBe("left");
    expect("density" in dams).toBe(false);
  });
});
