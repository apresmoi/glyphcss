import type { SceneSnapshot } from "./state";
import type { CubeFace, GridContext, Voxel } from "./types";

export interface RendererMountOptions {
  documentRef: Document;
  target: HTMLElement;
}

export interface RendererHandle {
  applyInitial(snapshot: SceneSnapshot): void;
  applyPatches(snapshot: SceneSnapshot, patches: ScenePatch[]): void;
  destroy(): void;
}

export type RendererFactory = (options: RendererMountOptions) => RendererHandle;

export type ScenePatch =
  | AddVoxelPatch
  | UpdateVoxelPatch
  | RemoveVoxelPatch
  | WallsMetaPatch
  | FloorMetaPatch;

interface VoxelPatchBase {
  voxelKey: string;
  layerIndex: number;
}

export interface AddVoxelPatch extends VoxelPatchBase {
  type: "addVoxel";
  voxel: Voxel;
  faces: CubeFace[];
}

export interface UpdateVoxelPatch extends VoxelPatchBase {
  type: "updateVoxel";
  voxel: Voxel;
  faces?: CubeFace[];
  dirtyProps?: Array<"bounds" | "color" | "texture" | "shape" | "data">;
}

export interface RemoveVoxelPatch extends VoxelPatchBase {
  type: "removeVoxel";
}

export interface WallsMetaPatch {
  type: "wallsMeta";
  showWalls: boolean;
  mask: GridContext["walls"];
}

export interface FloorMetaPatch {
  type: "floorMeta";
  showFloor: boolean;
}
