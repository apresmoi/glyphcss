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
  layers: Voxel[][];
  context: GridContext;
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
  let cachedSnapshot: ControllerSnapshot | null = null;

  function buildSnapshot(): ControllerSnapshot {
    cachedSnapshot = {
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
    return cachedSnapshot;
  }

  function setDimensions(next: SceneDimensions) {
    const rows = typeof next.rows === "number" ? next.rows : dimensions.rows;
    const cols = typeof next.cols === "number" ? next.cols : dimensions.cols;
    const depth = typeof next.depth === "number" ? next.depth : dimensions.depth;
    if (rows === dimensions.rows && cols === dimensions.cols && depth === dimensions.depth) {
      return;
    }
    dimensions = { rows, cols, depth };
    cachedSnapshot = null;
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
    cachedSnapshot = null;
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
    cachedSnapshot = null;
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
    cachedSnapshot = null;
    emitSnapshot();
  }

  function handlePointerUp() {
    if (!isDragging) return;
    isDragging = false;
    cachedSnapshot = null;
    emitSnapshot();
  }

  function emitSnapshot() {
    const snap = cachedSnapshot ?? buildSnapshot();
    snapshotListeners.forEach((listener) => listener(snap));
  }

  function getWalls() {
    return (cachedSnapshot ?? buildSnapshot()).walls;
  }

  function getCursor() {
    return (cachedSnapshot ?? buildSnapshot()).cursor;
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
    const snapshot = cachedSnapshot ?? buildSnapshot();
    const scene = buildSceneContext({
      grid: state.voxels,
      context: {
        rows: state.rows,
        cols: state.cols,
        depth: state.depth,
        showWalls: state.showWalls,
        showFloor: state.showFloor,
        projection: state.projection,
        walls: snapshot.walls,
        rotX: snapshot.camera.rotX,
        rotY: snapshot.camera.rotY
      },
      dimensions
    });
    setDimensions(scene.dimensions);
    cachedSnapshot = null;
    return {
      layers: scene.lookupData.layers,
      context: scene.context
    };
  }

  return {
    getDimensions,
    setDimensions,
    getCameraState,
    updateCamera,
    getBoxStyle: () => (cachedSnapshot ?? buildSnapshot()).style,
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
