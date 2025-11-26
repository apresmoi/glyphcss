import { createIsometricCamera, normalizeInvertMultiplier } from "../core/camera";
import type { CameraHandle, CameraState } from "../core/camera";
import type { ProjectionMode, SceneDimensions, WallsMask, Voxel, GridContext } from "../core/types";
import { buildSceneContext, computeWallMask, wallMasksEqual } from "../core/context";
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
    projection: options.projection === "dimetric" ? "dimetric" : "cubic"
  };

  const initialScene = buildSceneContext({
    grid: lastState.voxels,
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
    const scene = buildSceneContext({
      grid: state.voxels,
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
      if (lastState.showWalls) {
        const nextMask = computeWallMask(camera.state.rotX, camera.state.rotY);
        if (!wallMasksEqual(currentContext.walls, nextMask)) {
          currentContext = { ...currentContext, walls: nextMask };
        }
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
    lastState = state;
    const scene = rebuildScene(state);
    emitSnapshot();
    return {
      layers: currentLayers,
      context: currentContext
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
