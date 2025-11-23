import React from "react";
import { SCENE_HOST_CLASS, type SceneComponentProps } from "@voxcss/controller/sceneBindings";
import { useSceneBinding, useSceneControllerContext } from "./useBindings";

export const VoxScene: React.FC<SceneComponentProps> = (props) => {
  const controller = useSceneControllerContext();
  const bindingRef = useSceneBinding({ controller, ...props });
  return <div ref={bindingRef} className={SCENE_HOST_CLASS} />;
};

VoxScene.displayName = "VoxScene";

export type { SceneComponentProps as VoxSceneProps } from "@voxcss/controller/sceneBindings";
