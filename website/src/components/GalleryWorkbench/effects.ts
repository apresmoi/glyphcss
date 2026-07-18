import {
  GlyphEffectCatalog,
  GlyphEffects,
  type GlyphEffectId,
  type GlyphStockEffect,
} from "@glyphcss/effects";
import type {
  GlyphEffectNumberParamSpec,
  GlyphEffectParamSpec,
} from "glyphcss";
import type {
  GalleryEffectParamValue,
  GalleryEffectState,
} from "./types";

export type GalleryEffectNumberParamSpec = GlyphEffectNumberParamSpec;
export type GalleryEffectParamSpec = GlyphEffectParamSpec;
export type GalleryEffectDefinition = GlyphStockEffect;

const catalog: readonly GalleryEffectDefinition[] = GlyphEffectCatalog;
const definitionsById = new Map<GlyphEffectId, GalleryEffectDefinition>();

for (const definition of catalog) definitionsById.set(definition.id, definition);
for (const definition of Object.values(GlyphEffects)) {
  if (!definitionsById.has(definition.id)) definitionsById.set(definition.id, definition);
}

export const GALLERY_EFFECT_CATALOG = [...definitionsById.values()];

export const GALLERY_EFFECT_OPTIONS: Record<string, string> = {
  None: "",
  ...Object.fromEntries(GALLERY_EFFECT_CATALOG.map((definition) => [definition.label, definition.id])),
};

export const DEFAULT_GALLERY_EFFECT_STATE: GalleryEffectState = {
  effectId: null,
  effectVersion: 1,
  blend: "replace",
  paused: false,
  timeScale: 1,
  params: {},
};

export function galleryEffectDefinition(
  effectId: GlyphEffectId | null,
): GalleryEffectDefinition | null {
  return effectId ? definitionsById.get(effectId) ?? null : null;
}

export function galleryEffectDefaultParams(
  definition: GalleryEffectDefinition,
): Record<string, GalleryEffectParamValue> {
  const params: Record<string, GalleryEffectParamValue> = {};
  for (const [name, spec] of Object.entries(definition.parameterSchema)) {
    if (name === "time") continue;
    params[name] = spec.default;
  }
  return params;
}

function galleryEffectProgramParams(
  definition: GalleryEffectDefinition,
  params: Readonly<Record<string, GalleryEffectParamValue>>,
): Record<string, GalleryEffectParamValue> {
  const complete: Record<string, GalleryEffectParamValue> = {};
  for (const [name, spec] of Object.entries(definition.parameterSchema)) {
    complete[name] = params[name] ?? spec.default;
  }
  return complete;
}

export function galleryEffectParamsAreValid(
  definition: GalleryEffectDefinition,
  params: Readonly<Record<string, GalleryEffectParamValue>>,
): boolean {
  try {
    definition.program.validateParams?.(galleryEffectProgramParams(definition, params) as never);
    return true;
  } catch {
    return false;
  }
}

export function createGalleryEffectState(
  effectId: GlyphEffectId,
  options: Partial<Pick<GalleryEffectState, "blend" | "paused" | "timeScale">> = {},
): GalleryEffectState | null {
  const definition = galleryEffectDefinition(effectId);
  if (!definition) return null;
  return {
    effectId,
    effectVersion: definition.version,
    blend: options.blend ?? definition.defaultBlend,
    paused: options.paused ?? false,
    timeScale: options.timeScale ?? 1,
    params: galleryEffectDefaultParams(definition),
  };
}

export function sanitizeGalleryEffectParams(
  definition: GalleryEffectDefinition,
  candidate: unknown,
): Record<string, GalleryEffectParamValue> {
  const params = galleryEffectDefaultParams(definition);
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return params;
  for (const [name, spec] of Object.entries(definition.parameterSchema)) {
    if (name === "time") continue;
    const value = (candidate as Record<string, unknown>)[name];
    if (spec.kind === "number") {
      if (typeof value === "number" && Number.isFinite(value)) {
        params[name] = Math.min(
          spec.max ?? Number.POSITIVE_INFINITY,
          Math.max(spec.min ?? Number.NEGATIVE_INFINITY, value),
        );
      }
    } else if (spec.kind === "boolean") {
      if (typeof value === "boolean") params[name] = value;
    } else if (typeof value === "string" && value.length <= 256) {
      if (spec.kind === "color") {
        if (/^#[\da-f]{3}(?:[\da-f]{1}|[\da-f]{3}|[\da-f]{5})?$/i.test(value)) params[name] = value;
      } else if (!spec.values || spec.values.includes(value)) {
        params[name] = value;
      }
    }
  }
  const speedMin = params.speedMin;
  const speedMax = params.speedMax;
  if (typeof speedMin === "number" && typeof speedMax === "number" && speedMin > speedMax) {
    params.speedMax = speedMin;
  }
  return galleryEffectParamsAreValid(definition, params)
    ? params
    : galleryEffectDefaultParams(definition);
}

export function galleryEffectExportName(definition: GalleryEffectDefinition | null): string | null {
  if (!definition) return null;
  for (const [name, effect] of Object.entries(GlyphEffects)) {
    if (effect === definition || effect.id === definition.id) return name;
  }
  return null;
}
