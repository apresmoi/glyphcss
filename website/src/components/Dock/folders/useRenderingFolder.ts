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
  /** Real reason the currently selected `charMode` isn't doing anything
   *  right now (`null`/omitted when it is) — see `/maps`'s
   *  `../../../lib/glyphMapCharModeAvailability.ts`. Optional: a caller that
   *  doesn't pass it (gallery, synth, wordart) keeps the pre-existing
   *  render-mode-only gating below unchanged. */
  charModeReason?: string | null;
  /** The "Character mode" dropdown's own option list. Defaults to every
   *  charMode the library supports (`CHAR_MODE_OPTIONS` below) — every
   *  existing caller (gallery, synth, wordart) keeps that full list. `/maps`
   *  passes a trimmed list with Braille removed: with Terrain pinned to
   *  `solid` and no scene-wide render mode, Braille (wireframe-only — it
   *  encodes binary sub-cell coverage and can't carry solid mode's shading
   *  ramp) can never do anything on that page, so it's dropped from the
   *  picker entirely rather than shown disabled (`charModeReason` already
   *  covers the OTHER, live-condition no-ops). */
  charModeOptions?: Record<string, SceneOptionsState["charMode"]>;
  wireframeJunctions: boolean;
  hiddenLines: SceneOptionsState["hiddenLines"];
  solidWeightRamp: boolean;
  colorEncoding: SceneOptionsState["colorEncoding"];
  /** Real reason `colorEncoding: "atlas"` isn't available right now (`null`
   *  when it is) — see `../../../lib/glyphAtlasAvailability.ts`. */
  atlasReason: string | null;
  density: number;
  dragDensity: number;
  useColors: boolean;
  smoothShading: boolean;
  creaseAngle: number;
  /** Show the "Density ×" row. Default `true` — every existing caller
   *  (gallery, this folder's own tests) keeps a scene-wide density slider.
   *  `MapsWorkbench` passes `false`: maps expose density per-layer instead
   *  (the left-rail Terrain/Borders/Contour cards), so a second, scene-wide
   *  "Density" control in the right Dock would be a confusing duplicate of
   *  a concept that page already surfaces elsewhere. "Drag density" stays
   *  visible regardless — it governs interaction PERFORMANCE (how coarse
   *  the render gets while actively dragging), a concern that exists
   *  independent of any per-layer resolution. */
  showDensity?: boolean;
  /**
   * Show the "Render mode" row. Default `true` — every existing caller
   *  (gallery, this folder's own tests) keeps a scene-wide render-mode
   *  dropdown. `MapsWorkbench` passes `false`: a map is not one picture in
   *  one mode — terrain is `solid` while a border or contour overlay is
   *  `ink` — so mode belongs to the LAYER (the left-rail cards' own "mode"
   *  row, wired to `@glyphcss/maps`' `GlyphMapLayer.renderMode`), and a
   *  scene-wide dropdown in this Dock could only fight it.
   */
  showRenderMode?: boolean;
  /**
   * Show the "Glyph palette" row. Default `true` — every existing caller
   *  (gallery, this folder's own tests) keeps a scene-wide glyph-palette
   *  dropdown. `MapsWorkbench` passes `false`: a map is not one picture in
   *  one character ramp — the ramp belongs to the LAYER
   *  (`GlyphMapLayer.glyphPalette` in `@glyphcss/maps`), and a scene-wide
   *  dropdown here could only fight it.
   */
  showGlyphPalette?: boolean;
  /**
   * Show the "Feature edges °" row. Default `true`. `MapsWorkbench` passes
   *  `false`: `featureEdges` is a mesh-BUILD-time wireframe threshold for
   *  re-deriving edges from raw triangle soup (`trianglesToFeatureEdges`,
   *  packages/core), and `glyphMapPolygons` already emits well-defined
   *  quads — the control had nothing to apply to there and was never
   *  forwarded to the map's scene at all.
   */
  showFeatureEdges?: boolean;
  /**
   * Show the "Crease angle °" row. Default `true`. `MapsWorkbench` passes
   *  `false`: it is the threshold `smoothShading` uses, and a relief mesh
   *  has no authored hard creases to protect, so the map keeps the library
   *  default (60°) and exposes only the on/off toggle.
   */
  showCreaseAngle?: boolean;
  onRenderModeChange: (mode: GalleryRenderPresentation) => void;
  onUpdateScene: (partial: Partial<Pick<SceneOptionsState, "featureEdges" | "glyphPalette" | "charMode" | "wireframeJunctions" | "hiddenLines" | "solidWeightRamp" | "colorEncoding" | "density" | "dragDensity" | "useColors" | "smoothShading" | "creaseAngle">>) => void;
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
const COLOR_ENCODING_OPTIONS: Record<string, SceneOptionsState["colorEncoding"]> = {
  Spans: "spans",
  Atlas: "atlas",
};

export function useRenderingFolder(parent: GUI | null, inputs: RenderingFolderInputs): GUI | null {
  const { renderMode, semanticAvailable, featureEdges, glyphPalette, charMode, charModeReason = null, charModeOptions = CHAR_MODE_OPTIONS, wireframeJunctions, hiddenLines, solidWeightRamp, colorEncoding, atlasReason, density, dragDensity, showDensity = true, showRenderMode = true, showGlyphPalette = true, showFeatureEdges = true, showCreaseAngle = true, useColors, smoothShading, creaseAngle, onRenderModeChange, onUpdateScene } = inputs;
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
  useEffect(() => {
    renderModeControl?.setVisible(showRenderMode);
  }, [renderModeControl, showRenderMode]);
  const featureEdgesControl = useSlider(folder, "Feature edges °", { min: 0, max: 90, step: 1 }, featureEdges, (value) =>
    onUpdateScene({ featureEdges: value }),
  );
  useEffect(() => {
    featureEdgesControl?.setVisible(showFeatureEdges);
  }, [featureEdgesControl, showFeatureEdges]);
  const glyphPaletteControl = useOption<GlyphPaletteId>(folder, "Glyph palette", GLYPH_PALETTE_OPTIONS, glyphPalette as GlyphPaletteId, (value) =>
    onUpdateScene({ glyphPalette: value }),
  );
  useEffect(() => {
    glyphPaletteControl?.setVisible(showGlyphPalette);
  }, [glyphPaletteControl, showGlyphPalette]);
  const charModeControl = useOption<SceneOptionsState["charMode"]>(
    folder,
    "Character mode",
    charModeOptions,
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
    //
    // `charModeReason` (optional — only `/maps` passes it, same
    // `computeGlyph*Availability` -> `setEnabled`/`title` idiom
    // `colorEncodingControl` below already uses for the atlas control) is a
    // SECOND, independent reason the current selection can be a no-op even
    // while the mode-level check above passes — e.g. `/maps` pins the scene
    // to `solid` yet braille is still permanently unavailable there, or
    // halfblock/quadrant stop applying the instant a stroke layer starts
    // owning the scene's one `transformCells` hook. A caller that never
    // passes it (gallery, synth, wordart) gets `null` here and this effect
    // is byte-identical to before.
    if (!charModeControl) return;
    const modeApplies = renderMode === "wireframe" || renderMode === "solid";
    charModeControl.setEnabled(modeApplies && charModeReason === null, { dim: true });
    charModeControl.raw.$name.title = charModeReason !== null
      ? `Character mode — "${charMode}" isn't doing anything right now: ${charModeReason}`
      : "";
  }, [charModeControl, renderMode, charMode, charModeReason]);
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
  // `colorEncoding: "atlas"` — zero-`<span>` colour-font output. Disabled
  // (with the REAL reason from `computeGlyphAtlasAvailability`, not a
  // hand-maintained guess — see that module's doc) whenever the currently
  // rendered scene can't fit the atlas, same `setEnabled(bool, {dim:true})`
  // gating idiom every other conditionally-available row above uses.
  // `raw.$name.title` sets the native tooltip — same mechanism `/synth` and
  // `/wordart` use; lil-gui's `DockController` has no built-in tooltip prop.
  const colorEncodingControl = useOption<SceneOptionsState["colorEncoding"]>(
    folder, "Color encoding", COLOR_ENCODING_OPTIONS, colorEncoding, (value) => onUpdateScene({ colorEncoding: value }),
  );
  useEffect(() => {
    if (!colorEncodingControl) return;
    colorEncodingControl.setEnabled(atlasReason === null, { dim: true });
    colorEncodingControl.raw.$name.title = atlasReason === null
      ? "Color encoding — \"Atlas\" encodes glyph+colour as a single colour-font PUA text node (zero <span>s) instead of HTML spans, when the current render fits the atlas's palette/glyph budget."
      : `Color encoding — "Atlas" isn't available right now: ${atlasReason}`;
  }, [colorEncodingControl, atlasReason]);
  useToggle(folder, "Colors", useColors, (value) =>
    onUpdateScene({ useColors: value }),
  );
  useToggle(folder, "Smooth shading", smoothShading, (value) =>
    onUpdateScene({ smoothShading: value }),
  );
  const creaseAngleControl = useSlider(folder, "Crease angle °", { min: 0, max: 180, step: 1 }, creaseAngle, (value) =>
    onUpdateScene({ creaseAngle: value }),
  );
  useEffect(() => {
    creaseAngleControl?.setVisible(showCreaseAngle);
  }, [creaseAngleControl, showCreaseAngle]);
  // Both sliders already read the SAME direction as each other — 1 is the
  // baseline in both, higher is sharper — "Drag density" is just density's
  // own value expressed as a fraction of it (`dragDensityToDownscale`,
  // `../../GlyphScene/GlyphScene.tsx`) rather than an independent range:
  // it structurally cannot exceed 1 (dragging can only match or coarsen the
  // base density, never sharpen past it), which is why its slider tops out
  // at 1 while Density's own goes to 4×. Unifying the two sliders' numeric
  // range/step would change this exact control on every OTHER page that
  // shares this folder (gallery) — instead the tooltips below spell out the
  // relationship so the pair reads as coherent without touching that shared
  // range.
  const densityControl = useSlider(folder, "Density ×", { min: 0.5, max: 4, step: 0.1 }, density, (value) =>
    onUpdateScene({ density: value }),
  );
  useEffect(() => {
    if (!densityControl) return;
    densityControl.raw.$name.title = "Density — the scene's base render resolution, as a multiplier of the default cell size. 1× is the default; higher is sharper (more cells, more render cost).";
  }, [densityControl]);
  useEffect(() => {
    densityControl?.setVisible(showDensity);
  }, [densityControl, showDensity]);
  const dragDensityControl = useSlider(folder, "Drag density ×", { min: 0.5, max: 1, step: 0.05 }, dragDensity, (value) =>
    onUpdateScene({ dragDensity: value }),
  );
  useEffect(() => {
    if (!dragDensityControl) return;
    dragDensityControl.raw.$name.title = "Drag density — resolution used WHILE actively dragging, as a fraction of Density. 1× keeps full Density during a drag (no reduction); lower renders coarser while dragging and restores full detail on release. Always ≤ Density — dragging can only match or coarsen the base resolution, never sharpen past it.";
  }, [dragDensityControl]);
  return folder;
}
