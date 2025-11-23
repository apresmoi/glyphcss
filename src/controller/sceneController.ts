import { createIsometricCamera } from "../core/camera";
import type { CameraHandle, CameraState } from "../core/camera";
import type { ProjectionMode, SceneDimensions, WallsMask, SceneContextSnapshot } from "../core";
import { computeWallMask, wallMasksEqual } from "../core";
import { buildSceneContext } from "../core/context";
import type { SceneStateShape } from "./sceneBindings";

type DimensionsListener = (dimensions: Required<SceneDimensions>) => void;
type CameraListener = (state: CameraState) => void;
type StyleListener = (style: Record<string, string>) => void;
type WallsListener = (walls: WallsMask) => void;
type CursorListener = (cursor: string) => void;

type SceneControllerEventPayloads = {
  dimensions: Required<SceneDimensions>;
  camera: CameraState;
  style: Record<string, string>;
  walls: WallsMask;
  cursor: string;
};

type SceneControllerEventName = keyof SceneControllerEventPayloads;

interface SceneControllerEmitter {
  emit<K extends SceneControllerEventName>(event: K, payload: SceneControllerEventPayloads[K]): void;
  subscribe<K extends SceneControllerEventName>(
    event: K,
    listener: (payload: SceneControllerEventPayloads[K]) => void
  ): () => void;
}

function createSceneEmitter(): SceneControllerEmitter {
  const listeners: Partial<Record<SceneControllerEventName, Set<(payload: unknown) => void>>> = {};
  return {
    emit(event, payload) {
      listeners[event]?.forEach((listener) => {
        (listener as (value: typeof payload) => void)(payload);
      });
    },
    subscribe(event, listener) {
      const bucket = (listeners[event] ??= new Set());
      bucket.add(listener as (payload: unknown) => void);
      return () => {
        bucket.delete(listener as (payload: unknown) => void);
        if (bucket.size === 0) {
          delete listeners[event];
        }
      };
    }
  };
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

const DEFAULT_POINTER_INVERT = 1;
const POINTER_DRAG_SPEED = 5;

export function sceneController(options: SceneControllerOptions = {}): SceneController {
  let dimensions: Required<SceneDimensions> = {
    rows: typeof options.dimensions?.rows === "number" ? options.dimensions.rows : DEFAULT_DIMENSIONS.rows,
    cols: typeof options.dimensions?.cols === "number" ? options.dimensions.cols : DEFAULT_DIMENSIONS.cols,
    depth: typeof options.dimensions?.depth === "number" ? options.dimensions.depth : DEFAULT_DIMENSIONS.depth
  };

  const camera: CameraHandle = createIsometricCamera(options.camera);
  let pointerInvert = resolvePointerInvert(options.pointerInvert);
  let projectionMode: ProjectionMode = options.projection === "dimetric" ? "dimetric" : "cubic";

  const emitter = createSceneEmitter();
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
    emitState("dimensions", { ...dimensions });
    emitStyle();
  }

  function subscribeDimensions(listener: DimensionsListener) {
    return subscribeImmediate("dimensions", listener, getDimensions());
  }

  function getDimensions() {
    return { ...dimensions };
  }

  function getCameraState() {
    return { ...camera.state };
  }

  function updateCamera(next: Partial<CameraState>) {
    camera.update(next);
    emitState("camera", { ...camera.state });
    emitStyle();
    emitWalls();
    emitCursor();
  }

  function subscribeCamera(listener: CameraListener) {
    return subscribeImmediate("camera", listener, getCameraState());
  }

  function subscribeBoxStyle(listener: StyleListener) {
    return subscribeImmediate("style", listener, getBoxStyle());
  }

  function subscribeWalls(listener: WallsListener) {
    const snapshot = getWalls();
    lastWalls = snapshot;
    return subscribeImmediate("walls", listener, snapshot);
  }

  function subscribeCursor(listener: CursorListener) {
    return subscribeImmediate("cursor", listener, getCursor());
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
    emitState("camera", { ...camera.state });
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
    emitState("style", getBoxStyle());
  }

  function emitWalls() {
    const snapshot = getWalls();
    if (lastWalls && wallMasksEqual(lastWalls, snapshot)) {
      return;
    }
    lastWalls = snapshot;
    emitState("walls", snapshot);
  }

  function emitCursor() {
    emitState("cursor", getCursor());
  }

  function emitState<K extends SceneControllerEventName>(event: K, payload: SceneControllerEventPayloads[K]) {
    emitter.emit(event, payload);
  }

  function subscribeImmediate<K extends SceneControllerEventName>(
    event: K,
    listener: (payload: SceneControllerEventPayloads[K]) => void,
    initial: SceneControllerEventPayloads[K]
  ): () => void {
    const unsubscribe = emitter.subscribe(event, listener);
    listener(initial);
    return unsubscribe;
  }

  function setPointerInvert(multiplier: number) {
    pointerInvert = resolvePointerInvert(multiplier);
  }

  function setProjection(mode?: ProjectionMode) {
    const normalized: ProjectionMode = mode === "dimetric" ? "dimetric" : "cubic";
    if (projectionMode !== normalized) {
      projectionMode = normalized;
      emitStyle();
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
    setPointerInvert,
    setProjection,
    applySceneState,
    handlePointerDown,
    handlePointerMove,
    handlePointerUp
  };
}

function resolvePointerInvert(value?: number): number {
  if (typeof value === "number" && value !== 0) {
    return value < 0 ? -1 : 1;
  }
  return DEFAULT_POINTER_INVERT;
}
