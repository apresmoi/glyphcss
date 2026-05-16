import { parsePureColor } from "@layoutit/polycss-react";
import type { Polygon } from "@layoutit/polycss-react";
import type { PresetModel } from "../types";

// Mirrors the lighting/zoom defaults from DEFAULT_SCENE so this module has no
// dependency on GalleryWorkbench's runtime state object.
const DEFAULT_AMBIENT_INTENSITY = 0.4;
const DEFAULT_LIGHT_INTENSITY = 1;
const DEFAULT_ZOOM = 0.35;

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(Math.max(value, min), max);
}

function polygonArea(polygon: Polygon): number {
  const [origin] = polygon.vertices;
  if (!origin || polygon.vertices.length < 3) return 0;
  let area = 0;
  for (let i = 1; i < polygon.vertices.length - 1; i += 1) {
    const a = polygon.vertices[i];
    const b = polygon.vertices[i + 1];
    const ax = a[0] - origin[0];
    const ay = a[1] - origin[1];
    const az = a[2] - origin[2];
    const bx = b[0] - origin[0];
    const by = b[1] - origin[1];
    const bz = b[2] - origin[2];
    const cx = ay * bz - az * by;
    const cy = az * bx - ax * bz;
    const cz = ax * by - ay * bx;
    area += Math.hypot(cx, cy, cz) * 0.5;
  }
  return area;
}

function colorLuminance(color: string | undefined): number | null {
  if (!color) return null;
  const parsed = parsePureColor(color);
  if (!parsed) return null;
  const [r, g, b] = parsed.rgb;
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

function roundToStep(value: number, step: number): number {
  return Number((Math.round(value / step) * step).toFixed(4));
}

export function modelLightingStats(polygons: Polygon[]): {
  averageLuminance: number;
  colorCoverage: number;
  textureCoverage: number;
} {
  let totalWeight = 0;
  let colorWeight = 0;
  let luminanceSum = 0;
  let texturedWeight = 0;

  for (const polygon of polygons) {
    const weight = Math.max(polygonArea(polygon), 1);
    totalWeight += weight;

    const luminance = colorLuminance(polygon.color);
    if (luminance !== null) {
      colorWeight += weight;
      luminanceSum += luminance * weight;
    }

    if (polygon.texture || polygon.material?.texture || polygon.textureTriangles?.length) {
      texturedWeight += weight;
    }
  }

  const averageLuminance = colorWeight > 0 ? luminanceSum / colorWeight : 0.55;
  const colorCoverage = totalWeight > 0 ? colorWeight / totalWeight : 0;
  const textureCoverage = totalWeight > 0 ? texturedWeight / totalWeight : 0;
  return { averageLuminance, colorCoverage, textureCoverage };
}

export function smartAmbientForModel(model: PresetModel, polygons: Polygon[]): number {
  if (polygons.length === 0) return DEFAULT_AMBIENT_INTENSITY;

  const { averageLuminance, colorCoverage, textureCoverage } = modelLightingStats(polygons);

  const neutralLuminance = 0.52;
  const darkness = clamp((neutralLuminance - averageLuminance) / neutralLuminance, 0, 1);
  const brightness = clamp((averageLuminance - neutralLuminance) / (1 - neutralLuminance), 0, 1);
  // Albedo is not exposure: very bright models still need fill, and dark
  // saturated models should not be washed out by aggressive compensation.
  const luminanceAdjustment =
    Math.pow(darkness, 1.35) * 0.14 -
    Math.pow(brightness, 1.4) * 0.08;
  const densityLift = clamp(Math.log10(Math.max(polygons.length, 1) / 1800), -0.8, 1.2) * 0.025;
  const textureLift = textureCoverage > 0.3 && colorCoverage < 0.75 && averageLuminance < 0.58 ? 0.04 : 0;
  const voxelLift = model.kind === "vox" ? 0.03 : 0;

  return roundToStep(
    clamp(
      DEFAULT_AMBIENT_INTENSITY + luminanceAdjustment + densityLift + textureLift + voxelLift,
      0.28,
      0.65,
    ),
    0.05,
  );
}

export function smartKeyIntensityForModel(polygons: Polygon[]): number {
  if (polygons.length === 0) return DEFAULT_LIGHT_INTENSITY;

  const { averageLuminance } = modelLightingStats(polygons);
  const neutralLuminance = 0.52;
  const darkness = clamp((neutralLuminance - averageLuminance) / neutralLuminance, 0, 1);
  const brightness = clamp((averageLuminance - neutralLuminance) / (1 - neutralLuminance), 0, 1);
  const keyAdjustment =
    Math.pow(darkness, 1.6) * 0.04 -
    Math.pow(brightness, 1.2) * 0.12;

  return roundToStep(
    clamp(
      DEFAULT_LIGHT_INTENSITY + keyAdjustment,
      0.85,
      1.05,
    ),
    0.05,
  );
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
  const spanX = maxX - minX;
  const spanY = maxY - minY;
  const spanZ = maxZ - minZ;
  const maxSpan = Math.max(spanX, spanY, spanZ);
  if (!Number.isFinite(maxSpan) || maxSpan <= 0) return DEFAULT_ZOOM;
  const spanRatio = clamp(maxSpan / 110, 0.06, 7);
  const zoom = 1.2 / Math.sqrt(spanRatio);
  return clamp(zoom, 0.06, 0.82);
}

export function defaultZoomForModel(model: PresetModel, polygons: Polygon[]): number {
  const presetZoom = model.zoom ?? DEFAULT_ZOOM;
  const smartZoom = smartZoomForPolygons(polygons);
  return clamp((presetZoom * 0.85 + smartZoom * 0.15) * 0.55, 0.08, 1.2);
}
