import { useEffect, type Dispatch } from "react";
import { useButton, useFolder, useOption, useReadonlyText, useSlider, useText, useToggle } from "../Dock/primitives";
import { useDockGui } from "../Dock/slots";
import {
  CHART_CHARSETS, CHART_COLORS, CHART_DETAILS, CHART_SCALE_TYPES, CHART_TARGETS,
  resolveGlyphChartsWorkbenchControls, type ChartsWorkbenchAction, type ChartsWorkbenchState,
  type GlyphChartsWorkbenchControlAction,
} from "./chartsWorkbenchState";

const options = <T extends string,>(values: readonly T[]): Record<T, T> => Object.fromEntries(values.map((value) => [value, value])) as Record<T, T>;

export function ChartsDock({ state, dispatch }: { state: ChartsWorkbenchState; dispatch: Dispatch<ChartsWorkbenchAction> }) {
  const gui = useDockGui();
  const controls = resolveGlyphChartsWorkbenchControls(state.controls);
  const setControl = (control: GlyphChartsWorkbenchControlAction) => dispatch({ type: "set-control", control });
  const output = useFolder(gui, "Output", { open: true });
  useOption(output, "Target", options(CHART_TARGETS), controls.target, (value) => setControl({ type: "target", value }));
  useOption(output, "Charset", options(CHART_CHARSETS), controls.charset, (value) => setControl({ type: "charset", value }));
  // Colour modes are independent overrides in the API, including across targets.
  useOption(output, "Color", options(CHART_COLORS), controls.color, (value) => setControl({ type: "color", value }));
  useSlider(output, "Width", { min: 12, max: 240, step: 1 }, controls.width, (value) => setControl({ type: "width", value }));
  useSlider(output, "Height", { min: 6, max: 120, step: 1 }, controls.height, (value) => setControl({ type: "height", value }));
  useOption(output, "Detail", options(CHART_DETAILS), controls.detail ?? "auto", (value) => setControl({ type: "detail", value }));
  useButton(output, "Reset to target defaults", () => dispatch({ type: "reset-target" }));

  const chart = useFolder(gui, "Chart", { open: true });
  useText(chart, "Title", state.chart.title, (title) => dispatch({ type: "set-chart", patch: { title } }));
  useText(chart, "Description", state.chart.description, (description) => dispatch({ type: "set-chart", patch: { description } }));

  useToggle(chart, "Legend", state.chart.legend, (legend) => dispatch({ type: "set-chart", patch: { legend } }));

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
  return null;
}
