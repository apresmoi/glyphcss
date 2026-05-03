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
   * For shape: "triangle" / "polygon". 3+ vertices in voxel space defining
   * an arbitrary planar face. (x, y, z) and the optional bbox fields hold
   * the bounding box of these vertices for compatibility with cell-based
   * accounting (occupancy maps, IoU scoring).
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
