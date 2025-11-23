import { useEffect, useLayoutEffect, useRef, createContext, useContext } from "react";
import type { RefObject } from "react";
import type { SceneController } from "@voxcss/controller/sceneController";
import { attachSceneBinding, type AttachSceneBindingOptions } from "@voxcss/controller/domBindings";

export const SceneControllerContext = createContext<SceneController | null>(null);

export function useSceneControllerContext(): SceneController {
  const controller = useContext(SceneControllerContext);
  if (!controller) {
    throw new Error("voxcss: controller is not ready yet.");
  }
  return controller;
}

export type SceneBindingProps = Omit<AttachSceneBindingOptions, "element"> & { controller: SceneController };

export function useSceneBinding(props: SceneBindingProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const bindingRef = useRef<ReturnType<typeof attachSceneBinding>>(null);
  const latestProps = useRef(props);

  useLayoutEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    bindingRef.current = attachSceneBinding({ ...latestProps.current, element });
    return () => {
      bindingRef.current?.destroy();
      bindingRef.current = null;
    };
  }, []);

  useEffect(() => {
    latestProps.current = props;
    bindingRef.current?.update(props);
  }, [props]);

  return containerRef;
}
