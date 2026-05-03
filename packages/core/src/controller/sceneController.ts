import { createIsometricCamera, normalizeInvertMultiplier } from "../camera/camera";
import type { CameraHandle, CameraState } from "../camera/camera";
import type { ProjectionMode, SceneDimensions, WallsMask, Voxel, GridContext, VoxelGrid, FaceAppearanceOverride } from "../types";
import { buildSceneContext, computeWallMask, wallMasksEqual } from "../scene/context";
import { mergeVoxels as mergeVoxelsGrid } from "../merge/mergeVoxels";
import { normalizeMergeVoxelsOption, is2dMerge, is3dMerge } from "../merge/mergeVoxelsOption";
import type { MergeVoxelsOption } from "../merge/mergeVoxelsOption";

export interface SceneState {
  voxels: VoxelGrid;
  rows?: number;
  cols?: number;
  depth?: number;
  showWalls: boolean;
  showFloor: boolean;
  projection: ProjectionMode;
  mergeVoxels?: MergeVoxelsOption;
  lighting?: (voxel: Voxel, face: string) => FaceAppearanceOverride | undefined;
  resolveTexture?: (name: string, face: string) => string | undefined;
}

export type SceneRenderMode = "cubes" | "slice-renderer";
export interface RendererMetadata { mode: SceneRenderMode; }

type SnapshotListener = (snapshot: ControllerSnapshot) => void;

export interface ControllerSnapshot {
  style: Record<string, string>;
  walls: WallsMask;
  cursor: string;
  camera: CameraState;
  cameraOnly: boolean;
  context: GridContext;
  depthLayers: number;
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

/** Structural type replacing PointerEvent — core has no DOM dependency. */
export interface PointerInput {
  clientX: number;
  clientY: number;
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

  handlePointerDown(event: PointerInput): void;
  handlePointerMove(event: PointerInput): void;
  handlePointerUp(): void;
}

const DEFAULT_POINTER_INVERT = 1;
const POINTER_DRAG_SPEED = 5;
const nowMs = (): number => {
  const perf = (globalThis as { performance?: { now?: () => number } }).performance;
  return typeof perf?.now === "function" ? perf.now() : Date.now();
};
const getSceneProfile = (): Record<string, number | boolean> | null => {
  const root = (globalThis as { __voxcssProfile?: Record<string, unknown> }).__voxcssProfile;
  if (!root || typeof root !== "object") return null;
  const entry = (root as { sceneController?: Record<string, number | boolean> }).sceneController;
  if (entry) return entry;
  const next: Record<string, number | boolean> = {};
  (root as { sceneController?: Record<string, number | boolean> }).sceneController = next;
  return next;
};

export function sceneController(options: SceneControllerOptions = {}): SceneController {
  const snapshotListeners = new Set<SnapshotListener>();

  const camera: CameraHandle = createIsometricCamera(options.camera);
  let pointerInvert = normalizeInvertMultiplier(options.pointerInvert) ?? DEFAULT_POINTER_INVERT;
  let lastSnapshotCameraOnly = false;
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
  let cachedRawVoxelsLength = -1;
  let cachedMergeOption: MergeVoxelsOption = false;
  let cachedMergedVoxels: VoxelGrid | null = null;
  let cachedCubeOnly = true;

  const resolveGrid = (
    state: SceneState
  ): { grid: VoxelGrid; mergeOption: MergeVoxelsOption; rawCount: number; cubeOnly: boolean } => {
    const rawVoxels = state.voxels ?? [];
    const mergeOption = normalizeMergeVoxelsOption(state.mergeVoxels);
    if (
      rawVoxels === cachedRawVoxels &&
      rawVoxels.length === cachedRawVoxelsLength &&
      mergeOption === cachedMergeOption &&
      cachedMergedVoxels
    ) {
      return {
        grid: cachedMergedVoxels,
        mergeOption,
        rawCount: rawVoxels.length,
        cubeOnly: cachedCubeOnly
      };
    }

    const cubeOnly = rawVoxels.every((voxel) => !voxel || (voxel.shape ?? "cube") === "cube");
    let grid: VoxelGrid = rawVoxels;
    if (is2dMerge(mergeOption)) {
      grid = mergeVoxelsGrid(rawVoxels);
    }

    cachedRawVoxels = rawVoxels;
    cachedRawVoxelsLength = rawVoxels.length;
    cachedMergeOption = mergeOption;
    cachedMergedVoxels = grid;
    cachedCubeOnly = cubeOnly;

    return { grid, mergeOption, rawCount: rawVoxels.length, cubeOnly };
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
      rotY: camera.state.rotY,
      lighting: lastState.lighting,
      resolveTexture: lastState.resolveTexture
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
        rotY: camera.state.rotY,
        lighting: state.lighting,
        resolveTexture: state.resolveTexture
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
      camera: { ...camera.state },
      cameraOnly: lastSnapshotCameraOnly,
      context: currentContext,
      depthLayers: currentLayers.length
    };
  }

  function setDimensions(next: SceneDimensions) {
    dimensionOverride = {
      rows: next.rows ?? dimensionOverride?.rows,
      cols: next.cols ?? dimensionOverride?.cols,
      depth: next.depth ?? dimensionOverride?.depth
    };
    rebuildScene(lastState);
    emitSnapshot(false);
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
      emitSnapshot(true);
      return;
    }
    emitSnapshot(true);
  }

  function subscribeSnapshot(listener: SnapshotListener) {
    snapshotListeners.add(listener);
    listener(buildSnapshot());
    return () => snapshotListeners.delete(listener);
  }

  function handlePointerDown(event: PointerInput) {
    isDragging = true;
    pointerX = event.clientX;
    pointerY = event.clientY;
    emitSnapshot(true);
  }

  function handlePointerMove(event: PointerInput) {
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
    emitSnapshot(true);
  }

  function emitSnapshot(cameraOnly: boolean) {
    lastSnapshotCameraOnly = cameraOnly;
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
    emitSnapshot(false);
  }

  function applySceneState(state: SceneState): SceneSnapshot {
    const profile = getSceneProfile();
    const start = profile ? nowMs() : 0;
    const prevState = lastState;
    lastState = state;
    const resolveStart = profile ? nowMs() : 0;
    const resolved = resolveGrid(state);
    if (profile) profile.resolveMs = Math.round(nowMs() - resolveStart);
    const { mergeOption } = resolved;
    const mode: SceneRenderMode = is3dMerge(mergeOption) ? "slice-renderer" : "cubes";
    const needsRebuild =
      prevState.voxels !== state.voxels ||
      prevState.voxels.length !== state.voxels.length ||
      prevState.rows !== state.rows ||
      prevState.cols !== state.cols ||
      prevState.depth !== state.depth ||
      prevState.showWalls !== state.showWalls ||
      prevState.showFloor !== state.showFloor ||
      prevState.projection !== state.projection ||
      prevState.mergeVoxels !== state.mergeVoxels ||
      prevState.lighting !== state.lighting ||
      prevState.resolveTexture !== state.resolveTexture;
    if (profile) profile.needsRebuild = needsRebuild;
    if (needsRebuild) {
      const buildStart = profile ? nowMs() : 0;
      rebuildScene(state);
      if (profile) profile.buildSceneMs = Math.round(nowMs() - buildStart);
    } else if (profile) {
      profile.buildSceneMs = 0;
    }
    emitSnapshot(false);
    if (profile) profile.totalMs = Math.round(nowMs() - start);
    return {
      layers: currentLayers,
      context: currentContext,
      renderer: { mode }
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
