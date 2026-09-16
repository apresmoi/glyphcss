import { useEffect, useMemo, type Dispatch } from "react";
import { createPortal } from "react-dom";
import type { GUI } from "lil-gui";
import type { GlyphChartCharset, GlyphChartColorMode, GlyphChartDetail, GlyphChartTarget } from "@glyphcss/charts";
import { GLYPH_CHART_3D_COLORSCALE_NAMES, glyphChart3dCharsetDegrades, type GlyphChart3dResolvedAxis } from "@glyphcss/charts/3d";
import { useColor, useDockSlot, useFolder, useOption, useSlider, useText, useToggle, type DockOptionController } from "../Dock/primitives";
import { useDockGui } from "../Dock/slots";
import { IconToggle } from "../SynthWorkbench/synthKit";
import type { Charts3dViewportHandle } from "./Charts3dViewport";
import { RangeCategorySelect, RangeSlider, RangeUnavailable, rangeSliderStep } from "../InstrumentWorkbench/RangeSlider";
import { ColorSwatch } from "../InstrumentWorkbench/ColorSwatch";
import { useFolderTitleReset } from "../InstrumentWorkbench/useFolderTitleReset";
import { Instrument3DEffectsFolder, type Instrument3DEffectTarget } from "../InstrumentWorkbench/Instrument3DEffectsFolder";
import { CHARTS_3D_EFFECT_SURFACE_TARGET } from "./Charts3dViewport";
import type { Charts3dAxisOverride, Charts3dGuideOptions, Charts3dResolveResult } from "./chartsWorkbench3d";
import {
  CHART_AXIS_COLOR_MODES, CHART_CHARSETS, CHART_COLORS, CHART_DETAILS, CHART_LEGEND_PLACEMENTS, CHART_REGION_FILLS, CHART_SCALE_TYPES, CHART_TARGETS,
  CHART_TITLE_ALIGNS, CHART_TITLE_POSITIONS, CHART_X_AXIS_TITLE_ATS,
  CHARTS_3D_AXIS_FORMAT_NAMES,
  CHARTS_DENSITY_MIN, CHARTS_DENSITY_MIN_FONT_PX, CHARTS_DENSITY_STEP,
  CHARTS_NO_SCALE_REASON, CHARTS_TIME_UNIT_MS, chartsDensitySliderMax, chartsDomainNumberDisplay, chartsIsoDateStamp, chartsNumberToScaleBound, chartsScaleBoundToNumber,
  chartsScaleSliderBounds, chartsTimeBoundDisplay, chartsTimeBoundFromDisplay, chartsTimeBoundSnap, chartsTimeDisplayPrecision, chartsTimePrecisionOf,
  chartsWorkbenchAxisTimePrecision, chartsWorkbenchScaleTypeFits,
  chartsWorkbenchDensity, chartsWorkbenchDensityLocked, chartsWorkbenchHasCartesianMark, chartsWorkbenchHasZeroAnchoredMark, chartsWorkbenchInferredDomains,
  chartsWorkbenchSizeLocked,
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
      value: v as string, icon: <span className="gx-toggle-text">{CHARSET_SYMBOL[v]}</span>, label: v, desc: `Charset: ${v}`,
      ...(disabled ? { disabled: true, disabledReason: CHARTS_3D_CHARSET_UNAVAILABLE_REASON } : {}),
    };
  });
}
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
// A 3D axis's own title placement (AGENTS.md's "Axis title position") shares
// ONE start/center/end vocabulary across every axis (x, y AND z) — unlike
// 2D's x/y split, a 3D title always pushes outward from the same fixed
// origin corner regardless of which axis it belongs to — so this reuses the
// 2D X row's own symbol table rather than a duplicate one.
const CHARTS_3D_AXIS_TITLE_AT_TOGGLE = (["start", "center", "end"] as const).map((v) => ({
  value: v as string, icon: <span className="gx-toggle-text">{AXIS_X_TITLE_AT_SYMBOL[v]}</span>, label: v, desc: `Title placement: ${v}`,
}));
/** The library's own `object.ts` default for `"end"` (`AXIS_TITLE_TIP_OFFSET`,
 *  the page's own default `titleAt`) — the titleOffset slider's own seed
 *  when the reader has set no override. `"start"`/`"center"` keep their own
 *  larger `0.6` (`AXIS_TITLE_LEGACY_MARGIN`) in the library; the slider seed
 *  is not re-derived per `titleAt` selection here, a known simplification. */
const AXIS_TITLE_OFFSET_DEFAULT = 0.15;

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
function useTicksControl(folder: GUI | null, axis: "x" | "y", ticks: number, actualTicks: number | undefined, dispatch: Dispatch<ChartsWorkbenchAction>, visible = true): void {
  const AXIS = axis.toUpperCase();
  const auto = ticks === 0;
  // Unchecking auto seeds the slider from the axis's own last-rendered
  // tick count (`chartsWorkbenchActualTicks`'s own doc) — grounded in what
  // the reader can currently see, never a guessed flat number — clamped
  // only as the last-resort floor for the rare grid this can't read a
  // count off at all (REVIEW-dock-addenda-opus.md P2-2).
  const seed = Math.max(CHART_TICKS_MIN, Math.min(CHART_TICKS_MAX, actualTicks ?? CHART_TICKS_MIN));
  const autoCtrl = useToggle(folder, `${AXIS} ticks: auto`, auto, (checked) => dispatch({ type: "set-axis", axis, patch: { ticks: checked ? 0 : seed } }));
  const shown = auto ? seed : ticks;
  const sliderCtrl = useSlider(folder, `${AXIS} ticks`, { min: CHART_TICKS_MIN, max: CHART_TICKS_MAX, step: 1 }, shown,
    (value) => dispatch({ type: "set-axis", axis, patch: { ticks: value } }));
  useEffect(() => { sliderCtrl?.setEnabled(!auto); }, [sliderCtrl, auto]);
  // The X/Y axis subgroup's own folder is hidden/shown as a whole
  // (`ChartsDock`'s own per-axis `useFolder`/`.hide()`/`.show()` call) —
  // this per-control toggle stays too, redundant with the ancestor's own
  // `display: none` but load-bearing for jsdom, which has no layout engine
  // and so never reflects ancestor-hidden state on a DESCENDANT's own
  // `getComputedStyle().display` (`Charts3dViewport.lifecycle.test.tsx`'s
  // own visibility assertions read each control's OWN computed style).
  useEffect(() => { autoCtrl?.setVisible(visible); sliderCtrl?.setVisible(visible); }, [autoCtrl, sliderCtrl, visible]);
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

const CHARTS_3D_AXIS_FORMAT_OPTIONS: Record<string, string> = Object.fromEntries(["auto", ...CHARTS_3D_AXIS_FORMAT_NAMES].map((v) => [v, v]));

/**
 * One 3D axis's full row set (packet C6, coordinator addendum) — title,
 * ticks (auto + slider, seeded off the axis's own ACTUAL resolved tick
 * count, mirroring `useTicksControl`'s idiom exactly), a tick-format
 * preset select (`CHARTS_3D_AXIS_FORMAT_NAMES`'s own safe subset), four
 * visibility toggles seeded from the axis's own FULLY RESOLVED visibility
 * (`GlyphChart3dResolvedAxis.lineVisible`/etc. — already the library-
 * default-then-guide-then-axis-override chain, so the shown value is
 * always what the reader is currently looking at) and a colour swatch,
 * every row LIVE in the SAME "Axes" folder the 2D rows use, toggled
 * `.setVisible(visible)` together rather than a second folder — mirrors
 * `useTicksControl`'s own `visible` parameter. Each row's own label carries
 * a "(3D)" suffix so it never collides with the 2D row of the same name
 * mounted alongside it in the identical folder (only one of the two sets
 * is ever visible at a time, but both always exist as real DOM rows).
 *
 * Writing a visibility toggle or colour ALWAYS sets an explicit override —
 * there is no separate "[reset] back to auto" control for these two kinds
 * of row (a documented, bounded simplification; text/ticks/format/domain
 * all keep a real "auto" path). A future increment can add one without
 * changing this function's own shape.
 */
function use3dAxisControls(
  folder: GUI | null,
  axisLabel: "X" | "Y" | "Z",
  axisKey: "x" | "y" | "z",
  override: Charts3dAxisOverride,
  resolved: GlyphChart3dResolvedAxis | undefined,
  visible: boolean,
  colorDisabled: boolean,
  colorDisabledReason: string | undefined,
  dispatch: Dispatch<ChartsWorkbenchAction>,
): void {
  const patch = (p: Partial<Charts3dAxisOverride>) => dispatch({ type: "set-3d-axis", axis: axisKey, patch: p });

  const titleCtrl = useText(folder, `${axisLabel} title (3D)`, override.title ?? "", (title) => patch({ title }));

  const ticksAuto = override.ticks === undefined;
  const ticksSeed = Math.max(CHART_TICKS_MIN, Math.min(CHART_TICKS_MAX, resolved?.ticks.length ?? 5));
  const ticksAutoCtrl = useToggle(folder, `${axisLabel} ticks: auto (3D)`, ticksAuto, (checked) => patch({ ticks: checked ? undefined : ticksSeed }));
  const ticksShown = ticksAuto ? ticksSeed : override.ticks!;
  const ticksCtrl = useSlider(folder, `${axisLabel} ticks (3D)`, { min: CHART_TICKS_MIN, max: CHART_TICKS_MAX, step: 1 }, ticksShown,
    (value) => patch({ ticks: value }));
  useEffect(() => { ticksCtrl?.setEnabled(!ticksAuto); }, [ticksCtrl, ticksAuto]);

  const formatCtrl = useOption(folder, `${axisLabel} format (3D)`, CHARTS_3D_AXIS_FORMAT_OPTIONS, override.format ?? "auto",
    (value) => patch({ format: value === "auto" ? undefined : value }));

  const lineCtrl = useToggle(folder, `${axisLabel} line (3D)`, override.line ?? resolved?.lineVisible ?? true, (line) => patch({ line }));
  const tickMarksCtrl = useToggle(folder, `${axisLabel} tick marks (3D)`, override.tickMarks ?? resolved?.tickMarksVisible ?? true, (tickMarks) => patch({ tickMarks }));
  const tickLabelsCtrl = useToggle(folder, `${axisLabel} tick labels (3D)`, override.tickLabels ?? resolved?.tickLabelsVisible ?? true, (tickLabels) => patch({ tickLabels }));
  const gridCtrl = useToggle(folder, `${axisLabel} grid (3D)`, override.grid ?? resolved?.gridVisible ?? false, (grid) => patch({ grid }));

  const colorCtrl = useColor(folder, `${axisLabel} colour (3D)`, override.color ?? resolved?.color ?? "#7a7f8a", (color) => patch({ color }));
  useEffect(() => {
    colorCtrl?.setEnabled(!colorDisabled);
    colorCtrl?.raw.domElement.setAttribute("title", colorDisabled ? (colorDisabledReason ?? "") : "");
  }, [colorCtrl, colorDisabled, colorDisabledReason]);

  // Axis title placement (user feedback, verbatim: "we need to be able to
  // configure the position of the title of the axis") — `titleOffset` is a
  // plain number slider seeded from the library's own default (`0.6`,
  // `AXIS_TITLE_OFFSET_DEFAULT`) when unset; `titleAt` is an IconToggle
  // rendered by the caller (`${axisLabel}3dTitleAtSlot`, mirroring
  // `x3dDomainSlot`'s own external-slot idiom) since every 3D axis shares
  // ONE start/center/end vocabulary, unlike 2D's x/y split.
  const titleOffsetCtrl = useSlider(folder, `${axisLabel} title offset (3D)`, { min: 0, max: 2, step: 0.05 },
    override.titleOffset ?? AXIS_TITLE_OFFSET_DEFAULT, (value) => patch({ titleOffset: value }));

  useEffect(() => {
    for (const ctrl of [titleCtrl, ticksAutoCtrl, ticksCtrl, formatCtrl, lineCtrl, tickMarksCtrl, tickLabelsCtrl, gridCtrl, colorCtrl, titleOffsetCtrl]) ctrl?.setVisible(visible);
  }, [titleCtrl, ticksAutoCtrl, ticksCtrl, formatCtrl, lineCtrl, tickMarksCtrl, tickLabelsCtrl, gridCtrl, colorCtrl, titleOffsetCtrl, visible]);
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

/**
 * A 3D axis's own domain row (packet C6, coordinator addendum) — MUCH
 * simpler than the 2D `ScaleDomainControl` above: a 3D axis domain is
 * ALWAYS plain finite linear numbers (`GlyphChart3dResolvedAxis.domain`),
 * never log/time/zero-anchored, so none of that control's own
 * `loFloor`/`loCeiling`/`capReason` machinery applies. Bounds are the
 * resolved axis's own NICE domain padded +/-20%, mirroring 2D's own
 * padding convention (`chartsScaleSliderBounds`'s ordinary-scale case).
 * Either end left `null` (cleared) reverts BOTH ends to auto — the
 * library's own `GlyphChart3dAxisOptions.domain` is one atomic `[min, max]`
 * tuple with no partial-override shape, unlike 2D's independently-nullable
 * min/max (a documented, bounded simplification). `resolved === undefined`
 * (no 3D mark currently resolved, e.g. mid-error) disables the row rather
 * than guessing bounds.
 */
function Charts3dAxisDomainRow({ label, override, resolved, dispatch, axis }: {
  label: string; axis: "x" | "y" | "z";
  override: readonly [number, number] | undefined;
  resolved: GlyphChart3dResolvedAxis | undefined;
  dispatch: Dispatch<ChartsWorkbenchAction>;
}) {
  if (!resolved) return <RangeUnavailable label={`${label} domain`} reason="No 3D chart is currently resolved." />;
  const [dataMin, dataMax] = resolved.domain;
  const span = dataMax - dataMin || 1;
  const min = dataMin - span * 0.2;
  const max = dataMax + span * 0.2;
  const step = rangeSliderStep(min, max);
  const value: readonly [number | null, number | null] = override ? [override[0], override[1]] : [null, null];
  return <RangeSlider label={`${label} domain`} min={min} max={max} step={step} domain={[dataMin, dataMax]}
    value={value} format={(n) => chartsDomainNumberDisplay(n, step)}
    onChange={(next) => dispatch({
      type: "set-3d-axis", axis,
      patch: { domain: !next || next[0] === null || next[1] === null ? undefined : [next[0], next[1]] },
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
// Packet C4 (codex review addition) — mirrors `renderGlyphChart3d`'s own
// `style` option exactly (`resolveCharts3dStyle`'s own doc): "auto"
// resolves braille to a real wireframe and every other charset to solid;
// an explicit choice always wins, on both the live viewport and Copy.
const CHARTS_3D_STYLE_TOGGLE = [
  { value: "auto", icon: <span className="gx-toggle-text">auto</span>, label: "Auto", desc: "Follows charset — braille renders as a real wireframe, everything else solid." },
  { value: "solid", icon: <span className="gx-toggle-text">solid</span>, label: "Solid", desc: "Lambert/value-shaded fill." },
  { value: "wireframe", icon: <span className="gx-toggle-text">wire</span>, label: "Wireframe", desc: "The surface's own decimated quad grid as depth-tested lines." },
  { value: "ink", icon: <span className="gx-toggle-text">ink</span>, label: "Ink", desc: "Silhouette + crease outline only." },
];
const CHARTS_3D_COLORSCALE_TOGGLE = GLYPH_CHART_3D_COLORSCALE_NAMES.map((v) => ({ value: v as string, icon: <span className="gx-toggle-text">{v.slice(0, 4)}</span>, label: v, desc: `Colorscale: ${v}` }));

// Guide toggles (packet C4, item 1) — one row per `GlyphChart3dGuideOptions`
// field, read off `packages/charts/src/3d/types.ts` directly: `axisLines`/
// `ticks`/`tickLabels`/`titles`/`grid` default `true`, `floorGrid`/`walls`/
// `box` default `false` (`GlyphChart3dGuideOptions`'s own doc comment).
// `state.chart3d.guides` stores only OVERRIDES (an empty object means every
// field follows the library's own default), so a row's shown value is
// `state.chart3d.guides[key] ?? CHARTS_3D_GUIDE_DEFAULTS[key]` — never a
// value re-derived from the resolved mark, which would need threading a new
// prop through just to read 8 fields this page already knows statically.
const CHARTS_3D_GUIDE_DEFAULTS: Record<keyof Charts3dGuideOptions, boolean> = {
  axisLines: true, ticks: true, tickLabels: true, titles: true, grid: true, floorGrid: false, walls: false, box: false,
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
const CHARTS_3D_EFFECT_IDS = ["none", "scan", "glitch", "ripple"] as const;
const CHARTS_3D_EFFECT_TARGETS: readonly Instrument3DEffectTarget[] = [{ id: CHARTS_3D_EFFECT_SURFACE_TARGET, label: "Chart" }];

export function ChartsDock({ state, dispatch, rendered, chart3dViewportHandleRef, chart3dResolved }: {
  state: ChartsWorkbenchState; dispatch: Dispatch<ChartsWorkbenchAction>; rendered?: ChartsWorkbenchRender;
  /** The live 3D viewport's own reset-camera entry point — `undefined`/not
   *  yet mounted is a no-op button, never a crash. */
  chart3dViewportHandleRef?: { current: Charts3dViewportHandle | null };
  /** The CURRENTLY resolved 3D mark (packet C6) — the Axes folder's own
   *  per-axis rows read its `axes.{x,y,z}` for their tick-count/domain
   *  seeds, mirroring `rendered`'s own "seed from what actually rendered"
   *  role for the 2D ticks row. `undefined`/not `ok` leaves every 3D axis
   *  row at its own built-in fallback seed rather than crashing. */
  chart3dResolved?: Charts3dResolveResult;
}) {
  const gui = useDockGui();
  const controls = resolveGlyphChartsWorkbenchControls(state.controls);
  const setControl = (control: GlyphChartsWorkbenchControlAction) => dispatch({ type: "set-control", control });
  // Hoisted above every consumer (the Charset row's own dim-with-reason
  // below, AND the View folder's own show/hide gating further down) —
  // `state.dimension === "3d"` is a single cheap boolean, no reason to
  // compute it twice.
  const is3d = state.dimension === "3d";
  const charsetToggle = useMemo(() => chartsCharsetToggle(is3d), [is3d]);
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
  const widthCtrl = useSlider(output, "Width", { min: 12, max: 240, step: 1 }, controls.width, (value) => setControl({ type: "width", value }));
  const heightCtrl = useSlider(output, "Height", { min: 6, max: 120, step: 1 }, controls.height, (value) => setControl({ type: "height", value }));
  // `web` fills the measured viewport instead of a fixed logical grid
  // (AGENTS.md's "Charts" "Targets and page") — the mirror image of
  // Density's own lock just below: there the row dims OFF web (a fixed
  // consuming-renderer cell size has nothing to scale), here it dims ON
  // web (the viewport, not this slider, now owns the grid). The dialed-in
  // value still survives the round trip back to terminal/chat exactly like
  // density's own does off web (`chartsWorkbenchSizeLocked`'s own doc).
  const sizeLocked = chartsWorkbenchSizeLocked(controls.target);
  useEffect(() => {
    if (!widthCtrl || !heightCtrl) return;
    widthCtrl.setEnabled(!sizeLocked);
    heightCtrl.setEnabled(!sizeLocked);
    const reason = sizeLocked ? "Web fills the viewport." : "";
    widthCtrl.raw.domElement.title = reason;
    heightCtrl.raw.domElement.title = reason;
  }, [widthCtrl, heightCtrl, sizeLocked]);
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

  // Axes folder (user feedback, verbatim: "this section is a mess man, can
  // we somehow do a subgrouping by axis? like all the config for this axe,
  // all this config for this other axis"): a per-axis SUBFOLDER (nested
  // `useFolder`, collapsed by default) replaces the old flat wall of X/Y
  // (and, in 3D, X/Y/Z) rows, each with its own header reset clearing only
  // that axis (`useFolderTitleReset`). What's genuinely SHARED stays at
  // this outer "Axes" level, above every subgroup: the axis-colour mode
  // toggle (2D's `axisColorSlot`, which switches shared vs. per-axis
  // swatches — not one axis's own setting) and the shared 3D `axes.color`
  // swatch every per-axis colour overrides.
  const axes = useFolder(gui, "Axes", { open: false });
  // Axis colour (packet item 1; dock-fix bundle item 7) — MOVED here from
  // the Chart folder: this IS "the ticks/title rows" folder for an axis,
  // and a shared or per-axis swatch reads as one more axis-level control
  // beside them, not a chart-wide style choice living apart from what it
  // colours. The Chart folder's own title-bar reset above still clears it
  // (its tooltip already named "axis colour" before this moved, and still
  // does) — only the ROW moved, not which reset owns it.
  const axisColorSlot = useDockSlot(axes, { position: "top", className: "charts-axis-color-slot" });

  // 2D per-axis subgroups — both exist unconditionally (mirroring the 3D
  // subgroups below) and are hidden/shown as a WHOLE via the subfolder's
  // own `.hide()/.show()` while a 3D type is active; the per-control
  // `setVisible` calls inside `useTicksControl` stay too (jsdom has no
  // layout engine, so a descendant's own `getComputedStyle().display`
  // never reflects an ancestor folder's hidden state — see that hook's
  // own doc).
  const xAxisFolder = useFolder(axes, "X axis", { open: false });
  useFolderTitleReset(xAxisFolder, "Reset the X axis to its defaults", () => dispatch({ type: "reset-axis", axis: "x" }));
  const xTickMarksCtrl = useToggle(xAxisFolder, "X tick marks", state.axes.x.tickMarks, (tickMarks) => dispatch({ type: "set-axis", axis: "x", patch: { tickMarks } }));
  const xGridCtrl = useToggle(xAxisFolder, "X grid", state.axes.x.grid, (grid) => dispatch({ type: "set-axis", axis: "x", patch: { grid } }));
  const xTitleCtrl = useText(xAxisFolder, "X title", state.axes.x.title, (title) => dispatch({ type: "set-axis", axis: "x", patch: { title } }));
  useTicksControl(xAxisFolder, "x", state.axes.x.ticks, actualXTicks, dispatch, !is3d);
  // Axis title placement (Dock item "Axis Title + Title at") — the same
  // pair (text + placement toggle) the chart's own title row has, added
  // right after each axis's existing Title text field.
  const xTitleAtSlot = useDockSlot(xAxisFolder, { position: "bottom", className: "dock-toggle-row-slot" });

  const yAxisFolder = useFolder(axes, "Y axis", { open: false });
  useFolderTitleReset(yAxisFolder, "Reset the Y axis to its defaults", () => dispatch({ type: "reset-axis", axis: "y" }));
  const yTickMarksCtrl = useToggle(yAxisFolder, "Y tick marks", state.axes.y.tickMarks, (tickMarks) => dispatch({ type: "set-axis", axis: "y", patch: { tickMarks } }));
  const yGridCtrl = useToggle(yAxisFolder, "Y grid", state.axes.y.grid, (grid) => dispatch({ type: "set-axis", axis: "y", patch: { grid } }));
  const yTitleCtrl = useText(yAxisFolder, "Y title", state.axes.y.title, (title) => dispatch({ type: "set-axis", axis: "y", patch: { title } }));
  useTicksControl(yAxisFolder, "y", state.axes.y.ticks, actualYTicks, dispatch, !is3d);
  const yTitleAtSlot = useDockSlot(yAxisFolder, { position: "bottom", className: "dock-toggle-row-slot" });
  // Packet C6 — the whole 2D Axes subgroups hide while a 3D type is active;
  // the 3D subgroups below take over the SAME outer "Axes" folder instead
  // of a second one, per the coordinator's own instruction.
  useEffect(() => {
    for (const ctrl of [xTickMarksCtrl, xGridCtrl, xTitleCtrl, yTickMarksCtrl, yGridCtrl, yTitleCtrl]) ctrl?.setVisible(!is3d);
  }, [xTickMarksCtrl, xGridCtrl, xTitleCtrl, yTickMarksCtrl, yGridCtrl, yTitleCtrl, is3d]);
  useEffect(() => { if (xAxisFolder) is3d ? xAxisFolder.hide() : xAxisFolder.show(); }, [xAxisFolder, is3d]);
  useEffect(() => { if (yAxisFolder) is3d ? yAxisFolder.hide() : yAxisFolder.show(); }, [yAxisFolder, is3d]);

  // The 3D Axes subgroups (packet C6, coordinator addendum, widened to a
  // real per-axis SUBFOLDER by the "Axes folder subgrouping" packet) — x, y
  // AND z, each its own collapsed folder in the SAME outer "Axes" folder as
  // the 2D subgroups above, hidden/shown as a whole together with the 2D
  // ones flipped the other way. Colour dims (with the SAME reason the 2D
  // axis-colour swatches already use) under `Color: none`, since a 3D axis
  // colour paints nothing there either.
  const resolved3dAxes = chart3dResolved?.ok ? chart3dResolved.resolved.mark.axes : undefined;
  const axes3dColorCtrl = useColor(axes, "Axes colour (3D)", state.chart3d.axes.color ?? "#7a7f8a", (color) => dispatch({ type: "set-3d-axes-color", color }));
  useEffect(() => {
    axes3dColorCtrl?.setVisible(is3d);
    axes3dColorCtrl?.setEnabled(!colorDisabled);
    axes3dColorCtrl?.raw.domElement.setAttribute("title", colorDisabled ? (colorDisabledReason ?? "") : "");
  }, [axes3dColorCtrl, is3d, colorDisabled, colorDisabledReason]);

  const x3dAxisFolder = useFolder(axes, "X axis (3D)", { open: false });
  useFolderTitleReset(x3dAxisFolder, "Reset the X axis (3D) to its defaults", () => dispatch({ type: "reset-3d-axis", axis: "x" }));
  use3dAxisControls(x3dAxisFolder, "X", "x", state.chart3d.axes.x, resolved3dAxes?.x, is3d, colorDisabled, colorDisabledReason, dispatch);
  const x3dTitleAtSlot = useDockSlot(x3dAxisFolder, { position: "bottom", className: "dock-toggle-row-slot" });
  const x3dDomainSlot = useDockSlot(x3dAxisFolder, { position: "bottom", className: "charts-scale-domain-slot" });

  const y3dAxisFolder = useFolder(axes, "Y axis (3D)", { open: false });
  useFolderTitleReset(y3dAxisFolder, "Reset the Y axis (3D) to its defaults", () => dispatch({ type: "reset-3d-axis", axis: "y" }));
  use3dAxisControls(y3dAxisFolder, "Y", "y", state.chart3d.axes.y, resolved3dAxes?.y, is3d, colorDisabled, colorDisabledReason, dispatch);
  const y3dTitleAtSlot = useDockSlot(y3dAxisFolder, { position: "bottom", className: "dock-toggle-row-slot" });
  const y3dDomainSlot = useDockSlot(y3dAxisFolder, { position: "bottom", className: "charts-scale-domain-slot" });

  const z3dAxisFolder = useFolder(axes, "Z axis (3D)", { open: false });
  useFolderTitleReset(z3dAxisFolder, "Reset the Z axis (3D) to its defaults", () => dispatch({ type: "reset-3d-axis", axis: "z" }));
  use3dAxisControls(z3dAxisFolder, "Z", "z", state.chart3d.axes.z, resolved3dAxes?.z, is3d, colorDisabled, colorDisabledReason, dispatch);
  const z3dTitleAtSlot = useDockSlot(z3dAxisFolder, { position: "bottom", className: "dock-toggle-row-slot" });
  const z3dDomainSlot = useDockSlot(z3dAxisFolder, { position: "bottom", className: "charts-scale-domain-slot" });
  useEffect(() => { if (x3dAxisFolder) is3d ? x3dAxisFolder.show() : x3dAxisFolder.hide(); }, [x3dAxisFolder, is3d]);
  useEffect(() => { if (y3dAxisFolder) is3d ? y3dAxisFolder.show() : y3dAxisFolder.hide(); }, [y3dAxisFolder, is3d]);
  useEffect(() => { if (z3dAxisFolder) is3d ? z3dAxisFolder.show() : z3dAxisFolder.hide(); }, [z3dAxisFolder, is3d]);

  // View folder (3D only, packet C3) — hidden entirely in 2D mode, the same
  // `.hide()`/`.show()` idiom the Terminal folder below already uses for
  // its own target gating. `is3d` itself is hoisted above (the Charset
  // row's own dim-with-reason needs it too).
  const view = useFolder(gui, "View", { open: true });
  useEffect(() => { if (view) is3d ? view.show() : view.hide(); }, [view, is3d]);
  const orbitModeSlot = useDockSlot(view, { position: "bottom", className: "dock-toggle-row-slot" });
  const resetCameraSlot = useDockSlot(view, { position: "bottom", className: "dock-toggle-row-slot" });
  const styleSlot = useDockSlot(view, { position: "bottom", className: "dock-toggle-row-slot" });
  const shadingSlot = useDockSlot(view, { position: "bottom", className: "dock-toggle-row-slot" });
  const colorscaleSlot = useDockSlot(view, { position: "bottom", className: "dock-toggle-row-slot" });
  // Guide toggles (packet C4, item 1) — plain `useToggle` boolean rows, the
  // same primitive the Axes folder's own "X grid"/"X tick marks" rows use.
  // `guideValue`/`setGuide` avoid retyping the `?? CHARTS_3D_GUIDE_DEFAULTS`
  // fallback and the `set-3d-guides` dispatch 8 times over.
  const guideValue = (key: keyof Charts3dGuideOptions) => state.chart3d.guides[key] ?? CHARTS_3D_GUIDE_DEFAULTS[key];
  const setGuide = (key: keyof Charts3dGuideOptions) => (value: boolean) => dispatch({ type: "set-3d-guides", patch: { [key]: value } });
  useToggle(view, "Axis lines", guideValue("axisLines"), setGuide("axisLines"));
  useToggle(view, "Ticks", guideValue("ticks"), setGuide("ticks"));
  useToggle(view, "Tick labels", guideValue("tickLabels"), setGuide("tickLabels"));
  useToggle(view, "Axis titles", guideValue("titles"), setGuide("titles"));
  useToggle(view, "Wall grid", guideValue("grid"), setGuide("grid"));
  useToggle(view, "Floor grid", guideValue("floorGrid"), setGuide("floorGrid"));
  useToggle(view, "Wall outline", guideValue("walls"), setGuide("walls"));
  useToggle(view, "Box outline", guideValue("box"), setGuide("box"));

  const terminal = useFolder(gui, "Terminal", { open: true });
  useToggle(terminal, "NO_COLOR", state.terminal.NO_COLOR, (value) => dispatch({ type: "set-terminal", flag: "NO_COLOR", value }));
  useToggle(terminal, "FORCE_COLOR", state.terminal.FORCE_COLOR, (value) => dispatch({ type: "set-terminal", flag: "FORCE_COLOR", value }));
  useEffect(() => { if (terminal) controls.target === "terminal" ? terminal.show() : terminal.hide(); }, [terminal, controls.target]);

  return <>
    <Instrument3DEffectsFolder
      gui={gui} effectIds={CHARTS_3D_EFFECT_IDS} targets={CHARTS_3D_EFFECT_TARGETS} allTargetsLabel="Whole chart"
      state={{ effectId: state.effect3d.effectId, targetId: state.effect3d.targetId }}
      onChange={(patch) => dispatch({ type: "set-effect3d", patch })}
      visible={is3d}
    />
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
        <IconToggle groupTitle="Character set" options={charsetToggle} value={controls.charset} onChange={(v) => setControl({ type: "charset", value: v as GlyphChartCharset })} />
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
    {!is3d && axisColorSlot && createPortal(
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
    {is3d && x3dDomainSlot && createPortal(
      <Charts3dAxisDomainRow label="X" axis="x" override={state.chart3d.axes.x.domain} resolved={resolved3dAxes?.x} dispatch={dispatch} />,
      x3dDomainSlot,
    )}
    {is3d && y3dDomainSlot && createPortal(
      <Charts3dAxisDomainRow label="Y" axis="y" override={state.chart3d.axes.y.domain} resolved={resolved3dAxes?.y} dispatch={dispatch} />,
      y3dDomainSlot,
    )}
    {is3d && z3dDomainSlot && createPortal(
      <Charts3dAxisDomainRow label="Z" axis="z" override={state.chart3d.axes.z.domain} resolved={resolved3dAxes?.z} dispatch={dispatch} />,
      z3dDomainSlot,
    )}
    {is3d && x3dTitleAtSlot && createPortal(
      <div className="dock-toggle-row">
        <span className="dock-toggle-row-label">X title at (3D)</span>
        <IconToggle groupTitle="X axis title placement (3D)" options={CHARTS_3D_AXIS_TITLE_AT_TOGGLE} value={state.chart3d.axes.x.titleAt ?? "end"}
          onChange={(value) => dispatch({ type: "set-3d-axis", axis: "x", patch: { titleAt: value as Charts3dAxisOverride["titleAt"] } })} />
      </div>,
      x3dTitleAtSlot,
    )}
    {is3d && y3dTitleAtSlot && createPortal(
      <div className="dock-toggle-row">
        <span className="dock-toggle-row-label">Y title at (3D)</span>
        <IconToggle groupTitle="Y axis title placement (3D)" options={CHARTS_3D_AXIS_TITLE_AT_TOGGLE} value={state.chart3d.axes.y.titleAt ?? "end"}
          onChange={(value) => dispatch({ type: "set-3d-axis", axis: "y", patch: { titleAt: value as Charts3dAxisOverride["titleAt"] } })} />
      </div>,
      y3dTitleAtSlot,
    )}
    {is3d && z3dTitleAtSlot && createPortal(
      <div className="dock-toggle-row">
        <span className="dock-toggle-row-label">Z title at (3D)</span>
        <IconToggle groupTitle="Z axis title placement (3D)" options={CHARTS_3D_AXIS_TITLE_AT_TOGGLE} value={state.chart3d.axes.z.titleAt ?? "end"}
          onChange={(value) => dispatch({ type: "set-3d-axis", axis: "z", patch: { titleAt: value as Charts3dAxisOverride["titleAt"] } })} />
      </div>,
      z3dTitleAtSlot,
    )}
    {!is3d && xTitleAtSlot && createPortal(
      <div className="dock-toggle-row">
        <span className="dock-toggle-row-label">X title at</span>
        <IconToggle groupTitle="X axis title placement" options={AXIS_X_TITLE_AT_TOGGLE} value={state.style.axisTitlePlacement.x}
          onChange={(value) => dispatch({ type: "set-axis-title-at", axis: "x", value: value as ChartsWorkbenchState["style"]["axisTitlePlacement"]["x"] })} />
      </div>,
      xTitleAtSlot,
    )}
    {!is3d && yTitleAtSlot && createPortal(
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
    {styleSlot && createPortal(
      <div className="dock-toggle-row">
        <span className="dock-toggle-row-label">Style</span>
        <IconToggle groupTitle="Render style" options={CHARTS_3D_STYLE_TOGGLE} value={state.chart3d.style}
          onChange={(value) => dispatch({ type: "set-3d-view", patch: { style: value as ChartsWorkbenchState["chart3d"]["style"] } })} />
      </div>,
      styleSlot,
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
