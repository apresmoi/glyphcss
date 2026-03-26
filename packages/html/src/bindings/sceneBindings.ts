import type { SceneController, SceneState, WallsMask } from "@layoutit/voxcss-core";
import { createDomRenderer } from "../renderer/domRenderer";
import { injectBaseStyles } from "../styles";
import { wallMasksEqual } from "@layoutit/voxcss-core";

export type { SceneState };

export type SceneComponentProps = Partial<SceneState>;
export const SCENE_HOST_CLASS = "voxcss-scene";

const GRID_RESTORE_DELAY = 120;

export function normalizeSceneState(input: SceneComponentProps): SceneState {
  return {
    voxels: input.voxels ?? [],
    rows: input.rows,
    cols: input.cols,
    depth: input.depth,
    showWalls: input.showWalls ?? false,
    showFloor: input.showFloor ?? false,
    projection: input.projection ?? "cubic",
    mergeVoxels: input.mergeVoxels ?? false
  };
}

export function mountScene({
  controller,
  element,
  ...initial
}: SceneState & { controller: SceneController; element: HTMLElement }) {
  if (!element) {
    throw new Error("voxcss: mountScene requires an element.");
  }
  element.classList.add(SCENE_HOST_CLASS);

  let state: SceneState = normalizeSceneState(initial);
  const doc = element.ownerDocument ?? (typeof document !== "undefined" ? document : undefined);
  if (!doc) {
    throw new Error("voxcss: document is not available. Provide a host element attached to a document.");
  }

  injectBaseStyles(doc);
  const renderer = createDomRenderer({ documentRef: doc, target: element });
  let lastWalls: WallsMask | null = null;
  let lastDimensions = controller.getDimensions();
  let lastProjection = controller.getProjection();
  let lastCamera = controller.getCameraState();
  let lastCursor = controller.getCursor();
  const win = doc.defaultView ?? undefined;
  const requestFrame = win?.requestAnimationFrame?.bind(win) ?? ((cb: FrameRequestCallback) => setTimeout(cb, 16) as unknown as number);
  const cancelFrame = win?.cancelAnimationFrame?.bind(win) ?? ((id: number) => clearTimeout(id));
  const setTimer = (win?.setTimeout?.bind(win) ?? setTimeout) as typeof setTimeout;
  const clearTimer = (win?.clearTimeout?.bind(win) ?? clearTimeout) as typeof clearTimeout;
  let pendingRender: number | null = null;
  let lastSceneSnapshot: ReturnType<typeof controller.applySceneState> | null = null;
  let gridRestoreTimer: ReturnType<typeof setTimeout> | null = null;
  let gridSuppressed = false;
  const applyBoxStyle = (style: Record<string, string>) => {
    Object.entries(style).forEach(([key, value]) => {
      (element.style as CSSStyleDeclaration & Record<string, string>)[key] = value ?? "";
    });
  };
  applyBoxStyle(controller.getBoxStyle());

  const setGridSuppressed = (suppressed: boolean) => {
    if (gridSuppressed === suppressed) return;
    gridSuppressed = suppressed;
    if (suppressed) {
      element.style.setProperty("--voxcss-floor-grid-image", "none");
      element.style.setProperty("--voxcss-ceiling-grid-image", "none");
    } else {
      element.style.removeProperty("--voxcss-floor-grid-image");
      element.style.removeProperty("--voxcss-ceiling-grid-image");
    }
  };

  const scheduleGridRestore = () => {
    if (gridRestoreTimer !== null) clearTimer(gridRestoreTimer);
    gridRestoreTimer = setTimer(() => {
      gridRestoreTimer = null;
      setGridSuppressed(false);
    }, GRID_RESTORE_DELAY);
  };

  const scheduleRender = () => {
    if (pendingRender !== null) return;
    pendingRender = requestFrame(() => {
      pendingRender = null;
      lastSceneSnapshot = controller.applySceneState(state);
      renderer.render(lastSceneSnapshot);
    });
  };
  // Render once synchronously to avoid a long rAF handler on initial mount.
  lastSceneSnapshot = controller.applySceneState(state);
  renderer.render(lastSceneSnapshot);
  lastWalls = controller.getWalls();
  lastDimensions = controller.getDimensions();
  lastProjection = controller.getProjection();

  const unsubscribers = [
    controller.subscribeSnapshot(({ style, walls, cameraOnly, context, camera, cursor }) => {
      applyBoxStyle(style);
      if (cursor) {
        const wasDragging = lastCursor === "grabbing";
        const isDragging = cursor === "grabbing";
        if (wasDragging && !isDragging) {
          if (gridRestoreTimer !== null) {
            clearTimer(gridRestoreTimer);
            gridRestoreTimer = null;
          }
          setGridSuppressed(false);
        }
        lastCursor = cursor;
      }
      if (camera) {
        const rotationChanged = camera.rotX !== lastCamera.rotX || camera.rotY !== lastCamera.rotY;
        if (rotationChanged) {
          setGridSuppressed(true);
          scheduleGridRestore();
        }
        lastCamera = camera;
      }
      if (cameraOnly) {
        const wallsChanged = !lastWalls || !wallMasksEqual(lastWalls, walls);
        if (wallsChanged) {
          lastWalls = walls;
          if (lastSceneSnapshot) {
            lastSceneSnapshot = { ...lastSceneSnapshot, context };
            renderer.render(lastSceneSnapshot);
          } else {
            scheduleRender();
          }
        }
        return;
      }
      const nextDimensions = controller.getDimensions();
      const dimensionsChanged =
        nextDimensions.rows !== lastDimensions.rows ||
        nextDimensions.cols !== lastDimensions.cols ||
        nextDimensions.depth !== lastDimensions.depth;
      const projectionChanged = controller.getProjection() !== lastProjection;
      const wallsChanged = !lastWalls || !wallMasksEqual(lastWalls, walls);
      if (dimensionsChanged || projectionChanged || wallsChanged) {
        lastWalls = walls;
        lastDimensions = nextDimensions;
        lastProjection = controller.getProjection();
        scheduleRender();
      }
    })
  ];

  return {
    update(next: SceneState) {
      const nextState = normalizeSceneState(next);
      const prevState = state;
      state = nextState;
      const shouldRender =
        prevState.voxels !== nextState.voxels ||
        prevState.voxels.length !== nextState.voxels.length ||
        prevState.rows !== nextState.rows ||
        prevState.cols !== nextState.cols ||
        prevState.depth !== nextState.depth ||
        prevState.showWalls !== nextState.showWalls ||
        prevState.showFloor !== nextState.showFloor ||
        prevState.projection !== nextState.projection ||
        prevState.mergeVoxels !== nextState.mergeVoxels;
      if (shouldRender) scheduleRender();
    },
    destroy() {
      if (pendingRender !== null) {
        cancelFrame(pendingRender);
        pendingRender = null;
      }
      if (gridRestoreTimer !== null) {
        clearTimer(gridRestoreTimer);
        gridRestoreTimer = null;
      }
      unsubscribers.forEach((dispose) => dispose());
      renderer.destroy();
    }
  };
}
