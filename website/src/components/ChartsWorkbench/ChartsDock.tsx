import { useEffect, useMemo, useRef, type Dispatch } from "react";
import { createPortal } from "react-dom";
import type { GUI } from "lil-gui";
import type { GlyphChartCharset, GlyphChartColorMode, GlyphChartDetail, GlyphChartTarget } from "@glyphcss/charts";
import { useDockSlot, useFolder, useOption, useSlider, useText, useToggle } from "../Dock/primitives";
import { useDockGui } from "../Dock/slots";
import { IconToggle } from "../SynthWorkbench/synthKit";
import { RangeSlider } from "../InstrumentWorkbench/RangeSlider";
import { ColorSwatch } from "../InstrumentWorkbench/ColorSwatch";
import {
  CHART_AXIS_COLOR_MODES, CHART_CHARSETS, CHART_COLORS, CHART_DETAILS, CHART_LEGEND_PLACEMENTS, CHART_SCALE_TYPES, CHART_TARGETS,
  CHART_TITLE_ALIGNS, CHART_TITLE_POSITIONS, CHART_X_AXIS_TITLE_ATS,
  chartsNumberToScaleBound, chartsScaleBoundToNumber, chartsScaleSliderBounds, chartsTimeBoundDisplay, chartsTimeBoundFromDisplay,
  chartsWorkbenchHasZeroAnchoredMark, chartsWorkbenchInferredDomains,
  resolveGlyphChartsWorkbenchControls, type ChartsWorkbenchAction, type ChartsWorkbenchAxisDomain, type ChartsWorkbenchScale, type ChartsWorkbenchState,
  type GlyphChartsWorkbenchControlAction,
} from "./chartsWorkbenchState";
import { chartsWorkbenchActualTicks, type ChartsWorkbenchRender } from "./chartsWorkbenchRender";

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

// Axis title placement (Dock item "Axis Title + Title at") — same icon-
// toggle idiom as the chart's own Title-at row above; `x`'s vocabulary
// (start/center/end) mirrors `TITLE_ALIGN_TOGGLE`'s symbols, `y`'s
// (top/bottom) mirrors `TITLE_POSITION_TOGGLE`'s.
const AXIS_X_TITLE_AT_SYMBOL: Record<string, string> = { start: "⇤", center: "⇔", end: "⇥" };
const AXIS_X_TITLE_AT_TOGGLE = CHART_X_AXIS_TITLE_ATS.map((v) => ({ value: v as string, icon: <span className="gx-toggle-text">{AXIS_X_TITLE_AT_SYMBOL[v]}</span>, label: v, desc: `X title placement: ${v}` }));
const AXIS_Y_TITLE_AT_TOGGLE = CHART_TITLE_POSITIONS.map((v) => ({ value: v as string, icon: <span className="gx-toggle-text">{v === "top" ? "⇧" : "⇩"}</span>, label: v, desc: `Y title placement: ${v}` }));

// Ticks row (owner packet item 1) — replaces the old flat "0 = auto"
// slider with one row combining an [x]/[ ] auto checkbox and a plain
// single-thumb slider, both custom (not real lil-gui controllers, since
// lil-gui has no built-in checkbox+slider combo row) but built from the
// SAME classes `RangeSlider.tsx`/`gallery-workbench.css` already give a
// lil-gui-indistinguishable look: `controller number hasSlider` for the
// outer row (name label + widget padding/colours), `range-slider-track`/
// `-fill`/`-range`/`-number` for the slider itself — never the plain
// `.slider`/`.fill`/`input[type=number]` classes real lil-gui's own
// NumberController uses, which `RangeSlider.tsx`'s own doc explains draw a
// SECOND, conflicting set of "[ ]" bracket pseudo-elements.
const CHART_TICKS_MIN = 2;
const CHART_TICKS_MAX = 40;
function TicksRow({ axis, ticks, actualTicks, dispatch }: {
  axis: "x" | "y";
  ticks: number;
  actualTicks: number | undefined;
  dispatch: Dispatch<ChartsWorkbenchAction>;
}) {
  const AXIS = axis.toUpperCase();
  const auto = ticks === 0;
  // Unchecking auto seeds the slider from the axis's own last-rendered
  // tick count (`chartsWorkbenchActualTicks`'s own doc) rather than
  // reusing whatever number happened to sit on the disabled slider.
  const seed = actualTicks ?? 6;
  const shown = auto ? seed : ticks;
  const setTicks = (value: number) => dispatch({ type: "set-axis", axis, patch: { ticks: Math.max(CHART_TICKS_MIN, Math.min(CHART_TICKS_MAX, Math.round(value))) } });
  const pct = ((Math.min(CHART_TICKS_MAX, Math.max(CHART_TICKS_MIN, shown)) - CHART_TICKS_MIN) / (CHART_TICKS_MAX - CHART_TICKS_MIN)) * 100;
  return <div className="controller number hasSlider charts-ticks-row">
    <div className="name">{AXIS} ticks</div>
    <div className={`widget charts-ticks-row-widget${auto ? " is-disabled" : ""}`}>
      <input type="checkbox" className="charts-ticks-auto" checked={auto}
        aria-label={`${AXIS} ticks: auto`}
        onChange={(e) => dispatch({ type: "set-axis", axis, patch: { ticks: e.target.checked ? 0 : seed } })} />
      <div className="slider range-slider-track charts-ticks-row-track">
        <div className="fill range-slider-fill" style={{ left: 0, width: `${pct}%` }} />
        <input type="range" className="range-slider-range" min={CHART_TICKS_MIN} max={CHART_TICKS_MAX} step={1} disabled={auto}
          value={shown} aria-label={`${AXIS} ticks value`} aria-valuetext={String(shown)}
          onChange={(e) => setTicks(Number(e.target.value))} />
      </div>
      <input className="range-slider-number" inputMode="decimal" disabled={auto}
        aria-label={`${AXIS} ticks number`} value={shown}
        onChange={(e) => { const n = Number(e.target.value); if (Number.isFinite(n)) setTicks(n); }} />
    </div>
  </div>;
}

/**
 * Folder-title-bar reset (owner packet item 3): "OUTPUT ═══════ [reset]"
 * lives on the folder's OWN native title line — its "═══" rule is the same
 * `.title::after` pseudo-element every nested Dock folder already draws
 * (`gallery-workbench.css`) — rather than a separate row inside the
 * folder body. lil-gui's `.title` is a native `<button>`, so the
 * `[reset]` control is mounted as a plain DOM SIBLING appended directly to
 * the folder's own root element (`folder.domElement`); `.charts-folder-
 * reset` (`charts-workbench.css`) gives that element `position: relative`
 * and reserves room in `.title`'s own padding for the overlaid button. The
 * button paints on top of the (non-positioned) title row by ordinary CSS
 * stacking order, so only its own small rect intercepts a click — the
 * rest of the row still toggles the folder open/closed; `stopPropagation`
 * on its own click is a defensive belt-and-braces (it's a SIBLING of
 * `.title`, never a descendant, so a click on it was never going to reach
 * `.title`'s own listener regardless). Replaces the old `useDockSlot({
 * position: "top" })` header row.
 */
function useFolderTitleReset(folder: GUI | null, title: string, onReset: () => void): void {
  const onResetRef = useRef(onReset);
  onResetRef.current = onReset;
  useEffect(() => {
    if (!folder) return;
    folder.domElement.classList.add("charts-folder-reset");
    const button = document.createElement("button");
    button.type = "button";
    button.className = "charts-folder-reset-button";
    button.textContent = "reset";
    button.title = title;
    const onClick = (e: MouseEvent) => { e.stopPropagation(); onResetRef.current(); };
    button.addEventListener("click", onClick);
    folder.domElement.appendChild(button);
    return () => {
      button.removeEventListener("click", onClick);
      button.remove();
      folder.domElement.classList.remove("charts-folder-reset");
    };
  }, [folder, title]);
}

/**
 * Dual-handle domain control (packet item 3) for one axis's Scales row —
 * a `RangeSlider` over the data extent for a numeric/time scale, or the
 * ORIGINAL plain min/max text pair for `band` (a category name isn't a
 * slider position) or when inference failed entirely (bad mark JSON —
 * `inferred` is `undefined`). `scale.min`/`.max` stay the same strings
 * `buildScale` already reads; this control only translates them to and
 * from the slider's numeric domain.
 *
 * Slider BOUNDS come from `chartsScaleSliderBounds` (P1: never a flat pad
 * that can hand a bar/area/rect y-domain or a log domain an illegal
 * position — REVIEW-dock-colours-sliders-opus.md), widened past their own
 * padded range to include any already-typed override (P2-1: the two
 * number fields may exceed the visible bounds, and the slider re-derives
 * around them on the next render). `inferred.disabledReason` (a log scale
 * whose real data can't produce a legal domain) renders the slider
 * `disabled` with that reason instead of falling back to the plain text
 * pair, showing the LINEAR reading of the same data rather than a
 * fabricated placeholder.
 */
function ScaleDomainControl({ axis, scale, inferred, zeroAnchored, dispatch }: {
  axis: "x" | "y";
  scale: ChartsWorkbenchScale;
  inferred: ChartsWorkbenchAxisDomain | undefined;
  zeroAnchored: boolean;
  dispatch: Dispatch<ChartsWorkbenchAction>;
}) {
  const resolvedType = scale.type === "auto" ? inferred?.type : scale.type;
  if (!inferred || resolvedType === "band" || resolvedType === "ordinal" || resolvedType === undefined || inferred.domain.length < 2) {
    const AXIS = axis.toUpperCase();
    return <>
      <label className="voice-row charts-mark-row"><span>{AXIS} min</span>
        <input className="charts-pipeline-input" aria-label={`${AXIS} scale minimum`} value={scale.min} onChange={(e) => dispatch({ type: "set-scale", axis, patch: { min: e.target.value } })} /></label>
      <label className="voice-row charts-mark-row"><span>{AXIS} max</span>
        <input className="charts-pipeline-input" aria-label={`${AXIS} scale maximum`} value={scale.max} onChange={(e) => dispatch({ type: "set-scale", axis, patch: { max: e.target.value } })} /></label>
    </>;
  }
  const type = resolvedType as "linear" | "log" | "sqrt" | "time";
  const disabled = inferred.disabledReason !== undefined;
  const toNumber = (v: number | string | Date) => v instanceof Date ? v.getTime() : Number(v);
  const domainMin = toNumber(inferred.domain[0]!);
  const domainMax = toNumber(inferred.domain.at(-1)!);
  // A `disabledReason` reading is already the LINEAR fallback (the axis's
  // own declared log type failed) — zero-anchoring is a claim about the
  // REAL scale that would render, which this one, by construction, never
  // will.
  const bounds = chartsScaleSliderBounds(disabled ? "linear" : type, domainMin, domainMax, !disabled && zeroAnchored);
  const explicitLo = scale.min.trim() ? chartsScaleBoundToNumber(type, scale.min) : null;
  const explicitHi = scale.max.trim() ? chartsScaleBoundToNumber(type, scale.max) : null;
  const min = explicitLo !== null ? Math.min(bounds.min, explicitLo) : bounds.min;
  const max = explicitHi !== null ? Math.max(bounds.max, explicitHi) : bounds.max;
  const value: readonly [number | null, number | null] | null = scale.min.trim() || scale.max.trim() ? [explicitLo, explicitHi] : null;
  const format = (n: number) => type === "time" ? chartsTimeBoundDisplay(n) : String(Math.round(n * 1000) / 1000);
  const parse = (raw: string) => type === "time" ? chartsTimeBoundFromDisplay(raw) : (Number.isFinite(Number(raw)) ? Number(raw) : null);
  // NEW-1/NEW-4 (REVIEW-dock-colours-sliders-opus-round2.md): a TYPED value
  // that would need `loFloor`/`loCeiling`/`hiFloor` to clamp it is refused
  // outright, with this reason shown inline, rather than silently
  // substituted — the log rule (`bounds.loFloor`, this axis's own sign/
  // zero-exclusion cap) and the zero-anchored rule (`bounds.loCeiling`/
  // `hiFloor`) are the only two ways this control ever caps a thumb, so one
  // reason string per axis covers both (they're mutually exclusive — see
  // `chartsScaleSliderBounds`).
  const capReason = !disabled && type === "log" ? "A log domain must have one sign and exclude zero."
    : !disabled && zeroAnchored ? "A bar, area, or rect chart's Y domain must include zero."
    : undefined;
  return <RangeSlider label={`${axis.toUpperCase()} domain`} min={min} max={max} domain={[domainMin, domainMax]}
    loFloor={bounds.loFloor} loCeiling={bounds.loCeiling} hiFloor={bounds.hiFloor} capReason={capReason}
    disabled={disabled} disabledReason={inferred.disabledReason}
    value={value} format={format} parse={parse}
    onChange={(next) => dispatch({
      type: "set-scale", axis,
      patch: next === null ? { min: "", max: "" } : {
        min: next[0] === null ? "" : chartsNumberToScaleBound(type, next[0]),
        max: next[1] === null ? "" : chartsNumberToScaleBound(type, next[1]),
      },
    })} />;
}

export function ChartsDock({ state, dispatch, rendered }: { state: ChartsWorkbenchState; dispatch: Dispatch<ChartsWorkbenchAction>; rendered?: ChartsWorkbenchRender }) {
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
  const actualXTicks = rendered?.ok ? chartsWorkbenchActualTicks(rendered.report.ledger, "x") : undefined;
  const actualYTicks = rendered?.ok ? chartsWorkbenchActualTicks(rendered.report.ledger, "y") : undefined;
  const output = useFolder(gui, "Output", { open: true });
  // Folder-title-bar reset (owner packet item 3) — "OUTPUT ═══════ [reset]"
  // on the folder's own native title line; see `useFolderTitleReset`'s own
  // doc above. Replaces the old `useDockSlot({ position: "top" })` header
  // row.
  useFolderTitleReset(output, "Reset target, charset, color, width, height, and detail to this target's defaults", () => dispatch({ type: "reset-target" }));
  const targetSlot = useDockSlot(output, { position: "bottom", className: "dock-toggle-row-slot" });
  const charsetSlot = useDockSlot(output, { position: "bottom", className: "dock-toggle-row-slot" });
  const colorSlot = useDockSlot(output, { position: "bottom", className: "dock-toggle-row-slot" });
  useSlider(output, "Width", { min: 12, max: 240, step: 1 }, controls.width, (value) => setControl({ type: "width", value }));
  useSlider(output, "Height", { min: 6, max: 120, step: 1 }, controls.height, (value) => setControl({ type: "height", value }));
  const detailSlot = useDockSlot(output, { position: "bottom", className: "dock-toggle-row-slot" });

  // Dataset selection now lives in the left rail (AGENTS.md's "Charts" —
  // "Data layer" — it is this page's own "model", exactly as synth's rail
  // is the voice/model picker): `ChartsWorkbench.tsx` renders
  // `ChartsDataFolder` directly in the rail body, so this Dock carries no
  // Data folder at all.
  const chart = useFolder(gui, "Chart", { open: true });
  // Folder-title-bar reset (P2-6, REVIEW-dock-colours-sliders-opus.md;
  // owner packet item 3) — the Output folder's own reset is scoped to
  // output settings only (target/charset/color/width/height/detail) and
  // never touches a hand-picked axis/mark colour, a typed scale domain, or
  // an axis title placement, all of which live in THIS folder (and Scales,
  // below it) — this is their own reset, same title-bar idiom.
  useFolderTitleReset(chart, "Reset axis colour, mark colours, and typed scale domains to their defaults", () => dispatch({ type: "reset-chart-style" }));
  useText(chart, "Title", state.chart.title, (title) => dispatch({ type: "set-chart", patch: { title } }));
  const titlePlacementSlot = useDockSlot(chart, { position: "bottom", className: "dock-toggle-row-slot" });
  useText(chart, "Description", state.chart.description, (description) => dispatch({ type: "set-chart", patch: { description } }));
  useToggle(chart, "Legend", state.chart.legend, (legend) => dispatch({ type: "set-chart", patch: { legend } }));
  const legendPlacementSlot = useDockSlot(chart, { position: "bottom", className: "dock-toggle-row-slot" });
  // Axis colour (packet item 1) — a Chart-folder row, not the Axes folder's
  // own tick/grid rows below: the colour is a CHART-wide style choice
  // (`applyChartStyle`, `chartsWorkbenchRender.ts`), and lives beside
  // legend/title placement rather than the per-axis tick machinery.
  const axisColorSlot = useDockSlot(chart, { position: "bottom", className: "charts-axis-color-slot" });

  const scales = useFolder(gui, "Scales", { open: true });
  useOption(scales, "X type", options(CHART_SCALE_TYPES), state.scales.x.type, (type) => dispatch({ type: "set-scale", axis: "x", patch: { type } }));
  const xDomainSlot = useDockSlot(scales, { position: "bottom", className: "charts-scale-domain-slot" });
  useOption(scales, "Y type", options(CHART_SCALE_TYPES), state.scales.y.type, (type) => dispatch({ type: "set-scale", axis: "y", patch: { type } }));
  const yDomainSlot = useDockSlot(scales, { position: "bottom", className: "charts-scale-domain-slot" });
  // Recomputed off the raw mark data (never the current min/max override —
  // see `chartsWorkbenchInferredDomains`'s own doc), so a `RangeSlider`'s
  // own draggable bounds don't shrink every time a reader narrows the
  // selection. Each axis degrades to the original plain min/max text
  // inputs (`ScaleDomainControl` below) independently — a failing Y no
  // longer takes X's own, otherwise-valid, control down with it. No
  // separate "Blank = inferred" readout: the `RangeSlider`'s own `auto`
  // toggle IS that state now, and the two number fields are never blank.
  const inferredDomains = useMemo(() => chartsWorkbenchInferredDomains(state), [state]);
  const zeroAnchoredY = useMemo(() => chartsWorkbenchHasZeroAnchoredMark(state), [state]);

  const axes = useFolder(gui, "Axes", { open: false });
  const xTicksSlot = useDockSlot(axes, { position: "bottom", className: "charts-ticks-row-slot" });
  useToggle(axes, "X tick marks", state.axes.x.tickMarks, (tickMarks) => dispatch({ type: "set-axis", axis: "x", patch: { tickMarks } }));
  useToggle(axes, "X grid", state.axes.x.grid, (grid) => dispatch({ type: "set-axis", axis: "x", patch: { grid } }));
  useText(axes, "X title", state.axes.x.title, (title) => dispatch({ type: "set-axis", axis: "x", patch: { title } }));
  // Axis title placement (Dock item "Axis Title + Title at") — the same
  // pair (text + placement toggle) the chart's own title row has, added
  // right after each axis's existing Title text field.
  const xTitleAtSlot = useDockSlot(axes, { position: "bottom", className: "dock-toggle-row-slot" });
  const yTicksSlot = useDockSlot(axes, { position: "bottom", className: "charts-ticks-row-slot" });
  useToggle(axes, "Y tick marks", state.axes.y.tickMarks, (tickMarks) => dispatch({ type: "set-axis", axis: "y", patch: { tickMarks } }));
  useToggle(axes, "Y grid", state.axes.y.grid, (grid) => dispatch({ type: "set-axis", axis: "y", patch: { grid } }));
  useText(axes, "Y title", state.axes.y.title, (title) => dispatch({ type: "set-axis", axis: "y", patch: { title } }));
  const yTitleAtSlot = useDockSlot(axes, { position: "bottom", className: "dock-toggle-row-slot" });

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
      <ScaleDomainControl axis="x" scale={state.scales.x} inferred={inferredDomains.x} zeroAnchored={false} dispatch={dispatch} />,
      xDomainSlot,
    )}
    {yDomainSlot && createPortal(
      <ScaleDomainControl axis="y" scale={state.scales.y} inferred={inferredDomains.y} zeroAnchored={zeroAnchoredY} dispatch={dispatch} />,
      yDomainSlot,
    )}
    {xTicksSlot && createPortal(<TicksRow axis="x" ticks={state.axes.x.ticks} actualTicks={actualXTicks} dispatch={dispatch} />, xTicksSlot)}
    {yTicksSlot && createPortal(<TicksRow axis="y" ticks={state.axes.y.ticks} actualTicks={actualYTicks} dispatch={dispatch} />, yTicksSlot)}
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
  </>;
}
