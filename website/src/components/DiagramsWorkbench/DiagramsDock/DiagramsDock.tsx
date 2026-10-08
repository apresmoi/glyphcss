import { useEffect, type Dispatch } from "react";
import { createPortal } from "react-dom";
import { useDockGui, useDockSlot, useFolder, useOption, useSlider, useText, useToggle } from "../../Dock/index";
import { IconToggle } from "../../IconToggle/index";

import {
  DIAGRAMS_DENSITY_MIN,
  DIAGRAMS_DENSITY_MAX,
  DIAGRAMS_DENSITY_STEP,
  glyphDiagramsWorkbenchDensity,
  buildGlyphDiagramsWorkbenchGraph,
  diagramsWorkbenchSizeLocked,
  GLYPH_DIAGRAMS_FORMS,
  resolveGlyphDiagramsWorkbenchControls,
  type GlyphDiagramsFormId,
  type GlyphDiagramsWorkbenchAction,
  type GlyphDiagramsWorkbenchControlAction,
  type GlyphDiagramsWorkbenchState,
} from "../../../features/diagrams/model/diagramsWorkbenchState";
import { useFolderTitleReset } from "../../Dock/index";

const options = <T extends string>(values: readonly T[]): Record<T, T> =>
  Object.fromEntries(values.map((value) => [value, value])) as Record<T, T>;

// Same icon-button treatment as ChartsDock.tsx's Output folder (owner
// packet item 3, "Dock (both pages)") — target/charset/color, the fields
// the two pages genuinely share. Diagrams' own "Detail" lives in the
// Diagram folder (not Output) and stays a plain dropdown, matching
// Engine there.
const TARGET_TOGGLE = (["chat", "terminal", "web"] as const).map((v) => ({
  value: v as string,
  icon: <span className="gx-toggle-text">{v === "terminal" ? "term" : v}</span>,
  label: v,
  desc: `Render for ${v}`,
}));
const CHARSET_SYMBOL: Record<string, string> = { ascii: "#", box: "┼", blocks: "▓", braille: "⠿" };
const CHARSET_TOGGLE = (["ascii", "box", "blocks", "braille"] as const).map((value) => ({
  value,
  icon: <span className="gx-toggle-text">{CHARSET_SYMBOL[value]}</span>,
  label: value,
  desc: `Charset: ${value}`,
}));
const COLOR_SYMBOL: Record<string, string> = {
  none: "off",
  ansi16: "16",
  ansi256: "256",
  truecolor: "rgb",
  css: "css",
};
const COLOR_TOGGLE = (["none", "ansi16", "ansi256", "truecolor", "css"] as const).map((value) => ({
  value,
  icon: <span className="gx-toggle-text">{COLOR_SYMBOL[value]}</span>,
  label: value,
  desc: `Color mode: ${value}`,
}));
// The form axis (this task) — one row per `GLYPH_DIAGRAMS_FORMS` entry, so a
// future form ships by appending to that table, never by touching this
// function's own body.
const FORM_TOGGLE = GLYPH_DIAGRAMS_FORMS.map((f) => ({
  value: f.id as string,
  icon: <span className="gx-toggle-text">{f.label}</span>,
  label: f.label,
  desc: `Form: ${f.label}`,
}));

export function GlyphDiagramsDock({
  state,
  dispatch,
}: {
  state: GlyphDiagramsWorkbenchState;
  dispatch: Dispatch<GlyphDiagramsWorkbenchAction>;
}) {
  const gui = useDockGui();
  const controls = resolveGlyphDiagramsWorkbenchControls(state.controls, state.form);
  const setControl = (control: GlyphDiagramsWorkbenchControlAction) => dispatch({ type: "set-control", control });
  const output = useFolder(gui, "Output", { open: true });
  // Folder-title-bar reset (REVIEW-dock-addenda-opus.md P3-5) — the SAME
  // idiom `ChartsDock.tsx`'s Output/Chart folders use, on the folder's own
  // native title line; see `InstrumentWorkbench/useFolderTitleReset`'s own
  // doc. Supersedes the older `useDockSlot({ position: "top" })` header row
  // this page used to carry independently.
  useFolderTitleReset(output, "Reset target, charset, color, width, and height to this target's defaults", () =>
    setControl({ type: "reset" }),
  );
  const formSlot = useDockSlot(output, { position: "top", className: "dock-toggle-row-slot" });
  const targetSlot = useDockSlot(output, { position: "bottom", className: "dock-toggle-row-slot" });
  const charsetSlot = useDockSlot(output, { position: "bottom", className: "dock-toggle-row-slot" });
  const colorSlot = useDockSlot(output, { position: "bottom", className: "dock-toggle-row-slot" });
  const widthCtrl = useSlider(output, "Width", { min: 12, max: 240, step: 1 }, controls.width, (value) =>
    setControl({ type: "width", value }),
  );
  const heightCtrl = useSlider(output, "Height", { min: 6, max: 120, step: 1 }, controls.height, (value) =>
    setControl({ type: "height", value }),
  );
  const densityCtrl = useSlider(
    output,
    "Density",
    { min: DIAGRAMS_DENSITY_MIN, max: DIAGRAMS_DENSITY_MAX, step: DIAGRAMS_DENSITY_STEP },
    glyphDiagramsWorkbenchDensity(state.controls),
    (value) => setControl({ type: "density", value }),
  );
  const densityLocked = controls.target !== "web";
  useEffect(() => {
    if (!densityCtrl) return;
    densityCtrl.setEnabled(!densityLocked);
    densityCtrl.raw.domElement.title = densityLocked ? "Density changes cell size only on web." : "";
  }, [densityCtrl, densityLocked]);
  // `web` fills the measured viewport instead of a fixed logical grid
  // (AGENTS.md's "Diagrams" "Targets and page") — mirrors `ChartsDock.tsx`'s
  // own identical lock exactly (`diagramsWorkbenchSizeLocked`'s own doc).
  const sizeLocked = diagramsWorkbenchSizeLocked(controls.target);
  useEffect(() => {
    if (!widthCtrl || !heightCtrl) return;
    widthCtrl.setEnabled(!sizeLocked);
    heightCtrl.setEnabled(!sizeLocked);
    const reason = sizeLocked ? "Web fills the viewport." : "";
    widthCtrl.raw.domElement.title = reason;
    heightCtrl.raw.domElement.title = reason;
  }, [widthCtrl, heightCtrl, sizeLocked]);

  let direction = state.layout.direction ?? "TB";
  try {
    direction = buildGlyphDiagramsWorkbenchGraph(state).direction;
  } catch {
    /* Draft syntax must not disable the controls needed to repair it. */
  }
  const layout = useFolder(gui, "Layout", { open: true });
  useOption(
    layout,
    "Direction",
    options(["Auto", "TB", "LR", "BT", "RL"] as const),
    state.layout.autoDirection ? "Auto" : direction,
    (value) =>
      dispatch({
        type: "set-layout",
        patch: value === "Auto" ? { autoDirection: true } : { direction: value, autoDirection: false },
      }),
    "choices",
  );
  useOption(layout, "Engine", options(["dagre"] as const), state.layout.engine, (engine) =>
    dispatch({ type: "set-layout", patch: { engine } }),
  );
  useSlider(layout, "nodesep", { min: 3, max: 24, step: 1 }, state.layout.nodesep, (nodesep) =>
    dispatch({ type: "set-layout", patch: { nodesep } }),
  );
  useSlider(layout, "ranksep", { min: 3, max: 24, step: 1 }, state.layout.ranksep, (ranksep) =>
    dispatch({ type: "set-layout", patch: { ranksep } }),
  );
  // Only graph diagrams use the layout engine and its spacing controls.
  useEffect(() => {
    if (layout) state.form === "graph" ? layout.show() : layout.hide();
  }, [layout, state.form]);

  const diagram = useFolder(gui, "Diagram", { open: true });
  useText(diagram, "Title", state.diagram.title, (title) => dispatch({ type: "set-diagram", patch: { title } }));
  const detailCtrl = useOption(
    diagram,
    "Detail",
    options(["auto", "faithful", "balanced", "simplified"] as const),
    state.diagram.detail,
    (detail) => dispatch({ type: "set-diagram", patch: { detail } }),
  );
  // `Detail` is the 2D graph compaction ladder's own control — meaningless
  // for the sequence pipeline (its own degrade ladder, `packages/diagrams/AGENTS.md`'s
  // "Degrade" bullet, takes no `detail` option at all). `Title` above stays
  // visible for both forms (both pipelines read it), so only this ONE row
  // hides, not the whole folder — `website/AGENTS.md`'s "locked/unavailable
  // control" granularity.
  useEffect(() => {
    if (detailCtrl) detailCtrl.setVisible(state.form === "graph");
  }, [detailCtrl, state.form]);
  const terminal = useFolder(gui, "Terminal", { open: true });
  useToggle(terminal, "NO_COLOR", state.terminal.NO_COLOR, (value) =>
    dispatch({ type: "set-terminal", flag: "NO_COLOR", value }),
  );
  useToggle(terminal, "FORCE_COLOR", state.terminal.FORCE_COLOR, (value) =>
    dispatch({ type: "set-terminal", flag: "FORCE_COLOR", value }),
  );
  useEffect(() => {
    if (terminal) controls.target === "terminal" ? terminal.show() : terminal.hide();
  }, [terminal, controls.target]);

  return (
    <>
      {formSlot &&
        createPortal(
          <div className="dock-toggle-row">
            <span className="dock-toggle-row-label">Form</span>
            <IconToggle
              groupTitle="Diagram form"
              options={FORM_TOGGLE}
              value={state.form}
              onChange={(v) => dispatch({ type: "set-form", form: v as GlyphDiagramsFormId })}
            />
          </div>,
          formSlot,
        )}
      {targetSlot &&
        createPortal(
          <div className="dock-toggle-row">
            <span className="dock-toggle-row-label">Target</span>
            <IconToggle
              groupTitle="Output target"
              options={TARGET_TOGGLE}
              value={controls.target}
              onChange={(v) => setControl({ type: "target", value: v as typeof controls.target })}
            />
          </div>,
          targetSlot,
        )}
      {charsetSlot &&
        createPortal(
          <div className="dock-toggle-row">
            <span className="dock-toggle-row-label">Charset</span>
            <IconToggle
              groupTitle="Character set"
              options={CHARSET_TOGGLE}
              value={controls.charset}
              onChange={(v) => setControl({ type: "charset", value: v as typeof controls.charset })}
            />
          </div>,
          charsetSlot,
        )}
      {colorSlot &&
        createPortal(
          <div className="dock-toggle-row">
            <span className="dock-toggle-row-label">Color</span>
            <IconToggle
              groupTitle="Color mode — independent of target"
              options={COLOR_TOGGLE}
              value={controls.color}
              onChange={(v) => setControl({ type: "color", value: v as typeof controls.color })}
            />
          </div>,
          colorSlot,
        )}
    </>
  );
}
