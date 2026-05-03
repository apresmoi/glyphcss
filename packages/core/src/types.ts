/* Core type and constant definitions shared across voxcss runtime modules. */
export type ProjectionMode = "cubic" | "dimetric";
export const DEFAULT_PROJECTION: ProjectionMode = "cubic";

/**
 * 3D point/vector in voxel space, stored as a `[x, y, z]` tuple. Tuple
 * (rather than `{x, y, z}`) for compact JSON: triangle meshes serialize to
 * thousands of vertices and the difference adds up. Destructure with
 * `const [x, y, z] = v` when you need named axes.
 */
export type Vec3 = [number, number, number];

/**
 * Directional light setup used by the triangle / polygon renderer for
 * per-face Lambert shading. Direction is in scene-local CSS-pixel coords:
 * +X right, +Y down (CSS convention), +Z toward viewer. Vector doesn't
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
 * Strict, post-normalization voxel — internal type used everywhere by
 * voxcss after ingress. `x/y/z` are always present. The renderers, scene
 * builders, occlusion checks, etc. all assume this shape.
 */
export interface Voxel {
  x: number;
  y: number;
  z: number;
  x2?: number;
  y2?: number;
  z2?: number;
  color?: string;
  texture?: string;
  shape?: string;
  data?: Record<string, unknown>;
  rot?: number;
  /**
   * For shape: "triangle" / "polygon". 3+ coplanar vertices in voxel space
   * defining the face. The renderer treats triangle as the strict 3-vertex
   * case and polygon as any N >= 3; both route to the same SVG renderer.
   */
  vertices?: Vec3[];
  /**
   * For shape: "triangle". SVG path string defining the triangle within the
   * slope's 480×480 viewBox. Default is spike's primary slope shape:
   * "M480 0 L480 480 L0 480 Z" (right triangle in lower-right).
   * Examples:
   *   "M0 0 L480 0 L0 480 Z"     — right triangle in upper-left
   *   "M240 0 L480 480 L0 480 Z" — isoceles triangle pointing up
   *   "M120 0 L480 240 L0 480 Z" — scalene triangle
   */
  path?: string;
}

export type VoxelGrid = Voxel[];

/**
 * Public-facing voxel input — the shape users actually pass to voxcss.
 * Loosens `x/y/z` so triangle/polygon callers can ship just `vertices`
 * and color: voxcss derives the bbox from the vertices at ingress and
 * upgrades to the strict internal `Voxel` type (with x/y/z populated).
 *
 * For cube/ramp/wedge/spike voxels, x/y/z still need to be passed —
 * they ARE the geometry origin. Omitting them defaults to (0,0,0).
 */
export interface InputVoxel extends Omit<Voxel, "x" | "y" | "z"> {
  x?: number;
  y?: number;
  z?: number;
}

export type InputVoxelGrid = InputVoxel[];

export const BASE_TILE = 50;

export interface SceneDimensions {
  rows?: number;
  cols?: number;
  depth?: number;
}

export interface WallsMask {
  t: boolean;
  b: boolean;
  bl: boolean;
  br: boolean;
  fl: boolean;
  fr: boolean;
}

export type OffsetMap = Record<string, [number, number, number]>;

export interface FaceAppearanceOverride {
  backgroundImage?: string | null;
  backgroundColor?: string | null;
  filter?: string | null;
}

export interface GridContext {
  rows: number;
  cols: number;
  depth: number;
  tileSize: number;
  layerElevation: number;
  projection?: ProjectionMode;
  walls: WallsMask;
  offsets: OffsetMap;
  showWalls: boolean;
  showFloor: boolean;
  rotX?: number;
  rotY?: number;
  renderVersion?: number;
  wallColor: string;
  getVoxel(x: number, y: number, z: number): Voxel | null;
  resolveTexture?(name: string, face: string): string | undefined;
  lighting?(voxel: Voxel, face: string): FaceAppearanceOverride | undefined;
  // Debug: when true, renderers should also emit faces that would normally be
  // occlusion-culled, marked with `voxcss-debug-occluded` so CSS can outline
  // them. Lets you visually identify where the visibility logic is hiding faces
  // (e.g. cells behind a partial-coverage shape like a spike).
  debugShowOccluded?: boolean;
  // Debug: when true, every cube/shape DOM element gets a `data-debug` string
  // like "cube (x,y,z)→(x2,y2,z2)" so a specific voxel can be identified by
  // copy/pasting the attribute. Independent of `debugShowOccluded` — you can
  // have labels without the red overlays.
  debugShowLabels?: boolean;
  // Debug: when true, triangle voxels render their back face too, tinted in
  // a debug color, so you can see what `backface-visibility: hidden` would
  // normally cull. Doubles per-triangle DOM cost — use sparingly.
  debugShowBackfaces?: boolean;
  /**
   * Optional directional-light setup used by the triangle/polygon renderer
   * for Lambert shading. Direction is in scene-local CSS-pixel coords:
   * +X right, +Y down (CSS), +Z toward viewer. Vector is normalized
   * internally; pass any non-zero direction.
   */
  directionalLight?: DirectionalLight;
  // Pre-computed camera-direction occlusion map. Lookup by voxel key
  // ("x:y:z") returns a space-separated string of direction-bin indices where
  // the voxel is hidden by a closer voxel. Renderers emit this as
  // `data-occluded-dirs` so CSS can hide voxels via the current-direction
  // class on the scene root.
  occlusionMap?: Map<string, string>;
}


export const DEFAULT_OFFSETS: OffsetMap = {
  t: [0, 0, 1],
  b: [0, 0, -1],
  fr: [0, 1, 0],
  fl: [1, 0, 0],
  bl: [0, -1, 0],
  br: [-1, 0, 0],
  f: [0, 0, 0]
};

export const DEFAULT_WALLS: WallsMask = {
  t: false,
  b: true,
  bl: true,
  br: true,
  fl: false,
  fr: false
};

export const DEFAULT_WALL_COLOR = "#3e3e4d";

export const LAYER_CLASS = "voxcss-layer";
export const FLOOR_CLASS = "voxcss-floor-z";
export const CUBE_CLASS = "voxcss-cube";
export const FACE_CLASS = "voxcss-cube-face";
export const CUBE_FACES = ["t", "b", "bl", "br", "fr", "fl"] as const;
export type CubeFace = (typeof CUBE_FACES)[number];
export const WALL_CLASS = "voxcss-wall";
export const CEILING_CLASS = "voxcss-ceiling";
export const STYLE_ID = "voxcss-base-styles";
export const SCENE_CLASS = "voxcss-camera";

export interface WallDimensionsSnapshot {
  rows: number;
  cols: number;
  depth: number;
  tileSize: number;
}
