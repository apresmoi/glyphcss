import { createIsometricCamera, normalizeInvertMultiplier } from "../core/camera";
import type { CameraHandle, CameraState } from "../core/camera";
import type { ProjectionMode, SceneDimensions, WallsMask, Voxel, VoxelGrid, VoxelLookup, GridContext } from "../core/types";
import { computeWallMask, inferGridDimensions } from "../core/context";
import { buildSceneContext } from "../core/context";
import type { SceneState } from "./sceneBindings";

type SnapshotListener = (snapshot: ControllerSnapshot) => void;

export interface ControllerSnapshot {
  style: Record<string, string>;
  walls: WallsMask;
  cursor: string;
  camera: CameraState;
}

export interface SceneSnapshot {
  grid: VoxelGrid;
  layers: Voxel[][];
  lookups: VoxelLookup[];
  context: GridContext;
  dimensions: Required<SceneDimensions>;
}

export interface SceneControllerOptions {
  dimensions?: SceneDimensions;
  camera?: Partial<CameraState>;
  pointerInvert?: number;
  projection?: ProjectionMode;
}

export interface SceneController {
  getDimensions(): Required<SceneDimensions>;
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
  const defaultDimensions = inferGridDimensions([]);
  let dimensions: Required<SceneDimensions> = {
    rows: typeof options.dimensions?.rows === "number" ? options.dimensions.rows : defaultDimensions.rows,
    cols: typeof options.dimensions?.cols === "number" ? options.dimensions.cols : defaultDimensions.cols,
    depth: typeof options.dimensions?.depth === "number" ? options.dimensions.depth : defaultDimensions.depth
  };

  const camera: CameraHandle = createIsometricCamera(options.camera);
  let pointerInvert = normalizeInvertMultiplier(options.pointerInvert) ?? DEFAULT_POINTER_INVERT;
  let projectionMode: ProjectionMode = options.projection === "dimetric" ? "dimetric" : "cubic";
  let isDragging = false;
  let pointerX = 0;
  let pointerY = 0;

  function setDimensions(next: SceneDimensions) {
    const rows = typeof next.rows === "number" ? next.rows : dimensions.rows;
    const cols = typeof next.cols === "number" ? next.cols : dimensions.cols;
    const depth = typeof next.depth === "number" ? next.depth : dimensions.depth;
    if (rows === dimensions.rows && cols === dimensions.cols && depth === dimensions.depth) {
      return;
    }
    dimensions = { rows, cols, depth };
    emitSnapshot();
  }

  function getDimensions() {
    return { ...dimensions };
  }

  function getCameraState() {
    return { ...camera.state };
  }

  function updateCamera(next: Partial<CameraState>) {
    camera.update(next);
    emitSnapshot();
  }

  function subscribeSnapshot(listener: SnapshotListener) {
    snapshotListeners.add(listener);
    listener({
      style: camera.getStyle({
        rows: dimensions.rows,
        cols: dimensions.cols,
        depth: dimensions.depth,
        dimetric: projectionMode === "dimetric"
      }),
      walls: computeWallMask(camera.state.rotX, camera.state.rotY),
      cursor: isDragging ? "grabbing" : "grab",
      camera: { ...camera.state }
    });
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
    camera.update({ rotX: nextRotX, rotY: nextRotY });
    pointerX = event.clientX;
    pointerY = event.clientY;
    emitSnapshot();
  }

  function handlePointerUp() {
    if (!isDragging) return;
    isDragging = false;
    emitSnapshot();
  }

  function emitSnapshot() {
    const snap: ControllerSnapshot = {
      style: camera.getStyle({
        rows: dimensions.rows,
        cols: dimensions.cols,
        depth: dimensions.depth,
        dimetric: projectionMode === "dimetric"
      }),
      walls: computeWallMask(camera.state.rotX, camera.state.rotY),
      cursor: isDragging ? "grabbing" : "grab",
      camera: { ...camera.state }
    };
    snapshotListeners.forEach((listener) => listener(snap));
  }

  function setPointerInvert(multiplier: number) {
    pointerInvert = normalizeInvertMultiplier(multiplier) ?? DEFAULT_POINTER_INVERT;
  }

  function setProjection(mode?: ProjectionMode) {
    const normalized: ProjectionMode = mode === "dimetric" ? "dimetric" : "cubic";
    if (projectionMode !== normalized) {
      projectionMode = normalized;
      emitSnapshot();
    }
  }

  function applySceneState(state: SceneState): SceneSnapshot {
    setProjection(state.projection);
    const cameraState = camera.state;
    const baseContext = {
      rows: state.rows,
      cols: state.cols,
      depth: state.depth,
      showWalls: state.showWalls,
      showFloor: state.showFloor,
      projection: state.projection,
      walls: computeWallMask(camera.state.rotX, camera.state.rotY),
      rotX: cameraState.rotX,
      rotY: cameraState.rotY
    };
    const scene = buildSceneContext({
      grid: state.voxels,
      context: baseContext,
      dimensions
    });
    setDimensions(scene.dimensions);
    return {
      grid: state.voxels,
      layers: scene.lookupData.layers,
      lookups: scene.lookupData.lookups,
      context: scene.context,
      dimensions: scene.dimensions
    };
  }

  return {
    getDimensions,
    setDimensions,
    getCameraState,
    updateCamera,
    getBoxStyle: () =>
      camera.getStyle({
        rows: dimensions.rows,
        cols: dimensions.cols,
        depth: dimensions.depth,
        dimetric: projectionMode === "dimetric"
      }),
    subscribeSnapshot,
    getWalls: () => computeWallMask(camera.state.rotX, camera.state.rotY),
    getCursor: () => (isDragging ? "grabbing" : "grab"),
    setPointerInvert,
    setProjection,
    applySceneState,
    handlePointerDown,
    handlePointerMove,
    handlePointerUp
  };
}
