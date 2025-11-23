import { createIsometricCamera } from "../core/camera";
import type { CameraHandle, CameraState } from "../core/camera";
import type { ProjectionMode, SceneDimensions, WallsMask, SceneContextSnapshot } from "../core";
import { computeWallMask, wallMasksEqual } from "../core";
import { buildSceneContext } from "../core/context";
import type { SceneStateShape } from "./sceneOptions";

type DimensionsListener = (dimensions: Required<SceneDimensions>) => void;
type CameraListener = (state: CameraState) => void;
type StyleListener = (style: Record<string, string>) => void;
type WallsListener = (walls: WallsMask) => void;
type CursorListener = (cursor: string) => void;

export interface SceneControllerOptions {
  dimensions?: SceneDimensions;
  camera?: Partial<CameraState>;
  controls?: Partial<ControllerControls>;
  projection?: ProjectionMode;
}

export interface ControllerControls {
  invert: number;
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
  setControls(next: Partial<ControllerControls>): void;
  setProjection(mode?: ProjectionMode): void;
  applySceneState(state: SceneStateShape): SceneContextSnapshot;

  handlePointerDown(event: PointerEvent): void;
  handlePointerMove(event: PointerEvent): void;
  handlePointerUp(): void;
}

const DEFAULT_DIMENSIONS: Required<SceneDimensions> = {
  rows: 16,
  cols: 16,
  depth: 12
};

const DEFAULT_CONTROLS: ControllerControls = {
  invert: 1
};

const POINTER_DRAG_SPEED = 5;

export function sceneController(
  options: SceneControllerOptions = {}
): SceneController {
  let dimensions = normalizeDimensions(
    options.dimensions ?? DEFAULT_DIMENSIONS,
    DEFAULT_DIMENSIONS
  );

  const camera: CameraHandle = createIsometricCamera(options.camera);
  let controls: ControllerControls = { ...DEFAULT_CONTROLS, ...(options.controls ?? {}) };
  let projectionMode: ProjectionMode = options.projection === "dimetric" ? "dimetric" : "cubic";

  const dimensionSubscribers = new Set<DimensionsListener>();
  const cameraSubscribers = new Set<CameraListener>();
  const styleSubscribers = new Set<StyleListener>();
  const wallsSubscribers = new Set<WallsListener>();
  let lastWalls: WallsMask | null = null;
  const cursorSubscribers = new Set<CursorListener>();

  const dragState = {
    isDragging: false,
    pointerX: 0,
    pointerY: 0
  };

  function notifyDimensions() {
    const snapshot = { ...dimensions };
    dimensionSubscribers.forEach((listener) => listener(snapshot));
    notifyStyle();
  }

  function notifyCamera() {
    const snapshot = { ...camera.state };
    cameraSubscribers.forEach((listener) => listener(snapshot));
    notifyStyle();
    notifyWalls();
    notifyCursor();
  }

  function notifyStyle() {
    const snapshot = getBoxStyle();
    styleSubscribers.forEach((listener) => listener(snapshot));
  }

  function notifyWalls() {
    const snapshot = getWalls();
    if (lastWalls && wallMasksEqual(lastWalls, snapshot)) {
      return;
    }
    lastWalls = snapshot;
    wallsSubscribers.forEach((listener) => listener(snapshot));
  }

  function notifyCursor() {
    const cursor = getCursor();
    cursorSubscribers.forEach((listener) => listener(cursor));
  }

  function setDimensions(next: SceneDimensions) {
    const merged = normalizeDimensions(next, dimensions);
    const changed = hasDimensionChanges(dimensions, merged);
    dimensions = merged;
    if (changed) {
      notifyDimensions();
    }
  }

  function subscribeDimensions(listener: DimensionsListener) {
    dimensionSubscribers.add(listener);
    return () => {
      dimensionSubscribers.delete(listener);
    };
  }

  function getDimensions() {
    return { ...dimensions };
  }

  function getCameraState() {
    return { ...camera.state };
  }

  function updateCamera(next: Partial<CameraState>) {
    camera.update(next);
    notifyCamera();
  }

  function subscribeCamera(listener: CameraListener) {
    cameraSubscribers.add(listener);
    return () => {
      cameraSubscribers.delete(listener);
    };
  }

  function subscribeBoxStyle(listener: StyleListener) {
    styleSubscribers.add(listener);
    listener(getBoxStyle());
    return () => {
      styleSubscribers.delete(listener);
    };
  }

  function subscribeWalls(listener: WallsListener) {
    wallsSubscribers.add(listener);
    const snapshot = getWalls();
    lastWalls = snapshot;
    listener(snapshot);
    return () => {
      wallsSubscribers.delete(listener);
    };
  }

  function subscribeCursor(listener: CursorListener) {
    cursorSubscribers.add(listener);
    listener(getCursor());
    return () => {
      cursorSubscribers.delete(listener);
    };
  }


  function handlePointerDown(event: PointerEvent) {
    dragState.isDragging = true;
    dragState.pointerX = event.clientX;
    dragState.pointerY = event.clientY;
    notifyCamera();
  }

  function handlePointerMove(event: PointerEvent) {
    if (!dragState.isDragging) return;
    const invert = controls.invert || 1;
    const dX = ((event.clientX - dragState.pointerX) * invert) / POINTER_DRAG_SPEED;
    const dY = ((event.clientY - dragState.pointerY) * invert) / POINTER_DRAG_SPEED;
    const nextRotY = (camera.state.rotY - dX + 360) % 360;
    const nextRotX = Math.max(0, Math.min(100, camera.state.rotX - dY));
    camera.update({ rotX: nextRotX, rotY: nextRotY });
    dragState.pointerX = event.clientX;
    dragState.pointerY = event.clientY;
    notifyCamera();
  }

  function handlePointerUp() {
    dragState.isDragging = false;
    notifyCamera();
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

  function setControls(next: Partial<ControllerControls>) {
    controls = { ...controls, ...(next ?? {}) };
  }

  function setProjection(mode?: ProjectionMode) {
    const normalized: ProjectionMode = mode === "dimetric" ? "dimetric" : "cubic";
    if (projectionMode !== normalized) {
      projectionMode = normalized;
      notifyStyle();
    }
  }

  function applySceneState(state: SceneStateShape): SceneContextSnapshot {
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
      context: baseContext
    });
    setDimensions(scene.dimensions);
    return scene.snapshot;
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
    setControls,
    setProjection,
    applySceneState,
    handlePointerDown,
    handlePointerMove,
    handlePointerUp
  };
}

function normalizeDimensions(
  next: SceneDimensions,
  fallback: Required<SceneDimensions>
): Required<SceneDimensions> {
  return {
    rows: typeof next.rows === "number" ? next.rows : fallback.rows,
    cols: typeof next.cols === "number" ? next.cols : fallback.cols,
    depth: typeof next.depth === "number" ? next.depth : fallback.depth
  };
}

function hasDimensionChanges(
  previous: Required<SceneDimensions>,
  next: Required<SceneDimensions>
): boolean {
  return (
    previous.rows !== next.rows ||
    previous.cols !== next.cols ||
    previous.depth !== next.depth
  );
}
