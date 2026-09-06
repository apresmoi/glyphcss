// @vitest-environment happy-dom
/**
 * The OpenStreetMap card's per-row density.
 *
 * The card mounts one layer per OpenMapTiles row and used to give all ten of
 * them ONE density, so a reader who wanted roads sharpened had to sharpen
 * land cover too. Each row now carries its own control, on its own line,
 * beside the toggle it already had — the same `MapsReadout` + 1..4 track
 * every other density row on this rail uses, not a new control shape.
 *
 * The master/per-row contract asserted here:
 *
 *  - The card keeps ONE master row. Moving it is a write of EVERY row (the
 *    page's `mapOsmDensityRecord`), because that is the gesture the card
 *    already had and it has to keep meaning all of it.
 *  - The master READS "mixed" once the rows disagree — it cannot print a
 *    number that is wrong for nine of ten rows.
 *  - A row's own control writes that row and nothing else.
 *  - A row whose density cannot do anything — the row is switched off, or it
 *    is a `symbol`/`circle` row, which reads no density at all — has it
 *    disabled and dimmed (`.maps-osm-row--density-off`, `DensityRow`'s own
 *    gated treatment scoped to the density half, since the toggle beside it
 *    is live).
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

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
import { MAP_OSM_SUBLAYERS, mapOsmDensityRecord } from "./mapsOsm";

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
    sublayers: MAP_OSM_SUBLAYERS.map((s) => ({ ...s, on: true, density: 1 })),
    onSublayer: noop,
    onSublayerDensity: noop,
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

/** One OSM row, by its label. */
function row(host: HTMLElement, label: string): HTMLElement {
  const found = Array.from(card(host).querySelectorAll(".maps-osm-row")).find(
    (r) => r.querySelector("span")?.textContent === label,
  );
  expect(found, label).toBeTruthy();
  return found as HTMLElement;
}

const slider = (el: HTMLElement) => el.querySelector<HTMLInputElement>("input[type='range']")!;
const readout = (el: HTMLElement) => el.querySelector<HTMLInputElement>("input[type='text']")!;

/** The card's live overlay-grid count, or `null` while it costs nothing and says nothing. */
function strokeGrids(host: HTMLElement): string | null {
  const found = Array.from(card(host).querySelectorAll(".maps-layer-info-row")).find(
    (r) => r.querySelector("span")?.textContent === "stroke grids",
  );
  return found?.querySelector(".maps-layer-info-value")?.textContent ?? null;
}

/** The card's ONE master row — the density control it already had. */
function master(host: HTMLElement): HTMLElement {
  const found = Array.from(card(host).querySelectorAll(".maps-layer-slider")).find(
    (r) => !r.classList.contains("maps-osm-row"),
  );
  expect(found).toBeTruthy();
  return found as HTMLElement;
}

/**
 * React patches `value` on the node itself to track it, so writing through
 * the PROTOTYPE setter is what leaves that tracker stale and makes React
 * treat the dispatched event as a real change — the same technique
 * `LayersPanel.contourWindow.test.tsx` uses on its own rows.
 */
function setValue(input: HTMLInputElement, to: string): void {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, to);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

function drag(input: HTMLInputElement, to: string): void {
  act(() => { setValue(input, to); });
}

afterEach(() => {
  act(() => { root?.unmount(); });
  root = null;
  container?.remove();
  container = null;
});

describe("every OSM row carries its own density, on its own line", () => {
  it("gives each mapped row a slider and an editable readout beside its toggle", () => {
    const host = render();
    for (const spec of MAP_OSM_SUBLAYERS) {
      const r = row(host, spec.label);
      expect(r.querySelector("input[type='checkbox']"), spec.label).not.toBeNull();
      expect(slider(r), spec.label).not.toBeNull();
      expect(readout(r), spec.label).not.toBeNull();
    }
  });

  it("uses the rail's own density track — 1 to 4 in 0.1 steps — not a new control shape", () => {
    const r = row(render(), "Roads");
    expect(slider(r).min).toBe("1");
    expect(slider(r).max).toBe("4");
    expect(slider(r).step).toBe("0.1");
    expect(readout(r).className).toBe("voice-slider-readout");
  });

  it("shows each row's own value", () => {
    const host = render({
      sublayers: MAP_OSM_SUBLAYERS.map((s) => ({ ...s, on: true, density: s.id === "omt-roads" ? 3 : 1.5 })),
    });
    expect(readout(row(host, "Roads")).value).toBe("3.0x");
    expect(readout(row(host, "Water")).value).toBe("1.5x");
  });

  it("routes a row's drag back with THAT row's id and nothing else", () => {
    const onSublayerDensity = vi.fn();
    const host = render({ onSublayerDensity });
    drag(slider(row(host, "Roads")), "2.7");
    expect(onSublayerDensity).toHaveBeenCalledTimes(1);
    expect(onSublayerDensity).toHaveBeenCalledWith("omt-roads", 2.7);
  });

  it("disables a row's density while the row itself is off", () => {
    const host = render({
      sublayers: MAP_OSM_SUBLAYERS.map((s) => ({ ...s, on: s.id === "omt-roads", density: 1 })),
    });
    const on = row(host, "Roads");
    // A `fill` row, so its density is genuinely wired — the only thing
    // gating it here is that the row is switched off.
    const off = row(host, "Water");
    expect(slider(on).disabled).toBe(false);
    expect(readout(on).disabled).toBe(false);
    expect(slider(off).disabled).toBe(true);
    expect(readout(off).disabled).toBe(true);
    expect(off.className).toContain("maps-osm-row--density-off");
    // Only the DENSITY is gated, never the whole row: the toggle stays live
    // and undimmed, because it is how a reader turns the row back on.
    expect(off.className).not.toContain("maps-layer-slider--off");
    expect(off.querySelector<HTMLInputElement>("input[type='checkbox']")!.disabled).toBe(false);
  });

  it("gates the two row types that read no density at all, even while they are ON", () => {
    // `symbol`/`circle` rows mount positioned hotspots rather than geometry
    // and nothing in `widget.ts` consumes their `density` — the same honest
    // "not wired through for this layer type" state `DensityRow` already has.
    const host = render();
    for (const label of ["Places", "Peaks", "POIs"]) {
      const r = row(host, label);
      expect(r.querySelector<HTMLInputElement>("input[type='checkbox']")!.checked, label).toBe(true);
      expect(slider(r).disabled, label).toBe(true);
      expect(r.getAttribute("title"), label).toMatch(/not wired through/i);
    }
    expect(slider(row(host, "Roads")).disabled).toBe(false);
  });

  it("still routes the toggle itself, unchanged", () => {
    const onSublayer = vi.fn();
    const host = render({ onSublayer });
    act(() => { row(host, "Buildings").querySelector<HTMLInputElement>("input[type='checkbox']")!.click(); });
    expect(onSublayer).toHaveBeenCalledWith("omt-buildings", false);
  });
});

describe("the master row", () => {
  it("survives — the common gesture is still one drag", () => {
    const onDensity = vi.fn();
    const host = render({ onDensity });
    drag(slider(master(host)), "3.1");
    expect(onDensity).toHaveBeenCalledWith(3.1);
  });

  it("reads the shared value while every row agrees", () => {
    const host = render({
      density: 2.5,
      sublayers: MAP_OSM_SUBLAYERS.map((s) => ({ ...s, on: true, density: 2.5 })),
    });
    expect(readout(master(host)).value).toBe("2.5x");
  });

  it("reads 'mixed' once one row differs — it cannot print a number that is wrong for the others", () => {
    const host = render({
      density: null,
      sublayers: MAP_OSM_SUBLAYERS.map((s) => ({ ...s, on: true, density: s.id === "omt-roads" ? 3 : 1 })),
    });
    expect(readout(master(host)).value).toBe("mixed");
  });

  it("a typed number on the mixed master still commits, overwriting every row", () => {
    const onDensity = vi.fn();
    const host = render({
      density: null,
      onDensity,
      sublayers: MAP_OSM_SUBLAYERS.map((s) => ({ ...s, on: true, density: s.id === "omt-roads" ? 3 : 1 })),
    });
    const input = readout(master(host));
    act(() => { input.focus(); input.dispatchEvent(new FocusEvent("focusin", { bubbles: true })); });
    act(() => { setValue(input, "2"); });
    act(() => { input.blur(); input.dispatchEvent(new FocusEvent("focusout", { bubbles: true })); });
    expect(onDensity).toHaveBeenCalledWith(2);
    // And `mapOsmDensityRecord` is what the page turns that into.
    expect(Object.values(mapOsmDensityRecord(2)).every((v) => v === 2)).toBe(true);
  });
});

describe("the card states what the choice costs", () => {
  it("warns, on the stroke rows themselves, that each distinct density is another pass", () => {
    const host = render();
    for (const label of ["Waterways", "Roads", "Boundaries"]) {
      expect(row(host, label).getAttribute("title"), label).toMatch(/distinct/i);
    }
    // A mesh row says the opposite, because it is free.
    expect(row(host, "Buildings").getAttribute("title")).not.toMatch(/distinct/i);
  });

  it("counts the overlay grids the current stroke densities actually ask for, live on the card", () => {
    const withStrokes = (d: Record<string, number>) =>
      MAP_OSM_SUBLAYERS.map((s) => ({ ...s, on: true, density: d[s.id] ?? 1 }));

    // Every stroke at 1x asks for no overlay at all, so there is no row —
    // the card says nothing about a cost that is not being paid.
    expect(strokeGrids(render({ sublayers: withStrokes({}) }))).toBeNull();

    expect(strokeGrids(render({
      sublayers: withStrokes({ "omt-waterways": 2, "omt-roads": 2, "omt-boundaries": 2 }),
    }))).toBe("1 extra pass");

    expect(strokeGrids(render({
      sublayers: withStrokes({ "omt-waterways": 2, "omt-roads": 3, "omt-boundaries": 4 }),
    }))).toBe("3 extra passes");

    // A mesh row's density is never counted — it costs no viewport overlay.
    expect(strokeGrids(render({
      sublayers: withStrokes({ "omt-water": 3, "omt-buildings": 4 }),
    }))).toBeNull();
  });

  it("does not count a stroke row that is switched off — it is not mounted", () => {
    const host = render({
      sublayers: MAP_OSM_SUBLAYERS.map((s) => ({
        ...s,
        on: s.id !== "omt-boundaries",
        density: s.id === "omt-waterways" ? 2 : s.id === "omt-roads" ? 3 : 4,
      })),
    });
    expect(strokeGrids(host)).toBe("2 extra passes");
  });
});
