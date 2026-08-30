/**
 * `/maps`'s compact single-query-param URL state, built on the shared codec
 * (`website/src/lib/urlState.ts` — the same packing rules `/gallery`,
 * `/synth` and `/wordart` use). A brand-new page has no legacy links to
 * support, so unlike `synthUrlState.ts` this is a single codec, no version
 * migration chain.
 */
import { createUrlCodec, readUrlParam, scheduleCompactedUrlWrite, type UrlField } from "../../lib/urlState";
import { defaultGlyphColorEncoding } from "../../lib/glyphColorEncodingDefault";
import { DEFAULT_MAP_LIGHTING, type MapLighting, type MapPaletteName, type MapProjectionId } from "./mapsKit";

export type MapRenderMode = "wireframe" | "solid" | "ink";
// Includes "calibrated" — `DockRendering`'s glyph-palette dropdown always
// offers it (registered as a side effect of importing that folder, see
// `calibratedPalette.ts`), so the callback's partial can legally carry it.
export type MapGlyphPalette = "default" | "ascii" | "lines" | "blocks" | "stars" | "arrows" | "math" | "binary" | "hex" | "calibrated";
export type MapCharMode = "ascii" | "braille" | "halfblock" | "quadrant";
export type MapColorEncoding = "spans" | "atlas";

export interface MapsUrlState {
  projection: MapProjectionId;
  exaggeration: number;
  centerLon: number;
  centerLat: number;
  span: number;
  tilt: number;
  palette: MapPaletteName;
  renderMode: MapRenderMode;
  glyphPalette: MapGlyphPalette;
  charMode: MapCharMode;
  colorEncoding: MapColorEncoding;
  useColors: boolean;
  density: number;
  smoothShading: boolean;
  creaseAngle: number;
  lightAzimuth: number;
  lightElevation: number;
  lightIntensity: number;
  lightColor: string;
  ambientIntensity: number;
  ambientColor: string;
}

export const MAPS_URL_DEFAULTS: MapsUrlState = {
  projection: "globe",
  exaggeration: 24,
  centerLon: 0,
  centerLat: 20,
  span: 140,
  tilt: 40,
  palette: "terrain",
  renderMode: "solid",
  glyphPalette: "default",
  charMode: "ascii",
  // The site defaults `colorEncoding` per-page via feature detection
  // (`defaultGlyphColorEncoding`), same as `/synth`/`/gallery`/`/wordart` —
  // see that module's doc: settled synchronously, applied at hydration, an
  // explicit `?`-URL value always wins.
  colorEncoding: defaultGlyphColorEncoding(),
  useColors: true,
  density: 1,
  smoothShading: false,
  creaseAngle: 60,
  lightAzimuth: DEFAULT_MAP_LIGHTING.lightAzimuth,
  lightElevation: DEFAULT_MAP_LIGHTING.lightElevation,
  lightIntensity: DEFAULT_MAP_LIGHTING.lightIntensity,
  lightColor: DEFAULT_MAP_LIGHTING.lightColor,
  ambientIntensity: DEFAULT_MAP_LIGHTING.ambientIntensity,
  ambientColor: DEFAULT_MAP_LIGHTING.ambientColor,
};

const PROJECTION_VALUES: readonly MapProjectionId[] = ["equirectangular", "mercator", "globe", "orthographic"];
const PALETTE_VALUES: readonly MapPaletteName[] = ["terrain", "viridis", "heat", "ocean", "grayscale", "mono"];
const RENDER_MODE_VALUES: readonly MapRenderMode[] = ["wireframe", "solid", "ink"];
const GLYPH_PALETTE_VALUES: readonly MapGlyphPalette[] = ["default", "ascii", "lines", "blocks", "stars", "arrows", "math", "binary", "hex", "calibrated"];
const CHAR_MODE_VALUES: readonly MapCharMode[] = ["ascii", "braille", "halfblock", "quadrant"];
const COLOR_ENCODING_VALUES: readonly MapColorEncoding[] = ["spans", "atlas"];

const mapsFields: readonly UrlField<MapsUrlState>[] = [
  { key: "projection", token: "p", type: { kind: "enum", values: PROJECTION_VALUES }, default: MAPS_URL_DEFAULTS.projection },
  { key: "exaggeration", token: "e", type: { kind: "float", step: 1 }, default: MAPS_URL_DEFAULTS.exaggeration },
  { key: "centerLon", token: "x", type: { kind: "float", step: 0.1 }, default: MAPS_URL_DEFAULTS.centerLon },
  { key: "centerLat", token: "y", type: { kind: "float", step: 0.1 }, default: MAPS_URL_DEFAULTS.centerLat },
  { key: "span", token: "s", type: { kind: "float", step: 0.1 }, default: MAPS_URL_DEFAULTS.span },
  { key: "tilt", token: "t", type: { kind: "float", step: 1 }, default: MAPS_URL_DEFAULTS.tilt },
  { key: "palette", token: "P", type: { kind: "enum", values: PALETTE_VALUES }, default: MAPS_URL_DEFAULTS.palette },
  { key: "renderMode", token: "m", type: { kind: "enum", values: RENDER_MODE_VALUES }, default: MAPS_URL_DEFAULTS.renderMode },
  { key: "glyphPalette", token: "g", type: { kind: "enum", values: GLYPH_PALETTE_VALUES }, default: MAPS_URL_DEFAULTS.glyphPalette },
  { key: "charMode", token: "c", type: { kind: "enum", values: CHAR_MODE_VALUES }, default: MAPS_URL_DEFAULTS.charMode },
  { key: "colorEncoding", token: "E", type: { kind: "enum", values: COLOR_ENCODING_VALUES }, default: MAPS_URL_DEFAULTS.colorEncoding },
  { key: "useColors", token: "u", type: { kind: "bool" }, default: MAPS_URL_DEFAULTS.useColors },
  { key: "density", token: "d", type: { kind: "float", step: 0.1 }, default: MAPS_URL_DEFAULTS.density },
  { key: "smoothShading", token: "S", type: { kind: "bool" }, default: MAPS_URL_DEFAULTS.smoothShading },
  { key: "creaseAngle", token: "C", type: { kind: "float", step: 1 }, default: MAPS_URL_DEFAULTS.creaseAngle },
  { key: "lightAzimuth", token: "a", type: { kind: "float", step: 1 }, default: MAPS_URL_DEFAULTS.lightAzimuth },
  { key: "lightElevation", token: "v", type: { kind: "float", step: 1 }, default: MAPS_URL_DEFAULTS.lightElevation },
  { key: "lightIntensity", token: "k", type: { kind: "float", step: 0.05 }, default: MAPS_URL_DEFAULTS.lightIntensity },
  { key: "lightColor", token: "K", type: { kind: "color" }, default: MAPS_URL_DEFAULTS.lightColor },
  { key: "ambientIntensity", token: "i", type: { kind: "float", step: 0.05 }, default: MAPS_URL_DEFAULTS.ambientIntensity },
  { key: "ambientColor", token: "A", type: { kind: "color" }, default: MAPS_URL_DEFAULTS.ambientColor },
];

export const MAPS_SCHEMA_VERSION = "1";
export const MAPS_PARAM = "m";
export const mapsCodec = createUrlCodec<MapsUrlState>(MAPS_SCHEMA_VERSION, mapsFields);

export function readInitialMapsState(): MapsUrlState {
  const decoded = mapsCodec.decode(readUrlParam(MAPS_PARAM));
  return { ...MAPS_URL_DEFAULTS, ...decoded };
}

export function writeMapsUrlState(state: MapsUrlState): void {
  scheduleCompactedUrlWrite(mapsCodec, MAPS_PARAM, state);
}
