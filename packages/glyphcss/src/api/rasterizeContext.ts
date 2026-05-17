import type {
  GridSize,
  RenderMode,
  WireframeEdge,
} from "@glyphcss/core";
import { trianglesToFeatureEdges } from "@glyphcss/core";
import type { GlyphcssCamera } from "./createGlyphcssCamera";
import type { GlyphcssDirectionalLight, GlyphcssAmbientLight, GlyphcssTriangle } from "./types";

export interface RasterizeContextOptions {
  camera: GlyphcssCamera;
  grid: GridSize;
  /** Triangle list. Required for `solid` / `voxel` modes, optional otherwise. */
  triangles?: GlyphcssTriangle[];
  /** Explicit wireframe edges. If omitted in wireframe mode, edges are derived from `triangles`. */
  wireframe?: WireframeEdge[];
  mode?: RenderMode;
  directionalLight?: GlyphcssDirectionalLight;
  ambientLight?: GlyphcssAmbientLight;
  /** Named wireframe glyph palette. Defaults to `"default"`. */
  glyphPalette?: string;
  /**
   * When `false`, the rasterizer emits plain text (no <span> wrappers). The
   * output is just one text node — fastest possible DOM update. Default `true`.
   */
  useColors?: boolean;
}

export interface RasterizeContext {
  camera: GlyphcssCamera;
  grid: GridSize;
  triangles: GlyphcssTriangle[];
  wireframe: WireframeEdge[];
  mode: RenderMode;
  directionalLight: GlyphcssDirectionalLight;
  ambientLight: GlyphcssAmbientLight;
  /** Named wireframe glyph palette passed to the rasterizer. */
  glyphPalette: string;
  useColors: boolean;
}

const DEFAULT_DIRECTIONAL: GlyphcssDirectionalLight = { direction: [0.5, 0.7, 0.5], intensity: 1 };
const DEFAULT_AMBIENT: GlyphcssAmbientLight = { intensity: 0.4 };

export function buildRasterizeContext(opts: RasterizeContextOptions): RasterizeContext {
  const triangles = opts.triangles ?? [];
  const mode = opts.mode ?? (triangles.length ? "solid" : "wireframe");
  // trianglesToFeatureEdges only accesses vertices and color — safe to cast GlyphcssTriangle.
  const wireframe = opts.wireframe ?? (mode === "wireframe" ? trianglesToFeatureEdges(triangles as Parameters<typeof trianglesToFeatureEdges>[0]) : []);
  return {
    camera: opts.camera,
    grid: opts.grid,
    triangles,
    wireframe,
    mode,
    directionalLight: opts.directionalLight ?? DEFAULT_DIRECTIONAL,
    ambientLight: opts.ambientLight ?? DEFAULT_AMBIENT,
    glyphPalette: opts.glyphPalette ?? "default",
    useColors: opts.useColors ?? true,
  };
}
