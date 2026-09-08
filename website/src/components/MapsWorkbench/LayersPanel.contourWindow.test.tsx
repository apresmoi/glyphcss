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
 * The Contour card's elevation-window rows.
 *
 * The control's whole point is that its track is the terrain's OWN range —
 * a floor slider that runs over an arbitrary fixed span is not a control a
 * reader can aim with. And "no floor" has to stay a distinct value from "a
 * floor at the lowest visible cell", because that endpoint moves with the
 * view: `null` at the track's far end, never the endpoint's own number.
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
      minElevation: null, onMinElevation: () => {}, maxElevation: null, onMaxElevation: () => {},
      density: 1, onDensity: noop,
    },
    borders: { visible: true, onVisible: noop, color: "#e8c988", onColor: noop, simplify: null, density: 1, onDensity: noop },
    contour: {
      visible: true, onVisible: noop, color: "#7fe8c9", onColor: noop,
      interval: 500, onInterval: noop,
      minElevation: null, onMinElevation: noop,
      maxElevation: null, onMaxElevation: noop,
      fieldRange: { min: -5000, max: 4000 },
      lineCount: 8, density: 1, onDensity: noop,
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
      source: "OpenFreeMap · OpenMapTiles · z0–14", missing: null,
      sublayers: [], onSublayer: () => {}, onSublayerDensity: () => {}, onSublayerAnchor: () => {},
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

/**
 * The Contour card's slider rows, keyed by their leading label (`interval`,
 * `floor`, `ceiling`, `density`).
 *
 * `readout` reads the value column's `.value`, not its `textContent`: every
 * readout on a layer card is a real text input now (`mapsKit.tsx`'s
 * `MapsReadout`, matching the Dock's own editable number rows), so the
 * displayed string lives on the input rather than in a `<span>`'s text.
 */
function contourRows(host: HTMLElement): Map<string, { input: HTMLInputElement; readoutInput: HTMLInputElement; readout: string }> {
  const card = Array.from(host.querySelectorAll(".maps-layer-card")).find(
    (c) => c.querySelector(".maps-layer-check span")?.textContent === "Contour",
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

/**
 * Types `text` into a readout and blurs it, the way a reader commits a typed
 * value. React patches `value` on the node itself to track it, so writing
 * through the PROTOTYPE setter is what makes React see a real change — the
 * same technique the drag test below uses on the range input.
 */
function typeInto(input: HTMLInputElement, text: string): void {
  act(() => { input.focus(); input.dispatchEvent(new FocusEvent("focusin", { bubbles: true })); });
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, text);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  act(() => { input.dispatchEvent(new FocusEvent("focusout", { bubbles: true })); });
}

/** Tears down the currently mounted panel, so a test that mounts more than once doesn't leave the earlier tree in the document. */
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

describe("/maps Contour card — the elevation window", () => {
  it("renders a floor and a ceiling row bounded by the field's own range", () => {
    const rows = contourRows(mount());
    expect([...rows.keys()]).toEqual(["interval", "floor", "ceiling", "density"]);
    for (const end of ["floor", "ceiling"]) {
      // -5000..4000 rounded out to the control's 50m step is exactly itself.
      expect(rows.get(end)!.input.min).toBe("-5000");
      expect(rows.get(end)!.input.max).toBe("4000");
      expect(rows.get(end)!.input.step).toBe("50");
    }
  });

  it("reads 'off' at each unbounded end, and parks its handle at that end of the track", () => {
    const rows = contourRows(mount());
    expect(rows.get("floor")!.readout).toBe("off");
    expect(rows.get("ceiling")!.readout).toBe("off");
    expect(rows.get("floor")!.input.value).toBe("-5000");
    expect(rows.get("ceiling")!.input.value).toBe("4000");
  });

  it("reports a set window in metres", () => {
    const rows = contourRows(mount({ minElevation: 0, maxElevation: 2000 }));
    expect(rows.get("floor")!.readout).toBe("0m");
    expect(rows.get("ceiling")!.readout).toBe("2000m");
    expect(rows.get("floor")!.input.value).toBe("0");
  });

  it("emits null — not the track's endpoint — when a handle is dragged back to its far end", () => {
    const onMinElevation = vi.fn();
    const host = mount({ minElevation: 0, onMinElevation });
    const floor = contourRows(host).get("floor")!.input;
    // React patches `value` on the node itself to track it; writing through
    // the PROTOTYPE setter leaves that tracker stale, which is what makes
    // React treat the dispatched event as a real change.
    const setValue = (v: string) => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(floor, v);
      floor.dispatchEvent(new Event("input", { bubbles: true }));
    };
    act(() => setValue("-2000"));
    expect(onMinElevation).toHaveBeenLastCalledWith(-2000);
    act(() => setValue("-5000")); // the track's own bottom = "no floor"
    expect(onMinElevation).toHaveBeenLastCalledWith(null);
  });

  it("commits a TYPED floor, and reads 0 as sea level rather than as unbounded", () => {
    // The reported case: "I should be able to set the floor of the contour
    // map to 0 manually in the input, and I cannot." Dragging can only reach
    // 0 when the view's own data range happens to straddle sea level on a
    // 50m detent, so typing is the only reliable way there — and `0` must
    // not be confused with the unbounded sentinel a falsy check would hit.
    const onMinElevation = vi.fn();
    const host = mount({ minElevation: null, onMinElevation });
    typeInto(contourRows(host).get("floor")!.readoutInput, "0");
    expect(onMinElevation).toHaveBeenCalledTimes(1);
    expect(onMinElevation).toHaveBeenLastCalledWith(0);
  });

  it("types back to unbounded through an empty field or the word it prints", () => {
    for (const text of ["", "off", "OFF"]) {
      const onMinElevation = vi.fn();
      const host = mount({ minElevation: 0, onMinElevation });
      typeInto(contourRows(host).get("floor")!.readoutInput, text);
      expect(onMinElevation).toHaveBeenLastCalledWith(null);
      unmount();
    }
  });

  it("honours a typed value the 50m slider step cannot reach, and reverts junk", () => {
    // The URL persists this window at 10m (mapsUrlState.ts's `contourFloor`),
    // so snapping a typed value to the control's own 50m drag detent would
    // make that precision unreachable.
    const onMinElevation = vi.fn();
    const host = mount({ minElevation: 0, onMinElevation });
    typeInto(contourRows(host).get("floor")!.readoutInput, "1234");
    expect(onMinElevation).toHaveBeenLastCalledWith(1234);

    onMinElevation.mockClear();
    typeInto(contourRows(host).get("floor")!.readoutInput, "not a number");
    expect(onMinElevation).not.toHaveBeenCalled();
  });

  it("clamps a typed value to the ETOPO envelope, and widens the track to hold it", () => {
    // Clamping to the CURRENT track instead would make a real elevation
    // unreachable just because the view doesn't happen to show it; the
    // envelope's own job is to stay far inside the ±32,000m sentinel an
    // unbounded end persists as.
    const onMaxElevation = vi.fn();
    const host = mount({ maxElevation: null, onMaxElevation });
    typeInto(contourRows(host).get("ceiling")!.readoutInput, "99999");
    expect(onMaxElevation).toHaveBeenLastCalledWith(9000);

    // Re-mounted at that committed value: the track grew past the field's
    // own 4000m top rather than stranding the handle.
    unmount();
    const rows = contourRows(mount({ maxElevation: 9000 }));
    expect(rows.get("ceiling")!.input.max).toBe("9000");
    expect(rows.get("ceiling")!.input.value).toBe("9000");
  });

  it("keeps a handle reachable when the view no longer covers the value it holds", () => {
    // Floor 0 chosen at a global view, then zoomed into a wholly submarine
    // one: the track widens to the value rather than stranding the handle.
    const rows = contourRows(mount({ minElevation: 0, fieldRange: { min: -6000, max: -2000 } }));
    expect(rows.get("floor")!.input.max).toBe("0");
    expect(rows.get("floor")!.input.value).toBe("0");
  });
});
