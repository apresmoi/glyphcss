import React from "react";
import { SCENE_HOST_CLASS, type SceneComponentProps } from "@voxcss/controller/sceneBindings";
import type { MergeVoxelsOption } from "@voxcss/utils/mergeVoxelsOption";
import { useSceneBinding, useSceneControllerContext } from "./useBindings";

export type VoxSceneProps = SceneComponentProps & { mergeVoxels?: MergeVoxelsOption };

export const VoxScene: React.FC<VoxSceneProps> = (props) => {
  const controller = useSceneControllerContext();
  const bindingRef = useSceneBinding({ controller, ...props });
  return <div ref={bindingRef} className={SCENE_HOST_CLASS} />;
};

VoxScene.displayName = "VoxScene";
