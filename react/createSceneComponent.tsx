import React from "react";
import type { RefObject } from "react";
import type { SceneController } from "@voxcss/controller/sceneController";
import type { SceneBindingOptions } from "@voxcss/controller/sceneBindings";
import { SCENE_HOST_CLASS, ensureSceneController, type SceneComponentProps } from "@voxcss/controller/sceneBindings";

export interface ReactSceneComponentFactoryConfig {
  useController(): SceneController | null;
  useBinding(options: Omit<SceneBindingOptions, "element">): RefObject<HTMLDivElement>;
  className?: string;
}

export function createSceneComponent({
  useController,
  useBinding,
  className = SCENE_HOST_CLASS
}: ReactSceneComponentFactoryConfig) {
  const SceneComponent: React.FC<SceneComponentProps> = (props) => {
    const controller = ensureSceneController(useController());
    const bindingRef = useBinding({ controller, ...props });
    return <div ref={bindingRef} className={className} />;
  };
  SceneComponent.displayName = "VoxScene";
  return SceneComponent;
}

export type { SceneComponentProps };
