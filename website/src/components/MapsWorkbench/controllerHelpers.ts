import { type MapCharMode } from "../../features/maps/services/mapsUrlState";

export const BACKGROUND_LAYER_ID = "background";

export const TERRAIN_LAYER_ID = "terrain";

export const BORDER_LAYER_ID = "borders";

export const CONTOUR_LAYER_ID = "contour";

export const EXTRA_LAYER_IDS = ["fill", "symbol", "circle", "heatmap", "fill-extrusion", "model"] as const;

export const BASE_FONT_PX = 13;

/**
 * Mesh-backed layers — the ones a GLYPH PALETTE (character ramp) can apply
 * to. `line`/`contour` are stamped post-raster and already emit their own
 * oriented stroke glyphs; `symbol`/`circle` mount DOM hotspots.
 */
export const MESH_LAYER_IDS = ["fill", "heatmap", "fill-extrusion", "model"] as const;

/**
 * The layers that carry a RENDER MODE row — a strict subset of
 * {@link MESH_LAYER_IDS}. `fill` and `heatmap` are shaded-MAGNITUDE surfaces
 * exactly as terrain is (a filled country, a density relief), so they are
 * pinned to `MAP_SCENE_RENDER_MODE` with no control, the same way terrain
 * already was: `wireframe`/`ink` show a cage or an outline carrying none of
 * the information those layers exist to carry, and separating an OPAQUE
 * layer into its own pass was measured at ~+8.8 ms/frame — a way to spend a
 * third of the frame budget for nothing. See `mapsKit.tsx`'s `ModeRow` doc.
 */
export const RENDER_MODE_LAYER_IDS = ["fill-extrusion", "model"] as const;

/**
 * `/maps`'s own "Character mode" option list — every `MapCharMode` EXCEPT
 * Braille (`useRenderingFolder.ts`'s `charModeOptions` prop; the shared
 * `CHAR_MODE_OPTIONS` default every other page keeps includes it). Braille
 * only encodes `wireframe` mode, and this page pins its scene to `solid`
 * with no way to change it (`MAP_SCENE_RENDER_MODE`), so Braille can never
 * do anything here — dropped from the picker entirely rather than shown
 * disabled (`glyphMapCharModeAvailability.ts` covers the OTHER, live-
 * condition no-ops this page's `charModeReason` surfaces instead).
 */
export const MAPS_CHAR_MODE_OPTIONS: Record<string, MapCharMode> = {
  ASCII: "ascii",
  Halfblock: "halfblock",
  Quadrant: "quadrant",
};

/**
 * Where the `model` layer's landmark spike stands: Zermatt / the Matterhorn,
 * inside the curated Switzerland bundle this site already bakes at its
 * deepest zoom — so the one place the map has real detail for is the one
 * place worth putting a 3D marker on. `model` takes caller-authored
 * `Polygon[]` and has no data source of its own (see `mapPin.ts`), so this
 * is a coordinate, not a dataset.
 */
export const MODEL_ANCHOR: readonly [number, number] = [7.7491, 45.9766];
