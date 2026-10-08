import { type CSSProperties, useCallback, useEffect, useRef, useState } from "react";
import { useSynthPreview } from "../../../features/synth/hooks/useSynthPreview";
import { useTrendlineClock } from "../../../features/synth/hooks/useTrendlineClock";
import { CFREQ_MAX, freqFromSlider, freqToSlider } from "../../../features/synth/model/frequency";
import {
  type Params,
  type ParamValue,
  angleApplies,
  COLOR_VOICE_ACCENT,
  fieldHasPlacement,
  isSdfField,
  isSdfIterField,
  NORMAL_DERIVED_SYNTH_FIELDS,
  soloColorParams,
} from "../../../features/synth/model/parameters";
import { buildWavePathD } from "../../../features/synth/model/waves";
import { ActionButton } from "../../ActionButton";
import { EditableReadout } from "../../EditableReadout";
import { IconToggle } from "../../IconToggle";
import { SliderRow, SliderTrack } from "../../SliderRow";
import {
  type VoiceDisplayMode,
  FIELD_TOGGLE_COLOR,
  FIELD_TOGGLE_COLOR_3D,
  VOICE_MODE_TOGGLE,
  VoiceCardFrame,
  VoiceFieldMap,
  WAVE_TOGGLE,
} from "../../VoiceCard";

export function ColorVoiceCard({
  slot,
  index,
  params,
  onParam,
  onRemove,
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
  stageShape?: string;
  hoverToAnimate?: boolean;
  /** Display density (crowding fix) — mirrors `VoiceCard`'s own `mode` prop
   *  exactly (see its doc comment): `undefined` (the default) keeps the full
   *  original card, every param row shown. `"basic"`/`"advanced"` opts a
   *  card into the managed layout: `"basic"` hides `camp` (mix), `cphase`,
   *  and placement (`cangle`/`coriginU/V/W`) — the conditional `cduty`
   *  (square wave) / `citer` (SDF field) rows still show when they apply,
   *  same as geometry. Unlike a geometry voice, a colour voice has no layer
   *  selector at all (AGENTS.md: "layers have no color model of their
   *  own") — there's nothing to gate for that concept here. Viewer
   *  preference only — never read from or written to the `?s=` URL. */
  mode?: VoiceDisplayMode;
  /** Required alongside `mode` for the per-card `[bsc|adv]` toggle to render. */
  onModeChange?: (mode: VoiceDisplayMode) => void;
}) {
  const managed = mode !== undefined;
  const showAdvanced = !managed || mode === "advanced";
  const [host, setHost] = useState<HTMLDivElement | null>(null);
  const [hovered, setHovered] = useState(false);
  const f = (k: string) => String(params[`c${k}${slot}`]);
  const num = (k: string) => Number(params[`c${k}${slot}`]);
  const field = f("field");
  const isNormalDerived = NORMAL_DERIVED_SYNTH_FIELDS.has(field);
  const volumetric = params.space === "object";
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
  const animate = hoverToAnimate ? hovered : true;
  // Managed (`/synth`) cards drop the mini scene preview in "basic" mode,
  // same rule `VoiceCard` applies (`c6591a2`) — the decoupled clock below
  // drives the trendline instead, and the two never fire the same `onTick`
  // at once. This is the SAME RULE as the geometry card, not the same
  // pinned shape: geometry always solos on a flat "plane" in advanced mode
  // because the point there is the voice's own occupancy PATTERN in
  // isolation from the object it's painted on. A colour voice's solo
  // (`soloColorParams`) already isolates colour a different way — it forces
  // the GEOMETRY stack flat (`field1: "radial", freq1: 0`, constant
  // occupancy) so glyph choice never varies and only colour does; the
  // preview MESH shape is left free to track `stageShape` on a volumetric
  // patch, because several colour fields (the four normal-derived kinds,
  // and any `space: "object"` field) are genuine reads of the real 3D
  // surface/normal and are meaningless on a flat plane — pinning to "plane"
  // here would defeat the same fields the "no preview" state below already
  // exists to handle. So: same basic/advanced RULE (mini preview only in
  // advanced), different shape policy, because the two solos isolate
  // different things.
  useSynthPreview(
    host,
    () => soloColorParams(params, slot),
    [
      params[`cfield${slot}`],
      params[`cwave${slot}`],
      params[`cfreq${slot}`],
      params[`cspeed${slot}`],
      params[`cangle${slot}`],
      params[`coriginU${slot}`],
      params[`coriginV${slot}`],
      params[`coriginW${slot}`],
      params[`cduty${slot}`],
      params[`cphase${slot}`],
      params[`citer${slot}`],
      params.colorCombine,
      params.colorMode,
      params.hueOffset,
      params.hueRange,
      params.hueSat,
      params.hueLight,
      params.color,
      params.colorB,
      params.gradient,
      params.space,
      params.scale,
      params.glyphs,
      host,
      stageShape,
    ],
    onTick,
    volumetric ? stageShape : "plane",
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
  const canPlace = fieldHasPlacement(field);
  const [placementOverride, setPlacementOverride] = useState(false);
  // A field switch that loses placement (into a normal-derived kind) must
  // close the panel rather than leave it open on now-hidden rows.
  useEffect(() => {
    if (!canPlace) setPlacementOverride(false);
  }, [canPlace]);
  const placementOpen = canPlace && placementOverride;
  return (
    <VoiceCardFrame
      className="voice-card"
      onPointerEnter={() => {
        if (hoverToAnimate) setHovered(true);
      }}
      onPointerLeave={() => {
        if (hoverToAnimate) setHovered(false);
      }}
    >
      <div className="voice-left">
        <svg className="voice-trend" viewBox="0 0 100 30" preserveAspectRatio="none" aria-hidden="true">
          <line x1="0" y1="15" x2="100" y2="15" className="voice-trend-mid" />
          <path
            ref={pathRef}
            className="voice-trend-line"
            style={{ stroke: COLOR_VOICE_ACCENT }}
            vectorEffect="non-scaling-stroke"
            fill="none"
          />
        </svg>
        {showAdvanced &&
          (isNormalDerived ? (
            <span
              className="voice-preview voice-preview-none"
              title="No 2D preview — this field is a per-cell surface normal read (VOLUMETRIC-4.md §1), which a flat preview plane can't show (its normal never varies). Apply it and look at the real stage."
            >
              no preview
            </span>
          ) : (
            <span className="voice-preview" ref={setHost} />
          ))}
      </div>
      <div className="voice-controls">
        <div className="voice-head">
          <span className="voice-title">Voice {index + 1}</span>
          <span className="voice-head-right">
            {managed && (
              <span className="voice-mode-toggle">
                <IconToggle
                  groupTitle="Basic/Advanced — Basic shows wave, field, freq, speed, and any conditional params (duty, iter). Advanced adds mix, phase, and placement."
                  options={VOICE_MODE_TOGGLE}
                  value={mode as string}
                  onChange={(v) => onModeChange?.(v as VoiceDisplayMode)}
                />
              </span>
            )}
            <ActionButton className="voice-remove" onClick={onRemove} title="Remove colour voice">
              ×
            </ActionButton>
          </span>
        </div>
        <IconToggle
          groupTitle="Wave — the oscillator shape sampled across this colour voice's field (hover a button for its shape)"
          options={WAVE_TOGGLE}
          value={f("wave")}
          onChange={(v) => onParam(`cwave${slot}`, v)}
        />
        <IconToggle
          groupTitle="Field — how this colour voice's value varies (hover a button for its shape). The four normal-derived kinds at the end (VOLUMETRIC-4.md §1) read the surface's own geometric normal — one value per cell, not a spatial pattern."
          options={volumetric ? FIELD_TOGGLE_COLOR_3D : FIELD_TOGGLE_COLOR}
          value={field}
          onChange={(v) => onParam(`cfield${slot}`, v)}
        />
        <SliderRow
          className="voice-slider"
          title="Freq — spatial frequency: how many oscillation cycles this voice packs across the surface."
        >
          <span>freq</span>
          <SliderTrack className="voice-slider-track">
            <input
              type="range"
              min={0}
              max={1}
              step={0.001}
              value={freqToSlider(num("freq"), CFREQ_MAX)}
              style={fill(freqToSlider(num("freq"), CFREQ_MAX), 0, 1)}
              onChange={(e) => onParam(`cfreq${slot}`, freqFromSlider(+e.target.value, CFREQ_MAX))}
            />
          </SliderTrack>
          <EditableReadout
            value={num("freq")}
            min={0}
            max={CFREQ_MAX}
            format={(v) => (v < 2 ? v.toFixed(2) : v.toFixed(1))}
            onCommit={(v) => onParam(`cfreq${slot}`, v)}
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
              onChange={(e) => onParam(`cspeed${slot}`, +e.target.value)}
            />
          </SliderTrack>
          <EditableReadout
            value={num("speed")}
            min={-8}
            max={8}
            format={(v) => v.toFixed(2)}
            onCommit={(v) => onParam(`cspeed${slot}`, v)}
          />
        </SliderRow>
        {showAdvanced && (
          <SliderRow
            className="voice-slider"
            title="Mix — a MIX WEIGHT, not a volume: blends the running colour-stack result toward combine(result, this voice) by this amount. 0 skips the voice entirely."
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
                onChange={(e) => onParam(`camp${slot}`, +e.target.value)}
              />
            </SliderTrack>
            <EditableReadout
              value={num("amp")}
              min={0}
              max={1}
              format={(v) => v.toFixed(2)}
              onCommit={(v) => onParam(`camp${slot}`, v)}
            />
          </SliderRow>
        )}
        {f("wave") === "square" && (
          <SliderRow className="voice-slider" title="Duty — the square wave's high fraction.">
            <span>duty</span>
            <SliderTrack className="voice-slider-track">
              <input
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={num("duty")}
                style={fill(num("duty"), 0, 1)}
                onChange={(e) => onParam(`cduty${slot}`, +e.target.value)}
              />
            </SliderTrack>
            <EditableReadout
              value={num("duty")}
              min={0}
              max={1}
              format={(v) => v.toFixed(2)}
              onCommit={(v) => onParam(`cduty${slot}`, v)}
            />
          </SliderRow>
        )}
        {showAdvanced && (
          <SliderRow className="voice-slider" title="Phase — added to this voice's wave argument, in cycles.">
            <span>phase</span>
            <SliderTrack className="voice-slider-track">
              <input
                type="range"
                min={-1}
                max={1}
                step={0.01}
                value={num("phase")}
                style={fill(num("phase"), -1, 1)}
                onChange={(e) => onParam(`cphase${slot}`, +e.target.value)}
              />
            </SliderTrack>
            <EditableReadout
              value={num("phase")}
              min={-1}
              max={1}
              format={(v) => v.toFixed(2)}
              onCommit={(v) => onParam(`cphase${slot}`, v)}
            />
          </SliderRow>
        )}
        {isSdfIterField(field) && (
          <SliderRow
            className="voice-slider"
            title="Iterations — recursion depth of the box (menger) / corner-tetra (sierpinski) fractal."
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
                onChange={(e) => onParam(`citer${slot}`, +e.target.value)}
              />
            </SliderTrack>
            <EditableReadout
              value={num("iter")}
              min={1}
              max={4}
              integer
              format={(v) => String(v)}
              onCommit={(v) => onParam(`citer${slot}`, v)}
            />
          </SliderRow>
        )}
        {showAdvanced && canPlace && (
          <button
            type="button"
            className={`voice-placement-toggle${placementOpen ? " is-open" : ""}`}
            onClick={() => setPlacementOverride((o) => !o)}
            title="Placement — where this colour voice's field is centred and which way it runs."
          >
            {placementOpen ? "▾" : "▸"} placement
          </button>
        )}
        {showAdvanced && placementOpen && (
          <div className="voice-placement">
            <VoiceFieldMap params={params} slot={slot} keyPrefix="c" fallbackColor={COLOR_VOICE_ACCENT} />
            <div className="voice-placement-rows">
              {angleApplies(field) && (
                <SliderRow
                  className="voice-slider"
                  title="Angle — rotates this voice's sampling frame about its own origin, in degrees."
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
                      onChange={(e) => onParam(`cangle${slot}`, +e.target.value)}
                    />
                  </SliderTrack>
                  <EditableReadout
                    value={num("angle")}
                    min={-180}
                    max={180}
                    format={(v) => `${v.toFixed(0)}°`}
                    onCommit={(v) => onParam(`cangle${slot}`, v)}
                  />
                </SliderRow>
              )}
              <SliderRow
                className="voice-slider"
                title="Origin U — offsets THIS voice's centre from the global origin."
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
                    onChange={(e) => onParam(`coriginU${slot}`, +e.target.value)}
                  />
                </SliderTrack>
                <EditableReadout
                  value={num("originU")}
                  min={-1}
                  max={1}
                  format={(v) => v.toFixed(2)}
                  onCommit={(v) => onParam(`coriginU${slot}`, v)}
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
                    onChange={(e) => onParam(`coriginV${slot}`, +e.target.value)}
                  />
                </SliderTrack>
                <EditableReadout
                  value={num("originV")}
                  min={-1}
                  max={1}
                  format={(v) => v.toFixed(2)}
                  onCommit={(v) => onParam(`coriginV${slot}`, v)}
                />
              </SliderRow>
              {(volumetric || isSdfField(field)) && (
                <SliderRow className="voice-slider" title="Origin W — as Origin U/V, on the third (depth) axis.">
                  <span>w</span>
                  <SliderTrack className="voice-slider-track">
                    <input
                      type="range"
                      min={-1}
                      max={1}
                      step={0.01}
                      value={num("originW")}
                      style={fill(num("originW"), -1, 1)}
                      onChange={(e) => onParam(`coriginW${slot}`, +e.target.value)}
                    />
                  </SliderTrack>
                  <EditableReadout
                    value={num("originW")}
                    min={-1}
                    max={1}
                    format={(v) => v.toFixed(2)}
                    onCommit={(v) => onParam(`coriginW${slot}`, v)}
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
