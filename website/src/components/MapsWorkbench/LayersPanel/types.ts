import { type GlyphMapLabelAnchor } from "@glyphcss/maps";
import {
  type MapLayerGlyphPalette,
  type MapLayerRenderMode,
  type MapPaletteName,
} from "../../../features/maps/model/config";

export interface BackgroundLayerInputs {
  color: string;
  onColor: (v: string) => void;
}

// No `renderMode`/`onRenderMode` here, unlike `ExtraLayerInputs` — a relief
// mesh has no reason to render as anything but `solid` (`MAP_SCENE_RENDER_
// MODE`), so the Terrain card carries no mode control at all rather than one
// that only ever offers a single meaningful choice (see `ModeRow`'s doc).
export interface TerrainLayerInputs {
  visible: boolean;
  onVisible: (v: boolean) => void;
  /** The COLOUR ramp (elevation band → colour). Distinct from `glyphPalette` — see `GlyphRow`'s doc. */
  palette: MapPaletteName;
  onPalette: (v: MapPaletteName) => void;
  /** The CHARACTER ramp (shade → glyph). Distinct from `palette` — see `GlyphRow`'s doc. */
  glyphPalette: MapLayerGlyphPalette;
  onGlyphPalette: (v: MapLayerGlyphPalette) => void;
  exaggeration: number;
  onExaggeration: (v: number) => void;
  /** ETOPO1 tile pyramid's own sampling provenance (e.g. `"nearest"`) — `null` before the provider loads. */
  sampler: string | null;
  /**
   * The terrain's own elevation WINDOW in metres, `null` at either end for
   * unbounded — `GlyphMapRasterLayer.minElevation`/`maxElevation`. Terrain
   * outside it is held AT the window edge, so a floor of 0 draws the land and
   * replaces the seabed with a smooth plane at sea level. Same two numbers,
   * same units and the same control as the Contour card's own window.
   */
  minElevation: number | null;
  onMinElevation: (v: number | null) => void;
  maxElevation: number | null;
  onMaxElevation: (v: number | null) => void;
  density: number;
  onDensity: (v: number) => void;
}

export interface BordersLayerInputs {
  visible: boolean;
  onVisible: (v: boolean) => void;
  color: string;
  onColor: (v: string) => void;
  /** Vector tile pyramid's own Visvalingam-Whyatt simplification provenance — `null` before the provider loads. */
  simplify: string | null;
  density: number;
  onDensity: (v: number) => void;
}

export interface ContourLayerInputs {
  visible: boolean;
  onVisible: (v: boolean) => void;
  color: string;
  onColor: (v: string) => void;
  /** Elevation-unit spacing between contour lines — see `GlyphMapContourLayer.levels`'s `{ interval }` variant. */
  interval: number;
  onInterval: (v: number) => void;
  /**
   * The elevation WINDOW in metres (`GlyphMapContourLayer.minElevation`/
   * `maxElevation`), `null` for an unbounded end. Contouring the whole
   * ETOPO1 range (~-10,900..+8,300 m) crowds the ocean: `floor 0` is land
   * only, `ceiling 0` sea only, `0..2000` the foothills.
   */
  minElevation: number | null;
  onMinElevation: (v: number | null) => void;
  maxElevation: number | null;
  onMaxElevation: (v: number | null) => void;
  /**
   * The DATA range of the layer's currently resolved field
   * (`GlyphMapHandle.getContourFieldRange`) — the floor/ceiling sliders'
   * own track, so they offer the elevations the terrain in view actually
   * holds rather than an arbitrary fixed span. `null` while the layer is
   * off or before its first tile resolves.
   */
  fieldRange: { readonly min: number; readonly max: number } | null;
  /** The resulting line count for the CURRENTLY resolved field, read-only — `null` while off or before the first tile resolves. */
  lineCount: number | null;
  /**
   * `GlyphMapContourLayer.labels` — prints the elevation on every INDEX
   * contour (every `labelEvery`th line, in a gap in the line, restoring the
   * underlying terrain glyph either side). `labelEvery` stays fixed at the
   * library default (5) rather than getting its own control.
   */
  labels: boolean;
  onLabels: (v: boolean) => void;
  density: number;
  onDensity: (v: number) => void;
}

/**
 * The OpenStreetMap card's inputs.
 *
 * This card used to carry three rows and a button that existed only because
 * its DATA was a vendored ~4 km extract of Zürich on a page that opens on the
 * globe: what the extract held, what box it covered, whether the view was
 * currently on that box, and a flight to it. The source is now OpenFreeMap's
 * whole planet, swept on demand (`mapsOsm.ts`), so there is no box to be
 * outside of and nowhere in particular to fly to — all four are gone rather
 * than kept as controls that would state a coverage limit that no longer
 * exists.
 *
 * What is left is one provenance row and, only while it is true, one line
 * saying that some tiles did not arrive.
 */
/**
 * One row of a MULTI-ROW layer card: what it is called, which glyph layer
 * type it mounts as, whether it is on, and the two per-row settings only some
 * types read.
 *
 * Shared by the OpenStreetMap card and the Datasets card rather than
 * duplicated. The row's BEHAVIOUR is derived from its own `type` in both
 * cases ({@link MAP_ROW_DENSITYLESS_TYPES}, {@link MAP_ROW_LABEL_TYPES}), so
 * one shape genuinely serves both — the cards differ in where their rows come
 * from and what their tooltips say, not in what a row IS.
 */
export interface MapLayerRowInputs {
  readonly id: string;
  readonly label: string;
  /** The glyph layer type this row mounts as — it decides what the row's density COSTS, and whether the row gets a density control at all (`MAP_ROW_DENSITYLESS_TYPES`). */
  readonly type: "line" | "fill" | "fill-extrusion" | "symbol" | "circle";
  readonly on: boolean;
  /** This row's own density. Ignored for a `symbol`/`circle` row, which renders no density control. */
  readonly density: number;
  /**
   * Where this row's labels sit relative to their own point — MapLibre's
   * `text-anchor`. Read only by a `symbol` row (`MAP_ROW_LABEL_TYPES`); every
   * other row carries the field and renders no control for it, exactly as
   * `density` is carried and ignored by the two types that read none.
   */
  readonly anchor: GlyphMapLabelAnchor;
}

export interface OsmLayerInputs {
  visible: boolean;
  onVisible: (v: boolean) => void;
  /** Where the data comes from — service, schema and zoom ladder, read off the provider (`mapOsmSourceLabel`). */
  source: string;
  /** `null` when every tile arrived; otherwise how many did not (`mapOsmMissingTilesLabel`). */
  missing: string | null;
  /** One row per mapped OpenMapTiles layer (`GLYPH_MAP_OPENMAPTILES_LAYERS`). */
  sublayers: readonly MapLayerRowInputs[];
  onSublayer: (id: string, on: boolean) => void;
  /**
   * A single row's density. Writes THAT row and nothing else — the card's
   * only density gesture. There is deliberately no card-level `density`
   * here: per-row replaced the master rather than joining it.
   */
  onSublayerDensity: (id: string, density: number) => void;
  /**
   * A single row's label placement. Writes THAT row and nothing else — the
   * placement is a decision about one class of things (city names beside
   * their dot, a lake's name across the water), so there is deliberately no
   * card-level anchor here for the same reason there is no card-level
   * density.
   */
  onSublayerAnchor: (id: string, anchor: GlyphMapLabelAnchor) => void;
}

/**
 * The DATASETS card's inputs — five static reference datasets, mirroring
 * {@link OsmLayerInputs} row for row because they are the same kind of card:
 * a set of independent layers off one theme, each with its own toggle and,
 * where its type has one, its own density and its own label placement.
 *
 * What it does NOT mirror is a `missing` line. The OSM card streams tiles
 * and a tile can fail to arrive for one region while the rest of the frame
 * draws; these are five whole files that either loaded or did not, so a
 * failure is stated as the row simply not being loaded yet — which
 * {@link source} already reports.
 */
export interface DatasetsLayerInputs {
  visible: boolean;
  onVisible: (v: boolean) => void;
  /** How many of the card's files the reader has actually fetched (`mapDatasetSourceLabel`) — the card's provenance row. */
  source: string;
  /** `null` when nothing failed; otherwise the rows whose file did not load. */
  failed: string | null;
  rows: readonly MapLayerRowInputs[];
  onRow: (id: string, on: boolean) => void;
  onRowDensity: (id: string, density: number) => void;
  onRowAnchor: (id: string, anchor: GlyphMapLabelAnchor) => void;
}

/**
 * One row of the LIVE card, already reduced to strings.
 *
 * The card renders text and knows nothing about feeds, statuses or fetches —
 * `mapLiveRowReadout` (`mapsLiveRefresh.ts`) turns a row's state into these
 * three fields, where a test can reach the wording without mounting
 * anything. Same one-way rule the OSM card follows: this file imports from
 * the page's data modules, never the other way round.
 */
export interface LiveFeedInputs {
  readonly id: string;
  readonly label: string;
  /** What the feed is, and when it has something to show. */
  readonly tooltip: string;
  readonly on: boolean;
  /** The value column: what the row is currently showing, or why it is not. */
  readonly value: string;
  readonly warn: boolean;
  /** A second line naming what went wrong, or `null` when nothing did. */
  readonly note: string | null;
  /**
   * The TIME WINDOWS this row can be read at, in card order — **empty, or a
   * single entry, means no control at all**.
   *
   * That is the whole rule and it is a claim about the DATA, not about the
   * card: GDACS' row is a list of currently-ACTIVE events (measured on a
   * real capture, not one of its 99 had begun in the previous week) and a
   * satellite is a live position, so neither has a "how far back" to answer.
   * A control that cannot change anything is worse than no control.
   *
   * `desc` is the button's own tooltip and it is load-bearing: the quake
   * windows carry a MAGNITUDE FLOOR chosen for the reader (see
   * `mapsLive.ts`), so the button that carries it has to say so.
   */
  readonly windows: readonly { readonly value: string; readonly label: string; readonly desc: string }[];
  readonly window: string;
}

export interface LiveLayerInputs {
  visible: boolean;
  onVisible: (v: boolean) => void;
  /** One row per feed, in `MAP_LIVE_FEEDS` order. */
  feeds: readonly LiveFeedInputs[];
  onFeed: (id: string, on: boolean) => void;
  /**
   * A single row's time window. Writes THAT row and nothing else — the same
   * per-row rule the OSM card's density and label placement follow, and here
   * it is forced rather than chosen: two of the four rows have no time axis
   * at all, so there is no card-level window to write.
   */
  onWindow: (id: string, window: string) => void;
}

export interface LayersFolderInputs {
  background: BackgroundLayerInputs;
  terrain: TerrainLayerInputs;
  borders: BordersLayerInputs;
  contour: ContourLayerInputs;
  fill: ExtraLayerInputs;
  symbol: ExtraLayerInputs;
  circle: ExtraLayerInputs;
  heatmap: ExtraLayerInputs;
  fillExtrusion: ExtraLayerInputs;
  model: ExtraLayerInputs;
  osm: OsmLayerInputs;
  datasets: DatasetsLayerInputs;
  live: LiveLayerInputs;
}

/**
 * One control on a demo layer's card, in THAT LAYER'S OWN UNIT.
 *
 * These cards used to share a single 1..40 "amount" slider across six layers
 * whose units have nothing in common — a symbol POPULATION threshold, a
 * circle RADIUS in pixels, a heatmap RADIUS in cells and an extrusion HEIGHT
 * in metres all read off the same 1..40 track. That is a large part of why
 * the layers read as broken: 20 metres of extrusion is invisible at global
 * scale, and a population threshold of 20 people filters nothing. Every
 * control now declares its own range and prints its own unit.
 */
export interface LayerSliderSpec {
  readonly key: string;
  readonly label: string;
  readonly min: number;
  readonly max: number;
  readonly step: number;
  readonly value: number;
  readonly title: string;
  /** Readout text — the unit lives here (`"1.2M"`, `"120 km"`, `"9 px"`). */
  readonly format: (v: number) => string;
  /**
   * The inverse of {@link format}, for the row's editable readout. REQUIRED
   * whenever `format` prints something `Number.parseFloat` cannot invert —
   * a magnitude suffix (`"1.2M"`), a different unit from the value's own
   * (`"120 km"` for metres), a leading symbol (`"≥ 3"`), or a value that
   * isn't in the slider's own space at all ({@link logHeightSliderSpec}'s
   * log position). Without it a bare focus-then-blur commits the parsed
   * PREFIX of the formatted string, which is a silent data loss, not a
   * cosmetic one. Omit it only for a format `Number.parseFloat` genuinely
   * inverts (a bare number, or a number with a trailing unit) — the row then
   * falls back to {@link parseMapsNumber} over its own `min`/`max`.
   */
  readonly parse?: (raw: string) => { readonly value: number } | null;
  /** Rounds a typed value, for a row whose unit is inherently whole (pixels, cells, a prominence tier). Ignored when `parse` is supplied. */
  readonly integer?: boolean;
  readonly onChange: (v: number) => void;
}

/**
 * One `<select>` row on a layer card. Two rows use it: the DATASET picker
 * (which baked source layer drives a point layer — `GlyphMapLayer.sourceLayer`)
 * and the Model card's SHAPE picker (which `resolveGeometry` solid stands at
 * the anchor). They are the same control with a different label, so they are
 * one type rather than two identical ones.
 */
export interface LayerSelectSpec {
  readonly value: string;
  readonly options: readonly { readonly value: string; readonly label: string }[];
  readonly title: string;
  readonly onChange: (v: string) => void;
}

export interface ExtraLayerInputs {
  visible: boolean;
  onVisible: (v: boolean) => void;
  color: string;
  onColor: (v: string) => void;
  /** Point-driven layers only (`symbol`/`circle`/`heatmap`) — `model` authors its own geometry and has no dataset to pick. */
  dataset?: LayerSelectSpec;
  /** `model` ONLY — which `resolveGeometry` solid stands at the anchor (`mapPin.ts`'s `MAP_MODEL_SHAPES`). The mirror image of `dataset`: the one layer with no data has the only shape choice. */
  shape?: LayerSelectSpec;
  sliders: readonly LayerSliderSpec[];
  /** `fill-extrusion`/`model` only — every other card is pinned to `MAP_SCENE_RENDER_MODE`. See `ModeRow`'s doc for why. */
  renderMode?: MapLayerRenderMode;
  onRenderMode?: (v: MapLayerRenderMode) => void;
  /** Every MESH-BACKED card — a WIDER set than `renderMode`'s. See `GlyphRow`'s doc. */
  glyphPalette?: MapLayerGlyphPalette;
  onGlyphPalette?: (v: MapLayerGlyphPalette) => void;
}
