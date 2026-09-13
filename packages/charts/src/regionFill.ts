/**
 * The ONE decision on how a region mark (bar/rect/area/arc) carries series
 * identity in its fill: a TEXTURE glyph per series (`seriesShade`), or a
 * SOLID block in each series' own colour. AGENTS.md's "Charts" "Series and
 * shading"; rationale and measurements in `docs/design/charts.md`'s "Solid
 * coloured fills".
 *
 * Whole-chart, never per mark: a legend lists every mark's swatches side by
 * side, so a per-mark answer could show one solid swatch beside a textured
 * one, and a caller (the `/charts` Dock) could no longer state ONE reason.
 *
 * Solid only when colour genuinely carries identity in THIS render: colour
 * on, no flow mark (`flowMarks.ts` still paints its own textures), and no two
 * distinct region series resolving to the same colour at the render's own
 * depth — `ansi16` quantises the default palette's blue and green to the
 * same teal, so a third series already collides there. `auto` additionally
 * keeps textures for `terminal`/`chat`, where a copy/paste or a monochrome
 * theme drops the colour the solid fill relies on; an explicit `"solid"`
 * overrides that guess but never the three honesty rules above (it is
 * refused with a ledger entry instead, since a solid fill in those cases
 * makes two series literally identical).
 */

import { nearestAnsiCanvasColor } from "glyphcss";
import type { GlyphChartResolvedMark } from "./resolve";
import { chartSeries, resolveSeriesColor } from "./series";
import type { GlyphChartColorMode, GlyphChartRegionFill, GlyphChartRegionFillResolution, GlyphChartTarget } from "./types";

/** Mark types whose fill glyph `regionFillGlyph` picks. `cell` shades by VALUE, and `sankey`/`funnel` paint in `flowMarks.ts`. */
const SOLID_CAPABLE_MARK_TYPES = new Set(["bar", "rect", "area", "arc"]);
const FLOW_MARK_TYPES = new Set(["sankey", "funnel"]);

/** Whether a render paints colour at all — shared by `renderGlyphChart` and `glyphChartRegionFill` so the two can never disagree. */
export function glyphChartColorEnabled(color: GlyphChartColorMode, env: Readonly<Record<string, string | undefined>> | undefined): boolean {
  const ansi = color !== "none" && color !== "css";
  const noColor = Boolean(env?.NO_COLOR) && !env?.FORCE_COLOR;
  return color !== "none" && !(ansi && noColor);
}

export interface GlyphChartRegionFillContext {
  readonly requested: GlyphChartRegionFill;
  readonly color: GlyphChartColorMode;
  readonly colorEnabled: boolean;
  readonly target: GlyphChartTarget;
}

function displayColor(hex: string, color: GlyphChartColorMode): string {
  if (color === "ansi16") return nearestAnsiCanvasColor(hex, "16");
  if (color === "ansi256") return nearestAnsiCanvasColor(hex, "256");
  return hex;
}

export function resolveGlyphChartRegionFill(marks: readonly GlyphChartResolvedMark[], ctx: GlyphChartRegionFillContext): GlyphChartRegionFillResolution {
  const { requested } = ctx;
  const texture = (reason: GlyphChartRegionFillResolution["reason"], message: string, colliding?: readonly [string, string]): GlyphChartRegionFillResolution =>
    ({ requested, fill: "texture", reason, message, ...(colliding ? { colliding } : {}) });
  const series = chartSeries(marks);
  const region = series.filter((s) => SOLID_CAPABLE_MARK_TYPES.has(s.mark.type));
  if (region.length === 0) return texture("no-region-mark", "No bar, rect, area or pie mark has a fill to texture.");
  if (requested === "texture") return texture("requested-texture", "Textures were requested.");
  if (!ctx.colorEnabled) return texture("color-off", "Colour is off, so textures tell the series apart.");
  if (marks.some((m) => FLOW_MARK_TYPES.has(m.mark.type))) return texture("flow-mark", "Sankey and funnel marks still paint textures, so the whole chart keeps them.");
  const identityByColor = new Map<string, string>();
  const seen = new Set<string>();
  for (let i = 0; i < region.length; i++) {
    const s = region[i]!;
    const identity = s.name ?? `unnamed ${s.mark.type} ${i + 1}`;
    if (s.name !== undefined && seen.has(identity)) continue;
    seen.add(identity);
    const shown = displayColor(resolveSeriesColor(s, true)!, ctx.color);
    const owner = identityByColor.get(shown);
    if (owner !== undefined) {
      return texture("colors-collide", `Series "${owner}" and "${identity}" paint the same colour${ctx.color === "ansi16" || ctx.color === "ansi256" ? ` in ${ctx.color}` : ""}, so textures tell them apart.`, [owner, identity]);
    }
    identityByColor.set(shown, identity);
  }
  if (requested === "auto" && (ctx.target === "terminal" || ctx.target === "chat")) {
    return texture(ctx.target === "terminal" ? "target-terminal" : "target-chat", `A ${ctx.target} copy can lose its colour, so textures stay on.`);
  }
  return { requested, fill: "solid", reason: "colors-distinct", message: "Every series has its own colour, so fills are solid." };
}
