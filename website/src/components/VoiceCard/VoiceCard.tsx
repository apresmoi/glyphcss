import { type CSSProperties, useCallback, useEffect, useRef, useState } from "react";
import { useSynthPreview } from "../../features/synth/hooks/useSynthPreview";
import { useTrendlineClock } from "../../features/synth/hooks/useTrendlineClock";
import { FREQ_MAX, freqFromSlider, freqToSlider } from "../../features/synth/model/frequency";
import { soloParams } from "../../features/synth/model/geometry";
import {
  type Params,
  type ParamValue,
  angleApplies,
  isSdfField,
  isSdfIterField,
  MAX_LAYERS,
  resolveColorStackVisibility,
} from "../../features/synth/model/parameters";
import { MAX_VOICES } from "../../features/synth/model/urlState";
import { buildWavePathD } from "../../features/synth/model/waves";
import { ActionButton } from "../ActionButton";
import { EditableReadout } from "../EditableReadout/index";
import { IconToggle } from "../IconToggle/index";
import { SliderRow, SliderTrack } from "../SliderRow";
import { VoiceCardFrame } from "./VoiceCardFrame";
import { VoiceFieldMap } from "./VoiceFieldMap";
import {
  type VoiceDisplayMode,
  FIELD_TOGGLE,
  FIELD_TOGGLE_3D,
  LAYER_TOGGLE,
  VOICE_MODE_TOGGLE,
  WAVE_TOGGLE,
} from "./voiceOptions";

export function VoiceCard({
  slot,
  index,
  params,
  onParam,
  onRemove,
  onHover,
  stageShape = "cube",
  hoverToAnimate = false,
  mode,
  onModeChange,
}: {
  slot: number;
  index: number;
  params: Params;
  onParam: (key: string, value: ParamValue) => void;
  onRemove: () => void;
  /** Fires this card's slot while the pointer is on it (and null when it
   *  leaves), so a host can highlight that voice's contribution in the render.
   *  Optional — /synth doesn't use it. Pointer-over covers dragging too, since
   *  the pointer stays on the card for the whole drag. */
  onHover?: (slot: number | null) => void;
  /** The page's CURRENT stage mesh (VOLUMETRIC-2.md §3) — used only for this
   *  card's own volumetric preview, so e.g. a voice edited on the `pyramid`
   *  stage previews on a pyramid too, not a hardcoded cube. Callers with no
   *  stage concept of their own (the loaders gallery) omit it and keep the
   *  old cube preview. */
  stageShape?: string;
  /** When `true`, this card's own mini preview (and trendline) only animates
   *  while the pointer is over the card — otherwise it renders one static,
   *  representative frame and stays there (perf: a voice sidebar can mount
   *  many of these at once, each with its own render loop). Default `false`
   *  keeps every EXISTING caller's continuous-animation behavior unchanged
   *  (the loaders gallery mounts a card per loader and has never gated this
   *  on hover) — `/synth`'s own sidebar opts in explicitly. */
  hoverToAnimate?: boolean;
  /** Display density (crowding fix) — `undefined` (the default, every
   *  EXISTING caller) keeps the full original card: every param row, the
   *  live mini scene preview (soloed on `stageShape`), no mode toggle.
   *  Passing `"basic"`/`"advanced"` opts a card into the managed layout:
   *  `"basic"` hides `mix`/`phase`/the layer selector/placement (the
   *  conditional `duty`/`iter` rows still show when they apply — those
   *  aren't display-mode params) AND the mini scene preview, showing only
   *  the waveform trendline at full height. `"advanced"` shows everything
   *  `"basic"` does plus those, and re-mounts the mini scene preview below
   *  the trendline — but always soloed on a flat `"plane"`, never
   *  `stageShape`, even on a volumetric patch: the point is to see the
   *  voice's own PATTERN in isolation, not the object it happens to be
   *  painted on (the object preview was removed at the user's request —
   *  see `1d1e2cd`). Either mode shows the per-card `[bsc|adv]` toggle.
   *  Viewer preference only — never read from or written to the `?s=` URL;
   *  `/synth`'s own sidebar is the only caller that passes this today. */
  mode?: VoiceDisplayMode;
  /** Required alongside `mode` for the per-card `[bsc|adv]` toggle to render
   *  (an unmanaged card has nothing to call this with). */
  onModeChange?: (mode: VoiceDisplayMode) => void;
}) {
  const managed = mode !== undefined;
  const showAdvanced = !managed || mode === "advanced";
  // Colour stack precedence table (`resolveColorStackVisibility`'s doc
  // above) — this card's own swatch drives `voiceColors` blending, whose
  // toggle is already hidden once the colour stack owns colour instead.
  const { showVoiceColorSwatch } = resolveColorStackVisibility(
    params.colorStackOn === true,
    String(params.colorMode ?? ""),
  );
  const [host, setHost] = useState<HTMLDivElement | null>(null);
  const [hovered, setHovered] = useState(false);
  const f = (k: string) => String(params[`${k}${slot}`]);
  const num = (k: string) => Number(params[`${k}${slot}`]);
  const volumetric = params.space === "object";
  // Always-fresh ref (not a dep) — the trendline reads it from inside the
  // preview's own rAF tick, which must stay mounted across param changes.
  const trendRef = useRef({
    wave: f("wave"),
    freq: num("freq"),
    speed: num("speed"),
    amp: num("amp"),
    duty: num("duty"),
    phase: num("phase"),
  });
  trendRef.current = {
    wave: f("wave"),
    freq: num("freq"),
    speed: num("speed"),
    amp: num("amp"),
    duty: num("duty"),
    phase: num("phase"),
  };
  const pathRef = useRef<SVGPathElement | null>(null);
  const onTick = useCallback((t: number) => {
    const path = pathRef.current;
    if (!path) return;
    const v = trendRef.current;
    path.setAttribute("d", buildWavePathD(v.wave, v.freq, v.speed, v.amp, t, 100, 30, v.duty, v.phase));
  }, []);
  // `soloParams` also copies the SOURCE layer's shaping (see its own doc) and
  // the voice's own `iter${slot}` — so the deps list below must track the
  // voice's `layer${slot}` assignment, `iter${slot}`, and every layer's
  // combine/threshold/invert/blend/amp, or an edit to any of those leaves
  // this card's preview and trendline rendering a stale patch.
  const layerShapingDeps = Array.from({ length: MAX_LAYERS }, (_, i) => i + 1).flatMap((l) => [
    params[`layerCombine${l}`],
    params[`layerThresholdOn${l}`],
    params[`layerThreshold${l}`],
    params[`layerInvert${l}`],
    params[`layerBlend${l}`],
    params[`layerAmp${l}`],
  ]);
  const animate = hoverToAnimate ? hovered : true;
  // An unmanaged card (`mode` omitted — the loaders gallery) mounts its own
  // live mini scene, soloed on `stageShape` when the patch is volumetric,
  // which drives the trendline via `onTick` as a byproduct. A managed card
  // (`/synth`) only renders the `host` span below (see `voice-preview`) in
  // `"advanced"` mode, and always solos on a flat `"plane"` regardless of
  // `stageShape` — showing the voice's own pattern, never the object it's
  // painted on. In `"basic"` mode `host` stays null so this call is a no-op
  // and the decoupled clock below drives the trendline instead; the two
  // never fire the same `onTick` at once for a given card.
  useSynthPreview(
    host,
    () => soloParams(params, slot),
    [
      params[`field${slot}`],
      params[`wave${slot}`],
      params[`freq${slot}`],
      params[`speed${slot}`],
      params[`color${slot}`],
      params[`angle${slot}`],
      params[`originU${slot}`],
      params[`originV${slot}`],
      params[`originW${slot}`],
      params[`duty${slot}`],
      params[`phase${slot}`],
      params[`iter${slot}`],
      params[`layer${slot}`],
      ...layerShapingDeps,
      params.voiceColors,
      params.space,
      params.scale,
      params.color,
      params.colorB,
      params.gradient,
      params.glyphs,
      host,
      stageShape,
    ],
    onTick,
    managed ? "plane" : volumetric ? stageShape : "plane",
    animate,
  );
  useTrendlineClock(
    onTick,
    [f("wave"), num("freq"), num("speed"), num("amp"), num("duty"), num("phase")],
    animate,
    managed && !showAdvanced,
  );
  const fill = (v: number, min: number, max: number) =>
    ({ ["--fill" as string]: `${((v - min) / (max - min)) * 100}%` }) as CSSProperties;
  // Placement (angle/u/v) is the exception rather than the rule, so it folds
  // away — but a patch that USES it should show it without being asked. The
  // check spans the whole patch, not just this voice: Cube tiles leaves voice 1
  // at 0° while turning 2 and 3, and one open card beside two shut ones reads
  // as a glitch rather than a state.
  const patchUsesPlacement = Array.from({ length: MAX_VOICES }, (_, k) => k + 1).some(
    (v) =>
      Number(params[`amp${v}`] ?? 0) > 0 &&
      ((angleApplies(String(params[`field${v}`])) && Number(params[`angle${v}`] ?? 0) !== 0) ||
        Number(params[`originU${v}`] ?? 0) !== 0 ||
        Number(params[`originV${v}`] ?? 0) !== 0 ||
        Number(params[`originW${v}`] ?? 0) !== 0),
  );
  const [placementOverride, setPlacementOverride] = useState<boolean | null>(null);
  // Applying a preset flips `patchUsesPlacement`; clear any manual choice so the
  // new patch decides, instead of a stale click hiding what it configured.
  useEffect(() => {
    setPlacementOverride(null);
  }, [patchUsesPlacement]);
  const placementOpen = placementOverride ?? patchUsesPlacement;
  return (
    <VoiceCardFrame
      className="voice-card"
      onPointerEnter={() => {
        onHover?.(slot);
        if (hoverToAnimate) setHovered(true);
      }}
      onPointerLeave={() => {
        onHover?.(null);
        if (hoverToAnimate) setHovered(false);
      }}
    >
      <div className="voice-left">
        <svg className="voice-trend" viewBox="0 0 100 30" preserveAspectRatio="none" aria-hidden="true">
          <line x1="0" y1="15" x2="100" y2="15" className="voice-trend-mid" />
          <path
            ref={pathRef}
            className="voice-trend-line"
            style={{ stroke: f("color") }}
            vectorEffect="non-scaling-stroke"
            fill="none"
          />
        </svg>
        {/* Managed cards (`/synth`) drop the live mini scene preview in
            `"basic"` mode (user: "the object rendering below the wave could
            disappear") — not just hidden, never rendered, so `host` stays
            null and `useSynthPreview` above stays a no-op. `"advanced"`
            re-mounts it, always soloed on a flat plane (see the
            `useSynthPreview` call above) — a pattern, not the object. */}
        {showAdvanced && <span className="voice-preview" ref={setHost} />}
      </div>
      <div className="voice-controls">
        <div className="voice-head">
          <span className="voice-title">Voice {index + 1}</span>
          <span className="voice-head-right">
            {showVoiceColorSwatch && (
              <input
                type="color"
                className="voice-color"
                value={f("color")}
                onChange={(e) => onParam(`color${slot}`, e.target.value)}
                title="Voice color"
              />
            )}
            {managed && (
              <span className="voice-mode-toggle">
                <IconToggle
                  groupTitle="Basic/Advanced — Basic shows wave, field, freq, speed, and any conditional params (duty, iter). Advanced adds mix, phase, layer assignment, and placement."
                  options={VOICE_MODE_TOGGLE}
                  value={mode as string}
                  onChange={(v) => onModeChange?.(v as VoiceDisplayMode)}
                />
              </span>
            )}
            <ActionButton className="voice-remove" onClick={onRemove} title="Remove voice">
              ×
            </ActionButton>
          </span>
        </div>
        <IconToggle
          groupTitle="Wave — the oscillator shape sampled across this voice's field (hover a button for its shape)"
          options={WAVE_TOGGLE}
          value={f("wave")}
          onChange={(v) => onParam(`wave${slot}`, v)}
        />
        <IconToggle
          groupTitle="Field — how this voice's value varies spatially across the surface (hover a button for its shape)"
          options={volumetric ? FIELD_TOGGLE_3D : FIELD_TOGGLE}
          value={f("field")}
          onChange={(v) => onParam(`field${slot}`, v)}
        />
        <SliderRow
          className="voice-slider"
          title="Freq — spatial frequency: how many oscillation cycles this voice packs across the surface. Higher = tighter, more repetitions. The dial is tapered, so the low end where patterns actually live gets most of the travel."
        >
          <span>freq</span>
          <SliderTrack className="voice-slider-track">
            <input
              type="range"
              min={0}
              max={1}
              step={0.001}
              value={freqToSlider(num("freq"), FREQ_MAX)}
              style={fill(freqToSlider(num("freq"), FREQ_MAX), 0, 1)}
              onChange={(e) => onParam(`freq${slot}`, freqFromSlider(+e.target.value, FREQ_MAX))}
            />
          </SliderTrack>
          <EditableReadout
            value={num("freq")}
            min={0}
            max={FREQ_MAX}
            format={(v) => (v < 2 ? v.toFixed(2) : v.toFixed(1))}
            onCommit={(v) => onParam(`freq${slot}`, v)}
          />
        </SliderRow>
        <SliderRow
          className="voice-slider"
          title="Speed — how fast this voice's phase animates over time. Negative reverses the direction of travel."
        >
          <span>speed</span>
          <SliderTrack className="voice-slider-track">
            <input
              type="range"
              min={-8}
              max={8}
              step={0.05}
              value={num("speed")}
              style={fill(num("speed"), -8, 8)}
              onChange={(e) => onParam(`speed${slot}`, +e.target.value)}
            />
          </SliderTrack>
          <EditableReadout
            value={num("speed")}
            min={-8}
            max={8}
            format={(v) => v.toFixed(2)}
            onCommit={(v) => onParam(`speed${slot}`, v)}
          />
        </SliderRow>
        {showAdvanced && (
          <SliderRow
            className="voice-slider"
            title="Mix — a MIX WEIGHT, not a volume: blends the running result toward combine(result, this voice) by this amount. 0 skips the voice entirely; a low value still shows up gently instead of a mode like multiply collapsing the whole field to flat."
          >
            <span>mix</span>
            <SliderTrack className="voice-slider-track">
              <input
                type="range"
                min={0}
                max={1}
                step={0.02}
                value={num("amp")}
                style={fill(num("amp"), 0, 1)}
                onChange={(e) => onParam(`amp${slot}`, +e.target.value)}
              />
            </SliderTrack>
            <EditableReadout
              value={num("amp")}
              min={0}
              max={1}
              format={(v) => v.toFixed(2)}
              onCommit={(v) => onParam(`amp${slot}`, v)}
            />
          </SliderRow>
        )}
        {f("wave") === "square" && (
          <SliderRow
            className="voice-slider"
            title="Duty — the square wave's high fraction. 0.5 (default) is an even on/off split; a smaller value selects a narrower high band (e.g. 1/3 for a middle-third selector)."
          >
            <span>duty</span>
            <SliderTrack className="voice-slider-track">
              <input
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={num("duty")}
                style={fill(num("duty"), 0, 1)}
                onChange={(e) => onParam(`duty${slot}`, +e.target.value)}
              />
            </SliderTrack>
            <EditableReadout
              value={num("duty")}
              min={0}
              max={1}
              format={(v) => v.toFixed(2)}
              onCommit={(v) => onParam(`duty${slot}`, v)}
            />
          </SliderRow>
        )}
        {showAdvanced && (
          <SliderRow
            className="voice-slider"
            title="Phase — added to this voice's wave argument, in cycles. Shifts the wave itself, unlike Origin U/V (which linear fields ignore entirely) — the only way to phase-shift a linear voice. For a menger/sierpinski voice, phase is an ISO-LEVEL offset instead — it erodes/dilates the solid, not a translation."
          >
            <span>phase</span>
            <SliderTrack className="voice-slider-track">
              <input
                type="range"
                min={-1}
                max={1}
                step={0.01}
                value={num("phase")}
                style={fill(num("phase"), -1, 1)}
                onChange={(e) => onParam(`phase${slot}`, +e.target.value)}
              />
            </SliderTrack>
            <EditableReadout
              value={num("phase")}
              min={-1}
              max={1}
              format={(v) => v.toFixed(2)}
              onCommit={(v) => onParam(`phase${slot}`, v)}
            />
          </SliderRow>
        )}
        {isSdfIterField(f("field")) && (
          <SliderRow
            className="voice-slider"
            title="Iterations — recursion depth of the box (menger) / corner-tetra (sierpinski) fractal. Capped at 4: carve/xray's march resolution caps at 256 steps, and iteration 5 would need ~486 and render guaranteed false holes."
          >
            <span>iter</span>
            <SliderTrack className="voice-slider-track">
              <input
                type="range"
                min={1}
                max={4}
                step={1}
                value={num("iter")}
                style={fill(num("iter"), 1, 4)}
                onChange={(e) => onParam(`iter${slot}`, +e.target.value)}
              />
            </SliderTrack>
            <EditableReadout
              value={num("iter")}
              min={1}
              max={4}
              integer
              format={(v) => String(v)}
              onCommit={(v) => onParam(`iter${slot}`, v)}
            />
          </SliderRow>
        )}
        {showAdvanced && (
          <div
            className="voice-layer-row"
            title="Layer — which of up to 3 groups this voice folds into before layers combine. All voices default to layer 1, which folds exactly like today's flat mix."
          >
            <span className="voice-layer-label">layer</span>
            <IconToggle
              groupTitle="Layer assignment"
              options={LAYER_TOGGLE}
              value={String(num("layer"))}
              onChange={(v) => onParam(`layer${slot}`, Number(v))}
            />
          </div>
        )}
        {showAdvanced && (
          <button
            type="button"
            className={`voice-placement-toggle${placementOpen ? " is-open" : ""}`}
            onClick={() => setPlacementOverride(!placementOpen)}
            title="Placement — where this voice's field is centred and which way it runs. Hidden until used, since most patches leave it alone."
          >
            {placementOpen ? "▾" : "▸"} placement
          </button>
        )}
        {showAdvanced && placementOpen && (
          <div className="voice-placement">
            <VoiceFieldMap params={params} slot={slot} />
            <div className="voice-placement-rows">
              {angleApplies(f("field")) && (
                <SliderRow
                  className="voice-slider"
                  title="Angle — rotates this voice's sampling frame about its own origin, in degrees. Turns the linear fields into a steerable plane wave; radial is invariant to it (its level sets are circles)."
                >
                  <span>angle</span>
                  <SliderTrack className="voice-slider-track">
                    <input
                      type="range"
                      min={-180}
                      max={180}
                      step={1}
                      value={num("angle")}
                      style={fill(num("angle"), -180, 180)}
                      onChange={(e) => onParam(`angle${slot}`, +e.target.value)}
                    />
                  </SliderTrack>
                  <EditableReadout
                    value={num("angle")}
                    min={-180}
                    max={180}
                    format={(v) => `${v.toFixed(0)}°`}
                    onCommit={(v) => onParam(`angle${slot}`, v)}
                  />
                </SliderRow>
              )}
              <SliderRow
                className="voice-slider"
                title="Origin U — offsets THIS voice's centre from the global origin. Two radial voices on different centres is the classic interference figure."
              >
                <span>u</span>
                <SliderTrack className="voice-slider-track">
                  <input
                    type="range"
                    min={-1}
                    max={1}
                    step={0.01}
                    value={num("originU")}
                    style={fill(num("originU"), -1, 1)}
                    onChange={(e) => onParam(`originU${slot}`, +e.target.value)}
                  />
                </SliderTrack>
                <EditableReadout
                  value={num("originU")}
                  min={-1}
                  max={1}
                  format={(v) => v.toFixed(2)}
                  onCommit={(v) => onParam(`originU${slot}`, v)}
                />
              </SliderRow>
              <SliderRow className="voice-slider" title="Origin V — as Origin U, on the other axis.">
                <span>v</span>
                <SliderTrack className="voice-slider-track">
                  <input
                    type="range"
                    min={-1}
                    max={1}
                    step={0.01}
                    value={num("originV")}
                    style={fill(num("originV"), -1, 1)}
                    onChange={(e) => onParam(`originV${slot}`, +e.target.value)}
                  />
                </SliderTrack>
                <EditableReadout
                  value={num("originV")}
                  min={-1}
                  max={1}
                  format={(v) => v.toFixed(2)}
                  onCommit={(v) => onParam(`originV${slot}`, v)}
                />
              </SliderRow>
              {(volumetric || isSdfField(f("field"))) && (
                <SliderRow
                  className="voice-slider"
                  title="Origin W — as Origin U/V, on the third (depth) axis. No effect on a 2D linear/angular/radial/noise field, but an SDF voice (gyroid/menger/sierpinski) reads it even in 2D — the field is evaluated as a z=0 slice, and Origin W moves that slice through the volume."
                >
                  <span>w</span>
                  <SliderTrack className="voice-slider-track">
                    <input
                      type="range"
                      min={-1}
                      max={1}
                      step={0.01}
                      value={num("originW")}
                      style={fill(num("originW"), -1, 1)}
                      onChange={(e) => onParam(`originW${slot}`, +e.target.value)}
                    />
                  </SliderTrack>
                  <EditableReadout
                    value={num("originW")}
                    min={-1}
                    max={1}
                    format={(v) => v.toFixed(2)}
                    onCommit={(v) => onParam(`originW${slot}`, v)}
                  />
                </SliderRow>
              )}
            </div>
          </div>
        )}
      </div>
    </VoiceCardFrame>
  );
}
