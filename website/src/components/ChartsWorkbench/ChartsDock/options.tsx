import { GLYPH_CHART_3D_COLORSCALE_NAMES, glyphChart3dCharsetDegrades } from "@glyphcss/charts/3d";
import type { Charts3dGuideOptions } from "../../../features/charts/model/chartsWorkbench3d";
import {
  CHART_CHARSETS,
  CHART_COLORS,
  CHART_DETAILS,
  CHART_LEGEND_PLACEMENTS,
  CHART_REGION_FILLS,
  CHART_TARGETS,
  CHART_TITLE_ALIGNS,
  CHART_TITLE_POSITIONS,
  CHART_X_AXIS_TITLE_ATS,
} from "../../../features/charts/model/chartsWorkbenchState";
import { type ChartsWorkbenchRegionFillStatus } from "../../../features/charts/render/chartsWorkbenchRender";
import { type Instrument3DEffectTarget } from "../../Instrument3DEffectsFolder";
import { CHARTS_3D_EFFECT_SURFACE_TARGET } from "../Charts3dViewport";

export const options = <T extends string>(values: readonly T[]): Record<T, T> =>
  Object.fromEntries(values.map((value) => [value, value])) as Record<T, T>;

// Owner packet item 3 — "target, charset, color and detail should be
// buttons with symbols not dropdowns", plus legend placement and title
// align/position in the Chart folder. Each toggle's SYMBOL is either the
// short label a `<select>` would have shown, or (charset) the literal
// glyph that charset paints — same `icon: <span className="gx-toggle-text">`
// idiom `VOICE_MODE_TOGGLE`/`LAYER_TOGGLE` already use in synthKit.tsx,
// reused rather than approximated (see LoadersDock.tsx's own cross-import).
export const TARGET_TOGGLE = CHART_TARGETS.map((v) => ({
  value: v as string,
  icon: <span className="gx-toggle-text">{v === "terminal" ? "term" : v}</span>,
  label: v,
  desc: `Render for ${v}`,
}));

const CHARSET_SYMBOL: Record<string, string> = { ascii: "#", box: "┼", blocks: "▓", braille: "⠿" };

// C3 fix round 2 (user feedback: the old `charts-3d-downgrade-note` banner
// inside the viewport's own render area violated AGENTS.md's "TargetPreview"
// rule — "a chrome note lives in the frame's OWN chrome... never the
// viewport's render area" — and read as developer-speak). The reason now
// lives where the CHOICE is made: the Charset row itself, the same
// `mapDirectionLocked`/`chartsMarkTypeFit.ts` idiom every other unfit
// control on this page already uses (`chartsRegionFillToggle`, right above,
// is the closest sibling — same `disabled`/`disabledReason` shape). Derived
// from the library's OWN `glyphChart3dCharsetDegrades` predicate, never a
// hardcoded `charset === "braille"` list — the C2 fix round in flight is
// expected to make braille a real (wireframe) 3D surface, at which point
// this dims only what the predicate still says can't render, with no page
// change needed.
const CHARTS_3D_CHARSET_UNAVAILABLE_REASON = "Not available for 3D surfaces yet";

export function chartsCharsetToggle(is3d: boolean) {
  return CHART_CHARSETS.map((v) => {
    const disabled = is3d && glyphChart3dCharsetDegrades(v);
    return {
      value: v as string,
      icon: <span className="gx-toggle-text">{CHARSET_SYMBOL[v]}</span>,
      label: v,
      desc: `Charset: ${v}`,
      ...(disabled ? { disabled: true, disabledReason: CHARTS_3D_CHARSET_UNAVAILABLE_REASON } : {}),
    };
  });
}

const COLOR_SYMBOL: Record<string, string> = {
  none: "off",
  ansi16: "16",
  ansi256: "256",
  truecolor: "rgb",
  css: "css",
};

export const COLOR_TOGGLE = CHART_COLORS.map((v) => ({
  value: v as string,
  icon: <span className="gx-toggle-text">{COLOR_SYMBOL[v]}</span>,
  label: v,
  desc: `Color mode: ${v}`,
}));

const DETAIL_SYMBOL: Record<string, string> = { auto: "auto", faithful: "full", balanced: "bal", simplified: "min" };

export const DETAIL_TOGGLE = CHART_DETAILS.map((v) => ({
  value: v as string,
  icon: <span className="gx-toggle-text">{DETAIL_SYMBOL[v]}</span>,
  label: v,
  desc: `Detail: ${v}`,
}));

const LEGEND_SYMBOL: Record<string, string> = {
  bottom: "btm",
  "top-left": "↖",
  "top-right": "↗",
  "bottom-left": "↙",
  "bottom-right": "↘",
  title: "ttl",
};

export const LEGEND_TOGGLE = CHART_LEGEND_PLACEMENTS.map((v) => ({
  value: v as string,
  icon: <span className="gx-toggle-text">{LEGEND_SYMBOL[v]}</span>,
  label: v,
  desc: `Legend placement: ${v}`,
}));

const TITLE_ALIGN_SYMBOL: Record<string, string> = { left: "⇤", center: "⇔", right: "⇥" };

export const TITLE_ALIGN_TOGGLE = CHART_TITLE_ALIGNS.map((v) => ({
  value: v as string,
  icon: <span className="gx-toggle-text">{TITLE_ALIGN_SYMBOL[v]}</span>,
  label: v,
  desc: `Title align: ${v}`,
}));

export const TITLE_POSITION_TOGGLE = CHART_TITLE_POSITIONS.map((v) => ({
  value: v as string,
  icon: <span className="gx-toggle-text">{v === "top" ? "⇧" : "⇩"}</span>,
  label: v,
  desc: `Title position: ${v}`,
}));

export const AXIS_COLOR_MODE_LABEL: Record<string, string> = { shared: "shared", "per-axis": "per axis" };

// Textures row (CHARTS-RESEARCH `DIAGNOSIS-solid-colour-fills.md` §4): three
// states mapping 1:1 onto the library's `regionFill`, because `auto` depends
// on more than colour (target, colour collisions, flow marks) and a two-state
// "follows colour" switch could not say which one decided. `on` = textures
// forced, `off` = solid forced.
const REGION_FILL_LABEL: Record<string, string> = { auto: "auto", texture: "on", solid: "off" };

export function chartsRegionFillToggle(status: ChartsWorkbenchRegionFillStatus | null) {
  const autoSays = status
    ? `${status.auto.fill === "solid" ? "solid" : "textures"} now — ${status.auto.message}`
    : "follows colour";
  return CHART_REGION_FILLS.map((v) => {
    const disabledReason = status?.inapplicable ?? (v === "solid" ? status?.solidUnavailable : undefined);
    return {
      value: v as string,
      icon: <span className="gx-toggle-text">{REGION_FILL_LABEL[v]}</span>,
      label: REGION_FILL_LABEL[v]!,
      desc:
        v === "auto"
          ? `Textures: auto, ${autoSays}`
          : v === "texture"
            ? "Textures on: every series keeps its own fill pattern"
            : "Textures off: solid colour fills",
      ...(disabledReason ? { disabled: true, disabledReason } : {}),
    };
  });
}

// Axis title placement (Dock item "Axis Title + Title at") — same icon-
// toggle idiom as the chart's own Title-at row above; `x`'s vocabulary
// (start/center/end) mirrors `TITLE_ALIGN_TOGGLE`'s symbols, `y`'s
// (top/bottom) mirrors `TITLE_POSITION_TOGGLE`'s.
const AXIS_X_TITLE_AT_SYMBOL: Record<string, string> = { start: "⇤", center: "⇔", end: "⇥" };

export const AXIS_X_TITLE_AT_TOGGLE = CHART_X_AXIS_TITLE_ATS.map((v) => ({
  value: v as string,
  icon: <span className="gx-toggle-text">{AXIS_X_TITLE_AT_SYMBOL[v]}</span>,
  label: v,
  desc: `X title placement: ${v}`,
}));

export const AXIS_Y_TITLE_AT_TOGGLE = CHART_TITLE_POSITIONS.map((v) => ({
  value: v as string,
  icon: <span className="gx-toggle-text">{v === "top" ? "⇧" : "⇩"}</span>,
  label: v,
  desc: `Y title placement: ${v}`,
}));

// A 3D axis's own title placement (AGENTS.md's "Axis title position") shares
// ONE start/center/end vocabulary across every axis (x, y AND z) — unlike
// 2D's x/y split, a 3D title always pushes outward from the same fixed
// origin corner regardless of which axis it belongs to — so this reuses the
// 2D X row's own symbol table rather than a duplicate one.
export const CHARTS_3D_AXIS_TITLE_AT_TOGGLE = (["start", "center", "end"] as const).map((v) => ({
  value: v as string,
  icon: <span className="gx-toggle-text">{AXIS_X_TITLE_AT_SYMBOL[v]}</span>,
  label: v,
  desc: `Title placement: ${v}`,
}));

/** The library's own `object.ts` default for `"end"` (`AXIS_TITLE_TIP_OFFSET`,
 *  the page's own default `titleAt`) — the titleOffset slider's own seed
 *  when the reader has set no override. `"start"`/`"center"` keep their own
 *  larger `0.6` (`AXIS_TITLE_LEGACY_MARGIN`) in the library; the slider seed
 *  is not re-derived per `titleAt` selection here, a known simplification. */
export const AXIS_TITLE_OFFSET_DEFAULT = 0.15;

// View folder (packet C3, 3D only) — turntable/trackball, reset camera,
// colorscale and shading. `aspect` (mentioned as optional in the packet
// scope, "if the library exposes it") is skipped: `glyphChartSurface`'s
// `aspect` is a per-BUILD option baked into the mesh's own object-space
// coordinates, not a live per-frame knob the way `shading`/`colorscale`
// are, and this showcase has no natural "aspect" control elsewhere to
// mirror (a later increment can add it if a real need shows up).
export const CHARTS_3D_ORBIT_MODE_TOGGLE = [
  {
    value: "turntable",
    icon: <span className="gx-toggle-text">⟲</span>,
    label: "Turntable",
    desc: "Two-axis orbit, up-vector locked — the default.",
  },
  {
    value: "trackball",
    icon: <span className="gx-toggle-text">◎</span>,
    label: "Trackball",
    desc: "Free rotation about any screen axis, roll included.",
  },
];

export const CHARTS_3D_SHADING_TOGGLE = [
  {
    value: "auto",
    icon: <span className="gx-toggle-text">auto</span>,
    label: "Auto",
    desc: "Follows the library's own default (colour-mode-aware).",
  },
  {
    value: "relief",
    icon: <span className="gx-toggle-text">relief</span>,
    label: "Relief",
    desc: "Glyph shape reads slope; colour reads the z band.",
  },
  {
    value: "value",
    icon: <span className="gx-toggle-text">value</span>,
    label: "Value",
    desc: "Glyph density reads the z band directly — legible with colour off.",
  },
];

// Packet C4 (codex review addition) — mirrors `renderGlyphChart3d`'s own
// `style` option exactly (`resolveCharts3dStyle`'s own doc): "auto"
// resolves braille to a real wireframe and every other charset to solid;
// an explicit choice always wins, on both the live viewport and Copy.
export const CHARTS_3D_STYLE_TOGGLE = [
  {
    value: "auto",
    icon: <span className="gx-toggle-text">auto</span>,
    label: "Auto",
    desc: "Follows charset — braille renders as a real wireframe, everything else solid.",
  },
  {
    value: "solid",
    icon: <span className="gx-toggle-text">solid</span>,
    label: "Solid",
    desc: "Lambert/value-shaded fill.",
  },
  {
    value: "wireframe",
    icon: <span className="gx-toggle-text">wire</span>,
    label: "Wireframe",
    desc: "The surface's own decimated quad grid as depth-tested lines.",
  },
  {
    value: "ink",
    icon: <span className="gx-toggle-text">ink</span>,
    label: "Ink",
    desc: "Silhouette + crease outline only.",
  },
];

export const CHARTS_3D_COLORSCALE_TOGGLE = GLYPH_CHART_3D_COLORSCALE_NAMES.map((v) => ({
  value: v as string,
  icon: <span className="gx-toggle-text">{v.slice(0, 4)}</span>,
  label: v,
  desc: `Colorscale: ${v}`,
}));

// Guide toggles (packet C4, item 1) — one row per `GlyphChart3dGuideOptions`
// field, read off `packages/charts/src/3d/types.ts` directly: `axisLines`/
// `ticks`/`tickLabels`/`titles`/`grid` default `true`, `floorGrid`/`walls`/
// `box` default `false` (`GlyphChart3dGuideOptions`'s own doc comment).
// `state.chart3d.guides` stores only OVERRIDES (an empty object means every
// field follows the library's own default), so a row's shown value is
// `state.chart3d.guides[key] ?? CHARTS_3D_GUIDE_DEFAULTS[key]` — never a
// value re-derived from the resolved mark, which would need threading a new
// prop through just to read 8 fields this page already knows statically.
export const CHARTS_3D_GUIDE_DEFAULTS: Record<keyof Charts3dGuideOptions, boolean> = {
  axisLines: true,
  ticks: true,
  tickLabels: true,
  titles: true,
  grid: true,
  floorGrid: false,
  walls: false,
  box: false,
};

// Effects folder (packet C4, item 3) — the shared `Instrument3DEffectsFolder`,
// reused verbatim (never a second one). The curated effect id set mirrors
// `/diagrams`' own `DIAGRAMS_3D_EFFECT_IDS` (`DiagramsDock.tsx`) — the same
// small set that reads well mesh-targeted, resolved against
// `@glyphcss/effects`' own catalog by `Charts3dViewport.tsx`'s `applyEffect`.
// Targets: guides render as an OVERLAY on the object (`object.ts`'s
// `glyphChartObject`, confirmed by direct read — ONE data mesh (`"surface"`/
// `"points"`/`"bars"`/`"line"` depending on mark type, packet C6) plus
// `overlays: [axisTriadOverlay(...)]`, no second mesh), so the only
// non-"whole chart" target is that one data mesh — no guides target is
// offered. Labelled "Chart" (not "Surface") since packet C6 widened this
// to every 3D mark type, not only `surface`.
export const CHARTS_3D_EFFECT_IDS = ["none", "scan", "glitch", "ripple"] as const;

export const CHARTS_3D_EFFECT_TARGETS: readonly Instrument3DEffectTarget[] = [
  { id: CHARTS_3D_EFFECT_SURFACE_TARGET, label: "Chart" },
];
