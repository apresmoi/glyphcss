import type { CubeFace, GridContext, ProjectionMode, Voxel, VoxelGrid, WallsMask } from "@layoutit/voxcss-core";

export type ShapeRenderer = (args: {
  voxel: Voxel;
  context: GridContext;
  root: HTMLElement;
  precomputedFaces?: CubeFace[];
}) => void | HTMLElement | DocumentFragment;

export interface SceneOptions {
  rows?: number;
  cols?: number;
  depth?: number;
  showWalls?: boolean;
  showFloor?: boolean;
  projection?: ProjectionMode;
  context?: Partial<GridContext>;
  document?: Document;
}

export type CreateVoxcssOptions = SceneOptions;

export interface VoxcssInstance {
  mount(target: HTMLElement, grid: VoxelGrid, context?: Partial<GridContext>): void;
  update(grid: VoxelGrid, context?: Partial<GridContext>): void;
  destroy(): void;
}

export interface VoxIllustrationOptions extends SceneOptions {
  element: string | HTMLElement;
  voxels: VoxelGrid;
}

export interface VoxIllustrationHandle {
  update(grid?: VoxelGrid, context?: Partial<GridContext>): void;
  destroy(): void;
  scene: VoxcssInstance;
}

export interface LayerRecord {
  element: HTMLElement;
  children?: HTMLElement[];
  lastVoxels?: Voxel[] | null;
}

export interface RenderState {
  root: HTMLElement;
  floor: HTMLElement;
  layers: Map<number, LayerRecord>;
  wallElements: Map<keyof WallsMask, HTMLElement>;
  ceiling: HTMLElement | null;
}
