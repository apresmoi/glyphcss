/* Shared lighting helpers for voxcss shapes. */
import type { CubeFace, WallsMask } from "./types";

interface ParsedColor {
  rgb: [number, number, number];
  alpha: number;
}

const defaultColor: ParsedColor = { rgb: [204, 204, 204], alpha: 1 };
const colorCache = new Map<string, ParsedColor>();
let probeEl: HTMLElement | null = null;

function parseHexColor(value: string): ParsedColor | null {
  const hex = value.replace("#", "");
  if (hex.length === 3) {
    const r = parseInt(hex[0] + hex[0], 16);
    const g = parseInt(hex[1] + hex[1], 16);
    const b = parseInt(hex[2] + hex[2], 16);
    if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) return null;
    return { rgb: [r, g, b], alpha: 1 };
  }
  if (hex.length === 6) {
    const r = parseInt(hex.slice(0, 2), 16);
    const g = parseInt(hex.slice(2, 4), 16);
    const b = parseInt(hex.slice(4, 6), 16);
    if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) return null;
    return { rgb: [r, g, b], alpha: 1 };
  }
  return null;
}

function ensureProbe(doc: Document | null = typeof document !== "undefined" ? document : null): HTMLElement | null {
  if (typeof document === "undefined" && !doc) return null;
  if (probeEl && probeEl.ownerDocument) return probeEl;
  const owner = doc ?? document;
  if (!owner) return null;
  probeEl = owner.createElement("div");
  owner.head.appendChild(probeEl);
  return probeEl;
}

export function parseColor(input: string): ParsedColor | null {
  if (!input) return null;
  const key = input.trim();
  const cached = colorCache.get(key);
  if (cached) return cached;

  const hexParsed = parseHexColor(key);
  if (hexParsed) {
    colorCache.set(key, hexParsed);
    return hexParsed;
  }

  const probe = ensureProbe();
  if (!probe) return null;
  probe.style.color = "";
  probe.style.color = key;
  const computed = getComputedStyle(probe);
  const value = computed.color;
  if (!value || value === "rgba(0, 0, 0, 0)" || value === "transparent") {
    return null;
  }
  const match = value.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/i);
  if (!match) return null;
  const parsed: ParsedColor = {
    rgb: [Number(match[1]), Number(match[2]), Number(match[3])],
    alpha: match[4] ? Number(match[4]) : 1
  };
  colorCache.set(key, parsed);
  return parsed;
}

function clampChannel(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value)));
}

function formatColor(color: ParsedColor): string {
  const [r, g, b] = color.rgb.map(clampChannel) as [number, number, number];
  return color.alpha < 1 ? `rgba(${r}, ${g}, ${b}, ${color.alpha})` : `rgb(${r}, ${g}, ${b})`;
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

export type DimetricShapeType = "flat" | "ramp" | "wedge" | "spike";

interface DimetricSurfaceDefinition {
  id: string;
  baseAngle: number;
  allowPeak?: boolean;
}

export interface DimetricSurfaceLighting {
  id: string;
  angle: number;
  level: number;
  color: string;
}

const DIMETRIC_SURFACE_DEFINITIONS: Record<DimetricShapeType, DimetricSurfaceDefinition[]> = {
  flat: [{ id: "top", baseAngle: 180, allowPeak: true }],
  ramp: [{ id: "slope", baseAngle: 0 }],
  wedge: [
    { id: "primary", baseAngle: 0 },
    { id: "secondary", baseAngle: 90 }
  ],
  spike: [
    { id: "primary", baseAngle: 0 },
    { id: "secondary", baseAngle: 270 }
  ]
};

const DIMETRIC_LIGHT_SOURCE_ANGLE = 180;
const DIMETRIC_LEVEL_DELTAS: Record<number, number> = {
  1: 18,
  2: 8,
  3: -12,
  4: -28
};

function normalizeDimetricAngle(value: number): number {
  if (!Number.isFinite(value)) return 0;
  const normalized = value % 360;
  return normalized < 0 ? normalized + 360 : normalized;
}

function dimetricAngularDifference(a: number, b: number): number {
  const diff = Math.abs(normalizeDimetricAngle(a) - normalizeDimetricAngle(b));
  return diff > 180 ? 360 - diff : diff;
}

function angleToBrightnessLevel(angle: number, { allowPeak = false }: { allowPeak?: boolean } = {}): number {
  const diff = dimetricAngularDifference(angle, DIMETRIC_LIGHT_SOURCE_ANGLE);
  if (allowPeak && diff <= 10) return 1;
  if (diff <= 30) return 2;
  if (diff <= 90) return 3;
  return 4;
}

export function computeDimetricLighting(
  shape: DimetricShapeType,
  rotation: number,
  baseColor: string
): DimetricSurfaceLighting[] {
  const surfaces = DIMETRIC_SURFACE_DEFINITIONS[shape];
  if (!surfaces) return [];
  const normalizedRotation = normalizeDimetricAngle(rotation);
  return surfaces.map((surface) => {
    const angle = normalizeDimetricAngle(normalizedRotation + surface.baseAngle);
    const level = angleToBrightnessLevel(angle, { allowPeak: surface.allowPeak });
    const delta = DIMETRIC_LEVEL_DELTAS[level] ?? 0;
    return {
      id: surface.id,
      angle,
      level,
      color: shadeColor(baseColor, delta)
    };
  });
}
