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
import { resolveGlyphChartTickFormat } from "../tickFormat";
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
    // alone measures).
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
 * package alone can fix cheaply since it owns the format call. Applied to
 * EVERY tick label, `axes.*.format`'s own custom preset/callback output
 * included (C7) — a preset built on `d3-format` (`number`, `currency`, ...)
 * emits the SAME Unicode minus sign, and a raw callback's output is opaque
 * text this package cannot otherwise sanitize, so the fold is unconditional
 * rather than gated on which path produced the string.
 */
function asciiMinus(formatted: string): string {
  return formatted.replace(/−/g, "-");
}

// Mirrors `validate.ts`'s own `CANONICAL_HEX_COLOR` / `colorscale.ts`'s own
// copy exactly — canonical lowercase `#rrggbb`, the same "many independent
// copies of one regex" convention every other canonical-hex check in this
// codebase already follows (schema.ts, validate.ts, colorscale.ts, the cell
// canvas) rather than a cross-module import for one six-line check.
const CANONICAL_HEX_COLOR = /^#[0-9a-f]{6}$/;
function isCanonicalHexColor(v: unknown): v is string {
  return typeof v === "string" && CANONICAL_HEX_COLOR.test(v);
}
function resolveAxisColorOption(color: string | undefined, context: string): string | undefined {
  if (color === undefined) return undefined;
  if (!isCanonicalHexColor(color)) {
    chart3dError("bad-axis-color", `${context} must be a canonical lowercase #rrggbb string, got ${JSON.stringify(color)}.`);
  }
  return color;
}

/** C7: the mark-wide shared `axes.color` (2D's `axes.color` pattern) — validated once per mark constructor, read by every axis that carries no `color` of its own (`object.ts`'s `axisRenderColor`). */
export function resolveAxesColor(color: string | undefined): string | undefined {
  return resolveAxisColorOption(color, "axes.color");
}

function resolveOptionalBoolean(value: boolean | undefined, field: string): boolean | undefined {
  if (value !== undefined && typeof value !== "boolean") chart3dError("bad-options", `axes.${field} must be a boolean, got ${JSON.stringify(value)}.`);
  return value;
}

/** C7 (P1-3): `axes.{x,y,z}.titleAt` — mirrors 2D's `axes.x.titleAt` vocabulary/naming (AGENTS.md's "Charts" "Axes"), one shared set for every 3D axis. */
const TITLE_AT_VALUES = ["start", "center", "end"] as const;
function resolveTitleAt(value: "start" | "center" | "end" | undefined): "start" | "center" | "end" | undefined {
  if (value === undefined) return undefined;
  if (!(TITLE_AT_VALUES as readonly string[]).includes(value)) {
    chart3dError("bad-axis-title-at", `axes titleAt must be one of ${TITLE_AT_VALUES.join(", ")}, got ${JSON.stringify(value)}.`);
  }
  return value;
}

function resolveTitleOffset(value: number | undefined): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    chart3dError("bad-options", `axes titleOffset must be a finite number, got ${JSON.stringify(value)}.`);
  }
  return value;
}

/**
 * C7's own `axes.{x,y,z}.domain` — an explicit `[min, max]` override for the
 * data-derived NICE domain. Used VERBATIM, never `.nice()`d (mirroring
 * `scales.ts`'s own `buildContinuous`, whose explicit `opts.domain` skips
 * `nice()` unless the caller separately asks for it — an explicit bound is
 * the caller's OWN exact number, not a hint to round outward from).
 */
function resolveExplicitDomain(domain: readonly [number, number] | undefined): readonly [number, number] | undefined {
  if (domain === undefined) return undefined;
  if (
    !Array.isArray(domain) || domain.length !== 2
    || domain.some((v) => typeof v !== "number" || !Number.isFinite(v))
    || domain[0]! >= domain[1]!
  ) {
    chart3dError("bad-axis-domain", `axes domain must be [min, max] with two finite numbers and min < max, got ${JSON.stringify(domain)}.`);
  }
  return domain;
}

/**
 * One nice-domain/tick/format pipeline for every axis of every 3D mark type.
 *
 * `pad` (DATA units, default `0`) widens the FINAL domain by that much at
 * each end, AFTER the ticks are derived — so a mark whose glyph has real
 * extent around its own data position (a `bars3d` bar's footprint, half
 * `barHalfWidth` either side of its `x`/`y`) gets a box that CONTAINS it
 * without moving a single tick. User report, verbatim: "the 2024 olympics
 * chart is showing blocks on top of the axes" — the outermost bar sat
 * exactly on the domain edge, so half its footprint mapped past `ext` and
 * painted over the triad's own axis lines. Padding the values BEFORE
 * `.nice()` instead was rejected: on an index-like axis it pushes the nice
 * domain out a whole tick step (`[0, 9]` -> `[-2, 10]`) and invents ticks
 * at positions no bar stands on. Applied to an EXPLICIT domain too — half a
 * bar width neither uncrops a deliberately narrow frame nor lets a bar
 * paint outside it, and a reader sliding a domain must not reintroduce the
 * defect.
 */
export function resolveAxis(values: readonly number[], defaultTitle: string, options: GlyphChart3dAxisOptions | undefined, pad = 0): GlyphChart3dResolvedAxis {
  const explicitDomain = resolveExplicitDomain(options?.domain);
  let domain: [number, number];
  let scale;
  if (explicitDomain !== undefined) {
    domain = [explicitDomain[0], explicitDomain[1]];
    scale = scaleLinear().domain(domain);
  } else {
    const min = Math.min(...values);
    const max = Math.max(...values);
    domain = min === max ? [min - 1, max + 1] : [min, max];
    scale = scaleLinear().domain(domain).nice();
  }
  const requested = options?.ticks;
  if (requested !== undefined && (!Number.isInteger(requested) || requested < 1)) {
    chart3dError("bad-options", `axes ticks must be a positive integer, got ${JSON.stringify(requested)}.`);
  }
  const ticks = scale.ticks(requested ?? 5);
  const title = options?.title !== undefined ? options.title : defaultTitle;
  // `resolveGlyphChartTickFormat` throws its own tagged `bad-tick-format`
  // error (`tickFormat.ts`) — the SAME code this file's `AXIS_OPTION_RULES`
  // reuses, so a 3D caller never sees two different codes for the identical
  // failure a 2D caller would hit through `axes.{x,y}.format`.
  const format = resolveGlyphChartTickFormat(options?.format);
  const resolvedDomain = scale.domain() as [number, number];
  return {
    title,
    domain: pad > 0 ? [resolvedDomain[0] - pad, resolvedDomain[1] + pad] : resolvedDomain,
    ticks,
    tickLabels: ticks.map((t, i) => asciiMinus(format ? format.apply(t, i, ticks) : PLAIN_FORMAT(t))),
    color: resolveAxisColorOption(options?.color, "axes color"),
    lineVisible: resolveOptionalBoolean(options?.line, "line"),
    tickMarksVisible: resolveOptionalBoolean(options?.tickMarks, "tickMarks"),
    tickLabelsVisible: resolveOptionalBoolean(options?.tickLabels, "tickLabels"),
    gridVisible: resolveOptionalBoolean(options?.grid, "grid"),
    titleAt: resolveTitleAt(options?.titleAt),
    titleOffset: resolveTitleOffset(options?.titleOffset),
  };
}
