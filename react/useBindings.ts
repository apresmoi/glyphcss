import { useEffect, useLayoutEffect, useRef, createContext, useContext } from "react";
import type { RefObject } from "react";
import type { SceneController } from "@voxcss/controller/sceneController";
import { mountScene, normalizeSceneState, type SceneState } from "@voxcss/controller/sceneBindings";

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
  const prevStateRef = useRef<SceneState | null>(null);

  useLayoutEffect(() => {
    latestProps.current = props;
    const element = containerRef.current;
    if (!element) return;
    const { controller, element: _unused, ...state } = latestProps.current;
    bindingRef.current = mountScene({ controller, element, ...normalizeSceneState(state) });
    return () => {
      bindingRef.current?.destroy();
      bindingRef.current = null;
      prevStateRef.current = null;
    };
  }, [props.controller]);

  useEffect(() => {
    latestProps.current = props;
    const { controller: _controller, element: _element, ...state } = props;
    const nextState = normalizeSceneState(state);
    if (prevStateRef.current && sceneStateShallowEqual(prevStateRef.current, nextState)) {
      return;
    }
    prevStateRef.current = nextState;
    bindingRef.current?.update(nextState);
  }, [
    props.controller,
    props.voxels,
    props.rows,
    props.cols,
    props.depth,
    props.showWalls,
    props.showFloor,
    props.projection
  ]);

  return containerRef;
}

function sceneStateShallowEqual(a: SceneState, b: SceneState): boolean {
  return (
    a.voxels === b.voxels &&
    a.rows === b.rows &&
    a.cols === b.cols &&
    a.depth === b.depth &&
    a.showWalls === b.showWalls &&
    a.showFloor === b.showFloor &&
    a.projection === b.projection
  );
}
