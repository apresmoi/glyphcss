import {
  type GlyphMapClassifier,
  type GlyphMapLabelAnchor,
  type GlyphMapProjection,
  type GlyphMapSunMode,
  glyphMapEquirectangular,
  glyphMapGlobe,
  glyphMapMercator,
} from "@glyphcss/maps";
import { type CountryTileLayer, COUNTRY_TILE_LAYERS } from "../providers/countryTilesProvider";
import { type PlaceTileLayer, PLACE_TILE_LAYERS } from "../providers/placeTilesProvider";

// ── Projections ────────────────────────────────────────────────────────────

export type MapProjectionId = "equirectangular" | "mercator" | "globe";

/** Re-exported under the page's own naming so `mapsUrlState`/`MapsWorkbench` speak one type. `"off"` is the UI's "Full". */
export type MapSunMode = GlyphMapSunMode;

export const PROJECTION_OPTIONS: Record<string, MapProjectionId> = {
  Equirectangular: "equirectangular",
  Mercator: "mercator",
  Globe: "globe",
};

export function buildMapProjection(id: MapProjectionId, exaggeration: number): GlyphMapProjection {
  switch (id) {
    case "equirectangular":
      return glyphMapEquirectangular({ exaggeration });
    case "mercator":
      return glyphMapMercator({ exaggeration });
    case "globe":
      return glyphMapGlobe({ exaggeration });
  }
}

export function isOrbitProjectionId(id: MapProjectionId): boolean {
  return id === "globe";
}

// ── Render mode ────────────────────────────────────────────────────────────

/**
 * A LAYER's render mode (`@glyphcss/maps`' `GlyphMapLayer.renderMode`, which
 * routes to glyphcss's per-mesh `GlyphMeshTransform.mode`). `/maps` has no
 * scene-wide render-mode control: a map is not one picture in one mode —
 * terrain reads as `solid` while an overlay reads as `ink`.
 */
export type MapLayerRenderMode = "wireframe" | "solid" | "ink";

/**
 * The mode the SHARED base grid rasterizes in, and so the mode a layer that
 * declares none inherits. Fixed, not a control. Keeping it `"solid"` is what
 * makes a layer that also picks `"solid"` free: glyphcss only splits a mesh
 * into its own rasterizer pass when its mode genuinely differs from this one.
 */
export const MAP_SCENE_RENDER_MODE: MapLayerRenderMode = "solid";

// ── Glyph palettes (the CHARACTER ramp) ────────────────────────────────────

/**
 * A LAYER's glyph palette (`@glyphcss/maps`' `GlyphMapLayer.glyphPalette`,
 * which routes to glyphcss's per-mesh `GlyphMeshTransform.glyphPalette`).
 * `/maps` has no scene-wide glyph-palette control for the same reason it has
 * no scene-wide render mode: terrain, an extrusion and a landmark model are
 * not one picture in one ramp.
 *
 * This is NOT {@link MapPaletteName}. That one is a COLOUR ramp — which
 * colour each elevation band is painted in. This one is the CHARACTER ramp —
 * which glyphs carry the shade. Both live on the same card, labelled
 * `colors` and `glyphs` respectively (see `LayersPanel`).
 *
 * The value set mirrors what the Dock's shared "Glyph palette" row offered
 * before this moved, `"calibrated"` included: that name is registered into
 * glyphcss's `WIREFRAME_PALETTES` as an import-time side effect of
 * `Dock/folders/useRenderingFolder.ts`, which `MapsWorkbench` mounts.
 */
export type MapLayerGlyphPalette =
  | "default"
  | "ascii"
  | "lines"
  | "blocks"
  | "stars"
  | "arrows"
  | "math"
  | "binary"
  | "hex"
  | "calibrated";

export const GLYPH_PALETTE_OPTIONS: Record<string, MapLayerGlyphPalette> = {
  Default: "default",
  ASCII: "ascii",
  Lines: "lines",
  Blocks: "blocks",
  Stars: "stars",
  Arrows: "arrows",
  Math: "math",
  Binary: "binary",
  Hex: "hex",
  Calibrated: "calibrated",
};

/**
 * The ramp the SHARED base grid rasterizes against, and so the ramp a layer
 * that names none inherits. Fixed, not a control — the exact counterpart of
 * {@link MAP_SCENE_RENDER_MODE}, and load-bearing for the same reason:
 * `@glyphcss/maps` only splits a mesh into its own rasterizer pass when the
 * layer's ramp genuinely differs from this one, so a card left on "Default"
 * costs nothing at all.
 */
export const MAP_SCENE_GLYPH_PALETTE: MapLayerGlyphPalette = "default";

// ── Point datasets (which baked point pyramid drives a point layer) ────────

/**
 * Every dataset a `symbol`/`circle`/`heatmap` card can select, across BOTH
 * point pyramids: `countries` is the admin-0 label-point bake
 * (`bake-country-tiles.mjs`), the other three are populated-places
 * `sourceLayer`s (`bake-place-tiles.mjs`).
 *
 * They are two separate pyramids behind two separate providers rather than
 * one pyramid with four `sourceLayer`s because attribution is derived from
 * the mounted layer's own provider, never hardcoded: these are two different
 * Natural Earth files with two different provenance records, and a tile
 * carries one attribution list (see `countryTilesProvider.ts`'s doc).
 */
export type PointDataset = PlaceTileLayer | CountryTileLayer;

export const COUNTRY_DATASET: CountryTileLayer = "countries";

export function isCountryDataset(value: PointDataset): value is CountryTileLayer {
  return value === COUNTRY_DATASET;
}

/** Display names, in the picker's own order — countries first, since it is the `symbol`/`circle` default. */
export const POINT_DATASET_LABELS: Record<PointDataset, string> = {
  countries: "Countries",
  places: "Cities",
  capitals: "Capitals",
  megacities: "Megacities (5M+)",
};

export const POINT_DATASET_OPTIONS = [...COUNTRY_TILE_LAYERS, ...PLACE_TILE_LAYERS].map((value) => ({
  value,
  label: POINT_DATASET_LABELS[value],
}));

/** Layers driven by a POINT pyramid — the ones that get a dataset picker. */
export const POINT_LAYER_IDS = ["symbol", "circle", "heatmap"] as const;

/**
 * Each point layer's STARTING dataset. Lives here rather than inline in
 * `MapsWorkbench.tsx`'s `useState` so a test can assert the values the page
 * is actually wired to without importing the whole page component (whose
 * import chain reaches packages the website does not depend on) — the same
 * reason {@link EXTRUSION_HEIGHT_BOUNDS_M} is exported.
 *
 * `symbol` is COUNTRIES: a country name is the label a reader expects a world
 * map to carry, there are only 242 of them (against 1,251 cities, every one
 * of which costs a DOM hotspot to reach a decluttered handful), and Natural
 * Earth's `LABELRANK` gives the declutter a real prominence order so a world
 * view shows the giants rather than an arbitrary subset.
 *
 * `circle` is countries too, and ONLY because the countries bake carries a
 * genuine magnitude to size by — `pop_scale`, the same log-normalized
 * population column the places pyramid writes, so the layer needs no branch
 * at all. A dataset with nothing to size by would render 242 identical dots,
 * which would be a worse default than population-sized cities; that is not
 * the case here.
 *
 * `heatmap` stays on cities: a density field wants many samples, and 242
 * country label points are a scatter, not a field.
 */
export const POINT_DATASET_DEFAULTS: Readonly<Record<(typeof POINT_LAYER_IDS)[number], PointDataset>> = {
  symbol: COUNTRY_DATASET,
  circle: COUNTRY_DATASET,
  heatmap: "places",
};

// ── Terrain palettes (elevation bands -> color), matching `GlyphMapClassifiers
//    .etopo1V1`'s 8 breaks / 9 bands ([0,250,800,1600,2600,3600,4600,5600]) —
//    same table `/examples/flatmap.astro` ships, so a viewer who knows that
//    page sees the same names/looks here. ───────────────────────────────────

export type MapPaletteName = "terrain" | "viridis" | "heat" | "ocean" | "grayscale" | "mono";

export const MAP_PALETTES: Record<MapPaletteName, readonly string[]> = {
  terrain: ["#2a55a8", "#2f5a36", "#3f6b32", "#5f7536", "#86713f", "#9c7b50", "#b09471", "#cdb49a", "#f0f0f0"],
  viridis: ["#21295c", "#443983", "#31688e", "#21918c", "#35b779", "#90d743", "#cae11f", "#e8e419", "#fde725"],
  heat: ["#0a1430", "#3b0f2e", "#6b1f2e", "#9c3a1f", "#c8651a", "#e89a1c", "#f4c83a", "#f8e98a", "#ffffff"],
  ocean: ["#041f3f", "#0b3a6b", "#1e5aa8", "#3a86c8", "#69aede", "#9fcdef", "#c8e4f7", "#e8f4ff", "#ffffff"],
  grayscale: ["#10243a", "#3a3a3a", "#4d4d4d", "#616161", "#767676", "#8c8c8c", "#a3a3a3", "#cccccc", "#ffffff"],
  mono: Array(9).fill("#ffe8b8"),
};

export const PALETTE_OPTIONS: Record<string, MapPaletteName> = {
  Terrain: "terrain",
  Viridis: "viridis",
  Heat: "heat",
  Ocean: "ocean",
  Grayscale: "grayscale",
  Mono: "mono",
};

export function paletteColorsFor(
  name: MapPaletteName,
  classifier: GlyphMapClassifier,
): (elev: number) => string | undefined {
  const colors = MAP_PALETTES[name];
  return (elev: number) => {
    const band = classifier.classifyValue ? classifier.classifyValue(elev) : 0;
    return colors[band] ?? colors[colors.length - 1];
  };
}

/**
 * Exported for `LayersPanel.dockRows.test.tsx`: `LayersPanel` itself mounts
 * this row `enabled` at all three of its call sites, so the gated state — a
 * dimmed row whose slider AND readout are both disabled, the Dock's own
 * `.controller.disabled` treatment — has no reachable path through the panel
 * to assert it from.
 */
/**
 * The density track every row on this rail shares — glyphcss's per-mesh
 * detail-resolution multiplier. Module constants, not literals repeated per
 * row, because the OSM card's per-row rows have to land on the SAME track as
 * `DensityRow` or the card reads as a second control family.
 */
export const DENSITY_MIN = 1;

export const DENSITY_MAX = 4;

export const DENSITY_STEP = 0.1;

export const formatDensity = (v: number) => `${v.toFixed(1)}x`;

/**
 * One OpenStreetMap row: its toggle and, where the renderer reads one, its
 * own density — on ONE line.
 *
 * The card mounts one layer per OpenMapTiles source row and used to give all
 * of them a single density, so sharpening roads meant sharpening land cover
 * too. Per-row is now the whole feature: the card carries NO master, because
 * a second control standing for every row at once is redundant beside the
 * rows themselves and its only distinct reading — "mixed" — was a statement
 * about the controls rather than about the map. The `stroke grids` row above
 * is what still speaks for the card as a whole, and it matters more now: a
 * reader can no longer flatten every stroke back to one number in one drag,
 * so the live grid count is the thing telling them why the frame got slow.
 *
 * The control is the rail's own — the same 1..4/0.1 track and the same
 * editable `MapsReadout` every other density row carries — landed in the
 * card body's existing three-column grid with the checkbox moved into the
 * head of the WIDGET column beside the slider, rather than a fourth column
 * or a second line per row.
 *
 * The class list keeps `maps-layer-bool-row` (this is still the row that
 * toggles the layer, and the checkbox is still its first input) and adds
 * `maps-osm-row`, which is what the CSS uses to stop the checkbox spanning
 * the value column.
 *
 * **A `symbol`/`circle` row renders no density control at all** — not a
 * disabled one. Those two mount positioned DOM hotspots rather than
 * geometry and nothing in `widget.ts` reads their `density`, so there is no
 * number to show and no gesture to offer; a greyed slider is a control a
 * reader has to work out is dead, and it takes the row's own width to say
 * nothing. The row keeps its label and its toggle, and because the checkbox
 * stays inside `.maps-osm-row-widget` — the same flex head of the same
 * WIDGET column — it lands in the same place it does on every other row,
 * with the value column simply empty. The set is derived from
 * {@link MAP_ROW_DENSITYLESS_TYPES} against each row's OWN type, never a list of
 * row ids, because the row list belongs to `@glyphcss/maps` and moves.
 *
 * **The `title` states what the row's own density COSTS**, and the answer
 * differs by layer type, which is why it is written per type rather than
 * once on the card:
 *
 *  - `fill`/`fill-extrusion` are FREE to differ. A mesh-backed layer carries
 *    no `detailGroup` (`widget.ts` groups only a raster layer's tiles), so
 *    it already popped into its own `<pre>` the moment it left 1x — a
 *    private number costs nothing over a shared one.
 *  - `line` rows are NOT. A stroke owns no mesh; it is stamped into a
 *    full-viewport overlay grid, and `syncViewportOverlayDensities` routes
 *    the set of DISTINCT stroke densities to
 *    `scene.setViewportOverlayDensities`, so the three stroke rows sharing
 *    one number cost one grid and holding three cost three, each with its
 *    own geometry depth pass.
 *  - `symbol`/`circle` have no density row to price, so their title says
 *    what the row IS and why the control is absent.
 */
export const OSM_DENSITY_TITLES: Record<string, (label: string) => string> = {
  line: (label) =>
    `${label} density — a stroke row is stamped into a full-viewport overlay grid, and each DISTINCT density among the stroke rows (Waterways, Roads, Boundaries) buys another grid and another depth pass: measured at 140x63, one grid at 2x costs 27.4 ms/render and three at 2/2.1/2.2 cost 63.4 ms, so it is the COUNT that is charged for. Sharing one number with the other strokes costs nothing.`,
  fill: (label) =>
    `${label} density — free to differ. This row renders in its own pass at any value above 1x, so a number of its own costs no more than sharing one.`,
  "fill-extrusion": (label) =>
    `${label} density — free to differ. This row renders in its own pass at any value above 1x, so a number of its own costs no more than sharing one.`,
  symbol: (label) =>
    `${label} — positioned labels rather than geometry, so this row has no density: nothing in the renderer reads one for it.`,
  circle: (label) =>
    `${label} — positioned markers rather than geometry, so this row has no density: nothing in the renderer reads one for it.`,
};

/** The two layer types these cards mount that read no `density` at all — so their rows carry no density control. */
export const MAP_ROW_DENSITYLESS_TYPES = new Set(["symbol", "circle"]);

/**
 * The one layer type on this card that DRAWS LABELS — so its rows, and only
 * its rows, carry the placement control below.
 *
 * Derived against each row's own type for the reason
 * {@link MAP_ROW_DENSITYLESS_TYPES} is, and the reason is not hypothetical here:
 * the row list belongs to `@glyphcss/maps` and it has moved twice already —
 * `Peaks` was a `circle` row before it became a labelled `symbol` one, and
 * `Protected areas`/`Water labels` were appended as `symbol` rows later. A
 * hardcoded id list written when this card was first built was two rows out
 * of date by the time anyone looked.
 *
 * A `circle` row is deliberately NOT in it: it mounts a dot with no text, so
 * there is no label to place. That is why this is its own set rather than
 * the complement of the density one.
 */
export const MAP_ROW_LABEL_TYPES = new Set(["symbol"]);

/**
 * The placements the row control offers, out of the nine
 * `GlyphMapLabelAnchor` names.
 *
 * FIVE, not nine. The four corners are expressible — a caller writing the
 * layer by hand gets them — but a nine-way segmented control in a 340px rail
 * row gives each button ~13px, which is narrower than the icon inside it,
 * and the corner placements are the ones a character grid distinguishes
 * least: a label displaced half its own box diagonally lands within a cell
 * or two of the edge-anchored answer beside it. The five here are the ones
 * that read as different pictures.
 */
export const OSM_LABEL_ANCHOR_OPTIONS: readonly GlyphMapLabelAnchor[] = ["center", "left", "right", "top", "bottom"];

/**
 * Per-layer render mode — the /maps Dock has no scene-wide one. A map is not
 * one picture in one mode: an extrusion reads as building `wireframe` while
 * everything under it stays `solid`.
 *
 * Carried by `fill-extrusion` and `model` ONLY. Every other card is pinned
 * to {@link MAP_SCENE_RENDER_MODE} with no row at all, on one argument
 * applied three times: terrain (`raster`), `heatmap` and `fill` are all
 * shaded-MAGNITUDE surfaces — a relief mesh, a density relief, a filled
 * country — whose whole content IS the shade, so `wireframe`/`ink` show a
 * cage or an outline carrying none of the information the layer exists to
 * carry. An extrusion (real building wireframes) and a model (arbitrary
 * authored geometry) genuinely read in all three. `line`/`contour` are
 * stamped post-raster and already stroke by construction, and
 * `symbol`/`circle` mount DOM hotspots rather than geometry, so none of
 * those four ever had the row.
 *
 * The cost argument points the same way. "Solid" is the scene's own mode, so
 * choosing it is free — glyphcss only splits a mesh into its own rasterizer
 * pass when its mode genuinely differs (`GlyphMeshTransform.mode`). A layer
 * separated for an OUTLINE mode mounts `transparent` and is effectively
 * free, but a separated OPAQUE layer was measured at about +8.8 ms/frame —
 * so a mode row on a solid-by-nature surface is mostly a way for a reader to
 * spend a third of the frame budget for no visual gain. Removing it removes
 * that. The tooltip still warns for the two cards that keep it.
 */
export const LAYER_RENDER_MODES: readonly MapLayerRenderMode[] = ["solid", "wireframe", "ink"];

export const LAYER_RENDER_MODE_LABELS: Record<MapLayerRenderMode, string> = {
  solid: "Solid",
  wireframe: "Wireframe",
  ink: "Ink",
};
