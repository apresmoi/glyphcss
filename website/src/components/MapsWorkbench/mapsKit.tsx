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
 * builds. A map-specific "Projection"/"View" folder replaces it below, built
 * from the SAME primitives (`useFolder`/`useSlider`/`useOption`) — same
 * pattern `SynthWorkbench`'s own `SynthDock` already uses for its own
 * scene/camera, which also isn't Gallery-shaped.
 */
import type { GUI } from "lil-gui";
import {
  glyphMapEquirectangular,
  glyphMapGlobe,
  glyphMapMercator,
  glyphMapOrthographic,
  type GlyphMapBounds,
  type GlyphMapClassifier,
  type GlyphMapProjection,
} from "@glyphcss/maps";
import { useFolder, useOption, useReadonlyText, useSlider } from "../Dock/primitives";

// ── Projections ────────────────────────────────────────────────────────────

export type MapProjectionId = "equirectangular" | "mercator" | "globe" | "orthographic";

export const PROJECTION_OPTIONS: Record<string, MapProjectionId> = {
  Equirectangular: "equirectangular",
  Mercator: "mercator",
  Globe: "globe",
  Orthographic: "orthographic",
};

/** `orthographic` centers on `view.center` at CONSTRUCTION time only — like
 *  every projection swap, changing it means tearing down and rebuilding the
 *  widget (see MapsWorkbench's `[projectionId, exaggeration]` effect); there
 *  is no `setProjection`/`transitionTo` yet (MAPS.md §13 slice 4, out of
 *  scope). */
export function buildMapProjection(
  id: MapProjectionId,
  exaggeration: number,
  center: readonly [number, number],
): GlyphMapProjection {
  switch (id) {
    case "equirectangular": return glyphMapEquirectangular({ exaggeration });
    case "mercator": return glyphMapMercator({ exaggeration });
    case "globe": return glyphMapGlobe({ exaggeration });
    case "orthographic": return glyphMapOrthographic({ lon0: center[0], lat0: center[1], exaggeration });
  }
}

export function isOrbitProjectionId(id: MapProjectionId): boolean {
  return id === "globe";
}

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

// ── Places (quick-jump `fitBounds` targets) ────────────────────────────────

export interface MapPlace {
  readonly label: string;
  readonly bounds: GlyphMapBounds;
}

export const MAP_PLACES: readonly MapPlace[] = [
  { label: "World", bounds: { west: -180, east: 180, south: -80, north: 82 } },
  { label: "Himalaya", bounds: { west: 78, east: 92, south: 25, north: 32 } },
  { label: "Grand Canyon", bounds: { west: -114.5, east: -110.5, south: 34.5, north: 37.5 } },
  { label: "Andes", bounds: { west: -77, east: -65, south: -34, north: -4 } },
  { label: "Mariana Trench", bounds: { west: 139, east: 149, south: 8, north: 16 } },
  { label: "Sahara", bounds: { west: -12, east: 26, south: 14, north: 31 } },
  { label: "Iceland", bounds: { west: -26, east: -12, south: 62.5, north: 67 } },
  { label: "Amazon Basin", bounds: { west: -76, east: -49, south: -13, north: 4 } },
  { label: "Antarctica", bounds: { west: -180, east: 180, south: -90, north: -63 } },
];

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

export function buildMapLighting(l: MapLighting): {
  directionalLight: { direction: [number, number, number]; intensity: number; color: string };
  ambientLight: { intensity: number; color: string };
} {
  const a = (l.lightAzimuth * Math.PI) / 180;
  const e = (l.lightElevation * Math.PI) / 180;
  return {
    directionalLight: {
      direction: [Math.cos(e) * Math.cos(a), Math.cos(e) * Math.sin(a), Math.sin(e)],
      intensity: l.lightIntensity,
      color: l.lightColor,
    },
    ambientLight: { intensity: l.ambientIntensity, color: l.ambientColor },
  };
}

// ── "Projection" folder ─────────────────────────────────────────────────────

export interface ProjectionFolderInputs {
  projectionId: MapProjectionId;
  exaggeration: number;
  onProjectionId: (id: MapProjectionId) => void;
  onExaggeration: (value: number) => void;
}

export function useProjectionFolder(parent: GUI | null, inputs: ProjectionFolderInputs): void {
  const { projectionId, exaggeration, onProjectionId, onExaggeration } = inputs;
  const folder = useFolder(parent, "Projection", { open: true });
  useOption<MapProjectionId>(folder, "Projection", PROJECTION_OPTIONS, projectionId, onProjectionId);
  useSlider(folder, "Exaggeration ×", { min: 1, max: 60, step: 1 }, exaggeration, onExaggeration);
}

// ── "View" folder — center/span/tilt (replaces DockCamera; see file doc) ──

export interface ViewFolderInputs {
  centerLon: number;
  centerLat: number;
  span: number;
  maxSpan: number;
  tilt: number;
  isOrbitProjection: boolean;
  lod: number;
  degPerCell: number;
  onCenter: (lon: number, lat: number) => void;
  onSpan: (span: number) => void;
  onTilt: (tilt: number) => void;
}

export function useViewFolder(parent: GUI | null, inputs: ViewFolderInputs): void {
  const { centerLon, centerLat, span, maxSpan, tilt, isOrbitProjection, lod, degPerCell, onCenter, onSpan, onTilt } = inputs;
  const folder = useFolder(parent, "View", { open: true });
  useSlider(folder, "Center lon", { min: -180, max: 180, step: 0.1 }, centerLon, (v) => onCenter(v, centerLat));
  useSlider(folder, "Center lat", { min: -90, max: 90, step: 0.1 }, centerLat, (v) => onCenter(centerLon, v));
  useSlider(folder, "Span °", { min: 0.5, max: maxSpan, step: 0.5 }, span, onSpan);
  const tiltCtrl = useSlider(folder, "Tilt °", { min: 5, max: 89, step: 1 }, tilt, onTilt);
  // Only a flat sheet (equirectangular/Mercator/orthographic) has a fixed
  // camera tilt — the globe is navigated entirely by orbit (widget.ts's
  // `isOrbitProjection`), so `opts.tilt` has no effect there (see
  // `GlyphMapOptions.tilt`'s own doc).
  tiltCtrl?.setEnabled(!isOrbitProjection, { dim: true });
  useReadonlyText(folder, "LOD", `z${lod} · ${degPerCell.toFixed(3)}°/cell`);
}

// ── "Terrain" folder — palette only (recolors via remove+re-addLayer, since
//    a mounted raster layer's `colors` has no live setter — see
//    `MapsWorkbench`'s `handlePalette`). ────────────────────────────────────

export interface TerrainFolderInputs {
  palette: MapPaletteName;
  onPalette: (name: MapPaletteName) => void;
}

export function useTerrainFolder(parent: GUI | null, inputs: TerrainFolderInputs): void {
  const folder = useFolder(parent, "Terrain", { open: true });
  useOption<MapPaletteName>(folder, "Palette", PALETTE_OPTIONS, inputs.palette, inputs.onPalette);
}
