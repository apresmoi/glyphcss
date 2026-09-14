import { useEffect, useMemo, type Dispatch } from "react";
import { createPortal } from "react-dom";
import type { GUI } from "lil-gui";
import type { GlyphChartCharset, GlyphChartColorMode, GlyphChartDetail, GlyphChartTarget } from "@glyphcss/charts";
import { GLYPH_CHART_3D_COLORSCALE_NAMES } from "@glyphcss/charts/3d";
import { useDockSlot, useFolder, useOption, useSlider, useText, useToggle, type DockOptionController } from "../Dock/primitives";
import { useDockGui } from "../Dock/slots";
import { IconToggle } from "../SynthWorkbench/synthKit";
import type { Charts3dViewportHandle } from "./Charts3dViewport";
import { RangeCategorySelect, RangeSlider, RangeUnavailable, rangeSliderStep } from "../InstrumentWorkbench/RangeSlider";
import { ColorSwatch } from "../InstrumentWorkbench/ColorSwatch";
import { useFolderTitleReset } from "../InstrumentWorkbench/useFolderTitleReset";
import {
  CHART_AXIS_COLOR_MODES, CHART_CHARSETS, CHART_COLORS, CHART_DETAILS, CHART_LEGEND_PLACEMENTS, CHART_REGION_FILLS, CHART_SCALE_TYPES, CHART_TARGETS,
  CHART_TITLE_ALIGNS, CHART_TITLE_POSITIONS, CHART_X_AXIS_TITLE_ATS,
  CHARTS_DENSITY_MIN, CHARTS_DENSITY_MIN_FONT_PX, CHARTS_DENSITY_STEP,
  CHARTS_NO_SCALE_REASON, CHARTS_TIME_UNIT_MS, chartsDensitySliderMax, chartsDomainNumberDisplay, chartsIsoDateStamp, chartsNumberToScaleBound, chartsScaleBoundToNumber,
  chartsScaleSliderBounds, chartsTimeBoundDisplay, chartsTimeBoundFromDisplay, chartsTimeBoundSnap, chartsTimeDisplayPrecision, chartsTimePrecisionOf,
  chartsWorkbenchAxisTimePrecision, chartsWorkbenchScaleTypeFits,
  chartsWorkbenchDensity, chartsWorkbenchDensityLocked, chartsWorkbenchHasCartesianMark, chartsWorkbenchHasZeroAnchoredMark, chartsWorkbenchInferredDomains,
  resolveGlyphChartsWorkbenchControls, type ChartsScaleTypeFitTable, type ChartsTimePrecision, type ChartsWorkbenchAction, type ChartsWorkbenchAxisDomain,
  type ChartsWorkbenchScale, type ChartsWorkbenchState,
  type GlyphChartsWorkbenchControlAction,
} from "./chartsWorkbenchState";
import { chartsWorkbenchActualTicks, chartsWorkbenchRegionFillStatus, type ChartsWorkbenchRegionFillStatus, type ChartsWorkbenchRender } from "./chartsWorkbenchRender";

const options = <T extends string,>(values: readonly T[]): Record<T, T> => Object.fromEntries(values.map((value) => [value, value])) as Record<T, T>;

// Owner packet item 3 — "target, charset, color and detail should be
// buttons with symbols not dropdowns", plus legend placement and title
// align/position in the Chart folder. Each toggle's SYMBOL is either the
// short label a `<select>` would have shown, or (charset) the literal
// glyph that charset paints — same `icon: <span className="gx-toggle-text">`
// idiom `VOICE_MODE_TOGGLE`/`LAYER_TOGGLE` already use in synthKit.tsx,
// reused rather than approximated (see LoadersDock.tsx's own cross-import).
const TARGET_TOGGLE = CHART_TARGETS.map((v) => ({ value: v as string, icon: <span className="gx-toggle-text">{v === "terminal" ? "term" : v}</span>, label: v, desc: `Render for ${v}` }));
const CHARSET_SYMBOL: Record<string, string> = { ascii: "#", box: "┼", blocks: "▓", braille: "⠿" };
const CHARSET_TOGGLE = CHART_CHARSETS.map((v) => ({ value: v as string, icon: <span className="gx-toggle-text">{CHARSET_SYMBOL[v]}</span>, label: v, desc: `Charset: ${v}` }));
const COLOR_SYMBOL: Record<string, string> = { none: "off", ansi16: "16", ansi256: "256", truecolor: "rgb", css: "css" };
const COLOR_TOGGLE = CHART_COLORS.map((v) => ({ value: v as string, icon: <span className="gx-toggle-text">{COLOR_SYMBOL[v]}</span>, label: v, desc: `Color mode: ${v}` }));
const DETAIL_SYMBOL: Record<string, string> = { auto: "auto", faithful: "full", balanced: "bal", simplified: "min" };
const DETAIL_TOGGLE = CHART_DETAILS.map((v) => ({ value: v as string, icon: <span className="gx-toggle-text">{DETAIL_SYMBOL[v]}</span>, label: v, desc: `Detail: ${v}` }));
const LEGEND_SYMBOL: Record<string, string> = { bottom: "btm", "top-left": "↖", "top-right": "↗", "bottom-left": "↙", "bottom-right": "↘", title: "ttl" };
const LEGEND_TOGGLE = CHART_LEGEND_PLACEMENTS.map((v) => ({ value: v as string, icon: <span className="gx-toggle-text">{LEGEND_SYMBOL[v]}</span>, label: v, desc: `Legend placement: ${v}` }));
const TITLE_ALIGN_SYMBOL: Record<string, string> = { left: "⇤", center: "⇔", right: "⇥" };
const TITLE_ALIGN_TOGGLE = CHART_TITLE_ALIGNS.map((v) => ({ value: v as string, icon: <span className="gx-toggle-text">{TITLE_ALIGN_SYMBOL[v]}</span>, label: v, desc: `Title align: ${v}` }));
const TITLE_POSITION_TOGGLE = CHART_TITLE_POSITIONS.map((v) => ({ value: v as string, icon: <span className="gx-toggle-text">{v === "top" ? "⇧" : "⇩"}</span>, label: v, desc: `Title position: ${v}` }));
const AXIS_COLOR_MODE_LABEL: Record<string, string> = { shared: "shared", "per-axis": "per axis" };

// Textures row (CHARTS-RESEARCH `DIAGNOSIS-solid-colour-fills.md` §4): three
// states mapping 1:1 onto the library's `regionFill`, because `auto` depends
// on more than colour (target, colour collisions, flow marks) and a two-state
// "follows colour" switch could not say which one decided. `on` = textures
// forced, `off` = solid forced.
const REGION_FILL_LABEL: Record<string, string> = { auto: "auto", texture: "on", solid: "off" };
export function chartsRegionFillToggle(status: ChartsWorkbenchRegionFillStatus | null) {
  const autoSays = status ? `${status.auto.fill === "solid" ? "solid" : "textures"} now — ${status.auto.message}` : "follows colour";
  return CHART_REGION_FILLS.map((v) => {
    const disabledReason = status?.inapplicable ?? (v === "solid" ? status?.solidUnavailable : undefined);
    return {
      value: v as string, icon: <span className="gx-toggle-text">{REGION_FILL_LABEL[v]}</span>, label: REGION_FILL_LABEL[v]!,
      desc: v === "auto" ? `Textures: auto, ${autoSays}` : v === "texture" ? "Textures on: every series keeps its own fill pattern" : "Textures off: solid colour fills",
      ...(disabledReason ? { disabled: true, disabledReason } : {}),
    };
  });
}

// Axis title placement (Dock item "Axis Title + Title at") — same icon-
// toggle idiom as the chart's own Title-at row above; `x`'s vocabulary
// (start/center/end) mirrors `TITLE_ALIGN_TOGGLE`'s symbols, `y`'s
// (top/bottom) mirrors `TITLE_POSITION_TOGGLE`'s.
const AXIS_X_TITLE_AT_SYMBOL: Record<string, string> = { start: "⇤", center: "⇔", end: "⇥" };
const AXIS_X_TITLE_AT_TOGGLE = CHART_X_AXIS_TITLE_ATS.map((v) => ({ value: v as string, icon: <span className="gx-toggle-text">{AXIS_X_TITLE_AT_SYMBOL[v]}</span>, label: v, desc: `X title placement: ${v}` }));
const AXIS_Y_TITLE_AT_TOGGLE = CHART_TITLE_POSITIONS.map((v) => ({ value: v as string, icon: <span className="gx-toggle-text">{v === "top" ? "⇧" : "⇩"}</span>, label: v, desc: `Y title placement: ${v}` }));

// Ticks row (owner packet item 1) — an "X ticks: auto" boolean plus an
// "X ticks" number slider, built with the SAME `useToggle`/`useSlider`
// primitives the Width/Height rows use (REVIEW-dock-addenda-opus.md P2-1/
// P2-3): real lil-gui controllers, not classes borrowed from a two-thumb
// `RangeSlider`. That gets the identical bar/field/inset for free — same
// `.controller.number`/`.controller.boolean` rules `gallery-workbench.css`
// already gives Width/Height and every other real row — and fixes the
// typed-input clamping for the same reason: lil-gui's own `NumberController`
// only rewrites the input's DISPLAYED text on `updateDisplay()`, gated on
// `!this._inputFocused`, so a value typed mid-focus is never fought by a
// controlled-React rewrite the way the old custom `<input value={shown}>`
// was — "12" commits as 12, not 22. It also gives the auto checkbox the
// theme's real focus ring (`.controller.boolean input:focus-visible`) and
// the disabled slider row the theme's real `.controller.disabled .name`
// dimming, both for free, since there is no longer a bespoke class fighting
// the theme's own `!important` rules for either (P3-4).
const CHART_TICKS_MIN = 2;
const CHART_TICKS_MAX = 40;
function useTicksControl(folder: GUI | null, axis: "x" | "y", ticks: number, actualTicks: number | undefined, dispatch: Dispatch<ChartsWorkbenchAction>): void {
  const AXIS = axis.toUpperCase();
  const auto = ticks === 0;
  // Unchecking auto seeds the slider from the axis's own last-rendered
  // tick count (`chartsWorkbenchActualTicks`'s own doc) — grounded in what
  // the reader can currently see, never a guessed flat number — clamped
  // only as the last-resort floor for the rare grid this can't read a
  // count off at all (REVIEW-dock-addenda-opus.md P2-2).
  const seed = Math.max(CHART_TICKS_MIN, Math.min(CHART_TICKS_MAX, actualTicks ?? CHART_TICKS_MIN));
  useToggle(folder, `${AXIS} ticks: auto`, auto, (checked) => dispatch({ type: "set-axis", axis, patch: { ticks: checked ? 0 : seed } }));
  const shown = auto ? seed : ticks;
  const sliderCtrl = useSlider(folder, `${AXIS} ticks`, { min: CHART_TICKS_MIN, max: CHART_TICKS_MAX, step: 1 }, shown,
    (value) => dispatch({ type: "set-axis", axis, patch: { ticks: value } }));
  useEffect(() => { sliderCtrl?.setEnabled(!auto); }, [sliderCtrl, auto]);
  // Clearing the number field goes back to auto — never `Number("") === 0`
  // (AGENTS.md's own rule for this page's other number fields). lil-gui's
  // own `NumberController` leaves an emptied field's `input` a no-op (it
  // parses with `parseFloat` and bails on `NaN`, never calling `onChange`)
  // and its own `blur` handler just restores the last COMMITTED number —
  // lil-gui has no "emptied means something" concept of its own, so this
  // page's own input-tracking + blur listener supplies it, watching the
  // typed text directly rather than the DOM value at blur time (lil-gui's
  // own blur listener, registered first at construction, has already
  // restored that by the time a second listener on the same element runs).
  useEffect(() => {
    const input = sliderCtrl?.raw.domElement.querySelector("input");
    if (!input) return;
    let emptied = false;
    const onInput = () => { emptied = input.value.trim() === ""; };
    const onBlur = () => { if (emptied) { emptied = false; dispatch({ type: "set-axis", axis, patch: { ticks: 0 } }); } };
    input.addEventListener("input", onInput);
    input.addEventListener("blur", onBlur);
    return () => { input.removeEventListener("input", onInput); input.removeEventListener("blur", onBlur); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sliderCtrl, axis]);
}

/**
 * The Type select's own fit idiom (the mark card's Type toggle, `/maps`'
 * `mapDirectionLocked`): a scale type this axis's data can't carry is a
 * DISABLED option whose label carries the short reason and whose title
 * carries the full one (`chartsWorkbenchScaleTypeFits`). lil-gui builds the
 * `<option>`s itself and reads the choice by `selectedIndex` into its own
 * value list, drawing the closed display from its own name list — so
 * relabelling an option here changes only what the open list shows, never
 * the value lil-gui commits or displays. Options are in `CHART_SCALE_TYPES`
 * order because `useOption` built them from that same list.
 */
function useScaleTypeFit(ctrl: DockOptionController<string> | null, fits: ChartsScaleTypeFitTable): void {
  useEffect(() => {
    const row = ctrl?.raw.domElement;
    const select = row?.querySelector("select");
    if (!row || !select) return;
    const unavailable: string[] = [];
    CHART_SCALE_TYPES.forEach((type, index) => {
      const option = select.options[index];
      if (!option) return;
      const fit = fits[type];
      option.disabled = !fit.fits;
      option.textContent = fit.fits ? type : `${type} — ${fit.short}`;
      option.title = fit.fits ? "" : fit.reason;
      if (!fit.fits) unavailable.push(`${type}: ${fit.reason}`);
    });
    row.title = unavailable.length ? `Not available for this data — ${unavailable.join(" ")}` : "";
  }, [ctrl, fits]);
}

/**
 * One axis's Scales domain control — always ONE lil-gui-shaped row: `.name`
 * "X domain" with its `[reset]`, then `.widget` (CHARTS-RESEARCH
 * `DIAGNOSIS-scale-rows-mark-card.md`). Its widget is:
 *
 * - numeric or time: a `RangeSlider` over the data extent;
 * - band: two compact category selects (`RangeCategorySelect`);
 * - nothing usable: `RangeUnavailable`, the short reason in the widget and
 *   the full one on its title, and no inputs at all. The Type select already
 *   disables a type the data can't carry (`unfit`), so only a legacy `?c=`
 *   link, bad mark data, or a chart with no x/y scale ever lands here.
 *
 * `scale.min`/`.max` stay the same strings `buildScale` reads; this control
 * only translates them to and from the slider's numeric domain.
 *
 * Slider BOUNDS come from `chartsScaleSliderBounds` (P1: never a flat pad
 * that can hand a bar/area/rect y-domain or a log domain an illegal
 * position — REVIEW-dock-colours-sliders-opus.md), widened past their own
 * padded range to include any already-typed override (P2-1: the two number
 * fields may exceed the visible bounds, and the slider re-derives around
 * them on the next render). A time axis additionally snaps its bounds OUT to
 * one calendar unit — the coarser of its data's and its span's
 * (`chartsTimeDisplayPrecision`) — and steps by it, so every thumb position
 * is a whole year (month, day) and the fields read "1980", not "1980-01-01"
 * cut to "198".
 */
export function ScaleDomainControl({ axis, scale, inferred, zeroAnchored, hasCartesianScale, unfit, timePrecision = "day", dispatch }: {
  axis: "x" | "y";
  scale: ChartsWorkbenchScale;
  inferred: ChartsWorkbenchAxisDomain | undefined;
  zeroAnchored: boolean;
  hasCartesianScale: boolean;
  /** This axis's CURRENT type ruled out by `chartsWorkbenchScaleTypeFits`. */
  unfit?: { readonly short: string; readonly reason: string };
  /** The calendar unit every date on this axis sits on (`chartsWorkbenchAxisTimePrecision`). */
  timePrecision?: ChartsTimePrecision;
  dispatch: Dispatch<ChartsWorkbenchAction>;
}) {
  const label = `${axis.toUpperCase()} domain`;
  if (!hasCartesianScale) return <RangeUnavailable label={label} short="no x/y scale" reason={CHARTS_NO_SCALE_REASON} />;
  if (unfit) return <RangeUnavailable label={label} short={unfit.short} reason={unfit.reason} />;
  const resolvedType = scale.type === "auto" ? inferred?.type : scale.type;
  if (!inferred || resolvedType === undefined) {
    return <RangeUnavailable label={label} short="unreadable" reason="This axis's data can't be read as a scale." />;
  }
  if (inferred.domain.length < 2) {
    return <RangeUnavailable label={label} short="one value" reason="A single value has nothing to narrow." />;
  }
  if (resolvedType === "band") {
    // `buildScale`'s band branch throws on any bound that isn't a category
    // in data order, or on a pair that doesn't name at least two of them
    // (DIAGNOSIS-scale-domain.md P3-5). A `<select>` can only commit one of
    // its own options, and `RangeCategorySelect` disables every option that
    // would cross the other end — so neither failure is reachable from here.
    const categories = inferred.domain.map(String);
    const stamps = categories.map(chartsIsoDateStamp);
    const dates = stamps.every((stamp): stamp is number => stamp !== null) ? stamps : null;
    const datePrecision = dates ? chartsTimePrecisionOf(dates) : undefined;
    const display = dates && datePrecision
      ? (category: string) => chartsTimeBoundDisplay(dates[categories.indexOf(category)]!, datePrecision)
      : undefined;
    return <RangeCategorySelect label={label} categories={categories} display={display}
      value={[scale.min.trim() || null, scale.max.trim() || null]}
      onSelect={(end, category) => dispatch({ type: "set-scale", axis, patch: end === "lo" ? { min: category } : { max: category } })}
      onReset={() => dispatch({ type: "set-scale", axis, patch: { min: "", max: "" } })} />;
  }
  const type = resolvedType as "linear" | "log" | "sqrt" | "time";
  const toNumber = (v: number | string | Date) => v instanceof Date ? v.getTime() : Number(v);
  const domainMin = toNumber(inferred.domain[0]!);
  const domainMax = toNumber(inferred.domain.at(-1)!);
  const bounds = chartsScaleSliderBounds(type, domainMin, domainMax, zeroAnchored);
  const explicitLo = scale.min.trim() ? chartsScaleBoundToNumber(type, scale.min) : null;
  const explicitHi = scale.max.trim() ? chartsScaleBoundToNumber(type, scale.max) : null;
  let min = explicitLo !== null ? Math.min(bounds.min, explicitLo) : bounds.min;
  let max = explicitHi !== null ? Math.max(bounds.max, explicitHi) : bounds.max;
  // A time row shows, steps and snaps at ONE unit (`chartsTimeDisplayPrecision`),
  // so a thumb can never sit between two values its fields can show.
  const shown = type === "time" ? chartsTimeDisplayPrecision(timePrecision, domainMax - domainMin) : undefined;
  const unit = shown && shown !== "time" ? CHARTS_TIME_UNIT_MS[shown] : undefined;
  if (shown && unit !== undefined) {
    min = chartsTimeBoundSnap(min, shown, "floor");
    max = chartsTimeBoundSnap(max, shown, "ceil");
  }
  const step = unit ?? rangeSliderStep(min, max);
  const format = (n: number) => shown ? chartsTimeBoundDisplay(n, shown) : chartsDomainNumberDisplay(n, step);
  const describe = type === "time" ? (n: number) => chartsTimeBoundDisplay(n, timePrecision) : undefined;
  const parse = (raw: string) => type === "time" ? chartsTimeBoundFromDisplay(raw) : (Number.isFinite(Number(raw)) ? Number(raw) : null);
  const snap = shown && unit !== undefined ? (n: number) => chartsTimeBoundSnap(n, shown) : undefined;
  const value: readonly [number | null, number | null] | null = scale.min.trim() || scale.max.trim() ? [explicitLo, explicitHi] : null;
  // NEW-1/NEW-4 (REVIEW-dock-colours-sliders-opus-round2.md): a TYPED value
  // that would need `loFloor`/`loCeiling`/`hiFloor` to clamp it is refused
  // outright, with this reason shown inline, rather than silently
  // substituted — the log rule (`bounds.loFloor`, this axis's own sign/
  // zero-exclusion cap) and the zero-anchored rule (`bounds.loCeiling`/
  // `hiFloor`) are the only two ways this control ever caps a thumb, so one
  // reason string per axis covers both (they're mutually exclusive — see
  // `chartsScaleSliderBounds`).
  const capReason = type === "log" ? "A log domain must have one sign and exclude zero."
    : zeroAnchored ? "A bar, area, or rect chart's Y domain must include zero."
    : undefined;
  return <RangeSlider label={label} min={min} max={max} step={step} domain={[domainMin, domainMax]}
    loFloor={bounds.loFloor} loCeiling={bounds.loCeiling} hiFloor={bounds.hiFloor} capReason={capReason}
    value={value} format={format} parse={parse} describe={describe} snap={snap}
    onChange={(next) => dispatch({
      type: "set-scale", axis,
      patch: next === null ? { min: "", max: "" } : {
        min: next[0] === null ? "" : chartsNumberToScaleBound(type, next[0]),
        max: next[1] === null ? "" : chartsNumberToScaleBound(type, next[1]),
      },
    })} />;
}

// View folder (packet C3, 3D only) — turntable/trackball, reset camera,
// colorscale and shading. `aspect` (mentioned as optional in the packet
// scope, "if the library exposes it") is skipped: `glyphChartSurface`'s
// `aspect` is a per-BUILD option baked into the mesh's own object-space
// coordinates, not a live per-frame knob the way `shading`/`colorscale`
// are, and this showcase has no natural "aspect" control elsewhere to
// mirror (a later increment can add it if a real need shows up).
const CHARTS_3D_ORBIT_MODE_TOGGLE = [
  { value: "turntable", icon: <span className="gx-toggle-text">⟲</span>, label: "Turntable", desc: "Two-axis orbit, up-vector locked — the default." },
  { value: "trackball", icon: <span className="gx-toggle-text">◎</span>, label: "Trackball", desc: "Free rotation about any screen axis, roll included." },
];
const CHARTS_3D_SHADING_TOGGLE = [
  { value: "auto", icon: <span className="gx-toggle-text">auto</span>, label: "Auto", desc: "Follows the library's own default (colour-mode-aware)." },
  { value: "relief", icon: <span className="gx-toggle-text">relief</span>, label: "Relief", desc: "Glyph shape reads slope; colour reads the z band." },
  { value: "value", icon: <span className="gx-toggle-text">value</span>, label: "Value", desc: "Glyph density reads the z band directly — legible with colour off." },
];
const CHARTS_3D_COLORSCALE_TOGGLE = GLYPH_CHART_3D_COLORSCALE_NAMES.map((v) => ({ value: v as string, icon: <span className="gx-toggle-text">{v.slice(0, 4)}</span>, label: v, desc: `Colorscale: ${v}` }));

export function ChartsDock({ state, dispatch, rendered, chart3dViewportHandleRef }: {
  state: ChartsWorkbenchState; dispatch: Dispatch<ChartsWorkbenchAction>; rendered?: ChartsWorkbenchRender;
  /** The live 3D viewport's own reset-camera entry point — `undefined`/not
   *  yet mounted is a no-op button, never a crash. */
  chart3dViewportHandleRef?: { current: Charts3dViewportHandle | null };
}) {
  const gui = useDockGui();
  const controls = resolveGlyphChartsWorkbenchControls(state.controls);
  const setControl = (control: GlyphChartsWorkbenchControlAction) => dispatch({ type: "set-control", control });
  // P3-6 (REVIEW-dock-colours-sliders-opus.md): under `Color: none` the
  // library drops every colour from the render, but every swatch (axis and
  // per-mark) stayed fully live with no signal — a picked value that
  // silently paints nothing reads as broken, not as a colour the reader
  // chose to suppress. Dimmed with the reason on `title`, `/maps`'
  // `mapDirectionLocked` idiom for "disabled with its reason", not hidden —
  // the colour is still real state, just inert while `Color` is off.
  const colorDisabled = controls.color === "none";
  const colorDisabledReason = colorDisabled ? "Color mode is off — pick a colour mode below to see it painted." : undefined;
  // Ticks rows (owner packet item 1) — the seed a reader gets when
  // unchecking "auto" (`chartsWorkbenchActualTicks`'s own doc).
  const actualXTicks = rendered ? chartsWorkbenchActualTicks(rendered, "x", controls.charset) : undefined;
  const actualYTicks = rendered ? chartsWorkbenchActualTicks(rendered, "y", controls.charset) : undefined;
  const output = useFolder(gui, "Output", { open: true });
  // Folder-title-bar reset (REVIEW-dock-addenda-opus.md P3-5) — "OUTPUT
  // ═══════ [reset]" on the folder's own native title line; see
  // `InstrumentWorkbench/useFolderTitleReset`'s own doc, shared with
  // `/diagrams`.
  useFolderTitleReset(output, "Reset target, charset, color, width, height, and detail to this target's defaults", () => dispatch({ type: "reset-target" }));
  const targetSlot = useDockSlot(output, { position: "bottom", className: "dock-toggle-row-slot" });
  const charsetSlot = useDockSlot(output, { position: "bottom", className: "dock-toggle-row-slot" });
  const colorSlot = useDockSlot(output, { position: "bottom", className: "dock-toggle-row-slot" });
  useSlider(output, "Width", { min: 12, max: 240, step: 1 }, controls.width, (value) => setControl({ type: "width", value }));
  useSlider(output, "Height", { min: 6, max: 120, step: 1 }, controls.height, (value) => setControl({ type: "height", value }));
  // Density (the user's own framing: "like in the 3D renderers we have the
  // density sliders" — AGENTS.md's "Per-mesh detail layers", the same
  // multiplier-on-cells-per-unit rule, applied to the chart's own render
  // grid instead of a mesh). Web only: `terminal`/`chat` render at whatever
  // cell size the CONSUMING renderer picks (a real terminal's font, a chat
  // client's fenced-code-block font), which this page cannot resize, so the
  // row dims with a reason there rather than doing nothing silently
  // (`@glyphcss/maps`' `mapDirectionLocked` idiom, `MapsWorkbench/mapsKit.tsx`).
  const densityLocked = chartsWorkbenchDensityLocked(controls.target);
  const densityMax = useMemo(() => chartsDensitySliderMax(), []);
  const densityCtrl = useSlider(output, "Density", { min: CHARTS_DENSITY_MIN, max: densityMax, step: CHARTS_DENSITY_STEP },
    chartsWorkbenchDensity(state.controls), (value) => setControl({ type: "density", value }));
  useEffect(() => {
    if (!densityCtrl) return;
    densityCtrl.setEnabled(!densityLocked);
    densityCtrl.raw.domElement.title = densityLocked
      ? "Fixed cell size on this target — density applies to web."
      : `Renders more cells for the same on-screen size (like the 3D renderers' own density), down to a ${CHARTS_DENSITY_MIN_FONT_PX}px minimum cell — capped at ${densityMax}× for that floor.`;
  }, [densityCtrl, densityLocked, densityMax]);
  const detailSlot = useDockSlot(output, { position: "bottom", className: "dock-toggle-row-slot" });

  // Dataset selection now lives in the left rail (AGENTS.md's "Charts" —
  // "Data layer" — it is this page's own "model", exactly as synth's rail
  // is the voice/model picker): `ChartsWorkbench.tsx` renders
  // `ChartsDataFolder` directly in the rail body, so this Dock carries no
  // Data folder at all.
  const chart = useFolder(gui, "Chart", { open: true });
  // Folder-title-bar reset (P2-6, REVIEW-dock-colours-sliders-opus.md;
  // REVIEW-dock-addenda-opus.md P3-3) — the Output folder's own reset is
  // scoped to output settings only (target/charset/color/width/height/
  // detail) and never touches a hand-picked axis/mark colour, a typed
  // scale domain, an axis title placement, or a tick count, all of which
  // live in THIS folder (and Scales/Axes, below it) — this is their own
  // reset, same title-bar idiom. Its scope reaches across folders on
  // purpose (axis title placement and tick counts are Axes-folder rows,
  // not Chart-folder ones) — folded honestly into ONE reset and ONE
  // tooltip naming everything it touches, rather than a second reset on
  // the Axes folder for just those two.
  useFolderTitleReset(chart, "Reset axis colour, mark colours, textures, typed scale domains, axis title placement, and tick counts to their defaults", () => dispatch({ type: "reset-chart-style" }));
  useText(chart, "Title", state.chart.title, (title) => dispatch({ type: "set-chart", patch: { title } }));
  const titlePlacementSlot = useDockSlot(chart, { position: "bottom", className: "dock-toggle-row-slot" });
  useText(chart, "Description", state.chart.description, (description) => dispatch({ type: "set-chart", patch: { description } }));
  useToggle(chart, "Legend", state.chart.legend, (legend) => dispatch({ type: "set-chart", patch: { legend } }));
  const legendPlacementSlot = useDockSlot(chart, { position: "bottom", className: "dock-toggle-row-slot" });
  const regionFillSlot = useDockSlot(chart, { position: "bottom", className: "dock-toggle-row-slot" });
  const regionFillStatus = useMemo(() => chartsWorkbenchRegionFillStatus(state), [state]);
  const regionFillToggle = useMemo(() => chartsRegionFillToggle(regionFillStatus), [regionFillStatus]);

  const scales = useFolder(gui, "Scales", { open: true });
  const xTypeCtrl = useOption(scales, "X type", options(CHART_SCALE_TYPES), state.scales.x.type, (type) => dispatch({ type: "set-scale", axis: "x", patch: { type } }));
  const xDomainSlot = useDockSlot(scales, { position: "bottom", className: "charts-scale-domain-slot" });
  const yTypeCtrl = useOption(scales, "Y type", options(CHART_SCALE_TYPES), state.scales.y.type, (type) => dispatch({ type: "set-scale", axis: "y", patch: { type } }));
  const yDomainSlot = useDockSlot(scales, { position: "bottom", className: "charts-scale-domain-slot" });
  // Recomputed off the raw mark data (never the current min/max override —
  // see `chartsWorkbenchInferredDomains`'s own doc), so a `RangeSlider`'s
  // own draggable bounds don't shrink every time a reader narrows the
  // selection. Each axis resolves independently — a failing Y never takes
  // X's own, otherwise-valid, control down with it.
  const inferredDomains = useMemo(() => chartsWorkbenchInferredDomains(state), [state]);
  const zeroAnchoredY = useMemo(() => chartsWorkbenchHasZeroAnchoredMark(state), [state]);
  const hasCartesianScale = useMemo(() => chartsWorkbenchHasCartesianMark(state), [state]);
  // Both read only the marks (twelve domain resolutions, and one pass over
  // the mark data), so a Scales/Axes/Output edit never recomputes them.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const scaleTypeFits = useMemo(() => chartsWorkbenchScaleTypeFits(state), [state.marks]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const timePrecision = useMemo(() => ({ x: chartsWorkbenchAxisTimePrecision(state, "x"), y: chartsWorkbenchAxisTimePrecision(state, "y") }), [state.marks]);
  useScaleTypeFit(xTypeCtrl, scaleTypeFits.x);
  useScaleTypeFit(yTypeCtrl, scaleTypeFits.y);
  const unfitOf = (axis: "x" | "y") => {
    const fit = scaleTypeFits[axis][state.scales[axis].type];
    return fit.fits ? undefined : fit;
  };

  const axes = useFolder(gui, "Axes", { open: false });
  // Axis colour (packet item 1; dock-fix bundle item 7) — MOVED here from
  // the Chart folder: this IS "the ticks/title rows" folder for an axis,
  // and a shared or per-axis swatch reads as one more axis-level control
  // beside them, not a chart-wide style choice living apart from what it
  // colours. The Chart folder's own title-bar reset above still clears it
  // (its tooltip already named "axis colour" before this moved, and still
  // does) — only the ROW moved, not which reset owns it.
  const axisColorSlot = useDockSlot(axes, { position: "top", className: "charts-axis-color-slot" });
  useTicksControl(axes, "x", state.axes.x.ticks, actualXTicks, dispatch);
  useToggle(axes, "X tick marks", state.axes.x.tickMarks, (tickMarks) => dispatch({ type: "set-axis", axis: "x", patch: { tickMarks } }));
  useToggle(axes, "X grid", state.axes.x.grid, (grid) => dispatch({ type: "set-axis", axis: "x", patch: { grid } }));
  useText(axes, "X title", state.axes.x.title, (title) => dispatch({ type: "set-axis", axis: "x", patch: { title } }));
  // Axis title placement (Dock item "Axis Title + Title at") — the same
  // pair (text + placement toggle) the chart's own title row has, added
  // right after each axis's existing Title text field.
  const xTitleAtSlot = useDockSlot(axes, { position: "bottom", className: "dock-toggle-row-slot" });
  useTicksControl(axes, "y", state.axes.y.ticks, actualYTicks, dispatch);
  useToggle(axes, "Y tick marks", state.axes.y.tickMarks, (tickMarks) => dispatch({ type: "set-axis", axis: "y", patch: { tickMarks } }));
  useToggle(axes, "Y grid", state.axes.y.grid, (grid) => dispatch({ type: "set-axis", axis: "y", patch: { grid } }));
  useText(axes, "Y title", state.axes.y.title, (title) => dispatch({ type: "set-axis", axis: "y", patch: { title } }));
  const yTitleAtSlot = useDockSlot(axes, { position: "bottom", className: "dock-toggle-row-slot" });

  // View folder (3D only, packet C3) — hidden entirely in 2D mode, the same
  // `.hide()`/`.show()` idiom the Terminal folder below already uses for
  // its own target gating.
  const is3d = state.dimension === "3d";
  const view = useFolder(gui, "View", { open: true });
  useEffect(() => { if (view) is3d ? view.show() : view.hide(); }, [view, is3d]);
  const orbitModeSlot = useDockSlot(view, { position: "bottom", className: "dock-toggle-row-slot" });
  const resetCameraSlot = useDockSlot(view, { position: "bottom", className: "dock-toggle-row-slot" });
  const shadingSlot = useDockSlot(view, { position: "bottom", className: "dock-toggle-row-slot" });
  const colorscaleSlot = useDockSlot(view, { position: "bottom", className: "dock-toggle-row-slot" });

  const terminal = useFolder(gui, "Terminal", { open: true });
  useToggle(terminal, "NO_COLOR", state.terminal.NO_COLOR, (value) => dispatch({ type: "set-terminal", flag: "NO_COLOR", value }));
  useToggle(terminal, "FORCE_COLOR", state.terminal.FORCE_COLOR, (value) => dispatch({ type: "set-terminal", flag: "FORCE_COLOR", value }));
  useEffect(() => { if (terminal) controls.target === "terminal" ? terminal.show() : terminal.hide(); }, [terminal, controls.target]);

  return <>
    {targetSlot && createPortal(
      <div className="dock-toggle-row">
        <span className="dock-toggle-row-label">Target</span>
        <IconToggle groupTitle="Output target" options={TARGET_TOGGLE} value={controls.target} onChange={(v) => setControl({ type: "target", value: v as GlyphChartTarget })} />
      </div>,
      targetSlot,
    )}
    {charsetSlot && createPortal(
      <div className="dock-toggle-row">
        <span className="dock-toggle-row-label">Charset</span>
        <IconToggle groupTitle="Character set" options={CHARSET_TOGGLE} value={controls.charset} onChange={(v) => setControl({ type: "charset", value: v as GlyphChartCharset })} />
      </div>,
      charsetSlot,
    )}
    {colorSlot && createPortal(
      <div className="dock-toggle-row">
        <span className="dock-toggle-row-label">Color</span>
        <IconToggle groupTitle="Color mode — independent of target" options={COLOR_TOGGLE} value={controls.color} onChange={(v) => setControl({ type: "color", value: v as GlyphChartColorMode })} />
      </div>,
      colorSlot,
    )}
    {detailSlot && createPortal(
      <div className="dock-toggle-row">
        <span className="dock-toggle-row-label">Detail</span>
        <IconToggle groupTitle="Layout detail" options={DETAIL_TOGGLE} value={controls.detail ?? "auto"} onChange={(v) => setControl({ type: "detail", value: v as GlyphChartDetail })} />
      </div>,
      detailSlot,
    )}
    {titlePlacementSlot && createPortal(
      <div className="dock-toggle-row">
        <span className="dock-toggle-row-label">Title at</span>
        <IconToggle groupTitle="Title horizontal alignment" options={TITLE_ALIGN_TOGGLE} value={state.chart.titleAlign} onChange={(titleAlign) => dispatch({ type: "set-chart", patch: { titleAlign: titleAlign as ChartsWorkbenchState["chart"]["titleAlign"] } })} />
        <IconToggle groupTitle="Title row position" options={TITLE_POSITION_TOGGLE} value={state.chart.titlePosition} onChange={(titlePosition) => dispatch({ type: "set-chart", patch: { titlePosition: titlePosition as ChartsWorkbenchState["chart"]["titlePosition"] } })} />
      </div>,
      titlePlacementSlot,
    )}
    {legendPlacementSlot && createPortal(
      <div className="dock-toggle-row">
        <span className="dock-toggle-row-label">Legend at</span>
        <IconToggle groupTitle="Legend placement" options={LEGEND_TOGGLE} value={state.chart.legendPlacement} onChange={(legendPlacement) => dispatch({ type: "set-chart", patch: { legendPlacement: legendPlacement as ChartsWorkbenchState["chart"]["legendPlacement"] } })} />
      </div>,
      legendPlacementSlot,
    )}
    {regionFillSlot && createPortal(
      <div className="dock-toggle-row" title={regionFillStatus?.inapplicable ?? regionFillToggle[0]!.desc}>
        <span className="dock-toggle-row-label">Textures</span>
        <IconToggle groupTitle="Fill textures" options={regionFillToggle} value={state.style.regionFill ?? "auto"}
          onChange={(value) => dispatch({ type: "set-region-fill", value: value as typeof CHART_REGION_FILLS[number] })} />
      </div>,
      regionFillSlot,
    )}
    {axisColorSlot && createPortal(
      <div className="charts-axis-color">
        <div className="dock-toggle-row">
          <span className="dock-toggle-row-label">Axes</span>
          <button type="button" className={`charts-axis-color-mode${state.style.axisColor.mode === "per-axis" ? " is-active" : ""}`}
            aria-pressed={state.style.axisColor.mode === "per-axis"}
            title="Toggle between one shared axis colour and separate X/Y swatches"
            onClick={() => dispatch({ type: "set-axis-color-mode", mode: state.style.axisColor.mode === CHART_AXIS_COLOR_MODES[0] ? CHART_AXIS_COLOR_MODES[1] : CHART_AXIS_COLOR_MODES[0] })}>
            {AXIS_COLOR_MODE_LABEL[state.style.axisColor.mode]}
          </button>
        </div>
        {state.style.axisColor.mode === "shared"
          ? <ColorSwatch label="Colour" value={state.style.axisColor.shared} onChange={(color) => dispatch({ type: "set-axis-color", which: "shared", color })} disabled={colorDisabled} disabledReason={colorDisabledReason} />
          : <>
              <ColorSwatch label="X" value={state.style.axisColor.x} onChange={(color) => dispatch({ type: "set-axis-color", which: "x", color })} disabled={colorDisabled} disabledReason={colorDisabledReason} />
              <ColorSwatch label="Y" value={state.style.axisColor.y} onChange={(color) => dispatch({ type: "set-axis-color", which: "y", color })} disabled={colorDisabled} disabledReason={colorDisabledReason} />
            </>}
      </div>,
      axisColorSlot,
    )}
    {xDomainSlot && createPortal(
      <ScaleDomainControl axis="x" scale={state.scales.x} inferred={inferredDomains.x} zeroAnchored={false} hasCartesianScale={hasCartesianScale}
        unfit={unfitOf("x")} timePrecision={timePrecision.x} dispatch={dispatch} />,
      xDomainSlot,
    )}
    {yDomainSlot && createPortal(
      <ScaleDomainControl axis="y" scale={state.scales.y} inferred={inferredDomains.y} zeroAnchored={zeroAnchoredY} hasCartesianScale={hasCartesianScale}
        unfit={unfitOf("y")} timePrecision={timePrecision.y} dispatch={dispatch} />,
      yDomainSlot,
    )}
    {xTitleAtSlot && createPortal(
      <div className="dock-toggle-row">
        <span className="dock-toggle-row-label">X title at</span>
        <IconToggle groupTitle="X axis title placement" options={AXIS_X_TITLE_AT_TOGGLE} value={state.style.axisTitlePlacement.x}
          onChange={(value) => dispatch({ type: "set-axis-title-at", axis: "x", value: value as ChartsWorkbenchState["style"]["axisTitlePlacement"]["x"] })} />
      </div>,
      xTitleAtSlot,
    )}
    {yTitleAtSlot && createPortal(
      <div className="dock-toggle-row">
        <span className="dock-toggle-row-label">Y title at</span>
        <IconToggle groupTitle="Y axis title placement" options={AXIS_Y_TITLE_AT_TOGGLE} value={state.style.axisTitlePlacement.y}
          onChange={(value) => dispatch({ type: "set-axis-title-at", axis: "y", value: value as ChartsWorkbenchState["style"]["axisTitlePlacement"]["y"] })} />
      </div>,
      yTitleAtSlot,
    )}
    {orbitModeSlot && createPortal(
      <div className="dock-toggle-row">
        <span className="dock-toggle-row-label">Rotate</span>
        <IconToggle groupTitle="Orbit mode" options={CHARTS_3D_ORBIT_MODE_TOGGLE} value={state.chart3d.orbitMode}
          onChange={(value) => dispatch({ type: "set-3d-view", patch: { orbitMode: value as ChartsWorkbenchState["chart3d"]["orbitMode"] } })} />
      </div>,
      orbitModeSlot,
    )}
    {resetCameraSlot && createPortal(
      <div className="dock-toggle-row">
        <span className="dock-toggle-row-label">Camera</span>
        <button type="button" className="gx-toggle-btn gx-toggle-text charts-3d-reset-camera" title="Reset the camera to the default framing" onClick={() => chart3dViewportHandleRef?.current?.resetCamera()}>Reset</button>
      </div>,
      resetCameraSlot,
    )}
    {shadingSlot && createPortal(
      <div className="dock-toggle-row">
        <span className="dock-toggle-row-label">Shading</span>
        <IconToggle groupTitle="Surface shading" options={CHARTS_3D_SHADING_TOGGLE} value={state.chart3d.shading}
          onChange={(value) => dispatch({ type: "set-3d-view", patch: { shading: value as ChartsWorkbenchState["chart3d"]["shading"] } })} />
      </div>,
      shadingSlot,
    )}
    {colorscaleSlot && createPortal(
      <div className="dock-toggle-row">
        <span className="dock-toggle-row-label">Colorscale</span>
        <IconToggle groupTitle="Surface colorscale" options={CHARTS_3D_COLORSCALE_TOGGLE} value={state.chart3d.colorscale}
          onChange={(value) => dispatch({ type: "set-3d-view", patch: { colorscale: value as ChartsWorkbenchState["chart3d"]["colorscale"] } })} />
      </div>,
      colorscaleSlot,
    )}
  </>;
}
