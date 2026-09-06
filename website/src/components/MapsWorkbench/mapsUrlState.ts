/**
 * `/maps`'s compact single-query-param URL state, built on the shared codec
 * (`website/src/lib/urlState.ts` — the same packing rules `/gallery`,
 * `/synth` and `/wordart` use). The page has since grown a short version
 * migration chain of its own (`mapsCodecLegacyV1`/`mapsCodecLegacyV2` below)
 * as fields were retired — smaller than `synthUrlState.ts`'s, but the same
 * shape: dispatch on the packed string's version tag, never on decoded
 * values.
 */
import { createUrlCodec, readUrlParam, scheduleCompactedUrlWrite, type UrlField } from "../../lib/urlState";
import { defaultGlyphColorEncoding } from "../../lib/glyphColorEncodingDefault";
import { DEFAULT_MAP_LIGHTING, type MapLayerRenderMode, type MapLighting, type MapPaletteName, type MapProjectionId, type MapSunMode } from "./mapsKit";

// Includes "calibrated" — `DockRendering`'s glyph-palette dropdown always
// offers it (registered as a side effect of importing that folder, see
// `calibratedPalette.ts`), so the callback's partial can legally carry it.
export type MapGlyphPalette = "default" | "ascii" | "lines" | "blocks" | "stars" | "arrows" | "math" | "binary" | "hex" | "calibrated";
export type MapCharMode = "ascii" | "halfblock" | "quadrant";
export type MapColorEncoding = "spans" | "atlas";

export interface MapsUrlState {
  projection: MapProjectionId;
  exaggeration: number;
  centerLon: number;
  centerLat: number;
  span: number;
  tilt: number;
  palette: MapPaletteName;
  glyphPalette: MapGlyphPalette;
  charMode: MapCharMode;
  colorEncoding: MapColorEncoding;
  useColors: boolean;
  density: number;
  smoothShading: boolean;
  lightAzimuth: number;
  lightElevation: number;
  lightIntensity: number;
  lightColor: string;
  ambientIntensity: number;
  ambientColor: string;
  sunMode: MapSunMode;
  /** Manual-sun day of year, 1-366. Only meaningful when `sunMode === "manual"`. */
  sunDay: number;
  /** Manual-sun UTC hour, 0-24. Only meaningful when `sunMode === "manual"`. */
  sunHour: number;
  /**
   * The contour layer's elevation WINDOW in metres
   * (`GlyphMapContourLayer.minElevation`/`maxElevation`).
   *
   * The live control is `number | null` (null = that end is unbounded), and
   * the codec has no null: `MAPS_CONTOUR_WINDOW_OFF` is the sentinel each
   * unbounded end packs as, chosen far outside any terrestrial elevation so
   * it can never collide with a real choice. Because it is also each field's
   * DEFAULT, an untouched window costs zero characters — a link that carries
   * neither token decodes to "no window", which is the pre-window behaviour
   * exactly.
   */
  contourFloor: number;
  contourCeiling: number;
}

/** The sentinel a `null` (unbounded) contour-window end packs as — see `MapsUrlState.contourFloor`. */
export const MAPS_CONTOUR_WINDOW_OFF = { min: -32000, max: 32000 } as const;

export const MAPS_URL_DEFAULTS: MapsUrlState = {
  projection: "globe",
  exaggeration: 24,
  centerLon: 0,
  centerLat: 20,
  span: 140,
  tilt: 40,
  palette: "terrain",
  glyphPalette: "default",
  charMode: "ascii",
  // Deliberately "spans", NOT the feature-detected default — this is the
  // codec's OMISSION SENTINEL (mirrors `synthUrlState.ts`'s
  // `SYNTH_URL_DEFAULTS.colorEncoding` doc verbatim): a browser-dependent
  // sentinel would make the same patch encode differently per engine, so a
  // link shared from a supporting browser would decode wrong on one that
  // isn't. `readInitialMapsState` below applies the real, feature-detected
  // default (`defaultGlyphColorEncoding`), same as `/synth`/`/gallery`/
  // `/wordart`, but only when the URL carries no explicit choice — read from
  // the raw DECODED PARTIAL, never from this merged-defaults object, so an
  // explicit `?`-URL value always wins.
  colorEncoding: "spans",
  useColors: true,
  density: 1,
  smoothShading: false,
  lightAzimuth: DEFAULT_MAP_LIGHTING.lightAzimuth,
  lightElevation: DEFAULT_MAP_LIGHTING.lightElevation,
  lightIntensity: DEFAULT_MAP_LIGHTING.lightIntensity,
  lightColor: DEFAULT_MAP_LIGHTING.lightColor,
  ambientIntensity: DEFAULT_MAP_LIGHTING.ambientIntensity,
  ambientColor: DEFAULT_MAP_LIGHTING.ambientColor,
  // "off" is the UI's "Full" — the pre-existing lighting exactly, so an
  // existing link (which carries no sun token at all) decodes to the same
  // render it always did.
  sunMode: "off",
  // June solstice noon UTC: a manual sun the user has not yet moved lands on
  // the most legible terminator of the year rather than an arbitrary one.
  sunDay: 172,
  sunHour: 12,
  contourFloor: MAPS_CONTOUR_WINDOW_OFF.min,
  contourCeiling: MAPS_CONTOUR_WINDOW_OFF.max,
};

// `"orthographic"` (index 3) was a real, offered `MapProjectionId` before
// the /maps projection picker dropped it — a previously-shared link can
// still carry that encoded index. It stays HERE, decode-only (this array's
// type is deliberately the codec's own loose `readonly string[]`, not
// `readonly MapProjectionId[]` — the current type no longer has room for
// it), so the enum's positional indices don't shift: `decodePackedEnum`
// looks a decoded index up in THIS array, and `decodePacked`'s "unknown
// token: stop, keep what's parsed" short-circuit (urlState.ts) fires the
// SAME way for an out-of-range enum INDEX as for a genuinely unknown token
// — it isn't just this field that reverts to default, every token ordered
// after it in the packed string never gets a chance to decode either, since
// `projection` is this schema's very FIRST field. Silently dropping
// "orthographic" from this list would take a legacy orthographic link's
// entire state back to schema defaults, not just its projection. Never
// offered by the picker and never produced by `buildMapProjection` again —
// `readInitialMapsState` below maps a decoded `"orthographic"` explicitly
// to the real default projection.
const PROJECTION_VALUES: readonly string[] = ["equirectangular", "mercator", "globe", "orthographic"];
const PALETTE_VALUES: readonly MapPaletteName[] = ["terrain", "viridis", "heat", "ocean", "grayscale", "mono"];
const RENDER_MODE_VALUES: readonly MapLayerRenderMode[] = ["wireframe", "solid", "ink"];
const GLYPH_PALETTE_VALUES: readonly MapGlyphPalette[] = ["default", "ascii", "lines", "blocks", "stars", "arrows", "math", "binary", "hex", "calibrated"];
// `"braille"` (index 1) was a real, offered `MapCharMode` before /maps
// dropped Braille from the character-mode picker (with Terrain pinned to
// solid, a binary 2x4 sub-cell dot mask can never carry solid mode's
// shading ramp — see `glyphMapCharModeAvailability.ts`'s old doc, now
// removed with the branch it explained). It stays HERE, decode-only, as a
// loose `readonly string[]` — not `readonly MapCharMode[]`, the current
// type no longer has room for it — for exactly the reason `PROJECTION_
// VALUES` keeps `"orthographic"` above: `decodePackedEnum` resolves by
// INDEX, so removing the string would shift `"halfblock"`/`"quadrant"`
// into `"braille"`'s old slot on any already-shared link. `readInitialMaps
// State` maps a decoded `"braille"` to the schema default explicitly,
// mirroring the projection fallback.
const CHAR_MODE_VALUES: readonly string[] = ["ascii", "braille", "halfblock", "quadrant"];
const COLOR_ENCODING_VALUES: readonly MapColorEncoding[] = ["spans", "atlas"];
const SUN_MODE_VALUES: readonly MapSunMode[] = ["off", "realtime", "manual"];

// `centerLon`/`centerLat` precision (v2+, see `MAPS_SCHEMA_VERSION`'s doc):
// derived from the deepest zoom the WIDGET's own camera can reach, not from
// terrain data resolution (the curated z7 tiles' ~0.015625 deg/sample is
// actually the LOOSER bound — the widget's `minSpan` of 0.001
// (packages/maps/src/widget.ts) lets the camera zoom well past what any
// baked terrain resolves, and it's that camera floor a shared link has to
// survive). At `span = minSpan` over the widget's base grid (160 cols —
// `MapsWorkbench.tsx`'s `cols: 160`, also `MapsWorkbench.atlasAvailability
// .real.test.ts`'s real-view fixture), one glyph cell covers `minSpan / 160
// = 6.25e-6` degrees. `GEO_STEP = 1e-6` gives a worst-case round-trip error
// (half the step) of `5e-7` degrees — about 8% of that cell, and about 5.5cm
// at the equator (`1e-6 deg * ~111,000 m/deg`) — small enough that a
// restored view never visibly drifts by even one cell at the tightest zoom
// the map can reach, while still costing the SAME base36 digit bucket as
// the old 0.1 step for most real-world coordinates (one extra digit at
// worst — measured in this fix's own commit).
const GEO_STEP = 1e-6;
// `span` precision (v2+): `span` ranges over `minSpan` (0.001) to the widest
// domain span (720, `packages/maps/src/widget.ts`'s `domainWidth`) — five
// decimal orders of magnitude. A single ABSOLUTE step is a poor fit across
// that range (fine enough for 0.001 wastes digits at 720; coarse enough for
// 720 can't even represent 0.001 — the OLD 0.1 step rounds anything below
// 0.05 to zero). `span` moves to the shared codec's `"logFloat"` kind
// instead: a fixed step in natural-log space is a fixed RELATIVE step in
// linear space, so precision (and encoded digit count) stays constant
// across the whole domain. `SPAN_LOG_STEP = 0.0005` gives a worst-case
// relative error of `exp(0.00025) - 1 ≈ 0.025%`: at `minSpan` that's an
// absolute error of ~2.5e-7 degrees (well under `GEO_STEP`'s own margin
// above), and at the widest span (720) it's ~0.18 degrees — utterly
// negligible against a near-global view. Every value in between costs the
// same ~3-4 base36 digits (`ln(0.001)..ln(720)` spans ~13.5 natural-log
// units; `13.5 / 0.0005 = 27,000` units, comfortably inside base36's 3-digit
// bucket, `36^3 = 46,656`) — see this fix's commit for the measured
// character counts at both ends.
const SPAN_LOG_STEP = 0.0005;

const mapsFields: readonly UrlField<MapsUrlState>[] = [
  { key: "projection", token: "p", type: { kind: "enum", values: PROJECTION_VALUES }, default: MAPS_URL_DEFAULTS.projection },
  { key: "exaggeration", token: "e", type: { kind: "float", step: 1 }, default: MAPS_URL_DEFAULTS.exaggeration },
  { key: "centerLon", token: "x", type: { kind: "float", step: GEO_STEP }, default: MAPS_URL_DEFAULTS.centerLon },
  { key: "centerLat", token: "y", type: { kind: "float", step: GEO_STEP }, default: MAPS_URL_DEFAULTS.centerLat },
  { key: "span", token: "s", type: { kind: "logFloat", step: SPAN_LOG_STEP }, default: MAPS_URL_DEFAULTS.span },
  { key: "tilt", token: "t", type: { kind: "float", step: 1 }, default: MAPS_URL_DEFAULTS.tilt },
  { key: "palette", token: "P", type: { kind: "enum", values: PALETTE_VALUES }, default: MAPS_URL_DEFAULTS.palette },
  { key: "glyphPalette", token: "g", type: { kind: "enum", values: GLYPH_PALETTE_VALUES }, default: MAPS_URL_DEFAULTS.glyphPalette },
  { key: "charMode", token: "c", type: { kind: "enum", values: CHAR_MODE_VALUES }, default: MAPS_URL_DEFAULTS.charMode },
  { key: "colorEncoding", token: "E", type: { kind: "enum", values: COLOR_ENCODING_VALUES }, default: MAPS_URL_DEFAULTS.colorEncoding },
  { key: "useColors", token: "u", type: { kind: "bool" }, default: MAPS_URL_DEFAULTS.useColors },
  { key: "density", token: "d", type: { kind: "float", step: 0.1 }, default: MAPS_URL_DEFAULTS.density },
  { key: "smoothShading", token: "S", type: { kind: "bool" }, default: MAPS_URL_DEFAULTS.smoothShading },
  { key: "lightAzimuth", token: "a", type: { kind: "float", step: 1 }, default: MAPS_URL_DEFAULTS.lightAzimuth },
  { key: "lightElevation", token: "v", type: { kind: "float", step: 1 }, default: MAPS_URL_DEFAULTS.lightElevation },
  { key: "lightIntensity", token: "k", type: { kind: "float", step: 0.05 }, default: MAPS_URL_DEFAULTS.lightIntensity },
  { key: "lightColor", token: "K", type: { kind: "color" }, default: MAPS_URL_DEFAULTS.lightColor },
  { key: "ambientIntensity", token: "i", type: { kind: "float", step: 0.05 }, default: MAPS_URL_DEFAULTS.ambientIntensity },
  { key: "ambientColor", token: "A", type: { kind: "color" }, default: MAPS_URL_DEFAULTS.ambientColor },
  // The codec is TOKEN-keyed, not positional, so appending these three at
  // the end is not what makes them safe for old links — a link that carries
  // none of them simply decodes each to its default above, which is the
  // pre-sun behaviour exactly.
  { key: "sunMode", token: "n", type: { kind: "enum", values: SUN_MODE_VALUES }, default: MAPS_URL_DEFAULTS.sunMode },
  { key: "sunDay", token: "j", type: { kind: "float", step: 1 }, default: MAPS_URL_DEFAULTS.sunDay },
  { key: "sunHour", token: "h", type: { kind: "float", step: 0.25 }, default: MAPS_URL_DEFAULTS.sunHour },
  // Appended for the same reason (and with the same consequence) as the sun
  // tokens above: token-keyed, so a link carrying neither decodes both to
  // `MAPS_CONTOUR_WINDOW_OFF` — no window, the pre-window render exactly.
  // No version bump: nothing was retired here, and v3's existing tokens all
  // still decode with their existing rules (contrast `terrainRenderMode`'s
  // removal below, which needed one). 10m steps are finer than the 50m the
  // control itself offers, so a persisted value round-trips exactly.
  { key: "contourFloor", token: "F", type: { kind: "float", step: 10 }, default: MAPS_URL_DEFAULTS.contourFloor },
  { key: "contourCeiling", token: "C", type: { kind: "float", step: 10 }, default: MAPS_URL_DEFAULTS.contourCeiling },
];

export const MAPS_SCHEMA_VERSION = "3";
export const MAPS_PARAM = "m";
export const mapsCodec = createUrlCodec<MapsUrlState>(MAPS_SCHEMA_VERSION, mapsFields);

// `terrainRenderMode` (token `m`) was retired when /maps removed the Terrain
// layer's render-mode control — a relief mesh never made sense as anything
// but `solid`. Unlike the `"orthographic"` VALUE retirement above, this is a
// whole FIELD retirement: there's no enum slot to keep occupied, so keeping
// old links safe means a version bump instead — a REAL "2"-tagged link can
// carry a genuine non-default `m=<wireframe|ink>`, and `decodePacked`'s
// "unknown token: stop" short-circuit would silently drop every field
// ordered after `m` on such a link the moment the live schema stopped
// recognizing the token at all.
//
// `MAPS_SCHEMA_VERSION` bumps 2 -> 3 for this field removal (distinct from
// the 1 -> 2 bump above, which was a wire-format-only change to three
// tokens' own encoding). `LegacyMapsUrlStateV2` + `legacyV2MapsFields`
// reconstruct exactly the v2 field list — this schema's current fields plus
// the retired one — so `mapsCodecLegacyV2` can still decode a "2"-tagged
// link in full; the decoded `terrainRenderMode` is simply not read by
// anything once merged (the control it drove no longer exists). Order in
// the reconstructed list doesn't matter — the codec is TOKEN-keyed, not
// positional — so it's appended rather than spliced back into its
// historical position.
type LegacyMapsUrlStateV2 = MapsUrlState & { terrainRenderMode: MapLayerRenderMode };
const legacyTerrainRenderModeField: UrlField<LegacyMapsUrlStateV2> = {
  key: "terrainRenderMode",
  token: "m",
  type: { kind: "enum", values: RENDER_MODE_VALUES },
  default: "solid",
};
const legacyV2MapsFields: readonly UrlField<LegacyMapsUrlStateV2>[] = [...mapsFields, legacyTerrainRenderModeField];
/** Decodes a "2"-tagged link (every link shared between the precision fix
 *  and the Terrain render-mode control's removal) with the field list that
 *  version was actually written with. Decode-only — every new write goes
 *  through `mapsCodec` (version "3"). See `legacyV2MapsFields`'s doc. */
export const mapsCodecLegacyV2 = createUrlCodec<LegacyMapsUrlStateV2>("2", legacyV2MapsFields);

const LEGACY_V1_GEO_STEP = 0.1;
const legacyV1MapsFields: readonly UrlField<LegacyMapsUrlStateV2>[] = legacyV2MapsFields.map((field) =>
  field.key === "centerLon" || field.key === "centerLat" || field.key === "span"
    ? { ...field, type: { kind: "float", step: LEGACY_V1_GEO_STEP } }
    : field,
);
/** Decodes a "1"-tagged link (every link shared before the precision fix)
 *  with the exact rules it was written with. Decode-only — every new write
 *  goes through `mapsCodec` (version "3"). See `MAPS_SCHEMA_VERSION`'s doc. */
export const mapsCodecLegacyV1 = createUrlCodec<LegacyMapsUrlStateV2>("1", legacyV1MapsFields);

/** Dispatches to the legacy codec bound to the link's own version tag, else
 *  the live (v3) codec — mirrors `synthUrlState.ts`'s `decodeOuterState`. */
function decodeMapsUrlState(raw: string | null | undefined): Partial<MapsUrlState> {
  if (raw && raw[1] === "1") return mapsCodecLegacyV1.decode(raw);
  if (raw && raw[1] === "2") return mapsCodecLegacyV2.decode(raw);
  return mapsCodec.decode(raw);
}

export function readInitialMapsState(): MapsUrlState {
  const decoded = decodeMapsUrlState(readUrlParam(MAPS_PARAM));
  // `decoded.projection` is typed `MapProjectionId`, but a legacy link can
  // still decode the retired `"orthographic"` value (see `PROJECTION_VALUES`'
  // doc above) — cast to read it before falling back, same explicit-mapping
  // shape `colorEncoding`'s own detected-default resolution uses below.
  const decodedProjection = decoded.projection as string | undefined;
  const projection: MapProjectionId = decodedProjection === "orthographic" ? MAPS_URL_DEFAULTS.projection : decoded.projection ?? MAPS_URL_DEFAULTS.projection;
  // `"braille"` (see `CHAR_MODE_VALUES`'s doc) is a decode-only legacy value
  // — /maps never offers it — mapped to the schema default the same way.
  const decodedCharMode = decoded.charMode as string | undefined;
  const charMode: MapCharMode = decodedCharMode === "braille" ? MAPS_URL_DEFAULTS.charMode : decoded.charMode ?? MAPS_URL_DEFAULTS.charMode;
  const state: Record<string, unknown> = {
    ...MAPS_URL_DEFAULTS,
    ...decoded,
    projection,
    charMode,
    // Feature-detected site default, applied only when the LINK carries no
    // choice (`decoded`, the raw partial — never the already-defaulted
    // merge) — see `MAPS_URL_DEFAULTS.colorEncoding`'s doc for why the
    // codec's own omission sentinel must stay the fixed "spans" instead.
    colorEncoding: decoded.colorEncoding ?? defaultGlyphColorEncoding(),
  };
  // `decoded` can carry the retired `terrainRenderMode` key at runtime when
  // it came from `mapsCodecLegacyV1`/`mapsCodecLegacyV2` (both still decode
  // token `m` — see `legacyV2MapsFields`'s doc) even though `MapsUrlState`
  // no longer declares it. Drop it explicitly rather than leaking a
  // structurally-invisible extra field into live state.
  delete state.terrainRenderMode;
  return state as MapsUrlState;
}

export function writeMapsUrlState(state: MapsUrlState): void {
  scheduleCompactedUrlWrite(mapsCodec, MAPS_PARAM, state);
}
