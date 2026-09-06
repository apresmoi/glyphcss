// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

// React 19 requires this flag for `act()`-based tests (createRoot + act, no
// React Testing Library here) — mirrors `LayersPanel.glyphPalette.test.tsx`.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// `mapsKit` -> `Dock/primitives` -> `useRenderingFolder.ts` calls
// `ensureCalibratedPalette()` at IMPORT TIME, a real-browser-only canvas
// measurement happy-dom cannot do. Stub just that one measurement, exactly as
// the sibling LayersPanel tests do for the same import chain.
vi.mock("@glyphcss/effects", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@glyphcss/effects")>();
  return { ...actual, calibrateGlyphRamp: () => ({ ramp: " .:-=+*#%@", steps: [] }) };
});

import { LayersPanel, MAP_SCENE_GLYPH_PALETTE, MAP_SCENE_RENDER_MODE, type ExtraLayerInputs, type LayersFolderInputs } from "./mapsKit";
import { MAP_MODEL_SHAPE_DEFAULT, MAP_MODEL_SHAPE_OPTIONS } from "./mapPin";

/**
 * The Model card's SHAPE row — the mirror image of the point cards' DATASET
 * row, and the reason the one layer with no data source is still
 * demonstrable. Two things have to hold: the row exists on Model and ONLY on
 * Model (every other card either picks a dataset or authors nothing), and it
 * offers the real `mapPin.ts` list rather than a copy that can drift.
 */

let root: Root | null = null;
let container: HTMLElement | null = null;
const noop = () => {};

function extra(overrides: Partial<ExtraLayerInputs> = {}): ExtraLayerInputs {
  return { visible: true, onVisible: noop, color: "#ffffff", onColor: noop, sliders: [], ...overrides };
}

/** Every card expanded, so a missing row means "not rendered", never "collapsed". */
function inputs(): LayersFolderInputs {
  const mesh = extra({ glyphPalette: MAP_SCENE_GLYPH_PALETTE, onGlyphPalette: noop });
  const dataset = { value: "countries", options: [{ value: "countries", label: "Countries" }], title: "", onChange: noop };
  return {
    background: { color: "#05070c", onColor: noop },
    terrain: {
      visible: true, onVisible: noop, palette: "terrain", onPalette: noop,
      glyphPalette: MAP_SCENE_GLYPH_PALETTE, onGlyphPalette: noop,
      exaggeration: 24, onExaggeration: noop, sampler: null, density: 1, onDensity: noop,
    },
    borders: { visible: true, onVisible: noop, color: "#e8c988", onColor: noop, simplify: null, density: 1, onDensity: noop },
    contour: {
      visible: true, onVisible: noop, color: "#7fe8c9", onColor: noop, interval: 500, onInterval: noop,
      minElevation: null, onMinElevation: noop, maxElevation: null, onMaxElevation: noop,
      fieldRange: null, lineCount: null, density: 1, onDensity: noop,
    },
    fill: mesh,
    symbol: extra({ dataset }),
    circle: extra({ dataset }),
    heatmap: extra({ ...mesh, dataset }),
    fillExtrusion: extra({ ...mesh, renderMode: MAP_SCENE_RENDER_MODE, onRenderMode: noop }),
    model: extra({
      ...mesh,
      renderMode: MAP_SCENE_RENDER_MODE, onRenderMode: noop,
      shape: { value: MAP_MODEL_SHAPE_DEFAULT, options: MAP_MODEL_SHAPE_OPTIONS, title: "", onChange: noop },
    }),
    // The OSM card's inputs — required by `LayersFolderInputs`, and not read
    // by this file's assertions (`LayersPanel.osm.test.tsx` owns that card).
    osm: {
      visible: false, onVisible: noop,
      summary: null, extent: null, error: null,
      inCoverage: false, onFlyTo: noop,
      sublayers: [], onSublayer: noop,
      density: 1, onDensity: noop,
    },
  };
}

function render(): HTMLElement {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => { root!.render(<LayersPanel {...inputs()} />); });
  return container;
}

/** Every card's own `<select>` row labels, keyed by the card's checkbox label. */
function cardSelectLabels(host: HTMLElement): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const card of Array.from(host.querySelectorAll(".maps-layer-card"))) {
    const name = card.querySelector(".maps-layer-check span")?.textContent ?? "?";
    out.set(name, Array.from(card.querySelectorAll(".maps-layer-select-row")).map(
      (row) => row.querySelector("span")?.textContent ?? "",
    ));
  }
  return out;
}

afterEach(() => {
  act(() => { root?.unmount(); });
  root = null;
  container?.remove();
  container = null;
});

describe("LayersPanel — the Model card's shape row", () => {
  it("renders a shape row on Model and on no other card", () => {
    const rows = cardSelectLabels(render());
    expect(rows.get("Model")).toContain("shape");
    for (const card of ["Terrain", "Borders", "Contour", "Fill", "Symbol", "Circle", "Heatmap", "Fill extrusion"]) {
      expect(rows.get(card), card).not.toContain("shape");
    }
  });

  it("offers exactly mapPin.ts's own shape list, in its own order", () => {
    const host = render();
    const model = Array.from(host.querySelectorAll(".maps-layer-card"))
      .find((c) => c.querySelector(".maps-layer-check span")?.textContent === "Model")!;
    const select = Array.from(model.querySelectorAll(".maps-layer-select-row"))
      .find((row) => row.querySelector("span")?.textContent === "shape")!
      .querySelector("select")!;
    expect(Array.from(select.options).map((o) => o.value)).toEqual(MAP_MODEL_SHAPE_OPTIONS.map((o) => o.value));
    expect(select.value).toBe(MAP_MODEL_SHAPE_DEFAULT);
    // A pyramid is what this layer has always mounted; the picker must not
    // silently change what the page opens on.
    expect(MAP_MODEL_SHAPE_DEFAULT).toBe("pyramid");
  });

  it("keeps the Model card's own dataset row absent — it authors geometry, it does not select data", () => {
    const rows = cardSelectLabels(render());
    expect(rows.get("Model")).not.toContain("data");
  });
});
