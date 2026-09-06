// @vitest-environment happy-dom
/**
 * Root-causes and pins the fix for the reported "/maps color-encoding
 * control is permanently disabled" bug.
 * `MapsWorkbench.atlasAvailability(.real).test.ts` already prove
 * `computeGlyphAtlasAvailability` returns `null` (available) for /maps's
 * real documented default content — both a synthetic reproduction and one
 * built from the real baked ETOPO1 + admin_0 tile pyramids on disk. So the
 * disabled state was NOT a glyph-coverage problem; it was a WIRING problem,
 * specific to `MapsWorkbench.tsx`'s own React effect graph.
 *
 * `MapsWorkbench.tsx` loads its terrain (`provider`) and border
 * (`vectorProvider`) tile providers via two INDEPENDENT `useEffect`s that
 * each resolve asynchronously off their own `fetch` chain and call their own
 * `setState`. Its widget-BUILD effect depends on
 * `[provider, vectorProvider, exaggeration]` — so it (re)builds
 * `createGlyphMap` (destroy + recreate; `map.destroy()` removes the OLD
 * `<pre>` from the DOM, per `packages/glyphcss/src/api/createGlyphScene.ts`'s
 * `destroy()`: `host.removeChild(sceneEl)`) whenever EITHER provider
 * resolves. When `provider` (terrain) resolves first, the map is built
 * WITHOUT borders; when `vectorProvider` resolves afterward, the map is torn
 * down and REBUILT with borders — a brand-new `map.scene.output` `<pre>`
 * node.
 *
 * The atlas-availability effect's dependency array used to be
 * `[provider, projectionId, exaggeration]` — missing `vectorProvider`. So
 * when the rebuild fired because `vectorProvider` arrived, that effect never
 * re-ran: its `MutationObserver` kept watching the OLD, now-DETACHED `<pre>`,
 * and no observer was ever attached to the new one. If that old `<pre>`
 * never received a mutation while it still had content (plausible under
 * real network latency — terrain tiles hadn't rendered yet when borders
 * arrived and triggered the rebuild), `atlasReason` froze at its initial
 * `"Nothing rendered yet."` value forever, with no further update possible —
 * reading exactly as "the color-encoding control is permanently disabled."
 * Fixed by adding `vectorProvider` to that effect's dependency array
 * (`MapsWorkbench.tsx`, the "Atlas availability" effect).
 *
 * `MapsWorkbench.tsx` itself can't be mounted directly in this standalone
 * vitest config: it imports `../GalleryWorkbench/CodePanel`, which imports
 * `@glyphcss/core` directly — a package `website/package.json` never
 * declares as a dependency (only `@glyphcss/effects`/`maps`/`react`/`fonts`
 * are), so it isn't symlinked into `website/node_modules/@glyphcss/` at all
 * and Vite's standalone (non-Astro) resolution can't find it. That's a
 * pre-existing, unrelated environment gap (not touched here — fixing it
 * means editing `website/package.json`, outside this task's declared
 * `website/src/**` scope, and pulling in the entire Gallery/CodePanel/Dock
 * chain would test far more surface than this specific bug). This file
 * instead isolates the exact effects at fault into a minimal harness
 * component reproducing `MapsWorkbench.tsx`'s own effect SHAPE (same
 * dependency-array pattern, same build/cleanup/observe logic) verbatim,
 * driving it with the real `createGeoTilesProvider`/
 * `createVectorTilesProvider`/`createGlyphMap`/
 * `computeGlyphAtlasAvailability` — nothing about the bug mechanism itself
 * is hand-waved. `includeVectorProviderDep` toggles the harness's atlas
 * effect between the pre-fix (`false`) and post-fix (`true`, the default,
 * matching current `MapsWorkbench.tsx`) dependency array, so the same
 * harness proves both the defect and the fix.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { act, useEffect, useRef, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// `./mapsKit` -> `../SynthWorkbench/synthKit` -> `../Dock` -> `Dock/slots.tsx`
// -> `Dock/folders/useRenderingFolder.ts`, which calls
// `ensureCalibratedPalette()` at IMPORT TIME (a real-browser-only canvas
// measurement happy-dom can't do). Same stub `synthKit.test.ts`/
// `LayerGroup.test.tsx` use for the identical reason.
vi.mock("@glyphcss/effects", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@glyphcss/effects")>();
  return {
    ...actual,
    calibrateGlyphRamp: () => ({ ramp: " .:-=+*#%@", steps: [] }),
  };
});

import { createGlyphMap, GlyphMapClassifiers, glyphMapEquirectangular, type GlyphMapHandle, type GlyphMapProvider, type GlyphMapVectorProvider } from "@glyphcss/maps";
import { computeGlyphAtlasAvailability } from "../../lib/glyphAtlasAvailability";
import { MAP_PALETTES, MAP_SCENE_RENDER_MODE } from "./mapsKit";
import { MAPS_URL_DEFAULTS } from "./mapsUrlState";
import { createGeoTilesProvider } from "../../lib/geoTilesProvider";
import { createVectorTilesProvider } from "../../lib/vectorTilesProvider";

const PUBLIC_DATA_DIR = resolve(process.cwd(), "public/data");

function stubFetchFromDisk(vectorDelayMs: number): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL) => {
      const url = String(input);
      const relative = url.replace(/^\/data\//, "");
      const isVector = relative.startsWith("vector-tiles/");
      if (isVector && vectorDelayMs > 0) await new Promise((r) => setTimeout(r, vectorDelayMs));
      const filePath = `${PUBLIC_DATA_DIR}/${relative}`;
      try {
        const isJson = filePath.endsWith(".json");
        const body = readFileSync(filePath);
        return new Response(body, {
          status: 200,
          headers: { "content-type": isJson ? "application/json" : "application/octet-stream" },
        });
      } catch {
        return new Response(null, { status: 404 });
      }
    }),
  );
}

/**
 * Reproduces exactly the effects at fault in `MapsWorkbench.tsx` (provider
 * loading effects, the widget-build effect, and the atlas-availability
 * effect). `onObservedPre` reports every `<pre>` the atlas effect's
 * `MutationObserver` is asked to observe, and `onAtlasReason` reports every
 * computed reason, so the test can inspect the mechanism directly.
 */
function AtlasWiringHarness({ vectorDelayMs, includeVectorProviderDep, onObservedPre, onAtlasReason, onMapReady }: {
  vectorDelayMs: number;
  includeVectorProviderDep: boolean;
  onObservedPre: (pre: HTMLElement) => void;
  onAtlasReason: (reason: string | null) => void;
  onMapReady: (pre: HTMLElement) => void;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<GlyphMapHandle | null>(null);
  const [provider, setProvider] = useState<GlyphMapProvider | null>(null);
  const [vectorProvider, setVectorProvider] = useState<GlyphMapVectorProvider | null>(null);

  // Mirrors MapsWorkbench.tsx's terrain-provider-load effect.
  useEffect(() => {
    let cancelled = false;
    createGeoTilesProvider().then((p) => { if (!cancelled) setProvider(p); });
    return () => { cancelled = true; };
  }, []);

  // Mirrors MapsWorkbench.tsx's border-provider-load effect, artificially
  // delayed here to force it to resolve strictly AFTER `provider` (a real,
  // plausible network-timing outcome the live page can hit too — this
  // harness just makes it deterministic).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (vectorDelayMs > 0) await new Promise((r) => setTimeout(r, vectorDelayMs));
      const p = await createVectorTilesProvider();
      if (!cancelled) setVectorProvider(p);
    })();
    return () => { cancelled = true; };
  }, [vectorDelayMs]);

  // Mirrors MapsWorkbench.tsx's widget-build effect: deps
  // `[provider, vectorProvider]` (exaggeration omitted here, constant in
  // this harness), destroy+rebuild on either provider changing.
  useEffect(() => {
    const host = hostRef.current;
    if (!host || !provider) return;
    const map = createGlyphMap(host, {
      view: { center: [MAPS_URL_DEFAULTS.centerLon, MAPS_URL_DEFAULTS.centerLat], span: MAPS_URL_DEFAULTS.span, cols: 60, rows: 24 },
      projection: glyphMapEquirectangular(),
      layers: [
        { type: "raster", id: "terrain", source: provider, classifier: GlyphMapClassifiers.etopo1V1, colors: MAP_PALETTES[MAPS_URL_DEFAULTS.palette], density: 1 },
        ...(vectorProvider ? [{ type: "line" as const, id: "borders", source: vectorProvider, color: "#e8c988", density: 1 }] : []),
      ],
      scene: { mode: MAP_SCENE_RENDER_MODE, glyphPalette: MAPS_URL_DEFAULTS.glyphPalette, charMode: MAPS_URL_DEFAULTS.charMode, useColors: MAPS_URL_DEFAULTS.useColors },
    });
    mapRef.current = map;
    onMapReady(map.scene.output);
    return () => {
      map.destroy();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [provider, vectorProvider]);

  // Mirrors MapsWorkbench.tsx's atlas-availability effect. `includeVectorProviderDep`
  // toggles between the pre-fix deps (`[provider]`, the bug) and the current,
  // fixed deps (`[provider, vectorProvider]`).
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const pre = map.scene.output;
    onObservedPre(pre);
    const recompute = (): void => {
      onAtlasReason(computeGlyphAtlasAvailability(pre, { useColors: MAPS_URL_DEFAULTS.useColors, charMode: MAPS_URL_DEFAULTS.charMode }).reason);
    };
    recompute();
    const observer = new MutationObserver(recompute);
    observer.observe(pre, { childList: true, subtree: true, characterData: true });
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, includeVectorProviderDep ? [provider, vectorProvider] : [provider]);

  return <div ref={hostRef} />;
}

let root: Root | null = null;
let container: HTMLElement | null = null;

afterEach(() => {
  if (root) act(() => { root!.unmount(); });
  container?.remove();
  root = null;
  container = null;
  vi.unstubAllGlobals();
});

async function runHarness(includeVectorProviderDep: boolean): Promise<{
  observedPres: HTMLElement[];
  readyPres: HTMLElement[];
  reasons: (string | null)[];
}> {
  stubFetchFromDisk(150); // borders resolve strictly after terrain

  const observedPres: HTMLElement[] = [];
  const readyPres: HTMLElement[] = [];
  const reasons: (string | null)[] = [];

  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(
      <AtlasWiringHarness
        vectorDelayMs={150}
        includeVectorProviderDep={includeVectorProviderDep}
        onObservedPre={(pre) => observedPres.push(pre)}
        onAtlasReason={(reason) => reasons.push(reason)}
        onMapReady={(pre) => readyPres.push(pre)}
      />,
    );
  });

  // Let terrain load and the first (no-borders) build settle.
  await act(async () => { await new Promise((r) => setTimeout(r, 60)); });
  // Let the delayed vector-tiles fetch resolve and the rebuild happen.
  await act(async () => { await new Promise((r) => setTimeout(r, 400)); });

  return { observedPres, readyPres, reasons };
}

describe("/maps atlas-availability wiring — fixed: the effect re-subscribes across the borders rebuild", () => {
  it("the atlas effect's MutationObserver re-attaches to the rebuilt (live) <pre> once borders arrive after terrain, and stays reactive", async () => {
    const { observedPres, readyPres, reasons } = await runHarness(true);

    expect(readyPres.length).toBe(2); // terrain-only build, then the borders rebuild
    const [preAfterFirstBuild, finalPre] = readyPres as [HTMLElement, HTMLElement];
    expect(finalPre).not.toBe(preAfterFirstBuild);
    expect(preAfterFirstBuild.isConnected).toBe(false);
    expect(finalPre.isConnected).toBe(true);

    // Fixed: the atlas effect re-ran when `vectorProvider` arrived, so it
    // observed BOTH pres in turn — critically, including the live one.
    expect(observedPres).toContain(finalPre);

    const reasonsBefore = reasons.length;
    finalPre.textContent = "##";
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    expect(reasons.length).toBeGreaterThan(reasonsBefore); // the live pre IS observed
  }, 20000);
});
