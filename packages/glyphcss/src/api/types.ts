import type { Vec3, Vec2 } from "@layoutit/polycss-core";

/**
 * Triangle type for the glyphcss rasterizer. Unlike polycss-core's TextureTriangle,
 * `uvs` is optional — the ASCII rasterizer never samples UV texture coordinates.
 */
export interface GlyphcssTriangle {
  vertices: [Vec3, Vec3, Vec3];
  uvs?: [Vec2, Vec2, Vec2];
  color?: string;
}

/** Directional light — single distant source for the ASCII rasterizer. */
export interface GlyphcssDirectionalLight {
  direction: Vec3;
  intensity?: number;
  /** Hex color (#rrggbb). Tints the lit-side per-cell output. Default white. */
  color?: string;
}

/** Ambient light — uniform fill regardless of orientation. */
export interface GlyphcssAmbientLight {
  intensity?: number;
  /** Hex color (#rrggbb). Tints the unlit-side fill. Default white. */
  color?: string;
}

export interface GlyphcssMeshState {
  id: number;
  triangles: GlyphcssTriangle[];
  transform: GlyphcssMeshTransform;
}

export interface GlyphcssMeshTransform {
  position?: Vec3;
  scale?: number | Vec3;
  rotation?: Vec3;
}
