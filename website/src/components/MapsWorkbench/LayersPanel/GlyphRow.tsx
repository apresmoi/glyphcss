import { type MapLayerGlyphPalette, GLYPH_PALETTE_OPTIONS } from "../../../features/maps/model/config";
import { BracketSelect } from "../../BracketSelect";

/**
 * Per-layer GLYPH palette — the CHARACTER ramp. Carried by EVERY mesh-backed
 * card (`raster`, `fill`, `fill-extrusion`, `heatmap`, `model`), which is a
 * WIDER set than `ModeRow`'s since that row was cut back to
 * `fill-extrusion`/`model`. The two rows are not the same question: a ramp
 * changes which characters carry a shade, so it is exactly as meaningful on
 * a solid-by-nature surface as anywhere else and costs a separate pass only
 * when it differs from {@link MAP_SCENE_GLYPH_PALETTE}. The cards that carry
 * neither row are `line`/`contour` — stamped post-raster, already emitting
 * their own oriented stroke glyphs (glyphcss documents `glyphPalette` as a
 * no-op there) — and `symbol`/`circle`, which mount DOM hotspots rather than
 * geometry.
 *
 * The row is labelled `glyphs`, never `palette`, because the Terrain card
 * ALSO carries a colour ramp — labelled `colors` — and the two are different
 * axes: `colors` picks which colour an elevation band is painted in,
 * `glyphs` picks which characters carry the shade. Both titles say so
 * explicitly and name the other.
 *
 * "Default" is the scene's own ramp, so choosing it is free — `@glyphcss/maps`
 * only sets the per-mesh option when the layer's ramp genuinely differs
 * (`glyphMapMeshTransform`). Every other choice buys this layer a second full
 * rasterizer pass, which is what the tooltip warns about.
 */
export function GlyphRow({
  label,
  value,
  onChange,
}: {
  label: string;
  value: MapLayerGlyphPalette;
  onChange: (v: MapLayerGlyphPalette) => void;
}) {
  return (
    <label
      className="maps-layer-select-row"
      title={`${label} glyph palette — the CHARACTER ramp this layer shades with (not its colours; that is the "colors" row). "Default" is the scene's own ramp and costs nothing; any other ramp renders this layer in its own pass.`}
    >
      <span>glyphs</span>
      <BracketSelect value={value} onChange={(e) => onChange(e.target.value as MapLayerGlyphPalette)}>
        {Object.entries(GLYPH_PALETTE_OPTIONS).map(([display, id]) => (
          <option key={id} value={id}>
            {display}
          </option>
        ))}
      </BracketSelect>
    </label>
  );
}
