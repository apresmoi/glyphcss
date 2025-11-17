import type { SceneSnapshot } from "./state";
import type {
  ScenePatch,
  AddVoxelPatch,
  UpdateVoxelPatch,
  RemoveVoxelPatch,
  LayerMetaPatch,
  WallsMetaPatch,
  FloorMetaPatch,
  PointerRegionPatch
} from "./renderer";
import { computeVisibleFaces } from "./visibility";
import { makeVoxelKey, wallMasksEqual } from "./context";
import type { Voxel, PointerEventPayload } from "./types";

export interface SceneDiffResult {
  patches: ScenePatch[];
}

export function diffScenes(previous: SceneSnapshot | null, next: SceneSnapshot): SceneDiffResult {
  const patches: ScenePatch[] = [];
  const prevDepth = previous?.context.depth ?? 0;
  const prevLayers = previous?.layers ?? [];
  const prevLayerCount = Math.max(prevDepth, prevLayers.length);
  const nextLayerCount = Math.max(next.context.depth, next.layers.length);
  const layerCount = Math.max(prevLayerCount, nextLayerCount);
  const wallsChanged =
    !previous ||
    previous.context.showWalls !== next.context.showWalls ||
    !wallMasksEqual(previous.context.walls, next.context.walls);

  for (let layerIndex = 0; layerIndex < layerCount; layerIndex += 1) {
    const nextVoxels = next.layers[layerIndex] ?? [];
    const prevVoxels = prevLayers[layerIndex] ?? [];
    patches.push(...diffLayer(layerIndex, prevVoxels, nextVoxels, next, wallsChanged));
    patches.push(createLayerMetaPatch(layerIndex, next));
  }

  patches.push({
    type: "wallsMeta",
    showWalls: next.context.showWalls,
    mask: next.context.walls
  } satisfies WallsMetaPatch);

  patches.push({
    type: "floorMeta",
    showFloor: next.context.showFloor
  } satisfies FloorMetaPatch);

  return { patches };
}

function diffLayer(
  layerIndex: number,
  previous: Voxel[],
  next: Voxel[],
  snapshot: SceneSnapshot,
  forceFaceUpdate: boolean
): ScenePatch[] {
  const patches: ScenePatch[] = [];
  const nextMap = new Map<string, Voxel>();
  for (const voxel of next) {
    if (!voxel) continue;
    nextMap.set(makeVoxelKey(voxel), voxel);
  }

  const prevMap = new Map<string, Voxel>();
  for (const voxel of previous) {
    if (!voxel) continue;
    prevMap.set(makeVoxelKey(voxel), voxel);
  }

  for (const [key, voxel] of nextMap.entries()) {
    const existing = prevMap.get(key);
    const faces = resolveVisibleFaces(key, voxel, snapshot);
    if (!faces.length) {
      if (existing) {
        patches.push(createRemovePatch(layerIndex, key));
      }
      continue;
    }
    if (!existing) {
      patches.push(createAddPatch(layerIndex, key, voxel, faces));
      patches.push(...createPointerPatches(layerIndex, key, voxel, faces));
      continue;
    }
    const update = createUpdatePatch(layerIndex, key, voxel, existing, faces, forceFaceUpdate);
    if (update) {
      patches.push(update);
      patches.push(...createPointerPatches(layerIndex, key, voxel, faces));
    }
  }

  for (const [key] of prevMap.entries()) {
    if (!nextMap.has(key)) {
      patches.push(createRemovePatch(layerIndex, key));
    }
  }

  return patches;
}

function createAddPatch(layerIndex: number, key: string, voxel: Voxel, faces: ReturnType<typeof computeVisibleFaces>): AddVoxelPatch {
  return {
    type: "addVoxel",
    layerIndex,
    voxelKey: key,
    voxel,
    faces
  };
}

function createUpdatePatch(
  layerIndex: number,
  key: string,
  voxel: Voxel,
  previous: Voxel,
  faces: ReturnType<typeof computeVisibleFaces>,
  forceFaces: boolean
): UpdateVoxelPatch | null {
  const dirtyProps: UpdateVoxelPatch["dirtyProps"] = [];
  if (voxel.color !== previous.color) dirtyProps.push("color");
  if (voxel.texture !== previous.texture) dirtyProps.push("texture");
  if (voxel.shape !== previous.shape) dirtyProps.push("shape");
  if (voxel.data !== previous.data) dirtyProps.push("data");
  const boundsChanged =
    voxel.x !== previous.x ||
    voxel.y !== previous.y ||
    (voxel.x2 ?? voxel.x + 1) !== (previous.x2 ?? previous.x + 1) ||
    (voxel.y2 ?? voxel.y + 1) !== (previous.y2 ?? previous.y + 1);
  if (boundsChanged) dirtyProps.push("bounds");

  if (!dirtyProps.length && !forceFaces) return null;

  return {
    type: "updateVoxel",
    layerIndex,
    voxelKey: key,
    voxel,
    dirtyProps,
    faces
  };
}

function createRemovePatch(layerIndex: number, voxelKey: string): RemoveVoxelPatch {
  return {
    type: "removeVoxel",
    layerIndex,
    voxelKey
  };
}

function createLayerMetaPatch(layerIndex: number, snapshot: SceneSnapshot): LayerMetaPatch {
  return {
    type: "layerMeta",
    layerIndex,
    rows: snapshot.context.rows,
    cols: snapshot.context.cols,
    tileSize: snapshot.context.tileSize,
    elevation: snapshot.context.layerElevation
  };
}

function createPointerPatches(
  layerIndex: number,
  voxelKey: string,
  voxel: Voxel,
  faces: ReturnType<typeof computeVisibleFaces>
): PointerRegionPatch[] {
  return faces.map((face) => {
    const payload: PointerEventPayload = {
      voxelKey,
      voxel,
      face,
      type: "region"
    };
    return {
      type: "pointerRegion",
      layerIndex,
      voxelKey,
      face,
      payload
    };
  });
}

const visibleFacesCache = new WeakMap<SceneSnapshot, Map<string, ReturnType<typeof computeVisibleFaces>>>();

function resolveVisibleFaces(voxelKey: string, voxel: Voxel, snapshot: SceneSnapshot): ReturnType<typeof computeVisibleFaces> {
  let cache = visibleFacesCache.get(snapshot);
  if (!cache) {
    cache = new Map();
    visibleFacesCache.set(snapshot, cache);
  }
  const cached = cache.get(voxelKey);
  if (cached) return cached;
  const faces = computeVisibleFaces(voxel, snapshot.context);
  cache.set(voxelKey, faces);
  return faces;
}
