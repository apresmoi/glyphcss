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

import {
  DensityRow, LayersPanel, MAP_SCENE_GLYPH_PALETTE, logHeightSliderSpec,
  parseHeightMeters, parseMapsHex, parseMapsNumber,
  type ExtraLayerInputs, type LayersFolderInputs,
} from "./mapsKit";

/**
 * The left rail's layer cards render the DOCK's control rows, not a second
 * control system sitting next to it (user ask: "could we use the same kind of
 * inputs we have in the right sidebar in the left sidebar… the sliders and
 * inputs don't look exactly the same, they should").
 *
 * Geometry is asserted from the stylesheet in
 * `maps-workbench.rowWidths.test.ts` — there is no layout engine here. What
 * this file can prove is the MARKUP that geometry is written against, and the
 * one behavioural half of "the same kind of input": the Dock's number rows
 * are editable, so these must be too.
 */
let root: Root | null = null;
let container: HTMLElement | null = null;
const noop = () => {};

function extra(overrides: Partial<ExtraLayerInputs> = {}): ExtraLayerInputs {
  return { visible: true, onVisible: noop, color: "#ffffff", onColor: noop, sliders: [], ...overrides };
}

function inputs(overrides: Partial<LayersFolderInputs> = {}): LayersFolderInputs {
  const mesh = extra({ glyphPalette: MAP_SCENE_GLYPH_PALETTE, onGlyphPalette: noop });
  return {
    background: { color: "#05070c", onColor: noop },
    terrain: {
      visible: true, onVisible: noop,
      palette: "terrain", onPalette: noop,
      glyphPalette: MAP_SCENE_GLYPH_PALETTE, onGlyphPalette: noop,
      exaggeration: 24, onExaggeration: noop,
      sampler: "nearest",
      density: 1, onDensity: noop,
    },
    borders: { visible: true, onVisible: noop, color: "#e8c988", onColor: noop, simplify: "vw", density: 1, onDensity: noop },
    contour: {
      visible: true, onVisible: noop, color: "#7fe8c9", onColor: noop,
      interval: 500, onInterval: noop,
      minElevation: null, onMinElevation: noop,
      maxElevation: null, onMaxElevation: noop,
      fieldRange: { min: -5000, max: 4000 },
      lineCount: 8, density: 1, onDensity: noop,
    },
    fill: mesh, symbol: extra(), circle: extra(),
    heatmap: mesh, fillExtrusion: mesh, model: mesh,
    // The OSM card's inputs — required by `LayersFolderInputs`, and not read
    // by this file's assertions (`LayersPanel.osm.test.tsx` owns that card).
    osm: {
      visible: false, onVisible: () => {},
      source: "OpenFreeMap · OpenMapTiles · z0–14", missing: null,
      sublayers: [], onSublayer: () => {}, onSublayerDensity: () => {}, onSublayerAnchor: () => {},
      density: 1, onDensity: () => {},
    },
    ...overrides,
  };
}

function mount(overrides: Partial<LayersFolderInputs> = {}): HTMLElement {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => { root!.render(<LayersPanel {...inputs(overrides)} />); });
  return container;
}

afterEach(() => {
  act(() => { root?.unmount(); });
  container?.remove();
  root = null;
  container = null;
  vi.restoreAllMocks();
});

describe("/maps layer cards — the Dock's control rows", () => {
  it("gives every slider row an EDITABLE value column, never a static label", () => {
    const host = mount();
    const rows = Array.from(host.querySelectorAll("label.voice-slider"));
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      const readout = row.querySelector(".voice-slider-readout");
      const label = row.querySelector("span")?.textContent ?? "?";
      // The Dock's number row is `<div class=name> <div class=widget>
      // <div class=slider> <input>`, an input on both halves. A `<span>`
      // here is the regression this replaces.
      expect(readout, label).not.toBeNull();
      expect(readout!.tagName, label).toBe("INPUT");
      expect((readout as HTMLInputElement).type, label).toBe("text");
    }
  });

  it("renders the Dock's colour controller: a bracketed swatch bar plus an editable hex field", () => {
    const host = mount();
    const colorRows = Array.from(host.querySelectorAll(".maps-layer-color-row"));
    // Background, Borders, Contour, and the six demo layers.
    expect(colorRows.length).toBe(9);
    for (const row of colorRows) {
      // `.voice-slider-track` is what carries the `[ ]` pseudo brackets, so
      // the swatch reads as the same control family as the sliders.
      const swatch = row.querySelector(".voice-slider-track.maps-layer-swatch");
      expect(swatch).not.toBeNull();
      expect(swatch!.querySelector('input[type="color"]')).not.toBeNull();
      const hex = row.querySelector("input.maps-layer-hex") as HTMLInputElement | null;
      expect(hex).not.toBeNull();
      expect(hex!.type).toBe("text");
    }
    // The 18px `.voice-color` square this replaces is gone — it had no
    // counterpart in the Dock and no way to type a colour.
    expect(host.querySelector(".voice-color")).toBeNull();
  });

  it("names the background row 'Background' once, not a header plus a 'color' label", () => {
    const host = mount();
    const row = host.querySelector(".maps-layer-background-row .maps-layer-color-row")!;
    expect(row.querySelector("span")!.textContent).toBe("Background");
    expect(host.querySelector(".maps-layer-background-row")!.textContent).not.toContain("color");
  });

  it("gates a density row the way the Dock gates a controller — dimmed, and BOTH halves disabled", () => {
    // The row stays visible and dimmed rather than disappearing (the Dock's
    // own `.controller.disabled` treatment). Both halves have to follow the
    // gate: dimming a row whose value could still be TYPED would be a worse
    // state than the static label it replaced.
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => { root!.render(<DensityRow label="Symbol" density={1} onDensity={noop} enabled={false} />); });
    const row = container.querySelector(".voice-slider")!;
    expect(row.className).toContain("maps-layer-slider--off");
    expect((row.querySelector('input[type="range"]') as HTMLInputElement).disabled).toBe(true);
    expect((row.querySelector(".voice-slider-readout") as HTMLInputElement).disabled).toBe(true);

    act(() => { root!.render(<DensityRow label="Terrain" density={1} onDensity={noop} enabled />); });
    const on = container.querySelector(".voice-slider")!;
    expect(on.className).not.toContain("maps-layer-slider--off");
    expect((on.querySelector('input[type="range"]') as HTMLInputElement).disabled).toBe(false);
    expect((on.querySelector(".voice-slider-readout") as HTMLInputElement).disabled).toBe(false);
  });

  it("still renders every select, checkbox and read-only row the cards had", () => {
    const host = mount();
    // Terrain, Borders, Contour, Fill, Symbol, Circle, Heatmap, Fill
    // extrusion, Model, OpenStreetMap. (Background is a bare row, not a card.)
    expect(host.querySelectorAll(".maps-layer-card").length).toBe(10);
    expect(host.querySelectorAll('.maps-layer-head input[type="checkbox"]').length).toBe(10);
    expect(host.querySelectorAll(".maps-layer-select-row .gx-select select").length).toBeGreaterThan(0);
    expect(Array.from(host.querySelectorAll(".maps-layer-info-value")).map((n) => n.textContent))
      .toEqual(["nearest", "vw", "8"]);
  });
});

describe("/maps readout parsers — each one inverts its own format", () => {
  // A readout is a text input now, so `parse` must invert `format` exactly:
  // focusing a row and blurring it without editing has to be a no-op. A
  // parser that read only the numeric PREFIX of the formatted string would
  // silently rewrite the value ("1.2M" → 1.2 people, "120 km" → 120 metres).
  it("clamps and optionally rounds a plain numeric readout", () => {
    expect(parseMapsNumber(1, 4)("2.5x")).toEqual({ value: 2.5 });
    expect(parseMapsNumber(1, 4)("9")).toEqual({ value: 4 });
    expect(parseMapsNumber(1, 4)("0")).toEqual({ value: 1 });
    expect(parseMapsNumber(1, 60, true)("24.7")).toEqual({ value: 25 });
    expect(parseMapsNumber(1, 4)("")).toBeNull();
    expect(parseMapsNumber(1, 4)("nope")).toBeNull();
  });

  it("reads both units a height readout can print, and treats a bare number as metres", () => {
    expect(parseHeightMeters("800 m")).toBe(800);
    expect(parseHeightMeters("1.5 km")).toBe(1_500);
    expect(parseHeightMeters("1500")).toBe(1_500);
    expect(parseHeightMeters("tall")).toBeNull();
  });

  it("maps a typed height back through the log row's own position space", () => {
    // The row's slider travels in log POSITION while its readout prints
    // metres — the case `EditableReadout`'s hardcoded `Number.parseFloat`
    // cannot express, and the reason `LayerSliderSpec.parse` exists. Without
    // it, blurring this row unedited would commit "5.0 km" as position 5,
    // i.e. the row's maximum.
    const committed: number[] = [];
    const spec = logHeightSliderSpec({
      key: "height", label: "height", min: 20, max: 2_000_000, value: 5_000,
      onChange: (v) => committed.push(v), title: "",
    });
    // Focus-then-blur with no edit is a no-op: the formatted string parses
    // back to the same position, and so to the same metres.
    spec.onChange(spec.parse!(spec.format(spec.value))!.value);
    expect(committed.pop()).toBeCloseTo(5_000, 6);
    // A value the 0.001 position step cannot land on is honoured exactly.
    spec.onChange(spec.parse!("1234 m")!.value);
    expect(committed.pop()).toBeCloseTo(1_234, 6);
    // And km is read as km, not as metres.
    spec.onChange(spec.parse!("1.5 km")!.value);
    expect(committed.pop()).toBeCloseTo(1_500, 6);
    // Out of range clamps to the row's own bounds rather than escaping them.
    spec.onChange(spec.parse!("9999 km")!.value);
    expect(committed.pop()).toBeCloseTo(2_000_000, 6);
    expect(spec.parse!("tall")).toBeNull();
  });

  it("normalises a hex colour and rejects a half-typed one", () => {
    expect(parseMapsHex("#0af")).toBe("#00aaff");
    expect(parseMapsHex("00AAFF")).toBe("#00aaff");
    expect(parseMapsHex(" #00aaff ")).toBe("#00aaff");
    expect(parseMapsHex("#00aa")).toBeNull();
    expect(parseMapsHex("rebeccapurple")).toBeNull();
  });
});
