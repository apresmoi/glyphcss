import { createIsometricCamera, normalizeInvertMultiplier } from "../core/camera";
import type { CameraHandle, CameraState } from "../core/camera";
import type { ProjectionMode, SceneDimensions, WallsMask } from "../core";
import { computeWallMask, inferGridDimensions, wallMasksEqual } from "../core";
import { buildSceneContext } from "../core/context";
import type { SceneSnapshot } from "../core/state";
import type { SceneStateShape } from "./sceneBindings";

type DimensionsListener = (dimensions: Required<SceneDimensions>) => void;
type CameraListener = (state: CameraState) => void;
type StyleListener = (style: Record<string, string>) => void;
type WallsListener = (walls: WallsMask) => void;
type CursorListener = (cursor: string) => void;

export interface SceneControllerOptions {
  dimensions?: SceneDimensions;
  camera?: Partial<CameraState>;
  pointerInvert?: number;
  projection?: ProjectionMode;
}

export interface SceneController {
  getDimensions(): Required<SceneDimensions>;
  setDimensions(next: SceneDimensions): void;
  subscribeDimensions(listener: DimensionsListener): () => void;

  getCameraState(): CameraState;
  updateCamera(next: Partial<CameraState>): void;
  subscribeCamera(listener: CameraListener): () => void;

  getBoxStyle(): Record<string, string>;
  subscribeBoxStyle(listener: StyleListener): () => void;
  getWalls(): WallsMask;
  subscribeWalls(listener: WallsListener): () => void;
  getCursor(): string;
  subscribeCursor(listener: CursorListener): () => void;
  setPointerInvert(multiplier: number): void;
  setProjection(mode?: ProjectionMode): void;
  applySceneState(state: SceneStateShape): SceneSnapshot;

  handlePointerDown(event: PointerEvent): void;
  handlePointerMove(event: PointerEvent): void;
  handlePointerUp(): void;
}

const DEFAULT_POINTER_INVERT = 1;
const POINTER_DRAG_SPEED = 5;

export function sceneController(options: SceneControllerOptions = {}): SceneController {
  const dimensionListeners = new Set<DimensionsListener>();
  const cameraListeners = new Set<CameraListener>();
  const styleListeners = new Set<StyleListener>();
  const wallListeners = new Set<WallsListener>();
  const cursorListeners = new Set<CursorListener>();
  function notify<T>(listeners: Set<(payload: T) => void>, payload: T) {
    listeners.forEach((listener) => listener(payload));
  }
  const defaultDimensions = inferGridDimensions([]);
  let dimensions: Required<SceneDimensions> = {
    rows: typeof options.dimensions?.rows === "number" ? options.dimensions.rows : defaultDimensions.rows,
    cols: typeof options.dimensions?.cols === "number" ? options.dimensions.cols : defaultDimensions.cols,
    depth: typeof options.dimensions?.depth === "number" ? options.dimensions.depth : defaultDimensions.depth
  };

  const camera: CameraHandle = createIsometricCamera(options.camera);
  let pointerInvert = normalizeInvertMultiplier(options.pointerInvert) ?? DEFAULT_POINTER_INVERT;
  let projectionMode: ProjectionMode = options.projection === "dimetric" ? "dimetric" : "cubic";

  let lastWalls: WallsMask | null = null;

  const dragState = {
    isDragging: false,
    pointerX: 0,
    pointerY: 0
  };

  function setDimensions(next: SceneDimensions) {
    const rows = typeof next.rows === "number" ? next.rows : dimensions.rows;
    const cols = typeof next.cols === "number" ? next.cols : dimensions.cols;
    const depth = typeof next.depth === "number" ? next.depth : dimensions.depth;
    if (rows === dimensions.rows && cols === dimensions.cols && depth === dimensions.depth) {
      return;
    }
    dimensions = { rows, cols, depth };
    notify(dimensionListeners, { ...dimensions });
    emitStyle();
  }

  function subscribeDimensions(listener: DimensionsListener) {
    dimensionListeners.add(listener);
    listener(getDimensions());
    return () => dimensionListeners.delete(listener);
  }

  function getDimensions() {
    return { ...dimensions };
  }

  function getCameraState() {
    return { ...camera.state };
  }

  function updateCamera(next: Partial<CameraState>) {
    camera.update(next);
    notify(cameraListeners, { ...camera.state });
    emitStyle();
    emitWalls();
    emitCursor();
  }

  function subscribeCamera(listener: CameraListener) {
    cameraListeners.add(listener);
    listener(getCameraState());
    return () => cameraListeners.delete(listener);
  }

  function subscribeBoxStyle(listener: StyleListener) {
    styleListeners.add(listener);
    listener(getBoxStyle());
    return () => styleListeners.delete(listener);
  }

  function subscribeWalls(listener: WallsListener) {
    const snapshot = getWalls();
    lastWalls = snapshot;
    wallListeners.add(listener);
    listener(snapshot);
    return () => wallListeners.delete(listener);
  }

  function subscribeCursor(listener: CursorListener) {
    cursorListeners.add(listener);
    listener(getCursor());
    return () => cursorListeners.delete(listener);
  }

  function handlePointerDown(event: PointerEvent) {
    dragState.isDragging = true;
    dragState.pointerX = event.clientX;
    dragState.pointerY = event.clientY;
    emitCursor();
  }

  function handlePointerMove(event: PointerEvent) {
    if (!dragState.isDragging) return;
    const invert = pointerInvert || DEFAULT_POINTER_INVERT;
    const dX = ((event.clientX - dragState.pointerX) * invert) / POINTER_DRAG_SPEED;
    const dY = ((event.clientY - dragState.pointerY) * invert) / POINTER_DRAG_SPEED;
    const nextRotY = (camera.state.rotY - dX + 360) % 360;
    const nextRotX = Math.max(0, Math.min(100, camera.state.rotX - dY));
    camera.update({ rotX: nextRotX, rotY: nextRotY });
    dragState.pointerX = event.clientX;
    dragState.pointerY = event.clientY;
    notify(cameraListeners, { ...camera.state });
    emitStyle();
    emitWalls();
    emitCursor();
  }

  function handlePointerUp() {
    if (!dragState.isDragging) return;
    dragState.isDragging = false;
    emitCursor();
  }

  function getBoxStyle() {
    return camera.getStyle({
      rows: dimensions.rows,
      cols: dimensions.cols,
      depth: dimensions.depth,
      dimetric: projectionMode === "dimetric"
    });
  }

  function getWalls(): WallsMask {
    return computeWallMask(camera.state.rotX, camera.state.rotY);
  }

  function getCursor() {
    return dragState.isDragging ? "grabbing" : "grab";
  }

  function emitStyle() {
    notify(styleListeners, getBoxStyle());
  }

  function emitWalls() {
    const snapshot = getWalls();
    if (lastWalls && wallMasksEqual(lastWalls, snapshot)) {
      return;
    }
    lastWalls = snapshot;
    notify(wallListeners, snapshot);
  }

  function emitCursor() {
    notify(cursorListeners, getCursor());
  }

  function setPointerInvert(multiplier: number) {
    pointerInvert = normalizeInvertMultiplier(multiplier) ?? DEFAULT_POINTER_INVERT;
  }

  function setProjection(mode?: ProjectionMode) {
    const normalized: ProjectionMode = mode === "dimetric" ? "dimetric" : "cubic";
    if (projectionMode !== normalized) {
      projectionMode = normalized;
      emitStyle();
    }
  }

  function applySceneState(state: SceneStateShape): SceneSnapshot {
    setProjection(state.projection);
    const cameraState = camera.state;
    const baseContext = {
      rows: state.rows,
      cols: state.cols,
      depth: state.depth,
      showWalls: state.showWalls,
      showFloor: state.showFloor,
      projection: state.projection,
      walls: getWalls(),
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
    subscribeDimensions,
    getCameraState,
    updateCamera,
    subscribeCamera,
    getBoxStyle,
    subscribeBoxStyle,
    getWalls,
    subscribeWalls,
    getCursor,
    subscribeCursor,
    setPointerInvert,
    setProjection,
    applySceneState,
    handlePointerDown,
    handlePointerMove,
    handlePointerUp
  };
}
