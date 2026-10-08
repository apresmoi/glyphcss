/**
 * Named sequential colorscale anchors and band resolution for the surface
 * mark's colour (PLAN-3d.md §5 "Colour"). Approximate, hand-picked anchor
 * stops for `viridis`/`cividis`/`magma` (commonly published reference
 * points for each map, not a pixel-exact port of matplotlib's own spline)
 * — good enough for a monospace-cell render, and a caller who needs exact
 * fidelity passes a custom anchor array instead. `greys` is a plain
 * black-to-white ramp.
 */
import { chart3dError } from "./validate";
import type { GlyphChart3dColorscale, GlyphChart3dColorscaleName } from "./types";
import { GLYPH_CHART_3D_COLORSCALE_NAMES } from "./types";

const CANONICAL_HEX_COLOR = /^#[0-9a-f]{6}$/;
function isCanonicalHexColor(v: unknown): v is string {
  return typeof v === "string" && CANONICAL_HEX_COLOR.test(v);
}

const COLORSCALE_ANCHORS: Readonly<Record<GlyphChart3dColorscaleName, readonly string[]>> = {
  viridis: ["#440154", "#482878", "#3e4a89", "#31688e", "#26828e", "#1f9e89", "#35b779", "#6ece58", "#b5de2b", "#fde725"],
  cividis: ["#00204d", "#00336f", "#39486b", "#575d6d", "#707173", "#8a8779", "#a69d75", "#c4b56c", "#e4cf5b", "#ffea46"],
  magma: ["#000004", "#180f3e", "#451077", "#721f81", "#9f2f7f", "#cd4071", "#f1605d", "#fd9567", "#feca8d", "#fcfdbf"],
  greys: ["#000000", "#ffffff"],
};

function hexToRgb(hex: string): readonly [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
}

/**
 * CIELAB `L*` (perceptual lightness) from an sRGB hex colour, `0` (black) to
 * `100` (white). `L*` depends only on relative luminance `Y` (the standard
 * `f(Y/Yn)` piecewise formula, `Yn = 1` for the sRGB white point) — the
 * `a*`/`b*` (hue/chroma) channels would need the full `X`/`Z` tristimulus
 * values, which this validation has no use for.
 */
function srgbChannelToLinear(c8: number): number {
  const c = c8 / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}
/** Exported for `colorscale.test.ts`'s own named-preset monotonicity gate. */
export function hexLStar(hex: string): number {
  const [r, g, b] = hexToRgb(hex);
  const y = 0.2126 * srgbChannelToLinear(r) + 0.7152 * srgbChannelToLinear(g) + 0.0722 * srgbChannelToLinear(b);
  const EPS = 216 / 24389, KAPPA = 24389 / 27;
  return y > EPS ? 116 * Math.cbrt(y) - 16 : KAPPA * y;
}

/**
 * A sequential colorscale's whole point is "higher value reads lighter/darker
 * than lower value" — a colour a reader can't rank against its neighbour by
 * lightness alone defeats that (P2-7). Named presets are hand-picked to
 * already hold this property (each is itself gated by
 * `colorscale.test.ts`'s own monotonicity suite); only a CUSTOM anchor array
 * is checked here, once, at resolve time.
 */
function assertMonotoneLightness(anchors: readonly string[]): void {
  const l = anchors.map(hexLStar);
  let asc = true, desc = true;
  for (let i = 1; i < l.length; i++) {
    if (l[i]! < l[i - 1]!) asc = false;
    if (l[i]! > l[i - 1]!) desc = false;
  }
  if (!asc && !desc) {
    chart3dError("colorscale-not-monotone", `A custom colorscale's anchors must be monotonic in CIELAB L* (perceptual lightness); got L* = ${l.map((v) => v.toFixed(1)).join(", ")}.`);
  }
}

/** Resolves a `colorscale` option to its ordered anchor array, validating a custom array's own shape and its monotone-lightness invariant. */
export function resolveGlyphChart3dColorscaleAnchors(colorscale: GlyphChart3dColorscale | undefined): readonly string[] {
  if (colorscale === undefined) return COLORSCALE_ANCHORS.viridis;
  if (typeof colorscale === "string") {
    if (!GLYPH_CHART_3D_COLORSCALE_NAMES.includes(colorscale as GlyphChart3dColorscaleName)) {
      chart3dError("bad-options", `colorscale must be one of ${GLYPH_CHART_3D_COLORSCALE_NAMES.join(", ")}, or an array of #rrggbb anchors, got ${JSON.stringify(colorscale)}.`);
    }
    return COLORSCALE_ANCHORS[colorscale as GlyphChart3dColorscaleName];
  }
  if (!Array.isArray(colorscale) || colorscale.length < 2 || colorscale.some((c) => !isCanonicalHexColor(c))) {
    chart3dError("bad-options", `A custom colorscale must be an array of 2+ canonical #rrggbb anchors, got ${JSON.stringify(colorscale)}.`);
  }
  assertMonotoneLightness(colorscale);
  return colorscale;
}
function rgbToHex(r: number, g: number, b: number): string {
  const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
  return `#${[clamp(r), clamp(g), clamp(b)].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

/** Linearly interpolates an ordered anchor array at `t` in `[0, 1]`. */
export function interpolateGlyphChart3dAnchors(anchors: readonly string[], t: number): string {
  const clamped = Math.max(0, Math.min(1, t));
  const n = anchors.length;
  if (n === 1) return anchors[0]!;
  const scaled = clamped * (n - 1);
  const i0 = Math.min(n - 2, Math.floor(scaled));
  const i1 = i0 + 1;
  const localT = scaled - i0;
  const [ar, ag, ab] = hexToRgb(anchors[i0]!);
  const [br, bg, bb] = hexToRgb(anchors[i1]!);
  return rgbToHex(ar + (br - ar) * localT, ag + (bg - ag) * localT, ab + (bb - ab) * localT);
}

/**
 * Quantizes a normalized value `t` in `[0, 1]` into one of `bands` levels
 * (>= 1), the same "quantize so span-runs and the atlas palette survive"
 * discipline `cell`'s own shade ramp follows (AGENTS.md's "Charts"
 * "Series and shading" — `cell`'s continuous ramp is itself quantized to a
 * fixed level count for the same reason). Returns the band INDEX, `0` ..
 * `bands - 1`.
 */
export function glyphChart3dBandIndex(t: number, bands: number): number {
  if (bands <= 1) return 0;
  const clamped = Math.max(0, Math.min(1, t));
  return Math.min(bands - 1, Math.floor(clamped * bands));
}

/** The band's own representative colour — anchors sampled at the band's midpoint fraction, so band 0 never lands exactly on anchor[0] alone unless `bands === 1`. */
export function glyphChart3dBandColor(anchors: readonly string[], bandIndex: number, bands: number): string {
  const t = bands <= 1 ? 0.5 : (bandIndex + 0.5) / bands;
  return interpolateGlyphChart3dAnchors(anchors, t);
}
