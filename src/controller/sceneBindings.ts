import type { SceneController } from "./sceneController";
import type { ProjectionMode, VoxelGrid, WallsMask } from "../core/types";
import { createDomRenderer } from "../core/domRenderer";
import { injectBaseStyles } from "../core/styles";
import { wallMasksEqual } from "../core/context";

export interface SceneState {
  voxels: VoxelGrid;
  rows?: number;
  cols?: number;
  depth?: number;
  showWalls: boolean;
  showFloor: boolean;
  projection: ProjectionMode;
}

export type SceneComponentProps = Partial<SceneState>;
export const SCENE_HOST_CLASS = "voxcss-scene-host";

export function mountScene({
  controller,
  element,
  ...initial
}: SceneState & { controller: SceneController; element: HTMLElement }) {
  if (!element) {
    throw new Error("voxcss: mountScene requires an element.");
  }
  element.classList.add(SCENE_HOST_CLASS);

  let state: SceneState = initial;
  const doc = element.ownerDocument ?? (typeof document !== "undefined" ? document : undefined);
  if (!doc) {
    throw new Error("voxcss: document is not available. Provide a host element attached to a document.");
  }

  injectBaseStyles(doc);
  const renderer = createDomRenderer({ documentRef: doc, target: element });
  let lastWalls: WallsMask | null = null;
  const applyBoxStyle = (style: Record<string, string>) => {
    Object.entries(style).forEach(([key, value]) => {
      (element.style as CSSStyleDeclaration & Record<string, string>)[key] = value ?? "";
    });
  };
  applyBoxStyle(controller.getBoxStyle());

  const rerender = () => renderer.render(controller.applySceneState(state));
  rerender();

  const unsubscribers = [
    controller.subscribeSnapshot(({ style, walls }) => {
      applyBoxStyle(style);
      if (!lastWalls || !wallMasksEqual(lastWalls, walls)) {
        lastWalls = walls;
        rerender();
      }
    })
  ];

  return {
    update(next: SceneState) {
      state = next;
      rerender();
    },
    destroy() {
      unsubscribers.forEach((dispose) => dispose());
      renderer.destroy();
    }
  };
}
