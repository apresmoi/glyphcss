/**
 * Rendering folder — render mode, feature-edge threshold, glyph palette,
 * line-height multiplier, and colors toggle.
 */
import type { GUI } from "lil-gui";
import type { SceneOptionsState } from "../../GalleryWorkbench/types";
import { useEffect } from "react";
import { useFolder, useOption, useSlider, useToggle } from "../primitives";
import { CALIBRATED_PALETTE_NAME, ensureCalibratedPalette } from "../../GalleryWorkbench/calibratedPalette";

// Registered once, at module load — before this folder's "Calibrated" option
// is ever selectable, and before any route can preselect it.
ensureCalibratedPalette();

export type GalleryRenderPresentation = SceneOptionsState["renderMode"] | "semantic";

export interface RenderingFolderInputs {
  /** Gallery-only presentation state. `semantic` still renders core solid mode. */
  renderMode: GalleryRenderPresentation;
  semanticAvailable: boolean;
  featureEdges: number;
  glyphPalette: SceneOptionsState["glyphPalette"];
  charMode: SceneOptionsState["charMode"];
  wireframeJunctions: boolean;
  hiddenLines: SceneOptionsState["hiddenLines"];
  solidWeightRamp: boolean;
  density: number;
  dragDensity: number;
  useColors: boolean;
  smoothShading: boolean;
  creaseAngle: number;
  onRenderModeChange: (mode: GalleryRenderPresentation) => void;
  onUpdateScene: (partial: Partial<Pick<SceneOptionsState, "featureEdges" | "glyphPalette" | "charMode" | "wireframeJunctions" | "hiddenLines" | "solidWeightRamp" | "density" | "dragDensity" | "useColors" | "smoothShading" | "creaseAngle">>) => void;
}


const RENDER_MODE_OPTIONS: Record<string, GalleryRenderPresentation> = {
  Wireframe: "wireframe",
  Solid: "solid",
  Ink: "ink",
  Semantic: "semantic",
};
type GlyphPaletteId = SceneOptionsState["glyphPalette"];
const GLYPH_PALETTE_OPTIONS: Record<string, GlyphPaletteId> = {
  Default: "default",
  ASCII: "ascii",
  Lines: "lines",
  Blocks: "blocks",
  Stars: "stars",
  Arrows: "arrows",
  Math: "math",
  Binary: "binary",
  Hex: "hex",
  // Font-calibrated: measures real ink coverage per glyph in the gallery's
  // font (`@glyphcss/effects`' `calibrateGlyphRamp`) instead of an authored
  // guess — perceptually linear for THAT font, not eyeballed.
  Calibrated: CALIBRATED_PALETTE_NAME as GlyphPaletteId,
};
const CHAR_MODE_OPTIONS: Record<string, SceneOptionsState["charMode"]> = {
  ASCII: "ascii",
  Braille: "braille",
  Halfblock: "halfblock",
  Quadrant: "quadrant",
};
const HIDDEN_LINES_OPTIONS: Record<string, SceneOptionsState["hiddenLines"]> = {
  Show: "show",
  Hide: "hide",
};

export function useRenderingFolder(parent: GUI | null, inputs: RenderingFolderInputs): GUI | null {
  const { renderMode, semanticAvailable, featureEdges, glyphPalette, charMode, wireframeJunctions, hiddenLines, solidWeightRamp, density, dragDensity, useColors, smoothShading, creaseAngle, onRenderModeChange, onUpdateScene } = inputs;
  const folder = useFolder(parent, "Rendering", { open: true });

  const renderModeControl = useOption<GalleryRenderPresentation>(folder, "Render mode", RENDER_MODE_OPTIONS, renderMode, onRenderModeChange);
  useEffect(() => {
    const semanticOption = Array.from(renderModeControl?.raw.domElement.querySelectorAll<HTMLOptionElement>("option") ?? [])
      .find((option) => option.textContent === "Semantic");
    if (semanticOption) semanticOption.disabled = !semanticAvailable;
  }, [renderModeControl, semanticAvailable]);
  useEffect(() => {
    const select = renderModeControl?.raw.domElement.querySelector<HTMLSelectElement>("select");
    if (!select) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "End" && semanticAvailable) {
        event.preventDefault();
        onRenderModeChange("semantic");
      }
    };
    select.addEventListener("keydown", onKeyDown);
    return () => select.removeEventListener("keydown", onKeyDown);
  }, [onRenderModeChange, renderModeControl, semanticAvailable]);
  useSlider(folder, "Feature edges °", { min: 0, max: 90, step: 1 }, featureEdges, (value) =>
    onUpdateScene({ featureEdges: value }),
  );
  useOption<GlyphPaletteId>(folder, "Glyph palette", GLYPH_PALETTE_OPTIONS, glyphPalette as GlyphPaletteId, (value) =>
    onUpdateScene({ glyphPalette: value }),
  );
  const charModeControl = useOption<SceneOptionsState["charMode"]>(
    folder,
    "Character mode",
    CHAR_MODE_OPTIONS,
    charMode,
    (value) => onUpdateScene({ charMode: value }),
  );
  useEffect(() => {
    // Braille only encodes wireframe mode; halfblock and quadrant are the
    // solid-mode mirrors (2x/4x subcell resolution via block glyphs, coarser
    // shape than a ramp glyph). None of the three do anything in ink/semantic
    // presentation, so the control is enabled for wireframe OR solid and
    // dimmed otherwise — whichever option doesn't apply to the active render
    // mode is simply a documented no-op once selected (same as before).
    charModeControl?.setEnabled(renderMode === "wireframe" || renderMode === "solid", { dim: true });
  }, [charModeControl, renderMode]);
  const junctionsControl = useToggle(folder, "Box junctions (wireframe)", wireframeJunctions, (value) =>
    onUpdateScene({ wireframeJunctions: value }),
  );
  useEffect(() => {
    // The junction resolve pass is an ASCII-path refinement — dim it outside
    // wireframe mode and while braille (its own corner/join encoding) is active.
    junctionsControl?.setEnabled(renderMode === "wireframe" && charMode !== "braille", { dim: true });
  }, [junctionsControl, renderMode, charMode]);
  const hiddenLinesControl = useOption<SceneOptionsState["hiddenLines"]>(
    folder,
    "Hidden lines",
    HIDDEN_LINES_OPTIONS,
    hiddenLines,
    (value) => onUpdateScene({ hiddenLines: value }),
  );
  useEffect(() => {
    // Depth-tests outline strokes against a solid surface prepass, in both
    // wireframe (ASCII or braille) and ink. `"show"` is the x-ray/blueprint
    // look — every contour drawn, nothing occludes; `"hide"` is the opaque
    // illustration look. No-op in solid, which is already depth-buffered per
    // cell, so dim there.
    hiddenLinesControl?.setEnabled(renderMode === "wireframe" || renderMode === "ink", { dim: true });
  }, [hiddenLinesControl, renderMode]);
  const weightRampControl = useToggle(folder, "Weighted shading", solidWeightRamp, (value) =>
    onUpdateScene({ solidWeightRamp: value }),
  );
  useEffect(() => {
    // Solid-mode-only second density axis (font-weight-calibrated ramp). Also
    // a no-op under charMode "halfblock"/"quadrant" — both two-color-per-cell
    // encodings have no font-weight span either — so dim there too, same
    // treatment `charMode`'s own no-op combinations get above.
    weightRampControl?.setEnabled(
      renderMode === "solid" && charMode !== "halfblock" && charMode !== "quadrant",
      { dim: true },
    );
  }, [weightRampControl, renderMode, charMode]);
  useToggle(folder, "Colors", useColors, (value) =>
    onUpdateScene({ useColors: value }),
  );
  useToggle(folder, "Smooth shading", smoothShading, (value) =>
    onUpdateScene({ smoothShading: value }),
  );
  useSlider(folder, "Crease angle °", { min: 0, max: 180, step: 1 }, creaseAngle, (value) =>
    onUpdateScene({ creaseAngle: value }),
  );
  useSlider(folder, "Density ×", { min: 0.5, max: 4, step: 0.1 }, density, (value) =>
    onUpdateScene({ density: value }),
  );
  useSlider(folder, "Drag density ×", { min: 0.5, max: 1, step: 0.05 }, dragDensity, (value) =>
    onUpdateScene({ dragDensity: value }),
  );
  return folder;
}
