/**
 * Map-domain data + Dock folders for `/maps` (MAPS.md §15). `DockLighting`
 * and `DockRendering` (`../Dock`) are reused AS-IS — every field either
 * folder needs is a real `createGlyphScene` option, reached through
 * `map.scene.setOptions()` (the documented escape hatch,
 * `packages/maps/src/widget.ts`'s `GlyphMapHandle.scene` doc). `DockCamera`
 * is deliberately NOT reused: `createGlyphMap` owns an internal orthographic
 * camera derived from `view.center`/`span` (see widget.ts's `syncCameraToView`),
 * and DockCamera's rotX/rotY/zoom/FPV/perspective controls would either
 * desync from that view state on the next pan/zoom or (the projection
 * toggle) assume a perspective camera the widget's screen math never
 * builds. A map-specific "View" folder replaces it below, built from the
 * SAME primitives (`useFolder`/`useSlider`) — same pattern `SynthWorkbench`'s
 * own `SynthDock` already uses for its own scene/camera, which also isn't
 * Gallery-shaped. Projection itself is NOT a Dock folder — it's a segmented
 * icon picker portaled into a slot at the TOP of the Dock, above every
 * folder (`MapsProjectionControls` below), the same inline
 * label-left/buttons-right shape `MapsSunControls` uses for its own toggle.
 */
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { CSSProperties, ReactNode } from "react";
import type { GUI } from "lil-gui";
import {
  glyphMapEquirectangular,
  glyphMapGlobe,
  glyphMapMercator,
  type GlyphMapClassifier,
  type GlyphMapProjection,
  type GlyphMapKeyLightMode,
  type GlyphMapLabelAnchor,
  type GlyphMapSunMode,
} from "@glyphcss/maps";
import { PLACE_TILE_LAYERS, type PlaceTileLayer } from "../../lib/placeTilesProvider";
import { COUNTRY_TILE_LAYERS, type CountryTileLayer } from "../../lib/countryTilesProvider";
import { useDockSlot, useFolder, useReadonlyText, useSlider, type DockController } from "../Dock/primitives";
import {
  MAP_BEARING_HOME,
  MAP_BEARING_SLIDER_RANGE,
  mapBearingIsNorth,
  mapTiltIsLevel,
  mapTiltResetValue,
  mapTiltSliderRange,
} from "./mapsView";
// One-way: `mapsOsm.ts` imports `@glyphcss/maps` and nothing from this file,
// so the OSM card can read its own cost rule from the same place the page's
// mount path does rather than restating it.
import { mapOsmStrokeOverlayCount, mapOsmSublayerTooltip } from "./mapsOsm";
import { IconToggle, ToggleIcon } from "../SynthWorkbench/synthKit";

// ── Projections ────────────────────────────────────────────────────────────

export type MapProjectionId = "equirectangular" | "mercator" | "globe";

/** Re-exported under the page's own naming so `mapsUrlState`/`MapsWorkbench` speak one type. `"off"` is the UI's "Full". */
export type MapSunMode = GlyphMapSunMode;

export const PROJECTION_OPTIONS: Record<string, MapProjectionId> = {
  Equirectangular: "equirectangular",
  Mercator: "mercator",
  Globe: "globe",
};

export function buildMapProjection(
  id: MapProjectionId,
  exaggeration: number,
): GlyphMapProjection {
  switch (id) {
    case "equirectangular": return glyphMapEquirectangular({ exaggeration });
    case "mercator": return glyphMapMercator({ exaggeration });
    case "globe": return glyphMapGlobe({ exaggeration });
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
  | "default" | "ascii" | "lines" | "blocks" | "stars" | "arrows" | "math" | "binary" | "hex" | "calibrated";

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

export const POINT_DATASET_OPTIONS = [...COUNTRY_TILE_LAYERS, ...PLACE_TILE_LAYERS]
  .map((value) => ({ value, label: POINT_DATASET_LABELS[value] }));

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

export function paletteColorsFor(name: MapPaletteName, classifier: GlyphMapClassifier): (elev: number) => string | undefined {
  const colors = MAP_PALETTES[name];
  return (elev: number) => {
    const band = classifier.classifyValue ? classifier.classifyValue(elev) : 0;
    return colors[band] ?? colors[colors.length - 1];
  };
}

// ── "Layers" panel — expandable per-layer CARDS in the LEFT RAIL, directly
//    under the rail's shared "Layers" header (the Projection picker used to
//    sit above these cards in the same rail; it now lives in the Dock —
//    see `MapsProjectionControls` below). Styled after
//    SynthWorkbench's own collapsible `LayerGroup` (user ask: "some kind of
//    UI like the synth voices, but in this case its map layers") — see
//    `../SynthWorkbench/synthKit.tsx`'s `LayerGroup` and
//    `instrument-workbench.css` for the source of truth these classes are
//    styled from: `.layer-group`/`.layer-group-head`/`.layer-group-toggle`+
//    `.layer-group-caret`/`.layer-group-body` for the card shell,
//    `.layer-group-check` for the bracket enable checkbox, `.voice-slider`/
//    `.voice-slider-track`/`.voice-color` for every slider/swatch row inside
//    a card. A collapsed card is just the enable checkbox + name; expanding
//    it reveals that layer's OWN controls, density among them — replacing
//    the earlier flat-row design, which put density on the collapsed row
//    itself and had no room for palette/exaggeration/color at all. This
//    file supplies only the new row shapes those existing idioms don't
//    already cover (`.maps-layer-color-row`/`.maps-layer-select-row`/
//    `.maps-layer-info-row`, maps-workbench.css), same "row GRID only"
//    convention this file has followed since the original flat-row design.
//
//    Every card's DENSITY slider stays visibly dimmed+disabled
//    (`.maps-layer-slider--off`) unless `DensityRow`'s own `enabled` prop is
//    true. `raster`'s density passes straight through to glyphcss's own
//    per-mesh `density` (see `GlyphMapRasterLayer.density`'s doc). Borders
//    (`line`) and Contour now wire through too: a stroke layer's `density`
//    (when it's a genuine value, not `1`/omitted) routes through
//    `scene.setViewportOverlayDensities` to its own meshless, full-viewport
//    output grid — see `GlyphMapLineLayer.density`'s doc in
//    `@glyphcss/maps`'s `widget.ts` and glyphcss's own
//    `GlyphSceneHandle.setViewportOverlayDensities` doc for the mechanism.
//    `background` has no glyph resolution to multiply at all
//    (`GlyphMapBackgroundLayer.density`'s doc), so it carries no density row
//    rather than a dimmed one, and — having no toggleable per-layer STATE
//    either (a flat CSS colour is either applied or it isn't) — it is not a
//    `LayerCard` at all: a plain always-present colour row.
//
//    Palette and exaggeration used to live in the right-hand Dock even
//    though both are per-raster-layer properties (`GlyphMapRasterLayer
//    .colors`, the projection's own `exaggeration` argument) — moved into
//    the Terrain card so the Dock stays scene-level concerns only (camera,
//    lighting, glyph presentation), one home per control. RENDER MODE moved
//    the same way and for the same reason, but it is not merely relocated:
//    a map is not one picture in one mode (terrain reads as `solid`, an
//    overlay as `ink`), so there is no scene-wide render mode to relocate —
//    every OTHER MESH-BACKED card carries its own `ModeRow` instead (see its
//    doc). Terrain does NOT: a relief mesh has no reason to render as
//    anything but `solid` (`wireframe`/`ink` never made sense for it, unlike
//    a symbolic overlay), so its card carries no mode row at all — pinned to
//    `MAP_SCENE_RENDER_MODE`, the same mode the shared base grid already
//    rasterizes in, which is what makes it free.
//    The GLYPH PALETTE (the character ramp) moved out of the Dock on exactly
//    the same argument and lands as each mesh-backed card's own `GlyphRow` —
//    which is also why the Terrain card's colour ramp is now labelled
//    `colors` rather than `palette`: one card, two ramps, neither of which
//    "palette" names unambiguously. `sampler`/`simplify` are
//    READ-ONLY provenance strings baked into the tile pyramid at build time
//    (`bake-geo-tiles.mjs`/`bake-vector-tiles.mjs`) — there is no live
//    control that re-samples or re-simplifies already-baked tiles, so they
//    render as an info row, not a slider with nothing wired behind it.

function densityFill(v: number, min: number, max: number): CSSProperties {
  return { ["--fill" as string]: `${((v - min) / (max - min)) * 100}%` } as CSSProperties;
}

// ── Editable readouts ─────────────────────────────────────────────────────

/**
 * The VALUE column of a layer-card row: a real text input, not a label, so a
 * number can be typed as well as dragged. The Dock's own number rows have
 * always been type-to-set (`.dn-floating-controls .lil-gui .controller.number
 * input`, gallery-workbench.css), and these static readouts were the visible
 * break in that system — the reported case being a contour floor that could
 * not be set to exactly 0 m.
 *
 * The commit contract is `SynthWorkbench`'s `EditableReadout` verbatim: a
 * draft string while focused, commit on blur and on Enter, revert on Escape,
 * and a value that fails to parse reverts rather than writing NaN. This is a
 * sibling of that component rather than a reuse of it because every readout
 * on this page either carries a unit its own `format` prints (`"1.2M"`,
 * `"120 km"`, `"≥ 3"`), or lives in a value space its slider does not share
 * (the height rows travel in LOG position), or has a non-numeric state at all
 * (the contour window's unbounded `null`, and a hex colour). `EditableReadout`
 * hardcodes `Number.parseFloat` + a numeric clamp, which inverts none of
 * those — and on such a row a bare focus-then-blur would silently commit the
 * wrong number. `parse` is therefore always the format's own inverse, passed
 * beside it. The default `className` is the same one `EditableReadout`
 * renders, so the two are visually identical.
 *
 * A typed value is deliberately NOT snapped to the slider's `step`: the step
 * is a DRAG granularity, and typing exists precisely to reach values between
 * two detents (the contour window persists at 10 m while its slider steps at
 * 50 m; a log height slider's step is very coarse in metres at the top of
 * its range).
 */
export function MapsReadout<T>({
  value, format, parse, onCommit,
  disabled = false, title, className = "voice-slider-readout", inputMode = "decimal",
}: {
  value: T;
  format: (v: T) => string;
  /** The inverse of {@link format}. `null` means "not a value" — revert. */
  parse: (raw: string) => { readonly value: T } | null;
  onCommit: (next: T) => void;
  disabled?: boolean;
  title?: string;
  className?: string;
  inputMode?: "decimal" | "text";
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const cancelledRef = useRef(false);
  return (
    <input
      type="text"
      inputMode={inputMode}
      spellCheck={false}
      className={className}
      title={title}
      disabled={disabled}
      value={draft ?? format(value)}
      onFocus={() => setDraft(format(value))}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        if (cancelledRef.current) { cancelledRef.current = false; setDraft(null); return; }
        const parsed = parse(draft ?? format(value));
        if (parsed) onCommit(parsed.value);
        setDraft(null);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          (e.target as HTMLInputElement).blur();
        } else if (e.key === "Escape") {
          cancelledRef.current = true;
          (e.target as HTMLInputElement).blur();
        }
      }}
    />
  );
}

/**
 * `parse` for a readout whose `format` IS invertible by `Number.parseFloat` —
 * a bare number, or a number with a trailing unit (`"1.0x"`, `"500m"`,
 * `"9 px"`, `"3 cells"`). Clamps to the control's own range; `integer` rounds,
 * for a row whose unit is inherently whole (pixels, cells, metres of relief).
 */
export function parseMapsNumber(min: number, max: number, integer = false) {
  return (raw: string): { readonly value: number } | null => {
    const n = Number.parseFloat(raw);
    if (!Number.isFinite(n)) return null;
    const clamped = Math.min(max, Math.max(min, n));
    return { value: integer ? Math.round(clamped) : clamped };
  };
}

/**
 * Metres from a {@link formatHeightMeters} string (`"800 m"`, `"1.5 km"`).
 * A bare number is METRES — the unit both height rows declare their bounds
 * in ({@link EXTRUSION_HEIGHT_BOUNDS_M}, {@link HEATMAP_RELIEF_HEIGHT_BOUNDS_M}).
 */
export function parseHeightMeters(raw: string): number | null {
  const m = /^\s*(-?\d*\.?\d+)\s*(km|m)?\s*$/i.exec(raw);
  if (!m) return null;
  const n = Number.parseFloat(m[1]);
  if (!Number.isFinite(n)) return null;
  return m[2]?.toLowerCase() === "km" ? n * 1_000 : n;
}

// ── Layer-row readout formats, and their inverses ────────────────────────
// Module scope, not closures inside the component, so
// `MapsWorkbench.readouts.test.ts` can assert the round trip directly. They
// live here, beside the other readout parsers, rather than in
// `MapsWorkbench.tsx` where the rows that use them are declared: a test that
// only needs three pure string functions should not have to import the whole
// page component.
//
// `LayerSliderSpec.parse`'s doc: a row whose readout prints a magnitude
// suffix, a different unit from the value's own, or a leading symbol MUST
// supply an inverse, because the readout is a text INPUT now — without one a
// bare focus-then-blur commits `Number.parseFloat`'s reading of the formatted
// string ("1.2M" -> 1.2 people, "120 km" -> 120 metres), silently destroying
// the value. Each parser accepts what its own format prints, plus the
// plainest thing a reader would type instead.

/** Model-height readout: whole kilometres. */
export const formatKm = (m: number): string => `${Math.round(m / 1000)} km`;
/** Symbol population readout: `1.2M` above a million, `500k` below. */
export const formatPeople = (n: number): string =>
  (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : `${Math.round(n / 1000)}k`);

const clampRound = (n: number, min: number, max: number) => ({ value: Math.round(Math.min(max, Math.max(min, n))) });

/** Inverse of {@link formatKm}: a bare number is KILOMETRES (the unit the row prints); an explicit `m` suffix is metres. */
export const parseKm = (min: number, max: number) => (raw: string) => {
  const m = /^\s*(-?\d*\.?\d+)\s*(km|m)?\s*$/i.exec(raw);
  if (!m) return null;
  const n = Number.parseFloat(m[1]);
  if (!Number.isFinite(n)) return null;
  return clampRound(m[2]?.toLowerCase() === "m" ? n : n * 1_000, min, max);
};

/** Inverse of {@link formatPeople}: accepts the `M`/`k` magnitude suffix the format prints, and a plain head count. */
export const parsePeople = (min: number, max: number) => (raw: string) => {
  const m = /^\s*(-?\d*\.?\d+)\s*([mk])?\s*$/i.exec(raw);
  if (!m) return null;
  const n = Number.parseFloat(m[1]);
  if (!Number.isFinite(n)) return null;
  const s = m[2]?.toLowerCase();
  return clampRound(s === "m" ? n * 1_000_000 : s === "k" ? n * 1_000 : n, min, max);
};

/** Inverse of the prominence row's `≥ n`: `Number.parseFloat("≥ 3")` is NaN, so the symbol has to be consumed explicitly. */
export const parsePriority = (min: number, max: number) => (raw: string) => {
  const m = /^\s*(?:≥|>=)?\s*(-?\d*\.?\d+)\s*$/.exec(raw);
  if (!m) return null;
  const n = Number.parseFloat(m[1]);
  if (!Number.isFinite(n)) return null;
  return clampRound(n, min, max);
};

/**
 * `#rgb`/`#rrggbb`, with or without the `#`, normalised to the canonical
 * `#rrggbb` an `<input type="color">` requires. `null` for anything else, so
 * a half-typed colour reverts instead of writing an invalid value.
 */
export function parseMapsHex(raw: string): string | null {
  const m = /^\s*#?([0-9a-f]{3}|[0-9a-f]{6})\s*$/i.exec(raw);
  if (!m) return null;
  const hex = m[1].toLowerCase();
  return `#${hex.length === 3 ? hex.replace(/./g, (c) => c + c) : hex}`;
}

function LayerCard({ label, visible, onVisible, children }: {
  label: string;
  visible: boolean;
  onVisible: (v: boolean) => void;
  children: ReactNode;
}) {
  // Disclosure IS the enable checkbox — an enabled layer always shows its
  // controls and cannot be collapsed away from them, and a disabled layer has
  // nothing worth tuning. That removes the separate caret button entirely
  // rather than keeping two controls whose states could disagree.
  return (
    <div className="layer-group maps-layer-card">
      <div className="layer-group-head maps-layer-head">
        <label className="layer-group-check maps-layer-check" title={`${label} — show or hide this layer`}>
          <input type="checkbox" checked={visible} onChange={(e) => onVisible(e.target.checked)} />
          <span>{label}</span>
        </label>
      </div>
      {visible && <div className="layer-group-body maps-layer-body">{children}</div>}
    </div>
  );
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
const DENSITY_MIN = 1;
const DENSITY_MAX = 4;
const DENSITY_STEP = 0.1;
const formatDensity = (v: number) => `${v.toFixed(1)}x`;

export function DensityRow({ label, density, onDensity, enabled }: {
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
    <label
      className={`voice-slider maps-layer-slider${enabled ? "" : " maps-layer-slider--off"}`}
      title={enabled
        ? `${label} density — glyph resolution multiplier for this layer (1x-4x)`
        : `${label} density — not wired through to the renderer for this layer type yet`}
    >
      <span>density</span>
      <span className="voice-slider-track">
        <input type="range" min={DENSITY_MIN} max={DENSITY_MAX} step={DENSITY_STEP} disabled={!enabled} value={density} style={densityFill(density, DENSITY_MIN, DENSITY_MAX)} onChange={(e) => onDensity(+e.target.value)} />
      </span>
      <MapsReadout
        value={density}
        disabled={!enabled}
        format={formatDensity}
        parse={parseMapsNumber(DENSITY_MIN, DENSITY_MAX)}
        onCommit={onDensity}
        title="Type a multiplier between 1 and 4."
      />
    </label>
  );
}

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
 * {@link OSM_DENSITYLESS_TYPES} against each row's OWN type, never a list of
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
const OSM_DENSITY_TITLES: Record<string, (label: string) => string> = {
  line: (label) => `${label} density — a stroke row is stamped into a full-viewport overlay grid, and each DISTINCT density among the stroke rows (Waterways, Roads, Boundaries) buys another grid and another depth pass: measured at 140x63, one grid at 2x costs 27.4 ms/render and three at 2/2.1/2.2 cost 63.4 ms, so it is the COUNT that is charged for. Sharing one number with the other strokes costs nothing.`,
  fill: (label) => `${label} density — free to differ. This row renders in its own pass at any value above 1x, so a number of its own costs no more than sharing one.`,
  "fill-extrusion": (label) => `${label} density — free to differ. This row renders in its own pass at any value above 1x, so a number of its own costs no more than sharing one.`,
  symbol: (label) => `${label} — positioned labels rather than geometry, so this row has no density: nothing in the renderer reads one for it.`,
  circle: (label) => `${label} — positioned markers rather than geometry, so this row has no density: nothing in the renderer reads one for it.`,
};
/** The two layer types the OSM card mounts that read no `density` at all — so their rows carry no density control. */
const OSM_DENSITYLESS_TYPES = new Set(["symbol", "circle"]);

/**
 * The one layer type on this card that DRAWS LABELS — so its rows, and only
 * its rows, carry the placement control below.
 *
 * Derived against each row's own type for the reason
 * {@link OSM_DENSITYLESS_TYPES} is, and the reason is not hypothetical here:
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
const OSM_LABEL_TYPES = new Set(["symbol"]);

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
const OSM_LABEL_ANCHOR_OPTIONS: readonly GlyphMapLabelAnchor[] = ["center", "left", "right", "top", "bottom"];

/**
 * One icon per placement: the feature's POINT as a filled dot at the centre
 * of the frame, and the LABEL as a box whose named edge sits on it.
 *
 * Drawing both is the whole point, because the vocabulary is MapLibre's and
 * MapLibre's `left` puts the label's LEFT EDGE on the point — so the label
 * reads out to the RIGHT of it. A control that showed only a bar on the left
 * for "left" would be showing the opposite of what the option does. The icon
 * shows where the label actually goes; the `title` says the rule in words.
 */
const OSM_LABEL_ANCHOR_ICONS: Record<GlyphMapLabelAnchor, ReactNode> = (() => {
  // Half-extents of the label box: 4 across, 2 down, on the 16x16 frame every
  // `ToggleIcon` uses.
  const box = (x: number, y: number) => (
    <ToggleIcon strokeWidth={1.2}>
      <rect x={x - 4} y={y - 2} width="8" height="4" rx="0.8" />
      <circle cx="8" cy="8" r="1.3" fill="currentColor" stroke="none" />
    </ToggleIcon>
  );
  return {
    center: box(8, 8),
    left: box(12, 8),
    right: box(4, 8),
    top: box(8, 11),
    bottom: box(8, 5),
    // Present so the record is total over the type — the control offers the
    // five above (see `OSM_LABEL_ANCHOR_OPTIONS`), and a corner reaching it
    // would otherwise render an empty button.
    "top-left": box(12, 11),
    "top-right": box(4, 11),
    "bottom-left": box(12, 5),
    "bottom-right": box(4, 5),
  };
})();

const OSM_LABEL_ANCHOR_DESCRIPTIONS: Record<string, string> = {
  center: "the label sits ON the point, centred — what a labelled row has always drawn",
  left: "the label's LEFT edge sits on the point, so the name reads out to the right of it",
  right: "the label's RIGHT edge sits on the point, so the name reads back to the left of it",
  top: "the label's TOP edge sits on the point, so the name hangs below it",
  bottom: "the label's BOTTOM edge sits on the point, so the name sits above it",
};

const OSM_LABEL_ANCHOR_TOGGLE = OSM_LABEL_ANCHOR_OPTIONS.map((value) => ({
  value,
  icon: OSM_LABEL_ANCHOR_ICONS[value],
  label: value,
  desc: OSM_LABEL_ANCHOR_DESCRIPTIONS[value],
}));

/**
 * One row of the LIVE card: a public feed, its toggle, and what it is
 * currently showing.
 *
 * Geometry is `OsmSublayerRow`'s exactly — name / widget / value, with the
 * checkbox inside the same `.maps-osm-row-widget` flex head so the card
 * body's three-column grid is unchanged. The value column carries the
 * READOUT rather than a control, because a live row has nothing to tune: it
 * is on or off, and what a reader wants to know is whether it has anything
 * and how old it is.
 *
 * The reason line is a separate row underneath and appears ONLY while
 * something is wrong. A row showing 385 events whose last refresh failed is
 * still showing something true, and saying so in a second line is what
 * distinguishes it from a row that never loaded at all.
 */
function LiveFeedRow({ row, onToggle }: { row: LiveFeedInputs; onToggle: (on: boolean) => void }) {
  return (
    <>
      <label className="voice-slider maps-layer-slider maps-layer-bool-row maps-osm-row maps-live-row" title={row.tooltip}>
        <span>{row.label}</span>
        <span className="maps-osm-row-widget">
          <span className="layer-group-check maps-layer-bool-check">
            <input type="checkbox" checked={row.on} onChange={(e) => onToggle(e.target.checked)} />
          </span>
        </span>
        <span className={`maps-layer-info-value${row.warn ? " maps-layer-info-warn" : ""}`}>{row.value}</span>
      </label>
      {row.note === null ? null : (
        <div className="maps-layer-info-row maps-live-note" title="The last refresh did not land. Whatever the row already had is still on the map; the next refresh tries again.">
          <span aria-hidden="true">{"\u21b3"}</span>
          <span className="maps-layer-info-value maps-layer-info-warn">{row.note}</span>
        </div>
      )}
    </>
  );
}

function OsmSublayerRow({ row, onToggle, onDensity, onAnchor }: {
  row: OsmSublayerInputs;
  onToggle: (on: boolean) => void;
  onDensity: (v: number) => void;
  onAnchor: (anchor: GlyphMapLabelAnchor) => void;
}) {
  const wired = !OSM_DENSITYLESS_TYPES.has(row.type);
  const labelled = OSM_LABEL_TYPES.has(row.type);
  return (
    <label
      // `maps-osm-row--density-off`, NOT `maps-layer-slider--off`: on this
      // row only the DENSITY is gated — the toggle beside it is exactly how
      // a reader turns the row back on, so dimming the whole line (which is
      // what `--off` does, name column included) would read as "this control
      // is dead" about a control that is not. A densityless row never takes
      // it: there is nothing there to dim.
      className={`voice-slider maps-layer-slider maps-layer-bool-row maps-osm-row${wired && !row.on ? " maps-osm-row--density-off" : ""}${labelled ? " maps-osm-row--labelled" : ""}`}
      title={OSM_DENSITY_TITLES[row.type]?.(row.label) ?? `${row.label} — the OpenMapTiles source layer this maps onto (OpenStreetMap data, ODbL).`}
    >
      {/*
        The row's NAME carries what the layer IS; the `title` on the `<label>`
        around it carries what the row's DENSITY costs. Two titles rather than
        one concatenation because a browser shows the INNERMOST one, so
        pointing at "Waterways" answers "what is this?" and pointing at its
        slider answers "what does moving this cost?" — which is the question
        each of those two targets actually raises. `undefined`, never an empty
        string, for a row `mapsOsm.ts` has no summary for: an empty `title`
        renders an empty tooltip box in some browsers, and the gap is a red
        test (`mapsOsm.tooltips.test.ts`) rather than something to paper over
        here.
      */}
      <span title={mapOsmSublayerTooltip(row.id) ?? undefined}>{row.label}</span>
      <span className="maps-osm-row-widget">
        <span className="layer-group-check maps-layer-bool-check">
          <input type="checkbox" checked={row.on} onChange={(e) => onToggle(e.target.checked)} />
        </span>
        {wired && (
          <span className="voice-slider-track">
            <input
              type="range"
              min={DENSITY_MIN}
              max={DENSITY_MAX}
              step={DENSITY_STEP}
              disabled={!row.on}
              value={row.density}
              style={densityFill(row.density, DENSITY_MIN, DENSITY_MAX)}
              onChange={(e) => onDensity(+e.target.value)}
            />
          </span>
        )}
        {labelled && (
          // `preventDefault` on the group, not on each button: the ROW is a
          // `<label>` whose control is the toggle beside this, and a click
          // that reaches the label runs its activation behaviour on that
          // checkbox. The HTML spec already exempts interactive descendants,
          // so a real browser never forwards a button click here — this is
          // the guard for anything that does not implement that clause,
          // which includes the DOM these rows are tested against.
          <span className="maps-osm-anchor" onClick={(e) => e.preventDefault()}>
            <IconToggle
              groupTitle={`${row.label} label placement — which part of the label sits on the feature's own point (MapLibre's text-anchor). It is a per-LAYER cartographic choice, so every labelled row answers it for itself.`}
              options={OSM_LABEL_ANCHOR_TOGGLE}
              value={row.anchor}
              onChange={(v) => onAnchor(v as GlyphMapLabelAnchor)}
            />
          </span>
        )}
      </span>
      {wired && (
        <MapsReadout
          value={row.density}
          disabled={!row.on}
          format={formatDensity}
          parse={parseMapsNumber(DENSITY_MIN, DENSITY_MAX)}
          onCommit={onDensity}
          title="Type a multiplier between 1 and 4 for this row alone."
        />
      )}
    </label>
  );
}

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
const LAYER_RENDER_MODES: readonly MapLayerRenderMode[] = ["solid", "wireframe", "ink"];
const LAYER_RENDER_MODE_LABELS: Record<MapLayerRenderMode, string> = {
  solid: "Solid",
  wireframe: "Wireframe",
  ink: "Ink",
};

function ModeRow({ label, value, onChange }: { label: string; value: MapLayerRenderMode; onChange: (v: MapLayerRenderMode) => void }) {
  return (
    <label
      className="maps-layer-select-row"
      title={`${label} render mode — how THIS layer rasterizes. "Solid" is the scene's own mode and costs nothing; any other mode renders this layer in its own pass.`}
    >
      <span>mode</span>
      <span className="gx-select">
        <select value={value} onChange={(e) => onChange(e.target.value as MapLayerRenderMode)}>
          {LAYER_RENDER_MODES.map((mode) => <option key={mode} value={mode}>{LAYER_RENDER_MODE_LABELS[mode]}</option>)}
        </select>
      </span>
    </label>
  );
}

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
function GlyphRow({ label, value, onChange }: { label: string; value: MapLayerGlyphPalette; onChange: (v: MapLayerGlyphPalette) => void }) {
  return (
    <label
      className="maps-layer-select-row"
      title={`${label} glyph palette — the CHARACTER ramp this layer shades with (not its colours; that is the "colors" row). "Default" is the scene's own ramp and costs nothing; any other ramp renders this layer in its own pass.`}
    >
      <span>glyphs</span>
      <span className="gx-select">
        <select value={value} onChange={(e) => onChange(e.target.value as MapLayerGlyphPalette)}>
          {Object.entries(GLYPH_PALETTE_OPTIONS).map(([display, id]) => <option key={id} value={id}>{display}</option>)}
        </select>
      </span>
    </label>
  );
}

/**
 * The Dock's own colour controller, reproduced: a 10px bracketed swatch bar
 * filling the widget column (its `[ ]` come from `.voice-slider-track`, the
 * same wrapper the sliders use, so the two read as one control family) plus
 * an EDITABLE hex field in the value column — see `.dn-floating-controls
 * .lil-gui .controller.color` in gallery-workbench.css. Replaces an 18px
 * square swatch that had no counterpart in the Dock and no way to type a
 * colour at all.
 */
function ColorRow({ label = "color", value, onChange, title }: {
  label?: string;
  value: string;
  onChange: (v: string) => void;
  title?: string;
}) {
  return (
    <label className="maps-layer-color-row" title={title ?? `${label} — click the bar to pick, or type a hex value`}>
      <span>{label}</span>
      <span className="voice-slider-track maps-layer-swatch">
        <input type="color" value={value} onChange={(e) => onChange(e.target.value)} />
      </span>
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

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="maps-layer-info-row" title={`${label} — provenance baked into the tile pyramid at build time, not a live control`}>
      <span>{label}</span>
      <span className="maps-layer-info-value">{value}</span>
    </div>
  );
}

/**
 * A boolean row — same `[ ]`/`[x]` idiom as `LayerCard`'s own visibility
 * checkbox (`.layer-group-check`, itself a reproduction of the Dock's
 * `.controller.boolean` checkbox), landed in the card body's shared 3-column
 * grid rather than hand-rolled: the name in column 1, the checkbox spanning
 * the widget/value columns (2/4) like a `<select>` row with no separate
 * readout of its own.
 */
function BoolRow({ label, value, onChange, title }: {
  label: string;
  value: boolean;
  onChange: (v: boolean) => void;
  title: string;
}) {
  return (
    <label className="maps-layer-bool-row" title={title}>
      <span>{label}</span>
      <span className="layer-group-check maps-layer-bool-check">
        <input type="checkbox" checked={value} onChange={(e) => onChange(e.target.checked)} />
      </span>
    </label>
  );
}

export interface BackgroundLayerInputs {
  color: string; onColor: (v: string) => void;
}

// No `renderMode`/`onRenderMode` here, unlike `ExtraLayerInputs` — a relief
// mesh has no reason to render as anything but `solid` (`MAP_SCENE_RENDER_
// MODE`), so the Terrain card carries no mode control at all rather than one
// that only ever offers a single meaningful choice (see `ModeRow`'s doc).
export interface TerrainLayerInputs {
  visible: boolean; onVisible: (v: boolean) => void;
  /** The COLOUR ramp (elevation band → colour). Distinct from `glyphPalette` — see `GlyphRow`'s doc. */
  palette: MapPaletteName; onPalette: (v: MapPaletteName) => void;
  /** The CHARACTER ramp (shade → glyph). Distinct from `palette` — see `GlyphRow`'s doc. */
  glyphPalette: MapLayerGlyphPalette; onGlyphPalette: (v: MapLayerGlyphPalette) => void;
  exaggeration: number; onExaggeration: (v: number) => void;
  /** ETOPO1 tile pyramid's own sampling provenance (e.g. `"nearest"`) — `null` before the provider loads. */
  sampler: string | null;
  /**
   * The terrain's own elevation WINDOW in metres, `null` at either end for
   * unbounded — `GlyphMapRasterLayer.minElevation`/`maxElevation`. Terrain
   * outside it is held AT the window edge, so a floor of 0 draws the land and
   * replaces the seabed with a smooth plane at sea level. Same two numbers,
   * same units and the same control as the Contour card's own window.
   */
  minElevation: number | null; onMinElevation: (v: number | null) => void;
  maxElevation: number | null; onMaxElevation: (v: number | null) => void;
  density: number; onDensity: (v: number) => void;
}

export interface BordersLayerInputs {
  visible: boolean; onVisible: (v: boolean) => void;
  color: string; onColor: (v: string) => void;
  /** Vector tile pyramid's own Visvalingam-Whyatt simplification provenance — `null` before the provider loads. */
  simplify: string | null;
  density: number; onDensity: (v: number) => void;
}

export interface ContourLayerInputs {
  visible: boolean; onVisible: (v: boolean) => void;
  color: string; onColor: (v: string) => void;
  /** Elevation-unit spacing between contour lines — see `GlyphMapContourLayer.levels`'s `{ interval }` variant. */
  interval: number; onInterval: (v: number) => void;
  /**
   * The elevation WINDOW in metres (`GlyphMapContourLayer.minElevation`/
   * `maxElevation`), `null` for an unbounded end. Contouring the whole
   * ETOPO1 range (~-10,900..+8,300 m) crowds the ocean: `floor 0` is land
   * only, `ceiling 0` sea only, `0..2000` the foothills.
   */
  minElevation: number | null; onMinElevation: (v: number | null) => void;
  maxElevation: number | null; onMaxElevation: (v: number | null) => void;
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
  labels: boolean; onLabels: (v: boolean) => void;
  density: number; onDensity: (v: number) => void;
}

/** Slider granularity for an elevation window (the Contour card's floor/ceiling and the Terrain card's), in metres — fine enough to place a coastline or a treeline exactly, coarse enough that the whole ETOPO1 envelope is a few hundred steps. */
export const ELEVATION_WINDOW_STEP = 50;
const ELEVATION_WINDOW_FALLBACK = { min: -11000, max: 9000 } as const;

/** Rounded-out slider bounds for an elevation window, widened to contain whatever the current values are so a handle is never off its own track (a user who set a floor of 0 and then zoomed into a wholly-submarine view keeps a reachable handle). Falls back to the ETOPO1 envelope before a field resolves. */
export function elevationWindowTrack(
  fieldRange: { readonly min: number; readonly max: number } | null,
  values: readonly (number | null)[],
): { readonly min: number; readonly max: number } {
  const step = ELEVATION_WINDOW_STEP;
  const lo = fieldRange ? Math.floor(fieldRange.min / step) * step : ELEVATION_WINDOW_FALLBACK.min;
  const hi = fieldRange ? Math.ceil(fieldRange.max / step) * step : ELEVATION_WINDOW_FALLBACK.max;
  const present = values.filter((v): v is number => v !== null);
  const min = Math.min(lo, ...present);
  const max = Math.max(hi, ...present);
  // A degenerate (flat) field would otherwise give a zero-width track, which
  // renders as an unusable slider rather than an empty one.
  return max > min ? { min, max } : { min, max: min + step };
}

/**
 * The `GlyphMapContourLayer` mount options MapsWorkbench.tsx's own contour
 * effect passes to `map.addLayer`, minus `type`/`id`/`source` (which come
 * from a constant and the shared terrain provider, not page state). Pulled
 * out as a pure function — rather than left inline in the effect body —
 * purely so the omit-when-off behaviour of `minElevation`/`maxElevation`/
 * `labels` has something directly testable: `MapsWorkbench.tsx` itself can't
 * be mounted in this standalone vitest config (`mapsAtlasWiring.repro.test.tsx`'s
 * doc has the reason — `CodePanel` pulls in `@glyphcss/core`, which
 * `website/package.json` never declares). Each end/flag is OMITTED, not
 * passed as a sentinel, when unset — so an untouched control mounts exactly
 * the layer this page mounted before that control existed.
 */
/**
 * The TERRAIN layer's elevation-window options, as `addLayer` takes them.
 * Extracted for the same reason `buildContourLayerMountOptions` is: each end
 * is OMITTED, never passed as a sentinel, when unset — so an untouched
 * control mounts exactly the layer this page mounted before the control
 * existed, which is the byte-identity `@glyphcss/maps` gates on its side.
 */
export function terrainWindowOptions(
  minElevation: number | null,
  maxElevation: number | null,
): { minElevation?: number; maxElevation?: number } {
  return {
    ...(minElevation === null ? {} : { minElevation }),
    ...(maxElevation === null ? {} : { maxElevation }),
  };
}

export function buildContourLayerMountOptions(opts: {
  interval: number;
  color: string;
  density: number;
  minElevation: number | null;
  maxElevation: number | null;
  labels: boolean;
}): {
  levels: { interval: number };
  color: string;
  density: number;
  minElevation?: number;
  maxElevation?: number;
  labels?: true;
} {
  return {
    levels: { interval: opts.interval },
    color: opts.color,
    density: opts.density,
    ...(opts.minElevation === null ? {} : { minElevation: opts.minElevation }),
    ...(opts.maxElevation === null ? {} : { maxElevation: opts.maxElevation }),
    ...(opts.labels ? { labels: true } : {}),
  };
}

/**
 * Parses a TYPED contour-window end. Three outcomes, and keeping them apart
 * is the whole point of the function:
 *
 * - `""` or `"off"` (the string the readout itself prints for an unbounded
 *   end) → `null`, unbounded.
 * - any finite number, `0` INCLUDED → that elevation in metres. `0` is sea
 *   level and the single most useful floor this page offers ("floor 0 spends
 *   every line on land"); it must never be read as "off", which is exactly
 *   what a falsy check would have done.
 * - anything else → `null` return, i.e. not a value: {@link MapsReadout}
 *   reverts to what was there.
 *
 * A typed value is CLAMPED to the ETOPO envelope
 * ({@link ELEVATION_WINDOW_FALLBACK}) rather than to the slider's current
 * track, and the track then WIDENS to contain it ({@link elevationWindowTrack}
 * already folds the live values into its own bounds, so a handle is never
 * stranded). Clamping to the track instead would make a legitimate elevation
 * unreachable purely because the current view doesn't happen to hold it. The
 * envelope's own job is to stay well inside `mapsUrlState.ts`'s
 * `MAPS_CONTOUR_WINDOW_OFF` (±32,000 m), the sentinel an unbounded end
 * persists as — a typed value colliding with it would round-trip through a
 * shared link as "off".
 */
export function parseElevationWindowEnd(raw: string): { readonly value: number | null } | null {
  const text = raw.trim();
  if (text === "" || text.toLowerCase() === "off") return { value: null };
  const n = Number.parseFloat(text);
  if (!Number.isFinite(n)) return null;
  return { value: Math.min(ELEVATION_WINDOW_FALLBACK.max, Math.max(ELEVATION_WINDOW_FALLBACK.min, n)) };
}

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
function ElevationWindowRow({ end, value, onChange, track, title }: {
  end: "floor" | "ceiling";
  value: number | null;
  onChange: (v: number | null) => void;
  track: { readonly min: number; readonly max: number };
  title: string;
}) {
  const off = end === "floor" ? track.min : track.max;
  const shown = value ?? off;
  return (
    <label className="voice-slider maps-layer-slider" title={title}>
      <span>{end}</span>
      <span className="voice-slider-track">
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
      </span>
      <MapsReadout
        value={value}
        format={(v) => (v === null ? "off" : `${v}m`)}
        parse={parseElevationWindowEnd}
        onCommit={onChange}
        title={`Type an elevation in metres — 0 is sea level. Empty, or "off", for no ${end}.`}
      />
    </label>
  );
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
/** One row of the OpenStreetMap card: a mapped OpenMapTiles layer, its toggle state and its own glyph density. */
export interface OsmSublayerInputs {
  readonly id: string;
  readonly label: string;
  /** The glyph layer type this row mounts as — it decides what the row's density COSTS, and whether the row gets a density control at all (`OSM_DENSITYLESS_TYPES`). */
  readonly type: "line" | "fill" | "fill-extrusion" | "symbol" | "circle";
  readonly on: boolean;
  /** This row's own density. Ignored for a `symbol`/`circle` row, which renders no density control. */
  readonly density: number;
  /**
   * Where this row's labels sit relative to their own point — MapLibre's
   * `text-anchor`. Read only by a `symbol` row (`OSM_LABEL_TYPES`); every
   * other row carries the field and renders no control for it, exactly as
   * `density` is carried and ignored by the two types that read none.
   */
  readonly anchor: GlyphMapLabelAnchor;
}

export interface OsmLayerInputs {
  visible: boolean; onVisible: (v: boolean) => void;
  /** Where the data comes from — service, schema and zoom ladder, read off the provider (`mapOsmSourceLabel`). */
  source: string;
  /** `null` when every tile arrived; otherwise how many did not (`mapOsmMissingTilesLabel`). */
  missing: string | null;
  /** One row per mapped OpenMapTiles layer (`GLYPH_MAP_OPENMAPTILES_LAYERS`). */
  sublayers: readonly OsmSublayerInputs[];
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
}

export interface LiveLayerInputs {
  visible: boolean; onVisible: (v: boolean) => void;
  /** One row per feed, in `MAP_LIVE_FEEDS` order. */
  feeds: readonly LiveFeedInputs[];
  onFeed: (id: string, on: boolean) => void;
}

export interface LayersFolderInputs {
  background: BackgroundLayerInputs;
  terrain: TerrainLayerInputs;
  borders: BordersLayerInputs;
  contour: ContourLayerInputs;
  fill: ExtraLayerInputs; symbol: ExtraLayerInputs; circle: ExtraLayerInputs;
  heatmap: ExtraLayerInputs; fillExtrusion: ExtraLayerInputs; model: ExtraLayerInputs;
  osm: OsmLayerInputs;
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
 * Formats a metres value adaptively — `m` below one kilometre, `km` above,
 * with a fractional km reading between 1 and 10 so a value near the low end
 * of the km range (e.g. a 1,500 m heatmap relief) doesn't collapse to a
 * misleading `"2 km"`. Shared by every metre-valued row on this page whose
 * range now crosses the metres/kilometres boundary.
 */
export function formatHeightMeters(m: number): string {
  if (m < 1_000) return `${Math.round(m)} m`;
  const km = m / 1_000;
  return `${km < 10 ? km.toFixed(1) : Math.round(km)} km`;
}

/**
 * The `fill-extrusion` height row's bounds — an ABSOLUTE structure height,
 * so its ceiling must stay reachable at a hemisphere-wide view (a
 * building-scale value is genuinely sub-pixel there — relief divides by the
 * Earth's radius) while its floor reaches real landmark/building scale.
 * Exported (rather than left as inline literals in `MapsWorkbench.tsx`) so
 * `mapsKit.logHeightSlider.test.ts` asserts against the SAME numbers the
 * control is actually wired to, not a copy that can silently drift.
 */
export const EXTRUSION_HEIGHT_BOUNDS_M = { min: 20, max: 2_000_000 } as const;

/**
 * The `heatmap` height row's bounds — a relief AMPLITUDE added ON TOP of
 * real terrain (`GLYPH_MAP_HEATMAP_RELIEF_HEIGHT_M` in `widget.ts`), so its
 * ceiling relates to terrain's OWN variation (Everest-to-trench is ~19 km)
 * rather than to planetary scale — deliberately far below
 * {@link EXTRUSION_HEIGHT_BOUNDS_M}'s ceiling, since these are different
 * physical quantities even though both rows share `logHeightSliderSpec`.
 */
export const HEATMAP_RELIEF_HEIGHT_BOUNDS_M = { min: 10, max: 20_000 } as const;

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
export function logHeightSliderSpec({ key, label, min, max, value, onChange, title }: {
  key: string; label: string; min: number; max: number; value: number;
  onChange: (v: number) => void; title: string;
}): LayerSliderSpec {
  const logSpan = Math.log(max / min);
  const toPos = (v: number) => Math.log(Math.min(max, Math.max(min, v)) / min) / logSpan;
  const toValue = (pos: number) => min * Math.exp(Math.min(1, Math.max(0, pos)) * logSpan);
  return {
    key, label, min: 0, max: 1, step: 0.001, title,
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
  visible: boolean; onVisible: (v: boolean) => void;
  color: string; onColor: (v: string) => void;
  /** Point-driven layers only (`symbol`/`circle`/`heatmap`) — `model` authors its own geometry and has no dataset to pick. */
  dataset?: LayerSelectSpec;
  /** `model` ONLY — which `resolveGeometry` solid stands at the anchor (`mapPin.ts`'s `MAP_MODEL_SHAPES`). The mirror image of `dataset`: the one layer with no data has the only shape choice. */
  shape?: LayerSelectSpec;
  sliders: readonly LayerSliderSpec[];
  /** `fill-extrusion`/`model` only — every other card is pinned to `MAP_SCENE_RENDER_MODE`. See `ModeRow`'s doc for why. */
  renderMode?: MapLayerRenderMode; onRenderMode?: (v: MapLayerRenderMode) => void;
  /** Every MESH-BACKED card — a WIDER set than `renderMode`'s. See `GlyphRow`'s doc. */
  glyphPalette?: MapLayerGlyphPalette; onGlyphPalette?: (v: MapLayerGlyphPalette) => void;
}

export function LayersPanel({ background, terrain, borders, contour, fill, symbol, circle, heatmap, fillExtrusion, model, osm, live }: LayersFolderInputs) {
  const extra = (label: string, value: ExtraLayerInputs) => <LayerCard label={label} visible={value.visible} onVisible={value.onVisible}>
    <ColorRow value={value.color} onChange={value.onColor} />
    {value.dataset && (
      <label className="maps-layer-select-row" title={value.dataset.title}>
        <span>data</span>
        <span className="gx-select">
          <select value={value.dataset.value} onChange={(e) => value.dataset!.onChange(e.target.value)}>
            {value.dataset.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </span>
      </label>
    )}
    {value.shape && (
      <label className="maps-layer-select-row" title={value.shape.title}>
        <span>shape</span>
        <span className="gx-select">
          <select value={value.shape.value} onChange={(e) => value.shape!.onChange(e.target.value)}>
            {value.shape.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </span>
      </label>
    )}
    {value.renderMode !== undefined && value.onRenderMode !== undefined && (
      <ModeRow label={label} value={value.renderMode} onChange={value.onRenderMode} />
    )}
    {value.glyphPalette !== undefined && value.onGlyphPalette !== undefined && (
      <GlyphRow label={label} value={value.glyphPalette} onChange={value.onGlyphPalette} />
    )}
    {value.sliders.map((s) => (
      <label key={s.key} className="voice-slider" title={s.title}>
        <span>{s.label}</span>
        <span className="voice-slider-track">
          <input type="range" min={s.min} max={s.max} step={s.step} value={s.value} style={densityFill(s.value, s.min, s.max)} onChange={(e) => s.onChange(+e.target.value)} />
        </span>
        <MapsReadout
          value={s.value}
          format={s.format}
          parse={s.parse ?? parseMapsNumber(s.min, s.max, s.integer)}
          onCommit={s.onChange}
        />
      </label>
    ))}
  </LayerCard>;
  return (
    <div className="maps-layers-list">
      {/*
        One Dock row, not a card header plus a separately-labelled swatch:
        the background has no toggleable state and no density, so "Background"
        IS this row's name. The old two-part shape printed "Background" and
        then "color" on the same line, a doubled label with no counterpart
        anywhere in the Dock.
      */}
      <div className="maps-layer-background-row">
        <ColorRow
          label="Background"
          value={background.color}
          onChange={background.onColor}
          title="Background — the page colour behind every layer. Click the bar to pick, or type a hex value."
        />
      </div>
      <LayerCard label="Terrain" visible={terrain.visible} onVisible={terrain.onVisible}>
        {/*
          Labelled `colors`, not `palette`: this card now carries TWO ramps
          and "palette" names neither of them unambiguously. This one is the
          elevation-band COLOUR ramp (`GlyphMapRasterLayer.colors`); `glyphs`
          just below is the CHARACTER ramp (`GlyphMapRasterLayer.glyphPalette`
          — see `GlyphRow`'s doc). Each title names the other so a reader who
          lands on one knows the other exists.
        */}
        <label className="maps-layer-select-row" title="Terrain color palette — which COLOUR each elevation band is painted in (not which characters carry the shade; that is the &quot;glyphs&quot; row).">
          <span>colors</span>
          <span className="gx-select">
            <select value={terrain.palette} onChange={(e) => terrain.onPalette(e.target.value as MapPaletteName)}>
              {Object.entries(PALETTE_OPTIONS).map(([display, value]) => <option key={value} value={value}>{display}</option>)}
            </select>
          </span>
        </label>
        <GlyphRow label="Terrain" value={terrain.glyphPalette} onChange={terrain.onGlyphPalette} />
        <label className="voice-slider" title="Exaggeration — vertical relief multiplier. Construction-time only: changing this rebuilds the widget.">
          <span>exag ×</span>
          <span className="voice-slider-track">
            <input type="range" min={1} max={60} step={1} value={terrain.exaggeration} style={densityFill(terrain.exaggeration, 1, 60)} onChange={(e) => terrain.onExaggeration(+e.target.value)} />
          </span>
          <MapsReadout
            value={terrain.exaggeration}
            format={(v) => String(v)}
            parse={parseMapsNumber(1, 60, true)}
            onCommit={terrain.onExaggeration}
            title="Type a multiplier between 1 and 60."
          />
        </label>
        <ElevationWindowRow
          end="floor"
          value={terrain.minElevation}
          onChange={terrain.onMinElevation}
          track={elevationWindowTrack(null, [terrain.minElevation, terrain.maxElevation])}
          title="Floor — lowest elevation the terrain SHAPE is drawn at. Terrain below it is held at the floor rather than dropped, so a floor of 0m draws the land and replaces the seabed with a smooth plane at sea level. Colours are untouched: the sea keeps its own band, it just loses its relief. Drag to the far left for no floor."
        />
        <ElevationWindowRow
          end="ceiling"
          value={terrain.maxElevation}
          onChange={terrain.onMaxElevation}
          track={elevationWindowTrack(null, [terrain.minElevation, terrain.maxElevation])}
          title="Ceiling — highest elevation the terrain SHAPE is drawn at. A ceiling of 0m flattens the land and leaves the bathymetry; floor 0 with ceiling 2000 flattens everything outside the foothills. Drag to the far right for no ceiling."
        />
        {terrain.sampler !== null && <InfoRow label="sampler" value={terrain.sampler} />}
        <DensityRow label="Terrain" density={terrain.density} onDensity={terrain.onDensity} enabled={true} />
      </LayerCard>
      <LayerCard label="Borders" visible={borders.visible} onVisible={borders.onVisible}>
        <ColorRow value={borders.color} onChange={borders.onColor} />
        {borders.simplify !== null && <InfoRow label="simplify" value={borders.simplify} />}
        <DensityRow label="Borders" density={borders.density} onDensity={borders.onDensity} enabled={true} />
      </LayerCard>
      <LayerCard label="Contour" visible={contour.visible} onVisible={contour.onVisible}>
        <ColorRow value={contour.color} onChange={contour.onColor} />
        <label className="voice-slider" title="Interval — fixed elevation spacing between contour lines (e.g. every 500m). Stays stable while panning, unlike a fixed LINE COUNT which would re-space every line whenever the visible elevation range changes.">
          <span>interval</span>
          <span className="voice-slider-track">
            <input type="range" min={100} max={2000} step={100} value={contour.interval} style={densityFill(contour.interval, 100, 2000)} onChange={(e) => contour.onInterval(+e.target.value)} />
          </span>
          <MapsReadout
            value={contour.interval}
            format={(v) => `${v}m`}
            parse={parseMapsNumber(100, 2000, true)}
            onCommit={contour.onInterval}
            title="Type a spacing in metres between 100 and 2000. Not snapped to the slider's 100 m detents."
          />
        </label>
        <ElevationWindowRow
          end="floor"
          value={contour.minElevation}
          onChange={contour.onMinElevation}
          track={elevationWindowTrack(contour.fieldRange, [contour.minElevation, contour.maxElevation])}
          title="Floor — lowest elevation contoured. Levels are both CHOSEN inside the window and CLIPPED to it, so a floor of 0m spends every line on land instead of the abyssal plains. Drag to the far left for no floor."
        />
        <ElevationWindowRow
          end="ceiling"
          value={contour.maxElevation}
          onChange={contour.onMaxElevation}
          track={elevationWindowTrack(contour.fieldRange, [contour.minElevation, contour.maxElevation])}
          title="Ceiling — highest elevation contoured. A ceiling of 0m gives bathymetry alone; floor 0 with ceiling 2000 gives the foothills. Drag to the far right for no ceiling."
        />
        <InfoRow label="lines" value={contour.lineCount === null ? "—" : String(contour.lineCount)} />
        <BoolRow
          label="labels"
          value={contour.labels}
          onChange={contour.onLabels}
          title="Labels — print the elevation on every 5th contour, in a gap in the line."
        />
        <DensityRow label="Contour" density={contour.density} onDensity={contour.onDensity} enabled={true} />
      </LayerCard>
      {extra("Fill", fill)}
      {extra("Symbol", symbol)}
      {extra("Circle", circle)}
      {extra("Heatmap", heatmap)}
      {extra("Fill extrusion", fillExtrusion)}
      {extra("Model", model)}
      <LayerCard label="OpenStreetMap" visible={osm.visible} onVisible={osm.onVisible}>
        <InfoRow label="source" value={osm.source} />
        {/*
          Only while it is true. A tile that 404s or times out leaves that
          region without data for the frame and the rest of the view intact,
          so this says how many are missing rather than letting a thinner
          render read as a broken layer.
        */}
        {osm.missing === null ? null : (
          <div
            className="maps-layer-info-row"
            title="Tiles the service did not return this frame. That region simply has no data right now; everything else still drew."
          >
            <span>tiles</span>
            <span className="maps-layer-info-value maps-layer-info-warn">{osm.missing}</span>
          </div>
        )}
        {/*
          The one cost a reader of this card can spend by accident, stated
          LIVE and where the choice is being made rather than only in a
          tooltip. Derived here from the rows the panel already has — no page
          state, and it moves in the same render as the slider that caused it.
        */}
        {(() => {
          const grids = mapOsmStrokeOverlayCount(osm.sublayers);
          if (grids === 0) return null;
          return (
            <div
              className="maps-layer-info-row"
              title="Stroke rows (Waterways, Roads, Boundaries) are stamped into full-viewport overlay grids, one per DISTINCT density, each with its own depth pass. Measured at 140x63 over a relief mesh: 6.6 ms/render with none, 27.4 ms with one grid at 2x, 63.4 ms with three at 2/2.1/2.2 — so it is the grid COUNT that is charged for, not the sharpness. Give the strokes one shared number to pay for one."
            >
              <span>stroke grids</span>
              <span className={`maps-layer-info-value${grids > 1 ? " maps-layer-info-warn" : ""}`}>
                {grids === 1 ? "1 extra pass" : `${grids} extra passes`}
              </span>
            </div>
          );
        })()}
        {osm.sublayers.map((s) => (
          <OsmSublayerRow
            key={s.id}
            row={s}
            onToggle={(v) => osm.onSublayer(s.id, v)}
            onDensity={(v) => osm.onSublayerDensity(s.id, v)}
            onAnchor={(v) => osm.onSublayerAnchor(s.id, v)}
          />
        ))}
      </LayerCard>
      {/*
        LIVE. Every row is a public, keyless, openly-licensed feed read
        straight from the reader's own browser, and every row is OFF by
        default — a live layer costs somebody else's bandwidth and a reader's
        own rate-limit budget, so it is opted into rather than out of. Each
        row's tooltip says what it is AND when it has something to show,
        following the OSM card's own idiom, because "I turned it on and
        nothing appeared" is the reading a sparse layer invites.
      */}
      <LayerCard label="Live" visible={live.visible} onVisible={live.onVisible}>
        <div
          className="maps-layer-info-row"
          title="Four public feeds, fetched by your own browser with no API key and no server in between: USGS earthquakes, GDACS disaster alerts, Launch Library 2 and CelesTrak orbital elements. Each refreshes on its own cadence and credits itself in the map's attribution line while it is on."
        >
          <span>source</span>
          <span className="maps-layer-info-value">public feeds, no key</span>
        </div>
        {live.feeds.map((row) => (
          <LiveFeedRow key={row.id} row={row} onToggle={(on) => live.onFeed(row.id, on)} />
        ))}
      </LayerCard>
    </div>
  );
}

// ── Lighting (mirrors SynthWorkbench's `Lighting`/`buildLighting`, adapted
//    to DockLighting's exact field names so the folder is reusable as-is). ──

export interface MapLighting {
  lightAzimuth: number;
  lightElevation: number;
  lightIntensity: number;
  lightColor: string;
  ambientIntensity: number;
  ambientColor: string;
}

export const DEFAULT_MAP_LIGHTING: MapLighting = {
  lightAzimuth: 50,
  lightElevation: 50,
  lightIntensity: 1.15,
  lightColor: "#ffffff",
  ambientIntensity: 0.45,
  ambientColor: "#ffffff",
};

/**
 * `ownedDirection` (from `map.getKeyLightDirection()`) REPLACES the azimuth/
 * elevation direction whenever the WIDGET owns the key light's direction —
 * the real sun on an orbit projection, or a `keyLight: "headlight"` (the
 * page's "Full" sun mode on a globe). It is deliberately the same value the
 * widget itself writes, read fresh at the moment of the write, so the page
 * and the widget can never disagree: whichever writes last writes the same
 * answer. `null` (nobody owns it — a sheet projection outside a headlight, a
 * `setProjection` blend mid-flight) falls back to the sliders, unchanged.
 *
 * Reading `getSunDirection()` here instead would be a real bug now, not a
 * naming quibble: it answers `null` while a headlight is on, so the page
 * would clobber the headlight with its own slider vector on every lighting
 * or projection change.
 */
export function buildMapLighting(l: MapLighting, ownedDirection?: readonly [number, number, number] | null): {
  directionalLight: { direction: [number, number, number]; intensity: number; color: string };
  ambientLight: { intensity: number; color: string };
} {
  const a = (l.lightAzimuth * Math.PI) / 180;
  const e = (l.lightElevation * Math.PI) / 180;
  const direction: [number, number, number] = ownedDirection
    ? [ownedDirection[0], ownedDirection[1], ownedDirection[2]]
    : [Math.cos(e) * Math.cos(a), Math.cos(e) * Math.sin(a), Math.sin(e)];
  return {
    directionalLight: {
      direction,
      intensity: l.lightIntensity,
      color: l.lightColor,
    },
    ambientLight: { intensity: l.ambientIntensity, color: l.ambientColor },
  };
}

// ── Sun mode — three buttons in the Dock's own Lighting folder ────────────
//
// The mode enum is `@glyphcss/maps`' own `GlyphMapSunMode`, not a second
// page-local copy: "Full" is the widget's `"off"`, "Real time" is
// `"realtime"`, "Manual" is `"manual"`.
//
// "FULL" IS NOT "NO SUN". The label promises everything lit — a globo
// terráqueo — and turning the sun off does not deliver that on its own: the
// azimuth/elevation key light is still a FIXED direction, so a globe still
// has a lit half and a dark half, just one that no longer tracks the clock.
// What Full actually means is `keyLight: "headlight"` (see
// `mapKeyLightForSunMode`): the key light points along the camera's own view
// axis, so the whole visible face is lit with no terminator anywhere, while
// Lambert still varies per face so terrain relief stays legible. Pure ambient
// would also remove the terminator, and was rejected because it gives every
// face the same shade and erases the relief the terrain layer exists to show
// (rendered and pinned in `@glyphcss/maps`' `widget.headlight.test.ts`).
//
// A REAL-TIME sun keeps moving on the widget's own wall-clock timer
// (`GLYPH_MAP_SUN_TICK_MS`, 30 s — the subsolar point moves 0.25 deg of
// longitude per minute, so a tick is 0.125 deg, about a twelfth of a cell at
// a world view, and costs two re-renders a minute on an idle map). A MANUAL
// sun is pinned to the day/hour the two rows below set.

export const SUN_MODE_LABELS: Record<MapSunMode, string> = {
  off: "Full",
  realtime: "Real time",
  manual: "Manual",
};

const SUN_MODE_DESCRIPTIONS: Record<MapSunMode, string> = {
  off: "everything lit: on a globe the key light follows the camera, so the whole visible face is lit with no terminator (relief still shades)",
  realtime: "the sun where it actually is right now; the terminator keeps advancing (15 deg of longitude per hour)",
  manual: "the sun at a day and UTC hour you pick, frozen there",
};

const SUN_MODE_ICONS: Record<MapSunMode, ReactNode> = {
  // Full disc + rays: everything lit.
  off: (
    <ToggleIcon strokeWidth={1.3}>
      <circle cx="8" cy="8" r="3.2" />
      <path d="M8 1.2V3M8 13V14.8M1.2 8H3M13 8H14.8M3.2 3.2L4.5 4.5M11.5 11.5L12.8 12.8M12.8 3.2L11.5 4.5M4.5 11.5L3.2 12.8" />
    </ToggleIcon>
  ),
  // Clock face: the sun tracks the wall clock.
  realtime: (
    <ToggleIcon strokeWidth={1.3}>
      <circle cx="8" cy="8" r="6.3" />
      <path d="M8 4.2V8L10.8 9.8" />
    </ToggleIcon>
  ),
  // Half-lit disc: a terminator you place yourself.
  manual: (
    <ToggleIcon strokeWidth={1.3}>
      <circle cx="8" cy="8" r="6.3" />
      <path d="M8 1.7A6.3 6.3 0 0 1 8 14.3Z" fill="currentColor" />
    </ToggleIcon>
  ),
};

export const SUN_MODE_TOGGLE = (["off", "realtime", "manual"] as const).map((value) => ({
  value,
  icon: SUN_MODE_ICONS[value],
  label: SUN_MODE_LABELS[value],
  desc: SUN_MODE_DESCRIPTIONS[value],
}));

/**
 * A manual sun's `(day-of-year, UTC hour)` as an instant. The YEAR is the
 * current UTC one rather than a persisted field: solar declination for a
 * given day-of-year moves by hundredths of a degree between years — far below
 * a glyph cell — so pinning it would buy nothing and cost a URL token.
 */
/**
 * Which `keyLight` mode the widget should be in, given the sun mode and the
 * live projection.
 *
 * ORBIT ONLY, and that is the point rather than a shortcut. The defect Full
 * fixes is a dark HEMISPHERE, which only a sphere has: a sheet projection's
 * faces all point roughly `+Z`, so a fixed key light there produces
 * hillshading, never a terminator — everything on it is already lit. Aiming
 * that light down the view axis anyway would buy nothing and would silently
 * take away the one control (Azimuth/Elev) that does real work on a flat
 * map. Same shape as every other projection-dependent choice on this page
 * and in the widget: a CAPABILITY question, answered once.
 *
 * With the sun ON, the sun owns the direction on an orbit projection and the
 * sheet's terminator is a per-cell term — either way a headlight would be
 * fighting it, so it stays off.
 *
 * SHADOWS OUTRANK THE HEADLIGHT, and not as a preference. Shadows fall along
 * the key light, and a headlight IS the camera's view axis; an orthographic
 * camera's screen position is the component of a world point PERPENDICULAR to
 * that axis, so displacing a caster along it moves the shadow zero columns and
 * zero rows. Every shadow lands in its own caster's cells, hidden behind the
 * thing that threw it — measured at 27 surviving fringe cells against 535 for
 * the same scene under a fixed light (`widget.shadow.test.ts` pins the
 * order of magnitude). That is why the /maps page could turn shadows on at its
 * defaults — globe projection, Sun "Full" — and see nothing anywhere, and no
 * depth bias or receiver set can recover it. Asking for shadows therefore
 * gives the direction back to the Azimuth/Elev sliders, which the Dock then
 * un-dims: an evenly lit globe and cast shadows are mutually exclusive, and
 * the reader gets whichever they asked for last.
 */
export function mapKeyLightForSunMode(mode: MapSunMode, projection: MapProjectionId, shadows = false): GlyphMapKeyLightMode {
  if (shadows) return "fixed";
  return mode === "off" && isOrbitProjectionId(projection) ? "headlight" : "fixed";
}

/**
 * Whether the Dock's Azimuth/Elev rows are dimmed — true in EXACTLY the cases
 * where something other than those two sliders is aiming the key light.
 *
 * Derived from {@link mapKeyLightForSunMode} and the sun's own rule rather
 * than restated as a second condition, because a live-looking slider that
 * changes nothing (and a dimmed one that was the only thing left aiming the
 * light) are the two failure modes this row has. `mapsKit.sun.test.ts` pins
 * the equivalence across every mode/projection/shadow combination.
 */
export function mapDirectionLocked(projection: MapProjectionId, mode: MapSunMode, shadows = false): boolean {
  const headlightOwns = mapKeyLightForSunMode(mode, projection, shadows) === "headlight";
  // The sun writes a real `directionalLight.direction` only on an orbit
  // projection; on a sheet its terminator is a per-cell colour term that
  // leaves the key light alone.
  const sunOwns = mode !== "off" && isOrbitProjectionId(projection);
  return headlightOwns || sunOwns;
}

export function mapSunManualInstant(dayOfYear: number, utcHour: number, year = new Date().getUTCFullYear()): number {
  return Date.UTC(year, 0, 1) + (dayOfYear - 1) * 86_400_000 + utcHour * 3_600_000;
}

/** The inverse — used to SEED the manual rows from the real clock when the user switches into manual, so the sun does not jump. */
export function mapSunManualFields(at: number): { day: number; hour: number } {
  const d = new Date(at);
  const startOfYear = Date.UTC(d.getUTCFullYear(), 0, 1);
  const day = Math.floor((at - startOfYear) / 86_400_000) + 1;
  const hour = d.getUTCHours() + d.getUTCMinutes() / 60;
  return { day, hour };
}

/**
 * The sun controls, rendered INSIDE the shared Dock Lighting folder through
 * `DockLighting`'s `extras` seam — not a fourth lighting section of our own.
 *
 * The three-way mode toggle is portaled into a TOP dock slot (it gates the
 * Azimuth/Elev rows below it, so it has to read as the parent choice — the
 * same placement, and the same `.dock-subcell` row CSS, /synth's own Subcell
 * toggle uses). The two manual-time rows are ordinary `useSlider` lil-gui
 * controllers, created unconditionally and merely hidden outside manual mode
 * (a controller appended only once its mode is picked would land after the
 * ambient rows instead of next to the toggle that governs it — the same
 * create-always/show-in-place idiom /synth uses for Ink levels vs Ink
 * spacing).
 */
export function MapsSunControls({ folder, mode, day, hour, onMode, onDay, onHour }: {
  folder: GUI | null;
  mode: MapSunMode;
  day: number;
  hour: number;
  onMode: (mode: MapSunMode) => void;
  onDay: (day: number) => void;
  onHour: (hour: number) => void;
}) {
  const slot = useDockSlot(folder, { position: "top", className: "dock-subcell-slot" });
  const dayCtrl = useSlider(folder, "Sun day", { min: 1, max: 366, step: 1 }, day, onDay);
  const hourCtrl = useSlider(folder, "Sun hour", { min: 0, max: 24, step: 0.25 }, hour, onHour);

  useEffect(() => {
    dayCtrl?.setVisible(mode === "manual");
    hourCtrl?.setVisible(mode === "manual");
  }, [dayCtrl, hourCtrl, mode]);

  if (!slot) return null;
  return createPortal(
    <div className="dock-subcell">
      <span className="dock-subcell-label">Sun</span>
      <IconToggle
        groupTitle="Sun — where the key light comes from. Full: no terminator, the sliders below are the whole light. Real time: the sun's true current position, advancing on its own. Manual: a day and UTC hour you pick."
        options={SUN_MODE_TOGGLE}
        value={mode}
        onChange={(v) => onMode(v as MapSunMode)}
      />
    </div>,
    slot,
  );
}

const SHADOW_TOGGLE = ([
  { value: "off", label: "Off", desc: "no shadow pass at all — the render is byte-identical to a map built without this control" },
  { value: "on", label: "Cast", desc: "buildings and models drop a shadow onto the terrain and fill under them, along the same light the shading uses" },
] as const).map(({ value, label, desc }) => ({
  value,
  label,
  desc,
  icon: value === "off" ? (
    // An empty block: something standing there, throwing nothing.
    <ToggleIcon strokeWidth={1.3}>
      <path d="M4.5 4.5H9.5V9.5H4.5Z" />
    </ToggleIcon>
  ) : (
    // The same block with its shadow laid out to one side.
    <ToggleIcon strokeWidth={1.3}>
      <path d="M4.5 4.5H9.5V9.5H4.5Z" />
      <path d="M9.5 9.5H14V12H4.5V9.5Z" fill="currentColor" stroke="none" opacity="0.55" />
    </ToggleIcon>
  ),
}));

/**
 * Why the Shadows toggle would draw NOTHING right now, or `null` when it
 * would draw something. The reader's own layer state is the whole input.
 *
 * A shadow needs a layer that stands UP off the ground
 * (`GLYPH_MAP_SHADOW_CASTERS` — `fill-extrusion` and `model`), and the page's
 * DEFAULT layer set has none: terrain never casts by design (the relief
 * system keeps a global floor tier mounted, so 256 shadow-map texels would
 * span the Earth) and borders are stamped strokes that own no mesh. So a
 * reader on the default map who turns Shadows on gets an extra pass and no
 * pixel of difference — the exact dead control the Azimuth/Elev rows already
 * dim themselves for (`mapDirectionLocked`), stated the same way: not by
 * disabling the toggle, which would hide the feature from someone about to
 * mount a caster, but by saying what is missing.
 *
 * A per-layer DENSITY is deliberately NOT part of this. It used to switch the
 * feature off silently (glyphcss's shadow map was built per output grid, so a
 * layer separated by its own density stopped casting AND receiving); the
 * shadow map is now built from every caster in the scene and shared across
 * the frame's passes, so a density is orthogonal again and there is nothing
 * to warn about.
 *
 * Pure, so it is testable without mounting the Dock.
 */
export function mapShadowCasterReason(
  extraVisible: Readonly<Record<string, boolean>>,
  osmOn: boolean,
  osmSublayers: Readonly<Record<string, boolean>>,
): string | null {
  if (extraVisible["fill-extrusion"] === true) return null;
  if (extraVisible.model === true) return null;
  if (osmOn && osmSublayers["omt-buildings"] === true) return null;
  return "Nothing mounted casts: turn on OpenStreetMap → Buildings, or the Extrusion or Model layer. Terrain never casts, and borders own no mesh.";
}

/**
 * The cast-shadow toggle, in the SAME Dock Lighting folder and through the
 * same `extras` seam as {@link MapsSunControls} — because it is the same
 * subject. A shadow is thrown by the key light, so a reader who has just set
 * the sun is exactly the reader who wants to know whether it casts, and
 * putting this anywhere else (a Rendering row, a layer card) would separate a
 * light from what it does.
 *
 * It renders BELOW the Sun row, which is why it is rendered ABOVE it in the
 * JSX: `useDockSlot(folder, { position: "top" })` inserts each slot before the
 * folder's current first child, so the LAST one mounted ends up first.
 */
export function MapsShadowControls({ folder, shadows, onShadows, casterReason }: {
  folder: GUI | null;
  shadows: boolean;
  onShadows: (on: boolean) => void;
  /** {@link mapShadowCasterReason} — shown under the row while shadows are ON and nothing can cast. */
  casterReason?: string | null;
}) {
  const slot = useDockSlot(folder, { position: "top", className: "dock-subcell-slot" });
  if (!slot) return null;
  // Only while the toggle is ON: with shadows off there is nothing inert to
  // explain, and a permanent caveat under an off switch is noise.
  const note = shadows ? casterReason ?? null : null;
  return createPortal(
    <>
      <div className="dock-subcell">
        <span className="dock-subcell-label">Shadows</span>
        <IconToggle
          groupTitle="Shadows — whether standing geometry (OSM buildings, the model layer) casts onto the ground under it. Off by default: it is a second pass, and it needs a layer that stands up off the ground to draw anything at all."
          options={SHADOW_TOGGLE}
          value={shadows ? "on" : "off"}
          onChange={(v) => onShadows(v === "on")}
        />
      </div>
      {note === null ? null : <p className="maps-shadow-note">{note}</p>}
    </>,
    slot,
  );
}

// ── "Projection" picker — segmented icon toggle portaled into a slot at the
//    TOP of the Dock, above every folder (View/Rendering/Lighting): a
//    projection is the map's fundamental shape, not a scene/camera tuning
//    knob, so it reads as the first thing in the Dock rather than buried in
//    a folder. Laid out INLINE — label on the left, buttons on the right —
//    exactly like `MapsSunControls`' own Sun toggle below, reusing the same
//    `useDockSlot(folder, { position: "top" })` + `.dock-subcell` portal
//    mechanism rather than a second way to inject markup into lil-gui.
//    Reuses `IconToggle`/`ToggleIcon` from `SynthWorkbench/synthKit.tsx`
//    verbatim — the same segmented-icon control /synth's field/wave rows and
//    LoadersDock's Subcell row already use (`LoadersDock.tsx`'s own
//    import-and-use is the established cross-page pattern this follows).
//    `Exaggeration` stays in the rail's Terrain card (mapsKit.tsx's
//    `LayersPanel` doc) — it's a per-raster-layer property (the projection's
//    own vertical-relief argument), not a scene-level concern either.

const PROJECTION_ICONS: Record<MapProjectionId, ReactNode> = {
  // Wide rectangle, one evenly-spaced equator + one meridian — the plain
  // lon/lat grid with no distortion.
  equirectangular: (
    <ToggleIcon>
      <rect x="1.5" y="4" width="13" height="8" />
      <path d="M1.5 8H14.5M8 4V12" />
    </ToggleIcon>
  ),
  // Taller rectangle; graticule lines WIDEN toward top/bottom — the
  // stretch signature that reads unmistakably as Mercator at 15px.
  mercator: (
    <ToggleIcon>
      <rect x="4" y="1.5" width="8" height="13" />
      <path d="M4 8H12M4 5.8H12M4 3.2H12M4 10.2H12M4 12.8H12M8 1.5V14.5" />
    </ToggleIcon>
  ),
  // Circle + a horizontal equator ellipse + a vertical meridian ellipse —
  // the textbook "globe" glyph, curved throughout.
  globe: (
    <ToggleIcon strokeWidth={1.3}>
      <circle cx="8" cy="8" r="6.3" />
      <ellipse cx="8" cy="8" rx="6.3" ry="1.8" />
      <ellipse cx="8" cy="8" rx="2.2" ry="6.3" />
    </ToggleIcon>
  ),
};

const PROJECTION_DESCRIPTIONS: Record<MapProjectionId, string> = {
  equirectangular: "the plain lat/lon grid, stretched by no math at all — pick it when you want raw coordinates to read off directly, at the cost of shapes and area both distorting away from the equator",
  mercator: "keeps angles and local shapes true (a coastline still looks right up close) but inflates area toward the poles — pick it for bearing-style navigation, not for comparing how big two regions really are",
  globe: "the true sphere, with correct shape and area everywhere on it — pick it to see the planet as it actually is, navigated by orbiting the camera instead of panning a flat sheet",
};

/** Built from `PROJECTION_OPTIONS` so the toggle and the option set can't drift. */
export const PROJECTION_TOGGLE = Object.entries(PROJECTION_OPTIONS).map(([label, value]) => ({
  value,
  icon: PROJECTION_ICONS[value],
  label,
  desc: PROJECTION_DESCRIPTIONS[value],
}));

/**
 * Mirrors `MapsSunControls` exactly: a `folder` (here the Dock's ROOT `GUI`,
 * not a subfolder — `useDockSlot` reads `parent.$children` regardless of
 * whether `parent` is the root or a folder, so "top of the whole Dock" is
 * just "top slot on the root") gets a `dock-subcell-slot` inserted before
 * its first child, and the toggle portals into it.
 */
export function MapsProjectionControls({ folder, projectionId, onProjectionId }: {
  folder: GUI | null;
  projectionId: MapProjectionId;
  onProjectionId: (id: MapProjectionId) => void;
}) {
  const slot = useDockSlot(folder, { position: "top", className: "dock-subcell-slot" });
  if (!slot) return null;
  return createPortal(
    <div className="dock-subcell">
      <span className="dock-subcell-label">Projection</span>
      <IconToggle
        groupTitle="Projection — the map's shape. Construction-time: switching rebuilds the widget."
        options={PROJECTION_TOGGLE}
        value={projectionId}
        onChange={(v) => onProjectionId(v as MapProjectionId)}
      />
    </div>,
    slot,
  );
}

// ── "View" folder — center/span/tilt (replaces DockCamera; see file doc).
//    No "Jump to" quick-travel control — Places navigation was removed
//    entirely (user ask: "remove the places from the left sidebar" plus
//    "we should remove the jump to from the right sidebar"), not relocated
//    a second time. ───────────────────────────────────────────────────────

export interface ViewFolderInputs {
  centerLon: number;
  centerLat: number;
  span: number;
  maxSpan: number;
  tilt: number;
  maxTilt: number;
  bearing: number;
  isOrbitProjection: boolean;
  lod: number;
  degPerCell: number;
  onCenter: (lon: number, lat: number) => void;
  onSpan: (span: number) => void;
  onTilt: (tilt: number) => void;
  onBearing: (bearing: number) => void;
}

/*
 * Street-level WALK is deliberately NOT a row in this folder.
 *
 * It shipped as one — a `Walk` toggle under Bearing plus a `Horizon`
 * readout — and was rejected as one ("it feels stupid as a checkbox"). It is
 * a MODE, not a setting: the reader stops looking at the map and stands in
 * it, and the entrance to that belongs ON the map, the way Google Maps'
 * pegman does. It now lives in `MapWalkButton.tsx`, an overlay beside
 * `MapCompass` and `MapSearchBox`, and it carries the same gate reason and
 * the same tile-budget readout there. Tilt and Bearing stay here and keep
 * meaning something while walking (the walker's pitch and heading), which is
 * what the old placement argument was really about.
 */

export function useViewFolder(parent: GUI | null, inputs: ViewFolderInputs): void {
  const { centerLon, centerLat, span, maxSpan, tilt, maxTilt, bearing, isOrbitProjection, lod, degPerCell, onCenter, onSpan, onTilt, onBearing } = inputs;
  const folder = useFolder(parent, "View", { open: true });
  useSlider(folder, "Center lon", { min: -180, max: 180, step: 0.1 }, centerLon, (v) => onCenter(v, centerLat));
  useSlider(folder, "Center lat", { min: -90, max: 90, step: 0.1 }, centerLat, (v) => onCenter(centerLon, v));
  // The lil-gui controller is created ONCE per (folder, label) — its RANGE is
  // read at creation, so a live ceiling has to be pushed onto the raw
  // controller afterwards or the slider keeps offering a span the map will
  // clamp away. `maxSpan` is genuinely live: it follows the projection, the
  // tilt and the host's shape.
  const spanCtrl = useSlider(folder, "Span °", { min: 0.5, max: maxSpan, step: 0.5 }, span, onSpan);
  useEffect(() => {
    spanCtrl?.raw.max(maxSpan);
  }, [spanCtrl, maxSpan]);
  // `tilt` is unified across both navigation modes (widget.ts's
  // `GlyphMapHandle.setTilt` doc) as "additional pitch on top of the
  // projection's own base orientation" — see `mapTiltSliderRange` for why
  // the two families keep different SHAPES and why the ceiling is the
  // widget's own live `getMaxTilt()` rather than the literal it replaced.
  // Pushed onto the raw controller for the same reason `maxSpan` is: the
  // range is read once at creation, and this one moves with every wheel
  // notch (~21 degrees at a whole-world span, 85 by city scale).
  const tiltRange = mapTiltSliderRange(isOrbitProjection, maxTilt);
  const tiltCtrl = useSlider(folder, "Tilt °", tiltRange, tilt, onTilt);
  useEffect(() => {
    tiltCtrl?.raw.min(tiltRange.min);
    tiltCtrl?.raw.max(tiltRange.max);
  }, [tiltCtrl, tiltRange.min, tiltRange.max]);
  // Home is NOT zero for both families: an orbit `tilt` is a signed offset on
  // top of `cameraForCenter` so 0 is the head-on globe, while a sheet's IS
  // `camera.rotX` so 0 is a plan view looking straight down — a different map
  // from the one the page opens at. See `mapTiltResetValue`.
  const tiltHome = mapTiltResetValue(isOrbitProjection);
  useRowReset(tiltCtrl, {
    atHome: mapTiltIsLevel(tilt, isOrbitProjection),
    label: `Reset the pitch to ${tiltHome}°`,
    title: `Put the pitch back to ${tiltHome}° — ${isOrbitProjection
      ? "the globe seen head-on, this projection's own base orientation"
      : "the isometric pitch this page opens at; 0° would be a plan view looking straight down"}.`,
    onReset: () => onTilt(tiltHome),
  });
  // Bearing sits immediately under Tilt because they are the two halves of
  // ONE gesture (`controls.tilt`: vertical pitches, horizontal turns), and a
  // reader who finds one should find the other. Unlike Tilt its range is
  // FIXED — a heading has no ceiling — so there is no `raw.min`/`raw.max`
  // push here; see `MAP_BEARING_SLIDER_RANGE` for why it is 0..360 and what
  // the handle does at the north seam. The VALUE still syncs every frame
  // like Tilt's does, or the horizontal half of the gesture would leave this
  // showing a heading the camera no longer has.
  const bearingCtrl = useSlider(folder, "Bearing °", MAP_BEARING_SLIDER_RANGE, bearing, onBearing);
  useEffect(() => {
    // The compass direction at the TOP of the picture, spelled out on the row
    // itself: a heading a reader cannot orient is just a number, and the
    // label alone cannot say which way 0 faces.
    (bearingCtrl?.raw.domElement as HTMLElement | undefined)?.setAttribute(
      "title",
      "Compass heading at the top of the map. 0° = north up, 90° = east up. Ctrl+drag or right-drag sideways to turn.",
    );
  }, [bearingCtrl]);
  useRowReset(bearingCtrl, {
    atHome: mapBearingIsNorth(bearing),
    label: "Reset the heading to north",
    title: "Face the map north-up again. A compass has one home on either projection.",
    onReset: () => onBearing(MAP_BEARING_HOME),
  });
  useReadonlyText(folder, "LOD", `z${lod} · ${degPerCell.toFixed(3)}°/cell`);
}

/**
 * The inline `[reset]` beside a View slider's own label.
 *
 * Asked for in exactly that shape, and after a first attempt shipped it as two
 * full-width lil-gui button rows: "NO, THE RESET BUTTONS HAVE TO BE NEXT TO
 * THE TILT ° AND BEARING ° LABELS WE CANNOT ADD THOSE HUGE BUTTONS ... tiny
 * reset button ... [reset]". So it is literally that word in brackets, in the
 * rail's own monospace, at 9px — the same bracket language the Dock's slider
 * already draws around its track (`[ ─█──── ]`, gallery-workbench.css) and
 * the same row scale `/synth`'s `.voice-mode-toggle .gx-toggle-btn` uses when
 * a segmented control has to live inline in a title row rather than own one.
 *
 * It goes in the row's NAME cell, not its widget. That was the geometric
 * objection to inline in the first place — a number row is `.name` at 45%
 * plus a widget that already ends in a 45..70px value box, so an affordance
 * in the WIDGET buys itself out of the slider TRACK, the part a reader
 * drags. The name cell has the room instead: measured in a real browser on
 * the running page at the Dock's 360px, the cell is 152.09px (148px of
 * content), the longer of the two labels is 61.6px and this button 43.2px, so
 * the worse row uses 110.8 of 148 — and `Tilt °`/`Bearing °`/`Span °` all
 * still report a 120.05px slider track at the same x, unchanged to the third
 * decimal from before this existed. `.maps-view-name`'s `max-width:
 * var(--name-width)` then makes the guarantee structural rather than a
 * measurement that could rot — lil-gui gives `.name` a `min-width` and no
 * max, so pinning the max to the same 45% means the cell cannot grow into the
 * widget however long a label gets.
 *
 * Both write through the folder's OWN `onTilt`/`onBearing` — the callbacks
 * the sliders drive, which `MapsWorkbench` wires to `map.setTilt` /
 * `map.setBearing`. Nothing here writes page state directly: the tilt
 * ceiling, the `[0, 360)` bearing normalization, the widget's single motion
 * loop and the URL write all live behind those two setters.
 *
 * DISABLED at home — a real `disabled` attribute on a real `<button>`, so it
 * is inert rather than merely quiet — which also makes it the INDICATOR that
 * a pitch or a heading is in force at all (the same job the on-map
 * `MapCompass` does, which resets both angles at once and is the
 * discoverable half of this pair). The ROW stays enabled: it is the slider's,
 * and lil-gui's `.controller.disabled` would take the slider down with it.
 */
function useRowReset(
  ctrl: DockController<number> | null,
  inputs: { atHome: boolean; label: string; title: string; onReset: () => void },
): void {
  const { atHome, label, title, onReset } = inputs;
  const onResetRef = useRef(onReset);
  onResetRef.current = onReset;
  const [button, setButton] = useState<HTMLButtonElement | null>(null);

  useEffect(() => {
    // `.name` is lil-gui's own documented row class (the tests find rows by
    // it, and `Controller.$name` is not in the published typings), so this
    // stays on the same public-DOM footing as the `title` writes above.
    const name = ctrl?.raw.domElement.querySelector<HTMLElement>(".name");
    if (!name) return;
    const el = document.createElement("button");
    el.type = "button";
    el.className = "maps-view-reset";
    el.textContent = "[reset]";
    el.addEventListener("click", () => onResetRef.current());
    name.classList.add("maps-view-name");
    name.appendChild(el);
    setButton(el);
    return () => {
      el.remove();
      name.classList.remove("maps-view-name");
      setButton(null);
    };
  }, [ctrl]);

  useEffect(() => {
    if (!button) return;
    button.disabled = atHome;
    button.setAttribute("aria-label", label);
    button.setAttribute("title", title);
  }, [button, atHome, label, title]);
}

// ── Code panel — reuses `GalleryWorkbench/CodePanel`'s shell (tabs, copy,
//    collapse) via its `override` prop (MAPS.md §13 slice 5's "same
//    component, same interaction, do not write a second one"). `@glyphcss/
//    maps` has no React/Vue bindings yet (AGENTS.md's API sketch: "No
//    React/Vue components — deferred scope"), so every tab shows the same
//    real, working vanilla `createGlyphMap` snippet — labeled honestly
//    rather than inventing framework wrappers that don't exist.

export interface MapsSnippetLighting {
  readonly azimuth: number;
  readonly elevation: number;
  readonly intensity: number;
  readonly color: string;
  readonly ambientIntensity: number;
  readonly ambientColor: string;
}

/** The OSM card's mounted state — `null` when the card is off. */
export interface MapsSnippetOsm {
  /** The rows that are on, in card order (`mapOsmLayers`' `include`). */
  readonly enabled: readonly string[];
  /** Per-row density, only for rows that diverge from 1. */
  readonly densities: Readonly<Record<string, number>>;
  /** Per-row label placement, only for rows that diverge from the centred default. */
  readonly anchors: Readonly<Record<string, string>>;
}

export interface MapsSnippetState {
  readonly projectionId: MapProjectionId;
  readonly exaggeration: number;
  readonly centerLon: number;
  readonly centerLat: number;
  readonly span: number;
  readonly tilt: number;
  /** Camera heading, degrees. Emitted only when the map has actually been turned — see {@link buildMapsSnippet}. */
  readonly bearing: number;
  readonly palette: MapPaletteName;
  readonly terrainGlyphPalette: MapLayerGlyphPalette;
  readonly backgroundColor: string;
  readonly showBorders: boolean;
  readonly borderColor: string;
  readonly showContour: boolean;
  readonly contourInterval: number;
  readonly contourColor: string;
  /** The contour elevation window, `null` per unbounded end — emitted only when set, so an untouched window produces the snippet this builder produced before the control existed. */
  readonly contourMinElevation: number | null;
  readonly contourMaxElevation: number | null;

  // ── The scene block the page actually passes ────────────────────────────
  readonly charMode: string;
  readonly colorEncoding: string;
  readonly useColors: boolean;
  readonly smoothShading: boolean;
  readonly wireframeJunctions: boolean;
  readonly hiddenLines: "show" | "hide";
  readonly solidWeightRamp: boolean;
  readonly density: number;
  /** Already converted from the Dock's "Drag density" — the page passes this number, not the UI one. */
  readonly interactiveDownscale: number;
  readonly lighting: MapsSnippetLighting;

  // ── Whole-map options ───────────────────────────────────────────────────
  readonly sunMode: "off" | "realtime" | "manual";
  readonly sunDay: number;
  readonly sunHour: number;
  readonly shadows: boolean;

  // ── Per-layer state ─────────────────────────────────────────────────────
  readonly showTerrain: boolean;
  readonly terrainDensity: number;
  readonly terrainMinElevation: number | null;
  readonly terrainMaxElevation: number | null;
  readonly borderDensity: number;
  readonly contourDensity: number;
  readonly contourLabels: boolean;
  readonly osm: MapsSnippetOsm | null;
}

const PROJECTION_FACTORY: Record<MapProjectionId, string> = {
  equirectangular: "glyphMapEquirectangular",
  mercator: "glyphMapMercator",
  globe: "glyphMapGlobe",
};

function fmt(n: number): string {
  return String(Math.round(n * 100) / 100);
}

/** `key: value` only when `value` diverges from the page's own default — see {@link buildMapsSnippet}. */
function optional(key: string, value: unknown, fallback: unknown): string {
  return value === fallback ? "" : `, ${key}: ${JSON.stringify(value)}`;
}

/** The `minElevation`/`maxElevation` pair for a layer's elevation window, or an empty string when neither end is bounded. */
function elevationWindowSource(min: number | null, max: number | null): string {
  return [
    min === null ? "" : `, minElevation: ${fmt(min)}`,
    max === null ? "" : `, maxElevation: ${fmt(max)}`,
  ].join("");
}

/**
 * The `sun` option, or an empty string in the default `"off"` mode.
 *
 * `manual` is pinned to ONE instant, and the page derives that instant from a
 * day-of-year and an hour (`mapSunManualInstant`). The snippet spells the
 * resulting ISO timestamp rather than re-deriving it, so the pen shows the
 * terminator the reader is looking at rather than one that depends on when
 * the snippet is run.
 */
function sunSource(state: MapsSnippetState): string {
  if (state.sunMode === "off") return "";
  if (state.sunMode === "realtime") return `\n  sun: { mode: "realtime" },`;
  const instant = mapSunManualInstant(state.sunDay, state.sunHour);
  return `\n  sun: { mode: "manual", date: new Date(${JSON.stringify(new Date(instant).toISOString())}) },`;
}

/**
 * The `scene` block.
 *
 * Everything that is at glyphcss's own default is OMITTED, and that is a
 * deliberate rule rather than brevity: a snippet that spelled every default
 * out would read as if the default had to be opted into, and it is the exact
 * rule the pre-existing `glyphPalette` line already followed. What the page
 * pins UNCONDITIONALLY (`mode`, `glyphPalette`) stays unconditional, because
 * the page pins it unconditionally.
 */
function sceneSource(state: MapsSnippetState): string {
  const l = state.lighting;
  const rad = (deg: number) => (deg * Math.PI) / 180;
  const el = rad(l.elevation);
  const az = rad(l.azimuth);
  // The page's own `buildMapLighting` conversion, spelled as literals so the
  // pen needs no helper: glyphcss's `direction` is the source vector, from
  // the surface TOWARD the light (AGENTS.md, "Numeric conventions").
  const dir = [Math.cos(el) * Math.cos(az), Math.cos(el) * Math.sin(az), Math.sin(el)]
    .map((v) => fmt(v))
    .join(", ");
  return [
    `    mode: "${MAP_SCENE_RENDER_MODE}",`,
    `    glyphPalette: ${JSON.stringify(MAP_SCENE_GLYPH_PALETTE)},`,
    state.charMode === "ascii" ? "" : `    charMode: ${JSON.stringify(state.charMode)},`,
    state.colorEncoding === "spans" ? "" : `    colorEncoding: ${JSON.stringify(state.colorEncoding)},`,
    state.useColors ? "" : "    useColors: false,",
    state.smoothShading ? "    smoothShading: true," : "",
    state.wireframeJunctions ? "    wireframeJunctions: true," : "",
    state.hiddenLines === "show" ? "" : `    hiddenLines: ${JSON.stringify(state.hiddenLines)},`,
    // A ramp is DATA (`calibrateWeightedGlyphRamp`'s steps), not a flag, so
    // the snippet names the call that produces it rather than inlining a
    // table the reader would have to trust.
    state.solidWeightRamp
      ? "    // solidWeightRamp: calibrateWeightedGlyphRamp({ font: { family: getComputedStyle(host).fontFamily, size: 13 } }),"
      : "",
    state.density === 1 ? "" : `    density: ${fmt(state.density)},`,
    state.interactiveDownscale === 1 ? "" : `    interactiveDownscale: ${fmt(state.interactiveDownscale)},`,
    `    directionalLight: { direction: [${dir}], intensity: ${fmt(l.intensity)}, color: ${JSON.stringify(l.color)} },`,
    `    ambientLight: { intensity: ${fmt(l.ambientIntensity)}, color: ${JSON.stringify(l.ambientColor)} },`,
  ].filter(Boolean).join("\n");
}

export function buildMapsSnippet(state: MapsSnippetState): string {
  const factory = PROJECTION_FACTORY[state.projectionId];
  const projectionArgs = `{ exaggeration: ${fmt(state.exaggeration)} }`;
  // The per-layer glyph-palette option is EMITTED ONLY WHEN IT DIVERGES from
  // the scene's own — not for brevity, but because that is exactly the
  // condition under which it costs anything: `@glyphcss/maps` keeps a layer
  // naming the scene's own ramp in the shared base grid, so a snippet that
  // spelled it out unconditionally would read as if the free case had to be
  // opted into. Terrain has no render-mode option of its own to emit here —
  // it is always the scene's own `solid` mode (`MAP_SCENE_RENDER_MODE`).
  const terrainOptions =
    (state.terrainGlyphPalette === MAP_SCENE_GLYPH_PALETTE ? "" : `, glyphPalette: ${JSON.stringify(state.terrainGlyphPalette)}`)
    + optional("density", state.terrainDensity, 1)
    + elevationWindowSource(state.terrainMinElevation, state.terrainMaxElevation);
  const layerLines = [
    `    { type: "background", color: ${JSON.stringify(state.backgroundColor)} },`,
    ...(state.showTerrain
      ? [`    { type: "raster", source: terrainProvider, classifier: GlyphMapClassifiers.etopo1V1, colors: ${JSON.stringify(MAP_PALETTES[state.palette])}${terrainOptions} },`]
      : []),
    ...(state.showBorders
      ? [`    { type: "line", source: borderProvider, color: ${JSON.stringify(state.borderColor)}${optional("density", state.borderDensity, 1)} },`]
      : []),
    ...(state.showContour
      ? [`    { type: "contour", source: terrainProvider, levels: { interval: ${fmt(state.contourInterval)} }, color: ${JSON.stringify(state.contourColor)}${elevationWindowSource(state.contourMinElevation, state.contourMaxElevation)}${state.contourLabels ? ", labels: true" : ""}${optional("density", state.contourDensity, 1)} },`]
      : []),
    // The OSM stack is ONE call, exactly as the page mounts it
    // (`mapsOsm.ts`'s `mapOsmLayers`): thirteen rows off one provider, each
    // carrying that provider's ODbL attribution, so `getAttributions()` picks
    // the credit up from the mounted layer rather than from a hardcoded
    // string. Spread rather than listed, because the row -> layer mapping is
    // `@glyphcss/maps`' table and not something a page should re-type.
    ...(state.osm ? ["    ...osmLayers,"] : []),
  ].join("\n");

  const osmPreamble = state.osm
    ? `\n// The OpenStreetMap stack — OpenFreeMap's planet (public, no API key),\n// mapped onto glyph layers by @glyphcss/maps' OpenMapTiles schema table.\nconst osmSource = glyphMapOpenFreeMapProvider();\nconst osmLayers = glyphMapOpenMapTilesLayers(osmSource, {\n  include: ${JSON.stringify(state.osm.enabled)},\n  densities: ${JSON.stringify(state.osm.densities)},\n  textAnchors: ${JSON.stringify(state.osm.anchors)},\n});\n`
    : "";

  const imports = [
    "  createGlyphMap,",
    `  ${factory},`,
    "  GlyphMapClassifiers,",
    ...(state.osm ? ["  glyphMapOpenFreeMapProvider,", "  glyphMapOpenMapTilesLayers,"] : []),
  ].join("\n");

  return `import {
${imports}
} from "@glyphcss/maps";

// terrainProvider / borderProvider: fetch from your own baked tile
// pyramids (see website/scripts/bake-geo-tiles.mjs and
// bake-vector-tiles.mjs for the reference bakers this page uses).
// contour reuses the SAME elevation provider as terrain — createGlyphMap
// re-derives its field per visible LOD/tile as the view changes.

const host = document.querySelector("#map");
${osmPreamble}
const map = createGlyphMap(host, {
  view: { center: [${fmt(state.centerLon)}, ${fmt(state.centerLat)}], span: ${fmt(state.span)}, cols: 160, rows: 64 },
  projection: ${factory}(${projectionArgs}),
  tilt: ${fmt(state.tilt)},${state.bearing === 0 ? "" : `\n  bearing: ${fmt(state.bearing)},`}${sunSource(state)}${state.shadows ? "\n  shadow: {}," : ""}
  autoSize: true,
  controls: { drag: true, wheel: true },
  layers: [
${layerLines}
  ],
  scene: {
${sceneSource(state)}
  },
});

// No @glyphcss/react or @glyphcss/vue bindings exist for maps yet
// (AGENTS.md) — call createGlyphMap directly from a framework's own
// mount/effect hook (React useEffect, Vue onMounted, ...).
`;
}
