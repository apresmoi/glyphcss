import type { PresetModel } from "../types";

const DEFAULT_ZOOM = 0.35;

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(Math.max(value, min), max);
}

export function defaultZoomForModel(model: PresetModel): number {
  return model.zoom ?? DEFAULT_ZOOM;
}

export function smartZoomForPreset(model: PresetModel): number {
  return clamp(model.zoom ?? DEFAULT_ZOOM, 0.06, 1.2);
}
