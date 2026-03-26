/* Core type and constant definitions shared across voxcss runtime modules. */
export type ProjectionMode = "cubic" | "dimetric";
export const DEFAULT_PROJECTION: ProjectionMode = "cubic";

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
