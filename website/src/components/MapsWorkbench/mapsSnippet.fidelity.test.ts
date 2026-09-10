import { describe, expect, it } from "vitest";

import { MAP_SCENE_GLYPH_PALETTE, MAP_SCENE_RENDER_MODE, buildMapsSnippet, type MapsSnippetState } from "./mapsKit";

/**
 * "The code should actually put everything we have selected there."
 *
 * The page's `createGlyphMap` call (MapsWorkbench.tsx) carries a `scene`
 * block, a `sun`, a `keyLight`, a `shadow`, per-layer densities and glyph
 * palettes, the terrain elevation window, the contour window and labels, and
 * — with the OSM card on — thirteen more layers off one OpenFreeMap
 * provider. The snippet used to emit fourteen of those fields and silently
 * drop the rest, so a reader who spent ten minutes tuning the page got a
 * snippet that rendered the DEFAULT map.
 *
 * These are the ones the snippet can honestly reproduce: every field below is
 * a real option on `createGlyphMap`, spelled the way the page spells it.
 * `interactiveDownscale` is the one derived value (`dragDensity` is a UI
 * number the page converts), so it is emitted already converted.
 */
const DEFAULTS: MapsSnippetState = {
  projectionId: "globe",
  exaggeration: 24,
  centerLon: 0,
  centerLat: 20,
  span: 140,
  tilt: 0,
  bearing: 0,
  palette: "terrain",
  terrainGlyphPalette: MAP_SCENE_GLYPH_PALETTE,
  backgroundColor: "#05070c",
  showBorders: false,
  borderColor: "#38bdf8",
  showContour: false,
  contourInterval: 500,
  contourColor: "#94a3b8",
  contourMinElevation: null,
  contourMaxElevation: null,
  // ── everything below is what the snippet did not carry ──
  charMode: "ascii",
  colorEncoding: "spans",
  useColors: true,
  smoothShading: false,
  wireframeJunctions: false,
  hiddenLines: "show",
  solidWeightRamp: false,
  density: 1,
  interactiveDownscale: 1,
  showTerrain: true,
  terrainDensity: 1,
  terrainMinElevation: null,
  terrainMaxElevation: null,
  borderDensity: 1,
  contourDensity: 1,
  contourLabels: false,
  lighting: {
    azimuth: 135, elevation: 45, intensity: 1, color: "#ffffff",
    ambientIntensity: 0.25, ambientColor: "#ffffff",
  },
  sunMode: "off",
  sunDay: 172,
  sunHour: 12,
  shadows: false,
  osm: null,
};

function build(overrides: Partial<MapsSnippetState> = {}): string {
  return buildMapsSnippet({ ...DEFAULTS, ...overrides });
}

describe("the snippet carries the scene the page actually builds", () => {
  it("emits the page's own scene mode and glyph palette", () => {
    const code = build();
    expect(code).toContain(`mode: "${MAP_SCENE_RENDER_MODE}"`);
    expect(code).toContain(`glyphPalette: "${MAP_SCENE_GLYPH_PALETTE}"`);
  });

  it("carries a chosen charMode, colorEncoding and colour switch", () => {
    const code = build({ charMode: "braille", colorEncoding: "atlas", useColors: false });
    expect(code).toContain('charMode: "braille"');
    expect(code).toContain('colorEncoding: "atlas"');
    expect(code).toContain("useColors: false");
  });

  it("carries the render-quality switches", () => {
    const code = build({ smoothShading: true, wireframeJunctions: true, hiddenLines: "hide", solidWeightRamp: true });
    expect(code).toContain("smoothShading: true");
    expect(code).toContain("wireframeJunctions: true");
    expect(code).toContain('hiddenLines: "hide"');
    expect(code).toMatch(/solidWeightRamp/);
  });

  it("carries density and the drag downscale as the option the page passes", () => {
    const code = build({ density: 1.6, interactiveDownscale: 2 });
    expect(code).toContain("density: 1.6");
    expect(code).toContain("interactiveDownscale: 2");
  });

  it("carries the light the Lighting folder set", () => {
    const code = build({
      lighting: { azimuth: 120, elevation: 30, intensity: 1.2, color: "#ffddaa", ambientIntensity: 0.4, ambientColor: "#334455" },
    });
    expect(code).toMatch(/directionalLight/);
    expect(code).toContain("intensity: 1.2");
    expect(code).toContain('"#ffddaa"');
    expect(code).toMatch(/ambientLight/);
    expect(code).toContain("intensity: 0.4");
  });

  it("carries the sun mode and, in manual, the instant it is pinned to", () => {
    expect(build()).not.toMatch(/\bsun:/);
    const realtime = build({ sunMode: "realtime" });
    expect(realtime).toContain('sun: { mode: "realtime" }');
    const manual = build({ sunMode: "manual", sunDay: 172, sunHour: 9.5 });
    expect(manual).toContain('mode: "manual"');
    expect(manual).toMatch(/date: new Date\(/);
  });

  it("carries shadows", () => {
    expect(build()).not.toMatch(/\bshadow:/);
    expect(build({ shadows: true })).toContain("shadow: {}");
  });

  it("carries the terrain window, its density and its glyph ramp", () => {
    const code = build({
      terrainMinElevation: 0, terrainMaxElevation: 4000, terrainDensity: 1.5, terrainGlyphPalette: "dense",
    });
    expect(code).toContain("minElevation: 0");
    expect(code).toContain("maxElevation: 4000");
    expect(code).toContain("density: 1.5");
    expect(code).toContain('glyphPalette: "dense"');
  });

  it("omits the terrain layer entirely when it is switched off", () => {
    const code = build({ showTerrain: false });
    expect(code).not.toContain('type: "raster"');
  });

  it("carries the stroke layers' own densities and the contour's labels", () => {
    const code = build({
      showBorders: true, borderDensity: 2,
      showContour: true, contourDensity: 1.8, contourLabels: true,
    });
    expect(code).toMatch(/type: "line"[^\n]*density: 2/);
    expect(code).toMatch(/type: "contour"[^\n]*density: 1\.8/);
    expect(code).toMatch(/type: "contour"[^\n]*labels: true/);
  });

  it("carries the OSM stack as the one call the page makes", () => {
    expect(build()).not.toMatch(/glyphMapOpenFreeMapProvider/);
    const code = build({
      osm: { enabled: ["omt-roads", "omt-water"], densities: { "omt-roads": 2.5 }, anchors: { "omt-places": "top" } },
    });
    expect(code).toContain("glyphMapOpenFreeMapProvider");
    expect(code).toContain("glyphMapOpenMapTilesLayers");
    expect(code).toContain('"omt-roads"');
    expect(code).toContain('"omt-water"');
    expect(code).toContain("2.5");
    // …and the built layers reach `layers`. Building them and never mounting
    // them is the failure mode a preamble-only assertion would miss.
    expect(code).toMatch(/layers: \[[\s\S]*\.\.\.osmLayers,[\s\S]*\]/);
  });

  // A default page must still produce the compact snippet it produced before
  // any of this existed — a reader who changed nothing should not be handed
  // forty lines of defaults spelled out.
  it("stays quiet on an untouched page", () => {
    const code = build();
    expect(code).not.toMatch(/\bsun:/);
    expect(code).not.toMatch(/\bshadow:/);
    expect(code).not.toMatch(/interactiveDownscale/);
    expect(code).not.toMatch(/wireframeJunctions/);
    expect(code).not.toMatch(/hiddenLines/);
    expect(code).not.toMatch(/glyphMapOpenFreeMapProvider/);
    expect(code).not.toMatch(/minElevation/);
  });
});
