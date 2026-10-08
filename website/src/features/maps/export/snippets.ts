import {
  type MapLayerGlyphPalette,
  type MapPaletteName,
  type MapProjectionId,
  MAP_PALETTES,
  MAP_SCENE_GLYPH_PALETTE,
  MAP_SCENE_RENDER_MODE,
} from "../model/config";
import { mapSunManualInstant } from "../model/lighting";

// Map snippets use the vanilla widget API; the export panel only enables JS.

export interface MapsSnippetLighting {
  readonly azimuth: number;
  readonly elevation: number;
  readonly intensity: number;
  readonly color: string;
  readonly ambientIntensity: number;
  readonly ambientColor: string;
}

/** The OSM card's mounted state — `null` when the card is off. */
export interface MapsSnippetOsm {
  /** The rows that are on, in card order (`mapOsmLayers`' `include`). */
  readonly enabled: readonly string[];
  /** Per-row density, only for rows that diverge from 1. */
  readonly densities: Readonly<Record<string, number>>;
  /** Per-row label placement, only for rows that diverge from the centred default. */
  readonly anchors: Readonly<Record<string, string>>;
}

export interface MapsSnippetState {
  readonly projectionId: MapProjectionId;
  readonly exaggeration: number;
  readonly centerLon: number;
  readonly centerLat: number;
  readonly span: number;
  readonly tilt: number;
  /** Camera heading, degrees. Emitted only when the map has actually been turned — see {@link buildMapsSnippet}. */
  readonly bearing: number;
  readonly palette: MapPaletteName;
  readonly terrainGlyphPalette: MapLayerGlyphPalette;
  readonly backgroundColor: string;
  readonly showBorders: boolean;
  readonly borderColor: string;
  readonly showContour: boolean;
  readonly contourInterval: number;
  readonly contourColor: string;
  /** The contour elevation window, `null` per unbounded end — emitted only when set, so an untouched window produces the snippet this builder produced before the control existed. */
  readonly contourMinElevation: number | null;
  readonly contourMaxElevation: number | null;

  // ── The scene block the page actually passes ────────────────────────────
  readonly charMode: string;
  readonly colorEncoding: string;
  readonly useColors: boolean;
  readonly smoothShading: boolean;
  readonly wireframeJunctions: boolean;
  readonly hiddenLines: "show" | "hide";
  readonly solidWeightRamp: boolean;
  readonly density: number;
  /** Already converted from the Dock's "Drag density" — the page passes this number, not the UI one. */
  readonly interactiveDownscale: number;
  readonly lighting: MapsSnippetLighting;

  // ── Whole-map options ───────────────────────────────────────────────────
  readonly sunMode: "off" | "realtime" | "manual";
  readonly sunDay: number;
  readonly sunHour: number;
  readonly shadows: boolean;

  // ── Per-layer state ─────────────────────────────────────────────────────
  readonly showTerrain: boolean;
  readonly terrainDensity: number;
  readonly terrainMinElevation: number | null;
  readonly terrainMaxElevation: number | null;
  readonly borderDensity: number;
  readonly contourDensity: number;
  readonly contourLabels: boolean;
  readonly osm: MapsSnippetOsm | null;
}

const PROJECTION_FACTORY: Record<MapProjectionId, string> = {
  equirectangular: "glyphMapEquirectangular",
  mercator: "glyphMapMercator",
  globe: "glyphMapGlobe",
};

function fmt(n: number): string {
  return String(Math.round(n * 100) / 100);
}

/** `key: value` only when `value` diverges from the page's own default — see {@link buildMapsSnippet}. */
function optional(key: string, value: unknown, fallback: unknown): string {
  return value === fallback ? "" : `, ${key}: ${JSON.stringify(value)}`;
}

/** The `minElevation`/`maxElevation` pair for a layer's elevation window, or an empty string when neither end is bounded. */
function elevationWindowSource(min: number | null, max: number | null): string {
  return [min === null ? "" : `, minElevation: ${fmt(min)}`, max === null ? "" : `, maxElevation: ${fmt(max)}`].join(
    "",
  );
}

/**
 * The `sun` option, or an empty string in the default `"off"` mode.
 *
 * `manual` is pinned to ONE instant, and the page derives that instant from a
 * day-of-year and an hour (`mapSunManualInstant`). The snippet spells the
 * resulting ISO timestamp rather than re-deriving it, so the pen shows the
 * terminator the reader is looking at rather than one that depends on when
 * the snippet is run.
 */
function sunSource(state: MapsSnippetState): string {
  if (state.sunMode === "off") return "";
  if (state.sunMode === "realtime") return `\n  sun: { mode: "realtime" },`;
  const instant = mapSunManualInstant(state.sunDay, state.sunHour);
  return `\n  sun: { mode: "manual", date: new Date(${JSON.stringify(new Date(instant).toISOString())}) },`;
}

/**
 * The `scene` block.
 *
 * Everything that is at glyphcss's own default is OMITTED, and that is a
 * deliberate rule rather than brevity: a snippet that spelled every default
 * out would read as if the default had to be opted into, and it is the exact
 * rule the pre-existing `glyphPalette` line already followed. What the page
 * pins UNCONDITIONALLY (`mode`, `glyphPalette`) stays unconditional, because
 * the page pins it unconditionally.
 */
function sceneSource(state: MapsSnippetState): string {
  const l = state.lighting;
  const rad = (deg: number) => (deg * Math.PI) / 180;
  const el = rad(l.elevation);
  const az = rad(l.azimuth);
  // The page's own `buildMapLighting` conversion, spelled as literals so the
  // pen needs no helper: glyphcss's `direction` is the source vector, from
  // the surface TOWARD the light (AGENTS.md, "Numeric conventions").
  const dir = [Math.cos(el) * Math.cos(az), Math.cos(el) * Math.sin(az), Math.sin(el)].map((v) => fmt(v)).join(", ");
  return [
    `    mode: "${MAP_SCENE_RENDER_MODE}",`,
    `    glyphPalette: ${JSON.stringify(MAP_SCENE_GLYPH_PALETTE)},`,
    state.charMode === "ascii" ? "" : `    charMode: ${JSON.stringify(state.charMode)},`,
    state.colorEncoding === "spans" ? "" : `    colorEncoding: ${JSON.stringify(state.colorEncoding)},`,
    state.useColors ? "" : "    useColors: false,",
    state.smoothShading ? "    smoothShading: true," : "",
    state.wireframeJunctions ? "    wireframeJunctions: true," : "",
    state.hiddenLines === "show" ? "" : `    hiddenLines: ${JSON.stringify(state.hiddenLines)},`,
    // A ramp is DATA (`calibrateWeightedGlyphRamp`'s steps), not a flag, so
    // the snippet names the call that produces it rather than inlining a
    // table the reader would have to trust.
    state.solidWeightRamp
      ? "    // solidWeightRamp: calibrateWeightedGlyphRamp({ font: { family: getComputedStyle(host).fontFamily, size: 13 } }),"
      : "",
    state.density === 1 ? "" : `    density: ${fmt(state.density)},`,
    state.interactiveDownscale === 1 ? "" : `    interactiveDownscale: ${fmt(state.interactiveDownscale)},`,
    `    directionalLight: { direction: [${dir}], intensity: ${fmt(l.intensity)}, color: ${JSON.stringify(l.color)} },`,
    `    ambientLight: { intensity: ${fmt(l.ambientIntensity)}, color: ${JSON.stringify(l.ambientColor)} },`,
  ]
    .filter(Boolean)
    .join("\n");
}

export function buildMapsSnippet(state: MapsSnippetState): string {
  const factory = PROJECTION_FACTORY[state.projectionId];
  const projectionArgs = `{ exaggeration: ${fmt(state.exaggeration)} }`;
  // The per-layer glyph-palette option is EMITTED ONLY WHEN IT DIVERGES from
  // the scene's own — not for brevity, but because that is exactly the
  // condition under which it costs anything: `@glyphcss/maps` keeps a layer
  // naming the scene's own ramp in the shared base grid, so a snippet that
  // spelled it out unconditionally would read as if the free case had to be
  // opted into. Terrain has no render-mode option of its own to emit here —
  // it is always the scene's own `solid` mode (`MAP_SCENE_RENDER_MODE`).
  const terrainOptions =
    (state.terrainGlyphPalette === MAP_SCENE_GLYPH_PALETTE
      ? ""
      : `, glyphPalette: ${JSON.stringify(state.terrainGlyphPalette)}`) +
    optional("density", state.terrainDensity, 1) +
    elevationWindowSource(state.terrainMinElevation, state.terrainMaxElevation);
  const layerLines = [
    `    { type: "background", color: ${JSON.stringify(state.backgroundColor)} },`,
    ...(state.showTerrain
      ? [
          `    { type: "raster", source: terrainProvider, classifier: GlyphMapClassifiers.etopo1V1, colors: ${JSON.stringify(MAP_PALETTES[state.palette])}${terrainOptions} },`,
        ]
      : []),
    ...(state.showBorders
      ? [
          `    { type: "line", source: borderProvider, color: ${JSON.stringify(state.borderColor)}${optional("density", state.borderDensity, 1)} },`,
        ]
      : []),
    ...(state.showContour
      ? [
          `    { type: "contour", source: terrainProvider, levels: { interval: ${fmt(state.contourInterval)} }, color: ${JSON.stringify(state.contourColor)}${elevationWindowSource(state.contourMinElevation, state.contourMaxElevation)}${state.contourLabels ? ", labels: true" : ""}${optional("density", state.contourDensity, 1)} },`,
        ]
      : []),
    // The OSM stack is ONE call, exactly as the page mounts it
    // (`mapsOsm.ts`'s `mapOsmLayers`): thirteen rows off one provider, each
    // carrying that provider's ODbL attribution, so `getAttributions()` picks
    // the credit up from the mounted layer rather than from a hardcoded
    // string. Spread rather than listed, because the row -> layer mapping is
    // `@glyphcss/maps`' table and not something a page should re-type.
    ...(state.osm ? ["    ...osmLayers,"] : []),
  ].join("\n");

  const osmPreamble = state.osm
    ? `\n// The OpenStreetMap stack — OpenFreeMap's planet (public, no API key),\n// mapped onto glyph layers by @glyphcss/maps' OpenMapTiles schema table.\nconst osmSource = glyphMapOpenFreeMapProvider();\nconst osmLayers = glyphMapOpenMapTilesLayers(osmSource, {\n  include: ${JSON.stringify(state.osm.enabled)},\n  densities: ${JSON.stringify(state.osm.densities)},\n  textAnchors: ${JSON.stringify(state.osm.anchors)},\n});\n`
    : "";

  const imports = [
    "  createGlyphMap,",
    `  ${factory},`,
    "  GlyphMapClassifiers,",
    ...(state.osm ? ["  glyphMapOpenFreeMapProvider,", "  glyphMapOpenMapTilesLayers,"] : []),
  ].join("\n");

  return `import {
${imports}
} from "@glyphcss/maps";

// terrainProvider / borderProvider: fetch from your own baked tile
// pyramids (see website/scripts/bake-geo-tiles.mjs and
// bake-vector-tiles.mjs for the reference bakers this page uses).
// contour reuses the SAME elevation provider as terrain — createGlyphMap
// re-derives its field per visible LOD/tile as the view changes.

const host = document.querySelector("#map");
${osmPreamble}
const map = createGlyphMap(host, {
  view: { center: [${fmt(state.centerLon)}, ${fmt(state.centerLat)}], span: ${fmt(state.span)}, cols: 160, rows: 64 },
  projection: ${factory}(${projectionArgs}),
  tilt: ${fmt(state.tilt)},${state.bearing === 0 ? "" : `\n  bearing: ${fmt(state.bearing)},`}${sunSource(state)}${state.shadows ? "\n  shadow: {}," : ""}
  autoSize: true,
  controls: { drag: true, wheel: true },
  layers: [
${layerLines}
  ],
  scene: {
${sceneSource(state)}
  },
});

// No @glyphcss/react or @glyphcss/vue bindings exist for maps yet
// (AGENTS.md) — call createGlyphMap directly from a framework's own
// mount/effect hook (React useEffect, Vue onMounted, ...).
`;
}
