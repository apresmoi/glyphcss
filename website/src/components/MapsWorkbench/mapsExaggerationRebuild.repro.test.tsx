// @vitest-environment happy-dom
/**
 * Root-causes and pins the fix for two reported `/maps` defects that share
 * one mechanism:
 *
 *  - "when I change the exaggeration in the terrain layer the colour of land
 *    and borders become all green"
 *  - "the map FLICKERS a lot" (and, separately, "if I change the DENSITY it
 *    flickers but doesn't have an error with the colour")
 *
 * `exaggeration` was a member of `MapsWorkbench.tsx`'s widget-CONSTRUCTION
 * effect's dependency array, so every slider notch ran that effect's cleanup
 * (`map.destroy()`, which removes the scene's `<pre>` from the DOM) and built
 * a brand-new `createGlyphMap`. A raster layer's tile cache lives on its
 * layer runtime, which lives on the widget — so a rebuild throws the whole
 * cache away and refetches every visible tile over the network.
 *
 * Measured on the live page (headless Chromium, `/maps` at its default view,
 * dragging the exaggeration slider ten notches over ~1.4s): 66 tile requests,
 * and per notch the rendered ink went
 *   6614 non-space glyphs -> 0 -> ~5500 -> 6614.
 * The `0` is a freshly-built scene rendering itself with no geometry mounted
 * yet (that is the FLICKER); the ~5500 intermediate, drawn from ~10 distinct
 * glyphs instead of ~70, is the coarse z0 floor backstop alone, stretched
 * over the whole viewport while the refetch is in flight — land-coloured, so
 * it reads as GREEN. Neither is specific to exaggeration: any path that
 * discards a mounted raster layer's tile cache shows the same two frames.
 *
 * The fix is that `exaggeration` no longer rebuilds the widget. Relief scale
 * lives on the PROJECTION (`z = (elev / EARTH_RADIUS_M) * exaggeration`,
 * projection.ts), and `GlyphMapHandle.setProjection` already reprojects every
 * mounted mesh against a new projection FROM THE CACHE with no refetch
 * (AGENTS.md, "Projection transitions"). Routing an exaggeration change
 * through it with `durationMs: 0` keeps the widget, the `<pre>` and the tile
 * cache alive, so there is no empty frame, no backstop-only frame and no
 * network round trip.
 *
 * Harness note (identical to `mapsAtlasWiring.repro.test.tsx`'s, for the same
 * reason): `MapsWorkbench.tsx` cannot be mounted in this standalone vitest
 * config — it imports `../GalleryWorkbench/CodePanel`, which imports
 * `@glyphcss/core`, a package `website/package.json` never declares, so Vite's
 * non-Astro resolution cannot find it. This file therefore reproduces the
 * exact effect SHAPE at fault (same dependency arrays, same build/cleanup
 * logic) driving the REAL `createGeoTilesProvider` over the REAL baked ETOPO1
 * pyramid on disk and the REAL `createGlyphMap`. `rebuildOnExaggeration`
 * toggles the harness between the pre-fix shape (`true`) and the shipped one
 * (`false`), so the same harness proves both the defect and the fix.
 *
 * Fixture notes:
 *  - happy-dom has no layout, so `stubMonospaceMetrics` gives the hidden cell
 *    probes a real advance (same stub, same reason, as every `widget.*.test`
 *    in `@glyphcss/maps`).
 *  - Assertions count MOUNTED MESHES per tier and FETCHED TILES, never "is
 *    something rendered": the coarse backstop renders too, which is exactly
 *    what made the defect look like a colour bug rather than a missing tier.
 *  - NO synthetic pointer, wheel or resize event is dispatched anywhere in
 *    this file. Everything asserted has to arrive on its own.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { act, useEffect, useRef, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// `./mapsKit` -> `../SynthWorkbench/synthKit` -> `../Dock` reaches
// `useRenderingFolder.ts`, which calls `ensureCalibratedPalette()` at IMPORT
// time (a real-browser canvas measurement happy-dom cannot do). Same stub,
// same reason, as `mapsAtlasWiring.repro.test.tsx`.
vi.mock("@glyphcss/effects", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@glyphcss/effects")>();
  return { ...actual, calibrateGlyphRamp: () => ({ ramp: " .:-=+*#%@", steps: [] }) };
});

import { createGlyphMap, GlyphMapClassifiers, type GlyphMapHandle, type GlyphMapProvider } from "@glyphcss/maps";
import { buildMapProjection, MAP_PALETTES, MAP_SCENE_RENDER_MODE } from "./mapsKit";
import { MAPS_URL_DEFAULTS } from "./mapsUrlState";
import { createGeoTilesProvider } from "../../lib/geoTilesProvider";

const PUBLIC_DATA_DIR = resolve(process.cwd(), "public/data");

const COLS = 140, ROWS = 63, CELL_W = 8, CELL_H = 16, PROBE_FONT_PX = 16;

function rect(width: number, height: number): DOMRect {
  return { width, height, top: 0, left: 0, right: width, bottom: height, x: 0, y: 0, toJSON: () => ({}) } as DOMRect;
}
const EMPTY_RECT = rect(0, 0);
const stubbedHosts = new Set<HTMLElement>();
function stubMonospaceMetrics(host: HTMLElement): void {
  stubbedHosts.add(host);
  if (vi.isMockFunction(Element.prototype.getBoundingClientRect)) return;
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
    const el = this as HTMLElement;
    if (stubbedHosts.has(el)) return rect(COLS * CELL_W, ROWS * CELL_H);
    if (el.tagName !== "PRE" || !/visibility:\s*hidden/.test(el.style.cssText)) return EMPTY_RECT;
    const fontPx = parseFloat(/font-size:\s*([\d.]+)px/.exec(el.style.cssText)?.[1] ?? String(PROBE_FONT_PX));
    const k = fontPx / PROBE_FONT_PX;
    const lines = (el.textContent ?? "").split("\n").length || 1;
    return rect(CELL_W * k, CELL_H * k * lines);
  });
}

/** Every geo-tile PAYLOAD (`.bin`) the harness's providers actually fetched. */
const tileFetches: string[] = [];
function stubFetchFromDisk(): void {
  tileFetches.length = 0;
  vi.stubGlobal("fetch", vi.fn(async (input: string | URL) => {
    const url = String(input);
    const relative = url.replace(/^\/data\//, "");
    if (relative.endsWith(".bin")) tileFetches.push(relative);
    try {
      const body = readFileSync(`${PUBLIC_DATA_DIR}/${relative}`);
      return new Response(new Uint8Array(body).buffer as ArrayBuffer, {
        status: 200,
        headers: { "content-type": relative.endsWith(".json") ? "application/json" : "application/octet-stream" },
      });
    } catch {
      return new Response(null, { status: 404 });
    }
  }));
}

/** Live mounted meshes, keyed by the raster runtime's own per-tier `detailGroup` name. */
interface MountLog {
  readonly live: Map<object, string>;
  tally(): Record<string, number>;
}
function instrumentScene(map: GlyphMapHandle): MountLog {
  const live = new Map<object, string>();
  const realAdd = map.scene.add.bind(map.scene);
  (map.scene as { add: typeof realAdd }).add = (polygons, transform) => {
    const handle = realAdd(polygons, transform);
    live.set(handle, (transform as { detailGroup?: string } | undefined)?.detailGroup ?? "base");
    const realDispose = handle.dispose.bind(handle);
    (handle as { dispose: () => void }).dispose = () => { live.delete(handle); realDispose(); };
    return handle;
  };
  return {
    live,
    tally(): Record<string, number> {
      const out: Record<string, number> = {};
      for (const g of live.values()) out[g] = (out[g] ?? 0) + 1;
      return out;
    },
  };
}

interface HarnessProps {
  readonly exaggeration: number;
  /** `true` reproduces the pre-fix shape (exaggeration in the construction effect's deps). */
  readonly rebuildOnExaggeration: boolean;
  readonly onMap: (map: GlyphMapHandle) => void;
}

/**
 * `MapsWorkbench.tsx`'s provider-load effect, widget-construction effect and
 * projection effect, reproduced with their real dependency arrays.
 */
function Harness({ exaggeration, rebuildOnExaggeration, onMap }: HarnessProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<GlyphMapHandle | null>(null);
  const [provider, setProvider] = useState<GlyphMapProvider | null>(null);
  const exaggerationRef = useRef(exaggeration);
  exaggerationRef.current = exaggeration;

  useEffect(() => {
    let cancelled = false;
    void createGeoTilesProvider().then((p) => { if (!cancelled) setProvider(p); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const host = hostRef.current;
    if (!host || !provider) return;
    stubMonospaceMetrics(host);
    const map = createGlyphMap(host, {
      view: { center: [MAPS_URL_DEFAULTS.centerLon, MAPS_URL_DEFAULTS.centerLat], span: MAPS_URL_DEFAULTS.span, cols: COLS, rows: ROWS },
      projection: buildMapProjection(MAPS_URL_DEFAULTS.projection, exaggerationRef.current),
      tilt: MAPS_URL_DEFAULTS.tilt,
      layers: [{
        type: "raster", id: "terrain", source: provider,
        classifier: GlyphMapClassifiers.etopo1V1, colors: MAP_PALETTES[MAPS_URL_DEFAULTS.palette], density: 1,
      }],
      scene: { mode: MAP_SCENE_RENDER_MODE, glyphPalette: MAPS_URL_DEFAULTS.glyphPalette, charMode: MAPS_URL_DEFAULTS.charMode, useColors: MAPS_URL_DEFAULTS.useColors },
    });
    mapRef.current = map;
    onMap(map);
    return () => { map.destroy(); mapRef.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, rebuildOnExaggeration ? [provider, exaggeration] : [provider]);

  // The shipped shape's second half: an exaggeration change reprojects the
  // MOUNTED widget instead of rebuilding it. Skipped on the very first render
  // (`mapRef.current` is still null before the construction effect above has
  // run), so mount never double-applies.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || rebuildOnExaggeration) return;
    void map.setProjection(buildMapProjection(MAPS_URL_DEFAULTS.projection, exaggeration), { durationMs: 0 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [exaggeration]);

  return <div ref={hostRef} />;
}

let root: Root | null = null;
let container: HTMLElement | null = null;
afterEach(() => {
  if (root) act(() => { root!.unmount(); });
  container?.remove();
  root = null;
  container = null;
  stubbedHosts.clear();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

interface Run {
  readonly map: GlyphMapHandle;
  readonly log: MountLog;
  /** Every `<pre>` text length observed while the exaggeration change was applied. */
  readonly frameLengths: number[];
  readonly settledBefore: string;
  readonly settledAfter: string;
  readonly outputBefore: HTMLElement;
  readonly outputAfter: HTMLElement;
  readonly tierCountsBefore: Record<string, number>;
  readonly tierCountsAfter: Record<string, number>;
  readonly tileFetchesBefore: number;
  readonly tileFetchesDuring: number;
}

/** Mounts the harness, lets it settle with NO input, changes `exaggeration`, and reports what happened. */
async function run(rebuildOnExaggeration: boolean): Promise<Run> {
  stubFetchFromDisk();
  const maps: GlyphMapHandle[] = [];
  const logs: MountLog[] = [];
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);

  const render = (exaggeration: number): void => {
    root!.render(
      <Harness
        exaggeration={exaggeration}
        rebuildOnExaggeration={rebuildOnExaggeration}
        onMap={(m) => { maps.push(m); logs.push(instrumentScene(m)); }}
      />,
    );
  };

  act(() => { render(MAPS_URL_DEFAULTS.exaggeration); });
  await act(async () => { await new Promise((r) => setTimeout(r, 2500)); });

  const mapBefore = maps[maps.length - 1]!;
  const outputBefore = mapBefore.scene.output;
  const settledBefore = outputBefore.textContent ?? "";
  const tierCountsBefore = logs[logs.length - 1]!.tally();
  const tileFetchesBefore = tileFetches.length;

  // Sample every `<pre>` write that happens while the change is applied — an
  // empty or backstop-only intermediate is exactly the reported flicker.
  const frameLengths: number[] = [];
  const observer = new MutationObserver(() => {
    for (const pre of container!.querySelectorAll("pre.glyph-output")) {
      frameLengths.push([...(pre.textContent ?? "")].filter((c) => c !== " " && c !== "\n").length);
    }
  });
  observer.observe(container!, { childList: true, subtree: true, characterData: true });

  act(() => { render(MAPS_URL_DEFAULTS.exaggeration + 12); });
  await act(async () => { await new Promise((r) => setTimeout(r, 2500)); });
  observer.disconnect();

  const mapAfter = maps[maps.length - 1]!;
  return {
    map: mapAfter,
    log: logs[logs.length - 1]!,
    frameLengths,
    settledBefore,
    settledAfter: mapAfter.scene.output.textContent ?? "",
    outputBefore,
    outputAfter: mapAfter.scene.output,
    tierCountsBefore,
    tierCountsAfter: logs[logs.length - 1]!.tally(),
    tileFetchesBefore,
    tileFetchesDuring: tileFetches.length - tileFetchesBefore,
  };
}

const FINE = "glyph-map-raster:terrain:fine";

describe("/maps exaggeration — reprojects the mounted widget instead of rebuilding it", () => {
  it("keeps the widget, its <pre>, its tile cache and its fine tier across an exaggeration change", async () => {
    const r = await run(false);

    // The settled first paint already has the fine tier — with no input.
    expect(r.tierCountsBefore[FINE] ?? 0).toBeGreaterThan(0);

    // The widget survives: same handle, same `<pre>` node, still connected.
    expect(r.outputAfter).toBe(r.outputBefore);
    expect(r.outputAfter.isConnected).toBe(true);

    // The tile cache survives: not one payload refetched.
    expect(r.tileFetchesDuring).toBe(0);

    // The fine tier is never dropped, so the coarse backstop is never what
    // the viewport shows.
    expect(r.tierCountsAfter[FINE]).toBe(r.tierCountsBefore[FINE]);

    // No blank frame, and no backstop-only frame: every `<pre>` write during
    // the change carried at least as much ink as the FLOOR-ONLY render would
    // (measured at ~1150 non-space glyphs on this fixture; the settled render
    // is ~5x that). `>= 60%` of the settled ink is far above the floor tier
    // and far below a full render, so this cannot be satisfied by either.
    const settledInk = [...r.settledAfter].filter((c) => c !== " " && c !== "\n").length;
    expect(settledInk).toBeGreaterThan(2000);
    expect(r.frameLengths.length).toBeGreaterThan(0);
    expect(Math.min(...r.frameLengths)).toBeGreaterThan(settledInk * 0.6);

    // ...and the exaggeration genuinely applied — this is not a no-op.
    expect(r.settledAfter).not.toBe(r.settledBefore);
  }, 60_000);

  it("REPRODUCES the defect when the construction effect depends on exaggeration", async () => {
    const r = await run(true);

    // A brand-new widget: different `<pre>`, and the old one is detached.
    expect(r.outputAfter).not.toBe(r.outputBefore);
    expect(r.outputBefore.isConnected).toBe(false);

    // The cache died with it — every visible tile is refetched.
    expect(r.tileFetchesDuring).toBeGreaterThan(0);

    // And in between, the viewport showed a frame with far less ink than the
    // settled render: the empty first frame of the new scene, then the coarse
    // floor backstop alone while the refetch was in flight.
    const settledInk = [...r.settledAfter].filter((c) => c !== " " && c !== "\n").length;
    expect(Math.min(...r.frameLengths)).toBeLessThan(settledInk * 0.6);
  }, 60_000);
});
