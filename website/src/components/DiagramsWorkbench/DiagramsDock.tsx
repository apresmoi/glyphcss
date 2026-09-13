import { useEffect, type Dispatch } from "react";
import { createPortal } from "react-dom";
import { useDockSlot, useFolder, useOption, useSlider, useText, useToggle } from "../Dock/primitives";
import { useDockGui } from "../Dock/slots";
import { IconToggle } from "../SynthWorkbench/synthKit";
import { useFolderTitleReset } from "../InstrumentWorkbench/useFolderTitleReset";
import { buildGlyphDiagramsWorkbenchGraph, resolveGlyphDiagramsWorkbenchControls, type GlyphDiagramsWorkbenchAction, type GlyphDiagramsWorkbenchControlAction, type GlyphDiagramsWorkbenchState } from "./diagramsWorkbenchState";

const options = <T extends string,>(values: readonly T[]): Record<T, T> => Object.fromEntries(values.map((value) => [value, value])) as Record<T, T>;

// Same icon-button treatment as ChartsDock.tsx's Output folder (owner
// packet item 3, "Dock (both pages)") — target/charset/color, the fields
// the two pages genuinely share. Diagrams' own "Detail" lives in the
// Diagram folder (not Output) and stays a plain dropdown, matching
// direction/engine there.
const TARGET_TOGGLE = (["chat", "terminal", "web"] as const).map((v) => ({ value: v as string, icon: <span className="gx-toggle-text">{v === "terminal" ? "term" : v}</span>, label: v, desc: `Render for ${v}` }));
const CHARSET_SYMBOL: Record<string, string> = { ascii: "#", box: "┼", blocks: "▓", braille: "⠿" };
const CHARSET_TOGGLE = (["ascii", "box", "blocks", "braille"] as const).map((v) => ({ value: v as string, icon: <span className="gx-toggle-text">{CHARSET_SYMBOL[v]}</span>, label: v, desc: `Charset: ${v}` }));
const COLOR_SYMBOL: Record<string, string> = { none: "off", ansi16: "16", ansi256: "256", truecolor: "rgb", css: "css" };
const COLOR_TOGGLE = (["none", "ansi16", "ansi256", "truecolor", "css"] as const).map((v) => ({ value: v as string, icon: <span className="gx-toggle-text">{COLOR_SYMBOL[v]}</span>, label: v, desc: `Color mode: ${v}` }));

export function GlyphDiagramsDock({ state, dispatch }: { state: GlyphDiagramsWorkbenchState; dispatch: Dispatch<GlyphDiagramsWorkbenchAction> }) {
  const gui = useDockGui();
  const controls = resolveGlyphDiagramsWorkbenchControls(state.controls);
  const setControl = (control: GlyphDiagramsWorkbenchControlAction) => dispatch({ type: "set-control", control });
  const output = useFolder(gui, "Output", { open: true });
  // Folder-title-bar reset (REVIEW-dock-addenda-opus.md P3-5) — the SAME
  // idiom `ChartsDock.tsx`'s Output/Chart folders use, on the folder's own
  // native title line; see `InstrumentWorkbench/useFolderTitleReset`'s own
  // doc. Supersedes the older `useDockSlot({ position: "top" })` header row
  // this page used to carry independently.
  useFolderTitleReset(output, "Reset target, charset, color, width, and height to this target's defaults", () => setControl({ type: "reset" }));
  const targetSlot = useDockSlot(output, { position: "bottom", className: "dock-toggle-row-slot" });
  const charsetSlot = useDockSlot(output, { position: "bottom", className: "dock-toggle-row-slot" });
  const colorSlot = useDockSlot(output, { position: "bottom", className: "dock-toggle-row-slot" });
  useSlider(output, "Width", { min: 12, max: 240, step: 1 }, controls.width, (value) => setControl({ type: "width", value }));
  useSlider(output, "Height", { min: 6, max: 120, step: 1 }, controls.height, (value) => setControl({ type: "height", value }));

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

  return <>
    {targetSlot && createPortal(
      <div className="dock-toggle-row">
        <span className="dock-toggle-row-label">Target</span>
        <IconToggle groupTitle="Output target" options={TARGET_TOGGLE} value={controls.target} onChange={(v) => setControl({ type: "target", value: v as typeof controls.target })} />
      </div>,
      targetSlot,
    )}
    {charsetSlot && createPortal(
      <div className="dock-toggle-row">
        <span className="dock-toggle-row-label">Charset</span>
        <IconToggle groupTitle="Character set" options={CHARSET_TOGGLE} value={controls.charset} onChange={(v) => setControl({ type: "charset", value: v as typeof controls.charset })} />
      </div>,
      charsetSlot,
    )}
    {colorSlot && createPortal(
      <div className="dock-toggle-row">
        <span className="dock-toggle-row-label">Color</span>
        <IconToggle groupTitle="Color mode — independent of target" options={COLOR_TOGGLE} value={controls.color} onChange={(v) => setControl({ type: "color", value: v as typeof controls.color })} />
      </div>,
      colorSlot,
    )}
  </>;
}
