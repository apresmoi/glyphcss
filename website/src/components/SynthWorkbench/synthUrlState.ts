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
  GlyphFieldSynthEffect as fieldSynth,
  defaultGlyphEffectParams,
} from "@glyphcss/effects";
import {
  createUrlCodec,
  decodeEffectParamsPacked,
  encodeEffectParamsPacked,
  readUrlParam,
  scheduleCompactedUrlWrite,
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
export const MAX_VOICES = 6;

export type Params = Record<string, number | string | boolean>;

function synthDefaults(): Params {
  const { time: _time, ...rest } = defaultGlyphEffectParams(fieldSynth) as Params;
  return rest;
}
export const SYNTH_PARAM_DEFAULTS: Params = { ...synthDefaults(), voiceColors: true };

/** Which oscillator slots have a CARD (exist), independent of amp — packed as
 *  a 6-bit mask (1 base36 char covers 0..35, so 6 bits fit in 1 char). */
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
  { key: "paramsPacked", token: "p", type: { kind: "string" }, default: SYNTH_URL_DEFAULTS.paramsPacked },
];

// Bumped 1 -> 2 alongside `encodeEffectParamsPacked`/`decodeEffectParamsPacked`
// gaining a multi-char index escape (see urlState.ts) that fixes indices >= 62
// (`lit`, `voiceColors`, `color1..6`, and everything VOLUMETRIC.md's phases
// appended after them) silently dropping from `paramsPacked`. The escape
// format is byte-compatible with every pre-fix link on its own (a pre-fix
// string never used index >= 62, so it never contains the escape char) — the
// version bump plus `synthCodecLegacyV1` below exist so that guarantee is an
// explicit, tested decode path rather than an implicit property of the format.
const SYNTH_SCHEMA_VERSION = "2";
export const synthCodec = createUrlCodec<SynthUrlState>(SYNTH_SCHEMA_VERSION, synthFields);
// Decodes a URL shared before the version bump (`raw[1] === "1"`). Same field
// list — only `paramsPacked`'s internal token format changed, and that change
// is backward compatible — but `createUrlCodec`'s version gate rejects a
// version it wasn't built with, so a distinct instance is required to accept
// "1"-tagged input at all.
const synthCodecLegacyV1 = createUrlCodec<SynthUrlState>("1", synthFields);
const SYNTH_PARAM = "s";

// Shared with `resolveSpaceChange` in synthKit.tsx (the live Mapping-dropdown
// / 2D-3D-toggle guard): `render: "carve"` only validates under `space:
// "object"` (`validateFieldSynthRender` in @glyphcss/effects's stock.ts) —
// anything else must fall back to "paint". A live write can never produce an
// invalid combination because every `space` write routes through
// `resolveSpaceChange`, but a hand-crafted URL can encode one directly
// (decode has no such gate of its own), so decode applies the same rule here
// before params ever reach `addEffectLayer`/`validateParams`.
export function sanitizeCarveRenderForSpace(space: unknown, render: string): string {
  return render === "carve" && space !== "object" ? "paint" : render;
}

export interface SynthInitialState {
  shape: string;
  params: Params;
  timeScale: number;
  density: number;
  lighting: Lighting;
  voiceSlots: number[];
}

export interface SynthPatch {
  shape: string;
  params: Params;
  timeScale: number;
  density: number;
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
    paramsPacked,
  });
}

/** Dispatches to the legacy (pre-bump) codec for a "1"-tagged link, else the
 *  live codec — see `SYNTH_SCHEMA_VERSION`'s doc. */
function decodeOuterState(raw: string | null | undefined): Partial<SynthUrlState> {
  if (raw && raw[1] === "1") return synthCodecLegacyV1.decode(raw);
  return synthCodec.decode(raw);
}

/** Pure decode: packed `?s=` value -> patch (defaults for absent/garbage). */
export function decodeSynthUrlState(raw: string | null | undefined): SynthInitialState {
  const decoded = { ...SYNTH_URL_DEFAULTS, ...decodeOuterState(raw) };
  const overrides = decodeEffectParamsPacked(fieldSynth.parameterSchema, decoded.paramsPacked);
  const params = { ...SYNTH_PARAM_DEFAULTS, ...overrides } as Params;
  params.render = sanitizeCarveRenderForSpace(params.space, params.render as string);
  return {
    shape: decoded.shape,
    params,
    timeScale: decoded.timeScale,
    density: decoded.density,
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

export function readInitialSynthState(): SynthInitialState {
  return decodeSynthUrlState(readUrlParam(SYNTH_PARAM));
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
    paramsPacked,
  };
  scheduleCompactedUrlWrite(synthCodec, SYNTH_PARAM, full);
}
