import type { SceneController } from "./sceneController";
import type { ProjectionMode, VoxelGrid, WallsMask } from "../core/types";
import { createDomRenderer } from "../core/domRenderer";
import { injectBaseStyles } from "../core/styles";
import { wallMasksEqual } from "../core/context";
import type { MergeVoxelsOption } from "../utils/mergeVoxelsOption";

export interface SceneState {
  voxels: VoxelGrid;
  rows?: number;
  cols?: number;
  depth?: number;
  showWalls: boolean;
  showFloor: boolean;
  projection: ProjectionMode;
  mergeVoxels?: MergeVoxelsOption;
}

export type SceneComponentProps = Partial<SceneState>;
export const SCENE_HOST_CLASS = "voxcss-scene";

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
  const win = doc.defaultView ?? undefined;
  const requestFrame = win?.requestAnimationFrame?.bind(win) ?? ((cb: FrameRequestCallback) => setTimeout(cb, 16) as unknown as number);
  const cancelFrame = win?.cancelAnimationFrame?.bind(win) ?? ((id: number) => clearTimeout(id));
  let pendingRender: number | null = null;
  let lastSceneSnapshot: ReturnType<typeof controller.applySceneState> | null = null;
  const applyBoxStyle = (style: Record<string, string>) => {
    Object.entries(style).forEach(([key, value]) => {
      (element.style as CSSStyleDeclaration & Record<string, string>)[key] = value ?? "";
    });
  };
  applyBoxStyle(controller.getBoxStyle());

  const scheduleRender = () => {
    if (pendingRender !== null) return;
    pendingRender = requestFrame(() => {
      pendingRender = null;
      lastSceneSnapshot = controller.applySceneState(state);
      renderer.render(lastSceneSnapshot);
    });
  };
  scheduleRender();

  const unsubscribers = [
    controller.subscribeSnapshot(({ style, walls, cameraOnly, context }) => {
      applyBoxStyle(style);
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
      unsubscribers.forEach((dispose) => dispose());
      renderer.destroy();
    }
  };
}
