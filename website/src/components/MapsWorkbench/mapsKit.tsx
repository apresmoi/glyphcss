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
import type { CSSProperties } from "react";
import type { GUI } from "lil-gui";
import {
  glyphMapDecodeVectorTile,
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
//
// Replaces a hand-typed bounding-box array with REAL geometry: each place
// (besides "World", a fixed reset view) is "select this admin_0 feature,
// fit to its actual bounds" — computed from the SAME baked Natural Earth
// tiles the `line` border layer renders (`bake-vector-tiles.mjs`), not an
// eyeballed box. "Switzerland" doubles as the curated place demo (MAPS.md's
// coordinator scope addition) — selecting it is what pulls in its deeper
// (z4) curated bundle via `glyphMapCuratedVectorProvider`.

export interface MapPlace {
  readonly label: string;
  readonly bounds: GlyphMapBounds;
}

const WORLD_PLACE: MapPlace = { label: "World", bounds: { west: -180, east: 180, south: -80, north: 82 } };

/** Curated subset of admin_0 feature names to surface as quick-jump places — picked for terrain variety (mountains, desert, ice, rainforest), not exhaustive. */
const PLACE_FEATURE_NAMES = ["Nepal", "Peru", "Egypt", "Iceland", "Switzerland", "Brazil", "Antarctica", "Japan"];

function featureBounds(rings: readonly (readonly (readonly [number, number])[])[]): GlyphMapBounds {
  let west = Infinity, east = -Infinity, south = Infinity, north = -Infinity;
  for (const ring of rings) {
    for (const [lon, lat] of ring) {
      if (lon < west) west = lon;
      if (lon > east) east = lon;
      if (lat < south) south = lat;
      if (lat > north) north = lat;
    }
  }
  return { west, east, south, north };
}

/** Loads places from the baked z0 admin_0 tile (the whole world, coarsest resolution — plenty for a bounding box) — see `bake-vector-tiles.mjs`. */
export async function loadMapPlaces(baseUrl = "/data/vector-tiles"): Promise<readonly MapPlace[]> {
  const res = await fetch(`${baseUrl}/0/0_0.json`);
  if (!res.ok) throw new Error(`failed to load places from ${baseUrl}/0/0_0.json (${res.status})`);
  const tile = glyphMapDecodeVectorTile(await res.json());
  const features = tile.layers.admin0 ?? [];
  const places: MapPlace[] = [WORLD_PLACE];
  for (const name of PLACE_FEATURE_NAMES) {
    const feature = features.find((f) => f.properties?.name === name);
    if (feature) places.push({ label: name, bounds: featureBounds(feature.rings) });
  }
  return places;
}

// ── "Layers" panel — one row per layer (bracket checkbox + label + density
//    slider, all inline), directly in the LEFT RAIL under the shared
//    "Layers & places" header, above the Places list (user placement ask:
//    "the left rail is already where the map's content lives"). A prior
//    version mounted a SECOND lil-gui root here (`useGui`) and rendered each
//    layer as two separate lil-gui rows ("Background — visible" / "Background
//    — density") — lil-gui has no "several controls on one row" layout, so
//    that read as a foreign control kit dropped into the rail, with every
//    layer's name repeated twice. This is a plain React component instead
//    (AGENTS.md's no-BC-shim rule: replaces that mechanism outright, not
//    alongside it), reusing the SAME bracket-checkbox (`[x]`/`[ ]`,
//    `.layer-group-check`) and slider (`.voice-slider`/`.voice-slider-track`)
//    idiom `SynthWorkbench`'s own left-rail `LayerGroup`/`VoiceCard` already
//    established for exactly this "compact control row" shape — see
//    `../SynthWorkbench/synthKit.tsx`'s `LayerGroup` and
//    `instrument-workbench.css` for the source of truth these classes are
//    styled from; this file supplies only the row GRID (maps-workbench.css's
//    `.maps-layers-list`) that lines every row's checkbox/label/track/value
//    up in shared columns. Every layer row is the SAME shape (no per-type
//    exception in the UI) — `raster`'s density slider is enabled (wired
//    straight through to glyphcss's own per-mesh `density`, see
//    `GlyphMapRasterLayer.density`'s doc); `background`/`line`/`contour`'s
//    are visibly dimmed+disabled (`.maps-layer-slider--off`) rather than
//    present-but-inert, since `createGlyphMap` THROWS if a stroke layer's
//    `density` is actually set to anything but 1 (see
//    `GlyphMapLayerDensity`'s doc for why stroke-layer density is real
//    future work, not wired this slice).

export interface LayerRowInputs {
  visible: boolean;
  onVisible: (v: boolean) => void;
  density: number;
  onDensity: (v: number) => void;
  /** Whether THIS layer's density is actually wired through to the renderer this slice. */
  densityEnabled: boolean;
}

export interface LayersFolderInputs {
  background: LayerRowInputs;
  terrain: LayerRowInputs;
  borders: LayerRowInputs;
  contour: LayerRowInputs;
}

function densityFill(v: number, min: number, max: number): CSSProperties {
  return { ["--fill" as string]: `${((v - min) / (max - min)) * 100}%` } as CSSProperties;
}

function LayerRow({ label, row }: { label: string; row: LayerRowInputs }) {
  return (
    <div className="maps-layer-row">
      <label className="layer-group-check maps-layer-check" title={`${label} — show or hide this layer`}>
        <input type="checkbox" checked={row.visible} onChange={(e) => row.onVisible(e.target.checked)} />
        <span>{label}</span>
      </label>
      <span
        className={`voice-slider maps-layer-slider${row.densityEnabled ? "" : " maps-layer-slider--off"}`}
        title={row.densityEnabled
          ? `${label} density — glyph resolution multiplier for this layer (1x-4x)`
          : `${label} density — not wired through to the renderer for this layer type yet`}
      >
        <span className="voice-slider-track">
          <input
            type="range"
            min={1}
            max={4}
            step={1}
            disabled={!row.densityEnabled}
            value={row.density}
            style={densityFill(row.density, 1, 4)}
            onChange={(e) => row.onDensity(+e.target.value)}
          />
        </span>
        <span className="voice-slider-readout">{row.density}</span>
      </span>
    </div>
  );
}

export function LayersPanel({ background, terrain, borders, contour }: LayersFolderInputs) {
  return (
    <div className="maps-layers-list">
      <LayerRow label="Background" row={background} />
      <LayerRow label="Terrain" row={terrain} />
      <LayerRow label="Borders" row={borders} />
      <LayerRow label="Contour" row={contour} />
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
  // `tilt` is unified across both navigation modes (widget.ts's
  // `GlyphMapHandle.setTilt` doc) as "additional pitch on top of the
  // projection's own base orientation" — a flat sheet has no view-driven
  // base, so its range is the absolute iso pitch (5..89, unchanged from
  // before orbit tilt existed); the globe's base orientation already comes
  // from `view.center`, so its tilt is a signed offset on top of that
  // (head-on at 0, tilts either direction).
  const tiltRange = isOrbitProjection ? { min: -70, max: 70, step: 1 } : { min: 5, max: 89, step: 1 };
  useSlider(folder, "Tilt °", tiltRange, tilt, onTilt);
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

// ── Code panel — reuses `GalleryWorkbench/CodePanel`'s shell (tabs, copy,
//    collapse) via its `override` prop (MAPS.md §13 slice 5's "same
//    component, same interaction, do not write a second one"). `@glyphcss/
//    maps` has no React/Vue bindings yet (AGENTS.md's API sketch: "No
//    React/Vue components — deferred scope"), so every tab shows the same
//    real, working vanilla `createGlyphMap` snippet — labeled honestly
//    rather than inventing framework wrappers that don't exist.

export interface MapsSnippetState {
  readonly projectionId: MapProjectionId;
  readonly exaggeration: number;
  readonly centerLon: number;
  readonly centerLat: number;
  readonly span: number;
  readonly tilt: number;
  readonly palette: MapPaletteName;
  readonly renderMode: string;
  readonly showBorders: boolean;
  readonly showContour: boolean;
}

const PROJECTION_FACTORY: Record<MapProjectionId, string> = {
  equirectangular: "glyphMapEquirectangular",
  mercator: "glyphMapMercator",
  globe: "glyphMapGlobe",
  orthographic: "glyphMapOrthographic",
};

function fmt(n: number): string {
  return String(Math.round(n * 100) / 100);
}

export function buildMapsSnippet(state: MapsSnippetState): string {
  const factory = PROJECTION_FACTORY[state.projectionId];
  const projectionArgs = state.projectionId === "orthographic"
    ? `{ lon0: ${fmt(state.centerLon)}, lat0: ${fmt(state.centerLat)}, exaggeration: ${fmt(state.exaggeration)} }`
    : `{ exaggeration: ${fmt(state.exaggeration)} }`;
  const layerLines = [
    `    { type: "background", color: "#05070c" },`,
    `    { type: "raster", source: terrainProvider, classifier: GlyphMapClassifiers.etopo1V1, colors: ${JSON.stringify(MAP_PALETTES[state.palette])} },`,
    ...(state.showBorders ? [`    { type: "line", source: borderProvider, color: "#e8c988" },`] : []),
    ...(state.showContour ? [`    { type: "contour", source: terrainProvider, levels: 6, color: "#7fe8c9" },`] : []),
  ].join("\n");

  return `import {
  createGlyphMap,
  ${factory},
  GlyphMapClassifiers,
} from "@glyphcss/maps";

// terrainProvider / borderProvider: fetch from your own baked tile
// pyramids (see website/scripts/bake-geo-tiles.mjs and
// bake-vector-tiles.mjs for the reference bakers this page uses).
// contour reuses the SAME elevation provider as terrain — createGlyphMap
// re-derives its field per visible LOD/tile as the view changes.

const host = document.querySelector("#map");

const map = createGlyphMap(host, {
  view: { center: [${fmt(state.centerLon)}, ${fmt(state.centerLat)}], span: ${fmt(state.span)}, cols: 160, rows: 64 },
  projection: ${factory}(${projectionArgs}),
  tilt: ${fmt(state.tilt)},
  autoSize: true,
  controls: { drag: true, wheel: true },
  layers: [
${layerLines}
  ],
  scene: { mode: "${state.renderMode}" },
});

// No @glyphcss/react or @glyphcss/vue bindings exist for maps yet
// (AGENTS.md) — call createGlyphMap directly from a framework's own
// mount/effect hook (React useEffect, Vue onMounted, ...).
`;
}
