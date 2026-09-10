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
// the sibling `LayersPanel.glyphPalette.test.tsx` does for the same chain.
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
} from "./mapsKit";

/**
 * WHICH cards carry a RENDER MODE row, and which are pinned to
 * {@link MAP_SCENE_RENDER_MODE} with no control at all.
 *
 * Terrain, `heatmap` and `fill` are all shaded-MAGNITUDE surfaces — a relief
 * mesh, a density relief, a filled country — whose entire content IS the
 * shade, so `wireframe`/`ink` show a cage or an outline carrying none of the
 * information the layer exists to carry. Separating an OPAQUE layer into its
 * own pass was also measured at about +8.8 ms/frame, so the control was a way
 * to spend a third of the frame budget for no visual gain. `fill-extrusion`
 * (building wireframes) and `model` (arbitrary authored geometry) genuinely
 * read in all three modes and keep the row.
 *
 * The GLYPH ramp row is a WIDER set and must survive on every mesh-backed
 * card, `fill`/`heatmap` included: it changes which characters carry a shade,
 * which is exactly as meaningful on a solid-by-nature surface as anywhere
 * else. Asserting both together is the point — a removal that also took the
 * glyph row would pass a "no mode row" test on its own.
 */

let root: Root | null = null;
let container: HTMLElement | null = null;

const noop = () => {};

function extra(overrides: Partial<ExtraLayerInputs> = {}): ExtraLayerInputs {
  return { visible: true, onVisible: noop, color: "#ffffff", onColor: noop, sliders: [], ...overrides };
}

/**
 * Every card expanded, so a missing row means "not rendered", never
 * "collapsed". The `background`/`terrain`/`borders`/`contour` entries are
 * filled only so `LayersPanel` renders; none of this file's assertions read
 * them.
 */
function inputs(): LayersFolderInputs {
  const glyphOnly = extra({ glyphPalette: MAP_SCENE_GLYPH_PALETTE, onGlyphPalette: noop });
  const withMode = extra({
    glyphPalette: MAP_SCENE_GLYPH_PALETTE, onGlyphPalette: noop,
    renderMode: MAP_SCENE_RENDER_MODE, onRenderMode: noop,
  });
  return {
    background: { color: "#05070c", onColor: noop },
    terrain: {
      visible: true, onVisible: noop,
      palette: "terrain", onPalette: noop,
      glyphPalette: MAP_SCENE_GLYPH_PALETTE, onGlyphPalette: noop,
      exaggeration: 24, onExaggeration: noop,
      sampler: null,
      minElevation: null, onMinElevation: () => {}, maxElevation: null, onMaxElevation: () => {},
      density: 1, onDensity: noop,
    },
    borders: { visible: true, onVisible: noop, color: "#e8c988", onColor: noop, simplify: null, density: 1, onDensity: noop },
    contour: {
      visible: true, onVisible: noop, color: "#7fe8c9", onColor: noop,
      interval: 500, onInterval: noop,
      minElevation: null, onMinElevation: noop,
      maxElevation: null, onMaxElevation: noop,
      fieldRange: null,
      lineCount: null,
      density: 1, onDensity: noop,
    },
    fill: glyphOnly,
    symbol: extra(),
    circle: extra(),
    heatmap: glyphOnly,
    fillExtrusion: withMode,
    model: withMode,
    // The OSM card's inputs — required by `LayersFolderInputs`, and not read
    // by this file's assertions (`LayersPanel.osm.test.tsx` owns that card).
    osm: {
      visible: false, onVisible: () => {},
      source: "OpenFreeMap · OpenMapTiles · z0–14", missing: null,
      sublayers: [], onSublayer: () => {}, onSublayerDensity: () => {}, onSublayerAnchor: () => {},
      density: 1, onDensity: () => {},
    },
  };
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

function render(): Map<string, string[]> {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => { root!.render(<LayersPanel {...inputs()} />); });
  return cardSelectLabels(container);
}

afterEach(() => {
  act(() => { root?.unmount(); });
  root = null;
  container?.remove();
  container = null;
});

describe("LayersPanel — which cards carry a render-mode row", () => {
  it("gives Fill extrusion and Model a mode row", () => {
    const rows = render();
    expect(rows.get("Fill extrusion")).toContain("mode");
    expect(rows.get("Model")).toContain("mode");
  });

  it("gives Fill, Heatmap and Terrain NO mode row — all three are shaded-magnitude surfaces", () => {
    const rows = render();
    expect(rows.get("Fill")).not.toContain("mode");
    expect(rows.get("Heatmap")).not.toContain("mode");
    expect(rows.get("Terrain")).not.toContain("mode");
  });

  it("keeps the glyph ramp row on Fill and Heatmap — a wider set than the mode row", () => {
    const rows = render();
    expect(rows.get("Fill")).toContain("glyphs");
    expect(rows.get("Heatmap")).toContain("glyphs");
  });

  it("still gives no mode row to the hotspot-backed and post-raster cards", () => {
    const rows = render();
    for (const card of ["Symbol", "Circle", "Borders", "Contour"]) expect(rows.get(card)).not.toContain("mode");
  });
});
