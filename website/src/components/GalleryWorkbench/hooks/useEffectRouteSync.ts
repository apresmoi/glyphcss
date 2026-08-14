import { useEffect, type Dispatch, type SetStateAction } from "react";
import type { GlyphEffectId } from "@glyphcss/effects";
import {
  createUrlCodec,
  decodeEffectParamsPacked,
  encodeEffectParamsPacked,
  readUrlParam,
  writeUrlParam,
  type UrlField,
} from "../../../lib/urlState";
import {
  DEFAULT_GALLERY_EFFECT_STATE,
  GALLERY_EFFECT_CATALOG,
  galleryEffectDefinition,
  galleryEffectDefaultParams,
  sanitizeGalleryEffectParams,
} from "../effects";
import type { GalleryEffectParamValue, GalleryEffectState } from "../types";

const EFFECT_PARAM = "fx";
const EFFECT_SCHEMA_VERSION = "1";
const EFFECT_ID_VALUES = GALLERY_EFFECT_CATALOG.map((d) => d.id);

// Shape carried in the packed `fx` param. `params` is pre-packed against the
// chosen effect's own parameterSchema by `encodeEffectParamsPacked` (same
// generic codec /synth uses for its whole patch) and stored here as an opaque
// string field — so it round-trips through the same length-prefixed string
// primitive as any other string field, no JSON/escaping involved.
interface EffectRouteState {
  effectId: string;
  effectVersion: number;
  blend: "replace" | "over";
  paused: boolean;
  timeScale: number;
  params: string;
}

const EMPTY_ROUTE_STATE: EffectRouteState = {
  effectId: "",
  effectVersion: 0,
  blend: "replace",
  paused: false,
  timeScale: 1,
  params: "",
};

const effectFields: readonly UrlField<EffectRouteState>[] = [
  { key: "effectId", token: "i", type: { kind: "enum", values: EFFECT_ID_VALUES }, default: "" },
  { key: "effectVersion", token: "v", type: { kind: "int" }, default: 0 },
  { key: "blend", token: "b", type: { kind: "enum", values: ["replace", "over"] }, default: "replace" },
  { key: "paused", token: "p", type: { kind: "bool" }, default: false },
  { key: "timeScale", token: "s", type: { kind: "float", step: 0.0001 }, default: 1 },
  { key: "params", token: "x", type: { kind: "string" }, default: "" },
];

export const effectCodec = createUrlCodec<EffectRouteState>(EFFECT_SCHEMA_VERSION, effectFields);

function serializeEffectState(state: GalleryEffectState): string | null {
  if (!state.effectId) return null;
  const definition = galleryEffectDefinition(state.effectId);
  if (!definition) return null;
  const defaults = galleryEffectDefaultParams(definition);
  const params = encodeEffectParamsPacked(definition.parameterSchema, defaults, state.params);
  const encoded = effectCodec.encode({
    effectId: state.effectId,
    effectVersion: state.effectVersion,
    blend: state.blend,
    paused: state.paused,
    timeScale: state.timeScale,
    params,
  });
  return encoded === `p${EFFECT_SCHEMA_VERSION}` ? null : encoded;
}

function decodeEffectState(raw: string | null): GalleryEffectState {
  const route = { ...EMPTY_ROUTE_STATE, ...effectCodec.decode(raw) };
  if (!route.effectId) return DEFAULT_GALLERY_EFFECT_STATE;
  const definition = galleryEffectDefinition(route.effectId as GlyphEffectId);
  if (!definition) return DEFAULT_GALLERY_EFFECT_STATE;
  if (route.effectVersion !== definition.version) return DEFAULT_GALLERY_EFFECT_STATE;
  const timeScale = Number.isFinite(route.timeScale) ? Math.min(Math.max(route.timeScale, 0.05), 3) : 1;
  const overrides = decodeEffectParamsPacked(definition.parameterSchema, route.params) as Record<string, GalleryEffectParamValue>;
  return {
    effectId: definition.id,
    effectVersion: definition.version,
    blend: route.blend,
    paused: route.paused,
    timeScale,
    params: sanitizeGalleryEffectParams(definition, overrides),
  };
}

function currentEffectParam(): string | null {
  return readUrlParam(EFFECT_PARAM);
}

export function routeInitialEffectState(): GalleryEffectState {
  return decodeEffectState(currentEffectParam());
}

export function routeHasEffectState(): boolean {
  return routeInitialEffectState().effectId !== null;
}

export function setRouteEffectState(state: GalleryEffectState): void {
  writeUrlParam(EFFECT_PARAM, serializeEffectState(state));
}

export function clearRouteEffectState(): void {
  writeUrlParam(EFFECT_PARAM, null);
}

export function useEffectRouteSync(
  setEffectState: Dispatch<SetStateAction<GalleryEffectState>>,
): void {
  useEffect(() => {
    const handlePopState = () => setEffectState(decodeEffectState(currentEffectParam()));
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, [setEffectState]);
}
