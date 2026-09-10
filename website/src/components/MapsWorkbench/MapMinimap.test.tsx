// @vitest-environment happy-dom
/**
 * The minimap's WIRING — what it builds, when it builds it, and what it
 * actually writes to the second widget as the reader walks.
 *
 * `createGlyphMap` is the seam. That is deliberate and it is not a shortcut:
 * what is under test here is this page's use of the widget (the pose it opens
 * at, the controls it refuses, the writes the update rule does and does not
 * issue, and that the widget is DESTROYED rather than left mounted when the
 * inset goes away), none of which is a question about rasterization. The
 * geometry and the rule itself are pinned against the real package in
 * `mapsMinimap.test.ts`, including the tile level the span lands on.
 *
 * A sibling of `MapCompass.test.tsx` / `MapWalkButton.test.tsx` in every other
 * respect: driven in isolation, because `MapsWorkbench.tsx` cannot be mounted
 * under this vitest config.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// `mapsKit.tsx` (this component reads the page's projection factory and scene
// mode from it) reaches the Dock, which calibrates a glyph ramp against a
// canvas 2D context happy-dom does not have. Same stub, for the same reason,
// as `mapsWalkLink.repro.test.tsx`.
vi.mock("@glyphcss/effects", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@glyphcss/effects")>();
  return { ...actual, calibrateGlyphRamp: () => ({ ramp: " .:-=+*#%@", steps: [] }) };
});

interface FakeMap {
  readonly host: HTMLElement;
  readonly opts: Record<string, unknown>;
  readonly setViewCalls: unknown[];
  readonly setBearingCalls: number[];
  destroyed: boolean;
}
const built: FakeMap[] = [];

vi.mock("@glyphcss/maps", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@glyphcss/maps")>();
  return {
    ...actual,
    createGlyphMap: (host: HTMLElement, opts: Record<string, unknown>) => {
      const map: FakeMap = { host, opts, setViewCalls: [], setBearingCalls: [], destroyed: false };
      built.push(map);
      return {
        host,
        setView: (v: unknown) => { map.setViewCalls.push(v); },
        setBearing: (b: number) => { map.setBearingCalls.push(b); },
        destroy: () => { map.destroyed = true; },
      };
    },
  };
});

import type { GlyphMapVectorProvider } from "@glyphcss/maps";
import { MapMinimap } from "./MapMinimap";
import {
  MAP_MINIMAP_COLS,
  MAP_MINIMAP_MOVE_M,
  MAP_MINIMAP_ROWS,
  MAP_MINIMAP_SPAN_DEG,
  MAP_MINIMAP_TURN_DEG,
} from "./mapsMinimap";

const METRES_PER_DEGREE = (Math.PI / 180) * 6_371_000;
const SOURCE = { id: "osm" } as unknown as GlyphMapVectorProvider;
const LON = 8.5417, LAT = 47.3769;

let root: Root | null = null;
let container: HTMLElement | null = null;

interface Pose { readonly lon?: number; readonly lat?: number; readonly bearing?: number; readonly visible?: boolean; readonly walking?: boolean }

function node(pose: Pose = {}) {
  return (
    <MapMinimap
      visible={pose.visible ?? true}
      walking={pose.walking ?? true}
      source={SOURCE}
      projectionId="globe"
      centerLon={pose.lon ?? LON}
      centerLat={pose.lat ?? LAT}
      bearing={pose.bearing ?? 0}
    />
  );
}

function render(pose: Pose = {}): HTMLElement {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => { root!.render(node(pose)); });
  return container;
}
function rerender(pose: Pose): void {
  act(() => { root!.render(node(pose)); });
}
/** The one widget the inset built. */
function map(): FakeMap {
  expect(built.length).toBe(1);
  return built[0]!;
}

beforeEach(() => { built.length = 0; });
afterEach(() => {
  act(() => { root?.unmount(); });
  root = null;
  container?.remove();
  container = null;
});

describe("MapMinimap — where it lives", () => {
  it("is an overlay ON the map, like the compass, the search box and the pegman", () => {
    const host = render();
    expect(host.querySelector(".maps-minimap")).not.toBeNull();
    expect(host.querySelector(".maps-minimap__host")).not.toBeNull();
  });

  it("names itself, because a character grid cannot be read out", () => {
    const host = render({ walking: true });
    const box = host.querySelector(".maps-minimap")!;
    expect(box.getAttribute("role")).toBe("img");
    expect(box.getAttribute("aria-label")).toMatch(/where you are standing/i);
  });
});

describe("MapMinimap — when it exists at all", () => {
  it("builds NOTHING while hidden — no DOM and, more importantly, no second widget", () => {
    const host = render({ visible: false });
    expect(host.querySelector(".maps-minimap")).toBeNull();
    expect(built.length).toBe(0);
  });

  it("builds one widget when it appears and DESTROYS it when it goes away", () => {
    render({ visible: true });
    expect(built.length).toBe(1);
    expect(map().destroyed).toBe(false);
    rerender({ visible: false });
    expect(map().destroyed).toBe(true);
    expect(container!.querySelector(".maps-minimap")).toBeNull();
  });
});

describe("MapMinimap — what it builds", () => {
  it("opens top-down at its own span and grid, on the pose the map is at", () => {
    render({ lon: LON, lat: LAT, bearing: 137 });
    const opts = map().opts as {
      view: { center: [number, number]; span: number; cols: number; rows: number };
      tilt: number; bearing: number; controls: Record<string, boolean>;
    };
    expect(opts.view.center).toEqual([LON, LAT]);
    expect(opts.view.span).toBeCloseTo(MAP_MINIMAP_SPAN_DEG, 12);
    expect(opts.view.cols).toBe(MAP_MINIMAP_COLS);
    expect(opts.view.rows).toBe(MAP_MINIMAP_ROWS);
    // A plan has no pitch. On a sheet the widget's own default is 40, so this
    // has to be said rather than left out.
    expect(opts.tilt).toBe(0);
    expect(opts.bearing).toBe(137);
  });

  it("is not a map you drive — every control off, so the gestures stay the main map's", () => {
    render();
    const { controls } = map().opts as { controls: Record<string, boolean> };
    expect(controls).toEqual({ drag: false, wheel: false, tilt: false });
  });

  it("mounts the page's ONE OpenStreetMap source, so a shared tile address is a shared request", () => {
    render();
    const { layers } = map().opts as { layers: { type: string; source?: unknown }[] };
    expect(layers.length).toBe(4);
    for (const layer of layers) {
      if (layer.type === "background") continue;
      expect(layer.source).toBe(SOURCE);
    }
  });
});

describe("MapMinimap — following the walker", () => {
  it("re-centres once the walker has actually travelled half a cell", () => {
    render({ lat: LAT });
    // A frame's worth of walking: suppressed.
    rerender({ lat: LAT + (MAP_MINIMAP_MOVE_M * 0.5) / METRES_PER_DEGREE });
    expect(map().setViewCalls).toEqual([]);
    // Past the threshold: one write, at the LIVE position and not at the
    // threshold's own.
    const far = LAT + (MAP_MINIMAP_MOVE_M * 1.5) / METRES_PER_DEGREE;
    rerender({ lat: far });
    expect(map().setViewCalls).toEqual([{ center: [LON, far] }]);
  });

  it("does not re-centre for a look — walking and turning cost separately", () => {
    render({ bearing: 0 });
    rerender({ bearing: 90 });
    expect(map().setViewCalls).toEqual([]);
    expect(map().setBearingCalls).toEqual([90]);
  });

  it("keeps accumulating from the pose it WROTE, so a slow walk is not suppressed forever", () => {
    render({ lat: LAT });
    let lat = LAT;
    const step = (MAP_MINIMAP_MOVE_M * 0.4) / METRES_PER_DEGREE;
    for (let i = 0; i < 10; i++) { lat += step; rerender({ lat }); }
    // Ten frames of 40%-of-threshold travel: the inset re-centres on the
    // third, sixth and ninth. Three writes for ten frames — not zero (which
    // is what comparing against the LIVE pose instead of the written one
    // would give, and would leave the inset stuck forever) and not ten
    // (which is having no rule at all).
    expect(map().setViewCalls.length).toBe(3);
  });
});

describe("MapMinimap — heading-up", () => {
  it("re-orients once the heading has moved a full cell at its own edge, and not before", () => {
    render({ bearing: 10 });
    rerender({ bearing: 10 + MAP_MINIMAP_TURN_DEG * 0.5 });
    expect(map().setBearingCalls).toEqual([]);
    rerender({ bearing: 10 + MAP_MINIMAP_TURN_DEG * 1.5 });
    expect(map().setBearingCalls).toEqual([10 + MAP_MINIMAP_TURN_DEG * 1.5]);
  });

  it("tracks the heading the SHORT way round zero", () => {
    render({ bearing: 359 });
    rerender({ bearing: 0.5 });
    // 1.5 deg the short way, under the threshold — a naive subtraction would
    // read 358.5 and fire.
    expect(map().setBearingCalls).toEqual([]);
    rerender({ bearing: 5 });
    expect(map().setBearingCalls).toEqual([5]);
  });

  it("draws the cone pointing UP and never rotates it — that is what heading-up buys", () => {
    const host = render({ walking: true, bearing: 200 });
    const cone = host.querySelector<SVGElement>(".maps-minimap__cone")!;
    expect(cone).not.toBeNull();
    expect(cone.getAttribute("style") ?? "").not.toMatch(/rotate/);
    const d = host.querySelector("path")!.getAttribute("d")!;
    // Apex at the walker, opening into negative y — up, in SVG's own axes.
    expect(d.startsWith("M 0 0")).toBe(true);
    expect(d).toMatch(/-\d/);
  });

  it("has no cone when nobody is walking — there is no 'forward' to draw", () => {
    const host = render({ walking: false });
    expect(host.querySelector(".maps-minimap__cone")).toBeNull();
    // The reader's position is still marked: that is the question the inset
    // answers whether or not they are on foot.
    expect(host.querySelector(".maps-minimap__here")).not.toBeNull();
  });
});
