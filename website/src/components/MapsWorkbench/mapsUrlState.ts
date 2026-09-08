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
import { DEFAULT_MAP_LIGHTING, MAP_SCENE_RENDER_MODE, POINT_DATASET_DEFAULTS, type MapLayerRenderMode, type MapLighting, type MapPaletteName, type MapProjectionId, type MapSunMode, type PointDataset } from "./mapsKit";
import { MAP_OSM_DEFAULT_ANCHOR, MAP_OSM_DEFAULT_DENSITY, MAP_OSM_DEFAULT_ON, MAP_OSM_LABEL_ANCHORS, type MapOsmAnchors } from "./mapsOsm";

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
  /**
   * Camera HEADING, degrees, `[0, 360)` — the compass direction at the top of
   * the map (`GlyphMapHandle.getBearing()`). `0` (north up) is the default,
   * so a link from before this field existed decodes to exactly the map it
   * always showed.
   */
  bearing: number;
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
  /** Cast shadows (`GlyphMapHandle.setShadow`). Off by default — it is an extra pass, and it draws nothing at all without a layer that stands up off the ground. */
  shadows: boolean;
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

  // ── What is ON the map (as opposed to how it is drawn) ─────────────────
  //
  // Everything above describes the RENDER; a link carrying only those
  // restored the sender's exact viewpoint, palette, character mode and
  // lighting, and then drew whatever layers the READER's defaults mount.
  // That is a different map, which is the defect these fields close.

  /**
   * Which layers are mounted, as a bitfield over {@link MAPS_LAYER_KEYS}:
   * bit `i` set = that key's layer is visible.
   *
   * One token rather than ten: this is a boolean record over a known,
   * fixed key list, and ten `bool` fields would cost ten tokens and twenty
   * characters to say what four say here. The cost is that the KEY LIST is
   * now a wire format — see {@link MAPS_LAYER_KEYS} for the append-only
   * rule that follows from it.
   */
  layerMask: number;
  /** Which OpenStreetMap rows the OSM card mounts, as a bitfield over {@link MAPS_OSM_SUBLAYER_KEYS}. Same shape and same append-only rule as {@link layerMask}. */
  osmMask: number;

  /**
   * Per-layer glyph density (the 1..4 / 0.1 track every density row on the
   * page shares). One token each rather than a tuple: a tuple encodes every
   * slot the moment ANY slot moves, and the overwhelmingly common case is
   * one layer's density touched and five left alone.
   */
  terrainDensity: number;
  borderDensity: number;
  contourDensity: number;
  /**
   * The OSM card's MASTER density — the one number that is still true when
   * every row agrees.
   *
   * It is no longer the card's state (see {@link osmDensities}); it is kept,
   * written and decoded because it is in links already shared, and because a
   * uniform card has exactly one honest number to offer. A MIXED card writes
   * this at its default: no single float describes ten different ones, and
   * the codec omits a field at its default, so saying nothing costs nothing.
   */
  osmDensity: number;
  /**
   * One density per OSM row, positionally over
   * {@link MAPS_OSM_SUBLAYER_KEYS} — a fixed-width tuple, never a record, so
   * it packs as `MAPS_OSM_DENSITY_SLOTS` self-delimiting base36 numbers with
   * no key names on the wire.
   *
   * A tuple here, where the six per-LAYER densities above are one token
   * each, because the two have opposite common cases: those six are touched
   * one at a time, while the master gesture writes every one of these at once,
   * so a per-row token set would spend ten tokens to say what one says.
   */
  osmDensities: readonly number[];
  /**
   * The densities of the OSM rows PAST {@link osmDensities}' frozen ten,
   * positionally over the tail of {@link MAPS_OSM_SUBLAYER_KEYS} — token
   * `J`, width {@link MAPS_OSM_DENSITY_EXT_SLOTS}.
   *
   * A second token rather than a wider `M`: see
   * {@link MAPS_OSM_DENSITY_EXT_SLOTS}.
   */
  osmDensitiesExt: readonly number[];
  /**
   * Where each OSM row places its labels, as an INDEX into
   * {@link MAP_OSM_LABEL_ANCHORS} — positionally over
   * {@link MAPS_OSM_SUBLAYER_KEYS}, token `l`, width
   * {@link MAPS_OSM_ANCHOR_SLOTS}.
   *
   * A tuple over EVERY row, not over the labelled ones, even though only a
   * `symbol` row reads one. Which rows are labelled is a property of
   * `@glyphcss/maps`' row TYPES, and those move — `omt-peaks` was a `circle`
   * row and became a labelled `symbol` one — so a wire list keyed on that
   * set would be silently reinterpreted the next time a row changed type,
   * while a slot per row cannot be. The empty slots cost nothing: the whole
   * token is omitted while every row is centred, which is every link ever
   * shared and every untouched card.
   */
  osmLabelAnchors: readonly number[];
  fillDensity: number;
  extrusionDensity: number;

  /**
   * Which baked point dataset drives each point layer. Retiring one means
   * keeping its slot in {@link MAPS_POINT_DATASET_VALUES} decode-only and
   * remapping it in `readInitialMapsState`, exactly as `"orthographic"` is
   * handled — `decodePackedEnum` resolves by INDEX.
   */
  symbolDataset: PointDataset;
  circleDataset: PointDataset;
  heatmapDataset: PointDataset;

  /** The `model` layer's solid — a `MapModelShape` (`mapPin.ts`), typed loosely here so this file need not import the geometry registry. Same index-retirement rule as the datasets above. */
  modelShape: string;

  /** Contour spacing in metres. Step 1, not the slider's 100, because the card's readout accepts any integer in `[100, 2000]` un-snapped. */
  contourInterval: number;
  /** `GlyphMapContourLayer.labels` — elevations printed on every index contour. */
  contourLabels: boolean;

  /**
   * The two layers that actually offer a render-mode row. A wireframe cage
   * or an ink outline is a categorically different picture from a solid
   * one, which puts these in the same bucket as the layer being mounted at
   * all rather than in the per-layer COLOUR bucket the URL deliberately
   * does not carry.
   */
  extrusionRenderMode: MapLayerRenderMode;
  modelRenderMode: MapLayerRenderMode;

  /**
   * Street-level WALK mode (`GlyphMapHandle.setWalk`) — whether the link puts
   * the reader ON the ground rather than above the map.
   *
   * ONE flag, and that is the whole of it: a walker's POSE needs no token of
   * its own because walk mode reuses the widget's existing camera state
   * rather than adding any (`packages/maps/src/walk.ts`'s
   * `GLYPH_MAP_WALK_HORIZON_TILT_DEG` doc says so outright). `view.center` IS
   * where the walker stands ({@link centerLon}/{@link centerLat}), `bearing`
   * IS the heading they face ({@link bearing}), `getTilt()` IS their pitch
   * measured from the horizontal's 90 ({@link tilt}), and `view.span` is
   * pinned to the walker's own footprint while walking ({@link span}) — all
   * four already written by the page's existing view sync, per walk step and
   * per look. A second position/heading/pitch token would duplicate a field
   * that already round-trips.
   *
   * Restoring is GATED, never trusted: `mapsWalk.ts`' `mapWalkLinkEntry`
   * degrades a link that asks for a walk at a view where the mode is not
   * permitted (a flat sheet, or too far out) back to the ordinary map, since
   * `setWalk` itself throws on the first of those.
   */
  walk: boolean;
}

// ── Layer-content wire lists and their bitfields ──────────────────────────

/**
 * The layer-visibility bitfield's key order (token `L`). **APPEND-ONLY**, the
 * same rule the field-synth schema's key families live under (AGENTS.md,
 * "Stock effects"): bit `i` is `MAPS_LAYER_KEYS[i]` in every link ever
 * shared, so inserting, reordering or dropping a key silently reinterprets
 * them all. A key appended later is absent from an older link's mask and so
 * reads as OFF there — append rows that default off, or accept that.
 * `mapsUrlState.layers.test.ts` pins the order.
 */
export const MAPS_LAYER_KEYS = [
  "terrain", "borders", "contour", "osm",
  "fill", "symbol", "circle", "heatmap", "fill-extrusion", "model",
] as const;
export type MapsLayerKey = (typeof MAPS_LAYER_KEYS)[number];

/** Which layers the page mounts before any link says otherwise — terrain and borders, i.e. the map /maps has always opened on. */
export const MAPS_LAYER_DEFAULT_ON: readonly MapsLayerKey[] = ["terrain", "borders"];

/**
 * The OSM sublayer bitfield's key order (token `O`). Frozen here rather than
 * derived from `MAP_OSM_SUBLAYERS` (which is itself derived from
 * `@glyphcss/maps`' `GLYPH_MAP_OPENMAPTILES_LAYERS`) precisely because that
 * list is free to move and this one is not — same **APPEND-ONLY** rule as
 * {@link MAPS_LAYER_KEYS}. The cross-check that the two still agree lives in
 * `mapsUrlState.layers.test.ts`, so a package-side insertion goes red here
 * instead of quietly rewriting every shared link.
 */
export const MAPS_OSM_SUBLAYER_KEYS = [
  "omt-landcover", "omt-landuse", "omt-water", "omt-waterways", "omt-roads",
  "omt-buildings", "omt-boundaries", "omt-places", "omt-peaks", "omt-pois",
  // Appended when `@glyphcss/maps` grew rows for three OpenMapTiles source
  // layers it had never decoded (`park`, `aeroway`, `water_name`). Bits
  // 10-12 of the same `O` int, which has 31 of them — so no existing link
  // changes meaning, and a link written before this reads all three as OFF.
  "omt-parks", "omt-aeroways", "omt-water-labels",
] as const;

/** Wire order for the point-dataset enums — append-only for the same reason (`decodePackedEnum` resolves by index). */
export const MAPS_POINT_DATASET_VALUES: readonly PointDataset[] = ["countries", "places", "capitals", "megacities"];
/** Wire order for the `model` layer's shape enum — append-only, same reason. */
export const MAPS_MODEL_SHAPE_VALUES: readonly string[] = ["pyramid", "cone", "cube", "cylinder", "sphere", "icosahedron"];

function packBitmask(keys: readonly string[], on: Readonly<Record<string, boolean>>): number {
  let mask = 0;
  keys.forEach((key, i) => { if (on[key]) mask |= 1 << i; });
  return mask;
}

function unpackBitmask<K extends string>(keys: readonly K[], mask: number): Record<K, boolean> {
  return Object.fromEntries(keys.map((key, i) => [key, ((mask >>> i) & 1) === 1])) as Record<K, boolean>;
}

/** Pack the page's layer-visibility record into {@link MapsUrlState.layerMask}. Keys outside the wire list are ignored; keys missing from the record pack as off. */
export function mapsLayerMaskFromVisibility(visible: Readonly<Record<string, boolean>>): number {
  return packBitmask(MAPS_LAYER_KEYS, visible);
}
/** The inverse of {@link mapsLayerMaskFromVisibility} — always a complete record over {@link MAPS_LAYER_KEYS}. */
export function mapsLayerVisibilityFromMask(mask: number): Record<MapsLayerKey, boolean> {
  return unpackBitmask(MAPS_LAYER_KEYS, mask);
}
/** Pack the OSM card's row record into {@link MapsUrlState.osmMask}. */
export function mapsOsmMaskFromSublayers(on: Readonly<Record<string, boolean>>): number {
  return packBitmask(MAPS_OSM_SUBLAYER_KEYS, on);
}
/** The inverse of {@link mapsOsmMaskFromSublayers}. */
export function mapsOsmSublayersFromMask(mask: number): Record<string, boolean> {
  return unpackBitmask(MAPS_OSM_SUBLAYER_KEYS, mask);
}

/**
 * The per-row density tuple's FROZEN width (token `M`).
 *
 * Unlike the bitfield beside it — which has 31 bits of headroom, so
 * appending a row costs nothing — a `floatTuple` reads exactly this many
 * slots and then hands the cursor to the next token. The width is therefore
 * itself the wire format: appending an eleventh row and widening this in
 * place would make every already-shared `M` link decode the token AFTER it
 * as a density, and `decodePacked` would strand everything from there on.
 * `mapsUrlState.osmDensity.test.ts` asserts this width plus
 * {@link MAPS_OSM_DENSITY_EXT_SLOTS} still covers the row list exactly, so a
 * package-side insertion goes red here — the same treatment
 * `MAPS_OSM_SUBLAYER_KEYS`' own cross-check gets — rather than quietly
 * rewriting every shared link. Growing past it means a NEW token (or a
 * version bump), not a wider one: that is what `J` is, and a fourteenth row
 * means a third token on the same rule.
 */
export const MAPS_OSM_DENSITY_SLOTS = 10;

/**
 * The SECOND density tuple's frozen width (token `J`) — the OSM rows past
 * {@link MAPS_OSM_DENSITY_SLOTS}.
 *
 * When `@glyphcss/maps` grew rows for `park`, `aeroway` and `water_name`,
 * the row list went past `M`'s frozen ten. Widening `M` in place was never
 * available: a `floatTuple` reads its declared width and then hands the
 * cursor to the next token, so an eleven-slot `M` would read every
 * already-shared ten-slot link's FOLLOWING token as a density and strand
 * every field from there on. A NEW token instead leaves `M` meaning exactly
 * what it always meant — the first ten rows, in the first ten rows' order —
 * and costs a legacy link nothing, since it carries no `J` and every
 * appended row therefore opens at 1x.
 *
 * Frozen at THREE rather than given headroom, for the reason `M` is frozen
 * at ten: the width is the wire format either way, so spare slots would only
 * move the same breakage to a fourteenth row while charging every `J`-
 * carrying link for the empties. A fourteenth row means another token, and
 * `mapsUrlState.osmDensity.test.ts` asserts the two widths sum to the row
 * count so the breach is loud.
 */
export const MAPS_OSM_DENSITY_EXT_SLOTS = 3;

/** Pack the FIRST ten rows' densities into {@link MapsUrlState.osmDensities}. A row the record does not carry packs at the 1x default. */
export function mapsOsmDensitiesFromRecord(densities: Readonly<Record<string, number>>): number[] {
  return MAPS_OSM_SUBLAYER_KEYS.slice(0, MAPS_OSM_DENSITY_SLOTS).map((key) => densities[key] ?? MAP_OSM_DEFAULT_DENSITY);
}
/** Pack the rows PAST the frozen ten into {@link MapsUrlState.osmDensitiesExt}. Same rule, second token. */
export function mapsOsmDensitiesExtFromRecord(densities: Readonly<Record<string, number>>): number[] {
  return MAPS_OSM_SUBLAYER_KEYS.slice(MAPS_OSM_DENSITY_SLOTS).map((key) => densities[key] ?? MAP_OSM_DEFAULT_DENSITY);
}
/** The inverse of the two packers — always a complete record over {@link MAPS_OSM_SUBLAYER_KEYS}, from both tokens together. */
export function mapsOsmDensityRecordFromTuple(tuple: readonly number[], ext: readonly number[] = []): Record<string, number> {
  const all = [...tuple.slice(0, MAPS_OSM_DENSITY_SLOTS), ...ext];
  return Object.fromEntries(MAPS_OSM_SUBLAYER_KEYS.map((key, i) => [key, all[i] ?? MAP_OSM_DEFAULT_DENSITY]));
}

/**
 * The per-row label-anchor tuple's FROZEN width (token `l`).
 *
 * One slot per OSM row, and frozen for the reason
 * {@link MAPS_OSM_DENSITY_SLOTS} is: a `floatTuple` reads exactly this many
 * slots and then hands the cursor to the next token, so the width IS the
 * wire format and widening it in place would make every already-shared `l`
 * link decode the token AFTER it as an anchor. A fourteenth row means a
 * SECOND token on the same rule — which is what `J` is to `M` —
 * and `mapsUrlState.osmLabels.test.ts` asserts this width still covers the
 * row list exactly, so the breach is loud.
 *
 * Thirteen rather than ten, unlike `M`: `M` was frozen before the row list
 * grew past it, and this token is being introduced after. Nothing is gained
 * by starting it short.
 */
export const MAPS_OSM_ANCHOR_SLOTS = 13;

/**
 * Pack the card's placement record into {@link MapsUrlState.osmLabelAnchors}.
 *
 * A row the record does not carry — and a row naming an anchor the
 * vocabulary does not hold — packs at slot `0`, the centred default. Slot
 * `0` is what the whole token being omitted decodes to, so "unknown" and
 * "untouched" produce the same link rather than a different one.
 */
export function mapsOsmAnchorsFromRecord(anchors: Readonly<Record<string, string>>): number[] {
  return MAPS_OSM_SUBLAYER_KEYS.map((key) => {
    const index = MAP_OSM_LABEL_ANCHORS.indexOf(anchors[key] as (typeof MAP_OSM_LABEL_ANCHORS)[number]);
    return index < 0 ? 0 : index;
  });
}

/**
 * The inverse — always a complete record over {@link MAPS_OSM_SUBLAYER_KEYS}.
 *
 * A short tuple (a hand-edited link) and a slot naming an index the
 * vocabulary does not have (a link written by a build that appended an
 * anchor) both resolve to {@link MAP_OSM_DEFAULT_ANCHOR} rather than to
 * `undefined`: the widget would read an absent anchor as its own centred
 * default anyway, so resolving it here keeps the page's state honest about
 * what is actually mounted.
 */
export function mapsOsmAnchorRecordFromTuple(tuple: readonly number[]): MapOsmAnchors {
  return Object.fromEntries(MAPS_OSM_SUBLAYER_KEYS.map((key, i) => [
    key,
    MAP_OSM_LABEL_ANCHORS[tuple[i] as number] ?? MAP_OSM_DEFAULT_ANCHOR,
  ]));
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
  bearing: 0,
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
  // Off, like the widget's own default: shadows cost a pass, and a link
  // written before this token existed carries no `D` and decodes to exactly
  // the map it always described.
  shadows: false,
  contourFloor: MAPS_CONTOUR_WINDOW_OFF.min,
  contourCeiling: MAPS_CONTOUR_WINDOW_OFF.max,
  // Every layer-content default below is READ from the page's own constant
  // rather than restated, so the "a link carrying no token renders exactly
  // what the untouched page renders" property cannot drift: the codec omits
  // a field at its default, so these values ARE what an old link decodes to.
  layerMask: MAPS_LAYER_KEYS.reduce((mask, key, i) => (MAPS_LAYER_DEFAULT_ON.includes(key) ? mask | (1 << i) : mask), 0),
  osmMask: MAPS_OSM_SUBLAYER_KEYS.reduce((mask, key, i) => (MAP_OSM_DEFAULT_ON.includes(key) ? mask | (1 << i) : mask), 0),
  terrainDensity: 1,
  borderDensity: 1,
  contourDensity: 1,
  osmDensity: MAP_OSM_DEFAULT_DENSITY,
  osmDensities: Array(MAPS_OSM_DENSITY_SLOTS).fill(MAP_OSM_DEFAULT_DENSITY),
  osmDensitiesExt: Array(MAPS_OSM_DENSITY_EXT_SLOTS).fill(MAP_OSM_DEFAULT_DENSITY),
  // Slot 0 is `MAP_OSM_LABEL_ANCHORS[0]` — `"center"`, the placement a
  // `symbol` layer has always drawn.
  osmLabelAnchors: Array(MAPS_OSM_ANCHOR_SLOTS).fill(0),
  fillDensity: 1,
  extrusionDensity: 1,
  symbolDataset: POINT_DATASET_DEFAULTS.symbol,
  circleDataset: POINT_DATASET_DEFAULTS.circle,
  heatmapDataset: POINT_DATASET_DEFAULTS.heatmap,
  modelShape: "pyramid",
  contourInterval: 1000,
  contourLabels: false,
  extrusionRenderMode: MAP_SCENE_RENDER_MODE,
  modelRenderMode: MAP_SCENE_RENDER_MODE,
  // Off, so a link that carries no `w` opens the map — which is what every
  // link ever shared describes, and what a reader expects a map link to be.
  walk: false,
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
  // Appended, and for the third time with the same consequence: the codec is
  // TOKEN-keyed, so a link carrying no `b` decodes to `0` — north up, the map
  // every existing link already describes. No version bump: nothing was
  // retired. A 1-degree step matches the slider's own, so a shared heading
  // round-trips exactly.
  { key: "bearing", token: "b", type: { kind: "float", step: 1 }, default: MAPS_URL_DEFAULTS.bearing },
  // Appended beside the sun tokens it belongs with, and safe for the same
  // reason: TOKEN-keyed, so a link carrying no `D` decodes to `false` — no
  // shadow pass, byte-identical to every link written before it. No version
  // bump; nothing was retired. `D` because `S`/`s` are both already spoken
  // for (`smoothShading`, `span`).
  { key: "shadows", token: "D", type: { kind: "bool" }, default: MAPS_URL_DEFAULTS.shadows },
  { key: "contourFloor", token: "F", type: { kind: "float", step: 10 }, default: MAPS_URL_DEFAULTS.contourFloor },
  { key: "contourCeiling", token: "C", type: { kind: "float", step: 10 }, default: MAPS_URL_DEFAULTS.contourCeiling },
  // ── Layer CONTENT. Appended, and for the fourth time with the same
  //    consequence: the codec is TOKEN-keyed, so a link carrying none of
  //    these decodes every one to its default above — terrain and borders
  //    on, the OSM card's own four rows armed but the card itself off, every
  //    density at 1x, each point layer on its own default dataset. That is
  //    the page exactly as it rendered before these tokens existed, so NO
  //    version bump: nothing here was retired, and every v3 token still
  //    decodes with its existing rules (contrast `terrainRenderMode`'s
  //    removal below, which needed one).
  //
  //    Deliberately NOT here: every per-layer COLOUR (background, borders,
  //    contour, and the six demo layers). Nine `"color"` fields would add
  //    ~54 characters to a link that carries them, they are one click each
  //    to re-pick, and they change the tint of something the reader can
  //    already see rather than whether they can see it at all. Nor are the
  //    demo layers' magnitude sliders (min-pop, radii, extrusion/model
  //    heights, heat threshold): eight more numeric tokens tuning layers
  //    that are off by default. A URL that carries the whole UI is its own
  //    failure.
  { key: "layerMask", token: "L", type: { kind: "int" }, default: MAPS_URL_DEFAULTS.layerMask },
  { key: "osmMask", token: "O", type: { kind: "int" }, default: MAPS_URL_DEFAULTS.osmMask },
  { key: "terrainDensity", token: "T", type: { kind: "float", step: 0.1 }, default: MAPS_URL_DEFAULTS.terrainDensity },
  { key: "borderDensity", token: "B", type: { kind: "float", step: 0.1 }, default: MAPS_URL_DEFAULTS.borderDensity },
  { key: "contourDensity", token: "N", type: { kind: "float", step: 0.1 }, default: MAPS_URL_DEFAULTS.contourDensity },
  { key: "osmDensity", token: "Q", type: { kind: "float", step: 0.1 }, default: MAPS_URL_DEFAULTS.osmDensity },
  { key: "fillDensity", token: "W", type: { kind: "float", step: 0.1 }, default: MAPS_URL_DEFAULTS.fillDensity },
  { key: "extrusionDensity", token: "X", type: { kind: "float", step: 0.1 }, default: MAPS_URL_DEFAULTS.extrusionDensity },
  { key: "symbolDataset", token: "Y", type: { kind: "enum", values: MAPS_POINT_DATASET_VALUES }, default: MAPS_URL_DEFAULTS.symbolDataset },
  { key: "circleDataset", token: "Z", type: { kind: "enum", values: MAPS_POINT_DATASET_VALUES }, default: MAPS_URL_DEFAULTS.circleDataset },
  { key: "heatmapDataset", token: "H", type: { kind: "enum", values: MAPS_POINT_DATASET_VALUES }, default: MAPS_URL_DEFAULTS.heatmapDataset },
  { key: "modelShape", token: "G", type: { kind: "enum", values: MAPS_MODEL_SHAPE_VALUES }, default: MAPS_URL_DEFAULTS.modelShape },
  { key: "contourInterval", token: "I", type: { kind: "float", step: 1 }, default: MAPS_URL_DEFAULTS.contourInterval },
  { key: "contourLabels", token: "R", type: { kind: "bool" }, default: MAPS_URL_DEFAULTS.contourLabels },
  { key: "extrusionRenderMode", token: "U", type: { kind: "enum", values: RENDER_MODE_VALUES }, default: MAPS_URL_DEFAULTS.extrusionRenderMode },
  { key: "modelRenderMode", token: "V", type: { kind: "enum", values: RENDER_MODE_VALUES }, default: MAPS_URL_DEFAULTS.modelRenderMode },
  // ── The OSM card's PER-ROW densities. Appended LAST on purpose, and for
  //    the fifth time with the same consequence: the codec is TOKEN-keyed,
  //    so a link carrying no `M` decodes to every row at 1x — and
  //    `readInitialMapsState` then seeds them from whatever `Q` that link
  //    does carry, which is the map it described (one number, applied to
  //    every enabled row, is exactly what the card did then). No version
  //    bump: nothing was retired, `Q` still decodes with its existing rules,
  //    and `M` is a token no v1/v2/v3 link has ever contained.
  //
  //    LAST, rather than beside `Q`, because `decodePacked` stops at the
  //    first token it does not recognize: a link written here and opened by
  //    a not-yet-updated build strands every field ordered AFTER `M`, and
  //    there is nothing after it.
  //
  //    `M` (not `m`): the token map is case-sensitive, and lowercase `m` is
  //    the RETIRED `terrainRenderMode` token that `mapsCodecLegacyV2` still
  //    decodes.
  { key: "osmDensities", token: "M", type: { kind: "floatTuple", length: MAPS_OSM_DENSITY_SLOTS, step: 0.1 }, default: MAPS_URL_DEFAULTS.osmDensities },
  // ── WALK MODE. Appended after `M`, and for the sixth time with the same
  //    consequence: the codec is TOKEN-keyed, so a link carrying no `w`
  //    decodes to `false` — the map above the ground, which is every link
  //    ever shared. No version bump: nothing was retired, and `M` still
  //    decodes with its existing rules.
  //
  //    LAST for the reason `M`'s own doc gives — `decodePacked` stops at the
  //    first token it does not recognize, so a link written here and opened
  //    by a not-yet-updated build strands only what is ordered after it, and
  //    there is nothing after it. `M` was that token until now, which is why
  //    this goes AFTER it rather than before.
  //
  //    `w` (not `W`, which is `fillDensity`): the token map is
  //    case-sensitive, the same clause `M`/`m` already carry.
  //
  //    Deliberately NOT joined by a walk POSITION, HEADING or PITCH token —
  //    see `MapsUrlState.walk`. Nor by the walk OPTIONS (eye height, FOV,
  //    speed, horizon): the page offers no control for any of them, so a
  //    token would encode a constant.
  { key: "walk", token: "w", type: { kind: "bool" }, default: MAPS_URL_DEFAULTS.walk },
  // ── The OSM rows PAST `M`'s frozen ten. Appended after `w`, and for the
  //    seventh time with the same consequence: the codec is TOKEN-keyed, so
  //    a link carrying no `J` decodes to every appended row at 1x, and `M`
  //    still decodes character-for-character as it always did. No version
  //    bump; nothing was retired.
  //
  //    LAST, for the reason `M` and `w` both give — `decodePacked` stops at
  //    the first token it does not recognize, so a link written here and
  //    opened by a not-yet-updated build strands only what is ordered after
  //    it, and there is nothing after it. `w` was that token until now.
  //
  //    A NEW token rather than a wider `M`: a `floatTuple` reads its
  //    declared width and hands the cursor on, so widening `M` would make
  //    every already-shared `M` link decode the token AFTER it as a density.
  //    See `MAPS_OSM_DENSITY_EXT_SLOTS`.
  //
  //    `J` (not `j`, which is `sunDay`): the token map is case-sensitive,
  //    the same clause `M`/`m` and `w`/`W` already carry. It is the one
  //    upper-case letter the schema had left.
  { key: "osmDensitiesExt", token: "J", type: { kind: "floatTuple", length: MAPS_OSM_DENSITY_EXT_SLOTS, step: 0.1 }, default: MAPS_URL_DEFAULTS.osmDensitiesExt },
  // ── The OSM card's PER-ROW LABEL ANCHORS. Appended after `J`, and for the
  //    eighth time with the same consequence: the codec is TOKEN-keyed, so a
  //    link carrying no `l` decodes to every row centred — which is every
  //    link ever shared, since this is the placement a `symbol` layer has
  //    always drawn. No version bump; nothing was retired, and `M`/`J` still
  //    decode character-for-character.
  //
  //    LAST, for the reason `M`, `w` and `J` each give — `decodePacked`
  //    stops at the first token it does not recognize, so a link written
  //    here and opened by a not-yet-updated build strands only what is
  //    ordered after it, and there is nothing after it. `J` was that token
  //    until now.
  //
  //    A `floatTuple` at step 1 rather than a new codec kind: the slot holds
  //    an INDEX into `MAP_OSM_LABEL_ANCHORS`, which is an integer, and the
  //    existing tuple kind already packs one self-delimiting base36 number
  //    per slot. That makes the anchor LIST a wire format too, on the same
  //    append-only rule as `MAPS_OSM_SUBLAYER_KEYS` — pinned in
  //    `mapsUrlState.osmLabels.test.ts`.
  //
  //    `l` (not `L`, which is `layerMask`): the token map is case-sensitive,
  //    the same clause `M`/`m`, `w`/`W` and `J`/`j` already carry. Every
  //    upper-case letter was spent by `J`.
  { key: "osmLabelAnchors", token: "l", type: { kind: "floatTuple", length: MAPS_OSM_ANCHOR_SLOTS, step: 1 }, default: MAPS_URL_DEFAULTS.osmLabelAnchors },
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
    // A link from before the OSM card had per-row densities carries `Q` and
    // no `M`. `Q` was applied to EVERY enabled row when that link was
    // written, so seeding every row with it is not a fallback — it is the
    // map the link describes, restored exactly. Read from the raw DECODED
    // partial (never the merged defaults) for the same reason
    // `colorEncoding` above is: an explicit `M` must win over the `Q` a
    // newer link carries beside it.
    osmDensities: decoded.osmDensities
      ?? Array(MAPS_OSM_DENSITY_SLOTS).fill(decoded.osmDensity ?? MAPS_URL_DEFAULTS.osmDensity),
    // Same seeding rule, second token: a `Q`-only link meant one number
    // applied to every enabled row, and the rows appended since are rows.
    osmDensitiesExt: decoded.osmDensitiesExt
      ?? Array(MAPS_OSM_DENSITY_EXT_SLOTS).fill(decoded.osmDensity ?? MAPS_URL_DEFAULTS.osmDensity),
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
