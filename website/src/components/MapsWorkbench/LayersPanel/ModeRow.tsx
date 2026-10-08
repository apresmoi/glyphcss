import {
  type MapLayerRenderMode,
  LAYER_RENDER_MODES,
  LAYER_RENDER_MODE_LABELS,
} from "../../../features/maps/model/config";
import { BracketSelect } from "../../BracketSelect";

export function ModeRow({
  label,
  value,
  onChange,
}: {
  label: string;
  value: MapLayerRenderMode;
  onChange: (v: MapLayerRenderMode) => void;
}) {
  return (
    <label
      className="maps-layer-select-row"
      title={`${label} render mode — how THIS layer rasterizes. "Solid" is the scene's own mode and costs nothing; any other mode renders this layer in its own pass.`}
    >
      <span>mode</span>
      <BracketSelect value={value} onChange={(e) => onChange(e.target.value as MapLayerRenderMode)}>
        {LAYER_RENDER_MODES.map((mode) => (
          <option key={mode} value={mode}>
            {LAYER_RENDER_MODE_LABELS[mode]}
          </option>
        ))}
      </BracketSelect>
    </label>
  );
}
