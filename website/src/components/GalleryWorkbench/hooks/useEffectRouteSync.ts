import { useEffect, type Dispatch, type SetStateAction } from "react";
import type { GlyphEffectId } from "@glyphcss/effects";
import {
  DEFAULT_GALLERY_EFFECT_STATE,
  galleryEffectDefinition,
  galleryEffectDefaultParams,
  sanitizeGalleryEffectParams,
} from "../effects";
import type { GalleryEffectParamValue, GalleryEffectState } from "../types";

const EFFECT_PARAM = "fx";
const EFFECT_ROUTE_VERSION = 1;
const MAX_EFFECT_ROUTE_LENGTH = 8_192;

type SerializedEffectState = {
  v: 1;
  id: string;
  ev: number;
  b?: "replace" | "over";
  p?: 1;
  s?: number;
  x?: Record<string, GalleryEffectParamValue>;
};

function writeEffectParam(value: string | null): void {
  if (typeof window === "undefined") return;
  const params = new URLSearchParams(window.location.search);
  if (value) params.set(EFFECT_PARAM, value);
  else params.delete(EFFECT_PARAM);
  const search = params.toString();
  const next = `${window.location.pathname}${search ? `?${search}` : ""}${window.location.hash}`;
  const current = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  if (next !== current) window.history.replaceState(window.history.state, "", next);
}

function sameParamValue(a: GalleryEffectParamValue, b: GalleryEffectParamValue): boolean {
  if (typeof a === "number" && typeof b === "number") {
    return Number(a.toFixed(6)) === Number(b.toFixed(6));
  }
  return a === b;
}

function serializeEffectState(state: GalleryEffectState): string | null {
  if (!state.effectId) return null;
  const definition = galleryEffectDefinition(state.effectId);
  if (!definition) return null;
  const defaults = galleryEffectDefaultParams(definition);
  const overrides: Record<string, GalleryEffectParamValue> = {};
  for (const [name, value] of Object.entries(state.params)) {
    if (name === "time" || !(name in definition.parameterSchema)) continue;
    if (!sameParamValue(value, defaults[name]!)) overrides[name] = value;
  }
  const payload: SerializedEffectState = {
    v: EFFECT_ROUTE_VERSION,
    id: state.effectId,
    ev: state.effectVersion,
    ...(state.blend !== definition.defaultBlend ? { b: state.blend } : null),
    ...(state.paused ? { p: 1 as const } : null),
    ...(state.timeScale !== 1 ? { s: Number(state.timeScale.toFixed(4)) } : null),
    ...(Object.keys(overrides).length > 0 ? { x: overrides } : null),
  };
  return JSON.stringify(payload);
}

function decodeEffectState(raw: string | null): GalleryEffectState {
  if (!raw || raw.length > MAX_EFFECT_ROUTE_LENGTH) return DEFAULT_GALLERY_EFFECT_STATE;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return DEFAULT_GALLERY_EFFECT_STATE;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return DEFAULT_GALLERY_EFFECT_STATE;
  const payload = parsed as Partial<SerializedEffectState>;
  if (payload.v !== EFFECT_ROUTE_VERSION || typeof payload.id !== "string") return DEFAULT_GALLERY_EFFECT_STATE;
  const definition = galleryEffectDefinition(payload.id as GlyphEffectId);
  if (!definition) return DEFAULT_GALLERY_EFFECT_STATE;
  const effectVersion = definition.version;
  if (payload.ev !== effectVersion) return DEFAULT_GALLERY_EFFECT_STATE;
  const timeScale = typeof payload.s === "number" && Number.isFinite(payload.s)
    ? Math.min(Math.max(payload.s, 0.05), 3)
    : 1;
  return {
    effectId: definition.id,
    effectVersion,
    blend: payload.b === "over" || payload.b === "replace"
      ? payload.b
      : definition.defaultBlend,
    paused: payload.p === 1,
    timeScale,
    params: sanitizeGalleryEffectParams(definition, payload.x),
  };
}

function currentEffectParam(): string | null {
  if (typeof window === "undefined") return null;
  return new URLSearchParams(window.location.search).get(EFFECT_PARAM);
}

export function routeInitialEffectState(): GalleryEffectState {
  return decodeEffectState(currentEffectParam());
}

export function routeHasEffectState(): boolean {
  return routeInitialEffectState().effectId !== null;
}

export function setRouteEffectState(state: GalleryEffectState): void {
  writeEffectParam(serializeEffectState(state));
}

export function clearRouteEffectState(): void {
  writeEffectParam(null);
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
