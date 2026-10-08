import { GlyphRamps } from "@glyphcss/effects";
import { type ReactNode, useCallback, useEffect, useMemo, useRef } from "react";
import { createPortal } from "react-dom";
import { isFlat } from "../../../features/synth/model/geometry";
import {
  CALIBRATED_RAMP_NAME,
  COMBINE_OPTS,
  MARCH_STEPS_MAX,
  matchRamp,
  type Params,
  type ParamValue,
  RAMP_OPTS,
  RENDER_OPTS,
  resolveColorStackVisibility,
  resolveInkControlVisibility,
  resolveRenderChange,
  resolveSpaceChange,
  SCALE_MAX,
  SCALE_MIN,
  SHAPE_OPTS,
  SPACE_OPTS,
} from "../../../features/synth/model/parameters";
import { type Lighting } from "../../../features/synth/model/urlState";
import { useCustomRampCoverage, useRampCalibration } from "../../../hooks/useRampCalibration";
import { useColor, useDockGui, useDockSlot, useFolder, useOption, useSlider, useText, useToggle } from "../../Dock";
import { IconToggle } from "../../IconToggle";
import { LogSliderRow } from "../../LogSliderRow";
import { SynthScope } from "../../SynthScope";
import { SUBCELL_TOGGLE } from "../../VoiceCard";
import { RampDensityRow } from "../RampDensityRow";

// ── Right dock controls (stage / mix / output) ────────────────────────────────
export function SynthDock({
  shape,
  onShape,
  timeScale,
  onTimeScale,
  paused,
  onPaused,
  orbitAuto,
  onOrbitAuto,
  orbitSpeed,
  onOrbitSpeed,
  density,
  onDensity,
  colorTolerance,
  onColorTolerance,
  colorEncoding,
  onColorEncoding,
  atlasReason,
  lighting,
  onLight,
  params,
  onParam,
  paramsRef,
  tsRef,
  pausedRef,
  hostRef,
}: {
  shape: string;
  onShape: (s: string) => void;
  timeScale: number;
  onTimeScale: (n: number) => void;
  paused: boolean;
  onPaused: (b: boolean) => void;
  /** Camera auto-orbit (user request) — independent of `paused`/`timeScale`,
   *  which drive the MESH's own spin; this drifts the CAMERA. */
  orbitAuto: boolean;
  onOrbitAuto: (b: boolean) => void;
  orbitSpeed: number;
  onOrbitSpeed: (n: number) => void;
  density: number;
  onDensity: (n: number) => void;
  /** Run-extension colour-merge tolerance (COLOR-TOLERANCE.md Phase 4) — a
   *  SCENE option, not a field-synth param, so it's a sibling of `density`
   *  here rather than living in `params`/`onParam`. */
  colorTolerance: number;
  onColorTolerance: (n: number) => void;
  /** `colorEncoding: "atlas"` (zero-`<span>` colour-font output) toggle.
   *  `atlasReason` is `null` when available; otherwise the real reason it
   *  isn't — see `../../lib/glyphAtlasAvailability.ts` — surfaced as the
   *  disabled control's tooltip. */
  colorEncoding: "spans" | "atlas";
  onColorEncoding: (v: "spans" | "atlas") => void;
  atlasReason: string | null;
  lighting: Lighting;
  onLight: (partial: Partial<Lighting>) => void;
  params: Params;
  onParam: (key: string, value: ParamValue) => void;
  paramsRef: { current: Params };
  tsRef: { current: number };
  pausedRef: { current: boolean };
  hostRef: { current: HTMLElement | null };
}): ReactNode {
  const gui = useDockGui();
  const s = (k: string) => String(params[k] ?? "");
  const n = (k: string) => Number(params[k] ?? 0);
  // At "2x4" subcell resolution, field-synth emits a synthesized Braille dot
  // mask and never reads the `glyphs` ramp at all (the ramp branch is the
  // `1x1`-only else in fieldSynth's evaluate()) — Ramp/Chars/the density row
  // are dimmed and the reason is spelled out below, and `gain`/`bias`
  // (Contrast/Brightness) instead become the per-dot threshold cutoff.
  const subcellIs2x4 = s("subcellRes") === "2x4";
  // Ink synthesizes contour strokes for the same reason: it reads the field's
  // shape, never the ramp. Both modes therefore dim Ramp/Chars.
  const subcellIsInk = s("subcellRes") === "ink";
  const ramplessSubcell = subcellIs2x4 || subcellIsInk;
  // Single source of truth for "is this patch volumetric" — the Mapping
  // dropdown (the sole `space` control, VOLUMETRIC-2.md §4) and the
  // Volume folder below both read this same derived flag, so neither can
  // desync from `params.space`.
  const volumetric = s("space") === "object";
  // The one guard the Mapping dropdown routes every `space` write through
  // (see `resolveSpaceChange`'s doc above).
  const applySpace = useCallback(
    (nextSpace: string) => {
      const change = resolveSpaceChange(nextSpace);
      if (change.shape) onShape(change.shape);
      if (change.render) onParam("render", change.render);
      onParam("space", nextSpace);
    },
    [onShape, onParam],
  );

  const stage = useFolder(gui, "Stage", { open: true });
  useOption(stage, "Shape", SHAPE_OPTS, shape, (v) => onShape(v));
  useOption(stage, "Mapping", SPACE_OPTS, s("space"), applySpace);
  useSlider(stage, "Density", { min: 0.5, max: 4, step: 0.1 }, density, onDensity);
  useSlider(stage, "Speed", { min: 0.05, max: 8, step: 0.05 }, timeScale, onTimeScale);
  useToggle(stage, "Paused", paused, onPaused);
  // Camera auto-orbit: independent of Speed/Paused above (those spin the
  // MESH about one axis; this drifts the CAMERA's rotX/rotY). The flat plane
  // keeps its camera locked head-on (no drag-orbit either — see the
  // scene-rebuild effect), so the toggle hides there rather than offering a
  // control with nothing to move. "Orbit speed" hides unless orbit is on,
  // same show-only-when-relevant idiom as the Volume folder's render-mode
  // rows below.
  const flatStage = isFlat(shape);
  const orbitCtrl = useToggle(stage, "Orbit", orbitAuto, onOrbitAuto);
  const orbitSpeedCtrl = useSlider(stage, "Orbit speed", { min: 0.1, max: 4, step: 0.05 }, orbitSpeed, onOrbitSpeed);
  useEffect(() => {
    orbitCtrl?.setVisible(!flatStage);
  }, [orbitCtrl, flatStage]);
  useEffect(() => {
    orbitSpeedCtrl?.setVisible(!flatStage && orbitAuto);
  }, [orbitSpeedCtrl, flatStage, orbitAuto]);

  const mix = useFolder(gui, "Mix", { open: true });
  // Scope goes first so `useDockSlot`'s insertBefore(…, firstChild) lands it
  // above every controller subsequently added to this folder (Combine, Scale, …).
  const scopeHost = useDockSlot(mix, { position: "top", className: "dock-scope-slot" });
  const combineCtrl = useOption(mix, "Combine", COMBINE_OPTS, s("combine"), (v) => onParam("combine", v));
  // `DockController.raw` is the underlying lil-gui `Controller`, whose `$name`
  // is a public DOM element (see `primitives.tsx`) — setting its native
  // `title` attribute reuses the SAME hover-tooltip convention already used
  // everywhere else on this page (IconToggle buttons, the ramp density
  // swatches, the voice color/remove buttons) instead of inventing a second
  // tooltip system for lil-gui rows.
  useEffect(() => {
    if (combineCtrl)
      combineCtrl.raw.$name.title =
        "Combine — how each active voice after the first folds into the running result: add, multiply, max, min, or difference.";
  }, [combineCtrl]);
  const scaleSlot = useDockSlot(mix, { position: "bottom", className: "dock-logrow-slot" });
  useSlider(mix, "Origin U", { min: 0, max: 1, step: 0.01 }, n("originU"), (v) => onParam("originU", v));
  useSlider(mix, "Origin V", { min: 0, max: 1, step: 0.01 }, n("originV"), (v) => onParam("originV", v));
  const gainCtrl = useSlider(mix, "Contrast", { min: 0, max: 4, step: 0.05 }, n("gain"), (v) => onParam("gain", v));
  const biasCtrl = useSlider(mix, "Brightness", { min: -1, max: 2, step: 0.05 }, n("bias"), (v) => onParam("bias", v));
  // Relabel in place at 2x4 — same two sliders, different meaning: they set
  // the dot-density / line-weight threshold each subcell's value is cut
  // against (`subValue > 0.5` in fieldSynth's Braille branch) instead of the
  // ramp index.
  useEffect(() => {
    gainCtrl?.raw.name(subcellIs2x4 ? "Contrast (dot threshold)" : "Contrast");
    biasCtrl?.raw.name(subcellIs2x4 ? "Brightness (dot threshold)" : "Brightness");
  }, [gainCtrl, biasCtrl, subcellIs2x4]);

  // Volumetric-only render controls (VOLUMETRIC.md's Carve mode, extended by
  // VOLUMETRIC-2.md §1 with xray): the whole folder hides in 2D rather than
  // unmounting, same show/hide-not-destroy discipline as every other
  // conditional row on this page. Within it, individual rows hide per render
  // mode: March fade is carve's own falloff, Xray gain is xray's own
  // absorption gain (the two can't share a knob — see VOLUMETRIC-2.md §1),
  // March steps applies to both.
  const volume = useFolder(gui, "Volume", { open: true });
  useEffect(() => {
    if (volume) volumetric ? volume.show() : volume.hide();
  }, [volume, volumetric]);
  const renderMode = s("render");
  const showMarchSteps = renderMode === "carve" || renderMode === "xray";
  // The one guard the Render dropdown routes every `render` write through
  // (see `resolveRenderChange`'s doc above).
  useOption(volume, "Render", RENDER_OPTS, renderMode, (v) => {
    const change = resolveRenderChange(v, s("subcellRes"));
    if (change.subcellRes) onParam("subcellRes", change.subcellRes);
    onParam("render", v);
  });
  const marchStepsCtrl = useSlider(
    volume,
    "March steps",
    { min: 1, max: MARCH_STEPS_MAX, step: 1 },
    n("marchSteps"),
    (v) => onParam("marchSteps", v),
  );
  const marchFadeCtrl = useSlider(volume, "March fade", { min: 0, max: 8, step: 0.05 }, n("marchFade"), (v) =>
    onParam("marchFade", v),
  );
  const xrayGainCtrl = useSlider(volume, "Xray gain", { min: 0, max: 16, step: 0.05 }, n("xrayGain"), (v) =>
    onParam("xrayGain", v),
  );
  useEffect(() => {
    marchStepsCtrl?.setVisible(showMarchSteps);
    marchFadeCtrl?.setVisible(renderMode === "carve");
    xrayGainCtrl?.setVisible(renderMode === "xray");
  }, [marchStepsCtrl, marchFadeCtrl, xrayGainCtrl, showMarchSteps, renderMode]);

  const out = useFolder(gui, "Output", { open: true });
  // Subcell GATES Ramp/Chars/density below it (2x4 never reads the ramp — see
  // `subcellIs2x4` above), so it must render as the parent choice, ABOVE the
  // controls it disables. Requested first (before any other `use*` call on
  // `out`) so `useDockSlot`'s insertBefore(…, firstChild) lands it above
  // Ramp. A segmented icon control (reusing the SAME `IconToggle` component
  // and `.gx-toggle`/`.gx-toggle-btn` CSS the voice cards already use for
  // field/wave) instead of a dropdown — "1x1"/"2x4" read as a filled cell vs.
  // a braille dot grid instead of code-ish strings.
  const subcellSlot = useDockSlot(out, { position: "top", className: "dock-subcell-slot" });
  const calibration = useRampCalibration(hostRef);
  // Selecting "Calibrated" before the font-ready measurement lands (rare —
  // `document.fonts.ready` is usually already resolved by the time the Dock
  // is interactive) queues the apply instead of silently no-op'ing.
  const pendingCalibratedRef = useRef(false);
  const selectedRamp = matchRamp(s("glyphs"), calibration.ramp);
  // "Custom" only gets its own swatch once the current ramp is actually
  // custom (typed/edited, not a preset) — otherwise the density row would
  // carry a permanently-empty "Custom" entry.
  const customCoverage = useCustomRampCoverage(hostRef, s("glyphs"));
  const rampNames = useMemo(
    () =>
      selectedRamp === "Custom"
        ? [...Object.keys(GlyphRamps), CALIBRATED_RAMP_NAME, "Custom"]
        : [...Object.keys(GlyphRamps), CALIBRATED_RAMP_NAME],
    [selectedRamp],
  );
  const coverageByOption = useMemo(
    () =>
      selectedRamp === "Custom"
        ? { ...calibration.coverageByOption, Custom: customCoverage }
        : calibration.coverageByOption,
    [calibration.coverageByOption, selectedRamp, customCoverage],
  );
  const selectRamp = useCallback(
    (name: string) => {
      if (name === CALIBRATED_RAMP_NAME) {
        if (calibration.ramp) onParam("glyphs", calibration.ramp);
        else pendingCalibratedRef.current = true;
        return;
      }
      if (name !== "Custom" && GlyphRamps[name]) onParam("glyphs", GlyphRamps[name]);
    },
    [calibration.ramp, onParam],
  );
  useEffect(() => {
    if (pendingCalibratedRef.current && calibration.ramp) {
      onParam("glyphs", calibration.ramp);
      pendingCalibratedRef.current = false;
    }
  }, [calibration.ramp, onParam]);
  // Created before Ramp so lil-gui appends it directly under the Subcell
  // toggle — the mode's own knob belongs next to the mode, not buried at the
  // bottom of the folder.
  // Created ALWAYS and merely hidden when not in ink: lil-gui appends a
  // controller at creation time, so building it only once ink is selected would
  // append it after the colours. Creating it here — before Ramp — pins it
  // directly under the Subcell toggle, where the mode's own knob belongs.
  const inkLevelsCtrl = useSlider(out, "Ink levels", { min: 1, max: 12, step: 1 }, Number(params.inkLevels ?? 4), (v) =>
    onParam("inkLevels", v),
  );
  // Carve-ink's own knob (VOLUMETRIC-3.md §2's `inkSpacing`, absolute
  // domain-unit contour interval — NOT the 2D ink mode's `inkLevels`, which
  // is a documented no-op under carve-ink and reads the field's own
  // observed value range instead of a domain-unit distance). Bounds mirror
  // `packages/effects/src/stock.ts`'s `inkSpacing` schema entry exactly.
  // Created here, right after Ink levels, so the two occupy the SAME row in
  // the folder and swap in place rather than one appearing above/below a
  // gap — the same mutually-exclusive show/hide-in-place idiom the Volume
  // folder's "March fade"/"Xray gain" pair above already uses for two knobs
  // that only ever apply to one render mode each.
  const inkSpacingCtrl = useSlider(
    out,
    "Ink spacing",
    { min: 0.05, max: 4, step: 0.05 },
    Number(params.inkSpacing ?? 0.25),
    (v) => onParam("inkSpacing", v),
  );
  const rampCtrl = useOption(out, "Ramp", RAMP_OPTS, selectedRamp, selectRamp);
  const rampDensitySlot = useDockSlot(out, { position: "bottom", className: "dock-ramp-density-slot" });
  // `isValid` rejects an empty ramp before it ever reaches `onParam`/the
  // mounted effect layer's `setParams` — fieldSynth's `validateParams` (see
  // `packages/effects/src/stock.ts`, `validateGlyphRamp`) intentionally
  // THROWS on an empty ramp (deliberate authoring-time validation, distinct
  // from `glyphRamp()`'s safe `["?"]` render-time fallback), and this text
  // field is the one path that can hand it an empty string live. Reverts the
  // field to its last non-empty value instead of clearing it.
  const charsCtrl = useText(
    out,
    "Chars",
    s("glyphs"),
    (v) => onParam("glyphs", v),
    (next) => next.length > 0,
  );
  // Ramp/Chars/the density row do nothing at 2x4 (see `subcellIs2x4` above) —
  // dim them AND say why, rather than leaving live-looking controls that
  // silently no-op.
  const { showInkLevels, showInkSpacing } = resolveInkControlVisibility(s("subcellRes"), renderMode);
  useEffect(() => {
    // 2x4 DIMS the ramp rows (Contrast/Brightness change meaning there, so the
    // relationship is worth keeping on screen). Ink simply has no ramp concept
    // at all, so its rows are hidden outright rather than left as dead weight.
    if (rampCtrl) {
      subcellIsInk ? rampCtrl.raw.hide() : rampCtrl.raw.show();
      rampCtrl.setEnabled(!ramplessSubcell, { dim: true });
    }
    if (charsCtrl) {
      subcellIsInk ? charsCtrl.raw.hide() : charsCtrl.raw.show();
      charsCtrl.setEnabled(!ramplessSubcell, { dim: true });
    }
    if (rampDensitySlot) rampDensitySlot.style.display = subcellIsInk ? "none" : "";
    if (inkLevelsCtrl) {
      showInkLevels ? inkLevelsCtrl.raw.show() : inkLevelsCtrl.raw.hide();
    }
    if (inkSpacingCtrl) {
      showInkSpacing ? inkSpacingCtrl.raw.show() : inkSpacingCtrl.raw.hide();
    }
  }, [
    rampCtrl,
    charsCtrl,
    rampDensitySlot,
    inkLevelsCtrl,
    inkSpacingCtrl,
    ramplessSubcell,
    subcellIsInk,
    showInkLevels,
    showInkSpacing,
  ]);
  // How many cuts through the amplitude axis to contour — only meaningful in
  // ink, so it appears with the mode rather than sitting inert.
  const voiceColorsOn = params.voiceColors === true;
  const colorStackOn = params.colorStackOn === true;
  const colorMode = s("colorMode") || "gradient";
  // Precedence table (VOLUMETRIC-4.md §1) — see `resolveColorStackVisibility`'s
  // own doc above, shared by this dock and (indirectly, via the same param
  // shape) the sidebar's `ColorStackSection`. Only `showVoiceColorsToggle` is
  // read here now — `showGradientColors`/`showHueControls` used to gate this
  // dock's own Color/Color B/Gradient/Hue* rows, but those rows moved into
  // `ColorStackSection` (the left sidebar) entirely; see the Color/Color
  // B/Gradient block below for the dock's own (simpler) visibility rule.
  const { showVoiceColorsToggle } = resolveColorStackVisibility(colorStackOn, colorMode);
  // `voiceColors` is inert under `render: "xray"` (xray reads only the
  // absorbed density, not per-voice color — VOLUMETRIC-2.md §1) AND while the
  // colour stack is on (its own precedence rule: "voiceColors is ignored" —
  // `showVoiceColorsToggle` above) — hidden in either case rather than left
  // as a live-looking control that silently no-ops, the same duty-only-for-
  // square precedent used elsewhere on this page.
  const voiceColorsCtrl = useToggle(out, "Per-voice colors", voiceColorsOn, (v) => onParam("voiceColors", v));
  useEffect(() => {
    voiceColorsCtrl?.setVisible(s("render") !== "xray" && showVoiceColorsToggle);
  }, [voiceColorsCtrl, params.render, showVoiceColorsToggle]);
  const colorCtrl = useColor(out, "Color", s("color"), (v) => onParam("color", v));
  const colorBCtrl = useColor(out, "Color B", s("colorB"), (v) => onParam("colorB", v));
  const gradientCtrl = useSlider(out, "Gradient", { min: 0, max: 1, step: 0.05 }, n("gradient"), (v) =>
    onParam("gradient", v),
  );
  // Color/Color B/Gradient live here ONLY while the colour stack is off —
  // `ColorStackSection` (the left sidebar) owns these same params outright
  // once the stack is on, including under `colorMode: "gradient"` where
  // they're repurposed as its endpoints (VOLUMETRIC-4.md §1's precedence
  // table): a param lives in exactly one visible control, never a second,
  // disconnected copy in both places at once. Hue offset/range/saturation/
  // lightness moved there too and have no row here anymore at all — they're
  // only ever reachable via `colorMode: "hue"`, which only exists while the
  // stack owns the palette, so a Dock row for them would never be visible.
  // Per-voice colors still wins when it's on (the stack being on already
  // forces `voiceColors` inert — hidden above — so this dimming only matters
  // in the stack-off case these controls are now exclusively shown in).
  useEffect(() => {
    colorCtrl?.setVisible(!colorStackOn);
    colorCtrl?.setEnabled(!voiceColorsOn);
    colorBCtrl?.setVisible(!colorStackOn);
    colorBCtrl?.setEnabled(!voiceColorsOn);
    gradientCtrl?.setVisible(!colorStackOn);
    gradientCtrl?.setEnabled(!voiceColorsOn);
  }, [colorCtrl, colorBCtrl, gradientCtrl, voiceColorsOn, colorStackOn]);
  // `colorTolerance` (COLOR-TOLERANCE.md Phase 4) replaces the removed
  // `colorQuantize`: it's a SCENE option (`scene.setOptions({ colorTolerance
  // })`, wired through the `colorTolerance`/`onColorTolerance` props below),
  // not a field-synth param — the shared cross-mode run-extension merge
  // tolerance (`colorRunExtends`, packages/glyphcss/src/render/cells.ts)
  // rather than anything `resolveFieldSynthColor` computes, so it lives
  // outside `params`/`onParam` the same way `density` does. Never hidden,
  // same rationale as the removed row: it acts on whatever colour path is
  // active, not one specific mode. Redmean's full range is 0..765
  // (black<->white is 764.83 — COLOR-TOLERANCE.md), but the useful range
  // saturates almost immediately: live-tested at density 3.5 on the Menger
  // preset, tolerance 32 already reaches 25.2 of the 28.8 fps ceiling
  // (bench/color-tolerance.md's live-FPS table) — going 32 -> 256 cuts spans
  // ~10x further for only 3.6 more fps, and both 128 and 256 visibly degrade
  // color fidelity on real presets. The slider is capped at 96 (default 32)
  // so the whole useful range is reachable instead of three quarters of the
  // travel sitting on settings nobody wants; the underlying scene option
  // itself stays unbounded (including +Infinity) — this is a UI range only,
  // set with `setOptions({ colorTolerance: … })` above 96 still works and
  // still round-trips through the URL's "c" token.
  useSlider(out, "Color tolerance", { min: 0, max: 96, step: 1 }, colorTolerance, onColorTolerance);
  // `colorEncoding: "atlas"` — zero-`<span>` colour-font output. Disabled
  // (with the REAL reason from `computeGlyphAtlasAvailability`, not a
  // hand-maintained guess — see that module's doc) whenever the currently
  // rendered patch can't fit the atlas, same `setEnabled(bool, {dim:true})`
  // gating idiom every other conditionally-available Dock row here uses.
  const colorEncodingCtrl = useOption<"spans" | "atlas">(
    out,
    "Color encoding",
    { Spans: "spans", Atlas: "atlas" },
    colorEncoding,
    onColorEncoding,
    "choices",
  );
  useEffect(() => {
    if (!colorEncodingCtrl) return;
    colorEncodingCtrl.setEnabled(atlasReason === null, { dim: true });
    colorEncodingCtrl.raw.$name.title =
      atlasReason === null
        ? 'Color encoding — "Atlas" encodes glyph+colour as a single colour-font PUA text node (zero <span>s) instead of HTML spans, when the current render fits the atlas\'s palette/glyph budget.'
        : `Color encoding — "Atlas" isn't available right now: ${atlasReason}`;
  }, [colorEncodingCtrl, atlasReason]);

  const light = useFolder(gui, "Lighting", { open: false });
  useSlider(light, "Amount", { min: 0, max: 1, step: 0.05 }, n("lit"), (v) => onParam("lit", v));
  useSlider(light, "Azimuth", { min: 0, max: 360, step: 1 }, lighting.azimuth, (v) => onLight({ azimuth: v }));
  useSlider(light, "Elevation", { min: 0, max: 90, step: 1 }, lighting.elevation, (v) => onLight({ elevation: v }));
  useSlider(light, "Key", { min: 0, max: 2, step: 0.05 }, lighting.keyIntensity, (v) => onLight({ keyIntensity: v }));
  useColor(light, "Key color", lighting.keyColor, (v) => onLight({ keyColor: v }));
  useSlider(light, "Ambient", { min: 0, max: 1, step: 0.05 }, lighting.ambient, (v) => onLight({ ambient: v }));

  return (
    <>
      {scopeHost && createPortal(<SynthScope paramsRef={paramsRef} tsRef={tsRef} pausedRef={pausedRef} />, scopeHost)}
      {scaleSlot &&
        createPortal(
          <LogSliderRow
            label="Scale"
            title="Pattern scale — a multiplier on the sampled domain, so its effect is per RATIO, not per unit. The dial is logarithmic: equal travel per doubling."
            value={n("scale")}
            min={SCALE_MIN}
            max={SCALE_MAX}
            onChange={(v) => onParam("scale", v)}
          />,
          scaleSlot,
        )}
      {subcellSlot &&
        createPortal(
          <div className="dock-subcell">
            <span className="dock-subcell-label">Subcell</span>
            <IconToggle
              groupTitle="Subcell — cell resolution. 1x1 picks one glyph per cell from the Ramp below; 2x4 renders a synthesized braille dot matrix per cell instead and ignores the ramp entirely."
              options={SUBCELL_TOGGLE}
              value={s("subcellRes")}
              onChange={(v) => onParam("subcellRes", v)}
            />
          </div>,
          subcellSlot,
        )}
      {rampDensitySlot &&
        createPortal(
          <RampDensityRow
            names={rampNames}
            coverageByOption={coverageByOption}
            selected={selectedRamp}
            onSelect={selectRamp}
            disabledReason={
              subcellIs2x4
                ? "Subcell = 2x4 renders a Braille dot pattern, not the ramp — Ramp/Chars have no effect. Contrast/Brightness set the dot threshold instead."
                : undefined
            }
          />,
          rampDensitySlot,
        )}
    </>
  );
}
