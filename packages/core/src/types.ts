/* Core type and constant definitions shared across glyphcss runtime modules. */
export const DEFAULT_PROJECTION = "cubic" as const;

/**
 * Mesh post-processing intent.
 * - "lossless": preserve the authored surface while applying exact
 *   reductions such as interior culling and coplanar merge.
 * - "lossy": allow bounded geometric approximation when it reduces the
 *   rendered polygon/DOM count.
 */
export type MeshResolution = "lossless" | "lossy";

/**
 * 3D point/vector, stored as a `[x, y, z]` tuple. Tuple (rather than
 * `{x, y, z}`) for compact JSON: meshes serialize to thousands of vertices
 * and the difference adds up. Destructure with `const [x, y, z] = v` when
 * you need named axes.
 *
 * Glyphcss world space convention: +X right, +Y forward, +Z up.
 */
export type Vec3 = [number, number, number];

/**
 * 2D point/vector — `[u, v]`. Used for texture-atlas UV coordinates on
 * polygons. Convention follows OBJ: u is horizontal (0=left, 1=right),
 * v is vertical (0=bottom, 1=top). Renderers flip v when binding to raster
 * image space whose Y-axis points down.
 */
export type Vec2 = [number, number];

export interface TextureTriangle {
  vertices: [Vec3, Vec3, Vec3];
  uvs: [Vec2, Vec2, Vec2];
  /** Hex color string (`#rrggbb`) propagated from source model material. */
  color?: string;
}

/**
 * Directional light — simulates a single distant source (sun, key light).
 * Contributes Lambert shading scaled by `intensity`. `direction` is in
 * scene-local coords and does not need to be pre-normalized.
 * Mirrors three.js's `DirectionalLight`.
 */
export interface GlyphcssDirectionalLight {
  /** Direction the light shines TOWARD (typical convention). */
  direction: Vec3;
  /** Light tint, hex string. White by default. */
  color?: string;
  /** Scalar multiplier on the directional contribution. Default 1. */
  intensity?: number;
}

/**
 * Ambient light — uniform fill that adds to every polygon regardless of
 * orientation. Mirrors three.js's `AmbientLight`. Decoupled from the
 * directional contribution: the two add independently rather than
 * splitting a fixed energy budget.
 */
export interface GlyphcssAmbientLight {
  /** Tint, hex string. White by default. */
  color?: string;
  /** Scalar multiplier on the ambient contribution. Default 0.4. */
  intensity?: number;
}

/**
 * Material — paint configuration shareable across many polygons.
 *
 * In CSS terms, a material bundles the `background-image` source plus paint
 * config. When a polygon references a material AND its UVs form an
 * axis-aligned rectangle, glyphcss renders the polygon as an <i> with
 * `background-image: url(material.texture)` directly — no per-polygon canvas
 * rasterization, browser-cached texture, mounting / unmounting one polygon
 * does not affect any other.
 *
 * Three.js parallel: combines THREE.Texture + a basic Material in one. CSS
 * has no shader/sampler concerns, so the texture/material split from
 * Three.js doesn't pay rent here.
 */
export interface PolyMaterial {
  /** Image source. Anything `background-image: url(...)` can use. */
  texture: string;
  /** Optional unique key (used by glyphcss to dedupe / cache). Caller can
   *  pass a stable string; if omitted, the material's identity is its object
   *  reference. */
  key?: string;
}

/**
 * The single polygon type for glyphcss. N coplanar vertices in 3D space,
 * CCW winding from outside. No bbox field, no shape discriminator, no
 * input/output distinction — one type, used by parsers, by the merge
 * pass, and by the renderer.
 */
export interface Polygon {
  /** N coplanar vertices in 3D space, CCW winding from outside. */
  vertices: Vec3[];
  /**
   * Solid base color. Falls back to "#cccccc" when neither color nor
   * texture is set.
   */
  color?: string;
  /**
   * Texture URL. When set with `uvs`, UV-mapped via affine; without
   * `uvs`, single-tile fill. If the load fails, renderer falls back to
   * `color` (or default gray).
   */
  texture?: string;
  /**
   * Shared material. When set, `material.texture` takes precedence over the
   * inline `texture` field. If the polygon's UVs form an axis-aligned
   * rectangle, glyphcss uses the direct CSS background-image path (no per-
   * polygon canvas rasterization). Falls back to the atlas path otherwise.
   */
  material?: PolyMaterial;
  /**
   * Per-vertex UV coords (0..1, OBJ convention with v=0 at bottom).
   * Length MUST equal vertices.length when set; mismatched UVs are
   * stripped by `normalizePolygons`.
   */
  uvs?: Vec2[];
  /**
   * Renderer-internal source triangles for UV textures. Merge passes use this
   * to reduce DOM planes while preserving per-triangle texture mapping in the
   * generated atlas.
   * @internal
   */
  textureTriangles?: TextureTriangle[];
  /**
   * User-controlled metadata. Reflected to DOM as `data-*` attributes via
   * stringification by the framework wrappers. Only string|number|boolean
   * values are kept; other shapes are dropped by `normalizePolygons`.
   */
  data?: Record<string, string | number | boolean>;
}

// ── Glyphcss-specific (ASCII rendering) ─────────────────────────

/** Rendering mode for `rasterize`. See README for tradeoffs. */
export type RenderMode = "wireframe" | "solid" | "voxel";

/**
 * Character ramp used by `solid` mode to map shaded intensity to a glyph.
 * Index 0 = darkest (transparent / unset), last index = brightest.
 */
export type CharRamp = string[];

/**
 * Wireframe edge weight. Maps to glyph density in the rasterizer:
 *   1 — thin (spokes, inner cage)
 *   2 — normal (main cage edges)
 *   3 — core (focal accents)
 */
export type EdgeWeight = 1 | 2 | 3;

/** A single drawable edge in wireframe mode. */
export interface WireframeEdge {
  from: Vec3;
  to: Vec3;
  weight?: EdgeWeight;
  /** Hex color string (`#rrggbb`) propagated from the adjacent triangle's material. */
  color?: string;
}

/** Grid dimensions in character cells. */
export interface GridSize {
  cols: number;
  rows: number;
  /** Character cell aspect ratio (height / width). Typically ~2.0 for monospace. */
  cellAspect: number;
}

/**
 * A 3D anchor that should produce a 2D hitbox in the consumer's DOM.
 * Consumers absolute-position a `<div>` at the projected cell, sized by
 * `size` (in character cells). Pure-math: this module just projects.
 */
export interface Hotspot {
  id: string;
  at: Vec3;
  /** Hitbox size in cells. Default `[1, 1]`. */
  size?: [number, number];
}

/** Result of projecting a single hotspot through the camera. */
export interface HotspotCell {
  id: string;
  col: number;
  row: number;
  /** Camera-space Z. Useful for `z-index` / occlusion checks. */
  depth: number;
  /** False if behind the camera or off-grid. */
  visible: boolean;
}
