// @vitest-environment happy-dom
/**
 * The OpenStreetMap card's per-row LABEL PLACEMENT control.
 *
 * `text-anchor` is a per-LAYER cartographic decision — city names sit beside
 * their point, a lake's name sits on it — and this card mounts one layer per
 * OpenMapTiles row, so the control is per ROW. It lands in the widget column
 * those rows FREED when they lost their density slider: a `symbol` row has no
 * density (nothing in the renderer reads one for a positioned hotspot), so
 * the column held the toggle and nothing else.
 *
 * The contract asserted here:
 *
 *  - Every row whose built layer is a `symbol` renders the control; every
 *    other row renders none, not a disabled one — the same rule, and the same
 *    reason, as the density control's own absence.
 *  - The set is derived from each row's own TYPE, never from a list of ids.
 *    That list belongs to `@glyphcss/maps` and it has moved twice: `Peaks`
 *    became a labelled `symbol` row, and `Protected areas`/`Water labels`
 *    were appended as `symbol` rows later. A hardcoded list was already two
 *    rows out of date once.
 *  - A click routes back with THAT row's id and that row's anchor, and
 *    touches no other row.
 *  - The control is the rail's own segmented `IconToggle` — the same one the
 *    Projection picker and the Sun toggle use — not a new control language.
 *
 * `happy-dom` has no layout engine, so nothing here measures; every assertion
 * is over the rendered element tree, which is the established pattern for
 * this card (`MapsWorkbench.tsx` itself cannot be mounted in this config).
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
import { MAP_DATASET_DEFAULT_ANCHOR, MAP_DATASET_ROWS } from "./mapsDatasets";

let root: Root | null = null;
let container: HTMLElement | null = null;
const noop = () => {};

/**
 * The layer type this card mounts that DRAWS LABELS — stated here as the
 * independent claim, so this file and `mapsKit`'s own constant have to agree
 * rather than one being read off the other.
 */
const LABEL_TYPES = new Set(["symbol"]);
const LABELLED_ROWS = MAP_OSM_SUBLAYERS.filter((s) => LABEL_TYPES.has(s.type));
const UNLABELLED_ROWS = MAP_OSM_SUBLAYERS.filter((s) => !LABEL_TYPES.has(s.type));

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
    // The Datasets card is a sibling of the OSM card on the same rail and
    // `LayersPanel` renders both; these files are about the OSM one, so it
    // is supplied inert. `LayersPanel.datasets.test.tsx` is where it is
    // exercised.
    datasets: {
      visible: false, onVisible: noop, source: "nothing fetched yet", failed: null,
      rows: MAP_DATASET_ROWS.map((r) => ({ ...r, on: false, density: 1, anchor: MAP_DATASET_DEFAULT_ANCHOR })),
      onRow: noop, onRowDensity: noop, onRowAnchor: noop,
    },
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

/** The row's anchor control, or `null` where the row has none. */
const anchorGroup = (el: HTMLElement) => el.querySelector<HTMLElement>(".maps-osm-anchor .gx-toggle");
const anchorButtons = (el: HTMLElement) => Array.from(el.querySelectorAll<HTMLButtonElement>(".maps-osm-anchor .gx-toggle-btn"));
const activeAnchor = (el: HTMLElement) => anchorButtons(el).find((b) => b.classList.contains("is-active")) ?? null;

afterEach(() => {
  act(() => { root?.unmount(); });
  root = null;
  container?.remove();
  container = null;
});

describe("the derived sets", () => {
  it("are both non-empty — otherwise every claim below is vacuous", () => {
    expect(LABELLED_ROWS.length).toBeGreaterThan(0);
    expect(UNLABELLED_ROWS.length).toBeGreaterThan(0);
    expect(LABELLED_ROWS.length + UNLABELLED_ROWS.length).toBe(MAP_OSM_SUBLAYERS.length);
  });

  it("holds every symbol row the mapping declares, including the ones appended after this card was written", () => {
    expect(LABELLED_ROWS.map((s) => s.id)).toEqual(["omt-places", "omt-peaks", "omt-parks", "omt-water-labels"]);
  });
});

describe("every row that draws labels carries its own placement control", () => {
  it("renders the control on each labelled row", () => {
    const host = render();
    for (const spec of LABELLED_ROWS) {
      const r = row(host, spec.label);
      expect(anchorGroup(r), spec.label).not.toBeNull();
      expect(anchorButtons(r).length, spec.label).toBeGreaterThanOrEqual(3);
    }
  });

  it("renders NO control on a row that draws none — not a disabled one", () => {
    const host = render();
    for (const spec of UNLABELLED_ROWS) {
      const r = row(host, spec.label);
      expect(anchorGroup(r), spec.label).toBeNull();
      expect(anchorButtons(r), spec.label).toHaveLength(0);
    }
  });

  it("offers left / centre / right at minimum, in MapLibre's own vocabulary", () => {
    const buttons = anchorButtons(row(render(), "Places"));
    const labels = buttons.map((b) => b.getAttribute("aria-label"));
    for (const wanted of ["center", "left", "right"]) expect(labels).toContain(wanted);
  });

  it("uses the rail's own segmented control, not a new control shape", () => {
    // The same `IconToggle` markup the Projection picker and the Sun toggle
    // portal into the Dock.
    const group = anchorGroup(row(render(), "Places"))!;
    expect(group.getAttribute("role")).toBe("group");
    for (const button of anchorButtons(row(render(), "Places"))) {
      expect(button.className).toContain("gx-toggle-btn");
      expect(button.getAttribute("type")).toBe("button");
    }
  });

  it("mounts exactly one control per labelled row across the whole card", () => {
    const body = card(render()).querySelector<HTMLElement>(".maps-layer-body")!;
    const groups = Array.from(body.querySelectorAll(".maps-osm-anchor"));
    expect(groups).toHaveLength(LABELLED_ROWS.length);
    for (const el of groups) expect(el.closest(".maps-osm-row")).not.toBeNull();
  });
});

describe("the control shows and writes THAT row's own answer", () => {
  it("marks each row's current anchor active, independently of its neighbours", () => {
    const host = render({
      sublayers: MAP_OSM_SUBLAYERS.map((s) => ({
        ...s, on: true, density: 1,
        anchor: s.id === "omt-places" ? "left" : s.id === "omt-water-labels" ? "bottom" : MAP_OSM_DEFAULT_ANCHOR,
      })),
    });
    expect(activeAnchor(row(host, "Places"))!.getAttribute("aria-label")).toBe("left");
    expect(activeAnchor(row(host, "Water labels"))!.getAttribute("aria-label")).toBe("bottom");
    expect(activeAnchor(row(host, "Peaks"))!.getAttribute("aria-label")).toBe(MAP_OSM_DEFAULT_ANCHOR);
  });

  it("routes a click back with that row's id and nothing else", () => {
    const onSublayerAnchor = vi.fn();
    const host = render({ onSublayerAnchor });
    const button = anchorButtons(row(host, "Places")).find((b) => b.getAttribute("aria-label") === "left")!;
    act(() => { button.click(); });
    expect(onSublayerAnchor).toHaveBeenCalledTimes(1);
    expect(onSublayerAnchor).toHaveBeenCalledWith("omt-places", "left");
  });

  it("keeps the rows independent — one row's control never writes another's", () => {
    const onSublayerAnchor = vi.fn();
    const host = render({ onSublayerAnchor });
    for (const spec of LABELLED_ROWS) {
      onSublayerAnchor.mockClear();
      const button = anchorButtons(row(host, spec.label)).find((b) => b.getAttribute("aria-label") === "bottom")!;
      act(() => { button.click(); });
      expect(onSublayerAnchor, spec.label).toHaveBeenCalledTimes(1);
      expect(onSublayerAnchor, spec.label).toHaveBeenCalledWith(spec.id, "bottom");
    }
  });
});

describe("the control lands in the column the density slider freed", () => {
  it("sits inside the row's own widget cell, beside the toggle", () => {
    // The three-column grid is name / widget / value. A labelled row's
    // checkbox and its anchor control share the widget cell exactly as a
    // wired row's checkbox and slider do — this is the column those rows
    // emptied when they lost their density slider, not a fourth column and
    // not a second line.
    const r = row(render(), "Places");
    const widget = r.querySelector<HTMLElement>(".maps-osm-row-widget")!;
    expect(widget.querySelector("input[type='checkbox']")).not.toBeNull();
    expect(widget.querySelector(".maps-osm-anchor")).not.toBeNull();
    // And the density control it replaced is still absent.
    expect(r.querySelector("input[type='range']")).toBeNull();
    expect(r.querySelector("input[type='text']")).toBeNull();
  });

  it("still routes the toggle itself, unchanged", () => {
    const onSublayer = vi.fn();
    const host = render({ onSublayer });
    act(() => { row(host, "Places").querySelector<HTMLInputElement>("input[type='checkbox']")!.click(); });
    expect(onSublayer).toHaveBeenCalledWith("omt-places", false);
  });
});
