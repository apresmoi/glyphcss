import type {
  GridSize,
  RenderMode,
  WireframeEdge,
  Polygon,
} from "@glyphcss/core";
import type { GlyphCamera } from "./createGlyphCamera";
import type { GlyphDirectionalLight, GlyphAmbientLight } from "./types";

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
}

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
  };
}
