// @vitest-environment happy-dom
/**
 * Same empirical question as `MapsWorkbench.atlasAvailability.test.ts`, but
 * against the REAL baked ETOPO1 terrain pyramid and REAL Natural Earth
 * admin_0 border vector-tile pyramid on disk (`website/public/data/geo-tiles`,
 * `website/public/data/vector-tiles` — gitignored, regenerable, but already
 * baked in this checkout) instead of hand-rolled synthetic geometry. `fetch`
 * is stubbed to read those files straight off disk (same manifest/tile URL
 * shape `createGeoTilesProvider`/`createVectorTilesProvider` request), so
 * this exercises the exact provider code the live page runs, over the exact
 * data the live page would fetch, for `/maps`'s real default view.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

// See the sibling `.test.ts` file for why this stub is required before the
// `mapsKit`/`mapsUrlState` import chain loads under happy-dom.
vi.mock("@glyphcss/effects", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@glyphcss/effects")>();
  return {
    ...actual,
    calibrateGlyphRamp: () => ({ ramp: " .:-=+*#%@", steps: [] }),
  };
});

import { createGlyphMap, GlyphMapClassifiers } from "@glyphcss/maps";
import { computeGlyphAtlasAvailability } from "../../lib/glyphAtlasAvailability";
import { buildMapProjection, MAP_PALETTES, MAP_SCENE_RENDER_MODE } from "./mapsKit";
import { MAPS_URL_DEFAULTS } from "./mapsUrlState";
import { createGeoTilesProvider } from "../../lib/geoTilesProvider";
import { createVectorTilesProvider } from "../../lib/vectorTilesProvider";

// `vitest` (via `pnpm --filter @glyphcss/website test`) runs with cwd =
// `website/`, so this resolves to `website/public/data` regardless of where
// the test file itself lives.
const PUBLIC_DATA_DIR = resolve(process.cwd(), "public/data");

function stubFetchFromDisk(): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL) => {
      const url = String(input);
      // Both providers request paths like "/data/geo-tiles/manifest.json" or
      // "/data/vector-tiles/2/1_0.json" — strip the "/data" prefix to get a
      // path relative to `website/public/data`.
      const relative = url.replace(/^\/data\//, "");
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

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("/maps default state — atlas color-encoding availability against REAL baked ETOPO1 + admin_0 data", () => {
  it("computeGlyphAtlasAvailability against the real default-state render (real terrain + real borders) is available (reason === null)", async () => {
    stubFetchFromDisk();

    const [provider, vectorProvider] = await Promise.all([
      createGeoTilesProvider(),
      createVectorTilesProvider(),
    ]);

    const host = document.createElement("div");
    document.body.appendChild(host);

    const projection = buildMapProjection(
      MAPS_URL_DEFAULTS.projection,
      MAPS_URL_DEFAULTS.exaggeration,
    );

    const map = createGlyphMap(host, {
      view: { center: [MAPS_URL_DEFAULTS.centerLon, MAPS_URL_DEFAULTS.centerLat], span: MAPS_URL_DEFAULTS.span, cols: 160, rows: 64 },
      projection,
      tilt: MAPS_URL_DEFAULTS.tilt,
      layers: [
        { type: "background", id: "background", color: "#08131f" },
        {
          type: "raster",
          id: "terrain",
          source: provider,
          classifier: GlyphMapClassifiers.etopo1V1,
          colors: MAP_PALETTES[MAPS_URL_DEFAULTS.palette],
          density: 1,
        },
        { type: "line", id: "borders", source: vectorProvider, color: "#e8c988", density: 1 },
      ],
      scene: {
        mode: MAP_SCENE_RENDER_MODE,
        glyphPalette: MAPS_URL_DEFAULTS.glyphPalette,
        charMode: MAPS_URL_DEFAULTS.charMode,
        useColors: MAPS_URL_DEFAULTS.useColors,
        smoothShading: MAPS_URL_DEFAULTS.smoothShading,
      },
    });

    // Real providers fetch+decode tiles asynchronously (debounced); wait for
    // the widget to actually paint something, then let the debounce settle.
    await vi.waitFor(() => expect(map.scene.output.textContent ?? "").not.toBe(""), { timeout: 5000 });
    await new Promise((r) => setTimeout(r, 250));
    map.scene.rerender();

    const reason = computeGlyphAtlasAvailability(map.scene.output, {
      useColors: MAPS_URL_DEFAULTS.useColors,
      charMode: MAPS_URL_DEFAULTS.charMode,
    }).reason;
    // eslint-disable-next-line no-console -- deliberate: the task asks for
    // the REAL reason string, printed, not guessed.
    console.log("[/maps default-state atlasReason — REAL data]", reason);

    expect(reason).toBeNull();

    map.destroy();
    host.remove();
  }, 15000);
});
