// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { act, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import ts from "typescript";
import { MAP_PALETTES } from "../../features/maps/model/config";
import type { GlyphMapDemoProps } from "./types";

let maps: typeof import("@glyphcss/maps");
let GlyphMapDemo: typeof import("./GlyphMapDemo")["GlyphMapDemo"];
beforeEach(async () => {
  vi.resetModules();
  maps = await import("@glyphcss/maps");
  ({ GlyphMapDemo } = await import("./GlyphMapDemo"));
});

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: ReturnType<typeof createRoot> | undefined;
afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  document.body.replaceChildren();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
function fixtureFetch() {
  return vi.fn(async (url: string) => {
    const bytes = readFileSync(`public${url}`);
    return { ok: true, json: async () => JSON.parse(bytes.toString()), arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) };
  });
}
async function mount(props: GlyphMapDemoProps = {}) {
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root!.render(<StrictMode><GlyphMapDemo {...props} /></StrictMode>));
  return host;
}

it("renders real bundled terrain through the widget, displays its credit, and destroys the surviving StrictMode map", async () => {
  const fetch = fixtureFetch();
  vi.stubGlobal("fetch", fetch);
  const create = vi.spyOn(maps, "createGlyphMap");
  const host = await mount();
  await vi.waitFor(() => expect(create).toHaveBeenCalledOnce(), { timeout: 10000 });
  const map = create.mock.results[0]!.value as import("@glyphcss/maps").GlyphMapHandle;
  expect(create.mock.calls[0]![1]).toMatchObject({
    view: { center: [0, 20], span: 140, cols: 100, rows: 48 },
    autoSize: true, controls: { drag: true, wheel: false },
    scene: { mode: "solid", useColors: true },
  });
  expect(create.mock.calls[0]![1].projection.id).toBe(maps.glyphMapGlobe().id);
  expect(create.mock.calls[0]![1].projection.exaggeration).toBe(24);
  await act(async () => { await map.idle(); });
  const pre = host.querySelector("pre.glyph-output")!;
  expect(pre.textContent!.replace(/\s/g, "").length).toBeGreaterThan(100);
  expect(pre.querySelector("span")).not.toBeNull();
  expect(fetch.mock.calls.some(([url]) => url.endsWith(".bin"))).toBe(true);
  for (const credit of map.getAttributions()) {
    expect(host.textContent).toContain(credit.name);
    expect(host.textContent).toContain(credit.license);
  }
  expect(map.getAttributions().length).toBeGreaterThan(0);
  expect(host.querySelector('[role="status"]')).toBeNull();
  const referenceHost = document.createElement("div");
  document.body.append(referenceHost);
  const reference = maps.createGlyphMap(referenceHost, {
    view: { center: [0, 20], span: 140, cols: 100, rows: 48 },
    projection: maps.glyphMapGlobe({ exaggeration: 24 }),
    autoSize: true, controls: { drag: true, wheel: false },
    layers: [{ type: "raster", source: create.mock.calls[0]![1].layers!.find(layer => layer.type === "raster")!.source, classifier: maps.GlyphMapClassifiers.etopo1V1, colors: MAP_PALETTES.terrain }],
    scene: { mode: "solid", useColors: true },
  });
  try {
    await reference.idle();
    expect(pre.innerHTML).toBe(reference.scene.output.innerHTML);
  } finally { reference.destroy(); }
  const destroy = vi.spyOn(map, "destroy");
  await act(async () => root!.render(null));
  expect(destroy).toHaveBeenCalledOnce();
  expect(pre.isConnected).toBe(false);
}, 20000);

it("does not mount after unmounting during the provider fetch", async () => {
  let resolve!: (value: unknown) => void;
  vi.stubGlobal("fetch", () => new Promise(done => { resolve = done; }));
  const create = vi.spyOn(maps, "createGlyphMap");
  await mount();
  await act(async () => root!.render(null));
  await act(async () => resolve({ ok: true, json: async () => JSON.parse(readFileSync("public/data/geo-tiles/manifest.json", "utf8")) }));
  expect(create).not.toHaveBeenCalled();
});

it("reports a failed terrain request without leaving an unhandled rejection", async () => {
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
  const host = await mount();
  await vi.waitFor(() => expect(host.querySelector('[role="status"]')?.textContent).toContain("could not be loaded"), { timeout: 5000 });
});

// Execute the literal JSX props from the real docs so tests cover the examples
// the reader sees, including their geographic windows and selected OSM layers.
const pages = ["projections", "layers", "camera", "terrain", "openstreetmap"];
const examples = pages.flatMap(page => {
  const source = readFileSync(`src/content/docs/maps/${page}.mdx`, "utf8");
  const tags = [...source.matchAll(/<GlyphMapDemo\b[^\n]*\/>/g)].map(([tag]) => tag);
  expect(tags.length, page).toBeGreaterThan(0);
  expect(source.indexOf(tags[0]!), page).toBeLessThan(source.indexOf("## "));
  return tags.map(tag => {
    expect(tag, page).toContain("client:visible");
    const js = ts.transpileModule(`const props = ${tag.replace("client:visible", "")}`, {
      compilerOptions: { jsx: ts.JsxEmit.React, jsxFactory: "capture", target: ts.ScriptTarget.ES2022 },
    }).outputText;
    const props = new Function("capture", "GlyphMapDemo", `${js}; return props;`)((_component: unknown, props: GlyphMapDemoProps) => props, null) as GlyphMapDemoProps;
    return { page, props };
  });
});

it.each(examples)("renders the actual $page example: $props.label", async ({ props }) => {
  const bundledFetch = fixtureFetch();
  const requested: string[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    requested.push(url);
    if (!url.startsWith("https://tiles.openfreemap.org/")) return bundledFetch(url);
    const match = /\/(\d+)\/(\d+)\/(\d+)\.pbf$/.exec(url)!;
    const [z, x, y] = match.slice(1).map(Number);
    const fixture = `../packages/maps/fixtures/openfreemap/z${z}-${x}-${y}.mvt`;
    // Unrecorded neighbours are legitimately empty tiles, not fabricated data.
    let bytes: Buffer;
    try { bytes = readFileSync(fixture); } catch { bytes = Buffer.alloc(0); }
    return { ok: true, arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) };
  }));
  const create = vi.spyOn(maps, "createGlyphMap");
  const host = await mount(props);
  await vi.waitFor(() => expect(create).toHaveBeenCalledOnce(), { timeout: 10000 });
  const map = create.mock.results[0]!.value as import("@glyphcss/maps").GlyphMapHandle;
  const projection = props.projections?.[0]!.projection ?? props.projection!;
  await act(async () => { await map.idle(); });
  expect(host.querySelector("pre.glyph-output")!.textContent!.replace(/\s/g, "").length, requested.join("\n")).toBeGreaterThan(100);
  expect(host.querySelector("figure")?.getAttribute("aria-label")).toBe(props.label);
  expect(host.querySelector('[role="status"]')).toBeNull();
  expect(map.getTilt()).toBeCloseTo(props.tilt ?? (projection.type === "globe" ? 0 : 40));
  expect(map.getBearing()).toBe(props.bearing ?? 0);
  const options = create.mock.calls[0]![1];
  expect(options.projection.id).toBe(({ globe: maps.glyphMapGlobe, equirectangular: maps.glyphMapEquirectangular, mercator: maps.glyphMapMercator, orthographic: maps.glyphMapOrthographic })[projection.type]().id);
  expect(options.scene).toMatchObject(props.scene ?? {});
  expect(options.controls).toMatchObject(props.controls ?? {});
  expect(options.projection.exaggeration).toBe(projection.options?.exaggeration ?? 1);
  for (const credit of map.getAttributions()) expect(host.textContent).toContain(credit.name);
  const contour = options.layers?.find(layer => layer.type === "contour");
  if (contour) {
    expect(contour.source).toBe(options.layers?.find(layer => layer.type === "raster")?.source);
    expect(map.getContourFieldRange(contour.id!)).not.toBeNull();
    const withContours = map.scene.output.innerHTML;
    await act(async () => { map.removeLayer(contour.id!); await map.idle(); });
    expect(map.scene.output.innerHTML).not.toBe(withContours);
  }
  if (props.layers?.some(layer => layer.type === "markers")) expect(host.textContent).toContain("Buenos Aires");
  if (props.layers?.some(layer => layer.type === "osm")) {
    expect(requested.some(url => /\/1[34]\//.test(url))).toBe(true);
    expect(requested.filter(url => url.includes("openfreemap")).length).toBe(new Set(requested.filter(url => url.includes("openfreemap"))).size);
    expect(map.getAttributions().some(credit => credit.name === "OpenStreetMap contributors")).toBe(true);
    expect(requested.every(url => !url.includes("geo-tiles"))).toBe(true);
    const buildings = options.layers!.find(layer => layer.type === "fill-extrusion")!;
    const withBuildings = map.scene.output.innerHTML;
    await act(async () => { map.removeLayer(buildings.id!); await map.idle(); });
    expect(map.scene.output.innerHTML).not.toBe(withBuildings);
  }
  if (props.sun) expect(map.getSun()).toMatchObject(props.sun);
  if (props.keyLight) expect(map.getKeyLight()).toBe(props.keyLight);
}, 30000);

it("shares terrain providers across simultaneous islands and retries a failed manifest", async () => {
  const fetch = fixtureFetch();
  fetch.mockRejectedValueOnce(new Error("offline"));
  vi.stubGlobal("fetch", fetch);
  const { loadTerrain } = await import("./loadProviders");
  await expect(loadTerrain()).rejects.toThrow("offline");
  const [one, two] = await Promise.all([loadTerrain(), loadTerrain()]);
  expect(one).toBe(two);
  expect(fetch.mock.calls.filter(([url]) => url.endsWith("manifest.json"))).toHaveLength(2);
  const [tileOne, tileTwo] = await Promise.all([one.loadTile(0, 0, 0), two.loadTile(0, 0, 0)]);
  expect(tileOne).toBe(tileTwo);
  expect(fetch.mock.calls.filter(([url]) => url.endsWith(".bin"))).toHaveLength(1);
});

it("replaces and destroys the old map when serialisable props change", async () => {
  vi.stubGlobal("fetch", fixtureFetch());
  const create = vi.spyOn(maps, "createGlyphMap");
  await mount();
  await vi.waitFor(() => expect(create).toHaveBeenCalledOnce(), { timeout: 10000 });
  const first = create.mock.results[0]!.value;
  await act(async () => { await first.idle(); });
  const destroy = vi.spyOn(first, "destroy");
  await act(async () => root!.render(<StrictMode><GlyphMapDemo projection={{ type: "orthographic", options: { lon0: 20, lat0: 10, exaggeration: 8 } }} controls={{ drag: false, wheel: false, tilt: false }} scene={{ mode: "wireframe", useColors: false }} /></StrictMode>));
  await vi.waitFor(() => expect(create).toHaveBeenCalledTimes(2), { timeout: 10000 });
  const second = create.mock.results[1]!.value;
  await act(async () => { await second.idle(); });
  expect(destroy).toHaveBeenCalledOnce();
  expect(second.scene.output.isConnected).toBe(true);
  expect(second.host.style.touchAction).not.toBe("none");
  expect(second.scene.output.innerHTML).not.toBe(first.scene.output.innerHTML);
  expect(create.mock.calls[1]![1].projection.project(20, 10, 0)).toEqual(maps.glyphMapOrthographic({ lon0: 20, lat0: 10, exaggeration: 8 }).project(20, 10, 0));
  expect(second.scene.getOptions()).toMatchObject({ mode: "wireframe", useColors: false });
});

it("reports OSM tile failures even when the provider settles with empty tiles", async () => {
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
  const create = vi.spyOn(maps, "createGlyphMap");
  const host = await mount({ view: { center: [8.54, 47.375], span: 0.012 }, layers: [{ type: "osm", include: ["omt-roads"] }] });
  await vi.waitFor(() => expect(create).toHaveBeenCalledOnce(), { timeout: 10000 });
  await act(async () => { await create.mock.results[0]!.value.idle(); });
  expect(host.querySelector('[role="status"]')?.textContent).toContain("OpenStreetMap tiles could not be loaded");
});

it("morphs one map between projections from its tabs instead of mounting a map per projection", async () => {
  vi.stubGlobal("fetch", fixtureFetch());
  const create = vi.spyOn(maps, "createGlyphMap");
  const host = await mount({
    projections: [
      { label: "Globe", projection: { type: "globe", options: { exaggeration: 24 } }, span: 140 },
      { label: "Mercator", projection: { type: "mercator", options: { exaggeration: 24 } }, span: 360 },
    ],
  });
  await vi.waitFor(() => expect(host.querySelectorAll('[role="tab"]')).toHaveLength(2), { timeout: 10000 });
  await vi.waitFor(() => expect(create).toHaveBeenCalled(), { timeout: 10000 });
  const map = create.mock.results.at(-1)!.value as import("@glyphcss/maps").GlyphMapHandle;
  expect(create.mock.calls.at(-1)![1].projection.id).toBe(maps.glyphMapGlobe().id);
  const tabs = [...host.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
  expect(tabs.map((tab) => tab.getAttribute("aria-selected"))).toEqual(["true", "false"]);
  const setProjection = vi.spyOn(map, "setProjection");
  const flyTo = vi.spyOn(map, "flyTo");
  await act(async () => tabs[1]!.click());
  expect(setProjection).toHaveBeenCalledOnce();
  expect(setProjection.mock.calls[0]![0].id).toBe(maps.glyphMapMercator().id);
  expect(setProjection.mock.calls[0]![1]!.durationMs).toBeGreaterThan(0);
  expect(flyTo.mock.calls[0]![0]).toEqual({ span: 360 });
  expect(tabs.map((tab) => tab.getAttribute("aria-selected"))).toEqual(["false", "true"]);
  const mounted = create.mock.calls.length;
  await act(async () => tabs[1]!.click());
  expect(setProjection).toHaveBeenCalledOnce();
  expect(create.mock.calls.length).toBe(mounted);
});
