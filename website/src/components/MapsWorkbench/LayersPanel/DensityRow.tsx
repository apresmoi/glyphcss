import { DENSITY_MAX, DENSITY_MIN, DENSITY_STEP, formatDensity } from "../../../features/maps/model/config";
import { densityFill, parseMapsNumber } from "../../../features/maps/model/inputs";
import { SliderRow, SliderTrack } from "../../SliderRow";
import { MapsReadout } from "../MapsReadout";

export function DensityRow({
  label,
  density,
  onDensity,
  enabled,
}: {
  label: string;
  density: number;
  onDensity: (v: number) => void;
  enabled: boolean;
}) {
  // `density` is a plain multiplier with no integer requirement — glyphcss's
  // own per-mesh detail-layer math (cell size, silhouette-fit grid sizing,
  // and cross-layer occlusion id-map sampling) treats it as a continuous
  // ratio throughout (`createGlyphScene.ts`'s density path — verified
  // end-to-end at fractional values in `widget.fractionalDensity.test.ts`
  // before this step changed), so a whole-number-only slider was an
  // artificial UI restriction, not a renderer constraint. `toFixed(1)`
  // keeps the readout a clean one-decimal string at every step rather than
  // whatever the raw float happens to print as.
  return (
    <SliderRow
      className={`voice-slider maps-layer-slider${enabled ? "" : " maps-layer-slider--off"}`}
      title={
        enabled
          ? `${label} density — glyph resolution multiplier for this layer (1x-4x)`
          : `${label} density — not wired through to the renderer for this layer type yet`
      }
    >
      <span>density</span>
      <SliderTrack className="voice-slider-track">
        <input
          type="range"
          min={DENSITY_MIN}
          max={DENSITY_MAX}
          step={DENSITY_STEP}
          disabled={!enabled}
          value={density}
          style={densityFill(density, DENSITY_MIN, DENSITY_MAX)}
          onChange={(e) => onDensity(+e.target.value)}
        />
      </SliderTrack>
      <MapsReadout
        value={density}
        disabled={!enabled}
        format={formatDensity}
        parse={parseMapsNumber(DENSITY_MIN, DENSITY_MAX)}
        onCommit={onDensity}
        title="Type a multiplier between 1 and 4."
      />
    </SliderRow>
  );
}
