import { useEffect, useLayoutEffect, useRef, createContext, useContext } from "react";
import type { RefObject } from "react";
import type { SceneBindingOptions } from "@voxcss/controller/sceneBindings";
import { createSceneBinding, ensureSceneController, type SceneBindingHandle } from "@voxcss/controller/sceneBindings";
import type { SceneController } from "@voxcss/controller/sceneController";

export const SceneControllerContext = createContext<SceneController | null>(null);

export function useSceneControllerContext(): SceneController {
  const controller = useContext(SceneControllerContext);
  return ensureSceneController(controller);
}

export type SceneBindingProps = Omit<SceneBindingOptions, "element">;

export function useSceneBinding(props: SceneBindingProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const bindingRef = useRef<SceneBindingHandle | null>(null);
  const latestProps = useRef(props);

  useLayoutEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    const binding = createSceneBinding({ ...latestProps.current, element });
    bindingRef.current = binding;
    return () => {
      binding.destroy();
      bindingRef.current = null;
    };
  }, []);

  useEffect(() => {
    latestProps.current = props;
    bindingRef.current?.update(props);
  }, [props]);

  return containerRef;
}
