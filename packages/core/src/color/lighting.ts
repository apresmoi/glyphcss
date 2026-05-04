/* Shared lighting helpers for polycss polygons.
 * Pure module — zero DOM dependencies.
 *
 * Voxcss carried per-cube-face shading helpers (`shadeCubeFace`,
 * `shadeWallFace`, `getCubeFaceLightDelta`) and a shape-rotation-based
 * `computeShapeLighting(shape, rotation, baseColor)`. All of that's gone
 * with cube removal in Phase 2.
 *
 * The new `computeShapeLighting(normal, baseColor, light?)` is a per-polygon
 * Lambert shader. The renderer (`Poly.tsx`) may keep its Lambert math inline
 * for performance, but the helper exists for users who want to shade
 * polygons outside the renderer (e.g. SSR, validators, alternate backends).
 */
import type { DirectionalLight, Vec3 } from "../types";
import {
  type ParsedColor,
  parsePureColor,
  clampChannel,
  formatColor
} from "./color";

export type { ParsedColor };

const defaultColor: ParsedColor = { rgb: [204, 204, 204], alpha: 1 };
const colorCache = new Map<string, ParsedColor>();

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

  return null;
}

/**
 * Lighten/darken a color by a flat per-channel delta. Used by the framework
 * wrappers for tinted-overlay debug renderers; per-polygon Lambert shading
 * goes through `computeShapeLighting` instead.
 */
export function shadeColor(base: string, delta: number): string {
  const parsed = parseColor(base) ?? defaultColor;
  const rgb: [number, number, number] = [
    clampChannel(parsed.rgb[0] + delta),
    clampChannel(parsed.rgb[1] + delta),
    clampChannel(parsed.rgb[2] + delta)
  ];
  return formatColor({ rgb, alpha: parsed.alpha });
}

const DEFAULT_LIGHT: Required<Omit<DirectionalLight, "ambientColor">> & { ambientColor: string } = {
  direction: [0, 0, -1],
  color: "#ffffff",
  ambientColor: "#ffffff",
  ambient: 0.35
};

function normalizeVec3(v: Vec3): Vec3 {
  const len = Math.hypot(v[0], v[1], v[2]);
  if (len < 1e-12) return [0, 0, 0];
  return [v[0] / len, v[1] / len, v[2] / len];
}

function tintChannel(base: number, tintHex: string, channel: 0 | 1 | 2): number {
  const tint = parseColor(tintHex) ?? defaultColor;
  // Per-channel multiply, normalized to 0..1, with the tint scaled into 0..1.
  return base * (tint.rgb[channel] / 255);
}

/**
 * Per-polygon Lambert shading. Given a polygon's outward normal and a
 * directional light, returns the shaded color as a CSS rgb string.
 *
 * Math: lambert = max(0, normal · (-lightDir)). Final color =
 *   ambientContribution + (lambert * (1 - ambient) * directionalContribution)
 * where each contribution is base color tinted by light color (or ambient
 * color) per-channel.
 *
 * Pass `light` undefined to use the default light (top-down white,
 * ambient 0.35) — useful for static SSR/validator renders where the
 * caller just wants "looks shaded, doesn't matter how".
 */
export function computeShapeLighting(
  normal: Vec3,
  baseColor: string,
  light?: DirectionalLight,
): string {
  const base = parseColor(baseColor) ?? defaultColor;
  const dir = normalizeVec3(light?.direction ?? DEFAULT_LIGHT.direction);
  const lightHex = light?.color ?? DEFAULT_LIGHT.color;
  const ambientHex = light?.ambientColor ?? DEFAULT_LIGHT.ambientColor;
  const ambient = Math.max(0, Math.min(1, light?.ambient ?? DEFAULT_LIGHT.ambient));

  const n = normalizeVec3(normal);
  // Light shines TOWARD `dir`; surface receives light when its outward
  // normal points back toward the source (-dir).
  const lambert = Math.max(0, -(n[0] * dir[0] + n[1] * dir[1] + n[2] * dir[2]));
  const directional = (1 - ambient) * lambert;

  const out: [number, number, number] = [0, 0, 0];
  for (let c = 0 as 0 | 1 | 2; c < 3; c = (c + 1) as 0 | 1 | 2) {
    const baseC = base.rgb[c];
    const ambContrib = tintChannel(baseC, ambientHex, c) * ambient;
    const dirContrib = tintChannel(baseC, lightHex, c) * directional;
    out[c] = clampChannel(ambContrib + dirContrib);
  }
  return formatColor({ rgb: out, alpha: base.alpha });
}
