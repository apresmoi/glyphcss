import type { CSSProperties } from "react";
import { parseHex } from "../../../utils/color/colorHex";

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

export function densityFill(v: number, min: number, max: number): CSSProperties {
  return { ["--fill" as string]: `${((v - min) / (max - min)) * 100}%` } as CSSProperties;
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
  n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : `${Math.round(n / 1000)}k`;

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
 * a half-typed colour reverts instead of writing an invalid value. Kept as
 * a named re-export (rather than every call site importing `parseHex`
 * directly) since `parseMapsHex` is this module's own established public
 * name (`LayersPanel.dockRows.test.tsx` imports it) — the shared
 * `InstrumentWorkbench/colorHex.ts` implementation is now the single
 * source both this and `/charts`' `ChartsColorSwatch` read (P3-1,
 * REVIEW-dock-colours-sliders-opus.md — the two were byte-for-byte copies).
 */
export const parseMapsHex = parseHex;
