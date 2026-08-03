// /wordart's compact single-query-param URL state, built on the shared codec
// (website/src/lib/urlState.ts) — same packing rules /gallery and /synth use.
// Replaces the old ~40-key verbose `URLSearchParams` pass (419 chars for a
// representative state) with one packed `?w=` value (measured: 104 chars for
// the same state, see this component's tests for the pinned number).
import {
  createUrlCodec,
  decodeEffectParamsPacked,
  encodeEffectParamsPacked,
  readUrlParam,
  scheduleCompactedUrlWrite,
  type UrlField,
} from "../../lib/urlState";
import { GALLERY_EFFECT_CATALOG, galleryEffectDefinition, galleryEffectDefaultParams, sanitizeGalleryEffectParams } from "../GalleryWorkbench/effects";
import type { GalleryEffectBlend, GalleryEffectParamValue, GalleryEffectState } from "../GalleryWorkbench/types";
import { DEFAULT_GALLERY_EFFECT_STATE } from "../GalleryWorkbench/effects";
import type { GlyphEffectId } from "@glyphcss/effects";
import type { ExtrudeProfile, WarpShape } from "@glyphcss/fonts";

export type WordArtAlign = "left" | "center" | "right";
export type WordArtFillType = "solid" | "gradient" | "rainbow" | "texture" | "image";
export type WordArtFaceFill = "solid" | "texture" | "none";
export type WordArtCase = "as-typed" | "upper" | "lower" | "title";
export type WordArtRenderMode = "wireframe" | "solid" | "ink";
export type WordArtCharMode = "ascii" | "braille" | "halfblock";
export type WordArtHiddenLines = "show" | "hide";
export type Bezier4 = [number, number, number, number];

const TEXTURE_IDS = [
  "dirt", "dirt2", "grass3", "brick", "brick2", "wood", "wood3", "rock", "rock3",
  "ice", "ice3", "glass", "sand", "cacti", "mine", "mine4",
] as const;

export interface WordArtUrlState {
  text: string;
  font: string;
  weight: number;
  italic: boolean;
  textCase: WordArtCase;
  scaleX: number;
  scaleY: number;
  profile: ExtrudeProfile;
  roundConvex: boolean;
  bezier: Bezier4;
  depth: number;
  letterSpacing: number;
  lineHeight: number;
  align: WordArtAlign;
  underline: boolean;
  strike: boolean;
  color: string;
  sideColor: string;
  backColor: string;
  offset: number;
  curveSegments: number;
  simplify: number;
  profileSegments: number;
  warpShape: WarpShape;
  warpAmount: number;
  spin: boolean;
  perspective: boolean;
  zoomScale: number;
  turn: number;
  tilt: number;
  density: number;
  renderMode: WordArtRenderMode;
  charMode: WordArtCharMode;
  hiddenLines: WordArtHiddenLines;
  lightIntensity: number;
  ambient: number;
  lightColor: string;
  lightAz: number;
  lightEl: number;
  fillType: WordArtFillType;
  gradA: string;
  gradB: string;
  gradAngle: number;
  faceTex: string;
  sideFill: WordArtFaceFill;
  sideTex: string;
  backFill: WordArtFaceFill;
  backTex: string;
  outlineOn: boolean;
  outlineColor: string;
  outlineWidth: number;
  layered: boolean;
  effectId: string;
  effectBlend: GalleryEffectBlend;
  effectPaused: boolean;
  effectTimeScale: number;
  effectParams: string;
}

export const WORD_ART_DEFAULTS: WordArtUrlState = {
  text: "Glyph\nCSS",
  font: "Roboto",
  weight: 700,
  italic: false,
  textCase: "as-typed",
  scaleX: 100,
  scaleY: 100,
  profile: "bevel",
  roundConvex: false,
  bezier: [0.3, 0.9, 0.7, 0.1],
  depth: 26,
  letterSpacing: 0,
  lineHeight: 1.15,
  align: "center",
  underline: false,
  strike: false,
  color: "#d4a82a",
  sideColor: "#7c5e16",
  backColor: "#7c5e16",
  offset: 0,
  curveSegments: 4,
  simplify: 2,
  profileSegments: 3,
  warpShape: "none",
  warpAmount: 0.5,
  spin: true,
  perspective: true,
  zoomScale: 1,
  turn: 0,
  tilt: 14,
  density: 1,
  renderMode: "solid",
  charMode: "ascii",
  hiddenLines: "show",
  lightIntensity: 0.95,
  ambient: 0.5,
  lightColor: "#ffffff",
  lightAz: -25,
  lightEl: 45,
  fillType: "solid",
  gradA: "#ffd23f",
  gradB: "#ff5e3a",
  gradAngle: 270,
  faceTex: "dirt",
  sideFill: "solid",
  sideTex: "dirt",
  backFill: "solid",
  backTex: "dirt",
  outlineOn: false,
  outlineColor: "#1a1a2e",
  outlineWidth: 3,
  layered: false,
  effectId: "",
  effectBlend: "replace",
  effectPaused: false,
  effectTimeScale: 1,
  effectParams: "",
};

const EFFECT_ID_VALUES = GALLERY_EFFECT_CATALOG.map((d) => d.id);

const wordArtFields: readonly UrlField<WordArtUrlState>[] = [
  { key: "text", token: "t", type: { kind: "string" }, default: WORD_ART_DEFAULTS.text },
  { key: "font", token: "f", type: { kind: "string" }, default: WORD_ART_DEFAULTS.font },
  { key: "weight", token: "w", type: { kind: "int" }, default: WORD_ART_DEFAULTS.weight },
  { key: "italic", token: "i", type: { kind: "bool" }, default: WORD_ART_DEFAULTS.italic },
  { key: "textCase", token: "C", type: { kind: "enum", values: ["as-typed", "upper", "lower", "title"] }, default: WORD_ART_DEFAULTS.textCase },
  { key: "scaleX", token: "x", type: { kind: "float", step: 1 }, default: WORD_ART_DEFAULTS.scaleX },
  { key: "scaleY", token: "y", type: { kind: "float", step: 1 }, default: WORD_ART_DEFAULTS.scaleY },
  { key: "profile", token: "p", type: { kind: "enum", values: ["flat", "round", "bevel", "custom"] }, default: WORD_ART_DEFAULTS.profile },
  { key: "roundConvex", token: "v", type: { kind: "bool" }, default: WORD_ART_DEFAULTS.roundConvex },
  { key: "bezier", token: "z", type: { kind: "floatTuple", length: 4, step: 0.001 }, default: WORD_ART_DEFAULTS.bezier },
  { key: "depth", token: "d", type: { kind: "float", step: 1 }, default: WORD_ART_DEFAULTS.depth },
  { key: "letterSpacing", token: "l", type: { kind: "float", step: 1 }, default: WORD_ART_DEFAULTS.letterSpacing },
  { key: "lineHeight", token: "H", type: { kind: "float", step: 0.05 }, default: WORD_ART_DEFAULTS.lineHeight },
  { key: "align", token: "a", type: { kind: "enum", values: ["left", "center", "right"] }, default: WORD_ART_DEFAULTS.align },
  { key: "underline", token: "u", type: { kind: "bool" }, default: WORD_ART_DEFAULTS.underline },
  { key: "strike", token: "s", type: { kind: "bool" }, default: WORD_ART_DEFAULTS.strike },
  { key: "color", token: "k", type: { kind: "color" }, default: WORD_ART_DEFAULTS.color },
  { key: "sideColor", token: "K", type: { kind: "color" }, default: WORD_ART_DEFAULTS.sideColor },
  { key: "backColor", token: "b", type: { kind: "color" }, default: WORD_ART_DEFAULTS.backColor },
  { key: "offset", token: "o", type: { kind: "float", step: 1 }, default: WORD_ART_DEFAULTS.offset },
  { key: "curveSegments", token: "j", type: { kind: "float", step: 1 }, default: WORD_ART_DEFAULTS.curveSegments },
  { key: "simplify", token: "S", type: { kind: "float", step: 0.5 }, default: WORD_ART_DEFAULTS.simplify },
  { key: "profileSegments", token: "e", type: { kind: "float", step: 1 }, default: WORD_ART_DEFAULTS.profileSegments },
  { key: "warpShape", token: "W", type: { kind: "enum", values: ["none", "arch", "archDown", "arc", "wave", "bulge", "cone", "slantUp", "slantDown"] }, default: WORD_ART_DEFAULTS.warpShape },
  { key: "warpAmount", token: "A", type: { kind: "float", step: 0.02 }, default: WORD_ART_DEFAULTS.warpAmount },
  { key: "spin", token: "n", type: { kind: "bool" }, default: WORD_ART_DEFAULTS.spin },
  { key: "perspective", token: "P", type: { kind: "bool" }, default: WORD_ART_DEFAULTS.perspective },
  { key: "zoomScale", token: "Z", type: { kind: "float", step: 0.05 }, default: WORD_ART_DEFAULTS.zoomScale },
  { key: "turn", token: "T", type: { kind: "float", step: 0.1 }, default: WORD_ART_DEFAULTS.turn },
  { key: "tilt", token: "L", type: { kind: "float", step: 0.1 }, default: WORD_ART_DEFAULTS.tilt },
  { key: "density", token: "D", type: { kind: "float", step: 0.1 }, default: WORD_ART_DEFAULTS.density },
  { key: "renderMode", token: "m", type: { kind: "enum", values: ["wireframe", "solid", "ink"] }, default: WORD_ART_DEFAULTS.renderMode },
  { key: "charMode", token: "M", type: { kind: "enum", values: ["ascii", "braille", "halfblock"] }, default: WORD_ART_DEFAULTS.charMode },
  { key: "hiddenLines", token: "h", type: { kind: "enum", values: ["show", "hide"] }, default: WORD_ART_DEFAULTS.hiddenLines },
  { key: "lightIntensity", token: "g", type: { kind: "float", step: 0.05 }, default: WORD_ART_DEFAULTS.lightIntensity },
  { key: "ambient", token: "B", type: { kind: "float", step: 0.05 }, default: WORD_ART_DEFAULTS.ambient },
  { key: "lightColor", token: "N", type: { kind: "color" }, default: WORD_ART_DEFAULTS.lightColor },
  { key: "lightAz", token: "G", type: { kind: "float", step: 1 }, default: WORD_ART_DEFAULTS.lightAz },
  { key: "lightEl", token: "E", type: { kind: "float", step: 1 }, default: WORD_ART_DEFAULTS.lightEl },
  { key: "fillType", token: "F", type: { kind: "enum", values: ["solid", "gradient", "rainbow", "texture", "image"] }, default: WORD_ART_DEFAULTS.fillType },
  { key: "gradA", token: "1", type: { kind: "color" }, default: WORD_ART_DEFAULTS.gradA },
  { key: "gradB", token: "2", type: { kind: "color" }, default: WORD_ART_DEFAULTS.gradB },
  { key: "gradAngle", token: "3", type: { kind: "float", step: 5 }, default: WORD_ART_DEFAULTS.gradAngle },
  { key: "faceTex", token: "4", type: { kind: "enum", values: TEXTURE_IDS }, default: WORD_ART_DEFAULTS.faceTex },
  { key: "sideFill", token: "5", type: { kind: "enum", values: ["solid", "texture", "none"] }, default: WORD_ART_DEFAULTS.sideFill },
  { key: "sideTex", token: "6", type: { kind: "enum", values: TEXTURE_IDS }, default: WORD_ART_DEFAULTS.sideTex },
  { key: "backFill", token: "7", type: { kind: "enum", values: ["solid", "texture", "none"] }, default: WORD_ART_DEFAULTS.backFill },
  { key: "backTex", token: "8", type: { kind: "enum", values: TEXTURE_IDS }, default: WORD_ART_DEFAULTS.backTex },
  { key: "outlineOn", token: "9", type: { kind: "bool" }, default: WORD_ART_DEFAULTS.outlineOn },
  { key: "outlineColor", token: "O", type: { kind: "color" }, default: WORD_ART_DEFAULTS.outlineColor },
  { key: "outlineWidth", token: "0", type: { kind: "float", step: 0.5 }, default: WORD_ART_DEFAULTS.outlineWidth },
  { key: "layered", token: "Y", type: { kind: "bool" }, default: WORD_ART_DEFAULTS.layered },
  { key: "effectId", token: "c", type: { kind: "enum", values: ["", ...EFFECT_ID_VALUES] }, default: "" },
  { key: "effectBlend", token: "r", type: { kind: "enum", values: ["replace", "over"] }, default: "replace" },
  { key: "effectPaused", token: "q", type: { kind: "bool" }, default: false },
  { key: "effectTimeScale", token: "V", type: { kind: "float", step: 0.0001 }, default: 1 },
  { key: "effectParams", token: "R", type: { kind: "string" }, default: "" },
];

const WORD_ART_SCHEMA_VERSION = "1";
export const wordArtCodec = createUrlCodec<WordArtUrlState>(WORD_ART_SCHEMA_VERSION, wordArtFields);

const WORD_ART_PARAM = "w";

/** Read the initial state from the URL (defaults for anything absent/garbage
 *  — `decode` never throws, see urlState.ts). */
export function readInitialWordArtState(): WordArtUrlState {
  return { ...WORD_ART_DEFAULTS, ...wordArtCodec.decode(readUrlParam(WORD_ART_PARAM)) };
}

/** Restore the Effects folder's selection (mirrors the gallery's `fx` shape,
 *  folded into this page's single packed param instead of a second key). */
export function wordArtEffectStateFromUrlState(state: WordArtUrlState): GalleryEffectState {
  if (!state.effectId) return DEFAULT_GALLERY_EFFECT_STATE;
  const definition = galleryEffectDefinition(state.effectId as GlyphEffectId);
  if (!definition) return DEFAULT_GALLERY_EFFECT_STATE;
  const defaults = galleryEffectDefaultParams(definition);
  const overrides = decodeEffectParamsPacked(definition.parameterSchema, state.effectParams) as Record<string, GalleryEffectParamValue>;
  return {
    effectId: definition.id,
    effectVersion: definition.version,
    blend: state.effectBlend,
    paused: state.effectPaused,
    timeScale: state.effectTimeScale,
    params: sanitizeGalleryEffectParams(definition, { ...defaults, ...overrides }),
  };
}

/** Pack every control (non-defaults only) into the single `?w=` param.
 *  `effectState` is folded in here (not a second query key) so it can't race
 *  the rest of the page's controls for the last write. */
export function writeWordArtUrlState(state: WordArtUrlState, effectState: GalleryEffectState): void {
  const definition = effectState.effectId ? galleryEffectDefinition(effectState.effectId) : null;
  const full: WordArtUrlState = {
    ...state,
    effectId: definition ? definition.id : "",
    effectBlend: definition ? effectState.blend : "replace",
    effectPaused: definition ? effectState.paused : false,
    effectTimeScale: definition ? effectState.timeScale : 1,
    effectParams: definition
      ? encodeEffectParamsPacked(definition.parameterSchema, galleryEffectDefaultParams(definition), effectState.params)
      : "",
  };
  scheduleCompactedUrlWrite(wordArtCodec, WORD_ART_PARAM, full);
}
