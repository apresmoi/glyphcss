// @vitest-environment happy-dom
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
  type ExtraLayerInputs,
  type LayersFolderInputs,
  type LiveFeedInputs,
  type LiveLayerInputs,
} from "./mapsKit";
import { MAP_OSM_DEFAULT_ANCHOR, MAP_OSM_SUBLAYERS } from "./mapsOsm";
import { MAP_LIVE_FEEDS, MAP_LIVE_FEED_BY_ID } from "./mapsLive";

/**
 * The Live card's TIME WINDOW control.
 *
 * It is the same small per-row enum the OSM card's label-placement toggle
 * already is — `IconToggle` in a `.gx-toggle` group inside the row's own
 * widget cell — with text instead of icons, because "24h" and "30d" are
 * shorter and clearer than any glyph for them would be.
 *
 * The rule this file exists for: **a row with no real time axis has no
 * control.** GDACS' list is currently-active events (measured on the
 * vendored capture: not one of its 99 events began in the last seven days)
 * and a satellite is a live position, so neither can answer "how far back"
 * — and a control that cannot change anything is worse than no control.
 */

let root: Root | null = null;
let container: HTMLElement | null = null;
const noop = () => {};

function extra(overrides: Partial<ExtraLayerInputs> = {}): ExtraLayerInputs {
  return { visible: true, onVisible: noop, color: "#ffffff", onColor: noop, sliders: [], ...overrides };
}

/** The card's rows as the page builds them — every feed, with its real window list. */
function feedsFromSpecs(): LiveFeedInputs[] {
  return MAP_LIVE_FEEDS.map((spec) => ({
    id: spec.id,
    label: spec.label,
    tooltip: spec.tooltip,
    on: true,
    value: "",
    warn: false,
    note: null,
    windows: spec.windows.map((w) => ({ value: w.id, label: w.label, desc: w.desc })),
    window: spec.defaultWindow,
  }));
}

function inputs(liveOverrides: Partial<LiveLayerInputs> = {}): LayersFolderInputs {
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
    osm: {
      visible: false, onVisible: noop,
      source: "OpenFreeMap · OpenMapTiles · z0–14",
      missing: null,
      sublayers: MAP_OSM_SUBLAYERS.map((s) => ({ ...s, on: false, density: 1, anchor: MAP_OSM_DEFAULT_ANCHOR })),
      onSublayer: noop, onSublayerDensity: noop, onSublayerAnchor: noop,
    },
    // The Datasets card is a sibling on the same rail; this file is about
    // the Live one, so it is supplied inert exactly as `osm` above is.
    datasets: {
      visible: false, onVisible: noop, source: "nothing fetched yet", failed: null,
      rows: [], onRow: noop, onRowDensity: noop, onRowAnchor: noop,
    },
    live: {
      visible: true, onVisible: noop,
      feeds: feedsFromSpecs(),
      onFeed: noop, onWindow: noop,
      ...liveOverrides,
    },
  };
}

function render(liveOverrides: Partial<LiveLayerInputs> = {}): HTMLElement {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => { root!.render(<LayersPanel {...inputs(liveOverrides)} />); });
  return container;
}

afterEach(() => {
  if (root) act(() => { root!.unmount(); });
  container?.remove();
  root = null;
  container = null;
});

function liveCard(host: HTMLElement): HTMLElement {
  const card = [...host.querySelectorAll<HTMLElement>(".maps-layer-card")]
    .find((el) => el.querySelector(".maps-layer-check span")?.textContent === "Live");
  expect(card).toBeDefined();
  return card!;
}

/** Every row's window toggle, keyed by the row's own label. `null` where the row has none. */
function togglesByRow(card: HTMLElement): Record<string, string[] | null> {
  return Object.fromEntries([...card.querySelectorAll<HTMLElement>(".maps-live-row")].map((row) => {
    const name = row.querySelector("span")?.textContent ?? "";
    const group = row.querySelector(".maps-live-window .gx-toggle");
    return [name, group ? [...group.querySelectorAll("button")].map((b) => b.textContent ?? "") : null];
  }));
}

describe("LayersPanel — the Live card's time window", () => {
  it("gives a control only to the rows whose time axis is real", () => {
    expect(togglesByRow(liveCard(render()))).toEqual({
      Earthquakes: ["1h", "24h", "7d", "30d"],
      Disasters: null,
      "Launch sites": ["24h", "7d", "30d", "all"],
      Satellites: null,
    });
  });

  it("marks the row's current window as the active one", () => {
    const card = liveCard(render());
    const active = [...card.querySelectorAll<HTMLElement>(".maps-live-row")].map((row) => {
      const on = row.querySelector(".maps-live-window .gx-toggle-btn.is-active");
      return on?.textContent ?? null;
    });
    // The two defaults: the last seven days, and the whole upcoming manifest.
    expect(active).toEqual(["7d", null, "all", null]);
  });

  it("routes a window click back to the page with that row's own id", () => {
    const seen: [string, string][] = [];
    const card = liveCard(render({ onWindow: (id, window) => { seen.push([id, window]); } }));
    const quakes = [...card.querySelectorAll<HTMLElement>(".maps-live-row")][0]!;
    const buttons = [...quakes.querySelectorAll<HTMLButtonElement>(".maps-live-window button")];
    act(() => { buttons[0]!.click(); });
    act(() => { buttons[3]!.click(); });
    expect(seen).toEqual([["quakes", "hour"], ["quakes", "month"]]);
  });

  /**
   * The magnitude floor is chosen PER WINDOW so the payload stays sane, and
   * that makes the control one axis with a hidden second one — so every
   * button has to say what it carries, or the control misleads.
   */
  it("says on each button what that window costs and what floor it carries", () => {
    const card = liveCard(render());
    const quakes = [...card.querySelectorAll<HTMLElement>(".maps-live-row")][0]!;
    const titles = [...quakes.querySelectorAll<HTMLButtonElement>(".maps-live-window button")]
      .map((b) => b.getAttribute("title") ?? "");
    expect(titles.length).toBe(4);
    for (const title of titles) expect(title.length).toBeGreaterThan(40);
    expect(titles[2]).toContain("2.5");
    expect(titles[3]).toContain("4.5");
    // The row's own tooltip stops claiming a fixed window, since it no longer has one.
    expect(quakes.getAttribute("title") ?? "").not.toContain("past seven days");
  });

  /**
   * A window a row does not offer must not render a dead button — the page
   * can be handed one by a link written against a different build.
   */
  it("renders nothing for a row whose window list is empty", () => {
    const card = liveCard(render({
      feeds: [{
        id: "disasters", label: MAP_LIVE_FEED_BY_ID.disasters.label,
        tooltip: MAP_LIVE_FEED_BY_ID.disasters.tooltip,
        on: true, value: "99 events · 3s", warn: false, note: null,
        windows: [], window: "all",
      }],
    }));
    expect(card.querySelectorAll(".maps-live-window").length).toBe(0);
    expect(card.querySelectorAll(".maps-live-row").length).toBe(1);
  });

  /**
   * The row is a `<label>` whose control is the toggle beside this, so a
   * click that reaches the label runs its activation behaviour on that
   * checkbox — the same guard `OsmSublayerRow`'s anchor group carries, and
   * for the same reason: the DOM these rows are tested against does not
   * implement the spec's interactive-descendant exemption.
   */
  it("does not flip the row's own switch when a window button is clicked", () => {
    const seen: [string, boolean][] = [];
    const card = liveCard(render({ onFeed: (id, on) => { seen.push([id, on]); } }));
    const quakes = [...card.querySelectorAll<HTMLElement>(".maps-live-row")][0]!;
    act(() => { quakes.querySelector<HTMLButtonElement>(".maps-live-window button")!.click(); });
    expect(seen).toEqual([]);
  });
});
