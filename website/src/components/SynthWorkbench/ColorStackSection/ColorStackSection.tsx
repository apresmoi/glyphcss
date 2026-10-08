import { type CSSProperties, useCallback, useState } from "react";
import {
  COMBINES,
  MAX_COLOR_VOICES,
  nextFreeVoiceSlot,
  type Params,
  type ParamValue,
  resolveColorStackVisibility,
} from "../../../features/synth/model/parameters";
import { ActionButton } from "../../ActionButton";
import { BracketSelect } from "../../BracketSelect";
import { EditableReadout } from "../../EditableReadout";
import { SliderRow, SliderTrack } from "../../SliderRow";
import { type VoiceDisplayMode } from "../../VoiceCard";
import { ColorVoiceCard } from "../ColorVoiceCard";
import styles from "./ColorStackSection.module.css";

// The voice sidebar's own colour section — below the geometry layer groups
// (VOLUMETRIC-4.md §1 Phase 4: "voices are composed in the sidebar, and
// colour voices are voices", not a dock-only afterthought). Collapses to
// just its enable toggle when `colorStackOn` is off — the toggle's own
// bracket-checkbox reads `[x]`/`[ ]`, the SAME idiom `LayerGroup`'s
// threshold/invert checkboxes use (`.layer-group-check` in
// instrument-workbench.css) — and every param underneath stays untouched in
// `params` while collapsed (same "retained but inert" contract
// `voiceColors`' own toggle already established), so re-enabling restores
// exactly what was there.
export function ColorStackSection({
  params,
  onParam,
  stageShape,
}: {
  params: Params;
  onParam: (key: string, value: ParamValue) => void;
  stageShape: string;
}) {
  const colorStackOn = params.colorStackOn === true;
  const colorMode = String(params.colorMode ?? "gradient");
  // Which palette controls this section owns right now — same precedence
  // table `SynthDock` reads (`resolveColorStackVisibility`'s doc above): with
  // the stack on, gradient's Color/Color B/Gradient and hue's four sliders
  // are mutually exclusive on `colorMode`, and the Dock gives them up
  // entirely (see that function's call site in `SynthDock` below) — a
  // control lives in exactly one of the two places, never both.
  const { showGradientColors, showHueControls } = resolveColorStackVisibility(colorStackOn, colorMode);
  const fill = (v: number, min: number, max: number) =>
    ({ ["--fill" as string]: `${((v - min) / (max - min)) * 100}%` }) as CSSProperties;
  // Existence == `campN > 0` (VOLUMETRIC-4.md §1: "far less structure" than
  // the fractal geometry voices), unlike the geometry rail's independent
  // `voiceSlots` state (SynthWorkbench.tsx), which lets a MUTED voice keep
  // its card. A colour voice has no equivalent "silence but keep editing"
  // use case worth a second piece of state, and there's no URL-persisted
  // slot mask for it either — the whole patch, colour params included,
  // already round-trips through the generic packed `?s=` schema codec (see
  // synthUrlState.ts), so deriving existence straight from `camp` keeps a
  // shared/preset link's colour voices exactly as populated as the patch
  // that produced it.
  const colorVoiceSlots = Array.from({ length: MAX_COLOR_VOICES }, (_, i) => i + 1).filter(
    (slot) => Number(params[`camp${slot}`] ?? 0) > 0,
  );
  const addColorVoice = useCallback(() => {
    const slot = nextFreeVoiceSlot(colorVoiceSlots, MAX_COLOR_VOICES);
    if (!slot) return;
    onParam(`camp${slot}`, 1);
  }, [colorVoiceSlots, onParam]);
  const removeColorVoice = useCallback((slot: number) => onParam(`camp${slot}`, 0), [onParam]);
  // Per-card display density (crowding fix, mirroring `VoiceCard`'s own
  // `mode`/`onModeChange`) — deliberately its OWN state, not shared with the
  // geometry sidebar's `voiceMode` (SynthWorkbench.tsx): the colour stack is
  // documented throughout this file as "a second, independent voice program
  // ... decoupled from the geometry voices" (VOLUMETRIC-4.md §1), and its
  // slot numbers (1..MAX_COLOR_VOICES) overlap the geometry rail's own
  // (1..MAX_VOICES) — a shared override map keyed only by slot number would
  // silently cross-apply an override from one stack's card to the other's
  // same-numbered card. Viewer preference only — never URL-persisted, same
  // contract as the geometry rail's `voiceMode`.
  //
  // No section-wide "set every card at once" toggle here (unlike the
  // geometry rail's `voiceMode`, which manages up to `MAX_VOICES` = 9 cards)
  // — `MAX_COLOR_VOICES` = 3, so a global toggle next to "+ Add colour
  // voice" was managing at most three per-card `[bsc|adv]` toggles it sat
  // nowhere near (user report: "why do we have bsc/adv next to the add
  // colour voice? shouldn't that only be next to color voice 1?"). Each
  // card's own toggle is the only control now; default "basic" per card.
  const [colorVoiceModeByCard, setColorVoiceModeByCard] = useState<Record<number, VoiceDisplayMode>>({});
  const setColorVoiceCardMode = useCallback((slot: number, next: VoiceDisplayMode) => {
    setColorVoiceModeByCard((prev) => ({ ...prev, [slot]: next }));
  }, []);
  return (
    <div className={styles.root + " color-stack"}>
      {/* Header ROW: the enable checkbox (its own `<label>`, click target for
          the checkbox only) plus combine/mode selects as flex SIBLINGS — not
          children of the label, which would hijack a select click into
          toggling the checkbox (the same conflict `LayerGroup`'s header hit
          in `7ca4496`, and the same fix: split the click target out). The
          selects only render while `colorStackOn`, same as the body below. */}
      <div className="color-stack-head">
        <label
          className="color-stack-check"
          title="Colour voice stack — a second, independent voice program that drives colour only, decoupled from the geometry voices above (VOLUMETRIC-4.md §1). Params are retained while off, so toggling never loses work."
        >
          <input type="checkbox" checked={colorStackOn} onChange={(e) => onParam("colorStackOn", e.target.checked)} />
          <span>Colour</span>
        </label>
        {colorStackOn && (
          <>
            <label className="color-stack-head-select" title="Combine — how the colour voices fold together.">
              <BracketSelect
                value={String(params.colorCombine ?? "multiply")}
                onChange={(e) => onParam("colorCombine", e.target.value)}
              >
                {COMBINES.map((v) => (
                  <option key={v} value={v}>
                    {v}
                  </option>
                ))}
              </BracketSelect>
            </label>
            <label
              className="color-stack-head-select"
              title="Mode — gradient exposes Color / Color B / Gradient below as its endpoints; hue exposes Hue offset/range/saturation/lightness instead — the iridescence mode."
            >
              <BracketSelect
                value={String(params.colorMode ?? "gradient")}
                onChange={(e) => onParam("colorMode", e.target.value)}
              >
                <option value="gradient">gradient</option>
                <option value="hue">hue</option>
              </BracketSelect>
            </label>
          </>
        )}
      </div>
      {colorStackOn && (
        <div className="color-stack-body">
          {/* Palette — the mode-appropriate colour endpoints, moved in from the
              right Dock's Output folder (which gives them up entirely while
              the stack owns them — see `SynthDock`'s own `!colorStackOn` gate
              below) so "how do I pick the gradient colours" has an answer
              right next to the voices that feed them. `showGradientColors`/
              `showHueControls` are mutually exclusive whenever `colorStackOn`
              is true (`colorMode` is a two-value enum), so exactly one of
              the two blocks below renders. */}
          <div className="color-stack-palette">
            {showGradientColors && (
              <>
                <div className="color-stack-swatches">
                  <label className="color-stack-swatch" title="Color — the gradient's start endpoint.">
                    <input
                      type="color"
                      className="voice-color"
                      value={String(params.color ?? "#7df9ff")}
                      onChange={(e) => onParam("color", e.target.value)}
                    />
                    <span>Color</span>
                  </label>
                  <label className="color-stack-swatch" title="Color B — the gradient's end endpoint.">
                    <input
                      type="color"
                      className="voice-color"
                      value={String(params.colorB ?? "#ff4fa3")}
                      onChange={(e) => onParam("colorB", e.target.value)}
                    />
                    <span>Color B</span>
                  </label>
                </div>
                <SliderRow
                  className="voice-slider"
                  title="Gradient — interpolation position between Color and Color B."
                >
                  <span>grad</span>
                  <SliderTrack className="voice-slider-track">
                    <input
                      type="range"
                      min={0}
                      max={1}
                      step={0.05}
                      value={Number(params.gradient ?? 0)}
                      style={fill(Number(params.gradient ?? 0), 0, 1)}
                      onChange={(e) => onParam("gradient", +e.target.value)}
                    />
                  </SliderTrack>
                  <EditableReadout
                    value={Number(params.gradient ?? 0)}
                    min={0}
                    max={1}
                    format={(v) => v.toFixed(2)}
                    onCommit={(v) => onParam("gradient", v)}
                  />
                </SliderRow>
              </>
            )}
            {showHueControls && (
              <>
                <SliderRow
                  className="voice-slider"
                  title="Hue offset — rotates the hue wheel, in cycles (a whole-wheel rotation is 1 regardless of Hue range)."
                >
                  <span>hue</span>
                  <SliderTrack className="voice-slider-track">
                    <input
                      type="range"
                      min={-1}
                      max={1}
                      step={0.01}
                      value={Number(params.hueOffset ?? 0)}
                      style={fill(Number(params.hueOffset ?? 0), -1, 1)}
                      onChange={(e) => onParam("hueOffset", +e.target.value)}
                    />
                  </SliderTrack>
                  <EditableReadout
                    value={Number(params.hueOffset ?? 0)}
                    min={-1}
                    max={1}
                    format={(v) => v.toFixed(2)}
                    onCommit={(v) => onParam("hueOffset", v)}
                  />
                </SliderRow>
                <SliderRow
                  className="voice-slider"
                  title="Hue range — how much of the wheel the sweep covers, in degrees."
                >
                  <span>range</span>
                  <SliderTrack className="voice-slider-track">
                    <input
                      type="range"
                      min={0}
                      max={360}
                      step={1}
                      value={Number(params.hueRange ?? 360)}
                      style={fill(Number(params.hueRange ?? 360), 0, 360)}
                      onChange={(e) => onParam("hueRange", +e.target.value)}
                    />
                  </SliderTrack>
                  <EditableReadout
                    value={Number(params.hueRange ?? 360)}
                    min={0}
                    max={360}
                    format={(v) => `${v.toFixed(0)}°`}
                    onCommit={(v) => onParam("hueRange", v)}
                  />
                </SliderRow>
                <SliderRow
                  className="voice-slider"
                  title="Hue saturation — fixed saturation for every hue in the sweep."
                >
                  <span>sat</span>
                  <SliderTrack className="voice-slider-track">
                    <input
                      type="range"
                      min={0}
                      max={100}
                      step={1}
                      value={Number(params.hueSat ?? 70)}
                      style={fill(Number(params.hueSat ?? 70), 0, 100)}
                      onChange={(e) => onParam("hueSat", +e.target.value)}
                    />
                  </SliderTrack>
                  <EditableReadout
                    value={Number(params.hueSat ?? 70)}
                    min={0}
                    max={100}
                    format={(v) => `${v.toFixed(0)}%`}
                    onCommit={(v) => onParam("hueSat", v)}
                  />
                </SliderRow>
                <SliderRow className="voice-slider" title="Hue lightness — fixed lightness for every hue in the sweep.">
                  <span>light</span>
                  <SliderTrack className="voice-slider-track">
                    <input
                      type="range"
                      min={0}
                      max={100}
                      step={1}
                      value={Number(params.hueLight ?? 55)}
                      style={fill(Number(params.hueLight ?? 55), 0, 100)}
                      onChange={(e) => onParam("hueLight", +e.target.value)}
                    />
                  </SliderTrack>
                  <EditableReadout
                    value={Number(params.hueLight ?? 55)}
                    min={0}
                    max={100}
                    format={(v) => `${v.toFixed(0)}%`}
                    onCommit={(v) => onParam("hueLight", v)}
                  />
                </SliderRow>
              </>
            )}
          </div>
          <div className="color-stack-voices">
            {colorVoiceSlots.map((slot) => (
              <ColorVoiceCard
                key={slot}
                slot={slot}
                index={colorVoiceSlots.indexOf(slot)}
                params={params}
                onParam={onParam}
                onRemove={() => removeColorVoice(slot)}
                stageShape={stageShape}
                hoverToAnimate
                mode={colorVoiceModeByCard[slot] ?? "basic"}
                onModeChange={(next) => setColorVoiceCardMode(slot, next)}
              />
            ))}
          </div>
          {colorVoiceSlots.length === 0 && <p className="synth-empty">No colour voices — add one to start.</p>}
          <div className="color-stack-voices-actions">
            <ActionButton
              type="button"
              className="layer-group-add"
              onClick={addColorVoice}
              disabled={colorVoiceSlots.length >= MAX_COLOR_VOICES}
              title="Add a colour voice"
            >
              + Add colour voice
            </ActionButton>
          </div>
        </div>
      )}
    </div>
  );
}
