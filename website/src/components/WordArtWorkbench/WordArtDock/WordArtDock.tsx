import type { GlyphEffectId } from "@glyphcss/effects";
import { type ReactNode, useEffect } from "react";
import { type GalleryEffectDefinition, GALLERY_EFFECT_OPTIONS } from "../../../features/gallery/model/effects";
import type { GalleryEffectParamValue, GalleryEffectState } from "../../../features/gallery/model/types";
import {
  type Bezier4,
  type GuiValues,
  type WordArtCharMode,
  type WordArtHiddenLines,
  type WordArtRenderMode,
  bezierToCss,
  CHAR_MODE_OPTIONS,
  HIDDEN_LINES_OPTIONS,
  parseBezier,
  RENDER_MODE_OPTIONS,
} from "../../../features/wordart/model/parameters";
import {
  EffectParameterControls,
  useColor,
  useDockGui,
  useEffectsFolder,
  useFolder,
  useOption,
  useSlider,
  useText,
  useToggle,
} from "../../Dock";
import { useBezierEditorSlot } from "../WordArtRailControls";
import { PROFILE_OPTS, WARP_OPTS } from "../options";

/**
 * Right-hand Dock — 3D/scene knobs only: Shape (profile/warp), Layout
 * (extrusion + mesh geometry), Camera, Lighting. Typography and Color moved
 * to the left rail (plain React, see `RailSlider`/`RailSelect`/`SegmentedRow`
 * above) — this Dock never owned them conceptually, it just inherited the
 * old floating panel's full control set during the /synth-style restyle.
 * Built with the same `useFolder`/`useSlider`/`useOption`/`useColor`/
 * `useToggle`/`useText` primitives `/synth`'s `SynthDock` uses.
 */
export function WordArtDock({
  gui,
  setGui,
  atlasReason,
  bezier,
  onBezier,
  effectState,
  effectDefinition,
  onEffectChange,
  onUpdateEffectSettings,
  onUpdateEffectParams,
}: {
  gui: GuiValues;
  setGui: (k: keyof GuiValues, v: number | string | boolean) => void;
  /** Real reason `colorEncoding: "atlas"` isn't available right now (`null`
   *  when it is) — see `../../lib/glyphAtlasAvailability.ts`. */
  atlasReason: string | null;
  bezier: Bezier4;
  onBezier: (b: Bezier4) => void;
  effectState: GalleryEffectState;
  effectDefinition: GalleryEffectDefinition | null;
  onEffectChange: (effectId: GlyphEffectId | null) => void;
  onUpdateEffectSettings: (partial: Partial<Pick<GalleryEffectState, "blend" | "paused" | "timeScale">>) => void;
  onUpdateEffectParams: (partial: Record<string, GalleryEffectParamValue>) => void;
}): ReactNode {
  const dock = useDockGui();

  // ── Shape ─────────────────────────────────────────────────────────────
  const shapeFolder = useFolder(dock, "Shape", { open: true });
  useOption(shapeFolder, "Profile", PROFILE_OPTS, gui.profileMode, (v) => setGui("profileMode", v));
  const isCustom = gui.profileMode === "custom";
  const curveTextCtrl = useText(shapeFolder, "Curve", bezierToCss(bezier), (v) => {
    const p = parseBezier(v);
    if (p) onBezier(p);
  });
  const bezierSlot = useBezierEditorSlot(shapeFolder, isCustom, bezier, onBezier);
  useOption(shapeFolder, "Warp", WARP_OPTS, gui.warp, (v) => setGui("warp", v));
  const bendCtrl = useSlider(shapeFolder, "Bend", { min: 0, max: 1, step: 0.02 }, gui.bend, (v) => setGui("bend", v));

  // ── Layout ────────────────────────────────────────────────────────────
  const layoutFolder = useFolder(dock, "Layout", { open: true });
  useSlider(layoutFolder, "Depth", { min: 2, max: 80, step: 1 }, gui.depth, (v) => setGui("depth", v));
  useSlider(layoutFolder, "Scale X", { min: 40, max: 200, step: 1 }, gui.scaleX, (v) => setGui("scaleX", v));
  useSlider(layoutFolder, "Scale Y", { min: 40, max: 200, step: 1 }, gui.scaleY, (v) => setGui("scaleY", v));
  useSlider(layoutFolder, "Curve segments", { min: 1, max: 12, step: 1 }, gui.curveSegments, (v) =>
    setGui("curveSegments", v),
  );
  useSlider(layoutFolder, "Simplify", { min: 0, max: 8, step: 0.5 }, gui.simplify, (v) => setGui("simplify", v));
  const profileSegCtrl = useSlider(
    layoutFolder,
    "Edge segments",
    { min: 2, max: 10, step: 1 },
    gui.profileSegments,
    (v) => setGui("profileSegments", v),
  );
  useSlider(layoutFolder, "Layer offset", { min: 0, max: 32, step: 1 }, gui.offset, (v) => setGui("offset", v));
  useToggle(layoutFolder, "Flat layers", gui.layered, (v) => setGui("layered", v));

  // ── Render ────────────────────────────────────────────────────────────
  // Scene-wide ASCII resolution — same range/step as /synth's "Density"
  // (SynthWorkbench.tsx's `useSlider(stage, "Density", { min: 0.5, max: 4,
  // step: 0.1 }, …)`), independent of Shape/Layout's mesh geometry knobs.
  const renderFolder = useFolder(dock, "Render", { open: true });
  useOption<WordArtRenderMode>(renderFolder, "Render mode", RENDER_MODE_OPTIONS, gui.renderMode, (v) =>
    setGui("renderMode", v),
  );
  const charModeControl = useOption<WordArtCharMode>(
    renderFolder,
    "Character mode",
    CHAR_MODE_OPTIONS,
    gui.charMode,
    (v) => setGui("charMode", v),
  );
  useEffect(() => {
    // Same gating as the gallery's Rendering folder: braille only encodes
    // wireframe mode, halfblock is the solid-mode mirror — both are a
    // documented no-op in ink, so the control dims outside wireframe/solid.
    charModeControl?.setEnabled(gui.renderMode === "wireframe" || gui.renderMode === "solid", { dim: true });
  }, [charModeControl, gui.renderMode]);
  const hiddenLinesControl = useOption<WordArtHiddenLines>(
    renderFolder,
    "Hidden lines",
    HIDDEN_LINES_OPTIONS,
    gui.hiddenLines,
    (v) => setGui("hiddenLines", v),
  );
  useEffect(() => {
    // Depth-tests wireframe strokes (ASCII or braille) against a solid
    // surface prepass. No-op in solid/ink, so dim outside wireframe.
    hiddenLinesControl?.setEnabled(gui.renderMode === "wireframe" || gui.renderMode === "ink", { dim: true });
  }, [hiddenLinesControl, gui.renderMode]);
  useSlider(renderFolder, "Density", { min: 0.5, max: 4, step: 0.1 }, gui.density, (v) => setGui("density", v));
  // `colorEncoding: "atlas"` — zero-`<span>` colour-font output. Disabled
  // (with the REAL reason from `computeGlyphAtlasAvailability`, not a
  // hand-maintained guess — see that module's doc) whenever the currently
  // rendered word art can't fit the atlas, same `setEnabled(bool, {dim:true})`
  // gating idiom `charModeControl`/`hiddenLinesControl` above use.
  const colorEncodingControl = useOption<"spans" | "atlas">(
    renderFolder,
    "Color encoding",
    { Spans: "spans", Atlas: "atlas" },
    gui.colorEncoding,
    (v) => setGui("colorEncoding", v),
    "choices",
  );
  useEffect(() => {
    if (!colorEncodingControl) return;
    colorEncodingControl.setEnabled(atlasReason === null, { dim: true });
    colorEncodingControl.raw.$name.title =
      atlasReason === null
        ? 'Color encoding — "Atlas" encodes glyph+colour as a single colour-font PUA text node (zero <span>s) instead of HTML spans, when the current render fits the atlas\'s palette/glyph budget.'
        : `Color encoding — "Atlas" isn't available right now: ${atlasReason}`;
  }, [colorEncodingControl, atlasReason]);

  // ── Effects ───────────────────────────────────────────────────────────
  // Reuses the gallery's own Effects folder hook (`useEffectsFolder` +
  // `EffectParameterControls`, imported from `../Dock/folders/useEffectsFolder`)
  // instead of rebuilding the effect picker / auto-generated param controls.
  // Called directly (rather than via the `<DockEffects>` wrapper) so its
  // folder lands between Layout and Camera by hook-call order, matching every
  // other folder in this Dock.
  const effectsFolderInputs = {
    effectState,
    definition: effectDefinition,
    effectOptions: GALLERY_EFFECT_OPTIONS,
    onEffectChange,
    onUpdateSettings: onUpdateEffectSettings,
    onUpdateParams: onUpdateEffectParams,
  };
  const effectsFolder = useEffectsFolder(dock, effectsFolderInputs);

  // ── Camera ────────────────────────────────────────────────────────────
  const cameraFolder = useFolder(dock, "Camera", { open: false });
  useToggle(cameraFolder, "Perspective", gui.perspective, (v) => setGui("perspective", v));
  useSlider(cameraFolder, "Zoom", { min: 0.1, max: 6, step: 0.05 }, gui.zoom, (v) => setGui("zoom", v));
  useToggle(cameraFolder, "Auto-spin", gui.spin, (v) => setGui("spin", v));

  // ── Lighting ──────────────────────────────────────────────────────────
  const lightingFolder = useFolder(dock, "Lighting", { open: false });
  useSlider(lightingFolder, "Light", { min: 0, max: 2, step: 0.05 }, gui.light, (v) => setGui("light", v));
  useSlider(lightingFolder, "Ambient", { min: 0, max: 1, step: 0.05 }, gui.ambient, (v) => setGui("ambient", v));
  useSlider(lightingFolder, "Angle", { min: -90, max: 90, step: 1 }, gui.az, (v) => setGui("az", v));
  useSlider(lightingFolder, "Elev.", { min: 0, max: 90, step: 1 }, gui.el, (v) => setGui("el", v));
  useColor(lightingFolder, "Light color", gui.lightColor, (v) => setGui("lightColor", v));

  // ── Conditional show/hide (mirrors the original lil-gui .show()/.hide()) ──
  useEffect(() => {
    curveTextCtrl?.setVisible(isCustom);
    bendCtrl?.setVisible(gui.warp !== "none");
    profileSegCtrl?.setVisible(gui.profileMode.startsWith("round") || isCustom);
  }, [curveTextCtrl, bendCtrl, profileSegCtrl, isCustom, gui.warp, gui.profileMode]);

  return (
    <>
      {bezierSlot}
      <EffectParameterControls folder={effectsFolder} inputs={effectsFolderInputs} />
    </>
  );
}
