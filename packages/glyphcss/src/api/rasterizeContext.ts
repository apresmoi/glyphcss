import type {
  GridSize,
  RenderMode,
  WireframeEdge,
  Polygon,
  TextureSampler,
} from "@glyphcss/core";
import type { TransformCells } from "../render/cells";
import type { GlyphCamera, GlyphProjectionMetrics } from "./createGlyphCamera";
import type { GlyphDirectionalLight, GlyphAmbientLight, GlyphShadowOptions } from "./types";

/**
 * Cross-layer occlusion input. A shared buffer storing, per reference cell, the
 * id of the LAYER whose surface is nearest there (`-1` = empty). The rasterizer
 * blanks an output cell when the owner at its reference cell is a DIFFERENT layer
 * (`owner !== layerId`) — so a layer never occludes itself (its own self-depth is
 * already resolved inside its own rasterize), only other layers in front do.
 * `(colScale, colOffset)` / `(rowScale, rowOffset)` map this layer's OUTPUT cell
 * to a reference cell: `refCol = floor(colScale * outCol + colOffset)`.
 */
export interface OcclusionMap {
  idMap: Int32Array;
  layerId: number;
  cols: number;
  rows: number;
  colScale: number;
  colOffset: number;
  rowScale: number;
  rowOffset: number;
}

export interface RasterizeContextOptions {
  camera: GlyphCamera;
  grid: GridSize;
  /** Polygon list. Required for `solid` / `voxel` modes, optional otherwise. */
  polygons?: Polygon[];
  /** Explicit wireframe edges. If omitted in wireframe mode, edges are derived from `polygons` (fan-triangulated). */
  wireframe?: WireframeEdge[];
  mode?: RenderMode;
  directionalLight?: GlyphDirectionalLight;
  ambientLight?: GlyphAmbientLight;
  /** Named wireframe glyph palette. Defaults to `"default"`. */
  glyphPalette?: string;
  /**
   * When `false`, the rasterizer emits plain text (no <span> wrappers). The
   * output is just one text node — fastest possible DOM update. Default `true`.
   */
  useColors?: boolean;
  /**
   * Smooth (Gouraud) shading. When `true`, per-pixel Lambert intensity is
   * interpolated from per-vertex normals (averaged across adjacent polygons
   * within `creaseAngle`). Default `false` — flat shading is glyph's default
   * because the facets are part of the ASCII aesthetic.
   */
  smoothShading?: boolean;
  /**
   * Crease angle in degrees for smooth shading. Vertex normals are averaged
   * across adjacent faces whose normals diverge by less than this angle;
   * edges sharper than this stay flat-shaded. `0` collapses to pure flat
   * shading; `180` smooths every shared vertex. Default `60`.
   */
  creaseAngle?: number;
  /**
   * Render both faces of every polygon (no backface culling). Default `false`
   * (cull back faces — correct + faster for closed meshes). Set `true` for
   * single-sided surfaces whose winding isn't guaranteed to face the camera —
   * e.g. level geometry imported from a BSP — matching how a CSS/DOM renderer
   * (polycss) shows both sides. Without it, "back-wound" faces vanish.
   * Lighting remains one-sided: the authored polygon normal is still used for
   * Lambert shading, so a backface does not get direct light via `abs(dot)`.
   */
  doubleSided?: boolean;
  /**
   * Supersampled anti-aliasing factor (solid mode). `1` (default) = off. `2`/`3`
   * rasterize at N× the grid resolution and box-average down, removing the
   * motion crawl where sub-cell-sized surfaces flip their per-cell winner
   * frame-to-frame. Cost scales ~N². Use `2` for a big stability win at ~4× cost.
   */
  supersample?: number;
  /**
   * Temporal anti-aliasing: exponential blend of this frame with the previous
   * one, weight in [0,1) (history weight). `0` (default) = off. Smooths the
   * frame-to-frame crawl of edges that move faster than spatial supersampling
   * can cover, at the cost of motion ghosting. Needs `temporalHistory` retained
   * across renders (the scene does this).
   */
  temporalBlend?: number;
  shadow?: GlyphShadowOptions;
  /** Per-polygon cast flag (parallel to `polygons` array). True = this poly's mesh has castShadow. */
  castShadowFlags?: boolean[];
  /** Per-polygon receive flag (parallel to `polygons` array). True = this poly's mesh has receiveShadow. */
  receiveShadowFlags?: boolean[];
  /** Per-polygon relative depth bias (parallel to `polygons`). `pixelDepth *= 1 + bias`. */
  depthBiases?: number[];
  /**
   * Global depth-test deadband (0 = exact, the default). A polygon replaces the
   * current cell only when nearer by more than this relative fraction, so
   * near-coplanar surfaces (overlapping brushes, decals, a translucent plane
   * over its backing face) keep a STABLE winner instead of z-fighting per-cell
   * as the camera moves. A CSS/DOM renderer gets this for free from stacking
   * order; a projection-painted depth buffer needs the deadband. Typical 0.002–0.01.
   */
  depthEpsilon?: number;
  /** Optional cross-layer occlusion map (see {@link OcclusionMap}). */
  occlusion?: OcclusionMap | null;
  /**
   * Optional post-rasterize cell hook (M4 composition effects). When supplied,
   * the rasterizer builds a {@link CellGrid} from its final per-cell buffers,
   * runs the hook, then stringifies the (possibly mutated) grid — all BEFORE the
   * single `<pre>` write. When absent (default), no grid is built and output is
   * byte-identical to the pre-hook renderer. See {@link TransformCells}.
   */
  transformCells?: TransformCells;
}

/**
 * Cross-frame per-triangle shading cache. The Lambert intensities and lit
 * color depend only on world-space normals + light, never the camera — so
 * during a camera-only change (orbit/zoom drag) they are identical frame to
 * frame. Parallel arrays indexed by positional triangle order; lazily filled
 * as triangles become visible. The scene clears it when geometry, light, or
 * shading options change. Absent/null → always recompute (current behavior).
 */
export interface ShadeCache {
  iA: number[];
  iB: number[];
  iC: number[];
  lit: (string | null)[];
}

/**
 * Retained previous-frame buffer for temporal anti-aliasing. Per output cell:
 * blended ramp index + RGB. The scene keeps one and reuses it across renders;
 * `rasterize` resets it when the grid size changes.
 */
export interface TemporalHistory {
  idx: Float32Array;
  r: Float32Array;
  g: Float32Array;
  b: Float32Array;
  cols: number;
  rows: number;
  /** Snapshot of the camera that produced the stored frame (for reprojection). */
  cam: {
    kind: "perspective" | "orthographic";
    rotX: number; rotY: number; target: [number, number, number];
    zoom: number; perspective: number; distance: number; stretch: number; fovScale: number;
    center: [number, number];
    metrics?: GlyphProjectionMetrics;
  } | null;
}

export interface RasterizeContext {
  camera: GlyphCamera;
  grid: GridSize;
  polygons: Polygon[];
  wireframe: WireframeEdge[];
  mode: RenderMode;
  directionalLight: GlyphDirectionalLight;
  ambientLight: GlyphAmbientLight;
  /** Named wireframe glyph palette passed to the rasterizer. */
  glyphPalette: string;
  useColors: boolean;
  smoothShading: boolean;
  creaseAngle: number;
  doubleSided: boolean;
  supersample: number;
  temporalBlend: number;
  shadow: GlyphShadowOptions | undefined;
  castShadowFlags: boolean[];
  receiveShadowFlags: boolean[];
  depthBiases?: number[];
  /** Global depth-test deadband — see {@link RasterizeContextOptions.depthEpsilon}. */
  depthEpsilon?: number;
  /** Optional cross-frame shading cache (see {@link ShadeCache}). */
  shadeCache?: ShadeCache | null;
  /**
   * Decoded texture pixel samplers keyed by texture URL. When a polygon has a
   * texture + UVs and its sampler is present here, the solid rasterizer samples
   * the texture per cell (full image, glyph-resolution) instead of using the
   * flat baked `poly.color`. Built by the scene via `buildTextureSamplers`.
   */
  textureSamplers?: Map<string, TextureSampler> | null;
  /** Optional retained previous-frame buffer for temporal AA. */
  temporalHistory?: TemporalHistory | null;
  /** Optional cross-layer occlusion map (see {@link OcclusionMap}). */
  occlusion?: OcclusionMap | null;
  /** Optional post-rasterize cell hook — see {@link RasterizeContextOptions.transformCells}. */
  transformCells?: TransformCells;
}

// Source vector from the surface toward the distant light.
const DEFAULT_DIRECTIONAL: GlyphDirectionalLight = { direction: [0.5, 0.7, 0.5], intensity: 1 };
const DEFAULT_AMBIENT: GlyphAmbientLight = { intensity: 0.4 };

function polygonsToWireframeEdges(polygons: Polygon[]): WireframeEdge[] {
  // Derive deduplicated edges by fan-triangulating each polygon and collecting
  // unique vertex pairs (sorted key). Color is taken from the first polygon seen.
  const seen = new Set<string>();
  const out: WireframeEdge[] = [];
  for (const poly of polygons) {
    const verts = poly.vertices;
    if (verts.length < 2) continue;
    // Emit each polygon edge (consecutive pairs, wrapping around).
    for (let i = 0; i < verts.length; i++) {
      const a = verts[i]!;
      const b = verts[(i + 1) % verts.length]!;
      const k1 = `${a[0]},${a[1]},${a[2]}`;
      const k2 = `${b[0]},${b[1]},${b[2]}`;
      const key = k1 < k2 ? `${k1}|${k2}` : `${k2}|${k1}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const edge: WireframeEdge = { from: a, to: b, weight: 2 };
      if (poly.color) edge.color = poly.color;
      out.push(edge);
    }
  }
  return out;
}

export function buildRasterizeContext(opts: RasterizeContextOptions): RasterizeContext {
  const polygons = opts.polygons ?? [];
  const mode = opts.mode ?? (polygons.length ? "solid" : "wireframe");
  const wireframe = opts.wireframe ?? (mode === "wireframe" ? polygonsToWireframeEdges(polygons) : []);
  return {
    camera: opts.camera,
    grid: opts.grid,
    polygons,
    wireframe,
    mode,
    directionalLight: opts.directionalLight ?? DEFAULT_DIRECTIONAL,
    ambientLight: opts.ambientLight ?? DEFAULT_AMBIENT,
    glyphPalette: opts.glyphPalette ?? "default",
    useColors: opts.useColors ?? true,
    smoothShading: opts.smoothShading ?? false,
    creaseAngle: opts.creaseAngle ?? 60,
    doubleSided: opts.doubleSided ?? false,
    supersample: opts.supersample ?? 1,
    temporalBlend: opts.temporalBlend ?? 0,
    shadow: opts.shadow,
    castShadowFlags: opts.castShadowFlags ?? [],
    receiveShadowFlags: opts.receiveShadowFlags ?? [],
    ...(opts.depthBiases ? { depthBiases: opts.depthBiases } : {}),
    ...(opts.depthEpsilon ? { depthEpsilon: opts.depthEpsilon } : {}),
    ...(opts.occlusion ? { occlusion: opts.occlusion } : {}),
    ...(opts.transformCells ? { transformCells: opts.transformCells } : {}),
  };
}
