// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// Same import-time canvas-measurement stub every LayersPanel test installs —
// happy-dom has no layout engine, so the ramp calibration has nothing to
// measure against.
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
import { MAP_OSM_DEFAULT_ANCHOR, MAP_OSM_SUBLAYERS, mapOsmSublayerTooltip } from "./mapsOsm";

/**
 * The OSM card's row tooltips, on the RENDERED card.
 *
 * `mapsOsm.tooltips.test.ts` owns whether the text is true; this owns whether
 * a reader can reach it. The two are separate because the text was true and
 * unreachable at one point in this file's history — the row's `<label>`
 * already carried a `title` about density cost, and a browser shows the
 * innermost one, so a tooltip added to the wrong element is invisible while
 * every string assertion still passes.
 */

let root: Root | null = null;
let container: HTMLElement | null = null;
const noop = () => {};

function extra(overrides: Partial<ExtraLayerInputs> = {}): ExtraLayerInputs {
  return { visible: true, onVisible: noop, color: "#ffffff", onColor: noop, sliders: [], ...overrides };
}

function inputs(): LayersFolderInputs {
  const glyphOnly = extra({ glyphPalette: MAP_SCENE_GLYPH_PALETTE, onGlyphPalette: noop });
  const withMode = extra({
    glyphPalette: MAP_SCENE_GLYPH_PALETTE, onGlyphPalette: noop,
    renderMode: MAP_SCENE_RENDER_MODE, onRenderMode: noop,
  });
  const osm: OsmLayerInputs = {
    visible: true, onVisible: noop,
    source: "OpenFreeMap · OpenMapTiles · z0–14",
    missing: null,
    sublayers: MAP_OSM_SUBLAYERS.map((s) => ({ ...s, on: true, density: 1, anchor: MAP_OSM_DEFAULT_ANCHOR })),
    onSublayer: noop, onSublayerDensity: noop, onSublayerAnchor: noop,
  };
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
    osm,
  };
}

function render(): HTMLElement {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => { root!.render(<LayersPanel {...inputs()} />); });
  return container;
}

function osmCard(host: HTMLElement): HTMLElement {
  const found = Array.from(host.querySelectorAll(".maps-layer-card")).find(
    (c) => c.querySelector(".maps-layer-check span")?.textContent === "OpenStreetMap",
  );
  expect(found).toBeTruthy();
  return found as HTMLElement;
}

/** Row label → the `title` on the element carrying that label. */
function rowTooltips(host: HTMLElement): Map<string, string | null> {
  const out = new Map<string, string | null>();
  for (const row of Array.from(osmCard(host).querySelectorAll(".maps-osm-row"))) {
    const name = row.querySelector("span");
    if (!name) continue;
    out.set(name.textContent ?? "", name.getAttribute("title"));
  }
  return out;
}

afterEach(() => {
  act(() => { root?.unmount(); });
  root = null;
  container?.remove();
  container = null;
});

describe("LayersPanel — OpenStreetMap row tooltips", () => {
  it("puts a tooltip on every row's own name, matching what mapsOsm composed", () => {
    const tips = rowTooltips(render());
    expect(tips.size).toBe(MAP_OSM_SUBLAYERS.length);
    for (const row of MAP_OSM_SUBLAYERS) {
      expect(tips.get(row.label), row.id).toBe(mapOsmSublayerTooltip(row.id));
      expect(tips.get(row.label), row.id).toBeTruthy();
    }
  });

  it("keeps the density-cost title on the row itself, so the two answer different questions", () => {
    const roads = Array.from(osmCard(render()).querySelectorAll(".maps-osm-row"))
      .find((r) => r.querySelector("span")?.textContent === "Roads");
    expect(roads).toBeTruthy();
    // Outer: what moving the slider costs. Inner: what the layer is.
    expect(roads!.getAttribute("title")).toContain("density");
    const name = roads!.querySelector("span")!;
    expect(name.getAttribute("title")).toBe(mapOsmSublayerTooltip("omt-roads"));
    expect(name.getAttribute("title")).not.toBe(roads!.getAttribute("title"));
  });

  it("explains the two rows a reader most often mixes up in terms of geometry", () => {
    const tips = rowTooltips(render());
    expect(tips.get("Water")).toContain("AREAS");
    expect(tips.get("Waterways")).toContain("LINES");
  });
});
