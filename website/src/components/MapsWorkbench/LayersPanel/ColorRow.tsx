import { parseMapsHex } from "../../../features/maps/model/inputs";
import { SliderTrack } from "../../SliderRow";
import { MapsReadout } from "../MapsReadout";

/**
 * The Dock's own colour controller, reproduced: a 10px bracketed swatch bar
 * filling the widget column (its `[ ]` come from `.voice-slider-track`, the
 * same wrapper the sliders use, so the two read as one control family) plus
 * an EDITABLE hex field in the value column — see `.dn-floating-controls
 * .lil-gui .controller.color` in gallery-workbench.css. Replaces an 18px
 * square swatch that had no counterpart in the Dock and no way to type a
 * colour at all.
 */
export function ColorRow({
  label = "color",
  value,
  onChange,
  title,
}: {
  label?: string;
  value: string;
  onChange: (v: string) => void;
  title?: string;
}) {
  return (
    <label className="maps-layer-color-row" title={title ?? `${label} — click the bar to pick, or type a hex value`}>
      <span>{label}</span>
      <SliderTrack className="voice-slider-track maps-layer-swatch">
        <input type="color" value={value} onChange={(e) => onChange(e.target.value)} />
      </SliderTrack>
      <MapsReadout
        value={value}
        className="maps-layer-hex"
        inputMode="text"
        format={(v) => v}
        parse={(raw) => {
          const hex = parseMapsHex(raw);
          return hex === null ? null : { value: hex };
        }}
        onCommit={onChange}
        title="Type a hex colour (#rgb or #rrggbb)."
      />
    </label>
  );
}
