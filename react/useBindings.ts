import { useEffect, useLayoutEffect, useRef, createContext, useContext } from "react";
import type { RefObject } from "react";
import type { SceneController } from "@voxcss/controller/sceneController";
import { mountScene, type SceneState } from "@voxcss/controller/sceneBindings";

export const SceneControllerContext = createContext<SceneController | null>(null);

export function useSceneControllerContext(): SceneController {
  const controller = useContext(SceneControllerContext);
  if (!controller) {
    throw new Error("voxcss: controller is not ready yet.");
  }
  return controller;
}

export type SceneBindingProps = Partial<SceneState> & {
  controller: SceneController;
  element?: HTMLElement | null;
};

export function useSceneBinding(props: SceneBindingProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const bindingRef = useRef<ReturnType<typeof mountScene> | null>(null);
  const latestProps = useRef(props);

  const resolveState = (input: Partial<SceneState>): SceneState => ({
    voxels: input.voxels ?? [],
    rows: input.rows,
    cols: input.cols,
    depth: input.depth,
    showWalls: input.showWalls ?? false,
    showFloor: input.showFloor ?? false,
    projection: input.projection ?? "cubic"
  });

  useLayoutEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    const { controller, element: _unused, ...state } = latestProps.current;
    bindingRef.current = mountScene({ controller, element, ...resolveState(state) });
    return () => {
      bindingRef.current?.destroy();
      bindingRef.current = null;
    };
  }, []);

  useEffect(() => {
    latestProps.current = props;
    const { controller: _controller, element: _element, ...state } = props;
    bindingRef.current?.update(resolveState(state));
  }, [props]);

  return containerRef;
}
