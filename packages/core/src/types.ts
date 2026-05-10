/* Core type and constant definitions shared across polycss runtime modules. */
export const DEFAULT_PROJECTION = "cubic" as const;

/**
 * How polygon lighting is applied by DOM renderers.
 * - "baked": multiply the light tint into the off-DOM canvas before the
 *   polygon becomes an atlas sprite. Best fidelity (full RGB tint) but
 *   the atlas re-rasterizes whenever the light changes.
 * - "dynamic": lighting computed entirely in CSS via per-polygon normals
 *   embedded in calc() and scene-root light vars (background-color +
 *   background-blend-mode multiply, masked by the atlas alpha). Atlas
 *   stays light-independent — sliding the light only writes a few CSS
 *   variables, no JS work, no atlas re-rasterization.
 */
export type PolyTextureLightingMode = "baked" | "dynamic";

/**
 * 3D point/vector, stored as a `[x, y, z]` tuple. Tuple (rather than
 * `{x, y, z}`) for compact JSON: meshes serialize to thousands of vertices
 * and the difference adds up. Destructure with `const [x, y, z] = v` when
 * you need named axes.
 *
 * Polycss world space convention: +X right, +Y forward, +Z up.
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
}

/**
 * Directional light — simulates a single distant source (sun, key light).
 * Contributes Lambert shading scaled by `intensity`. `direction` is in
 * scene-local CSS-pixel coords and does not need to be pre-normalized.
 * Mirrors three.js's `DirectionalLight`.
 */
export interface PolyDirectionalLight {
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
export interface PolyAmbientLight {
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
 * axis-aligned rectangle, polycss renders the polygon as an <i> with
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
  /** Optional unique key (used by polycss to dedupe / cache). Caller can
   *  pass a stable string; if omitted, the material's identity is its object
   *  reference. */
  key?: string;
}

/**
 * The single polygon type for polycss. N coplanar vertices in 3D space,
 * CCW winding from outside. No bbox field, no shape discriminator, no
 * input/output distinction — one type, used by parsers, by the merge
 * pass, and by the renderer.
 *
 * See §Design.3 in POLYCSS_MIGRATION.md for the rationale.
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
   * rectangle, polycss uses the direct CSS background-image path (no per-
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
