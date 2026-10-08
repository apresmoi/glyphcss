import { type CSSProperties, type ReactNode } from "react";
import {
  type Params,
  type ParamValue,
  LAYER_COMBINE_VALUES,
  LAYER_VALUE_OPS,
} from "../../../features/synth/model/parameters";
import { ActionButton } from "../../ActionButton";
import { BracketSelect } from "../../BracketSelect";
import { CollapsibleSection } from "../../ControlSection";
import { EditableReadout } from "../../EditableReadout";
import { SliderRow, SliderTrack } from "../../SliderRow";

// ── Layer group (VOLUMETRIC-2.md §4, a rewrite of the old lil-gui
// LayerSection above — not a relocation): the voice sidebar is React, and
// this component now OWNS both the group's own shaping controls AND the
// nested voice cards, replacing the dock's separate "Layers" lil-gui folder
// entirely (that folder held only the shaping knobs; the cards lived in a
// flat list elsewhere — two places for one concept).
//
// Header compression: `.layer-group-head` is a flex ROW (not, as originally
// shipped, a single click-to-toggle `<button>` spanning the whole row) —
// `.layer-group-toggle` is the actual button (caret + "Layer N", the
// collapse/expand click target), and `combine`/`blend` sit beside it as
// their own compact `<BracketSelect>`s. Splitting the click target out of the
// button this way is what lets a `<BracketSelect>` live on the header row at all:
// nested inside the toggle button it would fight that button's own click
// handler (a native `<BracketSelect>` inside a `<button>` either can't open or
// double-fires the parent's onClick, browser-dependent) — as siblings, each
// owns its own input events cleanly. The body below keeps only what doesn't
// fit the header: "mix" (`layerAmpL` — same label as a voice's own "mix" on
// purpose: group opacity vs. element opacity), threshold toggle + value, and
// invert — mix/threshold-toggle/invert share one row, and the threshold
// VALUE slider only renders its own row when the toggle is on, since most
// layers leave it off (VOLUMETRIC.md's Step 3 default).
//
// `layerCombineL` (how the layer's OWN voices fold together before the layer
// blends into the stack) went uneditable in the original rewrite —
// VOLUMETRIC-2.md §4's header list omitted it, a spec defect: Menger/
// Sierpinski-membership-style multi-layer recipes (see
// `GlyphSierpinskiPyramidPreset` in packages/effects/src/stock.ts) set a
// non-default `layerCombineL`, so a live control is needed to actually
// tune those patches rather than only read/write them via preset/URL. It
// resolves BEFORE the layer's blended output exists, so it sits left of
// `blend` on the header row.
export function LayerGroup({
  layer,
  params,
  onParam,
  onAddVoice,
  canAddVoice,
  children,
}: {
  layer: number;
  params: Params;
  onParam: (key: string, value: ParamValue) => void;
  onAddVoice: (layer: number) => void;
  canAddVoice: boolean;
  children: ReactNode;
}) {
  const s = (k: string) => String(params[`${k}${layer}`] ?? "");
  const n = (k: string) => Number(params[`${k}${layer}`] ?? 0);
  const b = (k: string) => params[`${k}${layer}`] === true;
  const thresholdOn = b("layerThresholdOn");
  const fill = (v: number, min: number, max: number) =>
    ({ ["--fill" as string]: `${((v - min) / (max - min)) * 100}%` }) as CSSProperties;
  return (
    <CollapsibleSection
      title={`Layer ${layer}`}
      label={`Layer ${layer}`}
      actions={
        <>
          {" "}
          <label
            className="layer-group-head-select"
            title="Combine — how this layer's OWN voices fold together, before the layer's blended output joins the stack. &quot;inherit&quot; follows the patch-level Combine (Mix folder)."
          >
            <BracketSelect value={s("layerCombine")} onChange={(e) => onParam(`layerCombine${layer}`, e.target.value)}>
              {LAYER_COMBINE_VALUES.map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </BracketSelect>
          </label>
          <label
            className="layer-group-head-select"
            title="Blend — how this layer's shaped output folds into the running result across layers."
          >
            <BracketSelect value={s("layerBlend")} onChange={(e) => onParam(`layerBlend${layer}`, e.target.value)}>
              {LAYER_VALUE_OPS.map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </BracketSelect>
          </label>
        </>
      }
    >
      <div className="layer-group-controls">
        <div className="layer-group-row2">
          <label
            className="layer-group-check layer-group-check--compact"
            title="Invert — flips which side of the layer's result counts as solid."
          >
            <span>inv</span>
            <input
              type="checkbox"
              checked={b("layerInvert")}
              onChange={(e) => onParam(`layerInvert${layer}`, e.target.checked)}
            />
          </label>
          <SliderRow
            className="voice-slider layer-group-mix"
            title="Mix — this LAYER's own opacity into the stack (same idea as a voice's own mix, one level up: group opacity vs. element opacity)."
          >
            <span>mix</span>
            <SliderTrack className="voice-slider-track">
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={n("layerAmp")}
                style={fill(n("layerAmp"), 0, 1)}
                onChange={(e) => onParam(`layerAmp${layer}`, +e.target.value)}
              />
            </SliderTrack>
            <EditableReadout
              value={n("layerAmp")}
              min={0}
              max={1}
              format={(v) => v.toFixed(2)}
              onCommit={(v) => onParam(`layerAmp${layer}`, v)}
            />
          </SliderRow>
        </div>
        {/* Stable row — the slider is always mounted (user report: toggling
                threshold used to insert/remove a whole row and jump the layout).
                The checkbox sits directly in front of it and stays the enable/
                disable control; the slider itself goes `disabled` and dims when
                off, but its value stays readable either way. */}
        <div className="layer-group-row2">
          <label
            className="layer-group-check layer-group-check--compact"
            title="Threshold — cuts the layer's combined value at a level instead of shading it continuously."
          >
            <span>thr</span>
            <input
              type="checkbox"
              checked={thresholdOn}
              onChange={(e) => onParam(`layerThresholdOn${layer}`, e.target.checked)}
            />
          </label>
          <SliderRow
            className={`voice-slider layer-group-mix layer-group-threshold-slider${thresholdOn ? "" : " layer-group-threshold-slider--off"}`}
            title="Threshold value — the level the layer's combined value is cut against. A thresholded layer's folded value maps to ±1, so this range spans the ±1 signal's usable extent. Only active while the checkbox is on."
          >
            <SliderTrack className="voice-slider-track">
              <input
                type="range"
                min={-3}
                max={3}
                step={0.05}
                disabled={!thresholdOn}
                value={n("layerThreshold")}
                style={fill(n("layerThreshold"), -3, 3)}
                onChange={(e) => onParam(`layerThreshold${layer}`, +e.target.value)}
              />
            </SliderTrack>
            <EditableReadout
              value={n("layerThreshold")}
              min={-3}
              max={3}
              disabled={!thresholdOn}
              format={(v) => v.toFixed(2)}
              onCommit={(v) => onParam(`layerThreshold${layer}`, v)}
            />
          </SliderRow>
        </div>
      </div>
      <div className="layer-group-voices">{children}</div>
      <ActionButton
        type="button"
        className="layer-group-add"
        onClick={() => onAddVoice(layer)}
        disabled={!canAddVoice}
        title={`Add a voice assigned to layer ${layer}`}
      >
        + Add to layer {layer}
      </ActionButton>
    </CollapsibleSection>
  );
}
