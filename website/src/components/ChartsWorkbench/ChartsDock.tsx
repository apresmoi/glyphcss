import { useEffect, type Dispatch } from "react";
import { createPortal } from "react-dom";
import type { GlyphChartCharset, GlyphChartColorMode, GlyphChartDetail, GlyphChartTarget } from "@glyphcss/charts";
import { useDockSlot, useFolder, useOption, useReadonlyText, useSlider, useText, useToggle } from "../Dock/primitives";
import { useDockGui } from "../Dock/slots";
import { IconToggle } from "../SynthWorkbench/synthKit";
import {
  CHART_CHARSETS, CHART_COLORS, CHART_DETAILS, CHART_LEGEND_PLACEMENTS, CHART_SCALE_TYPES, CHART_TARGETS,
  CHART_TITLE_ALIGNS, CHART_TITLE_POSITIONS,
  resolveGlyphChartsWorkbenchControls, type ChartsWorkbenchAction, type ChartsWorkbenchState,
  type GlyphChartsWorkbenchControlAction,
} from "./chartsWorkbenchState";

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

export function ChartsDock({ state, dispatch }: { state: ChartsWorkbenchState; dispatch: Dispatch<ChartsWorkbenchAction> }) {
  const gui = useDockGui();
  const controls = resolveGlyphChartsWorkbenchControls(state.controls);
  const setControl = (control: GlyphChartsWorkbenchControlAction) => dispatch({ type: "set-control", control });
  const output = useFolder(gui, "Output", { open: true });
  // Folder-header reset (owner packet item 3: "reset to target defaults
  // could be something in the OUTPUT ======== [reset] folder header") —
  // requested FIRST (`useDockSlot`'s own doc: a "top" slot must land before
  // any sibling `use*` call to end up above them) so it renders as the
  // folder's first row, standing in for lil-gui's own non-extensible title
  // bar. Replaces the old standalone "Reset to target defaults" button.
  const outputHeaderSlot = useDockSlot(output, { position: "top", className: "dock-folder-header-slot" });
  const targetSlot = useDockSlot(output, { position: "bottom", className: "dock-toggle-row-slot" });
  const charsetSlot = useDockSlot(output, { position: "bottom", className: "dock-toggle-row-slot" });
  const colorSlot = useDockSlot(output, { position: "bottom", className: "dock-toggle-row-slot" });
  useSlider(output, "Width", { min: 12, max: 240, step: 1 }, controls.width, (value) => setControl({ type: "width", value }));
  useSlider(output, "Height", { min: 6, max: 120, step: 1 }, controls.height, (value) => setControl({ type: "height", value }));
  const detailSlot = useDockSlot(output, { position: "bottom", className: "dock-toggle-row-slot" });

  const chart = useFolder(gui, "Chart", { open: true });
  useText(chart, "Title", state.chart.title, (title) => dispatch({ type: "set-chart", patch: { title } }));
  const titlePlacementSlot = useDockSlot(chart, { position: "bottom", className: "dock-toggle-row-slot" });
  useText(chart, "Description", state.chart.description, (description) => dispatch({ type: "set-chart", patch: { description } }));
  useToggle(chart, "Legend", state.chart.legend, (legend) => dispatch({ type: "set-chart", patch: { legend } }));
  const legendPlacementSlot = useDockSlot(chart, { position: "bottom", className: "dock-toggle-row-slot" });

  const scales = useFolder(gui, "Scales", { open: true });
  useOption(scales, "X type", options(CHART_SCALE_TYPES), state.scales.x.type, (type) => dispatch({ type: "set-scale", axis: "x", patch: { type } }));
  useText(scales, "X min", state.scales.x.min, (min) => dispatch({ type: "set-scale", axis: "x", patch: { min } }));
  useText(scales, "X max", state.scales.x.max, (max) => dispatch({ type: "set-scale", axis: "x", patch: { max } }));
  useOption(scales, "Y type", options(CHART_SCALE_TYPES), state.scales.y.type, (type) => dispatch({ type: "set-scale", axis: "y", patch: { type } }));
  useText(scales, "Y min", state.scales.y.min, (min) => dispatch({ type: "set-scale", axis: "y", patch: { min } }));
  useText(scales, "Y max", state.scales.y.max, (max) => dispatch({ type: "set-scale", axis: "y", patch: { max } }));
  useReadonlyText(scales, "Domain", "Blank = inferred");

  const axes = useFolder(gui, "Axes", { open: false });
  useSlider(axes, "X ticks (0 = auto)", { min: 0, max: 12, step: 1 }, state.axes.x.ticks, (ticks) => dispatch({ type: "set-axis", axis: "x", patch: { ticks } }));
  useToggle(axes, "X tick marks", state.axes.x.tickMarks, (tickMarks) => dispatch({ type: "set-axis", axis: "x", patch: { tickMarks } }));
  useToggle(axes, "X grid", state.axes.x.grid, (grid) => dispatch({ type: "set-axis", axis: "x", patch: { grid } }));
  useText(axes, "X title", state.axes.x.title, (title) => dispatch({ type: "set-axis", axis: "x", patch: { title } }));
  useSlider(axes, "Y ticks (0 = auto)", { min: 0, max: 12, step: 1 }, state.axes.y.ticks, (ticks) => dispatch({ type: "set-axis", axis: "y", patch: { ticks } }));
  useToggle(axes, "Y tick marks", state.axes.y.tickMarks, (tickMarks) => dispatch({ type: "set-axis", axis: "y", patch: { tickMarks } }));
  useToggle(axes, "Y grid", state.axes.y.grid, (grid) => dispatch({ type: "set-axis", axis: "y", patch: { grid } }));
  useText(axes, "Y title", state.axes.y.title, (title) => dispatch({ type: "set-axis", axis: "y", patch: { title } }));

  const terminal = useFolder(gui, "Terminal", { open: true });
  useToggle(terminal, "NO_COLOR", state.terminal.NO_COLOR, (value) => dispatch({ type: "set-terminal", flag: "NO_COLOR", value }));
  useToggle(terminal, "FORCE_COLOR", state.terminal.FORCE_COLOR, (value) => dispatch({ type: "set-terminal", flag: "FORCE_COLOR", value }));
  useEffect(() => { if (terminal) controls.target === "terminal" ? terminal.show() : terminal.hide(); }, [terminal, controls.target]);

  return <>
    {outputHeaderSlot && createPortal(
      <div className="dock-folder-header">
        <span>OUTPUT</span>
        <span className="dock-folder-header-rule" />
        <button type="button" className="dock-folder-header-reset" title="Reset target, charset, color, width, height, and detail to this target's defaults" onClick={() => dispatch({ type: "reset-target" })}>reset</button>
      </div>,
      outputHeaderSlot,
    )}
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
  </>;
}
