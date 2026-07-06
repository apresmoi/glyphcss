import type { PresetModel } from "../types";
import type { Polygon } from "@glyphcss/core";

const DEFAULT_ZOOM = 0.35;
const DEFAULT_TARGET_SIZE = 60;

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(Math.max(value, min), max);
}

export function smartZoomForPolygons(polygons: Polygon[]): number {
  if (polygons.length === 0) return DEFAULT_ZOOM;
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;
  for (const polygon of polygons) {
    for (const [x, y, z] of polygon.vertices) {
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      minZ = Math.min(minZ, z);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
      maxZ = Math.max(maxZ, z);
    }
  }
  const maxSpan = Math.max(maxX - minX, maxY - minY, maxZ - minZ);
  if (!Number.isFinite(maxSpan) || maxSpan <= 0) return DEFAULT_ZOOM;
  const spanRatio = clamp(maxSpan / 110, 0.06, 7);
  const zoom = 1.2 / Math.sqrt(spanRatio);
  return clamp(zoom, 0.06, 0.82);
}

function smartZoomForSpan(maxSpan: number): number {
  if (!Number.isFinite(maxSpan) || maxSpan <= 0) return DEFAULT_ZOOM;
  const spanRatio = clamp(maxSpan / 110, 0.06, 7);
  const zoom = 1.2 / Math.sqrt(spanRatio);
  return clamp(zoom, 0.06, 0.82);
}

function targetSizeForModel(model: PresetModel): number {
  const targetSize = model.options && "targetSize" in model.options ? model.options.targetSize : undefined;
  return typeof targetSize === "number" ? targetSize : DEFAULT_TARGET_SIZE;
}

export function defaultZoomForModel(model: PresetModel, polygons?: Polygon[]): number {
  const presetZoom = model.zoom ?? DEFAULT_ZOOM;
  const smartZoom = polygons ? smartZoomForPolygons(polygons) : smartZoomForSpan(targetSizeForModel(model));
  return clamp((presetZoom * 0.85 + smartZoom * 0.15) * 0.55, 0.08, 1.2);
}

export function smartZoomForPreset(model: PresetModel): number {
  return clamp(model.zoom ?? DEFAULT_ZOOM, 0.05, 2.5);
}
