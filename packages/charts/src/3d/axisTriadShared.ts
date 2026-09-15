/**
 * Resolve-step machinery every 3D mark type shares (`surface.ts` originally
 * owned these; C5 pulled them out so `scatter.ts`/`parametric.ts`/`bars.ts`/
 * `line3d.ts` read the identical `axes.corner`/`guides`/`aspect`/`bands`/
 * axis-tick pipeline rather than five drifting copies) — every 3D mark's
 * own axis triad (AGENTS.md's "Charts 3D") is `GlyphChart3dAxisTriadSpec`
 * regardless of what geometry it plots.
 */
import { scaleLinear } from "d3-scale";
import { format as d3format } from "d3-format";
import { chart3dError } from "./validate";
import type {
  GlyphChart3dAxisOptions,
  GlyphChart3dCornerOption,
  GlyphChart3dGuideOptions,
  GlyphChart3dResolvedAxis,
  GlyphChart3dResolvedGuides,
} from "./types";

/** `axes.corner` — `"auto"` (default) or an explicit `[0|1,0|1,0|1]` triple/named corner shorthand. */
const CORNER_NAMES: Record<string, readonly [0 | 1, 0 | 1, 0 | 1]> = {
  "x0-y0-z0": [0, 0, 0], "x1-y0-z0": [1, 0, 0], "x1-y1-z0": [1, 1, 0], "x0-y1-z0": [0, 1, 0],
  "x0-y0-z1": [0, 0, 1], "x1-y0-z1": [1, 0, 1], "x1-y1-z1": [1, 1, 1], "x0-y1-z1": [0, 1, 1],
};

export function resolveCorner(option: GlyphChart3dCornerOption | keyof typeof CORNER_NAMES | undefined): GlyphChart3dCornerOption {
  if (option === undefined || option === "auto") return "auto";
  if (typeof option === "string") {
    const named = CORNER_NAMES[option];
    if (named === undefined) chart3dError("bad-options", `axes.corner must be "auto", a [0|1,0|1,0|1] triple, or one of ${Object.keys(CORNER_NAMES).join(", ")}, got ${JSON.stringify(option)}.`);
    return named!;
  }
  if (
    Array.isArray(option) && option.length === 3
    && option.every((b) => b === 0 || b === 1)
  ) {
    return option as GlyphChart3dCornerOption;
  }
  chart3dError("bad-options", `axes.corner must be "auto" or a [0|1,0|1,0|1] triple, got ${JSON.stringify(option)}.`);
}

export function resolveGuides(options: GlyphChart3dGuideOptions | undefined): GlyphChart3dResolvedGuides {
  const g = options ?? {};
  for (const [key, value] of Object.entries(g)) {
    if (value !== undefined && typeof value !== "boolean") {
      chart3dError("bad-options", `guides.${key} must be a boolean, got ${JSON.stringify(value)}.`);
    }
  }
  return {
    axisLines: g.axisLines ?? true,
    ticks: g.ticks ?? true,
    tickLabels: g.tickLabels ?? true,
    titles: g.titles ?? true,
    // Fix round 5, Item 2 ("the wall grid is still a cage"): both default
    // FALSE (opt-in) — a low-density crosshatch across a full guide plane
    // reads as a cage/diamond shape ahead of the data at this library's own
    // oblique default camera, a visual-WEIGHT defect no ink-share metric
    // alone measures (`docs/design/charts3d.md`'s "C2 fix round 5").
    grid: g.grid ?? false,
    floorGrid: g.floorGrid ?? false,
    walls: g.walls ?? false,
    box: g.box ?? false,
  };
}

/** Default `aspect` shared by every mark type — widened x/y (fix round 2's own P1-a) against a compressed z, so the default auto-fit reads as a genuine 3D block rather than a nearly-flat plate. */
export const GLYPH_CHART_3D_DEFAULT_ASPECT: readonly [number, number, number] = [1.3, 1.3, 0.6];

export function resolveAspect(aspect: readonly number[] | undefined): readonly [number, number, number] {
  if (aspect === undefined) return GLYPH_CHART_3D_DEFAULT_ASPECT;
  if (!Array.isArray(aspect) || aspect.length !== 3 || aspect.some((v) => typeof v !== "number" || !Number.isFinite(v) || v <= 0)) {
    chart3dError("bad-options", `aspect must be 3 positive finite numbers [x, y, z], got ${JSON.stringify(aspect)}.`);
  }
  return [aspect[0]!, aspect[1]!, aspect[2]!];
}

export function resolveBands(bands: number | undefined): number {
  if (bands === undefined) return 9;
  if (!Number.isInteger(bands) || bands < 1) chart3dError("bad-options", `bands must be a positive integer, got ${JSON.stringify(bands)}.`);
  return bands;
}

const PLAIN_FORMAT = d3format("~r");

/**
 * C2 fix round 8, P1-C (coordinator review: negative tick/colorbar labels
 * rendered as `?10`/`?20`). `d3-format` emits U+2212 MINUS SIGN for a
 * negative value, never ASCII hyphen-minus (`-`) — and neither the
 * ascii/box/braille chrome tiers' glyph set (`glyphInk.ts`/the font atlas)
 * carries U+2212, so `canvas.text` folded it to `?` (its own generic
 * unsupported-glyph fallback), silently turning every negative tick into a
 * DIFFERENT, wrong-looking number. 3D labels are ASCII throughout, matching
 * the 2D chart's own "ASCII is 7-bit throughout" rule (AGENTS.md's
 * "Labels") — never a font-gap workaround, a genuine formatting bug this
 * package alone can fix cheaply since it owns the format call.
 */
function asciiMinus(formatted: string): string {
  return formatted.replace(/−/g, "-");
}

/** One nice-domain/tick/format pipeline for every axis of every 3D mark type. */
export function resolveAxis(values: readonly number[], defaultTitle: string, options: GlyphChart3dAxisOptions | undefined): GlyphChart3dResolvedAxis {
  const min = Math.min(...values);
  const max = Math.max(...values);
  const domain: [number, number] = min === max ? [min - 1, max + 1] : [min, max];
  const scale = scaleLinear().domain(domain).nice();
  const requested = options?.ticks;
  if (requested !== undefined && (!Number.isInteger(requested) || requested < 1)) {
    chart3dError("bad-options", `axes ticks must be a positive integer, got ${JSON.stringify(requested)}.`);
  }
  const ticks = scale.ticks(requested ?? 5);
  const title = options?.title !== undefined ? options.title : defaultTitle;
  return {
    title,
    domain: scale.domain() as [number, number],
    ticks,
    tickLabels: ticks.map((t) => asciiMinus(PLAIN_FORMAT(t))),
  };
}
