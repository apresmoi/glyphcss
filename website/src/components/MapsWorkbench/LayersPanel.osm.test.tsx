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
import { MAP_OSM_DEFAULT_ANCHOR, MAP_OSM_SUBLAYERS } from "./mapsOsm";

/**
 * The OSM card after the source became OpenFreeMap's planet.
 *
 * It used to be the one card whose DATA DID NOT COVER THE VIEW — a vendored
 * ~4 km Zürich extract on a page that opens on the globe — and it carried an
 * extent row, a live in/out-of-coverage row and a "fly there" button to
 * explain and remedy that. All four are gone with the extract: there is no
 * box to be outside of, so a coverage row could only ever lie.
 *
 * What is asserted here is what replaced them: one provenance row read off
 * the provider, a missing-tiles line that exists ONLY when tiles are actually
 * missing, and a toggle per OpenMapTiles layer.
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
    source: "OpenFreeMap · OpenMapTiles · z0–14",
    missing: null,
    sublayers: MAP_OSM_SUBLAYERS.map((s) => ({ ...s, on: s.id === "omt-roads", density: 1, anchor: MAP_OSM_DEFAULT_ANCHOR })),
    onSublayer: noop,
    onSublayerDensity: noop,
    onSublayerAnchor: noop,
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
      exaggeration: 24, onExaggeration: noop, sampler: null, 
        minElevation: null, onMinElevation: noop, maxElevation: null, onMaxElevation: noop,
        density: 1, onDensity: noop,
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
  it("states where the data comes from — service, schema and zoom ladder", () => {
    expect(infoRows(render()).get("source")).toBe("OpenFreeMap · OpenMapTiles · z0–14");
  });

  it("has no extent or coverage row at all — the source is the planet", () => {
    const rows = infoRows(render());
    expect(rows.has("extent")).toBe(false);
    expect(rows.has("coverage")).toBe(false);
    // And no button offering to fly somewhere the data supposedly is.
    expect(card(render()).querySelector("button.maps-layer-action")).toBeNull();
  });

  it("says nothing about tiles while every tile is arriving", () => {
    expect(infoRows(render()).has("tiles")).toBe(false);
  });

  it("says how many tiles are missing when some are", () => {
    const rows = infoRows(render({ missing: "3 tiles unavailable" }));
    expect(rows.get("tiles")).toBe("3 tiles unavailable");
    const value = card(render({ missing: "3 tiles unavailable" })).querySelector(".maps-layer-info-value.maps-layer-info-warn");
    expect(value?.textContent).toBe("3 tiles unavailable");
  });

  it("carries one toggle per mapped OpenMapTiles layer, reflecting which are on", () => {
    const host = render();
    const rows = Array.from(card(host).querySelectorAll(".maps-layer-bool-row"));
    const labels = rows.map((r) => r.querySelector("span")?.textContent);
    for (const spec of MAP_OSM_SUBLAYERS) expect(labels).toContain(spec.label);
    const roads = rows.find((r) => r.querySelector("span")?.textContent === "Roads");
    expect(roads!.querySelector<HTMLInputElement>("input")!.checked).toBe(true);
    const places = rows.find((r) => r.querySelector("span")?.textContent === "Places");
    expect(places!.querySelector<HTMLInputElement>("input")!.checked).toBe(false);
  });

  it("routes a sublayer toggle back to the page", () => {
    const onSublayer = vi.fn();
    const host = render({ onSublayer });
    const buildings = Array.from(card(host).querySelectorAll(".maps-layer-bool-row"))
      .find((r) => r.querySelector("span")?.textContent === "Buildings");
    act(() => { buildings!.querySelector<HTMLInputElement>("input")!.click(); });
    expect(onSublayer).toHaveBeenCalledWith("omt-buildings", true);
  });
});
