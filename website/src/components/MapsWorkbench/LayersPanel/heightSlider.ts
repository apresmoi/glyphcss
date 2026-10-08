import { parseHeightMeters } from "../../../features/maps/model/inputs";
import { formatHeightMeters } from "../../../features/maps/model/terrain";
import { type LayerSliderSpec } from "./types";

/**
 * Builds a `LayerSliderSpec` whose `<input type="range">` travels linearly
 * over LOG POSITION (equal on-screen travel per decade) while the caller's
 * `value`/`onChange` stay in the real, linear unit (metres) — the same
 * value-space transform `website/src/lib/urlState.ts`'s `"logFloat"` kind and
 * `SynthWorkbench`'s `LogSliderRow` both use for a range spanning orders of
 * magnitude. This intentionally does NOT render `LogSliderRow` itself: that
 * component reproduces the Dock's lil-gui row markup
 * (`.controller.number.hasSlider`), a different DOM/CSS shape than this
 * panel's `.voice-slider` card rows — swapping it in here would be a SECOND
 * control style on one card, not a reused one. Reusing the math instead of
 * the widget keeps every row in `LayersPanel` rendering through the exact
 * same `.voice-slider` markup regardless of whether its scale is linear or
 * log.
 *
 * `min`/`max` are the real bounds in metres and must both be `> 0` (a log
 * scale has no zero). The underlying `<input>`'s own `min`/`max` are the
 * fixed `[0, 1]` position domain — `densityFill`'s linear fraction over that
 * domain is exactly the log-fraction over the real range, so the fill bar
 * reads correctly for free.
 */
export function logHeightSliderSpec({
  key,
  label,
  min,
  max,
  value,
  onChange,
  title,
}: {
  key: string;
  label: string;
  min: number;
  max: number;
  value: number;
  onChange: (v: number) => void;
  title: string;
}): LayerSliderSpec {
  const logSpan = Math.log(max / min);
  const toPos = (v: number) => Math.log(Math.min(max, Math.max(min, v)) / min) / logSpan;
  const toValue = (pos: number) => min * Math.exp(Math.min(1, Math.max(0, pos)) * logSpan);
  return {
    key,
    label,
    min: 0,
    max: 1,
    step: 0.001,
    title,
    value: toPos(value),
    format: (pos) => formatHeightMeters(toValue(pos)),
    // The readout is the ONLY way to hit an exact height on this row: a log
    // slider's 0.001 position step is sub-metre at the bottom of the range
    // and hundreds of metres at the top. Typed text is real metres (or km),
    // clamped to the row's real bounds and converted back into position
    // space, so the slider and the readout stay one control.
    parse: (raw) => {
      const metres = parseHeightMeters(raw);
      if (metres === null) return null;
      return { value: toPos(metres) };
    },
    onChange: (pos) => onChange(toValue(pos)),
  };
}
