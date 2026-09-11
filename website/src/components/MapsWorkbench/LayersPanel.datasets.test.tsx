// @vitest-environment happy-dom
/**
 * The Datasets card as the reader meets it.
 *
 * It is built on the SAME row component the OpenStreetMap card uses
 * (`mapsKit.tsx`'s `MapLayerRow`), so what is asserted here is not the markup
 * a second time — it is the three things that are this card's own:
 *
 *  1. **Which rows get which control**, derived from each row's own layer
 *     TYPE rather than from a list of ids. `fill` and `line` carry a density;
 *     `circle` and `symbol` carry none, because nothing in the renderer reads
 *     one for them; only `symbol` carries a label placement. A card that got
 *     this from an id list would be wrong the first time a row's type changed.
 *  2. **Every row explains itself**, including WHEN it draws. A row that
 *     draws nothing at the reader's current span reads as broken, and the
 *     tooltip is the only thing that can say otherwise.
 *  3. **The licence is visible in the vocabulary the reader can reach.** The
 *     cables are CC BY-NC-SA 3.0 — non-commercial and share-alike — so that
 *     fact belongs in the row's own tooltip as well as in the credit line.
 */
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
  type DatasetsLayerInputs,
  type ExtraLayerInputs,
  type LayersFolderInputs,
} from "./mapsKit";
import { MAP_OSM_DEFAULT_ANCHOR, MAP_OSM_SUBLAYERS } from "./mapsOsm";
import { MAP_DATASET_DEFAULT_ANCHOR, MAP_DATASET_ROWS, mapDatasetRowTooltip } from "./mapsDatasets";

let root: Root | null = null;
let container: HTMLElement | null = null;
const noop = () => {};

function extra(overrides: Partial<ExtraLayerInputs> = {}): ExtraLayerInputs {
  return { visible: true, onVisible: noop, color: "#ffffff", onColor: noop, sliders: [], ...overrides };
}

function datasets(overrides: Partial<DatasetsLayerInputs> = {}): DatasetsLayerInputs {
  return {
    visible: true, onVisible: noop,
    source: "nothing fetched yet",
    failed: null,
    rows: MAP_DATASET_ROWS.map((r) => ({
      id: r.id, label: r.label, type: r.type,
      on: r.id === "ds-cables", density: 1, anchor: MAP_DATASET_DEFAULT_ANCHOR,
    })),
    onRow: noop, onRowDensity: noop, onRowAnchor: noop,
    ...overrides,
  };
}

function inputs(overrides: Partial<DatasetsLayerInputs> = {}): LayersFolderInputs {
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
    borders: { visible: true, onVisible: noop, color: "#8899aa", onColor: noop, simplify: null, density: 1, onDensity: noop },
    contour: {
      visible: false, onVisible: noop, color: "#aa8866", onColor: noop,
      interval: 1000, onInterval: noop,
      minElevation: null, onMinElevation: noop, maxElevation: null, onMaxElevation: noop,
      fieldRange: null, lineCount: null, labels: false, onLabels: noop,
      density: 1, onDensity: noop,
    },
    fill: glyphOnly, symbol: extra(), circle: extra(), heatmap: glyphOnly,
    fillExtrusion: withMode, model: withMode,
    osm: {
      visible: false, onVisible: noop,
      source: "OpenFreeMap · OpenMapTiles · z0–14", missing: null,
      sublayers: MAP_OSM_SUBLAYERS.map((s) => ({ ...s, on: false, density: 1, anchor: MAP_OSM_DEFAULT_ANCHOR })),
      onSublayer: noop, onSublayerDensity: noop, onSublayerAnchor: noop,
    },
    datasets: datasets(overrides),
    // The Live card is a sibling on the same rail; this file is about the
    // Datasets one, so it is supplied inert exactly as `osm` above is.
    live: { visible: false, onVisible: noop, feeds: [], onFeed: noop, onWindow: noop },
  };
}

function mount(overrides: Partial<DatasetsLayerInputs> = {}): HTMLElement {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => { root!.render(<LayersPanel {...inputs(overrides)} />); });
  return container;
}

/** The Datasets card's own element, found by its head label rather than by position. */
function card(host: HTMLElement): HTMLElement {
  const found = Array.from(host.querySelectorAll<HTMLElement>(".maps-layer-card")).find(
    (el) => el.querySelector(".maps-layer-head")?.textContent?.includes("Datasets"),
  );
  expect(found).toBeDefined();
  return found!;
}

const rowFor = (host: HTMLElement, label: string): HTMLElement => {
  const found = Array.from(card(host).querySelectorAll<HTMLElement>(".maps-osm-row")).find(
    (el) => el.querySelector("span")?.textContent === label,
  );
  expect(found).toBeDefined();
  return found!;
};

/**
 * React tracks a controlled input's last value on the NODE, so assigning
 * `.value` directly leaves the tracker in step and the dispatched event is
 * discarded as a no-op. Going through the PROTOTYPE setter is what makes
 * React treat it as a real change — the same technique
 * `LayersPanel.osmDensity.test.ts` uses on its own rows.
 */
function setValue(input: HTMLInputElement, to: string): void {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, to);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

function setChecked(input: HTMLInputElement, to: boolean): void {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "checked")!.set!.call(input, to);
  input.dispatchEvent(new Event("click", { bubbles: true }));
}

afterEach(() => {
  act(() => { root?.unmount(); });
  root = null;
  container?.remove();
  container = null;
  vi.restoreAllMocks();
});

describe("the card's rows", () => {
  it("renders one row per dataset, in the card's own order", () => {
    const host = mount();
    const labels = Array.from(card(host).querySelectorAll<HTMLElement>(".maps-osm-row"))
      .map((el) => el.querySelector("span")?.textContent);
    expect(labels).toEqual(["Land regions", "Marine areas", "Submarine cables", "Datacenters", "Dams"]);
  });

  it("gives a density control to the fill and line rows and to no other", () => {
    const host = mount();
    const withSlider = Array.from(card(host).querySelectorAll<HTMLElement>(".maps-osm-row"))
      .filter((el) => el.querySelector('input[type="range"]') !== null)
      .map((el) => el.querySelector("span")?.textContent);
    // Derived from each row's TYPE (`fill`, `fill`, `line`), never an id list.
    expect(withSlider).toEqual(["Land regions", "Marine areas", "Submarine cables"]);
  });

  it("gives NO density control to the circle and symbol rows — not a disabled one", () => {
    const host = mount();
    // A greyed slider is a control the reader has to work out is dead, and it
    // spends the row's width saying nothing. Nothing in the renderer reads a
    // density for a hotspot-backed layer, so there is no number to show.
    expect(rowFor(host, "Datacenters").querySelector('input[type="range"]')).toBeNull();
    expect(rowFor(host, "Dams").querySelector('input[type="range"]')).toBeNull();
    // The row keeps its toggle, which is how the reader turns it back on.
    expect(rowFor(host, "Datacenters").querySelector('input[type="checkbox"]')).not.toBeNull();
  });

  it("gives a label-placement control to the symbol row alone", () => {
    const host = mount();
    const placed = Array.from(card(host).querySelectorAll<HTMLElement>(".maps-osm-row"))
      .filter((el) => el.querySelector(".maps-osm-anchor") !== null)
      .map((el) => el.querySelector("span")?.textContent);
    // Dams is the card's only `symbol` row. A `circle` draws a dot with no
    // text, so there is nothing to place — which is why the labelled set is
    // its own rule and not the complement of the density one.
    expect(placed).toEqual(["Dams"]);
  });

  it("reports each row's toggle state and writes back the row that was clicked", () => {
    const seen: [string, boolean][] = [];
    const host = mount({ onRow: (id, on) => seen.push([id, on]) });
    expect((rowFor(host, "Submarine cables").querySelector('input[type="checkbox"]') as HTMLInputElement).checked).toBe(true);
    expect((rowFor(host, "Dams").querySelector('input[type="checkbox"]') as HTMLInputElement).checked).toBe(false);

    const box = rowFor(host, "Dams").querySelector('input[type="checkbox"]') as HTMLInputElement;
    act(() => { setChecked(box, true); });
    expect(seen).toEqual([["ds-dams", true]]);
  });

  it("writes a density to THAT row and to no other", () => {
    const seen: [string, number][] = [];
    const host = mount({ onRowDensity: (id, v) => seen.push([id, v]) });
    const slider = rowFor(host, "Marine areas").querySelector('input[type="range"]') as HTMLInputElement;
    act(() => { setValue(slider, "2.4"); });
    expect(seen).toEqual([["ds-marine", 2.4]]);
  });
});

describe("the card's own rows above the list", () => {
  it("shows how much of the card's data the reader has actually fetched", () => {
    const host = mount({ source: "2 of 5 loaded" });
    const values = Array.from(card(host).querySelectorAll(".maps-layer-info-value")).map((n) => n.textContent);
    expect(values).toContain("2 of 5 loaded");
  });

  it("says nothing about failures while there are none", () => {
    const host = mount();
    expect(card(host).querySelector(".maps-layer-info-warn")).toBeNull();
  });

  it("names the rows whose file did not load, and only while that is true", () => {
    // A row can be switched on and draw nothing, which is the exact "did I
    // break it" reading a card has to answer rather than leave to the reader.
    const host = mount({ failed: "Land regions" });
    expect(card(host).querySelector(".maps-layer-info-warn")?.textContent).toBe("Land regions");
  });
});

describe("every row explains what it is and when it appears", () => {
  it.each(MAP_DATASET_ROWS.map((r) => [r.label, r.id] as const))("%s", (label, id) => {
    const host = mount();
    const tooltip = rowFor(host, label).querySelector("span")?.getAttribute("title");
    expect(tooltip).toBe(mapDatasetRowTooltip(id));
    expect(tooltip).toBeTruthy();
  });

  it("states the cables' non-commercial licence where the reader can see it", () => {
    // The credit line carries the obligation; the tooltip is where a reader
    // deciding whether to switch the row on finds out what it is.
    const host = mount();
    const tooltip = rowFor(host, "Submarine cables").querySelector("span")?.getAttribute("title") ?? "";
    expect(tooltip).toContain("CC BY-NC-SA 3.0");
    expect(tooltip.toLowerCase()).toContain("non-commercial");
  });

  it("says which licence each ODbL row carries too", () => {
    const host = mount();
    for (const label of ["Datacenters", "Dams"]) {
      expect(rowFor(host, label).querySelector("span")?.getAttribute("title")).toContain("ODbL");
    }
  });

  it("prices the one row whose density buys an extra pass", () => {
    const host = mount();
    // The `line` row's own title, not the card's: a stroke above 1x takes a
    // full-viewport overlay grid with its own depth pass, and that is the one
    // cost a reader of this card can spend by accident.
    expect(rowFor(host, "Submarine cables").getAttribute("title")).toMatch(/overlay grid/);
    // A `fill` row is free to differ — its own pass either way.
    expect(rowFor(host, "Land regions").getAttribute("title")).toMatch(/free to differ/);
  });
});
