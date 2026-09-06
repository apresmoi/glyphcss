// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// Same import-time canvas-measurement stub every LayersPanel test installs.
vi.mock("@glyphcss/effects", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@glyphcss/effects")>();
  return { ...actual, calibrateGlyphRamp: () => ({ ramp: " .:-=+*#%@", steps: [] }) };
});

import {
  LayersPanel,
  MAP_SCENE_GLYPH_PALETTE,
  MAP_SCENE_RENDER_MODE,
  type ExtraLayerInputs,
  type LayersFolderInputs,
  type OsmLayerInputs,
} from "./mapsKit";
import { MAP_OSM_SUBLAYERS } from "./mapsOsm";

/**
 * The OSM card is the one card on this page whose DATA DOES NOT COVER THE
 * VIEW. The vendored Protomaps extract is Zürich at zoom 12 — about 4 km —
 * and the page opens on the whole world, so a toggle that silently draws
 * nothing is the default outcome and is indistinguishable from a bug.
 *
 * The card therefore has to say three things, and this file asserts all
 * three: what the extract holds, what box it covers, and whether the CURRENT
 * view is on that box — with a flight to it one click away.
 */

let root: Root | null = null;
let container: HTMLElement | null = null;
const noop = () => {};

function extra(overrides: Partial<ExtraLayerInputs> = {}): ExtraLayerInputs {
  return { visible: true, onVisible: noop, color: "#ffffff", onColor: noop, sliders: [], ...overrides };
}

function osm(overrides: Partial<OsmLayerInputs> = {}): OsmLayerInputs {
  return {
    visible: true, onVisible: noop,
    summary: "Zürich · z12 · 8 layers · 3,908 features",
    extent: "8.52,47.36 → 8.56,47.39",
    error: null,
    inCoverage: true,
    onFlyTo: noop,
    sublayers: MAP_OSM_SUBLAYERS.map((s) => ({ ...s, on: s.id === "osm-roads" })),
    onSublayer: noop,
    density: 1, onDensity: noop,
    ...overrides,
  };
}

function inputs(osmOverrides: Partial<OsmLayerInputs> = {}): LayersFolderInputs {
  const glyphOnly = extra({ glyphPalette: MAP_SCENE_GLYPH_PALETTE, onGlyphPalette: noop });
  const withMode = extra({
    glyphPalette: MAP_SCENE_GLYPH_PALETTE, onGlyphPalette: noop,
    renderMode: MAP_SCENE_RENDER_MODE, onRenderMode: noop,
  });
  return {
    background: { color: "#05070c", onColor: noop },
    terrain: {
      visible: true, onVisible: noop, palette: "terrain", onPalette: noop,
      glyphPalette: MAP_SCENE_GLYPH_PALETTE, onGlyphPalette: noop,
      exaggeration: 24, onExaggeration: noop, sampler: null, density: 1, onDensity: noop,
    },
    borders: { visible: true, onVisible: noop, color: "#e8c988", onColor: noop, simplify: null, density: 1, onDensity: noop },
    contour: {
      visible: true, onVisible: noop, color: "#7fe8c9", onColor: noop,
      interval: 500, onInterval: noop, minElevation: null, onMinElevation: noop,
      maxElevation: null, onMaxElevation: noop, fieldRange: null, lineCount: null,
      labels: false, onLabels: noop, density: 1, onDensity: noop,
    },
    fill: glyphOnly, symbol: extra(), circle: extra(), heatmap: glyphOnly,
    fillExtrusion: withMode, model: withMode,
    osm: osm(osmOverrides),
  };
}

function render(osmOverrides: Partial<OsmLayerInputs> = {}): HTMLElement {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => { root!.render(<LayersPanel {...inputs(osmOverrides)} />); });
  return container;
}

function card(host: HTMLElement): HTMLElement {
  const found = Array.from(host.querySelectorAll(".maps-layer-card")).find(
    (c) => c.querySelector(".maps-layer-check span")?.textContent === "OpenStreetMap",
  );
  expect(found).toBeTruthy();
  return found as HTMLElement;
}

function infoRows(host: HTMLElement): Map<string, string> {
  return new Map(Array.from(card(host).querySelectorAll(".maps-layer-info-row")).map((row) => [
    row.querySelector("span")?.textContent ?? "",
    row.querySelector(".maps-layer-info-value")?.textContent ?? "",
  ]));
}

afterEach(() => {
  act(() => { root?.unmount(); });
  root = null;
  container?.remove();
  container = null;
});

describe("LayersPanel — the OpenStreetMap card", () => {
  it("states what the extract holds and the exact box it covers", () => {
    const rows = infoRows(render());
    expect(rows.get("data")).toBe("Zürich · z12 · 8 layers · 3,908 features");
    expect(rows.get("extent")).toBe("8.52,47.36 → 8.56,47.39");
  });

  it("says the view is ON the data when it is", () => {
    expect(infoRows(render()).get("coverage")).toBe("in view");
  });

  it("says the view is OFF the data when it is — the whole-world default", () => {
    expect(infoRows(render({ inCoverage: false })).get("coverage")).toBe("no data in view");
  });

  it("offers a flight to the extract, and calls it", () => {
    const onFlyTo = vi.fn();
    const host = render({ inCoverage: false, onFlyTo });
    const button = card(host).querySelector<HTMLButtonElement>("button.maps-layer-action");
    expect(button).toBeTruthy();
    act(() => { button!.click(); });
    expect(onFlyTo).toHaveBeenCalledTimes(1);
  });

  it("carries one toggle per mapped layer, reflecting which are on", () => {
    const host = render();
    const rows = Array.from(card(host).querySelectorAll(".maps-layer-bool-row"));
    const labels = rows.map((r) => r.querySelector("span")?.textContent);
    for (const spec of MAP_OSM_SUBLAYERS) expect(labels).toContain(spec.label);
    const roads = rows.find((r) => r.querySelector("span")?.textContent === "Roads");
    expect(roads!.querySelector<HTMLInputElement>("input")!.checked).toBe(true);
    const places = rows.find((r) => r.querySelector("span")?.textContent === "Places");
    expect(places!.querySelector<HTMLInputElement>("input")!.checked).toBe(false);
  });

  it("reports a load failure in place of the summary rather than an empty card", () => {
    const rows = infoRows(render({ summary: null, extent: null, error: "404 at /data/osm/zurich-z12.pmtiles" }));
    expect(rows.get("data")).toBe("404 at /data/osm/zurich-z12.pmtiles");
  });

  it("says it is still loading before the archive resolves", () => {
    expect(infoRows(render({ summary: null, extent: null })).get("data")).toBe("loading…");
  });
});
