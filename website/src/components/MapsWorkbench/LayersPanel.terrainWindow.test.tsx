// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// Same import-time canvas stub `LayersPanel.glyphPalette.test.tsx` documents:
// `mapsKit` → `Dock/primitives` → `useRenderingFolder.ts` calibrates a ramp
// against a real canvas at import time, which happy-dom cannot do.
vi.mock("@glyphcss/effects", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@glyphcss/effects")>();
  return { ...actual, calibrateGlyphRamp: () => ({ ramp: " .:-=+*#%@", steps: [] }) };
});

import { LayersPanel, MAP_SCENE_GLYPH_PALETTE, type ExtraLayerInputs, type LayersFolderInputs } from "./mapsKit";

/**
 * The Terrain card's elevation-window rows — the same `ElevationWindowRow`
 * the Contour card uses, on the same two numbers in the same units, because
 * they are the same control and a lookalike would be worse than a reuse.
 *
 * What matters here is the same thing that matters there: "no floor" has to
 * stay a distinct value from "a floor at the track's own lowest number", so
 * the far end of the slider commits `null`, never the endpoint's own value —
 * and `0` (sea level, the whole point of this control) must never be read as
 * "off".
 */
let root: Root | null = null;
let container: HTMLElement | null = null;
const noop = () => {};

function extra(overrides: Partial<ExtraLayerInputs> = {}): ExtraLayerInputs {
  return { visible: true, onVisible: noop, color: "#ffffff", onColor: noop, sliders: [], ...overrides };
}

function inputs(terrain: Partial<LayersFolderInputs["terrain"]>): LayersFolderInputs {
  const mesh = extra({ glyphPalette: MAP_SCENE_GLYPH_PALETTE, onGlyphPalette: noop });
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
      ...terrain,
    },
    borders: { visible: true, onVisible: noop, color: "#e8c988", onColor: noop, simplify: null, density: 1, onDensity: noop },
    contour: {
      visible: true, onVisible: noop, color: "#7fe8c9", onColor: noop,
      interval: 500, onInterval: noop,
      minElevation: null, onMinElevation: noop,
      maxElevation: null, onMaxElevation: noop,
      fieldRange: { min: -5000, max: 4000 },
      lineCount: 8, density: 1, onDensity: noop,
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
      source: "OpenFreeMap · OpenMapTiles · z0–14", missing: null,
      sublayers: [], onSublayer: () => {}, onSublayerDensity: () => {}, onSublayerAnchor: () => {},
      density: 1, onDensity: () => {},
    },
  };
}

function mount(terrain: Partial<LayersFolderInputs["terrain"]> = {}): HTMLElement {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => { root!.render(<LayersPanel {...inputs(terrain)} />); });
  return container;
}

/** The Terrain card's slider rows, keyed by their leading label (`exag ×`, `floor`, `ceiling`, `density`). */
function terrainRows(host: HTMLElement): Map<string, { input: HTMLInputElement; readoutInput: HTMLInputElement; readout: string }> {
  const card = Array.from(host.querySelectorAll(".maps-layer-card")).find(
    (c) => c.querySelector(".maps-layer-check span")?.textContent === "Terrain",
  )!;
  const out = new Map<string, { input: HTMLInputElement; readoutInput: HTMLInputElement; readout: string }>();
  for (const row of Array.from(card.querySelectorAll("label.voice-slider"))) {
    const label = row.querySelector("span")?.textContent ?? "";
    const readoutInput = row.querySelector(".voice-slider-readout") as HTMLInputElement;
    out.set(label, {
      input: row.querySelector('input[type="range"]') as HTMLInputElement,
      readoutInput,
      readout: readoutInput?.value ?? "",
    });
  }
  return out;
}

/** Types `text` into a readout and blurs it, the way a reader commits a typed value. */
function typeInto(input: HTMLInputElement, text: string): void {
  act(() => { input.focus(); input.dispatchEvent(new FocusEvent("focusin", { bubbles: true })); });
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, text);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  act(() => { input.dispatchEvent(new FocusEvent("focusout", { bubbles: true })); });
}

/** Drags a range input to `value`, the way a reader moves a slider. */
function dragTo(input: HTMLInputElement, value: number): void {
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, String(value));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

function unmount(): void {
  act(() => { root?.unmount(); });
  container?.remove();
  root = null;
  container = null;
}

afterEach(() => { unmount(); });

describe("LayersPanel — the Terrain card's elevation window", () => {
  it("offers a floor and a ceiling row, printing `off` while unbounded", () => {
    const rows = terrainRows(mount());
    expect([...rows.keys()]).toEqual(expect.arrayContaining(["floor", "ceiling"]));
    expect(rows.get("floor")!.readout).toBe("off");
    expect(rows.get("ceiling")!.readout).toBe("off");
  });

  it("prints a set end in metres", () => {
    const rows = terrainRows(mount({ minElevation: 0, maxElevation: 2000 }));
    expect(rows.get("floor")!.readout).toBe("0m");
    expect(rows.get("ceiling")!.readout).toBe("2000m");
  });

  it("commits a typed floor of 0 as 0, never as `off`", () => {
    const onMinElevation = vi.fn();
    const rows = terrainRows(mount({ onMinElevation }));
    typeInto(rows.get("floor")!.readoutInput, "0");
    expect(onMinElevation).toHaveBeenCalledWith(0);
  });

  it("commits `off` and an empty string as unbounded", () => {
    const onMinElevation = vi.fn();
    const rows = terrainRows(mount({ minElevation: 0, onMinElevation }));
    typeInto(rows.get("floor")!.readoutInput, "off");
    expect(onMinElevation).toHaveBeenCalledWith(null);
    typeInto(rows.get("floor")!.readoutInput, "");
    expect(onMinElevation).toHaveBeenLastCalledWith(null);
  });

  it("commits `null`, not the endpoint's own number, at the far end of the track", () => {
    const onMinElevation = vi.fn();
    const rows = terrainRows(mount({ minElevation: 0, onMinElevation }));
    const track = rows.get("floor")!.input;
    dragTo(track, Number(track.min));
    expect(onMinElevation).toHaveBeenCalledWith(null);
  });

  it("runs its track over the ETOPO1 envelope, and widens to hold a value outside it", () => {
    let rows = terrainRows(mount());
    expect({ min: Number(rows.get("floor")!.input.min), max: Number(rows.get("floor")!.input.max) })
      .toEqual({ min: -11000, max: 9000 });
    unmount();
    // A handle is never stranded off its own track.
    rows = terrainRows(mount({ maxElevation: 12000 }));
    expect(Number(rows.get("ceiling")!.input.max)).toBeGreaterThanOrEqual(12000);
  });

  it("leaves the Contour card's own window alone — two layers, two windows", () => {
    const rows = terrainRows(mount({ minElevation: 0 }));
    expect(rows.get("floor")!.readout).toBe("0m");
    const contourCard = Array.from(container!.querySelectorAll(".maps-layer-card")).find(
      (c) => c.querySelector(".maps-layer-check span")?.textContent === "Contour",
    )!;
    const contourFloor = Array.from(contourCard.querySelectorAll("label.voice-slider"))
      .find((r) => r.querySelector("span")?.textContent === "floor")!;
    expect((contourFloor.querySelector(".voice-slider-readout") as HTMLInputElement).value).toBe("off");
  });
});
