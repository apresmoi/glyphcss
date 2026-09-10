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
import { MAP_LIVE_FEEDS } from "./mapsLive";

/**
 * The LIVE card.
 *
 * Four rows, every one of them a public feed and every one of them OFF until
 * a reader asks — a live layer spends somebody else's bandwidth and the
 * reader's own rate-limit budget, so it cannot be opt-out. What is asserted
 * here is the card's contract with the reader: a row says what it is and when
 * it has something to show (the OSM card's tooltip idiom), it says what it is
 * currently showing, and when a refresh fails it says so WITHOUT dropping the
 * count it is still legitimately displaying.
 */

let root: Root | null = null;
let container: HTMLElement | null = null;
const noop = () => {};

function extra(overrides: Partial<ExtraLayerInputs> = {}): ExtraLayerInputs {
  return { visible: true, onVisible: noop, color: "#ffffff", onColor: noop, sliders: [], ...overrides };
}

function feed(overrides: Partial<LiveFeedInputs> = {}): LiveFeedInputs {
  return {
    id: "quakes", label: "Earthquakes", tooltip: "Every magnitude 2.5+ earthquake worldwide in the past seven days.",
    on: false, value: "", warn: false, note: null,
    // No time window by default here: this file's subject is the row itself,
    // and `LayersPanel.liveWindows.test.tsx` owns the control.
    windows: [], window: "all",
    ...overrides,
  };
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
    live: {
      visible: true, onVisible: noop,
      feeds: MAP_LIVE_FEEDS.map((spec) => feed({ id: spec.id, label: spec.label, tooltip: spec.tooltip })),
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

/** The Live card's own element — found by its head label, not by position. */
function liveCard(host: HTMLElement): HTMLElement {
  const card = [...host.querySelectorAll<HTMLElement>(".maps-layer-card")]
    .find((el) => el.querySelector(".maps-layer-check span")?.textContent === "Live");
  expect(card).toBeDefined();
  return card!;
}

describe("LayersPanel — the Live card", () => {
  it("carries one row per feed, in the order the feeds declare", () => {
    const card = liveCard(render());
    const rows = [...card.querySelectorAll<HTMLElement>(".maps-live-row")];
    expect(rows.map((r) => r.querySelector("span")?.textContent))
      .toEqual(MAP_LIVE_FEEDS.map((f) => f.label));
    expect(rows.length).toBe(4);
  });

  it("says where the data comes from, without naming a coverage it does not have", () => {
    const card = liveCard(render());
    const info = [...card.querySelectorAll<HTMLElement>(".maps-layer-info-row")];
    expect(info[0]!.textContent).toContain("public feeds, no key");
  });

  /**
   * The OSM card's idiom: every row's `title` says what the row IS and when
   * it has something to show, because "I turned it on and nothing appeared"
   * is the reading a sparse layer invites.
   */
  it("gives every row a tooltip that says what it is and when it has something", () => {
    const card = liveCard(render());
    for (const row of card.querySelectorAll<HTMLElement>(".maps-live-row")) {
      const title = row.getAttribute("title") ?? "";
      expect(title.length).toBeGreaterThan(60);
    }
  });

  it("starts every row off", () => {
    const card = liveCard(render());
    const boxes = [...card.querySelectorAll<HTMLInputElement>('.maps-live-row input[type="checkbox"]')];
    expect(boxes.length).toBe(4);
    expect(boxes.every((b) => !b.checked)).toBe(true);
  });

  it("routes a row toggle back to the page with that row's own id", () => {
    const seen: [string, boolean][] = [];
    const card = liveCard(render({ onFeed: (id, on) => { seen.push([id, on]); } }));
    const boxes = [...card.querySelectorAll<HTMLInputElement>('.maps-live-row input[type="checkbox"]')];
    act(() => { boxes[2]!.click(); });
    expect(seen).toEqual([[MAP_LIVE_FEEDS[2]!.id, true]]);
  });

  it("prints what a live row is currently showing", () => {
    const card = liveCard(render({
      feeds: [feed({ on: true, value: "385 quakes · 12s" })],
    }));
    const value = card.querySelector(".maps-live-row .maps-layer-info-value");
    expect(value?.textContent).toBe("385 quakes · 12s");
    expect(value?.classList.contains("maps-layer-info-warn")).toBe(false);
    // Nothing is wrong, so there is no second line at all.
    expect(card.querySelectorAll(".maps-layer-info-row").length).toBe(1);
  });

  /**
   * The distinction the whole failure design turns on: a row whose refresh
   * failed is STILL SHOWING its previous frame, so the count stays in the
   * value column and the failure is a second line under it. A card that
   * replaced the count with an error would be claiming the map had gone
   * blank when it had not.
   */
  it("keeps the count and adds a reason line when a refresh fails", () => {
    const card = liveCard(render({
      feeds: [feed({ on: true, value: "385 quakes · 5m", warn: true, note: "last refresh failed: rate limited — try again later" })],
    }));
    const value = card.querySelector(".maps-live-row .maps-layer-info-value");
    expect(value?.textContent).toBe("385 quakes · 5m");
    expect(value?.classList.contains("maps-layer-info-warn")).toBe(true);
    const note = [...card.querySelectorAll(".maps-layer-info-row")].at(-1);
    expect(note?.textContent).toContain("rate limited");
  });

  it("shows nothing at all when the card is closed", () => {
    const card = liveCard(render({ visible: false }));
    expect(card.querySelectorAll(".maps-live-row").length).toBe(0);
  });
});
