import { useEffect, useMemo, type Dispatch } from "react";
import { createPortal } from "react-dom";
import { useDockSlot, useFolder, useOption, useSlider, useText, useToggle } from "../Dock/primitives";
import { useDockGui } from "../Dock/slots";
import { IconToggle } from "../SynthWorkbench/synthKit";
import { useFolderTitleReset } from "../InstrumentWorkbench/useFolderTitleReset";
import { Instrument3DEffectsFolder } from "../InstrumentWorkbench/Instrument3DEffectsFolder";
import { buildGlyphDiagramsWorkbenchGraph, glyphDiagramsWorkbenchEffectTargets, resolveGlyphDiagramsWorkbenchControls, type GlyphDiagramsWorkbenchAction, type GlyphDiagramsWorkbenchControlAction, type GlyphDiagramsWorkbenchState } from "./diagramsWorkbenchState";

// Fix round 1, P1-2 — the small, curated set that "reads well" mesh-targeted
// on a node box (per the coordinator's own list): a bare highlight sweep,
// a corruption glitch, and a radiating ripple. `getGlyphEffect` (`Diagrams3DViewport.tsx`)
// resolves each id against `@glyphcss/effects`' own `GlyphEffects` catalog.
const DIAGRAMS_3D_EFFECT_IDS = ["none", "scan", "glitch", "ripple"] as const;

const options = <T extends string,>(values: readonly T[]): Record<T, T> => Object.fromEntries(values.map((value) => [value, value])) as Record<T, T>;

// Same icon-button treatment as ChartsDock.tsx's Output folder (owner
// packet item 3, "Dock (both pages)") — target/charset/color, the fields
// the two pages genuinely share. Diagrams' own "Detail" lives in the
// Diagram folder (not Output) and stays a plain dropdown, matching
// direction/engine there.
const TARGET_TOGGLE = (["chat", "terminal", "web"] as const).map((v) => ({ value: v as string, icon: <span className="gx-toggle-text">{v === "terminal" ? "term" : v}</span>, label: v, desc: `Render for ${v}` }));
const CHARSET_SYMBOL: Record<string, string> = { ascii: "#", box: "┼", blocks: "▓", braille: "⠿" };
/**
 * `blocks`/`braille` in 3D are FAITHFUL DOWNGRADES, not defects (packet
 * D3, `render3d.ts`'s own `resolveCharset`: `braille` -> wireframe,
 * `blocks` -> solid ASCII), so this dims the reason rather than hiding the
 * option — the reader can still pick it, and the target x charset x colour
 * matrix stays every cell reachable, per AGENTS.md's "Targets and page".
 */
function charsetToggleOptions(view: "2d" | "3d") {
  return (["ascii", "box", "blocks", "braille"] as const).map((v) => ({
    value: v as string, icon: <span className="gx-toggle-text">{CHARSET_SYMBOL[v]}</span>, label: v,
    desc: view === "3d" && v === "braille" ? "Braille draws wireframe outlines only in 3D, not solid surfaces" : view === "3d" && v === "blocks" ? "Blocks renders as solid ASCII in 3D (its sub-cell shading can't carry stamped edges/labels)" : `Charset: ${v}`,
  }));
}
const COLOR_SYMBOL: Record<string, string> = { none: "off", ansi16: "16", ansi256: "256", truecolor: "rgb", css: "css" };
const COLOR_TOGGLE = (["none", "ansi16", "ansi256", "truecolor", "css"] as const).map((v) => ({ value: v as string, icon: <span className="gx-toggle-text">{COLOR_SYMBOL[v]}</span>, label: v, desc: `Color mode: ${v}` }));
// Packet D3 — the 2D/3D view switch, right beside Output so it reads as
// scene-wide (AGENTS.md's D3 row). Web-only fields (turntable/trackball
// live geometry) dim in every other view/target combination via
// `disabled`/`disabledReason`, the `mapDirectionLocked` idiom.
const VIEW_TOGGLE = (["2d", "3d"] as const).map((v) => ({ value: v as string, icon: <span className="gx-toggle-text">{v}</span>, label: v, desc: `View: ${v}` }));

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
  const viewSlot = useDockSlot(output, { position: "top", className: "dock-toggle-row-slot" });
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
  useEffect(() => { if (diagram) state.view === "2d" ? diagram.show() : diagram.hide(); }, [diagram, state.view]);
  const terminal = useFolder(gui, "Terminal", { open: true });
  useToggle(terminal, "NO_COLOR", state.terminal.NO_COLOR, (value) => dispatch({ type: "set-terminal", flag: "NO_COLOR", value }));
  useToggle(terminal, "FORCE_COLOR", state.terminal.FORCE_COLOR, (value) => dispatch({ type: "set-terminal", flag: "FORCE_COLOR", value }));
  useEffect(() => { if (terminal) controls.target === "terminal" ? terminal.show() : terminal.hide(); }, [terminal, controls.target]);

  // Packet D3 — layout/zBy/seed/rotation. Diagram's `Detail` (compaction
  // ladder) is a 2D-only concept (the budget it manages doesn't apply to a
  // 3D scene, AGENTS.md's "Diagrams 3D": "the 2D ladder... does not apply
  // in 3D"), so it hides above rather than growing a 3D exception; this
  // folder is the 3D-only counterpart and hides in 2D the same way.
  const view3d = useFolder(gui, "3D", { open: true });
  useOption(view3d, "Layout", options(["layered", "force"] as const), state.view3d.layout, (layout) => dispatch({ type: "set-view3d", patch: { layout } }));
  useOption(view3d, "Z by", options(["group", "kind", "rank", "none"] as const), state.view3d.zBy, (zBy) => dispatch({ type: "set-view3d", patch: { zBy } }));
  useSlider(view3d, "Seed", { min: 1, max: 9999, step: 1 }, state.view3d.seed, (seed) => dispatch({ type: "set-view3d", patch: { seed } }));
  useOption(view3d, "Rotation", options(["turntable", "trackball"] as const), state.view3d.controlsMode, (controlsMode) => dispatch({ type: "set-view3d", patch: { controlsMode } }));
  useEffect(() => { if (view3d) state.view === "3d" ? view3d.show() : view3d.hide(); }, [view3d, state.view]);

  // Fix round 1, P1-2 — the shared Effects folder. Targets are the
  // CURRENT graph's own nodes; a draft with a syntax error keeps the last
  // resolvable target list rather than emptying the dropdown mid-edit
  // (same "don't disable the controls needed to repair it" rule the
  // Layout folder's `direction` read already follows, two lines above).
  const graphNodes = useMemo(() => {
    try { return buildGlyphDiagramsWorkbenchGraph(state).nodes; }
    catch { return []; }
  }, [state]);
  const effectTargets = useMemo(() => glyphDiagramsWorkbenchEffectTargets(graphNodes), [graphNodes]);

  return <>
    <Instrument3DEffectsFolder
      gui={gui} effectIds={DIAGRAMS_3D_EFFECT_IDS} targets={effectTargets} allTargetsLabel="All nodes"
      state={{ effectId: state.effect3d.effectId, targetId: state.effect3d.targetId }}
      onChange={(patch) => dispatch({ type: "set-effect3d", patch })}
      visible={state.view === "3d"}
    />
    {viewSlot && createPortal(
      <div className="dock-toggle-row">
        <span className="dock-toggle-row-label">View</span>
        <IconToggle groupTitle="Diagram dimension" options={VIEW_TOGGLE} value={state.view} onChange={(v) => dispatch({ type: "set-view", view: v as "2d" | "3d" })} />
      </div>,
      viewSlot,
    )}
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
        <IconToggle groupTitle="Character set" options={charsetToggleOptions(state.view)} value={controls.charset} onChange={(v) => setControl({ type: "charset", value: v as typeof controls.charset })} />
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
