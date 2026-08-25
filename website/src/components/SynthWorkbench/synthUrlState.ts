// /synth's compact single-query-param URL state, built on the shared codec
// (website/src/lib/urlState.ts) — same packing rules /gallery and /wordart
// use. Replaces the old base64url(JSON) `?s=` param: base64 inflates a short
// packed string by ~33% for nothing (see urlState.ts's file header for the
// measurement) — the field-synth patch (shape, up to 6 voices, lighting) is
// exactly a `GlyphEffectParamSchema`, so its packing reuses the SAME generic
// `encodeEffectParamsPacked`/`decodeEffectParamsPacked` gallery/wordart use
// for effect-layer overrides, applied here to the whole patch instead of a
// diff against one mounted effect.
import {
  GLYPH_FIELD_SYNTH_VALIDATION_RULES,
  GlyphFieldSynthEffect as fieldSynth,
  SYNTH_VOICES,
  defaultGlyphEffectParams,
  type GlyphFieldSynthValidationError,
  type GlyphFieldSynthValidationRuleId,
} from "@glyphcss/effects";
import {
  createUrlCodec,
  decodeEffectParamsPacked,
  decodeEffectParamsPackedLegacy,
  encodeEffectParamsPacked,
  readUrlParam,
  scheduleCompactedUrlWrite,
  type EffectParamSchemaLike,
  type UrlField,
} from "../../lib/urlState";

export interface Lighting {
  azimuth: number;
  elevation: number;
  keyIntensity: number;
  keyColor: string;
  ambient: number;
}

export const DEFAULT_LIGHTING: Lighting = { azimuth: 40, elevation: 38, keyIntensity: 1.1, keyColor: "#ffffff", ambient: 0.5 };

// Append-only (VOLUMETRIC-2.md §3): this array is encoded by INDEX in the
// packed `?s=` URL param, so a new entry must go at the end — never
// inserted. Keep in sync with synthKit.tsx's own duplicate `SHAPES` array.
const SHAPES = ["plane", "cube", "sphere", "icosahedron", "dodecahedron", "octahedron", "cylinder", "cone", "torus", "tetrahedron", "pyramid"] as const;
// The website's single source of truth for the voice-count cap — imported
// from `@glyphcss/effects`'s own `SYNTH_VOICES` (VOLUMETRIC-3.md §4 bumped
// it 6 -> 9), not an independently hardcoded duplicate. `synthKit.tsx`
// re-exports this same binding as `MAX_VOICES` rather than declaring its own
// second `= 9` literal.
export const MAX_VOICES = SYNTH_VOICES;

export type Params = Record<string, number | string | boolean>;

function synthDefaults(): Params {
  const { time: _time, ...rest } = defaultGlyphEffectParams(fieldSynth) as Params;
  return rest;
}
export const SYNTH_PARAM_DEFAULTS: Params = { ...synthDefaults(), voiceColors: true };

/** Which oscillator slots have a CARD (exist), independent of amp — packed
 *  as a `MAX_VOICES`-bit mask via the shared `{ kind: "int" }` packed-number
 *  codec (self-terminating base36, so the 9-bit mask VOLUMETRIC-3.md §4's
 *  voice bump needs — up to 511, 2 base36 chars — round-trips exactly like
 *  the smaller 6-bit mask did before it). */
function encodeVoiceSlots(slots: readonly number[]): number {
  let mask = 0;
  for (const slot of slots) mask |= 1 << (slot - 1);
  return mask;
}
function decodeVoiceSlots(mask: number): number[] {
  const slots: number[] = [];
  for (let i = 0; i < MAX_VOICES; i++) if (mask & (1 << i)) slots.push(i + 1);
  return slots;
}

export interface SynthUrlState {
  shape: string;
  timeScale: number;
  density: number;
  voiceSlotMask: number;
  lightAzimuth: number;
  lightElevation: number;
  lightKeyIntensity: number;
  lightKeyColor: string;
  lightAmbient: number;
  /** Run-extension colour-merge tolerance (COLOR-TOLERANCE.md Phase 4) — a
   *  SCENE option (`scene.setOptions({ colorTolerance })`), not a field-synth
   *  effect param, so it's an outer field here rather than living inside
   *  `paramsPacked`. Replaces the removed `colorQuantize` effect param as the
   *  page's one performance lever (see synthKit.tsx's Output-folder slider) —
   *  persisted the same way `density` is: it's a shareable rendering/
   *  performance setting a recipient's link should reproduce, not ephemeral
   *  UI state. Outer fields are keyed by TOKEN, not position (`byToken.get`
   *  in ../../lib/urlState.ts), so adding this new "c" token is safe for
   *  every existing link regardless of `SYNTH_SCHEMA_VERSION` — only the
   *  nested `paramsPacked` payload decodes positionally (see the version-
   *  bump doc below, which is about `colorQuantize`'s removal, not this). */
  colorTolerance: number;
  /** `glyphcss` scene option — `"spans"` (default) or `"atlas"` (zero-`<span>`
   *  colour-font encoding). The atlas palette itself is never persisted:
   *  `glyphcss` derives and pools it internally from the real cell buffers,
   *  so there's nothing stable to encode here — only the user's on/off
   *  preference. A fresh token
   *  (outer fields are keyed by TOKEN, not position — see
   *  `colorTolerance`'s own doc above), so this is safe to add for every
   *  existing link regardless of `SYNTH_SCHEMA_VERSION`. */
  colorEncoding: "spans" | "atlas";
  /** The whole field-synth patch, packed against `fieldSynth.parameterSchema`
   *  via the shared generic effect-params codec (see file header). */
  paramsPacked: string;
}

/** Default voice-slot mask: osc1 + osc2 (the only two voices with amp > 0 in
 *  `fieldSynthSchema`'s defaults) — matches `slotsFromParams(synthDefaults())`
 *  so an untouched patch omits `voiceSlotMask` from the packed URL entirely. */
const DEFAULT_VOICE_SLOT_MASK = 0b000011;

export const SYNTH_URL_DEFAULTS: SynthUrlState = {
  shape: "plane",
  timeScale: 1.4,
  density: 1,
  voiceSlotMask: DEFAULT_VOICE_SLOT_MASK,
  lightAzimuth: DEFAULT_LIGHTING.azimuth,
  lightElevation: DEFAULT_LIGHTING.elevation,
  lightKeyIntensity: DEFAULT_LIGHTING.keyIntensity,
  lightKeyColor: DEFAULT_LIGHTING.keyColor,
  lightAmbient: DEFAULT_LIGHTING.ambient,
  colorTolerance: 32,
  colorEncoding: "spans",
  paramsPacked: "",
};

const synthFields: readonly UrlField<SynthUrlState>[] = [
  { key: "shape", token: "s", type: { kind: "enum", values: SHAPES }, default: SYNTH_URL_DEFAULTS.shape },
  { key: "timeScale", token: "t", type: { kind: "float", step: 0.0001 }, default: SYNTH_URL_DEFAULTS.timeScale },
  { key: "density", token: "d", type: { kind: "float", step: 0.1 }, default: SYNTH_URL_DEFAULTS.density },
  { key: "voiceSlotMask", token: "v", type: { kind: "int" }, default: SYNTH_URL_DEFAULTS.voiceSlotMask },
  { key: "lightAzimuth", token: "a", type: { kind: "float", step: 1 }, default: SYNTH_URL_DEFAULTS.lightAzimuth },
  { key: "lightElevation", token: "e", type: { kind: "float", step: 1 }, default: SYNTH_URL_DEFAULTS.lightElevation },
  { key: "lightKeyIntensity", token: "k", type: { kind: "float", step: 0.05 }, default: SYNTH_URL_DEFAULTS.lightKeyIntensity },
  { key: "lightKeyColor", token: "K", type: { kind: "color" }, default: SYNTH_URL_DEFAULTS.lightKeyColor },
  { key: "lightAmbient", token: "m", type: { kind: "float", step: 0.05 }, default: SYNTH_URL_DEFAULTS.lightAmbient },
  { key: "colorTolerance", token: "c", type: { kind: "float", step: 1 }, default: SYNTH_URL_DEFAULTS.colorTolerance },
  { key: "paramsPacked", token: "p", type: { kind: "string" }, default: SYNTH_URL_DEFAULTS.paramsPacked },
  // Appended (not inserted) — token-keyed outer fields decode independent of
  // position, but new fields still go at the tail by convention (matches
  // `colorTolerance`'s own addition).
  { key: "colorEncoding", token: "E", type: { kind: "enum", values: ["spans", "atlas"] }, default: SYNTH_URL_DEFAULTS.colorEncoding },
];

// `decodeEffectParamsPacked`/`encodeEffectParamsPacked` key `paramsPacked`'s
// tokens by POSITION in `Object.keys(schema)` — append-only growth (every
// VOLUMETRIC.md/VOLUMETRIC-2.md phase) never disturbs an existing link,
// because a new key only ever lands after every index an older link could
// have used. Removing the slab feature's `slabAxis`/`slabStart`/`slabEnd`
// (packages/effects/src/stock.ts's schema, removed post-implementation —
// see VOLUMETRIC-2.md §1's Reconciliation entry) broke that guarantee for
// the first time: those three keys sat BEFORE `iter1..6` (and every
// Phase-4 key after them), so deleting them shifts every later key's index
// down by 3. A link encoded against the old schema must therefore be
// decoded against the OLD key order, or its `iter1..6`/later overrides
// silently land on the wrong param. `LEGACY_V2_FIELD_SYNTH_SCHEMA`
// reconstructs that old order by splicing the three retired specs back in
// at their original position (right after `xrayGain`) — decode-only; the
// three resulting values are discarded (see `decodeSynthUrlState`), never
// merged into `Params`, since the feature no longer exists.
const LEGACY_SLAB_AXIS_SPEC: EffectParamSchemaLike[string] = { kind: "string", default: "none", values: ["none", "x", "y", "z"] };
const LEGACY_SLAB_RANGE_SPEC: EffectParamSchemaLike[string] = { kind: "number", default: -1, step: 0.05 };
function buildLegacyV2FieldSynthSchema(): EffectParamSchemaLike {
  const current = fieldSynth.parameterSchema as unknown as EffectParamSchemaLike;
  const legacy: Record<string, EffectParamSchemaLike[string]> = {};
  for (const [key, spec] of Object.entries(current)) {
    legacy[key] = spec;
    if (key === "xrayGain") {
      legacy.slabAxis = LEGACY_SLAB_AXIS_SPEC;
      legacy.slabStart = LEGACY_SLAB_RANGE_SPEC;
      legacy.slabEnd = LEGACY_SLAB_RANGE_SPEC;
    }
  }
  return legacy;
}
export const LEGACY_V2_FIELD_SYNTH_SCHEMA: EffectParamSchemaLike = buildLegacyV2FieldSynthSchema();

// `colorQuantize` removal (COLOR-TOLERANCE.md Phase 4): unlike the slab keys
// above, it sat at the very TAIL of the schema (the last key before `} as
// const satisfies GlyphEffectParamSchema` in packages/effects/src/stock.ts),
// so removing it does NOT shift any other key's index — but a V3 link that
// DID encode a non-default `colorQuantize` still needs it to decode
// somewhere: `keys[token.value]` is undefined against the post-removal
// schema (index now past the end), and `decodeEffectParamsPacked` BREAKS the
// whole decode loop on an unresolvable token, silently dropping every
// override that came after it in the packed string too. `LEGACY_V3_FIELD_
// SYNTH_SCHEMA` reconstructs V3's exact order by appending the retired spec
// back at the tail (where it always was) — decode-only; the resulting value
// is discarded (see `buildSynthInitialState`), never merged into `Params`,
// since `colorTolerance` (a SCENE option, not a field-synth param — see
// `SynthUrlState.colorTolerance`'s doc) replaces it instead of inheriting
// its value.
const LEGACY_COLOR_QUANTIZE_SPEC: EffectParamSchemaLike[string] = { kind: "number", default: 0, step: 1 };
function buildLegacyV3FieldSynthSchema(): EffectParamSchemaLike {
  const current = fieldSynth.parameterSchema as unknown as EffectParamSchemaLike;
  return { ...current, colorQuantize: LEGACY_COLOR_QUANTIZE_SPEC };
}
export const LEGACY_V3_FIELD_SYNTH_SCHEMA: EffectParamSchemaLike = buildLegacyV3FieldSynthSchema();

// Bumped 4 -> 5 for the shared codec's compact-index/run/list rewrite of
// `encodeEffectParamsPacked`/`decodeEffectParamsPacked` (website/src/lib/
// urlState.ts) — a wire-format change to `paramsPacked` itself (not a
// schema key reshuffle like the 2->3/3->4 bumps below), so a v4 link's
// `paramsPacked` must decode through the LEGACY pair
// (`decodeEffectParamsPackedLegacy`) against the CURRENT schema — v4 never
// changed which keys exist, only v5 changes how they're packed.
const SYNTH_SCHEMA_VERSION = "5";
export const synthCodec = createUrlCodec<SynthUrlState>(SYNTH_SCHEMA_VERSION, synthFields);
// Decodes a URL shared before the version bump (`raw[1] === "1"`). Same field
// list — only `paramsPacked`'s internal token format changed, and that change
// is backward compatible — but `createUrlCodec`'s version gate rejects a
// version it wasn't built with, so a distinct instance is required to accept
// "1"-tagged input at all. A "1"-tagged link predates the escape fix, so its
// `paramsPacked` can only ever reference indices < 62 — comfortably below
// where the now-removed slab keys sat — so it's decoded against the CURRENT
// (post-slab-removal) schema below, unaffected by the shift.
const synthCodecLegacyV1 = createUrlCodec<SynthUrlState>("1", synthFields);
// Decodes a "2"-tagged link (the version live from the escape fix through
// the slab feature's removal) — same outer field list, but `paramsPacked`
// must be decoded against `LEGACY_V2_FIELD_SYNTH_SCHEMA`'s old key order.
const synthCodecLegacyV2 = createUrlCodec<SynthUrlState>("2", synthFields);
// Decodes a "3"-tagged link (the version live from the slab removal through
// the colorQuantize removal) — same outer field list (a V3 link never
// encoded `colorTolerance`; it didn't exist yet, so it decodes to its
// default, exactly as intended), but `paramsPacked` must be decoded against
// `LEGACY_V3_FIELD_SYNTH_SCHEMA`'s old key order.
const synthCodecLegacyV3 = createUrlCodec<SynthUrlState>("3", synthFields);
// Decodes a "4"-tagged link (the version live from the colorQuantize removal
// through the v5 compact-codec rewrite) — same outer field list AND the same
// (current) `paramsPacked` key order as v5, but `paramsPacked` itself must be
// decoded with the LEGACY escape-based decoder (see `decodeParamsPacked`
// below), since v5 is the first version to write the compact grammar.
const synthCodecLegacyV4 = createUrlCodec<SynthUrlState>("4", synthFields);
export const SYNTH_PARAM = "s";

// Shared with `resolveSpaceChange` in synthKit.tsx (the live Mapping-dropdown
// guard, now the ONLY space control — VOLUMETRIC-2.md §4 removed the 2D/3D
// toggle): `render: "carve"` or `render: "xray"` only validates under
// `space: "object"` (`validateFieldSynthRender` in @glyphcss/effects's
// stock.ts) — anything else must fall back to "paint". A live write can
// never produce an invalid combination because every `space` write routes
// through `resolveSpaceChange`, but a hand-crafted URL can encode one
// directly (decode has no such gate of its own), so decode applies the same
// rule here before params ever reach `addEffectLayer`/`validateParams`.
export function sanitizeCarveRenderForSpace(space: unknown, render: string): string {
  return (render === "carve" || render === "xray") && space !== "object" ? "paint" : render;
}

// ── URL hydration validity gate (VOLUMETRIC-2.md §4, P2-fixed) ─────────────
// `validateParams` throws opaque Error messages, but each throw site now
// carries a stable `code` (`GlyphFieldSynthValidationRuleId`, exported by
// `@glyphcss/effects` — see stock.ts's `GLYPH_FIELD_SYNTH_VALIDATION_RULES`),
// so this IS keyed off the thrown identity rather than reset-the-offending-
// key guesswork. It's a two-tier repair: re-validate, look up the CURRENT
// failure's code in `SYNTH_REPAIR_TABLE`, apply that row, repeat; if
// validation still throws with no table row (a future rule id with no
// matching entry), tier 2 resets the WHOLE effect-param object to schema
// defaults rather than leaving a half-repaired, still-invalid patch. Applied
// AFTER decode (both the v1-legacy and v2 codec paths funnel through
// `decodeSynthUrlState` below) and after the carve/xray-space coercion above.
const MAX_LAYERS = Number((fieldSynth.parameterSchema as unknown as Record<string, { max?: number }>).layer1?.max ?? 3);

function populatedLayers(p: Params): boolean[] {
  const populated: boolean[] = new Array(MAX_LAYERS).fill(false) as boolean[];
  for (let k = 1; k <= MAX_VOICES; k++) {
    if (!(Number(p[`amp${k}`] ?? 0) > 0)) continue;
    const layer = Math.round(Number(p[`layer${k}`] ?? 1));
    if (layer >= 1 && layer <= MAX_LAYERS) populated[layer - 1] = true;
  }
  return populated;
}

// Mirrors `validateFieldSynthLayers` in packages/effects/src/stock.ts:
// argmax is categorical and stays single-layer — a patch is invalid when
// argmax is EFFECTIVE (a populated layer's resolved combine — its own
// override, else the inherited patch-level `combine`) in more than one
// populated layer's worth of context.
function hasMultiLayerEffectiveArgmax(p: Params): boolean {
  const populated = populatedLayers(p);
  if (populated.filter(Boolean).length <= 1) return false;
  const patchCombine = String(p.combine ?? SYNTH_PARAM_DEFAULTS.combine);
  for (let l = 1; l <= MAX_LAYERS; l++) {
    if (!populated[l - 1]) continue;
    const raw = String(p[`layerCombine${l}`] ?? "inherit");
    const resolved = raw === "inherit" ? patchCombine : raw;
    if (resolved === "argmax") return true;
  }
  return false;
}

// Mirrors `validateFieldSynthGeometryNormalFields` in packages/effects/src/
// stock.ts (VOLUMETRIC-4.md §1): the four normal-derived field kinds
// (`normalX`/`normalY`/`normalZ`/`incidence`) are legal ONLY in the colour
// voice stack — never on an active GEOMETRY voice (`field1..N`), on or off
// the stack.
const NORMAL_DERIVED_SYNTH_FIELDS = new Set(["normalX", "normalY", "normalZ", "incidence"]);
const ALL_GEOMETRY_FIELD_KEYS: readonly string[] = Array.from({ length: MAX_VOICES }, (_, i) => `field${i + 1}`);

function hasActiveGeometryNormalField(p: Params): boolean {
  for (let k = 1; k <= MAX_VOICES; k++) {
    if (!(Number(p[`amp${k}`] ?? 0) > 0)) continue;
    if (NORMAL_DERIVED_SYNTH_FIELDS.has(String(p[`field${k}`]))) return true;
  }
  return false;
}

export interface SynthRepairRule {
  readonly predicate: (params: Params) => boolean;
  /** Keys reset to `SYNTH_PARAM_DEFAULTS` when `predicate` matches. */
  readonly reset: readonly string[];
}

// Keyed by `GlyphFieldSynthValidationRuleId` — the STABLE cross-package
// contract `@glyphcss/effects` exports (VOLUMETRIC-2.md §4 P2 fix). This
// replaces a hand-maintained mirror of `packages/effects/src/stock.ts`'s
// throw sites: that mirror's own "completeness" test asserted its length
// against itself, which is circular and caught nothing. Now the website
// test (synthUrlState.test.ts) asserts every id in the REAL exported
// `GLYPH_FIELD_SYNTH_VALIDATION_RULES` array is covered here or in
// `COERCION_HANDLED_RULES` below — a validator added on the effects side
// without a matching entry here fails that test via the exported list, not
// a hand-mirror.
//
// `"carve-requires-object-space"` is deliberately absent: it's covered by
// `sanitizeCarveRenderForSpace` above, which coerces `render` back to
// `"paint"` before this gate ever runs (one guard, not two competing ones)
// — see `COERCION_HANDLED_RULES`.
export const SYNTH_REPAIR_TABLE: Partial<Record<GlyphFieldSynthValidationRuleId, SynthRepairRule>> = {
  "empty-glyphs": {
    predicate: (p) => typeof p.glyphs !== "string" || p.glyphs.length === 0,
    reset: ["glyphs"],
  },
  "non-positive-scale": {
    predicate: (p) => !(Number(p.scale) > 0),
    reset: ["scale"],
  },
  "multi-layer-argmax": {
    predicate: hasMultiLayerEffectiveArgmax,
    reset: ["combine"],
  },
  // Xray-only (VOLUMETRIC-3.md §2): carve+ink and carve+2x4 are now legal —
  // carve's own march loop computes both directly — so this row must NOT
  // also match `render: "carve"` anymore, or a valid carve+ink/2x4 URL gets
  // "repaired" back to `1x1` for no reason.
  "xray-subcell-unsupported": {
    predicate: (p) => p.render === "xray" && (p.subcellRes === "2x4" || p.subcellRes === "ink"),
    reset: ["subcellRes"],
  },
  // Resets every geometry voice's field choice (blunt, same precedent as
  // `multi-layer-argmax`'s shared `combine` reset above) rather than trying
  // to identify just the offending voice(s) — `reset` is a static key list,
  // and a patch this malformed has no single "right" field to fall back to.
  "normal-field-requires-color-stack": {
    predicate: hasActiveGeometryNormalField,
    reset: ALL_GEOMETRY_FIELD_KEYS,
  },
};

// Rule ids handled BEFORE this gate runs, by the carve/xray-space coercion
// in `decodeSynthUrlState` (`sanitizeCarveRenderForSpace`) rather than by a
// repair-table row — an explicit tier-2-only acknowledgment, not a silent
// gap. The website completeness test asserts every exported rule id is
// covered by either `SYNTH_REPAIR_TABLE` or this list.
export const COERCION_HANDLED_RULES: readonly GlyphFieldSynthValidationRuleId[] = ["carve-requires-object-space"];

function applyRepairRow(params: Params, keys: readonly string[]): Params {
  const next = { ...params };
  for (const key of keys) next[key] = SYNTH_PARAM_DEFAULTS[key];
  return next;
}

// Tri-state, not a plain `code | undefined`: an unrecognized/untagged throw
// (`code: undefined` inside `ok: false`) must stay distinguishable from
// "validates clean" (`ok: true`), or `applySynthValidityGate` below could
// mistake a genuinely-invalid-but-untagged patch for a repaired one and skip
// tier 2 entirely.
type FieldSynthValidationOutcome =
  | { readonly ok: true }
  | { readonly ok: false; readonly code: GlyphFieldSynthValidationRuleId | undefined };

function fieldSynthValidationOutcome(params: Params): FieldSynthValidationOutcome {
  try {
    fieldSynth.program.validateParams?.({ ...params, time: (params.time as number | undefined) ?? 0 } as never);
    return { ok: true };
  } catch (error) {
    return { ok: false, code: (error as Partial<GlyphFieldSynthValidationError>).code };
  }
}

function fieldSynthValidatesClean(params: Params): boolean {
  return fieldSynthValidationOutcome(params).ok;
}

/** Two-tier URL hydration validity gate — see the module doc above. Pure
 *  (no `window` access), so it's the piece under test for repair-table
 *  coverage. Driven by the REAL thrown rule id (not a fixed predicate
 *  order): each pass resolves the current `validateParams` failure's code
 *  and applies that code's own repair row, so a repair is always tied to an
 *  actual throw site rather than a predicate that happened to also match.
 *  Bounded by the rule count so a pathological repair (one that doesn't
 *  actually clear its own predicate) can't loop forever — it falls through
 *  to tier 2 instead. */
export function applySynthValidityGate(params: Params): Params {
  let next = params;
  for (let guard = 0; guard < GLYPH_FIELD_SYNTH_VALIDATION_RULES.length; guard++) {
    const outcome = fieldSynthValidationOutcome(next);
    if (outcome.ok) return next;
    const row = outcome.code ? SYNTH_REPAIR_TABLE[outcome.code] : undefined;
    if (!row) break;
    next = applyRepairRow(next, row.reset);
  }
  if (fieldSynthValidatesClean(next)) return next;
  // Tier 2: a validator with no table row still threw — reset the WHOLE
  // effect-param object to schema defaults rather than ship a
  // half-repaired, still-invalid patch. Non-effect URL state (shape,
  // density, lighting, camera) lives outside `params` entirely and is
  // untouched by this function. Loud on purpose: a silent full-object reset
  // is indistinguishable from "no params were in the URL at all" to whoever
  // is debugging a link that loaded as defaults — see the module doc above
  // and the P0 this was written to make diagnosable (a genuinely valid patch
  // silently landing here reads identically to an absent `?s=` otherwise).
  console.warn(
    "synthUrlState: URL params failed field-synth validation after every known repair — resetting the whole patch to schema defaults.",
    params,
  );
  return { ...SYNTH_PARAM_DEFAULTS };
}

export interface SynthInitialState {
  shape: string;
  params: Params;
  timeScale: number;
  density: number;
  colorTolerance: number;
  colorEncoding: "spans" | "atlas";
  lighting: Lighting;
  voiceSlots: number[];
}

export interface SynthPatch {
  shape: string;
  params: Params;
  timeScale: number;
  density: number;
  colorTolerance: number;
  colorEncoding: "spans" | "atlas";
  lighting: Lighting;
  voiceSlots: readonly number[];
}

/** Pure encode: patch -> packed `?s=` value. No `window` access, so this is
 *  the piece under test for round-trip/size assertions. */
export function encodeSynthUrlState(state: SynthPatch): string {
  const paramsPacked = encodeEffectParamsPacked(fieldSynth.parameterSchema, SYNTH_PARAM_DEFAULTS, state.params);
  return synthCodec.encode({
    shape: state.shape,
    timeScale: state.timeScale,
    density: state.density,
    voiceSlotMask: encodeVoiceSlots(state.voiceSlots),
    lightAzimuth: state.lighting.azimuth,
    lightElevation: state.lighting.elevation,
    lightKeyIntensity: state.lighting.keyIntensity,
    lightKeyColor: state.lighting.keyColor,
    lightAmbient: state.lighting.ambient,
    colorTolerance: state.colorTolerance,
    colorEncoding: state.colorEncoding,
    paramsPacked,
  });
}

/** Dispatches to the legacy (pre-bump) codec for a "1"/"2"/"3"/"4"-tagged
 *  link, else the live codec — see `SYNTH_SCHEMA_VERSION`'s doc. */
function decodeOuterState(raw: string | null | undefined): Partial<SynthUrlState> {
  if (raw && raw[1] === "1") return synthCodecLegacyV1.decode(raw);
  if (raw && raw[1] === "2") return synthCodecLegacyV2.decode(raw);
  if (raw && raw[1] === "3") return synthCodecLegacyV3.decode(raw);
  if (raw && raw[1] === "4") return synthCodecLegacyV4.decode(raw);
  return synthCodec.decode(raw);
}

/** "1"/"2"-tagged links predate the slab removal, and "3"/"4"-tagged links
 *  predate the colorQuantize removal — each must decode `paramsPacked`
 *  against its OWN old key order (`LEGACY_V2_FIELD_SYNTH_SCHEMA` /
 *  `LEGACY_V3_FIELD_SYNTH_SCHEMA`'s docs). A "4"-tagged link's key order is
 *  identical to the live schema (only the wire FORMAT changed for v5, see
 *  `decodeParamsPacked` below), so it shares the same branch as the current
 *  (v5) schema here. */
function paramsSchemaFor(raw: string | null | undefined): EffectParamSchemaLike {
  if (raw && (raw[1] === "1" || raw[1] === "2")) return LEGACY_V2_FIELD_SYNTH_SCHEMA;
  if (raw && raw[1] === "3") return LEGACY_V3_FIELD_SYNTH_SCHEMA;
  return fieldSynth.parameterSchema as unknown as EffectParamSchemaLike;
}

/** Every version below the current one wrote `paramsPacked` with the LEGACY
 *  escape-based grammar (`encodeEffectParamsPackedLegacy`); only
 *  `SYNTH_SCHEMA_VERSION` ("5") writes/reads the compact run/list grammar
 *  (`encodeEffectParamsPacked`). This is a wire-format dispatch, orthogonal
 *  to `paramsSchemaFor`'s key-ORDER dispatch above — a "4"-tagged link uses
 *  the CURRENT key order but the LEGACY format, which is exactly why this
 *  needs its own check rather than folding into `paramsSchemaFor`. */
function decodeParamsPacked(
  raw: string | null | undefined,
  schema: EffectParamSchemaLike,
  packed: string | undefined,
): Record<string, unknown> {
  if (raw && raw[1] === SYNTH_SCHEMA_VERSION) return decodeEffectParamsPacked(schema, packed);
  return decodeEffectParamsPackedLegacy(schema, packed);
}

/** Shared post-processing for BOTH the synchronous ('p') and async ('z')
 *  decode paths below: merge the decoded outer fields over defaults, decode
 *  the nested `paramsPacked` effect patch against the right schema for
 *  `raw`'s version, discard retired keys, coerce carve/xray to the right
 *  space, and run the URL hydration validity gate. `raw` is only consulted
 *  for its version tag (`decodeOuterState`/`paramsSchemaFor` above), never
 *  re-decoded here — callers already resolved `outer` themselves (sync via
 *  `codec.decode`, async via `codec.decodeAsync`). */
function buildSynthInitialState(raw: string | null | undefined, outer: Partial<SynthUrlState>): SynthInitialState {
  const decoded = { ...SYNTH_URL_DEFAULTS, ...outer };
  const overrides = decodeParamsPacked(raw, paramsSchemaFor(raw), decoded.paramsPacked);
  // The retired slab keys only ever appear when `overrides` was decoded
  // against `LEGACY_V2_FIELD_SYNTH_SCHEMA` (a "1"/"2"-tagged link), and
  // `colorQuantize` only when decoded against `LEGACY_V3_FIELD_SYNTH_SCHEMA`
  // (a "3"-tagged link) — discard all four unconditionally rather than
  // branch on which schema was used: none of these features exist anymore,
  // and `SYNTH_PARAM_DEFAULTS` no longer has any of these keys either.
  delete overrides.slabAxis;
  delete overrides.slabStart;
  delete overrides.slabEnd;
  delete overrides.colorQuantize;
  let params = { ...SYNTH_PARAM_DEFAULTS, ...overrides } as Params;
  params.render = sanitizeCarveRenderForSpace(params.space, params.render as string);
  params = applySynthValidityGate(params);
  return {
    shape: decoded.shape,
    params,
    timeScale: decoded.timeScale,
    density: decoded.density,
    colorTolerance: decoded.colorTolerance,
    colorEncoding: decoded.colorEncoding,
    lighting: {
      azimuth: decoded.lightAzimuth,
      elevation: decoded.lightElevation,
      keyIntensity: decoded.lightKeyIntensity,
      keyColor: decoded.lightKeyColor,
      ambient: decoded.lightAmbient,
    },
    voiceSlots: decodeVoiceSlots(decoded.voiceSlotMask),
  };
}

/** Pure decode: packed `?s=` value -> patch (defaults for absent/garbage).
 *  Synchronous, so it can only ever read the 'p' (raw packed) format — a
 *  'z' (deflated) link decodes to defaults here (see urlState.ts's `decode`
 *  doc, which now warns when this happens) and needs `decodeSynthUrlStateAsync`
 *  to actually resolve. */
export function decodeSynthUrlState(raw: string | null | undefined): SynthInitialState {
  return buildSynthInitialState(raw, decodeOuterState(raw));
}

/** Picks the codec that understands `raw`'s outer version tag — mirrors
 *  `decodeOuterState`'s sync dispatch, but for `codec.decodeAsync` (the only
 *  path that can read a 'z'-tagged/compressed link at all). */
function outerCodecFor(raw: string | null | undefined) {
  if (raw && raw[1] === "1") return synthCodecLegacyV1;
  if (raw && raw[1] === "2") return synthCodecLegacyV2;
  if (raw && raw[1] === "3") return synthCodecLegacyV3;
  if (raw && raw[1] === "4") return synthCodecLegacyV4;
  return synthCodec;
}

/** Async catch-up for a 'z'-tagged (deflated) `?s=` link that
 *  `decodeSynthUrlState`/`readInitialSynthState` cannot read synchronously
 *  (decompression is inherently async — see urlState.ts's format doc). This
 *  is the fix for the P0 where a shared link past the compaction threshold
 *  (~400 packed chars — routine once a preset touches many voices/colour-
 *  stack keys, e.g. "Menger (cssGraphics)") silently loaded as schema
 *  defaults with no signal at all: the synchronous read alone can NEVER
 *  resolve a 'z' link, no matter how the rest of the pipeline is fixed.
 *
 *  Returns `null` for an absent or already-'p'-tagged param (nothing to
 *  catch up on — the synchronous read already fully resolved it) so call
 *  sites can tell "nothing to do" apart from "resolved, and it's a genuine
 *  no-op patch". Warns to the console (via `codec.decodeAsync`) when a
 *  present 'z' param fails to decode — garbage, truncated, an unsupported
 *  version, or a browser with no DecompressionStream support — instead of
 *  resolving to defaults with no trace. */
export async function decodeSynthUrlStateAsync(raw: string | null | undefined): Promise<SynthInitialState | null> {
  if (!raw || raw[0] !== "z") return null;
  const outer = await outerCodecFor(raw).decodeAsync(raw);
  return buildSynthInitialState(raw, outer);
}

export function readInitialSynthState(): SynthInitialState {
  return decodeSynthUrlState(readUrlParam(SYNTH_PARAM));
}

/** Async catch-up for the CURRENT `?s=` URL param — the page-facing wrapper
 *  around `decodeSynthUrlStateAsync` (which takes `raw` directly so it stays
 *  pure/testable). Call once on mount; a non-null result means the initial
 *  synchronous `readInitialSynthState()` read defaults because the URL held
 *  a compressed link, and the caller should apply this result over that
 *  initial state. */
export async function readInitialSynthStateAsync(): Promise<SynthInitialState | null> {
  return decodeSynthUrlStateAsync(readUrlParam(SYNTH_PARAM));
}

export function writeSynthUrlState(state: SynthPatch): void {
  const paramsPacked = encodeEffectParamsPacked(fieldSynth.parameterSchema, SYNTH_PARAM_DEFAULTS, state.params);
  const full: SynthUrlState = {
    shape: state.shape,
    timeScale: state.timeScale,
    density: state.density,
    voiceSlotMask: encodeVoiceSlots(state.voiceSlots),
    lightAzimuth: state.lighting.azimuth,
    lightElevation: state.lighting.elevation,
    lightKeyIntensity: state.lighting.keyIntensity,
    lightKeyColor: state.lighting.keyColor,
    lightAmbient: state.lighting.ambient,
    colorTolerance: state.colorTolerance,
    colorEncoding: state.colorEncoding,
    paramsPacked,
  };
  scheduleCompactedUrlWrite(synthCodec, SYNTH_PARAM, full);
}
