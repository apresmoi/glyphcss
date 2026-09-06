import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  createGlyphMap,
  glyphMapContourIntervalLevels,
  GlyphMapClassifiers,
  type GlyphMapAttribution,
  type GlyphMapHandle,
  type GlyphMapProvider,
  type GlyphMapVectorProvider,
  type GlyphMapView,
} from "@glyphcss/maps";
import { injectGlyphBaseStyles } from "glyphcss";
import { Dock, DockLighting, DockRendering } from "../Dock";
import { dragDensityToDownscale } from "../GlyphScene";
import { useDockGui } from "../Dock/slots";
import { CodePanel } from "../GalleryWorkbench/CodePanel";
import { createGeoTilesProvider } from "../../lib/geoTilesProvider";
import { createVectorTilesProvider } from "../../lib/vectorTilesProvider";
import { createPlaceTilesProvider } from "../../lib/placeTilesProvider";
import { createCountryTilesProvider, COUNTRY_PRIORITY_PROPERTY, COUNTRY_PRIORITY_RANGE } from "../../lib/countryTilesProvider";
import {
  MAP_OSM_DEFAULT_ON,
  MAP_OSM_SUBLAYERS,
  createOsmSource,
  mapOsmLayers,
  mapOsmMissingTilesLabel,
  mapOsmSourceLabel,
} from "./mapsOsm";
import { extractAsciiFromPre } from "../../lib/asciiClipboard";
import { downloadGlyphSvg } from "../../lib/glyphSvgExport";
import { computeGlyphAtlasAvailability } from "../../lib/glyphAtlasAvailability";
import { computeGlyphMapCharModeAvailability } from "../../lib/glyphMapCharModeAvailability";
import { getSolidWeightRamp } from "../GalleryWorkbench/weightedRamp";
import { StatsOverlay } from "../StatsOverlay";
import { AttributionCredit } from "../AttributionCredit/AttributionCredit";
import {
  InstrumentBody,
  InstrumentMain,
  InstrumentMobileTabs,
  InstrumentRail,
  InstrumentShell,
  InstrumentViewport,
} from "../InstrumentWorkbench/InstrumentWorkbench";
import {
  MAP_PALETTES,
  MAP_SCENE_GLYPH_PALETTE,
  MAP_SCENE_RENDER_MODE,
  POINT_DATASET_DEFAULTS,
  POINT_DATASET_OPTIONS,
  POINT_LAYER_IDS,
  isCountryDataset,
  type PointDataset,
  buildMapLighting,
  mapKeyLightForSunMode,
  buildMapProjection,
  buildMapsSnippet,
  buildContourLayerMountOptions,
  EXTRUSION_HEIGHT_BOUNDS_M,
  HEATMAP_RELIEF_HEIGHT_BOUNDS_M,
  LayersPanel,
  formatKm,
  formatPeople,
  logHeightSliderSpec,
  parseKm,
  parsePeople,
  parsePriority,
  isOrbitProjectionId,
  mapSunManualFields,
  mapSunManualInstant,
  MapsProjectionControls,
  MapsSunControls,
  paletteColorsFor,
  useViewFolder,
  type ExtraLayerInputs,
  type LayerSliderSpec,
  type LayersFolderInputs,
  type MapLayerGlyphPalette,
  type MapLayerRenderMode,
  type MapLighting,
  type MapPaletteName,
  type MapProjectionId,
  type MapSunMode,
} from "./mapsKit";
import { buildGlyphMapModelPolygons, MAP_MODEL_SHAPE_DEFAULT, MAP_MODEL_SHAPE_OPTIONS, type MapModelShape } from "./mapPin";
import { MapSearchBox } from "./MapSearchBox";
import { flyToMapSearchResult, loadMapSearchIndex, type MapSearchIndex, type MapSearchResult } from "./mapsSearch";
import { MAPS_CONTOUR_WINDOW_OFF, readInitialMapsState, writeMapsUrlState, type MapCharMode, type MapColorEncoding } from "./mapsUrlState";
import "../GalleryWorkbench/gallery-workbench.css";
import "../InstrumentWorkbench/instrument-workbench.css";
import "./maps-workbench.css";

const BACKGROUND_LAYER_ID = "background";
const TERRAIN_LAYER_ID = "terrain";
const BORDER_LAYER_ID = "borders";
const CONTOUR_LAYER_ID = "contour";
const EXTRA_LAYER_IDS = ["fill", "symbol", "circle", "heatmap", "fill-extrusion", "model"] as const;
const BASE_FONT_PX = 13;
/**
 * Mesh-backed layers — the ones a GLYPH PALETTE (character ramp) can apply
 * to. `line`/`contour` are stamped post-raster and already emit their own
 * oriented stroke glyphs; `symbol`/`circle` mount DOM hotspots.
 */
const MESH_LAYER_IDS = ["fill", "heatmap", "fill-extrusion", "model"] as const;
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
const RENDER_MODE_LAYER_IDS = ["fill-extrusion", "model"] as const;
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
const MAPS_CHAR_MODE_OPTIONS: Record<string, MapCharMode> = {
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
const MODEL_ANCHOR: readonly [number, number] = [7.7491, 45.9766];
/**
 * NO `maxSpan` is passed to `createGlyphMap` any more (it used to be 720 —
 * TWICE the world's own 360deg width, so a user could trivially pull back
 * until the map was a small rectangle in a field of page background).
 * Setting it at all is the widget's documented opt-OUT of the cover rule
 * ("overview margin around the whole projection" is exactly the background
 * cover removes), so the page simply omits it and takes the default: a sheet
 * projection is capped at its live COVER limit and the globe at its own
 * domain width. `map.getMaxSpan()` is the live ceiling, read into
 * `maxSpan` state below so the View folder's span slider offers the range
 * the map can actually show instead of one that snaps back.
 */

export default function MapsWorkbench() {
  const initial = useMemo(() => readInitialMapsState(), []);

  const hostRef = useRef<HTMLDivElement | null>(null);
  const [stageHost, setStageHost] = useState<HTMLElement | null>(null);
  const mapRef = useRef<GlyphMapHandle | null>(null);
  const [provider, setProvider] = useState<(GlyphMapProvider & { readonly sampler?: string }) | null>(null);
  const [providerError, setProviderError] = useState<string | null>(null);
  const [vectorProvider, setVectorProvider] = useState<(GlyphMapVectorProvider & { readonly simplify?: string }) | null>(null);
  const [placeProvider, setPlaceProvider] = useState<GlyphMapVectorProvider | null>(null);
  const [countryProvider, setCountryProvider] = useState<GlyphMapVectorProvider | null>(null);
  // OpenStreetMap: OpenFreeMap's planet, swept on demand like every other
  // provider on this page. Constructed once and eagerly — building it opens
  // no connection and reads no manifest (`vector/openfreemap.ts` uses the
  // service's documented `latest` alias precisely so there is no round trip),
  // so there is nothing to defer and no loading state to render. Tiles are
  // fetched by the widget's own sweep, only for layers that are mounted.
  const osmMissingTiles = useRef(0);
  const [osmMissing, setOsmMissing] = useState<string | null>(null);
  const osmSource = useMemo(
    () => createOsmSource({
      onError: () => {
        osmMissingTiles.current += 1;
        setOsmMissing(mapOsmMissingTilesLabel(osmMissingTiles.current));
      },
    }),
    [],
  );
  const [showOsm, setShowOsm] = useState(false);
  const [osmSublayers, setOsmSublayers] = useState<Record<string, boolean>>(
    () => Object.fromEntries(MAP_OSM_SUBLAYERS.map((s) => [s.id, MAP_OSM_DEFAULT_ON.includes(s.id)])),
  );
  const [osmDensity, setOsmDensity] = useState(1);
  const [attributions, setAttributions] = useState<readonly GlyphMapAttribution[]>([]);

  // ── Per-layer visibility + density + own controls (left-rail "Layers"
  //    panel, expandable cards — mapsKit.tsx's `LayersPanel` doc). Every
  //    MESH-backed layer's density passes straight through to glyphcss's own
  //    per-mesh detail layer: Terrain (`raster`) through `DensityRow`, and
  //    `fill`/`fill-extrusion` through their own cards' slider lists, on the
  //    same 1..4 / 0.1 track. Borders and Contour route theirs to a meshless
  //    viewport overlay grid instead (`GlyphMapLineLayer.density`'s doc).
  //    Background has no visibility toggle or density at all — it's a plain
  //    always-mounted colour, not a layer card (mapsKit.tsx's `LayersPanel`
  //    doc: `GlyphMapBackgroundLayer.density` is a documented permanent
  //    no-op). ─────────────────────────────────────────────────────────────
  const [showTerrain, setShowTerrain] = useState(true);
  const [showBorders, setShowBorders] = useState(true);
  const [showContour, setShowContour] = useState(false);
  const [terrainDensity, setTerrainDensity] = useState(1);
  const [borderDensity, setBorderDensity] = useState(1);
  const [contourDensity, setContourDensity] = useState(1);
  const [backgroundColor, setBackgroundColor] = useState("#05070c");
  const [borderColor, setBorderColor] = useState("#e8c988");
  const [contourColor, setContourColor] = useState("#7fe8c9");
  const [contourInterval, setContourInterval] = useState(1000);
  /**
   * The contour layer's elevation WINDOW in metres, `null` per end for
   * unbounded (`GlyphMapContourLayer.minElevation`/`maxElevation`). Contouring
   * the whole ETOPO1 range crowds the ocean — a floor of 0 spends every line
   * on land instead. Persisted through `MAPS_CONTOUR_WINDOW_OFF`, the codec's
   * sentinel for an unbounded end (`mapsUrlState.ts` has no null).
   */
  const [contourMinElevation, setContourMinElevation] = useState<number | null>(
    initial.contourFloor === MAPS_CONTOUR_WINDOW_OFF.min ? null : initial.contourFloor,
  );
  const [contourMaxElevation, setContourMaxElevation] = useState<number | null>(
    initial.contourCeiling === MAPS_CONTOUR_WINDOW_OFF.max ? null : initial.contourCeiling,
  );
  const [contourFieldRange, setContourFieldRange] = useState<{ readonly min: number; readonly max: number } | null>(null);
  /**
   * `GlyphMapContourLayer.labels` — prints the elevation on every INDEX
   * contour (every `labelEvery`th line, default 5) in a gap in the line.
   * Page-local, like the window's own bounds are not; `labelEvery` stays
   * fixed at its library default (5, the paper-map convention) rather than
   * getting its own control.
   */
  const [contourLabels, setContourLabels] = useState(false);
  const [extraVisible, setExtraVisible] = useState<Record<string, boolean>>({});
  // Per-layer render mode for the demo layers only — page-local, like their
  // colours and amounts. Terrain has no render-mode control at all (see
  // `TerrainLayerInputs`' doc in `mapsKit.tsx`): a relief mesh is always
  // rasterized `solid`.
  const [extraRenderMode, setExtraRenderMode] = useState<Record<string, MapLayerRenderMode>>(
    Object.fromEntries(RENDER_MODE_LAYER_IDS.map((id) => [id, MAP_SCENE_RENDER_MODE])),
  );
  // Per-layer GLYPH palette (the character ramp), which replaced the Dock's
  // scene-wide "Glyph palette" row — a map is no more one picture in one ramp
  // than it is one picture in one mode. Terrain's rides the URL token the
  // retired scene-wide control already owned (`g`); the demo layers' are
  // page-local, like their colours and modes.
  const [terrainGlyphPalette, setTerrainGlyphPalette] = useState<MapLayerGlyphPalette>(initial.glyphPalette);
  const [extraGlyphPalette, setExtraGlyphPalette] = useState<Record<string, MapLayerGlyphPalette>>(
    Object.fromEntries(MESH_LAYER_IDS.map((id) => [id, MAP_SCENE_GLYPH_PALETTE])),
  );
  /**
   * Which `resolveGeometry` solid the `model` layer stands at its anchor.
   * The mirror image of `pointDataset`: the one layer with no data source is
   * the one layer with a shape to pick (`mapPin.ts`'s `MAP_MODEL_SHAPES`).
   * Page-local, like the demo layers' colours — not URL-persisted.
   */
  const [modelShape, setModelShape] = useState<MapModelShape>(MAP_MODEL_SHAPE_DEFAULT);
  const [extraColor, setExtraColor] = useState<Record<string, string>>({ fill: "#4f7f52", symbol: "#ffffff", circle: "#f59e0b", heatmap: "#ef4444", "fill-extrusion": "#94a3b8", model: "#38bdf8" });
  // Which baked point dataset drives each point layer (its `sourceLayer`,
  // plus which of the two point pyramids it reads) — see `POINT_DATASET_DEFAULTS`.
  const [pointDataset, setPointDataset] = useState<Record<string, PointDataset>>({ ...POINT_DATASET_DEFAULTS });
  /**
   * Every demo layer's own controls, in its OWN unit — replacing the single
   * shared 1..40 "amount" slider that drove six layers with unrelated units
   * (see `mapsKit.tsx`'s `LayerSliderSpec` doc). Metre-valued controls are
   * large on purpose: relief is lifted through the projection's `elev` axis
   * and divided by the Earth's radius, so a building-scale 20 m extrusion is
   * genuinely sub-pixel at a global view — that is physics, not a defect.
   *
   * `extrusionHeightM` and `heatHeightM` both drive `logHeightSliderSpec`
   * rows (`mapsKit.tsx`) rather than a linear track — each spans several
   * orders of magnitude on its own and no single linear step serves both
   * ends. Their BOUNDS differ because they are different physical
   * quantities: extrusion height is an ABSOLUTE structure height (needs to
   * read at landmark scale — building/monument — up through a magnitude
   * that stays visible zoomed all the way out to a hemisphere), while heat
   * relief height (`GLYPH_MAP_HEATMAP_RELIEF_HEIGHT_M` in `widget.ts`) is
   * added ON TOP of real terrain, so its useful ceiling relates to terrain's
   * OWN variation (Everest-to-trench is ~19 km) rather than to planetary
   * scale — a 2,000 km relief bump would dwarf the terrain it's supposed to
   * sit on. `heatHeightM`'s default also moves down from the old (pre-relief)
   * 150,000 to 3,000, comfortably inside its new 20 km ceiling — the old
   * default predates the fix that put heatmap relief ON the terrain mesh
   * instead of floating at a fixed altitude, and left stale here would sit
   * pinned at the new max on load.
   */
  const [layerAmount, setLayerAmount] = useState({
    fillDensity: 1,
    symbolMinPop: 1_000_000,
    /**
     * The symbol layer's threshold when it is showing COUNTRIES, in the
     * baked `label_priority` unit rather than people. It needs its own state
     * because `minPriority` and the declutter ranking are the SAME number on
     * `GlyphMapSymbolLayer` — one `priorityProperty`, one threshold — so a
     * dataset whose priority column is a prominence rank cannot be filtered
     * on a population figure. Defaults to the range floor, i.e. every
     * country is a candidate and the declutter alone decides.
     */
    symbolMinPriority: COUNTRY_PRIORITY_RANGE.min,
    circleMaxRadius: 9,
    heatRadiusCells: 3,
    heatHeightM: 3_000,
    heatThreshold: 0.12,
    extrusionHeightM: 150_000,
    extrusionDensity: 1,
    modelHeightM: 200_000,
  });
  const showBordersRef = useRef(showBorders);
  showBordersRef.current = showBorders;
  const showTerrainRef = useRef(showTerrain);
  showTerrainRef.current = showTerrain;
  const terrainDensityRef = useRef(terrainDensity);
  terrainDensityRef.current = terrainDensity;
  const terrainGlyphPaletteRef = useRef(terrainGlyphPalette);
  terrainGlyphPaletteRef.current = terrainGlyphPalette;
  const backgroundColorRef = useRef(backgroundColor);
  backgroundColorRef.current = backgroundColor;
  const borderColorRef = useRef(borderColor);
  borderColorRef.current = borderColor;
  const borderDensityRef = useRef(borderDensity);
  borderDensityRef.current = borderDensity;

  // ── Projection — picking one animates the already-mounted widget via
  //    `map.setProjection()` (MAPS.md §13 slice 4; see the effect below the
  //    construction effect). `exaggeration` rides the SAME path, applied
  //    instantly rather than animated: it is a property of the projection
  //    (`z = (elev / EARTH_RADIUS_M) * exaggeration`), so it never needed a
  //    widget rebuild either. ─────────────────────────────────────────────
  const [projectionId, setProjectionId] = useState<MapProjectionId>(initial.projection);
  const [exaggeration, setExaggeration] = useState(initial.exaggeration);

  // ── View — mirrors the widget's own `GlyphMapView` (center/span), plus the
  //    sheet-only camera tilt. Synced FROM the widget on drag/wheel via the
  //    "move"/"zoom" events, and pushed TO the widget imperatively when a
  //    slider changes it. ──────────────────────────────────────────────────
  const [centerLon, setCenterLon] = useState(initial.centerLon);
  const [centerLat, setCenterLat] = useState(initial.centerLat);
  const [span, setSpan] = useState(initial.span);
  const [tilt, setTilt] = useState(initial.tilt);
  const [lod, setLod] = useState(0);
  const [maxSpan, setMaxSpan] = useState(360);
  const [degPerCell, setDegPerCell] = useState(0);
  const [viewGrid, setViewGrid] = useState<{ readonly cols: number; readonly rows: number }>({ cols: 160, rows: 64 });

  const [palette, setPalette] = useState<MapPaletteName>(initial.palette);

  // The readout counts the levels that will actually be DRAWN, so it must
  // apply the same window clip the layer does — an interval's absolute
  // multiples are clipped, never renumbered (`GlyphMapContourLayer
  // .minElevation`'s doc).
  const contourLineCount = contourFieldRange
    ? glyphMapContourIntervalLevels(contourInterval, contourFieldRange.min, contourFieldRange.max)
      .filter((level) => level >= (contourMinElevation ?? -Infinity) && level <= (contourMaxElevation ?? Infinity)).length
    : null;

  const setAmount = (key: keyof typeof layerAmount) => (value: number) => setLayerAmount((old) => ({ ...old, [key]: value }));

  /** Each demo layer's own controls, in its own unit — see `mapsKit.tsx`'s `LayerSliderSpec` doc. */
  const LAYER_SLIDERS: Record<string, readonly LayerSliderSpec[]> = {
    fill: [{ key: "density", label: "density", min: 1, max: 4, step: 0.1, value: layerAmount.fillDensity, title: "Fill density — glyph resolution multiplier for the country-polygon mesh.", format: (v) => `${v.toFixed(1)}x`, onChange: setAmount("fillDensity") }],
    // The symbol layer's threshold row is DATASET-dependent, because
    // `GlyphMapSymbolLayer` reads one `priorityProperty` for both the
    // declutter ranking and `minPriority`: cities rank by population, so the
    // threshold is people; countries rank by Natural Earth's LABELRANK
    // (inverted at bake time into `label_priority`), so the threshold is a
    // prominence tier. A single "min pop" row pointed at a 3..8 prominence
    // column would filter every country away at its 1,000,000 default.
    symbol: isCountryDataset(pointDataset.symbol)
      ? [{
          key: "minPriority", label: "prominence",
          min: COUNTRY_PRIORITY_RANGE.min, max: COUNTRY_PRIORITY_RANGE.max, step: 1,
          value: layerAmount.symbolMinPriority,
          title: `Minimum prominence a country needs before its label is a declutter candidate — the baked label_priority column (10 - Natural Earth's LABELRANK, so higher is more prominent). ${COUNTRY_PRIORITY_RANGE.min} keeps every country; ${COUNTRY_PRIORITY_RANGE.max} keeps only the top tier.`,
          format: (v) => `≥ ${v}`,
          parse: parsePriority(COUNTRY_PRIORITY_RANGE.min, COUNTRY_PRIORITY_RANGE.max),
          onChange: setAmount("symbolMinPriority"),
        }]
      : [{ key: "minPop", label: "min pop", min: 0, max: 10_000_000, step: 100_000, value: layerAmount.symbolMinPop, title: "Minimum population (Natural Earth's own pop_max column) a place needs before its label is a declutter candidate.", format: formatPeople, parse: parsePeople(0, 10_000_000), onChange: setAmount("symbolMinPop") }],
    circle: [{ key: "radius", label: "max r", min: 2, max: 24, step: 1, value: layerAmount.circleMaxRadius, title: "Radius in CSS pixels of the largest city — every dot is this times its own log-normalized population (pop_scale).", format: (v) => `${v} px`, integer: true, onChange: setAmount("circleMaxRadius") }],
    heatmap: [
      { key: "radius", label: "radius", min: 1, max: 12, step: 1, value: layerAmount.heatRadiusCells, title: "Gaussian falloff radius, in heatmap grid cells.", format: (v) => `${v} cells`, integer: true, onChange: setAmount("heatRadiusCells") },
      logHeightSliderSpec({ key: "height", label: "height", ...HEATMAP_RELIEF_HEIGHT_BOUNDS_M, value: layerAmount.heatHeightM, title: "Relief height in metres at full density, added ON TOP of real terrain — lifted through the projection's own elevation axis, so it exaggerates exactly as terrain does. Logarithmic: useful values run from a subtle bump to terrain-scale relief (Everest-to-trench is ~19 km), not planetary altitude.", onChange: setAmount("heatHeightM") }),
      { key: "threshold", label: "floor", min: 0, max: 0.5, step: 0.01, value: layerAmount.heatThreshold, title: "Normalized density below which a cell emits nothing, letting the terrain show through. At 0 the heatmap is an unbroken sheet over the whole world.", format: (v) => v.toFixed(2), onChange: setAmount("heatThreshold") },
    ],
    "fill-extrusion": [
      logHeightSliderSpec({ key: "height", label: "height", ...EXTRUSION_HEIGHT_BOUNDS_M, value: layerAmount.extrusionHeightM, title: "Extrusion height in metres. Logarithmic: a building-scale value is genuinely sub-pixel at a global view — relief divides by the Earth's radius — so this range runs from real structures up through landmark scale and well past the old 600 km ceiling.", onChange: setAmount("extrusionHeightM") }),
      // Same 1..4 / 0.1 track as every other density control on this page
      // (`mapsKit.tsx`'s `DensityRow`, and `fill`'s own row just above):
      // `GlyphMapFillExtrusionLayer.density` passes straight through to
      // glyphcss's per-mesh `density`, so the extrusion mesh pops into its
      // own silhouette-fitted `<pre>` at that multiple of the scene's glyph
      // resolution and is cross-layer-occlusion-correct against terrain.
      { key: "density", label: "density", min: 1, max: 4, step: 0.1, value: layerAmount.extrusionDensity, title: "Extrusion density — glyph resolution multiplier for the extrusion mesh (1x-4x).", format: (v) => `${v.toFixed(1)}x`, onChange: setAmount("extrusionDensity") },
    ],
    model: [{ key: "height", label: "height", min: 20_000, max: 600_000, step: 10_000, value: layerAmount.modelHeightM, title: "Height of the landmark spike in metres, above the anchor point.", format: formatKm, parse: parseKm(20_000, 600_000), onChange: setAmount("modelHeightM") }],
  };

  function extraLayerInputs(id: string): ExtraLayerInputs {
    return {
      visible: !!extraVisible[id], onVisible: (value: boolean) => setExtraVisible((old) => ({ ...old, [id]: value })),
      color: extraColor[id], onColor: (value: string) => setExtraColor((old) => ({ ...old, [id]: value })),
      sliders: LAYER_SLIDERS[id] ?? [],
      // Only a POINT-driven layer picks a dataset — `fill`/`fill-extrusion`
      // read the country-polygon pyramid (one layer, nothing to choose) and
      // `model` authors its own geometry.
      ...((POINT_LAYER_IDS as readonly string[]).includes(id)
        ? {
            dataset: {
              value: pointDataset[id],
              options: POINT_DATASET_OPTIONS,
              title: "Dataset — which baked Natural Earth point layer drives this layer: country label points (bake-country-tiles.mjs) or populated places (bake-place-tiles.mjs).",
              onChange: (value: string) => setPointDataset((old) => ({ ...old, [id]: value as PointDataset })),
            },
          }
        : {}),
      // The SHAPE row is `model`-only, and is the exact counterpart of the
      // dataset row above: `model` takes caller-authored `Polygon[]` and has
      // no source layer to select, so what it picks is geometry instead.
      ...(id === "model"
        ? {
            shape: {
              value: modelShape,
              options: MAP_MODEL_SHAPE_OPTIONS,
              title: "Shape — which @glyphcss/core primitive stands at the anchor. Every shape is grounded on the terrain and sized by this card's own height control.",
              onChange: (value: string) => setModelShape(value as MapModelShape),
            },
          }
        : {}),
      // A RENDER MODE row only where more than one mode says something —
      // `fill-extrusion` and `model`. `fill`/`heatmap` are shaded-magnitude
      // surfaces pinned to `MAP_SCENE_RENDER_MODE` exactly as terrain is
      // (`mapsKit.tsx`'s `ModeRow` doc).
      ...((RENDER_MODE_LAYER_IDS as readonly string[]).includes(id)
        ? {
            renderMode: extraRenderMode[id],
            onRenderMode: (value: MapLayerRenderMode) => setExtraRenderMode((old) => ({ ...old, [id]: value })),
          }
        : {}),
      // The GLYPH ramp is a WIDER set: it means something on every layer that
      // rasterizes geometry, solid-by-nature ones included (`GlyphRow`'s doc).
      ...((MESH_LAYER_IDS as readonly string[]).includes(id)
        ? {
            glyphPalette: extraGlyphPalette[id],
            onGlyphPalette: (value: MapLayerGlyphPalette) => setExtraGlyphPalette((old) => ({ ...old, [id]: value })),
          }
        : {}),
    };
  }

  /**
   * The search overlay's two hooks into the page.
   *
   * The index is built from the SAME providers the layers already use, held
   * in a ref so the loader can stay identity-stable (`MapSearchBox` calls it
   * exactly once, and a changing callback would defeat that). Each falls back
   * to creating its own only if the reader somehow reaches the box before the
   * provider effects settle — the manifests are browser-cached, so that costs
   * nothing but a repeated parse. The polygon pyramid is optional: without it
   * every country simply falls back to the point span
   * (`mapsSearch.ts`'s `mapSearchFlyTarget`).
   */
  const searchProvidersRef = useRef<{
    countries: GlyphMapVectorProvider | null;
    places: GlyphMapVectorProvider | null;
    polygons: GlyphMapVectorProvider | null;
  }>({ countries: null, places: null, polygons: null });
  searchProvidersRef.current = { countries: countryProvider, places: placeProvider, polygons: vectorProvider };

  const loadSearchIndex = useCallback(async (): Promise<MapSearchIndex> => {
    const held = searchProvidersRef.current;
    const [countries, places] = await Promise.all([
      held.countries ?? createCountryTilesProvider(),
      held.places ?? createPlaceTilesProvider(),
    ]);
    const countryPolygons = held.polygons ?? await createVectorTilesProvider().catch(() => null);
    return loadMapSearchIndex({ countries, places, countryPolygons });
  }, []);

  /**
   * Fly to a search result, LEVEL: `tilt` adds an ABSOLUTE camera pitch on an
   * orbit projection while the field of view shrinks with the zoom, so at city
   * scale the page's default 40 degrees puts the destination thousands of rows
   * off the grid (`mapsSearch.ts`'s `MAP_SEARCH_FLY_TILT`). The
   * levelling and the flight both live in `flyToMapSearchResult` so a test
   * driving the real widget can assert, via `map.project()`, that the
   * destination actually lands on the grid.
   */
  const flyToSearchResult = useCallback((result: MapSearchResult) => {
    const map = mapRef.current;
    if (!map) return;
    void flyToMapSearchResult(map, result, { onTilt: setTilt });
  }, []);

  const layersFolderInputs: LayersFolderInputs = {
    background: { color: backgroundColor, onColor: setBackgroundColor },
    terrain: {
      visible: showTerrain, onVisible: setShowTerrain,
      palette, onPalette: setPalette,
      glyphPalette: terrainGlyphPalette, onGlyphPalette: setTerrainGlyphPalette,
      exaggeration, onExaggeration: setExaggeration,
      sampler: provider?.sampler ?? null,
      density: terrainDensity, onDensity: setTerrainDensity,
    },
    borders: {
      visible: showBorders, onVisible: setShowBorders,
      color: borderColor, onColor: setBorderColor,
      simplify: vectorProvider?.simplify ?? null,
      density: borderDensity, onDensity: setBorderDensity,
    },
    contour: {
      visible: showContour, onVisible: setShowContour,
      color: contourColor, onColor: setContourColor,
      interval: contourInterval, onInterval: setContourInterval,
      minElevation: contourMinElevation, onMinElevation: setContourMinElevation,
      maxElevation: contourMaxElevation, onMaxElevation: setContourMaxElevation,
      fieldRange: contourFieldRange,
      lineCount: contourLineCount,
      labels: contourLabels, onLabels: setContourLabels,
      density: contourDensity, onDensity: setContourDensity,
    },
    fill: extraLayerInputs("fill"),
    symbol: extraLayerInputs("symbol"),
    circle: extraLayerInputs("circle"),
    heatmap: extraLayerInputs("heatmap"),
    fillExtrusion: extraLayerInputs("fill-extrusion"),
    model: extraLayerInputs("model"),
    osm: {
      visible: showOsm, onVisible: setShowOsm,
      source: mapOsmSourceLabel(osmSource),
      missing: osmMissing,
      sublayers: MAP_OSM_SUBLAYERS.map((spec) => ({ id: spec.id, label: spec.label, on: osmSublayers[spec.id] ?? false })),
      onSublayer: (id, on) => setOsmSublayers((prev) => ({ ...prev, [id]: on })),
      density: osmDensity, onDensity: setOsmDensity,
    },
  };

  const [charMode, setCharMode] = useState<MapCharMode>(initial.charMode);
  const [colorEncoding, setColorEncoding] = useState<MapColorEncoding>(initial.colorEncoding);
  const [useColors, setUseColors] = useState(initial.useColors);
  const [density, setDensity] = useState(initial.density);
  const [smoothShading, setSmoothShading] = useState(initial.smoothShading);
  // Not URL-persisted (page-local presentation knobs, same trim SynthWorkbench
  // applies to e.g. voiceMode) — real `createGlyphScene` options nonetheless,
  // all forwarded through `DockRendering` below.
  const [wireframeJunctions, setWireframeJunctions] = useState(false);
  const [hiddenLines, setHiddenLines] = useState<"show" | "hide">("show");
  const [solidWeightRamp, setSolidWeightRamp] = useState(false);
  const [dragDensity, setDragDensity] = useState(1);
  const [atlasReason, setAtlasReason] = useState<string | null>("Nothing rendered yet.");

  const [lighting, setLighting] = useState<MapLighting>({
    lightAzimuth: initial.lightAzimuth,
    lightElevation: initial.lightElevation,
    lightIntensity: initial.lightIntensity,
    lightColor: initial.lightColor,
    ambientIntensity: initial.ambientIntensity,
    ambientColor: initial.ambientColor,
  });

  // ── Real-sun lighting. `"off"` (the UI's "Full") is the default and the
  //    pre-existing behaviour exactly: the widget never touches the light,
  //    installs no cell hook and runs no timer. `"realtime"` hands the key
  //    light's DIRECTION to `@glyphcss/maps`' own sun, which re-resolves it
  //    every `GLYPH_MAP_SUN_TICK_MS` (30 s) so the terminator keeps
  //    advancing with the wall clock; `"manual"` pins it to the day/hour
  //    below. ───────────────────────────────────────────────────────────
  const [sunMode, setSunMode] = useState<MapSunMode>(initial.sunMode);
  const [sunDay, setSunDay] = useState(initial.sunDay);
  const [sunHour, setSunHour] = useState(initial.sunHour);

  // ── Character-mode availability. Unlike `atlasReason` above, this is a
  //    pure function of state this component already owns — no DOM probe,
  //    no MutationObserver — so it updates the instant Borders/Contour/Sun
  //    change, and (unlike atlasReason's "Nothing rendered yet." placeholder)
  //    it is already correct on the very first render, including for a URL
  //    that carries `charMode=halfblock` while Borders defaults on: the
  //    control reads as disabled with the real reason from the first paint,
  //    rather than claiming halfblock while silently rendering ascii.
  const charModeReason = useMemo(
    () => computeGlyphMapCharModeAvailability({
      charMode,
      bordersOn: showBorders,
      contourOn: showContour,
      sunStampingTerminator: sunMode !== "off" && !isOrbitProjectionId(projectionId),
    }).reason,
    [charMode, showBorders, showContour, sunMode, projectionId],
  );

  const [mobilePanel, setMobilePanel] = useState<"layers" | "controls" | "code" | null>(null);

  // Refs so imperative callbacks (map event handlers, the resize/interaction
  // observers) always read the latest value without re-subscribing.
  const centerRef = useRef<[number, number]>([centerLon, centerLat]);
  centerRef.current = [centerLon, centerLat];
  const spanRef = useRef(span);
  spanRef.current = span;
  const densityRef = useRef(density);
  densityRef.current = density;
  const dragDensityRef = useRef(dragDensity);
  dragDensityRef.current = dragDensity;
  // The CONSTRUCTION effect (below) reads the latest exaggeration without
  // depending on it: an exaggeration change is absorbed by the mounted
  // widget through `setProjection`, so it must not re-run construction, but
  // the initial build still has to start at whatever the slider currently
  // says (a change that lands while the provider is still loading).
  const exaggerationRef = useRef(exaggeration);
  exaggerationRef.current = exaggeration;
  const sunRef = useRef({ mode: sunMode, day: sunDay, hour: sunHour });
  sunRef.current = { mode: sunMode, day: sunDay, hour: sunHour };

  // ── Load the baked ETOPO1 tile provider once. ──────────────────────────
  useEffect(() => {
    let cancelled = false;
    createGeoTilesProvider()
      .then((p) => { if (!cancelled) setProvider(p); })
      .catch((err: unknown) => { if (!cancelled) setProviderError(err instanceof Error ? err.message : String(err)); });
    return () => { cancelled = true; };
  }, []);

  // ── Load the baked admin_0 border vector-tile provider once. ───────────
  useEffect(() => {
    let cancelled = false;
    createVectorTilesProvider()
      .then((p) => { if (!cancelled) setVectorProvider(p); })
      .catch((err: unknown) => console.warn("glyphcss/maps: failed to load vector tiles", err));
    return () => { cancelled = true; };
  }, []);

  // ── Load the baked Natural Earth populated-places POINT pyramid once —
  //    the data behind `symbol`/`circle`/`heatmap`. Separate from the border
  //    pyramid because they are different geometries with different LOD
  //    schedules (`bake-place-tiles.mjs` thins by NE's own `scalerank`;
  //    `bake-vector-tiles.mjs` thins by Visvalingam-Whyatt epsilon), and
  //    because a page that never turns a point layer on should not pay for
  //    it. Its own attribution rides on the provider and reaches the credit
  //    line through `map.getAttributions()`, never a hardcoded string. ────
  useEffect(() => {
    let cancelled = false;
    createPlaceTilesProvider()
      .then((p) => { if (!cancelled) setPlaceProvider(p); })
      .catch((err: unknown) => console.warn("glyphcss/maps: failed to load place tiles", err));
    return () => { cancelled = true; };
  }, []);

  // ── Load the baked Natural Earth ADMIN-0 LABEL POINT pyramid once — the
  //    `symbol`/`circle` layers' default dataset. A SEPARATE pyramid and a
  //    separate provider from the places one, not a fourth `sourceLayer` in
  //    it, because attribution is derived from the mounted layer's own
  //    provider and these are two different Natural Earth files with two
  //    different provenance records (a tile carries one attribution list).
  //    Keeping them apart is what makes `map.getAttributions()` credit the
  //    source the reader is actually looking at. ────────────────────────
  useEffect(() => {
    let cancelled = false;
    createCountryTilesProvider()
      .then((p) => { if (!cancelled) setCountryProvider(p); })
      .catch((err: unknown) => console.warn("glyphcss/maps: failed to load country tiles", err));
    return () => { cancelled = true; };
  }, []);

  function applyDensity(dragging: boolean): void {
    const host = hostRef.current;
    if (!host) return;
    const factor = densityRef.current * (dragging ? dragDensityRef.current : 1);
    host.style.fontSize = `${BASE_FONT_PX / Math.max(0.05, factor)}px`;
  }

  // ── Deterministic perf-harness seam (`bench/maps-render/mapsBench.mjs`).
  //    Installed ONLY under `?bench=1`, so the shipped page never grows a
  //    global. Accessors, not captured values: the widget is rebuilt when a
  //    provider resolves, and the harness must always reach the live one.
  //    `setColorEncoding` is exposed because `spans` is the URL codec's
  //    OMISSION SENTINEL (mapsUrlState.ts) and therefore unreachable from a
  //    link — the fidelity comparison has to run in spans mode, since the
  //    atlas palette is retrained by any change to how many renders happen
  //    per frame (asciiQuake's PERF_REPORT.md documents exactly this trap).
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (new URLSearchParams(window.location.search).get("bench") !== "1") return;
    const w = window as unknown as { __glyphMapsBench?: unknown };
    w.__glyphMapsBench = {
      map: () => mapRef.current,
      output: () => mapRef.current?.scene.output ?? null,
      getView: () => mapRef.current?.getView() ?? null,
      setView: (partial: Partial<GlyphMapView>) => mapRef.current?.setView(partial),
      setColorEncoding: (value: MapColorEncoding) => setColorEncoding(value),
      // The terrain raster layer's OWN density (glyphcss per-mesh detail
      // resolution), not the scene-wide `d` URL token. No URL state carries
      // it, and it is the one knob the tile-seam / detail-grouping work has
      // to be priced at — density 1 keeps every tile in the base grid, where
      // the question does not exist.
      setTerrainDensity: (value: number) => setTerrainDensity(value),
      // Toggle one of the page's OWN demo layer cards, with its real dataset
      // and real defaults. `--layer <json>` can't reach `symbol`/`circle`/
      // `heatmap`/`fill`: their `source` is a live provider object, not JSON.
      // Measuring a hand-built stand-in instead would measure something the
      // page never renders.
      setDemoLayer: (id: string, on: boolean) => setExtraVisible((old) => ({ ...old, [id]: on })),
      setDemoDataset: (id: string, dataset: string) => setPointDataset((old) => ({ ...old, [id]: dataset as PointDataset })),
    };
    return () => { delete w.__glyphMapsBench; };
  }, []);

  // ── Build (or rebuild) the widget whenever a PROVIDER arrives. Neither
  //    `projectionId` nor `exaggeration` is a dependency: both are absorbed
  //    live by the already-mounted widget through `map.setProjection()` (the
  //    effect right below this one) instead of tearing the whole thing down.
  //    Both are still read here for the INITIAL build — through their refs,
  //    since they are deliberately not listed. ────────────────────────────
  useEffect(() => {
    const host = hostRef.current;
    if (!host || !provider) return;
    injectGlyphBaseStyles(host.ownerDocument ?? undefined);
    applyDensity(false);

    const view: GlyphMapView = { center: centerRef.current, span: spanRef.current, cols: 160, rows: 64 };
    const projection = buildMapProjection(projectionId, exaggerationRef.current);
    const lightingScene = buildMapLighting(lighting);

    const map = createGlyphMap(host, {
      view,
      projection,
      autoSize: true,
      tilt,
      controls: { drag: true, wheel: true },
      sun: {
        mode: sunRef.current.mode,
        date: mapSunManualInstant(sunRef.current.day, sunRef.current.hour),
      },
      keyLight: mapKeyLightForSunMode(sunRef.current.mode, projectionId),
      layers: [
        { type: "background" as const, id: BACKGROUND_LAYER_ID, color: backgroundColorRef.current },
        ...(showTerrainRef.current
          ? [{
              type: "raster" as const,
              id: TERRAIN_LAYER_ID,
              source: provider,
              classifier: GlyphMapClassifiers.etopo1V1,
              colors: MAP_PALETTES[palette],
              density: terrainDensityRef.current,
              glyphPalette: terrainGlyphPaletteRef.current,
            }]
          : []),
        ...(vectorProvider && showBordersRef.current
          ? [{ type: "line" as const, id: BORDER_LAYER_ID, source: vectorProvider, color: borderColorRef.current, density: borderDensityRef.current }]
          : []),
      ],
      scene: {
        mode: MAP_SCENE_RENDER_MODE,
        // FIXED, not a control — the exact counterpart of `mode`. Every
        // mesh-backed layer picks its own ramp on its own card, and
        // `@glyphcss/maps` keeps a layer naming THIS one in the shared base
        // grid at no cost (`mapsKit.tsx`'s `MAP_SCENE_GLYPH_PALETTE` doc).
        glyphPalette: MAP_SCENE_GLYPH_PALETTE,
        charMode,
        colorEncoding,
        useColors,
        smoothShading,
        // `creaseAngle` is not forwarded: it is only `smoothShading`'s own
        // threshold, a relief mesh has no authored hard creases to protect,
        // and the Dock no longer exposes it here — so the map keeps
        // glyphcss's own default rather than pinning a page copy of it.
        wireframeJunctions,
        hiddenLines,
        solidWeightRamp: solidWeightRamp ? getSolidWeightRamp() ?? undefined : undefined,
        interactiveDownscale: dragDensityToDownscale(dragDensityRef.current),
        ...lightingScene,
      },
    });
    mapRef.current = map;

    // Throttled to one animation frame. The widget emits `move`/`zoom` per
    // input event and per animation step, and this pushes six pieces of
    // React state — so unthrottled it re-rendered the whole workbench on
    // every one of them, measured at 3.8 ms/frame of non-render script
    // during a continuous globe rotation (`bench/maps-render`). One sync per
    // displayed frame is all a readout can show anyway.
    let viewSyncFrame: number | null = null;
    function requestViewSync(): void {
      if (viewSyncFrame !== null) return;
      viewSyncFrame = requestAnimationFrame(() => { viewSyncFrame = null; syncViewState(); });
    }
    function syncViewState(): void {
      const v = map.getView();
      setCenterLon(v.center[0]);
      setCenterLat(v.center[1]);
      setSpan(v.span);
      // Re-read every sync, not once: the cover ceiling moves with the
      // projection, the tilt and the host's shape.
      setMaxSpan(map.getMaxSpan());
      const deg = v.span / v.cols;
      setDegPerCell(deg);
      setViewGrid((prev) => (prev.cols === v.cols && prev.rows === v.rows ? prev : { cols: v.cols, rows: v.rows }));
      if (provider) {
        const zooms = [...provider.zooms].sort((a, b) => a.z - b.z);
        let chosen = zooms[0]?.z ?? 0;
        for (const level of zooms) {
          chosen = level.z;
          if (level.tileLonSpan / level.tileCols <= deg) break;
        }
        setLod(chosen);
      }
    }
    syncViewState();
    map.on("move", requestViewSync);
    map.on("zoom", requestViewSync);
    setAttributions(map.getAttributions());

    // `interactiveDownscale`/drag-density workaround: the widget owns its own
    // pointer handlers internally and never calls `scene.setInteracting()`
    // (verified against packages/maps/src/widget.ts — a real slice-3 gap,
    // see this page's own report), so a page that wants either lever has to
    // drive it itself from the same gesture the widget already listens to.
    //
    // The switch to the coarser resolution happens on the FIRST pointermove
    // after a pointerdown — never on pointerdown itself. `setInteracting`
    // changes `<pre>` font-size and (under `autoSize`) `cols`/`rows`
    // synchronously, then immediately re-renders; but the `<pre>` is
    // `display: inline-block` and sizes to its CURRENT text content, so that
    // very first render reads its own `getBoundingClientRect()` (used to
    // stamp the border/contour strokes) against the font-size/cols/rows of
    // the render about to be committed while the DOM still holds the PREVIOUS
    // render's text — a genuine one-render metrics mismatch. Firing this on
    // a plain click (pointerdown + pointerup, no movement in between) buys
    // nothing and pays for that mismatched render, which visibly reads as the
    // stroke layers "jumping" until a real drag frame re-renders with
    // everything settled. Gating on movement means a click never enters the
    // downscaled state at all — no mismatched render is ever produced.
    let pointerDown = false;
    let dragging = false;
    const onDown = (): void => {
      pointerDown = true;
    };
    const onMove = (): void => {
      if (!pointerDown || dragging) return;
      dragging = true;
      map.scene.setInteracting(true);
      applyDensity(true);
    };
    const onUp = (): void => {
      pointerDown = false;
      if (!dragging) return;
      dragging = false;
      map.scene.setInteracting(false);
      applyDensity(false);
      map.scene.rerender();
    };
    host.addEventListener("pointerdown", onDown);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);

    return () => {
      host.removeEventListener("pointerdown", onDown);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      if (viewSyncFrame !== null) cancelAnimationFrame(viewSyncFrame);
      map.off("move", requestViewSync);
      map.off("zoom", requestViewSync);
      map.destroy();
      mapRef.current = null;
    };
    // Deliberately narrow deps — everything else in `scene`/`layers` above is
    // read once at construction and kept in sync by the effects below.
    // `projectionId` and `exaggeration` are intentionally OMITTED — see this
    // effect's own comment above; the `setProjection` effect right below owns
    // picking up a later change to either, on the MOUNTED widget.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [provider, vectorProvider]);

  // ── Projection picker AND relief exaggeration -> map.setProjection(). The
  //    widget instance is NOT rebuilt by either. Skipped on the very first
  //    render (`mapRef.current` is still null before the construction effect
  //    above has run) so mount never double-builds.
  //
  //    Picking a projection ANIMATES (MAPS.md §13 slice 4). Moving the
  //    exaggeration slider must NOT: it fires per notch, and a 600ms flight
  //    per notch would fight the next one. It is applied instantly instead,
  //    which `setProjection`'s own `durationMs: 0` branch does synchronously
  //    (widget.ts's `applyProjectionFrame(from, target, 1, ...)`).
  //
  //    Exaggeration used to be a dependency of the CONSTRUCTION effect above
  //    — `map.destroy()` plus a fresh `createGlyphMap` per notch. A raster
  //    layer's tile cache lives on its layer runtime, which lives on the
  //    widget, so every rebuild threw the cache away and refetched every
  //    visible tile: measured on the live page at 66 tile requests for a
  //    ten-notch drag, with each notch rendering an empty `<pre>` (the new
  //    scene's first frame, before any mesh is mounted) and then the coarse
  //    z0 floor backstop ALONE — land-coloured, stretched over the whole
  //    viewport — for the length of the network round trip. That is both
  //    halves of the report: "the map flickers a lot" and "the colour of land
  //    and borders becomes all green". Relief scale is a property of the
  //    PROJECTION (`z = (elev / EARTH_RADIUS_M) * exaggeration`), and
  //    `setProjection` already reprojects every mounted mesh from the cache
  //    with no refetch (AGENTS.md, "Projection transitions"), so there is
  //    nothing a rebuild was buying. `mapsExaggerationRebuild.repro.test.tsx`
  //    pins both shapes. ──────────────────────────────────────────────────
  //    `projectionIdRef` is what separates the two cases. It is updated even
  //    on the early return, so a projection picked BEFORE the provider
  //    resolved (the construction effect builds with it directly) cannot
  //    leave a stale id behind and make the next exaggeration notch animate.
  const projectionIdRef = useRef(projectionId);
  useEffect(() => {
    const map = mapRef.current;
    const projectionChanged = projectionIdRef.current !== projectionId;
    projectionIdRef.current = projectionId;
    if (!map) return;
    const projection = buildMapProjection(projectionId, exaggeration);
    // The destination's own cover ceiling applies from the flight's first
    // frame (the widget clamps up front so nothing snaps at the end), so the
    // slider's range has to follow it there, not only once it lands.
    void map.setProjection(projection, projectionChanged ? {} : { durationMs: 0 })
      .then(() => setMaxSpan(map.getMaxSpan()));
    setMaxSpan(map.getMaxSpan());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectionId, exaggeration]);

  // ── Palette / visibility / density recolor-or-remount: no live setter for
  //    any of these on a mounted raster layer (`addLayer`/`removeLayer` are
  //    the only layer mutators, packages/maps/src/widget.ts), so this
  //    removes and re-adds the SAME layer id. `density` passes straight
  //    through to glyphcss's own per-mesh `density` (GlyphMapRasterLayer.
  //    density's doc) — the one layer type actually wired this slice.
  //    Hiding the terrain is the SAME remove/re-add path, not a special
  //    case (coordinator's "keep one mechanism" — `raster` is already an
  //    ordinary layer type). ─────────────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !provider) return;
    map.removeLayer(TERRAIN_LAYER_ID);
    if (showTerrain) {
      map.addLayer({
        type: "raster",
        id: TERRAIN_LAYER_ID,
        source: provider,
        classifier: GlyphMapClassifiers.etopo1V1,
        colors: MAP_PALETTES[palette],
        density: terrainDensity,
        glyphPalette: terrainGlyphPalette,
      });
    }
    map.scene.rerender();
    setAttributions(map.getAttributions());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [palette, showTerrain, terrainDensity, terrainGlyphPalette]);

  // ── Background recolor -> addLayer/removeLayer, same mechanism. Always
  //    mounted (background is a plain always-present colour, not a
  //    toggleable layer card — mapsKit.tsx's `LayersPanel` doc); no
  //    `density` (a documented permanent no-op — `GlyphMapBackgroundLayer
  //    .density`'s doc). ─────────────────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    map.removeLayer(BACKGROUND_LAYER_ID);
    // No `beforeId`: a `background` layer only sets the host's CSS
    // background-color (`applyBackground()`, widget.ts) — it never
    // participates in depth-tested rendering, so layer ORDER relative to
    // terrain has no visual effect and threading a `beforeId` here would
    // throw whenever terrain happens to be hidden (its id isn't mounted).
    map.addLayer({ type: "background", id: BACKGROUND_LAYER_ID, color: backgroundColor });
    map.scene.rerender();
  }, [backgroundColor]);

  // ── Borders toggle -> addLayer/removeLayer on the ALREADY-mounted map
  //    (no recreation — mirrors the palette-recolor pattern above). ───────
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !vectorProvider) return;
    map.removeLayer(BORDER_LAYER_ID);
    if (showBorders) {
      map.addLayer({ type: "line", id: BORDER_LAYER_ID, source: vectorProvider, color: borderColor, density: borderDensity });
    }
    map.scene.rerender();
    setAttributions(map.getAttributions());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showBorders, borderColor, borderDensity, vectorProvider]);

  // ── Contour toggle -> mount/unmount a contour layer pointed straight at
  //    the SAME ETOPO1 provider `terrain` already uses. `createGlyphMap`
  //    owns re-deriving the field per visible LOD/tile from here on
  //    (`widget.ts`'s `scheduleTileUpdate`) — panning/zooming into a new
  //    tile now loads that tile's contour data instead of staying pinned to
  //    a snapshot from whichever view was current when the layer toggled on.
  //    `levels: { interval }` (not a count) keeps the lines at FIXED
  //    absolute elevations as the view pans — see `LayersPanel`'s "interval"
  //    control doc (mapsKit.tsx) for why a count would re-space on every move.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !provider) return;
    map.removeLayer(CONTOUR_LAYER_ID);
    if (showContour) {
      map.addLayer({
        type: "contour", id: CONTOUR_LAYER_ID, source: provider,
        ...buildContourLayerMountOptions({
          interval: contourInterval, color: contourColor, density: contourDensity,
          minElevation: contourMinElevation, maxElevation: contourMaxElevation, labels: contourLabels,
        }),
      });
    }
    map.scene.rerender();
    setAttributions(map.getAttributions());
    setContourFieldRange(showContour ? map.getContourFieldRange(CONTOUR_LAYER_ID) : null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showContour, contourInterval, contourColor, contourDensity, contourMinElevation, contourMaxElevation, contourLabels, provider]);

  // ── The demo layers.
  //
  //    `fill`/`fill-extrusion` read the country-POLYGON pyramid;
  //    `symbol`/`circle`/`heatmap` read the populated-places POINT pyramid
  //    (`bake-place-tiles.mjs`), each through the `sourceLayer` its own
  //    dataset picker selects. Pointing the point layers at the polygon
  //    pyramid — which is what this page used to do — is why they rendered
  //    nothing: it contains no point features at all, and `minPriority` on
  //    top of that filtered against `population_rank`, a column Natural
  //    Earth has never had.
  //
  //    `pop_scale` is the baked 0..1 LOG-normalized population column;
  //    `radiusScale`/`weightProperty` turn it into pixels and heat. Raw
  //    `pop_max` (real people) drives `minPriority`, which is a threshold a
  //    reader can reason about. ─────────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    for (const id of EXTRA_LAYER_IDS) map.removeLayer(id);
    if (vectorProvider) {
      // No `renderMode`: a filled country is a shaded-magnitude surface, so
      // it is pinned to the scene's own mode with no control (see the heatmap
      // just below, and `mapsKit.tsx`'s `ModeRow` doc).
      if (extraVisible.fill) map.addLayer({ type: "fill", id: "fill", source: vectorProvider, color: extraColor.fill, density: layerAmount.fillDensity, glyphPalette: extraGlyphPalette.fill });
      if (extraVisible["fill-extrusion"]) {
        map.addLayer({
          type: "fill-extrusion", id: "fill-extrusion", source: vectorProvider,
          height: layerAmount.extrusionHeightM, density: layerAmount.extrusionDensity,
          color: extraColor["fill-extrusion"], renderMode: extraRenderMode["fill-extrusion"], glyphPalette: extraGlyphPalette["fill-extrusion"],
        });
      }
    }
    // Which of the two point pyramids a card's selected dataset lives in.
    // `null` while that pyramid's manifest is still resolving — the layer is
    // simply not mounted yet, and this effect re-runs when it lands.
    const pointSource = (id: string) => (isCountryDataset(pointDataset[id]) ? countryProvider : placeProvider);
    const symbolSource = pointSource("symbol");
    if (extraVisible.symbol && symbolSource) {
      // `priorityProperty` drives BOTH the greedy declutter ranking and the
      // `minPriority` cutoff, so it has to name the column that actually
      // orders THIS dataset: population for cities, Natural Earth's LABELRANK
      // (inverted at bake time into `label_priority`, higher = more
      // prominent) for countries. Its threshold state is paired with it for
      // the same reason — see `layerAmount.symbolMinPriority`.
      const countries = isCountryDataset(pointDataset.symbol);
      map.addLayer({
        type: "symbol", id: "symbol", source: symbolSource, sourceLayer: pointDataset.symbol,
        textProperty: "name",
        priorityProperty: countries ? COUNTRY_PRIORITY_PROPERTY : "pop_max",
        minPriority: countries ? layerAmount.symbolMinPriority : layerAmount.symbolMinPop,
        color: extraColor.symbol,
      });
    }
    const circleSource = pointSource("circle");
    if (extraVisible.circle && circleSource) {
      // `pop_scale` needs no dataset branch: BOTH bakes write that column,
      // each log-normalized within its own population range, so a country dot
      // and a city dot are each sized by a real measured quantity.
      map.addLayer({
        type: "circle", id: "circle", source: circleSource, sourceLayer: pointDataset.circle,
        radiusProperty: "pop_scale", radiusScale: layerAmount.circleMaxRadius, radius: 2, color: extraColor.circle,
      });
    }
    const heatmapSource = pointSource("heatmap");
    if (extraVisible.heatmap && heatmapSource) {
      map.addLayer({
        type: "heatmap", id: "heatmap", source: heatmapSource, sourceLayer: pointDataset.heatmap,
        radius: layerAmount.heatRadiusCells, weightProperty: "pop_scale",
        height: layerAmount.heatHeightM, threshold: layerAmount.heatThreshold,
        // No `renderMode`: a density relief is a shaded-magnitude surface, so
        // it is pinned to the scene's own mode with no control at all, the
        // same way terrain is (`mapsKit.tsx`'s `ModeRow` doc).
        colors: ["#111827", extraColor.heatmap], glyphPalette: extraGlyphPalette.heatmap,
      });
    }
    if (extraVisible.model) {
      // World-space polygons, built against the LIVE projection — see
      // `mapPin.ts`. `projectionId`/`exaggeration` are dependencies of this
      // effect, so the shape is rebuilt whenever the widget's own projection
      // is re-derived (see the `setProjection` effect above, which runs
      // FIRST — effects run in declaration order), and it always stands on
      // the terrain rather than floating where the previous projection put
      // it.
      const projection = buildMapProjection(projectionId, exaggeration);
      map.addLayer({
        type: "model", id: "model", renderMode: extraRenderMode.model, glyphPalette: extraGlyphPalette.model,
        polygons: buildGlyphMapModelPolygons(projection, MODEL_ANCHOR[0], MODEL_ANCHOR[1], {
          shape: modelShape,
          heightM: layerAmount.modelHeightM,
          // A footprint about a tenth as wide as the shape is tall, in
          // degrees at this latitude — thin enough to read as a marker, wide
          // enough to survive a cell or two of rasterization at a
          // continental view. Every shape shares it, so swapping a pyramid
          // for a sphere changes the silhouette, never the scale.
          halfWidthDeg: Math.max(0.15, (layerAmount.modelHeightM / 1_000_000) * 1.2),
          color: extraColor.model,
        }),
      });
    }
    map.scene.rerender();
    setAttributions(map.getAttributions());
  }, [vectorProvider, placeProvider, countryProvider, extraVisible, extraColor, layerAmount, extraRenderMode, extraGlyphPalette, pointDataset, modelShape, projectionId, exaggeration]);

  // ── The OpenStreetMap card.
  //
  //    Mount/unmount the mapped layers on the shared OpenFreeMap source. The
  //    widget's own sweep then streams whatever the current view is looking
  //    at, so there is nothing to preload and nowhere to fly to: enabling the
  //    card over the Pacific draws the Pacific.
  //
  //    `mapOsmLayers` hands back ready-to-mount layers whose `source` already
  //    carries the ODbL OpenStreetMap credit, so `map.getAttributions()`
  //    picks the credit up from the mounted layer itself — nothing here
  //    writes an attribution string. ────────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    for (const { id } of MAP_OSM_SUBLAYERS) map.removeLayer(id);
    if (showOsm) {
      const enabled = MAP_OSM_SUBLAYERS.filter((s) => osmSublayers[s.id]).map((s) => s.id);
      for (const layer of mapOsmLayers(osmSource, { enabled, density: osmDensity })) map.addLayer(layer);
    }
    map.scene.rerender();
    setAttributions(map.getAttributions());
    // `provider`/`vectorProvider` are dependencies for the same reason the
    // borders and demo-layer effects list them: those two are what rebuild
    // the widget instance, and a rebuilt widget has no layers on it.
  }, [showOsm, osmSource, osmSublayers, osmDensity, provider, vectorProvider]);

  // ── Contour line-count readout (LayersPanel's "lines" info row) — polls
  //    the layer's CURRENTLY resolved field range while contour is visible,
  //    since a provider-backed contour re-derives its field asynchronously
  //    on its own schedule (widget.ts's `scheduleTileUpdate`/`updateProvider`)
  //    with no "field updated" event this page can subscribe to instead. ──
  useEffect(() => {
    if (!showContour) return;
    const id = window.setInterval(() => {
      const map = mapRef.current;
      if (!map) return;
      const range = map.getContourFieldRange(CONTOUR_LAYER_ID);
      setContourFieldRange((prev) => (prev?.min === range?.min && prev?.max === range?.max ? prev : range));
    }, 300);
    return () => window.clearInterval(id);
  }, [showContour]);

  // ── Rendering options -> `scene.setOptions()`. ─────────────────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    map.scene.setOptions({
      charMode,
      colorEncoding,
      useColors,
      smoothShading,
      wireframeJunctions,
      hiddenLines,
      solidWeightRamp: solidWeightRamp ? getSolidWeightRamp() ?? undefined : undefined,
    });
    map.scene.rerender();
  }, [charMode, colorEncoding, useColors, smoothShading, wireframeJunctions, hiddenLines, solidWeightRamp]);

  // ── Sun mode/time -> `map.setSun()` + `map.setKeyLight()`. DECLARED
  //    BEFORE the lighting effect on purpose: effects run in declaration
  //    order, and the lighting effect below reads
  //    `map.getKeyLightDirection()`, which must already reflect this
  //    render's mode. `setKeyLight` runs SECOND for the same reason within
  //    this effect — the sun outranks the headlight inside the widget, so
  //    the mode it resolves against has to be the current one.
  //    ────────────────────────────────────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    map.setSun({ mode: sunMode, date: mapSunManualInstant(sunDay, sunHour) });
    map.setKeyLight(mapKeyLightForSunMode(sunMode, projectionId));
  }, [sunMode, sunDay, sunHour, projectionId]);

  // ── Lighting -> `scene.setOptions()`. ──────────────────────────────────
  //    `map.getKeyLightDirection()` is read FRESH here rather than cached:
  //    when the widget owns the direction — the sun on an orbit projection,
  //    or Full mode's headlight — it is the same value the widget's own
  //    timer/camera writes, so page and widget can never disagree; whichever
  //    writes last writes the same answer. It is `null` when nobody owns it
  //    (a sheet outside a headlight, mid-`setProjection` blend), and the
  //    azimuth/elevation sliders take over in exactly those cases — the same
  //    cases the Dock dims them in.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    map.scene.setOptions(buildMapLighting(lighting, map.getKeyLightDirection()));
    map.scene.rerender();
  }, [lighting, sunMode, sunDay, sunHour, projectionId]);

  // ── Density -> host font-size (autoSize reads it back on next fit). ────
  useEffect(() => {
    applyDensity(false);
    const map = mapRef.current;
    if (!map) return;
    map.scene.fit();
    map.scene.rerender();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [density]);

  // ── Drag density -> `scene.setOptions({ interactiveDownscale })`. Only
  //    takes visible effect once a drag actually starts (see the pointer
  //    handlers above), so no `fit()`/`rerender()` is needed here — nothing
  //    on screen changes until the next `setInteracting(true)`. ────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    map.scene.setOptions({ interactiveDownscale: dragDensityToDownscale(dragDensity) });
  }, [dragDensity]);

  // ── Tilt -> map.setTilt() (works for both sheet and orbit projections —
  //    see widget.ts's `GlyphMapHandle.setTilt` doc). ──────────────────────
  const onTilt = useCallback((value: number) => {
    setTilt(value);
    mapRef.current?.setTilt(value);
  }, []);

  // ── Center/span sliders -> imperative `map.setView()`. ─────────────────
  const onCenter = useCallback((lon: number, lat: number) => {
    setCenterLon(lon);
    setCenterLat(lat);
    mapRef.current?.setView({ center: [lon, lat] });
  }, []);
  const onSpanChange = useCallback((value: number) => {
    setSpan(value);
    mapRef.current?.setView({ span: value });
  }, []);

  // ── Atlas availability (mirrors SynthWorkbench's own MutationObserver).
  //    `vectorProvider` MUST be a dep alongside `provider`: the widget-build
  //    effect above rebuilds (`map.destroy()` + a fresh `createGlyphMap`,
  //    a brand-new `map.scene.output` `<pre>`) whenever EITHER provider
  //    resolves — `provider` (terrain) typically first, `vectorProvider`
  //    (borders) after. Omitting it here left this effect's `MutationObserver`
  //    subscribed to the FIRST (terrain-only) `<pre>`, which the borders
  //    rebuild then destroys and detaches — no observer ever gets attached
  //    to the live one afterward, so `atlasReason` freezes at whatever it
  //    last read (often still `"Nothing rendered yet."` under real network
  //    latency) and the "Color encoding" control reads as permanently
  //    disabled. ───────────────────────────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const pre = map.scene.output;
    const recompute = (): void => {
      setAtlasReason(computeGlyphAtlasAvailability(pre, { useColors, charMode }).reason);
    };
    recompute();
    // Coalesced to one animation frame for the same reason `syncViewState`
    // above is: this observer fires on EVERY render's `<pre>` write, so
    // during continuous motion it ran `computeGlyphAtlasAvailability` (a DOM
    // walk) plus a React state push on every single frame — for a readout
    // that only ever changes when the render's CHARACTER SET does.
    let recomputeFrame: number | null = null;
    const observer = new MutationObserver(() => {
      if (recomputeFrame !== null) return;
      recomputeFrame = requestAnimationFrame(() => { recomputeFrame = null; recompute(); });
    });
    observer.observe(pre, { childList: true, subtree: true, characterData: true });
    return () => { if (recomputeFrame !== null) cancelAnimationFrame(recomputeFrame); observer.disconnect(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [provider, vectorProvider, projectionId, exaggeration]);

  // ── URL persistence. ────────────────────────────────────────────────────
  useEffect(() => {
    writeMapsUrlState({
      projection: projectionId,
      exaggeration,
      centerLon,
      centerLat,
      span,
      tilt,
      palette,
      // Token `g`, formerly the scene-wide ramp. `mapsUrlState.ts` still
      // names this key `glyphPalette`; retiring the scene-wide control under
      // the same token is the closest honest translation (an older link's
      // `g=blocks` now reads as "terrain in blocks"). See the report
      // accompanying this change for the rename + per-demo-layer tokens
      // that file should take next.
      glyphPalette: terrainGlyphPalette,
      charMode,
      colorEncoding,
      useColors,
      density,
      smoothShading,
      lightAzimuth: lighting.lightAzimuth,
      lightElevation: lighting.lightElevation,
      lightIntensity: lighting.lightIntensity,
      lightColor: lighting.lightColor,
      ambientIntensity: lighting.ambientIntensity,
      ambientColor: lighting.ambientColor,
      sunMode,
      sunDay,
      sunHour,
      contourFloor: contourMinElevation ?? MAPS_CONTOUR_WINDOW_OFF.min,
      contourCeiling: contourMaxElevation ?? MAPS_CONTOUR_WINDOW_OFF.max,
    });
  }, [projectionId, exaggeration, centerLon, centerLat, span, tilt, palette, terrainGlyphPalette, charMode, colorEncoding, useColors, density, smoothShading, lighting, sunMode, sunDay, sunHour, contourMinElevation, contourMaxElevation]);

  // ── Export bar ──────────────────────────────────────────────────────────
  const [copyState, setCopyState] = useState<"idle" | "copied" | "error">("idle");
  const handleCopyAscii = useCallback(async () => {
    const pre = mapRef.current?.scene.output ?? null;
    const text = extractAsciiFromPre(pre);
    if (text === null) {
      setCopyState("error");
      setTimeout(() => setCopyState("idle"), 1500);
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
      setCopyState("copied");
    } catch {
      setCopyState("error");
    }
    setTimeout(() => setCopyState("idle"), 1500);
  }, []);

  const [svgState, setSvgState] = useState<"idle" | "downloaded" | "error">("idle");
  const handleDownloadSvg = useCallback(() => {
    const pre = mapRef.current?.scene.output ?? null;
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const ok = downloadGlyphSvg(pre, `glyphcss-map-${projectionId}-${stamp}.svg`);
    setSvgState(ok ? "downloaded" : "error");
    setTimeout(() => setSvgState("idle"), 1500);
  }, [projectionId]);

  // Code panel toggle — closed by default, opened from the export bar next
  // to Copy ASCII / Download SVG, mirroring SynthWorkbench's own "Export"
  // toggle (`codeOpen`, `toggleCodeOpen`) exactly: same action class, same
  // `aria-expanded`, same title wording. Maps had no toggle at all before —
  // `CodePanel` mounted always-open, which is the defect this replaces.
  const [codeOpen, setCodeOpen] = useState(false);
  const toggleCodeOpen = useCallback(() => setCodeOpen((open) => !open), []);

  // ── Code panel — reuses GalleryWorkbench's `CodePanel` shell via its
  //    `override` prop (mapsKit.tsx's `buildMapsSnippet` doc: no @glyphcss/
  //    react or /vue bindings exist for maps yet, so every tab shows the
  //    same real vanilla snippet). ────────────────────────────────────────
  const mapsSnippet = useMemo(
    () => buildMapsSnippet({
      projectionId, exaggeration, centerLon, centerLat, span, tilt, palette, terrainGlyphPalette,
      backgroundColor, showBorders, borderColor, showContour, contourInterval, contourColor,
      contourMinElevation, contourMaxElevation,
    }),
    [
      projectionId, exaggeration, centerLon, centerLat, span, tilt, palette, terrainGlyphPalette,
      backgroundColor, showBorders, borderColor, showContour, contourInterval, contourColor,
      contourMinElevation, contourMaxElevation,
    ],
  );
  const mapsSnippets = useMemo(
    () => ({ html: mapsSnippet, vanilla: mapsSnippet, react: mapsSnippet, vue: mapsSnippet }),
    [mapsSnippet],
  );

  return (
    <InstrumentShell kind="synth">
      <InstrumentBody>
        <InstrumentRail
          id="maps-layers-panel"
          title="Layers"
          open={mobilePanel === "layers"}
        >
          <LayersPanel {...layersFolderInputs} />
        </InstrumentRail>
        <InstrumentMain elementRef={setStageHost}>
          <InstrumentViewport className="maps-viewport" elementRef={hostRef} />
          {providerError && <div className="maps-error">Couldn&apos;t load terrain data: {providerError}</div>}
          <StatsOverlay anchor="top-left" container={stageHost} />
          <MapSearchBox loadIndex={loadSearchIndex} onSelect={flyToSearchResult} />
          <div className="synth-export-bar">
            <button type="button" className="gw-code-panel__action" onClick={handleCopyAscii} title="Copy the rendered ASCII map to the clipboard">
              {copyState === "copied" ? "Copied" : copyState === "error" ? "Copy failed" : "Copy ASCII"}
            </button>
            <button type="button" className="gw-code-panel__action" onClick={handleDownloadSvg} title="Download the rendered map as an SVG file">
              {svgState === "downloaded" ? "Downloaded" : svgState === "error" ? "Download failed" : "Download SVG"}
            </button>
            <button
              type="button"
              className={`gw-code-panel__action${codeOpen ? " is-active" : ""}`}
              onClick={toggleCodeOpen}
              aria-expanded={codeOpen}
              title={codeOpen ? "Close export code window" : "Open export code window"}
            >
              Export
            </button>
          </div>
          {attributions.length > 0 && (
            <div className="maps-attribution">
              <AttributionCredit
                attributions={attributions.map((a) => ({ creator: a.name, license: a.license, sourceUrl: a.url, date: a.date }))}
              />
            </div>
          )}
          {(codeOpen || mobilePanel === "code") && (
            <CodePanel
              id="maps-code-panel"
              className={mobilePanel === "code" ? "is-mobile-open" : ""}
              override={{ snippets: mapsSnippets }}
            />
          )}
        </InstrumentMain>
        <Dock id="maps-controls-panel" className={mobilePanel === "controls" ? "is-mobile-open" : ""}>
          <MapsDockFolders
            projectionId={projectionId} onProjectionId={setProjectionId}
            centerLon={centerLon} centerLat={centerLat} span={span} maxSpan={maxSpan} tilt={tilt}
            lod={lod} degPerCell={degPerCell}
            onCenter={onCenter} onSpan={onSpanChange} onTilt={onTilt}
            charMode={charMode} charModeReason={charModeReason}
            wireframeJunctions={wireframeJunctions} hiddenLines={hiddenLines}
            solidWeightRamp={solidWeightRamp} colorEncoding={colorEncoding} atlasReason={atlasReason}
            density={density} dragDensity={dragDensity} useColors={useColors}
            smoothShading={smoothShading}
            onUpdateRendering={(partial) => {
              if (partial.charMode !== undefined) setCharMode(partial.charMode as MapCharMode);
              if (partial.wireframeJunctions !== undefined) setWireframeJunctions(partial.wireframeJunctions);
              if (partial.hiddenLines !== undefined) setHiddenLines(partial.hiddenLines);
              if (partial.solidWeightRamp !== undefined) setSolidWeightRamp(partial.solidWeightRamp);
              if (partial.colorEncoding !== undefined) setColorEncoding(partial.colorEncoding as MapColorEncoding);
              if (partial.density !== undefined) setDensity(partial.density);
              if (partial.dragDensity !== undefined) setDragDensity(partial.dragDensity);
              if (partial.useColors !== undefined) setUseColors(partial.useColors);
              if (partial.smoothShading !== undefined) setSmoothShading(partial.smoothShading);
            }}
            lighting={lighting}
            onUpdateLighting={(partial) => setLighting((l) => ({ ...l, ...partial }))}
            sunMode={sunMode} sunDay={sunDay} sunHour={sunHour}
            onSunMode={(mode) => {
              // Entering manual SEEDS the day/hour from the real clock, so
              // the sun stays where it was instead of jumping to whatever
              // instant a stale slider pair happens to name.
              if (mode === "manual" && sunMode !== "manual") {
                const seeded = mapSunManualFields(Date.now());
                setSunDay(seeded.day);
                setSunHour(Math.round(seeded.hour * 4) / 4);
              }
              setSunMode(mode);
            }}
            onSunDay={setSunDay}
            onSunHour={setSunHour}
          />
        </Dock>
      </InstrumentBody>
      <InstrumentMobileTabs label="Maps panels" items={[
        { id: "layers", label: "Layers", controls: "maps-layers-panel", expanded: mobilePanel === "layers", onClick: () => setMobilePanel((c) => c === "layers" ? null : "layers") },
        { id: "controls", label: "Controls", controls: "maps-controls-panel", expanded: mobilePanel === "controls", onClick: () => setMobilePanel((c) => c === "controls" ? null : "controls") },
        { id: "code", label: "Code", controls: "maps-code-panel", expanded: mobilePanel === "code", onClick: () => setMobilePanel((c) => c === "code" ? null : "code") },
      ]} />
    </InstrumentShell>
  );
}

// Small dock-content component (a Dock child, so `useDockGui()` resolves)
// bundling the map-specific folders + the reused DockLighting/DockRendering.
interface RenderingPartial {
  charMode?: MapCharMode;
  wireframeJunctions?: boolean;
  hiddenLines?: "show" | "hide";
  solidWeightRamp?: boolean;
  colorEncoding?: MapColorEncoding;
  density?: number;
  dragDensity?: number;
  useColors?: boolean;
  smoothShading?: boolean;
}

function MapsDockFolders(props: {
  projectionId: MapProjectionId; onProjectionId: (id: MapProjectionId) => void;
  centerLon: number; centerLat: number; span: number; maxSpan: number; tilt: number; lod: number; degPerCell: number;
  onCenter: (lon: number, lat: number) => void; onSpan: (v: number) => void; onTilt: (v: number) => void;
  charMode: MapCharMode; charModeReason: string | null;
  wireframeJunctions: boolean; hiddenLines: "show" | "hide"; solidWeightRamp: boolean;
  colorEncoding: MapColorEncoding; atlasReason: string | null;
  density: number; dragDensity: number; useColors: boolean; smoothShading: boolean;
  onUpdateRendering: (partial: RenderingPartial) => void;
  lighting: MapLighting;
  onUpdateLighting: (partial: Partial<MapLighting>) => void;
  sunMode: MapSunMode; sunDay: number; sunHour: number;
  onSunMode: (mode: MapSunMode) => void;
  onSunDay: (day: number) => void;
  onSunHour: (hour: number) => void;
}) {
  const gui = useDockGui();

  useViewFolder(gui, {
    centerLon: props.centerLon, centerLat: props.centerLat, span: props.span, maxSpan: props.maxSpan, tilt: props.tilt,
    isOrbitProjection: props.projectionId === "globe", lod: props.lod, degPerCell: props.degPerCell,
    onCenter: props.onCenter, onSpan: props.onSpan, onTilt: props.onTilt,
  });

  return (
    <>
      <MapsProjectionControls
        folder={gui}
        projectionId={props.projectionId}
        onProjectionId={props.onProjectionId}
      />
      {/*
        Several of `DockRendering`'s rows are hidden here rather than wired:
        Render mode, Density, Glyph palette, Feature edges, Crease angle. The
        folder is SHARED with /gallery (and, through it, every other page
        that mounts it), so each removal is an opt-out prop defaulting to
        today's behaviour — see `RenderingFolderInputs`' own docs for the
        per-row reasoning. The values below still have to be supplied because
        the folder computes real state from them: `renderMode` is genuinely
        this scene's mode and drives which OTHER rows are enabled (character
        mode, weighted shading, hidden lines), and `onRenderModeChange` cannot
        fire while its row is hidden; `glyphPalette` is the scene's real ramp,
        now set exclusively per-layer. `featureEdges`/`creaseAngle` are inert
        here — neither is forwarded to the map's scene.
      */}
      <DockRendering
        renderMode={MAP_SCENE_RENDER_MODE}
        showRenderMode={false}
        onRenderModeChange={() => {}}
        semanticAvailable={false}
        featureEdges={0}
        showFeatureEdges={false}
        // The scene's real (and now fixed) ramp — supplied because the
        // shared folder computes state from it, exactly as `renderMode` is.
        // The ROW itself has moved to the per-layer cards, hidden here with
        // the same opt-out `showRenderMode`/`showDensity` get.
        glyphPalette={MAP_SCENE_GLYPH_PALETTE}
        showGlyphPalette={false}
        charMode={props.charMode}
        charModeReason={props.charModeReason}
        charModeOptions={MAPS_CHAR_MODE_OPTIONS}
        wireframeJunctions={props.wireframeJunctions}
        hiddenLines={props.hiddenLines}
        solidWeightRamp={props.solidWeightRamp}
        colorEncoding={props.colorEncoding}
        atlasReason={props.atlasReason}
        density={props.density}
        dragDensity={props.dragDensity}
        // Maps exposes density per-layer instead (Terrain/Borders/Contour
        // cards in the left rail) — see `RenderingFolderInputs.showDensity`'s
        // doc for why a second scene-wide "Density" row in this Dock would
        // be a confusing duplicate. "Drag density" stays visible: it's an
        // interaction-performance knob, not a resolution knob.
        showDensity={false}
        useColors={props.useColors}
        smoothShading={props.smoothShading}
        creaseAngle={0}
        showCreaseAngle={false}
        onUpdateScene={props.onUpdateRendering}
      />
      <DockLighting
        lightAzimuth={props.lighting.lightAzimuth}
        lightElevation={props.lighting.lightElevation}
        lightIntensity={props.lighting.lightIntensity}
        lightColor={props.lighting.lightColor}
        ambientIntensity={props.lighting.ambientIntensity}
        ambientColor={props.lighting.ambientColor}
        // On an ORBIT projection SOMETHING always owns the key light's
        // direction — the sun in Real time/Manual, the camera-following
        // headlight in Full — so Azimuth/Elev have nothing left to aim and
        // are dimmed with the reason rather than left live and silently
        // ignored. On a SHEET they still do real work in every mode (relief
        // hillshading; the sun's terminator there is a separate per-cell
        // term, and Full leaves the light alone because a flat map has no
        // dark hemisphere to fix), so they stay enabled.
        directionLocked={isOrbitProjectionId(props.projectionId)}
        directionLockedReason={props.sunMode === "off"
          ? "Full lights the globe from the camera, so the whole visible face stays lit — switch Sun to Manual to aim a light by hand."
          : "The sun owns the key light's direction in this mode — switch Sun to Manual to aim it by hand."}
        onUpdateScene={props.onUpdateLighting}
        extras={(folder) => (
          <MapsSunControls
            folder={folder}
            mode={props.sunMode}
            day={props.sunDay}
            hour={props.sunHour}
            onMode={props.onSunMode}
            onDay={props.onSunDay}
            onHour={props.onSunHour}
          />
        )}
      />
    </>
  );
}
