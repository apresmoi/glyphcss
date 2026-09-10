// @vitest-environment happy-dom
/**
 * Reproduces `/maps`'s default state (MAPS_URL_DEFAULTS in mapsUrlState.ts:
 * globe projection, "solid" mode, "default" glyphPalette, "ascii" charMode,
 * terrain + border layers both visible at density 1) through the real
 * `createGlyphMap` widget and `computeGlyphAtlasAvailability` — the exact
 * same check `MapsWorkbench.tsx` runs against `map.scene.output` — to find
 * the REAL reason the atlas control is disabled by default, empirically,
 * rather than guessing from AGENTS.md's palette-coverage table.
 */
import { describe, expect, it, vi } from "vitest";

// `mapsUrlState.ts` -> `mapsKit.tsx` -> `../SynthWorkbench/synthKit` -> `../Dock`
// -> `Dock/slots.tsx` -> `Dock/folders/useRenderingFolder.ts`, which calls
// `ensureCalibratedPalette()` at IMPORT TIME (a real-browser-only canvas
// measurement). happy-dom has no canvas 2D context, so that module-load side
// effect throws before this file's own tests can run. Same stub
// `synthKit.test.ts` uses for the identical reason — `vi.mock` calls are
// hoisted above every import in this file, so this takes effect before the
// chain above loads.
vi.mock("@glyphcss/effects", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@glyphcss/effects")>();
  return {
    ...actual,
    calibrateGlyphRamp: () => ({ ramp: " .:-=+*#%@", steps: [] }),
  };
});

import { createGlyphMap, GlyphMapClassifiers, type GlyphMapGeoTile, type GlyphMapVectorFeature } from "@glyphcss/maps";
import { computeGlyphAtlasAvailability } from "../../lib/glyphAtlasAvailability";
import { buildMapProjection, MAP_PALETTES, MAP_SCENE_RENDER_MODE } from "./mapsKit";
import { MAPS_URL_DEFAULTS } from "./mapsUrlState";

function makeTerrainTile(): GlyphMapGeoTile {
  const cols = 8;
  const rows = 8;
  const elevation = new Float32Array((cols + 1) * (rows + 1));
  // A real elevation gradient (not a flat fill) so the render exercises more
  // than one classified band, same as the real ETOPO1 pyramid would.
  for (let j = 0; j <= rows; j++) {
    for (let i = 0; i <= cols; i++) {
      elevation[j * (cols + 1) + i] = -500 + (i / cols) * 6000 + (j / rows) * 1500;
    }
  }
  return {
    bounds: { west: -180, east: 180, south: -85, north: 85 },
    cols, rows, elevation,
    source: "synthetic", sampler: "nearest",
  };
}

function makeBorderFeature(): GlyphMapVectorFeature {
  // A closed ring roughly tracing a country outline — exercises the same
  // `line` layer / `stampGlyphMapPolyline` path `/maps`'s default "borders"
  // layer runs, at every tangent direction (not just one straight segment).
  return {
    id: "test-border",
    rings: [[
      [-10, -10], [10, -8], [15, 5], [5, 15], [-8, 12], [-15, 0], [-10, -10],
    ]],
  };
}

function mountMapsDefaults() {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const projection = buildMapProjection(MAPS_URL_DEFAULTS.projection, MAPS_URL_DEFAULTS.exaggeration);
  const map = createGlyphMap(host, {
    view: { center: [MAPS_URL_DEFAULTS.centerLon, MAPS_URL_DEFAULTS.centerLat], span: MAPS_URL_DEFAULTS.span, cols: 80, rows: 32 },
    projection,
    tilt: MAPS_URL_DEFAULTS.tilt,
    layers: [
      { type: "background", id: "background", color: "#08131f" },
      {
        type: "raster",
        id: "terrain",
        source: makeTerrainTile(),
        classifier: GlyphMapClassifiers.etopo1V1,
        colors: MAP_PALETTES[MAPS_URL_DEFAULTS.palette],
        density: 1,
      },
      { type: "line", id: "borders", source: { features: [makeBorderFeature()] }, color: "#e8c988", density: 1 },
    ],
    scene: {
      mode: MAP_SCENE_RENDER_MODE,
      glyphPalette: MAPS_URL_DEFAULTS.glyphPalette,
      charMode: MAPS_URL_DEFAULTS.charMode,
      useColors: MAPS_URL_DEFAULTS.useColors,
    },
  });
  map.scene.rerender();
  return { host, map };
}

describe("/maps default state — atlas color-encoding availability (empirical)", () => {
  it("computeGlyphAtlasAvailability against the real default-state render is available (reason === null)", () => {
    const { host, map } = mountMapsDefaults();
    const reason = computeGlyphAtlasAvailability(map.scene.output, {
      useColors: MAPS_URL_DEFAULTS.useColors,
      charMode: MAPS_URL_DEFAULTS.charMode,
    }).reason;
    // eslint-disable-next-line no-console -- deliberate: the task asks for the
    // REAL reason string, printed, not guessed.
    console.log("[/maps default-state atlasReason]", reason);
    expect(reason).toBeNull();
    map.destroy();
    host.remove();
  });
});
