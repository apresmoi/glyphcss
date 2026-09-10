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
 * Per-row is now the WHOLE feature. The contract asserted here:
 *
 *  - The card has NO master density row. Per-row control replaced it, and a
 *    second control standing for every row at once is redundant beside it.
 *  - A row's own control writes that row and nothing else.
 *  - A row the renderer reads no density for — `symbol`/`circle`, which
 *    mount positioned DOM hotspots rather than geometry — carries NO density
 *    control at all: no slider, no readout, not a disabled one. It keeps its
 *    toggle and its label, and the card body's three-column grid keeps the
 *    checkbox in the same column it sits in on every other row.
 *  - A row that IS wired but is switched off keeps the control, disabled and
 *    dimmed (`.maps-osm-row--density-off`, `DensityRow`'s own gated
 *    treatment scoped to the density half, since the toggle beside it is
 *    live).
 *  - The `stroke grids` cost readout survives, and matters more now that
 *    nothing can flatten every row in one drag.
 *
 * The densityless SET is derived from each row's own layer type rather than
 * listed, because the row list is `@glyphcss/maps`' and it moves: `Peaks`
 * became a labelled `symbol` row and `Protected areas`/`Water labels` were
 * appended as `symbol` rows after this card was first written. A hardcoded
 * list of labels would have gone stale silently.
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
import { MAP_OSM_DEFAULT_ANCHOR, MAP_OSM_SUBLAYERS } from "./mapsOsm";

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
    sublayers: MAP_OSM_SUBLAYERS.map((s) => ({ ...s, on: true, density: 1, anchor: MAP_OSM_DEFAULT_ANCHOR })),
    onSublayer: noop,
    onSublayerDensity: noop,
    onSublayerAnchor: noop,
    ...overrides,
  };
}

/**
 * The layer types this card mounts that the renderer reads no `density` for
 * — stated here as the independent claim, so this file and `mapsKit`'s own
 * constant have to agree rather than one being read off the other.
 */
const DENSITYLESS_TYPES = new Set(["symbol", "circle"]);
/** The rows that lose the control, and the rows that keep it — derived, never listed. */
const DENSITYLESS_ROWS = MAP_OSM_SUBLAYERS.filter((s) => DENSITYLESS_TYPES.has(s.type));
const WIRED_ROWS = MAP_OSM_SUBLAYERS.filter((s) => !DENSITYLESS_TYPES.has(s.type));


/** The Live card's inputs, in their default (card off, every row off) state — this file is about other cards. */
function live(overrides: Partial<LiveLayerInputs> = {}): LiveLayerInputs {
  return { visible: false, onVisible: () => {}, feeds: [], onFeed: () => {}, ...overrides };
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
    live: live(),
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
/** Every density widget inside `el` — the RENDERED control set, which is what "gone" has to be asserted against. */
const sliders = (el: HTMLElement) => Array.from(el.querySelectorAll<HTMLInputElement>("input[type='range']"));
const readouts = (el: HTMLElement) => Array.from(el.querySelectorAll<HTMLInputElement>("input[type='text']"));

/** The card's live overlay-grid count, or `null` while it costs nothing and says nothing. */
function strokeGrids(host: HTMLElement): string | null {
  const found = Array.from(card(host).querySelectorAll(".maps-layer-info-row")).find(
    (r) => r.querySelector("span")?.textContent === "stroke grids",
  );
  return found?.querySelector(".maps-layer-info-value")?.textContent ?? null;
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
  it("the derived sets are both non-empty — otherwise every claim below is vacuous", () => {
    expect(WIRED_ROWS.length).toBeGreaterThan(0);
    expect(DENSITYLESS_ROWS.length).toBeGreaterThan(0);
    expect(WIRED_ROWS.length + DENSITYLESS_ROWS.length).toBe(MAP_OSM_SUBLAYERS.length);
  });

  it("gives each WIRED row a slider and an editable readout beside its toggle", () => {
    const host = render();
    for (const spec of WIRED_ROWS) {
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
      sublayers: MAP_OSM_SUBLAYERS.map((s) => ({ ...s, on: true, density: s.id === "omt-roads" ? 3 : 1.5, anchor: MAP_OSM_DEFAULT_ANCHOR })),
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

  it("keeps the readout EDITABLE — a typed number commits to that row alone", () => {
    // The master used to be the only control on this card a typed number
    // reached. With it gone, the per-row readout has to carry that gesture.
    const onSublayerDensity = vi.fn();
    const host = render({ onSublayerDensity });
    const input = readout(row(host, "Roads"));
    act(() => { input.focus(); input.dispatchEvent(new FocusEvent("focusin", { bubbles: true })); });
    act(() => { setValue(input, "2.4"); });
    act(() => { input.blur(); input.dispatchEvent(new FocusEvent("focusout", { bubbles: true })); });
    expect(onSublayerDensity).toHaveBeenCalledWith("omt-roads", 2.4);
  });

  it("disables a row's density while the row itself is off", () => {
    const host = render({
      sublayers: MAP_OSM_SUBLAYERS.map((s) => ({ ...s, on: s.id === "omt-roads", density: 1, anchor: MAP_OSM_DEFAULT_ANCHOR })),
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

  it("gives the row types that read no density NO density control at all — not a disabled one", () => {
    // `symbol`/`circle` rows mount positioned hotspots rather than geometry
    // and nothing in `widget.ts` consumes their `density`. A greyed slider
    // is a control the reader has to work out is dead; there is nothing to
    // say, so the row says nothing.
    const host = render();
    for (const spec of DENSITYLESS_ROWS) {
      const r = row(host, spec.label);
      // The row itself is unchanged: label, and the toggle that is its point.
      expect(r.querySelector("span")!.textContent, spec.label).toBe(spec.label);
      expect(r.querySelector<HTMLInputElement>("input[type='checkbox']")!.checked, spec.label).toBe(true);
      expect(sliders(r), spec.label).toHaveLength(0);
      expect(readouts(r), spec.label).toHaveLength(0);
      expect(r.querySelector(".voice-slider-track"), spec.label).toBeNull();
      // Nothing to dim, so the gated treatment is not applied either.
      expect(r.className, spec.label).not.toContain("maps-osm-row--density-off");
      expect(r.getAttribute("title"), spec.label).toMatch(/no density/i);
    }
    // And a wired row is untouched by all of that.
    expect(slider(row(host, "Roads")).disabled).toBe(false);
  });

  it("mounts exactly one density control per wired row across the whole card — nothing else carries one", () => {
    const host = render();
    const body = card(host).querySelector<HTMLElement>(".maps-layer-body")!;
    expect(sliders(body)).toHaveLength(WIRED_ROWS.length);
    expect(readouts(body)).toHaveLength(WIRED_ROWS.length);
    // Every one of them belongs to a row, so none is a card-level control.
    for (const el of sliders(body)) expect(el.closest(".maps-osm-row")).not.toBeNull();
    for (const el of readouts(body)) expect(el.closest(".maps-osm-row")).not.toBeNull();
  });

  it("still routes the toggle itself, unchanged", () => {
    const onSublayer = vi.fn();
    const host = render({ onSublayer });
    act(() => { row(host, "Buildings").querySelector<HTMLInputElement>("input[type='checkbox']")!.click(); });
    expect(onSublayer).toHaveBeenCalledWith("omt-buildings", false);
  });
});

describe("the master row is gone", () => {
  it("leaves no card-level density control beside the per-row ones", () => {
    const body = card(render()).querySelector<HTMLElement>(".maps-layer-body")!;
    // The master was the card's one `.maps-layer-slider` that was NOT a row.
    const cardLevel = Array.from(body.querySelectorAll(".maps-layer-slider")).filter(
      (r) => !r.classList.contains("maps-osm-row"),
    );
    expect(cardLevel).toHaveLength(0);
    // And nothing prints its "mixed" reading anywhere on the card.
    expect(body.textContent).not.toMatch(/mixed/i);
  });

  it("prints no shared reading even when every row genuinely agrees", () => {
    // The state the master used to read a number in. The card offers only
    // the thirteen rows' own controls now.
    const body = card(render({
      sublayers: MAP_OSM_SUBLAYERS.map((s) => ({ ...s, on: true, density: 2.5, anchor: MAP_OSM_DEFAULT_ANCHOR })),
    })).querySelector<HTMLElement>(".maps-layer-body")!;
    expect(sliders(body)).toHaveLength(WIRED_ROWS.length);
    for (const el of sliders(body)) expect(el.closest(".maps-osm-row")).not.toBeNull();
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
      MAP_OSM_SUBLAYERS.map((s) => ({ ...s, on: true, density: d[s.id] ?? 1, anchor: MAP_OSM_DEFAULT_ANCHOR }));

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
        anchor: MAP_OSM_DEFAULT_ANCHOR,
        on: s.id !== "omt-boundaries",
        // Boundaries is the only row holding 4, and it is off. Every stroke
        // row this test is not about sits at 1x, which asks for no overlay
        // at all — so the count below is exactly waterways + roads.
        density: s.id === "omt-waterways" ? 2 : s.id === "omt-roads" ? 3 : s.id === "omt-boundaries" ? 4 : 1,
      })),
    });
    expect(strokeGrids(host)).toBe("2 extra passes");
  });
});
