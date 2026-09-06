// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// Same import-time canvas stub `LayersPanel.contourWindow.test.tsx` documents:
// `mapsKit` → `Dock/primitives` → `useRenderingFolder.ts` calibrates a ramp
// against a real canvas at import time, which happy-dom cannot do.
vi.mock("@glyphcss/effects", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@glyphcss/effects")>();
  return { ...actual, calibrateGlyphRamp: () => ({ ramp: " .:-=+*#%@", steps: [] }) };
});

import {
  buildContourLayerMountOptions,
  LayersPanel,
  MAP_SCENE_GLYPH_PALETTE,
  type ExtraLayerInputs,
  type LayersFolderInputs,
} from "./mapsKit";

/**
 * The Contour card's `labels` control — `GlyphMapContourLayer.labels`
 * shipped in `@glyphcss/maps` (`widget.contourLabels.test.ts`, 10 tests) but
 * was never wired into `/maps`, leaving it unreachable from the UI. This
 * pins two independent things: the checkbox actually renders and round-trips
 * through the Dock kit's `ContourLayerInputs`, and the mount-options builder
 * `MapsWorkbench.tsx`'s own contour effect calls only ever adds `labels: true`
 * to the layer when the control is on — never a `labels: false` sentinel,
 * matching the `minElevation`/`maxElevation` omit-when-off precedent this
 * control follows (an untouched control must mount byte-identically to
 * before it existed).
 */
let root: Root | null = null;
let container: HTMLElement | null = null;
const noop = () => {};

function extra(overrides: Partial<ExtraLayerInputs> = {}): ExtraLayerInputs {
  return { visible: true, onVisible: noop, color: "#ffffff", onColor: noop, sliders: [], ...overrides };
}

function inputs(contour: Partial<LayersFolderInputs["contour"]>): LayersFolderInputs {
  const mesh = extra({ glyphPalette: MAP_SCENE_GLYPH_PALETTE, onGlyphPalette: noop });
  return {
    background: { color: "#05070c", onColor: noop },
    terrain: {
      visible: true, onVisible: noop,
      palette: "terrain", onPalette: noop,
      glyphPalette: MAP_SCENE_GLYPH_PALETTE, onGlyphPalette: noop,
      exaggeration: 24, onExaggeration: noop,
      sampler: null,
      density: 1, onDensity: noop,
    },
    borders: { visible: true, onVisible: noop, color: "#e8c988", onColor: noop, simplify: null, density: 1, onDensity: noop },
    contour: {
      visible: true, onVisible: noop, color: "#7fe8c9", onColor: noop,
      interval: 500, onInterval: noop,
      minElevation: null, onMinElevation: noop,
      maxElevation: null, onMaxElevation: noop,
      fieldRange: { min: -5000, max: 4000 },
      lineCount: 8,
      labels: false, onLabels: noop,
      density: 1, onDensity: noop,
      ...contour,
    },
    fill: mesh,
    symbol: extra(),
    circle: extra(),
    heatmap: mesh,
    fillExtrusion: mesh,
    model: mesh,
    // The OSM card's inputs — required by `LayersFolderInputs`, and not read
    // by this file's assertions (`LayersPanel.osm.test.tsx` owns that card).
    osm: {
      visible: false, onVisible: () => {},
      summary: null, extent: null, error: null,
      inCoverage: false, onFlyTo: () => {},
      sublayers: [], onSublayer: () => {},
      density: 1, onDensity: () => {},
    },
  };
}

function mount(contour: Partial<LayersFolderInputs["contour"]> = {}): HTMLElement {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => { root!.render(<LayersPanel {...inputs(contour)} />); });
  return container;
}

function contourCard(host: HTMLElement): HTMLElement {
  return Array.from(host.querySelectorAll(".maps-layer-card")).find(
    (c) => c.querySelector(".maps-layer-check span")?.textContent === "Contour",
  ) as HTMLElement;
}

function labelsCheckbox(host: HTMLElement): HTMLInputElement {
  const card = contourCard(host);
  const row = Array.from(card.querySelectorAll("label")).find((r) => r.querySelector("span")?.textContent === "labels")!;
  return row.querySelector('input[type="checkbox"]') as HTMLInputElement;
}

function unmount(): void {
  act(() => { root?.unmount(); });
  container?.remove();
  root = null;
  container = null;
}

afterEach(() => {
  unmount();
  vi.restoreAllMocks();
});

describe("/maps Contour card — the labels control", () => {
  it("renders a labels checkbox, checked/unchecked matching the prop", () => {
    expect(labelsCheckbox(mount({ labels: false })).checked).toBe(false);
    unmount();
    expect(labelsCheckbox(mount({ labels: true })).checked).toBe(true);
  });

  it("calls onLabels with the new value when toggled", () => {
    const onLabels = vi.fn();
    const host = mount({ labels: false, onLabels });
    const checkbox = labelsCheckbox(host);
    act(() => {
      checkbox.click();
    });
    expect(onLabels).toHaveBeenCalledTimes(1);
    expect(onLabels).toHaveBeenLastCalledWith(true);
  });
});

describe("buildContourLayerMountOptions — the labels: true / omitted mount contract", () => {
  const base = { interval: 500, color: "#7fe8c9", density: 1, minElevation: null, maxElevation: null };

  it("omits `labels` entirely when off, matching the pre-existing mount shape", () => {
    const opts = buildContourLayerMountOptions({ ...base, labels: false });
    expect(opts).not.toHaveProperty("labels");
    expect(opts).toEqual({ levels: { interval: 500 }, color: "#7fe8c9", density: 1 });
  });

  it("adds `labels: true` when on", () => {
    const opts = buildContourLayerMountOptions({ ...base, labels: true });
    expect(opts.labels).toBe(true);
  });

  it("composes with an elevation window", () => {
    const opts = buildContourLayerMountOptions({ ...base, minElevation: 0, maxElevation: 2000, labels: true });
    expect(opts).toEqual({
      levels: { interval: 500 }, color: "#7fe8c9", density: 1,
      minElevation: 0, maxElevation: 2000, labels: true,
    });
  });
});
