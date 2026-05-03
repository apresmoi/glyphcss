/* Shared lighting helpers for voxcss shapes.
 * Pure module — zero DOM dependencies.
 * For CSS named color resolution ("red", "tomato"), see html/colorResolver.ts.
 */
import type { CubeFace, WallsMask } from "../types";
import {
  type ParsedColor,
  parsePureColor,
  clampChannel,
  formatColor
} from "./color";

export type { ParsedColor };

const defaultColor: ParsedColor = { rgb: [204, 204, 204], alpha: 1 };
const colorCache = new Map<string, ParsedColor>();

export type ColorResolver = (input: string) => ParsedColor | null;
let externalResolver: ColorResolver | null = null;

/** Register an external color resolver (e.g. DOM-based) for named CSS colors. */
export function setColorResolver(resolver: ColorResolver | null): void {
  externalResolver = resolver;
}

export function parseColor(input: string): ParsedColor | null {
  if (!input) return null;
  const key = input.trim();
  const cached = colorCache.get(key);
  if (cached) return cached;

  const parsed = parsePureColor(key);
  if (parsed) {
    colorCache.set(key, parsed);
    return parsed;
  }

  if (externalResolver) {
    const resolved = externalResolver(key);
    if (resolved) {
      colorCache.set(key, resolved);
      return resolved;
    }
  }

  return null;
}

export function shadeColor(base: string, delta: number): string {
  const parsed = parseColor(base) ?? defaultColor;
  const rgb: [number, number, number] = [
    clampChannel(parsed.rgb[0] + delta),
    clampChannel(parsed.rgb[1] + delta),
    clampChannel(parsed.rgb[2] + delta)
  ];
  return formatColor({ rgb, alpha: parsed.alpha });
}

const FACE_ADJUSTMENTS: Record<CubeFace, number> = {
  t: 0,
  b: 0,
  fr: -15,
  fl: -25,
  bl: -40,
  br: -30
};

export function getCubeFaceLightDelta(face: CubeFace): number {
  return FACE_ADJUSTMENTS[face] ?? 0;
}

export function shadeCubeFace(base: string, face: CubeFace): string {
  const delta = getCubeFaceLightDelta(face);
  return shadeColor(base, delta);
}

const WALL_FACE_MAP: Partial<Record<keyof WallsMask, CubeFace>> = {
  fr: "fr",
  fl: "fl",
  bl: "bl",
  br: "br"
};

export function shadeWallFace(base: string, face: keyof WallsMask): string {
  const cubeFace = WALL_FACE_MAP[face];
  if (!cubeFace) return shadeColor(base, 0);
  const delta = FACE_ADJUSTMENTS[cubeFace] ?? 0;
  return shadeColor(base, -delta);
}

export type ShapeType = "ramp" | "wedge" | "spike" | "triangle" | "polygon";

interface ShapeSurfaceDefinition {
  id: string;
  baseAngle: number;
  allowPeak?: boolean;
}

export interface ShapeSurfaceLighting {
  id: string;
  angle: number;
  level: number;
  delta: number;
  color: string;
}

const SHAPE_SURFACE_DEFINITIONS: Record<ShapeType, ShapeSurfaceDefinition[]> = {
  ramp: [{ id: "slope", baseAngle: 0 }],
  wedge: [
    { id: "primary", baseAngle: 0 },
    { id: "secondary", baseAngle: 90 }
  ],
  spike: [
    { id: "primary", baseAngle: 0 },
    { id: "secondary", baseAngle: 270 }
  ],
  triangle: [{ id: "primary", baseAngle: 0 }],
  polygon: [{ id: "primary", baseAngle: 0 }]
};

const SHAPE_LIGHT_SOURCE_ANGLE = 180;
const SHAPE_LEVEL_DELTAS: Record<number, number> = {
  1: 18,
  2: 8,
  3: -12,
  4: -28
};

function normalizeShapeAngle(value: number): number {
  if (!Number.isFinite(value)) return 0;
  const normalized = value % 360;
  return normalized < 0 ? normalized + 360 : normalized;
}

function shapeAngularDifference(a: number, b: number): number {
  const diff = Math.abs(normalizeShapeAngle(a) - normalizeShapeAngle(b));
  return diff > 180 ? 360 - diff : diff;
}

function angleToBrightnessLevel(angle: number, { allowPeak = false }: { allowPeak?: boolean } = {}): number {
  const diff = shapeAngularDifference(angle, SHAPE_LIGHT_SOURCE_ANGLE);
  if (allowPeak && diff <= 10) return 1;
  if (diff <= 30) return 2;
  if (diff <= 90) return 3;
  return 4;
}

export function computeShapeLighting(
  shape: ShapeType,
  rotation: number,
  baseColor: string
): ShapeSurfaceLighting[] {
  const surfaces = SHAPE_SURFACE_DEFINITIONS[shape];
  if (!surfaces) return [];
  const normalizedRotation = normalizeShapeAngle(rotation);
  return surfaces.map((surface) => {
    const angle = normalizeShapeAngle(normalizedRotation + surface.baseAngle);
    const level = angleToBrightnessLevel(angle, { allowPeak: surface.allowPeak });
    const delta = SHAPE_LEVEL_DELTAS[level] ?? 0;
    return {
      id: surface.id,
      angle,
      level,
      delta,
      color: shadeColor(baseColor, delta)
    };
  });
}
