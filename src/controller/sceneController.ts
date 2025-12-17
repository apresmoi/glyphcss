import { createIsometricCamera, normalizeInvertMultiplier } from "../core/camera";
import type { CameraHandle, CameraState } from "../core/camera";
import type { ProjectionMode, SceneDimensions, WallsMask, Voxel, GridContext } from "../core/types";
import { buildSceneContext, computeWallMask, wallMasksEqual } from "../core/context";
import type { SceneState } from "./sceneBindings";
import { mergeVoxels as mergeVoxelsGrid } from "../utils/mergeVoxels";
import { normalizeMergeVoxelsOption, is2dMerge, is3dMerge, is3dMask } from "../utils/mergeVoxelsOption";
import type { MergeVoxelsOption } from "../utils/mergeVoxelsOption";
import type { VoxelGrid } from "../core/types";
import type { RendererMetadata, SceneRenderMode } from "../core/domRenderer";

type SnapshotListener = (snapshot: ControllerSnapshot) => void;

export interface ControllerSnapshot {
  style: Record<string, string>;
  walls: WallsMask;
  cursor: string;
  camera: CameraState;
}

export interface SceneSnapshot {
  layers: Voxel[][];
  context: GridContext;
  renderer?: RendererMetadata;
}

export interface SceneControllerOptions {
  dimensions?: SceneDimensions;
  camera?: Partial<CameraState>;
  pointerInvert?: number;
  projection?: ProjectionMode;
}

export interface SceneController {
  getDimensions(): Required<SceneDimensions>;
  getProjection(): ProjectionMode;
  setDimensions(next: SceneDimensions): void;

  getCameraState(): CameraState;
  updateCamera(next: Partial<CameraState>): void;

  getBoxStyle(): Record<string, string>;
  getWalls(): WallsMask;
  getCursor(): string;
  subscribeSnapshot(listener: SnapshotListener): () => void;
  setPointerInvert(multiplier: number): void;
  setProjection(mode?: ProjectionMode): void;
  applySceneState(state: SceneState): SceneSnapshot;

  handlePointerDown(event: PointerEvent): void;
  handlePointerMove(event: PointerEvent): void;
  handlePointerUp(): void;
}

const DEFAULT_POINTER_INVERT = 1;
const POINTER_DRAG_SPEED = 5;

export function sceneController(options: SceneControllerOptions = {}): SceneController {
  const snapshotListeners = new Set<SnapshotListener>();

  const camera: CameraHandle = createIsometricCamera(options.camera);
  let pointerInvert = normalizeInvertMultiplier(options.pointerInvert) ?? DEFAULT_POINTER_INVERT;
  let isDragging = false;
  let pointerX = 0;
  let pointerY = 0;
  let dimensionOverride: SceneDimensions | undefined = options.dimensions;
  let lastState: SceneState = {
    voxels: [],
    rows: dimensionOverride?.rows,
    cols: dimensionOverride?.cols,
    depth: dimensionOverride?.depth,
    showWalls: false,
    showFloor: false,
    projection: options.projection === "dimetric" ? "dimetric" : "cubic",
    mergeVoxels: false
  };

  let cachedRawVoxels: VoxelGrid | null = null;
  let cachedMergeOption: MergeVoxelsOption = false;
  let cachedMergedVoxels: VoxelGrid | null = null;
  let cachedCubeOnly = true;
  let cachedHasZ2 = false;

  const resolveGrid = (
    state: SceneState
  ): { grid: VoxelGrid; mergeOption: MergeVoxelsOption; rawCount: number; cubeOnly: boolean; hasZ2: boolean } => {
    const rawVoxels = state.voxels ?? [];
    const mergeOption = normalizeMergeVoxelsOption(state.mergeVoxels);
    if (rawVoxels === cachedRawVoxels && mergeOption === cachedMergeOption && cachedMergedVoxels) {
      return {
        grid: cachedMergedVoxels,
        mergeOption,
        rawCount: rawVoxels.length,
        cubeOnly: cachedCubeOnly,
        hasZ2: cachedHasZ2
      };
    }

    const cubeOnly = rawVoxels.every((voxel) => !voxel || (voxel.shape ?? "cube") === "cube");
    const hasZ2 = rawVoxels.some((voxel) => voxel && typeof voxel.z2 === "number" && Number.isFinite(voxel.z2));
    const shouldPreMerge = is2dMerge(mergeOption) && !hasZ2;
    const grid = shouldPreMerge ? mergeVoxelsGrid(rawVoxels) : rawVoxels;

    cachedRawVoxels = rawVoxels;
    cachedMergeOption = mergeOption;
    cachedMergedVoxels = grid;
    cachedCubeOnly = cubeOnly;
    cachedHasZ2 = hasZ2;

    return { grid, mergeOption, rawCount: rawVoxels.length, cubeOnly, hasZ2 };
  };

  const initialScene = buildSceneContext({
    grid: resolveGrid(lastState).grid,
    context: {
      rows: lastState.rows,
      cols: lastState.cols,
      depth: lastState.depth,
      showWalls: lastState.showWalls,
      showFloor: lastState.showFloor,
      projection: lastState.projection,
      rotX: camera.state.rotX,
      rotY: camera.state.rotY
    },
    dimensions: dimensionOverride
  });
  let currentContext: GridContext = initialScene.context;
  let currentLayers: Voxel[][] = initialScene.layers;

  function rebuildScene(state: SceneState) {
    const { grid } = resolveGrid(state);
    const scene = buildSceneContext({
      grid,
      context: {
        rows: state.rows,
        cols: state.cols,
        depth: state.depth,
        showWalls: state.showWalls,
        showFloor: state.showFloor,
        projection: state.projection,
        rotX: camera.state.rotX,
        rotY: camera.state.rotY
      },
      dimensions: dimensionOverride
    });
    currentContext = scene.context;
    currentLayers = scene.layers;
    return scene;
  }

  function buildSnapshot(): ControllerSnapshot {
    return {
      style: camera.getStyle({
        rows: currentContext.rows,
        cols: currentContext.cols,
        depth: currentContext.depth,
        dimetric: currentContext.projection === "dimetric"
      }),
      walls: currentContext.walls,
      cursor: isDragging ? "grabbing" : "grab",
      camera: { ...camera.state }
    };
  }

  function setDimensions(next: SceneDimensions) {
    dimensionOverride = {
      rows: next.rows ?? dimensionOverride?.rows,
      cols: next.cols ?? dimensionOverride?.cols,
      depth: next.depth ?? dimensionOverride?.depth
    };
    rebuildScene(lastState);
    emitSnapshot();
  }

  function getDimensions() {
    return {
      rows: currentContext.rows,
      cols: currentContext.cols,
      depth: currentContext.depth
    };
  }

  function getProjection() {
    return lastState.projection;
  }

  function getCameraState() {
    return { ...camera.state };
  }

  function updateCamera(next: Partial<CameraState>) {
    const hadRotationUpdate = next.rotX !== undefined || next.rotY !== undefined;
    camera.update(next);
    if (hadRotationUpdate) {
      // Only rotation changes: avoid rebuilding the entire scene; update wall mask if needed.
      const nextMask = computeWallMask(camera.state.rotX, camera.state.rotY);
      if (!wallMasksEqual(currentContext.walls, nextMask)) {
        currentContext = { ...currentContext, walls: nextMask, rotX: camera.state.rotX, rotY: camera.state.rotY };
      } else if (currentContext.rotX !== camera.state.rotX || currentContext.rotY !== camera.state.rotY) {
        currentContext = { ...currentContext, rotX: camera.state.rotX, rotY: camera.state.rotY };
      }
      emitSnapshot();
      return;
    }
    emitSnapshot();
  }

  function subscribeSnapshot(listener: SnapshotListener) {
    snapshotListeners.add(listener);
    listener(buildSnapshot());
    return () => snapshotListeners.delete(listener);
  }

  function handlePointerDown(event: PointerEvent) {
    isDragging = true;
    pointerX = event.clientX;
    pointerY = event.clientY;
    emitSnapshot();
  }

  function handlePointerMove(event: PointerEvent) {
    if (!isDragging) return;
    const invert = pointerInvert || DEFAULT_POINTER_INVERT;
    const dX = ((event.clientX - pointerX) * invert) / POINTER_DRAG_SPEED;
    const dY = ((event.clientY - pointerY) * invert) / POINTER_DRAG_SPEED;
    const nextRotY = (camera.state.rotY - dX + 360) % 360;
    const nextRotX = Math.max(0, Math.min(100, camera.state.rotX - dY));
    // Rotation-only updates should not rebuild the scene; rely on camera update + wall mask refresh.
    updateCamera({ rotX: nextRotX, rotY: nextRotY });
    pointerX = event.clientX;
    pointerY = event.clientY;
  }

  function handlePointerUp() {
    if (!isDragging) return;
    isDragging = false;
    emitSnapshot();
  }

  function emitSnapshot() {
    const snap = buildSnapshot();
    snapshotListeners.forEach((listener) => listener(snap));
  }

  function getWalls() {
    return buildSnapshot().walls;
  }

  function getCursor() {
    return buildSnapshot().cursor;
  }

  function setPointerInvert(multiplier: number) {
    pointerInvert = normalizeInvertMultiplier(multiplier) ?? DEFAULT_POINTER_INVERT;
  }

  function setProjection(mode?: ProjectionMode) {
    const normalized: ProjectionMode = mode === "dimetric" ? "dimetric" : "cubic";
    if (lastState.projection === normalized) return;
    lastState = { ...lastState, projection: normalized };
    rebuildScene(lastState);
    emitSnapshot();
  }

  function applySceneState(state: SceneState): SceneSnapshot {
    const prevState = lastState;
    lastState = state;
    const { mergeOption, rawCount, cubeOnly, hasZ2 } = resolveGrid(state);
    const wants3d = is3dMerge(mergeOption) || is3dMask(mergeOption) || hasZ2;
    const planeShellEligible = wants3d && cubeOnly;
    const mode: SceneRenderMode = planeShellEligible
      ? is3dMask(mergeOption)
        ? "plane-shell-mask"
        : "plane-shell"
      : "cubes";
    const shouldPreMerge = is2dMerge(mergeOption) && !hasZ2;
    const mergeApplies = shouldPreMerge || planeShellEligible;
    const needsRebuild =
      prevState.voxels !== state.voxels ||
      prevState.rows !== state.rows ||
      prevState.cols !== state.cols ||
      prevState.depth !== state.depth ||
      prevState.showWalls !== state.showWalls ||
      prevState.showFloor !== state.showFloor ||
      prevState.projection !== state.projection ||
      prevState.mergeVoxels !== state.mergeVoxels;
    if (needsRebuild) {
      rebuildScene(state);
    }
    emitSnapshot();
    return {
      layers: currentLayers,
      context: currentContext,
      renderer: {
        mode,
        mergeApplies,
        rawVoxelCount: rawCount,
        cubeOnly,
        planeShellEligible
      }
    };
  }

  return {
    getDimensions,
    getProjection,
    setDimensions,
    getCameraState,
    updateCamera,
    getBoxStyle: () => buildSnapshot().style,
    subscribeSnapshot,
    getWalls,
    getCursor,
    setPointerInvert,
    setProjection,
    applySceneState,
    handlePointerDown,
    handlePointerMove,
    handlePointerUp
  };
}
