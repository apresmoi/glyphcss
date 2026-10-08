import { densityFill } from "../../../features/maps/model/inputs";
import { ELEVATION_WINDOW_STEP, parseElevationWindowEnd } from "../../../features/maps/model/terrain";
import { SliderRow, SliderTrack } from "../../SliderRow";
import { MapsReadout } from "../MapsReadout";

/**
 * One end of the contour elevation window. The track is the field's own data
 * range; dragging the handle to the track's far end (the bottom for a floor,
 * the top for a ceiling) means UNBOUNDED — which is why `null` is a real
 * value here rather than the track's endpoint: the endpoint moves as the
 * view's terrain changes, and "no floor" must not silently become "a floor
 * at whatever the deepest visible cell was".
 *
 * The readout is editable ({@link parseElevationWindowEnd}) because that
 * sentinel makes the DRAG unable to express one of the values a reader most
 * wants: a floor of exactly 0 m is only reachable by dragging when the view's
 * own data range happens to straddle sea level on a 50 m detent. Typing does
 * not snap to that 50 m step either — the URL persists this window at 10 m.
 */
/**
 * One end of an elevation window: a slider whose far end IS "off", plus an
 * editable readout that prints and accepts `off`. Shared by the Contour
 * card's floor/ceiling and the Terrain card's — the same two numbers in the
 * same units, so they get the same control rather than two lookalikes.
 */
export function ElevationWindowRow({
  end,
  value,
  onChange,
  track,
  title,
}: {
  end: "floor" | "ceiling";
  value: number | null;
  onChange: (v: number | null) => void;
  track: { readonly min: number; readonly max: number };
  title: string;
}) {
  const off = end === "floor" ? track.min : track.max;
  const shown = value ?? off;
  return (
    <SliderRow className="voice-slider maps-layer-slider" title={title}>
      <span>{end}</span>
      <SliderTrack className="voice-slider-track">
        <input
          type="range"
          min={track.min}
          max={track.max}
          step={ELEVATION_WINDOW_STEP}
          value={shown}
          style={densityFill(shown, track.min, track.max)}
          onChange={(e) => {
            const next = +e.target.value;
            onChange(next === off ? null : next);
          }}
        />
      </SliderTrack>
      <MapsReadout
        value={value}
        format={(v) => (v === null ? "off" : `${v}m`)}
        parse={parseElevationWindowEnd}
        onCommit={onChange}
        title={`Type an elevation in metres — 0 is sea level. Empty, or "off", for no ${end}.`}
      />
    </SliderRow>
  );
}
