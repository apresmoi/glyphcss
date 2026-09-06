// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

// React 19 requires this flag for `act()`-based tests (createRoot + act, no
// React Testing Library here) — mirrors `MapsProjectionControls.test.tsx`.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// `mapsKit` -> `Dock/primitives` -> `useRenderingFolder.ts` calls
// `ensureCalibratedPalette()` at IMPORT TIME, a real-browser-only canvas
// measurement happy-dom cannot do. Stub just that one measurement, exactly as
// `MapsProjectionControls.test.tsx` does for the same import chain.
vi.mock("@glyphcss/effects", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@glyphcss/effects")>();
  return { ...actual, calibrateGlyphRamp: () => ({ ramp: " .:-=+*#%@", steps: [] }) };
});

import {
  GLYPH_PALETTE_OPTIONS,
  LayersPanel,
  MAP_SCENE_GLYPH_PALETTE,
  type ExtraLayerInputs,
  type LayersFolderInputs,
  type MapLayerGlyphPalette,
} from "./mapsKit";

/**
 * The glyph palette (the CHARACTER ramp) moved out of the Dock's scene-wide
 * Rendering folder onto the individual layer cards, where the Terrain card
 * ALREADY carries a colour ramp. Two things have to hold and neither is
 * visible from the `@glyphcss/maps` side:
 *
 * 1. The two ramps are distinguishable. They are labelled `colors` and
 *    `glyphs`, never both "palette", and each row's title names the other.
 * 2. Only the MESH-BACKED cards carry the glyph row. `line`/`contour` are
 *    stamped post-raster (glyphcss documents `glyphPalette` as a no-op
 *    there) and `symbol`/`circle` mount DOM hotspots, so a control on those
 *    cards would be wired to nothing.
 *
 * Both are assertions about the RAIL, so they belong here rather than in
 * `packages/maps`.
 */

let root: Root | null = null;
let container: HTMLElement | null = null;

const noop = () => {};

function extra(overrides: Partial<ExtraLayerInputs> = {}): ExtraLayerInputs {
  return { visible: true, onVisible: noop, color: "#ffffff", sliders: [], ...overrides };
}

/** Every card expanded, so a missing row means "not rendered", never "collapsed". */
function inputs(): LayersFolderInputs {
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
      renderMode: "solid", onRenderMode: noop,
    },
    borders: { visible: true, onVisible: noop, color: "#e8c988", simplify: null, density: 1, onDensity: noop },
    contour: {
      visible: true, onVisible: noop, color: "#7fe8c9", onColor: noop,
      interval: 500, onInterval: noop,
      minElevation: null, onMinElevation: noop,
      maxElevation: null, onMaxElevation: noop,
      fieldRange: null,
      lineCount: null, density: 1, onDensity: noop,
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

/** Every card's own `<select>` rows, keyed by the card's checkbox label. */
function cardSelectLabels(host: HTMLElement): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const card of Array.from(host.querySelectorAll(".maps-layer-card"))) {
    const name = card.querySelector(".maps-layer-check span")?.textContent ?? "?";
    out.set(name, Array.from(card.querySelectorAll(".maps-layer-select-row")).map(
      (row) => row.querySelector("span")?.textContent ?? "",
    ));
  }
  return out;
}

function mount(): HTMLElement {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => { root!.render(<LayersPanel {...inputs()} />); });
  return container;
}

afterEach(() => {
  act(() => { root?.unmount(); });
  container?.remove();
  root = null;
  container = null;
  vi.restoreAllMocks();
});

describe("/maps layer cards — the colour ramp and the glyph ramp are two labelled rows", () => {
  it("the Terrain card carries both, named `colors` and `glyphs`, neither called `palette`", () => {
    const host = mount();
    const terrain = Array.from(host.querySelectorAll(".maps-layer-card")).find(
      (c) => c.querySelector(".maps-layer-check span")?.textContent === "Terrain",
    )!;
    const rows = Array.from(terrain.querySelectorAll(".maps-layer-select-row"));
    const labels = rows.map((row) => row.querySelector("span")?.textContent ?? "");

    expect(labels).toContain("colors");
    expect(labels).toContain("glyphs");
    expect(labels).not.toContain("palette");

    // Each row's tooltip points at the other, so a reader who lands on one
    // cannot mistake it for the other.
    const titleOf = (label: string) => rows.find((r) => r.querySelector("span")?.textContent === label)!.getAttribute("title") ?? "";
    expect(titleOf("colors")).toMatch(/glyphs/);
    expect(titleOf("glyphs")).toMatch(/colors/);
  });

  it("the glyph row offers the same ramps the retired Dock row did, defaulting to the scene's own", () => {
    const host = mount();
    const glyphRow = Array.from(host.querySelectorAll(".maps-layer-select-row")).find(
      (row) => row.querySelector("span")?.textContent === "glyphs",
    )!;
    const select = glyphRow.querySelector("select") as HTMLSelectElement;

    expect(Array.from(select.options).map((o) => o.value)).toEqual(Object.values(GLYPH_PALETTE_OPTIONS));
    expect(select.value).toBe(MAP_SCENE_GLYPH_PALETTE);
  });

  it("only the MESH-BACKED cards carry it — never a stroke or hotspot layer", () => {
    const byCard = cardSelectLabels(mount());
    const withGlyphs = [...byCard].filter(([, labels]) => labels.includes("glyphs")).map(([name]) => name);

    expect(withGlyphs.sort()).toEqual(["Fill", "Fill extrusion", "Heatmap", "Model", "Terrain"]);
    for (const name of ["Borders", "Contour", "Symbol", "Circle"]) {
      expect(byCard.get(name), name).not.toContain("glyphs");
    }
  });

  it("changing the glyph row reports the picked ramp", () => {
    const picked: MapLayerGlyphPalette[] = [];
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    const value = { ...inputs() };
    value.terrain = { ...value.terrain, onGlyphPalette: (v) => picked.push(v) };
    act(() => { root!.render(<LayersPanel {...value} />); });

    const select = Array.from(container.querySelectorAll(".maps-layer-select-row"))
      .find((row) => row.querySelector("span")?.textContent === "glyphs")!
      .querySelector("select") as HTMLSelectElement;
    act(() => {
      select.value = "blocks";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });

    expect(picked).toEqual(["blocks"]);
  });
});
