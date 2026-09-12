import { useEffect, type Dispatch } from "react";
import { useButton, useFolder, useOption, useSlider, useText, useToggle } from "../Dock/primitives";
import { useDockGui } from "../Dock/slots";
import { buildGlyphDiagramsWorkbenchGraph, resolveGlyphDiagramsWorkbenchControls, type GlyphDiagramsWorkbenchAction, type GlyphDiagramsWorkbenchControlAction, type GlyphDiagramsWorkbenchState } from "./diagramsWorkbenchState";

const options = <T extends string,>(values: readonly T[]): Record<T, T> => Object.fromEntries(values.map((value) => [value, value])) as Record<T, T>;

export function GlyphDiagramsDock({ state, dispatch }: { state: GlyphDiagramsWorkbenchState; dispatch: Dispatch<GlyphDiagramsWorkbenchAction> }) {
  const gui = useDockGui();
  const controls = resolveGlyphDiagramsWorkbenchControls(state.controls);
  const setControl = (control: GlyphDiagramsWorkbenchControlAction) => dispatch({ type: "set-control", control });
  const output = useFolder(gui, "Output", { open: true });
  useOption(output, "Target", options(["chat", "terminal", "web"] as const), controls.target, (value) => setControl({ type: "target", value }));
  useOption(output, "Charset", options(["ascii", "box", "blocks", "braille"] as const), controls.charset, (value) => setControl({ type: "charset", value }));
  useOption(output, "Color", options(["none", "ansi16", "ansi256", "truecolor", "css"] as const), controls.color, (value) => setControl({ type: "color", value }));
  useSlider(output, "Width", { min: 12, max: 240, step: 1 }, controls.width, (value) => setControl({ type: "width", value }));
  useSlider(output, "Height", { min: 6, max: 120, step: 1 }, controls.height, (value) => setControl({ type: "height", value }));
  useButton(output, "Reset to target defaults", () => setControl({ type: "reset" }));

  let direction = state.layout.direction ?? "TB";
  try { direction = buildGlyphDiagramsWorkbenchGraph(state).direction; } catch { /* Draft syntax must not disable the controls needed to repair it. */ }
  const layout = useFolder(gui, "Layout", { open: true });
  useOption(layout, "Direction", options(["TB", "LR", "BT", "RL"] as const), direction, (value) => dispatch({ type: "set-layout", patch: { direction: value } }));
  useOption(layout, "Engine", options(["dagre"] as const), state.layout.engine, (engine) => dispatch({ type: "set-layout", patch: { engine } }));
  useSlider(layout, "nodesep", { min: 3, max: 24, step: 1 }, state.layout.nodesep, (nodesep) => dispatch({ type: "set-layout", patch: { nodesep } }));
  useSlider(layout, "ranksep", { min: 3, max: 24, step: 1 }, state.layout.ranksep, (ranksep) => dispatch({ type: "set-layout", patch: { ranksep } }));

  const diagram = useFolder(gui, "Diagram", { open: true });
  useText(diagram, "Title", state.diagram.title, (title) => dispatch({ type: "set-diagram", patch: { title } }));
  useOption(diagram, "Detail", options(["auto", "faithful", "balanced", "simplified"] as const), state.diagram.detail, (detail) => dispatch({ type: "set-diagram", patch: { detail } }));
  const terminal = useFolder(gui, "Terminal", { open: true });
  useToggle(terminal, "NO_COLOR", state.terminal.NO_COLOR, (value) => dispatch({ type: "set-terminal", flag: "NO_COLOR", value }));
  useToggle(terminal, "FORCE_COLOR", state.terminal.FORCE_COLOR, (value) => dispatch({ type: "set-terminal", flag: "FORCE_COLOR", value }));
  useEffect(() => { if (terminal) controls.target === "terminal" ? terminal.show() : terminal.hide(); }, [terminal, controls.target]);
  return null;
}
