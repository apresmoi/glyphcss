/* Core type and constant definitions shared across polycss runtime modules. */
export const DEFAULT_PROJECTION = "cubic" as const;

/**
 * How textured polygon lighting is applied by DOM renderers.
 * - "baked": multiply the light tint into the off-DOM canvas before the
 *   polygon becomes an atlas sprite.
 * - "filter": leave the texture pixels unbaked and apply a CSS brightness()
 *   filter to the atlas sprite.
 */
export type TextureLightingMode = "baked" | "filter";

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

/**
 * Directional light setup used by the polygon renderer for polygon Lambert
 * shading. Direction is in scene-local CSS-pixel coords. Vector doesn't
 * need to be pre-normalized. Color is multiplied into the surface color
 * for the directional contribution; ambient (RGB) provides the floor for
 * faces pointing away from the light.
 */
export interface DirectionalLight {
  /** Direction the light shines TOWARD (typical convention). */
  direction: Vec3;
  /** Light tint, hex string. White by default. */
  color?: string;
  /** Ambient light tint, hex string. Pre-multiplied by `ambient` strength. */
  ambientColor?: string;
  /** Ambient strength 0..1 — floor brightness for back-of-light faces. */
  ambient?: number;
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
   * Per-vertex UV coords (0..1, OBJ convention with v=0 at bottom).
   * Length MUST equal vertices.length when set; mismatched UVs are
   * stripped by `normalizePolygons`.
   */
  uvs?: Vec2[];
  /**
   * User-controlled metadata. Reflected to DOM as `data-*` attributes via
   * stringification by the framework wrappers. Only string|number|boolean
   * values are kept; other shapes are dropped by `normalizePolygons`.
   */
  data?: Record<string, string | number | boolean>;
}
